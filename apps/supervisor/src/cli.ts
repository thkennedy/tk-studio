#!/usr/bin/env bun
/**
 * Supervisor CLI — jobs queued durably, one engine per checkout, each run
 * woken, invoked headless, finished.
 *
 *   bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>]
 *   bun src/cli.ts submit <job-id> --directory <root>
 *   bun src/cli.ts recover
 *   bun src/cli.ts drain
 *
 * The queue (src/queue.ts, SQLite at TK_SUPERVISOR_DB) owns minting.
 * `submit`: registry `show` → `resolve` (the plugin's one validator of
 * job.schema.json; a refusal or problems[] is returned verbatim, nothing
 * queued) → idempotent enqueue → JSON `{ok, run_id, state, minted}`.
 * `recover`: the restart rule — runs left `queued`/`running` by a dead owner
 * are ended `partial` (`orphaned: supervisor restart`, studio run ended too)
 * or re-queued when they never reached the minting verb (or reached it and
 * the lookup found no studio run absent from the stored pre-verb snapshot).
 * `drain`: recover, then drive every `queued` run no live process owns,
 * oldest first (re-validated through `resolve`: a refusal ends it `blocked`
 * naming the problems; a lock wait or no Max login leaves it queued), under
 * the permission mode recorded on the run (else the default).
 * JSON `{ok, recovered, runs[]}`; a run entry carries `state` (the queue run's
 * actual state) when its summary has no run id or a different state. Exit 0
 * every driven run completed, 1 otherwise, 2 the queue is unusable.
 * `run`: recover → Max-login preflight → registry `show` → `resolve` →
 * enqueue (or adopt the queued run; an explicit --permission-mode is recorded
 * on a queued run) → claim the checkout lock → pre-verb
 * snapshot → `verb_started` recorded in the queue → `wake`
 * (`submit` for a one-shot — `wake` refuses those) → skill target: `claude -p`
 * then `finish` | core target: `wake` already ran it, so `status` reports it
 * → the queue run's terminal state mirrors the outcome.
 * Prints one JSON summary: `run_id` is the queue run id, `studio_run_id` the
 * studio's. Exit 0 the run completes. Exit 1 any other run outcome: no Max
 * login (`blocked`, before anything is queued), a wake/submit answered without
 * waking (`not-woken`), a lock held by a live holder (the run stays `queued`
 * naming it), or the run already `running` under another live owner. A
 * wake/submit that fails after the pre-wake snapshot (timeout, crash, non-JSON
 * output) is recovered — jobrun creates the run before executing it: a run of
 * this job absent from that snapshot is the one this CLI started — a
 * non-terminal one is ended through a contract verb (skill: `finish --state
 * blocked`; core: `cancel`) and reported with its run id (exit 1). Exit 2 the
 * invocation or setup is refused before the studio run exists (bad flag or a
 * flag missing its value, host bypass or unknown --permission-mode, missing
 * TK_STUDIO_ROOT, contract pin, QueueDbMissing / QueueDbPlacementRefused,
 * unregistered project or a --directory that is not the registered root,
 * unreadable config, a job `resolve` refuses, a wake/submit refused outright,
 * answering without a run_id, or failing with no new run found); a queue run
 * already claimed is ended `blocked` with that error and named in the answer.
 */
import { existsSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildWorkerCommand, finishStateFor, invokeSkill, maxLoginPreflight, MISSING_STATUS_BLOCK,
  readProjectConfig, registryShow, requireCompatible, resolveStudioRoot, runJobVerb,
} from "./server";
import {
  isTerminal, Queue, selfOwner, type Holder, type Owner, type QueueRun, type RecoverReport, type RunState, type StudioEnder,
  type StudioFinder, type StudioOps,
} from "./queue";

export interface RunSummary {
  ok: boolean;
  job_id: string;
  project_id?: string;
  /** The queue run id (the studio's own run id rides `studio_run_id`). */
  run_id?: string | null;
  studio_run_id?: string | null;
  target?: "skill" | "core";
  state: string;
  reason?: string;
  status_block?: unknown;
  total_cost_usd?: number;
  finish?: unknown;
  /** The live lock holder a waiting run names. */
  holder?: Holder;
  /** The claim was refused (lock wait, already running, live owner, ended): nothing was driven. */
  waited?: "lock" | "running" | "owned" | "terminal";
  /** `drain`: the listed run was no longer an ownerless `queued` run — nothing minted, nothing driven. */
  skipped?: true;
}

/** Raised only before a studio run exists — the run could not start (exit 2).
 * Carries the `resolve` problems verbatim, and the queue run id once one was claimed. */
