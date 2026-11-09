// Story 27.1: every run gets its own worktree and ends in a PR — pinned against a real throwaway
// repository (a bare `origin`) and the fake `gh`; the studio scripts' runner is injected.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { cancelRun, closeOutOrphans, endAfterDriveFailure, finishRun, mirror, resolveCheckout, type Started } from "../src/cli";
import { AUTO_RESUME, closeOutPaused, engineState, harvestMessage, pausedLegs, type PausedDeps } from "../src/closeout";
import { checkoutKey, Queue, selfOwner, servedRoot } from "../src/queue";
import { invokeSkill, runProcess, toVmPath, type RunResult, type Spawner } from "../src/server";
import {
  baseBranch, closeOut, closeOutDetail, COPIED_RUNTIME, engineStatus, isDefaultBranch, launchedCloseOutInput, openPrUrl, originRepo, prBody, prepareWorktree, runBranch, sweepEngines, worktreePath, WorktreeFailed, type WorktreeDeps,
  driftingPlanes, worktreeClean, editPrBody, markPrDraft, markPrReady, proofCommit, proofCommitDue, treeClean, withRunWorktreeRollback,
  commitsAhead, NO_CHANGES_SKIP, noStoryEnd, STAGE_CARRY,
} from "../src/worktree";
import { FRAMES_DIR, legGuard, legVerdict, type HostVerifyResult, type PlayableJudge } from "../src/hostverify";
import { endNotice, noticeText } from "../src/hygiene";
import { supervisorRows } from "../src/planstatus";
import { fakeGh, fakeSbx, FIXTURE_POLICY, gitRepo, LEG_GUARD_ROWS, testGit } from "./fakes";
import { sliceRecorder } from "./helpers/slice";
import { tempDir, track } from "./tmp";

const me = { pid: process.pid, host: hostname(), nonce: "worktree-test" };

/** One fixture: a real repo + bare origin, the fake gh, a work folder, a queue with a claimed run,
 * a recording git/gh runner, and an injected studio-script runner (install, drift, launch status). */
