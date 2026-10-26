import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cancelRun, mirror, studioOps } from "../src/cli";
import { NotifierConfigMissing, NotifierUnknown, notifier, workDir } from "../src/env";
import {
  canonicalPr, claimRefusedLine, copyTranscript, END_HYGIENE_EVENTS, recordClaimRefusal, endNotice, isGodot, isWithin, NOTICE_MAX_BYTES, notifierSecrets, notify, noticeText, prUrl,
  REFUSED_UNDER_TEST, robocopyOk, scrubNotifier, snapshot, snapshotArgv, SnapshotFailed, snapshotOnce, snapshotTarget, sweepEnds, TRUNCATED_MARKER,
  underBunTest,
} from "../src/hygiene";
import { NOTIFIER_VARS } from "./preload";
import { END_LEASE_STALE_MS, NOTIFIED_BEFORE, Queue, type Owner, type Probes } from "../src/queue";
import type { RunResult } from "../src/server";
import { ensureTranscript } from "../src/transcript";
import { tempDir, track } from "./tmp";

const HOST = hostname();
const A: Owner = { pid: 930001, host: HOST, nonce: "hyg-a" };
const B: Owner = { pid: 930002, host: HOST, nonce: "hyg-b" };
const TG_TOKEN = "123456:tg-very-secret-token";
const PR = "https://github.com/tk/universe/pull/42";

const tmp = (p: string) => tempDir(p);

function fixture(alive = new Set<number>([A.pid])) {
  const dir = tmp("tk-sup-hyg-");
  const checkout = tmp("tk-sup-hyg-checkout-");
  const probes: Probes = {
    ownerAlive: (o) => alive.has(o.pid),
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start) => ({ pid, start, outcome: "not running" }),
  };
  const queue = track(new Queue(join(dir, "q.db"), probes));
  const enqueue = (jobId = "j", extra: { tier?: string; sandbox?: string; flagged?: boolean; owner?: Owner } = {}) =>
    queue.enqueue({
      jobId, root: checkout, projectId: "p", target: "skill", tier: extra.tier, sandbox: extra.sandbox, owner: extra.owner,
      definition: { id: jobId, trigger: "one-shot", target: { skill: "tk-studio-activate" } }, editorInTheLoop: extra.flagged,
    }).run;
  return { dir, checkout, queue, enqueue, alive, db: join(dir, "q.db") };
}

/** A recording fetch answering `status` (or throwing `fail`). */
function fakeFetch(status = 200, fail?: string) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (fail) throw new Error(fail);
    return new Response("ok", { status });
  };
  return { calls, fetchFn };
}