export class StartError extends Error {
  problems?: string[];
  runId?: string;
  /** A refusal, not a transport failure: a verb's `ok:false` answer (registry
   * `show`, `resolve`, `wake`/`submit`), `problems[]`, a registry root that is not the checkout,
   * an unreadable project config, or a missing checkout directory. */
  refused?: boolean;
}

function refusal(msg: string, problems?: string[]): StartError {
  const err = new StartError(msg);
  err.refused = true;
  if (problems) err.problems = problems;
  return err;
}

/** TK_STUDIO_ROOT (AD-15) and the contract pin — required before anything recovers or drives. */
function requireStudio(): void {
  try { resolveStudioRoot(); requireCompatible(); }
  catch (e) { throw new StartError(message(e)); }
}

type Target = "skill" | "core";
type VerbRunner = (root: string, cliArgs: string[], timeoutS?: number) => Promise<Record<string, any>>;

/** What the recovery path needs after a wake/submit failed or timed out. */
export interface TimeoutContext {
  root: string; projectId: string; target: Target; verb: "wake" | "submit"; timeoutS: number;
  /** Run ids of this job that existed before the wake/submit — never adopted. */
  before: ReadonlySet<string>;
}

/** A wake/submit that failed or timed out: a run may or may not exist. */
class WakeFailed extends Error {
  constructor(msg: string, readonly ctx: TimeoutContext) { super(msg); }
}

const isCore = (defn: Record<string, any> | undefined): boolean =>
  !!defn?.target && typeof defn.target === "object" && "core" in defn.target;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function answered(out: Record<string, any>, what: string): Record<string, any> {
  if (out.ok === false) throw new Error(`${what}: ${out.error ?? "refused"}`);
  return out;
}

/** Registry roots and `--directory` compared as real, absolute paths. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let r = resolve(p);
    try { r = realpathSync(r); } catch { /* compare the resolved path */ }
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

export interface RunOptions {
  /** Caps the skill invocation's timeout (the tick's --timeout-cap-s). The
   * wake/submit verb keeps the job's own `max_wall_clock_seconds` guard. */
  guardCapS?: number;
  /** An open queue (tests); default: opened at TK_SUPERVISOR_DB and closed after. */
  queue?: Queue;
  owner?: Owner;
  /** Skip the restart rule on start (`drain` already ran it). */
  skipRecover?: boolean;
  /** `drain`: drive exactly this queued run — adopt it, never mint. */
  runId?: string;
}

/** A validated job: `resolve` served its merged definition with no problems. */
export interface Validated {
  jobId: string; root: string; projectId: string; defn: Record<string, any>;
  target: Target;
  /** The skill invocation's timeout: the job's guard, capped at `guardCapS` (the tick's --timeout-cap-s). */
  guardS: number;
  /** The job's own `max_wall_clock_seconds`, never capped: a core job executes inside
   * `wake` under it, so the wake/submit verb's timeout is this + 120 s. */
  jobGuardS: number;
  permissionMode?: string;
}

/** The job's own wall-clock guard (default 600 s) and the invocation guard capped at `guardCapS`. */
export function guardsFor(defn: Record<string, any> | undefined, guardCapS?: number): { jobGuardS: number; guardS: number } {
  const jobGuardS = Number(defn?.guards?.max_wall_clock_seconds) || 600;
  return { jobGuardS, guardS: guardCapS && guardCapS > 0 ? Math.min(jobGuardS, guardCapS) : jobGuardS };
}

function openQueue(opts: RunOptions): { queue: Queue; owned: boolean } {
  if (opts.queue) return { queue: opts.queue, owned: false };
  try { return { queue: Queue.open(), owned: true }; }
  catch (e) { throw new StartError(message(e)); }
}

/** Ends a minted studio run for an orphaned queue run (the restart rule): a
 * non-terminal skill run is finished `partial` with the reason, a core run is
 * cancelled (never finished — AC5b). A failure is returned, never thrown. */
export function studioRunEnder(verbRunner: VerbRunner = runJobVerb): StudioEnder {
  return async (run, reason) => {
    const root = run.root, sid = run.studio_run_id!;
    try {
      const st = answered(await verbRunner(root, ["status", "--directory", root, "--job-id", run.job_id, "--run-id", sid]), "status");
      const state = (st.runs ?? [])[0]?.state;
      if (isTerminal(state)) return { ok: true, detail: `studio run ${sid} already ${state}` };
    } catch { /* end it anyway: the ending verb decides */ }
    const verb = run.target === "core" ? "cancel" : "finish";
    try {
      const out = answered(await verbRunner(root, verb === "finish"
        ? ["finish", "--directory", root, "--run-id", sid, "--state", "partial", "--reason", reason]
        : ["cancel", "--directory", root, "--job-id", run.job_id, "--run-id", sid]), verb);
      if (verb === "cancel" && out.cancelled !== true) throw new Error(`cancel: ${out.reason ?? "not cancelled"}`);
      return { ok: true, detail: `studio run ${sid} ended via ${verb}` };
    } catch (e) {
      return { ok: false, detail: `ending studio run ${sid} via ${verb} failed: ${message(e)}` };
    }
  };
}

