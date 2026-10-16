// Story 27.1: every run gets its own worktree and ends in a PR — pinned against a real throwaway
// repository (a bare `origin`) and the fake `gh`; the studio scripts' runner is injected.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { cancelRun, endAfterDriveFailure, mirror } from "../src/cli";
import { Queue, selfOwner } from "../src/queue";
import { runProcess, type RunResult } from "../src/server";
import {
  baseBranch, closeOut, closeOutDetail, COPIED_RUNTIME, engineStatus, isDefaultBranch, openPrUrl, originRepo, prBody, prepareWorktree, runBranch, sweepEngines, worktreePath, WorktreeFailed, type WorktreeDeps,
} from "../src/worktree";
import { fakeGh, gitRepo, testGit } from "./fakes";

const me = { pid: process.pid, host: hostname(), nonce: "worktree-test" };

/** One fixture: a real repo + bare origin, the fake gh, a work folder, a queue with a claimed run,
 * a recording git/gh runner, and an injected studio-script runner (install, drift, launch status). */
async function fixture(opts: { baseRef?: string; files?: Record<string, string>; skill?: string } = {}) {
  const repo = gitRepo(opts.files);
  const gh = fakeGh();
  const work = mkdtempSync(join(tmpdir(), "tk-sup-wt-work-"));
  const argvs: { bin: string; args: string[]; cwd: string }[] = [];
  const studio: { script: string; args: string[]; root: string }[] = [];
  const verbs: string[][] = [];
  const answers = {
    install: { exit: 0, out: { ok: true } } as { exit: number; out: unknown }, drift: "clean", launch: { ok: true, run: { status: "running" } } as unknown,
    /** The queue's engine probe (`live[]` in the worktree) and the recorded worker's probe. */
    engineLive: true, workerRunning: false,
  };
  const env = { ...process.env, TK_SUPERVISOR_WORK: work, GH_BIN: gh.bin, TK_STUDIO_ROOT: "/studio-root" };
  const deps: WorktreeDeps = {
    env,
    run: (bin, args, o) => { argvs.push({ bin, args, cwd: o.cwd }); return runProcess(bin, args, { cwd: o.cwd, timeoutS: o.timeoutS, env: { ...env, ...(o.env ?? {}) } }); },
    uv: async (root, script, args): Promise<RunResult> => {
      studio.push({ script, args, root });
      if (script.endsWith("install_base.py")) return { exit: answers.install.exit, stdout: JSON.stringify(answers.install.out), stderr: "" };
      if (script.endsWith("drift_check.py")) return { exit: answers.drift === "clean" ? 0 : 1, stdout: JSON.stringify({ ok: true, result: answers.drift }), stderr: "" };
      if (script.endsWith("launch.py")) return { exit: 0, stdout: JSON.stringify(answers.launch), stderr: "" };
      return { exit: 2, stdout: "", stderr: "unexpected script" };
    },
    verbs: async (_root, args) => { verbs.push(args); return { ok: true, state: args[args.indexOf("--state") + 1] }; },
  };
  const queue = new Queue(":memory:", {
    ownerAlive: (o) => o.nonce === me.nonce,
    // As the real probe (`uv` with the root as its cwd): a root that is gone fails, and fails closed.
    engineLive: async (root) => !existsSync(root) ? { live: true, detail: `launch status probe failed: no such directory '${root}'` }
      : answers.engineLive ? { live: true, run_ids: ["E1"] } : { live: false, run_ids: [] },
    probeWorker: (pid, start) => ({ pid, start, outcome: answers.workerRunning ? "running" : "not running" }),
  });
  const defn = { id: "j", target: { skill: opts.skill ?? "tk-studio-launch" } };
  const queued = queue.enqueue({ jobId: "j", root: repo.checkout, projectId: "proj", definition: defn, owner: me, ...(opts.baseRef ? { base_ref: opts.baseRef } : {}) }).run;
  const claim = await queue.claim(queued.run_id, me);
  if (!claim.claimed) throw new Error("not claimed");
  const head = () => [testGit(repo.checkout, "rev-parse", "--abbrev-ref", "HEAD"), testGit(repo.checkout, "rev-parse", "HEAD")];
  const headBefore = head();
  return { repo, gh, work, argvs, studio, verbs, answers, deps, queue, run: claim.run, defn, head, headBefore, get: () => queue.get(queued.run_id)! };
}

/** No git/gh argv ever forces, merges, or switches a branch. */
function expectNoForbiddenArgv(argvs: { bin: string; args: string[] }[], ghCalls: { argv: string[] }[]) {
  const all = [...argvs.map((a) => a.args), ...ghCalls.map((c) => c.argv)];
  expect(all.length).toBeGreaterThan(0);
  for (const args of all) {
    for (const forbidden of ["--force", "-f", "--force-with-lease", "merge", "checkout", "switch"]) expect(args).not.toContain(forbidden);
  }
}

/** A commit in the worktree (the engine's work). */
function commitIn(wt: string, file: string, msg: string) {
  writeFileSync(join(wt, file), msg);
  testGit(wt, "add", file);
  testGit(wt, "commit", "-q", "-m", msg);
}

describe("AC1: the worktree is cut from base_ref, the checkout never switched", () => {
  test("create: a feature-branch base_ref → <work>/worktrees/<project>/<run id> on supervisor/run-<id>, the path recorded, a relative gitdir, the checkout HEAD unchanged", async () => {
    const fx = await fixture({ baseRef: "feature" });
    testGit(fx.repo.checkout, "branch", "feature");
    testGit(fx.repo.checkout, "push", "-q", "origin", "feature"); // on origin too: its PR has a base on GitHub
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(wt).toBe(join(resolve(fx.work), "worktrees", "proj", fx.run.run_id));
    expect(wt).toBe(worktreePath(fx.work, "proj", fx.run.run_id));
    expect(testGit(wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe(runBranch(fx.run.run_id));
    expect(runBranch(fx.run.run_id)).toBe(`supervisor/run-${fx.run.run_id}`);
    expect(testGit(wt, "rev-parse", "HEAD")).toBe(testGit(fx.repo.checkout, "rev-parse", "feature"));
    // §5: the worktree's .git file holds a relative gitdir that resolves to the checkout's worktree record.
    const dotGit = readFileSync(join(wt, ".git"), "utf-8").trim();
    expect(dotGit).toStartWith("gitdir: ");
    const gitdir = dotGit.slice("gitdir: ".length);
    expect(isAbsolute(gitdir)).toBe(false);
    expect(gitdir).not.toMatch(/^[A-Za-z]:/);
    expect(resolve(wt, gitdir)).toBe(join(fx.repo.checkout, ".git", "worktrees", fx.run.run_id));
    expect(isAbsolute(readFileSync(join(fx.repo.checkout, ".git", "worktrees", fx.run.run_id, "gitdir"), "utf-8").trim())).toBe(false);
    expect(fx.argvs.find((a) => a.args[0] === "worktree")).toEqual({
      bin: "git", args: ["worktree", "add", "--relative-paths", wt, "-b", `supervisor/run-${fx.run.run_id}`, "feature"], cwd: fx.repo.checkout,
    });
    expect(fx.get()).toMatchObject({ worktree: wt, base_ref: "feature", base_ref_source: null });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "worktree")!.detail).toEqual({ path: wt, branch: `supervisor/run-${fx.run.run_id}`, base_ref: "feature" });
    // A feature branch is not the default: no protection check.
    expect(fx.gh.calls().some((c) => c.argv[0] === "api")).toBe(false);
    expect(fx.head()).toEqual(fx.headBefore);
    // Once per queue run: an adopted or resumed run keeps the worktree it has.
    expect(await prepareWorktree(fx.queue, fx.get(), "proj", fx.repo.checkout, fx.deps)).toBe(wt);
    expect(fx.argvs.filter((a) => a.args[0] === "worktree")).toHaveLength(1);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  });

  test("unprotected default: base_ref = the default branch and GitHub says unprotected → `blocked` naming it, no worktree", async () => {
    const fx = await fixture({ baseRef: "main" });
    fx.gh.answer({ protected: [] });
    const failed = prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    await expect(failed).rejects.toThrow(WorktreeFailed);
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps)).rejects.toThrow(
      "worktree protection: base_ref 'main' is the repository's default branch and is not protected on GitHub — refused");
    expect(fx.gh.calls().find((c) => c.argv[0] === "api")!.argv).toEqual(["api", "repos/{owner}/{repo}/branches/main"]);
    expect(existsSync(worktreePath(fx.work, "proj", fx.run.run_id))).toBe(false);
    expect(fx.get().worktree).toBeNull();
    expect(fx.argvs.some((a) => a.args[0] === "worktree")).toBe(false);
    expect(fx.head()).toEqual(fx.headBefore);
  });

  test("a protected default branch is accepted", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(existsSync(join(wt, ".git"))).toBe(true);
    expect(fx.gh.calls().filter((c) => c.argv[0] === "api")).toHaveLength(1);
  });

  test("no base_ref (§3): resolved to the default branch from origin/HEAD, recorded `base_ref_source: default`, protection checked", async () => {
    const fx = await fixture();
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(fx.get()).toMatchObject({ base_ref: "main", base_ref_source: "default", worktree: wt });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "base-ref")!.detail).toEqual({ base_ref: "main", base_ref_source: "default" });
    expect(fx.gh.calls().map((c) => c.argv[0])).toEqual(["api"]); // origin/HEAD answered: no `gh repo view`
  });

  test("no base_ref, no origin/HEAD: `gh repo view --json defaultBranchRef`; unprotected → `blocked`", async () => {
    const fx = await fixture();
    testGit(fx.repo.checkout, "remote", "set-head", "origin", "-d");
    fx.gh.answer({ default: "main", protected: [] });
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps)).rejects.toThrow("worktree protection: base_ref 'main'");
    expect(fx.gh.calls().map((c) => c.argv)).toEqual([["repo", "view", "--json", "defaultBranchRef"], ["api", "repos/{owner}/{repo}/branches/main"]]);
    expect(fx.get()).toMatchObject({ base_ref: "main", base_ref_source: "default", worktree: null });
  });

  test("TK_SUPERVISOR_WORK missing, or inside the project root → `blocked` naming it", async () => {
    const fx = await fixture({ baseRef: "main" });
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, { ...fx.deps, env: { ...fx.deps.env, TK_SUPERVISOR_WORK: "" } }))
      .rejects.toThrow("worktree work folder: WorkDirMissing: TK_SUPERVISOR_WORK is not set — every run needs the work folder its git worktree is cut under");
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, { ...fx.deps, env: { ...fx.deps.env, TK_SUPERVISOR_WORK: join(fx.repo.checkout, "work") } }))
      .rejects.toThrow("worktree work folder: TK_SUPERVISOR_WORK is the project root or lies inside it");
    expect(fx.argvs).toEqual([]);
  });

  test.skipIf(process.platform !== "win32")("sbx: a worktree with no path visible in the microVM → `blocked` (win32: a UNC work folder)", async () => {
    const fx = await fixture({ baseRef: "main" });
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, { ...fx.deps, env: { ...fx.deps.env, TK_SUPERVISOR_WORK: "\\\\server\\share\\work" }, tier: "sbx" }))
      .rejects.toThrow("worktree vm path:");
  });
});