const NTFY_ENV = { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/tk-supervisor" };
const TG_ENV = { TK_SUPERVISOR_NOTIFY: "telegram", TK_SUPERVISOR_TELEGRAM_TOKEN: TG_TOKEN, TK_SUPERVISOR_TELEGRAM_CHAT: "-100777" };

describe("hole 31: the suite never sends a real notification", () => {
  test("the preload stripped the operator's notifier variables before any test loaded, and set the marker", () => {
    for (const name of NOTIFIER_VARS) expect(process.env[name]).toBeUndefined();
    expect(process.env.TK_SUPERVISOR_UNDER_TEST).toBe("1");
    expect(underBunTest()).toBe(true);
    expect(underBunTest({})).toBe(false);
    expect(underBunTest({ NODE_ENV: "test" })).toBe(true);
    expect(notifier(process.env)).toEqual({ kind: "none" });
  });

  test("notify() through the real fetch is refused under bun test, naming no secret; an injected fake still sends", async () => {
    const notice = { run_id: "q-j-1", job_id: "j", project_id: "p", studio_run_id: "j-20260929T101010Z", state: "complete", reason: null };
    const tg = { kind: "telegram" as const, token: TG_TOKEN, chat: "-100777" };
    expect(await notify(tg, notice)).toEqual({ ok: false, via: "telegram", error: REFUSED_UNDER_TEST });
    expect(await notify(tg, notice, fetch)).toEqual({ ok: false, via: "telegram", error: REFUSED_UNDER_TEST });
    expect(await notify({ kind: "ntfy", url: NTFY_ENV.TK_SUPERVISOR_NTFY_URL }, notice)).toMatchObject({ ok: false, via: "ntfy", error: REFUSED_UNDER_TEST });
    expect(REFUSED_UNDER_TEST).not.toContain(TG_TOKEN);
    const fake = fakeFetch();
    expect(await notify(tg, notice, fake.fetchFn)).toEqual({ ok: true, via: "telegram" });
    expect(fake.calls).toHaveLength(1);
  });

  test("the end sweep with the real fetch records the refusal as notify-failed, never a send", async () => {
    const fx = fixture();
    const r = fx.enqueue();
    fx.queue.end(r.run_id, "complete", null);
    await sweepEnds(fx.queue, { env: TG_ENV });
    const ev = fx.queue.events(r.run_id).find((e) => e.kind === "notify-failed")!;
    expect(ev.detail).toEqual({ via: "telegram", error: REFUSED_UNDER_TEST });
    expect(JSON.stringify(fx.queue.events(r.run_id))).not.toContain(TG_TOKEN);
  });
});

describe("environment (operator-decisions §1)", () => {
  test("notifier: unset → none; ntfy needs its URL; telegram its token and chat; named errors never carry a value", () => {
    expect(notifier({})).toEqual({ kind: "none" });
    expect(notifier({ TK_SUPERVISOR_NOTIFY: " " })).toEqual({ kind: "none" });
    expect(notifier(NTFY_ENV)).toEqual({ kind: "ntfy", url: NTFY_ENV.TK_SUPERVISOR_NTFY_URL });
    expect(notifier(TG_ENV)).toEqual({ kind: "telegram", token: TG_TOKEN, chat: "-100777" });
    expect(() => notifier({ TK_SUPERVISOR_NOTIFY: "ntfy" })).toThrow(NotifierConfigMissing);
    expect(() => notifier({ TK_SUPERVISOR_NOTIFY: "ntfy" })).toThrow(/^NotifierConfigMissing: .*TK_SUPERVISOR_NTFY_URL/);
    expect(() => notifier({ ...TG_ENV, TK_SUPERVISOR_TELEGRAM_TOKEN: "" })).toThrow(/TK_SUPERVISOR_TELEGRAM_TOKEN/);
    let err: unknown;
    try { notifier({ ...TG_ENV, TK_SUPERVISOR_TELEGRAM_CHAT: undefined }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(NotifierConfigMissing);
    expect((err as Error).message).toContain("TK_SUPERVISOR_TELEGRAM_CHAT");
    expect((err as Error).message).not.toContain(TG_TOKEN);
    expect(() => notifier({ TK_SUPERVISOR_NOTIFY: "slack" })).toThrow(NotifierUnknown);
  });

  test("workDir: TK_SUPERVISOR_WORK, else undefined", () => {
    expect(workDir({})).toBeUndefined();
    expect(workDir({ TK_SUPERVISOR_WORK: " /w " })).toBe("/w");
  });
});

describe("the editor-in-the-loop snapshot (AC3)", () => {
  test("Godot: project.godot in the root or a first-level folder (game/); none deeper", () => {
    const root = tmp("tk-sup-godot-");
    expect(isGodot(root)).toBeNull();
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "a", "b", "project.godot"), "");
    expect(isGodot(root)).toBeNull(); // depth 2 is not a Godot project
    mkdirSync(join(root, "game"));
    writeFileSync(join(root, "game", "project.godot"), "");
    expect(isGodot(root)).toBe(join(root, "game", "project.godot"));
    writeFileSync(join(root, "project.godot"), "");
    expect(isGodot(root)).toBe(join(root, "project.godot"));
  });

  test("robocopy <root> <target> /E /R:3 /W:5 (never /MIR, bounded retries); exit 0–7 is success, 8+ or a spawn failure is not", async () => {
    expect(snapshotArgv("C:\\p", "D:\\w\\snapshots\\p\\q-1")).toEqual(["C:\\p", "D:\\w\\snapshots\\p\\q-1", "/E", "/R:3", "/W:5"]);
    expect(snapshotTarget("/w", "proj", "q-1")).toBe(join("/w", "snapshots", "proj", "q-1"));
    for (const code of [0, 1, 3, 7]) expect(robocopyOk(code)).toBe(true);
    for (const code of [8, 16, null, -1]) expect(robocopyOk(code)).toBe(false);
    const seen: [string, string[]][] = [];
    const runner = (exit: number | null) => async (bin: string, args: string[]): Promise<RunResult> => { seen.push([bin, args]); return { exit, stdout: "", stderr: "" }; };
    expect(await snapshot("/p", "/t", runner(1))).toEqual({ ok: true, exit: 1 });
    expect(seen).toEqual([["robocopy", ["/p", "/t", "/E", "/R:3", "/W:5"]]]);
    expect(seen.flat(2)).not.toContain("/MIR");
    expect(await snapshot("/p", "/t", runner(8))).toEqual({ ok: false, detail: "robocopy exited 8" });
    const spawnFail = await snapshot("/p", "/t", async () => { throw new Error("spawn robocopy ENOENT"); });
    expect(spawnFail).toMatchObject({ ok: false, detail: expect.stringContaining("ENOENT") });
  });

  test("flagged Godot run: one snapshot under <work>/snapshots/<project id>/<queue run id>, its path on the run; once per queue run", async () => {
    const fx = fixture();
    mkdirSync(join(fx.checkout, "game"));
    writeFileSync(join(fx.checkout, "game", "project.godot"), "");
    const run = fx.enqueue("j", { flagged: true });
    expect(run.editor_in_the_loop).toBe(1);
    const work = tmp("tk-sup-work-");
    const calls: string[][] = [];
    const deps = { env: { TK_SUPERVISOR_WORK: work }, run: async (_b: string, args: string[]) => { calls.push(args); return { exit: 3, stdout: "", stderr: "" }; } };
    await snapshotOnce(fx.queue, run, "p", fx.checkout, deps);
    const target = join(work, "snapshots", "p", run.run_id);
    expect(calls).toEqual([[fx.checkout, target, "/E", "/R:3", "/W:5"]]);
    expect(fx.queue.events(run.run_id).at(-1)).toMatchObject({ kind: "snapshot", from_state: "queued", detail: { path: target, exit: 3 } });
    await snapshotOnce(fx.queue, fx.queue.get(run.run_id)!, "p", fx.checkout, deps); // adopted / resumed: none again
    expect(calls).toHaveLength(1);
  });

  test("unflagged: nothing; flagged non-Godot: no robocopy, the reason recorded; no work folder or robocopy ≥8 → SnapshotFailed", async () => {
    const fx = fixture();
    const calls: string[][] = [];
    const run = (exit: number) => async (_b: string, args: string[]) => { calls.push(args); return { exit, stdout: "", stderr: "" }; };
    const plain = fx.enqueue("plain");
    await snapshotOnce(fx.queue, plain, "p", fx.checkout, { env: { TK_SUPERVISOR_WORK: "/w" }, run: run(0) });
    expect(fx.queue.events(plain.run_id).map((e) => e.kind)).toEqual(["enqueued"]);

    const flagged = fx.enqueue("flagged", { flagged: true });
    await snapshotOnce(fx.queue, flagged, "p", fx.checkout, { env: { TK_SUPERVISOR_WORK: "/w" }, run: run(0) });
    expect(calls).toEqual([]);
    expect(fx.queue.events(flagged.run_id).at(-1)).toMatchObject({ kind: "snapshot-skipped", detail: { why: expect.stringContaining("not a Godot project") } });

    writeFileSync(join(fx.checkout, "project.godot"), "");
    const godot = fx.enqueue("godot", { flagged: true });
    await expect(snapshotOnce(fx.queue, godot, "p", fx.checkout, { env: {}, run: run(0) })).rejects.toThrow(/^snapshot failed: WorkDirMissing/);
    await expect(snapshotOnce(fx.queue, godot, "p", fx.checkout, { env: { TK_SUPERVISOR_WORK: "/w" }, run: run(8) })).rejects.toThrow(SnapshotFailed);
    await expect(snapshotOnce(fx.queue, godot, "p", fx.checkout, { env: { TK_SUPERVISOR_WORK: "/w" }, run: run(8) })).rejects.toThrow("snapshot failed: robocopy exited 8");
    expect(fx.queue.events(godot.run_id).some((e) => e.kind === "snapshot")).toBe(false);
  });

  test("a work folder that is the project root or lies inside it: SnapshotFailed, robocopy never spawned", async () => {
    const fx = fixture();
    writeFileSync(join(fx.checkout, "project.godot"), "");
    const calls: string[][] = [];
    const runner = async (_b: string, args: string[]) => { calls.push(args); return { exit: 0, stdout: "", stderr: "" }; };
    for (const work of [fx.checkout, join(fx.checkout, "work"), `${fx.checkout}/./work/../`]) {
      const run = fx.enqueue(`nested-${calls.length}-${work.length}`, { flagged: true });
      await expect(snapshotOnce(fx.queue, run, "p", fx.checkout, { env: { TK_SUPERVISOR_WORK: work }, run: runner }))
        .rejects.toThrow("snapshot failed: TK_SUPERVISOR_WORK is the project root or lies inside it: the snapshot would copy into itself");
      expect(fx.queue.events(run.run_id).some((e) => e.kind === "snapshot")).toBe(false);
    }
    expect(await snapshot(fx.checkout, join(fx.checkout, "snapshots", "p", "q-1"), runner)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    // A sibling folder (even one sharing the root's name as a prefix) is outside: robocopy runs.
    const sibling = `${fx.checkout}-work`;
    expect(await snapshot(fx.checkout, join(sibling, "snapshots", "p", "q-1"), runner)).toEqual({ ok: true, exit: 0 });
    expect(calls).toHaveLength(1);
  });

  test("isWithin: equal or nested, resolved; case-insensitive on win32 only; another drive or a sibling is outside", () => {
    expect(isWithin("C:\\Proj", "C:\\Proj", "win32")).toBe(true);
    expect(isWithin("C:\\Proj", "c:\\proj\\work\\snapshots\\p\\q-1", "win32")).toBe(true);
    expect(isWithin("C:\\Proj\\", "C:\\PROJ\\sub\\..\\work", "win32")).toBe(true);
    expect(isWithin("C:\\Proj", "C:\\Project2\\work", "win32")).toBe(false);
    expect(isWithin("C:\\Proj", "D:\\Proj\\work", "win32")).toBe(false);
    expect(isWithin("C:\\Proj", "C:\\work", "win32")).toBe(false);
    expect(isWithin("C:\\Proj", "C:\\Proj\\..foo", "win32")).toBe(true); // a folder named `..foo` inside
    expect(isWithin("/srv/proj", "/srv/proj/work", "linux")).toBe(true);
    expect(isWithin("/srv/proj", "/srv/Proj/work", "linux")).toBe(false);
    expect(isWithin("/srv/proj", "/srv/proj-work", "linux")).toBe(false);
    expect(isWithin("/srv/proj", "/srv", "linux")).toBe(false);
  });
});

describe("the notification (AC4)", () => {
  const notice = { run_id: "q-j-1", job_id: "j", project_id: "p", studio_run_id: "j-20260929T101010Z", state: "partial", reason: "guard: max_turns (40)" };

  test("the PR: a GitHub pull-request URL among the status block's artifacts[], else none", () => {
    expect(prUrl({ artifacts: ["docs/x.md", PR, "https://github.com/tk/u/pull/43"] })).toBe(PR);
    expect(prUrl({ artifacts: ["https://github.com/tk/u/issues/4", ".bmad-loop/runs/r1"] })).toBeUndefined();
    expect(prUrl({})).toBeUndefined();
    expect(prUrl(undefined)).toBeUndefined();
    expect(noticeText({ ...notice, pr: PR })).toContain(`PR: ${PR}`);
    expect(noticeText(notice)).not.toContain("PR:");
  });

  test("ntfy: one POST to the topic URL naming the run, its state, its reason and its PR", async () => {
    const { calls, fetchFn } = fakeFetch();
    expect(await notify({ kind: "ntfy", url: NTFY_ENV.TK_SUPERVISOR_NTFY_URL }, { ...notice, pr: PR }, fetchFn)).toEqual({ ok: true, via: "ntfy" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(NTFY_ENV.TK_SUPERVISOR_NTFY_URL);
    expect(calls[0].init?.method).toBe("POST");
    const body = String(calls[0].init?.body);
    for (const s of ["q-j-1", "partial", "guard: max_turns (40)", PR]) expect(body).toContain(s);
  });

  test("telegram: one sendMessage with the same content; a failure never carries the token or its Bot API URL", async () => {
    const ok = fakeFetch();
    expect(await notify({ kind: "telegram", token: TG_TOKEN, chat: "-100777" }, notice, ok.fetchFn)).toEqual({ ok: true, via: "telegram" });
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0].url).toBe(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
    const sent = JSON.parse(String(ok.calls[0].init?.body));
    expect(sent.chat_id).toBe("-100777");
    for (const s of ["q-j-1", "partial", "guard: max_turns (40)"]) expect(sent.text).toContain(s);

    const thrown = fakeFetch(200, `fetch failed: https://api.telegram.org/bot${TG_TOKEN}/sendMessage unreachable (${TG_TOKEN})`);
    const failed = await notify({ kind: "telegram", token: TG_TOKEN, chat: "-100777" }, notice, thrown.fetchFn);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(TG_TOKEN);
    expect(JSON.stringify(failed)).not.toContain("api.telegram.org/bot");
    expect(await notify({ kind: "telegram", token: TG_TOKEN, chat: "-100777" }, notice, fakeFetch(502).fetchFn)).toEqual({ ok: false, via: "telegram", error: "HTTP 502" });
  });

  test("a long reason is cut with a marker, within Telegram's and ntfy's limits; run id, state and PR stay whole", async () => {
    const long = { ...notice, pr: PR, reason: `worker failed: ${"é".repeat(6000)}${"x".repeat(6000)}` };
    const text = noticeText(long);
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(NOTICE_MAX_BYTES);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toStartWith(`supervisor: run ${notice.run_id} ended ${notice.state}\n`);
    expect(text).toContain(`${TRUNCATED_MARKER}\n`);
    expect(text).toContain("reason: worker failed: é");
    expect(text).toEndWith(`PR: ${PR}`);
    expect(text).not.toContain("\uFFFD");
    expect(noticeText(notice)).not.toContain(TRUNCATED_MARKER); // a short reason is untouched
    // What goes out is the capped text, through both notifiers.
    const n = fakeFetch(), t = fakeFetch();
    await notify({ kind: "ntfy", url: NTFY_ENV.TK_SUPERVISOR_NTFY_URL }, long, n.fetchFn);
    await notify({ kind: "telegram", token: TG_TOKEN, chat: "-1" }, long, t.fetchFn);
    expect(String(n.calls[0].init?.body)).toBe(text);
    expect(JSON.parse(String(t.calls[0].init?.body)).text).toBe(text);
  });

  test("ntfy: a failure never carries the topic URL, its userinfo or its auth query (NFR5)", async () => {
    const url = "https://alice:s3cr3t-pw@ntfy.example/tk-secret-topic?auth=QXV0aFRva2VuCg";
    const fx = fixture();
    const r = fx.enqueue();
    fx.queue.end(r.run_id, "complete", null);
    const thrown = fakeFetch(200, `fetch failed: ${url} (connect ECONNREFUSED); retry https://ntfy.example/tk-secret-topic; auth=QXV0aFRva2VuCg; user alice:s3cr3t-pw`);
    const env = { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: url };
    expect(await sweepEnds(fx.queue, { env, fetch: thrown.fetchFn })).toEqual([r.run_id]);
    expect(thrown.calls[0].url).toBe(url);
    const failed = fx.queue.events(r.run_id).find((e) => e.kind === "notify-failed")!;
    expect(String(failed.detail!.error)).toContain("ECONNREFUSED");
    const all = JSON.stringify(fx.queue.events(r.run_id));
    for (const secret of [url, "ntfy.example/tk-secret-topic", "tk-secret-topic", "s3cr3t-pw", "QXV0aFRva2VuCg"]) expect(all).not.toContain(secret);
  });

  test("ntfy: userinfo with a bare % (not percent-encoded) still redacts the auth query and the topic (NFR5)", async () => {
    const url = "https://a%zz:p%zz@ntfy.example/tk-pct-topic?auth=UGN0VG9rZW4K";
    const n = { kind: "ntfy" as const, url };
    const secrets = notifierSecrets(n);
    for (const s of ["a%zz", "p%zz", "a%zz:p%zz@", "UGN0VG9rZW4K", "tk-pct-topic"]) expect(secrets).toContain(s);
    const scrubbed = scrubNotifier(n, `fetch failed: ${url}; auth=UGN0VG9rZW4K; topic tk-pct-topic; user a%zz:p%zz`);
    for (const s of ["UGN0VG9rZW4K", "tk-pct-topic", "a%zz", "p%zz"]) expect(scrubbed).not.toContain(s);
    // And through a failed send.
    const failed = await notify(n, notice, fakeFetch(200, `fetch failed: ${url} (ECONNREFUSED); auth=UGN0VG9rZW4K tk-pct-topic`).fetchFn);
    expect(failed.ok).toBe(false);
    for (const s of ["UGN0VG9rZW4K", "tk-pct-topic", "p%zz"]) expect(JSON.stringify(failed)).not.toContain(s);
  });

  test("an outcome event that cannot be recorded (e.g. SQLITE_BUSY) leaves the lease, never done; a later sweep after staleness records it and finalises", async () => {
    const fx = fixture();
    const r = fx.enqueue();
    fx.queue.end(r.run_id, "complete", null);
    const note = fx.queue.note.bind(fx.queue), claimEnd = fx.queue.claimEnd.bind(fx.queue);
    let busy = true;
    fx.queue.note = (id, kind, detail) => {
      if (busy && kind === "notified") { busy = false; throw new Error("SQLITE_BUSY: database is locked"); }
      note(id, kind, detail);
    };
    // This sweep's lease is written already past END_LEASE_STALE_MS (as if it were taken long ago).
    fx.queue.claimEnd = (id, by, _at) => claimEnd(id, by, Date.now() - END_LEASE_STALE_MS - 60_000);
    const first = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: first.fetchFn })).toEqual([]);
    expect(first.calls).toHaveLength(1);
    expect(fx.queue.get(r.run_id)!.notified).toStartWith("lease ");
    expect(fx.queue.events(r.run_id).map((e) => e.kind)).not.toContain("notified");
    fx.queue.claimEnd = claimEnd;
    // The stale lease is re-claimed: the notification is recorded, the recorded copy stage is not repeated.
    const later = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: later.fetchFn })).toEqual([r.run_id]);
    expect(later.calls).toHaveLength(1);
    const kinds = fx.queue.events(r.run_id).map((e) => e.kind);
    expect(kinds.filter((k) => k === "notified")).toHaveLength(1);
    expect(kinds.filter((k) => k === "transcript-copy-skipped")).toHaveLength(1);
    expect(fx.queue.get(r.run_id)!.notified).toStartWith("done ");
  });

  test("a claimant that died between the lease and the send: a later sweep re-claims the stale lease and sends once; a fresh lease is left alone", async () => {
    const fx = fixture();
    const crashed = fx.enqueue("crashed"), busy = fx.enqueue("busy");
    fx.queue.end(crashed.run_id, "blocked", "worker failed");
    fx.queue.end(busy.run_id, "complete", null);
    // B leased `crashed` 11 minutes ago and died before sending; A leased `busy` just now and is still sending.
    expect(fx.queue.claimEnd(crashed.run_id, B, Date.now() - END_LEASE_STALE_MS - 60_000)).toStartWith("lease ");
    const fresh = fx.queue.claimEnd(busy.run_id, A)!;
    const f = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: f.fetchFn })).toEqual([crashed.run_id]);
    expect(f.calls).toHaveLength(1);
    expect(String(f.calls[0].init?.body)).toContain(`run ${crashed.run_id} ended blocked`);
    expect(fx.queue.get(crashed.run_id)!.notified).toStartWith("done ");
    expect(fx.queue.get(busy.run_id)!.notified).toBe(fresh); // never re-claimed while fresh
    expect(fx.queue.events(busy.run_id).filter((e) => (END_HYGIENE_EVENTS as readonly string[]).includes(e.kind))).toEqual([]);
    // Once done, never again.
    const again = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: again.fetchFn })).toEqual([]);
    expect(again.calls).toEqual([]);
    expect(fx.queue.events(crashed.run_id).filter((e) => e.kind === "notified")).toHaveLength(1);
  });

  test("a re-claimed stale lease does not repeat a stage whose outcome is recorded (died after the send, before finalising)", async () => {
    const fx = fixture();
    const r = fx.enqueue();
    fx.queue.end(r.run_id, "complete", null);
    fx.queue.claimEnd(r.run_id, B, Date.now() - END_LEASE_STALE_MS - 60_000);
    fx.queue.note(r.run_id, "notified", { via: "ntfy", state: "complete" }); // B sent, then died
    const f = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: f.fetchFn })).toEqual([r.run_id]);
    expect(f.calls).toEqual([]);
    const kinds = fx.queue.events(r.run_id).map((e) => e.kind);
    expect(kinds.filter((k) => k === "notified")).toHaveLength(1);
    expect(kinds.at(-1)).toBe("transcript-copy-skipped"); // the copy stage still ran (no session recorded)
    expect(fx.queue.get(r.run_id)!.notified).toStartWith("done ");
  });

  test("every terminal path (complete, partial, blocked, cancelled, orphaned) → exactly one notification; never again", async () => {
    const fx = fixture(new Set([A.pid, B.pid]));
    const complete = fx.enqueue("c", { owner: A }), partial = fx.enqueue("p", { owner: A }), blocked = fx.enqueue("b", { owner: A });
    // One checkout lock: each run is claimed once the previous one ended.
    // complete through mirror, with the PR in the status block's artifacts[].
    expect((await fx.queue.claim(complete.run_id, A)).claimed).toBe(true);
    await mirror(fx.queue, complete.run_id, { jobId: "c", defn: {} }, {
      ok: true, job_id: "c", run_id: null, state: "complete", status_block: { status: "complete", artifacts: [PR] },
    });
    expect((await fx.queue.claim(partial.run_id, A)).claimed).toBe(true);
    fx.queue.end(partial.run_id, "partial", "guard: max_turns (40)");
    expect((await fx.queue.claim(blocked.run_id, A)).claimed).toBe(true);
    await fx.queue.endDriven(blocked.run_id, "blocked", "worker failed");
    // cancelled through the API's cancel ruling.
    const cancelled = fx.enqueue("x");
    const tg = fakeFetch();
    await cancelRun(fx.queue, cancelled.run_id, { hygiene: { env: TG_ENV, fetch: tg.fetchFn } });
    expect(tg.calls).toHaveLength(1); // the cancel's sweep covers only the run it cancelled
    // The driven ends' own sweep (their driver's, in production) notifies the other three, once each.
    expect(await sweepEnds(fx.queue, { env: TG_ENV, fetch: tg.fetchFn })).toEqual([complete.run_id, partial.run_id, blocked.run_id]);
    expect(tg.calls).toHaveLength(4);
    // orphaned through the restart rule: a dead owner's run that reached no verb is re-queued, one past its verb ended.
    const orphan = fx.enqueue("o", { owner: B });
    await fx.queue.claim(orphan.run_id, B);
    fx.queue.markVerbStarted(orphan.run_id, "wake", [], { target: "skill", definition: { id: "o" } });
    fx.queue.setStudioRun(orphan.run_id, "o-20260929T101010Z");
    fx.alive.delete(B.pid);
    await fx.queue.recover(studioOps(async (_root, a) => a[0] === "status" ? { runs: [{ run_id: "o-20260929T101010Z", state: "running" }] } : { state: "partial" }), A);
    expect(fx.queue.get(orphan.run_id)!.state).toBe("partial");
    const ntfy = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: ntfy.fetchFn })).toEqual([orphan.run_id]);
    expect(ntfy.calls).toHaveLength(1);
    expect(String(ntfy.calls[0].init?.body)).toContain("orphaned: supervisor restart");

    const texts = tg.calls.map((c) => JSON.parse(String(c.init?.body)).text as string);
    for (const [r, state] of [[complete, "complete"], [partial, "partial"], [blocked, "blocked"], [cancelled, "cancelled"]] as const) {
      const mine = texts.filter((t) => t.includes(r.run_id));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toContain(`ended ${state}`);
    }
    expect(texts.find((t) => t.includes(complete.run_id))).toContain(`PR: ${PR}`);
    expect(texts.find((t) => t.includes(partial.run_id))).toContain("reason: guard: max_turns (40)");
    expect(texts.find((t) => t.includes(partial.run_id))).not.toContain("PR:");
    expect(fx.queue.events(complete.run_id).find((e) => e.kind === "notified")!.detail).toEqual({ via: "telegram", state: "complete", pr: PR });

    // Never again: every end is claimed.
    const again = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: again.fetchFn })).toEqual([]);
    expect(again.calls).toEqual([]);
    for (const r of fx.queue.runs()) {
      expect(fx.queue.events(r.run_id).filter((e) => e.kind === "notified")).toHaveLength(1);
      expect(fx.queue.get(r.run_id)!.notified).toStartWith("done "); // every lease finalised
    }
    // The end hygiene's events come only after the run's ending event, and nothing else does.
    const hygiene = new Set<string>(END_HYGIENE_EVENTS);
    for (const r of fx.queue.runs()) {
      const kinds = fx.queue.events(r.run_id).map((e) => e.kind);
      const end = kinds.findIndex((k) => k === "ended" || k === "orphaned");
      expect(end).toBeGreaterThanOrEqual(0);
      expect(kinds.slice(0, end).filter((k) => hygiene.has(k))).toEqual([]);
      expect(kinds.slice(end + 1).filter((k) => !hygiene.has(k))).toEqual([]);
    }
  });

  test("once per run across processes: two queues on one file, one claim", async () => {
    const fx = fixture();
    const r = fx.enqueue();
    fx.queue.end(r.run_id, "complete", null);
    const other = track(new Queue(fx.db, fx.queue.probes));
    try {
      const a = fakeFetch(), b = fakeFetch();
      const [x, y] = await Promise.all([sweepEnds(fx.queue, { env: NTFY_ENV, fetch: a.fetchFn }), sweepEnds(other, { env: NTFY_ENV, fetch: b.fetchFn })]);
      expect([...x, ...y]).toEqual([r.run_id]);
      expect(a.calls.length + b.calls.length).toBe(1);
    } finally { other.close(); }
  });

  test("a send failure is an event; the run's state is unchanged; no notifier → an event says so", async () => {
    const fx = fixture();
    const r = fx.enqueue();
    fx.queue.end(r.run_id, "complete", "done");
    await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: fakeFetch(500).fetchFn });
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "complete", reason: "done" });
    expect(fx.queue.events(r.run_id).find((e) => e.kind === "notify-failed")).toMatchObject({ from_state: "complete", to_state: "complete", detail: { via: "ntfy", error: "HTTP 500" } });

    const none = fx.enqueue("n");
    fx.queue.end(none.run_id, "blocked", "x");
    const f = fakeFetch();
    await sweepEnds(fx.queue, { env: {}, fetch: f.fetchFn });
    expect(f.calls).toEqual([]);
    expect(fx.queue.events(none.run_id).find((e) => e.kind === "notify-skipped")!.detail).toEqual({ why: "no notifier configured (TK_SUPERVISOR_NOTIFY is unset)" });
  });

  test("a misconfigured notifier at sweep time: a named failure event, never the token", async () => {
    const fx = fixture();
    const r = fx.enqueue();
    fx.queue.end(r.run_id, "complete", null);
    await sweepEnds(fx.queue, { env: { ...TG_ENV, TK_SUPERVISOR_TELEGRAM_CHAT: "" }, fetch: fakeFetch().fetchFn });
    const ev = fx.queue.events(r.run_id).find((e) => e.kind === "notify-failed")!;
    expect(String(ev.detail!.error)).toStartWith("NotifierConfigMissing:");
    expect(JSON.stringify(fx.queue.events(r.run_id))).not.toContain(TG_TOKEN);
  });

  test("endNotice reads the PR the ending event carries", async () => {
    const fx = fixture();
    const r = fx.enqueue("j", { owner: A });
    await fx.queue.claim(r.run_id, A);
    await mirror(fx.queue, r.run_id, { jobId: "j", defn: {} }, { ok: false, job_id: "j", run_id: null, state: "blocked", reason: "gap", status_block: { artifacts: [PR] } });
    expect(endNotice(fx.queue, fx.queue.get(r.run_id)!)).toMatchObject({ run_id: r.run_id, state: "blocked", reason: "gap", pr: PR });
  });

  test("the PR is canonical: a trailing path, query or fragment is dropped, however long", () => {
    const long = "x".repeat(20_000);
    expect(prUrl({ artifacts: [`${PR}/files?diff=split#${long}`] })).toBe(PR);
    expect(prUrl({ artifacts: [`  ${PR}?${long}  `] })).toBe(PR);
    expect(prUrl({ artifacts: [`${PR}#discussion_r1`] })).toBe(PR);
    expect(canonicalPr(`${PR}/${long}`)).toBe(PR);
    expect(canonicalPr(`https://github.com/${"o".repeat(40)}/r/pull/1`)).toBeUndefined(); // no owner is that long
    expect(canonicalPr(`https://github.com/o/${"r".repeat(101)}/pull/1`)).toBeUndefined();
    expect(canonicalPr(`${PR}x`)).toBeUndefined();
    expect(canonicalPr(42)).toBeUndefined();
  });

  test("a long PR suffix and a long reason: the notice that goes out stays within NOTICE_MAX_BYTES, the PR line canonical", async () => {
    const fx = fixture();
    const r = fx.enqueue("j", { owner: A });
    await fx.queue.claim(r.run_id, A);
    const suffix = `?${"q".repeat(8000)}#${"é".repeat(4000)}`;
    await mirror(fx.queue, r.run_id, { jobId: "j", defn: {} }, {
      ok: false, job_id: "j", run_id: null, state: "blocked", reason: `gap: ${"r".repeat(8000)}`, status_block: { artifacts: [`${PR}${suffix}`] },
    });
    const f = fakeFetch();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: f.fetchFn })).toEqual([r.run_id]);
    const body = String(f.calls[0].init?.body);
    expect(Buffer.byteLength(body, "utf-8")).toBeLessThanOrEqual(NOTICE_MAX_BYTES);
    expect(body).toEndWith(`\nPR: ${PR}`);
    expect(body).not.toContain("qqqq");
    expect(body).toContain(TRUNCATED_MARKER);
    expect(fx.queue.events(r.run_id).find((e) => e.kind === "notified")!.detail).toEqual({ via: "ntfy", state: "blocked", pr: PR });
    // Even a raw suffix recorded on an ending event (an older record) is cut back to the canonical URL.
    expect(noticeText({ ...endNotice(fx.queue, fx.queue.get(r.run_id)!), pr: canonicalPr(`${PR}${suffix}`) })).toEndWith(`PR: ${PR}`);
  });

  test("a cancel sweeps only the run it cancelled: an unrelated unclaimed end stays unswept and unnotified", async () => {
    const fx = fixture();
    const other = fx.enqueue("other");
    fx.queue.end(other.run_id, "blocked", "worker failed"); // its driver has not swept it yet
    const target = fx.enqueue("target");
    const f = fakeFetch();
    const ended = await cancelRun(fx.queue, target.run_id, { hygiene: { env: NTFY_ENV, fetch: f.fetchFn } });
    expect(ended.state).toBe("cancelled");
    expect(f.calls).toHaveLength(1);
    expect(String(f.calls[0].init?.body)).toContain(`run ${target.run_id} ended cancelled`);
    expect(fx.queue.get(target.run_id)!.notified).toStartWith("done ");
    expect(fx.queue.get(other.run_id)!.notified).toBeNull();
    expect(fx.queue.events(other.run_id).filter((e) => (END_HYGIENE_EVENTS as readonly string[]).includes(e.kind))).toEqual([]);
    // Its own driver's (or recover's, or drain's) sweep still notifies it.
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: f.fetchFn })).toEqual([other.run_id]);
    expect(f.calls).toHaveLength(2);
  });

  test("a cancel of an unknown run id sends nothing and sweeps nothing", async () => {
    const fx = fixture();
    const other = fx.enqueue("other");
    fx.queue.end(other.run_id, "complete", null);
    const f = fakeFetch();
    await expect(cancelRun(fx.queue, "q-no-such-run", { hygiene: { env: NTFY_ENV, fetch: f.fetchFn } })).rejects.toThrow("queue run 'q-no-such-run' not found");
    expect(f.calls).toEqual([]);
    expect(fx.queue.get(other.run_id)!.notified).toBeNull();
    expect(await sweepEnds(fx.queue, { env: NTFY_ENV, fetch: f.fetchFn }, ["q-no-such-run"])).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});