/** A studio run id's mint order: `<job-id>-<YYYYMMDDTHHMMSSZ>[-N]` → [ms, N]; null when it does not parse. */
export function studioRunOrder(jobId: string, runId: string): [number, number] | null {
  if (!runId.startsWith(`${jobId}-`)) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:-(\d+))?$/.exec(runId.slice(jobId.length + 1));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(ms) ? [ms, m[7] ? Number(m[7]) : 1] : null;
}

/** Looks up the studio run an orphan's minting verb may have created: among
 * the job's runs absent from the stored pre-verb snapshot, the EARLIEST one
 * minted at or after `verb_started` (a later one may be a foreign run minted
 * during the downtime). A candidate whose mint order cannot be read makes the
 * pick ambiguous: a failed lookup (the run is then ended, never re-queued).
 * A failed lookup is returned, never thrown. */
export function studioRunFinder(verbRunner: VerbRunner = runJobVerb): StudioFinder {
  return async (run, snapshot) => {
    const before = new Set(snapshot);
    try {
      const st = answered(await verbRunner(run.root, ["status", "--directory", run.root, "--job-id", run.job_id]), "status");
      const absent = ((st.runs ?? []) as Record<string, any>[])
        .map((r) => r?.run_id)
        .filter((id): id is string => typeof id === "string" && !!id && !before.has(id));
      const since = Date.parse(run.verb_started ?? "");
      if (absent.length && !Number.isFinite(since)) return { ok: false, detail: "no verb_started time to order the candidates by" };
      const floor = Math.floor(since / 1000) * 1000; // studio ids carry whole seconds
      const ordered: { id: string; key: [number, number] }[] = [];
      for (const id of absent) {
        const key = studioRunOrder(run.job_id, id);
        if (!key) return { ok: false, detail: `ambiguous: studio run '${id}' has no readable mint time` };
        if (key[0] >= floor) ordered.push({ id, key });
      }
      ordered.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
      return { ok: true, run_id: ordered[0]?.id ?? null };
    } catch (e) {
      return { ok: false, detail: `status: ${message(e)}` };
    }
  };
}

/** The studio calls the restart rule makes, through the contract verbs. */
export function studioOps(verbRunner: VerbRunner = runJobVerb): StudioOps {
  return { end: studioRunEnder(verbRunner), find: studioRunFinder(verbRunner) };
}

/** `recover`: the restart rule over the whole queue. */
export async function recoverQueue(opts: RunOptions = {}, verbRunner: VerbRunner = runJobVerb): Promise<RecoverReport> {
  requireStudio();
  const { queue, owned } = openQueue(opts);
  try { return await queue.recover(studioOps(verbRunner), opts.owner ?? selfOwner()); }
  finally { if (owned) queue.close(); }
}

export interface DrainReport {
  ok: boolean;
  recovered: RecoverReport;
  runs: ({ run_id: string; job_id: string } & (
    /** `state`: the queue run's actual state, when the summary carries no run id or a different state. */
    | { summary: RunSummary; state?: RunState }
    /** `state`: the queue run's state once it is no longer `queued` (a refusal, or a post-claim start failure, ended it). */
    | { error: string; problems?: string[]; state?: RunState }))[];
}

/** `drain`: recover, then drive every `queued` run no live process owns,
 * oldest first, by the job id and checkout the queue stored (re-validated
 * through `resolve` by `runJob`, which adopts exactly that run and never
 * mints; a run no longer ownerless-queued is skipped). */