describe("AC2: the untracked runtime is materialised by the studio's own motions", () => {
  test("materialise: `tk install` at the pin inside the worktree, policy/routing/overlay copied (files, never links), `tk activate` clean", async () => {
    const fx = await fixture({ baseRef: "main" });
    mkdirSync(join(fx.repo.checkout, ".bmad-loop"), { recursive: true });
    writeFileSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"), "policy = 1\n");
    writeFileSync(join(fx.repo.checkout, ".bmad-loop", "routing.current.json"), "{\"r\":1}\n");
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(fx.studio.map((c) => [c.script.split(/[\\/]/).slice(-4).join("/"), c.args, c.root])).toEqual([
      ["skills/tk-studio-install/scripts/install_base.py", ["--directory", wt], wt],
      ["skills/tk-studio-activate/scripts/drift_check.py", ["--directory", wt], wt],
    ]);
    expect(fx.studio[0]!.script).toStartWith(join("/studio-root", "plugins", "tk-studio"));
    for (const rel of [".bmad-loop/policy.toml", ".bmad-loop/routing.current.json"]) {
      expect(lstatSync(join(wt, rel)).isFile()).toBe(true);
      expect(lstatSync(join(wt, rel)).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(wt, rel), "utf-8")).toBe(readFileSync(join(fx.repo.checkout, rel), "utf-8"));
    }
    expect(existsSync(join(wt, ".tk-studio", "config.local.yaml"))).toBe(false); // absent in the checkout: skipped silently
    expect(fx.head()).toEqual(fx.headBefore);
  });

  test("the local overlay `.tk-studio/config.local.yaml` is copied when present", async () => {
    const fx = await fixture({ baseRef: "main" });
    mkdirSync(join(fx.repo.checkout, ".tk-studio"), { recursive: true });
    writeFileSync(join(fx.repo.checkout, ".tk-studio", "config.local.yaml"), "local: true\n");
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(readFileSync(join(wt, ".tk-studio", "config.local.yaml"), "utf-8")).toBe("local: true\n");
    expect(COPIED_RUNTIME).toContain(".tk-studio/config.local.yaml");
  });

  test("an install that fails, or activate drift, ends the run `blocked` naming the step", async () => {
    const a = await fixture({ baseRef: "main" });
    a.answers.install = { exit: 1, out: { ok: false, step: "upstream-installer", error: "npx exploded" } };
    await expect(prepareWorktree(a.queue, a.run, "proj", a.repo.checkout, a.deps)).rejects.toThrow("worktree install: upstream-installer: npx exploded");
    const b = await fixture({ baseRef: "main" });
    b.answers.drift = "drift";
    await expect(prepareWorktree(b.queue, b.run, "proj", b.repo.checkout, b.deps)).rejects.toThrow("worktree activate drift: result 'drift'");
  });
});

describe("AC3: the close-out pushes the run branch and opens a PR against base_ref", () => {
  const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] };

  test("the PR body: the status block (fenced JSON), the engine run id, the landed commits, the metered cost — in that order", () => {
    const body = prBody({ statusBlock: BLOCK, engineRunId: "E1", commits: ["abc123 one", "def456 two"], costUsd: 1.5, runId: "q-1" });
    const at = (s: string) => body.indexOf(s);
    expect(body).toContain("```json\n" + JSON.stringify(BLOCK, null, 2) + "\n```");
    expect(body).toContain("Engine run: E1");
    expect(body).toContain("- abc123 one\n- def456 two");
    expect(body).toContain("$1.5000");
    expect(at("```json")).toBeLessThan(at("Engine run: E1"));
    expect(at("Engine run: E1")).toBeLessThan(at("- abc123 one"));
    expect(at("- def456 two")).toBeLessThan(at("$1.5000"));
    expect(prBody({ commits: [], runId: "q-1" })).toContain("not metered");
  });

  test("engine completes with commits: pushed (no force), `gh pr create --base <base_ref>` with the body, the worktree removed", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "engine: story one");
    commitIn(wt, "b.txt", "engine: story two");
    mkdirSync(join(wt, ".bmad-loop", "runs", "E1"), { recursive: true });
    writeFileSync(join(wt, ".bmad-loop", "runs", "E1", "run.json"), JSON.stringify({ total_cost_usd: 2.25 }));
    const out = await closeOut(fx.get(), { paused: false, statusBlock: BLOCK, engineRunId: "E1" }, fx.deps);
    expect(out).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", pushed: `supervisor/run-${fx.run.run_id}`, worktree: "removed" });
    expect(out.error).toBeUndefined();
    expect(out.commits).toHaveLength(2);
    // The branch reached origin; the worktree is gone.
    expect(testGit(fx.repo.origin, "rev-parse", `refs/heads/supervisor/run-${fx.run.run_id}`)).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(wt)).toBe(false);
    expect(fx.argvs.find((a) => a.args[0] === "push")).toEqual({ bin: "git", args: ["push", "origin", `supervisor/run-${fx.run.run_id}`], cwd: wt });
    const call = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    const create = call.argv;
    expect(create.slice(0, 6)).toEqual(["pr", "create", "--base", "main", "--head", `supervisor/run-${fx.run.run_id}`]);
    expect(create).not.toContain("--draft");
    expect(create).not.toContain("--body"); // the body through a file, never on the command line
    expect(create).toContain("--body-file");
    expect(existsSync(create[create.indexOf("--body-file") + 1]!)).toBe(false); // removed afterwards
    const body = call.body!;
    expect(body).toContain(JSON.stringify(BLOCK, null, 2));
    expect(body).toContain("Engine run: E1");
    expect(body).toContain("engine: story one");
    expect(body).toContain("engine: story two");
    expect(body).toContain("$2.2500");
    expect(fx.head()).toEqual(fx.headBefore);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  });

  test("no commits: no push, no PR, \"no changes\", the worktree removed", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    const out = await closeOut(fx.get(), { paused: false, statusBlock: BLOCK, engineRunId: "E1" }, fx.deps);
    expect(out).toEqual({ commits: [], no_changes: true, worktree: "removed" });
    expect(fx.argvs.some((a) => a.args[0] === "push")).toBe(false);
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(existsSync(wt)).toBe(false);
  });

  test("a push that fails is recorded and the worktree kept", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    testGit(fx.repo.checkout, "remote", "set-url", "origin", join(tmpdir(), "tk-sup-no-such-origin.git"));
    const out = await closeOut(fx.get(), { paused: false }, fx.deps);
    expect(out.error).toStartWith("git push exit");
    expect(out.worktree).toBe("kept");
    expect(out.pr).toBeUndefined();
    expect(existsSync(wt)).toBe(true);
  });
});

