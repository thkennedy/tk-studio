// Story 27.3: a paused run whose story landed is closed out by the service — the three outcomes of the
// paused-run pass, the resume route and the restart caution, pinned against a real throwaway repository,
// the fake `sbx` (its in-VM `bmad-loop archive|resolve`), a fake `meter.py` under a temp TK_STUDIO_ROOT and a
// fake launch worker (the engine). Never a real sandbox, engine or ledger.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createApi } from "../src/api";
import { closeOutOrphans, relauncher, type Started } from "../src/cli";
import { closableVerdict, closeOutPaused, ESCALATION_BLOCKED_REASON, findSpec, frontmatter, harvestMessage, jiraBound, landing, launchedSinceMove, NOT_HANDED, resumePaused, ResumeRefused, trackArgs, type PausedDeps } from "../src/closeout";
import { renderPage, type PageData } from "../src/page";
import { Queue, type Owner, type Probes } from "../src/queue";
import { runProcess, toVmPath, type RunResult } from "../src/server";
import { COPIED_RUNTIME, launchedCloseOutInput, storyLandedBeforeStop, sweepEngines } from "../src/worktree";
import { fakeGh, fakeSbx, fakeStudioRoot, gitRepo, RUNTIME_GITIGNORE, testGit } from "./fakes";
import { tempDir } from "./tmp";

const SB = "claude-p";
const E1 = "20261016-101010-ab12", E2 = "20261016-121212-cd34";
const STUDIO_RUN = "launch-27-20261016T101010Z";
const KEY = "9-1-the-landed-story";
const LAUNCH = { id: "launch-27", trigger: "one-shot", target: { skill: "tk-studio-launch" }, guards: { max_wall_clock_seconds: 600 } };
const WAKE = { state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: { epic: 9 } }, routing: null };
const PR = "https://github.com/acme/widget/pull/42";
const me: Owner = { pid: process.pid, host: hostname(), nonce: "closeout-test" };
const dead: Owner = { pid: 999_999_1, host: hostname(), nonce: "closeout-dead-driver" };
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };

let sbx: ReturnType<typeof fakeSbx>;
let studio: ReturnType<typeof fakeStudioRoot>;
beforeAll(() => { sbx = fakeSbx(); studio = fakeStudioRoot(); });

/** Hole 38: an sbx run's engine status (`launch.py status`) is read inside its sandbox, so the fake `sbx`
 * answers it; a test's host `uv` override keeps answering a host-tier run. `"fail"`: the probe fails. */
const statusAnswer = (run: Record<string, unknown> | "fail") =>
  sbx.answer({ ...sbx.answers(), launch_status: run === "fail" ? "fail" : { ok: true, runs: [], live: [], run } });
afterAll(() => {
  // Every `sbx` call was argv only: no shell, no `-c` string; the pin was never released by the pass.
  for (const c of sbx.calls()) for (const a of c.argv) expect(["bash", "sh", "-c", "-lc", "--force"]).not.toContain(a);
});

/** A spec's markdown with its frontmatter. */
const spec = (status: string, verdict?: string) =>
  `---\ntitle: 'The landed story'\nstatus: ${status}\n${verdict !== undefined ? `reconcile_verdict: '${verdict}'\n` : ""}---\n\n# body\n`;

/** One paused sbx launch run: a real worktree on `supervisor/run-<id>` (cut from a real repo), engine E1's run
 * dir, the story's spec (uncommitted: the engine's staged harvest), the run launched then paused at `stage`. */
async function pausedRun(opts: { status?: string; verdict?: string; stage?: string; key?: string | null; tier?: "sbx" | "host"; spec?: boolean; paused?: boolean } = {}) {
  const repo = gitRepo();
  const work = tempDir("tk-sup-co-work-");
  const queue = new Queue(":memory:", { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) });
  const tier = opts.tier ?? "sbx";
  const run0 = queue.enqueue({
    jobId: "launch-27", root: repo.checkout, projectId: "p27", definition: LAUNCH, owner: me, tier, ...(tier === "sbx" ? { sandbox: SB } : {}),
  }).run;
  expect((await queue.claim(run0.run_id, me)).claimed).toBe(true);
  const wt = join(work, "worktrees", "p27", run0.run_id);
  testGit(repo.checkout, "worktree", "add", "--relative-paths", wt, "-b", `supervisor/run-${run0.run_id}`, "main");
  queue.recordWorktree(run0.run_id, wt, { branch: `supervisor/run-${run0.run_id}`, base_ref: "main" });
  if (tier === "sbx") queue.note(run0.run_id, "pinned", { sandbox: SB });
  queue.setStudioRun(run0.run_id, STUDIO_RUN);
  queue.setWake(run0.run_id, WAKE);
  queue.setSession(run0.run_id, "11111111-1111-4111-8111-111111111111");
  const runDir = join(wt, ".bmad-loop", "runs", E1);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "engine.pid"), "6509 125610.0");
  // The dev commit landed; the engine's own bookkeeping (the spec at done, the ledger) is not committed.
  writeFileSync(join(wt, "story.txt"), "the story's code\n");
  testGit(wt, "add", "story.txt");
  testGit(wt, "commit", "-q", "-m", "feat: the landed story");
  const key = opts.key === undefined ? KEY : opts.key;
  if (opts.spec !== false && key) {
    mkdirSync(join(wt, "_bmad-output", "specs", "spec-epic-9", "stories"), { recursive: true });
    writeFileSync(join(wt, "_bmad-output", "specs", "spec-epic-9", "stories", `${key}-spec.md`), spec(opts.status ?? "done", opts.verdict));
  }
  const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [`.bmad-loop/runs/${E1}`] };
  queue.markLaunched(run0.run_id, E1, { status_block: BLOCK, end: { state: "complete", reason: null } });
  if (opts.paused !== false) queue.markPaused(run0.run_id, {
    engine: { run_id: E1, status: "running", paused_stage: opts.stage ?? "escalation", paused_reason: "reconcile asks for a ruling", ...(key ? { paused_story_key: key } : {}) },
    pr: PR, closeout: { result: "draft PR", worktree: "kept" },
  });
  return { repo, wt, runDir, queue, run: queue.get(run0.run_id)!, get: () => queue.get(run0.run_id)! };
}

/** The pass's deps: real git (a test identity), the fake meter.py through real `uv`, the fake `sbx`, a
 * notifier answered by `sent`, the real relaunch driver with the fake launch worker. `order` logs each step. */
function passDeps(fx: Awaited<ReturnType<typeof pausedRun>>, o: { notify?: boolean; launchEngine?: string } = {}) {
  const order: string[] = [];
  const sent: string[] = [];
  const invoked: { skill: string; args: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
  const env: Record<string, string | undefined> = {
    ...process.env, ...IDENTITY, TK_STUDIO_ROOT: studio.root, SBX_BIN: sbx.bin, GH_BIN: "/nonexistent-gh",
    ...(o.notify === false ? { TK_SUPERVISOR_NOTIFY: "" } : { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/tk-topic" }),
  };
  const sbxRun = (bin: string, args: string[], opts: { timeoutS: number }) => { order.push(`sbx ${args.slice(0, 4).join(" ")}`); return runProcess(bin, args, { timeoutS: opts.timeoutS }); };
  const started: Started = {
    jobId: "launch-27", root: fx.repo.checkout, projectId: "p27", runId: STUDIO_RUN, guardS: 600, defn: LAUNCH, woke: WAKE,
    tier: fx.run.tier === "sbx" ? "sbx" : "host", ...(fx.run.tier === "sbx" ? { sandbox: SB } : {}), workRoot: fx.wt, sessionId: fx.run.session_id ?? undefined,
  };
  const worktree = {
    env,
    run: async (bin: string, args: string[], opts: { cwd: string; timeoutS: number; env?: Record<string, string | undefined> }): Promise<RunResult> => {
      order.push(`${bin} ${args[0]}`);
      if (bin === "bmad-loop") return { exit: 0, stdout: "archived", stderr: "" }; // the host tier's bmad-loop (never real)
      return runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...env, ...(opts.env ?? {}) } });
    },
    uv: async (root: string, script: string, args: string[], timeoutS?: number) => {
      order.push(`uv ${script.split(/[\\/]/).at(-1)} ${args[0]}`);
      return runProcess("uv", ["run", script, ...args], { cwd: root, timeoutS: timeoutS ?? 120, env: { ...env, PYTHONIOENCODING: "utf-8" } });
    },
    sbx: { env, run: sbxRun },
  };
  const relaunch = relauncher({
    worktree, verbRunner: async () => ({ ok: true }),
    rebuild: async (_q, run, wake) => { order.push("rebuild"); expect(wake).toEqual(WAKE); return { ...started, sessionId: run.session_id ?? undefined }; },
    invoke: async (_root, skill, args, _spawner, opts = {}) => {
      order.push("invoke");
      invoked.push({ skill, args: args as Record<string, unknown>, opts: opts as Record<string, unknown> });
      if (opts.pin && args.sandbox) expect(await opts.pin(String(args.sandbox))).toBeNull();
      return { exit: 0, worker_elapsed_s: 1, status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [`.bmad-loop/runs/${o.launchEngine ?? E2}`] } };
    },
  });
  const deps: PausedDeps = {
    ...worktree, self: me, relaunch,
    hygiene: { env, fetch: async (_url, init) => { sent.push(String(init?.body ?? "")); return new Response("ok", { status: 200 }); } },
  };
  return { deps, order, sent, invoked };
}

const kinds = (q: Queue, id: string) => q.events(id).map((e) => e.kind);
/** The resolve child has exited and handed the run back: a `launched` after the `engine-resume`. Never "the
 * last event is `launched`": the resume's `engine-pid` re-read can land after the child's hand-back. */
const handedBack = (fx: { queue: Queue; run: { run_id: string } }) => launchedSinceMove(fx.queue.events(fx.run.run_id));
/** The page's HTML for one run of a fixture. */
const pageFor = (fx: Awaited<ReturnType<typeof pausedRun>>) => renderPage({
  generated: "2026-10-16T00:00:00Z", secrets: { token: "t-page", env: {} }, counts: { paused: 1 }, jobs: [], locks: [], statusBlocks: [], runsOmitted: 0,
  ledger: { path: "ledger", note: "none" }, registry: { ok: false, note: "none" },
  runs: [{
    run: fx.get(), resumes: 0, cost: null, events: fx.queue.events(fx.run.run_id), eventsOmitted: 0, workspace: null,
    runJson: { ok: false, note: "none" }, handoff: { ok: false, note: "none" },
  }],
} as PageData);
const ev = (q: Queue, id: string, kind: string) => q.events(id).filter((e) => e.kind === kind);

// ---------------------------------------------------------------- the spec read