export async function drainQueue(opts: RunOptions = {}, verbRunner: VerbRunner = runJobVerb): Promise<DrainReport> {
  requireStudio();
  const { queue, owned } = openQueue(opts);
  const owner = opts.owner ?? selfOwner();
  try {
    const recovered = await queue.recover(studioOps(verbRunner), owner);
    const runs: DrainReport["runs"] = [];
    for (const r of queue.drainable(owner)) {
      try {
        // `undefined` mode: runJob drives the run under the mode recorded on it (else the default).
        const summary = await runJob(r.job_id, r.root, undefined, { ...opts, queue, owner, skipRecover: true, runId: r.run_id });
        // Report the run's actual queue state when the summary does not (a stop before
        // the claim, e.g. no Max login, answers `blocked` with no run id while the run stays `queued`).
        const now = queue.get(r.run_id)?.state;
        runs.push({
          run_id: r.run_id, job_id: r.job_id, summary: summary.run_id ? summary : { ...summary, run_id: r.run_id },
          ...(now && (!summary.run_id || now !== summary.state) ? { state: now } : {}),
        });
      } catch (e) {
        const problems = e instanceof StartError && e.problems ? { problems: e.problems } : {};
        let error = message(e);
        if (e instanceof StartError && e.refused && queue.get(r.run_id)?.state === "queued") {
          // Re-validation refused the stored job (registry `show`, `resolve`
          // refusal or problems[]): it can never run as queued — end it
          // `blocked` naming the refusal verbatim, never leave it queued.
          try { queue.end(r.run_id, "blocked", error, { from: "queued" }); }
          catch (qe) { error = `${error}; queue: ${message(qe)}`; }
        }
        // A start failure after the claim already ended the run `blocked` (runJob): report its actual state.
        const now = queue.get(r.run_id)?.state;
        runs.push({ run_id: r.run_id, job_id: r.job_id, error, ...problems, ...(now && now !== "queued" ? { state: now } : {}) });
      }
    }
    return { ok: runs.every((r) => "summary" in r && (r.summary.ok || r.summary.skipped === true)), recovered, runs };
  } finally { if (owned) queue.close(); }
}

/** `submit`: validate, then enqueue (idempotent). Nothing is driven. */
export async function submitJob(jobId: string, directory: string, opts: RunOptions = {}): Promise<Record<string, unknown>> {
  try { resolveStudioRoot(); requireCompatible(); }
  catch (e) { throw new StartError(message(e)); }
  const { queue, owned } = openQueue(opts);
  try {
    let v: Validated;
    try { v = await validate(jobId, directory, undefined, opts.guardCapS); }
    catch (e) { throw e instanceof StartError ? e : new StartError(message(e)); }
    const { run, minted } = queue.enqueue({ jobId, root: v.root, projectId: v.projectId, target: v.target, definition: v.defn });
    return { ok: true, job_id: jobId, project_id: v.projectId, run_id: run.run_id, state: run.state, minted };
  } finally { if (owned) queue.close(); }
}

export async function runJob(jobId: string, directory: string, permissionMode?: string, opts: RunOptions = {}): Promise<RunSummary> {
  requireStudio(); // StudioRootMissing (AD-15), the contract pin
  const { queue, owned } = openQueue(opts);
  const owner = opts.owner ?? selfOwner();
  try {
    if (!opts.skipRecover) await queue.recover(studioOps(), owner);
    // `drain` mode: the listed run must still be an ownerless `queued` run.
    const skipped = (why: string): RunSummary => {
      const now = opts.runId ? queue.get(opts.runId) : null;
      return { ok: false, job_id: jobId, run_id: opts.runId ?? null, studio_run_id: now?.studio_run_id ?? null,
        state: now?.state ?? "missing", reason: `skipped: ${why}`, skipped: true };
    };
    if (opts.runId && !queue.drainable(owner).some((r) => r.run_id === opts.runId)) {
      return skipped(`run ${opts.runId} is no longer an ownerless queued run`);
    }
    let v: Validated;
    try {
      const root = resolve(directory);
      if (!existsSync(root)) throw refusal(`directory does not exist: ${directory}`);
      // A host bypass is refused before anything starts (AD-2 ruling).
      buildWorkerCommand({ prompt: "", permissionMode });
      const login = await maxLoginPreflight();
      if (login) return { ok: false, job_id: jobId, run_id: null, state: "blocked", reason: login };
      v = await validate(jobId, directory, permissionMode, opts.guardCapS);
    } catch (e) { throw e instanceof StartError ? e : new StartError(message(e)); }

    // An explicit --permission-mode is recorded on the queue run it mints or adopts
    // (a queued run only), so a later `drain` or tick drives it under that mode.
    let run: QueueRun;
    if (opts.runId) {
      run = queue.get(opts.runId)!;
      if (permissionMode !== undefined && run.state === "queued") run = queue.recordPermissionMode(run.run_id, permissionMode);
    } else {
      run = queue.enqueue({ jobId, root: v.root, projectId: v.projectId, target: v.target, definition: v.defn, owner, permissionMode }).run;
    }
    const claim = await queue.claim(run.run_id, owner);
    if (!claim.claimed && opts.runId && claim.why !== "lock") return skipped(claim.reason);
    if (!claim.claimed) {
      return {
        waited: claim.why,
        ok: false, job_id: jobId, project_id: v.projectId, run_id: run.run_id, studio_run_id: claim.run.studio_run_id,
        target: v.target, state: claim.run.state, reason: claim.reason, ...(claim.holder ? { holder: claim.holder } : {}),
      };
    }
    let summary: RunSummary;
    try {
      // The effective mode: the caller's explicit one, else the one recorded on the run, else the default.
      const mode = permissionMode ?? claim.run.permission_mode ?? undefined;
      if (mode !== permissionMode) buildWorkerCommand({ prompt: "", permissionMode: mode }); // a stored mode is re-checked
      summary = await drive(queue, run.run_id, { ...v, permissionMode: mode });
    }
    catch (e) {
      const err = e instanceof StartError ? e : new StartError(message(e));
      try { await queue.endDriven(run.run_id, "blocked", err.message); } catch { /* already ended */ }
      err.runId = run.run_id;
      throw err;
    }
    return await mirror(queue, run.run_id, v, summary);
  } finally { if (owned) queue.close(); }
}