async function fixture(opts: { baseRef?: string; files?: Record<string, string>; skill?: string; nested?: string; policy?: string | false } = {}) {
  const repo = gitRepo(opts.files, opts.policy !== undefined ? { policy: opts.policy } : {});
  const gh = fakeGh();
  const work = tempDir("tk-sup-wt-work-");
  const argvs: { bin: string; args: string[]; cwd: string }[] = [];
  const studio: { script: string; args: string[]; root: string }[] = [];
  const verbs: string[][] = [];
  const answers = {
    install: { exit: 0, out: { ok: true } } as { exit: number; out: unknown }, drift: "clean", launch: { ok: true, run: { status: "running" } } as unknown,
    /** Hole 42: the drift check's answers in order (consumed first), then `drift` for every later call. */
    driftSeq: [] as string[],
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
      if (script.endsWith("drift_check.py")) { const r = answers.driftSeq.shift() ?? answers.drift; return { exit: r === "clean" ? 0 : 1, stdout: JSON.stringify({ ok: true, result: r }), stderr: "" }; }
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
  // Story 28.5: a project nested below the repository's top-level (its lock key and prefix as a submission resolves them).
  const root = opts.nested ? join(repo.checkout, opts.nested) : repo.checkout;
  // Story 38.5 (CAP-14): a nested project's checkout holds its own untracked policy too (the run worktree's is refused without one).
  if (opts.nested && opts.policy !== false) { mkdirSync(join(root, ".bmad-loop"), { recursive: true }); writeFileSync(join(root, ".bmad-loop", "policy.toml"), FIXTURE_POLICY); }
  const where = opts.nested ? await resolveCheckout(root) : {};
  const queued = queue.enqueue({ jobId: "j", root, projectId: "proj", definition: defn, owner: me, ...(opts.baseRef ? { base_ref: opts.baseRef } : {}), ...where }).run;
  const claim = await queue.claim(queued.run_id, me);
  if (!claim.claimed) throw new Error("not claimed");
  const head = () => [testGit(repo.checkout, "rev-parse", "--abbrev-ref", "HEAD"), testGit(repo.checkout, "rev-parse", "HEAD")];
  const headBefore = head();
  return { repo, root, gh, work, argvs, studio, verbs, answers, deps, queue, run: claim.run, defn, head, headBefore, get: () => queue.get(queued.run_id)! };
}

/** No git/gh argv ever forces a push, merges, or switches a branch. The one forced verb is
 * `git worktree remove --force` (hole 34: the engine's untracked runtime), never a push. */
function expectNoForbiddenArgv(argvs: { bin: string; args: string[] }[], ghCalls: { argv: string[] }[]) {
  const all = [...argvs.map((a) => a.args), ...ghCalls.map((c) => c.argv)];
  expect(all.length).toBeGreaterThan(0);
  for (const args of all) {
    const removal = args[0] === "worktree" && args[1] === "remove";
    for (const forbidden of ["--force", "-f", "--force-with-lease", "merge", "checkout", "switch"]) {
      if (removal && forbidden === "--force") continue;
      expect(args).not.toContain(forbidden);
    }
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
  test("materialise: a drift-clean fresh worktree needs no install (hole 42) — the drift check first, policy/routing/overlay copied (files, never links), `tk activate` clean", async () => {
    const fx = await fixture({ baseRef: "main" });
    mkdirSync(join(fx.repo.checkout, ".bmad-loop"), { recursive: true });
    writeFileSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"), "policy = 1\n");
    writeFileSync(join(fx.repo.checkout, ".bmad-loop", "routing.current.json"), "{\"r\":1}\n");
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(fx.studio.map((c) => [c.script.split(/[\\/]/).slice(-4).join("/"), c.args, c.root])).toEqual([
      ["skills/tk-studio-activate/scripts/drift_check.py", ["--directory", wt], wt],
      ["skills/tk-studio-activate/scripts/drift_check.py", ["--directory", wt], wt],
    ]);
    expect(fx.studio[0]!.script).toStartWith(join("/studio-root", "plugins", "tk-studio"));
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "materialised")!.detail).toMatchObject({ path: wt, install: "skipped: drift-clean" });
    for (const rel of [".bmad-loop/policy.toml", ".bmad-loop/routing.current.json"]) {
      expect(lstatSync(join(wt, rel)).isFile()).toBe(true);
      expect(lstatSync(join(wt, rel)).isSymbolicLink()).toBe(false);
    }
    expect(readFileSync(join(wt, ".bmad-loop", "routing.current.json"), "utf-8")).toBe(readFileSync(join(fx.repo.checkout, ".bmad-loop", "routing.current.json"), "utf-8"));
    // Story 37.3 (DW-148): the worktree's policy differs by the engine's rollback alone; the checkout's copy is untouched.
    expect(readFileSync(join(wt, ".bmad-loop", "policy.toml"), "utf-8")).toBe("policy = 1\n\n[scm]\nrollback_on_failure = true\n");
    expect(readFileSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"), "utf-8")).toBe("policy = 1\n");
    expect(existsSync(join(wt, ".tk-studio", "config.local.yaml"))).toBe(false); // absent in the checkout: skipped silently
    expect(fx.head()).toEqual(fx.headBefore);
  });

  test("Story 37.3 (DW-148): the run worktree's policy reads `[scm] rollback_on_failure = true` (TOML-parsed), every other byte equal; the checkout keeps `false`", async () => {
    const fx = await fixture({ baseRef: "main" });
    const POLICY = "[run]\nsession_timeout_min = 90\n\n[scm]\nisolation = \"none\"           # none | worktree\nrollback_on_failure = false  # in-place recovery\npreserve_keep = 20\n\n[other]\nrollback_on_failure = false\n";
    mkdirSync(join(fx.repo.checkout, ".bmad-loop"), { recursive: true });
    writeFileSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"), POLICY);
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    const copy = readFileSync(join(wt, ".bmad-loop", "policy.toml"), "utf-8");
    expect(copy).toBe(POLICY.replace("rollback_on_failure = false  # in-place", "rollback_on_failure = true  # in-place"));
    const parsed = Bun.TOML.parse(copy) as any;
    expect(parsed.scm).toEqual({ isolation: "none", rollback_on_failure: true, preserve_keep: 20 });
    expect(parsed.other.rollback_on_failure).toBe(false); // only the `[scm]` table's key
    expect(readFileSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"), "utf-8")).toBe(POLICY);
    expect(existsSync(join(wt, ".bmad-loop", `policy.toml.tmp-${process.pid}`))).toBe(false);
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "materialised")!.detail).toMatchObject({ copied: [".bmad-loop/policy.toml"] });
  });

  test("Story 37.3: the rollback edit's shapes — the key added under `[scm]`, the table appended, `true` kept as is", () => {
    expect(withRunWorktreeRollback("[scm]\nisolation = \"none\"\n")).toBe("[scm]\nrollback_on_failure = true\nisolation = \"none\"\n");
    expect(withRunWorktreeRollback("a = 1")).toBe("a = 1\n\n[scm]\nrollback_on_failure = true\n");
    expect(withRunWorktreeRollback("")).toBe("[scm]\nrollback_on_failure = true\n"); // no policy: the table alone
    expect(withRunWorktreeRollback("[scm]\nrollback_on_failure = true\n")).toBe("[scm]\nrollback_on_failure = true\n");
    expect(withRunWorktreeRollback("[scm]\r\nrollback_on_failure = false\r\n")).toBe("[scm]\r\nrollback_on_failure = true\r\n");
  });

  test("Story 37.3: a copied policy that does not parse after the edit → `worktree policy` refused by name, the copy restored", async () => {
    const fx = await fixture({ baseRef: "main" });
    const BROKEN = "[scm]\nrollback_on_failure = maybe\n"; // no boolean to replace: the key added twice, which TOML refuses
    mkdirSync(join(fx.repo.checkout, ".bmad-loop"), { recursive: true });
    writeFileSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"), BROKEN);
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps)).rejects.toThrow(/^worktree policy: \.bmad-loop\/policy\.toml rollback_on_failure = true refused \(does not parse: /);
    const wt = worktreePath(fx.work, "proj", fx.run.run_id);
    expect(readFileSync(join(wt, ".bmad-loop", "policy.toml"), "utf-8")).toBe(BROKEN);
  });

  test("Story 38.5 (CAP-14): a checkout with no policy → refused by name (`worktree policy: none in the checkout`), never a stub; nothing written, the run blocked as a prepare step", async () => {
    const fx = await fixture({ baseRef: "main", policy: false });
    expect(existsSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"))).toBe(false);
    const failed = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps).then(() => undefined, (e: unknown) => e);
    expect(failed).toBeInstanceOf(WorktreeFailed);
    expect((failed as WorktreeFailed).message).toBe("worktree policy: none in the checkout");
    const wt = worktreePath(fx.work, "proj", fx.run.run_id);
    expect(existsSync(join(wt, ".bmad-loop", "policy.toml"))).toBe(false);
    expect(existsSync(join(wt, ".bmad-loop", `policy.toml.tmp-${process.pid}`))).toBe(false);
    expect(fx.queue.events(fx.run.run_id).some((e) => e.kind === "materialised")).toBe(false);
    expect(existsSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"))).toBe(false);
  });

  test("Story 38.5 (CAP-14): the four forms — a bare boolean with a comment, a quoted value under `[scm]`, a dotted root key, a one-line inline table — the value replaced, every other byte kept (CRLF too); a parse after reads true", async () => {
    const forms: [string, string, string][] = [
      ["bare", "[run]\nx = 1\n\n[scm]\nrollback_on_failure = false  # in-place recovery\nkeep = 2\n", "[run]\nx = 1\n\n[scm]\nrollback_on_failure = true  # in-place recovery\nkeep = 2\n"],
      ["quoted", "[scm]\r\nisolation = \"none\"\r\nrollback_on_failure = \"false\" # a string\r\n", "[scm]\r\nisolation = \"none\"\r\nrollback_on_failure = true # a string\r\n"],
      ["single-quoted", "[scm]\nrollback_on_failure = 'no'\n", "[scm]\nrollback_on_failure = true\n"],
      ["dotted", "scm.isolation = \"none\"\nscm.rollback_on_failure = false # dotted\n\n[run]\nx = 1\n", "scm.isolation = \"none\"\nscm.rollback_on_failure = true # dotted\n\n[run]\nx = 1\n"],
      ["dotted, key absent", "scm.isolation = \"none\"\r\n[run]\r\nx = 1\r\n", "scm.isolation = \"none\"\r\nscm.rollback_on_failure = true\r\n[run]\r\nx = 1\r\n"],
      ["inline", "scm = { isolation = \"none\", rollback_on_failure = false } # inline\n", "scm = { isolation = \"none\", rollback_on_failure = true } # inline\n"],
      ["inline, key absent", "scm = { isolation = \"none\" }\r\n", "scm = { isolation = \"none\", rollback_on_failure = true }\r\n"],
      ["inline, empty", "scm = {}\n", "scm = { rollback_on_failure = true }\n"],
    ];
    for (const [name, policy, expected] of forms) {
      expect([name, withRunWorktreeRollback(policy)]).toEqual([name, expected]);
      const fx = await fixture({ baseRef: "main", policy });
      const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
      const copy = readFileSync(join(wt, ".bmad-loop", "policy.toml"), "utf-8");
      expect([name, copy]).toEqual([name, expected]);
      expect((Bun.TOML.parse(copy) as any).scm.rollback_on_failure).toBe(true);
      expect(readFileSync(join(fx.repo.checkout, ".bmad-loop", "policy.toml"), "utf-8")).toBe(policy); // the checkout untouched
    }
  });

  test("Story 38.5 (CAP-14): no in-place form (a multi-line inline table, an `[scm.sub]`-only definition) → re-serialised with `Bun.TOML.stringify`, every value kept; already true → no write", async () => {
    for (const policy of ["a = 1\nscm = { isolation = \"none\",\n  rollback_on_failure = false }\n", "a = 1\n\n[scm.sub]\nk = 1\n"]) {
      expect(withRunWorktreeRollback(policy)).toBe(policy); // the line edit answers it unchanged
      const fx = await fixture({ baseRef: "main", policy });
      const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
      const copy = readFileSync(join(wt, ".bmad-loop", "policy.toml"), "utf-8");
      const original = Bun.TOML.parse(policy) as any;
      expect(Bun.TOML.parse(copy)).toEqual({ ...original, scm: { ...original.scm, rollback_on_failure: true } });
      expect(copy).toBe(Bun.TOML.stringify({ ...original, scm: { ...original.scm, rollback_on_failure: true } })!);
    }
    const TRUE = "# kept as is\n[scm]\nrollback_on_failure = true # on\n";
    const fx = await fixture({ baseRef: "main", policy: TRUE });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(readFileSync(join(wt, ".bmad-loop", "policy.toml"), "utf-8")).toBe(TRUE);
  });

  test("Story 38.5 (CAP-14): a form whose value cannot be kept (`scm` not a table) → refused by name, the original kept", async () => {
    const fx = await fixture({ baseRef: "main", policy: "scm = 1\n" });
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps)).rejects.toThrow("worktree policy: .bmad-loop/policy.toml rollback_on_failure = true refused (scm is not a table); the original kept");
    expect(readFileSync(join(worktreePath(fx.work, "proj", fx.run.run_id), ".bmad-loop", "policy.toml"), "utf-8")).toBe("scm = 1\n");
  });

  test("materialise: `tk install` at the pin runs only when the fresh worktree reports drift (hole 42), then `tk activate` clean", async () => {
    const fx = await fixture({ baseRef: "main" });
    fx.answers.driftSeq = ["drift"]; // the fresh worktree drifts; the install brings it to the pin; the final check is clean
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(fx.studio.map((c) => c.script.split(/[\\/]/).at(-1))).toEqual(["drift_check.py", "install_base.py", "drift_check.py"]);
    expect(fx.studio[1]).toMatchObject({ root: wt, args: ["--directory", wt] });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "materialised")!.detail).toMatchObject({ path: wt, install: "ran" });
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
    a.answers.driftSeq = ["drift"]; // the install runs only on drift (hole 42)
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

  test("Story 36.2: a priced sweep's `## Metered cost`: worker + engine = total, one line per bundle, a later cycle named; an unpriced summary keeps the plain figure", () => {
    const bundle = { dw_ids: ["DW-1"], landed: true };
    const sweep = { engine_cost_usd: 3, bundles: [
      { ...bundle, name: "a", cycle: 1, key: "dw-a", cost_usd: 1, source: "metered" },
      { ...bundle, name: "b", cycle: 2, key: "dw2-b", cost_usd: 2, source: "sessions" },
      { ...bundle, name: "c", cycle: 1, key: "dw-c", cost_usd: null },
    ] };
    expect(prBody({ commits: [], runId: "q-1", costUsd: 0.5, sweep })).toContain(
      "## Metered cost\n\n$0.5000 (worker turns) + $3.0000 (engine) = $3.5000\n\n- a: $1.0000 (metered)\n- b (cycle 2): $2.0000 (sessions)\n- c: not metered\n\n## Sweep");
    expect(prBody({ commits: [], runId: "q-1", costUsd: 0.5, sweep: { bundles: [] } })).toContain("## Metered cost\n\n$0.5000 (total_cost_usd)");
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
    // Hole 34: the removal is forced (the engine's untracked runtime); the pushed branch stays local too.
    expect(fx.argvs.find((a) => a.args[0] === "worktree" && a.args[1] === "remove")!.args).toEqual(["worktree", "remove", "--force", wt]);
    expect(out.branch).toBeUndefined();
    expect(testGit(fx.repo.checkout, "rev-parse", "--verify", `refs/heads/supervisor/run-${fx.run.run_id}`)).toMatch(/^[0-9a-f]{40}$/);
  });

  test("no commits: no push, no PR, \"no changes\", the worktree removed with its untracked runtime, the local branch deleted (hole 34)", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    // What the first real run left behind: untracked files no .gitignore covers, which made a plain
    // `git worktree remove` refuse (exit 128, "contains modified or untracked files") and keep the folder.
    mkdirSync(join(wt, ".tk-studio", "runs", "q-1"), { recursive: true });
    writeFileSync(join(wt, ".tk-studio", "runs", "q-1", "run.json"), "{}");
    writeFileSync(join(wt, "scratch.txt"), "left by the engine");
    const branch = `supervisor/run-${fx.run.run_id}`;
    const out = await closeOut(fx.get(), { paused: false, statusBlock: BLOCK, engineRunId: "E1" }, fx.deps);
    expect(out).toEqual({ commits: [], no_changes: true, worktree: "removed", branch: "deleted" });
    expect(fx.argvs.some((a) => a.args[0] === "push")).toBe(false);
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(existsSync(wt)).toBe(false);
    expect(testGit(fx.repo.checkout, "branch", "--list", branch)).toBe("");
    expect(testGit(fx.repo.checkout, "worktree", "list", "--porcelain")).not.toContain(branch);
    expect(fx.head()).toEqual(fx.headBefore);
    // A lost-record close-out of the same run (worktree and branch gone): still "no changes", never an error.
    const again = await closeOut(fx.get(), { paused: false }, fx.deps);
    expect(again).toEqual({ commits: [], no_changes: true, worktree: "removed" });
    expect(fx.argvs.some((a) => a.args[0] === "branch" && a.args[1] === "-D" && a.args[2] === branch && a.cwd === fx.repo.checkout)).toBe(true);
    expect(fx.argvs.filter((a) => a.args[0] === "branch")).toHaveLength(1); // not attempted twice
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
    // Story 38.5 (CAP-13): the engines loop runs no leg for a pause (`pausedLegs` does, after the notice): a draft.
    expect(fx.queue.events(fx.run.run_id).filter((e) => e.kind === "host-verify")).toEqual([]);
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
    // Story 35.1: the close-out's first body carries `Legs: 1 — close-out …` under the heading.
    // Story 38.5 (CAP-13): the pause ran no leg in the engines loop, so the end's leg is the only one.
    expect(fx.gh.calls().at(-1)!.body).toMatch(/## Host verify\n\nLegs: 1 — close-out skipped \S+\n\nSkipped: host-tier run: the worker ran on the host/);
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

  test("cancel of a launched run: the engine stopped, then closed out before the `cancelled` end — pushed, its PR (a draft: Story 38.5, DW-166) on `ended`, the worktree removed", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: partial work");
    const stops: string[][] = [];
    const lines: string[][] = [];
    const verbs = async (_r: string, a: string[]) => { lines.push(a); return a[0] === "status" ? { runs: [{ run_id: "j-20261016T101010Z", state: "running" }] } : { state: "cancelled" }; };
    const ended = await cancelRun(fx.queue, fx.run.run_id, { verbRunner: verbs, launchStop: async (root, id) => { stops.push([root, id]); fx.answers.engineLive = false; return { ok: true, detail: "stopping" }; }, worktree: fx.deps });
    // Story 38.5 (DW-166): the cancel's one job-run line, its cost carried (`cancelCostUsd`).
    expect(lines.filter((a) => a[0] !== "status").map((a) => [a[0], a[a.indexOf("--total-cost-usd") + 1]])).toEqual([["finish", "0.25"]]);
    expect(ended.state).toBe("cancelled");
    expect(stops).toEqual([[fx.wt, "E1"]]);
    const ev = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ev.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "draft PR", worktree: "removed" }, engine_stop: { ok: true } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft"); // Story 38.5 (DW-166): no leg vouches for a cancel
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
  const config = (host?: string, engine?: string) => host === undefined ? "vcs: git\n"
    : `vcs: git\nverify:\n  host: ${JSON.stringify(host)}\n${engine === undefined ? "" : `  engine: ${JSON.stringify(engine)}\n`}`;

  /** A launched sbx run (as the AC3 sweep's `launched()`) whose base config carries `host` (and Story 34.1's
   * `engine`, when given; Story 34.3: `extra` config lines appended); one engine commit. */
  async function launchedSbx(host: string | undefined, tier: "sbx" | "host" = "sbx", engine?: string, extra = "") {
    const fx = await fixture({ baseRef: "main", files: { ".tk-studio/config.yaml": config(host, engine) + extra } });
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

  test("Story 34.1: host green, engine gate red → `partial` naming the engine command, `--draft`, the event's `engine.verdict: red`", async () => {
    const ENGINE = bunCmd("console.log('importing'); console.error('SCRIPT ERROR: res://main.tscn'); process.exit(1)");
    const fx = await launchedSbx(bunCmd("console.log('all green')"), "sbx", ENGINE);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const ev = hv(fx);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toMatchObject({ green: false, exit: 0, stdout_tail: ["all green"], engine: { verdict: "red", exit: 1, command: ENGINE, cwd: fx.wt, stderr_tail: ["SCRIPT ERROR: res://main.tscn"] } });
    const reason = `host verify red (engine): \`${ENGINE}\` exited 1; last lines: SCRIPT ERROR: res://main.tscn`;
    expect(fx.get()).toMatchObject({ state: "partial", reason });
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).toContain("--draft");
    expect(create.body).toContain("Engine gate: red");
    expect(create.body).toContain("SCRIPT ERROR: res://main.tscn");
    expect(prCalls(fx).some((c) => c.argv[1] === "ready")).toBe(false);
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended).toMatchObject({ to_state: "partial" });
    expect(ended.detail).toMatchObject({ reason, closeout: { result: "draft PR", host_verify: "red", worktree: "removed" } });
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("partial");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--reason") + 1]).toBe(reason);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  });

  /** Story 34.3: a launched run declaring `playable`, its sandbox recorded, the store in a temp folder, a fake
   * `playable.py` (the capture spec whose argv runs `playable.py` writes the media under `--out` and passes) and a
   * fake judge answering `answer` at a cost of $0.50 (Story 35.3: `result` its invoke result instead; the core's
   * `playable_judge.py rubric` answered with the five ids). */
  async function launchedPlayable(answer: Record<string, unknown>, result?: Record<string, unknown>) {
    const GREEN = bunCmd("console.log('all green')");
    const fx = await launchedSbx(GREEN, "sbx", GREEN, "playable:\n  scenario: scenarios/smoke.json\n  seed: 3\n  ticks: 60\n");
    // The run's sandbox recorded (the judge's tier); its engine status read through a fake `sbx` (hole 38).
    const sbx = fakeSbx();
    fx.queue.db.run("UPDATE runs SET sandbox = 'tk-sbx' WHERE run_id = ?", [fx.run.run_id]);
    sbx.answer({ launch_status: { ok: true, runs: [{ run_id: "E1", status: "finished" }], live: [], run: { run_id: "E1", status: "finished" } } });
    fx.deps.env = { ...fx.deps.env, SBX_BIN: sbx.bin, TK_STUDIO_HOME: tempDir("tk-sup-pv-store-") };
    const inner = fx.deps.run!;
    const playableArgv: string[][] = [];
    fx.deps.run = async (bin, args, o) => {
      const spec = bin === process.execPath && args[0] === "-e" ? JSON.parse(readFileSync(args[2]!, "utf-8")) : undefined;
      if (spec && String(spec.argv[2] ?? "").endsWith("playable_judge.py") && spec.argv[3] === "rubric") {
        const ids = ["scene-loaded", "player-visible", "no-magenta-or-error-overlay", "hud-reads", "moments-shown"];
        writeFileSync(spec.out, JSON.stringify({ ok: true, ids, rubric: ids.map((id) => ({ id, line: id })), status: "complete", intent: "tk-studio-playable-judge", artifacts: [], reason: null }));
        writeFileSync(spec.status, JSON.stringify({ exit: 0, signal: null }));
        return { exit: 0, stdout: "", stderr: "" };
      }
      if (!spec || !String(spec.argv[2] ?? "").endsWith("playable.py")) return inner(bin, args, o);
      playableArgv.push(spec.argv);
      const out = spec.argv[spec.argv.indexOf("--out") + 1] as string;
      mkdirSync(join(out, "frames"), { recursive: true });
      writeFileSync(join(out, "frames", "tick-000000.png"), "png");
      writeFileSync(join(out, "frames", "tick-000030.png"), "png");
      writeFileSync(join(out, "report.json"), JSON.stringify({ schema: 1, verdict: "pass", failed: null,
        frames: [{ tick: 0, file: "frames/tick-000000.png" }, { tick: 30, file: "frames/tick-000030.png" }], moments: [] }));
      writeFileSync(spec.out, JSON.stringify({ ok: true, verdict: "pass", exit: 0, status: "complete", intent: "playable", artifacts: [], reason: null }));
      writeFileSync(spec.status, JSON.stringify({ exit: 0, signal: null }));
      return { exit: 0, stdout: "", stderr: "" };
    };
    const judged: string[] = [];
    fx.deps.judge = async (root, args) => {
      judged.push(join(root, args.payload.media));
      writeFileSync(join(root, args.payload.media, "judge.json"), JSON.stringify(answer));
      return result ?? { status_block: { status: "complete", intent: "tk-studio-playable-judge", artifacts: ["judge.json"], reason: null }, total_cost_usd: 0.5 };
    };
    fx.deps.route = async () => ({});
    return { ...fx, playableArgv, judged };
  }
  const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

  test("Story 34.3: host and engine green, the judge fails → `partial` red (playable), `--draft` with the findings and the store frame paths, the cost its own line", async () => {
    const findings = [{ frame: "frames/tick-000030.png", rubric: "player-visible", note: "the player is off screen" }];
    const fx = await launchedPlayable({ verdict: "fail", findings });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.playableArgv).toHaveLength(1);
    expect(fx.judged).toHaveLength(1);
    const ev = hv(fx);
    expect(ev).toHaveLength(1);
    const store = flag(fx.playableArgv[0]!, "--out")!;
    expect(ev[0]!.detail).toMatchObject({ green: false, exit: 0, engine: { verdict: "green" },
      playable: { verdict: "fail", findings, store, judge: { status: "complete", verdict: "fail", cost_usd: 0.5, model: "claude-sonnet-5", effort: "medium" } } });
    const reason = "host verify red (playable): player-visible at frames/tick-000030.png: the player is off screen";
    expect(fx.get()).toMatchObject({ state: "partial", reason });
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).toContain("--draft");
    expect(create.body).toContain("Playable: fail");
    expect(create.body).toContain("- `frames/tick-000030.png` — player-visible: the player is off screen");
    expect(create.body).toContain(`- \`${join(store, "frames/tick-000030.png")}\``);
    expect(prCalls(fx).some((c) => c.argv[1] === "ready")).toBe(false);
    const ended = fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!;
    expect(ended).toMatchObject({ to_state: "partial" });
    // The notifier's line (the inbox) is the ended reason: no writer of its own.
    expect(ended.detail).toMatchObject({ reason, closeout: { result: "draft PR", host_verify: "red", worktree: "removed" } });
    expect(fx.verbs).toHaveLength(1);
    expect(flag(fx.verbs[0]!, "--state")).toBe("partial");
    expect(flag(fx.verbs[0]!, "--reason")).toBe(reason);
    expect(flag(fx.verbs[0]!, "--playable-verify-cost-usd")).toBe("0.5");
    expect(flag(fx.verbs[0]!, "--total-cost-usd")).toBe("0.75"); // the engine's $0.25 plus the judge's
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  }, 30_000);

  test("Story 34.3: the judge passes → the PR opens ready with `Playable: pass`, the run as computed, the cost its own line", async () => {
    const fx = await launchedPlayable({ verdict: "pass", findings: [] });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)[0]!.detail).toMatchObject({ green: true, playable: { verdict: "pass", judge: { verdict: "pass", cost_usd: 0.5 } } });
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).not.toContain("--draft");
    expect(create.body).toContain("Playable: pass");
    expect(fx.get()).toMatchObject({ state: "complete" });
    expect(flag(fx.verbs[0]!, "--state")).toBe("complete");
    expect(flag(fx.verbs[0]!, "--playable-verify-cost-usd")).toBe("0.5");
    expect(flag(fx.verbs[0]!, "--total-cost-usd")).toBe("0.75");
  }, 30_000);

  test("Story 35.3: the judge's infrastructure fails (the pin) → `inconclusive`: the run `partial` naming it, no rubric fail, no finding", async () => {
    const pin = "sbx pin failed: sbx run -d --name tk-sbx exited 1: no such sandbox";
    const fx = await launchedPlayable({ verdict: "pass", findings: [] },
      { status_block: { status: "blocked", intent: "tk-studio-playable-judge", artifacts: [], reason: pin }, pin, ran: false });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const reason = `infrastructure: pin: ${pin}`;
    expect(hv(fx)[0]!.detail).toMatchObject({ green: false, playable: { verdict: "inconclusive", reason, judge: { status: "blocked" } } });
    expect((hv(fx)[0]!.detail as any).playable.findings).toBeUndefined();
    expect(fx.get()).toMatchObject({ state: "partial", reason: `host verify inconclusive (playable): ${reason}` });
    expect(flag(fx.verbs[0]!, "--state")).toBe("partial");
    expect(flag(fx.verbs[0]!, "--reason")).toBe(`host verify inconclusive (playable): ${reason}`);
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.body).toContain(`Playable: inconclusive — ${reason}`);
    expect(create.body).not.toContain("Playable: fail");
  }, 30_000);

  test("Story 34.3: an unmetered engine cost → `--total-cost-usd` absent (never zero-filled with the judge's), `--playable-verify-cost-usd` still sent", async () => {
    const fx = await launchedPlayable({ verdict: "pass", findings: [] });
    // The launch worker's cost removed from its `launched` event, and no engine run.json: the engine cost is unmetered.
    (fx.queue as any).db.query("UPDATE events SET detail = json_remove(detail, '$.worker_cost_usd') WHERE run_id = ? AND kind = 'launched'").run(fx.run.run_id);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.judged).toHaveLength(1);
    expect(fx.verbs).toHaveLength(1);
    expect(flag(fx.verbs[0]!, "--playable-verify-cost-usd")).toBe("0.5");
    expect(fx.verbs[0]).not.toContain("--total-cost-usd");
  }, 30_000);

  test("Story 34.3: a project without `playable` → `playable: skipped (no playable)` on the event, no judge, no cost line, the PR as before", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)[0]!.detail).toMatchObject({ green: true, playable: { verdict: "skipped", reason: "no playable" } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).not.toContain("Playable");
    expect(fx.verbs[0]).not.toContain("--playable-verify-cost-usd");
    expect(flag(fx.verbs[0]!, "--total-cost-usd")).toBe("0.25");
  });

  test("red on a paused run's existing draft: the pause's leg red (a draft, `pausedLegs`); at the end the same code head reuses it (Story 38.5), no `gh pr ready`, `gh pr edit <pr> --body-file` with the failures", async () => {
    const fx = await launchedSbx(RED);
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    // Story 38.5 (CAP-13): no leg in the engines loop; the pass runs it for the landed commits, red keeps the draft.
    expect(hv(fx)).toHaveLength(0);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const pr = "https://github.com/acme/widget/pull/42";
    expect(hv(fx).map((e) => [e.detail!.green, e.detail!.paused_leg])).toEqual([[false, { pr, flip: "draft" }]]);
    expect(hv(fx)[0]!.detail!.code_head).toBe(testGit(fx.wt, "rev-parse", "HEAD"));
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)).toHaveLength(1); // Story 38.5: one commit set, one leg — the pause's reused for the end
    expect(fx.get().state).toBe("partial");
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "create", "ready", "edit", "ready", "edit"]);
    expect(prCalls(fx)[2]!.argv).toEqual(["pr", "ready", pr, "--undo"]); // the pass's red flip: a no-op on the draft
    expect(prCalls(fx)[4]!.argv).toEqual(["pr", "ready", pr, "--undo"]); // never marked ready
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
    expect(hv(fx).map((e) => e.detail)).toEqual([{ skipped: true, reason: "no verify.host", code_head: expect.any(String) }]); // Story 38.5: the code head recorded
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).not.toContain("--draft");
    expect(create.body).toContain("Skipped: no verify.host");
    expect(fx.get()).toMatchObject({ state: "complete" });
  });

  test("a host-tier run: skipped `host-tier run: …`, nothing spawned, the PR as before", async () => {
    const fx = await launchedSbx(RED, "host");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail)).toEqual([{ skipped: true, reason: "host-tier run: the worker ran on the host", code_head: expect.any(String) }]); // Story 38.5: the code head recorded
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
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft"); // Story 36.3 (DW-64): no leg vouches for it
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

  test("Story 37.3 (DW-148), Story 38.5 (`pausedLegs`): a dirty paused tree skips the leg (`paused: dirty tree`, the code head), the PR a draft, the uncommitted work left in place", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    writeFileSync(join(fx.wt, "half.txt"), "half-written"); // the attempt's uncommitted work
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "dev", paused_reason: "rollback-manual-required" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    expect(hv(fx)).toHaveLength(0);
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ closeout: { result: "draft PR", worktree: "kept" } });
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused: dirty tree", code_head: testGit(fx.wt, "rev-parse", "HEAD") }]);
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([]); // noted once
    expect(hv(fx)).toHaveLength(1);
    expect(fx.argvs.some((a) => a.bin === process.execPath)).toBe(false); // the leg's command never ran
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "create"]); // the PR stays the pause's draft
    expect(readFileSync(join(fx.wt, "half.txt"), "utf-8")).toBe("half-written");
    expect(testGit(fx.wt, "status", "--porcelain")).toContain("half.txt"); // never committed nor stashed
  });

  test("Story 37.3 (DW-148): a paused tree whose only uncommitted change is under `_bmad-output/` (the engine's protected artifacts) reads clean: the leg runs, the PR ready; a code file reads dirty", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    mkdirSync(join(fx.wt, "_bmad-output", "specs", "spec-epic-1", "stages"), { recursive: true });
    writeFileSync(join(fx.wt, "_bmad-output", "specs", "spec-epic-1", "stages", "1-1-x.jsonl"), "{}\n"); // the paused story's stage buffer
    expect(await treeClean(fx.get(), fx.deps)).toBe(true);
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft"); // Story 38.5: the pause's own close-out
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail!.green)).toEqual([true]);
    expect(prCalls(fx).map((c) => c.argv.slice(1, 3))).toEqual([["list", "--head"], ["create", "--base"], ["ready", "https://github.com/acme/widget/pull/42"], ["edit", "https://github.com/acme/widget/pull/42"]]);
    expect(testGit(fx.wt, "status", "--porcelain")).toContain("_bmad-output/"); // left in place, never committed
    writeFileSync(join(fx.wt, "code.ts"), "half-written");
    expect(await treeClean(fx.get(), fx.deps)).toBe(false);
  });

  test("Story 37.3 (DW-148), Story 38.5: pause 1 green → the PR marked ready by `pausedLegs`; resumed, pause 2 on a new commit and a dirty tree → `gh pr ready --undo` and `gh pr edit`, a draft again, the dirty skip noted by the pass", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).at(-1)!.detail!.paused_leg).toEqual({ pr: "https://github.com/acme/widget/pull/42", flip: "ready" });
    // The engine resumed (`POST /runs/{id}/resume`) and its driver let go; then it pauses again with uncommitted work.
    const launched = fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "launched")!.detail!;
    fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", {});
    fx.queue.note(fx.run.run_id, "launched", launched);
    fx.queue.db.run("UPDATE runs SET owner_pid = NULL, owner_nonce = NULL WHERE run_id = ?", [fx.run.run_id]); // its driver gone
    commitIn(fx.wt, "b.txt", "engine: story two"); // a new code head: the first pause's leg does not vouch for it
    writeFileSync(join(fx.wt, "half.txt"), "half-written");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    const pr = "https://github.com/acme/widget/pull/42";
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "create", "ready", "edit", "ready", "edit"]);
    expect(prCalls(fx)[4]!.argv).toEqual(["pr", "ready", pr, "--undo"]);
    expect(prCalls(fx)[5]!.argv.slice(0, 4)).toEqual(["pr", "edit", pr, "--body-file"]);
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ pr, closeout: { result: "draft PR", worktree: "kept" } });
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail!.reason ?? e.detail!.green)).toEqual([true, "paused: dirty tree"]);
    expect(prCalls(fx)).toHaveLength(6); // the dirty skip flips nothing: the pause's draft stays
  });

  test("green on a paused run: the pause's leg green (`pausedLegs`, Story 38.5) marks the draft ready; at the end the same code head reuses it, `gh pr ready <pr>` then `gh pr edit <pr> --body-file` carrying the green `## Host verify`", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    // Story 38.5 (CAP-13): the pause closes out as a draft with no leg; the pass's green leg marks it ready, the worktree kept.
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ closeout: { result: "draft PR", worktree: "kept" } });
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const pr = "https://github.com/acme/widget/pull/42";
    expect(hv(fx).map((e) => [e.detail!.green, e.detail!.paused_leg])).toEqual([[true, { pr, flip: "ready" }]]);
    expect(prCalls(fx)[3]!.body).toMatch(/## Host verify\n\nLegs: 1 — close-out green \S+\n\nGreen: `/);
    expect(fx.verbs).toEqual([]);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx).map((e) => e.detail!.green)).toEqual([true]); // one commit set, one leg
    expect(prCalls(fx).map((c) => c.argv[1])).toEqual(["list", "create", "ready", "edit", "ready", "edit"]);
    expect(prCalls(fx)[4]!.argv).toEqual(["pr", "ready", pr]);
    const edit = prCalls(fx)[5]!;
    expect(edit.argv.slice(0, 4)).toEqual(["pr", "edit", pr, "--body-file"]);
    expect(edit.body).toMatch(/## Host verify\n\nLegs: 1 — close-out green \S+\n\nGreen: `/);
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

  test("hole 38: an sbx run's engine status is read inside its sandbox (`sbx exec … uv run …/launch.py status --directory <VM worktree> --run-id <id>`), never through the host uv; the end then runs as on the host", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    const sbx = fakeSbx();
    fx.deps.env = { ...fx.deps.env, SBX_BIN: sbx.bin };
    fx.queue.db.run("UPDATE runs SET sandbox = 'claude-p' WHERE run_id = ?", [fx.run.run_id]);
    fx.answers.launch = { ok: false, error: "the host uv must not probe an sbx run's engine" };
    sbx.answer({ launch_status: { ok: true, runs: [{ run_id: "E1", status: "finished" }], live: [], run: { run_id: "E1", status: "finished" } } });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const status = sbx.calls().filter((c) => c.argv[0] === "exec" && c.argv[3] === "run");
    expect(status).toHaveLength(1);
    expect(status[0]!.argv).toEqual(["exec", "claude-p", "uv", "run", "/studio-root/plugins/tk-studio/lib/launch.py", "status", "--directory", toVmPath(fx.wt), "--run-id", "E1"]);
    expect(fx.studio.some((s) => s.script.endsWith("launch.py"))).toBe(false); // never the host's launch core
    expect(fx.get().state).toBe("complete");
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ engine: { status: "finished" }, closeout: { result: "PR", worktree: "removed" } });
    // A VM probe that fails leaves the run alone, named — fail closed, as on the host.
    const fy = await launchedSbx(bunCmd("console.log('all green')"));
    fy.deps.env = { ...fy.deps.env, SBX_BIN: sbx.bin };
    fy.queue.db.run("UPDATE runs SET sandbox = 'claude-p' WHERE run_id = ?", [fy.run.run_id]);
    sbx.answer({ launch_status: "fail" });
    expect(await sweepEngines(fy.queue, fy.deps)).toEqual([]);
    expect(fy.get().state).toBe("running");
  }, 30_000);

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
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft"); // Story 36.3 (DW-64)
  });

  /** A hanging verify command (prints, then sleeps 60s): the leg trips its own guard. */
  const HANG = bunCmd("console.error('hung here'); setTimeout(() => {}, 60000)");
  /** Story 38.1: the run's `worker_guard_s` and its definition snapshot's `guards` (a `LEG_GUARD_ROWS` row). */
  const setGuards = (fx: { queue: Queue; run: { run_id: string }; defn: Record<string, unknown> }, workerGuardS: number | null, guards: Record<string, number>) =>
    (fx.queue as any).db.query("UPDATE runs SET worker_guard_s = ?, definition = ? WHERE run_id = ?")
      .run(workerGuardS, JSON.stringify({ ...fx.defn, guards }), fx.run.run_id);

  // Story 38.1 (AC1): the sweep tail's leg reads `legGuard`, never `worker_guard_s`: the one table's rows.
  for (const row of LEG_GUARD_ROWS) {
    test(`Story 38.1: the sweep tail's guard — ${row.name} → \`${row.trip}\`, red, \`partial\``, async () => {
      const fx = await launchedSbx(HANG);
      setGuards(fx, row.workerGuardS, row.guards);
      fx.answers.launch = { ok: true, run: { status: "finished" } };
      expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
      expect(hv(fx)[0]!.detail).toMatchObject({ green: false, exit: null, guard: row.trip, stderr_tail: ["hung here"] });
      expect(fx.get()).toMatchObject({ state: "partial", reason: `host verify red: \`${HANG}\` timed out (${row.trip}); last lines: hung here` });
    }, 30_000);
  }

  test("Story 38.1 (CAP-3): the close-out notes its `host-verify-leg` lease before the leg, and the leg's `host-verify` closes it", async () => {
    const fx = await launchedSbx(bunCmd("console.log('all green')"));
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const evs = fx.queue.events(fx.run.run_id);
    const lease = evs.findIndex((e) => e.kind === "host-verify-leg");
    expect(lease).toBeGreaterThanOrEqual(0);
    expect(evs[lease]!.detail).toMatchObject({ by: "close-out", owner: { pid: expect.any(Number), host: expect.any(String), nonce: expect.any(String) } });
    expect(evs.findIndex((e) => e.kind === "host-verify")).toBeGreaterThan(lease);
    expect(evs.filter((e) => e.kind === "host-verify-leg")).toHaveLength(1);
    // DW-184: the lease carries the leg's guard and its deadline (the lease plus one guard).
    const g = legGuard(fx.queue.definition(fx.get()));
    const d = evs[lease]!.detail as { guard_s: number; deadline: string };
    expect(d.guard_s).toBe(g.seconds);
    expect(new Date(d.deadline).toISOString()).toBe(d.deadline);
    expect(Math.abs(Date.parse(d.deadline) - (Date.parse(evs[lease]!.at) + g.seconds * 1000))).toBeLessThan(1000);
  });

  test("Story 38.1 (CAP-2): a tail leg ended on the guard with every verdict so far green is `inconclusive (guard)`: `partial`, a draft, Timed out", async () => {
    const GUARDED = bunCmd("console.log('== lib suite: ok in 3s'); setTimeout(() => {}, 60000)");
    const fx = await launchedSbx(GUARDED);
    setGuards(fx, 50, { max_wall_clock_seconds: 50, host_verify_seconds: 1 });
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(hv(fx)[0]!.detail).toMatchObject({ green: false, guard: "guard: host_verify_seconds (1s)", verdicts: ["== lib suite: ok in 3s"], suite_durations: { "lib suite": 3 } });
    const reason = "host verify inconclusive (guard): timed out (guard: host_verify_seconds (1s)) with every verdict so far green; unrun: conformance, supervisor, studio-web";
    expect(fx.get()).toMatchObject({ state: "partial", reason });
    const create = fx.gh.calls().find((c) => c.argv[1] === "create")!;
    expect(create.argv).toContain("--draft");
    expect(create.body).toContain("**Timed out:**");
    expect(create.body).toContain("Durations: lib suite 3s");
    expect(create.body).not.toContain("**Red:**");
    expect(prCalls(fx).some((c) => c.argv[1] === "ready")).toBe(false);
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
      expect(ended.detail).toMatchObject({ engine: { status }, closeout: { result: "draft PR", worktree: "removed" } }); // Story 36.3 (DW-64)
      expect((ended.detail!.closeout as Record<string, unknown>).host_verify).toBeUndefined();
      expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
      expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--reason") + 1]).toBe(TRIP);
    }
  }, 30_000); // two launched-sbx fixtures through real git: past bun's 5 s default on the win32 host (2026-10-16)

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

  test("Story 38.5 (DW-166): the late close-out of a cancelled run with no recorded `host-verify` never marks its PR ready: `--undo` and the body edited; `closed_out` carries `draft PR` and the PR; no `job-run` line of its own", async () => {
    const fx = await cancelledSkipped();
    const finishes = fx.verbs.length;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(prCalls(fx).map((c) => c.argv.slice(1, 4))).toEqual([["list", "--head", `supervisor/run-${fx.run.run_id}`], ["ready", fx.pr, "--undo"], ["edit", fx.pr, "--body-file"]]);
    expect(hv(fx)).toHaveLength(0);
    expect(fx.get().state).toBe("cancelled");
    const closed = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({ pr: fx.pr, closeout: { result: "draft PR" } });
    expect(fx.verbs).toHaveLength(finishes); // the cancel's own `finish` is the run's one job-run line
  });
  /** Story 38.5 (DW-166): a launch run (engine E1 named by its status block, no `launched`) ended `complete` with its close-out
   * skipped (`hold_lock`), the `host-verify` records given seeded first: the late close-out reads them by the position rule. */
  async function completeSkipped(...records: Record<string, unknown>[]) {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    commitIn(wt, "a.txt", "engine: work");
    for (const r of records) fx.queue.note(fx.run.run_id, "host-verify", r);
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, { ok: true, job_id: "j", run_id: "j-1", target: "skill", state: "complete",
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, hold_lock: "sbx worker may still run in the VM: 12" }, async () => ({}), fx.deps);
    expect(fx.get()).toMatchObject({ state: "complete", engine_run_id: "E1" });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { result: "skipped" } });
    fx.answers.engineLive = false;
    return fx;
  }
  const lateCreate = (fx: { gh: ReturnType<typeof fakeGh> }) => fx.gh.calls().find((c) => c.argv[0] === "pr" && c.argv[1] === "create")!;

  test("Story 38.5 (DW-166): the late close-out of a `complete` run whose latest record is a `paused: dirty tree` skip never opens the PR ready (a draft); the stage row reads `draft PR`", async () => {
    const fx = await completeSkipped({ skipped: true, reason: "paused: dirty tree", code_head: "abc1234" });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(lateCreate(fx).argv).toContain("--draft");
    const closed = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "draft PR" } });
    // the derived records: the stage pass's `close-out` row and the PR the plan-status review pass reads (`closed_out.detail.pr`)
    expect(supervisorRows(fx.queue.events(fx.run.run_id)).filter((r) => r.stage === "close-out").map((r) => r.outcome)).toEqual(["skipped", "draft PR"]); // the end's skipped record, then the late close-out's
    expect(fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "closed_out")!.detail!.pr).toBe("https://github.com/acme/widget/pull/42");
  });

  test("Story 38.5 (DW-166): a paused-sweep skip never vouches; a recorded green leg or a by-design skip does — the late close-out of a `complete` run opens the PR ready", async () => {
    const sweepSkip = await completeSkipped({ skipped: true, reason: "paused sweep: WIP committed, leg skipped" });
    expect(await sweepEngines(sweepSkip.queue, sweepSkip.deps)).toEqual([sweepSkip.run.run_id]);
    expect(lateCreate(sweepSkip).argv).toContain("--draft");
    for (const leg of [
      { command: "c", argv: ["c"], cwd: "w", exit: 0, duration_ms: 1, green: true, stdout_tail: [], stderr_tail: [] },
      { skipped: true, reason: "no verify.host" },
      { skipped: true, reason: "host-tier run: the worker ran on the host" },
    ]) {
      const fx = await completeSkipped(leg);
      expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
      expect(lateCreate(fx).argv).not.toContain("--draft");
      expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "closed_out")!.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR" } });
    }
  });

  test("Story 38.5 (DW-166): the late close-out of a `complete` run that launched no engine (a skill run) opens its PR ready", async () => {
    const fx = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const defn = { id: "j", target: { skill: "tk-studio-activate" } };
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "worker: fix");
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn }, { ok: true, job_id: "j", run_id: "j-1", target: "skill", state: "complete", hold_lock: "sbx worker may still run in the VM: 12" }, async () => ({}), fx.deps);
    expect(fx.get().state).toBe("complete");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.queue.events(fx.run.run_id).at(-1)).toMatchObject({ kind: "closed_out", detail: { pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR" } } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).not.toContain("--draft");
  });
});