describe("the per-run transcript copy (AC4)", () => {
  function transcript(sid: string) {
    const config = tmp("tk-sup-hyg-config-");
    const slug = join(config, "projects", "C--proj-slug");
    mkdirSync(join(slug, sid, "subagents"), { recursive: true });
    writeFileSync(join(slug, `${sid}.jsonl`), '{"type":"assistant","message":{"id":"m1"}}\n');
    writeFileSync(join(slug, sid, "subagents", "agent-1.jsonl"), '{"type":"assistant","message":{"id":"m2"}}\n');
    return { config, slug };
  }

  test("host: <backup>/<slug>/<sid>.jsonl + <sid>/subagents/, and ensureTranscript restores from that copy", () => {
    const sid = "0c5e1a52-1111-4a4a-9b9b-222222222222";
    const { config, slug } = transcript(sid);
    const backup = tmp("tk-sup-hyg-backup-");
    expect(copyTranscript(sid, backup, config)).toEqual({ path: join(backup, "C--proj-slug", `${sid}.jsonl`), subagents: 1 });
    expect(readFileSync(join(backup, "C--proj-slug", sid, "subagents", "agent-1.jsonl"), "utf-8")).toContain("m2");
    // The CLI garbage-collected it: the 21-6 restore finds the per-run copy.
    rmSync(slug, { recursive: true, force: true });
    expect(ensureTranscript(sid, config, backup)).toEqual({ path: join(config, "projects", "C--proj-slug", `${sid}.jsonl`), restored: true });
    expect(existsSync(join(config, "projects", "C--proj-slug", sid, "subagents", "agent-1.jsonl"))).toBe(true);
  });

  test("the sweep copies a host run's transcript; sbx is skipped (VM-resident); a missing backup variable or transcript is an event", async () => {
    const fx = fixture(new Set([A.pid]));
    const sid = "0c5e1a52-3333-4a4a-9b9b-444444444444";
    const { config } = transcript(sid);
    const backup = tmp("tk-sup-hyg-backup-");
    const host = fx.enqueue("h", { owner: A });
    await fx.queue.claim(host.run_id, A);
    fx.queue.setSession(host.run_id, sid);
    fx.queue.end(host.run_id, "complete", null);
    const env = { CLAUDE_CONFIG_DIR: config, TK_SUPERVISOR_TRANSCRIPT_BACKUP: backup };
    await sweepEnds(fx.queue, { env });
    expect(fx.queue.events(host.run_id).find((e) => e.kind === "transcript-copied")!.detail)
      .toEqual({ session_id: sid, path: join(backup, "C--proj-slug", `${sid}.jsonl`), subagents: 1 });

    const sbx = fx.enqueue("s", { owner: A, tier: "sbx", sandbox: "claude-p" });
    await fx.queue.claim(sbx.run_id, A);
    fx.queue.setSession(sbx.run_id, "sbx-session");
    fx.queue.end(sbx.run_id, "partial", "x");
    const unset = fx.enqueue("u", { owner: A });
    await fx.queue.claim(unset.run_id, A);
    fx.queue.setSession(unset.run_id, sid);
    fx.queue.end(unset.run_id, "complete", null);
    await sweepEnds(fx.queue, { env: { CLAUDE_CONFIG_DIR: config } });
    expect(fx.queue.events(sbx.run_id).find((e) => e.kind === "transcript-copy-skipped")!.detail!.why).toContain("VM-resident");
    expect(fx.queue.events(unset.run_id).find((e) => e.kind === "transcript-copy-failed")!.detail).toMatchObject({ error: "TK_SUPERVISOR_TRANSCRIPT_BACKUP is unset" });

    const gone = fx.enqueue("g", { owner: A });
    await fx.queue.claim(gone.run_id, A);
    fx.queue.setSession(gone.run_id, "no-such-session");
    fx.queue.end(gone.run_id, "complete", null);
    await sweepEnds(fx.queue, { env });
    expect(fx.queue.events(gone.run_id).find((e) => e.kind === "transcript-copy-failed")!.detail!.error).toContain("not found");
    expect(fx.queue.get(gone.run_id)!.state).toBe("complete");
  });
});