/** The 21-1 flow under a claimed lock: snapshot → wake/submit → invoke/finish. */
async function drive(queue: Queue, queueRunId: string, v: Validated): Promise<RunSummary> {
  let started: Started | { summary: RunSummary };
  // "Started" is recorded, with the snapshot, just before the minting verb.
  try {
    started = await startRun(v, (verb, before) => {
      queue.markVerbStarted(queueRunId, verb, before, { target: v.target, definition: v.defn });
    });
  }
  catch (e) {
    // A wake/submit that failed may still have created the run: recover it.
    if (e instanceof WakeFailed) return recoverAfterTimeout(v.jobId, e.message, e.ctx);
    throw e;
  }
  if ("summary" in started) return started.summary;
  queue.setStudioRun(queueRunId, started.runId);
  return finishRun(started);
}

/** `.bmad-loop/runs/<id>` named by a tk-studio-launch run's status block: the detached engine it started. */
export function launchedEngine(skill: unknown, block: unknown): string | undefined {
  const b = block as Record<string, unknown> | undefined;
  if (skill !== "tk-studio-launch" && b?.intent !== "tk-studio-launch") return undefined;
  for (const a of Array.isArray(b?.artifacts) ? b!.artifacts as unknown[] : []) {
    const m = typeof a === "string" ? /^(?:\.\/)?\.bmad-loop\/runs\/([^/]+)\/?$/.exec(a.replace(/\\/g, "/")) : null;
    if (m) return m[1];
  }
  return undefined;
}

/** Mirror the outcome into the queue run: a terminal studio outcome ends it in
 * that state; anything else (e.g. a one-shot still queued with no executable
 * directive, `not-woken`) ends it `blocked` with the reason and the studio run
 * named — never left `queued`. A launch run that names no engine has the
 * launch core probed before its lock is released (`Queue.endDriven`). The
 * summary's `run_id` becomes the queue id. */
async function mirror(queue: Queue, queueRunId: string, v: Validated, s: RunSummary): Promise<RunSummary> {
  const studioRunId = s.run_id ?? null;
  let reason = s.reason;
  try {
    if (studioRunId && queue.get(queueRunId)?.studio_run_id !== studioRunId) queue.setStudioRun(queueRunId, studioRunId);
    const terminal = isTerminal(s.state);
    const endReason = terminal ? s.reason ?? null
      : `${studioRunId ? `studio run ${studioRunId} left ${s.state}` : s.state}${s.reason ? `: ${s.reason}` : ""}`;
    const engine = launchedEngine(v.defn?.target?.skill, s.status_block);
    await queue.endDriven(queueRunId, terminal ? (s.state as "complete") : "blocked", endReason, engine ? { engineRunId: engine } : {});
  } catch (e) {
    reason = `${reason ? `${reason}; ` : ""}queue: ${message(e)}`;
  }
  return { ...s, run_id: queueRunId, studio_run_id: studioRunId, ...(reason !== undefined ? { reason } : {}) };
}

export interface Started {
  jobId: string; root: string; projectId: string; runId: string;
  /** The skill invocation's timeout (the capped guard). */
  guardS: number;
  defn: Record<string, any>; woke: Record<string, any>; permissionMode?: string;
}

/** Registry `show` + `resolve`: the plugin's one validator (AD-2). A refusal
 * or problems[] throws StartError carrying them verbatim; nothing is queued. */