describe("the paused story's spec and verdict", () => {
  test("frontmatter: only top-level keys, quotes stripped; findSpec: implementation-artifacts first, else one stories match", () => {
    expect(frontmatter(spec("done", "no-impact"))).toMatchObject({ status: "done", reconcile_verdict: "no-impact" });
    expect(frontmatter("no frontmatter\nstatus: done\n")).toEqual({});
    const wt = tempDir("tk-sup-co-spec-");
    expect(findSpec(wt, KEY)).toBeUndefined();
    mkdirSync(join(wt, "_bmad-output", "specs", "a", "stories"), { recursive: true });
    writeFileSync(join(wt, "_bmad-output", "specs", "a", "stories", `${KEY}-spec.md`), spec("done"));
    expect(findSpec(wt, KEY)).toBe(join(wt, "_bmad-output", "specs", "a", "stories", `${KEY}-spec.md`));
    mkdirSync(join(wt, "_bmad-output", "specs", "b", "stories"), { recursive: true });
    writeFileSync(join(wt, "_bmad-output", "specs", "b", "stories", `${KEY}-other.md`), spec("done"));
    expect(findSpec(wt, KEY)).toBeUndefined(); // two matches: none
    mkdirSync(join(wt, "_bmad-output", "implementation-artifacts"), { recursive: true });
    writeFileSync(join(wt, "_bmad-output", "implementation-artifacts", `spec-${KEY}.md`), spec("done"));
    expect(findSpec(wt, KEY)).toBe(join(wt, "_bmad-output", "implementation-artifacts", `spec-${KEY}.md`));
    expect(findSpec(wt, "../escape")).toBeUndefined();
  });

  test("the verdict is read as YAML: comments, any case of `escalate`, null/~/empty, block scalars and non-strings never close out", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const file = join(fx.wt, "_bmad-output", "specs", "spec-epic-9", "stories", `${KEY}-spec.md`);
    const rule = (line: string) => {
      writeFileSync(file, `---\ntitle: 'x'\nstatus: done # landed\n${line}\n---\n\n# body\n`);
      return landing(fx.run, fx.queue.events(fx.run.run_id));
    };
    for (const line of ["reconcile_verdict: escalate # needs a human", "reconcile_verdict: Escalate", "reconcile_verdict: ' ESCALATE '", "reconcile_verdict: |\n  escalate"]) {
      expect(rule(line)).toMatchObject({ outcome: "awaiting-ruling", reason: "reconcile_verdict: escalate" });
    }
    for (const line of ["reconcile_verdict: null", "reconcile_verdict: ~", "reconcile_verdict: ''", "reconcile_verdict:", "reconcile_verdict: |", "reconcile_verdict: >\n",
      "reconcile_verdict: 3", "reconcile_verdict: true", "reconcile_verdict: [no-impact]", "reconcile_verdict: {v: no-impact}", "# reconcile_verdict: no-impact"]) {
      expect(rule(line)).toMatchObject({ outcome: "awaiting-ruling", reason: "no reconcile_verdict recorded" });
    }
    expect(rule("reconcile_verdict: no-impact # checked")).toMatchObject({ outcome: "close-out", verdict: "no-impact" });
    expect(rule("reconcile_verdict: \"adjust-stories\"")).toMatchObject({ outcome: "close-out", verdict: "adjust-stories" });
    for (const v of [null, undefined, "", "  ", "escalate", " Escalate ", 3, ["no-impact"]]) expect(closableVerdict(v)).toBe(false);
    expect(closableVerdict(" no-impact ")).toBe(true);
    // Frontmatter that is not YAML, or not a mapping, reads as none.
    expect(frontmatter("---\nstatus: [done\n---\n")).toEqual({});
    expect(frontmatter("---\n- done\n---\n")).toEqual({});
    expect(frontmatter("---\nstatus: done\n")).toEqual({}); // unterminated
  });

  test("landing: closable verdicts close out; none or `escalate` await a ruling; anything else is left for the resume", async () => {
    for (const v of ["no-impact", "not-required", "adjust-stories"]) {
      const fx = await pausedRun({ verdict: v });
      expect(landing(fx.run, fx.queue.events(fx.run.run_id))).toMatchObject({ outcome: "close-out", story_key: KEY, verdict: v });
    }
    const none = await pausedRun({});
    expect(landing(none.run, none.queue.events(none.run.run_id))).toMatchObject({ outcome: "awaiting-ruling", reason: "no reconcile_verdict recorded" });
    const empty = await pausedRun({ verdict: "" });
    expect(landing(empty.run, empty.queue.events(empty.run.run_id))).toMatchObject({ outcome: "awaiting-ruling", reason: "no reconcile_verdict recorded" });
    const esc = await pausedRun({ verdict: "escalate" });
    expect(landing(esc.run, esc.queue.events(esc.run.run_id))).toMatchObject({ outcome: "awaiting-ruling", reason: "reconcile_verdict: escalate" });
    const notDone = await pausedRun({ status: "in-review", verdict: "no-impact" });
    expect(landing(notDone.run, notDone.queue.events(notDone.run.run_id))).toMatchObject({ outcome: "not-landed" });
    const noKey = await pausedRun({ key: null });
    expect(landing(noKey.run, noKey.queue.events(noKey.run.run_id))).toEqual({ outcome: "not-landed", why: "no paused story key" });
    const noSpec = await pausedRun({ spec: false, verdict: "no-impact" });
    expect(landing(noSpec.run, noSpec.queue.events(noSpec.run.run_id))).toMatchObject({ outcome: "not-landed", why: `no spec found for story ${KEY}` });
    // Block If: another paused stage with a done spec is never widened into AC1.
    const boundary = await pausedRun({ stage: "epic-boundary", verdict: "no-impact" });
    expect(landing(boundary.run, boundary.queue.events(boundary.run.run_id))).toMatchObject({ outcome: "not-landed" });
  }, 60_000); // nine real worktrees through git: past bun's 5 s default on a Windows host (api.test.ts uses the same budget)
});

// ---------------------------------------------------------------- AC1