describe("the queue file gains the `paused` state (Story 27.1)", () => {
  test("a runs table whose state CHECK predates `paused` is rebuilt once on open: rows and columns intact, `paused` accepted", async () => {
    const path = join(tempDir("tk-sup-wt-old-"), "q.db");
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
      const q = track(new Queue(path, { ownerAlive: () => false, engineLive: async () => ({ live: false }) }));
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
    // Story 38.5 (DW-166): a cancel's late close-out has no leg to vouch for it: a draft.
    expect(closed[0]!.detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "draft PR", worktree: "removed" } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
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

  test("cancel of a paused run (P1): its draft PR stays a draft (Story 38.5, DW-166: `--undo`, the body edited), never created again", async () => {
    const fx = await launched();
    commitIn(fx.wt, "a.txt", "engine: one");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review" } };
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get().state).toBe("paused");
    await cancelRun(fx.queue, fx.run.run_id, { verbRunner: VERBS, launchStop: async () => { fx.answers.engineLive = false; return { ok: true, detail: "stopping" }; }, worktree: fx.deps });
    expect(endedOf(fx)).toMatchObject({ from_state: "paused", to_state: "cancelled" });
    expect(endedOf(fx).detail).toMatchObject({ pr: "https://github.com/acme/widget/pull/42", closeout: { result: "draft PR", worktree: "removed" } });
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv.slice(0, 2))).toEqual([["pr", "list"], ["pr", "create"], ["pr", "ready"], ["pr", "edit"]]);
    expect(fx.gh.calls().find((c) => c.argv[1] === "ready")!.argv).toContain("--undo");
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
    const path = join(tempDir("tk-sup-wt-idx-"), "q.db");
    track(new Queue(path)).close();
    const db = new Database(path);
    db.exec("DROP INDEX runs_one_live; CREATE UNIQUE INDEX runs_one_live ON runs (job_id, checkout) WHERE state IN ('queued','running')");
    db.close();
    const q = track(new Queue(path));
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
    fx.answers.driftSeq = ["drift"]; // the install runs only on drift (hole 42)
    fx.answers.install = { exit: 1, out: { ok: false, step: "upstream-installer", error: "killed" } };
    await expect(prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps)).rejects.toThrow("worktree install:");
    const cut = fx.get();
    expect(cut.worktree).toBeString();
    expect(fx.queue.events(cut.run_id).some((e) => e.kind === "materialised")).toBe(false);
    fx.answers.install = { exit: 0, out: { ok: true } };
    fx.answers.driftSeq = ["drift"];
    const before = fx.studio.length;
    expect(await prepareWorktree(fx.queue, cut, "proj", fx.repo.checkout, fx.deps)).toBe(cut.worktree!);
    expect(fx.studio.slice(before).map((c) => c.script.split(/[\\/]/).at(-1))).toEqual(["drift_check.py", "install_base.py", "drift_check.py"]);
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
    // Story 37.3 (DW-148): no green leg vouches for the pause: `gh pr ready --undo` (a no-op on a draft), the body regenerated.
    const pr = fx.gh.calls().filter((c) => c.argv[0] === "pr");
    expect(pr.map((c) => c.argv[1])).toEqual(["list", "ready", "edit"]);
    expect(pr[1]!.argv).toEqual(["pr", "ready", URL, "--undo"]);
  });

  test("Story 37.3 (DW-148): a pause whose leg ran green on an already-open draft PR: `gh pr ready` then `gh pr edit` (never `--undo`)", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    const out = await closeOut(fx.get(), { paused: true, existingPr: URL, verify: { command: "x", argv: ["x"], cwd: wt, exit: 0, duration_ms: 1, green: true, stdout_tail: [], stderr_tail: [] } }, fx.deps);
    expect(out).toMatchObject({ pr: URL, worktree: "kept", host_verify: "green" });
    expect(out.draft).toBeUndefined();
    expect(out.error).toBeUndefined();
    const pr = fx.gh.calls().filter((c) => c.argv[0] === "pr");
    expect(pr.map((c) => c.argv[1])).toEqual(["ready", "edit"]);
    expect(pr[0]!.argv).toEqual(["pr", "ready", URL]);
    expect(pr[1]!.argv.slice(0, 4)).toEqual(["pr", "edit", URL, "--body-file"]);
  });

  test("Story 37.3 (DW-148): a PR an earlier green pause made ready, paused again non-green (dirty skip, red): returned to a draft (`gh pr ready --undo`), its body regenerated; `draft` only when the undo answers", async () => {
    for (const kind of ["dirty", "red"] as const) {
      const fx = await fixture({ baseRef: "main" });
      const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
      commitIn(wt, "a.txt", "work");
      const verify: HostVerifyResult = kind === "dirty" ? { skipped: true, reason: "paused: dirty tree" }
        : { command: "x", argv: ["x"], cwd: wt, exit: 1, duration_ms: 1, green: false, stdout_tail: [], stderr_tail: ["1 failing"] };
      const out = await closeOut(fx.get(), { paused: true, existingPr: URL, verify }, fx.deps);
      expect(out).toMatchObject({ pr: URL, draft: true, worktree: "kept" });
      expect(out.error).toBeUndefined();
      const pr = fx.gh.calls().filter((c) => c.argv[0] === "pr");
      expect(pr.map((c) => c.argv[1])).toEqual(["ready", "edit"]);
      expect(pr[0]!.argv).toEqual(["pr", "ready", URL, "--undo"]);
      expect(pr[1]!.argv.slice(0, 4)).toEqual(["pr", "edit", URL, "--body-file"]);
    }
    // The undo refused: never recorded a draft, the failure named (the body still regenerated).
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "work");
    fx.gh.answer({ fail: ["pr ready"] });
    const out = await closeOut(fx.get(), { paused: true, existingPr: URL, verify: { skipped: true, reason: "paused: dirty tree" } }, fx.deps);
    expect(out.draft).toBeUndefined();
    expect(out.error).toMatch(/^gh pr ready --undo /);
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv[1])).toEqual(["ready", "edit"]);
  });

  test("Story 37.3 (DW-148): a paused close-out on an existing PR with an inconclusive leg, or a killed engine: `gh pr ready --undo`, `draft`, the body regenerated", async () => {
    const inconclusive: HostVerifyResult = { command: "c", argv: ["c"], cwd: "/w", exit: 0, duration_ms: 1, green: false, stdout_tail: [], stderr_tail: [],
      engine: { verdict: "green", command: "e", duration_ms: 1, godot_dir: null },
      playable: { verdict: "inconclusive", reason: "infrastructure: sbx: exec failed" } };
    for (const kind of ["inconclusive", "killed"] as const) {
      const fx = await fixture({ baseRef: "main" });
      const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
      commitIn(wt, "a.txt", "work");
      const out = await closeOut(fx.get(), kind === "inconclusive" ? { paused: true, existingPr: URL, verify: inconclusive } : { paused: true, existingPr: URL, killed: true }, fx.deps);
      expect(out).toMatchObject({ pr: URL, draft: true, worktree: "kept" });
      expect(out.error).toBeUndefined();
      const pr = fx.gh.calls().filter((c) => c.argv[0] === "pr");
      expect(pr.map((c) => c.argv[1])).toEqual(["ready", "edit"]);
      expect(pr[0]!.argv).toEqual(["pr", "ready", URL, "--undo"]);
      expect(pr[1]!.argv.slice(0, 4)).toEqual(["pr", "edit", URL, "--body-file"]);
    }
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
    expect(closed[0]!.detail).toMatchObject({ pr: URL, closeout: { result: "draft PR", worktree: "removed" } }); // Story 38.5 (DW-166): a cancel's, a draft
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
    // Story 38.5 (DW-166): a `blocked` end that launched an engine has no leg vouching for it: a draft.
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ pr: URL, closeout: { result: "draft PR", worktree: "removed" } });
    expect(creates(fx)[0]!.argv).toContain("--draft");
    const body = creates(fx)[0]!.body!;
    expect(body).toContain("$4.5000");
    expect(body).not.toContain("$0.2500");
  });

  test("Story 38.5 (DW-166): the run's end (`closeOutNow`) opens a PR ready only on a `complete` end of a run that launched no engine; a `complete` launch run's PR is a draft; its own `finish` the one job-run line", async () => {
    // A skill run (no engine, no leg by design) ending `complete`: ready.
    const skill = await fixture({ baseRef: "main", skill: "tk-studio-activate" });
    const sdefn = { id: "j", target: { skill: "tk-studio-activate" } };
    const swt = await prepareWorktree(skill.queue, skill.run, "proj", skill.repo.checkout, skill.deps);
    skill.queue.markVerbStarted(skill.run.run_id, "wake", [], { target: "skill", definition: sdefn });
    commitIn(swt, "a.txt", "worker: fix");
    await mirror(skill.queue, skill.run.run_id, { jobId: "j", defn: sdefn },
      { ok: true, job_id: "j", run_id: "j-1", target: "skill", state: "complete", status_block: { status: "complete", intent: "tk-studio-activate", artifacts: [] } },
      async () => ({}), skill.deps);
    expect(skill.get().state).toBe("complete");
    expect(skill.queue.events(skill.run.run_id).at(-1)!.detail).toMatchObject({ pr: URL, closeout: { result: "PR", worktree: "removed" } });
    expect(creates(skill)[0]!.argv).not.toContain("--draft");
    // A launch run whose engine the status block names, ending `complete` with no deferred finish: no leg vouches, a draft.
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    fx.answers.engineLive = false;
    commitIn(wt, "a.txt", "engine: work");
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn },
      { ok: true, job_id: "j", run_id: "j-1", target: "skill", state: "complete", total_cost_usd: 0.25,
        status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] } },
      async () => ({}), fx.deps);
    expect(fx.get().state).toBe("complete");
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ pr: URL, closeout: { result: "draft PR", worktree: "removed" } });
    expect(creates(fx)[0]!.argv).toContain("--draft");
    expect(fx.verbs).toEqual([]); // no second job-run line: the run's own `finish` (the worker's) is its one
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
    expect(fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "closed_out")).toMatchObject({ detail: { pr: URL, closeout: { result: "draft PR", worktree: "removed" } } }); // Story 38.5 (DW-166)
    expect(existsSync(wt)).toBe(false);
  });
});

