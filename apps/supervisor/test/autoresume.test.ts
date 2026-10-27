// Story 33.6 (hole 65): a stale render view never halts a story. The paused-run pass recognises a dev session's
// CRITICAL escalation on a stale view of a fresh `_bmad/render/` snapshot, checks the host sees the folder complete,
// removes the snapshot and the untracked `blocked` draft and resumes once per story; a second such pause is left
// for the operator. Pinned against a real throwaway repository and worktree (real git for the untracked check), an
// injected resume, an injected notifier and an injected `track.py`. Never a real sandbox, engine or ledger.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  AUTO_RESUME, autoResumedLine, autoResumeRefusedLine, closeOutPaused, RENDER_HALT_MESSAGES, ResumeRefused, secondHaltLine,
  resolveArgs, snapshotComplete, snapshotFolders, staleRenderView, type PausedDeps,
} from "../src/closeout";
import { NOTICE_MAX_BYTES } from "../src/hygiene";
import { Queue, type Owner } from "../src/queue";
import type { HoldChild } from "../src/sandbox";
import { runProcess, type RunResult } from "../src/server";
import { gitRepo, testGit } from "./fakes";
import { tempDir } from "./tmp";

const E1 = "20261027-101010-ab12", E2 = "20261027-121212-cd34";
const KEY = "9-2-the-render-story";
const LAUNCH = { id: "launch-33", trigger: "one-shot", target: { skill: "tk-studio-launch" }, guards: { max_wall_clock_seconds: 600 } };
const PR = "https://github.com/acme/widget/pull/43";
const me: Owner = { pid: process.pid, host: hostname(), nonce: "autoresume-test" };
/** Another live process: it can take the close-out lease only once the pass let go of it. */
const other: Owner = { pid: process.pid, host: hostname(), nonce: "autoresume-other" };
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
const SNAP = "_bmad/render/bmad-build-auto/widget-4b16bf12e1f0/172e0a66eabaf094fb43";
const SPEC_REL = `_bmad-output/specs/spec-epic-9/stories/${KEY}-spec.md`;
const OUTPUTS = { "workflow.md": "# workflow\n", "step-01-plan.md": "# plan\n", "references/check.md": "# check\n" };

/** A dev session's pause reason quoting `halt` (a renderer message) about the snapshot at `path`. */
const devReason = (halt: string) => `CRITICAL escalation from dev session: The skill render failed.\n\nHALT: ${halt}\n\nBlocking condition: render_skill.py could not verify the generation`;
const msgs = (path: string) => [
  `corrupt existing generation ${path}: Expecting value: line 1 column 1 (char 0)`,
  `generation contains unexpected or missing files: ${path}`,
  `failed to verify ${path}/step-01-plan.md: [Errno 2] No such file or directory: '${path}/step-01-plan.md'`,
  `generation output hash mismatch: ${path}/workflow.md`,
  `uv run --no-cache "/home/agent/w/_bmad/scripts/render_skill.py" exited 1 (${path})`,
];
const SANDBOX_PATH = `/home/agent/work/worktrees/p33/run-x/${SNAP}`;
const REASON = devReason(msgs(SANDBOX_PATH)[2]!);

const spec = (status: string) => `---\ntitle: 'The render story'\nstatus: ${status}\n---\n\n# body\n`;