describe("no history flood", () => {
  test("runs already terminal when the queue file gains the marker are never swept", async () => {
    const fx = fixture();
    const old = fx.enqueue("old");
    fx.queue.end(old.run_id, "complete", null);
    // Simulate a pre-22.3 file: the marker column dropped, the trigger recreated without it.
    fx.queue.db.exec("DROP TRIGGER runs_terminal_immutable; DROP TRIGGER runs_notified_once; ALTER TABLE runs DROP COLUMN notified;");
    fx.queue.close();
    const q = track(new Queue(fx.db, fx.queue.probes));
    try {
      expect(q.get(old.run_id)!.notified).toBe(NOTIFIED_BEFORE);
      const f = fakeFetch();
      expect(await sweepEnds(q, { env: NTFY_ENV, fetch: f.fetchFn })).toEqual([]);
      expect(f.calls).toEqual([]);
    } finally { q.close(); }
  });
});

describe("start.ps1 (AC1, AC2)", () => {
  const script = resolve(import.meta.dir, "..", "start.ps1");
  const text = readFileSync(script, "utf-8");

  test("no mirror copy, no scheduled task, no logon type, no hidden window; the exact shell:startup command", () => {
    expect(text).not.toMatch(/\/MIR|Register-ScheduledTask|LogonType|WindowStyle Hidden/i);
    expect(text).toContain("wt.exe -w studio nt --title supervisor pwsh -NoExit -File <repo>\\start.ps1");
    expect(text).toContain('"wt.exe -w studio nt --title supervisor pwsh -NoExit -File $Repo\\start.ps1"');
    // User scope first, the required pair named, recover once before the pacer loop (tick, then drain).
    expect(text).toContain("[Environment]::GetEnvironmentVariable($Name, 'User')");
    for (const s of ["TK_SUPERVISOR_BIND", "TK_SUPERVISOR_TOKEN", "TK_SUPERVISOR_TRANSCRIPT_BACKUP", "& $Sbx daemon start -d", "Push-Location -LiteralPath $HOME"]) expect(text).toContain(s);
    // The call sites: the API keeper first (the API answers while recover, tick and drain drive runs),
    // then the sbx probe, then one recover pass to completion, then the pacer loop (tick, then drain).
    const order = ["$Keeper = Start-SupervisorKeeper", "Test-SbxDaemon -Path", "$Recovered = Invoke-SupervisorRecover", "while ($true) {\n    if ($Keeper", "@('src/tick.ts')", "@('src/cli.ts', 'drain')"]
      .map((s) => text.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Story 33.1: serve runs under the log tee (`src/log.ts --tag serve '--' <script>`).
    expect(text).toContain("& $Bun src/log.ts --tag serve '--' src/cli.ts serve");
  });

  test("serve runs in its own same-console keeper (-ServeOnly), restarted with a back-off independent of recover/tick/drain", () => {
    expect(text).toContain("[switch]$ServeOnly");
    expect(text).toContain("Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile', '-File', \"`\"$Self`\"\", '-ServeOnly')");
    expect(text).toMatch(/Start-Process -FilePath \(Get-Process -Id \$PID\)\.Path [^\n]*-NoNewWindow -PassThru/);
    // The keeper branch comes after step 1 (it needs the variables) and before the sbx probe, recover
    // and the pacer, which it never reaches (its serve loop never ends).
    const branch = text.indexOf("if ($ServeOnly) {\n");
    expect(text.indexOf('Stop-SupervisorStart -Why "[supervisor] cannot start: $($Missing -join')).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(text.indexOf('Stop-SupervisorStart -Why "[supervisor] cannot start: $($Missing -join'));
    expect(branch).toBeGreaterThan(text.indexOf("$Bun = (Get-Command bun -ErrorAction Stop).Source"));
    const keeperLoop = text.slice(branch, text.indexOf("\n}\n", branch));
    // Story 33.1: serve under the tee, its exit code read at once ($LASTEXITCODE is the tee's, which is serve's).
    expect(keeperLoop).toContain("& $Bun src/log.ts --tag serve '--' src/cli.ts serve\n        $code = $LASTEXITCODE");
    expect(keeperLoop).toContain("Register-Failure -Backoff $ServeBackoff");
    expect(keeperLoop).toContain("if (((Get-Date) - $started).TotalSeconds -ge $ServeUpSeconds) { $ServeBackoff.Failures = 0 }");
    for (const s of ["Invoke-SupervisorRecover", "Test-SbxDaemon", "src/tick.ts"]) expect(keeperLoop).not.toContain(s);
    expect(branch).toBeLessThan(text.indexOf("$Keeper = Start-SupervisorKeeper"));
    // The shell:startup print and the backup warning are the main script's only.
    // Story 33.1: printed through Write-SupervisorLog, after the env import (the log folder is known) and
    // before step 1's refusals.
    const shortcut = text.indexOf("if (-not $ServeOnly) {\n  Write-SupervisorLog -Text '[supervisor] the shell:startup shortcut command");
    expect(shortcut).toBeGreaterThan(text.indexOf("foreach ($name in $Names) { $Present[$name] = Import-SupervisorVariable -Name $name }"));
    expect(shortcut).toBeGreaterThan(text.indexOf("function Write-SupervisorLog {"));
    expect(shortcut).toBeLessThan(text.indexOf("$Missing = @('TK_SUPERVISOR_BIND'"));
    expect(text.indexOf("function Write-SupervisorLog {")).toBeGreaterThan(0);
    // Story 33.1 review: a Bearer/Basic credential in a line (an exception's text) is masked the page's way, and
    // the append shares the day file with the tees (ReadWrite share, retried on a held file), never Add-Content.
    const logger = text.slice(text.indexOf("function Write-SupervisorLog {"), text.indexOf("\n}\n", text.indexOf("function Write-SupervisorLog {")));
    expect(logger).toContain(`$line = $line -replace '(?i)\\b(Bearer)(\\s+)[^\\s"'',;]+', '$1$2[redacted]'`);
    expect(logger).toContain("$line = $line -replace '(?i)\\b(Basic)(\\s+)[A-Za-z0-9+/=]{8,}', '$1$2[redacted]'");
    expect(logger).toContain("[System.IO.File]::Open($file, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)");
    expect(logger).toContain("[System.Text.UTF8Encoding]::new($false)");
    expect(logger).toContain("} catch [System.IO.IOException] {\n        if ($attempt -lt 4) { Start-Sleep -Milliseconds 50 }");
    expect(logger).not.toContain("Add-Content");
    expect(logger.indexOf("if ($Warning) { Write-Warning $Text } else { Write-Host $Text }")).toBeLessThan(logger.indexOf("try {"));
    // The main loop only watches the keeper; it stops only that process tree, never by name.
    expect(text).toContain("if (-not $Keeper -and (Test-Due -Backoff $KeeperBackoff)) { $Keeper = Start-SupervisorKeeper }");
    expect(text).toContain("$Keeper.Kill($true)");
    // Story 33.1: the catch logs `uncaught:` and only re-throws; the finally stops the keeper tree, then logs `stopped`.
    expect(text).toContain('} catch {\n  $StopWhy = $_.Exception.Message\n  Write-SupervisorLog -Text "uncaught: $StopWhy"\n  throw\n} finally {\n  Stop-SupervisorKeeper -Keeper $Keeper\n  Write-SupervisorLog -Text "stopped ($StopWhy)"\n}');
    expect(text).not.toMatch(/Stop-Process\s+-Name|taskkill[^\n]*\/IM/i);
    expect(text).not.toContain("'src/cli.ts', 'serve'"); // the main loop never starts serve itself
  });

  test("only step 1's checks end the script: serve, recover and the sbx probe warn and retry or go on; the exit code is readable", () => {
    // Story 33.1: the only throw that starts an error is Stop-SupervisorStart's, called by step 1's two refusals
    // (missing BIND/TOKEN/SECRET, no bun) before anything starts; the keeper's and the pacer's catch only
    // re-throw (a bare `throw`) after logging `uncaught:`.
    const code = text.slice(text.indexOf("#>\n")).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    const throws = code.match(/^.*\bthrow\b.*$/gm) ?? [];
    expect(throws.map((l) => l.trim())).toEqual(["throw $Why", "throw", "throw"]);
    expect(code).toContain("function Stop-SupervisorStart {\n  param([Parameter(Mandatory)][string]$Why)\n  Write-SupervisorLog -Text \"uncaught: $Why\"\n  Write-SupervisorLog -Text \"stopped ($Why)\"\n  throw $Why\n}");
    expect(code.match(/\bthrow\n\s*\} finally \{/g)).toHaveLength(2);
    expect(code.match(/Write-SupervisorLog -Text "uncaught: \$StopWhy"\n\s*throw\n/g)).toHaveLength(2);
    const calls = [...code.matchAll(/Stop-SupervisorStart -Why/g)].map((m) => m.index!);
    expect(calls).toHaveLength(2);
    for (const i of calls) {
      expect(i).toBeLessThan(code.indexOf("if ($ServeOnly) {\n"));
      expect(i).toBeLessThan(code.indexOf("$Keeper = Start-SupervisorKeeper"));
    }
    expect(text).toContain('Stop-SupervisorStart -Why "[supervisor] cannot start: $($Missing -join');
    expect(text).toContain('catch { Stop-SupervisorStart -Why "[supervisor] cannot start: bun not found on PATH');
    expect(text).toContain("$null = $proc.Handle");
    expect(text).toContain("$PSNativeCommandUseErrorActionPreference = $false");
    expect(text).toContain("if (-not $Recovered -and (Test-Due -Backoff $RecoverBackoff)) { $Recovered = Invoke-SupervisorRecover }");
    // A native command's output goes to the console, never into a function's answer ($Recovered is the boolean only).
    // Story 33.1: under the log tee, the `| Out-Host` kept; the tee exits with the child's code, read at once.
    expect(text).toContain("& $Bun src/log.ts --tag drain '--' src/cli.ts recover | Out-Host\n    $code = $LASTEXITCODE");
    expect(text).toContain("if ($code -eq 0) { return $true }");
    expect(text).toContain("& $Bun src/log.ts --tag $Tag '--' @Arguments | Out-Host\n    if ($LASTEXITCODE -ne 0) {");
    expect(text).not.toMatch(/^\s*& \$Bun (?!src\/log\.ts --tag)/m); // every bun child runs under the tee
    // The sbx probe is bounded: on timeout only that probe is killed and the daemon is taken as not running.
    expect(text).toContain("$SbxProbeSeconds = 30");
    expect(text).toContain("[System.Diagnostics.ProcessStartInfo]::new($Path, 'ls')");
    expect(text).toContain("if (-not $probe.WaitForExit($SbxProbeSeconds * 1000)) {");
    expect(text).toContain("try { $probe.Kill() } catch { }");
    expect(text).not.toMatch(/& \$Sbx ls/); // the unbounded probe is gone
    expect(text).not.toMatch(/\$probe\.WaitForExit\(\)/);
    // Output names variables and exit codes, never a value.
    expect(text).not.toMatch(/Write-(Host|Warning|SupervisorLog)[^\n]*\$env:TK_SUPERVISOR_(TOKEN|TELEGRAM_TOKEN|NTFY_URL)/);
    expect(text).not.toMatch(/Write-(Host|Warning|SupervisorLog)[^\n]*\$value/);
  });

  test.skipIf(!Bun.which("pwsh"))("the PowerShell parser reports 0 errors", () => {
    const res = spawnSync("pwsh", ["-NoProfile", "-Command",
      `$e = $null; [System.Management.Automation.Language.Parser]::ParseFile('${script}', [ref]$null, [ref]$e) | Out-Null; $e.Count`], { encoding: "utf-8" });
    expect(res.stdout.trim()).toBe("0");
  });
});

describe("start.ps1 sign-in (Story 22.5 AC4)", () => {
  const text = readFileSync(resolve(import.meta.dir, "..", "start.ps1"), "utf-8");
  const certCall = "foreach ($arg in @('cert', '--cert-file', $env:TK_SUPERVISOR_TLS_CERT, '--key-file', $env:TK_SUPERVISOR_TLS_KEY, $env:TK_SUPERVISOR_TLS_NAME))";
  const certGuard = "if (-not $ServeOnly -and $TlsPresent) {";

  test("TK_SUPERVISOR_SESSION_SECRET is required beside BIND and TOKEN: missing, the script ends before anything starts", () => {
    expect(text).toContain("$Missing = @('TK_SUPERVISOR_BIND', 'TK_SUPERVISOR_TOKEN', 'TK_SUPERVISOR_SESSION_SECRET') | Where-Object { -not $Present[$_] }");
    const refusal = text.indexOf('Stop-SupervisorStart -Why "[supervisor] cannot start: $($Missing -join');
    expect(refusal).toBeGreaterThan(text.indexOf("$Missing = @('TK_SUPERVISOR_BIND'"));
    expect(refusal).toBeLessThan(text.indexOf("$Keeper = Start-SupervisorKeeper"));
  });

  test("the new variables are among the exported names", () => {
    const start = text.indexOf("$Names = @(");
    expect(start).toBeGreaterThan(0);
    const names = text.slice(start, text.indexOf("\n)\n", start));
    for (const n of [
      "TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_TLS_CERT", "TK_SUPERVISOR_TLS_KEY", "TK_SUPERVISOR_TLS_NAME",
    ]) expect(names).toContain(`'${n}'`);
  });

  test("tailscale cert is one shared function: the main script runs it (never under -ServeOnly) with all three TLS variables, before the keeper", () => {
    // Story 27.5 (DW-21): one `tailscale cert` call, in a function the main script and the keeper share.
    expect(text.split("'cert', '--cert-file'")).toHaveLength(2);
    expect(text).toContain("$TlsNames = @('TK_SUPERVISOR_TLS_CERT', 'TK_SUPERVISOR_TLS_KEY', 'TK_SUPERVISOR_TLS_NAME')");
    const fn = text.indexOf("function Invoke-TailscaleCert {");
    const call = text.indexOf(certCall);
    const guard = text.indexOf(certGuard);
    expect(fn).toBeGreaterThan(text.indexOf('Stop-SupervisorStart -Why "[supervisor] cannot start: $($Missing -join'));
    expect(call).toBeGreaterThan(fn);
    expect(guard).toBeGreaterThan(call);
    expect(text.slice(guard, guard + 80)).toContain("Invoke-TailscaleCert");
    // Defined before the keeper branch (whose serve loop never ends), run before the keeper is started.
    expect(fn).toBeLessThan(text.indexOf("if ($ServeOnly) {\n"));
    expect(guard).toBeLessThan(text.indexOf("if ($ServeOnly) {\n"));
    expect(guard).toBeLessThan(text.indexOf("$Keeper = Start-SupervisorKeeper"));
  });

  test("the keeper renews on serve's exit 75 and restarts serve at once, without the back-off (DW-21)", () => {
    const keeper = text.slice(text.indexOf("if ($ServeOnly) {\n"), text.indexOf("$KeeperBackoff = New-Backoff"));
    const renew = keeper.indexOf("if ($code -eq 75) {");
    expect(keeper.indexOf("& $Bun src/log.ts --tag serve '--' src/cli.ts serve")).toBeGreaterThan(0);
    expect(renew).toBeGreaterThan(keeper.indexOf("& $Bun src/log.ts --tag serve '--' src/cli.ts serve"));
    const branch = keeper.slice(renew, keeper.indexOf("}", keeper.indexOf("continue", renew)) + 1);
    expect(branch).toContain("if ($TlsPresent) { Invoke-TailscaleCert }");
    expect(branch).toContain("continue");
    expect(renew).toBeLessThan(keeper.indexOf("$delay = Register-Failure -Backoff $ServeBackoff"));
  });

  test("tailscale cert is bounded at 120 s; a timeout kills only that process, and every failure is a warning", () => {
    expect(text).toContain("$CertSeconds = 120");
    const block = text.slice(text.indexOf("function Invoke-TailscaleCert {"), text.indexOf(certGuard));
    expect(block).toContain("if (-not $cert.WaitForExit($CertSeconds * 1000)) {");
    expect(block).toContain("try { $cert.Kill() } catch { }");
    expect(block).not.toMatch(/\$cert\.WaitForExit\(\)/);
    for (const w of [
      "Write-SupervisorLog -Warning -Text '[supervisor] tailscale not found:",
      'Write-SupervisorLog -Warning -Text "[supervisor] tailscale cert gave no answer within $CertSeconds s:',
      'Write-SupervisorLog -Warning -Text "[supervisor] tailscale cert exited $($cert.ExitCode):',
      'Write-SupervisorLog -Warning -Text "[supervisor] tailscale cert did not run:',
    ]) expect(block).toContain(w);
    expect(block).not.toMatch(/\bthrow\b|\bexit\b/);
    // Names only, never a value.
    expect(block).not.toMatch(/Write-(Host|Warning|SupervisorLog)[^\n]*\$env:/);
    expect(text).not.toMatch(/Write-(Host|Warning|SupervisorLog)[^\n]*\$env:TK_SUPERVISOR_(SESSION_SECRET|OAUTH_)/);
  });
});

describe("Story 33.2: one notifier line per new claim refusal, naming the run and what resolves it", () => {
  const LOGIN = "harness auth: Max login missing or expired (not logged in)";
  const RESOLVES = "renew the sandbox's Max login: sbx run --name claude-p → /login → /exit; the next drain pass claims the run";

  test("the line: one line with the run id, the reason and the resolution; only the reason is cut", () => {
    const line = claimRefusedLine("q-j-1", LOGIN, RESOLVES);
    expect(line).toBe(`supervisor: run q-j-1 stays queued, claim refused: ${LOGIN} — resolve: ${RESOLVES}`);
    expect(line).not.toContain("\n");
    expect(claimRefusedLine("q-j-1", "a\n  b", "x")).toBe("supervisor: run q-j-1 stays queued, claim refused: a b — resolve: x");
    const long = claimRefusedLine("q-j-1", "é".repeat(5000), RESOLVES);
    expect(Buffer.byteLength(long, "utf-8")).toBeLessThanOrEqual(NOTICE_MAX_BYTES);
    expect(long).toContain(TRUNCATED_MARKER);
    expect(long).toContain("q-j-1");
    expect(long.endsWith(`— resolve: ${RESOLVES}`)).toBe(true);
  });

  test("a new reason sends once (outcome on the event); a repeat sends nothing; a second reason sends its own line; no token anywhere", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    const { calls, fetchFn } = fakeFetch();
    const deps = { env: TG_ENV, fetch: fetchFn };
    expect(await recordClaimRefusal(fx.queue, run.run_id, "max-login", LOGIN, RESOLVES, deps)).toBe(true);
    expect(await recordClaimRefusal(fx.queue, run.run_id, "max-login", LOGIN, RESOLVES, deps)).toBe(false);
    expect(await recordClaimRefusal(fx.queue, run.run_id, "max-login", LOGIN, RESOLVES, deps)).toBe(false);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body).toEqual({ chat_id: "-100777", text: claimRefusedLine(run.run_id, LOGIN, RESOLVES) });
    expect(body.text).toContain(run.run_id);
    expect(body.text).toContain("sbx run --name claude-p → /login → /exit");
    const events = fx.queue.events(run.run_id).filter((e) => e.kind === "claim-refused");
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toMatchObject({ reason: LOGIN, resolves: RESOLVES, notify: { ok: true, via: "telegram" } });
    expect(await recordClaimRefusal(fx.queue, run.run_id, "pin-failed:claude-p", "sbx pin failed: sbx run -d --name claude-p exited 1: down", "start it", deps)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(fx.queue.events(run.run_id))).not.toContain(TG_TOKEN);
  });

  test("no notifier configured: the event still lands, its `notify` naming the skip; a run that is not queued records nothing", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    const { calls, fetchFn } = fakeFetch();
    expect(await recordClaimRefusal(fx.queue, run.run_id, "max-login", LOGIN, RESOLVES, { env: {}, fetch: fetchFn })).toBe(true);
    expect(calls).toHaveLength(0);
    expect(fx.queue.events(run.run_id).find((e) => e.kind === "claim-refused")!.detail!.notify).toMatchObject({ ok: false, skipped: expect.stringContaining("TK_SUPERVISOR_NOTIFY") });
    fx.queue.end(run.run_id, "cancelled", "by hand", { from: "queued" });
    expect(await recordClaimRefusal(fx.queue, run.run_id, "other", "other", "x", { env: TG_ENV, fetch: fetchFn })).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