// ---------------------------------------------------------------- Story 27.5

describe("Story 27.5: the orphan close-out (DW-25)", () => {
  test("a worktree run `recover` orphaned is closed out once nothing around it is live: pushed, its PR on `closed_out`, no host verify leg, its pin released — once", async () => {
    const fx = await fixture();
    const sbx = fakeSbx();
    fx.deps.env = { ...fx.deps.env, SBX_BIN: sbx.bin };
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.db.run("UPDATE runs SET tier = 'sbx', sandbox = 'sb' WHERE run_id = ?", [fx.run.run_id]);
    fx.queue.note(fx.run.run_id, "pinned", { sandbox: "sb" });
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    fx.queue.setStudioRun(fx.run.run_id, "j-20261016T101010Z");
    commitIn(wt, "a.txt", "the work a dead driver left");
    // The driver dies: `recover` (another process) orphans the run — no engine live then.
    fx.queue.db.run("UPDATE runs SET owner_nonce = 'dead-driver', owner_pid = 999999 WHERE run_id = ?", [fx.run.run_id]);
    fx.queue.db.run("UPDATE locks SET owner_nonce = 'dead-driver', owner_pid = 999999");
    fx.answers.engineLive = false;
    const report = await fx.queue.recover({ end: async () => ({ ok: true, detail: "ended", state: "partial" }), find: async () => ({ ok: true, run_id: null }) }, me);
    expect(report.ended.map((e) => e.run_id)).toEqual([fx.run.run_id]);
    expect(fx.queue.orphanedCloseOuts().map((r) => r.run_id)).toEqual([fx.run.run_id]);

    // An engine in its worktree may still work it: nothing yet.
    fx.answers.engineLive = true;
    expect(await closeOutOrphans(fx.queue, fx.deps)).toEqual([]);
    expect(fx.queue.events(fx.run.run_id).some((e) => e.kind === "closing-out" || e.kind === "closed_out")).toBe(false);
    expect(existsSync(wt)).toBe(true);

    // Confirmed dead: closed out, the PR recorded, the worktree removed, the pin released; never the host verify leg.
    fx.answers.engineLive = false;
    expect(await closeOutOrphans(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const evs = fx.queue.events(fx.run.run_id);
    expect(evs.find((e) => e.kind === "closed_out")!.detail).toMatchObject({ orphaned: true, pr: "https://github.com/acme/widget/pull/42", closeout: { result: "PR", worktree: "removed" } });
    expect(evs.some((e) => e.kind === "host-verify")).toBe(false);
    expect(fx.studio.some((s) => /verify/.test(s.script))).toBe(false);
    expect(evs.find((e) => e.kind === "pin-released")!.detail).toMatchObject({ sandbox: "sb", stop: { ok: true } });
    expect(sbx.calls().map((c) => c.argv)).toContainEqual(["stop", "sb"]);
    expect(existsSync(wt)).toBe(false);
    expect(fx.get().state).toBe("partial");
    expect(testGit(fx.repo.origin, "rev-parse", `refs/heads/supervisor/run-${fx.run.run_id}`)).toMatch(/^[0-9a-f]{40}$/);
    // Once: never closed out again.
    expect(await closeOutOrphans(fx.queue, fx.deps)).toEqual([]);
    expect(fx.queue.orphanedCloseOuts()).toEqual([]);
    expect(fx.gh.calls().filter((c) => c.argv[1] === "create")).toHaveLength(1);
    expectNoForbiddenArgv(fx.argvs, fx.gh.calls());
  }, 60_000);
});

describe("Story 28.5 (DW-25): a project below its git top-level is served at <worktree>/<prefix>", () => {
  const NESTED = "apps/sup";
  const nestedFiles = (extra: Record<string, string> = {}) => ({ [`${NESTED}/.tk-studio/config.yaml`]: "project_id: sup\n", ...extra });

  test("nested: the worktree is cut at the repository's top, the run serves <wt>/<prefix> (install, drift and the copied runtime there)", async () => {
    const fx = await fixture({ baseRef: "main", nested: NESTED, files: nestedFiles() });
    expect(fx.run).toMatchObject({ prefix: `${NESTED}/`, checkout: checkoutKey(fx.root), lock_checkout: checkoutKey(fx.repo.checkout) });
    mkdirSync(join(fx.root, ".bmad-loop"), { recursive: true });
    writeFileSync(join(fx.root, ".bmad-loop", "policy.toml"), "nested = true\n");
    fx.answers.driftSeq = ["drift"]; // the install runs only on drift (hole 42): pin it at the served root
    const served = await prepareWorktree(fx.queue, fx.run, "proj", fx.root, fx.deps);
    const wt = worktreePath(fx.work, "proj", fx.run.run_id);
    expect(served).toBe(join(wt, NESTED));
    // The worktree is the whole repository (its top recorded on the run for the git motions).
    expect(fx.get().worktree).toBe(wt);
    expect(existsSync(join(wt, ".git"))).toBe(true);
    expect(existsSync(join(served, ".tk-studio", "config.yaml"))).toBe(true);
    expect(fx.argvs.find((a) => a.args[0] === "worktree")!.args).toEqual(["worktree", "add", "--relative-paths", wt, "-b", runBranch(fx.run.run_id), "main"]);
    // `install_base.py --directory` and the drift check at the served root, never the top.
    const install = fx.studio.find((s) => s.script.endsWith("install_base.py"))!;
    expect(install).toMatchObject({ root: served, args: ["--directory", served] });
    expect(fx.studio.find((s) => s.script.endsWith("drift_check.py"))).toMatchObject({ root: served, args: ["--directory", served] });
    // The copied runtime from the project root lands under the served root.
    expect(readFileSync(join(served, ".bmad-loop", "policy.toml"), "utf-8")).toBe("nested = true\n\n[scm]\nrollback_on_failure = true\n"); // Story 37.3: the rollback on
    expect(existsSync(join(wt, ".bmad-loop", "policy.toml"))).toBe(false);
    // Once per queue run: a resumed or adopted run answers the served root again.
    expect(await prepareWorktree(fx.queue, fx.get(), "proj", fx.root, fx.deps)).toBe(served);
  });

  test("top-level: prefix \"\" — the run serves the worktree itself (unchanged)", async () => {
    const fx = await fixture({ baseRef: "main" });
    const where = await resolveCheckout(fx.repo.checkout);
    expect(where).toEqual({ lockCheckout: checkoutKey(fx.repo.checkout), prefix: "" });
    const top = fx.queue.enqueue({ jobId: "t", root: fx.repo.checkout, projectId: "proj", definition: { id: "t" }, owner: me, base_ref: "main", ...where }).run;
    expect(top).toMatchObject({ prefix: "", lock_checkout: checkoutKey(fx.repo.checkout) });
    fx.answers.driftSeq = ["drift"]; // the install runs only on drift (hole 42)
    const served = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    expect(served).toBe(worktreePath(fx.work, "proj", fx.run.run_id));
    expect(fx.studio.find((s) => s.script.endsWith("install_base.py"))).toMatchObject({ root: served, args: ["--directory", served] });
  });

  /** A launched nested run (as the AC3 sweep's `launched()`): served root prepared, engine E1, `launched` written. */
  async function launchedNested(files: Record<string, string> = {}) {
    const fx = await fixture({ baseRef: "main", nested: NESTED, files: nestedFiles(files) });
    mkdirSync(join(fx.root, ".bmad-loop"), { recursive: true });
    writeFileSync(join(fx.root, ".bmad-loop", "policy.toml"), "nested = true\n");
    fx.answers.driftSeq = ["drift"]; // the install runs only on drift (hole 42): pin it at the served root
    const served = await prepareWorktree(fx.queue, fx.run, "proj", fx.root, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: true, job_id: "j", run_id: "j-20261017T101010Z", target: "skill", state: "complete",
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    return { ...fx, served, wt: worktreePath(fx.work, "proj", fx.run.run_id) };
  }

  test("the engine-end sweep reads <wt>/<prefix>/.bmad-loop (status, metered cost), commits without the nested engine state", async () => {
    const fx = await launchedNested();
    // The engine lock is probed at the served root; the lock row keyed by the git checkout.
    expect(fx.queue.lock(fx.get())).toMatchObject({ kind: "engine", engine_run_id: "E1", root: fx.served, checkout: checkoutKey(fx.repo.checkout) });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.studio.at(-1)).toMatchObject({ args: ["status", "--directory", fx.served, "--run-id", "E1"], root: fx.served });
    // The engine's run.json under the served root is the metered cost (never an outer `.bmad-loop`).
    mkdirSync(join(fx.served, ".bmad-loop", "runs", "E1"), { recursive: true });
    writeFileSync(join(fx.served, ".bmad-loop", "runs", "E1", "run.json"), JSON.stringify({ total_cost_usd: 1.5 }));
    expect(launchedCloseOutInput(fx.queue.events(fx.run.run_id), fx.get())).toMatchObject({ engineRunId: "E1", costUsd: 1.5 });
    commitIn(fx.served, "a.txt", "engine: story one");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get()).toMatchObject({ state: "complete" });
    expect(fx.verbs[0]).toContain("1.5");
    // Pushed from the worktree top: the engine's work, never its nested runtime state.
    const files = testGit(fx.repo.origin, "ls-tree", "-r", "--name-only", `refs/heads/${runBranch(fx.run.run_id)}`).split("\n");
    expect(files).toContain(`${NESTED}/a.txt`);
    expect(files).not.toContain(`${NESTED}/.bmad-loop/policy.toml`);
    expect(files.some((f) => f.startsWith(`${NESTED}/.bmad-loop/runs/`))).toBe(false);
  });

  test("closeOut with no costUsd: the PR body carries the metered cost from <wt>/<prefix>/.bmad-loop/runs/<id>/run.json", async () => {
    const fx = await launchedNested();
    commitIn(fx.served, "a.txt", "engine: story one");
    mkdirSync(join(fx.served, ".bmad-loop", "runs", "E1"), { recursive: true });
    writeFileSync(join(fx.served, ".bmad-loop", "runs", "E1", "run.json"), JSON.stringify({ total_cost_usd: 2.5 }));
    // Never the outer worktree top's `.bmad-loop`.
    mkdirSync(join(fx.wt, ".bmad-loop", "runs", "E1"), { recursive: true });
    writeFileSync(join(fx.wt, ".bmad-loop", "runs", "E1", "run.json"), JSON.stringify({ total_cost_usd: 9 }));
    const out = await closeOut(fx.get(), { paused: false, engineRunId: "E1" }, fx.deps);
    expect(out.error).toBeUndefined();
    const body = fx.gh.calls().find((c) => c.argv[1] === "create")!.body!;
    expect(body).toContain("$2.5000");
    expect(body).not.toContain("$9.0000");
  });

  test("the host verify leg reads `<base>:<prefix>.tk-studio/config.yaml` from the project root and runs at the served root", async () => {
    const host = `"${process.execPath}" -e "console.log('nested green')"`;
    const fx = await launchedNested({ [`${NESTED}/.tk-studio/config.yaml`]: `project_id: sup\nverify:\n  host: ${JSON.stringify(host)}\n` });
    (fx.queue as any).db.query("UPDATE runs SET tier = 'sbx' WHERE run_id = ?").run(fx.run.run_id);
    commitIn(fx.served, "a.txt", "engine: story one");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.argvs.find((a) => a.args[0] === "show")).toEqual({ bin: "git", args: ["show", `main:${NESTED}/.tk-studio/config.yaml`], cwd: fx.root });
    const ev = fx.queue.events(fx.run.run_id).find((e) => e.kind === "host-verify")!;
    expect(ev.detail).toMatchObject({ green: true, cwd: fx.served, command: host, stdout_tail: ["nested green"] });
    expect(fx.argvs.find((a) => a.bin === process.execPath)!.cwd).toBe(fx.served);
  });

  /** AC3: drive a nested run's invocation through `finishRun` and the real `invokeSkill` (an injected spawner), the
   * run's `workRoot` the served root `prepareWorktree` answers (as `runJob` passes it). Answers the worker spawn. */
  async function invokeNested(tier: "host" | "sbx") {
    const fx = await fixture({ baseRef: "main", nested: NESTED, files: nestedFiles() });
    const served = await prepareWorktree(fx.queue, fx.run, "proj", fx.root, fx.deps);
    const BLOCK = { status: "complete", intent: "tk-studio-activate", artifacts: [] };
    const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
    const spawner: Spawner = async (cmd, args, o) => {
      calls.push({ cmd, args, cwd: o.cwd });
      return args.includes("auth") && args.includes("status")
        ? { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }
        : { exit: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(BLOCK) }) };
    };
    const started: Started = {
      jobId: "j", root: fx.root, projectId: "proj", runId: "j-20261017T101010Z", guardS: 600, defn: fx.defn,
      woke: { accepted: true, run_id: "j-20261017T101010Z", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: {} } },
      workRoot: served, tier, ...(tier === "sbx" ? { sandbox: "claude-p" } : {}),
    };
    const summary = await finishRun(started, async () => ({ ok: true }), (root, skill, args, _sp, o) => invokeSkill(root, skill, args, spawner, o));
    expect(summary).toMatchObject({ ok: true, state: "complete" });
    const worker = calls.find((c) => c.args.includes("-p"))!;
    const prompt = worker.args[worker.args.indexOf("-p") + 1];
    const payload = JSON.parse(prompt.split("\n")[0].replace(/^\S+ /, ""));
    return { fx, served, worker, payload };
  }

  test("AC3 (review patch): host tier — the worker's cwd and `payload.directory` are <wt>/<prefix>, never the worktree top or the checkout", async () => {
    const { fx, served, worker, payload } = await invokeNested("host");
    const wt = worktreePath(fx.work, "proj", fx.run.run_id);
    expect(served).toBe(join(wt, NESTED));
    expect(worker.cwd).toBe(served);
    expect(payload.directory).toBe(served);
    expect(payload.directory).not.toBe(wt);
    expect(payload.directory).not.toBe(fx.root);
  });

  test("AC3 (review patch): sbx tier — the VM path (`sbx exec … -C`, `payload.directory`) is derived from the served path; the resume path's workRoot is the served root", async () => {
    const { fx, served, worker, payload } = await invokeNested("sbx");
    const vm = toVmPath(served);
    expect(vm.endsWith(`/${NESTED}`)).toBe(true);
    // The box's own TK_ATLASSIAN_* variables add `-e NAME` pairs right after `exec` (Story 31.1): skip them, so the
    // assertion holds whatever the host leg's environment carries.
    const withoutPassThrough: string[] = [];
    for (let i = 0; i < worker.args.length; i++) { if (worker.args[i] === "-e") { i++; continue; } withoutPassThrough.push(worker.args[i]!); }
    expect(withoutPassThrough.slice(0, 2)).toEqual(["exec", "claude-p"]);
    expect(worker.args[worker.args.indexOf("-C") + 1]).toBe(vm);
    expect(payload.directory).toBe(vm);
    expect(worker.cwd).toBe(served);
    // The resume path (`rebuildStarted`'s `workRoot: servedRoot(run)`) reads the same served root off the run row.
    expect(servedRoot(fx.get())).toBe(served);
  });

  /** A paused nested run at `nested` closed out: the harvest committed, the nested engine state never staged. */
  async function pausedCloseOutNested(nested: string) {
    const NESTED = nested;
    const fx = await fixture({ baseRef: "main", nested: NESTED, files: { [`${NESTED}/.tk-studio/config.yaml`]: "project_id: sup\n" } });
    const served = await prepareWorktree(fx.queue, fx.run, "proj", fx.root, fx.deps);
    const wt = worktreePath(fx.work, "proj", fx.run.run_id);
    const KEY = "9-1-the-landed-story", E1 = "20261017-101010-ab12";
    // The engine's state under the served root: its run dir, an archived run, the copied runtime — none ignored
    // there (the top-level `.gitignore` anchors its patterns at the top), all untracked.
    const state = [`.bmad-loop/runs/${E1}/engine.pid`, ".bmad-loop/archive/20261016-090909-ee00/engine.pid", ...COPIED_RUNTIME];
    for (const rel of state) { mkdirSync(join(served, rel, ".."), { recursive: true }); writeFileSync(join(served, rel), "machine-local\n"); }
    const untracked = testGit(wt, "status", "--porcelain", "--untracked-files=all").split("\n");
    for (const rel of state) expect(untracked).toContain(`?? ${NESTED}/${rel}`);
    // The engine's harvest: the story's spec at done with a closable verdict (uncommitted), under the served root.
    const specRel = `_bmad-output/specs/spec-epic-9/stories/${KEY}-spec.md`;
    mkdirSync(join(served, specRel, ".."), { recursive: true });
    writeFileSync(join(served, specRel), "---\ntitle: 'x'\nstatus: done\nreconcile_verdict: no-impact\n---\n\n# body\n");
    const head = testGit(wt, "rev-parse", "HEAD");
    fx.queue.markLaunched(fx.run.run_id, E1, { end: { state: "complete", reason: null } });
    fx.queue.markPaused(fx.run.run_id, { engine: { run_id: E1, status: "running", paused_stage: "escalation", paused_story_key: KEY } });
    const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
    // The injected studio runner answers `meter.py` with a failure: the pass stops right after the commit step.
    const deps: PausedDeps = { ...fx.deps, self: me, run: (bin, args, o) => fx.deps.run!(bin, args, { ...o, env: { ...IDENTITY, ...(o.env ?? {}) } }) };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(fx.queue.events(fx.run.run_id).filter((e) => e.kind === "close-out-failed").map((e) => e.detail!.step)).toEqual(["meter"]);
    expect(fx.argvs.find((a) => a.args[0] === "add")).toMatchObject({ cwd: wt });
    expect(testGit(wt, "log", "-1", "--format=%s")).toBe(harvestMessage(KEY, fx.run.run_id, E1));
    expect(testGit(wt, "rev-parse", "HEAD~1")).toBe(head);
    expect(testGit(wt, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean)).toEqual([`${NESTED}/${specRel}`]);
    // The engine state: never staged, never committed, still in the served root.
    expect(testGit(wt, "diff", "--cached", "--name-only")).toBe("");
    const after = testGit(wt, "status", "--porcelain", "--untracked-files=all").split("\n");
    for (const rel of state) { expect(after).toContain(`?? ${NESTED}/${rel}`); expect(existsSync(join(served, rel))).toBe(true); }
  }

  test("the paused-run close-out commits the harvest without the nested engine state (`<prefix>.bmad-loop/runs|archive`, the copied runtime)", async () => {
    await pausedCloseOutNested(NESTED);
  });

  test("review patch: a project path with glob metacharacters is excluded literally (`apps/s[u]p` never reads as `apps/sup`)", async () => {
    // The built pathspec: every metacharacter of the prefix wrapped in a one-character bracket class
    // (a backslash escape is a path separator to git on Windows and excluded nothing there), the
    // engine-state globs kept.
    expect(engineState("a/b*[c]?\\d/")).toEqual(engineState("").map((p) => p.replace(":(exclude,glob)", () => ":(exclude,glob)a/b[*][[]c[]][?][\\\\]d/")));
    expect(engineState("apps/s[u]p/")[0]).toBe(":(exclude,glob)apps/s[[]u[]]p/.bmad-loop/run[s]/**");
    expect(engineState("$&/")[0]).toBe(":(exclude,glob)$&/.bmad-loop/run[s]/**");
    // A real repository: unescaped, `apps/s[u]p/.bmad-loop/...` would match `apps/sup/...` and the state would be committed.
    await pausedCloseOutNested("apps/s[u]p");
  });
});

