/**
 * hostleg.ts — an ended run's host leg, re-runnable (Story 33.8, hole 52).
 *
 * `POST /runs/{id}/verify` (bearer only) and `bun src/cli.ts verify <run id>` re-run the host verify leg of an
 * ended run in one motion, replacing the hand recipe (cut a worktree, run `verify.host`, flip the PR):
 *
 *   refusals  checked in order before anything runs: `RunNotFound` (404); `ExternalRun` (409); `RunNotEnded`
 *             (409: `queued`, `running` or `paused`); `NoBranch` (409: no recorded worktree, the run branch not
 *             on origin per `git ls-remote --heads origin refs/heads/supervisor/run-<id>`, or that call failing);
 *             `VerifyRunning` (409: a `host-verify-leg` lease held by a live owner, `Queue.takeVerifyLeg`).
 *             `VerifyFailed` (500): the work folder unset, or the cut or materialise failed; the lease is released.
 *   the cut   `<run.worktree>.verify` (a leftover from a crashed leg removed first), the branch fetched, then
 *             `git worktree add --relative-paths --detach <path> <tip sha>` (detached: the local run branch may
 *             still exist) and `materialise`d as `prepareWorktree` does.
 *   the leg   `hostVerify` on a copy of the run naming the fresh worktree, under the sweep's guard: exactly as the
 *             close-out runs it (the command read at the run's `base_ref` in the checkout). The worktree is then
 *             removed (best effort).
 *   the PR    the run's recorded PR (`ended`, then `closed_out`/`paused`), else an open PR from the run branch
 *             (`gh pr list`). On green only: `gh pr view <pr> --json state,isDraft`, and an open draft is marked
 *             ready (`gh pr ready <pr>`). Red or skipped never touches the PR (no `--undo`, no body edit).
 *   result    one `host-verify` event: the leg's detail plus `rerun {by, head, worktree, pr, pr_ready?}`. It closes
 *             the lease. The run's state, its `ended` event and its engine are never touched (CAP-15).
 *
 * The refusals, the lease, the cut and materialise answer synchronously; the leg itself is the handle's `done`.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { workDir } from "./env";
import { canonicalPr } from "./hygiene";
import { hostVerify, isSlice, type HostVerifyResult } from "./hostverify";
import { isTerminal, selfOwner, servedRoot, type Owner, type Queue, type QueueEvent, type QueueRun, type RunState } from "./queue";
import { lastJsonObject, type RunResult } from "./server";
import { gh, materialise, openPrUrl, priorPr, runBranch, runner, type WorktreeDeps } from "./worktree";

export type VerifyRefusal = "RunNotFound" | "ExternalRun" | "RunNotEnded" | "NoBranch" | "VerifyRunning" | "SchemaError" | "VerifyFailed";

/** A re-run refused (the API and the verb map `code` to their answers). */
export class VerifyRefused extends Error {
  constructor(readonly code: VerifyRefusal, detail: string) { super(`${code}: ${detail}`); this.name = "VerifyRefused"; }
}

export interface HostLegDeps extends WorktreeDeps {
  /** The lease's owner (default `selfOwner()`). */
  self?: Owner;
}

/** What the re-run adds to its `host-verify` event. */
export interface HostLegRerun {
  by: "api" | "cli"; head: string; worktree: string; pr: string | null;
  /** On green with a PR: `marked` (a draft made ready), `already`, `not open`, or `error: <clipped>`. */
  pr_ready?: string;
}
export type HostLegResult = HostVerifyResult & { rerun: HostLegRerun };