describe("AC3: the engine-end sweep (operator-decisions §2)", () => {
  /** A launched run: worktree cut, engine E1 recorded by `mirror`, its `launched` event written. */
  async function launched() {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] };
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete", status_block: BLOCK, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    return { ...fx, wt, BLOCK };
  }

  test("launch return → `launched` (status block, engine run id); the run stays `running`, its driver lets go, the lock goes to the engine", async () => {
    const fx = await launched();
    expect(fx.get()).toMatchObject({ state: "running", engine_run_id: "E1", owner_pid: null });
    const ev = fx.queue.events(fx.run.run_id).at(-1)!;
    expect(ev).toMatchObject({ kind: "launched", from_state: "running", to_state: "running" });
    expect(ev.detail).toMatchObject({ engine_run_id: "E1", status_block: fx.BLOCK, lock: { handed_to_engine: "E1" }, end: { state: "complete" } });
    expect(fx.queue.events(fx.run.run_id).some((e) => e.kind === "ended")).toBe(false);
    expect(fx.queue.lock(fx.repo.checkout)).toMatchObject({ kind: "engine", engine_run_id: "E1", run_id: fx.run.run_id, root: fx.wt });
    expect(fx.queue.pacing("j", fx.repo.checkout, me).live.map((r) => r.run_id)).toEqual([fx.run.run_id]);
    // A still-running engine: the sweep leaves it.
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.studio.at(-1)).toMatchObject({ args: ["status", "--directory", fx.wt, "--run-id", "E1"], root: fx.wt });
  });

  test("paused: pushed, a draft PR, the URL on the `paused` event, the worktree and the lock kept; then ended: `gh pr ready`, `ended` carries the PR, the worktree removed", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: story one");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const paused = fx.get();
    expect(paused).toMatchObject({ state: "paused", owner_pid: null, worktree: fx.wt });
    const pausedEv = fx.queue.events(fx.run.run_id).at(-1)!;
    expect(pausedEv).toMatchObject({ kind: "paused", from_state: "running", to_state: "paused" });
    expect(pausedEv.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "draft PR", worktree: "kept" }, engine: { paused_stage: "review" } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
    expect(existsSync(fx.wt)).toBe(true);
    // The lock is kept: another run on the checkout waits on the paused run.
    const other = fx.queue.enqueue({ jobId: "k", root: fx.repo.checkout, definition: { id: "k" }, owner: me }).run;
    const wait = await fx.queue.claim(other.run_id, me);
    expect(wait).toMatchObject({ claimed: false, why: "lock", holder: { run_id: fx.run.run_id, detail: "its run is paused: the lock is kept for the resume" } });
    expect(fx.queue.pacing("j", fx.repo.checkout, me).live.map((r) => r.run_id)).toEqual([fx.run.run_id]);
    expect(fx.verbs).toEqual([]); // the paused path never finishes the studio run
    // Still paused: never closed out twice.
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.gh.calls().filter((c) => c.argv[1] === "create")).toHaveLength(1);

    // The resumed engine lands one more commit and finishes.
    commitIn(fx.wt, "b.txt", "engine: story two");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const ended = fx.get();
    expect(ended).toMatchObject({ state: "complete", engine_run_id: "E1" });
    const endedEv = fx.queue.events(fx.run.run_id).at(-1)!;
    expect(endedEv).toMatchObject({ kind: "ended", from_state: "paused", to_state: "complete" });
    expect(endedEv.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" }, engine: { status: "finished" }, lock: "released",
      finish: { ok: true, detail: "studio run j-20261016T101010Z finished complete" } });
    // operator-decisions §2: `finish` at the engine's end — the deferred state, the launch status block
    // (the PR among its artifacts), the metered cost (no run.json here: the launch worker's).
    expect(fx.verbs).toEqual([[
      "finish", "--directory", fx.repo.checkout, "--run-id", "j-20261016T101010Z", "--state", "complete",
      "--status-block", JSON.stringify({ ...fx.BLOCK, artifacts: [...fx.BLOCK.artifacts, "https://github.com/acme/widget/pull/42"] }), "--total-cost-usd", "0.25",
    ]]);
    const prCalls = fx.gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv.slice(0, 2));
    // The same PR, never opened twice; marked ready, then its body regenerated with the (skipped: host-tier)
    // `## Host verify` section (Story 27.4).
    expect(prCalls).toEqual([["pr", "list"], ["pr", "create"], ["pr", "ready"], ["pr", "edit"]]);
    expect(fx.gh.calls().at(-2)!.argv).toEqual(["pr", "ready", "https://github.com/acme/widget/pull/42"]);
    expect(fx.gh.calls().at(-1)!.argv.slice(0, 4)).toEqual(["pr", "edit", "https://github.com/acme/widget/pull/42", "--body-file"]);
    expect(fx.gh.calls().at(-1)!.body).toContain("## Host verify\n\nSkipped: host-tier run: the worker ran on the host");
    expect(existsSync(fx.wt)).toBe(false);
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
    expect(fx.head()).toEqual(fx.headBefore);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  });

  test("engine stopped with no commits: `ended` once, \"no changes\", no push, no PR, the worktree removed", async () => {
    const fx = await launched();
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get()).toMatchObject({ state: "complete" });
    const ev = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "ended");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toMatchObject({ no_changes: true, closeout: { result: "no changes", worktree: "removed" }, engine: { status: "stopped" } });
    expect(ev[0]!.detail!.pr).toBeUndefined();
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(fx.argvs.some((a) => a.args[0] === "push")).toBe(false);
    expect(existsSync(fx.wt)).toBe(false);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // ended: nothing left to sweep
    expect(fx.verbs.map((v) => v[0])).toEqual(["finish"]); // finished once, at the engine's end
  });

  test("the run.json metered cost is what `finish` and the PR body carry", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    mkdirSync(join(fx.wt, ".bmad-loop", "runs", "E1"), { recursive: true });
    writeFileSync(join(fx.wt, ".bmad-loop", "runs", "E1", "run.json"), JSON.stringify({ total_cost_usd: 3.5 }));
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const finish = fx.verbs[0]!;
    expect(finish[finish.indexOf("--total-cost-usd") + 1]).toBe("3.5");
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("$3.5000");
  });

  test("cancel of a launched run: the engine stopped, then closed out before the `cancelled` end — pushed, its PR on `ended`, the worktree removed", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: partial work");
    const stops: string[][] = [];
    const verbs = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "j-20261016T101010Z", state: "running" }] } : { state: "cancelled" };
    const ended = await cancelRun(fx.queue, fx.run.run_id, { verbRunner: verbs, launchStop: async (root, id) => { stops.push([root, id]); fx.answers.engineLive = false; return { ok: true, detail: "stopping" }; }, worktree: fx.deps });
    expect(ended.state).toBe("cancelled");
    expect(stops).toEqual([[fx.wt, "E1"]]);
    const ev = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ev.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" }, engine_stop: { ok: true } });
    expect(testGit(fx.repo.origin, "rev-parse", `refs/heads/supervisor/run-${fx.run.run_id}`)).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(fx.wt)).toBe(false);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  });

  test("cancel of a launched run with nothing landed: \"no changes\" on `ended`, no PR, the worktree removed", async () => {
    const fx = await launched();
    const verbs = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "j-20261016T101010Z", state: "running" }] } : { state: "cancelled" };
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: verbs, launchStop: async () => { fx.answers.engineLive = false; return { ok: true, detail: "stopping" }; }, worktree: fx.deps });
    const ev = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ev.detail).toMatchObject({ no_changes: true, closeout: { result: "no changes", worktree: "removed" } });
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(existsSync(fx.wt)).toBe(false);
  });

  test("a failed status probe never closes out", async () => {
    const fx = await launched();
    fx.answers.launch = { ok: false, error: "bmad-loop not found" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.get().state).toBe("running");
    expect(await engineStatus(fx.wt, "E1", fx.deps)).toMatchObject({ phase: "unknown", detail: { error: "bmad-loop not found" } });
  });

  /** A `blocked` launch whose status block names engine E1 (not marked `launched`: no deferred finish). */
  async function blockedLaunch(engineLive: boolean) {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    fx.answers.engineLive = engineLive;
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn },
      { ok: false, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "blocked", reason: "dirty tree", status_block: { status: "blocked", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"], reason: "dirty tree" } },
      async () => ({}), fx.deps);
    return { ...fx, wt };
  }

  test("a blocked launch ends at once: \"no changes\", the worktree removed, no `launched` event; its engine dead → the checkout lock released, claimable (P2)", async () => {
    const fx = await blockedLaunch(false);
    expect(fx.get()).toMatchObject({ state: "blocked", reason: "dirty tree", engine_run_id: "E1" });
    const kinds = fx.queue.events(fx.run.run_id).map((e) => e.kind);
    expect(kinds).not.toContain("launched");
    const ended = fx.queue.events(fx.run.run_id).at(-1)!;
    expect(ended.detail).toMatchObject({ no_changes: true, closeout: { result: "no changes" }, lock: "released" });
    expect(existsSync(fx.wt)).toBe(false);
    // The engine named was probed in the worktree before the close-out (not after it, at a removed path).
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
    const other = fx.queue.enqueue({ jobId: "k", root: fx.repo.checkout, definition: { id: "k" }, owner: me }).run;
    expect(await fx.queue.claim(other.run_id, me)).toMatchObject({ claimed: true });
  });

  test("P2: a blocked launch whose named engine may still be live → `closeout: skipped`, the worktree kept; the sweep closes it out once the engine is dead", async () => {
    const fx = await blockedLaunch(true);
    commitIn(fx.wt, "a.txt", "engine: work");
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ closeout: { result: "skipped", why: "an engine may still work the worktree", worktree: "kept" } });
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(fx.argvs.some((a) => a.args[0] === "push" || (a.args[0] === "worktree" && a.args[1] === "remove"))).toBe(false);
    expect(existsSync(fx.wt)).toBe(true);
    expect(fx.queue.lock(fx.repo.checkout)).toMatchObject({ kind: "engine", engine_run_id: "E1", root: fx.wt });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // still live: the sweep waits
    fx.answers.engineLive = false;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closed_out")).toHaveLength(1);
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "closed_out")!.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { worktree: "removed" } });
    expect(existsSync(fx.wt)).toBe(false);
    // P1 (c): the engine lock it held at the removed worktree is released; the checkout is claimable.
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
    const other = fx.queue.enqueue({ jobId: "k", root: fx.repo.checkout, definition: { id: "k" }, owner: me }).run;
    expect(await fx.queue.claim(other.run_id, me)).toMatchObject({ claimed: true });
  });

  test("a run with no engine (any skill) closes out when it ends: commits → a PR on the `ended` event", async () => {
    const fx = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const defn = { id: "j", target: { skill: "tk-studio-activate" } };
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "fix.txt", "worker: a fix");
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn }, { ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete", total_cost_usd: 0.5 }, async () => ({}), fx.deps);
    const ended = fx.queue.events(fx.run.run_id).at(-1)!;
    expect(ended).toMatchObject({ kind: "ended", to_state: "complete" });
    expect(ended.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("$0.5000");
  });
});

