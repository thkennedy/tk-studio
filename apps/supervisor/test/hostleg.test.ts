// Story 33.8 (hole 52): an ended run's host leg, re-runnable — `rerunHostLeg` against a real throwaway repository
// (a bare `origin` holding the pushed `supervisor/run-<id>`), a recording runner whose `gh` is faked, a fake studio
// script runner (`uv`), and a real `verify.host` (`process.execPath -e …`, so it runs on both hosts).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { hostVerifyOf } from "../src/board";
import { main, verifyVerb } from "../src/cli";
import { rerunHostLeg, VerifyRefused, type HostLegResult, type HostLegStarted } from "../src/hostleg";
import { Queue, type Owner } from "../src/queue";
import { runProcess, type RunResult } from "../src/server";
import { runBranch, type WorktreeDeps } from "../src/worktree";
import { gitRepo, testGit } from "./fakes";
import { tempDir } from "./tmp";

const me: Owner = { pid: process.pid, host: hostname(), nonce: "hostleg-test" };
const other: Owner = { pid: 910099, host: hostname(), nonce: "hostleg-other" };
const PR = "https://github.com/acme/widget/pull/42";
const GH = "fake-gh-33-8";

/** `verify.host` as a bun one-liner exiting `code` (single quotes only inside). */
const verifyConfig = (code: number) => `vcs: git\nverify:\n  host: ${JSON.stringify(`"${process.execPath}" -e "console.log('leg ran'); process.exit(${code})"`)}\n`;

type GhView = { state: string; isDraft: boolean };

/** An ended sbx run with its branch pushed to origin and its worktree removed, as a close-out leaves one. */
async function fixture(o: { code?: number; pr?: string | null; push?: boolean; worktree?: boolean } = {}) {
  const repo = gitRepo({ ".tk-studio/config.yaml": verifyConfig(o.code ?? 0) });
  const work = tempDir("tk-sup-hostleg-work-");
  const alive = new Set<string>([me.nonce]);
  const queue = new Queue(":memory:", { ownerAlive: (w) => alive.has(w.nonce), engineLive: async () => ({ live: false, run_ids: [] }) });
  const env = { ...process.env, TK_SUPERVISOR_WORK: work, GH_BIN: GH, TK_STUDIO_ROOT: "/studio-root" };
  const argvs: { bin: string; args: string[]; cwd: string }[] = [];
  const gh: string[][] = [];
  const studio: string[] = [];
  const answers = {
    view: { state: "OPEN", isDraft: true } as GhView | "fail", open: [] as string[], drift: "clean", lsRemote: "real" as "real" | "fail",
  };
  const deps: WorktreeDeps & { self: Owner } = {
    env, self: me,
    run: async (bin, args, opts): Promise<RunResult> => {
      argvs.push({ bin, args, cwd: opts.cwd });
      if (bin === GH) {
        gh.push(args);
        const sub = args.slice(0, 2).join(" ");
        if (sub === "pr view") return answers.view === "fail" ? { exit: 1, stdout: "", stderr: "fake gh: pr view failed" } : { exit: 0, stdout: JSON.stringify(answers.view), stderr: "" };
        if (sub === "pr ready") return { exit: 0, stdout: "ready", stderr: "" };
        if (sub === "pr list") return { exit: 0, stdout: JSON.stringify(answers.open.map((url) => ({ url }))), stderr: "" };
        return { exit: 2, stdout: "", stderr: `fake gh: unsupported ${args.join(" ")}` };
      }
      if (bin === "git" && args[0] === "ls-remote" && answers.lsRemote === "fail") return { exit: 128, stdout: "", stderr: "fatal: could not read from remote" };
      return runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...env, ...(opts.env ?? {}) } });
    },
    uv: async (_root, script): Promise<RunResult> => {
      studio.push(script);
      if (script.endsWith("drift_check.py")) return { exit: answers.drift === "clean" ? 0 : 1, stdout: JSON.stringify({ ok: true, result: answers.drift }), stderr: "" };
      if (script.endsWith("install_base.py")) return { exit: 1, stdout: JSON.stringify({ ok: false, step: "upstream-installer", error: "fake install failed" }), stderr: "" };
      return { exit: 2, stdout: "", stderr: "unexpected script" };
    },
  };
  const queued = queue.enqueue({ jobId: "j", root: repo.checkout, projectId: "proj", definition: { id: "j", target: { skill: "tk-studio-launch" } }, owner: me, base_ref: "main" }).run;
  const claim = await queue.claim(queued.run_id, me);
  if (!claim.claimed) throw new Error("not claimed");
  const id = queued.run_id;
  queue.db.query("UPDATE runs SET tier = 'sbx' WHERE run_id = ?").run(id);
  const branch = runBranch(id);
  const wt = join(work, "worktrees", "proj", id);
  let tip = "";
  if (o.worktree !== false) {
    mkdirSync(join(work, "worktrees", "proj"), { recursive: true });
    testGit(repo.checkout, "worktree", "add", "-q", wt, "-b", branch, "main");
    writeFileSync(join(wt, "feature.txt"), "the engine's work");
    testGit(wt, "add", "feature.txt");
    testGit(wt, "commit", "-q", "-m", "the engine's work");
    if (o.push !== false) testGit(wt, "push", "-q", "origin", branch);
    tip = testGit(wt, "rev-parse", "HEAD");
    queue.recordWorktree(id, wt, { branch, base_ref: "main" });
    queue.note(id, "launched", { engine_run_id: "E1", end: {} });
    queue.note(id, "host-verify", { command: "x", argv: ["x"], cwd: wt, exit: 1, duration_ms: 5, green: false, stdout_tail: [], stderr_tail: ["boom"] });
    testGit(repo.checkout, "worktree", "remove", "--force", wt);
  }
  queue.end(id, "partial", "host verify red: `x` exited 1", { detail: { ...(o.pr === null ? {} : { pr: o.pr ?? PR }), closeout: { result: "draft PR", host_verify: "red" } } });
  const endedBefore = queue.events(id).find((e) => e.kind === "ended");
  const hostVerifies = () => queue.events(id).filter((e) => e.kind === "host-verify");
  return { repo, work, queue, deps, argvs, gh, studio, answers, alive, id, wt, tip, branch, endedBefore, hostVerifies };
}