describe("AC1: a landed story with a closable verdict is closed out and the epic relaunched", () => {
  test("commit → meter → archive → relaunch (`close-out`), the pinning recorder, a new `launched`; the story never re-driven", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    const headBefore = testGit(fx.wt, "rev-parse", "HEAD");
    const out = await closeOutPaused(fx.queue, p.deps);
    expect(out).toEqual({ closed: [fx.run.run_id], awaiting: [] });

    // The order: the harvest commit, the meter, the archive (VM home first), then the relaunch.
    const steps = p.order.filter((s) => s.startsWith("git commit") || s.startsWith("uv meter.py") || s.includes("bmad-loop") || s === "rebuild" || s === "invoke" || s.startsWith("sbx run"));
    expect(steps).toEqual([
      "git commit", "uv meter.py harvest", `sbx exec ${SB} /home/agent/.local/bin/bmad-loop archive`, "rebuild", "invoke", `sbx run -d --name ${SB}`,
    ]);
    expect(p.order.indexOf(`sbx exec ${SB} printenv HOME`)).toBeLessThan(p.order.indexOf(`sbx exec ${SB} /home/agent/.local/bin/bmad-loop archive`));

    // The harvest commit: on the run branch, the named message, a child of the dev commit (never a squash).
    expect(testGit(fx.wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe(`supervisor/run-${fx.run.run_id}`);
    expect(testGit(fx.wt, "log", "-1", "--format=%s")).toBe(harvestMessage(KEY, fx.run.run_id, E1));
    expect(harvestMessage(KEY, fx.run.run_id, E1)).toBe(`supervisor: close-out harvest for ${KEY} (run ${fx.run.run_id}, engine ${E1})`);
    expect(testGit(fx.wt, "rev-parse", "HEAD~1")).toBe(headBefore);
    expect(testGit(fx.wt, "status", "--porcelain", "--untracked-files=no")).toBe("");

    // The meter: `meter.py harvest --run-dir <worktree>/.bmad-loop/runs/<E1>` on the host.
    expect(studio.calls().filter((c) => c.script === "meter").at(-1)!.argv).toEqual(["harvest", "--run-dir", fx.runDir]);
    // The archive: through `sbx exec`, the VM binary, the VM worktree, no --force; the run dir gone.
    expect(sbx.calls().map((c) => c.argv)).toContainEqual(["exec", SB, "/home/agent/.local/bin/bmad-loop", "archive", "--project", toVmPath(fx.wt), E1]);
    expect(existsSync(fx.runDir)).toBe(false);
    expect(existsSync(join(fx.wt, ".bmad-loop", "archive", E1))).toBe(true);

    // The `close-out` move, then the relaunch's new `launched` under the same queue run.
    const k = kinds(fx.queue, fx.run.run_id);
    expect(k.lastIndexOf("close-out")).toBeLessThan(k.lastIndexOf("launched"));
    const co = ev(fx.queue, fx.run.run_id, "close-out")[0]!;
    expect(co).toMatchObject({ from_state: "paused", to_state: "running" });
    expect(co.detail).toMatchObject({ story_key: KEY, verdict: "no-impact", meter: { ok: true }, archive: "archived", owner: { nonce: me.nonce } });
    expect(co.detail!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(ev(fx.queue, fx.run.run_id, "launched").at(-1)!.detail).toMatchObject({ engine_run_id: E2, lock: { handed_to_engine: E2 } });
    expect(fx.get()).toMatchObject({ state: "running", engine_run_id: E2, owner_pid: null, worktree: fx.wt });
    expect(fx.queue.lock(fx.repo.checkout)).toMatchObject({ kind: "engine", engine_run_id: E2, run_id: fx.run.run_id });

    // The relaunch: `tk-studio-launch` once, its own payload (nothing story-specific), a fresh session, the pin passed.
    expect(p.invoked).toHaveLength(1);
    expect(p.invoked[0]!.skill).toBe("tk-studio-launch");
    expect(p.invoked[0]!.args.payload).toEqual({ epic: 9, run_id: STUDIO_RUN });
    expect(JSON.stringify(p.invoked[0]!.args)).not.toContain(KEY);
    expect(typeof p.invoked[0]!.opts.pin).toBe("function");
    expect(p.invoked[0]!.opts.resume).toBeUndefined();
    expect(p.invoked[0]!.opts.sessionId).not.toBe(fx.run.session_id);
    expect(ev(fx.queue, fx.run.run_id, "pinned")).toHaveLength(2); // the claim's, and the relaunch's idempotent re-pin
    // The pin is never released between the harvest, the archive and the relaunch.
    expect(k).not.toContain("pin-released");
    expect(sbx.calls().some((c) => c.argv[0] === "stop")).toBe(false);
    expect(k).not.toContain("closing-out");
    expect(k).not.toContain("closed_out");
    // Running now: the pass leaves it.
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.invoked).toHaveLength(1);
  });

  test("a failed step leaves the run paused with one `close-out-failed` per (step, error); the next pass retries from it", async () => {
    const fx = await pausedRun({ verdict: "not-required" });
    const p = passDeps(fx);
    studio.answer({ meter: "fail" });
    try {
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    } finally { studio.answer({}); }
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null, engine_run_id: E1 });
    const failures = ev(fx.queue, fx.run.run_id, "close-out-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toMatchObject({ story_key: KEY, engine_run_id: E1, step: "meter" });
    expect(String(failures[0]!.detail!.error)).toContain("fake meter failed");
    // The commit was done once and is not undone; the archive never ran.
    expect(testGit(fx.wt, "log", "--format=%s").split("\n").filter((s) => s.startsWith("supervisor: close-out harvest"))).toHaveLength(1);
    expect(existsSync(fx.runDir)).toBe(true);
    expect(p.invoked).toHaveLength(0);

    // The meter answers again: the commit is `nothing to commit`, then the rest runs.
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
    expect(ev(fx.queue, fx.run.run_id, "close-out")[0]!.detail).toMatchObject({ commit: "nothing to commit", archive: "archived" });
    expect(testGit(fx.wt, "log", "--format=%s").split("\n").filter((s) => s.startsWith("supervisor: close-out harvest"))).toHaveLength(1);
    expect(fx.get()).toMatchObject({ state: "running", engine_run_id: E2 });
  });

  test("an archive refused, then a relaunch that cannot be rebuilt: still paused, each failure once; an archived run dir counts done", async () => {
    const fx = await pausedRun({ verdict: "adjust-stories" });
    const p = passDeps(fx);
    sbx.answer({ archive: "fail" });
    try { await closeOutPaused(fx.queue, p.deps); } finally { sbx.answer({}); }
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed").map((e) => e.detail!.step)).toEqual(["archive"]);
    expect(fx.get().state).toBe("paused");
    const failing: PausedDeps = { ...p.deps, relaunch: async () => { throw new Error("registry: project 'p27' is not registered"); } };
    await closeOutPaused(fx.queue, failing);
    await closeOutPaused(fx.queue, failing);
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed").map((e) => e.detail!.step)).toEqual(["archive", "relaunch"]);
    expect(existsSync(fx.runDir)).toBe(false); // archived on the second pass: never archived again
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
    expect(kinds(fx.queue, fx.run.run_id)).not.toContain("close-out");
    // The rebuild answers: the meter and the archive count done (run dir gone), the relaunch runs.
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
    expect(ev(fx.queue, fx.run.run_id, "close-out")[0]!.detail).toMatchObject({ commit: "nothing to commit", archive: "already archived" });
    // The engine's runtime state (its run dir, then its archived one) is never committed to the run branch.
    const paths = testGit(fx.wt, "log", "--name-only", "--format=", `main..supervisor/run-${fx.run.run_id}`).split("\n").filter(Boolean);
    expect(paths).toContain(`_bmad-output/specs/spec-epic-9/stories/${KEY}-spec.md`);
    expect(paths.filter((f) => f.startsWith(".bmad-loop/runs") || f.startsWith(".bmad-loop/archive"))).toEqual([]);
    expect(existsSync(join(fx.wt, ".bmad-loop", "archive", E1, "engine.pid"))).toBe(true);
    expect(testGit(fx.wt, "log", "--format=%s").split("\n").filter((s) => s.startsWith("supervisor: close-out harvest"))).toHaveLength(1);
  });

  test("a project that ignores both `.bmad-loop/runs` and `.bmad-loop/archive`: the harvest commit succeeds and commits neither; a clean retry is `nothing to commit`", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    // The project ignores the engine's archive dir too (committed before the pause: never part of the harvest).
    writeFileSync(join(fx.wt, ".gitignore"), `${RUNTIME_GITIGNORE}.bmad-loop/archive/\n`);
    testGit(fx.wt, "add", ".gitignore");
    testGit(fx.wt, "commit", "-q", "-m", "chore: ignore the engine archive");
    const head = testGit(fx.wt, "rev-parse", "HEAD");
    // An earlier engine's archived run dir beside E1's live one: both ignored, both present.
    mkdirSync(join(fx.wt, ".bmad-loop", "archive", "20261015-090909-ee00"), { recursive: true });
    writeFileSync(join(fx.wt, ".bmad-loop", "archive", "20261015-090909-ee00", "engine.pid"), "6400 120000.0");
    expect(testGit(fx.wt, "check-ignore", ".bmad-loop/runs", ".bmad-loop/archive").split("\n")).toEqual([".bmad-loop/runs", ".bmad-loop/archive"]);
    // The runtime `materialise` copied in, present and ignored too: `git add` still exits 0.
    for (const rel of COPIED_RUNTIME) { mkdirSync(join(fx.wt, rel, ".."), { recursive: true }); writeFileSync(join(fx.wt, rel), "machine-local\n"); }
    expect(testGit(fx.wt, "check-ignore", ...COPIED_RUNTIME).split("\n")).toEqual([...COPIED_RUNTIME]);
    const specPath = `_bmad-output/specs/spec-epic-9/stories/${KEY}-spec.md`;

    // The meter fails, so the pass stops right after the commit step: the commit itself succeeded.
    studio.answer({ meter: "fail" });
    try { expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] }); }
    finally { studio.answer({}); }
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed").map((e) => e.detail!.step)).toEqual(["meter"]);
    expect(testGit(fx.wt, "log", "-1", "--format=%s")).toBe(harvestMessage(KEY, fx.run.run_id, E1));
    expect(testGit(fx.wt, "rev-parse", "HEAD~1")).toBe(head);
    const files = testGit(fx.wt, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(files).toEqual([specPath]);
    expect(files.filter((f) => f.startsWith(".bmad-loop/runs") || f.startsWith(".bmad-loop/archive"))).toEqual([]);

    // The retry: a clean index is `nothing to commit` (never a commit failure); the archive (now an ignored dir) runs.
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
    expect(ev(fx.queue, fx.run.run_id, "close-out")[0]!.detail).toMatchObject({ commit: "nothing to commit", archive: "archived" });
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed").map((e) => e.detail!.step)).toEqual(["meter"]);
    const paths = testGit(fx.wt, "log", "--name-only", "--format=", `main..supervisor/run-${fx.run.run_id}`).split("\n").filter(Boolean);
    expect(paths.filter((f) => f.startsWith(".bmad-loop/runs") || f.startsWith(".bmad-loop/archive"))).toEqual([]);
    expect(existsSync(join(fx.wt, ".bmad-loop", "archive", E1, "engine.pid"))).toBe(true);
    expect(testGit(fx.wt, "log", "--format=%s").split("\n").filter((s) => s.startsWith("supervisor: close-out harvest"))).toHaveLength(1);
  });

  test("a relaunch drive that fails after the new `launched` (mirror throws): stays running on the new engine, one `close-out-failed`, nothing re-run", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    const deps: PausedDeps = {
      ...p.deps,
      relaunch: async (q, run) => async () => {
        q.markLaunched(run.run_id, E2, { end: { state: "complete", reason: null } }); // the new engine has the run
        throw new Error("mirror: studio finish refused");
      },
    };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
    expect(fx.get()).toMatchObject({ state: "running", engine_run_id: E2, owner_pid: null });
    const failures = ev(fx.queue, fx.run.run_id, "close-out-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toMatchObject({ step: "relaunch", engine_run_id: E2 });
    expect(String(failures[0]!.detail!.error)).toContain("mirror: studio finish refused");
    const k = kinds(fx.queue, fx.run.run_id);
    expect(k.lastIndexOf("paused")).toBeLessThan(k.lastIndexOf("close-out"));
    expect(fx.queue.lock(fx.repo.checkout)).toMatchObject({ kind: "engine", engine_run_id: E2 });
    expect(fx.queue.awaitingEngine().map((r) => r.run_id)).toContain(fx.run.run_id);
    // The next pass runs no meter, archive or relaunch.
    const before = p.order.length;
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.order.slice(before)).toEqual([]);
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed")).toHaveLength(1);
    expect(ev(fx.queue, fx.run.run_id, "close-out")).toHaveLength(1);
  });

  test("a relaunch drive that fails before its `launched`: back to `paused`, the engine lock the paused run held restored", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    const lockBefore = fx.queue.lock(fx.repo.checkout);
    expect(lockBefore).toMatchObject({ kind: "engine", engine_run_id: E1, run_id: fx.run.run_id, owner_pid: null });
    const during: unknown[] = [];
    const deps: PausedDeps = {
      ...p.deps,
      relaunch: async (q) => async () => { during.push(q.lock(fx.repo.checkout)); throw new Error("worker spawn failed"); },
    };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] }); // back to paused: not closed
    expect(during[0]).toMatchObject({ kind: "run", owner_nonce: me.nonce }); // the move took it as this process's run lock
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null, engine_run_id: E1 });
    expect(fx.queue.lock(fx.repo.checkout)).toEqual(lockBefore);
    const paused = ev(fx.queue, fx.run.run_id, "paused").at(-1)!;
    expect(paused.detail).toMatchObject({ pr: PR, relaunch_failed: "worker spawn failed", lock_restored: { kind: "engine", engine_run_id: E1 } });
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed").map((e) => e.detail!.step)).toEqual(["relaunch"]);
  });

  test("a project that does not ignore the copied runtime: the harvest commit carries the harvest, never `COPIED_RUNTIME`", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    // The project ignores only the engine's run dir (committed before the pause).
    writeFileSync(join(fx.wt, ".gitignore"), ".bmad-loop/runs/\n");
    testGit(fx.wt, "add", ".gitignore");
    testGit(fx.wt, "commit", "-q", "-m", "chore: ignore only the engine runs");
    for (const rel of COPIED_RUNTIME) { mkdirSync(join(fx.wt, rel, ".."), { recursive: true }); writeFileSync(join(fx.wt, rel), "machine-local\n"); }
    const untracked = testGit(fx.wt, "status", "--porcelain", "--untracked-files=all").split("\n");
    for (const rel of COPIED_RUNTIME) expect(untracked).toContain(`?? ${rel}`);
    studio.answer({ meter: "fail" }); // stop right after the commit step
    try { expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] }); }
    finally { studio.answer({}); }
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed").map((e) => e.detail!.step)).toEqual(["meter"]);
    expect(testGit(fx.wt, "log", "-1", "--format=%s")).toBe(harvestMessage(KEY, fx.run.run_id, E1));
    const files = testGit(fx.wt, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(files).toEqual([`_bmad-output/specs/spec-epic-9/stories/${KEY}-spec.md`]);
    // Still untracked, still in the worktree: never staged.
    const after = testGit(fx.wt, "status", "--porcelain", "--untracked-files=all").split("\n");
    for (const rel of COPIED_RUNTIME) { expect(after).toContain(`?? ${rel}`); expect(existsSync(join(fx.wt, rel))).toBe(true); }
  });

  test("the `close-out` move throws: one `close-out-failed {step: relaunch}`, the drive never runs, still paused, not closed", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    let drove = 0;
    const deps: PausedDeps = { ...p.deps, relaunch: async () => async () => { drove++; } };
    fx.queue.resumeFromPause = () => { throw new Error("database is locked"); };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(drove).toBe(0);
    const failures = ev(fx.queue, fx.run.run_id, "close-out-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toMatchObject({ step: "relaunch", error: "database is locked", story_key: KEY });
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null, engine_run_id: E1 });
    expect(kinds(fx.queue, fx.run.run_id)).not.toContain("close-out");
  });

  test("a relaunch drive that resolves with the run still running and no new `launched` (mirror swallowed its failure): back to `paused`, not closed", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    const lockBefore = fx.queue.lock(fx.repo.checkout);
    const deps: PausedDeps = { ...p.deps, relaunch: async () => async () => ({ ok: false, reason: "markLaunched: database is locked" }) };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null, engine_run_id: E1 });
    expect(fx.queue.lock(fx.repo.checkout)).toEqual(lockBefore);
    const failures = ev(fx.queue, fx.run.run_id, "close-out-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toMatchObject({ step: "relaunch", error: NOT_HANDED });
    expect(ev(fx.queue, fx.run.run_id, "paused").at(-1)!.detail).toMatchObject({ pr: PR, relaunch_failed: NOT_HANDED });
    const k = kinds(fx.queue, fx.run.run_id);
    expect(k.lastIndexOf("close-out")).toBeLessThan(k.lastIndexOf("paused"));
  });

  test("a relaunch drive that resolves having ended the run: left as it is, closed", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    const deps: PausedDeps = { ...p.deps, relaunch: async (q, run) => async () => { await q.endDriven(run.run_id, "blocked", "the worker failed"); } };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
    expect(fx.get().state).toBe("blocked");
    expect(ev(fx.queue, fx.run.run_id, "close-out-failed")).toEqual([]);
  });

  test("a worktree not on its run branch: the commit step fails naming the branch; nothing committed, still paused", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const p = passDeps(fx);
    testGit(fx.wt, "checkout", "-q", "-b", "elsewhere");
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    const failures = ev(fx.queue, fx.run.run_id, "close-out-failed");
    expect(failures.map((e) => e.detail!.step)).toEqual(["commit"]);
    expect(String(failures[0]!.detail!.error)).toContain(`supervisor/run-${fx.run.run_id}`);
    expect(String(failures[0]!.detail!.error)).toContain("elsewhere");
    expect(p.order.filter((s) => s === "git add" || s === "git commit")).toEqual([]);
    expect(testGit(fx.wt, "log", "-1", "--format=%s")).toBe("feat: the landed story");
    expect(fx.get()).toMatchObject({ state: "paused", engine_run_id: E1 });
    expect(existsSync(fx.runDir)).toBe(true);
  });

  test("host tier: the same `bmad-loop archive` argv on the host, no `sbx exec`", async () => {
    const fx = await pausedRun({ verdict: "no-impact", tier: "host" });
    const p = passDeps(fx);
    const before = sbx.calls().length;
    // The host bmad-loop is answered by the injected runner; it never removes the run dir, so it is removed here.
    const deps: PausedDeps = { ...p.deps, run: async (bin, args, o) => { const r = await p.deps.run!(bin, args, o); if (bin === "bmad-loop") p.order.push(JSON.stringify(args)); return r; } };
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
    expect(p.order).toContain(JSON.stringify(["archive", "--project", fx.wt, E1]));
    expect(sbx.calls().slice(before).some((c) => c.argv[0] === "exec")).toBe(false);
  });
});

