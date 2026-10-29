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
 *             Story 35.1: `git worktree add --relative-paths -B supervisor/run-<id> <path> <tip sha>` — on the run
 *             branch, never detached: a stale local branch (a close-out's removed worktree keeps it) is reset to
 *             origin's tip, so a commit there fast-forwards it; a local branch not an ancestor of that tip (unpushed
 *             commits) is `VerifyFailed` naming it and `git log --oneline <tip>..<local>` (never moved); another
 *             worktree holding the branch is `VerifyFailed` naming that worktree's path (never removed here). Then `materialise`d as `prepareWorktree` does.
 *   the leg   `hostVerify` on a copy of the run naming the fresh worktree, under the sweep's guard: exactly as the
 *             close-out runs it (the command read at the run's `base_ref` in the checkout).
 *   the proof Story 35.1 (DW-76: the re-run is a whole leg): on a slice run, under the close-out's own condition (Story
 *             35.3, `proofCommitDue`: a ran leg whose own playable step ran (exited 0 or 1) and whose store holds `report.json` and whose assets step is not
 *             red — green, a non-red `match` fault, or `skipped: no manifest` — on playable pass and fail alike), the
 *             placed art, the manifest and `.tk-studio/proof/<run_id>/` committed through `worktree.ts proofCommit`
 *             (`host leg: placed assets and proof (run <id>)`), then `git push origin <branch>` (never forced). A
 *             failure of either is `rerun.commit`/`rerun.pushed: "error: …"`: the leg still recorded, the body never
 *             edited, green flipping nothing; red still `--undo`es. A failed push resets the `.verify` worktree's
 *             branch to the cut tip (`git reset --hard <head>`); a failed reset appends `; local branch left ahead: …`
 *             to `rerun.pushed`. The rule: a re-run rolls back its own unpushed proof commit to the tip it was cut at,
 *             and on a red leg always attempts `--undo` whatever earlier step failed; only the body edit and the
 *             green ready flip depend on earlier steps succeeding. A non-slice re-run, or a slice one off the
 *             condition, commits nothing.
 *   the PR    the run's recorded PR (`ended`, then `closed_out`/`paused`), else an open PR from the run branch
 *             (`gh pr list`); `gh pr view <pr> --json state,isDraft,body`. Story 35.1 (hole 88, DW-82): an open PR's body
 *             is regenerated (`prBody` from the record, `launchedCloseOutInput`: the launch status block, the engine run,
 *             the recorded cost — the worktree gone, the old body's `## Metered cost` carried back unchanged, the
 *             record-only figure only when the old body has no such section; the commits `git log --oneline <base_ref>..HEAD`; its `## Host verify` the latest
 *             leg's section under a `Legs: <k> — …` history line) and `gh pr edit --body-file`; then green marks an
 *             open draft ready (`gh pr ready <pr>`) only once the body is `edited` (a failed edit leaves the PR as it
 *             was, `pr_ready` unset), red turns an open ready PR back to a draft (`gh pr ready <pr>
 *             --undo`, the event's `reason` is `redReason`), skipped flips nothing; Story 35.3: an inconclusive leg
 *             flips nothing either (never marked ready; the event's `reason` is `host verify inconclusive (playable): <reason>`,
 *             `inconclusiveReason`). A PR not open, or unreadable,
 *             is never edited; an unreadable one is `pr_body: "error: gh pr view …"` whatever the verdict.
 *             The worktree is then removed (best effort).
 *   result    one `host-verify` event: the leg's detail plus `rerun {by, head, worktree, pr, pr_ready?, commit?,
 *             pushed?, pr_body?, pr_draft?}` (its presence is `rerun: true`). It closes the lease. The run's state,
 *             its `ended` event and its engine are never touched (CAP-15).
 *
 * The refusals, the lease, the cut and materialise answer synchronously; the leg itself is the handle's `done`.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { workDir } from "./env";
import { canonicalPr } from "./hygiene";
import { hostVerify, inconclusiveReason, isInconclusive, isRed, isSlice, legHistory, legVerdict, redReason, type HostVerifyResult, type PrProof } from "./hostverify";
import { isTerminal, selfOwner, servedRoot, type Owner, type Queue, type QueueEvent, type QueueRun, type RunState } from "./queue";
import { lastJsonObject, type RunResult } from "./server";
import {
  editPrBody, gh, launchedCloseOutInput, markPrDraft, markPrReady, materialise, meteredCost, meteredCostSection, openPrUrl, originWebUrl,
  prBody, priorPr, proofCommit, proofCommitDue, runBranch, runner, type WorktreeDeps,
} from "./worktree";

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
  /** On green with a PR: `marked` (a draft made ready), `already`, `not open`, or `error: <clipped>`; unset when the
   * body edit failed (the PR left as it was). */
  pr_ready?: string;
  /** Story 35.1: a slice run's host-side commit (`{sha, frames, sheet?}`, sha `nothing to commit` on a clean index),
   * `skipped: <why>` off the close-out's condition, or `error: <clipped>`. */
  commit?: { sha: string; frames: string[]; sheet?: string; skipped_ignored?: string[] } | string;
  /** Story 35.1: the branch pushed after a commit, or `error: <clipped>`. */
  pushed?: string;
  /** Story 35.1: an open PR's body regenerated: `edited` or `error: <clipped>`; the PR's state unreadable (no edit):
   * `error: gh pr view …`. */
  pr_body?: string;
  /** Story 35.1: on red with a PR: `undone` (an open ready PR back to a draft), `already`, `not open`, or `error: <clipped>`. */
  pr_draft?: string;
}
/** The re-run's result; Story 35.1: a red leg's `reason` is `redReason` (a skipped one's is its own). */
export type HostLegResult = HostVerifyResult & { rerun: HostLegRerun; reason?: string };

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

/** The PR's state and its current body (`gh pr view --json state,isDraft,body`), or `error: <clipped>`. Never throws. */
async function prState(root: string, pr: string, deps: WorktreeDeps): Promise<{ open: boolean; draft: boolean; body?: string } | string> {
  try {
    const v = await gh(deps, root, ["pr", "view", pr, "--json", "state,isDraft,body"]);
    const view = lastJsonObject(v.stdout) as Record<string, unknown> | null;
    if (v.exit !== 0 || !view) return `error: gh pr view ${failed(v)}`;
    return { open: view.state === "OPEN", draft: view.isDraft === true, ...(typeof view.body === "string" ? { body: view.body } : {}) };
  } catch (e) { return `error: gh pr view: ${clip(message(e))}`; }
}

/** Story 35.1: a slice re-run's commit and push (the close-out's condition and `proofCommit`, see the header). Answers
 * the PR proof when the commit landed (pushed, or nothing to push), else undefined with `ok: false` on a failure. */
async function sliceCommit(
  run: QueueRun, path: string, branch: string, tip: string, verify: HostVerifyResult, rerun: HostLegRerun, deps: WorktreeDeps,
): Promise<{ ok: boolean; proof?: PrProof }> {
  // Story 35.3: the close-out's widened condition (the proof exists, the assets step not red).
  const due = proofCommitDue(verify, { run_id: run.run_id, worktree: path, prefix: run.prefix });
  if (!due.due) { rerun.commit = `skipped: ${due.why}`; return { ok: true }; }
  let done: Awaited<ReturnType<typeof proofCommit>>;
  try { done = await proofCommit({ run_id: run.run_id, worktree: path, prefix: run.prefix }, verify, deps); }
  catch (e) { rerun.commit = `error: ${clip(message(e))}`; return { ok: false }; }
  rerun.commit = { sha: done.sha, frames: done.frames, ...(done.sheet ? { sheet: done.sheet } : {}), ...(done.skipped_ignored ? { skipped_ignored: done.skipped_ignored } : {}) };
  if (done.sha !== "nothing to commit") {
    let pushError: string | undefined;
    try {
      const r = await git(deps, path, ["push", "origin", branch], 300); // never forced
      if (r.exit !== 0) pushError = `error: git push ${failed(r)}`;
    } catch (e) { pushError = `error: git push: ${clip(message(e))}`; }
    if (pushError !== undefined) {
      // The supervisor's own unpushed proof commit rolled back to the cut tip, so the local run branch is never left
      // ahead of origin (a later re-run's `refuseAheadBranch` would refuse it).
      let kept: string | undefined;
      try {
        const reset = await git(deps, path, ["reset", "--hard", tip], 60);
        if (reset.exit !== 0) kept = `git reset --hard ${failed(reset)}`;
      } catch (e) { kept = `git reset --hard: ${clip(message(e))}`; }
      rerun.pushed = kept ? `${pushError}; local branch left ahead: ${clip(kept, 200)}` : pushError;
      return { ok: false };
    }
    rerun.pushed = branch;
  }
  const prefix = run.prefix ?? "";
  const web = done.head && done.sheet ? await originWebUrl(deps, path) : undefined;
  return { ok: true, proof: { frames: done.frames.map((f) => `${prefix}${f}`), ...(web ? { sheetUrl: `${web}/blob/${done.head}/${prefix}${done.sheet}?raw=true` } : {}) } };
}

/** Story 35.1: an open PR's body regenerated from the record with the latest leg (`prBody`, see the header). When the
 * engine's metered cost cannot be read (the run's worktree gone), the old body's `## Metered cost` section is carried
 * back unchanged; the record-only figure only when it has none. Answers `edited` or `error: <clipped>`; never throws. */
async function rewriteBody(
  queue: Queue, run: QueueRun, path: string, pr: string, verify: HostVerifyResult, by: "api" | "cli", proof: PrProof | undefined,
  oldBody: string | undefined, deps: WorktreeDeps,
): Promise<string> {
  try {
    const events = queue.events(run.run_id);
    const log = await git(deps, path, ["log", "--oneline", `${run.base_ref ?? ""}..HEAD`]);
    if (log.exit !== 0) return `error: git log ${failed(log)}`;
    const commits = log.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const legs = legHistory(events, { leg: "re-run", verdict: legVerdict(verify), recorded_at: new Date().toISOString(), by });
    const input = launchedCloseOutInput(events, run);
    const metered = run.worktree && existsSync(run.worktree) ? meteredCost(servedRoot(run)!, input.engineRunId) : undefined;
    const costText = metered === undefined ? meteredCostSection(oldBody) : undefined;
    const body = prBody({ ...input, ...(costText ? { costText } : {}), commits, runId: run.run_id, verify, ...(proof ? { proof } : {}), legs });
    const e = await editPrBody(deps, run.root, pr, body);
    return e ? `error: ${e}` : "edited";
  } catch (e) { return `error: ${clip(message(e))}`; }
}

/** Story 35.1: a local run branch that is not an ancestor of origin's tip (commits never pushed) is never moved by
 * `-B`: thrown, naming the branch and `git log --oneline <tip>..<local>` (clipped). Behind or equal passes. */
async function refuseAheadBranch(root: string, branch: string, tip: string, deps: WorktreeDeps): Promise<void> {
  const ref = `refs/heads/${branch}`;
  const local = await git(deps, root, ["rev-parse", "--verify", "--quiet", ref], 30);
  if (local.exit !== 0) return; // no local branch: `-B` creates it
  const anc = await git(deps, root, ["merge-base", "--is-ancestor", ref, tip], 30);
  if (anc.exit === 0) return;
  const log = await git(deps, root, ["log", "--oneline", `${tip}..${ref}`], 30);
  const ahead = log.exit === 0 ? clip(log.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("; "), 200) : `git log ${failed(log)}`;
  throw new Error(`the local run branch '${branch}' is not an ancestor of origin's tip ${tip.slice(0, 12)} (never moved here): ${ahead || `git merge-base --is-ancestor ${failed(anc)}`}`);
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
    await refuseAheadBranch(run.root, branch, head, deps);
    // Story 35.1: on the run branch reset to origin's tip (`-B`), never detached: the slice commit lands there.
    const add = await git(deps, run.root, ["worktree", "add", "--relative-paths", "-B", branch, path, head]);
    if (add.exit !== 0) {
      const out = `${add.stderr}\n${add.stdout}`;
      if (/already (checked out|used by worktree)/i.test(out)) {
        const at = /already (?:checked out|used by worktree) at '([^']+)'/i.exec(out)?.[1];
        throw new Error(at
          ? `the run branch '${branch}' is held by another worktree at '${at}' (never removed here)`
          : `the run branch '${branch}' is held by another worktree (never removed here): git worktree add ${failed(add)}`);
      }
      throw new Error(`git worktree add ${failed(add)}`);
    }
    await materialise(run.root, servedRoot({ worktree: path, prefix: run.prefix })!, deps);
  } catch (e) {
    if (existsSync(path)) await removeWorktree(run.root, path, deps);
    try { queue.releaseVerifyLeg(runId, self); } catch { /* a dead owner's lease is taken over */ }
    throw new VerifyRefused("VerifyFailed", clip(message(e)));
  }
  const done = runLeg(queue, run, path, { by: opts.by, head, branch }, deps);
  return { run_id: run.run_id, state: run.state, head, done };
}