async function validate(jobId: string, directory: string, permissionMode?: string, guardCapS?: number): Promise<Validated> {
  const root = resolve(directory);
  if (!existsSync(root)) throw refusal(`directory does not exist: ${directory}`);
  const cfg = readProjectConfig(root);
  if (cfg.unreadable) throw refusal(`project config unreadable: ${cfg.unreadable}`);
  const pid = cfg.config.project_id;
  // The studio's identity is str(project_id): a numeric id is still the id.
  const projectId = (typeof pid === "string" || typeof pid === "number") && String(pid) ? String(pid) : basename(root);
  let shown: Record<string, any>;
  try { shown = await registryShow(projectId); }
  catch (e) {
    // `registry: …` is show's own refusal answer (ok:false); anything else is transport (spawn, timeout, no JSON).
    const msg = message(e);
    throw msg.startsWith("registry: ") ? refusal(msg) : new StartError(msg);
  }
  const entryRoot = shown.entry?.root;
  if (typeof entryRoot !== "string" || !samePath(entryRoot, root)) {
    throw refusal(`registry: project '${projectId}' is registered at '${entryRoot}', not at '${root}' — --directory does not match the registry entry`);
  }

  let answer: Record<string, any>;
  try { answer = await runJobVerb(root, ["resolve", "--directory", root, "--job-id", jobId]); }
  catch (e) { throw new StartError(`resolve: ${message(e)}`); } // transport: transient
  if (answer.ok === false) throw refusal(`resolve: ${answer.error ?? "refused"}`);
  const resolved = answer;
  if (Array.isArray(resolved.problems) && resolved.problems.length) {
    throw refusal(`resolve: ${resolved.problems.join("; ")}`, resolved.problems.map(String));
  }
  if (!resolved.resolved || typeof resolved.resolved !== "object") {
    throw new StartError(`resolve: served no merged definition for '${jobId}'`);
  }
  const defn = resolved.resolved as Record<string, any>;
  return { jobId, root, projectId, defn, target: isCore(defn) ? "core" : "skill", ...guardsFor(defn, guardCapS), permissionMode };
}

/** Under the claimed lock: snapshot, `onVerb` (the queue's `verb_started`
 * record), then the verb that mints. Any throw before the verb means no studio run started.
 * The verb's timeout is the job's UNCAPPED guard + 120 s (a core job runs inside `wake`
 * under its own guard); the tick's cap applies only to the skill invocation. */
export async function startRun(
  v: Validated, onVerb: (verb: "wake" | "submit", before: string[]) => void, verbRunner: VerbRunner = runJobVerb,
): Promise<Started | { summary: RunSummary }> {
  const { jobId, root, projectId, defn, target, guardS, jobGuardS, permissionMode } = v;
  const oneShot = defn?.trigger === "one-shot";
  const verb = oneShot ? "submit" : "wake";

  // The runs this job already has: a failed wake/submit may only ever
  // adopt a run absent from this snapshot (one this CLI started).
  let before: Set<string>;
  try {
    const snap = answered(await verbRunner(root, ["status", "--directory", root, "--job-id", jobId]), "status");
    before = new Set(((snap.runs ?? []) as Record<string, any>[])
      .map((r) => r.run_id).filter((id): id is string => typeof id === "string"));
  } catch (e) { throw new StartError(`status (pre-${verb} snapshot): ${message(e)}`); }
  try { onVerb(verb, [...before]); }
  catch (e) { throw new StartError(`queue (recording ${verb} start): ${message(e)}`); }

  const timeoutS = jobGuardS + 120;
  let out: Record<string, any>;
  try {
    out = await verbRunner(root, oneShot
      ? ["submit", "--directory", root, "--id", jobId]
      : ["wake", "--directory", root, "--job-id", jobId], timeoutS);
  } catch (e) {
    // jobrun creates the run before executing it: ANY failure here (timeout,
    // crash, non-JSON output) may have left one behind — recover, never assume.
    throw new WakeFailed(message(e), { root, projectId, target, verb, timeoutS, before });
  }
  if (out.ok === false) throw refusal(`${verb}: ${out.error ?? "refused"}`);
  const woke = out;
  if (woke.woken !== true && woke.accepted !== true) {
    return { summary: { job_id: jobId, project_id: projectId, ok: false, run_id: null, state: "not-woken", reason: String(woke.reason ?? "refused") } };
  }
  if (typeof woke.run_id !== "string" || !woke.run_id) {
    throw new StartError(`${verb}: answered ${woke.woken === true ? "woken" : "accepted"} without a run_id — driver contract §4 violation; nothing invoked`);
  }
  return { jobId, root, projectId, runId: woke.run_id, guardS, defn, woke, permissionMode };
}

