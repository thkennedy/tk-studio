#!/usr/bin/env bun
/**
 * Supervisor CLI — jobs queued durably, one engine per checkout, each run
 * woken, invoked headless, finished.
 *
 *   bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>] [--tier host|sbx]
 *                  [--sandbox <name>] [--model <model>] [--effort <effort>]
 *   bun src/cli.ts submit <job-id> --directory <root> [same options as run]
 *   bun src/cli.ts recover
 *   bun src/cli.ts drain
 *
 * The queue (src/queue.ts, SQLite at TK_SUPERVISOR_DB) owns minting.
 * `submit`: registry `show` → `resolve` (the plugin's one validator of
 * job.schema.json; a refusal or problems[] is returned verbatim, nothing
 * queued) → idempotent enqueue → JSON `{ok, run_id, state, minted}`.
 * `recover`: the restart rule — runs left `queued`/`running` by a dead owner
 * have their recorded worker killed (pid + start time matched), then a skill
 * run with its session recorded, a transcript and budget left is resumed
 * (`claude -p --resume <session-id>`, once per run — Story 21.6); otherwise
 * ended `partial` (`orphaned: supervisor restart` plus the cause, studio run
 * ended too), or re-queued when they never reached the minting verb (or
 * reached it and the lookup found no studio run absent from the stored
 * pre-verb snapshot).
 * `drain`: recover, then drive every `queued` run no live process owns,
 * oldest first (re-validated through `resolve`: a refusal ends it `blocked`
 * naming the problems; a lock wait or no Max login leaves it queued), under
 * the permission mode and worker options recorded on the run (else the default).
 *
 * Tiers (Story 21.4): the worker runs on `host` (`claude -p` directly) or
 * `sbx` (inside a Docker Sandboxes microVM through `sbx exec`). Every option
 * resolves explicit (the flag) ?? stored (the queue run) ?? the supervisor's
 * per-job config (TK_SUPERVISOR_CONFIG, keyed `<project-id>/<job-id>`) ??
 * default (tier `host`, mode `auto`) — a config entry's permission_mode only on
 * the entry's own tier (no `tier` → host); model/effort have no config layer and,
 * when absent, the resolved job's `woke.routing` is forwarded verbatim (§5 —
 * the supervisor never chooses a model). Resolved before any process and
 * before anything is queued: a bypass on the host tier is HostBypassRefused
 * (`state: blocked`, exit 2), an unknown tier TierRefused, an sbx tier with no
 * sandbox SbxSandboxMissing, an sbx root with no microVM path
 * VmPathUnderivable, a bad config SupervisorConfigInvalid (all exit 2,
 * nothing queued). The resolved tier and sandbox, and explicit model/effort,
 * are recorded on the queue run; stored values are re-checked after the claim.
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
 * flag missing its value or given an empty one, host bypass or unknown
 * --permission-mode, unknown --tier, an sbx tier with no sandbox or no
 * microVM path, SupervisorConfigInvalid, missing
 * TK_STUDIO_ROOT, contract pin, QueueDbMissing / QueueDbPlacementRefused,
 * unregistered project or a --directory that is not the registered root,
 * unreadable config, a job `resolve` refuses, a wake/submit refused outright,
 * answering without a run_id, or failing with no new run found); a queue run
 * already claimed is ended `blocked` with that error and named in the answer.
 */
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildWorkerCommand, checkTier, finishStateFor, invokeSkill, maxLoginPreflight, MISSING_STATUS_BLOCK,
  readProjectConfig, registryShow, requireCompatible, resolveStudioRoot, runJobVerb, SbxSandboxMissing, toVmPath, WORKER_RECORD_FAILED, type Tier,
} from "./server";
import {
  checkoutKey, defaultProbes, isTerminal, LAUNCH_SKILL, ORPHANED_REASON, probeLaunchEngine, processStartTime, Queue, selfOwner,
  type Holder, type LaunchEngine, type Owner, type QueueRun, type RecoverReport, type RunState, type StudioEnder, type StudioFinder, type StudioOps, type StudioResumer, type TerminalState,
} from "./queue";
import { jobOptions, loadSupervisorConfig, type JobOptions } from "./config";
import {
  ensureTranscript, resultCounts, sbxTranscriptExists, transcriptCounts, TranscriptError, transcriptNewCounts, type Counts,
} from "./transcript";

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
  /** The guards that tripped (Story 21.5): named in `reason` and in the queue run's `ended` event. */
  guards_tripped?: GuardTrip[];
  /** The studio's `account` answer for this iteration's counters. */
  account?: { turns: number; tokens: number; within_budget: boolean; exceeded: string[] };
  /** The studio run's own terminal state when it differs from `state` (a core
   * run the backstop `cancel`led: the queue run ends `partial`, the studio holds
   * `cancelled`). `mirror` records and matches `stop.on_status` against it. */
  studio_state?: string;
}

/** A tripped guard: the job guard's name (or the tick's `--timeout-cap-s`) and its value. */
export interface GuardTrip { guard: string; value: number }

/** Guards counted in seconds: the job's wall clock (and its backstop), the tick's cap. */
const inSeconds = (guard: string) => guard.startsWith("max_wall_clock_seconds") || guard === "--timeout-cap-s";

/** `guard: <name> (<value>[s])` — the reason a guard trip ends a run with. */
export function guardReason(trips: GuardTrip[]): string {
  return trips.map((t) => `guard: ${t.guard} (${t.value}${inSeconds(t.guard) ? "s" : ""})`).join("; ");
}

/** The wall-clock bound that actually trips under `guardS`: the job's own
 * `max_wall_clock_seconds`, or the tick's `--timeout-cap-s` when it capped it. */
export function wallClockGuard(jobGuardS: number | undefined, guardS: number): GuardTrip {
  return jobGuardS !== undefined && guardS < jobGuardS
    ? { guard: "--timeout-cap-s", value: guardS }
    : { guard: "max_wall_clock_seconds", value: guardS };
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
  /** The job's own `max_wall_clock_seconds`: the verb's timeout is its backstop (+120 s). */
  jobGuardS?: number;
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
  /** Explicit worker options (the submission's flags); each wins over the stored run and the config. */
  tier?: string;
  sandbox?: string;
  model?: string;
  effort?: string;
}

/** The worker options a run is driven with (Story 21.4). */
export interface WorkerOptions { tier: Tier; permissionMode?: string; sandbox?: string; model?: string; effort?: string }

/** One layer of worker options: the submission, the queue run, or the config. */
interface OptionLayer { tier?: string | null; permissionMode?: string | null; sandbox?: string | null; model?: string | null; effort?: string | null }

/** The stored layer of a queue run. */
const storedLayer = (run: QueueRun | null | undefined): OptionLayer =>
  run ? { tier: run.tier, permissionMode: run.permission_mode, sandbox: run.sandbox, model: run.model, effort: run.effort } : {};

/** Resolve explicit ?? stored ?? config ?? default and check the result before
 * any process starts: an unknown tier → TierRefused; bypass on the host tier
 * → HostBypassRefused; an unknown mode → named; sbx without a sandbox →
 * SbxSandboxMissing; sbx on a root with no microVM path (e.g. a UNC share,
 * when `root` is given) → VmPathUnderivable. Only a config entry's
 * `permission_mode` is tier-gated: it applies only when the run's effective
 * tier is the entry's own tier (no `tier` → host), so a tier frozen at enqueue
 * never mixes with a mode configured for another tier. The config `sandbox`
 * follows the plain explicit ?? stored ?? config precedence and is read only
 * on sbx. Model/effort come only from the
 * submission (stored or explicit): the config never chooses a model (AD-14). */