// ---------------------------------------------------------------- AC2

describe("AC2: no verdict, or `escalate`: awaiting a ruling", () => {
  test("stays paused; one notification naming the story and the reason over two passes; the page row says \"awaiting a ruling\"", async () => {
    for (const [verdict, reason] of [[undefined, "no reconcile_verdict recorded"], ["escalate", "reconcile_verdict: escalate"]] as const) {
      const fx = await pausedRun(verdict ? { verdict } : {});
      const p = passDeps(fx);
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [fx.run.run_id] });
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
      expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null, engine_run_id: E1 });
      expect(p.sent).toHaveLength(1);
      expect(p.sent[0]).toContain(KEY);
      expect(p.sent[0]).toContain(reason);
      expect(p.sent[0]).toContain(PR);
      const rec = ev(fx.queue, fx.run.run_id, "awaiting-ruling");
      expect(rec).toHaveLength(1);
      expect(rec[0]!.detail).toEqual({ story_key: KEY, engine_run_id: E1, reason, notify: { ok: true, via: "ntfy" } });
      // Nothing closed out.
      expect(testGit(fx.wt, "log", "-1", "--format=%s")).toBe("feat: the landed story");
      expect(existsSync(fx.runDir)).toBe(true);
      expect(p.invoked).toHaveLength(0);
      // The page row.
      const data = {
        generated: "2026-10-16T00:00:00Z", secrets: { token: "t-page", env: {} }, counts: { paused: 1 }, jobs: [], locks: [], statusBlocks: [], runsOmitted: 0,
        ledger: { path: "ledger", note: "none" }, registry: { ok: false, note: "none" },
        runs: [{
          run: fx.get(), resumes: 0, cost: null, events: fx.queue.events(fx.run.run_id), eventsOmitted: 0, workspace: null,
          runJson: { ok: false, note: "none" }, handoff: { ok: false, note: "none" },
        }],
      } as PageData;
      const html = renderPage(data);
      expect(html).toContain(`awaiting a ruling: story ${KEY} — ${reason}`);
    }
  });

  test("a fresh pause after a resume (same story, same engine) gets its own record and notification; the page row follows", async () => {
    const fx = await pausedRun({ verdict: "escalate" });
    const p = passDeps(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [fx.run.run_id] });
    expect(pageFor(fx)).toContain("awaiting a ruling");
    // A resume, the engine handed back, and the engine pauses again on the same story.
    fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", { engine_run_id: E1 }, me);
    fx.queue.markLaunched(fx.run.run_id, E1, { end: {} });
    const engine = ev(fx.queue, fx.run.run_id, "paused").at(-1)!.detail!.engine;
    fx.queue.markPaused(fx.run.run_id, { engine, pr: PR });
    expect(pageFor(fx)).not.toContain("awaiting a ruling"); // the old record is not this pause's
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [fx.run.run_id] });
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")).toHaveLength(2);
    expect(p.sent).toHaveLength(2);
    expect(pageFor(fx)).toContain(`awaiting a ruling: story ${KEY} — reconcile_verdict: escalate`);
  });

  test("a notifier that fails is recorded in the event; still one record", async () => {
    const fx = await pausedRun({ verdict: "escalate" });
    const p = passDeps(fx);
    const deps: PausedDeps = { ...p.deps, hygiene: { ...p.deps.hygiene, fetch: async () => new Response("no", { status: 503 }) } };
    await closeOutPaused(fx.queue, deps);
    await closeOutPaused(fx.queue, deps);
    const rec = ev(fx.queue, fx.run.run_id, "awaiting-ruling");
    expect(rec).toHaveLength(1);
    expect(rec[0]!.detail!.notify).toEqual({ ok: false, via: "ntfy", error: "HTTP 503" });
  });
});

// ---------------------------------------------------------------- Story 31.5