const refusal = async (p: Promise<unknown>): Promise<VerifyRefused> => {
  try { await p; } catch (e) { if (e instanceof VerifyRefused) return e; throw e; }
  throw new Error("not refused");
};

/** Capture `console.log`/`console.error` while `fn` runs. */
async function captured<T>(fn: () => Promise<T>): Promise<{ value: T; out: string; err: string }> {
  const log = console.log, error = console.error;
  let out = "", err = "";
  console.log = (...a: unknown[]) => { out += `${a.join(" ")}\n`; };
  console.error = (...a: unknown[]) => { err += `${a.join(" ")}\n`; };
  try { return { value: await fn(), out, err }; } finally { console.log = log; console.error = error; }
}

describe("AC1: the leg — cut, run, record, remove, flip", () => {
  test("green: a detached `<worktree>.verify` at the remote tip, materialised, one green `host-verify` with `rerun`, removed, the draft PR marked ready; the run's state and `ended` unchanged; the board reads green", async () => {
    const fx = await fixture({ code: 0 });
    const before = fx.hostVerifies().length;
    const started = await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps);
    expect(started).toMatchObject({ run_id: fx.id, state: "partial", head: fx.tip });
    const r = await started.done;
    const path = `${fx.wt}.verify`;
    // The cut: fetched, then detached at the tip origin answered.
    expect(fx.argvs.find((a) => a.args[0] === "fetch")!.args).toEqual(["fetch", "origin", `+refs/heads/${fx.branch}:refs/remotes/origin/${fx.branch}`]);
    expect(fx.argvs.find((a) => a.args[0] === "worktree" && a.args[1] === "add")).toEqual({ bin: "git", args: ["worktree", "add", "--relative-paths", "--detach", path, fx.tip], cwd: fx.repo.checkout });
    // Materialised (the drift check, twice: clean, so no install).
    expect(fx.studio.filter((s) => s.endsWith("drift_check.py"))).toHaveLength(2);
    // One new green `host-verify`, run in the fresh worktree.
    const hv = fx.hostVerifies();
    expect(hv).toHaveLength(before + 1);
    expect(hv.at(-1)!.detail).toMatchObject({ green: true, exit: 0, cwd: path, stdout_tail: ["leg ran"], rerun: { by: "api", head: fx.tip, worktree: "removed", pr: PR, pr_ready: "marked" } });
    expect(r).toEqual(hv.at(-1)!.detail as unknown as HostLegResult);
    expect(existsSync(path)).toBe(false);
    // `gh pr view` then `gh pr ready <pr>`; never `--undo`, never a body edit.
    expect(fx.gh).toEqual([["pr", "view", PR, "--json", "state,isDraft"], ["pr", "ready", PR]]);
    // The terminal state and the `ended` event are unchanged; the board's derived `host_verify` is green.
    expect(fx.queue.get(fx.id)!.state).toBe("partial");
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "ended")).toEqual([fx.endedBefore!]);
    expect(hostVerifyOf(fx.queue.events(fx.id))).toBe("green");
    // The lease: taken (`by: api`), closed by the result; a second re-run takes it again.
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "host-verify-leg").map((e) => e.detail)).toEqual([{ owner: me, by: "api" }]);
    expect(fx.queue.takeVerifyLeg(fx.id, other, "cli")).toBe(true);
  }, 60_000);

  test("red: a red `host-verify`, the PR never touched (no `gh pr ready`, no `--undo`), the state unchanged", async () => {
    const fx = await fixture({ code: 3 });
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "cli" }, fx.deps)).done;
    expect(r).toMatchObject({ green: false, exit: 3, rerun: { by: "cli", head: fx.tip, worktree: "removed", pr: PR } });
    expect("pr_ready" in r.rerun).toBe(false);
    expect(fx.gh).toEqual([]);
    expect(fx.queue.get(fx.id)!.state).toBe("partial");
    expect(hostVerifyOf(fx.queue.events(fx.id))).toBe("red");
  }, 60_000);

  test("the PR's states: already ready → `already`; closed → `not open`; a view failure → `error: …`", async () => {
    for (const [view, want] of [[{ state: "OPEN", isDraft: false }, "already"], [{ state: "CLOSED", isDraft: true }, "not open"], ["fail", /^error: gh pr view exit 1: fake gh: pr view failed/]] as const) {
      const fx = await fixture();
      fx.answers.view = view as GhView | "fail";
      const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
      if (typeof want === "string") expect(r.rerun.pr_ready).toBe(want);
      else expect(r.rerun.pr_ready).toMatch(want);
      expect(fx.gh.some((a) => a[1] === "ready")).toBe(false);
    }
  }, 90_000);

  test("no PR anywhere: `pr: null`, no `gh pr ready`; a PR only on `gh pr list` is adopted", async () => {
    const none = await fixture({ pr: null });
    const r = await (await rerunHostLeg(none.queue, none.id, { by: "api" }, none.deps)).done;
    expect(r.rerun.pr).toBeNull();
    expect("pr_ready" in r.rerun).toBe(false);
    expect(none.gh).toEqual([["pr", "list", "--head", none.branch, "--state", "open", "--json", "url"]]);

    const listed = await fixture({ pr: null });
    listed.answers.open = ["https://github.com/acme/widget/pull/7"];
    const l = await (await rerunHostLeg(listed.queue, listed.id, { by: "api" }, listed.deps)).done;
    expect(l.rerun).toMatchObject({ pr: "https://github.com/acme/widget/pull/7", pr_ready: "marked" });
    expect(listed.gh.at(-1)).toEqual(["pr", "ready", "https://github.com/acme/widget/pull/7"]);
  }, 60_000);

  test("a leftover `.verify` folder (a crashed leg) is removed before the cut", async () => {
    const fx = await fixture();
    const path = `${fx.wt}.verify`;
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "stale.txt"), "left behind");
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: true, rerun: { worktree: "removed" } });
    const removeAt = fx.argvs.findIndex((a) => a.args[0] === "worktree" && a.args[1] === "remove" && a.args.includes(path));
    const addAt = fx.argvs.findIndex((a) => a.args[0] === "worktree" && a.args[1] === "add");
    expect(removeAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeLessThan(addAt);
    expect(existsSync(path)).toBe(false);
  }, 60_000);

  test("a `.verify` registration whose folder was deleted by hand is pruned before the cut", async () => {
    const fx = await fixture();
    const path = `${fx.wt}.verify`;
    testGit(fx.repo.checkout, "worktree", "add", "-q", "--detach", path, "main");
    rmSync(path, { recursive: true, force: true });
    expect(testGit(fx.repo.checkout, "worktree", "list", "--porcelain")).toContain(".verify");
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: true, rerun: { worktree: "removed" } });
    const pruneAt = fx.argvs.findIndex((a) => a.args[0] === "worktree" && a.args[1] === "prune");
    const addAt = fx.argvs.findIndex((a) => a.args[0] === "worktree" && a.args[1] === "add");
    expect(pruneAt).toBeGreaterThanOrEqual(0);
    expect(pruneAt).toBeLessThan(addAt);
    expect(existsSync(path)).toBe(false);
  }, 60_000);

  test("a materialise failure: `VerifyFailed`, the lease released (a second call is not `VerifyRunning`), no `host-verify`", async () => {
    const fx = await fixture();
    fx.answers.drift = "drift"; // the install then fails: `WorktreeFailed`
    const before = fx.hostVerifies().length;
    const e = await refusal(rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps));
    expect(e.code).toBe("VerifyFailed");
    expect(e.message).toContain("worktree install");
    expect(fx.hostVerifies()).toHaveLength(before);
    expect(existsSync(`${fx.wt}.verify`)).toBe(false);
    expect(fx.queue.events(fx.id).filter((x) => x.kind === "host-verify-leg").at(-1)!.detail).toMatchObject({ owner: null });
    fx.answers.drift = "clean";
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: true });
  }, 60_000);

  test("no work folder: `VerifyFailed`, the lease released", async () => {
    const fx = await fixture();
    const e = await refusal(rerunHostLeg(fx.queue, fx.id, { by: "api" }, { ...fx.deps, env: { ...fx.deps.env, TK_SUPERVISOR_WORK: "" } }));
    expect(e.code).toBe("VerifyFailed");
    expect(fx.queue.takeVerifyLeg(fx.id, other)).toBe(true);
  }, 60_000);
});