export function resolveWorkerOptions(explicit: OptionLayer, stored: OptionLayer = {}, config: JobOptions = {}, root?: string): WorkerOptions {
  const pick = <T>(...vals: (T | null | undefined)[]): T | undefined => vals.find((v) => v !== undefined && v !== null && v !== "") ?? undefined;
  const tier = checkTier(pick(explicit.tier, stored.tier, config.tier));
  const configMode = tier === (config.tier ?? "host") ? config.permission_mode : undefined;
  const permissionMode = pick(explicit.permissionMode, stored.permissionMode, configMode);
  const sandbox = pick(explicit.sandbox, stored.sandbox, config.sandbox);
  buildWorkerCommand({ prompt: "", permissionMode, tier }); // HostBypassRefused / unknown mode, no process
  if (tier === "sbx" && !sandbox) throw new SbxSandboxMissing();
  if (tier === "sbx" && root !== undefined) toVmPath(root); // VmPathUnderivable, no process
  const model = pick(explicit.model, stored.model), effort = pick(explicit.effort, stored.effort);
  return {
    tier, ...(permissionMode ? { permissionMode } : {}), ...(sandbox ? { sandbox } : {}),
    ...(model ? { model } : {}), ...(effort ? { effort } : {}),
  };
}

/** The project id the studio keys this checkout by: `.tk-studio/config.yaml`
 * `project_id` ?? basename(root) — a file read, no process. */
function projectIdOf(root: string): string {
  const cfg = readProjectConfig(root);
  if (cfg.unreadable) throw refusal(`project config unreadable: ${cfg.unreadable}`);
  const pid = cfg.config.project_id;
  // The studio's identity is str(project_id): a numeric id is still the id.
  return (typeof pid === "string" || typeof pid === "number") && String(pid) ? String(pid) : basename(root);
}

/** The run `enqueue` would adopt: this job's `queued`/`running` run on this checkout. */
function liveRun(queue: Queue, jobId: string, root: string): QueueRun | undefined {
  const checkout = checkoutKey(root);
  return queue.runs().find((r) => r.job_id === jobId && r.checkout === checkout && (r.state === "queued" || r.state === "running"));
}

/** Resolve a job's worker options before any process: the config is loaded
 * (SupervisorConfigInvalid), the project id read from its config file. */
function resolveBeforeStart(jobId: string, root: string, explicit: OptionLayer, stored: QueueRun | null | undefined): { options: WorkerOptions; config: JobOptions } {
  const config = jobOptions(loadSupervisorConfig(), projectIdOf(root), jobId);
  // A refusal: the options can never run as given (`drain` ends a stored run `blocked` naming it).
  try { return { options: resolveWorkerOptions(explicit, storedLayer(stored), config, root), config }; }
  catch (e) { throw refusal(message(e)); }
}

const explicitLayer = (permissionMode: string | undefined, opts: RunOptions): OptionLayer =>
  ({ permissionMode, tier: opts.tier, sandbox: opts.sandbox, model: opts.model, effort: opts.effort });

/** A validated job: `resolve` served its merged definition with no problems. */
export interface Validated {
  jobId: string; root: string; projectId: string; defn: Record<string, any>;
  /** The registry entry's own root (`--directory` matched it via samePath): the
   * sbx microVM path is derived from it, never from the caller's spelling. */
  registryRoot?: string;
  target: Target;
  /** The skill invocation's timeout: the job's guard, capped at `guardCapS` (the tick's --timeout-cap-s). */
  guardS: number;
  /** The job's own `max_wall_clock_seconds`, never capped: a core job executes inside
   * `wake` under it, so the wake/submit verb's timeout is this + 120 s. */
  jobGuardS: number;
  permissionMode?: string;
  /** Worker options (Story 21.4): tier (default host), sbx sandbox, submission model/effort overrides. */
  tier?: Tier;
  sandbox?: string;
  model?: string;
  effort?: string;
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
      if (isTerminal(state)) return { ok: true, detail: `studio run ${sid} already ${state}`, state };
    } catch { /* end it anyway: the ending verb decides */ }
    const verb = run.target === "core" ? "cancel" : "finish";
    try {
      const out = answered(await verbRunner(root, verb === "finish"
        ? ["finish", "--directory", root, "--run-id", sid, "--state", "partial", "--reason", reason]
        : ["cancel", "--directory", root, "--job-id", run.job_id, "--run-id", sid]), verb);
      if (verb === "cancel" && out.cancelled !== true) throw new Error(`cancel: ${out.reason ?? "not cancelled"}`);
      // §4: `finish` answers the run's state; `cancel` ends a resumable run `partial` (reason `cancelled`).
      return { ok: true, detail: `studio run ${sid} ended via ${verb}`, state: verb === "finish" && typeof out.state === "string" ? out.state : "partial" };
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

/** A run `recover` took over for a resume, and what driving it answered. */
export type ResumedRun = RecoverReport["resumed"][number] & { summary?: RunSummary; error?: string };
/** The restart rule's report, with every taken-over run driven. */
export type RecoveryReport = Omit<RecoverReport, "resumed"> & { resumed: ResumedRun[] };

/** The restart rule with resumes (Story 21.6): `Queue.recover` kills recorded
 * workers, ends what cannot resume and takes over what can — kept short; the
 * caller then drives each taken-over run (`driveResumes`). */
export async function recoverWithResume(
  queue: Queue, owner: Owner, verbRunner: VerbRunner = runJobVerb, deps: ResumeDeps = {},
): Promise<{ report: RecoveryReport; prepared: Map<string, Started> }> {
  const prepared = new Map<string, Started>();
  const report = await queue.recover({ ...studioOps(verbRunner), resume: restartResumer(queue, verbRunner, prepared, deps) }, owner);
  await settleTakenOver(queue, report, prepared, verbRunner, deps);
  return { report, prepared };
}

/** Drive taken-over runs one after another: `--resume <session-id>` on the stored tier, then finish and mirror. */
export async function driveResumes(
  queue: Queue, runs: ResumedRun[], prepared: Map<string, Started>, verbRunner: VerbRunner = runJobVerb, invoke: SkillInvoker = invokeSkill,
): Promise<void> {
  for (const r of runs) {
    const s = prepared.get(r.run_id);
    if (!s) {
      r.error = "resume: no rebuilt run to drive";
      try { await queue.endDriven(r.run_id, "blocked", r.error); } catch { /* already ended */ }
      continue;
    }
    let summary: RunSummary;
    try { summary = await finishRun({ ...s, recorder: queueRecorder(queue, r.run_id) }, verbRunner, invoke); }
    catch (e) {
      r.error = message(e);
      try { await queue.endDriven(r.run_id, "blocked", r.error); } catch { /* already ended */ }
      continue;
    }
    r.summary = await mirror(queue, r.run_id, { jobId: s.jobId, defn: s.defn }, summary);
  }
}

/** `recover`: the restart rule over the whole queue; every resumable run is resumed. */
export async function recoverQueue(opts: RunOptions = {}, verbRunner: VerbRunner = runJobVerb): Promise<RecoveryReport> {
  requireStudio();
  const { queue, owned } = openQueue(opts);
  try {
    const { report, prepared } = await recoverWithResume(queue, opts.owner ?? selfOwner(), verbRunner);
    await driveResumes(queue, report.resumed, prepared, verbRunner);
    return report;
  } finally { if (owned) queue.close(); }
}

export interface DrainReport {
  ok: boolean;
  recovered: RecoveryReport;
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
    const { report: recovered, prepared } = await recoverWithResume(queue, owner, verbRunner);
    await driveResumes(queue, recovered.resumed, prepared, verbRunner);
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
    // Every run drain drove completed: the queued runs, and the resumed runs its recovery took over.
    const ok = runs.every((r) => "summary" in r && (r.summary.ok || r.summary.skipped === true))
      && recovered.resumed.every((r) => r.summary?.ok === true);
    return { ok, recovered, runs };
  } finally { if (owned) queue.close(); }
}