/** After a wake/submit failure (timeout or otherwise): adopt the newest run of this job that is NOT
 * in the pre-wake snapshot — never a run this CLI did not start. A
 * non-terminal one is ended through a contract verb, because the tick's
 * no-overlap rule would otherwise skip the job forever and no `job-run` event
 * would ever be emitted (AD-12): a skill run is finished `blocked`; a core run
 * is cancelled (AC5b: the supervisor never calls `finish` on a core run).
 * No new run → StartError (exit 2, nothing started). */
export async function recoverAfterTimeout(
  jobId: string, failMsg: string, ctx: TimeoutContext, verbRunner: VerbRunner = runJobVerb,
): Promise<RunSummary> {
  const { root, projectId, target, verb, timeoutS, before } = ctx;
  const timedOut = /timed out/i.test(failMsg);
  let run: Record<string, any> | undefined;
  try {
    const status = answered(await verbRunner(root, ["status", "--directory", root, "--job-id", jobId]), "status");
    run = ((status.runs ?? []) as Record<string, any>[])
      .filter((r) => typeof r.run_id === "string" && r.run_id && !before.has(r.run_id))
      .sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0))
      .at(-1);
  } catch (e) {
    throw new StartError(`${verb} failed: ${failMsg}; no run could be looked up (status: ${message(e)})`);
  }
  if (!run) throw new StartError(`${verb} failed: ${failMsg}; no new run of '${jobId}' exists`);

  const runId = run.run_id as string;
  const base = { ok: false, job_id: jobId, project_id: projectId, run_id: runId, target };
  let state = String(run.state ?? "unknown");
  const failed = `${verb} failed: ${failMsg}`;
  if (state !== "queued" && state !== "running") return { ...base, state, reason: failed };

  const endReason = timedOut
    ? `supervisor: ${verb} timed out after ${timeoutS}s before answering — the run could not be driven`
    : `supervisor: ${verb} failed before answering (${failMsg.slice(0, 300)}) — the run could not be driven`;
  const endVerb = target === "skill" ? "finish" : "cancel";
  let ended: string;
  try {
    const out = answered(await verbRunner(root, target === "skill"
      ? ["finish", "--directory", root, "--run-id", runId, "--state", "blocked", "--reason", endReason]
      : ["cancel", "--directory", root, "--job-id", jobId, "--run-id", runId]), endVerb);
    if (target === "core" && out.cancelled !== true) throw new Error(`cancel: ${out.reason ?? "not cancelled"}`);
    if (typeof out.state === "string") state = out.state;
    else if (Array.isArray(out.runs_ended) && out.runs_ended.includes(runId)) state = "partial";
    ended = `; the supervisor ended the run via ${endVerb}`;
  } catch (e) {
    ended = `; ending the run via ${endVerb} failed: ${message(e)}`;
  }
  try {
    const status = answered(await verbRunner(root, ["status", "--directory", root, "--job-id", jobId, "--run-id", runId]), "status");
    const now = (status.runs ?? [])[0];
    if (typeof now?.state === "string") state = now.state;
  } catch { /* keep the state the ending verb answered */ }
  return { ...base, state, reason: `${failed}${ended}` };
}

type SkillInvoker = typeof invokeSkill;

/** Once a run id is known nothing throws: failures come back as ok:false with the run id.
 * The skill invocation runs under `s.guardS` (the capped guard). */