describe("Story 27.4: the host verify leg runs before any PR opens", () => {
  /** `"<bun>" -e "<script>"`: the same verify command on both hosts (the script uses single quotes only). */
  const bunCmd = (script: string) => `"${process.execPath}" -e "${script}"`;
  const RED = bunCmd("console.log('ran 12 tests'); console.error('FAIL win32 path test'); console.error('1 failing'); process.exit(3)");
  const config = (host?: string) => host === undefined ? "vcs: git\n" : `vcs: git\nverify:\n  host: ${JSON.stringify(host)}\n`;

  /** A launched sbx run (as the AC3 sweep's `launched()`) whose base config carries `host`; one engine commit. */
  async function launchedSbx(host: string | undefined, tier: "sbx" | "host" = "sbx") {
    const fx = await fixture({ baseRef: "main", files: { ".tk-studio/config.yaml": config(host) } });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] };
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete", status_block: BLOCK, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    // The run's tier as an sbx submission records it (set after the launch return: no fake `sbx` here).
    (fx.queue as any).db.query("UPDATE runs SET tier = ? WHERE run_id = ?").run(tier, fx.run.run_id);
    commitIn(wt, "a.txt", "engine: story one");
    return { ...fx, wt, BLOCK };
  }
  const hv = (fx: { queue: Queue; run: { run_id: string } }) => fx.queue.events(fx.run.run_id).filter((e) => e.kind === "host-verify");
  const prCalls = (fx: { gh: ReturnType<typeof fakeGh> }) => fx.gh.calls().filter((c) => c.argv[0] === "pr");

  test("green: a `host-verify` event before the close-out (exit, duration, tails), the PR created ready, the end as computed", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const events = fx.queue.events(fx.run.run_id);
    const ev = hv(fx);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toMatchObject({ green: true, exit: 0, cwd: fx.wt, stdout_tail: ["all green"], stderr_tail: [] });
    expect(typeof ev[0]!.detail!.duration_ms).toBe("number");
    expect(events.findIndex((e) => e.kind === "host-verify")).toBeLessThan(events.findIndex((e) => e.kind === "ended"));
    // The verify ran in the worktree, before the push.
    const verifyAt = fx.argvs.findIndex((a) => a.bin === process.execPath), pushAt = fx.argvs.findIndex((a) => a.args[0] === "push");
    expect(fx.argvs[verifyAt]!.cwd).toBe(fx.wt);
    expect(verifyAt).toBeLessThan(pushAt);
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).not.toContain("--draft");
    expect(create.body).toContain("## Host verify");
    expect(create.body).toContain("Green: `");
    expect(fx.get()).toMatchObject({ state: "complete" });
    const ended = events.find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ closeout: { result: "PR", host_verify: "green", worktree: "removed" } });
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("complete");
  });

  test("red exit: `partial` naming the command and its last lines, pushed, `gh pr create --draft` carrying the failures, `finish --state partial`", async () => {
    const fx = await launchedSbx(RED);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)[0]!.detail).toMatchObject({ green: false, exit: 3, command: RED, stderr_tail: ["FAIL win32 path test", "1 failing"] });
    const reason = `host verify red: \`${RED}\` exited 3; last lines: FAIL win32 path test | 1 failing`;
    expect(fx.get()).toMatchObject({ state: "partial", reason });
    // Pushed as before.
    expect(testGit(fx.repo.origin, "rev-parse", `refs/heads/supervisor/run-${fx.run.run_id}`)).toMatch(/^[0-9a-f]{40}$/);
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).toContain("--draft");
    expect(create.body).toContain("**Red:**");
    expect(create.body).toContain("FAIL win32 path test");
    expect(prCalls(fx).some((c) => c.argv[1] === "ready")).toBe(false);
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended).toMatchObject({ to_state: "partial" });
    expect(ended.detail!.reason).toBe(reason); // the notification's reason names the command and its failures
    expect(ended.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "draft PR", host_verify: "red", worktree: "removed" } });
    expect(existsSync(fx.wt)).toBe(false);
    // The deferred studio `finish` carries the red end.
    expect(fx.verbs).toHaveLength(1);
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("partial");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--reason") + 1]).toBe(reason);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  });

  test("red on a paused run's existing draft: no `host-verify` on the pause; at the end no `gh pr ready`, `gh pr edit <pr> --body-file` with the failures", async () => {
    const fx = await launchedSbx(RED);
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    expect(hv(fx)).toHaveLength(0); // a paused stop runs no leg
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(1);
    expect(fx.get().state).toBe("partial");
    const pr = "https://github.com/acme/widget/pull/42";
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "create", "ready", "edit"]);
    expect(prCalls(fx)[2]!.argv).toEqual(["pr", "ready", pr, "--undo"]); // a no-op on the draft: never marked ready
    const edit = prCalls(fx).at(-1)!;
    expect(edit.argv.slice(0, 4)).toEqual(["pr", "edit", pr, "--body-file"]);
    expect(edit.body).toContain("FAIL win32 path test");
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ pr, closeout: { result: "draft PR", host_verify: "red", worktree: "removed" } });
  });

  test("absent: no `verify.host` → a skipped `host-verify` event with the reason; the PR opens as before", async () => {
    const fx = await launchedSbx(undefined);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail)).toEqual([{ skipped: true, reason: "no verify.host" }]);
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).not.toContain("--draft");
    expect(create.body).toContain("Skipped: no verify.host");
    expect(fx.get()).toMatchObject({ state: "complete" });
  });

  test("a host-tier run: skipped `host-tier run: …`, nothing spawned, the PR as before", async () => {
    const fx = await launchedSbx(RED, "host");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail)).toEqual([{ skipped: true, reason: "host-tier run: the worker ran on the host" }]);
    expect(fx.argvs.some((a) => a.bin === process.execPath)).toBe(false);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).not.toContain("--draft");
    expect(fx.get().state).toBe("complete");
  });

  test("an engine the supervisor killed: no leg, no `host-verify` event, its recorded end", async () => {
    const fx = await launchedSbx(RED);
    fx.queue.recordEnginePid(fx.run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    fx.queue.note(fx.run.run_id, "engine-kill", { why: "test", sandbox: "claude-p", worker: { pid: 6509, start: "125610.0", outcome: "killed" } });
    fx.answers.launch = { ok: true, run: { status: "running" } }; // a killed engine never writes its end
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(0);
    expect(fx.argvs.some((a) => a.bin === process.execPath)).toBe(false);
    expect(fx.get().state).toBe("complete");
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).not.toContain("--draft");
  });

  test("a relaunched run: red overrides the engine's own end (`finished` would be `complete`)", async () => {
    const fx = await launchedSbx(RED);
    // A close-out then a relaunch's `launched` (Story 27.3): the end is the engine's terminal status.
    fx.queue.note(fx.run.run_id, "close-out", { story: "k" });
    fx.queue.markLaunched(fx.run.run_id, "E1", { end: { state: "complete", reason: null } });
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toStartWith(`host verify red: \`${RED}\` exited 3`);
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("partial");
    expect(fx.verbs[0]!.join(" ")).not.toContain("relaunched engine ended");
  });

  test("a resumed run: red overrides the engine's own end (`finished` would be `complete`) → `partial` naming the command, `finish --state partial`", async () => {
    const fx = await launchedSbx(RED);
    // The resume's fresh `launched` (Story 27.3: `resumed: true`): the end is the engine's terminal status.
    fx.queue.markLaunched(fx.run.run_id, "E1", { end: { state: "complete", reason: null }, resumed: true } as any);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(1);
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toStartWith(`host verify red: \`${RED}\` exited 3`);
    expect(fx.verbs).toHaveLength(1);
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("partial");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--reason") + 1]).toStartWith(`host verify red: \`${RED}\``);
    expect(fx.verbs[0]!.join(" ")).not.toContain("resumed engine ended");
  });

  test("red on an adopted open PR (not paused, perhaps left ready by a crashed close-out): `gh pr ready <pr> --undo` and `gh pr edit`, never plain `gh pr ready`", async () => {
    const fx = await launchedSbx(RED);
    const pr = "https://github.com/acme/widget/pull/77";
    fx.gh.answer({ open: [pr] });
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(prCalls(fx).map((c) => c.argv.slice(1, 4))).toEqual([
      ["list", "--head", `supervisor/run-${fx.run.run_id}`], ["ready", pr, "--undo"], ["edit", pr, "--body-file"],
    ]);
    expect(prCalls(fx).filter((c) => c.argv[1] === "ready").every((c) => c.argv.includes("--undo"))).toBe(true);
    expect(prCalls(fx).at(-1)!.body).toContain("FAIL win32 path test");
    expect(fx.get().state).toBe("partial");
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ pr, closeout: { result: "draft PR", host_verify: "red", worktree: "removed" } });
  });

  test("red on an adopted PR whose `gh pr ready --undo` fails: recorded in the close-out (never thrown), the body still edited", async () => {
    const fx = await launchedSbx(RED);
    const pr = "https://github.com/acme/widget/pull/77";
    fx.gh.answer({ open: [pr], fail: ["pr ready"] });
    const verify = { command: RED, argv: ["x"], cwd: fx.wt, exit: 3, duration_ms: 1, green: false, stdout_tail: [], stderr_tail: ["boom"] };
    const c = await closeOut(fx.get(), { paused: false, verify }, fx.deps);
    expect(c.error).toStartWith("gh pr ready --undo ");
    expect(c.draft).toBeUndefined();
    expect(c).toMatchObject({ pr, host_verify: "red", worktree: "kept" });
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "ready", "edit"]);
  });

  test("green on a paused run's existing draft: at the end `gh pr ready <pr>` then `gh pr edit <pr> --body-file` carrying the green `## Host verify`", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail!.green)).toEqual([true]);
    const pr = "https://github.com/acme/widget/pull/42";
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "create", "ready", "edit"]);
    expect(prCalls(fx)[2]!.argv).toEqual(["pr", "ready", pr]);
    const edit = prCalls(fx)[3]!;
    expect(edit.argv.slice(0, 4)).toEqual(["pr", "edit", pr, "--body-file"]);
    expect(edit.body).toContain("## Host verify\n\nGreen: `");
    expect(fx.get().state).toBe("complete");
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ pr, closeout: { result: "PR", host_verify: "green", worktree: "removed" } });
  });

  test("green on an adopted open PR whose `gh pr ready` and `gh pr edit` both fail: both recorded in the close-out (never thrown)", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    const pr = "https://github.com/acme/widget/pull/77";
    fx.gh.answer({ open: [pr], fail: ["pr ready", "pr edit"] });
    const verify = { command: "x", argv: ["x"], cwd: fx.wt, exit: 0, duration_ms: 1, green: true, stdout_tail: [], stderr_tail: [] };
    const c = await closeOut(fx.get(), { paused: false, verify }, fx.deps);
    expect(c.error).toStartWith("gh pr ready ");
    expect(c.error).toContain("; gh pr edit ");
    expect(c).toMatchObject({ pr, host_verify: "green", worktree: "kept" });
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "ready", "edit"]);
  });

  test("no verify given (a late close-out, the CLI) on an open PR: `gh pr ready` only, the body never edited", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    const pr = "https://github.com/acme/widget/pull/77";
    fx.gh.answer({ open: [pr] });
    const c = await closeOut(fx.get(), { paused: false }, fx.deps);
    expect(c).toMatchObject({ pr, worktree: "removed" });
    expect(c.error).toBeUndefined();
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "ready"]);
  });

  test("a killed engine whose worktree is gone (no pending record): no leg, no `host-verify` event, its recorded end", async () => {
    const fx = await launchedSbx(RED);
    fx.queue.recordEnginePid(fx.run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    fx.queue.note(fx.run.run_id, "engine-kill", { why: "test", sandbox: "claude-p", worker: { pid: 6509, start: "125610.0", outcome: "killed" } });
    testGit(fx.repo.checkout, "worktree", "remove", "--force", fx.wt);
    expect(existsSync(fx.wt)).toBe(false);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(0);
    expect(fx.argvs.some((a) => a.bin === process.execPath)).toBe(false);
    expect(fx.get().state).toBe("complete");
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ engine: { gone: "its worktree is gone: no engine can run there" } });
    expect((ended.detail!.closeout as Record<string, unknown>).host_verify).toBeUndefined();
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).not.toContain("--draft");
  });

  /** A hanging verify command (prints, then sleeps 60s): the leg trips the run's guard. */
  const HANG = bunCmd("console.error('hung here'); setTimeout(() => {}, 60000)");
  const setGuards = (fx: { queue: Queue; run: { run_id: string }; defn: Record<string, unknown> }, workerGuardS: number | null, defnGuardS: number) =>
    (fx.queue as any).db.query("UPDATE runs SET worker_guard_s = ?, definition = ? WHERE run_id = ?")
      .run(workerGuardS, JSON.stringify({ ...fx.defn, guards: { max_wall_clock_seconds: defnGuardS } }), fx.run.run_id);

  test("the guard: the run's `worker_guard_s` (before the definition's) bounds the leg, the trip named → `partial`", async () => {
    const fx = await launchedSbx(HANG);
    setGuards(fx, 1, 50);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)[0]!.detail).toMatchObject({ green: false, exit: null, guard: "guard: max_wall_clock_seconds (1s)", stderr_tail: ["hung here"] });
    expect(fx.get()).toMatchObject({ state: "partial", reason: `host verify red: \`${HANG}\` timed out (guard: max_wall_clock_seconds (1s)); last lines: hung here` });
  }, 30_000);

  test("the guard: no `worker_guard_s` → the job definition's `guards.max_wall_clock_seconds`", async () => {
    const fx = await launchedSbx(HANG);
    setGuards(fx, null, 1);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)[0]!.detail).toMatchObject({ green: false, exit: null, guard: "guard: max_wall_clock_seconds (1s)" });
    expect(fx.get().state).toBe("partial");
  }, 30_000);

  /** The first sweep's close-out runs, then its transition and its `closed_out` record both fail (a crash's
   * effect): the run is left `running` with a `host-verify` recorded and no pending record. */
  function loseTransitionOnce(fx: { queue: Queue }) {
    const endEngine = fx.queue.endEngine.bind(fx.queue), note = fx.queue.note.bind(fx.queue);
    let fail = true;
    (fx.queue as any).endEngine = (...a: Parameters<typeof endEngine>) => { if (fail) throw new Error("database is locked"); return endEngine(...a); };
    (fx.queue as any).note = (...a: Parameters<typeof note>) => { if (fail && a[1] === "closed_out") { fail = false; throw new Error("database is locked"); } return note(...a); };
  }

  test("a second sweep after a lost close-out (worktree kept) reuses the recorded `host-verify`: the command not re-run, no second event", async () => {
    const fx = await launchedSbx(RED);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    fx.gh.answer({ fail: ["pr create"] }); // the close-out errs: its worktree kept
    loseTransitionOnce(fx);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(hv(fx)).toHaveLength(1);
    expect(existsSync(fx.wt)).toBe(true);
    expect(fx.get().state).toBe("running");
    const spawnsBefore = fx.argvs.filter((a) => a.bin === process.execPath).length;
    expect(spawnsBefore).toBe(1);
    fx.gh.answer({});
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.argvs.filter((a) => a.bin === process.execPath)).toHaveLength(1); // never re-run
    expect(hv(fx)).toHaveLength(1);
    expect(fx.get()).toMatchObject({ state: "partial" });
    expect(fx.get().reason).toStartWith(`host verify red: \`${RED}\` exited 3`);
  });

  test("a recorded red `host-verify` with the worktree since removed: still `partial`, never `worktree gone`, never plain `gh pr ready`", async () => {
    const fx = await launchedSbx(RED);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    loseTransitionOnce(fx);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(existsSync(fx.wt)).toBe(false); // the close-out removed it before its transition was lost
    expect(hv(fx)).toHaveLength(1);
    const pr = "https://github.com/acme/widget/pull/42";
    fx.gh.answer({ open: [pr] }); // the PR the lost close-out opened, adopted
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(1);
    expect(hv(fx)[0]!.detail).toMatchObject({ green: false, exit: 3 });
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toStartWith(`host verify red: \`${RED}\` exited 3`);
    const ready = prCalls(fx).filter((c) => c.argv[1] === "ready");
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.every((c) => c.argv.includes("--undo"))).toBe(true);
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ pr, closeout: { result: "draft PR", host_verify: "red" } });
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("partial");
  });

  test("a pending record replayed by a later sweep never re-runs the leg", async () => {
    const fx = await launchedSbx(RED);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    // The transition fails once (the queue busy): the close-out recorded with its pending end.
    const endEngine = fx.queue.endEngine.bind(fx.queue);
    let fail = true;
    (fx.queue as any).endEngine = (...a: Parameters<typeof endEngine>) => { if (fail) { fail = false; throw new Error("database is locked"); } return endEngine(...a); };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(hv(fx)).toHaveLength(1);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(1);
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toStartWith("host verify red: ");
  });

  const KILL = { why: "test", sandbox: "claude-p", worker: { pid: 6509, start: "125610.0", outcome: "killed" } };
  const TRIP = "guard tripped: max_turns exceeded";

  test("review P1: a killed engine whose status reads ended (it handled TERM): no leg, no `host-verify` event, the launch's recorded end", async () => {
    for (const status of ["stopped", "interrupted"]) {
      const fx = await launchedSbx(RED);
      // The trip's end on the launch's `launched` (as a relaunch after a guard trip records it).
      fx.queue.markLaunched(fx.run.run_id, fx.get().engine_run_id!, { end: { state: "partial", reason: TRIP } });
      fx.queue.recordEnginePid(fx.run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
      fx.queue.note(fx.run.run_id, "engine-kill", { ...KILL, worker: { ...KILL.worker, outcome: status === "stopped" ? "killed" : "not running" } });
      fx.answers.launch = { ok: true, run: { status } };
      expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
      expect(hv(fx)).toHaveLength(0);
      expect(fx.argvs.some((a) => a.bin === process.execPath)).toBe(false);
      expect(fx.get()).toMatchObject({ state: "partial", reason: TRIP });
      const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
      expect(ended.detail).toMatchObject({ engine: { status }, closeout: { result: "PR", worktree: "removed" } });
      expect((ended.detail!.closeout as Record<string, unknown>).host_verify).toBeUndefined();
      expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).not.toContain("--draft");
      expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--reason") + 1]).toBe(TRIP);
    }
  });

  test("review P2: a recorded red `host-verify`, the worktree gone, then an `engine-kill` `not running`: the red reused — `partial`, never plain `gh pr ready`, no second event", async () => {
    const fx = await launchedSbx(RED);
    fx.queue.recordEnginePid(fx.run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    loseTransitionOnce(fx);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(existsSync(fx.wt)).toBe(false);
    expect(hv(fx)).toHaveLength(1);
    fx.queue.note(fx.run.run_id, "engine-kill", { ...KILL, worker: { ...KILL.worker, outcome: "not running" } });
    const pr = "https://github.com/acme/widget/pull/42";
    fx.gh.answer({ open: [pr] }); // the draft the lost close-out opened, adopted
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(1);
    expect(fx.argvs.filter((a) => a.bin === process.execPath)).toHaveLength(1);
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toStartWith(`host verify red: \`${RED}\` exited 3`);
    const ready = prCalls(fx).filter((c) => c.argv[1] === "ready");
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.every((c) => c.argv.includes("--undo"))).toBe(true);
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ pr, closeout: { result: "draft PR", host_verify: "red" } });
  });

  const STOP_VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "j-20261016T101010Z", state: "running" }] } : { state: "cancelled" };
  /** A launched run cancelled while its engine is still live (`closeout: skipped`), its draft PR open. */
  async function cancelledSkipped(recorded?: Record<string, unknown>) {
    const fx = await launchedSbx(RED);
    if (recorded) fx.queue.note(fx.run.run_id, "host-verify", recorded);
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: STOP_VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { result: "skipped" } });
    const pr = "https://github.com/acme/widget/pull/77";
    fx.gh.answer({ open: [pr] });
    fx.answers.engineLive = false;
    return { ...fx, pr };
  }

  test("review P3: the late close-out of a terminal run with a recorded red `host-verify` never marks its draft ready: `--undo` and the body edited; the leg never run", async () => {
    const red = { command: RED, argv: ["x"], cwd: "w", exit: 3, duration_ms: 5, green: false, stdout_tail: [], stderr_tail: ["FAIL win32 path test"] };
    const fx = await cancelledSkipped(red);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(prCalls(fx).map((c) => c.argv.slice(1, 4))).toEqual([
      ["list", "--head", `supervisor/run-${fx.run.run_id}`], ["ready", fx.pr, "--undo"], ["edit", fx.pr, "--body-file"],
    ]);
    expect(prCalls(fx).at(-1)!.body).toContain("FAIL win32 path test");
    expect(hv(fx)).toHaveLength(1);
    expect(fx.argvs.some((a) => a.bin === process.execPath)).toBe(false);
    expect(fx.get().state).toBe("cancelled");
    const closed = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({ pr: fx.pr, closeout: { result: "draft PR", host_verify: "red" } });
  });

  test("review P3: the late close-out of a terminal run with no recorded `host-verify`: as before — `gh pr ready` only, the body never edited", async () => {
    const fx = await cancelledSkipped();
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(prCalls(fx).map((c) => c.argv.slice(1, 3))).toEqual([["list", "--head"], ["ready", fx.pr]]);
    expect(prCalls(fx)[1]!.argv).toEqual(["pr", "ready", fx.pr]);
    expect(hv(fx)).toHaveLength(0);
    expect(fx.get().state).toBe("cancelled");
  });
});