/** The leg in the cut worktree, (a slice) the proof commit and push, the PR body and its flip, the removal, and the
 * one `host-verify` event (it closes the lease). */
async function runLeg(
  queue: Queue, run: QueueRun, path: string, at: { by: "api" | "cli"; head: string; branch: string }, deps: HostLegDeps,
): Promise<HostLegResult> {
  let verify: HostVerifyResult;
  const rerun: HostLegRerun = { by: at.by, head: at.head, worktree: "kept", pr: null };
  try {
    const guardS = run.worker_guard_s ?? (Number(queue.definition(run)?.guards?.max_wall_clock_seconds) || 600);
    // Story 34.8: a slice run's re-run gets the assets step too (the close-out's detection, from the resolved definition).
    const slice = isSlice(queue.definition(run));
    verify = await hostVerify({ ...run, worktree: path }, guardS, deps, { slice });
    // Story 35.1: a slice run's placed art and proof committed and pushed, before the body edit.
    const committed = slice ? await sliceCommit(run, path, at.branch, at.head, verify, rerun, deps) : { ok: true };
    rerun.pr = await runPr(run, queue.events(run.run_id), at.branch, deps);
    // A failed commit or push: the body is never edited and green flips nothing (`pr_ready` unset), but red still
    // turns an open ready PR back to a draft (hole 88: a ready PR never stays ready over a stale Green body).
    if (rerun.pr && !committed.ok && isRed(verify)) {
      const state = await prState(run.root, rerun.pr, deps);
      if (typeof state === "string") rerun.pr_draft = state;
      else if (!state.open) rerun.pr_draft = "not open";
      else {
        const e = state.draft ? undefined : await markPrDraft(deps, run.root, rerun.pr);
        rerun.pr_draft = state.draft ? "already" : e ? `error: ${e}` : "undone";
      }
    } else if (rerun.pr && committed.ok) {
      const state = await prState(run.root, rerun.pr, deps);
      const green = !verify.skipped && verify.green;
      const red = isRed(verify);
      if (typeof state === "string") {
        // Story 35.1: the state unreadable, no body edit: recorded whatever the verdict.
        rerun.pr_body = state;
        if (green) rerun.pr_ready = state;
        else if (red) rerun.pr_draft = state;
      } else if (!state.open) {
        if (green) rerun.pr_ready = "not open";
        else if (red) rerun.pr_draft = "not open";
      } else {
        rerun.pr_body = await rewriteBody(queue, run, path, rerun.pr, verify, at.by, committed.proof, state.body, deps);
        const outcome = (e: string | undefined, done: string) => (e ? `error: ${e}` : done);
        // Story 35.1 (consult F1): a failed body edit leaves the PR as it was on green (no flip, `pr_ready` unset);
        // red still turns it back to a draft.
        if (green) {
          if (rerun.pr_body === "edited") rerun.pr_ready = state.draft ? outcome(await markPrReady(deps, run.root, rerun.pr), "marked") : "already";
        } else if (red) rerun.pr_draft = state.draft ? "already" : outcome(await markPrDraft(deps, run.root, rerun.pr), "undone");
      }
    }
    rerun.worktree = await removeWorktree(run.root, path, deps);
  } catch (e) {
    verify = { skipped: true, reason: `re-run failed: ${clip(message(e))}` };
    rerun.worktree = existsSync(path) ? await removeWorktree(run.root, path, deps) : "removed";
  }
  // Story 35.3: an inconclusive leg names its reason too (it flips no PR: neither green nor red above).
  const result = { ...verify, ...(isRed(verify) ? { reason: redReason(verify) } : isInconclusive(verify) ? { reason: inconclusiveReason(verify) } : {}), rerun } as HostLegResult;
  try { queue.note(run.run_id, "host-verify", result as unknown as Record<string, unknown>); }
  catch (e) {
    // Not recorded (the queue busy): the lease is let go of, so the next re-run is not `VerifyRunning`.
    try { queue.releaseVerifyLeg(run.run_id, deps.self ?? selfOwner()); } catch { /* re-taken once this owner is dead */ }
    throw e;
  }
  return result;
}