describe("hole 75: materialise judges only the planes it owns", () => {
  const plane = (plane: string, status: string) => ({ plane, status, detail: "" });
  test("a stopped sandbox's login plane never fails a materialise (the pin owns the login)", () => {
    expect(worktreeClean({ result: "clean", planes: [] })).toBe(true);
    expect(worktreeClean({ result: "drift", planes: [plane("bmad-base", "ok"), plane("plugin", "ok"), plane("store", "ok"),
      plane("vault", "ok"), plane("tracking", "ok"), plane("sandbox-login", "missing")] })).toBe(true);
    expect(worktreeClean({ result: "error", planes: [plane("plugin", "ok"), plane("sandbox-login", "error")] })).toBe(true);
    // hole 93: a fresh worktree never has the served checkout's sync-back state; the plane is reported, not judged
    expect(worktreeClean({ result: "drift", planes: [plane("plugin", "ok"), plane("tracking", "missing")] })).toBe(true);
    expect(driftingPlanes({ result: "drift", planes: [plane("plugin", "drift"), plane("tracking", "missing")] })).toBe("plugin: drift");
  });
  test("a judged plane that drifts still refuses, and the refusal names it", () => {
    const out = { result: "drift", planes: [plane("bmad-base", "ok"), plane("plugin", "drift"), plane("sandbox-login", "missing")] };
    expect(worktreeClean(out)).toBe(false);
    expect(driftingPlanes(out)).toBe("plugin: drift");
    expect(worktreeClean(null)).toBe(false);
    expect(worktreeClean({ result: "drift" })).toBe(false);
    expect(driftingPlanes({ result: "drift" })).toBe("result 'drift'");
  });
});