/** `submit`: validate, then enqueue (idempotent). Nothing is driven. */
export async function submitJob(jobId: string, directory: string, opts: RunOptions & { permissionMode?: string } = {}): Promise<Record<string, unknown>> {
  try { resolveStudioRoot(); requireCompatible(); }
  catch (e) { throw new StartError(message(e)); }
  const { queue, owned } = openQueue(opts);
  try {
    let v: Validated, options: WorkerOptions;
    try {
      const root = resolve(directory);
      if (!existsSync(root)) throw refusal(`directory does not exist: ${directory}`);
      // Worker options resolved before any process (a host bypass is refused, nothing queued).
      ({ options } = resolveBeforeStart(jobId, root, explicitLayer(opts.permissionMode, opts), liveRun(queue, jobId, root)));
      v = await validate(jobId, directory, undefined, opts.guardCapS);
    }
    catch (e) { throw e instanceof StartError ? e : new StartError(message(e)); }
    const { run, minted } = queue.enqueue({
      jobId, root: v.root, projectId: v.projectId, target: v.target, definition: v.defn,
      permissionMode: opts.permissionMode, tier: options.tier, sandbox: options.sandbox, model: options.model, effort: options.effort,
    });
    return { ok: true, job_id: jobId, project_id: v.projectId, run_id: run.run_id, state: run.state, minted };
  } finally { if (owned) queue.close(); }
}