describe("the queue file gains the `paused` state (Story 27.1)", () => {
  test("a runs table whose state CHECK predates `paused` is rebuilt once on open: rows and columns intact, `paused` accepted", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "tk-sup-wt-old-")), "q.db");
    const old = new Database(path, { create: true });
    old.exec(`CREATE TABLE jobs (job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL, project_id TEXT,
        definition TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (job_id, checkout));
      CREATE TABLE runs (run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL,
        project_id TEXT, target TEXT,
        state TEXT NOT NULL CHECK (state IN ('queued','running','complete','partial','blocked','cancelled')),
        reason TEXT, owner_pid INTEGER, owner_host TEXT, owner_nonce TEXT, owner_start TEXT,
        studio_run_id TEXT, engine_run_id TEXT, verb_started TEXT, verb_snapshot TEXT, definition TEXT,
        created TEXT NOT NULL, updated TEXT NOT NULL, FOREIGN KEY (job_id, checkout) REFERENCES jobs (job_id, checkout));
      INSERT INTO jobs VALUES ('j', '/x', '/x', NULL, '{}', 't', 't');
      INSERT INTO runs (run_id, job_id, checkout, root, state, created, updated) VALUES ('q-old', 'j', '/x', '/x', 'running', 't', 't');`);
    old.close();
    for (let i = 0; i < 2; i++) {
      const q = new Queue(path, { ownerAlive: () => false, engineLive: async () => ({ live: false }) });
      try {
        expect((q.db.query("SELECT sql FROM sqlite_master WHERE name = 'runs'").get() as { sql: string }).sql).toContain("'paused'");
        expect(q.get("q-old")).toMatchObject({ state: i === 0 ? "running" : "paused", worktree: null, base_ref_source: null });
        if (i === 0) q.markPaused("q-old", { why: "test" });
        expect(() => q.db.run("INSERT INTO runs (run_id, job_id, checkout, root, state, created, updated) VALUES ('q-bad', 'j', '/x', '/x', 'nope', 't', 't')")).toThrow();
      } finally { q.close(); }
    }
  });
});

describe("never closed out while something may still work the worktree (P3), and the late close-out", () => {
  const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "j-20261016T101010Z", state: "running" }] } : { state: "cancelled" };
  async function launched() {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] };
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete", status_block: BLOCK, finish_deferred: true,
    }, async () => ({}), fx.deps);
    return { ...fx, wt };
  }
  const endedOf = (fx: { queue: Queue; run: { run_id: string } }) => fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;

  test("cancel: the engine still live after the graceful stop → skipped (no push, no PR, the worktree kept); once it is dead the sweep closes it out once (`closed_out`)", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.get().state).toBe("cancelled");
    expect(endedOf(fx).detail).toMatchObject({ closeout: { result: "skipped", why: "the engine stop is not confirmed: the engine is still live", worktree: "kept" } });
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(fx.argvs.some((a) => a.args[0] === "push" || (a.args[0] === "worktree" && a.args[1] === "remove"))).toBe(false);
    expect(existsSync(fx.wt)).toBe(true);
    // Still live: the sweep waits.
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    fx.answers.engineLive = false;
    const updated = fx.get().updated;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const closed = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" } });
    expect(fx.get()).toMatchObject({ state: "cancelled", updated }); // the terminal row never updated
    expect(existsSync(fx.wt)).toBe(false);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // once
    expect(fx.gh.calls().filter((c) => c.argv[1] === "create")).toHaveLength(1);
    expect(fx.queue.takeEndedCloseOut(fx.run.run_id, me)).toBe(false);
  });

  test("cancel: a failed engine stop → skipped", async () => {
    const fx = await launched();
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => { fx.answers.engineLive = false; return { ok: false, detail: "refused" }; }, worktree: fx.deps });
    expect(endedOf(fx).detail).toMatchObject({ closeout: { result: "skipped", why: "the engine stop failed", worktree: "kept" } });
    expect(existsSync(fx.wt)).toBe(true);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]); // the engine is gone: closed out late
    expect(fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "closed_out")).toMatchObject({ detail: { no_changes: true } });
  });

  test("cancel: a recorded worker that may still run → skipped; closed out once it is gone", async () => {
    const fx = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.setWorker(fx.run.run_id, 999_999, "start");
    fx.queue.db.run("UPDATE runs SET owner_pid = NULL, owner_nonce = NULL WHERE run_id = ?", [fx.run.run_id]); // its driver gone
    fx.answers.workerRunning = true;
    const killQueue = fx.queue as unknown as { probes: { killWorker?: unknown } };
    killQueue.probes.killWorker = async (pid: number, start: string | null) => ({ pid, start, outcome: "kill failed", detail: "test" });
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, worktree: fx.deps });
    expect(endedOf(fx).detail).toMatchObject({ closeout: { result: "skipped", why: "its recorded worker may still run (kill failed)", worktree: "kept" } });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // the worker may still run
    fx.answers.workerRunning = false;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(existsSync(wt)).toBe(false);
  });

  test("cancel: a running run whose live driver recorded no worker → skipped (`driverLive`)", async () => {
    const fx = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    // Its driver: another live process (this process's own pid would read as a dead predecessor).
    fx.queue.db.run("UPDATE runs SET owner_pid = 4242, owner_host = 'elsewhere', owner_nonce = 'live-driver' WHERE run_id = ?", [fx.run.run_id]);
    fx.queue.db.run("UPDATE locks SET owner_pid = 4242, owner_host = 'elsewhere', owner_nonce = 'live-driver' WHERE run_id = ?", [fx.run.run_id]);
    const q = fx.queue as unknown as { probes: { ownerAlive: (o: { nonce: string }) => boolean } };
    q.probes.ownerAlive = (o) => o.nonce === me.nonce || o.nonce === "live-driver";
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, worktree: fx.deps });
    expect(endedOf(fx).detail).toMatchObject({ closeout: { result: "skipped", why: "its driver is live", worktree: "kept" } });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // the lock is kept for the live driver
    expect(existsSync(wt)).toBe(true);
  });

  test("cancel: a run another close-out holds → skipped (atomic take, P2)", async () => {
    const fx = await launched();
    fx.answers.engineLive = false;
    fx.queue.db.run("UPDATE runs SET owner_pid = 4243, owner_host = 'elsewhere', owner_nonce = 'other-sweep' WHERE run_id = ?", [fx.run.run_id]);
    const q = fx.queue as unknown as { probes: { ownerAlive: (o: { nonce: string }) => boolean } };
    q.probes.ownerAlive = (o) => o.nonce === me.nonce || o.nonce === "other-sweep";
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(endedOf(fx).detail).toMatchObject({ closeout: { result: "skipped", why: "the run is held by another close-out" } });
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
  });

  test("cancel of a paused run (P1): its draft PR is marked ready, never created again", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: one");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review" } };
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get().state).toBe("paused");
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => { fx.answers.engineLive = false; return { ok: true, detail: "stopping" }; }, worktree: fx.deps });
    expect(endedOf(fx)).toMatchObject({ from_state: "paused", to_state: "cancelled" });
    expect(endedOf(fx).detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" } });
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv.slice(0, 2))).toEqual([["pr", "list"], ["pr", "create"], ["pr", "ready"]]);
    expect(existsSync(fx.wt)).toBe(false);
  });

  test("mirror: `hold_lock` (an sbx worker that may still run) → skipped; the sweep closes it out later", async () => {
    const fx = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const defn = { id: "j", target: { skill: "tk-studio-activate" } };
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "worker: fix");
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn }, { ok: false, job_id: "j", run_id: "j-1", target: "skill", state: "partial", hold_lock: "sbx worker may still run in the VM: 12" }, async () => ({}), fx.deps);
    expect(endedOf(fx).detail).toMatchObject({ closeout: { result: "skipped", why: "its worker may still run: sbx worker may still run in the VM: 12", worktree: "kept" } });
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(existsSync(wt)).toBe(true);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]); // no worker recorded, no engine: closed out
    expect(fx.queue.events(fx.run.run_id).at(-1)).toMatchObject({ kind: "closed_out", detail: { pr: "https://github.com/acme/widget/pull/42" } });
  });

  test("a blocked launch whose probe finds a live orphan engine → skipped; swept once the engine is gone", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn },
      { ok: false, job_id: "j", run_id: "j-1", target: "skill", state: "blocked", reason: "unconfirmed", status_block: { status: "blocked", intent: "tk-studio-launch", artifacts: [] } },
      async () => ({}), fx.deps);
    expect(endedOf(fx).detail).toMatchObject({ closeout: { result: "skipped", why: "an engine may still work the worktree" } });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    fx.answers.engineLive = false;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "closed_out")).toMatchObject({ detail: { no_changes: true, closeout: { worktree: "removed" } } });
    expect(existsSync(wt)).toBe(false);
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull(); // P1 (c): never left probing the removed worktree
  });

  test("P4: a sweep that throws after taking a run lets go of it; the next sweep takes it again", async () => {
    const fx = await launched();
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review" } };
    const real = fx.queue.markPaused.bind(fx.queue);
    let once = true;
    fx.queue.markPaused = (id, d) => { if (once) { once = false; throw new Error("busy"); } return real(id, d); };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.get()).toMatchObject({ state: "running", owner_pid: null, owner_nonce: null });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
  });
});