/** A re-run started: the run (its terminal state unchanged), the tip it was cut at, and the leg's result. */
export interface HostLegStarted { run_id: string; state: RunState; head: string; done: Promise<HostLegResult> }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Command output for an event: URL userinfo redacted, clipped (worktree.ts's rule). */
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const failed = (r: RunResult) => `exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;

const git = (deps: WorktreeDeps, cwd: string, args: string[], timeoutS = 120) => runner(deps)("git", args, { cwd, timeoutS });

/** The tip SHA of the run branch on origin, or a `NoBranch` refusal. */
async function remoteTip(run: QueueRun, branch: string, deps: WorktreeDeps): Promise<string> {
  let r: RunResult;
  try { r = await git(deps, run.root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], 60); }
  catch (e) { throw new VerifyRefused("NoBranch", `git ls-remote failed: ${clip(message(e))}`); }
  if (r.exit !== 0) throw new VerifyRefused("NoBranch", `git ls-remote ${failed(r)}`);
  const sha = r.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.split(/\s+/)[0];
  if (!sha) throw new VerifyRefused("NoBranch", `'${branch}' is not on origin (a "no changes" end, or never pushed)`);
  return sha;
}

/** Remove a worktree folder: `git worktree remove --force`, else `rmSync` and `git worktree prune`. Answers
 * `removed` or `kept: <why>`; never throws. */
async function removeWorktree(root: string, path: string, deps: WorktreeDeps): Promise<string> {
  let why = "";
  try {
    const r = await git(deps, root, ["worktree", "remove", "--force", path]);
    if (r.exit === 0 && !existsSync(path)) return "removed";
    why = `git worktree remove ${failed(r)}`;
  } catch (e) { why = `git worktree remove: ${clip(message(e))}`; }
  try { rmSync(path, { recursive: true, force: true }); } catch (e) { why = `${why}; rm: ${clip(message(e))}`; }
  try { await git(deps, root, ["worktree", "prune"]); } catch { /* its record only */ }
  return existsSync(path) ? `kept: ${why}` : "removed";
}

/** The run's PR: the latest canonical `detail.pr` on its `ended` events, then its `closed_out`/`paused` ones
 * (`priorPr`), else an open PR from the run branch (`gh pr list`); null with none. */
async function runPr(run: QueueRun, events: readonly QueueEvent[], branch: string, deps: WorktreeDeps): Promise<string | null> {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== "ended") continue;
    const pr = canonicalPr(e.detail?.pr);
    if (pr) return pr;
  }
  const prior = priorPr(events);
  if (prior) return prior;
  try {
    const r = await gh(deps, run.root, ["pr", "list", "--head", branch, "--state", "open", "--json", "url"]);
    return r.exit === 0 ? openPrUrl(r.stdout) ?? null : null;
  } catch { return null; }
}

/** A green leg's PR flip: an open draft marked ready (`marked`), an open ready PR left (`already`), anything else
 * left (`not open`); a failure is `error: <clipped>`. Never `--undo`, never a body edit. */
async function markReady(root: string, pr: string, deps: WorktreeDeps): Promise<string> {
  try {
    const v = await gh(deps, root, ["pr", "view", pr, "--json", "state,isDraft"]);
    const view = lastJsonObject(v.stdout) as Record<string, unknown> | null;
    if (v.exit !== 0 || !view) return `error: gh pr view ${failed(v)}`;
    if (view.state !== "OPEN") return "not open";
    if (view.isDraft !== true) return "already";
    const r = await gh(deps, root, ["pr", "ready", pr]);
    return r.exit === 0 ? "marked" : `error: gh pr ready ${failed(r)}`;
  } catch (e) { return `error: ${clip(message(e))}`; }
}

/** Re-run an ended run's host leg (see the header). Throws `VerifyRefused`; answers once the leg is started. */
export async function rerunHostLeg(queue: Queue, runId: string, opts: { by: "api" | "cli" }, deps: HostLegDeps = {}): Promise<HostLegStarted> {
  const run = queue.get(runId);
  if (!run) throw new VerifyRefused("RunNotFound", `queue run '${runId}' not found`);
  if (run.state === "external") throw new VerifyRefused("ExternalRun", `queue run '${runId}' was started outside the queue`);
  if (!isTerminal(run.state)) throw new VerifyRefused("RunNotEnded", `queue run '${runId}' is ${run.state}: only an ended run's host leg is re-run`);
  if (!run.worktree) throw new VerifyRefused("NoBranch", `queue run '${runId}' has no recorded worktree (no branch was cut)`);
  const branch = runBranch(run.run_id);
  const head = await remoteTip(run, branch, deps);
  const self = deps.self ?? selfOwner();
  if (!queue.takeVerifyLeg(runId, self, opts.by)) {
    throw new VerifyRefused("VerifyRunning", `a host-leg re-run of queue run '${runId}' is already running`);
  }
  const path = `${run.worktree}.verify`;
  try {
    if (!workDir(deps.env ?? process.env)) throw new Error("TK_SUPERVISOR_WORK is unset");
    if (existsSync(path)) await removeWorktree(run.root, path, deps); // a crashed earlier leg's leftover
    // A registration whose folder is gone (a crash between the rmSync and the prune, a hand delete) would make
    // `git worktree add` refuse the path: prune it first, best effort.
    try { await git(deps, run.root, ["worktree", "prune"]); } catch { /* its record only */ }
    const f = await git(deps, run.root, ["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    if (f.exit !== 0) throw new Error(`git fetch ${failed(f)}`);
    mkdirSync(dirname(path), { recursive: true });
    const add = await git(deps, run.root, ["worktree", "add", "--relative-paths", "--detach", path, head]);
    if (add.exit !== 0) throw new Error(`git worktree add ${failed(add)}`);
    await materialise(run.root, servedRoot({ worktree: path, prefix: run.prefix })!, deps);
  } catch (e) {
    if (existsSync(path)) await removeWorktree(run.root, path, deps);
    try { queue.releaseVerifyLeg(runId, self); } catch { /* a dead owner's lease is taken over */ }
    throw new VerifyRefused("VerifyFailed", clip(message(e)));
  }
  const done = runLeg(queue, run, path, { by: opts.by, head, branch }, deps);
  return { run_id: run.run_id, state: run.state, head, done };
}

/** The leg in the cut worktree, the removal, the PR, and the one `host-verify` event (it closes the lease). */
async function runLeg(
  queue: Queue, run: QueueRun, path: string, at: { by: "api" | "cli"; head: string; branch: string }, deps: HostLegDeps,
): Promise<HostLegResult> {
  let verify: HostVerifyResult;
  const rerun: HostLegRerun = { by: at.by, head: at.head, worktree: "kept", pr: null };
  try {
    const guardS = run.worker_guard_s ?? (Number(queue.definition(run)?.guards?.max_wall_clock_seconds) || 600);
    // Story 34.8: a slice run's re-run gets the assets step too (the close-out's detection, from the resolved definition).
    verify = await hostVerify({ ...run, worktree: path }, guardS, deps, { slice: isSlice(queue.definition(run)) });
    rerun.worktree = await removeWorktree(run.root, path, deps);
    rerun.pr = await runPr(run, queue.events(run.run_id), at.branch, deps);
    if (rerun.pr && !verify.skipped && verify.green) rerun.pr_ready = await markReady(run.root, rerun.pr, deps);
  } catch (e) {
    verify = { skipped: true, reason: `re-run failed: ${clip(message(e))}` };
    rerun.worktree = existsSync(path) ? await removeWorktree(run.root, path, deps) : "removed";
  }
  const result = { ...verify, rerun } as HostLegResult;
  try { queue.note(run.run_id, "host-verify", result as unknown as Record<string, unknown>); }
  catch (e) {
    // Not recorded (the queue busy): the lease is let go of, so the next re-run is not `VerifyRunning`.
    try { queue.releaseVerifyLeg(run.run_id, deps.self ?? selfOwner()); } catch { /* re-taken once this owner is dead */ }
    throw e;
  }
  return result;
}
