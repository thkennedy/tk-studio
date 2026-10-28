// Story 33.8 (hole 52): an ended run's host leg, re-runnable — `rerunHostLeg` against a real throwaway repository
// (a bare `origin` holding the pushed `supervisor/run-<id>`), a recording runner whose `gh` is faked, a fake studio
// script runner (`uv`), and a real `verify.host` (`process.execPath -e …`, so it runs on both hosts).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

type GhView = { state: string; isDraft: boolean; body?: string };
/** The launch's status block, on the fixture's `launched` event (the PR body re-renders it). */
const LAUNCH_BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] };

/** An ended sbx run with its branch pushed to origin and its worktree removed, as a close-out leaves one. */
async function fixture(o: { code?: number; pr?: string | null; push?: boolean; worktree?: boolean; definition?: Record<string, unknown>; config?: string; files?: Record<string, string>; engine?: boolean } = {}) {
  const repo = gitRepo({ ".tk-studio/config.yaml": o.config ?? verifyConfig(o.code ?? 0), ...(o.files ?? {}) });
  const work = tempDir("tk-sup-hostleg-work-");
  const alive = new Set<string>([me.nonce]);
  const queue = new Queue(":memory:", { ownerAlive: (w) => alive.has(w.nonce), engineLive: async () => ({ live: false, run_ids: [] }) });
  const env = { ...process.env, TK_SUPERVISOR_WORK: work, GH_BIN: GH, TK_STUDIO_ROOT: "/studio-root" };
  const argvs: { bin: string; args: string[]; cwd: string }[] = [];
  const gh: string[][] = [];
  /** Story 35.1: each `gh pr edit --body-file` body, read inside the fake (the temp file is removed after). */
  const bodies: string[] = [];
  const studio: string[] = [];
  const answers = {
    view: { state: "OPEN", isDraft: true } as GhView | "fail", open: [] as string[], drift: "clean", lsRemote: "real" as "real" | "fail",
    edit: "ok" as "ok" | "fail",
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
        if (sub === "pr edit") {
          bodies.push(readFileSync(args[args.indexOf("--body-file") + 1]!, "utf-8"));
          return answers.edit === "fail" ? { exit: 1, stdout: "", stderr: "fake gh: pr edit failed" } : { exit: 0, stdout: "", stderr: "" };
        }
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
  const queued = queue.enqueue({ jobId: "j", root: repo.checkout, projectId: "proj", definition: o.definition ?? { id: "j", target: { skill: "tk-studio-launch" } }, owner: me, base_ref: "main" }).run;
  const claim = await queue.claim(queued.run_id, me);
  if (!claim.claimed) throw new Error("not claimed");
  const id = queued.run_id;
  queue.db.query("UPDATE runs SET tier = 'sbx' WHERE run_id = ?").run(id);
  // Story 35.1: a slice re-run's playable step needs the engine run id and the sandbox (the judge's tier).
  if (o.engine) queue.db.query("UPDATE runs SET engine_run_id = 'E1', sandbox = 'tk-sbx' WHERE run_id = ?").run(id);
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
    queue.note(id, "launched", { engine_run_id: "E1", status_block: LAUNCH_BLOCK, worker_cost_usd: 0.5, end: {} });
    queue.note(id, "host-verify", { command: "x", argv: ["x"], cwd: wt, exit: 1, duration_ms: 5, green: false, stdout_tail: [], stderr_tail: ["boom"] });
    testGit(repo.checkout, "worktree", "remove", "--force", wt);
  }
  queue.end(id, "partial", "host verify red: `x` exited 1", { detail: { ...(o.pr === null ? {} : { pr: o.pr ?? PR }), closeout: { result: "draft PR", host_verify: "red" } }, ...(o.engine ? { keepEngine: true } : {}) });
  const endedBefore = queue.events(id).find((e) => e.kind === "ended");
  const hostVerifies = () => queue.events(id).filter((e) => e.kind === "host-verify");
  return { repo, work, queue, deps, argvs, gh, bodies, studio, answers, alive, id, wt, tip, branch, endedBefore, hostVerifies };
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
  test("Story 35.1: green: `<worktree>.verify` cut on the run branch (`-B`) at the remote tip, materialised, one green `host-verify` with `rerun`, removed, the body rewritten with the `Legs:` history, the draft PR marked ready; the run's state and `ended` unchanged; the board reads green", async () => {
    const fx = await fixture({ code: 0 });
    const before = fx.hostVerifies().length;
    const started = await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps);
    expect(started).toMatchObject({ run_id: fx.id, state: "partial", head: fx.tip });
    const r = await started.done;
    const path = `${fx.wt}.verify`;
    // The cut: fetched, then the run branch reset (`-B`) to the tip origin answered — never detached.
    expect(fx.argvs.find((a) => a.args[0] === "fetch")!.args).toEqual(["fetch", "origin", `+refs/heads/${fx.branch}:refs/remotes/origin/${fx.branch}`]);
    expect(fx.argvs.find((a) => a.args[0] === "worktree" && a.args[1] === "add")).toEqual({ bin: "git", args: ["worktree", "add", "--relative-paths", "-B", fx.branch, path, fx.tip], cwd: fx.repo.checkout });
    // Materialised (the drift check, twice: clean, so no install).
    expect(fx.studio.filter((s) => s.endsWith("drift_check.py"))).toHaveLength(2);
    // One new green `host-verify`, run in the fresh worktree.
    const hv = fx.hostVerifies();
    expect(hv).toHaveLength(before + 1);
    expect(hv.at(-1)!.detail).toMatchObject({ green: true, exit: 0, cwd: path, stdout_tail: ["leg ran"], rerun: { by: "api", head: fx.tip, worktree: "removed", pr: PR, pr_ready: "marked", pr_body: "edited" } });
    expect(r).toEqual(hv.at(-1)!.detail as unknown as HostLegResult);
    expect(existsSync(path)).toBe(false);
    // `gh pr view`, the body rewritten (`gh pr edit --body-file`), then `gh pr ready <pr>`; never `--undo`.
    expect(fx.gh.map((a) => a.slice(0, 3))).toEqual([["pr", "view", PR], ["pr", "edit", PR], ["pr", "ready", PR]]);
    expect(fx.gh[1]![3]).toBe("--body-file");
    expect(fx.gh.some((a) => a.includes("--undo"))).toBe(false);
    // The body: the status block re-rendered from the record, the landed commit, the history line then the green section.
    const body = fx.bodies[0]!;
    expect(body).toContain(`## Launch status block\n\n\`\`\`json\n${JSON.stringify(LAUNCH_BLOCK, null, 2)}\n\`\`\``);
    expect(body).toContain("Engine run: E1");
    expect(body).toMatch(/## Landed commits\n\n- [0-9a-f]+ the engine's work\n/);
    expect(body).toContain("$0.5000 (total_cost_usd)");
    const closeAt = hv[0]!.at;
    expect(body).toMatch(new RegExp(`## Host verify\\n\\nLegs: 2 — close-out red ${closeAt.replace(/[.]/g, "\\.")}; re-run green \\S+ \\(by api\\)\\n\\nGreen: `));
    expect(body).not.toContain("**Red:**"); // the first leg's text replaced
    // The terminal state and the `ended` event are unchanged; the board's derived `host_verify` is green.
    expect(fx.queue.get(fx.id)!.state).toBe("partial");
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "ended")).toEqual([fx.endedBefore!]);
    expect(hostVerifyOf(fx.queue.events(fx.id))).toBe("green");
    // The lease: taken (`by: api`), closed by the result; a second re-run takes it again.
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "host-verify-leg").map((e) => e.detail)).toEqual([{ owner: me, by: "api" }]);
    expect(fx.queue.takeVerifyLeg(fx.id, other, "cli")).toBe(true);
  }, 60_000);

  test("Story 35.1: red on a draft PR: a red `host-verify` naming why, the body rewritten red, the PR left a draft (`pr_draft: already`, no `gh pr ready`), the state unchanged", async () => {
    const fx = await fixture({ code: 3 });
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "cli" }, fx.deps)).done;
    expect(r).toMatchObject({ green: false, exit: 3, rerun: { by: "cli", head: fx.tip, worktree: "removed", pr: PR, pr_body: "edited", pr_draft: "already" } });
    expect(r.reason).toStartWith("host verify red: `");
    expect(r.reason).toContain("exited 3");
    expect("pr_ready" in r.rerun).toBe(false);
    expect(fx.gh.map((a) => a.slice(0, 3))).toEqual([["pr", "view", PR], ["pr", "edit", PR]]);
    expect(fx.bodies[0]).toMatch(/Legs: 2 — close-out red \S+; re-run red \S+ \(by cli\)\n\n\*\*Red:\*\* `/);
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
      // Story 35.1: an open PR's body is rewritten; a PR not open (or unreadable) is never edited.
      expect(fx.gh.some((a) => a[1] === "edit")).toBe(view !== "fail" && (view as GhView).state === "OPEN");
    }
  }, 90_000);

  test("no PR anywhere: `pr: null`, no `gh pr ready`; a PR only on `gh pr list` is adopted", async () => {
    const none = await fixture({ pr: null });
    const r = await (await rerunHostLeg(none.queue, none.id, { by: "api" }, none.deps)).done;
    expect(r.rerun.pr).toBeNull();
    expect("pr_ready" in r.rerun).toBe(false);
    expect("pr_body" in r.rerun).toBe(false);
    expect(none.gh).toEqual([["pr", "list", "--head", none.branch, "--state", "open", "--json", "url"]]);

    const listed = await fixture({ pr: null });
    listed.answers.open = ["https://github.com/acme/widget/pull/7"];
    const l = await (await rerunHostLeg(listed.queue, listed.id, { by: "api" }, listed.deps)).done;
    expect(l.rerun).toMatchObject({ pr: "https://github.com/acme/widget/pull/7", pr_ready: "marked" });
    expect(listed.gh.at(-1)).toEqual(["pr", "ready", "https://github.com/acme/widget/pull/7"]);
    expect(l.rerun.pr_body).toBe("edited");
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
    expect(JSON.parse(green.out)).toEqual({ ok: true, run_id: "q-1", state: "partial", head: "abc123", rerun: true, green: true, pr: PR, pr_ready: "marked", worktree: "removed" });
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
    expect(JSON.parse(ok.out)).toEqual({ ok: true, run_id: fx.id, state: "partial", head: fx.tip, rerun: true, green: true, pr: PR, pr_ready: "marked", pr_body: "edited", worktree: "removed" });
  }, 60_000);
});

describe("Story 34.8: a slice run's re-verify runs the assets step", () => {
  test("a run-vertical-slice run's re-run records `assets` on its host-verify; a non-slice re-run does not", async () => {
    for (const definition of [
      { id: "run-epic-41", type: "run-vertical-slice", target: { skill: "tk-studio-launch" } },
      { id: "run-epic-41", type: "run-epic", target: { skill: "tk-studio-launch" } },
    ]) {
      const fx = await fixture({ code: 0, definition });
      await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
      const detail = fx.hostVerifies().at(-1)!.detail as Record<string, unknown>;
      expect(detail.green).toBe(true);
      if (definition.type === "run-vertical-slice") {
        // no manifest in the fixture repo: the step is recorded, skipped, the leg continues
        expect(detail.assets).toEqual({ verdict: "skipped", reason: "no manifest", manifest: "assets/manifest.yaml", art_path: "art/greybox", steps: [] });
      } else expect("assets" in detail).toBe(false);
    }
  }, 120_000);
});

describe("Story 35.1: the re-run is a whole leg — the PR body, both flips, the history line", () => {
  test("Story 35.1: red on an open ready PR: the body rewritten red, `gh pr ready <pr> --undo` (`pr_draft: undone`), never a plain `gh pr ready`", async () => {
    const fx = await fixture({ code: 4 });
    fx.answers.view = { state: "OPEN", isDraft: false };
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r.rerun).toMatchObject({ pr: PR, pr_body: "edited", pr_draft: "undone" });
    expect("pr_ready" in r.rerun).toBe(false);
    expect(fx.gh.map((a) => a.slice(0, 3))).toEqual([["pr", "view", PR], ["pr", "edit", PR], ["pr", "ready", PR]]);
    expect(fx.gh.at(-1)).toEqual(["pr", "ready", PR, "--undo"]);
    expect(fx.bodies[0]).toContain("**Red:** `");
    expect(fx.bodies[0]).toContain("exit 4");
    // the event says why
    const d = fx.hostVerifies().at(-1)!.detail as Record<string, any>;
    expect(d.reason).toStartWith("host verify red: `");
    expect(d.rerun.pr_draft).toBe("undone");
  }, 60_000);

  test("Story 35.1: a skipped re-run renders the section skipped and flips nothing", async () => {
    const fx = await fixture({ config: "vcs: git\n" });
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ skipped: true, reason: "no verify.host", rerun: { pr: PR, pr_body: "edited" } });
    expect("pr_ready" in r.rerun || "pr_draft" in r.rerun).toBe(false);
    expect(fx.gh.some((a) => a[1] === "ready")).toBe(false);
    expect(fx.bodies[0]).toMatch(/Legs: 2 — close-out red \S+; re-run skipped \S+ \(by api\)\n\nSkipped: no verify.host/);
  }, 60_000);

  test("Story 35.1: `gh pr edit` failing on red still turns the ready PR back to a draft", async () => {
    const fx = await fixture({ code: 1 });
    fx.answers.edit = "fail";
    fx.answers.view = { state: "OPEN", isDraft: false };
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r.rerun.pr_body).toMatch(/^error: gh pr edit/);
    expect(r.rerun.pr_draft).toBe("undone");
    expect(fx.gh.at(-1)).toEqual(["pr", "ready", PR, "--undo"]);
  }, 60_000);

  test("Story 35.1: the PR's state unreadable is `pr_body: error: gh pr view …` whatever the verdict (skipped too), never edited, never flipped", async () => {
    for (const [config, flip] of [["vcs: git\n", null], [verifyConfig(0), "pr_ready"], [verifyConfig(1), "pr_draft"]] as const) {
      const fx = await fixture({ config });
      fx.answers.view = "fail";
      const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
      expect(r.rerun.pr_body).toMatch(/^error: gh pr view exit 1: fake gh: pr view failed/);
      if (flip) expect((r.rerun as any)[flip]).toBe(r.rerun.pr_body);
      else expect("pr_ready" in r.rerun || "pr_draft" in r.rerun).toBe(false);
      expect(fx.gh.some((a) => a[1] === "edit" || a[1] === "ready")).toBe(false);
      expect(fx.hostVerifies().at(-1)!.detail).toMatchObject({ rerun: { pr_body: r.rerun.pr_body } });
    }
  }, 120_000);

  test("Story 35.1: a closed PR: `pr_draft: not open` on red, the body never edited", async () => {
    const fx = await fixture({ code: 1 });
    fx.answers.view = { state: "MERGED", isDraft: false };
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r.rerun.pr_draft).toBe("not open");
    expect("pr_body" in r.rerun).toBe(false);
    expect(fx.gh).toEqual([["pr", "view", PR, "--json", "state,isDraft,body"]]);
  }, 60_000);

  test("Story 35.1: `gh pr edit` failing is `pr_body: error: …` (never thrown): the leg recorded, the draft left as it was (no `gh pr ready`, no `pr_ready`)", async () => {
    const fx = await fixture();
    fx.answers.edit = "fail";
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r.rerun.pr_body).toMatch(/^error: gh pr edit exit 1: fake gh: pr edit failed/);
    expect("pr_ready" in r.rerun).toBe(false);
    expect(fx.gh.some((a) => a[1] === "ready")).toBe(false);
    expect(fx.hostVerifies().at(-1)!.detail).toMatchObject({ green: true, rerun: { pr_body: r.rerun.pr_body } });
  }, 60_000);

  test("Story 35.1: the history line keeps every leg after the latest `launched`, oldest first: a second re-run reads `Legs: 3`", async () => {
    const fx = await fixture({ code: 0 });
    await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    await (await rerunHostLeg(fx.queue, fx.id, { by: "cli" }, fx.deps)).done;
    const hv = fx.hostVerifies();
    expect(fx.bodies).toHaveLength(2);
    expect(fx.bodies[1]).toContain(`Legs: 3 — close-out red ${hv[0]!.at}; re-run green ${hv[1]!.at} (by api); re-run green `);
    expect(fx.bodies[1]).toMatch(/re-run green \S+ \(by cli\)\n\nGreen: /);
  }, 90_000);

  test("Story 35.1: the worktree gone (no metered cost to read): the old body's `## Metered cost` carried back unchanged, never the record-only figure", async () => {
    const fx = await fixture();
    const old = ["Opened by the supervisor.", "", "## Metered cost", "", "$3.2100 (total_cost_usd)", "", "## Host verify", "", "**Red:** old"].join("\n");
    fx.answers.view = { state: "OPEN", isDraft: true, body: old };
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r.rerun.pr_body).toBe("edited");
    expect(fx.bodies[0]).toContain("## Metered cost\n\n$3.2100 (total_cost_usd)\n\n## Host verify");
    expect(fx.bodies[0]).not.toContain("$0.5000");
    // An old body with no such section: the record-only figure (the launch worker's).
    const fy = await fixture();
    fy.answers.view = { state: "OPEN", isDraft: true, body: "no cost here" };
    await (await rerunHostLeg(fy.queue, fy.id, { by: "api" }, fy.deps)).done;
    expect(fy.bodies[0]).toContain("## Metered cost\n\n$0.5000 (total_cost_usd)");
  }, 90_000);

  test("Story 35.1: legHistory and prSection: one line, the latest leg's section below it; no legs leaves the section unchanged", async () => {
    const { legHistory, prSection } = await import("../src/hostverify");
    const ev = (seq: number, kind: string, detail: Record<string, unknown> | null) => ({ seq, run_id: "q", at: `2026-10-27T00:00:0${seq}Z`, kind, from_state: null, to_state: "partial", detail });
    const events = [
      ev(1, "host-verify", { skipped: true, reason: "an older launch's leg" }), ev(2, "launched", {}),
      ev(3, "host-verify", { green: false }), ev(4, "host-verify", { green: true, rerun: { by: "cli" } }),
    ];
    const legs = legHistory(events, { leg: "re-run", verdict: "skipped", recorded_at: "2026-10-27T00:00:09Z", by: "api" });
    expect(legs).toEqual([
      { leg: "close-out", verdict: "red", recorded_at: "2026-10-27T00:00:03Z" },
      { leg: "re-run", verdict: "green", recorded_at: "2026-10-27T00:00:04Z", by: "cli" },
      { leg: "re-run", verdict: "skipped", recorded_at: "2026-10-27T00:00:09Z", by: "api" },
    ]);
    const v = { skipped: true as const, reason: "no verify.host" };
    expect(prSection(v, undefined, legs)).toEqual([
      "## Host verify", "",
      "Legs: 3 — close-out red 2026-10-27T00:00:03Z; re-run green 2026-10-27T00:00:04Z (by cli); re-run skipped 2026-10-27T00:00:09Z (by api)", "",
      "Skipped: no verify.host",
    ]);
    expect(prSection(v)).toEqual(["## Host verify", "", "Skipped: no verify.host"]);
    expect(prSection(v, undefined, [])).toEqual(prSection(v));
  });
});