describe("review patches: enqueue while paused (P5), base_ref spellings (P6), re-materialise (P7), deferred finish fallback (P8)", () => {
  test("P5: a submit while the job's run is paused mints no second run", async () => {
    const fx = await fixture({ baseRef: "main" });
    await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.db.run("UPDATE runs SET engine_run_id = 'E1' WHERE run_id = ?", [fx.run.run_id]);
    fx.queue.markPaused(fx.run.run_id, { why: "test" });
    const again = fx.queue.enqueue({ jobId: "j", root: fx.repo.checkout, definition: fx.defn });
    expect(again).toMatchObject({ minted: false, run: { run_id: fx.run.run_id, state: "paused" } });
    expect(() => fx.queue.db.run("INSERT INTO runs (run_id, job_id, checkout, root, state, created, updated) VALUES ('q-dup', 'j', ?, ?, 'queued', 't', 't')", [fx.run.checkout, fx.run.root])).toThrow();
  });

  test("P5: an existing file's live-run index gains `paused` (dropped and recreated)", () => {
    const path = join(mkdtempSync(join(tmpdir(), "tk-sup-wt-idx-")), "q.db");
    new Queue(path).close();
    const db = new Database(path);
    db.exec("DROP INDEX runs_one_live; CREATE UNIQUE INDEX runs_one_live ON runs (job_id, checkout) WHERE state IN ('queued','running')");
    db.close();
    const q = new Queue(path);
    try { expect((q.db.query("SELECT sql FROM sqlite_master WHERE name = 'runs_one_live'").get() as { sql: string }).sql).toContain("'paused'"); }
    finally { q.close(); }
  });

  test.each(["origin/main", "refs/heads/main"])("P6: base_ref %s is the default branch: the protection refusal still applies", async (ref) => {
    const fx = await fixture({ baseRef: ref });
    fx.gh.answer({ protected: [] });
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps))
      .rejects.toThrow(`worktree protection: base_ref '${ref}' is the repository's default branch and is not protected on GitHub — refused`);
    expect(fx.gh.calls().find((c) => c.argv[0] === "api")!.argv).toEqual(["api", "repos/{owner}/{repo}/branches/main"]);
  });

  test("P6: an `origin/main` base targets `main` in the PR", async () => {
    const fx = await fixture({ baseRef: "origin/main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    await closeOut(fx.get(), { paused: false }, fx.deps);
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!.argv;
    expect(create.slice(2, 4)).toEqual(["--base", "main"]);
  });

  test("P7: a worktree cut but never materialised (a crash mid-materialise) is materialised again before the drive", async () => {
    const fx = await fixture({ baseRef: "main" });
    fx.answers.install = { exit: 1, out: { ok: false, step: "upstream-installer", error: "killed" } };
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps)).rejects.toThrow("worktree install:");
    const cut = fx.get();
    expect(cut.worktree).toBeString();
    expect(fx.queue.events(cut.run_id).some((e) => e.kind === "materialised")).toBe(false);
    fx.answers.install = { exit: 0, out: { ok: true } };
    const before = fx.studio.length;
    expect(await prepareWorktree(fx.queue, cut, "proj", fx.repo.checkout, fx.deps)).toBe(cut.worktree!);
    expect(fx.studio.slice(before).map((c) => c.script.split(/[\\/]/).at(-1))).toEqual(["install_base.py", "drift_check.py"]);
    expect(fx.queue.events(cut.run_id).filter((e) => e.kind === "materialised")).toHaveLength(1);
    // Marked: a further re-drive keeps it as it is.
    const n = fx.studio.length;
    await prepareWorktree(fx.queue, fx.get(), "proj", fx.repo.checkout, fx.deps);
    expect(fx.studio.length).toBe(n);
  });

  test("P8: a deferred finish whose run cannot wait for its engine is finished at once, its outcome on `ended`", async () => {
    const fx = await fixture({ baseRef: "main" });
    await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    const verbs: string[][] = [];
    // A summary with no engine named (nothing to wait for), yet its finish deferred.
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: { id: "j", target: { skill: "tk-studio-activate" } } },
      { ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete", finish_deferred: true },
      async (_r, a) => { verbs.push(a); return { ok: true, state: "complete" }; }, fx.deps);
    expect(verbs.map((v) => v.slice(0, 7))).toEqual([["finish", "--directory", fx.repo.checkout, "--run-id", "j-20261016T101010Z", "--state", "complete"]]);
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ finish: { ok: true } });
  });
});