export async function runJob(jobId: string, directory: string, permissionMode?: string, opts: RunOptions = {}): Promise<RunSummary> {
  requireStudio(); // StudioRootMissing (AD-15), the contract pin
  const { queue, owned } = openQueue(opts);
  const owner = opts.owner ?? selfOwner();
  let resuming: Promise<void> = Promise.resolve();
  try {
    if (!opts.skipRecover) {
      const { report, prepared } = await recoverWithResume(queue, owner);
      // This job's own resumed run on this checkout first (it is never driven twice);
      // other jobs' resumes are driven alongside this run.
      const checkout = checkoutKey(resolve(directory));
      const mine = (id: string) => { const r = queue.get(id); return r?.job_id === jobId && r.checkout === checkout; };
      await driveResumes(queue, report.resumed.filter((r) => mine(r.run_id)), prepared);
      resuming = driveResumes(queue, report.resumed.filter((r) => !mine(r.run_id)), prepared);
    }
    // `drain` mode: the listed run must still be an ownerless `queued` run.
    const skipped = (why: string): RunSummary => {
      const now = opts.runId ? queue.get(opts.runId) : null;
      return { ok: false, job_id: jobId, run_id: opts.runId ?? null, studio_run_id: now?.studio_run_id ?? null,
        state: now?.state ?? "missing", reason: `skipped: ${why}`, skipped: true };
    };
    if (opts.runId && !queue.drainable(owner).some((r) => r.run_id === opts.runId)) {
      return skipped(`run ${opts.runId} is no longer an ownerless queued run`);
    }
    let v: Validated, options: WorkerOptions, config: JobOptions;
    const explicit = explicitLayer(permissionMode, opts);
    try {
      const root = resolve(directory);
      if (!existsSync(root)) throw refusal(`directory does not exist: ${directory}`);
      // Worker options resolved before anything starts: a host bypass is refused (AD-2
      // ruling), an unknown tier or an sbx tier without a sandbox too — nothing queued.
      const stored = opts.runId ? queue.get(opts.runId) : liveRun(queue, jobId, root);
      ({ options, config } = resolveBeforeStart(jobId, root, explicit, stored));
      const login = await maxLoginPreflight(undefined, { tier: options.tier, sandbox: options.sandbox });
      if (login) return { ok: false, job_id: jobId, run_id: null, state: "blocked", reason: login };
      v = await validate(jobId, directory, permissionMode, opts.guardCapS);
    } catch (e) { throw e instanceof StartError ? e : new StartError(message(e)); }

    // An explicit --permission-mode is recorded on the queue run it mints or adopts
    // (a queued run only), so a later `drain` or tick drives it under that mode; the
    // resolved tier and sandbox, and the submission's model/effort, likewise.
    const record = { tier: options.tier, sandbox: options.sandbox, model: options.model, effort: options.effort };
    let run: QueueRun;
    if (opts.runId) {
      run = queue.get(opts.runId)!;
      if (permissionMode !== undefined && run.state === "queued") run = queue.recordPermissionMode(run.run_id, permissionMode);
      if (run.state === "queued") run = queue.recordRunOptions(run.run_id, record);
    } else {
      run = queue.enqueue({ jobId, root: v.root, projectId: v.projectId, target: v.target, definition: v.defn, owner, permissionMode, ...record }).run;
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
      // The effective options: explicit, else recorded on the run, else the config, else the
      // default — re-checked after the claim (an invalid stored value ends the run `blocked`).
      const eff = resolveWorkerOptions(explicit, storedLayer(claim.run), config, v.root);
      summary = await drive(queue, run.run_id, { ...v, ...eff });
    }
    catch (e) {
      const err = e instanceof StartError ? e : new StartError(message(e));
      try { await queue.endDriven(run.run_id, "blocked", err.message); } catch { /* already ended */ }
      err.runId = run.run_id;
      throw err;
    }
    return await mirror(queue, run.run_id, v, summary);
  } finally {
    await resuming;
    if (owned) queue.close();
  }
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
  // Story 21.6: the wake answer a resume rebuilds from, then a pre-minted session id
  // (recorded just before the spawn) and the worker's pid (recorded on spawn).
  queue.setWake(queueRunId, { directive: started.woke.directive ?? null, routing: started.woke.routing ?? null, state: started.woke.state ?? null });
  return finishRun({ ...started, sessionId: randomUUID(), recorder: queueRecorder(queue, queueRunId) });
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
export async function mirror(queue: Queue, queueRunId: string, v: Pick<Validated, "jobId" | "defn">, s: RunSummary): Promise<RunSummary> {
  const studioRunId = s.run_id ?? null;
  let reason = s.reason;
  try {
    if (studioRunId && queue.get(queueRunId)?.studio_run_id !== studioRunId) queue.setStudioRun(queueRunId, studioRunId);
    const terminal = isTerminal(s.state);
    const endReason = terminal ? s.reason ?? null
      : `${studioRunId ? `studio run ${studioRunId} left ${s.state}` : s.state}${s.reason ? `: ${s.reason}` : ""}`;
    const engine = launchedEngine(v.defn?.target?.skill, s.status_block);
    // A terminal state the studio's own run reached: marked on the `ended` event
    // (it clears an earlier recorded stop — Queue.pacing); a not-woken or refused run never is.
    // The studio's own state (`studio_state`) is what it holds, and what its `evaluate_stop` sees.
    const studioState = s.studio_state ?? s.state;
    const studioOutcome = terminal && studioRunId && isTerminal(studioState) ? { run_id: studioRunId, state: studioState } : undefined;
    const detail = { ...(s.guards_tripped?.length ? { guards_tripped: s.guards_tripped } : {}), ...(studioOutcome ? { studio_outcome: studioOutcome } : {}) };
    // AC4: a studio outcome in `stop.on_status` stops the job recurring — the
    // `stopped` event is written in the same transaction as `ended`.
    const onStatus = v.defn?.stop?.on_status;
    const stop = studioOutcome && Array.isArray(onStatus) && onStatus.includes(studioOutcome.state)
      ? { stop: { condition: "on_status" as const, state: studioOutcome.state, job_id: v.jobId } } : {};
    await queue.endDriven(queueRunId, terminal ? (s.state as "complete") : "blocked", endReason,
      { ...(engine ? { engineRunId: engine } : {}), ...(Object.keys(detail).length ? { detail } : {}), ...stop });
  } catch (e) {
    reason = `${reason ? `${reason}; ` : ""}queue: ${message(e)}`;
  }
  return { ...s, run_id: queueRunId, studio_run_id: studioRunId, ...(reason !== undefined ? { reason } : {}) };
}

export interface Started {
  jobId: string; root: string; projectId: string; runId: string;
  /** The skill invocation's timeout (the capped guard). */
  guardS: number;
  /** The job's own `max_wall_clock_seconds` (uncapped): `guardS` below it means the cap bounds. */
  jobGuardS?: number;
  defn: Record<string, any>; woke: Record<string, any>; permissionMode?: string;
  tier?: Tier; sandbox?: string;
  /** The registry entry root: the sbx microVM path is derived from it. */
  registryRoot?: string;
  /** The submission's overrides: they win over `woke.routing` (§5). */
  model?: string; effort?: string;
  /** Story 21.6: the pre-minted session id (`--session-id` on the first invoke, `--resume` on a resume). */
  sessionId?: string;
  /** Records the session, the worker, what was accounted and each resume on the queue run. */
  recorder?: RunRecorder;
  /** A restart resume: the first invocation resumes `sessionId` with this much of the guard left. */
  resumeFirst?: { remainingS: number; spentS: number };
  /** A restart resume: the message ids the restart's budget check `account`ed — never
   * counted again, even when their `accounted` event could not be recorded. */
  accountedIds?: string[];
}

/** What a driven run records on its queue run (Story 21.6). */
export interface RunRecorder {
  session(sessionId: string): void;
  /** The spawned worker's pid and the wall-clock guard seconds passed to that spawn. */
  worker(pid: number, guardS?: number): void;
  accounted(ids: string[], counts: Counts): void;
  accountedIds(): string[];
  resumes(): number;
  resumed(detail: Record<string, unknown>): void;
  /** The launch-orphan rule's probe of the run's checkout (`root` when the run is not found). */
  launchEngine?(root: string): Promise<LaunchEngine>;
}

/** The queue-backed recorder of one queue run. */
export function queueRecorder(queue: Queue, runId: string): RunRecorder {
  return {
    session: (sid) => { queue.setSession(runId, sid); },
    worker: (pid, guardS) => { queue.setWorker(runId, pid, processStartTime(pid), guardS); },
    accounted: (ids, counts) => { queue.recordAccounted(runId, ids, counts); },
    accountedIds: () => queue.accountedIds(runId),
    resumes: () => queue.resumeCount(runId),
    resumed: (detail) => { queue.markResumed(runId, detail); },
    launchEngine: (root) => queue.launchEngineAt(queue.get(runId)?.root ?? root),
  };
}

/** Registry `show` + `resolve`: the plugin's one validator (AD-2). A refusal
 * or problems[] throws StartError carrying them verbatim; nothing is queued. */
async function validate(jobId: string, directory: string, permissionMode?: string, guardCapS?: number): Promise<Validated> {
  const root = resolve(directory);
  if (!existsSync(root)) throw refusal(`directory does not exist: ${directory}`);
  const projectId = projectIdOf(root);
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
  return { jobId, root, projectId, registryRoot: entryRoot, defn, target: isCore(defn) ? "core" : "skill", ...guardsFor(defn, guardCapS), permissionMode };
}

/** Under the claimed lock: snapshot, `onVerb` (the queue's `verb_started`
 * record), then the verb that mints. Any throw before the verb means no studio run started.
 * The verb's timeout is the backstop of the job's UNCAPPED `max_wall_clock_seconds`
 * guard (+ 120 s: a core job runs inside `wake`, where jobrun enforces the guard
 * itself); the tick's cap applies only to the skill invocation. */
export async function startRun(
  v: Validated, onVerb: (verb: "wake" | "submit", before: string[]) => void, verbRunner: VerbRunner = runJobVerb,
): Promise<Started | { summary: RunSummary }> {
  const { jobId, root, projectId, defn, target, guardS, jobGuardS, permissionMode, tier, sandbox, model, effort, registryRoot } = v;
  const worker = { permissionMode, tier, sandbox, model, effort, ...(registryRoot !== undefined ? { registryRoot } : {}) };
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
    throw new WakeFailed(message(e), { root, projectId, target, verb, timeoutS, jobGuardS, before });
  }
  if (out.ok === false) throw refusal(`${verb}: ${out.error ?? "refused"}`);
  const woke = out;
  if (woke.woken !== true && woke.accepted !== true) {
    return { summary: { job_id: jobId, project_id: projectId, ok: false, run_id: null, state: "not-woken", reason: String(woke.reason ?? "refused") } };
  }
  if (typeof woke.run_id !== "string" || !woke.run_id) {
    throw new StartError(`${verb}: answered ${woke.woken === true ? "woken" : "accepted"} without a run_id — driver contract §4 violation; nothing invoked`);
  }
  return { jobId, root, projectId, runId: woke.run_id, guardS, jobGuardS, defn, woke, ...worker };
}

/** After a wake/submit failure (timeout or otherwise): adopt the newest run of this job that is NOT
 * in the pre-wake snapshot — never a run this CLI did not start. A
 * non-terminal one is ended through a contract verb, because the tick's
 * no-overlap rule would otherwise skip the job forever and no `job-run` event
 * would ever be emitted (AD-12): a skill run is finished — `partial` when the
 * backstop of its wall-clock guard tripped (a timeout), `blocked` otherwise; a
 * core run is cancelled (AC5b: the supervisor never calls `finish` on a core run).
 * No new run → StartError (exit 2, nothing started). */