describe("Story 34.8: a slice run's proof folder and host-side commit, before the push", () => {
  type Ran = Extract<import("../src/hostverify").HostVerifyResult, { skipped?: false }>;
  /** A prepared worktree with one engine commit; origin's fetch URL a GitHub one (its push URL the bare origin). */
  async function prepared(files: Record<string, string> = {}) {
    const fx = await fixture({ baseRef: "main", files });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "engine: story one");
    testGit(wt, "remote", "set-url", "origin", "https://github.com/acme/tua.git");
    testGit(wt, "remote", "set-url", "--push", "origin", fx.repo.origin);
    return { ...fx, wt, run: fx.get() };
  }
  /** The playable store: the report, two frames, the sheet. */
  function store() {
    const dir = tempDir("tk-sup-vs-store-");
    mkdirSync(join(dir, "frames"), { recursive: true });
    writeFileSync(join(dir, "report.json"), JSON.stringify({ verdict: "pass" }));
    writeFileSync(join(dir, "log.txt"), "log\n");
    for (const f of ["tick-000000.png", "tick-000030.png", "tick-000060.png"]) writeFileSync(join(dir, "frames", f), f);
    writeFileSync(join(dir, "contact-sheet.png"), "sheet");
    return dir;
  }
  const verify = (o: { assets?: Ran["assets"] | null; store?: string } = {}): Ran => ({
    command: "c", argv: ["c"], cwd: "/w", exit: 0, duration_ms: 1, green: true, stdout_tail: [], stderr_tail: [],
    engine: { verdict: "green", command: "e", duration_ms: 1, godot_dir: null },
    playable: o.store ? { verdict: "pass", exit: 0, store: o.store, contact_sheet: join(o.store, "contact-sheet.png"), sampled: ["tick-000000.png", "tick-000060.png"] } : { verdict: "skipped", reason: "no playable" },
    ...(o.assets === null ? {} : { assets: o.assets ?? { verdict: "green", manifest: "assets/manifest.yaml", art_path: "art/greybox", steps: [] } }),
  });

  test("green assets: the art, the manifest and .tk-studio/proof/<run_id>/ committed by name, before the push; the PR embeds the sheet", async () => {
    const fx = await prepared();
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    mkdirSync(join(fx.wt, "assets"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    writeFileSync(join(fx.wt, "assets", "manifest.yaml"), "schema: 1\n");
    writeFileSync(join(fx.wt, "stray.txt"), "never committed"); // not a named path
    const st = store();
    const c = await closeOut(fx.run, { paused: false, verify: verify({ store: st }), slice: true }, fx.deps);
    expect(c.error).toBeUndefined();
    expect(c.pr).toBe("https://github.com/acme/widget/pull/42");
    const branch = runBranch(fx.run.run_id);
    const subject = testGit(fx.repo.origin, "log", "-1", "--format=%s", branch);
    expect(subject).toBe(`host leg: placed assets and proof (run ${fx.run.run_id})`);
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    expect(testGit(fx.repo.origin, "show", "--name-only", "--format=", branch).split("\n").sort()).toEqual([
      `${proof}/contact-sheet.png`, `${proof}/frames/tick-000000.png`, `${proof}/frames/tick-000060.png`, `${proof}/report.json`,
      "art/greybox/crate.glb", "assets/manifest.yaml",
    ]);
    expect(c.commits[0]).toContain("host leg: placed assets and proof");
    expect(c.host_commit).toMatch(/^[0-9a-f]{40}$/);
    // `git add` with named paths only (never -A), before the push
    const adds = fx.argvs.filter((a) => a.bin === "git" && a.args[0] === "add");
    expect(adds.map((a) => a.args)).toEqual([["add", "--", "art/greybox", "assets/manifest.yaml", proof, ":(exclude)art/greybox/.candidates"]]);
    const commitAt = fx.argvs.findIndex((a) => a.args[0] === "commit"), pushAt = fx.argvs.findIndex((a) => a.args[0] === "push");
    expect(commitAt).toBeGreaterThan(-1);
    expect(commitAt).toBeLessThan(pushAt);
    const body = fx.gh.calls().find((x) => x.argv[1] === "create")!.body!;
    expect(body).toContain(`![contact sheet](https://github.com/acme/tua/blob/${c.host_commit}/${proof}/contact-sheet.png?raw=true)`);
    expect(body).toContain(`- \`${proof}/frames/tick-000000.png\``);
    expect(body).toContain("Assets: green");
    expect(closeOutDetail(c)).toMatchObject({ closeout: { host_commit: c.host_commit } });
  });

  test("a retried slice close-out (the proof already committed): nothing to commit, the PR still embeds the sheet at the head", async () => {
    const fx = await prepared();
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    const st = store();
    fx.gh.answer({ fail: ["pr create"] });
    const first = await closeOut(fx.run, { paused: false, verify: verify({ store: st }), slice: true }, fx.deps);
    expect(first.error).toStartWith("gh pr create");
    expect(first.worktree).toBe("kept");
    expect(first.host_commit).toMatch(/^[0-9a-f]{40}$/);
    fx.gh.answer({});
    const again = await closeOut(fx.run, { paused: false, verify: verify({ store: st }), slice: true }, fx.deps);
    expect(again.error).toBeUndefined();
    expect(again.host_commit).toBe("nothing to commit");
    expect(fx.argvs.filter((a) => a.bin === "git" && a.args[0] === "commit")).toHaveLength(1);
    const body = fx.gh.calls().filter((x) => x.argv[1] === "create").at(-1)!.body!;
    expect(body).toContain(`![contact sheet](https://github.com/acme/tua/blob/${first.host_commit}/.tk-studio/proof/${fx.run.run_id}/contact-sheet.png?raw=true)`);
  });

  test("a retried close-out after the store was pruned: the committed proof kept, the worktree clean, the sheet still embedded", async () => {
    const fx = await prepared();
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    const st = store();
    fx.gh.answer({ fail: ["pr create"] });
    const first = await closeOut(fx.run, { paused: false, verify: verify({ store: st }), slice: true }, fx.deps);
    expect(first.host_commit).toMatch(/^[0-9a-f]{40}$/);
    rmSync(st, { recursive: true, force: true });
    fx.gh.answer({});
    const again = await closeOut(fx.run, { paused: false, verify: verify({ store: st }), slice: true }, fx.deps);
    expect(again.error).toBeUndefined();
    expect(again.host_commit).toBe("nothing to commit");
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    // the proof never deleted unstaged: the worktree clean enough to go, the pushed branch still carrying the sheet
    expect(again.worktree).toBe("removed");
    expect(testGit(fx.repo.origin, "ls-tree", "-r", "--name-only", runBranch(fx.run.run_id), "--", proof).split("\n")).toContain(`${proof}/contact-sheet.png`);
    const body = fx.gh.calls().filter((x) => x.argv[1] === "create").at(-1)!.body!;
    expect(body).toContain(`![contact sheet](https://github.com/acme/tua/blob/${first.host_commit}/${proof}/contact-sheet.png?raw=true)`);
    expect(body).toContain(`- \`${proof}/frames/tick-000000.png\``);
  });

  test("the host commit is scoped to the named paths: diff and commit carry the pathspec, a stray staged file stays out", async () => {
    const fx = await prepared();
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    writeFileSync(join(fx.wt, "stray.txt"), "staged elsewhere");
    testGit(fx.wt, "add", "--", "stray.txt");
    const c = await closeOut(fx.run, { paused: false, verify: verify({ store: store() }), slice: true }, fx.deps);
    expect(c.error).toBeUndefined();
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    const named = ["art/greybox", proof, ":(exclude)art/greybox/.candidates"];
    const diff = fx.argvs.find((a) => a.bin === "git" && a.args[0] === "diff" && a.args.includes("--cached"))!;
    expect(diff.args).toEqual(["diff", "--cached", "--quiet", "--", ...named]);
    const commit = fx.argvs.find((a) => a.bin === "git" && a.args[0] === "commit")!;
    expect(commit.args).toEqual(["commit", "-m", `host leg: placed assets and proof (run ${fx.run.run_id})`, "--", ...named]);
    const shown = testGit(fx.repo.origin, "show", "--name-only", "--format=", runBranch(fx.run.run_id)).split("\n");
    expect(shown).not.toContain("stray.txt");
  });

  test("no named path present: nothing to commit, no diff and no commit call", async () => {
    const fx = await prepared();
    // Story 35.3: no store (no proof to copy) and no art or manifest on disk: proofCommit itself stages nothing
    const c = await proofCommit(fx.run, verify(), fx.deps);
    expect(c.sha).toBe("nothing to commit");
    expect(fx.argvs.some((a) => a.bin === "git" && (a.args[0] === "add" || a.args[0] === "commit"))).toBe(false);
    expect(fx.argvs.some((a) => a.bin === "git" && a.args[0] === "diff" && a.args.includes("--cached"))).toBe(false);
  });

  test("a commit failure is the close-out's error: nothing pushed, the worktree kept", async () => {
    const fx = await prepared();
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    // Story 35.3: an ignored path is skipped now, never a failure: the worktree off the run branch fails the commit
    testGit(fx.wt, "checkout", "-q", "-b", "elsewhere");
    const c = await closeOut(fx.run, { paused: false, verify: verify({ store: store() }), slice: true }, fx.deps);
    expect(c.error).toStartWith("host commit: the worktree is on 'elsewhere', not the run branch");
    expect(c.pushed).toBeUndefined();
    expect(c.worktree).toBe("kept");
    expect(fx.gh.calls().some((x) => x.argv[1] === "create")).toBe(false);
  });

  test("red assets, no report.json in the store, or a non-slice run: no host commit, no art staged, the close-out as before", async () => {
    for (const [v, slice] of [
      [verify({ assets: { verdict: "red", reason: "assets.py check exited 1", steps: [] }, store: store() }), true],
      [verify({ assets: { verdict: "red", reason: "assets.py match fault: 2 not-run", manifest: "assets/manifest.yaml", art_path: "art/greybox", steps: [] }, store: store() }), true],
      [verify(), true],
      [verify({ store: store() }), false],
    ] as const) {
      const fx = await prepared();
      mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
      writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
      const c = await closeOut(fx.run, { paused: false, verify: v, ...(slice ? { slice } : {}) }, fx.deps);
      expect(c.host_commit).toBeUndefined();
      expect(fx.argvs.some((a) => a.bin === "git" && (a.args[0] === "add" || a.args[0] === "commit"))).toBe(false);
      expect(existsSync(join(fx.wt, ".tk-studio", "proof"))).toBe(false);
    }
  }, 30_000);

  test("Story 35.3: `skipped: no manifest` with report.json in the store: the proof committed (no art, no manifest)", async () => {
    const fx = await prepared();
    const st = store();
    const c = await closeOut(fx.run, { paused: false, verify: verify({ store: st, assets: { verdict: "skipped", reason: "no manifest", manifest: "assets/manifest.yaml", art_path: "art/greybox", steps: [] } }), slice: true }, fx.deps);
    expect(c.error).toBeUndefined();
    expect(c.host_commit).toMatch(/^[0-9a-f]{40}$/);
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    expect(testGit(fx.repo.origin, "show", "--name-only", "--format=", runBranch(fx.run.run_id)).split("\n").sort()).toEqual([
      `${proof}/contact-sheet.png`, `${proof}/frames/tick-000000.png`, `${proof}/frames/tick-000060.png`, `${proof}/report.json`,
    ]);
    // the leg with no assets step at all (an older record) commits its proof too
    const gx = await prepared();
    const d = await closeOut(gx.run, { paused: false, verify: verify({ store: store(), assets: null }), slice: true }, gx.deps);
    expect(d.host_commit).toMatch(/^[0-9a-f]{40}$/);
  }, 30_000);

  test("Story 35.3: a non-red match fault commits the art and proof; `.candidates/` and an ignored path never staged, the ignored one in `skipped_ignored`", async () => {
    const fx = await prepared({ ".gitignore": ".bmad-loop/runs/\nassets/\n" });
    mkdirSync(join(fx.wt, "art", "greybox", ".candidates"), { recursive: true });
    mkdirSync(join(fx.wt, "assets"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    writeFileSync(join(fx.wt, "art", "greybox", ".candidates", "door.glb"), "candidate");
    writeFileSync(join(fx.wt, "assets", "manifest.yaml"), "schema: 1\n"); // ignored by the project
    const fault = { verdict: "green" as const, manifest: "assets/manifest.yaml", art_path: "art/greybox",
      steps: [{ verb: "match" as const, exit: 1, status: "fault", duration_ms: 1, reason: "match: door: coverage" }] };
    const v = verify({ store: store(), assets: fault });
    const done = await proofCommit(fx.run, v, fx.deps);
    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(done.skipped_ignored).toEqual(["assets/manifest.yaml"]);
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    const shown = testGit(fx.wt, "show", "--name-only", "--format=", "HEAD").split("\n");
    expect(shown).toContain("art/greybox/crate.glb");
    expect(shown).not.toContain("art/greybox/.candidates/door.glb");
    expect(shown).not.toContain("assets/manifest.yaml");
    expect(shown).toContain(`${proof}/report.json`);
    const ci = fx.argvs.findIndex((a) => a.bin === "git" && a.args[0] === "check-ignore");
    const add = fx.argvs.findIndex((a) => a.bin === "git" && a.args[0] === "add");
    expect(ci).toBeGreaterThan(-1);
    expect(ci).toBeLessThan(add);
    expect(fx.argvs[add]!.args).toEqual(["add", "--", "art/greybox", proof, ":(exclude)art/greybox/.candidates"]);
    // the close-out commits under the same condition (a fault that is not red)
    const gx = await prepared();
    mkdirSync(join(gx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(gx.wt, "art", "greybox", "crate.glb"), "glb");
    const c = await closeOut(gx.run, { paused: false, verify: verify({ store: store(), assets: fault }), slice: true }, gx.deps);
    expect(c.host_commit).toMatch(/^[0-9a-f]{40}$/);
  }, 30_000);

  test("Story 35.3: an ignored path with non-ASCII characters is matched (`check-ignore -q` per path, its exit code read, never its C-quoted output) and never staged", async () => {
    const fx = await prepared({ ".gitignore": ".bmad-loop/runs/\nassets/\n" });
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    mkdirSync(join(fx.wt, "assets"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    writeFileSync(join(fx.wt, "assets", "mänifest ü.yaml"), "schema: 1\n"); // ignored, and C-quoted without -z
    const v = verify({ store: store(), assets: { verdict: "green", manifest: "assets/mänifest ü.yaml", art_path: "art/greybox", steps: [] } });
    const done = await proofCommit(fx.run, v, fx.deps);
    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(done.skipped_ignored).toEqual(["assets/mänifest ü.yaml"]);
    const ci = fx.argvs.filter((a) => a.bin === "git" && a.args[0] === "check-ignore").map((a) => a.args);
    expect(ci).toContainEqual(["check-ignore", "-q", "--", "assets/mänifest ü.yaml"]);
    const add = fx.argvs.find((a) => a.bin === "git" && a.args[0] === "add")!;
    expect(add.args).not.toContain("assets/mänifest ü.yaml");
  }, 30_000);

  test("Story 35.3: the proof folder itself ignored: in `skipped_ignored`, no sheet and no frames answered, the PR body embeds no contact sheet", async () => {
    const fx = await prepared({ ".gitignore": ".bmad-loop/runs/\n.tk-studio/proof/\n" });
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    const done = await proofCommit(fx.run, verify({ store: store() }), fx.deps);
    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(done.skipped_ignored).toEqual([proof]);
    expect(done.sheet).toBeUndefined();
    expect(done.frames).toEqual([]);
    expect(testGit(fx.wt, "show", "--name-only", "--format=", "HEAD").split("\n")).not.toContain(`${proof}/report.json`);
    // the close-out's PR body through the same answer: no contact-sheet link, no frame links
    const gx = await prepared({ ".gitignore": ".bmad-loop/runs/\n.tk-studio/proof/\n" });
    mkdirSync(join(gx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(gx.wt, "art", "greybox", "crate.glb"), "glb");
    const c = await closeOut(gx.run, { paused: false, verify: verify({ store: store() }), slice: true }, gx.deps);
    expect(c.error).toBeUndefined();
    expect(c.host_commit).toMatch(/^[0-9a-f]{40}$/);
    const body = gx.gh.calls().find((x) => x.argv[1] === "create")!.body!;
    expect(body).not.toContain("contact-sheet.png");
    expect(body).not.toContain(`.tk-studio/proof/${gx.run.run_id}/frames/`);
  }, 30_000);

  test("Story 35.3: the art path holding only `.candidates/`: left out of the diff and commit, the proof still committed", async () => {
    const fx = await prepared();
    mkdirSync(join(fx.wt, "art", "greybox", ".candidates"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", ".candidates", "door.glb"), "candidate");
    const fault = { verdict: "green" as const, manifest: "assets/manifest.yaml", art_path: "art/greybox",
      steps: [{ verb: "match" as const, exit: 1, status: "fault", duration_ms: 1, reason: "match: door: coverage" }] };
    const done = await proofCommit(fx.run, verify({ store: store(), assets: fault }), fx.deps);
    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    const shown = testGit(fx.wt, "show", "--name-only", "--format=", "HEAD").split("\n");
    expect(shown).toContain(`${proof}/report.json`);
    expect(shown.some((f) => f.includes(".candidates"))).toBe(false);
    const commit = fx.argvs.find((a) => a.bin === "git" && a.args[0] === "commit")!;
    expect(commit.args).toEqual(["commit", "-m", `host leg: placed assets and proof (run ${fx.run.run_id})`, "--", proof]);
    expect(done.sheet).toBe(`${proof}/contact-sheet.png`);
  }, 30_000);

  test("Story 35.3: an ignore rule matching files inside the proof folder (`*.png`): report.json committed, no sheet, no frames", async () => {
    const fx = await prepared({ ".gitignore": ".bmad-loop/runs/\n*.png\n" });
    mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
    writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    const done = await proofCommit(fx.run, verify({ store: store() }), fx.deps);
    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(done.skipped_ignored).toBeUndefined();
    expect(done.sheet).toBeUndefined();
    expect(done.frames).toEqual([]);
    const shown = testGit(fx.wt, "show", "--name-only", "--format=", "HEAD").split("\n");
    expect(shown).toContain(`${proof}/report.json`);
    expect(shown).not.toContain(`${proof}/contact-sheet.png`);
  }, 30_000);

  test("Story 35.3: proofCommitDue: a playable exit 2 or a guard trip (exit null) is never due, and the close-out commits nothing", async () => {
    for (const exit of [2, null]) {
      const fx = await prepared();
      mkdirSync(join(fx.wt, "art", "greybox"), { recursive: true });
      writeFileSync(join(fx.wt, "art", "greybox", "crate.glb"), "glb");
      const v = verify({ store: store() });
      v.playable = { ...v.playable!, exit, reason: exit === null ? "timed out (guard)" : "playable.py exited 2" } as Ran["playable"];
      const due = proofCommitDue(v, fx.run);
      expect(due.due).toBe(false);
      if (!due.due) expect(due.why).toStartWith("the playable step never finished");
      const c = await closeOut(fx.run, { paused: false, verify: v, slice: true }, fx.deps);
      expect(c.host_commit).toBeUndefined();
      expect(fx.argvs.some((a) => a.bin === "git" && (a.args[0] === "add" || a.args[0] === "commit"))).toBe(false);
      expect(existsSync(join(fx.wt, ".tk-studio", "proof"))).toBe(false);
    }
  }, 30_000);

  test("Story 35.3: proofCommitDue's served-root fallback only when the store itself is gone, never for a store without report.json", async () => {
    const fx = await prepared();
    const proofDir = join(fx.wt, ".tk-studio", "proof", fx.run.run_id);
    mkdirSync(proofDir, { recursive: true });
    writeFileSync(join(proofDir, "report.json"), JSON.stringify({ verdict: "pass" })); // an earlier leg's proof
    // the store pruned (its path missing): the served root's proof is due (a retried close-out)
    const pruned = store();
    rmSync(pruned, { recursive: true, force: true });
    expect(proofCommitDue(verify({ store: pruned }), fx.run)).toEqual({ due: true });
    // the store present without report.json (a crash that wrote none): never due, the stale proof never re-embedded
    const crashed = store();
    rmSync(join(crashed, "report.json"));
    const v = verify({ store: crashed });
    v.playable = { ...v.playable!, exit: 1 } as Ran["playable"];
    expect(proofCommitDue(v, fx.run)).toEqual({ due: false, why: "no report.json in the playable store" });
    // no store recorded at all, the served root's proof present: the fallback still answers
    const bare = verify({ store: pruned });
    delete (bare.playable as { store?: string }).store;
    expect(proofCommitDue(bare, fx.run)).toEqual({ due: true });
  }, 30_000);

  test("the sweep decides the slice from the resolved definition and passes it to the leg", async () => {
    const config = `vcs: git\nverify:\n  host: ${JSON.stringify(`"${process.execPath}" -e "console.log('ok')"`)}\n`;
    for (const defn of [{ id: "run-epic-41", type: "run-vertical-slice", target: { skill: "tk-studio-launch" } }, { id: "run-epic-41", type: "run-epic", target: { skill: "tk-studio-launch" } }]) {
      const fx = await fixture({ baseRef: "main", files: { ".tk-studio/config.yaml": config } });
      const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
      fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: defn });
      await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn }, {
        ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete",
        status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, total_cost_usd: 0.25, finish_deferred: true,
      }, async () => ({}), fx.deps);
      (fx.queue as any).db.query("UPDATE runs SET tier = 'sbx' WHERE run_id = ?").run(fx.run.run_id);
      commitIn(wt, "a.txt", "engine: story one");
      fx.answers.launch = { ok: true, run: { status: "finished" } };
      expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
      const ev = fx.queue.events(fx.run.run_id).find((e) => e.kind === "host-verify")!;
      if (defn.type === "run-vertical-slice") expect(ev.detail!.assets).toEqual({ verdict: "skipped", reason: "no manifest", manifest: "assets/manifest.yaml", art_path: "art/greybox", steps: [] });
      else expect("assets" in ev.detail!).toBe(false);
    }
  }, 30_000);
  test("Story 38.5: a slice run that paused and ends on the same code head never reuses the pause's code-only leg — the end runs `hostVerify` with `slice` and records its `assets` step; a run-epic still reuses the pause's leg", async () => {
    const config = `vcs: git\nverify:\n  host: ${JSON.stringify(`"${process.execPath}" -e "console.log('ok')"`)}\n`;
    for (const defn of [{ id: "run-epic-41", type: "run-vertical-slice", target: { skill: "tk-studio-launch" } }, { id: "run-epic-41", type: "run-epic", target: { skill: "tk-studio-launch" } }]) {
      const fx = await fixture({ baseRef: "main", files: { ".tk-studio/config.yaml": config } });
      const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
      fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: defn });
      await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn }, {
        ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete",
        status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, total_cost_usd: 0.25, finish_deferred: true,
      }, async () => ({}), fx.deps);
      (fx.queue as any).db.query("UPDATE runs SET tier = 'sbx' WHERE run_id = ?").run(fx.run.run_id);
      commitIn(wt, "a.txt", "engine: story one");
      fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
      expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
      expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
      const legs = () => fx.queue.events(fx.run.run_id).filter((e) => e.kind === "host-verify");
      expect(legs().map((e) => "assets" in e.detail!)).toEqual([false]); // the pause's leg: the code leg only
      const head = testGit(wt, "rev-parse", "HEAD");
      fx.answers.launch = { ok: true, run: { status: "finished" } };
      expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
      if (defn.type === "run-vertical-slice") {
        expect(legs()).toHaveLength(2);
        expect(legs()[1]!.detail).toMatchObject({ green: true, code_head: head, assets: { verdict: "skipped", reason: "no manifest" } });
      } else expect(legs()).toHaveLength(1); // one commit set, one leg
      expect(fx.get().state).toBe("complete");
    }
  }, 30_000);

  test("Story 38.5: pause 1 green at head H (the PR ready); resumed, pause 2 on a dirty tree at the same H → `gh pr ready --undo` (no reuse on a dirty tree), one `paused: dirty tree` skip after pause 2", async () => {
    const config = `vcs: git\nverify:\n  host: ${JSON.stringify(`"${process.execPath}" -e "console.log('ok')"`)}\n`;
    const fx = await fixture({ baseRef: "main", files: { ".tk-studio/config.yaml": config } });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete",
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    (fx.queue as any).db.query("UPDATE runs SET tier = 'sbx' WHERE run_id = ?").run(fx.run.run_id);
    commitIn(wt, "a.txt", "engine: story one");
    const pr = "https://github.com/acme/widget/pull/42";
    const prs = () => fx.gh.calls().filter((c) => c.argv[0] === "pr");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(prs().map((c) => c.argv[1])).toEqual(["list", "create", "ready", "edit"]); // the pass's green flip
    const launched = fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "launched")!.detail!;
    fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", {});
    fx.queue.note(fx.run.run_id, "launched", launched);
    fx.queue.db.run("UPDATE runs SET owner_pid = NULL, owner_nonce = NULL WHERE run_id = ?", [fx.run.run_id]);
    writeFileSync(join(wt, "half.txt"), "half-written"); // no new commit: the same code head
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(prs().map((c) => c.argv[1])).toEqual(["list", "create", "ready", "edit", "ready", "edit"]);
    expect(prs()[4]!.argv).toEqual(["pr", "ready", pr, "--undo"]);
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ pr, closeout: { result: "draft PR", worktree: "kept" } });
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    const evs = fx.queue.events(fx.run.run_id);
    const after = evs.slice(evs.findLastIndex((e) => e.kind === "paused") + 1).filter((e) => e.kind === "host-verify");
    expect(after.map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused: dirty tree", code_head: testGit(wt, "rev-parse", "HEAD") }]);
    expect(await pausedLegs(fx.queue, fx.deps)).toEqual([]); // once
    expect(prs()).toHaveLength(6);
  });

  test("Story 37.3 (DW-148), Story 38.5 (`pausedLegs`): a clean paused slice run's leg is the code leg only: no assets verb, the tree still clean, green → the PR ready", async () => {
    const config = `vcs: git\nverify:\n  host: ${JSON.stringify(`"${process.execPath}" -e "console.log('ok')"`)}\n`;
    const defn = { id: "run-epic-41", type: "run-vertical-slice", target: { skill: "tk-studio-launch" } };
    const fx = await fixture({ baseRef: "main", files: { ".tk-studio/config.yaml": config, "assets/manifest.yaml": "schema: 1\n" } });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: defn });
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete",
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    (fx.queue as any).db.query("UPDATE runs SET tier = 'sbx' WHERE run_id = ?").run(fx.run.run_id);
    commitIn(wt, "a.txt", "engine: story one");
    // Every step the leg spawns, its argv read from the spec file before it runs.
    const spawned: string[][] = [];
    const run: WorktreeDeps["run"] = async (bin, args, o) => {
      if (bin === process.execPath && args[2] && existsSync(args[2])) { try { spawned.push(JSON.parse(readFileSync(args[2], "utf-8")).argv); } catch { /* not a step spec */ } }
      return fx.deps.run!(bin, args, o);
    };
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, { ...fx.deps, run })).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("paused");
    const c = fx.queue.events(fx.run.run_id).at(-1)!.detail as any;
    expect(c.closeout).toMatchObject({ result: "draft PR", worktree: "kept" });
    expect(c.closeout.host_commit).toBeUndefined(); // the slice proof stays with the final close-out
    expect(await pausedLegs(fx.queue, { ...fx.deps, run })).toEqual([fx.run.run_id]);
    const ev = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "host-verify");
    expect(ev.map((e) => e.detail!.green)).toEqual([true]);
    expect("assets" in ev[0]!.detail!).toBe(false);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.some((a) => a.some((x) => String(x).endsWith("assets.py")))).toBe(false);
    expect(await treeClean(fx.get(), fx.deps)).toBe(true);
    expect(ev[0]!.detail!.paused_leg).toEqual({ pr: "https://github.com/acme/widget/pull/42", flip: "ready" });
    expect(fx.gh.calls().filter((x) => x.argv[0] === "pr").map((x) => x.argv[1])).toEqual(["list", "create", "ready", "edit"]);
  }, 30_000);
});