describe("Story 35.1: a slice re-run commits and pushes its placed art and proof (DW-76: the re-run is a whole leg)", () => {
  const SLICE = { id: "run-epic-41", type: "run-vertical-slice", target: { skill: "tk-studio-launch" } };
  const oneLiner = (code: number) => JSON.stringify(`"${process.execPath}" -e "process.exit(${code})"`);
  const sliceConfig = (hostCode: number) =>
    `vcs: git\nverify:\n  host: ${oneLiner(hostCode)}\n  engine: ${oneLiner(0)}\nplayable:\n  scenario: scenarios/smoke.json\n  seed: 7\n  ticks: 120\n`;
  const REPORT = (verdict: string) => ({ schema: 1, verdict, failed: null, frames: [{ tick: 0, file: "frames/tick-000000.png" }, { tick: 30, file: "frames/tick-000030.png" }] });

  /** The re-run fixture as a slice run: the manifest on main, `assets.py` faked green (greybox places `art/greybox/crate.glb`),
   * `playable.py run` writing the report and frames into the store (`pass` exit 0, else a harness fail exit 1), `sheet`
   * the sheet; the judge passes; origin's URL read as a GitHub one so the body embeds the sheet. */
  async function sliceFixture(o: { hostCode?: number; playable?: "pass" | "fail" } = {}) {
    const fx = await fixture({ config: sliceConfig(o.hostCode ?? 0), files: { "assets/manifest.yaml": "schema: 1\n" }, definition: SLICE, engine: true });
    const home = tempDir("tk-sup-hostleg-home-");
    fx.deps.env = { ...fx.deps.env, TK_STUDIO_HOME: home };
    const inner = fx.deps.run!;
    const verbs: string[] = [];
    fx.deps.run = async (bin, args, opts) => {
      if (bin === "git" && args[0] === "remote" && args[1] === "get-url") return { exit: 0, stdout: "https://github.com/acme/widget.git\n", stderr: "" };
      if (bin === process.execPath && args[0] === "-e" && args[2]) {
        const spec = JSON.parse(readFileSync(args[2], "utf-8"));
        const argv = spec.argv as string[];
        const script = String(argv[2] ?? "");
        const status = (exit: number, block: Record<string, unknown>) => {
          writeFileSync(spec.out, JSON.stringify(block) + "\n");
          writeFileSync(spec.err, "");
          writeFileSync(spec.status, JSON.stringify({ exit, signal: null }));
          return { exit: 0, stdout: "", stderr: "" };
        };
        if (script.endsWith("assets.py")) {
          verbs.push(`assets ${argv[3]}`);
          if (argv[3] === "greybox") {
            const dir = argv[argv.indexOf("--directory") + 1]!;
            mkdirSync(join(dir, "art", "greybox"), { recursive: true });
            writeFileSync(join(dir, "art", "greybox", "crate.glb"), "glb");
          }
          return status(0, { ok: true, status: "complete", intent: "assets", artifacts: [] });
        }
        if (script.endsWith("playable.py") && argv[3] === "sheet") {
          verbs.push("playable sheet");
          writeFileSync(argv[argv.indexOf("--out") + 1]!, `sheet-of-${fx.id}`);
          return status(0, { ok: true, frames: ["tick-000000.png", "tick-000030.png"], status: "complete", intent: "playable", artifacts: [] });
        }
        if (script.endsWith("playable.py")) {
          verbs.push("playable run");
          const out = argv[argv.indexOf("--out") + 1]!;
          const pass = (o.playable ?? "pass") === "pass";
          mkdirSync(join(out, "frames"), { recursive: true });
          for (const f of REPORT("pass").frames) writeFileSync(join(out, f.file), "png");
          writeFileSync(join(out, "report.json"), JSON.stringify(REPORT(pass ? "pass" : "fail")));
          return status(pass ? 0 : 1, { ok: pass, verdict: pass ? "pass" : "fail", failed: null, status: pass ? "complete" : "partial", intent: "playable", artifacts: [] });
        }
      }
      return inner(bin, args, opts);
    };
    fx.deps.route = async () => ({});
    fx.deps.judge = async (served) => {
      writeFileSync(join(served, ".bmad-loop", "runs", "E1", "playable", "judge.json"), JSON.stringify({ verdict: "pass", findings: [] }));
      return { status_block: { status: "complete" }, total_cost_usd: 0.01 };
    };
    return { ...fx, verbs, proof: `.tk-studio/proof/${fx.id}` };
  }

  test("Story 35.1: green assets on a stale local branch: `-B` resets it to origin's tip, the art and proof committed (`host leg: placed assets and proof`) and pushed fast-forward, the body embeds the committed sheet, the draft marked ready", async () => {
    const fx = await sliceFixture();
    // A close-out's `git worktree remove` keeps the local run branch: left behind origin here.
    testGit(fx.repo.checkout, "branch", "-f", fx.branch, "main");
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(fx.verbs).toEqual(["assets check", "assets greybox", "assets match", "playable run", "playable sheet"]);
    expect(r).toMatchObject({ green: true, assets: { verdict: "green" }, playable: { verdict: "pass" } });
    const sha = testGit(fx.repo.origin, "rev-parse", fx.branch);
    expect(r.rerun).toMatchObject({
      commit: { sha, frames: [`${fx.proof}/frames/tick-000000.png`, `${fx.proof}/frames/tick-000030.png`], sheet: `${fx.proof}/contact-sheet.png` },
      pushed: fx.branch, pr_body: "edited", pr_ready: "marked", worktree: "removed",
    });
    expect(testGit(fx.repo.origin, "log", "-1", "--format=%s", fx.branch)).toBe(`host leg: placed assets and proof (run ${fx.id})`);
    expect(testGit(fx.repo.origin, "rev-parse", `${fx.branch}^`)).toBe(fx.tip); // a fast-forward on the pushed tip
    expect(fx.argvs.some((a) => a.args[0] === "push" && a.args.some((x) => x.startsWith("-f") || x.startsWith("--force")))).toBe(false);
    expect(testGit(fx.repo.origin, "show", "--name-only", "--format=", fx.branch).split("\n").sort()).toEqual([
      `${fx.proof}/contact-sheet.png`, `${fx.proof}/frames/tick-000000.png`, `${fx.proof}/frames/tick-000030.png`, `${fx.proof}/report.json`, "art/greybox/crate.glb",
    ]);
    // The per-leg sheet store (`<store>/sheets/`) is what lands: the committed sheet is this leg's own copy.
    expect((r as any).playable.contact_sheet).toContain(join("playable", "sheets"));
    expect(testGit(fx.repo.origin, "show", `${fx.branch}:${fx.proof}/contact-sheet.png`)).toBe(readFileSync((r as any).playable.contact_sheet, "utf-8"));
    // Commit and push before the body edit.
    const pushAt = fx.argvs.findIndex((a) => a.args[0] === "push"), editAt = fx.argvs.findIndex((a) => a.bin === GH && a.args[1] === "edit");
    expect(pushAt).toBeGreaterThan(-1);
    expect(pushAt).toBeLessThan(editAt);
    const body = fx.bodies[0]!;
    expect(body).toContain(`![contact sheet](https://github.com/acme/widget/blob/${sha}/${fx.proof}/contact-sheet.png?raw=true)`);
    expect(body).toContain(`- \`${fx.proof}/frames/tick-000000.png\``);
    expect(body).toContain("Assets: green");
    expect(body).toMatch(/## Landed commits\n\n- [0-9a-f]+ host leg: placed assets and proof/);
  }, 120_000);

  test("Story 35.1: a playable fail still commits the proof (on pass and fail alike); the PR is turned back to a draft", async () => {
    const fx = await sliceFixture({ playable: "fail" });
    fx.answers.view = { state: "OPEN", isDraft: false };
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: false, playable: { verdict: "fail" }, rerun: { pushed: fx.branch, pr_body: "edited", pr_draft: "undone" } });
    expect(r.reason).toStartWith("host verify red (playable): ");
    expect(testGit(fx.repo.origin, "log", "-1", "--format=%s", fx.branch)).toBe(`host leg: placed assets and proof (run ${fx.id})`);
    expect(fx.bodies[0]).toContain("Playable: fail");
    expect(fx.bodies[0]).toContain(`${fx.proof}/contact-sheet.png?raw=true`);
  }, 120_000);

  test("Story 35.1: a red `verify.host` on a slice run commits nothing (`commit: skipped: …`), origin's tip unchanged", async () => {
    const fx = await sliceFixture({ hostCode: 1 });
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: false, assets: { verdict: "skipped", reason: "verify.host red" } });
    expect(r.rerun.commit).toBe("skipped: assets skipped (verify.host red)");
    expect("pushed" in r.rerun).toBe(false);
    expect(testGit(fx.repo.origin, "rev-parse", fx.branch)).toBe(fx.tip);
    expect(fx.argvs.some((a) => a.bin === "git" && (a.args[0] === "commit" || a.args[0] === "push"))).toBe(false);
    expect(r.rerun.pr_body).toBe("edited");
  }, 120_000);

  test("Story 35.1: a push refused: `pushed: error: …`, the leg still recorded, the PR left as it was (no edit, no flip)", async () => {
    const fx = await sliceFixture();
    const hook = join(fx.repo.origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho refused by the test >&2\nexit 1\n", { mode: 0o755 });
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r.rerun.commit).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(r.rerun.pushed).toMatch(/^error: git push exit \d+/);
    expect(fx.gh.some((a) => a[1] === "edit" || a[1] === "ready" || a[1] === "view")).toBe(false);
    expect(testGit(fx.repo.origin, "rev-parse", fx.branch)).toBe(fx.tip);
    expect(fx.hostVerifies().at(-1)!.detail).toMatchObject({ green: true, rerun: { pushed: r.rerun.pushed } });
  }, 120_000);

  test("Story 35.1: a red slice re-run whose push is refused still turns the ready PR back to a draft (one `gh pr ready --undo`), the body never edited", async () => {
    const fx = await sliceFixture({ playable: "fail" });
    fx.answers.view = { state: "OPEN", isDraft: false };
    const hook = join(fx.repo.origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho refused by the test >&2\nexit 1\n", { mode: 0o755 });
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: false, playable: { verdict: "fail" } });
    expect(r.rerun.commit).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(r.rerun.pushed).toStartWith("error:");
    expect(r.rerun.pr_draft).toBe("undone");
    expect(r.rerun.pr_body).toBeUndefined();
    expect("pr_ready" in r.rerun).toBe(false);
    expect(fx.gh.filter((a) => a[1] === "ready")).toEqual([["pr", "ready", PR, "--undo"]]);
    expect(fx.gh.some((a) => a[1] === "edit")).toBe(false);
    expect(fx.bodies).toHaveLength(0);
  }, 120_000);

  test("Story 35.1: a refused push rolls the proof commit back to the cut tip: the local run branch is not ahead of origin, and the next re-run is not `VerifyFailed`", async () => {
    const fx = await sliceFixture();
    const hook = join(fx.repo.origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho refused by the test >&2\nexit 1\n", { mode: 0o755 });
    const first = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(first.rerun.pushed).toMatch(/^error: git push exit \d+/);
    expect(first.rerun.pushed).not.toContain("local branch left ahead");
    expect(testGit(fx.repo.checkout, "rev-parse", fx.branch)).toBe(fx.tip);
    expect(testGit(fx.repo.origin, "rev-parse", fx.branch)).toBe(fx.tip);
    rmSync(hook);
    const second = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(second).toMatchObject({ green: true, rerun: { pushed: fx.branch, pr_body: "edited" } });
    expect(testGit(fx.repo.origin, "rev-parse", `${fx.branch}^`)).toBe(fx.tip);
    expect(testGit(fx.repo.checkout, "rev-parse", fx.branch)).toBe(testGit(fx.repo.origin, "rev-parse", fx.branch));
  }, 180_000);

  test("Story 35.1: another worktree holding the run branch: `VerifyFailed` naming it, that worktree untouched, the lease released", async () => {
    const fx = await fixture();
    const held = join(fx.work, "held");
    testGit(fx.repo.checkout, "worktree", "add", "-q", held, fx.branch);
    const e = await refusal(rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps));
    expect(e.code).toBe("VerifyFailed");
    expect(e.message).toContain(`the run branch '${fx.branch}' is held by another worktree`);
    // git names the held worktree with forward slashes on Windows too: compare separator-insensitively
    expect(e.message.replaceAll("\\", "/")).toContain(held.replaceAll("\\", "/"));
    expect(existsSync(join(held, "feature.txt"))).toBe(true);
    expect(fx.queue.takeVerifyLeg(fx.id, other)).toBe(true);
  }, 60_000);

  test("Story 35.1: a local run branch ahead of origin (an unpushed commit): `VerifyFailed` naming the branch and the commit, the branch and its commit untouched, the lease released", async () => {
    const fx = await fixture();
    const tree = testGit(fx.repo.checkout, "rev-parse", `${fx.branch}^{tree}`);
    const ahead = testGit(fx.repo.checkout, "commit-tree", tree, "-p", fx.branch, "-m", "unpushed hand fix");
    testGit(fx.repo.checkout, "update-ref", `refs/heads/${fx.branch}`, ahead);
    const e = await refusal(rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps));
    expect(e.code).toBe("VerifyFailed");
    expect(e.message).toContain(`'${fx.branch}'`);
    expect(e.message).toContain("unpushed hand fix");
    expect(e.message).toContain(ahead.slice(0, 7));
    expect(testGit(fx.repo.checkout, "rev-parse", fx.branch)).toBe(ahead);
    expect(testGit(fx.repo.checkout, "log", "-1", "--format=%s", ahead)).toBe("unpushed hand fix");
    expect(testGit(fx.repo.origin, "rev-parse", fx.branch)).toBe(fx.tip);
    expect(fx.argvs.some((a) => a.bin === "git" && a.args[0] === "worktree" && a.args[1] === "add")).toBe(false);
    expect(fx.hostVerifies()).toHaveLength(1);
    expect(fx.queue.takeVerifyLeg(fx.id, other)).toBe(true);
  }, 60_000);

  test("Story 35.1: the slice proof commit refused: `commit: error: …`, nothing pushed, the PR left as it was (no edit, no flip), the leg still recorded", async () => {
    const fx = await sliceFixture();
    const inner = fx.deps.run!;
    fx.deps.run = async (bin, args, opts) =>
      bin === "git" && args[0] === "commit" ? { exit: 1, stdout: "", stderr: "commit refused by the test" } : inner(bin, args, opts);
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect(r).toMatchObject({ green: true, assets: { verdict: "green" } });
    expect(r.rerun.commit).toMatch(/^error: git commit exit 1: commit refused by the test/);
    expect("pushed" in r.rerun || "pr_body" in r.rerun || "pr_ready" in r.rerun).toBe(false);
    expect(fx.argvs.some((a) => a.bin === "git" && a.args[0] === "push")).toBe(false);
    expect(testGit(fx.repo.origin, "rev-parse", fx.branch)).toBe(fx.tip);
    expect(fx.gh.some((a) => a[1] === "edit" || a[1] === "ready" || a[1] === "view")).toBe(false);
    expect(fx.hostVerifies().at(-1)!.detail).toMatchObject({ green: true, rerun: { commit: r.rerun.commit } });
  }, 120_000);

  test("Story 35.1: a non-slice re-run uses the same cut and commits nothing", async () => {
    const fx = await fixture();
    const r = await (await rerunHostLeg(fx.queue, fx.id, { by: "api" }, fx.deps)).done;
    expect("commit" in r.rerun || "pushed" in r.rerun).toBe(false);
    expect(fx.argvs.some((a) => a.bin === "git" && (a.args[0] === "commit" || a.args[0] === "push"))).toBe(false);
  }, 60_000);
});