describe("review pass 2: P1–P9", () => {
  const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "j-20261016T101010Z", state: "running" }] } : { state: "cancelled" };
  const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] };
  async function launched() {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete", status_block: BLOCK, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    return { ...fx, wt };
  }
  /** Every root the queue's engine probe was asked about. */
  function recordProbes(q: Queue): string[] {
    const roots: string[] = [];
    const probes = q.probes as { engineLive: (root: string, id: string | null) => Promise<unknown> };
    const real = probes.engineLive;
    probes.engineLive = (root, id) => { roots.push(root); return real(root, id); };
    return roots;
  }
  /** Another job's run on the same checkout claims it. */
  async function claimable(fx: { queue: Queue; repo: { checkout: string } }) {
    const other = fx.queue.enqueue({ jobId: "k", root: fx.repo.checkout, definition: { id: "k" }, owner: me }).run;
    return fx.queue.claim(other.run_id, me);
  }
  const bodyOf = (fx: { gh: { calls: () => { argv: string[]; body?: string }[] } }) => fx.gh.calls().find((c) => c.argv[1] === "create")!.body!;

  test("P1 (a): mirror, a launch naming no engine — probed before the close-out, the lock released (never re-probed at the removed worktree), the checkout claimable", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    fx.answers.engineLive = false;
    const roots = recordProbes(fx.queue);
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn },
      { ok: false, job_id: "j", run_id: "j-1", target: "skill", state: "blocked", reason: "no engine", status_block: { status: "blocked", intent: "tk-studio-launch", artifacts: [] } },
      async () => ({}), fx.deps);
    expect(existsSync(wt)).toBe(false);
    expect(roots).toEqual([wt]); // once, before the close-out
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ no_changes: true, closeout: { worktree: "removed" }, lock: "released" });
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
    expect(await claimable(fx)).toMatchObject({ claimed: true });
  });

  test("P1 (b): cancel — the engine stopped and confirmed dead, the close-out removes the worktree: the lock released (not handed to the engine), its id kept, the checkout claimable", async () => {
    const fx = await launched();
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => { fx.answers.engineLive = false; return { ok: true, detail: "stopping" }; }, worktree: fx.deps });
    expect(existsSync(fx.wt)).toBe(false);
    expect(fx.get()).toMatchObject({ state: "cancelled", engine_run_id: "E1" });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { worktree: "removed" }, lock: "released" });
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
    expect(await claimable(fx)).toMatchObject({ claimed: true });
  });

  test("P1 (d): an engine lock whose recorded worktree is gone is probed at its run's root, not the missing path: a claim succeeds when no engine is live", async () => {
    const fx = await launched();
    expect(fx.queue.lock(fx.repo.checkout)).toMatchObject({ kind: "engine", root: fx.wt });
    testGit(fx.repo.checkout, "worktree", "remove", "--force", fx.wt); // test-side only: the worktree gone under the lock
    fx.answers.engineLive = false;
    const roots = recordProbes(fx.queue);
    expect(await claimable(fx)).toMatchObject({ claimed: true });
    expect(roots).not.toContain(fx.wt);
    expect(roots).toContain(fx.repo.checkout);
  });

  test("P3: a drive that throws after a launch with a live engine → `closeout: skipped`, the worktree kept; swept once the engine is dead", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    commitIn(wt, "a.txt", "engine: work");
    await endAfterDriveFailure(fx.queue, fx.run.run_id, "drive threw", fx.deps, me);
    expect(fx.get()).toMatchObject({ state: "blocked", reason: "drive threw" });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({
      closeout: { result: "skipped", why: "an engine may still work the worktree (E1)", worktree: "kept" },
    });
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(fx.argvs.some((a) => a.args[0] === "push")).toBe(false);
    expect(existsSync(wt)).toBe(true);
    fx.answers.engineLive = false;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(existsSync(wt)).toBe(false);
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
  });

  test("P3: a drive that throws with its recorded worker still running → skipped; with nothing live → closed out, the lock released", async () => {
    const a = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const wtA = await prepareWorktree(a.queue, a.run, "proj", a.repo.checkout, a.deps);
    a.queue.setWorker(a.run.run_id, 999_999, "start");
    a.answers.workerRunning = true;
    await endAfterDriveFailure(a.queue, a.run.run_id, "drive threw", a.deps, me);
    expect(a.queue.events(a.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { result: "skipped", why: "its recorded worker may still run (running)" } });
    expect(existsSync(wtA)).toBe(true);

    const b = await fixture({ baseRef: "main" });
    const wtB = await prepareWorktree(b.queue, b.run, "proj", b.repo.checkout, b.deps);
    b.queue.markVerbStarted(b.run.run_id, "wake", [], { target: "skill", definition: b.defn });
    b.answers.engineLive = false;
    await endAfterDriveFailure(b.queue, b.run.run_id, "drive threw", b.deps, me);
    expect(b.queue.events(b.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ no_changes: true, closeout: { worktree: "removed" }, lock: "released" });
    expect(existsSync(wtB)).toBe(false);
    expect(await claimable(b)).toMatchObject({ claimed: true });
  });

  test("P4: a launched run whose close-out lease owner died is left by `recover` and closed out by the next sweep", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    // A sweep (or a cancel) took it for its close-out, then died.
    fx.queue.db.run("UPDATE runs SET owner_pid = 4244, owner_host = 'elsewhere', owner_nonce = 'dead-sweep' WHERE run_id = ?", [fx.run.run_id]);
    const touched: string[] = [];
    const report = await fx.queue.recover({
      find: async () => { touched.push("find"); return { ok: true, run_id: null }; },
      end: async () => { touched.push("end"); return { ok: true, detail: "ended" }; },
      resume: async () => { touched.push("resume"); return { resume: false, cause: "test" }; },
    }, me);
    expect(touched).toEqual([]);
    expect([...report.ended.map((r) => r.run_id), ...report.requeued, ...report.resumed.map((r) => r.run_id)]).not.toContain(fx.run.run_id);
    expect(fx.get()).toMatchObject({ state: "running", owner_nonce: "dead-sweep" });
    expect(fx.queue.events(fx.run.run_id).some((e) => e.kind === "orphaned" || e.kind === "recovering")).toBe(false);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("complete");
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", finish: { ok: true } });
  });

  test("P5 (i): a cancel that wins the race mid-sweep — the cancelled run gets one `closed_out` with the PR URL; never a second `gh pr create`; the lock released", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    fx.answers.engineLive = false;
    let raced = false;
    const deps: WorktreeDeps = {
      ...fx.deps,
      run: async (bin, args, o) => {
        if (!raced && args[0] === "worktree" && args[1] === "remove") {
          raced = true; // the cancel lands while the sweep holds the run's close-out
          await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
        }
        return fx.deps.run!(bin, args, o);
      },
    };
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.run.run_id]);
    expect(raced).toBe(true);
    expect(fx.get().state).toBe("cancelled");
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { result: "skipped", why: "the run is held by another close-out" } });
    const closed = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" }, finish: { ok: true } });
    expect(existsSync(fx.wt)).toBe(false);
    // The late close-out never runs it again.
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.gh.calls().filter((c) => c.argv[1] === "create")).toHaveLength(1);
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
    expect(await claimable(fx)).toMatchObject({ claimed: true });
  });

  test("P5 (ii): `endEngine` throws once after the close-out — the next sweep writes `ended` with the PR URL from the record: no second push, PR, finish or probe", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    const real = fx.queue.endEngine.bind(fx.queue);
    let once = true;
    fx.queue.endEngine = (...a) => { if (once) { once = false; throw new Error("SQLITE_BUSY: database is locked"); } return real(...a); };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.get()).toMatchObject({ state: "running", owner_pid: null });
    expect(existsSync(fx.wt)).toBe(false);
    expect(fx.queue.events(fx.run.run_id).at(-1)).toMatchObject({ kind: "closed_out", detail: { pr: "https://github.com/acme/widget/pull/42", pending: { phase: "ended", state: "complete" } } });
    const probes = fx.studio.filter((c) => c.script.endsWith("launch.py")).length;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.studio.filter((c) => c.script.endsWith("launch.py")).length).toBe(probes); // the removed worktree never probed
    expect(fx.get().state).toBe("complete");
    expect(fx.queue.events(fx.run.run_id).at(-1)).toMatchObject({ kind: "ended", detail: { pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" }, lock: "released", finish: { ok: true } } });
    expect(fx.argvs.filter((a) => a.args[0] === "push")).toHaveLength(1);
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv.slice(0, 2))).toEqual([["pr", "list"], ["pr", "create"]]);
    expect(fx.verbs.map((v) => v[0])).toEqual(["finish"]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
  });

  test("P6: cancel's PR body carries the launch status block and the metered cost (the launch worker's)", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: partial work");
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => { fx.answers.engineLive = false; return { ok: true, detail: "stopping" }; }, worktree: fx.deps });
    const body = bodyOf(fx);
    expect(body).toContain("```json\n" + JSON.stringify(BLOCK, null, 2) + "\n```");
    expect(body).toContain("Engine run: E1");
    expect(body).toContain("$0.2500");
  });

  test("P6: the late close-out's PR body carries the launch status block and the metered cost (the engine's run.json)", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    mkdirSync(join(fx.wt, ".bmad-loop", "runs", "E1"), { recursive: true });
    writeFileSync(join(fx.wt, ".bmad-loop", "runs", "E1", "run.json"), JSON.stringify({ total_cost_usd: 1.75 }));
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { result: "skipped" } });
    fx.answers.engineLive = false;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const body = bodyOf(fx);
    expect(body).toContain("```json\n" + JSON.stringify(BLOCK, null, 2) + "\n```");
    expect(body).toContain("$1.7500");
  });

  test("P7: `refs/remotes/origin/<b>` is normalised like `origin/<b>` and `refs/heads/<b>`", async () => {
    expect(["main", "origin/main", "refs/heads/main", "refs/remotes/origin/main"].map(baseBranch)).toEqual(["main", "main", "main", "main"]);
    const fx = await fixture({ baseRef: "refs/remotes/origin/main" });
    fx.gh.answer({ protected: [] });
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps))
      .rejects.toThrow("worktree protection: base_ref 'refs/remotes/origin/main' is the repository's default branch and is not protected on GitHub — refused");
    fx.gh.answer({});
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    await closeOut(fx.get(), { paused: false }, fx.deps);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv.slice(2, 4)).toEqual(["--base", "main"]);
  });

  test("P8: a tag or a commit SHA as base_ref → `blocked` at prepare naming it, no worktree; a branch only on origin is accepted", async () => {
    const fx = await fixture({ baseRef: "v1" });
    testGit(fx.repo.checkout, "tag", "v1");
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps))
      .rejects.toThrow("worktree base_ref: base_ref 'v1' names no branch (neither refs/heads/v1 nor refs/remotes/origin/v1): a PR needs a branch to target");
    const sha = testGit(fx.repo.checkout, "rev-parse", "HEAD");
    const bySha = await fixture({ baseRef: sha });
    await expect(prepareWorktree(bySha.queue, bySha.run, "proj", bySha.repo.checkout, bySha.deps)).rejects.toThrow(`worktree base_ref: base_ref '${sha}' names no branch`);
    for (const f of [fx, bySha]) {
      expect(f.argvs.some((a) => a.args[0] === "worktree")).toBe(false);
      expect(f.get().worktree).toBeNull();
    }
    const remote = await fixture({ baseRef: "origin/rel" });
    testGit(remote.repo.checkout, "push", "-q", "origin", "main:rel");
    testGit(remote.repo.checkout, "fetch", "-q", "origin");
    const wt = await prepareWorktree(remote.queue, remote.run, "proj", remote.repo.checkout, remote.deps);
    expect(existsSync(join(wt, ".git"))).toBe(true);
  });

  test("P9: origin's repository parsed from https and ssh URL forms; anything else leaves gh's default", () => {
    expect(originRepo("https://github.com/acme/widget.git")).toBe("acme/widget");
    expect(originRepo("https://github.com/acme/widget")).toBe("acme/widget");
    expect(originRepo("https://x-access-token:secret@github.com/acme/widget.git\n")).toBe("acme/widget");
    expect(originRepo("git@github.com:acme/widget.git")).toBe("acme/widget");
    expect(originRepo("ssh://git@github.com/acme/widget.git")).toBe("acme/widget");
    expect(originRepo("ssh://git@ssh.github.com:443/acme/widget.git")).toBe("acme/widget");
    expect(originRepo("https://ghe.example.com/acme/widget.git")).toBe("ghe.example.com/acme/widget");
    expect(originRepo("/tmp/origin.git")).toBeUndefined();
    expect(originRepo("C:/repos/origin.git")).toBeUndefined();
    expect(originRepo("git@work-alias:acme/widget.git")).toBeUndefined();
  });

  test("P9: every gh call is pinned to origin's repository (GH_REPO), never an `upstream` remote beside it; a local origin leaves gh's default", async () => {
    const local = await fixture({ baseRef: "main" });
    await prepareWorktree(local.queue, local.run, "proj", local.repo.checkout, local.deps);
    expect(local.gh.calls().map((c) => c.gh_repo)).toEqual([null]);

    const fx = await fixture({ baseRef: "main" });
    testGit(fx.repo.checkout, "remote", "set-url", "origin", "https://github.com/acme/widget.git");
    testGit(fx.repo.checkout, "config", `url.${fx.repo.origin}.pushInsteadOf`, "https://github.com/acme/widget.git"); // pushes stay local
    testGit(fx.repo.checkout, "remote", "add", "upstream", "https://github.com/upstream-org/widget.git");
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    const out = await closeOut(fx.get(), { paused: false }, fx.deps);
    expect(out).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", worktree: "removed" });
    const calls = fx.gh.calls();
    expect(calls.map((c) => c.argv.slice(0, 2).join(" "))).toEqual(["api repos/{owner}/{repo}/branches/main", "pr list", "pr create"]);
    expect(calls.map((c) => c.gh_repo)).toEqual(["acme/widget", "acme/widget", "acme/widget"]);
    expect(calls[0]!.argv).toEqual(["api", "repos/{owner}/{repo}/branches/main"]);
  });
});