export async function recoverAfterTimeout(
  jobId: string, failMsg: string, ctx: TimeoutContext, verbRunner: VerbRunner = runJobVerb,
): Promise<RunSummary> {
  const { root, projectId, target, verb, timeoutS, jobGuardS, before } = ctx;
  const timedOut = /timed out/i.test(failMsg);
  // A timeout is the backstop of the job's own wall-clock guard: named on the run.
  const trip: GuardTrip | undefined = timedOut
    ? (jobGuardS !== undefined ? { guard: "max_wall_clock_seconds", value: jobGuardS } : { guard: "max_wall_clock_seconds backstop", value: timeoutS })
    : undefined;
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
  // Already terminal: the studio run ended on its own (no `guards_tripped`), but a timeout still names the guard backstop.
  if (state !== "queued" && state !== "running") return { ...base, state, reason: trip ? `${guardReason([trip])} — ${failed}` : failed };

  const endReason = trip
    ? `${guardReason([trip])} — supervisor backstop: ${verb} timed out after ${timeoutS}s before answering; the run could not be driven`
    : `supervisor: ${verb} failed before answering (${failMsg.slice(0, 300)}) — the run could not be driven`;
  const endVerb = target === "skill" ? "finish" : "cancel";
  let ended: string, endedOk = false;
  try {
    const out = answered(await verbRunner(root, target === "skill"
      ? ["finish", "--directory", root, "--run-id", runId, "--state", trip ? "partial" : "blocked", "--reason", endReason]
      : ["cancel", "--directory", root, "--job-id", jobId, "--run-id", runId]), endVerb);
    if (target === "core" && out.cancelled !== true) throw new Error(`cancel: ${out.reason ?? "not cancelled"}`);
    if (typeof out.state === "string") state = out.state;
    else if (Array.isArray(out.runs_ended) && out.runs_ended.includes(runId)) state = "partial";
    ended = `; the supervisor ended the run via ${endVerb}`;
    endedOk = true;
  } catch (e) {
    ended = `; ending the run via ${endVerb} failed: ${message(e)}`;
  }
  try {
    const status = answered(await verbRunner(root, ["status", "--directory", root, "--job-id", jobId, "--run-id", runId]), "status");
    const now = (status.runs ?? [])[0];
    if (typeof now?.state === "string") state = now.state;
  } catch { /* keep the state the ending verb answered */ }
  if (trip && endedOk) {
    // AC1 on the backstop trip — a skill run finished `partial`, a core run
    // cancelled (21-1 AC5b: never finished): the queue run ends `partial` with
    // the guard named in its reason and its `ended` event.
    // A core run's studio state is `cancelled`: carried as `studio_state`, so `mirror` never records a studio outcome it does not hold.
    return {
      ...base, state: "partial", reason: `${guardReason([trip])} — ${failed}${ended} (studio run ${state})`, guards_tripped: [trip],
      ...(state !== "partial" ? { studio_state: state } : {}),
    };
  }
  return { ...base, state, reason: trip ? `${guardReason([trip])} — ${failed}${ended}` : `${failed}${ended}` };
}

/** Does the job carry a turn or token guard (the ones `account` enforces per iteration)? */
export function hasTurnTokenGuard(defn: Record<string, any> | undefined): boolean {
  const g = defn?.guards;
  const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return !!g && typeof g === "object" && (numeric(g.max_turns) || numeric(g.max_tokens));
}

/** One worker iteration's counters: the host transcript (by session id), or on
 * sbx the worker result's `num_turns`/`usage` (the transcript is inside the microVM). */
export function iterationCounts(out: Record<string, unknown>, tier?: Tier): Counts {
  return tier === "sbx" ? resultCounts(out) : transcriptCounts(typeof out.session_id === "string" ? out.session_id : undefined);
}

/** One iteration's counts not yet accounted (host: the transcript's message ids
 * outside `exclude`; sbx: the worker result's `num_turns`/`usage`, no ids). */
export function iterationNewCounts(
  out: Record<string, unknown>, tier: Tier | undefined, exclude: ReadonlySet<string>, sessionId?: string,
): { counts: Counts; ids: string[] } {
  if (tier === "sbx") return { counts: resultCounts(out), ids: [] };
  return transcriptNewCounts(sessionId ?? (typeof out.session_id === "string" ? out.session_id : undefined), exclude);
}

type SkillInvoker = typeof invokeSkill;

/** Resumes per run (AC2: one by default). */
export const RESUME_CAP = 1;

/** The transcript checks a resume needs: host (restored from the backup when
 * missing), sbx (inside the microVM). Each throws naming `transcript missing: <sid>`. */
export interface TranscriptChecks {
  host(sessionId: string): { restored: boolean };
  sbx(sandbox: string, sessionId: string): Promise<void>;
}
const defaultTranscriptChecks: TranscriptChecks = {
  host: (sid) => ensureTranscript(sid),
  sbx: (sb, sid) => sbxTranscriptExists(sb, sid),
};

/** What a resume check `account`ed: the counts, the message ids, the answer. */
export interface Accounted { turns: number; tokens: number; message_ids: string[]; within_budget: boolean; exceeded: string[] }

export interface ResumeInput {
  root: string; jobId: string; studioRunId: string;
  sessionId: string | null | undefined;
  /** Resumes this run already had. */
  resumes: number;
  tier?: string | null; sandbox?: string | null;
  defn: Record<string, any> | undefined; guardS: number; jobGuardS?: number;
  /** Wall clock already spent (used when `account` reports none). */
  spentS: number;
  /** The interrupted iteration's counts not yet accounted. */
  counts: () => { counts: Counts; ids: string[] };
  /** A run that may not resume here (an sbx run on restart): once the session, cap and
   * studio checks pass, it ends naming this cause (and trips) instead of resuming. */
  neverResume?: { cause: string; trips?: GuardTrip[] };
}

/** `accountAttempted`: the check ran `account` (or its counts) for this iteration — succeeded or failed —
 * so the iteration is never accounted again; `accounted`: what it accounted (absent for a job
 * with no `max_turns`/`max_tokens`, which is never accounted). */
type ResumeRefusal = { ok: false; cause: string; trips?: GuardTrip[]; studioState?: TerminalState; accounted?: Accounted; accountAttempted?: boolean };
export type ResumeVerdict = { ok: true; remainingS: number; restored: boolean; accounted?: Accounted; accountAttempted?: boolean } | ResumeRefusal;

/** Story 21.6: a `tk-studio-launch` run is never resumed beside the engine it may
 * have started. The launch-orphan rule's probe, outside any transaction: a live
 * engine → `launch engine live: <id>`; a failed probe → `launch engine unverified:
 * <detail>`; an empty `live[]` → undefined (the resume checks go on). */
export async function launchEngineCause(probe: () => Promise<LaunchEngine>): Promise<string | undefined> {
  let found: LaunchEngine;
  try { found = await probe(); }
  catch (e) { return `launch engine unverified: ${message(e)}`; }
  if (!found.holder) return undefined;
  if (found.engine.handed_to_engine === "unverified" && typeof found.engine.detail === "string") return `launch engine unverified: ${found.engine.detail}`;
  return `launch engine live: ${found.holder.id ?? "(no run id)"}`;
}

/** The resume-or-partial rule (AC1/AC2), checked in order; the first failure
 * is the cause the run ends `partial` naming: the eligibility (`resumeEligible`),
 * then the budget (`resumeBudget`). In process only — the owner already holds the
 * run; a restart checks the budget only after it has won the takeover. */
export async function resumeCheck(
  i: ResumeInput, verbRunner: VerbRunner = runJobVerb, transcripts: TranscriptChecks = defaultTranscriptChecks,
): Promise<ResumeVerdict> {
  const e = await resumeEligible(i, verbRunner, transcripts);
  if (!e.ok) return e;
  const b = await resumeBudget(i, verbRunner);
  return b.ok ? { ...b, restored: e.restored } : b;
}

/** Eligibility, in order, touching no studio counter: a session id recorded; the
 * resume count below the cap; the studio run still resumable (`status` answers
 * queued/running — a terminal one is answered as `studioState`); `neverResume`;
 * the transcript exists (restored from the backup first on the host). */