describe("Story 36.1: the sweep drives a slice run to its close-out on a passing playable run", () => {
  const config = `vcs: git\nverify:\n  host: "uv run tools/verify_host.py"\n  engine: "bash scripts/engine-gate.sh"\nplayable:\n  scenario: scenarios/smoke.json\n  seed: 7\n  ticks: 120\n`;
  const defn = { id: "run-epic-41", type: "run-vertical-slice", target: { skill: "tk-studio-launch" } };

  test("sweepEngines to closeOut with `slice: true`: the leg passes, the sheet and frames/<name> committed under the proof folder, the PR embeds the sheet", async () => {
    const fx = await fixture({ baseRef: "main", files: { ".tk-studio/config.yaml": config } });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: defn });
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn }, {
      ok: true, job_id: "j", run_id: "j-20261016T101010Z", target: "skill", state: "complete",
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, total_cost_usd: 0.25, finish_deferred: true,
    }, async () => ({}), fx.deps);
    fx.queue.db.run("UPDATE runs SET tier = 'sbx', sandbox = 'tk-sbx' WHERE run_id = ?", [fx.run.run_id]);
    commitIn(wt, "a.txt", "engine: story one");
    mkdirSync(join(wt, "assets"), { recursive: true });
    writeFileSync(join(wt, "assets", "manifest.yaml"), "schema: 1\n");
    testGit(wt, "remote", "set-url", "origin", "https://github.com/acme/tua.git");
    testGit(wt, "remote", "set-url", "--push", "origin", fx.repo.origin);

    const sbx = fakeSbx();
    sbx.answer({ launch_status: { ok: true, run: { status: "finished" } } as any });
    const env = { ...fx.deps.env, SBX_BIN: sbx.bin, TK_STUDIO_HOME: tempDir("tk-sup-36-home-") };
    const { steps, run } = sliceRecorder(config, { passing: true, through: fx.deps.run as any });
    const judge: PlayableJudge = async (root, args) => {
      writeFileSync(join(root, args.payload.media, "judge.json"), JSON.stringify({ verdict: "pass", findings: [] }));
      return { status_block: { status: "complete", intent: "tk-studio-playable-judge", artifacts: ["judge.json"], reason: null }, total_cost_usd: 0.1 };
    };
    const deps: WorktreeDeps = { ...fx.deps, env, run: run as any, judge, route: async () => ({ "playable-verify": { model: "claude-opus-5", effort: "high" } }) };

    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.run.run_id]);

    const leg = fx.queue.events(fx.run.run_id).find((e) => e.kind === "host-verify")!.detail as any;
    expect(steps.some((a) => a[3] === "sheet")).toBe(true);
    expect(leg).toMatchObject({ green: true, playable: { verdict: "pass", exit: 0, sampled: ["tick-000000.png", "tick-000030.png"] } });
    expect(legVerdict(leg)).toBe("green");
    expect(fx.get().state).toBe("complete");

    const branch = runBranch(fx.run.run_id);
    const proof = `.tk-studio/proof/${fx.run.run_id}`;
    expect(FRAMES_DIR).toBe("frames");
    expect(testGit(fx.repo.origin, "log", "-1", "--format=%s", branch)).toBe(`host leg: placed assets and proof (run ${fx.run.run_id})`);
    expect(testGit(fx.repo.origin, "show", "--name-only", "--format=", branch).split("\n").sort()).toEqual([
      `${proof}/contact-sheet.png`, `${proof}/frames/tick-000000.png`, `${proof}/frames/tick-000030.png`, `${proof}/report.json`, "assets/manifest.yaml",
    ]);
    expect(testGit(fx.repo.origin, "show", `${branch}:${proof}/contact-sheet.png`)).toBe("sheet-png");
    const head = testGit(fx.repo.origin, "rev-parse", branch);
    const body = fx.gh.calls().find((x) => x.argv[1] === "create")!.body!;
    expect(body).toContain(`![contact sheet](https://github.com/acme/tua/blob/${head}/${proof}/contact-sheet.png?raw=true)`);
    expect(body).toContain(`- \`${proof}/frames/tick-000000.png\``);
    const ended = fx.queue.events(fx.run.run_id).findLast((e) => e.kind === "ended")!.detail as any;
    expect(ended.closeout).toMatchObject({ host_verify: "green", host_commit: head });
  }, 30_000);
});