describe("review pass 3: P1–P9", () => {
  const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "j-20261016T101010Z", state: "running" }] } : { state: "cancelled" };
  const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] };
  const URL = "https://github.com/acme/widget/pull/42";
  async function launched() {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete", status_block: BLOCK, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    return { ...fx, wt };
  }
  const creates = (fx: { gh: ReturnType<typeof fakeGh> }) => fx.gh.calls().filter((c) => c.argv[0] === "pr" && c.argv[1] === "create");
  /** `queue.note` of `kind` throws once (the record lost: a crash, the file busy). */
  function noteThrowsOnce(q: Queue, kind: string) {
    const real = q.note.bind(q);
    let once = true;
    q.note = ((...a: Parameters<Queue["note"]>) => {
      if (once && a[1] === kind) { once = false; throw new Error("SQLITE_BUSY: database is locked"); }
      return real(...a);
    }) as Queue["note"];
  }

  test("P1: a close-out retried after its PR was opened but never recorded adopts the open PR (`gh pr list --head`): its URL recorded, no second `gh pr create`", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    const branch = runBranch(fx.run.run_id);
    // The first close-out pushed and opened the PR, then died before the removal and before its result was recorded.
    const first = await closeOut(fx.get(), { paused: false }, { ...fx.deps, run: async (bin, args, o) => {
      if (args[0] === "worktree" && args[1] === "remove") throw new Error("killed");
      return fx.deps.run!(bin, args, o);
    } });
    expect(first.pr).toBe(URL);
    expect(existsSync(wt)).toBe(true);
    fx.gh.answer({ open: [URL] }); // GitHub has the open PR from the run branch (gh refuses a second)
    const again = await closeOut(fx.get(), { paused: false }, fx.deps);
    expect(again).toMatchObject({ pr: URL, worktree: "removed" });
    expect(again.error).toBeUndefined();
    expect(closeOutDetail(again)).toMatchObject({ pr: URL, closeout: { result: "PR" } });
    expect(creates(fx)).toHaveLength(1);
    const pr = fx.gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv);
    expect(pr.slice(-2)).toEqual([["pr", "list", "--head", branch, "--state", "open", "--json", "url"], ["pr", "ready", URL]]);
    expect(openPrUrl(JSON.stringify([{ url: `${URL}/files` }]))).toBe(URL);
    expect(openPrUrl("[]")).toBeUndefined();
    expect(openPrUrl("not json")).toBeUndefined();
  });

  test("P1: a paused close-out that finds an open PR adopts it as the draft (not marked ready)", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    fx.gh.answer({ open: [URL] });
    const out = await closeOut(fx.get(), { paused: true }, fx.deps);
    expect(out).toMatchObject({ pr: URL, draft: true, worktree: "kept" });
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv[1])).toEqual(["list"]);
  });

  test("P2 (b): a close-out whose recorded worktree is gone reads the commits and pushes the branch from the checkout; the removal counts as done", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "engine: work");
    testGit(fx.repo.checkout, "worktree", "remove", "--force", wt); // test-side only: the worktree gone under the run
    const branch = runBranch(fx.run.run_id);
    const out = await closeOut(fx.get(), { paused: false, statusBlock: BLOCK, engineRunId: "E1" }, fx.deps);
    expect(out).toMatchObject({ pr: URL, pushed: branch, worktree: "removed" });
    expect(out.error).toBeUndefined();
    expect(out.commits).toHaveLength(1);
    expect(fx.argvs.find((a) => a.args[0] === "log")).toMatchObject({ args: ["log", "--oneline", `main..${branch}`], cwd: fx.repo.checkout });
    expect(fx.argvs.find((a) => a.args[0] === "push")).toEqual({ bin: "git", args: ["push", "origin", branch], cwd: fx.repo.checkout });
    expect(fx.argvs.some((a) => a.args[0] === "worktree" && a.args[1] === "remove")).toBe(false);
    expect(testGit(fx.repo.origin, "rev-parse", `refs/heads/${branch}`)).toBe(testGit(fx.repo.checkout, "rev-parse", branch));
    expect(creates(fx)[0]!.cwd).toBe(fx.repo.checkout);
    expect(fx.head()).toEqual(fx.headBefore);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  });

  test("P2 (a): a late close-out whose `closed_out` note throws lets go of its `closing-out` lease; the next sweep re-takes it and records the PR (adopted, never created twice), the engine lock released", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { result: "skipped" } });
    fx.answers.engineLive = false;
    const updated = fx.get().updated;
    noteThrowsOnce(fx.queue, "closed_out");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(existsSync(fx.wt)).toBe(false); // the close-out ran: pushed, the PR opened, the worktree removed
    expect(creates(fx)).toHaveLength(1);
    const leases = () => fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closing-out").map((e) => (e.detail as { owner: { nonce: string } | null }).owner?.nonce ?? null);
    expect(leases()).toEqual([selfOwner().nonce, null]); // taken, then let go of (appended: the terminal row untouched)
    expect(fx.get()).toMatchObject({ state: "cancelled", updated });
    fx.gh.answer({ open: [URL] }); // the PR the lost record named is open on GitHub
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(leases()).toEqual([selfOwner().nonce, null, selfOwner().nonce]);
    const closed = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({ pr: URL, closeout: { result: "PR", worktree: "removed" } });
    expect(creates(fx)).toHaveLength(1);
    expect(fx.queue.lock(fx.repo.checkout)).toBeNull();
    expect(fx.get()).toMatchObject({ state: "cancelled", updated });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
  });

  test("P2 (a): `releaseCloseOut` lets go of a terminal run's lease only when it is self's, and never after its `closed_out`", async () => {
    const fx = await launched();
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    const other = { pid: 4245, host: "elsewhere", nonce: "other-sweep" };
    const q = fx.queue as unknown as { probes: { ownerAlive: (o: { nonce: string }) => boolean } };
    q.probes.ownerAlive = (o) => o.nonce === me.nonce || o.nonce === other.nonce;
    expect(fx.queue.takeEndedCloseOut(fx.run.run_id, other)).toBe(true);
    const n = fx.queue.events(fx.run.run_id).length;
    fx.queue.releaseCloseOut(fx.run.run_id, me); // not mine: untouched
    expect(fx.queue.events(fx.run.run_id)).toHaveLength(n);
    expect(fx.queue.takeEndedCloseOut(fx.run.run_id, me)).toBe(false);
    fx.queue.releaseCloseOut(fx.run.run_id, other);
    expect(fx.queue.events(fx.run.run_id).at(-1)).toMatchObject({ kind: "closing-out", detail: { owner: null, released: { nonce: other.nonce } } });
    expect(fx.queue.takeEndedCloseOut(fx.run.run_id, me)).toBe(true);
    fx.queue.note(fx.run.run_id, "closed_out", { no_changes: true });
    const m = fx.queue.events(fx.run.run_id).length;
    fx.queue.releaseCloseOut(fx.run.run_id, me);
    expect(fx.queue.events(fx.run.run_id)).toHaveLength(m);
  });

  test("P3: a launched run whose worktree is gone with no pending record (the transition and its record both failed) is closed out and ended with the launch's end, never probed", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: work");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    const real = fx.queue.endEngine.bind(fx.queue);
    let once = true;
    fx.queue.endEngine = (...a) => { if (once) { once = false; throw new Error("SQLITE_BUSY: database is locked"); } return real(...a); };
    noteThrowsOnce(fx.queue, "closed_out");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(existsSync(fx.wt)).toBe(false);
    expect(fx.get()).toMatchObject({ state: "running", owner_pid: null });
    expect(fx.queue.events(fx.run.run_id).some((e) => e.kind === "closed_out")).toBe(false); // no record to complete from
    const probes = fx.studio.filter((c) => c.script.endsWith("launch.py")).length;
    fx.gh.answer({ open: [URL] });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.studio.filter((c) => c.script.endsWith("launch.py")).length).toBe(probes); // never probed at the removed worktree
    expect(fx.get().state).toBe("complete");
    expect(fx.queue.events(fx.run.run_id).at(-1)).toMatchObject({
      kind: "ended", to_state: "complete",
      detail: { pr: URL, closeout: { result: "PR", worktree: "removed" }, engine: { run_id: "E1", gone: "its worktree is gone: no engine can run there" }, lock: "released" },
    });
    expect(creates(fx)).toHaveLength(1);
    expect(fx.queue.pacing("j", fx.repo.checkout, me).live).toEqual([]); // the job's live slot is free
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
  });

  test("P4: the mirror path's PR body carries the engine's metered cost (run.json), not the launch worker's", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    fx.answers.engineLive = false;
    commitIn(wt, "a.txt", "engine: work");
    mkdirSync(join(wt, ".bmad-loop", "runs", "E1"), { recursive: true });
    writeFileSync(join(wt, ".bmad-loop", "runs", "E1", "run.json"), JSON.stringify({ total_cost_usd: 4.5 }));
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn },
      { ok: false, job_id: "j", run_id: "j-1", target: "skill", state: "blocked", reason: "dirty tree", total_cost_usd: 0.25,
        status_block: { status: "blocked", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"], reason: "dirty tree" } },
      async () => ({}), fx.deps);
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ pr: URL, closeout: { result: "PR", worktree: "removed" } });
    const body = creates(fx)[0]!.body!;
    expect(body).toContain("$4.5000");
    expect(body).not.toContain("$0.2500");
  });

  test("P4: no metered run.json → the launch worker's cost", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    fx.answers.engineLive = false;
    commitIn(wt, "a.txt", "engine: work");
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn },
      { ok: false, job_id: "j", run_id: "j-1", target: "skill", state: "blocked", reason: "dirty tree", total_cost_usd: 0.25,
        status_block: { status: "blocked", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"], reason: "dirty tree" } },
      async () => ({}), fx.deps);
    expect(creates(fx)[0]!.body).toContain("$0.2500");
  });

  test("P5: the default-branch check ignores case — `MAIN` meets the protection check of `main` (any filesystem)", async () => {
    expect(isDefaultBranch("MAIN", "main")).toBe(true);
    expect(isDefaultBranch("Main", "main")).toBe(true);
    expect(isDefaultBranch("mainline", "main")).toBe(false);
    const fx = await fixture({ baseRef: "MAIN" });
    fx.gh.answer({ protected: [] });
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps))
      .rejects.toThrow("worktree protection: base_ref 'MAIN' is the repository's default branch and is not protected on GitHub — refused");
    expect(fx.gh.calls().find((c) => c.argv[0] === "api")!.argv).toEqual(["api", "repos/{owner}/{repo}/branches/main"]);
    expect(fx.argvs.some((a) => a.args[0] === "worktree")).toBe(false);
  });

  test("P6: a body past the win32 command-line limit goes through `--body-file`, whole, the file removed afterwards", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    const big = { status: "complete", note: "x".repeat(40_000) };
    const out = await closeOut(fx.get(), { paused: false, statusBlock: big }, fx.deps);
    expect(out.pr).toBe(URL);
    const call = creates(fx)[0]!;
    expect(call.argv.join(" ").length).toBeLessThan(2_000);
    expect(call.body!.length).toBeGreaterThan(40_000);
    expect(call.body).toContain(JSON.stringify(big, null, 2));
    expect(existsSync(call.argv[call.argv.indexOf("--body-file") + 1]!)).toBe(false);
  });

  test("P7: a base branch only in the checkout (no PR base on GitHub) → `blocked` at prepare, no worktree", async () => {
    const fx = await fixture({ baseRef: "loc" });
    testGit(fx.repo.checkout, "branch", "loc");
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps))
      .rejects.toThrow("worktree base_ref: base_ref 'loc' is not on origin (no refs/remotes/origin/loc): its PR would have no base branch on GitHub");
    expect(fx.argvs.some((a) => a.args[0] === "worktree")).toBe(false);
    expect(fx.get().worktree).toBeNull();
  });

  test("P7: a bare base branch only on origin (`rel` with only `origin/rel`) → `blocked` at prepare (the cut cannot resolve it); `origin/rel` is accepted", async () => {
    const fx = await fixture({ baseRef: "rel" });
    testGit(fx.repo.checkout, "push", "-q", "origin", "main:rel");
    testGit(fx.repo.checkout, "fetch", "-q", "origin");
    expect(testGit(fx.repo.checkout, "branch", "--list", "rel")).toBe("");
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps))
      .rejects.toThrow("worktree base_ref: base_ref 'rel' does not resolve to a commit in the checkout: the worktree cannot be cut from it (origin/rel would)");
    expect(fx.argvs.some((a) => a.args[0] === "worktree")).toBe(false);
    expect(fx.get().worktree).toBeNull();
    const ok = await fixture({ baseRef: "origin/rel" });
    testGit(ok.repo.checkout, "push", "-q", "origin", "main:rel");
    const wt = await prepareWorktree(ok.queue, ok.run, "proj", ok.repo.checkout, ok.deps);
    expect(ok.argvs.find((a) => a.args[0] === "worktree")!.args).toEqual(["worktree", "add", "--relative-paths", wt, "-b", runBranch(ok.run.run_id), "origin/rel"]);
  });

  test("P9: cancelling a `queued` run that has a worktree (requeued after its cut) names why it is skipped truly; the sweep then closes it out", async () => {
    const fx = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "worker: fix");
    // As `recover` requeues a run whose driver died before the minting verb: queued, ownerless, its run lock dropped.
    fx.queue.db.run("UPDATE runs SET state = 'queued', owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL WHERE run_id = ?", [fx.run.run_id]);
    fx.queue.db.run("DELETE FROM locks WHERE run_id = ? AND kind = 'run'", [fx.run.run_id]);
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, worktree: fx.deps });
    expect(fx.get().state).toBe("cancelled");
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({
      closeout: { result: "skipped", why: "the run is queued: the engine-end sweep closes it out", worktree: "kept" },
    });
    expect(fx.queue.awaitingEngine().map((r) => r.run_id)).toEqual([fx.run.run_id]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "closed_out")).toMatchObject({ detail: { pr: URL, closeout: { result: "PR", worktree: "removed" } } });
    expect(existsSync(wt)).toBe(false);
  });
});