describe("AC1: every refusal, by name", () => {
  test("RunNotFound; ExternalRun; RunNotEnded for queued, running and paused", async () => {
    const fx = await fixture();
    expect((await refusal(rerunHostLeg(fx.queue, "q-nope", { by: "api" }, fx.deps))).code).toBe("RunNotFound");
    const ext = fx.queue.recordExternal("j", fx.repo.checkout, "j-20261027T000000Z", "running")!; // the job whose run ended
    expect((await refusal(rerunHostLeg(fx.queue, ext.run_id, { by: "api" }, fx.deps))).code).toBe("ExternalRun");
    const live = fx.queue.enqueue({ jobId: "live", root: fx.repo.checkout, projectId: "proj", definition: { id: "live" }, owner: me }).run;
    expect((await refusal(rerunHostLeg(fx.queue, live.run_id, { by: "api" }, fx.deps))).code).toBe("RunNotEnded");
    for (const state of ["running", "paused"]) {
      fx.queue.db.query("UPDATE runs SET state = ? WHERE run_id = ?").run(state, live.run_id);
      const e = await refusal(rerunHostLeg(fx.queue, live.run_id, { by: "api" }, fx.deps));
      expect(e.code).toBe("RunNotEnded");
      expect(e.message).toContain(state);
    }
    expect(fx.argvs).toEqual([]); // nothing ran
  }, 60_000);

  test("NoBranch: no recorded worktree; the branch absent on origin; `git ls-remote` failing", async () => {
    const none = await fixture({ worktree: false });
    expect((await refusal(rerunHostLeg(none.queue, none.id, { by: "api" }, none.deps))).code).toBe("NoBranch");
    const unpushed = await fixture({ push: false });
    const u = await refusal(rerunHostLeg(unpushed.queue, unpushed.id, { by: "api" }, unpushed.deps));
    expect(u.code).toBe("NoBranch");
    expect(u.message).toContain("not on origin");
    const failing = await fixture();
    failing.answers.lsRemote = "fail";
    const f = await refusal(rerunHostLeg(failing.queue, failing.id, { by: "api" }, failing.deps));
    expect(f.code).toBe("NoBranch");
    expect(f.message).toContain("git ls-remote exit 128");
    for (const fx of [none, unpushed, failing]) expect(fx.queue.events(fx.id).some((e) => e.kind === "host-verify-leg")).toBe(false);
  }, 60_000);

  test("VerifyRunning while a live owner holds the lease; a dead owner's lease is taken over", async () => {
    const fx = await fixture();
    fx.alive.add(other.nonce);
    expect(fx.queue.takeVerifyLeg(fx.id, other, "cli")).toBe(true);
    expect((await refusal(rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps))).code).toBe("VerifyRunning");
    expect(fx.argvs.some((a) => a.args[0] === "worktree")).toBe(false);
    fx.alive.delete(other.nonce);
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: true });
  }, 60_000);
});