export async function finishRun(s: Started, verbRunner: VerbRunner = runJobVerb, invoke: SkillInvoker = invokeSkill): Promise<RunSummary> {
  const { jobId, root, projectId, runId, guardS, defn, woke, permissionMode } = s;
  const base = { job_id: jobId, project_id: projectId, run_id: runId };
  const known = typeof woke.state === "string" ? woke.state : "unknown";

  if (isCore(defn) || (typeof woke.state === "string" && woke.state !== "queued")) {
    // Core target: `wake` executed it and ended the run — no worker, no finish.
    let status: Record<string, any>;
    try { status = answered(await verbRunner(root, ["status", "--directory", root, "--job-id", jobId, "--run-id", runId]), "status"); }
    catch (e) { return { ...base, ok: false, target: "core", state: known, reason: `status failed: ${message(e)}` }; }
    const run = (status.runs ?? [])[0] ?? {};
    return {
      ...base, ok: run.state === "complete", target: "core", state: String(run.state ?? known),
      ...(run.reason ? { reason: run.reason } : {}), ...(run.status_block ? { status_block: run.status_block } : {}),
    };
  }
  const directive = woke.directive as Record<string, any> | undefined;
  if (directive?.kind !== "invoke-skill" || typeof directive.skill !== "string") {
    return { ...base, ok: false, target: "skill", state: String(woke.state ?? "queued"), reason: "queued with no executable directive" };
  }

  let state: ReturnType<typeof finishStateFor>, reason: string | undefined, block: Record<string, unknown> | undefined, cost: number | undefined;
  try {
    const routing = (woke.routing ?? {}) as Record<string, unknown>;
    const knowledge = directive.knowledge && typeof directive.knowledge === "object" ? directive.knowledge : undefined;
    const out = await invoke(root, directive.skill, {
      payload: { ...(directive.payload ?? {}), run_id: runId }, timeout_s: guardS, permission_mode: permissionMode,
      model: routing.model, effort: routing.effort, ...(knowledge ? { knowledge } : {}),
    });
    cost = typeof out.total_cost_usd === "number" ? out.total_cost_usd : undefined;
    block = out.status_block as Record<string, unknown> | undefined;
    if (block) {
      state = finishStateFor(String(block.status));
      reason = typeof block.reason === "string" && block.reason ? block.reason
        : state === "complete" ? undefined : `status block ended '${block.status}'`;
    } else {
      state = "blocked";
      reason = String(out.conformance_failure ?? MISSING_STATUS_BLOCK);
    }
  } catch (e) {
    const msg = message(e);
    state = /timed out/i.test(msg) ? "partial" : "blocked";
    reason = state === "partial" ? `guard: max_wall_clock_seconds (${guardS}s)` : msg;
  }
  const extras = {
    ...(block ? { status_block: block } : {}), ...(cost !== undefined ? { total_cost_usd: cost } : {}),
  };
  let finish: Record<string, any>;
  try {
    finish = answered(await verbRunner(root, [
      "finish", "--directory", root, "--run-id", runId, "--state", state,
      ...(reason ? ["--reason", reason] : []),
      ...(block ? ["--status-block", JSON.stringify(block)] : []),
      ...(cost !== undefined ? ["--total-cost-usd", String(cost)] : []),
    ]), "finish");
  } catch (e) {
    // The run's real state, not the stale wake/submit answer: it may have
    // been ended by someone else (the refusal's usual cause).
    let actual = "unknown";
    try {
      const status = answered(await verbRunner(root, ["status", "--directory", root, "--job-id", jobId, "--run-id", runId]), "status");
      const run = (status.runs ?? [])[0];
      if (typeof run?.state === "string") actual = run.state;
    } catch { /* stays unknown */ }
    return { ...base, ok: false, target: "skill", state: actual, reason: `finish failed: ${message(e)}`, ...extras };
  }
  return { ...base, ok: state === "complete", target: "skill", state, ...(reason ? { reason } : {}), ...extras, finish };
}

const USAGE = [
  "usage: bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>]",
  "       bun src/cli.ts submit <job-id> --directory <root>",
  "       bun src/cli.ts recover",
  "       bun src/cli.ts drain",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === "recover" || cmd === "drain") {
    if (args.length) { console.error(`unknown argument '${args[0]}'\n${USAGE}`); return 2; }
    try {
      if (cmd === "drain") {
        const report = await drainQueue();
        console.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
      }
      const report = await recoverQueue();
      console.log(JSON.stringify({ ok: true, ...report }, null, 2));
      return 0;
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: message(e) }, null, 2));
      return 2;
    }
  }
  const [jobId, ...rest] = args;
  const allowed = cmd === "submit" ? ["--directory"] : ["--directory", "--permission-mode"];
  let directory: string | undefined, permissionMode: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) { console.error(`unknown argument '${flag}'\n${USAGE}`); return 2; }
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) { console.error(`${flag} needs a value\n${USAGE}`); return 2; }
    if (flag === "--directory") directory = value; else permissionMode = value;
  }
  if ((cmd !== "run" && cmd !== "submit") || !jobId || !directory) { console.error(USAGE); return 2; }
  try {
    if (cmd === "submit") {
      console.log(JSON.stringify(await submitJob(jobId, directory), null, 2));
      return 0;
    }
    const summary = await runJob(jobId, directory, permissionMode);
    console.log(JSON.stringify(summary, null, 2));
    return summary.ok ? 0 : 1;
  } catch (e) {
    // runJob/submitJob throw only before a studio run exists: every such error is a start failure (exit 2).
    const error = message(e);
    const state = error.startsWith("HostBypassRefused") ? "blocked" : "not-started";
    const extra = e instanceof StartError
      ? { ...(e.problems ? { problems: e.problems } : {}) } : {};
    const runId = e instanceof StartError && e.runId ? e.runId : null;
    console.log(JSON.stringify({ ok: false, job_id: jobId, run_id: runId, state, error, ...extra }, null, 2));
    return e instanceof StartError ? 2 : 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