describe("Story 31.5: a bound project's paused run is blocked on Jira once per (story key, engine run id)", () => {
  const bind = (root: string, body = "planning:\n  jira:\n    site: example.atlassian.net\n    project_key: TKS\n") => {
    mkdirSync(join(root, ".tk-studio"), { recursive: true });
    writeFileSync(join(root, ".tk-studio", "config.yaml"), body);
  };
  /** The pass's deps with `track.py` answered by `answer` (every other studio script as `passDeps` runs it). */
  const tracked = (fx: Awaited<ReturnType<typeof pausedRun>>, answer: () => Promise<RunResult>) => {
    const p = passDeps(fx);
    const calls: { root: string; script: string; args: string[] }[] = [];
    const uv = p.deps.uv!;
    const deps: PausedDeps = {
      ...p.deps,
      uv: async (root, script, args, timeoutS) => {
        if (!script.endsWith("track.py")) return uv(root, script, args, timeoutS);
        calls.push({ root, script, args });
        return answer();
      },
    };
    return { ...p, deps, calls };
  };
  const BLOCKED = { ok: true, status: "complete", intent: "tk-studio-track", artifacts: [], reason: null,
    issues: [{ issue: "TKS-1", entity: "ST-001", role: "story", transitioned: true, commented: true }] };
  const answer = (out: unknown, exit = 0) => async (): Promise<RunResult> => ({ exit, stdout: JSON.stringify(out), stderr: "" });

  test("jiraBound reads planning.jira.project_key from the tracked config only", () => {
    const root = tempDir("tk-sup-bound-");
    expect(jiraBound(root)).toBe(false);
    bind(root, "planning:\n  backend: bmad-files\n");
    expect(jiraBound(root)).toBe(false);
    bind(root, "planning:\n  jira:\n    project_key: ''\n");
    expect(jiraBound(root)).toBe(false);
    bind(root);
    expect(jiraBound(root)).toBe(true);
  });

  test("the block is invoked once per (story key, engine run id) and a `track-block` event records it", async () => {
    const fx = await pausedRun({ verdict: "escalate" });
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [fx.run.run_id] });
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(t.calls).toHaveLength(1);
    const spec = `_bmad-output/specs/spec-epic-9/stories/${KEY}-spec.md`;
    expect(t.calls[0]!.root).toBe(fx.run.root);
    expect(t.calls[0]!.script.split(/[\\/]/).slice(-2)).toEqual(["lib", "track.py"]);
    expect(t.calls[0]!.args).toEqual(trackArgs(fx.run.root, KEY, "reconcile_verdict: escalate", spec));
    expect(t.calls[0]!.args).toEqual(["block", "--directory", fx.run.root, "--story", KEY, "--reason", "reconcile_verdict: escalate",
      "--resolves", `a ruling in the spec (${spec})`, "--source", "run"]);
    const rec = ev(fx.queue, fx.run.run_id, "track-block");
    expect(rec).toHaveLength(1);
    expect(rec[0]!.detail).toEqual({ story_key: KEY, engine_run_id: E1, ok: true, status: "complete", reason: null,
      issues: [{ issue: "TKS-1", role: "story", transitioned: true, commented: true }] });
    // the existing record and its notification are unchanged
    expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a by-name `blocked` answer is recorded and never retried", async () => {
    const fx = await pausedRun({});
    bind(fx.run.root);
    const out = { ok: false, status: "blocked", intent: "tk-studio-track", artifacts: [], reason: "track refused: TK_ATLASSIAN_AGENT_TOKEN is not set — no Atlassian call made", issues: [] };
    const t = tracked(fx, answer(out, 2));
    await closeOutPaused(fx.queue, t.deps);
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(1);
    expect(ev(fx.queue, fx.run.run_id, "track-block")[0]!.detail).toMatchObject({ ok: false, status: "blocked", reason: out.reason });
  });

  test("a transient failure (no JSON, a crash) records nothing and the next pass retries", async () => {
    const fx = await pausedRun({ verdict: "escalate" });
    bind(fx.run.root);
    let n = 0;
    const t = tracked(fx, async () => {
      n += 1;
      if (n === 1) return { exit: 1, stdout: "Traceback (most recent call last):", stderr: "boom" };
      if (n === 2) throw new Error("uv: spawn failed");
      return { exit: 0, stdout: JSON.stringify(BLOCKED), stderr: "" };
    });
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [fx.run.run_id] });
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(0);
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(0);
    await closeOutPaused(fx.queue, t.deps);
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(3);
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(1);
    expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a `retry: true` answer (a temporary Jira failure, `partial` with ok false) records nothing and is retried", async () => {
    const fx = await pausedRun({ verdict: "escalate" });
    bind(fx.run.root);
    const RETRY = { ok: false, status: "partial", intent: "tk-studio-track", artifacts: [], retry: true,
      reason: "track retry: TKS-1: track: GET /issue/TKS-1 returned 503 — a temporary failure; call again on the next pass",
      issues: [{ issue: "TKS-1", role: "story", transitioned: false, commented: false, error: "returned 503" }] };
    let n = 0;
    const t = tracked(fx, async () => (++n === 1 ? answer(RETRY)() : answer(BLOCKED)()));
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(1);
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(0);
    await closeOutPaused(fx.queue, t.deps);
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(2);
    expect(ev(fx.queue, fx.run.run_id, "track-block").map((e) => e.detail!.status)).toEqual(["complete"]);
    expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")).toHaveLength(1);
  });

  // ------------------------------------------------ a dev session's `blocked` end (AC1's first trigger)

  const specFile = (fx: Awaited<ReturnType<typeof pausedRun>>) => join(fx.wt, "_bmad-output", "specs", "spec-epic-9", "stories", `${KEY}-spec.md`);
  const SPEC_REL = `_bmad-output/specs/spec-epic-9/stories/${KEY}-spec.md`;
  const devBlockedRun = async (condition?: string) => {
    const fx = await pausedRun({ status: "blocked", stage: "dev" });
    if (condition !== undefined) writeFileSync(specFile(fx), `${spec("blocked")}\n## Deviation Summary\n\nBlocking condition: none\n\nBlocking condition: ${condition}\n`);
    return fx;
  };

  test("a blocked spec makes one block call per pause, with no ruling record and no notification", async () => {
    const fx = await devBlockedRun("the spec contradicts AC2 on the inbox sort");
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.args).toEqual(["block", "--directory", fx.run.root, "--story", KEY, "--reason", "the spec contradicts AC2 on the inbox sort",
      "--resolves", `a ruling in the spec (${SPEC_REL})`, "--source", "run"]);
    expect(ev(fx.queue, fx.run.run_id, "track-block")[0]!.detail).toMatchObject({ story_key: KEY, engine_run_id: E1, ok: true, status: "complete" });
    expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")).toHaveLength(0);
    expect(t.sent).toHaveLength(0);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
    // a fresh pause of the same story and engine owes a fresh block
    fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", { engine_run_id: E1 }, me);
    fx.queue.markLaunched(fx.run.run_id, E1, { end: {} });
    fx.queue.markPaused(fx.run.run_id, { engine: ev(fx.queue, fx.run.run_id, "paused").at(-1)!.detail!.engine, pr: PR });
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(2);
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(2);
    expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")).toHaveLength(0);
  });

  test("a repeat pass over a blocked spec makes no second call (the reason falls back when none is named)", async () => {
    const fx = await devBlockedRun();
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    for (let i = 0; i < 3; i++) expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.args).toEqual(trackArgs(fx.run.root, KEY, "dev session ended blocked", SPEC_REL));
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(1);
    expect(t.sent).toHaveLength(0);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a blocked spec in an unbound project makes no call", async () => {
    const fx = await devBlockedRun("needs a token");
    const t = tracked(fx, answer(BLOCKED));
    await closeOutPaused(fx.queue, t.deps);
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(0);
    expect(fx.queue.events(fx.run.run_id).filter((e) => e.kind === "track-block" || e.kind === "awaiting-ruling")).toHaveLength(0);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("an `in-progress` spec that did not land stays a silent skip", async () => {
    const fx = await pausedRun({ status: "in-progress", stage: "dev" });
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    const before = kinds(fx.queue, fx.run.run_id);
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(t.calls).toHaveLength(0);
    expect(kinds(fx.queue, fx.run.run_id)).toEqual(before);
    expect(t.sent).toHaveLength(0);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  // ------------------------------------------------ an engine-raised escalation (AC1: a paused run awaiting a ruling)

  test("paused at `escalation` with an `in-review` spec: one block call, one `track-block`, no ruling record, still paused", async () => {
    const fx = await pausedRun({ status: "in-review", stage: "escalation" });
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.args).toEqual(["block", "--directory", fx.run.root, "--story", KEY, "--reason", "reconcile asks for a ruling",
      "--resolves", `a ruling in the spec (${SPEC_REL})`, "--source", "run"]);
    const rec = ev(fx.queue, fx.run.run_id, "track-block");
    expect(rec).toHaveLength(1);
    expect(rec[0]!.detail).toMatchObject({ story_key: KEY, engine_run_id: E1, ok: true, status: "complete" });
    expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")).toHaveLength(0);
    expect(t.sent).toHaveLength(0);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
    // a second pass: no second call
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(t.calls).toHaveLength(1);
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(1);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("an escalation whose paused event names no reason: the fixed fallback", async () => {
    const fx = await pausedRun({ status: "in-progress", paused: false });
    fx.queue.markPaused(fx.run.run_id, { engine: { run_id: E1, status: "running", paused_stage: "escalation", paused_reason: "  ", paused_story_key: KEY }, pr: PR });
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.args).toEqual(trackArgs(fx.run.root, KEY, ESCALATION_BLOCKED_REASON, SPEC_REL));
    expect(ESCALATION_BLOCKED_REASON).toBe("story escalated: awaiting a ruling");
  });

  test("an escalation with a not-landed spec in an unbound project makes no call", async () => {
    const fx = await pausedRun({ status: "in-review", stage: "escalation" });
    const t = tracked(fx, answer(BLOCKED));
    const before = kinds(fx.queue, fx.run.run_id);
    await closeOutPaused(fx.queue, t.deps);
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(0);
    expect(kinds(fx.queue, fx.run.run_id)).toEqual(before);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a not-landed `in-review` spec paused at another stage (`dev`) makes no call", async () => {
    const fx = await pausedRun({ status: "in-review", stage: "dev" });
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    const before = kinds(fx.queue, fx.run.run_id);
    expect(await closeOutPaused(fx.queue, t.deps)).toEqual({ closed: [], awaiting: [] });
    expect(t.calls).toHaveLength(0);
    expect(kinds(fx.queue, fx.run.run_id)).toEqual(before);
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("no binding: no call and nothing recorded", async () => {
    const fx = await pausedRun({ verdict: "escalate" });
    const t = tracked(fx, answer(BLOCKED));
    await closeOutPaused(fx.queue, t.deps);
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(0);
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(0);
  });

  test("a fresh pause of the same story and engine blocks again", async () => {
    const fx = await pausedRun({ verdict: "escalate" });
    bind(fx.run.root);
    const t = tracked(fx, answer(BLOCKED));
    await closeOutPaused(fx.queue, t.deps);
    fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", { engine_run_id: E1 }, me);
    fx.queue.markLaunched(fx.run.run_id, E1, { end: {} });
    fx.queue.markPaused(fx.run.run_id, { engine: ev(fx.queue, fx.run.run_id, "paused").at(-1)!.detail!.engine, pr: PR });
    await closeOutPaused(fx.queue, t.deps);
    await closeOutPaused(fx.queue, t.deps);
    expect(t.calls).toHaveLength(2);
    expect(ev(fx.queue, fx.run.run_id, "track-block")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- AC3

describe("AC3: a story with no landed work is left for the resume", () => {
  test("no story key, no spec, a spec not done: nothing closed out, nothing notified, still paused", async () => {
    for (const o of [{ key: null }, { spec: false, verdict: "no-impact" }, { status: "in-progress", verdict: "no-impact" }] as const) {
      const fx = await pausedRun(o);
      const p = passDeps(fx);
      const before = kinds(fx.queue, fx.run.run_id);
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
      expect(kinds(fx.queue, fx.run.run_id)).toEqual(before);
      expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
      expect(p.order).toEqual([]);
      expect(p.sent).toEqual([]);
    }
  });

  test("resume: `bmad-loop resolve … --resume` through `sbx exec`, `engine-resume`, the pid re-read; with and without a restore patch", async () => {
    for (const patch of [undefined, "fix.patch"]) {
      const fx = await pausedRun({ status: "in-progress" });
      const p = passDeps(fx);
      if (patch) writeFileSync(join(fx.wt, patch), "diff\n");
      sbx.answer({ resume_pid: "7001 200000" });
      let answer;
      try { answer = await resumePaused(fx.queue, fx.run.run_id, patch ? { restorePatch: patch } : {}, { ...p.deps, pidPolls: 40, pollMs: 25 }); }
      finally { sbx.answer({}); }
      expect(answer).toEqual({ ok: true, run_id: fx.run.run_id, state: "running", engine_run_id: E1 });
      const want = ["exec", SB, "/home/agent/.local/bin/bmad-loop", "resolve", "--project", toVmPath(fx.wt), "--no-interactive", "--resume",
        ...(patch ? ["--restore-patch", toVmPath(join(fx.wt, patch))] : []), E1];
      expect(sbx.calls().map((c) => c.argv)).toContainEqual(want);
      const er = ev(fx.queue, fx.run.run_id, "engine-resume");
      expect(er).toHaveLength(1);
      expect(er[0]).toMatchObject({ from_state: "paused", to_state: "running" });
      expect(er[0]!.detail).toMatchObject({ engine_run_id: E1, argv: want.slice(0), ...(patch ? { restore_patch: toVmPath(join(fx.wt, patch)) } : {}) });
      expect(ev(fx.queue, fx.run.run_id, "engine-pid").at(-1)!.detail).toMatchObject({ pid: 7001, start: "200000", source: "engine.pid", resumed: true });
      expect(fx.get()).toMatchObject({ engine_pid: 7001, engine_start: "200000" });
      // The child (the hold) exits: the run is handed back to the engine-end sweep with a fresh `launched`.
      for (let i = 0; i < 100 && !handedBack(fx); i++) await Bun.sleep(20);
      const k = kinds(fx.queue, fx.run.run_id);
      expect(k.lastIndexOf("launched")).toBeGreaterThan(k.lastIndexOf("engine-resume"));
      expect(ev(fx.queue, fx.run.run_id, "launched").at(-1)!.detail).toMatchObject({ resumed: true, resolve: { exit: 0 } });
      expect(fx.queue.awaitingEngine().map((r) => r.run_id)).toContain(fx.run.run_id);
    }
  });

  test("a `bmad-loop resolve` child that exits non-zero: its exit code and stderr tail on the `launched` it writes", async () => {
    const fx = await pausedRun({ status: "in-progress" });
    const p = passDeps(fx);
    sbx.answer({ resolve: "fail" });
    try {
      await resumePaused(fx.queue, fx.run.run_id, {}, { ...p.deps, pidPolls: 2, pollMs: 5 });
      // The fake reads its answer when the child starts: kept until the child has exited.
      for (let i = 0; i < 250 && !handedBack(fx); i++) await Bun.sleep(20);
    } finally { sbx.answer({}); }
    const launched = ev(fx.queue, fx.run.run_id, "launched").at(-1)!;
    const k = kinds(fx.queue, fx.run.run_id);
    expect(k.lastIndexOf("launched")).toBeGreaterThan(k.lastIndexOf("engine-resume")); // still handed to the sweep
    expect(launched.detail).toMatchObject({ resumed: true, resolve: { exit: 1 } });
    expect(String((launched.detail!.resolve as Record<string, unknown>).error)).toContain("resolve refused");
    expect(ev(fx.queue, fx.run.run_id, "engine-pid").at(-1)!.detail).toMatchObject({ engine_pid: "unknown" });
  });

  test("the hold note failing is tolerated; a hand-back write failing is retried once, then the run goes back to `paused` naming why", async () => {
    for (const fails of [1, 2]) {
      const fx = await pausedRun({ status: "in-progress" });
      const p = passDeps(fx);
      let finish!: (r: RunResult) => void;
      const spawn = () => ({ pid: 4242, done: new Promise<unknown>((res) => { finish = res; }) });
      const note = fx.queue.note.bind(fx.queue);
      fx.queue.note = (id, kind, d) => { if (kind === "hold") throw new Error("database is locked"); note(id, kind, d); };
      const markLaunched = fx.queue.markLaunched.bind(fx.queue);
      let tries = 0;
      fx.queue.markLaunched = (...a: Parameters<Queue["markLaunched"]>) => { if (++tries <= fails) throw new Error("database is locked"); return markLaunched(...a); };
      const lockBefore = fx.queue.lock(fx.repo.checkout);
      expect(await resumePaused(fx.queue, fx.run.run_id, {}, { ...p.deps, spawn, pidPolls: 1, pollMs: 1 })).toMatchObject({ ok: true, state: "running" });
      expect(kinds(fx.queue, fx.run.run_id)).not.toContain("hold");
      expect(fx.get().state).toBe("running");
      finish({ exit: 0, stdout: "", stderr: "" });
      for (let i = 0; i < 50 && fx.get().state === "running" && kinds(fx.queue, fx.run.run_id).at(-1) !== "launched"; i++) await Bun.sleep(10);
      if (fails === 1) {
        expect(tries).toBe(2);
        expect(fx.get().state).toBe("running");
        expect(kinds(fx.queue, fx.run.run_id).at(-1)).toBe("launched");
      } else {
        expect(tries).toBe(2);
        expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
        expect(String(ev(fx.queue, fx.run.run_id, "paused").at(-1)!.detail!.resume_failed)).toContain("database is locked");
        expect(fx.queue.lock(fx.repo.checkout)).toEqual(lockBefore);
      }
    }
  });

  test("a resume whose spawn fails: back to `paused`, the engine lock untouched", async () => {
    const fx = await pausedRun({ status: "in-progress" });
    const p = passDeps(fx);
    const lockBefore = fx.queue.lock(fx.repo.checkout);
    const spawn = () => { throw new Error("ENOENT sbx"); };
    const e = await resumePaused(fx.queue, fx.run.run_id, {}, { ...p.deps, spawn }).catch((x) => x);
    expect(e).toBeInstanceOf(ResumeRefused);
    expect((e as ResumeRefused).code).toBe("ResumeFailed");
    expect(fx.get()).toMatchObject({ state: "paused", owner_pid: null });
    expect(fx.queue.lock(fx.repo.checkout)).toEqual(lockBefore);
    expect(String(ev(fx.queue, fx.run.run_id, "paused").at(-1)!.detail!.resume_failed)).toContain("ENOENT sbx");
  });

  test("a resumed run's end is its engine's own terminal status: `crashed` ends `partial`, `finished` ends `complete`", async () => {
    for (const [status, state] of [["crashed", "partial"], ["finished", "complete"]] as const) {
      const fx = await pausedRun({ status: "in-progress" });
      const p = passDeps(fx);
      sbx.answer({ resume_pid: "7001 200000" });
      try { await resumePaused(fx.queue, fx.run.run_id, {}, { ...p.deps, pidPolls: 40, pollMs: 25 }); }
      finally { sbx.answer({}); }
      for (let i = 0; i < 100 && !handedBack(fx); i++) await Bun.sleep(20);
      const launched = ev(fx.queue, fx.run.run_id, "launched").at(-1)!.detail as Record<string, any>;
      expect(launched.resumed).toBe(true);
      expect(launched.end).toMatchObject({ state: "complete" }); // the launch's recorded end, carried over: never the answer
      // The engine probe answers the resumed engine's own end; the studio `finish` is recorded.
      const finishes: string[][] = [];
      statusAnswer({ run_id: E1, status });
      const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> =>
        script.endsWith("launch.py") && args[0] === "status"
          ? { exit: 0, stdout: JSON.stringify({ ok: true, run: { run_id: E1, status } }), stderr: "" }
          : p.deps.uv!(root, script, args, timeoutS);
      const verbs = async (_root: string, args: string[]) => { finishes.push(args); return { ok: true, state: args[args.indexOf("--state") + 1] }; };
      expect(await sweepEngines(fx.queue, { ...p.deps, uv, verbs })).toEqual([fx.run.run_id]);
      expect(fx.get().state).toBe(state);
      const ended = ev(fx.queue, fx.run.run_id, "ended").at(-1)!;
      expect(ended.to_state).toBe(state);
      expect(ended.detail).toMatchObject({ engine: { run_id: E1, status } });
      expect(finishes).toHaveLength(1);
      expect(finishes[0]!.slice(finishes[0]!.indexOf("--state"), finishes[0]!.indexOf("--state") + 2)).toEqual(["--state", state]);
      if (state === "partial") expect(finishes[0]).toContain(`resumed engine ended '${status}'`);
      else expect(finishes[0]).not.toContain("--reason");
    }
  });

  test("a relaunched run's end is its engine's own terminal status, not the relaunch's `launched.end`: `crashed` ends `partial`, `finished` ends `complete`", async () => {
    for (const [status, state] of [["crashed", "partial"], ["finished", "complete"]] as const) {
      const fx = await pausedRun({ verdict: "no-impact" });
      const p = passDeps(fx);
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
      const k = kinds(fx.queue, fx.run.run_id);
      expect(k.lastIndexOf("close-out")).toBeLessThan(k.lastIndexOf("launched"));
      const launched = ev(fx.queue, fx.run.run_id, "launched").at(-1)!.detail as Record<string, any>;
      expect(launched.resumed).toBeUndefined();
      expect(launched.end).toMatchObject({ state: "complete" }); // the relaunch's recorded end: never the answer
      const finishes: string[][] = [];
      statusAnswer({ run_id: E2, status });
      const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> =>
        script.endsWith("launch.py") && args[0] === "status"
          ? { exit: 0, stdout: JSON.stringify({ ok: true, run: { run_id: E2, status } }), stderr: "" }
          : p.deps.uv!(root, script, args, timeoutS);
      const verbs = async (_root: string, args: string[]) => { finishes.push(args); return { ok: true, state: args[args.indexOf("--state") + 1] }; };
      expect(await sweepEngines(fx.queue, { ...p.deps, uv, verbs })).toEqual([fx.run.run_id]);
      expect(fx.get().state).toBe(state);
      const ended = ev(fx.queue, fx.run.run_id, "ended").at(-1)!;
      expect(ended.to_state).toBe(state);
      expect(ended.detail).toMatchObject({ engine: { run_id: E2, status } });
      expect(finishes).toHaveLength(1);
      expect(finishes[0]!.slice(finishes[0]!.indexOf("--state"), finishes[0]!.indexOf("--state") + 2)).toEqual(["--state", state]);
      if (state === "partial") expect(finishes[0]).toContain(`relaunched engine ended '${status}'`);
      else expect(finishes[0]).not.toContain("--reason");
    }
  });

  // Story 33.7 (hole 59): a resumed or relaunched engine's graceful `stopped` ends `complete` when its journal says
  // the story it was driving landed (its last story entry a `story-done`), `partial` when it stopped before.
  describe("a resumed or relaunched engine's graceful stop (Story 33.7, AC1)", () => {
    /** The engine journal at `<served root>/.bmad-loop/runs/<engine>/journal.jsonl` (raw lines kept as given). */
    const journal = (wt: string, engine: string, entries: (Record<string, unknown> | string)[]) => {
      const dir = join(wt, ".bmad-loop", "runs", engine);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "journal.jsonl"), entries.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n");
    };
    const at = (kind: string, extra: Record<string, unknown> = {}) => ({ ts: "2026-10-27T00:00:00Z", kind, ...extra });
    /** A paused run resumed through `POST /runs/{id}/resume`'s pass, its resolve child handed back. */
    const resumed = async () => {
      const fx = await pausedRun({ status: "in-progress" });
      const p = passDeps(fx);
      sbx.answer({ resume_pid: "7001 200000" });
      try { await resumePaused(fx.queue, fx.run.run_id, {}, { ...p.deps, pidPolls: 40, pollMs: 25 }); }
      finally { sbx.answer({}); }
      for (let i = 0; i < 100 && !handedBack(fx); i++) await Bun.sleep(20);
      expect((ev(fx.queue, fx.run.run_id, "launched").at(-1)!.detail as Record<string, any>).resumed).toBe(true);
      return { fx, p, engine: E1 };
    };
    /** A paused run relaunched by the paused-run pass (a `launched` after its `close-out`). */
    const relaunched = async () => {
      const fx = await pausedRun({ verdict: "no-impact" });
      const p = passDeps(fx);
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
      const k = kinds(fx.queue, fx.run.run_id);
      expect(k.lastIndexOf("close-out")).toBeLessThan(k.lastIndexOf("launched"));
      return { fx, p, engine: E2 };
    };
    /** The engine-end sweep with the engine answering `stopped`, a fake `gh` and the studio `finish` recorded. */
    const sweepStopped = async (s: Awaited<ReturnType<typeof resumed>>) => {
      const { fx, p, engine } = s;
      const gh = fakeGh();
      const finishes: string[][] = [];
      statusAnswer({ run_id: engine, status: "stopped" });
      const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> =>
        script.endsWith("launch.py") && args[0] === "status"
          ? { exit: 0, stdout: JSON.stringify({ ok: true, run: { run_id: engine, status: "stopped" } }), stderr: "" }
          : p.deps.uv!(root, script, args, timeoutS);
      const verbs = async (_root: string, args: string[]) => { finishes.push(args); return { ok: true, state: args[args.indexOf("--state") + 1] }; };
      const env = { ...p.deps.env, GH_BIN: gh.bin };
      expect(await sweepEngines(fx.queue, { ...p.deps, env, uv, verbs })).toEqual([fx.run.run_id]);
      expect(finishes).toHaveLength(1);
      const ended = ev(fx.queue, fx.run.run_id, "ended").at(-1)!;
      expect(ended.detail).toMatchObject({ engine: { run_id: engine, status: "stopped" } });
      return { finish: finishes[0]!, ended, prCalls: gh.calls().filter((c) => c.argv[0] === "pr").map((c) => c.argv) };
    };
    const stateOf = (finish: string[]) => finish[finish.indexOf("--state") + 1];

    test("resumed, landed (`run-start, story-start, run-paused, run-resume, story-done`): `complete`, no reason, the PR marked ready", async () => {
      const s = await resumed();
      journal(s.fx.wt, s.engine, [at("run-start"), at("story-start", { story_key: KEY }), at("run-paused"), at("run-resume", { was_paused: true }), at("story-done", { story_key: KEY })]);
      const r = await sweepStopped(s);
      expect(s.fx.get()).toMatchObject({ state: "complete", reason: null });
      expect(r.ended).toMatchObject({ to_state: "complete" });
      expect(stateOf(r.finish)).toBe("complete");
      expect(r.finish).not.toContain("--reason");
      expect(r.prCalls).toContainEqual(["pr", "ready", PR]);
      expect(r.prCalls.some((a) => a.includes("--undo"))).toBe(false);
      expect(r.ended.detail).toMatchObject({ pr: PR, closeout: { result: "PR" } });
    });

    test("resumed, not landed (no `story-done` after the `run-resume`, or a `story-start` last): `partial`, `resumed engine ended 'stopped'`", async () => {
      for (const entries of [
        [at("run-start"), at("story-start", { story_key: KEY }), at("story-done", { story_key: KEY }), at("run-paused"), at("run-resume")],
        [at("run-start"), at("run-resume"), at("story-done", { story_key: KEY }), at("story-start", { story_key: "9-2-the-next" })],
      ]) {
        const s = await resumed();
        journal(s.fx.wt, s.engine, entries);
        const r = await sweepStopped(s);
        expect(s.fx.get()).toMatchObject({ state: "partial", reason: "resumed engine ended 'stopped'" });
        expect(stateOf(r.finish)).toBe("partial");
        expect(r.finish[r.finish.indexOf("--reason") + 1]).toBe("resumed engine ended 'stopped'");
      }
    });

    test("relaunched: a `story-done` last ends `complete` (no reason, the PR ready); a `story-start` last ends `partial`", async () => {
      for (const [last, state] of [["story-done", "complete"], ["story-start", "partial"]] as const) {
        const s = await relaunched();
        journal(s.fx.wt, s.engine, [at("run-start"), at("story-start", { story_key: KEY }), ...(last === "story-done" ? [at("story-done", { story_key: KEY })] : []), at("run-stop", { graceful: true })]);
        const r = await sweepStopped(s);
        expect(s.fx.get().state).toBe(state);
        expect(stateOf(r.finish)).toBe(state);
        if (state === "complete") {
          expect(s.fx.get().reason).toBeNull();
          expect(r.finish).not.toContain("--reason");
          expect(r.prCalls).toContainEqual(["pr", "ready", PR]);
        } else {
          expect(s.fx.get().reason).toBe("relaunched engine ended 'stopped'");
          expect(r.finish[r.finish.indexOf("--reason") + 1]).toBe("relaunched engine ended 'stopped'");
        }
      }
    });

    test("a missing journal ends `partial`; a red host verify with a `story-done` still ends `partial`, naming the red command", async () => {
      const missing = await resumed();
      await sweepStopped(missing);
      expect(missing.fx.get()).toMatchObject({ state: "partial", reason: "resumed engine ended 'stopped'" });

      const red = await resumed();
      journal(red.fx.wt, red.engine, [at("run-start"), at("story-start", { story_key: KEY }), at("run-resume"), at("story-done", { story_key: KEY })]);
      red.fx.queue.note(red.fx.run.run_id, "host-verify", {
        command: "bun test", argv: ["bun", "test"], cwd: red.fx.wt, exit: 3, duration_ms: 5, green: false, stdout_tail: [], stderr_tail: ["1 failing"],
      });
      const r = await sweepStopped(red);
      const reason = "host verify red: `bun test` exited 3; last lines: 1 failing";
      expect(red.fx.get()).toMatchObject({ state: "partial", reason });
      expect(r.finish[r.finish.indexOf("--reason") + 1]).toBe(reason);
      expect(r.prCalls).toContainEqual(["pr", "ready", PR, "--undo"]);
    });

    test("a resumed engine ended `stopped` whose taken run has no worktree (no served root): the sweep never throws, `partial`", async () => {
      const s = await resumed();
      journal(s.fx.wt, s.engine, [at("run-start"), at("story-start", { story_key: KEY }), at("run-resume"), at("story-done", { story_key: KEY })]);
      // The probe sees the worktree; the run the close-out takes carries none (`servedRoot` answers null).
      const take = s.fx.queue.takeForCloseOut.bind(s.fx.queue);
      s.fx.queue.takeForCloseOut = (id, self) => { const run = take(id, self); return run && { ...run, worktree: null }; };
      const r = await sweepStopped(s);
      expect(s.fx.get()).toMatchObject({ state: "partial", reason: "resumed engine ended 'stopped'" });
      expect(stateOf(r.finish)).toBe("partial");
      expect(r.finish[r.finish.indexOf("--reason") + 1]).toBe("resumed engine ended 'stopped'");
    });

    /** The supervisor killed the engine (pid and start recorded, killed); it handled TERM, so its status reads `stopped`. */
    const killedBySupervisor = (s: Awaited<ReturnType<typeof resumed>>) => {
      s.fx.queue.recordEnginePid(s.fx.run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
      s.fx.queue.note(s.fx.run.run_id, "engine-kill", { why: "test", sandbox: SB, worker: { pid: 6509, start: "125610.0", outcome: "killed" } });
    };

    test("a resumed engine the supervisor killed that ended `stopped` with a landed journal stays `partial`, no host verify", async () => {
      const s = await resumed();
      journal(s.fx.wt, s.engine, [at("run-start"), at("story-start", { story_key: KEY }), at("run-resume"), at("story-done", { story_key: KEY })]);
      killedBySupervisor(s);
      const r = await sweepStopped(s);
      expect(s.fx.get()).toMatchObject({ state: "partial", reason: "resumed engine ended 'stopped'" });
      expect(r.ended).toMatchObject({ to_state: "partial" });
      expect(stateOf(r.finish)).toBe("partial");
      expect(r.finish[r.finish.indexOf("--reason") + 1]).toBe("resumed engine ended 'stopped'");
      expect(ev(s.fx.queue, s.fx.run.run_id, "host-verify")).toHaveLength(0);
      // Deliberately no draft assertion: `closeOut` marks a resumed/relaunched run's PR ready on a skipped verify
      // whatever the end state — pre-existing, deferred in the 33-7 spec ("a killed engine's PR marked ready on a partial end").
    });

    test("a relaunched engine the supervisor killed that ended `stopped` with a landed journal never ends `complete`, no host verify", async () => {
      const s = await relaunched();
      journal(s.fx.wt, s.engine, [at("run-start"), at("story-start", { story_key: KEY }), at("story-done", { story_key: KEY }), at("run-stop", { graceful: true })]);
      killedBySupervisor(s);
      const r = await sweepStopped(s);
      // Its status read `stopped` (not `running`), so the relaunch's end is still the engine's own: `partial`, never `complete`.
      // This pins today's pre-existing behaviour: `relaunched` tests only `st.detail.killed`, so a killed relaunch whose engine
      // handled TERM and reads `stopped` does not keep `launched.end` — deferred in the 33-7 spec
      // ("a killed TERM-handling relaunch loses launched.end").
      expect(s.fx.get()).toMatchObject({ state: "partial", reason: "relaunched engine ended 'stopped'" });
      expect(stateOf(r.finish)).toBe("partial");
      expect(r.finish[r.finish.indexOf("--reason") + 1]).toBe("relaunched engine ended 'stopped'");
      expect(ev(s.fx.queue, s.fx.run.run_id, "host-verify")).toHaveLength(0);
    });

    test("storyLandedBeforeStop: the segment after the latest `run-start`/`run-resume`, unparsable lines skipped, an empty `story_key` not counted", () => {
      const dir = (entries: (Record<string, unknown> | string)[]) => {
        const wt = tempDir("tk-sup-co-journal-");
        journal(wt, "E", entries);
        return join(wt, ".bmad-loop", "runs", "E");
      };
      expect(storyLandedBeforeStop(join(tempDir("tk-sup-co-journal-"), "none"))).toBe(false);
      expect(storyLandedBeforeStop(dir([at("story-start", { story_key: KEY }), at("story-done", { story_key: KEY })]))).toBe(true); // no run-start: the whole file
      expect(storyLandedBeforeStop(dir([at("story-done", { story_key: KEY }), at("run-resume")]))).toBe(false);
      expect(storyLandedBeforeStop(dir([at("run-start"), at("story-done", { story_key: KEY }), "{not json", "", at("run-stop")]))).toBe(true);
      expect(storyLandedBeforeStop(dir([at("run-start"), at("story-done", { story_key: "" })]))).toBe(false);
      expect(storyLandedBeforeStop(dir([at("run-start"), at("story-done", { story_key: "  " })]))).toBe(false);
      expect(storyLandedBeforeStop(dir([at("run-start"), at("story-done")]))).toBe(false);
      expect(storyLandedBeforeStop(dir([at("run-start"), at("story-done", { story_key: KEY }), at("story-start", { story_key: KEY })]))).toBe(false);
    });
  });

  test("a relaunched run whose engine the supervisor killed ends with the relaunch's `launched.end` (the trip's state and guard reason), whether its status reads `running` or fails", async () => {
    const reason = "guard tripped: max_turns exceeded";
    for (const probe of ["running", "unreadable"] as const) {
      const fx = await pausedRun({ verdict: "no-impact" });
      const p = passDeps(fx);
      // The relaunch's `mirror` after a guard trip at launch return: the new `launched` carries the trip's end.
      const deps: PausedDeps = { ...p.deps, relaunch: async (q, run) => async () => { q.markLaunched(run.run_id, E2, { end: { state: "partial", reason } }); } };
      expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
      const k = kinds(fx.queue, fx.run.run_id);
      expect(k.lastIndexOf("close-out")).toBeLessThan(k.lastIndexOf("launched"));
      expect(fx.get()).toMatchObject({ state: "running", engine_run_id: E2 });
      // The supervisor killed the relaunched engine (pid and start recorded, killed): it never writes its end.
      fx.queue.recordEnginePid(fx.run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
      fx.queue.note(fx.run.run_id, "engine-kill", { why: "test", sandbox: SB, worker: { pid: 6509, start: "125610.0", outcome: "killed" } });
      const finishes: string[][] = [];
      statusAnswer(probe === "running" ? { run_id: E2, status: "running" } : "fail");
      const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> =>
        script.endsWith("launch.py") && args[0] === "status"
          ? probe === "running"
            ? { exit: 0, stdout: JSON.stringify({ ok: true, run: { run_id: E2, status: "running" } }), stderr: "" }
            : { exit: 1, stdout: "", stderr: "launch.py: the status could not be read" }
          : p.deps.uv!(root, script, args, timeoutS);
      const verbs = async (_root: string, args: string[]) => { finishes.push(args); return { ok: true, state: args[args.indexOf("--state") + 1] }; };
      expect(await sweepEngines(fx.queue, { ...p.deps, uv, verbs })).toEqual([fx.run.run_id]);
      expect(fx.get()).toMatchObject({ state: "partial", reason });
      const ended = ev(fx.queue, fx.run.run_id, "ended").at(-1)!;
      expect(ended.to_state).toBe("partial");
      expect(ended.detail).toMatchObject({ engine: { run_id: E2, killed: { pid: 6509, by: "engine-kill", outcome: "killed" } } });
      expect(finishes).toHaveLength(1);
      expect(finishes[0]![finishes[0]!.indexOf("--state") + 1]).toBe("partial");
      expect(finishes[0]![finishes[0]!.indexOf("--reason") + 1]).toBe(reason);
      expect(finishes[0]!.join(" ")).not.toContain("relaunched engine ended");
    }
  });

  test("resume refusals: not found, not paused, external, the story landed, a patch outside the worktree", async () => {
    const fx = await pausedRun({ status: "in-progress" });
    const p = passDeps(fx);
    const code = (e: unknown) => (e instanceof ResumeRefused ? e.code : String(e));
    expect(code(await resumePaused(fx.queue, "q-none", {}, p.deps).catch((e) => e))).toBe("RunNotFound");
    expect(code(await resumePaused(fx.queue, fx.run.run_id, { restorePatch: "../outside.patch" }, p.deps).catch((e) => e))).toBe("SchemaError");
    expect(fx.get().state).toBe("paused");
    const landed = await pausedRun({ verdict: "escalate" });
    expect(code(await resumePaused(landed.queue, landed.run.run_id, {}, passDeps(landed).deps).catch((e) => e))).toBe("StoryLanded");
    expect(landed.get().state).toBe("paused");
    const queued = fx.queue.enqueue({ jobId: "other", root: fx.repo.checkout, definition: { id: "other" } }).run;
    expect(code(await resumePaused(fx.queue, queued.run_id, {}, p.deps).catch((e) => e))).toBe("RunNotPaused");
    fx.queue.end(queued.run_id, "cancelled", "test");
    const ext = fx.queue.recordExternal("other", fx.repo.checkout, "other-20261016T101010Z", "running")!;
    expect(code(await resumePaused(fx.queue, ext.run_id, {}, p.deps).catch((e) => e))).toBe("ExternalRun");
  });

  test("the route: POST /runs/{id}/resume answers 200, 400 SchemaError, 404, 409 RunNotPaused | StoryLanded — bearer only", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    const TOKEN = "tok-closeout-route";
    const handler = createApi({ queue: fx.queue, token: TOKEN });
    const post = (path: string, body?: string, auth = true) =>
      handler(new Request(`http://100.100.1.2:8787${path}`, { method: "POST", ...(body !== undefined ? { body } : {}), headers: auth ? { authorization: `Bearer ${TOKEN}` } : {} }));
    const landed = await post(`/runs/${fx.run.run_id}/resume`, "{}");
    expect(landed.status).toBe(409);
    expect(await landed.json()).toMatchObject({ ok: false, error: "StoryLanded", run_id: fx.run.run_id });
    expect((await post(`/runs/q-none/resume`)).status).toBe(404);
    expect(await (await post(`/runs/${fx.run.run_id}/resume`, JSON.stringify({ restore_patch: 3 }))).json()).toMatchObject({ error: "SchemaError" });
    expect(await (await post(`/runs/${fx.run.run_id}/resume`, JSON.stringify({ patch: "x" }))).json()).toMatchObject({ error: "SchemaError" });
    expect((await post(`/runs/${fx.run.run_id}/resume`, "{}", false)).status).toBe(401);
    expect((await handler(new Request(`http://100.100.1.2:8787/runs/${fx.run.run_id}/resume`, { headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(405);
    const queued = fx.queue.enqueue({ jobId: "other", root: fx.repo.checkout, definition: { id: "other" } }).run;
    expect(await (await post(`/runs/${queued.run_id}/resume`)).json()).toMatchObject({ error: "RunNotPaused" });
    // 200 through an injected resume (the body passed through).
    const seen: unknown[] = [];
    const ok = createApi({ queue: fx.queue, token: TOKEN, resume: async (id, b) => { seen.push([id, b]); return { ok: true, run_id: id, state: "running", engine_run_id: E1 }; } });
    const r = await ok(new Request(`http://100.100.1.2:8787/runs/${fx.run.run_id}/resume`, { method: "POST", body: JSON.stringify({ restore_patch: "p.patch" }), headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, run_id: fx.run.run_id, state: "running", engine_run_id: E1 });
    expect(seen).toEqual([[fx.run.run_id, { restore_patch: "p.patch" }]]);
  });
});

// ---------------------------------------------------------------- the paused story key seam

describe("the engine's paused story key reaches the pass through the engine-end sweep", () => {
  test("launch.py's `run.paused_story_key` lands on the `paused` event the sweep writes; the pass reads it; none named, none carried", async () => {
    for (const named of [true, false]) {
      const fx = await pausedRun({ verdict: "escalate", paused: false });
      const p = passDeps(fx);
      expect(fx.get().state).toBe("running");
      const pausedRunStatus = { run_id: E1, status: "running", paused_stage: "escalation", paused_reason: "reconcile asks for a ruling", ...(named ? { paused_story_key: KEY } : {}) };
      statusAnswer(pausedRunStatus);
      const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> =>
        script.endsWith("launch.py") && args[0] === "status"
          ? { exit: 0, stdout: JSON.stringify({ ok: true, run: pausedRunStatus }), stderr: "" }
          : p.deps.uv!(root, script, args, timeoutS);
      expect(await sweepEngines(fx.queue, { ...p.deps, uv })).toEqual([fx.run.run_id]);
      expect(fx.get().state).toBe("paused");
      const engine = ev(fx.queue, fx.run.run_id, "paused").at(-1)!.detail!.engine as Record<string, unknown>;
      expect(engine).toMatchObject({ run_id: E1, paused_stage: "escalation" });
      if (named) {
        expect(engine.paused_story_key).toBe(KEY);
        expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [fx.run.run_id] });
        expect(ev(fx.queue, fx.run.run_id, "awaiting-ruling")[0]!.detail).toMatchObject({ story_key: KEY, engine_run_id: E1 });
      } else {
        expect("paused_story_key" in engine).toBe(false);
        expect(landing(fx.get(), fx.queue.events(fx.run.run_id))).toEqual({ outcome: "not-landed", why: "no paused story key" });
        expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
      }
    }
  });
});

// ---------------------------------------------------------------- the restart caution

describe("restart caution: a relaunched run is \"launched\" only after its new `launched`", () => {
  test("the relaunch driver dies before the new `launched`: `recover` handles the run, the archived engine id is never probed", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    // A driver that moved the run (`close-out`) and died before `mirror` wrote the new `launched`.
    fx.queue.resumeFromPause(fx.run.run_id, "close-out", { story_key: KEY, verdict: "no-impact" }, dead);
    expect(fx.get()).toMatchObject({ state: "running", owner_nonce: dead.nonce });
    expect(fx.queue.lock(fx.repo.checkout)).toMatchObject({ kind: "run", run_id: fx.run.run_id });
    expect(fx.queue.awaitingEngine().map((r) => r.run_id)).not.toContain(fx.run.run_id);
    const ended: string[] = [];
    const report = await fx.queue.recover({
      end: async (r) => { ended.push(r.run_id); return { ok: true, detail: "ended", state: "partial" }; },
      find: async () => ({ ok: true, run_id: null }),
    }, me);
    expect(report.ended.map((e) => e.run_id)).toEqual([fx.run.run_id]);
    expect(ended).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("partial");
  });

  test("after an `engine-resume`: no later `launched` and a dead owner → `recover` handles it; once a `launched` follows, the sweep probes it", async () => {
    const fx = await pausedRun({ status: "in-progress" });
    fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", { engine_run_id: E1 }, dead);
    // Story 27.5 (P1): the resume recorded its engine's pid, and that engine is gone (else the run is held, DW-29).
    fx.queue.recordEnginePid(fx.run.run_id, { pid: 7001, start: "1", source: "engine.pid" }, { sandbox: SB, resumed: true });
    (fx.queue.probes as Probes).engineProbe = async () => ({ alive: false });
    expect(fx.get()).toMatchObject({ state: "running", owner_nonce: dead.nonce });
    expect(fx.queue.awaitingEngine().map((r) => r.run_id)).not.toContain(fx.run.run_id); // the old `launched` does not count
    const ended: string[] = [];
    const report = await fx.queue.recover({
      end: async (r) => { ended.push(r.run_id); return { ok: true, detail: "ended", state: "partial" }; },
      find: async () => ({ ok: true, run_id: null }),
    }, me);
    expect(report.ended.map((e) => e.run_id)).toEqual([fx.run.run_id]);
    expect(ended).toEqual([fx.run.run_id]);

    const fy = await pausedRun({ status: "in-progress" });
    fy.queue.resumeFromPause(fy.run.run_id, "engine-resume", { engine_run_id: E1 }, me);
    expect(fy.queue.awaitingEngine().map((r) => r.run_id)).not.toContain(fy.run.run_id);
    fy.queue.markLaunched(fy.run.run_id, E1, { end: {} });
    expect(fy.queue.awaitingEngine().map((r) => r.run_id)).toContain(fy.run.run_id);
    const seen: string[] = [];
    await fy.queue.recover({
      end: async (r) => { seen.push(r.run_id); return { ok: true, detail: "ended", state: "partial" }; },
      find: async () => ({ ok: true, run_id: null }),
    }, me);
    expect(seen).toEqual([]); // launched: never recovered
    expect(fy.get().state).toBe("running");
  });
});


// ---------------------------------------------------------------- Story 27.5

describe("Story 27.5: cost across a close-out relaunch (DW-15), a resume in flight across a restart (DW-29)", () => {
  test("the close-out records the archived engine's metered cost before the archive; the final close-out's cost is the sum across engines", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    writeFileSync(join(fx.runDir, "run.json"), JSON.stringify({ total_cost_usd: 1.5 }));
    const p = passDeps(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [fx.run.run_id], awaiting: [] });
    const evs = fx.queue.events(fx.run.run_id);
    const acct = evs.filter((e) => e.kind === "accounted" && e.detail?.source === "engine");
    expect(acct.map((e) => e.detail)).toEqual([{ cost_usd: 1.5, engine_run_id: E1, source: "engine" }]);
    // Recorded before the archive moved the run dir away, and before the relaunch's `close-out` move.
    expect(evs.indexOf(acct[0]!)).toBeLessThan(evs.findIndex((e) => e.kind === "close-out"));
    expect(existsSync(fx.runDir)).toBe(false);
    // The relaunched engine E2 meters 2.0: the final close-out carries 1.5 + 2.0, never `launched` worker costs.
    const e2 = join(fx.wt, ".bmad-loop", "runs", E2);
    mkdirSync(e2, { recursive: true });
    writeFileSync(join(e2, "run.json"), JSON.stringify({ total_cost_usd: 2 }));
    expect(launchedCloseOutInput(fx.queue.events(fx.run.run_id), fx.get())).toMatchObject({ engineRunId: E2, costUsd: 3.5 });
    // E2 unmetered: the archived sum plus that iteration's worker cost (as today), else the sum alone.
    expect(launchedCloseOutInput(fx.queue.events(fx.run.run_id), { worktree: null, engine_run_id: E2 })).toMatchObject({ costUsd: 1.5 });
  });

  test("an engine cost already recorded (a close-out retried after a failed step) is never recorded twice", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    writeFileSync(join(fx.runDir, "run.json"), JSON.stringify({ total_cost_usd: 0.75 }));
    sbx.answer({ archive: "fail" });
    try {
      const p = passDeps(fx);
      await closeOutPaused(fx.queue, p.deps);
      await closeOutPaused(fx.queue, p.deps);
      expect(fx.get().state).toBe("paused");
      expect(ev(fx.queue, fx.run.run_id, "accounted").map((e) => e.detail)).toEqual([{ cost_usd: 0.75, engine_run_id: E1, source: "engine" }]);
    } finally { sbx.answer({}); }
  });

  test("DW-29: a resume in flight across a restart is held while its resumed engine runs, never orphaned; once the engine is gone it is", async () => {
    const fx = await pausedRun({ status: "in-progress" });
    let engine: "alive" | "gone" = "alive";
    (fx.queue.probes as Probes).engineProbe = async (_sb, pid) => engine === "alive" && pid === 7777 ? { alive: true, start: "424242" } : { alive: false };
    // `POST /runs/{id}/resume` by a serve that then died: the run moved `engine-resume`, the resumed engine's pid recorded.
    fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", { engine_run_id: E1 }, dead);
    fx.queue.recordEnginePid(fx.run.run_id, { pid: 7777, start: "424242", source: "engine.pid" }, { sandbox: SB, resumed: true });
    expect(await fx.queue.resumedEngineAlive(fx.get())).toBe(true);
    const ended: string[] = [];
    const ops = { end: async (r: { run_id: string }) => { ended.push(r.run_id); return { ok: true, detail: "ended", state: "partial" }; }, find: async () => ({ ok: true as const, run_id: null }) };
    const report = await fx.queue.recover(ops, me);
    expect(report.ended).toEqual([]);
    expect(report.held).toMatchObject([{ run_id: fx.run.run_id, worker: { pid: 7777, outcome: "running" } }]);
    expect(fx.get()).toMatchObject({ state: "running", owner_nonce: dead.nonce });
    expect(ended).toEqual([]);
    // The resumed engine ended (its hand-back lost with the dead serve): the restart rule orphans the run now.
    engine = "gone";
    expect(await fx.queue.resumedEngineAlive(fx.get())).toBe(false);
    const after = await fx.queue.recover(ops, me);
    expect(after.ended.map((e) => e.run_id)).toEqual([fx.run.run_id]);
    expect(fx.get().state).toBe("partial");
    expect(fx.queue.orphanedCloseOuts().map((r) => r.run_id)).toEqual([fx.run.run_id]);
  });
});

describe("Story 27.5 (P1): a resume whose engine pid is not recorded yet is held, never orphaned", () => {
  for (const window of ["no engine-pid after the engine-resume", "engine-pid {resumed: true, engine_pid: unknown}"] as const) {
    test(`${window}: \`recover\` holds the run; the orphan close-out never pushes, opens a PR or removes the worktree`, async () => {
      const fx = await pausedRun({ status: "in-progress" });
      // The resume's own `engine.pid` re-read from before the pause names the paused engine: not this resume's.
      fx.queue.recordEnginePid(fx.run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" }, { sandbox: SB });
      (fx.queue.probes as Probes).engineProbe = async () => ({ alive: false });
      fx.queue.resumeFromPause(fx.run.run_id, "engine-resume", { engine_run_id: E1 }, dead);
      if (window !== "no engine-pid after the engine-resume") {
        fx.queue.recordEnginePid(fx.run.run_id, null, { sandbox: SB, why: "engine.pid was not rewritten by the resume", resumed: true });
      }
      expect(await fx.queue.resumedEngineHold(fx.get())).toContain("the resume recorded no engine pid after its engine-resume");
      const ended: string[] = [];
      const report = await fx.queue.recover({
        end: async (r) => { ended.push(r.run_id); return { ok: true, detail: "ended", state: "partial" }; },
        find: async () => ({ ok: true, run_id: null }),
      }, me);
      expect(report.ended).toEqual([]);
      expect(ended).toEqual([]);
      expect(report.held).toMatchObject([{ run_id: fx.run.run_id, worker: { detail: expect.stringContaining("recorded no engine pid") } }]);
      expect(fx.get()).toMatchObject({ state: "running", owner_nonce: dead.nonce });
      const p = passDeps(fx);
      expect(await closeOutOrphans(fx.queue, p.deps)).toEqual([]);
      expect(kinds(fx.queue, fx.run.run_id)).not.toContain("closed_out");
      expect(existsSync(fx.wt)).toBe(true);
      expect(p.order.some((o) => o.startsWith("git push"))).toBe(false);
      expect(() => testGit(fx.repo.origin, "rev-parse", "--verify", "--quiet", `refs/heads/supervisor/run-${fx.run.run_id}`)).toThrow();
    });
  }
});

describe("Story 27.5 (P5): the archived engine's recorded cost when its relaunch failed", () => {
  test("the run still names the archived engine (its run.json gone): its recorded cost counts; metered there, never twice", async () => {
    const fx = await pausedRun({ verdict: "no-impact" });
    writeFileSync(join(fx.runDir, "run.json"), JSON.stringify({ total_cost_usd: 1.5 }));
    fx.queue.note(fx.run.run_id, "accounted", { cost_usd: 1.5, engine_run_id: E1, source: "engine" });
    // Still metered (not archived yet): the run.json counts, the recorded copy of it does not.
    expect(launchedCloseOutInput(fx.queue.events(fx.run.run_id), fx.get())).toMatchObject({ engineRunId: E1, costUsd: 1.5 });
    // Archived, then the relaunch failed: the run still names E1, whose run.json is gone.
    testGit(fx.wt, "status"); // the worktree is still there
    rmSync(fx.runDir, { recursive: true, force: true });
    expect(fx.get().engine_run_id).toBe(E1);
    expect(launchedCloseOutInput(fx.queue.events(fx.run.run_id), fx.get())).toMatchObject({ engineRunId: E1, costUsd: 1.5 });
  });
});