describe("AC1: the cli verb `verify <run id>`", () => {
  const leg = (r: Partial<HostLegResult>): ((q: Queue, id: string) => Promise<HostLegStarted>) => async (_q, id) => ({
    run_id: id, state: "partial", head: "abc123", done: Promise.resolve({ rerun: { by: "cli", head: "abc123", worktree: "removed", pr: PR }, ...r } as HostLegResult),
  });

  test("no run id, or two: the usage line, exit 2", async () => {
    for (const argv of [["verify"], ["verify", "a", "b"]]) {
      const { value, err } = await captured(() => main(argv));
      expect(value).toBe(2);
      expect(err).toContain("bun src/cli.ts verify <run id>");
    }
  });

  test("green 0, red or skipped 1, a refusal 2 — one JSON object each", async () => {
    const queue = new Queue(":memory:");
    const green = await captured(() => verifyVerb(["q-1"], { queue, leg: leg({ green: true, rerun: { by: "cli", head: "abc123", worktree: "removed", pr: PR, pr_ready: "marked" } } as Partial<HostLegResult>) }));
    expect(green.value).toBe(0);
    expect(JSON.parse(green.out)).toEqual({ ok: true, run_id: "q-1", state: "partial", head: "abc123", green: true, pr: PR, pr_ready: "marked", worktree: "removed" });
    const red = await captured(() => verifyVerb(["q-1"], { queue, leg: leg({ green: false } as Partial<HostLegResult>) }));
    expect(red.value).toBe(1);
    expect(JSON.parse(red.out)).toMatchObject({ ok: true, green: false, pr: PR });
    const skipped = await captured(() => verifyVerb(["q-1"], { queue, leg: leg({ skipped: true, reason: "no verify.host" } as Partial<HostLegResult>) }));
    expect(skipped.value).toBe(1);
    expect(JSON.parse(skipped.out)).toMatchObject({ ok: true, green: false, skipped: true, reason: "no verify.host" });
    const refused = await captured(() => verifyVerb(["q-1"], { queue, leg: async () => { throw new VerifyRefused("RunNotEnded", "queue run 'q-1' is running"); } }));
    expect(refused.value).toBe(2);
    expect(JSON.parse(refused.out)).toEqual({ ok: false, error: "RunNotEnded", detail: "RunNotEnded: queue run 'q-1' is running" });
    queue.close();
  });

  test("a non-refusal throw (the leg's record failing): `{ok: false, error: \"VerifyFailed\", detail}`, exit 2", async () => {
    const queue = new Queue(":memory:");
    const failing: (q: Queue, id: string) => Promise<HostLegStarted> = async (_q, id) => ({
      run_id: id, state: "partial", head: "abc123", done: Promise.reject(new Error("database is locked")),
    });
    const r = await captured(() => verifyVerb(["q-1"], { queue, leg: failing }));
    expect(r.value).toBe(2);
    expect(JSON.parse(r.out)).toEqual({ ok: false, error: "VerifyFailed", detail: "database is locked" });
    queue.close();
  });

  test("through the real leg: a refusal on a fixture queue answers 2 by name; a green re-run answers 0", async () => {
    const fx = await fixture();
    const notFound = await captured(() => verifyVerb(["q-nope"], { queue: fx.queue, leg: (q, id) => rerunHostLeg(q, id, { by: "cli" }, fx.deps) }));
    expect(notFound.value).toBe(2);
    expect(JSON.parse(notFound.out)).toMatchObject({ ok: false, error: "RunNotFound" });
    const ok = await captured(() => verifyVerb([fx.id], { queue: fx.queue, leg: (q, id) => rerunHostLeg(q, id, { by: "cli" }, fx.deps) }));
    expect(ok.value).toBe(0);
    expect(JSON.parse(ok.out)).toEqual({ ok: true, run_id: fx.id, state: "partial", head: fx.tip, green: true, pr: PR, pr_ready: "marked", worktree: "removed" });
  }, 60_000);
});