/** Write a snapshot folder: `manifest.json` (`outputs` as given, or `raw` verbatim) and the files in `files`. */
function writeSnapshot(dir: string, o: { outputs?: Record<string, string>; files?: Record<string, string>; raw?: string } = {}) {
  mkdirSync(dir, { recursive: true });
  const outputs = o.outputs ?? Object.fromEntries(Object.keys(OUTPUTS).map((k) => [k, "0".repeat(64)]));
  writeFileSync(join(dir, "manifest.json"), o.raw ?? JSON.stringify({ generation_hash: "172e0a66eabaf094fb43", outputs, skill: "bmad-build-auto" }));
  for (const [name, body] of Object.entries(o.files ?? OUTPUTS)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
}

/** One paused host launch run: a real worktree on `supervisor/run-<id>`, the story's spec (untracked unless
 * `tracked`), a complete snapshot at `SNAP` and the run paused at `stage` with `reason`. */
async function pausedRun(o: { status?: string; stage?: string; reason?: string; tracked?: boolean; snapshot?: boolean } = {}) {
  const repo = gitRepo();
  const work = tempDir("tk-sup-ar-work-");
  const queue = new Queue(":memory:", { ownerAlive: (x) => x.nonce === me.nonce || x.nonce === other.nonce, engineLive: async () => ({ live: false }) });
  const run0 = queue.enqueue({ jobId: "launch-33", root: repo.checkout, projectId: "p33", definition: LAUNCH, owner: me, tier: "host" }).run;
  expect((await queue.claim(run0.run_id, me)).claimed).toBe(true);
  const wt = join(work, "worktrees", "p33", run0.run_id);
  testGit(repo.checkout, "worktree", "add", "--relative-paths", wt, "-b", `supervisor/run-${run0.run_id}`, "main");
  queue.recordWorktree(run0.run_id, wt, { branch: `supervisor/run-${run0.run_id}`, base_ref: "main" });
  const specFile = join(wt, ...SPEC_REL.split("/"));
  mkdirSync(join(specFile, ".."), { recursive: true });
  writeFileSync(specFile, spec(o.status ?? "blocked"));
  if (o.tracked) { testGit(wt, "add", SPEC_REL); testGit(wt, "commit", "-q", "-m", "the spec, tracked"); }
  const snap = join(wt, ...SNAP.split("/"));
  if (o.snapshot !== false) writeSnapshot(snap);
  queue.markLaunched(run0.run_id, E1, { end: { state: "complete", reason: null } });
  const pause = () => queue.markPaused(run0.run_id, {
    engine: { run_id: E1, status: "running", paused_stage: o.stage ?? "escalation", paused_reason: o.reason ?? REASON, paused_story_key: KEY }, pr: PR,
  });
  pause();
  const id = run0.run_id;
  return { repo, wt, queue, id, specFile, snap, pause, run: () => queue.get(id)!, events: () => queue.events(id) };
}
type Fx = Awaited<ReturnType<typeof pausedRun>>;

const BLOCKED = { ok: true, status: "complete", intent: "tk-studio-track", artifacts: [], reason: null,
  issues: [{ issue: "TKS-1", entity: "ST-001", role: "story", transitioned: true, commented: true }] };

/** The pass's deps: real git, an injected resume (moves the run to `running` as `resumePaused` does, or refuses),
 * a notifier answered into `sent`, `track.py` answered by BLOCKED (recorded in `tracks`). */
function passDeps(fx: Fx, o: { refuse?: boolean; notify?: boolean; relaunch?: PausedDeps["relaunch"] } = {}) {
  const sent: string[] = [], resumed: string[] = [], tracks: string[][] = [], uvs: string[] = [];
  const env: Record<string, string | undefined> = {
    ...process.env, ...IDENTITY, TK_STUDIO_ROOT: tempDir("tk-sup-ar-studio-"),
    ...(o.notify === false ? { TK_SUPERVISOR_NOTIFY: "" } : { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/tk-topic" }),
  };
  const deps: PausedDeps = {
    env, self: me,
    run: async (bin, args, opts): Promise<RunResult> => {
      if (bin === "bmad-loop") return { exit: 0, stdout: "archived", stderr: "" };
      return runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...env, ...(opts.env ?? {}) } });
    },
    uv: async (_root, script, args) => {
      const name = script.split(/[\\/]/).at(-1)!;
      uvs.push(name);
      if (name === "track.py") { tracks.push(args); return { exit: 0, stdout: JSON.stringify(BLOCKED), stderr: "" }; }
      return { exit: 0, stdout: JSON.stringify({ ok: true, harvested: [] }), stderr: "" };
    },
    hygiene: { env, fetch: async (_url, init) => { sent.push(String(init?.body ?? "")); return new Response("ok", { status: 200 }); } },
    resume: async (q, runId) => {
      resumed.push(runId);
      if (o.refuse) throw new ResumeRefused("ResumeFailed", "sbx exec claude-p printenv HOME exit 1: no sandbox");
      q.resumeFromPause(runId, "engine-resume", { engine_run_id: E1 }, me);
      return { ok: true };
    },
    ...(o.relaunch ? { relaunch: o.relaunch } : {}),
  };
  return { deps, sent, resumed, tracks, uvs };
}

const bind = (root: string) => {
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), "planning:\n  jira:\n    site: example.atlassian.net\n    project_key: TKS\n");
};
const ev = (fx: Fx, kind: string) => fx.events().filter((e) => e.kind === kind);
const kinds = (fx: Fx) => fx.events().map((e) => e.kind);
/** A fresh pause of the same story after a resume: the engine re-drove it and halted the same way again. */
function pauseAgain(fx: Fx) {
  writeFileSync(fx.specFile, spec("blocked"));
  writeSnapshot(fx.snap);
  fx.queue.markLaunched(fx.id, E1, { end: {} });
  fx.pause();
}

// ---------------------------------------------------------------- the recognition