describe("Story 35.1: the re-run's shared motions — the `Legs:` line, the lifted body edit and flips, proofCommit on the `-B` cut", () => {
  type Ran = Extract<import("../src/hostverify").HostVerifyResult, { skipped?: false }>;
  const red: Ran = { command: "c", argv: ["c"], cwd: "/w", exit: 1, duration_ms: 1, green: false, stdout_tail: [], stderr_tail: ["boom"] };
  const legs = [
    { leg: "close-out" as const, verdict: "red" as const, recorded_at: "2026-10-27T01:00:00Z" },
    { leg: "re-run" as const, verdict: "green" as const, recorded_at: "2026-10-27T02:00:00Z", by: "api" as const },
  ];

  test("Story 35.1: prBody with `legs`: one `Legs:` line first under `## Host verify`, everything else (the status block) unchanged", () => {
    const input = { statusBlock: { status: "complete" }, engineRunId: "E1", commits: ["abc one"], costUsd: 1, runId: "q-1", verify: red };
    const plain = prBody(input), withLegs = prBody({ ...input, legs });
    expect(withLegs).toContain("## Host verify\n\nLegs: 2 — close-out red 2026-10-27T01:00:00Z; re-run green 2026-10-27T02:00:00Z (by api)\n\n**Red:** `c`");
    expect(withLegs.replace("Legs: 2 — close-out red 2026-10-27T01:00:00Z; re-run green 2026-10-27T02:00:00Z (by api)\n\n", "")).toBe(plain);
    expect(prBody({ ...input, legs: [legs[0]!] })).toContain("Legs: 1 — close-out red 2026-10-27T01:00:00Z\n\n");
  });

  test("Story 35.1: editPrBody, markPrReady and markPrDraft: `--body-file` (read at call time), `gh pr ready`, `gh pr ready --undo`; a failure answered, never thrown", async () => {
    const fx = await fixture();
    const pr = "https://github.com/acme/widget/pull/42";
    expect(await editPrBody(fx.deps, fx.repo.checkout, pr, "the body")).toBeUndefined();
    expect(await markPrReady(fx.deps, fx.repo.checkout, pr)).toBeUndefined();
    expect(await markPrDraft(fx.deps, fx.repo.checkout, pr)).toBeUndefined();
    const calls = fx.gh.calls();
    expect(calls.map((c) => c.argv.slice(0, 3))).toEqual([["pr", "edit", pr], ["pr", "ready", pr], ["pr", "ready", pr]]);
    expect(calls[0]!.argv[3]).toBe("--body-file");
    expect(calls[0]!.body).toBe("the body");
    expect(calls[1]!.argv).toEqual(["pr", "ready", pr]);
    expect(calls[2]!.argv).toEqual(["pr", "ready", pr, "--undo"]);
    fx.gh.answer({ fail: ["pr edit", "pr ready"] });
    expect(await editPrBody(fx.deps, fx.repo.checkout, pr, "b")).toMatch(/^gh pr edit exit 1: fake gh: pr edit failed/);
    expect(await markPrReady(fx.deps, fx.repo.checkout, pr)).toMatch(/^gh pr ready exit 1: /);
    expect(await markPrDraft(fx.deps, fx.repo.checkout, pr)).toMatch(/^gh pr ready --undo exit 1: /);
    const throwing: WorktreeDeps = { ...fx.deps, run: async () => { throw new Error("spawn failed"); } };
    expect(await markPrDraft(throwing, fx.repo.checkout, pr)).toBe("gh pr ready --undo: spawn failed");
  });

  test("Story 35.1: closeOut goes through the lifted motions: a red verify on an open PR is `--undo` then `gh pr edit`, its body carrying the passed `legs`", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "engine: story one");
    const pr = "https://github.com/acme/widget/pull/42";
    const c = await closeOut(fx.get(), { paused: false, existingPr: pr, verify: red, legs: [legs[0]!] }, fx.deps);
    expect(c).toMatchObject({ pr, draft: true });
    expect(c.error).toBeUndefined();
    const calls = fx.gh.calls().filter((x) => x.argv[0] === "pr");
    expect(calls.map((x) => x.argv)).toEqual([["pr", "ready", pr, "--undo"], ["pr", "edit", pr, "--body-file", expect.any(String)]]);
    expect(calls[1]!.body).toContain("## Host verify\n\nLegs: 1 — close-out red 2026-10-27T01:00:00Z\n\n**Red:**");
  });

  test("Story 35.3: an inconclusive leg flips no PR: `host_verify: inconclusive`, a new PR opened `--draft`, an open one never marked ready (body still edited)", async () => {
    const inconclusive: Ran = { command: "c", argv: ["c"], cwd: "/w", exit: 0, duration_ms: 1, green: false, stdout_tail: [], stderr_tail: [],
      engine: { verdict: "green", command: "e", duration_ms: 1, godot_dir: null },
      playable: { verdict: "inconclusive", reason: "infrastructure: sbx: exec failed" } };
    expect(legVerdict(inconclusive)).toBe("inconclusive");
    // a new PR: opened as a draft, never marked ready
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "engine: story one");
    const c = await closeOut(fx.get(), { paused: false, verify: inconclusive }, fx.deps);
    expect(c.error).toBeUndefined();
    expect(c).toMatchObject({ host_verify: "inconclusive", draft: true });
    expect(closeOutDetail(c)).toMatchObject({ closeout: { result: "draft PR", host_verify: "inconclusive" } });
    const create = fx.gh.calls().find((x) => x.argv[1] === "create")!;
    expect(create.argv).toContain("--draft");
    expect(fx.gh.calls().some((x) => x.argv[1] === "ready")).toBe(false);
    // an open PR: its body regenerated, never `gh pr ready` (nor `--undo`)
    const gx = await fixture({ baseRef: "main" });
    const gwt = await prepareWorktree(gx.queue, gx.run, "proj", gx.repo.checkout, gx.deps);
    commitIn(gwt, "a.txt", "engine: story one");
    const pr = "https://github.com/acme/widget/pull/42";
    const legs1 = [{ leg: "close-out" as const, verdict: "inconclusive" as const, recorded_at: "2026-10-27T01:00:00Z" }];
    const d = await closeOut(gx.get(), { paused: false, existingPr: pr, verify: inconclusive, legs: legs1 }, gx.deps);
    expect(d.error).toBeUndefined();
    expect(d).toMatchObject({ pr, host_verify: "inconclusive" });
    const calls = gx.gh.calls().filter((x) => x.argv[0] === "pr");
    expect(calls.map((x) => x.argv[1])).toEqual(["edit"]);
    expect(calls[0]!.body).toContain("## Host verify\n\nLegs: 1 — close-out inconclusive 2026-10-27T01:00:00Z\n\n");
    expect(calls[0]!.body).toContain("Playable: inconclusive — infrastructure: sbx: exec failed");
  });

  test("Story 36.3: a killed close-out on an adopted PR returns it to a draft; a failed `--undo` is recorded and claims no draft", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "engine: story one");
    const pr = "https://github.com/acme/widget/pull/42";
    fx.gh.answer({ open: [pr] });
    const c = await closeOut(fx.get(), { paused: false, killed: true }, fx.deps);
    expect(c).toMatchObject({ pr, draft: true });
    expect(c.error).toBeUndefined();
    const undo = fx.gh.calls().filter((x) => x.argv[1] === "ready");
    expect(undo.map((x) => x.argv.includes("--undo"))).toEqual([true]);
    expect(fx.gh.calls().some((x) => x.argv[1] === "edit")).toBe(true);
    const gx = await fixture({ baseRef: "main" });
    const gwt = await prepareWorktree(gx.queue, gx.run, "proj", gx.repo.checkout, gx.deps);
    commitIn(gwt, "a.txt", "engine: story one");
    gx.gh.answer({ open: [pr], fail: ["pr ready"] });
    const d = await closeOut(gx.get(), { paused: false, killed: true }, gx.deps);
    expect(d.draft).toBeUndefined();
    expect(d.error).toContain("gh pr ready --undo");
    expect(gx.gh.calls().some((x) => x.argv[1] === "edit")).toBe(true);
  });

  test("Story 35.1: proofCommit on a worktree cut `-B <run branch> <remote tip>` over a stale local branch: committed on the branch, fast-forward of the tip; a detached cut is refused", async () => {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    commitIn(wt, "a.txt", "engine: story one");
    const branch = runBranch(fx.run.run_id);
    testGit(wt, "push", "-q", "origin", branch);
    const tip = testGit(wt, "rev-parse", "HEAD");
    testGit(fx.repo.checkout, "worktree", "remove", "--force", wt);
    testGit(fx.repo.checkout, "branch", "-f", branch, "main"); // the kept local branch, behind origin
    const path = `${wt}.verify`;
    testGit(fx.repo.checkout, "fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
    testGit(fx.repo.checkout, "worktree", "add", "-q", "--relative-paths", "-B", branch, path, tip);
    mkdirSync(join(path, "art", "greybox"), { recursive: true });
    writeFileSync(join(path, "art", "greybox", "crate.glb"), "glb");
    const v: Ran = { ...red, exit: 0, green: true, stderr_tail: [], assets: { verdict: "green", manifest: "assets/manifest.yaml", art_path: "art/greybox", steps: [] } };
    const done = await proofCommit({ run_id: fx.run.run_id, worktree: path, prefix: null }, v, fx.deps);
    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(testGit(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(testGit(path, "rev-parse", "HEAD^")).toBe(tip);
    expect(testGit(path, "log", "-1", "--format=%s")).toBe(`host leg: placed assets and proof (run ${fx.run.run_id})`);
    testGit(path, "push", "-q", "origin", branch); // a fast-forward, never forced
    expect(testGit(fx.repo.origin, "rev-parse", branch)).toBe(done.sha);
    testGit(fx.repo.checkout, "worktree", "remove", "--force", path);
    testGit(fx.repo.checkout, "worktree", "add", "-q", "--detach", path, tip);
    await expect(proofCommit({ run_id: fx.run.run_id, worktree: path, prefix: null }, v, fx.deps)).rejects.toThrow(/not the run branch/);
  });
});

// Story 38.2 (hole 114, DW-180): the first 37.6 run's shape — two dev attempts halted on a stale render snapshot (five of the
// generation's ten files `-?????????` from inside the sandbox), the engine deferred the story and stopped, no commit landed.
describe("Story 38.2: a run that does no work says so", () => {
  const KEY = "37-6-one-stop-path-and-the-gates-blind-spots";
  const GEN = "_bmad/render/bmad-build-auto/wt-ac68fc677deb/f1a1d5587ffb3976eb54";
  const FILES = ["manifest.json", "compile-epic-context.md", "spec-template.md", "step-01-clarify-and-route.md", "step-04-review.md",
    "workflow.md", "step-02-plan.md", "step-03-implement.md", "references/a.md", "references/b.md"];
  const HALT = `the rendered skill is unreadable from inside the sandbox: ls -la /home/agent/w/${GEN}/ shows ${FILES.slice(0, 5).map((f) => `-????????? ? ? ? ? ? ${f}`).join(", ")}`;
  const specOf = (halt: string) => `---\ntitle: 'One stop path'\nstatus: 'halted'\n---\n\n# body\n\n## Auto Run Result\n\nStatus: halted\nBlocking condition: ${halt}\n`;
  const REASON = `no story landed: story ${KEY} ended halted after 2 dev attempt(s): ${HALT.slice(0, 300)}; engine ended 'stopped'`;

  /** An engine `eid` that drove KEY twice to a halt and deferred it: its journal, its state.json and the spec the engine stashed. */
  function haltedEngine(wt: string, eid: string, o: { journal?: boolean; halt?: string; spec?: boolean; decision?: string } = {}) {
    const runDir = join(wt, ".bmad-loop", "runs", eid);
    mkdirSync(join(runDir, "deferred", KEY), { recursive: true });
    const lines = [{ kind: "run-start" }, ...(o.journal === false ? [] : [{ kind: "story-start", story_key: KEY },
      { kind: "dev-decision", story_key: KEY, attempt: 1, session_status: "completed", action: "retry", reason: `spec status is 'halted', expected 'done'` },
      { kind: "dev-decision", story_key: KEY, attempt: 2, session_status: "completed", action: "defer", reason: o.decision ?? `spec status is 'halted', expected 'done'` },
      { kind: "deferred-artifacts-stashed", story_key: KEY }, { kind: "story-deferred", story_key: KEY }])];
    writeFileSync(join(runDir, "journal.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""), "utf-8");
    writeFileSync(join(runDir, "state.json"), JSON.stringify({ tasks: { [KEY]: { story_key: KEY, sessions: [
      { task_id: "t1", role: "dev", status: "completed", result_json: { status: "halted" } }, { task_id: "t1", role: "dev", status: "completed", result_json: { status: "halted" } }] } } }));
    if (o.journal !== false && o.spec !== false) writeFileSync(join(runDir, "deferred", KEY, `${KEY}-spec.md`), specOf(o.halt ?? HALT), "utf-8");
    return runDir;
  }

  /** The snapshot as the host sees it: complete (the sandbox's view is the stale one). */
  function writeSnapshot(wt: string) {
    const dir = join(wt, ...GEN.split("/"));
    const outputs = Object.fromEntries(FILES.filter((f) => f !== "manifest.json").map((f) => [f, "0".repeat(64)]));
    for (const f of Object.keys(outputs)) { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), `# ${f}\n`); }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ outputs }));
    return dir;
  }

  /** A launched run (the worker's cost `cost`, or none) whose engine E1 halted twice; `plansync.py stage` answered (recorded). */
  async function launchedHalted(o: { cost?: number | null; snapshot?: boolean; journal?: boolean; halt?: string; spec?: boolean; decision?: string; state?: "complete" | "blocked"; reason?: string } = {}) {
    const fx = await fixture({ baseRef: "main" });
    const wt = await prepareWorktree(fx.queue, fx.run, "proj", fx.repo.checkout, fx.deps);
    fx.queue.markVerbStarted(fx.run.run_id, "wake", [], { target: "skill", definition: fx.defn });
    const cost = o.cost === undefined ? 1.22 : o.cost;
    await mirror(fx.queue, fx.run.run_id, { jobId: "j", defn: fx.defn }, {
      ok: (o.state ?? "complete") === "complete", job_id: "j", run_id: "j-20261106T102330Z", target: "skill", state: o.state ?? "complete", ...(o.reason ? { reason: o.reason } : {}), finish_deferred: true,
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }, ...(cost !== null ? { total_cost_usd: cost } : {}),
    }, async () => ({}), fx.deps);
    const runDir = haltedEngine(wt, "E1", o);
    const snap = o.snapshot ? writeSnapshot(wt) : join(wt, ...GEN.split("/"));
    const carried: string[][] = [];
    const uv = fx.deps.uv!;
    fx.deps.uv = async (root, script, args, t) => {
      if (!script.endsWith("plansync.py")) return uv(root, script, args, t);
      carried.push(args);
      return { exit: 0, stdout: JSON.stringify({ ok: true, story: KEY, spec: null, buffered: true, appended: 3, rows: ["dev|1|a", "dev|2|b", "dev|2|c"] }), stderr: "" };
    };
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    const ev = (kind: string) => fx.queue.events(fx.run.run_id).filter((e) => e.kind === kind);
    return { ...fx, wt, runDir, snap, carried, ev };
  }

  test("CAP-4: no commit, the spec halted: `partial` naming the engine's last record, no leg (one `no changes` skip, no lease), the notice, the worker's cost", async () => {
    const fx = await launchedHalted();
    expect(await commitsAhead(fx.get(), fx.deps)).toEqual([]);
    expect(noStoryEnd(fx.wt, "E1", "stopped")).toMatchObject({ story_key: KEY, word: "halted", attempts: 2, reason: REASON });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get()).toMatchObject({ state: "partial", reason: REASON });
    expect(fx.ev("host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: NO_CHANGES_SKIP, code_head: expect.any(String) }]); // Story 38.5: the code head recorded
    expect(NO_CHANGES_SKIP).toBe("no changes");
    expect(fx.ev("host-verify-leg")).toEqual([]); // the skip notes no lease
    const ended = fx.ev("ended")[0]!;
    expect(ended.detail).toMatchObject({ no_changes: true, closeout: { result: "no changes", worktree: "removed", host_verify: expect.anything() } });
    expect(fx.verbs).toEqual([["finish", "--directory", fx.repo.checkout, "--run-id", "j-20261106T102330Z", "--state", "partial", "--reason", REASON,
      "--status-block", JSON.stringify({ status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"] }), "--total-cost-usd", "1.22"]]);
    const text = noticeText(endNotice(fx.queue, fx.get()));
    expect(text).toContain(`supervisor: run ${fx.run.run_id} ended partial`);
    expect(text).toContain("reason: no story landed: ");
    // CAP-6: the halted rows carried out before the worktree went, into the checkout's buffer.
    expect(fx.carried).toEqual([["stage", "--from-pass", "--run-dir", fx.runDir, "--story", KEY, "--worktree", fx.repo.checkout]]);
    expect(fx.ev(STAGE_CARRY).map((e) => e.detail)).toEqual([{ story_key: KEY, ok: true, rows: ["dev|1|a", "dev|2|b", "dev|2|c"], buffered: true }]);
    const k = fx.queue.events(fx.run.run_id).map((e) => e.kind);
    expect(k.indexOf(STAGE_CARRY)).toBeLessThan(k.indexOf("ended"));
    expect(existsSync(fx.wt)).toBe(false);
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
  });

  test("CAP-4: no worker figure on `launched`: `finish` carries the worker's `accounted` cost", async () => {
    const fx = await launchedHalted({ cost: null });
    fx.queue.note(fx.run.run_id, "accounted", { cost_usd: 1.22 });
    await sweepEngines(fx.queue, fx.deps);
    const finish = fx.verbs[0]!;
    expect(finish[finish.indexOf("--total-cost-usd") + 1]).toBe("1.22");
  });

  test("CAP-4: a commit ahead of the base: the leg runs as before (no `no changes` skip), the launch's end", async () => {
    const fx = await launchedHalted();
    commitIn(fx.wt, "a.txt", "engine: a story");
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.ev("host-verify").map((e) => e.detail?.reason)).not.toContain(NO_CHANGES_SKIP);
    expect(fx.ev("host-verify-leg")).toHaveLength(1);
    expect(fx.get()).toMatchObject({ state: "complete" });
    expect(fx.ev(STAGE_CARRY)).toEqual([]);
  });

  test("CAP-4: no `story-start` in the segment: today's end, the leg still skipped, nothing carried", async () => {
    const fx = await launchedHalted({ journal: false });
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get()).toMatchObject({ state: "complete", reason: null });
    expect(fx.ev("host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: NO_CHANGES_SKIP, code_head: expect.any(String) }]); // Story 38.5: the code head recorded
    expect(fx.carried).toEqual([]);
  });

  test("CAP-4: a resumed engine whose segment journals no `story-start` (`resolve --resume`): the story from the whole journal, its pre-resume attempts counted, `partial`", async () => {
    const fx = await launchedHalted();
    const lines = [{ kind: "run-start" }, { kind: "story-start", story_key: KEY }, { kind: "dev-decision", story_key: KEY, attempt: 1, reason: "first" },
      { kind: "run-paused", story_key: KEY }, { kind: "run-resume" }, { kind: "dev-decision", story_key: KEY, attempt: 2, reason: "second" }];
    writeFileSync(join(fx.runDir, "journal.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""), "utf-8");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(noStoryEnd(fx.wt, "E1", "finished")).toMatchObject({ story_key: KEY, word: "halted", attempts: 2 });
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get()).toMatchObject({ state: "partial", reason: expect.stringContaining(`no story landed: story ${KEY} ended halted after 2 dev attempt(s)`) });
    expect(fx.carried).toHaveLength(1);
  });

  test("CAP-4: a segment with its own `story-start`: the attempts are the segment's alone (the pre-resume ones not counted)", async () => {
    const fx = await launchedHalted();
    const lines = [{ kind: "run-start" }, { kind: "story-start", story_key: KEY }, { kind: "dev-decision", story_key: KEY, attempt: 1, reason: "first" },
      { kind: "run-resume" }, { kind: "story-start", story_key: KEY }, { kind: "dev-decision", story_key: KEY, attempt: 1, reason: "second" }];
    writeFileSync(join(fx.runDir, "journal.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""), "utf-8");
    expect(noStoryEnd(fx.wt, "E1", "finished")).toMatchObject({ story_key: KEY, attempts: 1 });
  });

  test("CAP-5: the render signature over a ready snapshot pauses the ended run (`no-story`); the pass relaunches once; a second halt stays paused for the operator", async () => {
    const fx = await launchedHalted({ snapshot: true });
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get()).toMatchObject({ state: "paused", worktree: fx.wt });
    const paused = fx.ev("paused").at(-1)!.detail!;
    expect(paused).toMatchObject({
      engine: { run_id: "E1", status: "stopped", paused_story_key: KEY, paused_stage: "no-story", paused_reason: REASON },
      no_story: { story_key: KEY, word: "halted", attempts: 2 }, no_changes: true, closeout: { result: "no changes", worktree: "kept" },
    });
    expect(fx.ev("host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: NO_CHANGES_SKIP, code_head: expect.any(String) }]); // Story 38.5: the code head recorded
    expect(fx.ev(STAGE_CARRY)).toHaveLength(1);
    expect(fx.verbs).toEqual([]); // paused: never finished
    expect(existsSync(fx.wt)).toBe(true);

    const relaunched: string[] = [], sent: string[] = [];
    const run0 = fx.deps.run!;
    const deps: PausedDeps = {
      ...fx.deps, self: me,
      run: (bin, args, o) => bin === "bmad-loop" ? Promise.resolve({ exit: 0, stdout: "archived", stderr: "" }) : run0(bin, args, o),
      relaunch: async (q, run) => async () => { relaunched.push(run.run_id); q.markLaunched(run.run_id, "E2", { end: {} }); },
      hygiene: { env: { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" }, fetch: async (_u, init) => { sent.push(String(init?.body ?? "")); return new Response("ok"); } },
    };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(relaunched).toEqual([fx.run.run_id]);
    expect(fx.get()).toMatchObject({ state: "running", engine_run_id: "E2" });
    expect(existsSync(fx.snap)).toBe(false);
    expect(existsSync(join(fx.runDir, "deferred", KEY, `${KEY}-spec.md`))).toBe(false);
    const co = fx.ev("close-out").at(-1)!.detail!;
    expect(co).toMatchObject({ reason: "stale-render-view", halted_story: KEY, archive: "archived" });
    expect(co.story_key).toBeUndefined(); // `finishedStories` never counts the halted story
    expect(fx.ev(AUTO_RESUME).map((e) => e.detail)).toEqual([expect.objectContaining({ attempt: 1, story_key: KEY, engine_run_id: "E1", resumed: true, via: "relaunch", status_word: "halted" })]);
    expect(sent).toHaveLength(1);

    // The relaunched engine halts on the same render: paused again, the pass records attempt 2 and relaunches nothing.
    haltedEngine(fx.wt, "E2");
    writeSnapshot(fx.wt);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.run.run_id]);
    expect(fx.get()).toMatchObject({ state: "paused" });
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(relaunched).toHaveLength(1);
    expect(fx.ev(AUTO_RESUME).map((e) => [e.detail!.attempt, e.detail!.resumed])).toEqual([[1, true], [2, false]]);
    expect(sent.at(-1)).toContain("stays paused for the operator");
    expect(fx.get()).toMatchObject({ state: "paused" });
  });

  test("CAP-5: no ready snapshot (the host sees it incomplete): no pause, the `partial` end", async () => {
    const fx = await launchedHalted({ snapshot: true });
    writeFileSync(join(fx.snap, "workflow.md"), "");
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get()).toMatchObject({ state: "partial", reason: REASON });
  });

  /** `git log --oneline` answered by `answer(n)` on its n-th call (1-based; undefined: the real git). */
  function failLog(fx: Awaited<ReturnType<typeof launchedHalted>>, answer: (n: number) => RunResult | undefined) {
    const run0 = fx.deps.run!;
    let n = 0;
    fx.deps.run = (bin, args, o) => {
      if (bin === "git" && args[0] === "log" && args[1] === "--oneline") { const r = answer(++n); if (r) return Promise.resolve(r); }
      return run0(bin, args, o);
    };
  }
  const LOG_FAILED: RunResult = { exit: 128, stdout: "", stderr: "fatal: bad revision" };

  test("CAP-4: a failed `commitsAhead` probe (git log exits non-zero): the leg runs as before, no `no changes` skip", async () => {
    const fx = await launchedHalted();
    failLog(fx, (n) => n === 1 ? LOG_FAILED : undefined);
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.ev("host-verify").map((e) => e.detail?.reason)).not.toContain(NO_CHANGES_SKIP);
    expect(fx.ev("host-verify-leg")).toHaveLength(1);
    expect(fx.ev(STAGE_CARRY)).toEqual([]);
    expect(fx.get()).toMatchObject({ state: "complete" });
  });

  test("CAP-4: a close-out that errors with zero commits ahead (the probe answered `[]`): still `partial` with the no-story reason", async () => {
    const fx = await launchedHalted();
    failLog(fx, (n) => n === 2 ? LOG_FAILED : undefined); // the probe answers, the close-out's own read fails
    await sweepEngines(fx.queue, fx.deps);
    const ended = fx.ev("ended")[0]!;
    expect(ended.detail!.no_changes).toBeUndefined();
    expect(ended.detail).toMatchObject({ closeout: { result: "failed", error: expect.stringContaining("git log exit 128") } });
    expect(fx.get()).toMatchObject({ state: "partial", reason: REASON });
    expect(fx.ev("host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: NO_CHANGES_SKIP, code_head: expect.any(String) }]); // Story 38.5: the code head recorded
  });

  test("CAP-4: the no-story override replaces only a `complete` end: a `blocked` end keeps its state and reason", async () => {
    const fx = await launchedHalted({ state: "blocked", reason: "the worker blocked: guard tripped" });
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get()).toMatchObject({ state: "blocked", reason: "the worker blocked: guard tripped" });
    expect(fx.ev("host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: NO_CHANGES_SKIP, code_head: expect.any(String) }]); // Story 38.5: the code head recorded
  });

  test("CAP-5: the halt pause whose close-out does not report `no_changes`: never `complete`, `partial` with the no-story reason", async () => {
    const fx = await launchedHalted({ snapshot: true });
    failLog(fx, (n) => n === 2 ? LOG_FAILED : undefined);
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get()).toMatchObject({ state: "partial", reason: REASON });
    expect(fx.ev("paused")).toEqual([]);
  });

  test("CAP-5: a HALT text longer than 300 characters whose generation path straddles character 300: the signature holds, the reason alone is clipped", async () => {
    const lead = "the rendered skill is unreadable from inside the sandbox: ";
    const tail = `/home/agent/w/${GEN}/`;
    const pad = "p".repeat(300 - lead.length - 1 - tail.length + 10);
    const long = `${lead}${pad} ${tail} shows ${FILES.slice(0, 5).map((f) => `-????????? ? ? ? ? ? ${f}`).join(", ")}`;
    const cut = long.slice(0, 300);
    expect(cut).toContain(GEN.slice(0, GEN.length - 10)); // the clip falls inside the generation segment
    expect(cut).not.toContain(GEN);
    const fx = await launchedHalted({ snapshot: true, halt: long });
    const reason = `no story landed: story ${KEY} ended halted after 2 dev attempt(s): ${cut}; engine ended 'stopped'`;
    expect(noStoryEnd(fx.wt, "E1", "stopped")).toMatchObject({ halt: cut, reason, haltText: long });
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.get()).toMatchObject({ state: "paused" });
    expect(fx.ev("paused").at(-1)!.detail).toMatchObject({ engine: { paused_stage: "no-story", paused_reason: reason }, no_story: { halt_text: long } });
    // The pass signs the unclipped HALT text the pause carries (the clipped reason names a second, truncated folder): it
    // recognises the pause the sweep wrote and relaunches it once.
    const relaunched: string[] = [];
    const run0 = fx.deps.run!;
    const deps: PausedDeps = {
      ...fx.deps, self: me,
      run: (bin, args, o) => bin === "bmad-loop" ? Promise.resolve({ exit: 0, stdout: "archived", stderr: "" }) : run0(bin, args, o),
      relaunch: async (q, run) => async () => { relaunched.push(run.run_id); q.markLaunched(run.run_id, "E2", { end: {} }); },
      hygiene: { env: {}, fetch: async () => new Response("ok") },
    };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(relaunched).toEqual([fx.run.run_id]);
    expect(fx.get()).toMatchObject({ state: "running", engine_run_id: "E2" });
    expect(fx.ev(AUTO_RESUME).map((e) => e.detail)).toEqual([expect.objectContaining({ attempt: 1, story_key: KEY, resumed: true, via: "relaunch", snapshot: GEN })]);
  });

  test("CAP-5: the signature carried by the dev-decision reason alone, no spec found: never paused (the pass would refuse it), the `partial` end", async () => {
    const fx = await launchedHalted({ snapshot: true, spec: false, decision: HALT });
    expect(noStoryEnd(fx.wt, "E1", "stopped")).toMatchObject({ story_key: KEY, haltText: HALT });
    expect(noStoryEnd(fx.wt, "E1", "stopped")!.spec).toBeUndefined();
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.ev("paused")).toEqual([]);
    expect(fx.get()).toMatchObject({ state: "partial", reason: expect.stringContaining(`no story landed: story ${KEY} ended halted`) });
  });

  test("CAP-5: a tracked spec (in the index): never paused (the pass would refuse it), the `partial` end", async () => {
    const fx = await launchedHalted({ snapshot: true });
    testGit(fx.wt, "add", "-f", "--", `.bmad-loop/runs/E1/deferred/${KEY}/${KEY}-spec.md`);
    await sweepEngines(fx.queue, fx.deps);
    expect(fx.ev("paused")).toEqual([]);
    expect(fx.get()).toMatchObject({ state: "partial", reason: REASON });
  });

  describe("noStoryEnd's fallbacks", () => {
    /** A served root whose engine `eid` started KEY: `decisions` dev-decision reasons, an optional state.json word and spec. */
    function served(o: { decisions?: string[]; session?: string; spec?: string } = {}) {
      const root = tempDir("tk-sup-wt-nostory-");
      const runDir = join(root, ".bmad-loop", "runs", "E1");
      mkdirSync(runDir, { recursive: true });
      const lines = [{ kind: "run-start" }, { kind: "story-start", story_key: KEY }, ...(o.decisions ?? []).map((reason, i) => ({ kind: "dev-decision", story_key: KEY, attempt: i + 1, reason }))];
      writeFileSync(join(runDir, "journal.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""), "utf-8");
      if (o.session !== undefined) writeFileSync(join(runDir, "state.json"), JSON.stringify({ tasks: { [KEY]: { sessions: [{ result_json: { status: "completed" } }, { result_json: { status: o.session } }] } } }), "utf-8");
      if (o.spec !== undefined) { mkdirSync(join(runDir, "deferred", KEY), { recursive: true }); writeFileSync(join(runDir, "deferred", KEY, `${KEY}-spec.md`), o.spec, "utf-8"); }
      return root;
    }

    test("no spec: the word from the last session's `result_json.status`, the HALT text from the last `dev-decision` reason", () => {
      const root = served({ decisions: ["first reason", "spec status is 'halted', expected 'done'"], session: "halted" });
      expect(noStoryEnd(root, "E1", "stopped")).toMatchObject({ story_key: KEY, word: "halted", attempts: 2, halt: "spec status is 'halted', expected 'done'",
        reason: `no story landed: story ${KEY} ended halted after 2 dev attempt(s): spec status is 'halted', expected 'done'; engine ended 'stopped'` });
    });

    test("no spec and no session word: `unknown`; no reason either: `no HALT text recorded`", () => {
      expect(noStoryEnd(served({ decisions: ["the dev session timed out"] }), "E1", "stopped")).toMatchObject({ word: "unknown", attempts: 1, halt: "the dev session timed out" });
      expect(noStoryEnd(served(), "E1", "stopped")).toMatchObject({ word: "unknown", attempts: 0, halt: "no HALT text recorded" });
    });

    test("a spec with no `Blocking condition:`: the HALT text from the first Auto Run Result line that is not `Status:`", () => {
      const spec = `---\nstatus: halted\n---\n\n## Auto Run Result\n\nStatus: halted\n\nThe renderer could not read workflow.md.\nA second line.\n\n## Next\n`;
      expect(noStoryEnd(served({ decisions: ["a dev-decision reason"], session: "completed", spec }), "E1", "stopped"))
        .toMatchObject({ word: "halted", halt: "The renderer could not read workflow.md." });
    });
  });
});