export async function resumeEligible(
  i: ResumeInput, verbRunner: VerbRunner = runJobVerb, transcripts: TranscriptChecks = defaultTranscriptChecks,
): Promise<{ ok: true; restored: boolean } | ResumeRefusal> {
  const sid = i.sessionId;
  if (!sid) return { ok: false, cause: "no session recorded" };
  if (i.resumes >= RESUME_CAP) return { ok: false, cause: `resume cap reached (${RESUME_CAP})` };
  let st: Record<string, any>;
  try { st = answered(await verbRunner(i.root, ["status", "--directory", i.root, "--job-id", i.jobId, "--run-id", i.studioRunId]), "status"); }
  catch (e) { return { ok: false, cause: `studio run status failed: ${message(e)}` }; }
  const state = (st.runs ?? [])[0]?.state;
  if (isTerminal(state)) return { ok: false, cause: `studio run ${i.studioRunId} already ${state}`, studioState: state };
  if (state !== "queued" && state !== "running") return { ok: false, cause: `studio run ${i.studioRunId} is ${state ?? "unknown"}, not resumable` };
  if (i.neverResume) return { ok: false, ...i.neverResume };
  let restored = false;
  try {
    if (i.tier === "sbx") await transcripts.sbx(i.sandbox ?? "", sid);
    else restored = transcripts.host(sid).restored;
  } catch (e) {
    return { ok: false, cause: e instanceof TranscriptError && e.message.startsWith("transcript missing") ? e.message : `transcript missing: ${sid} (${message(e)})` };
  }
  return { ok: true, restored };
}

/** The budget. A job with `max_turns`/`max_tokens`: `account` with the interrupted
 * iteration's counts (a studio write — only by the process that owns the run; counts
 * that cannot be read are a failed `account`, never zero); the remaining wall clock =
 * the guard − `counters.wall_clock_seconds`, else − `spentS`. A job with neither is
 * never accounted: the remaining wall clock = the guard − `spentS`. */
export async function resumeBudget(
  i: ResumeInput, verbRunner: VerbRunner = runJobVerb,
): Promise<{ ok: true; remainingS: number; accounted?: Accounted; accountAttempted?: boolean } | ResumeRefusal> {
  let acct: Record<string, any> | undefined, accounted: Accounted | undefined;
  const attempted = hasTurnTokenGuard(i.defn) ? { accountAttempted: true } : {};
  if (attempted.accountAttempted) {
    let counted: { counts: Counts; ids: string[] };
    try { counted = i.counts(); }
    catch (e) { return { ok: false, cause: `guard: account failed — ${message(e)}`, ...attempted }; }
    try {
      acct = answered(await verbRunner(i.root, [
        "account", "--directory", i.root, "--run-id", i.studioRunId, "--turns", String(counted.counts.turns), "--tokens", String(counted.counts.tokens),
      ]), "account");
    } catch (e) { return { ok: false, cause: `guard: account failed — ${message(e)}`, ...attempted }; }
    const exceeded: string[] = Array.isArray(acct.exceeded) ? acct.exceeded.map(String) : [];
    accounted = { ...counted.counts, message_ids: counted.ids, within_budget: acct.within_budget !== false, exceeded };
    if (acct.within_budget === false) {
      const trips = exceeded.map((g) => ({ guard: g, value: Number(i.defn?.guards?.[g]) }));
      return { ok: false, cause: trips.length ? guardReason(trips) : "guard: account answered within_budget false naming no guard", trips, accounted, ...attempted };
    }
  }
  const reported = Number(acct?.counters?.wall_clock_seconds);
  const spent = acct?.counters && Number.isFinite(reported) ? reported : i.spentS;
  const remainingS = Math.floor(i.guardS - spent);
  const done = { ...(accounted ? { accounted } : {}), ...attempted };
  if (remainingS <= 0) {
    const trips = [wallClockGuard(i.jobGuardS, i.guardS)];
    return { ok: false, cause: guardReason(trips), trips, ...done };
  }
  return { ok: true, remainingS, ...done };
}

/** Seconds since the run's first worker spawned (else since `verb_started`). */
function spentSince(queue: Queue, run: QueueRun, clock: () => number = Date.now): number {
  const first = queue.events(run.run_id).find((e) => e.kind === "worker")?.at ?? run.verb_started;
  const ms = Date.parse(first ?? "");
  return Number.isFinite(ms) ? Math.max(0, (clock() - ms) / 1000) : 0;
}

/** Rebuild the run a restart resumes: the stored worker options (explicit none,
 * then the config, then the default — `resolveWorkerOptions`), `validate()` for
 * the registry root (the sbx VM root never falls back to the caller's root), the
 * driven definition and the stored wake answer. No tick cap applies to a resume. */
async function rebuildStarted(queue: Queue, run: QueueRun, wake: Record<string, any>): Promise<Started> {
  const { options } = resolveBeforeStart(run.job_id, run.root, {}, run);
  const v = await validate(run.job_id, run.root, options.permissionMode);
  const defn = queue.definition(run) ?? v.defn;
  return {
    jobId: run.job_id, root: v.root, projectId: v.projectId, runId: run.studio_run_id!, ...guardsFor(defn), defn, woke: wake,
    ...(v.registryRoot !== undefined ? { registryRoot: v.registryRoot } : {}), sessionId: run.session_id ?? undefined,
    tier: options.tier, ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    ...(options.sandbox ? { sandbox: options.sandbox } : {}), ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
  };
}

export interface ResumeDeps {
  rebuild?: (run: QueueRun, wake: Record<string, any>) => Promise<Started>;
  transcripts?: TranscriptChecks;
  clock?: () => number;
}

/** The resume input of a dead owner's run, as recorded on its queue run. */
function restartInput(queue: Queue, run: QueueRun, deps: ResumeDeps): ResumeInput {
  const defn = queue.definition(run) ?? undefined;
  const { guardS, jobGuardS } = guardsFor(defn);
  const sid = run.session_id;
  return {
    root: run.root, jobId: run.job_id, studioRunId: run.studio_run_id!, sessionId: sid, resumes: queue.resumeCount(run.run_id),
    tier: run.tier, sandbox: run.sandbox, defn, guardS, jobGuardS, spentS: spentSince(queue, run, deps.clock),
    counts: () => transcriptNewCounts(sid ?? undefined, new Set(queue.accountedIds(run.run_id))),
  };
}

/** The `resume` op `recover` asks about a dead owner's run with a studio run:
 * a core run never resumes (21-1 AC5b: cancel + `supervisor restart`); an sbx
 * run never resumes on restart (its in-VM worker ran to its deadline: the
 * wall-clock guard is named); a skill run resumes when `resumeEligible` passes
 * and the run rebuilds — the rebuilt run is left in `prepared`. Nothing here
 * writes a studio counter: the budget is checked (`account`) only after this
 * process has won the takeover (`settleTakenOver`). */