describe("Story 33.6: the recognition", () => {
  test("each renderer message, and a render_skill.py mention, is recognised; the sandbox prefix resolves under the served root", async () => {
    const fx = await pausedRun();
    const { deps } = passDeps(fx);
    for (const m of msgs(SANDBOX_PATH)) {
      const events = fx.events().map((e) => e.kind === "paused" ? { ...e, detail: { ...e.detail, engine: { ...(e.detail!.engine as object), paused_reason: devReason(m) } } } : e);
      const s = await staleRenderView(fx.run(), events, deps);
      expect(s).toEqual({ story_key: KEY, snapshot: SNAP, dir: fx.snap, spec: fx.specFile });
    }
    expect(RENDER_HALT_MESSAGES).toHaveLength(4);
  });

  const withReason = (fx: Fx, reason: string, stage = "escalation") => fx.events().map((e) =>
    e.kind === "paused" ? { ...e, detail: { ...e.detail, engine: { ...(e.detail!.engine as object), paused_reason: reason, paused_stage: stage } } } : e);

  test("a path that runs on to a file is cut to the folder; any separator and prefix are accepted", async () => {
    expect(snapshotFolders(`failed to verify ${SANDBOX_PATH}/step-01-plan.md: [Errno 2]`)).toEqual([SNAP.slice("_bmad/render/".length)]);
    expect(snapshotFolders(`C:\\agent-work\\wt\\${SNAP.split("/").join("\\")}\\references\\check.md`)).toEqual([SNAP.slice("_bmad/render/".length)]);
    // The same folder named twice (with and without a file) is one folder.
    expect(snapshotFolders(`${SANDBOX_PATH} and ${SANDBOX_PATH}/workflow.md`)).toHaveLength(1);
    const fx = await pausedRun();
    const { deps } = passDeps(fx);
    const win = devReason(`generation contains unexpected or missing files: C:\\agent-work\\wt\\${SNAP.split("/").join("\\")}`);
    expect(await staleRenderView(fx.run(), withReason(fx, win), deps)).toMatchObject({ snapshot: SNAP, dir: fx.snap });
  });

  test("not recognised: two folders, `..`, outside `_bmad/render/`, another stage, no dev-session prefix, no renderer message", async () => {
    const fx = await pausedRun();
    const { deps } = passDeps(fx);
    const other = SANDBOX_PATH.replace("172e0a66eabaf094fb43", "99990a66eabaf094fb43");
    const not = [
      withReason(fx, devReason(`generation contains unexpected or missing files: ${SANDBOX_PATH} (also ${other})`)),
      withReason(fx, devReason("generation contains unexpected or missing files: /home/agent/w/_bmad/render/../../etc/passwd")),
      withReason(fx, devReason("generation contains unexpected or missing files: /home/agent/w/_bmad/render/a/../b")),
      withReason(fx, devReason("generation contains unexpected or missing files: /home/agent/w/_bmad/other/a/b/c")),
      withReason(fx, devReason("generation contains unexpected or missing files: /home/agent/w/_bmad/render/a/b")),
      withReason(fx, REASON, "dev"),
      withReason(fx, REASON, "pre_commit"),
      withReason(fx, REASON.replace("CRITICAL escalation from dev session", "CRITICAL escalation from review session")),
      withReason(fx, `HALT: generation contains unexpected or missing files: ${SANDBOX_PATH}`),
      withReason(fx, `CRITICAL escalation from dev session: the snapshot ${SANDBOX_PATH} looked wrong`),
    ];
    for (const events of not) expect(await staleRenderView(fx.run(), events, deps)).toBeUndefined();
    expect(snapshotFolders("_bmad/render/./b/c")).toBeUndefined();
  });

  test("each renderer message alone (no render_skill.py mention) is recognised; neither is not", async () => {
    const fx = await pausedRun();
    const { deps } = passDeps(fx);
    const alone = [
      `corrupt existing generation ${SANDBOX_PATH}: Expecting value: line 1 column 1 (char 0)`,
      `generation contains unexpected or missing files: ${SANDBOX_PATH}`,
      `failed to verify ${SANDBOX_PATH}/workflow.md: [Errno 2] No such file or directory`,
      `generation output hash mismatch: ${SANDBOX_PATH}/workflow.md`,
    ];
    for (const m of alone) {
      expect(m).not.toContain("render_skill.py");
      expect(await staleRenderView(fx.run(), withReason(fx, `CRITICAL escalation from dev session: HALT: ${m}`), deps)).toMatchObject({ snapshot: SNAP });
    }
    expect(await staleRenderView(fx.run(), withReason(fx, `CRITICAL escalation from dev session: the skill would not load from ${SANDBOX_PATH}`), deps)).toBeUndefined();
  });

  test("a path ending a sentence (`…/<generation>.`) is the folder; with and without the period it is one folder", async () => {
    const gen = SNAP.slice("_bmad/render/".length);
    expect(snapshotFolders(`generation contains unexpected or missing files: ${SANDBOX_PATH}.`)).toEqual([gen]);
    expect(snapshotFolders(`See ${SANDBOX_PATH}. The renderer said: failed to verify ${SANDBOX_PATH}/workflow.md`)).toEqual([gen]);
    expect(snapshotFolders(`${SANDBOX_PATH}...`)).toEqual([gen]);
    expect(snapshotFolders("_bmad/render/a/b/...")).toBeUndefined();
    const fx = await pausedRun();
    const reason = `CRITICAL escalation from dev session: HALT: generation contains unexpected or missing files: ${SANDBOX_PATH}.`;
    expect(await staleRenderView(fx.run(), withReason(fx, reason), passDeps(fx).deps)).toMatchObject({ snapshot: SNAP, dir: fx.snap });
  });

  test("`_bmad` needs a left boundary: the start, a separator, or a character outside `[A-Za-z0-9_.-]`", () => {
    const gen = SNAP.slice("_bmad/render/".length);
    for (const ok of [SNAP, `/home/a/${SNAP}`, `C:\\w\\${SNAP.split("/").join("\\")}`, `'${SNAP}'`, `(${SNAP})`, `\`${SNAP}\``, `path=${SNAP}`]) {
      expect(snapshotFolders(ok)).toEqual([gen]);
    }
    for (const no of [`x${SNAP}`, "my_bmad/render/a/b/c", `/home/a/not_bmad/render/a/b/c`, `/home/a/v1.0_bmad/render/a/b/c`, `/home/a/a-_bmad/render/a/b/c`]) {
      expect(snapshotFolders(no)).toEqual([]);
    }
  });

  test("the untracked check: only `git ls-files --error-unmatch` exit 1 is untracked; 128, a timeout or a throw is not recognised", async () => {
    const fx = await pausedRun();
    const { deps } = passDeps(fx);
    for (const exit of [128, null, 2]) {
      const run: PausedDeps["run"] = async () => ({ exit: exit as number, stdout: "", stderr: "fatal: not a git repository" });
      expect(await staleRenderView(fx.run(), fx.events(), { ...deps, run })).toBeUndefined();
    }
    expect(await staleRenderView(fx.run(), fx.events(), { ...deps, run: async () => { throw new Error("spawn git ENOENT"); } })).toBeUndefined();
    expect(await staleRenderView(fx.run(), fx.events(), { ...deps, run: async () => ({ exit: 1, stdout: "", stderr: "error: pathspec did not match" }) })).toMatchObject({ snapshot: SNAP });
  });

  test("a served root that is not a git repository is not recognised (real git, exit 128)", async () => {
    const fx = await pausedRun();
    const bare = tempDir("tk-sup-ar-norepo-");
    const specFile = join(bare, ...SPEC_REL.split("/"));
    mkdirSync(join(specFile, ".."), { recursive: true });
    writeFileSync(specFile, spec("blocked"));
    writeSnapshot(join(bare, ...SNAP.split("/")));
    const { deps } = passDeps(fx);
    const env = { ...deps.env, GIT_CEILING_DIRECTORIES: join(bare, "..") };
    const r = await deps.run!("git", ["-C", bare, "ls-files", "--error-unmatch", "--", SPEC_REL], { cwd: bare, timeoutS: 30, env });
    expect(r.exit).toBe(128);
    const run: PausedDeps["run"] = (bin, args, opts) => deps.run!(bin, args, { ...opts, env });
    expect(await staleRenderView({ worktree: bare, prefix: null }, fx.events(), { ...deps, run })).toBeUndefined();
  });

  test("not recognised: a tracked spec, or a spec that is not `blocked`", async () => {
    const tracked = await pausedRun({ tracked: true });
    expect(await staleRenderView(tracked.run(), tracked.events(), passDeps(tracked).deps)).toBeUndefined();
    for (const status of ["in-progress", "in-review", "done"]) {
      const fx = await pausedRun({ status });
      expect(await staleRenderView(fx.run(), fx.events(), passDeps(fx).deps)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------- the folder check

describe("Story 33.6: the folder check", () => {
  test("complete passes; a missing output, an empty output, an unparsable manifest and empty `outputs` fail", () => {
    const root = tempDir("tk-sup-ar-snap-");
    const ok = join(root, "ok");
    writeSnapshot(ok);
    expect(snapshotComplete(ok)).toBe(true);
    const missing = join(root, "missing");
    writeSnapshot(missing, { files: { "workflow.md": "# w\n", "step-01-plan.md": "# p\n" } });
    expect(snapshotComplete(missing)).toBe(false);
    const empty = join(root, "empty");
    writeSnapshot(empty, { files: { ...OUTPUTS, "workflow.md": "" } });
    expect(snapshotComplete(empty)).toBe(false);
    const bad = join(root, "bad");
    writeSnapshot(bad, { raw: "{\"outputs\": {\"workflow.md\"" });
    expect(snapshotComplete(bad)).toBe(false);
    const none = join(root, "none");
    writeSnapshot(none, { outputs: {} });
    expect(snapshotComplete(none)).toBe(false);
    const list = join(root, "list");
    writeSnapshot(list, { raw: JSON.stringify({ outputs: ["workflow.md"] }) });
    expect(snapshotComplete(list)).toBe(false);
    const escape = join(root, "escape");
    writeSnapshot(escape, { outputs: { "../ok/workflow.md": "x" } });
    expect(snapshotComplete(escape)).toBe(false);
    expect(snapshotComplete(join(root, "absent"))).toBe(false);
  });

  test("a failing check leaves the snapshot, the draft and the run untouched", async () => {
    const fx = await pausedRun();
    writeFileSync(join(fx.snap, "workflow.md"), "");
    const p = passDeps(fx);
    const before = kinds(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.resumed).toHaveLength(0);
    expect(existsSync(fx.snap) && existsSync(fx.specFile)).toBe(true);
    expect(kinds(fx)).toEqual(before);
    expect(p.sent).toHaveLength(0);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
  });
});

// ---------------------------------------------------------------- the single attempt

describe("Story 33.6: attempt 1 removes, resumes once, records and notifies", () => {
  test("the snapshot and the draft are removed, resume is called once, one event and one line; no block on a bound project", async () => {
    const fx = await pausedRun();
    bind(fx.run().root);
    const p = passDeps(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.resumed).toEqual([fx.id]);
    expect(existsSync(fx.snap)).toBe(false);
    expect(existsSync(fx.specFile)).toBe(false);
    expect(existsSync(join(fx.wt, "_bmad", "render", "bmad-build-auto"))).toBe(true); // only the generation folder
    const rec = ev(fx, AUTO_RESUME);
    expect(rec).toHaveLength(1);
    expect(rec[0]!.detail).toEqual({
      reason: "stale-render-view", snapshot: SNAP, story_key: KEY, engine_run_id: E1, attempt: 1, resumed: true, notify: { ok: true, via: "ntfy" },
    });
    expect(p.sent).toEqual([`supervisor: run ${fx.id} auto-resumed: story ${KEY} halted on a stale render view of ${SNAP} (attempt 1)`]);
    expect(p.tracks).toHaveLength(0);
    expect(ev(fx, "track-block")).toHaveLength(0);
    expect(ev(fx, "awaiting-ruling")).toHaveLength(0);
    expect(fx.run().state).toBe("running");
    // the run is no longer paused: another pass does nothing more
    await closeOutPaused(fx.queue, p.deps);
    expect(p.resumed).toHaveLength(1);
    expect(ev(fx, AUTO_RESUME)).toHaveLength(1);
  });

  test("with no notifier, the event records the skip", async () => {
    const fx = await pausedRun();
    const p = passDeps(fx, { notify: false });
    await closeOutPaused(fx.queue, p.deps);
    expect(ev(fx, AUTO_RESUME)[0]!.detail!.notify).toEqual({ ok: false, skipped: "no notifier configured (TK_SUPERVISOR_NOTIFY is unset)" });
    expect(p.sent).toHaveLength(0);
  });

  test("a refused resume: `resumed: false` and `error`, the refused line, the run stays paused and the lease released; no second resume", async () => {
    const fx = await pausedRun();
    bind(fx.run().root);
    const p = passDeps(fx, { refuse: true });
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    const error = "ResumeFailed: sbx exec claude-p printenv HOME exit 1: no sandbox";
    expect(ev(fx, AUTO_RESUME)[0]!.detail).toEqual({
      reason: "stale-render-view", snapshot: SNAP, story_key: KEY, engine_run_id: E1, attempt: 1, resumed: false, error, notify: { ok: true, via: "ntfy" },
    });
    expect(p.sent).toEqual([`supervisor: run ${fx.id} stays paused: auto-resume of story ${KEY} after a stale render view of ${SNAP} refused: ${error}`]);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
    for (let i = 0; i < 2; i++) expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.resumed).toHaveLength(1);
    expect(ev(fx, AUTO_RESUME)).toHaveLength(1);
    expect(p.sent).toHaveLength(1);
    expect(p.tracks).toHaveLength(0);
  });

  test("a second pause of the same story: one `attempt: 2` with `first_at`, one line, nothing removed or resumed; the 31.5 block then runs once", async () => {
    const fx = await pausedRun();
    bind(fx.run().root);
    const p = passDeps(fx);
    await closeOutPaused(fx.queue, p.deps);
    const first = ev(fx, AUTO_RESUME)[0]!;
    pauseAgain(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.resumed).toHaveLength(1);
    expect(existsSync(fx.snap) && existsSync(fx.specFile)).toBe(true);
    const rec = ev(fx, AUTO_RESUME);
    expect(rec).toHaveLength(2);
    expect(rec[1]!.detail).toEqual({
      reason: "stale-render-view", snapshot: SNAP, story_key: KEY, engine_run_id: E1, attempt: 2, resumed: false, first_at: first.at,
      notify: { ok: true, via: "ntfy" },
    });
    expect(p.sent.at(-1)).toBe(`supervisor: run ${fx.id} stays paused for the operator: story ${KEY} halted on a stale render view of ${SNAP} again after the auto-resume at ${first.at}`);
    // the draft (a dev session's `blocked` end) owes the 31.5 block, unchanged
    expect(p.tracks).toEqual([["block", "--directory", fx.run().root, "--story", KEY, "--reason", "dev session ended blocked",
      "--resolves", `a ruling in the spec (${SPEC_REL})`, "--source", "run"]]);
    expect(ev(fx, "track-block")).toHaveLength(1);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
    // a third pass adds nothing
    const before = kinds(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(kinds(fx)).toEqual(before);
    expect(p.sent).toHaveLength(2);
    expect(p.tracks).toHaveLength(1);
    expect(p.resumed).toHaveLength(1);
    // the block's record is on this pause (after the attempt-2 record), and the lease was let go of
    const since = fx.events().slice(fx.events().findLastIndex((e) => e.kind === "paused") + 1).map((e) => e.kind);
    expect(since).toEqual([AUTO_RESUME, "track-block"]);
    expect(ev(fx, "track-block")[0]!.detail).toMatchObject({ story_key: KEY, engine_run_id: E1, ok: true, status: "complete" });
    expect(fx.queue.takeForCloseOut(fx.id, other)).toMatchObject({ state: "paused", owner_nonce: other.nonce });
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a removal that fails (the folder cannot be renamed aside): no event, no resume, still paused and the lease released; the next pass retries", async () => {
    const fx = await pausedRun();
    const p = passDeps(fx);
    const locked = [join(fx.snap, "..")];
    for (const d of locked) chmodSync(d, 0o555);
    try {
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
      expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
      expect(p.resumed).toHaveLength(0);
      expect(p.sent).toHaveLength(0);
      expect(snapshotComplete(fx.snap)).toBe(true);
      expect(existsSync(fx.specFile)).toBe(true);
      expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
    } finally { for (const d of locked) chmodSync(d, 0o755); }
    await closeOutPaused(fx.queue, p.deps);
    expect(p.resumed).toEqual([fx.id]);
    expect(ev(fx, AUTO_RESUME).map((e) => e.detail!.attempt)).toEqual([1]);
    expect(existsSync(fx.snap) || existsSync(fx.specFile)).toBe(false);
    expect(readdirSync(join(fx.snap, ".."))).toEqual([]); // the aside folder removed too
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a draft removal that fails: the folder is renamed back in place, complete; no event, no resume; the next pass does attempt 1", async () => {
    const fx = await pausedRun();
    const p = passDeps(fx);
    const stories = join(fx.specFile, "..");
    chmodSync(stories, 0o555);
    try {
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
      expect(snapshotComplete(fx.snap)).toBe(true);
      expect(readdirSync(join(fx.snap, ".."))).toEqual([SNAP.split("/").at(-1)!]); // no aside folder left
      expect(existsSync(fx.specFile)).toBe(true);
      expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
      expect(p.resumed).toHaveLength(0);
      expect(p.sent).toHaveLength(0);
      expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
    } finally { chmodSync(stories, 0o755); }
    await closeOutPaused(fx.queue, p.deps);
    expect(p.resumed).toEqual([fx.id]);
    expect(ev(fx, AUTO_RESUME).map((e) => [e.detail!.attempt, e.detail!.resumed])).toEqual([[1, true]]);
    expect(existsSync(fx.snap) || existsSync(fx.specFile)).toBe(false);
  });

  test("the default resume: `resumePaused` accepts the run under the pass's lease, `engine-resume`, `running`, `resumed: true`", async () => {
    const fx = await pausedRun();
    const p = passDeps(fx);
    const spawned: { bin: string; args: string[]; cwd: string }[] = [];
    let exit!: (r: RunResult) => void;
    const done = new Promise<RunResult>((r) => { exit = r; });
    const { resume: _injected, ...rest } = p.deps;
    const deps = {
      ...rest, pidPolls: 1, sleep: async () => {},
      spawn: (bin: string, args: string[], opts: { cwd: string }): HoldChild => { spawned.push({ bin, args, cwd: opts.cwd }); return { pid: 424242, done }; },
    } as PausedDeps;
    expect(await closeOutPaused(fx.queue, deps)).toEqual({ closed: [], awaiting: [] });
    expect(spawned).toEqual([{ bin: "bmad-loop", args: resolveArgs(fx.wt, E1), cwd: fx.wt }]);
    const move = ev(fx, "engine-resume");
    expect(move).toHaveLength(1);
    expect(move[0]!.detail).toMatchObject({ engine_run_id: E1, owner: { nonce: me.nonce } });
    expect(fx.run()).toMatchObject({ state: "running", owner_nonce: me.nonce });
    expect(ev(fx, AUTO_RESUME)[0]!.detail).toMatchObject({ attempt: 1, resumed: true });
    expect(kinds(fx).indexOf("engine-resume")).toBeLessThan(kinds(fx).indexOf(AUTO_RESUME));
    exit({ exit: 0, stdout: "", stderr: "" });
    // the hand-back is not awaited by the pass: poll (bounded) for its `launched` record
    const handedBack = () => ev(fx, "launched").at(-1)?.detail?.resumed === true;
    for (const deadline = Date.now() + 5000; !handedBack() && Date.now() < deadline;) await Bun.sleep(10);
    expect(ev(fx, "launched").at(-1)!.detail).toMatchObject({ resumed: true });
  });

  test("a concurrent pass records attempt 2 between this pass's read and its take: no duplicate record or line; the 31.5 block runs once", async () => {
    const fx = await pausedRun();
    bind(fx.run().root);
    const p = passDeps(fx);
    await closeOutPaused(fx.queue, p.deps);
    const first = ev(fx, AUTO_RESUME)[0]!;
    pauseAgain(fx);
    const take = fx.queue.takeForCloseOut.bind(fx.queue);
    let raced = false;
    fx.queue.takeForCloseOut = (id, owner) => {
      if (!raced) {
        raced = true;
        fx.queue.note(id, AUTO_RESUME, { reason: "stale-render-view", snapshot: SNAP, story_key: KEY, engine_run_id: E1, attempt: 2, resumed: false, first_at: first.at });
      }
      return take(id, owner);
    };
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(raced).toBe(true);
    expect(ev(fx, AUTO_RESUME).map((e) => e.detail!.attempt)).toEqual([1, 2]);
    expect(p.sent).toHaveLength(1); // the attempt-1 line only
    expect(p.resumed).toHaveLength(1);
    expect(p.tracks).toHaveLength(1);
    expect(ev(fx, "track-block")).toHaveLength(1);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a concurrent pass records attempt 1 between this pass's read and its take: no second attempt 1 or resume; the attempt-2 path, if the snapshot is still there", async () => {
    for (const removed of [false, true]) {
      const fx = await pausedRun();
      const p = passDeps(fx);
      const take = fx.queue.takeForCloseOut.bind(fx.queue);
      let raced = false;
      fx.queue.takeForCloseOut = (id, owner) => {
        if (!raced) {
          raced = true;
          if (removed) { rmSync(fx.snap, { recursive: true, force: true }); rmSync(fx.specFile, { force: true }); }
          fx.queue.note(id, AUTO_RESUME, { reason: "stale-render-view", snapshot: SNAP, story_key: KEY, engine_run_id: E1, attempt: 1, resumed: false, error: "ResumeFailed: x" });
        }
        return take(id, owner);
      };
      expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
      expect(raced).toBe(true);
      expect(p.resumed).toHaveLength(0);
      // still there: the second halt is recorded once; removed by the other pass: nothing more
      expect(ev(fx, AUTO_RESUME).map((e) => e.detail!.attempt)).toEqual(removed ? [1] : [1, 2]);
      expect(p.sent).toHaveLength(removed ? 0 : 1);
      expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
    }
  });

  test("the attempt counts under any engine run id: a pause under a new engine is attempt 2", async () => {
    const fx = await pausedRun();
    const p = passDeps(fx);
    await closeOutPaused(fx.queue, p.deps);
    writeFileSync(fx.specFile, spec("blocked"));
    writeSnapshot(fx.snap);
    fx.queue.markLaunched(fx.id, E2, { end: {} });
    fx.queue.markPaused(fx.id, { engine: { run_id: E2, status: "running", paused_stage: "escalation", paused_reason: REASON, paused_story_key: KEY }, pr: PR });
    await closeOutPaused(fx.queue, p.deps);
    expect(p.resumed).toHaveLength(1);
    expect(ev(fx, AUTO_RESUME).map((e) => [e.detail!.attempt, e.detail!.engine_run_id])).toEqual([[1, E1], [2, E2]]);
  });

  test("the lines are one line each, within NOTICE_MAX_BYTES", () => {
    const long = `ResumeFailed: ${"é\nx ".repeat(3000)}`;
    const line = autoResumeRefusedLine("q-1", KEY, SNAP, long);
    expect(line).not.toContain("\n");
    expect(Buffer.byteLength(line, "utf-8")).toBeLessThanOrEqual(NOTICE_MAX_BYTES);
    expect(line.endsWith("… [reason truncated]")).toBe(true);
    expect(autoResumedLine("q-1", KEY, SNAP)).toBe(`supervisor: run q-1 auto-resumed: story ${KEY} halted on a stale render view of ${SNAP} (attempt 1)`);
    expect(secondHaltLine("q-1", KEY, SNAP, "2026-10-27T00:00:00Z")).not.toContain("\n");
  });
});

// ---------------------------------------------------------------- untouched other pauses

describe("Story 33.6: other pauses behave as before", () => {
  test("a landed story is closed out (even with a render reason and a complete snapshot)", async () => {
    const fx = await pausedRun({ status: "done" });
    writeFileSync(fx.specFile, `---\ntitle: 'x'\nstatus: done\nreconcile_verdict: no-impact\n---\n`);
    const relaunch: PausedDeps["relaunch"] = async (q, run) => async () => { q.markLaunched(run.run_id, E2, { end: {} }); };
    const p = passDeps(fx, { relaunch });
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [fx.id], awaiting: [] });
    expect(ev(fx, "close-out")).toHaveLength(1);
    expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
    expect(p.resumed).toHaveLength(0);
    expect(existsSync(fx.snap)).toBe(true);
  });

  test("a landed story awaiting a ruling: one `awaiting-ruling`, one notification, no auto-resume", async () => {
    const fx = await pausedRun({ status: "done" });
    const p = passDeps(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [fx.id] });
    expect(ev(fx, "awaiting-ruling")).toHaveLength(1);
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]).toContain("awaiting a ruling");
    expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
    expect(p.resumed).toHaveLength(0);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a dev `blocked` end that is not a render halt: one block call, no auto-resume, nothing removed", async () => {
    const fx = await pausedRun({ stage: "dev", reason: "dev session ended blocked" });
    bind(fx.run().root);
    const p = passDeps(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.tracks).toEqual([["block", "--directory", fx.run().root, "--story", KEY, "--reason", "dev session ended blocked",
      "--resolves", `a ruling in the spec (${SPEC_REL})`, "--source", "run"]]);
    expect(ev(fx, "track-block")).toHaveLength(1);
    expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
    expect(p.resumed).toHaveLength(0);
    expect(p.sent).toHaveLength(0);
    expect(existsSync(fx.snap) && existsSync(fx.specFile)).toBe(true);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a render-halt reason on a blocked dev end that names no snapshot: the 31.5 block, nothing else", async () => {
    const fx = await pausedRun({ reason: devReason("render_skill.py failed: permission denied") });
    bind(fx.run().root);
    const p = passDeps(fx);
    await closeOutPaused(fx.queue, p.deps);
    expect(p.tracks).toHaveLength(1);
    expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
    expect(p.resumed).toHaveLength(0);
  });

  test("an engine escalation with an `in-review` spec: one block call with the paused reason, no auto-resume", async () => {
    const fx = await pausedRun({ status: "in-review", reason: "reconcile asks for a ruling" });
    bind(fx.run().root);
    const p = passDeps(fx);
    expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.tracks).toEqual([["block", "--directory", fx.run().root, "--story", KEY, "--reason", "reconcile asks for a ruling",
      "--resolves", `a ruling in the spec (${SPEC_REL})`, "--source", "run"]]);
    expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
    expect(p.resumed).toHaveLength(0);
    expect(p.sent).toHaveLength(0);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("a bound project's render halt with an incomplete snapshot folder: the 31.5 block exactly once, no auto-resume", async () => {
    const fx = await pausedRun();
    writeFileSync(join(fx.snap, "references", "check.md"), "");
    bind(fx.run().root);
    const p = passDeps(fx);
    for (let i = 0; i < 3; i++) expect(await closeOutPaused(fx.queue, p.deps)).toEqual({ closed: [], awaiting: [] });
    expect(p.tracks).toEqual([["block", "--directory", fx.run().root, "--story", KEY, "--reason", "dev session ended blocked",
      "--resolves", `a ruling in the spec (${SPEC_REL})`, "--source", "run"]]);
    expect(ev(fx, "track-block")).toHaveLength(1);
    expect(ev(fx, AUTO_RESUME)).toHaveLength(0);
    expect(p.resumed).toHaveLength(0);
    expect(p.sent).toHaveLength(0);
    expect(existsSync(fx.snap) && existsSync(fx.specFile)).toBe(true);
    expect(fx.run()).toMatchObject({ state: "paused", owner_pid: null });
  });

  test("an unbound project's render halt with no snapshot folder: nothing at all", async () => {
    const fx = await pausedRun({ snapshot: false });
    const p = passDeps(fx);
    const before = kinds(fx);
    await closeOutPaused(fx.queue, p.deps);
    expect(kinds(fx)).toEqual(before);
    expect(p.resumed).toHaveLength(0);
    expect(existsSync(fx.specFile)).toBe(true);
  });
});