export function restartResumer(queue: Queue, verbRunner: VerbRunner, prepared: Map<string, Started>, deps: ResumeDeps = {}): StudioResumer {
  return async (run) => {
    const defn = queue.definition(run) ?? undefined;
    if (run.target === "core" || isCore(defn)) return { resume: false };
    // A launch run may have started an engine that works the checkout: never resumed beside it
    // (the orphan end then hands the lock to it, by the launch-orphan rule).
    if (defn?.target?.skill === LAUNCH_SKILL) {
      const cause = await launchEngineCause(() => queue.launchEngineAt(run.root));
      if (cause) return { resume: false, cause };
    }
    const input = restartInput(queue, run, deps);
    if (run.tier === "sbx") {
      const trips = [{ guard: "max_wall_clock_seconds", value: input.jobGuardS ?? input.guardS }];
      input.neverResume = run.worker_pid !== null && run.worker_pid !== undefined
        ? { cause: guardReason(trips), trips }
        : { cause: "no worker recorded (an sbx run is never resumed on restart)" };
    }
    const verdict = await resumeEligible(input, verbRunner, deps.transcripts);
    if (!verdict.ok) {
      return { resume: false, cause: verdict.cause, ...(verdict.trips ? { trips: verdict.trips } : {}), ...(verdict.studioState ? { studioState: verdict.studioState } : {}) };
    }
    let wake: unknown = null;
    try { wake = JSON.parse(run.wake ?? "null"); } catch { /* unreadable: none */ }
    if (!wake || typeof wake !== "object") return { resume: false, cause: "no wake answer recorded" };
    let rebuilt: Started;
    try { rebuilt = await (deps.rebuild ?? ((r, w) => rebuildStarted(queue, r, w)))(run, wake as Record<string, any>); }
    catch (e) { return { resume: false, cause: `resume rebuild failed: ${message(e)}` }; }
    prepared.set(run.run_id, { ...rebuilt, sessionId: run.session_id! });
    return { resume: true, detail: { session_id: run.session_id, ...(verdict.restored ? { transcript: "restored from the backup" } : {}) } };
  };
}

/** After the takeover (this process owns each run in `report.resumed`): the budget
 * — `account` with the interrupted iteration's counts not yet accounted, recorded
 * as an `accounted` event — so one recovery accounts them at most once. Budget
 * left → the remaining wall clock is set on the prepared run; a guard trip (or a
 * failed `account`) ends the owned run `partial` naming it (`orphaned: supervisor
 * restart; guard: …`, the studio run finished too), moved to `report.ended`. */
async function settleTakenOver(
  queue: Queue, report: RecoverReport, prepared: Map<string, Started>, verbRunner: VerbRunner, deps: ResumeDeps,
): Promise<void> {
  for (const r of [...report.resumed]) {
    const run = queue.get(r.run_id);
    const s = prepared.get(r.run_id);
    if (!run || !s || run.state !== "running") continue; // driveResumes names a missing rebuild
    const input = restartInput(queue, run, deps);
    const b = await resumeBudget(input, verbRunner);
    if (b.accounted) {
      try {
        queue.recordAccounted(r.run_id, b.accounted.message_ids, { turns: b.accounted.turns, tokens: b.accounted.tokens },
          { reason: "supervisor restart", ...(b.ok ? { remaining_s: b.remainingS } : {}) });
      } catch { /* the studio already has the counts */ }
    }
    if (b.ok) {
      prepared.set(r.run_id, {
        ...s, resumeFirst: { remainingS: b.remainingS, spentS: s.guardS - b.remainingS },
        ...(b.accounted ? { accountedIds: b.accounted.message_ids } : {}),
      });
      continue;
    }
    prepared.delete(r.run_id);
    report.resumed.splice(report.resumed.indexOf(r), 1);
    const reason = `${ORPHANED_REASON}; ${b.cause}`;
    const studio = await studioRunEnder(verbRunner)({ ...run, studio_run_id: r.studio_run_id }, reason);
    await mirror(queue, r.run_id, { jobId: run.job_id, defn: s.defn }, {
      ok: false, job_id: run.job_id, run_id: r.studio_run_id, target: "skill", state: "partial", reason,
      ...(b.trips?.length ? { guards_tripped: b.trips } : {}), studio_state: studio.ok && studio.state ? studio.state : "unknown",
    });
    report.ended.push({ run_id: r.run_id, studio_run_id: r.studio_run_id, studio: { ok: studio.ok, detail: studio.detail }, reason });
  }
}

/** Once a run id is known nothing throws: failures come back as ok:false with the run id.
 * The skill invocation runs under `s.guardS` (the capped guard); a trip ends the run
 * `partial` naming the bound that tripped. After the invocation returns and before
 * `finish`, a job with `max_turns`/`max_tokens` has the iteration's counters
 * `account`ed; `within_budget: false` or a failed `account` ends it `partial` naming it.
 * A silent exit (AC2: the worker ran and printed no status block — not an auth
 * block, a preflight stop or a wall-clock trip) resumes the session in process
 * (`--resume <session-id>`, the remaining wall clock) when `resumeCheck` passes;
 * otherwise, and after the cap, it ends `partial` naming MISSING_STATUS_BLOCK and the cause
 * (a resume whose record fails never runs: `resume not recorded`). A worker whose
 * record fails is killed and the run ends `blocked` naming `worker record failed`.
 * A resumed iteration accounts only the message ids not already accounted. */
export async function finishRun(
  s: Started, verbRunner: VerbRunner = runJobVerb, invoke: SkillInvoker = invokeSkill, clockMs: () => number = () => performance.now(),
  transcripts: TranscriptChecks = defaultTranscriptChecks,
): Promise<RunSummary> {
  const { jobId, root, projectId, runId, guardS, defn, woke, permissionMode, tier, sandbox, registryRoot } = s;
  const rec = s.recorder, sid = s.sessionId;
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

  let state: ReturnType<typeof finishStateFor> = "blocked", reason: string | undefined, block: Record<string, unknown> | undefined, cost: number | undefined;
  let invoked: Record<string, unknown> | undefined, tripped: GuardTrip[] | undefined, account: RunSummary["account"];
  const routing = (woke.routing ?? {}) as Record<string, unknown>;
  const knowledge = directive.knowledge && typeof directive.knowledge === "object" ? directive.knowledge : undefined;
  // §5: the submission's override, else the resolved job's routing — verbatim; neither → none (AD-14).
  const model = s.model ?? routing.model, effort = s.effort ?? routing.effort;
  // Resume state (Story 21.6).
  let resumes = rec ? rec.resumes() : 0;
  const accountedIds = new Set<string>([...(rec ? rec.accountedIds() : []), ...(s.accountedIds ?? [])]);
  let resuming = !!(s.resumeFirst && sid);
  let spentS = s.resumeFirst?.spentS ?? 0;
  let timeoutS = s.resumeFirst && sid ? s.resumeFirst.remainingS : guardS;
  let accountedLast = false;
  const noteAccounted = (a: Accounted) => {
    for (const id of a.message_ids) accountedIds.add(id);
    try { rec?.accounted(a.message_ids, { turns: a.turns, tokens: a.tokens }); } catch { /* the studio already has the counts */ }
    account = { turns: a.turns, tokens: a.tokens, within_budget: a.within_budget, exceeded: a.exceeded };
  };
  for (;;) {
    accountedLast = false; tripped = undefined; block = undefined; reason = undefined;
    try {
      const startedMs = clockMs();
      const spawnGuardS = timeoutS; // the guard this spawn runs under (sbx: its in-VM `timeout`)
      const recording = rec
        ? { ...(sid && !resuming ? { beforeSpawn: () => rec.session(sid) } : {}), onSpawn: (pid: number) => rec.worker(pid, spawnGuardS) } : {};
      const out = await invoke(root, directive.skill, {
        payload: { ...(directive.payload ?? {}), run_id: runId }, timeout_s: timeoutS, permission_mode: permissionMode,
        ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}),
        ...(tier ? { tier } : {}), ...(sandbox ? { sandbox } : {}), ...(knowledge ? { knowledge } : {}),
      }, undefined, {
        ...(registryRoot !== undefined ? { vmHostRoot: registryRoot } : {}),
        ...(sid ? { sessionId: sid, ...(resuming ? { resume: true } : {}) } : {}), ...recording,
      });
      // The worker's own time, from its spawn (invokeSkill's worker_elapsed_s) —
      // not the auth preflight or drift check before it; the injected clock only
      // when the result does not carry it.
      const elapsedS = typeof out.worker_elapsed_s === "number" && Number.isFinite(out.worker_elapsed_s)
        ? out.worker_elapsed_s : (clockMs() - startedMs) / 1000;
      invoked = out;
      if (typeof out.total_cost_usd === "number") cost = (cost ?? 0) + out.total_cost_usd;
      block = out.status_block as Record<string, unknown> | undefined;
      if (block) {
        state = finishStateFor(String(block.status));
        reason = typeof block.reason === "string" && block.reason ? block.reason
          : state === "complete" ? undefined : `status block ended '${block.status}'`;
      } else if (tier === "sbx" && (out.exit === 124 || out.exit === 137) && elapsedS >= timeoutS) {
        // The in-VM `timeout` (GNU: 124 on TERM, 137 after `-k`) fired before the
        // host timer: the wall-clock guard tripped inside the microVM (AC1). Only
        // once the iteration's time has passed in the worker's own run (from its spawn,
        // not counting the preflight) — an earlier 124/137 is an OOM or another
        // SIGKILL, and stays the AD-11 failure below.
        tripped = [wallClockGuard(s.jobGuardS, guardS)];
        state = "partial";
        reason = guardReason(tripped);
      } else if (out.ran !== false) {
        // AC2: a silent exit — the resume-or-partial rule, capped at RESUME_CAP.
        const failure = String(out.conformance_failure ?? MISSING_STATUS_BLOCK);
        spentS += elapsedS;
        // A launch run is never resumed beside a live (or unverified) engine: it ends
        // `partial` naming it, and its end hands the lock to the engine (`endDriven`).
        const engineCause = defn?.target?.skill === LAUNCH_SKILL
          ? await launchEngineCause(() => rec?.launchEngine ? rec.launchEngine(root) : probeLaunchEngine(defaultProbes, root))
          : undefined;
        const verdict: ResumeVerdict = engineCause ? { ok: false, cause: engineCause } : await resumeCheck({
          root, jobId, studioRunId: runId, sessionId: sid, resumes, tier, sandbox, defn, guardS, jobGuardS: s.jobGuardS, spentS,
          counts: () => iterationNewCounts(out, tier, accountedIds, sid),
        }, verbRunner, transcripts);
        if (verdict.accounted) noteAccounted(verdict.accounted);
        // The check ran `account` for this iteration (answered or failed): never again after the loop.
        if (verdict.accounted || verdict.accountAttempted) accountedLast = true;
        let unrecorded: string | undefined;
        if (verdict.ok) {
          // The resume is recorded before it runs: an unrecorded one could let a later restart exceed the cap.
          try {
            rec?.resumed({
              reason: "silent worker exit", session_id: sid, remaining_s: verdict.remainingS,
              ...(verdict.accounted ? { accounted: { turns: verdict.accounted.turns, tokens: verdict.accounted.tokens } } : {}),
              ...(verdict.restored ? { transcript: "restored from the backup" } : {}),
            });
          } catch (e) { unrecorded = `resume not recorded: ${message(e)}`; }
          if (unrecorded === undefined) {
            resumes++;
            resuming = true;
            timeoutS = verdict.remainingS;
            continue;
          }
        }
        state = "partial";
        reason = `${failure}; ${unrecorded ?? (verdict.ok ? "" : verdict.cause)}`;
        if (!verdict.ok && verdict.trips?.length) tripped = verdict.trips;
      } else {
        state = "blocked";
        reason = String(out.conformance_failure ?? MISSING_STATUS_BLOCK);
      }
    } catch (e) {
      const msg = message(e);
      // A failed worker record (the worker was killed) is its own named failure, never a guard trip.
      if (/timed out/i.test(msg) && !msg.startsWith(WORKER_RECORD_FAILED)) {
        tripped = [wallClockGuard(s.jobGuardS, guardS)];
        state = "partial";
        reason = guardReason(tripped);
      } else {
        state = "blocked";
        reason = msg;
      }
    }
    break;
  }
  // AC2: one worker iteration ran — account its turns/tokens before `finish`
  // (account refuses a run that is no longer resumable). A wall-clock trip is
  // not accounted (the iteration was killed), nor one a resume check already
  // accounted. The iteration's own reason is never dropped: guard text is
  // appended to it. A tripped turn/token guard ends the run `partial`; an
  // account FAILURE turns a clean run `partial` but never lifts an already-`blocked` one.
  const withGuard = (text: string) => (reason ? `${reason}; ${text}` : text);
  if (invoked && invoked.ran !== false && !tripped && !accountedLast && hasTurnTokenGuard(defn)) {
    try {
      const { counts, ids } = iterationNewCounts(invoked, tier, accountedIds, sid);
      const acct = answered(await verbRunner(root, [
        "account", "--directory", root, "--run-id", runId, "--turns", String(counts.turns), "--tokens", String(counts.tokens),
      ]), "account");
      const exceeded: string[] = Array.isArray(acct.exceeded) ? acct.exceeded.map(String) : [];
      noteAccounted({ ...counts, message_ids: ids, within_budget: acct.within_budget !== false, exceeded });
      if (acct.within_budget === false) {
        tripped = exceeded.map((g) => ({ guard: g, value: Number(defn?.guards?.[g]) }));
        state = "partial";
        reason = withGuard(tripped.length ? guardReason(tripped) : "guard: account answered within_budget false naming no guard");
      }
    } catch (e) {
      if (state !== "blocked") state = "partial";
      reason = withGuard(`guard: account failed — ${message(e)}`);
    }
  }
  const extras = {
    ...(block ? { status_block: block } : {}), ...(cost !== undefined ? { total_cost_usd: cost } : {}),
    ...(tripped?.length ? { guards_tripped: tripped } : {}), ...(account ? { account } : {}),
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
  "usage: bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>] [--tier host|sbx] [--sandbox <name>]",
  "                          [--model <model>] [--effort <effort>]",
  "       bun src/cli.ts submit <job-id> --directory <root> [same options as run]",
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
  const allowed = ["--directory", "--permission-mode", "--tier", "--sandbox", "--model", "--effort"];
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) { console.error(`unknown argument '${flag}'\n${USAGE}`); return 2; }
    const value = rest[++i];
    if (value === undefined || value.trim() === "" || value.startsWith("--")) { console.error(`${flag} needs a value\n${USAGE}`); return 2; }
    values[flag] = value;
  }
  const directory = values["--directory"], permissionMode = values["--permission-mode"];
  const worker = { tier: values["--tier"], sandbox: values["--sandbox"], model: values["--model"], effort: values["--effort"] };
  if ((cmd !== "run" && cmd !== "submit") || !jobId || !directory) { console.error(USAGE); return 2; }
  try {
    if (cmd === "submit") {
      console.log(JSON.stringify(await submitJob(jobId, directory, { ...worker, permissionMode }), null, 2));
      return 0;
    }
    const summary = await runJob(jobId, directory, permissionMode, worker);
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
