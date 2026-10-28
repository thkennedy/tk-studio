#!/usr/bin/env bun
/**
 * Supervisor CLI — jobs queued durably, one engine per checkout, each run
 * woken, invoked headless, finished.
 *
 *   bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>] [--tier host|sbx]
 *                  [--sandbox <name>] [--model <model>] [--effort <effort>]
 *   bun src/cli.ts submit <job-id> --directory <root> [same options as run] [--editor-in-the-loop]
 *   bun src/cli.ts recover
 *   bun src/cli.ts drain
 *   bun src/cli.ts serve   (the HTTP API, src/api.ts — Story 22.1)
 *   bun src/cli.ts verify <run id>   (Story 33.8: an ended run's host leg re-run, src/hostleg.ts)
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
 *
 * Worktrees (Story 27.1, src/worktree.ts): after the claim, before the snapshot and the minting verb,
 * every run gets its own git worktree of the project cut from its `base_ref` (none given → the
 * default branch, recorded `base_ref_source: default`; an unprotected default branch is refused),
 * materialised by the studio's own motions; a failed step ends the run `blocked` naming it.
 * `wake` and the registry keep the registered root and the checkout lock; the worker's cwd,
 * `payload.directory` and the sbx VM path are the worktree. A `tk-studio-launch` run that started an
 * engine writes `launched` and stays `running` (its end deferred); the engine-end sweep
 * (`sweepEngines`, in `run`, `recover` and `drain`) closes it out when the engine ends or pauses.
 * Every other end closes out at once: push + PR, or "no changes", then the worktree removed.
 *
 * The engine's sandbox (Story 27.2, src/sandbox.ts): an sbx worker pins its sandbox (`sbx run -d --name`)
 * before its login preflight; a launched sbx engine has its in-VM pid recorded and one `sbx exec … tail
 * --pid` held open for its life (respawned by `recover` after a restart); a cancel or a tripped guard kills
 * it by that pid; its deferred end releases the pin (`sbx stop`) when no other run records the sandbox.
 * `recover` (each tick) writes the served projects' `starter.lock` (the queue is the only starter; a claim
 * rewrites its own) and records a studio run started outside the queue as an `external` queue run.
 * Story 28.6: `serve` rewrites them every STARTER_LOCK_REFRESH_MS with a fresh `since` (`watchStarterLocks`),
 * so `jobrun.py` judges the lock live while the supervisor is up and refuses a hand start (`StarterLocked`);
 * the verbs `startRun` runs for a claimed run carry `--force-starter`.
 *
 * A paused run (Story 27.3, src/closeout.ts): after each sweep the paused-run pass closes out a run whose
 * story landed with a closable verdict (harvest commit, `meter.py harvest`, `bmad-loop archive`, then the
 * epic relaunched under the same queue run: `relauncher`), records one `awaiting-ruling` (and one notification)
 * for a landed story with no verdict or `escalate`, and leaves anything else for `POST /runs/{id}/resume`
 * (`resumeRun`).
 *
 * Run hygiene (Story 22.3, src/hygiene.ts): `submit --editor-in-the-loop` flags the run (refused
 * with WorkDirMissing, nothing queued, when TK_SUPERVISOR_WORK is unset); a flagged Godot run is
 * snapshot after the claim and before `wake`/`submit` (a failed snapshot ends it `blocked`
 * naming `snapshot failed: …`). After every end — in the driving process, after a cancel (that
 * run only), and in `recover`/`drain` — the end sweep notifies (TK_SUPERVISOR_NOTIFY, validated at the start of
 * `run`, `recover`, `drain` and `serve`: a named start error) and copies the host transcript.
 */
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  buildWorkerCommand, checkTier, finishStateFor, invokeSkill, lastJsonObject, maxLoginPreflight, MISSING_STATUS_BLOCK,
  readProjectConfig, registryShow, requireCompatible, resolveStudioRoot, runJobVerb, runProcess, runUv, SbxSandboxMissing, toVmPath, WORKER_RECORD_FAILED, type Spawner, type Tier,
} from "./server";
import { serve as serveApi } from "./api";
import { notifier, pluginRoot, tlsConfig, WorkDirMissing, workDir } from "./env";
import { engineMcpEnv, engineMcpRefusalText, recoverEngineMcps, startEngineMcp, type EngineMcpDeps } from "./enginemcp";
import { canonicalPr, prUrl, recordClaimRefusal, snapshotOnce, sweepEnds, underBunTest, type HygieneDeps } from "./hygiene";
import { rebuildAgents, type RebuildDeps, type RebuildResult } from "./registry";
import {
  closeOut, closeOutDetail, launchedCloseOutInput, meteredCost, pendingCloseOut, prepareWorktree, priorPr, sweepEngines, type WorktreeDeps,
} from "./worktree";
import {
  checkoutKey, defaultProbes, engineRoot, servedRoot, isTerminal, LAUNCH_SKILL, VALIDATE_RESOLUTION_JOB, ENGAGEMENT_CHAT_JOB, ORPHANED_REASON, probeLaunchEngine, processStartTime, Queue, RunTerminal, selfOwner, STUDIO_END_RETRY_LIMIT, workerMayRun,
  type Holder, type LaunchEngine, type Owner, type QueueRun, type RecoverReport, type RunState, type StudioEnder, type StudioFinder, type StudioOps, type StudioResumer, type TerminalState,
  type WorkerKill,
} from "./queue";
import { rerunHostLeg, VerifyRefused, type HostLegStarted } from "./hostleg";
import { closeOutPaused, launchedSinceMove, resumePaused, type PausedDeps, type ResumeAnswer, type ResumeDeps as EngineResumeDeps } from "./closeout";
import { mergePass, reviewPass, type PlanStatusDeps } from "./planstatus";
import { resolutionPass, withQueuedPayload, withStoredPayload, type ResolutionDeps } from "./resolution";
import { chatSpendPass, type ChatDeps, type ChatSpendDeps } from "./chat";
import { questionsPass, type QuestionsDeps } from "./questions";
import { scopePass, type ScopeDeps } from "./scope";
import { approvePass, engagementRunPass, engagementRunSpendPass, type ApproveDeps, type RunSpendDeps, type Submitter } from "./approve";
import { closeoutPass } from "./delivery";
import { ledgerPath } from "./board";
import { CERT_CHECK_MS, CERT_RENEW_EXIT, certCheck, recordCertStart } from "./cert";
import {
  holdEngine, killRunEngine, pinWithRestart, releasePin, respawnHolds, STARTER_LOCK_REFRESH_MS, studioRunDir, writeStarterLock, writeStarterLocks, type PinContext,
  type SandboxDeps,
} from "./sandbox";
import { jobOptions, loadSupervisorConfig, type JobOptions } from "./config";
import {
  ensureTranscript, resultCounts, sbxSessionWorkers, sbxTranscriptExists, transcriptCounts, TranscriptError, transcriptNewCounts,
  type Counts, type SbxWorkerProbe,
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
  /** Story 21.6: the run ends keeping its checkout lock (the cause: an sbx worker may still
   * run in the VM); `mirror` ends the queue run with `holdLock`, and the lock is freed only
   * once the recorded worker's in-VM deadline has passed (`Queue.recordedWorker`). */
  hold_lock?: string;
  /** Story 27.1 (operator-decisions §2): a `tk-studio-launch` run that started an engine in its
   * worktree — `finish` was not called at launch return; the engine-end sweep calls it. */
  finish_deferred?: true;
  /** Story 27.2: a tripped guard on an sbx launch run killed its in-VM engine by its recorded pid: the outcome. */
  engine_kill?: WorkerKill;
  /** Story 33.2: `drain` could not claim the run (it stays `queued`): the reason recorded as `claim-refused` and what
   * resolves it. */
  claim_refused?: ClaimRefused;
  /** Story 27.5 (DW-23): `finish` was refused (the studio run already terminal): the refusal and the run's actual
   * state — `mirror` records them as a `finish-refused` event; the reason stays the worker's own. */
  finish_refused?: { error: string; actual_state: string };
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

/** Story 22.3: a selected notifier missing its variables (or an unknown one) is a named start error. */
function requireNotifier(env: Record<string, string | undefined> = process.env): void {
  try { notifier(env); }
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
  /** Story 33.3: the sandboxes the pin restarted in this drain pass (`drainQueue` owns it and shares it with the
   * pass's resumes and drained runs; one restart per pass). */
  restarted?: Set<string>;
  /** Explicit worker options (the submission's flags); each wins over the stored run and the config. */
  tier?: string;
  sandbox?: string;
  model?: string;
  effort?: string;
  /** Story 22.1: the submission's `base_ref`, stored on the queue run it mints; Story 27.1: the run's
   * worktree is cut from it and its PR targets it. */
  baseRef?: string;
  /** Story 22.3: the submission's editor-in-the-loop flag (stored on the queue run like `tier`). */
  editorInTheLoop?: boolean;
  /** Story 22.3: the end sweep's environment and HTTP client (tests inject them). */
  hygiene?: HygieneDeps;
  /** Story 34.5: a drained flagged run's engine MCP start (tests inject its seams; default: the worktree env). */
  engineMcp?: EngineMcpDeps;
  /** Story 27.1: the worktree's environment and spawners (tests inject them; default process.env). */
  worktree?: WorktreeDeps;
  /** Story 27.5: the plan pull-back's registry lookup (tests inject it; default `registry.py show`). */
  plan?: PlanStatusDeps;
  /** Story 29.2: the agent registry's rebuild (`rebuildQuietly`) — injected deps, or `false` to skip it. */
  agents?: AgentsOption;
  /** Story 31.7: the resolution pass (`resolveQuietly`) — injected deps, or `false` to skip it. */
  resolution?: Partial<ResolutionDeps> | false;
  /** Story 32.2: the chat-spend pass (`chatSpendQuietly`) — injected deps, or `false` to skip it. */
  chatSpend?: Partial<ChatSpendDeps> | false;
  /** Story 32.3: the engagement questions pass (`questionsQuietly`) — injected deps, or `false` to skip it. */
  questions?: Partial<QuestionsDeps> | false;
  /** Story 32.4: the engagement scope pass (`scopeQuietly`) — injected deps, or `false` to skip it. */
  scope?: Partial<ScopeDeps> | false;
  /** Story 32.6: the approve pass and the engagement-run pass (`approveQuietly`) — injected deps, or `false` to skip
   * them. */
  approve?: Partial<ApproveDeps> | false;
  /** Story 32.6: the engagement run-spend pass (`runSpendQuietly`) — injected deps, or `false` to skip it. */
  runSpend?: Partial<RunSpendDeps> | false;
}

/** Story 29.2: how a rebuild point rebuilds the `agents` table — the injected deps (tests), `false` (no rebuild),
 * or undefined (production: `registry.py show` and `pipeline.py resolve`; under `bun test` no rebuild, so a test
 * never reads the operator's real registry or spawns `uv` unless it injects the deps). */
export type AgentsOption = Partial<RebuildDeps> | false | undefined;

/** Story 29.2: the one rebuild helper every rebuild point calls (recover, claim, end, drain, cancel). It awaits
 * `rebuildAgents`, logs a failed rebuild or its problems with `console.warn`, and never throws: a registry failure
 * never fails a tick, a claim or an end. */
export async function rebuildQuietly(queue: Queue, agents: AgentsOption = undefined): Promise<RebuildResult | null> {
  if (agents === false || (agents === undefined && underBunTest())) return null;
  try {
    const res = await rebuildAgents(queue, agents ?? {});
    if (!res.rebuilt) console.warn(`[agents] registry not rebuilt (table unchanged): ${res.problem}`);
    else for (const p of res.problems) console.warn(`[agents] ${p}`);
    return res;
  } catch (e) {
    console.warn(`[agents] registry not rebuilt: ${message(e)}`);
    return null;
  }
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

/** How long the submission's git read may take (Story 28.5): a failure or a trip keys by the root. */
const CHECKOUT_READ_TIMEOUT_S = 15;

/** Story 28.5: the git checkout a project root lies in, read once per submission — the checkout lock's key
 * (the canonical, case-folded `git rev-parse --show-toplevel`) and the root's prefix below it
 * (`--show-prefix`, `""` at the top). Argv only, bounded; a root not in git — or any failure — keys by
 * itself with prefix `""` (never a refusal). */
export async function resolveCheckout(
  root: string, opts: { platform?: NodeJS.Platform; timeoutS?: number } = {},
): Promise<{ lockCheckout: string; prefix: string }> {
  const own = { lockCheckout: checkoutKey(root, opts.platform), prefix: "" };
  try {
    const r = await runProcess("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: root, timeoutS: opts.timeoutS ?? CHECKOUT_READ_TIMEOUT_S });
    if (r.exit !== 0) return own;
    const [top = "", prefix = ""] = r.stdout.split(/\r?\n/);
    if (!top.trim()) return own;
    // `--show-toplevel` prints forward slashes on win32: canonicalised (resolved) before it is folded.
    return { lockCheckout: checkoutKey(top.trim(), opts.platform), prefix: prefix.trim() };
  } catch { return own; }
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
  // A refusal: the options can never run as given. Story 33.2 (ruling D): `drain` leaves a stored run `queued` on a
  // TierRefused or SbxSandboxMissing refusal (`placementRefusal`, recorded `claim-refused`) and ends it `blocked`
  // naming any other.
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
  /** Story 27.1: the run's worktree — the worker's cwd, `payload.directory` and the sbx VM path
   * (the studio verbs and the registry keep `root`). */
  workRoot?: string;
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

/** Drive taken-over runs one after another: `--resume <session-id>` on the stored tier, then finish and mirror.
 * Story 33.3: `restarted` is the drain pass's restarted set (`drainQueue` passes its own, so a resume's pin and the
 * pass's drained runs restart a sandbox at most once in the pass); absent, each resume's recorder has its own. */
export async function driveResumes(
  queue: Queue, runs: ResumedRun[], prepared: Map<string, Started>, verbRunner: VerbRunner = runJobVerb, invoke: SkillInvoker = invokeSkill,
  sandbox: SandboxDeps = {}, restarted?: Set<string>,
): Promise<void> {
  for (const r of runs) {
    const s = prepared.get(r.run_id);
    if (!s) {
      r.error = "resume: no rebuilt run to drive";
      try { await queue.endDriven(r.run_id, "blocked", r.error); } catch { /* already ended */ }
      await releasePin(queue, r.run_id, sandbox); // Story 27.2: the last holder's end stops an outstanding pin
      continue;
    }
    let summary: RunSummary;
    try { summary = await finishRun({ ...s, recorder: queueRecorder(queue, r.run_id, {}, restarted) }, verbRunner, invoke); }
    catch (e) {
      r.error = message(e);
      try { await queue.endDriven(r.run_id, "blocked", r.error); } catch { /* already ended */ }
      await releasePin(queue, r.run_id, sandbox);
      continue;
    }
    r.summary = await mirror(queue, r.run_id, { jobId: s.jobId, defn: s.defn }, summary, verbRunner);
  }
}

/** Story 27.2: the sandbox seams a run's worktree deps carry (the env, and the injected `sbx` spawners). */
const sbxDeps = (w: WorktreeDeps | undefined): SandboxDeps => ({ ...(w?.env ? { env: w.env } : {}), ...(w?.sbx ?? {}) });

/** Story 27.2: where the queue places its own runs of a job on a checkout — the job's supervisor config
 * (`TK_SUPERVISOR_CONFIG`, keyed by the checkout's project id) resolved as `runJob` resolves a fresh run —
 * the tier, and the sandbox on sbx. An unreadable config or a refused placement: none (recorded without). */
export function jobPlacement(jobId: string, root: string): { tier?: Tier; sandbox?: string } {
  try {
    const { options } = resolveBeforeStart(jobId, root, {}, null);
    return { tier: options.tier, ...(options.tier === "sbx" && options.sandbox ? { sandbox: options.sandbox } : {}) };
  } catch { return {}; }
}

/** Does the studio run's record directory still exist in the store (`studioRunDir`)? An unreadable key or
 * store answers yes: no proof the run is gone. */
function studioRunRecorded(r: QueueRun, studioRunId: string, env: Record<string, string | undefined> = process.env): boolean {
  try { return existsSync(studioRunDir(r, studioRunId, env)); } catch { return true; }
}

/** Story 27.2 (AC3): runs started outside the queue, per tick. An `external` queue run's job has its studio
 * runs listed (`status --job-id`, no `--run-id`): one whose studio run is listed terminal ends in that state;
 * one the list positively no longer carries — and whose record directory is gone from the store
 * (`<studioHome>/projects/<key>/runs/<id>/`: a run whose `run.json` the studio cannot read is dropped from the
 * list, not reported) — has vanished and ends `partial` naming it (`endExternal`). A
 * refusal (`ok:false` — the job definition's current problems, say) or a failed lookup (the verb could not
 * run) changes nothing: the next tick asks again, and the pacer keeps counting it live. Every such end
 * releases an outstanding pin on its sandbox when it was the last holder (`releasePin`, `sandbox` the seams).
 * Then every served job (a job row in the queue) with no live queue run on its checkout has its studio runs
 * listed (`status --job-id`, the contract): the earliest non-terminal one no queue run names is recorded
 * `external` with its studio run id and the job's placement (`jobPlacement`: tier and sandbox), live for the
 * pacer until it ends. Never throws. */
export async function detectExternal(
  queue: Queue, verbRunner: VerbRunner = runJobVerb, placement: (jobId: string, root: string) => { tier?: string; sandbox?: string } = jobPlacement,
  sandbox: SandboxDeps = {},
): Promise<{ recorded: string[]; ended: string[] }> {
  const out = { recorded: [] as string[], ended: [] as string[] };
  try {
    for (const r of queue.externalRuns()) {
      try {
        let st: Record<string, any>;
        try { st = await verbRunner(r.root, ["status", "--directory", r.root, "--job-id", r.job_id]); }
        catch { continue; } // the verb could not run: the next tick asks again
        // A refusal (the job definition has problems, …) or an answer with no `runs` list is no proof the
        // run is gone: unchanged.
        if (st?.ok === false || !Array.isArray(st?.runs)) continue;
        const sid = r.studio_run_id ?? "?";
        const listed = (st.runs as Record<string, any>[]).find((x) => x?.run_id === r.studio_run_id);
        // Not listed is no proof it is gone while its record directory is still in the store: the studio's
        // list drops a run whose `run.json` it cannot read (an error entry with no job id). Unchanged then.
        if (!listed && r.studio_run_id && studioRunRecorded(r, r.studio_run_id, sandbox.env)) continue;
        if (!listed) queue.endExternal(r.run_id, "partial", `status no longer lists studio run ${sid}`);
        else if (isTerminal(listed.state)) queue.endExternal(r.run_id, listed.state);
        else continue;
        out.ended.push(r.run_id);
        await releasePin(queue, r.run_id, sandbox); // Story 27.2: the last holder's end stops an outstanding pin
      } catch { /* the queue is busy: the next tick asks again */ }
    }
    const named = new Set(queue.runs().map((r) => r.studio_run_id).filter((id): id is string => !!id));
    for (const j of queue.jobs()) {
      if (queue.runs().some((r) => r.job_id === j.job_id && r.checkout === j.checkout && !isTerminal(r.state))) continue;
      try {
        const st = answered(await verbRunner(j.root, ["status", "--directory", j.root, "--job-id", j.job_id]), "status");
        const open = ((st.runs ?? []) as Record<string, any>[])
          .filter((x) => typeof x?.run_id === "string" && x.run_id && typeof x.state === "string" && !isTerminal(x.state) && !named.has(x.run_id))
          .sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0));
        const first = open[0];
        if (!first) continue;
        const rec = queue.recordExternal(j.job_id, j.root, first.run_id, first.state, placement(j.job_id, j.root));
        if (rec) { out.recorded.push(rec.run_id); named.add(first.run_id); }
      } catch { /* the next tick asks again */ }
    }
  } catch { /* the queue is busy: the next tick */ }
  return out;
}

/** `recover`: the restart rule over the whole queue; every resumable run is resumed. Story 27.2: first the
 * engine holds a restart dropped are respawned; last the external runs are detected and the served
 * projects' starter locks rewritten (the tick runs this once per tick). */
export async function recoverQueue(opts: RunOptions = {}, verbRunner: VerbRunner = runJobVerb): Promise<RecoveryReport> {
  requireStudio();
  requireNotifier(opts.hygiene?.env);
  const { queue, owned } = openQueue(opts);
  try {
    await respawnHolds(queue, sbxDeps(opts.worktree));
    await recoverEngineMcps(queue); // Story 34.5: an engine MCP a restart lost is stopped by its pid, never re-armed
    const { report, prepared } = await recoverWithResume(queue, opts.owner ?? selfOwner(), verbRunner);
    await driveResumes(queue, report.resumed, prepared, verbRunner, invokeSkill, sbxDeps(opts.worktree));
    await endCancelledLeftovers(queue, verbRunner); // Story 27.5 (DW-13): a cancelled run's studio run left open
    return report;
  } finally {
    await sweepEngines(queue, opts.worktree); // Story 27.1: engines that ended or paused are closed out
    await closeOutPaused(queue, pausedDeps(opts)); // Story 27.3: a paused run whose story landed is closed out
    await resolveQuietly(queue, opts); // Story 31.7: queue validate-resolution from resolved items; re-arm on a pass
    chatSpendQuietly(queue, opts); // Story 32.2: the chat runs' costs into each engagement's spend.planning_usd
    runSpendQuietly(queue, opts); // Story 32.6: the engagement runs' costs into each engagement's spend.runs_usd
    await questionsQuietly(queue, opts); // Story 32.3: the planner's questions applied, blocked, answered and closed
    await scopeQuietly(queue, opts); // Story 32.4: a revise body becomes the scope and its Confluence page
    await approveQuietly(queue, opts); // Story 32.6: the approve pass, then launched, autonomy and the cap
    await afterCloseOuts(queue, opts); // Story 27.5: the orphan close-out, then the plan's review and merge passes
    await detectExternal(queue, verbRunner, jobPlacement, sbxDeps(opts.worktree)); // Story 27.2: runs started outside the queue
    writeStarterLocks(queue, opts.worktree?.env ?? process.env);
    await rebuildQuietly(queue, opts.agents); // Story 29.2: the agent registry, every recover (every tick)
    await sweepEnds(queue, opts.hygiene);
    if (owned) queue.close();
  }
}

/** Story 27.5 (DW-25, DW-29): the orphan close-out. A worktree run `recover` ended orphaned (no close-out ran) is
 * closed out once nothing around it is live (`closeOutBlocker`: its driver, its recorded worker, an engine in its
 * worktree — and, for a run whose latest move is `engine-resume`, the resumed engine's pid): taken with
 * `takeEndedCloseOut`, closed out through `closeOut` with no host verify leg (the 27.4 leg never runs on an orphan),
 * recorded `closed_out`, its engine lock released once the worktree is removed, then its sbx pin (`releasePin`).
 * The launch it carries is read as a `launched` event after its latest `close-out`/`engine-resume` (as `recover`
 * reads it): an older one names an engine since archived. Answers the runs closed out. Never throws. */
export async function closeOutOrphans(queue: Queue, deps: WorktreeDeps = {}): Promise<string[]> {
  const done: string[] = [];
  let runs: QueueRun[];
  try { runs = queue.orphanedCloseOuts(); } catch { return done; }
  for (const r of runs) {
    let taken = false;
    try {
      if (await queue.closeOutBlocker(r)) continue;
      if (await queue.resumedEngineAlive(r)) continue;
      if (!queue.takeEndedCloseOut(r.run_id)) continue;
      taken = true;
      const events = queue.events(r.run_id);
      const moved = events.some((e) => e.kind === "close-out" || e.kind === "engine-resume");
      const launch = moved && !launchedSinceMove(events) ? events.filter((e) => e.kind !== "launched") : events;
      const existingPr = priorPr(events);
      const c = await closeOut(r, { paused: false, ...launchedCloseOutInput(launch, r), ...(existingPr ? { existingPr } : {}) }, deps);
      queue.note(r.run_id, "closed_out", { ...closeOutDetail(c), orphaned: true });
      if (c.worktree === "removed") queue.releaseEngineLock(r.run_id, "its worktree was closed out and removed (its engine confirmed dead)");
      await releasePin(queue, r.run_id, sbxDeps(deps));
      done.push(r.run_id);
    } catch {
      if (taken) { try { queue.releaseCloseOut(r.run_id); } catch { /* re-taken once its owner is dead */ } }
    }
  }
  return done;
}

/** Story 27.5: the passes after the paused-run pass at every `finally` site (`recover`, `drain`, `run`): the orphan
 * close-out (`closeOutOrphans`), then the plan's review and merge passes (src/planstatus.ts). Never throws. */
async function afterCloseOuts(queue: Queue, opts: RunOptions & { plan?: PlanStatusDeps }): Promise<void> {
  try { await closeOutOrphans(queue, opts.worktree); } catch { /* the next tick */ }
  const plan: PlanStatusDeps = { ...(opts.worktree ?? {}), ...(opts.plan ?? {}) };
  try { await reviewPass(queue, plan); } catch { /* the next tick */ }
  try { await mergePass(queue, plan); } catch { /* the next tick */ }
}

/** Story 31.7: the resolution pass (src/resolution.ts) right after the paused-run pass at every `finally` site
 * (`recover`, `drain`, `run`): production deps are `registry.py show`, `validate`'s resolve, `resolveCheckout` and
 * `resumeRun`; under `bun test` it runs only with injected deps (as `rebuildQuietly`). Never throws. */
async function resolveQuietly(queue: Queue, opts: RunOptions): Promise<void> {
  if (opts.resolution === false || (opts.resolution === undefined && underBunTest())) return;
  const deps: ResolutionDeps = {
    registry: () => registryShow(),
    resolveJob: async (root) => {
      const v = await validate(VALIDATE_RESOLUTION_JOB, root, undefined, opts.guardCapS);
      return { projectId: v.projectId, root: v.root, definition: v.defn, target: v.target };
    },
    checkout: resolveCheckout,
    resume: (q, runId) => resumeRun(q, runId, undefined, { ...(opts.worktree ?? {}), ...(opts.owner ? { self: opts.owner } : {}) }),
    ...(opts.resolution ?? {}),
  };
  try { await resolutionPass(queue, deps); } catch { /* the next tick */ }
}

/** Story 32.2: the chat-spend pass (src/chat.ts) right after the resolution pass at every `finally` site (`recover`,
 * `drain`, `run`): production reads the host ledger (`ledgerPath`); under `bun test` it runs only with injected deps
 * (as `resolveQuietly`). Never throws. */
function chatSpendQuietly(queue: Queue, opts: RunOptions): void {
  if (opts.chatSpend === false || (opts.chatSpend === undefined && underBunTest())) return;
  try { chatSpendPass(queue, { ledgerFile: ledgerPath(opts.hygiene?.env ?? process.env), ...(opts.chatSpend ?? {}) }); } catch { /* the next tick */ }
}

/** Story 32.3: the engagement questions pass (src/questions.ts) right after the chat-spend pass at every `finally`
 * site (`recover`, `drain`, `run`): production runs `track.py` through the worktree deps' `uv` (default `runUv`);
 * under `bun test` it runs only with injected deps (as `chatSpendQuietly`). Never throws. */
async function questionsQuietly(queue: Queue, opts: RunOptions): Promise<void> {
  if (opts.questions === false || (opts.questions === undefined && underBunTest())) return;
  try { await questionsPass(queue, { ...(opts.worktree ?? {}), ...(opts.questions ?? {}) }); } catch { /* the next tick */ }
}

/** Story 32.4: the engagement scope pass (src/scope.ts) right after the questions pass at every `finally` site
 * (`recover`, `drain`, `run`): production runs `engage.py scope --revise-at` through the worktree deps' `uv` (default
 * `runUv`); under `bun test` it runs only with injected deps (as `questionsQuietly`). Never throws. */
async function scopeQuietly(queue: Queue, opts: RunOptions): Promise<void> {
  if (opts.scope === false || (opts.scope === undefined && underBunTest())) return;
  try { await scopePass(queue, { ...(opts.worktree ?? {}), ...(opts.scope ?? {}) }); } catch { /* the next tick */ }
}

/** Story 32.6: the engagement run-spend pass (src/approve.ts) beside the chat-spend pass at every `finally` site
 * (`recover`, `drain`, `run`): the same host ledger (`ledgerPath`); under `bun test` it runs only with injected deps
 * (as `chatSpendQuietly`). Never throws. */
function runSpendQuietly(queue: Queue, opts: RunOptions): void {
  if (opts.runSpend === false || (opts.runSpend === undefined && underBunTest())) return;
  try { engagementRunSpendPass(queue, { ledgerFile: ledgerPath(opts.hygiene?.env ?? process.env), ...(opts.runSpend ?? {}) }); } catch { /* the next tick */ }
}

/** Story 32.6: the project's default worker placement for an engagement's `run-epic-N` (Settled shape 5), read from
 * `TK_SUPERVISOR_CONFIG` (never written): the job's own `<project>/<job>` entry is `submitJob`'s usual resolution
 * (`source: "config"`, nothing passed); else the placement of the project's highest-numbered `run-epic-*` entry
 * (`source` that job id); else the host tier (`source: "host"`). */
export function engagementPlacement(jobId: string, root: string): { tier?: Tier; sandbox?: string; source: string } {
  let jobs: Record<string, JobOptions> = {};
  let project: string;
  try { jobs = loadSupervisorConfig().jobs; project = projectIdOf(root); } catch { return { tier: "host", source: "host" }; }
  if (jobs[`${project}/${jobId}`]) return { source: "config" };
  let best: { n: number; job: string; o: JobOptions } | null = null;
  const prefix = `${project}/run-epic-`;
  for (const [key, o] of Object.entries(jobs)) {
    const m = key.startsWith(prefix) ? /^(\d+)$/.exec(key.slice(prefix.length)) : null;
    if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), job: key.slice(project.length + 1), o };
  }
  if (!best) return { tier: "host", source: "host" };
  const tier = best.o.tier ?? "host";
  return { tier, ...(tier === "sbx" && best.o.sandbox ? { sandbox: best.o.sandbox } : {}), source: best.job };
}

/** Story 32.6: the approve module's production submitter — `submitJob` with the run's `payload {engagement, project}`
 * and its `base_ref`, placed by `engagementPlacement` (the placement named in the answer). Never `stack`. */
export function engagementSubmitter(opts: RunOptions = {}): Submitter {
  return async (jobId, root, o) => {
    const placement = engagementPlacement(jobId, root);
    const out = await submitJob(jobId, root, {
      ...opts, ...(o.baseRef ? { baseRef: o.baseRef } : {}), payload: o.payload,
      ...(placement.tier ? { tier: placement.tier } : {}), ...(placement.sandbox ? { sandbox: placement.sandbox } : {}),
    });
    return { run_id: String(out.run_id), placement };
  };
}

/** Story 32.6: the approve module's production deps — the worktree deps, the submitter on this queue, the graceful
 * stop (`launchStopGraceful`) and the queued-run cancel (`cancelRun`). */
function approveDeps(queue: Queue, opts: RunOptions = {}): ApproveDeps {
  return {
    ...(opts.worktree ?? {}),
    submit: engagementSubmitter({ ...opts, queue }),
    launchStop: launchStopGraceful,
    cancelQueued: (runId) => cancelRun(queue, runId, { ...(opts.worktree ? { worktree: opts.worktree } : {}), ...(opts.hygiene ? { hygiene: opts.hygiene } : {}), agents: opts.agents }),
    ...(opts.approve ? opts.approve : {}),
  };
}

/** Story 32.6: the approve pass, then the engagement-run pass (src/approve.ts), after the scope pass at every
 * `finally` site (`recover`, `drain`, `run`); Story 32.8: then the closeout pass (src/delivery.ts: the engagement's
 * last run ended → the report, `run-ended`, the issue Done, one notifier line), with the host ledger for the runs'
 * costs; under `bun test` they run only with injected deps (as `scopeQuietly`). Never throws. */
async function approveQuietly(queue: Queue, opts: RunOptions): Promise<void> {
  if (opts.approve === false || (opts.approve === undefined && underBunTest())) return;
  const deps = approveDeps(queue, opts);
  try { await approvePass(queue, deps); } catch { /* the next tick */ }
  try { await engagementRunPass(queue, deps); } catch { /* the next tick */ }
  try { await closeoutPass(queue, { ledgerFile: ledgerPath(opts.hygiene?.env ?? process.env), ...deps }); } catch { /* the next tick */ }
}

/** Story 32.3: the input route's production `afterEngagementInput` — the questions pass for the one engagement an
 * applied `answer`/`go` moved (so a chat-card answer closes its issue without waiting for a run to end), then (Story
 * 32.4) the scope pass for it (an applied `revise` with a body becomes the scope and its page), then (Story 32.6) the
 * approve pass (an applied `approve` writes, publishes and queues the plan) and the engagement-run pass (a `go {cap}`
 * from `partial` resubmits); skipped under `bun test` unless deps are injected. Never throws. */
export async function afterEngagementInput(queue: Queue, root: string, id: string, deps?: Partial<QuestionsDeps & ScopeDeps & ApproveDeps>): Promise<void> {
  if (deps === undefined && underBunTest()) return;
  try { await questionsPass(queue, deps ?? {}, { root, engagement: id }); } catch { /* the next run end */ }
  try { await scopePass(queue, deps ?? {}, { root, engagement: id }); } catch { /* the next run end */ }
  const approve = { ...approveDeps(queue), ...(deps ?? {}) };
  try { await approvePass(queue, approve, { root, engagement: id }); } catch { /* the next run end */ }
  try { await engagementRunPass(queue, approve, { root, engagement: id }); } catch { /* the next run end */ }
}

/** Story 32.2: the chat route's production deps — the `engagement-chat` definition for a served root as `validate`
 * resolves it (the shipped type, undeclared, through `jobrun.py resolve`), and `resolveCheckout`. */
export function chatDeps(guardCapS?: number): ChatDeps {
  return {
    resolveJob: async (root) => {
      const v = await validate(ENGAGEMENT_CHAT_JOB, root, undefined, guardCapS);
      return { projectId: v.projectId, root: v.root, definition: v.defn, target: v.target };
    },
    checkout: resolveCheckout,
  };
}

/** Story 27.5 (DW-13): every `cancelled` run whose recorded studio run no record shows ended
 * (`Queue.cancelledLeftovers`: a driver's late `setStudioRun` the cancel's end missed, a cancel that died after its
 * end, a failed ender) has it ended by the same ender (`studioRunEnder`: core `cancel`, skill `finish`), recorded
 * `studio-run-ended {studio_run_id, late: true, by: "recover", detail, state}` once the ender answers ok (a studio run
 * already terminal included: its state) — the run is then never listed again. A failed ender records
 * `studio-run-end-failed {studio_run_id, by, detail, attempt}` (`attempt`: the failures so far for that studio run,
 * this one included) and the next recovery tries again; the attempt reaching `STUDIO_END_RETRY_LIMIT` also records
 * `gave_up: true`, and the run is never listed again. Never throws. */
export async function endCancelledLeftovers(queue: Queue, verbRunner: VerbRunner = runJobVerb): Promise<string[]> {
  const out: string[] = [];
  let runs: QueueRun[];
  try { runs = queue.cancelledLeftovers(); } catch { return out; }
  for (const r of runs) {
    try {
      const res = await studioRunEnder(verbRunner)(r, CANCELLED_REASON);
      if (!res.ok) {
        // Retried by the next recovery, bounded (the operator reads each attempt on the run's events).
        const attempt = queue.events(r.run_id).filter((e) => e.kind === "studio-run-end-failed" && e.detail?.studio_run_id === r.studio_run_id).length + 1;
        queue.note(r.run_id, "studio-run-end-failed", {
          studio_run_id: r.studio_run_id, by: "recover", detail: res.detail, attempt, ...(attempt >= STUDIO_END_RETRY_LIMIT ? { gave_up: true } : {}),
        });
        continue;
      }
      queue.note(r.run_id, "studio-run-ended", { studio_run_id: r.studio_run_id, late: true, by: "recover", detail: res.detail, ...(res.state ? { state: res.state } : {}) });
      out.push(r.run_id);
    } catch { /* the next recovery */ }
  }
  return out;
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
  requireNotifier(opts.hygiene?.env);
  const { queue, owned } = openQueue(opts);
  const owner = opts.owner ?? selfOwner();
  try {
    // Story 33.3: one pass, one restart per sandbox — shared by the pass's resumes and every run it gates.
    const restarted = new Set<string>();
    const { report: recovered, prepared } = await recoverWithResume(queue, owner, verbRunner);
    await driveResumes(queue, recovered.resumed, prepared, verbRunner, invokeSkill, sbxDeps(opts.worktree), restarted);
    const runs: DrainReport["runs"] = [];
    for (const r of queue.drainable(owner)) {
      try {
        // `undefined` mode: runJob drives the run under the mode recorded on it (else the default).
        const summary = await runJob(r.job_id, r.root, undefined, { ...opts, queue, owner, skipRecover: true, runId: r.run_id, restarted });
        // Report the run's actual queue state when the summary does not (Story 33.2: a refused claim — no Max
        // login, a failed pin, a refused placement — answers `queued` with its `claim_refused`).
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
          // Story 27.2: a queued run on a sandbox may be the last holder of a pin another run left kept.
          await releasePin(queue, r.run_id, sbxDeps(opts.worktree));
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
  } finally {
    await sweepEngines(queue, opts.worktree); // Story 27.1
    await closeOutPaused(queue, pausedDeps(opts)); // Story 27.3
    await resolveQuietly(queue, opts); // Story 31.7
    chatSpendQuietly(queue, opts); // Story 32.2
    runSpendQuietly(queue, opts); // Story 32.6
    await questionsQuietly(queue, opts); // Story 32.3
    await scopeQuietly(queue, opts); // Story 32.4
    await approveQuietly(queue, opts); // Story 32.6
    await afterCloseOuts(queue, opts); // Story 27.5
    await rebuildQuietly(queue, opts.agents); // Story 29.2: the agent registry after the drain's claims and ends
    await sweepEnds(queue, opts.hygiene);
    if (owned) queue.close();
  }
}

/** `submit`: validate, then enqueue (idempotent). Nothing is driven. */
export async function submitJob(
  jobId: string, directory: string,
  opts: RunOptions & { permissionMode?: string; /** Story 32.6: the run's own payload (`runPayload`), stored on its `enqueued` event. */ payload?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
  try { resolveStudioRoot(); requireCompatible(); }
  catch (e) { throw new StartError(message(e)); }
  const { queue, owned } = openQueue(opts);
  try {
    let v: Validated, options: WorkerOptions;
    try {
      // Story 22.3: a flagged run needs the work folder its snapshot lands in — refused, nothing queued.
      if (opts.editorInTheLoop && !workDir(opts.hygiene?.env)) throw refusal(new WorkDirMissing().message);
      const root = resolve(directory);
      if (!existsSync(root)) throw refusal(`directory does not exist: ${directory}`);
      // Worker options resolved before any process (a host bypass is refused, nothing queued).
      ({ options } = resolveBeforeStart(jobId, root, explicitLayer(opts.permissionMode, opts), liveRun(queue, jobId, root)));
      v = await validate(jobId, directory, undefined, opts.guardCapS);
      // Story 34.5: a run its job definition flags needs the work folder too (the same refusal, nothing queued).
      if (v.defn?.editor_in_the_loop === true && !workDir(opts.hygiene?.env)) throw refusal(new WorkDirMissing().message);
    }
    catch (e) { throw e instanceof StartError ? e : new StartError(message(e)); }
    const where = await resolveCheckout(v.root);
    const { run, minted } = queue.enqueue({
      jobId, root: v.root, projectId: v.projectId, target: v.target, definition: v.defn, ...where,
      permissionMode: opts.permissionMode, tier: options.tier, sandbox: options.sandbox, model: options.model, effort: options.effort,
      // Story 34.5: the queued run's flag is the submission's OR its job definition's.
      base_ref: opts.baseRef, ...(opts.editorInTheLoop || v.defn?.editor_in_the_loop === true ? { editorInTheLoop: true } : {}), ...(opts.payload ? { payload: opts.payload } : {}),
    });
    return { ok: true, job_id: jobId, project_id: v.projectId, run_id: run.run_id, state: run.state, minted };
  } finally { if (owned) queue.close(); }
}

/** `submit` by project id (the HTTP API, Story 22.1): the registry's `show` resolves the
 * project's root, then the one submit path (`submitJob`) validates and enqueues. An unknown
 * project is `show`'s own refusal (StartError, refused); nothing is queued. */
export async function submitProject(projectId: string, jobId: string, opts: RunOptions & { permissionMode?: string } = {}): Promise<Record<string, unknown>> {
  requireStudio();
  let root: string;
  try {
    const shown = await registryShow(projectId);
    root = shown.entry?.root;
    if (typeof root !== "string" || !root.trim()) throw refusal(`registry: project '${projectId}' has no usable root`);
  } catch (e) {
    if (e instanceof StartError) throw e;
    const msg = message(e);
    throw msg.startsWith("registry: ") ? refusal(msg) : new StartError(msg);
  }
  return submitJob(jobId, root, opts);
}

/** Stops a launched bmad-loop engine gracefully (tk-studio-launch `stop --graceful`). A failure is returned, never thrown. */
export type LaunchStopper = (root: string, engineRunId: string) => Promise<{ ok: boolean; detail: string }>;

/** tk-studio `lib/launch.py stop --directory <root> --run-id <id> --graceful` (driver contract §tk-studio-launch). */
export const launchStopGraceful: LaunchStopper = async (root, engineRunId) => {
  try {
    const res = await runUv(root, join(pluginRoot(), "lib", "launch.py"), ["stop", "--directory", root, "--run-id", engineRunId, "--graceful"]);
    const out = lastJsonObject(res.stdout) as Record<string, any> | null;
    if (!out) return { ok: false, detail: `launch stop emitted no JSON (exit ${res.exit}): ${res.stderr.trim().slice(0, 300)}` };
    if (out.ok !== true) return { ok: false, detail: `launch stop refused: ${String(out.error ?? "refused").slice(0, 300)}` };
    return { ok: true, detail: `engine ${engineRunId} stopping gracefully` };
  } catch (e) {
    return { ok: false, detail: `launch stop failed: ${message(e)}` };
  }
};

/** The reason a cancelled queue run ends with. */
export const CANCELLED_REASON = "cancelled: operator request";

/** Cancel a queue run (Story 22.1): a launched engine is stopped gracefully (launch
 * `stop --graceful`; the launch core probed again once the worker is dead), the studio run
 * named after those awaits ended (`studioRunEnder`: core → `cancel`, skill →
 * `finish`), then the recorded worker rule (`Queue.recordedWorker`, killing a host worker;
 * on sbx the in-VM deadline) decides the lock: a worker that may still run keeps it
 * (`holdLock`), an engine takes it over, else it is released — never a bare release. The
 * queue run ends `cancelled` through `Queue.end` with its `ended` event. A `running` run whose
 * dead driver started its minting verb but recorded no studio run has it looked up (the
 * restart rule's finder, `studioRunFinder`) and ended too — `recover` skips terminal runs.
 * A worker the driver recorded after the cancel read the run is killed once the run has
 * ended (the recorded-worker rule), named in a `worker-kill` event. Throws
 * `RunTerminal` on a run already ended (`CancelRaced`, carrying the side effects already
 * done, when it ended during the cancel), `ExternalRunRefused` on an `external` run (Story 27.2:
 * started outside the queue, left live), and an Error on an unknown run. */
export async function cancelRun(
  queue: Queue, runId: string,
  deps: {
    verbRunner?: VerbRunner; launchStop?: LaunchStopper; hygiene?: HygieneDeps; worktree?: WorktreeDeps; agents?: AgentsOption;
    /** Story 29.2: when given, the cancel's agent-registry rebuild is started and handed here, not awaited (the HTTP
     * route: the answer never waits on it). Unset: the rebuild is awaited before the end sweep. */
    detachRebuild?: (rebuild: Promise<RebuildResult | null>) => void;
  } = {},
): Promise<QueueRun> {
  // Story 22.3: once the cancel is done, the end sweep covers this run only (its cancelled end, or a
  // raced driver's end of it), so the answer never waits on other runs' ends: those stay with their
  // driver, `recover` and `drain`. An unknown run id sweeps nothing.
  try { return await cancelQueueRun(queue, runId, deps); }
  finally {
    // Story 29.2: the cancel's end rebuilds the agent registry (`rebuildQuietly` never rejects, so a detached
    // rebuild is never an unhandled rejection).
    const rebuild = rebuildQuietly(queue, deps.agents);
    if (deps.detachRebuild) deps.detachRebuild(rebuild);
    else await rebuild;
    await sweepEnds(queue, deps.hygiene, [runId]);
  }
}

async function cancelQueueRun(
  queue: Queue, runId: string, deps: { verbRunner?: VerbRunner; launchStop?: LaunchStopper; worktree?: WorktreeDeps },
): Promise<QueueRun> {
  const run = queue.get(runId);
  if (!run) throw new Error(`queue run '${runId}' not found`);
  if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
  // Story 27.2: an `external` run was started outside the queue — nothing here may stop it, so the queue run
  // is never ended under the studio run it mirrors (it stays live for the pacer until that run ends).
  if (run.state === "external") throw new ExternalRunRefused(runId, run.studio_run_id);
  const detail: Record<string, unknown> = { cancelled_by: "api" };
  // A launched engine: the one recorded, else (a launch run that reached its verb) the launch core's probe.
  const probeEngine = async (r: QueueRun) => {
    if (!r.verb_started || queue.definition(r)?.target?.skill !== LAUNCH_SKILL) return undefined;
    const probed = await queue.launchEngineAt(engineRoot(r), { tier: r.tier, sandbox: r.sandbox });
    if (probed.holder) detail.engine = probed.engine;
    return probed.holder;
  };
  const stopEngine = async (root: string, id: string | null) => {
    detail.engine_stop = id
      ? { engine_run_id: id, ...await (deps.launchStop ?? launchStopGraceful)(root, id) }
      : { engine_run_id: null, ok: false, detail: "an unverified engine: no run id to stop" };
  };
  // Story 27.2 (AC2): an sbx engine still live after the stop is killed by its recorded in-VM pid
  // (`sbx exec … kill -- -<pid>`, argv only), the kill and its outcome recorded (`engine-kill`).
  const killByPid = async (r: QueueRun) => {
    if (r.tier !== "sbx" || detail.engine_kill) return;
    const k = await killRunEngine(queue, r.run_id, "cancel", sbxDeps(deps.worktree));
    if (k) detail.engine_kill = k;
  };
  let engine: { id: string | null } | undefined = run.engine_run_id ? { id: run.engine_run_id } : await probeEngine(run);
  if (engine) { await stopEngine(engineRoot(run), engine.id); await killByPid(run); }
  // The studio run named after the awaits above: a driver inside its minting verb may have recorded it meanwhile.
  const named = queue.get(runId) ?? run;
  const verbs = deps.verbRunner ?? runJobVerb;
  // Story 27.5 (DW-13): the studio run this cancel ended — `Queue.endReread` compares it inside the end transaction.
  let acted: string | null = named.studio_run_id;
  if (named.studio_run_id) detail.studio = await studioRunEnder(verbs)(named, CANCELLED_REASON);
  else if (named.state === "running" && named.verb_started && !queue.ownerAlive(named)) {
    // Its driver died inside the minting verb: once cancelled, `recover` never looks the
    // studio run up — looked up here by the restart rule's finder, and ended when found.
    let snapshot: string[] = [];
    try { snapshot = JSON.parse(named.verb_snapshot ?? "[]"); } catch { /* an empty snapshot: the lookup still decides */ }
    let found: Awaited<ReturnType<StudioFinder>>;
    try { found = await studioRunFinder(verbs)(named, snapshot); }
    catch (e) { found = { ok: false, detail: message(e) }; }
    if (!found.ok) detail.lookup = { ok: false, detail: found.detail };
    else if (found.run_id) {
      detail.lookup = { ok: true, adopted: found.run_id };
      try { queue.setStudioRun(runId, found.run_id); } catch { /* ended meanwhile: `Queue.end` below refuses */ }
      acted = found.run_id;
      detail.studio = await studioRunEnder(verbs)({ ...named, studio_run_id: found.run_id }, CANCELLED_REASON);
    } else detail.lookup = { ok: true, adopted: null };
  }
  const current = queue.get(runId) ?? named;
  // The engine kill above is ruled on by `engineHeld` below (never reported as the recorded worker).
  const worker = await queue.recordedWorker(current, true, { engine: false });
  if (worker.worker) detail.worker = worker.worker;
  // An engine the launch core started after the first probe, found once the worker is dead: stopped too, and handed the lock.
  if (!engine) {
    engine = await probeEngine(current);
    if (engine) { await stopEngine(engineRoot(current), engine.id); await killByPid(current); }
  }
  // A kill that left the engine pid alive after its wait, or could not read its first probe (`start time
  // unreadable`, nothing signalled): the run and its lock are held (DW-3) until a later probe shows it gone.
  const engineKill = detail.engine_kill as WorkerKill | undefined;
  const engineHeld = !!engineKill && workerMayRun(engineKill);
  // A `running` run whose live owner (its driver) has recorded no worker yet — a queued run
  // claimed during the awaits above included: the lock stays with it (never a bare release
  // under a live driver); the driver's own end (`endDriven`), or `claim`/`recover` once the
  // driver is dead, frees it.
  const driverLive = !engine && current.state === "running" && current.worker_pid == null && queue.ownerAlive(current);
  const holdLock = worker.mayRun ? `cancelled: its recorded worker may still run (${worker.worker?.outcome ?? "unknown"})`
    : engineHeld ? `cancelled: its engine may still run in the VM (${engineKill!.outcome})`
    : driverLive ? `cancelled: its driver (pid ${current.owner_pid ?? "?"}${current.owner_host ? `@${current.owner_host}` : ""}) is live, no worker recorded yet` : undefined;
  // Story 27.1: a run with a worktree is closed out before its `cancelled` end, after the engine stop —
  // only once nothing may still work the worktree (else skipped: the engine-end sweep closes it out
  // later), and only by the process that takes the run (never beside the sweep).
  let engineDead = false, closedOut = false;
  if (current.worktree) {
    let skip: string | undefined;
    if (worker.mayRun) skip = `its recorded worker may still run (${worker.worker?.outcome ?? "unknown"})`;
    else if (driverLive) skip = "its driver is live";
    else if (engineHeld) skip = `its engine may still run in the VM (${engineKill!.outcome})`;
    else if (engine) {
      const stop = detail.engine_stop as { ok?: boolean } | undefined;
      if (stop?.ok !== true) skip = "the engine stop failed";
      else if ((await queue.launchEngineAt(engineRoot(current), { tier: current.tier, sandbox: current.sandbox })).holder) skip = "the engine stop is not confirmed: the engine is still live";
    }
    if (!skip && !queue.takeForCloseOut(runId)) {
      // Refused on a running or paused run: another process holds its close-out. Any other state (a
      // `queued` run `recover` requeued after its cut): nothing holds it, and the sweep closes it out.
      const state = queue.get(runId)?.state ?? current.state;
      skip = state === "running" || state === "paused" ? "the run is held by another close-out"
        : `the run is ${state}: the engine-end sweep closes it out`;
    }
    // AC3: the PR body carries the launch status block and the metered cost (read before the removal).
    const input = { ...launchedCloseOutInput(queue.events(runId), current), engineRunId: current.engine_run_id ?? engine?.id ?? null };
    Object.assign(detail, await closeOutNow(queue, runId, input, deps.worktree, skip));
    // Closed out with its engine confirmed dead (stopped, the probe empty): the lock is released, never
    // handed to that engine at a worktree the close-out removed.
    engineDead = !!engine && !skip;
    closedOut = !skip;
  }
  let ended: QueueRun, late: string | undefined, claimed: { pid: number | null; host: string | null } | undefined;
  try {
    // Story 27.5 (DW-12, DW-13): the end re-reads the run inside its transaction — a studio run recorded since the
    // read above is answered (`late`, ended below after the commit), and a claim since keeps the lock for its driver.
    ({ run: ended, late_studio_run_id: late, claimed } = queue.endReread(runId, "cancelled", CANCELLED_REASON, {
      detail, ...(holdLock ? { holdLock } : {}), ...(driverLive ? { driverLive } : {}), ...(engine ? { engineRunId: engine.id } : {}),
      ...(engineDead ? { keepEngine: true } : {}),
    }, { studio_run_id: acted, owner_nonce: current.owner_nonce }));
  } catch (e) {
    // Ended by its driver during the cancel: the side effects already done travel with the refusal.
    if (e instanceof RunTerminal) throw new CancelRaced(runId, queue.get(runId)?.state ?? "terminal", detail);
    throw e;
  }
  if (late) {
    // A driver recorded its studio run between the cancel's read and its end: ended now by the same ender (a failure
    // is left for the next `recover`, `endCancelledLeftovers`).
    const res = await studioRunEnder(verbs)({ ...ended, studio_run_id: late }, CANCELLED_REASON);
    if (res.ok) {
      try { queue.note(runId, "studio-run-ended", { studio_run_id: late, late: true, by: "cancel", detail: res.detail, ...(res.state ? { state: res.state } : {}) }); }
      catch { /* the queue is busy: `recover` reads the studio run again */ }
    }
  }
  // Story 27.2: the run's end with nothing left in its sandbox releases its pin (a skipped close-out: the sweep's late one does).
  // Story 27.5: never when a driver claimed the run inside the window — the lock is its, and its own end releases the pin.
  if (!holdLock && !claimed && (!current.worktree || closedOut)) await releasePin(queue, runId, sbxDeps(deps.worktree));
  // A worker the driver recorded after `current` was read (`onSpawn` → `setWorker` before the
  // end): the recorded-worker rule applies to it now, named in a `worker-kill` event (the
  // API's `effects.worker`). `end` kept the lock (it re-reads the worker in its transaction);
  // `claim`/`recover` free it once `recordedWorker` says it may no longer run.
  if (ended.worker_pid != null && current.worker_pid == null) {
    const late = await queue.recordedWorker(ended, true);
    if (late.worker) queue.noteWorkerKill(runId, late.worker, "recorded by its driver during the cancel");
    return queue.get(runId) ?? ended;
  }
  return ended;
}

/** Story 27.2: a cancel of an `external` queue run is refused — it was started outside the queue (`jobrun.py`
 * by hand, MCP `tk_job`), so the queue cannot stop its studio run; it stays live until that run ends. */
export class ExternalRunRefused extends Error {
  constructor(readonly runId: string, readonly studioRunId: string | null) {
    super(`ExternalRunRefused: queue run '${runId}' is external — studio run ${studioRunId ?? "?"} was started outside the queue, `
      + "so the queue cannot cancel it; stop it where it was started (it stays live until its studio run ends)");
    this.name = "ExternalRunRefused";
  }
}

/** `cancelRun`'s `RunTerminal` when the run ended during the cancel: `effects` names what the
 * cancel had already done (engine stop, studio end, worker kill) before `Queue.end` refused. */
export class CancelRaced extends RunTerminal {
  constructor(runId: string, readonly state: string, readonly effects: Record<string, unknown>) {
    super(runId, state);
  }
}

// ------------------------------------------------------------ Story 33.2: refusals reach the owner

/** A claim `drain` could not make: the reason (recorded as `claim-refused`) and what resolves it. */
export interface ClaimRefused { reason: string; resolves: string }

/** Story 33.2: a refusal with its stable dedup key (the cause class and its subject, never the volatile reason text);
 * the key is stored on the `claim-refused` event only, never on a summary or a 0.1.28 surface. */
interface KeyedRefusal extends ClaimRefused { key: string }

/** What resolves a lock wait (the reason names the holder). */
export const LOCK_RESOLVES = "the checkout lock's holder ends or is cancelled; the next drain pass claims the run";

/** The sandbox Max login's renewal steps (the global `anthropic` sbx secret is renewed from inside the sandbox). */
export const renewalSteps = (sb: string): string => `sbx run --name ${sb} → /login → /exit`;

/** What resolves a refused Max-login preflight on the run's tier. */
export const loginResolves = (options: Pick<WorkerOptions, "tier" | "sandbox">): string =>
  options.tier === "sbx" && options.sandbox
    ? `renew the sandbox's Max login: ${renewalSteps(options.sandbox)}; the next drain pass claims the run`
    : "log the host's claude in to the Max subscription (`claude`, then `/login`); the next drain pass claims the run";

/** What resolves a failed pin. */
export const pinResolves = (sb: string): string =>
  `make \`sbx run -d --name ${sb}\` succeed (\`sbx daemon status\` running, the sandbox listed by \`sbx ls\`); the next drain pass pins it again`;

/** Story 33.2 (ruling D): the placement refusals a drained run waits out `queued` — TierRefused and SbxSandboxMissing —
 * with what resolves each; any other refusal (a broken registry entry, `resolve`, `problems[]`) is null (it still ends
 * the run `blocked`). */
export function placementRefusal(reason: string): (ClaimRefused & { key: string }) | null {
  if (reason.startsWith("TierRefused")) {
    return { key: "placement:TierRefused", reason, resolves: "a tier of host or sbx: the job's TK_SUPERVISOR_CONFIG `tier` (a tier stored on the run changes only by cancelling it and resubmitting with --tier); the next drain pass claims the run" };
  }
  if (reason.startsWith("SbxSandboxMissing")) {
    return { key: "placement:SbxSandboxMissing", reason, resolves: "a sandbox name: the job's TK_SUPERVISOR_CONFIG `sandbox` (or cancel the run and resubmit with --sandbox); the next drain pass claims the run" };
  }
  return null;
}

/** Record a refusal on the run (`recordClaimRefusal`: the event, and the notifier line when its key is new); answers
 * it without the key. */
async function recordedRefusal(queue: Queue, runId: string, r: KeyedRefusal, hygiene?: HygieneDeps): Promise<ClaimRefused> {
  await recordClaimRefusal(queue, runId, r.key, r.reason, r.resolves, hygiene);
  return { reason: r.reason, resolves: r.resolves };
}

/** The summary of a drained run left `queued` by a refused claim. */
function refusedClaim(queue: Queue, runId: string, jobId: string, r: ClaimRefused): RunSummary {
  const now = queue.get(runId);
  return { ok: false, job_id: jobId, run_id: runId, studio_run_id: now?.studio_run_id ?? null, state: now?.state ?? "queued", reason: r.reason, claim_refused: r };
}

/** Story 33.2: the pin before the claim (moved from the drive's `invokeSkill`): `sbx run -d --name <sb>`, recorded
 * `pinned` once while that pin stands (a pass that finds it standing adds none) and `pin-failed` once per failure
 * episode on that sandbox (a pass that fails again updates that event's `error` in place — its clipped stderr may
 * vary per pass). Story 33.3: through `pinWithRestart` (a running, logged-out sandbox restarted once; `ctx` carries
 * the pass's restarted set and the probe's spawner). Null when pinned, else the failure. Never throws. */
export async function pinBeforeClaim(queue: Queue, runId: string, sb: string, deps: SandboxDeps = {}, ctx: PinContext = {}): Promise<string | null> {
  const failed = await pinWithRestart(queue, runId, sb, deps, ctx);
  try {
    const last = queue.events(runId).findLast((e) => e.kind === "pinned" || e.kind === "pin-failed" || e.kind === "pin-released");
    if (failed) {
      if (last?.kind === "pin-failed" && last.detail?.sandbox === sb) {
        if (last.detail?.error !== failed) queue.patchEventDetail(last.seq, { error: failed });
      } else queue.note(runId, "pin-failed", { sandbox: sb, error: failed });
    } else if (!(last?.kind === "pinned" && last.detail?.sandbox === sb && queue.pinOutstanding(sb))) {
      queue.note(runId, "pinned", { sandbox: sb });
    }
  } catch { /* the run ended meanwhile: the pin answer still stands */ }
  return failed;
}

export interface ClaimGateDeps {
  /** The pin's `sbx` seams. */
  sbx?: SandboxDeps;
  /** The Max-login probe's spawner (default `runProcess`). */
  spawner?: Spawner;
  /** The notifier's environment and HTTP client. */
  hygiene?: HygieneDeps;
  /** Story 33.3: the sandboxes the pin restarted in this drain pass (default: a set of this gate's own). */
  restarted?: Set<string>;
}

/** Story 33.2: the drain's gate before it claims queued run `runId` under its resolved `options` — on sbx the pin
 * (`pinBeforeClaim`), then the Max-login preflight. A refusal is recorded on the run (`claim-refused`, one per distinct
 * reason, the notifier line when it is new) and answered; the run stays `queued`. Null: the claim may proceed. */
export async function claimGate(queue: Queue, runId: string, options: WorkerOptions, deps: ClaimGateDeps = {}): Promise<ClaimRefused | null> {
  if (options.tier === "sbx" && options.sandbox) {
    // The pin is found through the run's recorded sandbox (`pinOutstanding`, `releasePin`): a queued run whose stored
    // tier/sandbox differ from the resolved ones (a legacy row; config supplies the sandbox) records them first.
    const stored = queue.get(runId);
    if (stored?.state === "queued" && (stored.tier !== options.tier || stored.sandbox !== options.sandbox)) {
      try { queue.recordRunOptions(runId, { tier: options.tier, sandbox: options.sandbox }); } catch { /* the run moved on meanwhile */ }
    }
    const failed = await pinBeforeClaim(queue, runId, options.sandbox, deps.sbx ?? {}, {
      ...(deps.restarted ? { restarted: deps.restarted } : {}), ...(deps.spawner ? { spawner: deps.spawner } : {}),
    });
    if (failed) return recordedRefusal(queue, runId, { key: `pin-failed:${options.sandbox}`, reason: failed, resolves: pinResolves(options.sandbox) }, deps.hygiene);
  }
  const login = await maxLoginPreflight(deps.spawner, { tier: options.tier, sandbox: options.sandbox });
  if (login) return recordedRefusal(queue, runId, { key: "max-login", reason: login, resolves: loginResolves(options) }, deps.hygiene);
  return null;
}

export async function runJob(jobId: string, directory: string, permissionMode?: string, opts: RunOptions = {}): Promise<RunSummary> {
  requireStudio(); // StudioRootMissing (AD-15), the contract pin
  requireNotifier(opts.hygiene?.env); // Story 22.3: a misconfigured notifier is a named start error
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
      await driveResumes(queue, report.resumed.filter((r) => mine(r.run_id)), prepared, runJobVerb, invokeSkill, sbxDeps(opts.worktree));
      resuming = driveResumes(queue, report.resumed.filter((r) => !mine(r.run_id)), prepared, runJobVerb, invokeSkill, sbxDeps(opts.worktree));
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
      try { ({ options, config } = resolveBeforeStart(jobId, root, explicit, stored)); }
      catch (e) {
        // Story 33.2: a drained run whose placement is refused stays `queued`, its refusal recorded, until it clears.
        const placement = opts.runId ? placementRefusal(message(e)) : null;
        if (placement) return await refusedClaim(queue, opts.runId!, jobId, await recordedRefusal(queue, opts.runId!, placement, opts.hygiene));
        throw e;
      }
      if (opts.runId) {
        // Story 33.2: the drain's gate before the claim — the pin (moved here from the drive), then the preflight.
        const refused = await claimGate(queue, opts.runId, options, {
          sbx: sbxDeps(opts.worktree), ...(opts.hygiene ? { hygiene: opts.hygiene } : {}), ...(opts.restarted ? { restarted: opts.restarted } : {}),
        });
        if (refused) return refusedClaim(queue, opts.runId, jobId, refused);
      } else {
        const login = await maxLoginPreflight(undefined, { tier: options.tier, sandbox: options.sandbox });
        if (login) return { ok: false, job_id: jobId, run_id: null, state: "blocked", reason: login };
      }
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
      // Story 31.7: a queued validate-resolution run carries the payload the resolution pass enqueued; Story 32.2: an
      // engagement-chat run its own (the `enqueued` event's) plus its run id.
      v = { ...v, defn: withStoredPayload(run.job_id, v.defn, queue.definition(run), { run_id: run.run_id, payload: queue.runPayload(run.run_id) }) };
    } else {
      // Story 34.5: a run its job definition flags needs the work folder its snapshot lands in (Story 22.3's refusal).
      if (v.defn?.editor_in_the_loop === true && !workDir(opts.hygiene?.env)) throw refusal(new WorkDirMissing().message);
      const where = await resolveCheckout(v.root);
      const enq = queue.enqueue({
        jobId, root: v.root, projectId: v.projectId, target: v.target, definition: v.defn, owner, permissionMode, ...record, ...where,
        ...(v.defn?.editor_in_the_loop === true ? { editorInTheLoop: true } : {}), // Story 34.5: the definition's flag
      });
      run = enq.run;
      // Story 31.7: an adopted (not minted) queued validate-resolution run keeps the payload the pass enqueued.
      if (!enq.minted) v = { ...v, defn: withStoredPayload(run.job_id, v.defn, queue.definition(run), { run_id: run.run_id, payload: queue.runPayload(run.run_id) }) };
    }
    const claim = await queue.claim(run.run_id, owner);
    // Story 27.2 (AC3): every claim rewrites the checkout's starter lock (the queue is the only starter).
    writeStarterLock({ project_id: v.projectId, root: v.root }, opts.worktree?.env ?? process.env);
    if (claim.claimed) await rebuildQuietly(queue, opts.agents); // Story 29.2: every claim rebuilds the agent registry
    // Story 33.2: the claim went through — the run's open refusals are cleared (`claim-refusal-cleared`).
    if (claim.claimed) { try { queue.clearClaimRefusals(run.run_id); } catch { /* the claim stands */ } }
    if (!claim.claimed && opts.runId && claim.why !== "lock") return skipped(claim.reason);
    // Story 33.2: a drained run waiting on a live lock holder records the wait as its claim refusal, keyed on the
    // holder's run id (its reason's pid, host and detail may change between passes), and answers it as `claim_refused`
    // beside the existing `waited` (additive).
    let lockRefused: ClaimRefused | undefined;
    if (!claim.claimed && opts.runId) {
      lockRefused = await recordedRefusal(queue, run.run_id, { key: `lock:${claim.holder?.run_id ?? "unknown"}`, reason: claim.reason, resolves: LOCK_RESOLVES }, opts.hygiene);
    }
    if (!claim.claimed) {
      return {
        waited: claim.why,
        ok: false, job_id: jobId, project_id: v.projectId, run_id: run.run_id, studio_run_id: claim.run.studio_run_id,
        target: v.target, state: claim.run.state, reason: claim.reason, ...(claim.holder ? { holder: claim.holder } : {}),
        ...(lockRefused ? { claim_refused: lockRefused } : {}),
      };
    }
    let summary: RunSummary;
    try {
      // The effective options: explicit, else recorded on the run, else the config, else the
      // default — re-checked after the claim (an invalid stored value ends the run `blocked`).
      const eff = resolveWorkerOptions(explicit, storedLayer(claim.run), config, v.root);
      // Story 27.1: the run's own worktree, cut from its base and materialised, once per queue run.
      const workRoot = await prepareWorktree(queue, claim.run, v.projectId, v.root, { ...opts.worktree, tier: eff.tier });
      // Story 22.3: a flagged Godot run is snapshot before the minting verb, once per queue run.
      await snapshotOnce(queue, claim.run, v.projectId, v.root, { env: opts.hygiene?.env });
      // Story 33.2: a drained run was pinned before its claim (`claimGate`): the drive pins it no second time.
      const prePinned = opts.runId !== undefined && eff.tier === "sbx";
      // Story 34.5: so a flagged drained run's engine MCP starts here, its worktree now cut (the recorder's pin starts
      // it on the other paths). A refusal ends the run `blocked`, its key and what resolves it in the reason (the run
      // is claimed by now, so no `claim-refused` event: those are recorded on a queued run only).
      if (prePinned) {
        const mcp = await startEngineMcp(queue, run.run_id, { env: opts.worktree?.env ?? process.env, ...opts.engineMcp });
        if ("refused" in mcp) throw new StartError(engineMcpRefusalText(mcp.refused));
      }
      summary = await drive(queue, run.run_id, { ...v, ...eff, workRoot }, opts.worktree, prePinned);
    }
    catch (e) {
      const err = e instanceof StartError ? e : new StartError(message(e));
      await endAfterDriveFailure(queue, run.run_id, err.message, opts.worktree, owner);
      err.runId = run.run_id;
      throw err;
    }
    return await mirror(queue, run.run_id, v, summary, runJobVerb, opts.worktree);
  } finally {
    await resuming;
    await sweepEngines(queue, opts.worktree); // Story 27.1: engines that ended or paused are closed out
    await closeOutPaused(queue, pausedDeps(opts)); // Story 27.3: a paused run whose story landed is closed out
    await resolveQuietly(queue, opts); // Story 31.7: queue validate-resolution from resolved items; re-arm on a pass
    chatSpendQuietly(queue, opts); // Story 32.2: the chat runs' costs into each engagement's spend.planning_usd
    runSpendQuietly(queue, opts); // Story 32.6: the engagement runs' costs into each engagement's spend.runs_usd
    await questionsQuietly(queue, opts); // Story 32.3: the planner's questions applied, blocked, answered and closed
    await scopeQuietly(queue, opts); // Story 32.4: a revise body becomes the scope and its Confluence page
    await approveQuietly(queue, opts); // Story 32.6: the approve pass, then launched, autonomy and the cap
    await afterCloseOuts(queue, opts); // Story 27.5: the orphan close-out, then the plan's review and merge passes
    await rebuildQuietly(queue, opts.agents); // Story 29.2: every end this process drove rebuilds the agent registry
    await sweepEnds(queue, opts.hygiene); // Story 22.3: every end this process drove (resumes included)
    if (owned) queue.close();
  }
}

/** Story 27.1: the `blocked` end of a run whose prepare or drive threw, by its driver. A worktree already
 * cut is closed out ("no changes" when nothing landed) — never while what the drive may have started
 * still works it: its recorded worker, or an engine in the worktree (`closeout: skipped`, the worktree
 * kept; the engine-end sweep closes it out once they are dead). Never throws. */
export async function endAfterDriveFailure(
  queue: Queue, runId: string, reason: string, deps: WorktreeDeps = {}, self: Owner = selfOwner(),
): Promise<void> {
  const cur = queue.get(runId);
  let skip: string | undefined;
  if (cur?.worktree && !isTerminal(cur.state)) {
    try { skip = await queue.closeOutBlocker(cur, self, { asDriver: true }); }
    catch (e) { skip = `what may still work the worktree could not be probed: ${message(e)}`; }
  }
  const closed = await closeOutNow(queue, runId, {}, deps, skip);
  // Closed out with nothing live around it: the lock is released, never handed to an engine at a removed worktree.
  const closedOut = !skip && (closed.closeout as { result?: string } | undefined)?.result !== undefined;
  try {
    await queue.endDriven(runId, "blocked", reason, { ...(Object.keys(closed).length ? { detail: closed } : {}), ...(closedOut ? { keepEngine: true } : {}) });
  } catch { /* already ended */ }
  // Story 27.2: nothing left in the sandbox — its pin is released (a skipped close-out: the sweep's late one does).
  if (!skip) await releasePin(queue, runId, sbxDeps(deps));
}

/** The 21-1 flow under a claimed lock: snapshot → wake/submit → invoke/finish. */
async function drive(queue: Queue, queueRunId: string, v: Validated, worktree?: WorktreeDeps, prePinned = false): Promise<RunSummary> {
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
  await recordMinted(queue, queueRunId, started);
  const recorder = queueRecorder(queue, queueRunId, sbxDeps(worktree));
  return finishRun({ ...started, sessionId: randomUUID(), recorder: prePinned ? { ...recorder, pin: undefined } : recorder });
}

/** Records the studio run the minting verb created on the queue run, then (Story 21.6) the
 * wake answer a resume rebuilds from — a pre-minted session id (recorded just before the
 * spawn) and the worker's pid (recorded on spawn) follow in `finishRun`. A queue run
 * cancelled meanwhile refuses (`RunTerminal`): only the driver knows the minted id then, so
 * it ends that studio run (`studioRunEnder`, `CANCELLED_REASON`) before the refusal is rethrown. */
export async function recordMinted(
  queue: Queue, queueRunId: string, started: Pick<Started, "runId" | "woke">, verbRunner: VerbRunner = runJobVerb,
): Promise<void> {
  try {
    queue.setStudioRun(queueRunId, started.runId);
    queue.setWake(queueRunId, { directive: started.woke.directive ?? null, routing: started.woke.routing ?? null, state: started.woke.state ?? null });
  } catch (e) {
    const run = queue.get(queueRunId);
    if (e instanceof RunTerminal && run?.state === "cancelled") {
      await studioRunEnder(verbRunner)({ ...run, studio_run_id: started.runId }, CANCELLED_REASON);
    }
    throw e;
  }
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
export async function mirror(
  queue: Queue, queueRunId: string, v: Pick<Validated, "jobId" | "defn">, s: RunSummary, verbRunner: VerbRunner = runJobVerb,
  worktree: WorktreeDeps = {},
): Promise<RunSummary> {
  const studioRunId = s.run_id ?? null;
  let reason = s.reason;
  try {
    if (studioRunId && queue.get(queueRunId)?.studio_run_id !== studioRunId) {
      try { queue.setStudioRun(queueRunId, studioRunId); }
      catch (e) {
        // Cancelled before this studio run was recorded (e.g. adopted after a failed wake): only
        // the driver knows it — ended as `recordMinted` does; the end below still runs, so the
        // lock kept for this driver is freed (`endDriven`).
        const run = queue.get(queueRunId);
        if (!(e instanceof RunTerminal && run?.state === "cancelled")) throw e;
        await studioRunEnder(verbRunner)({ ...run, studio_run_id: studioRunId }, CANCELLED_REASON);
      }
    }
    if (s.finish_refused) {
      try { queue.note(queueRunId, "finish-refused", { ...s.finish_refused }); } catch { /* the queue is busy: the summary still carries it */ }
    }
    const terminal = isTerminal(s.state);
    const endReason = terminal ? s.reason ?? null
      : `${studioRunId ? `studio run ${studioRunId} left ${s.state}` : s.state}${s.reason ? `: ${s.reason}` : ""}`;
    const engine = launchedEngine(v.defn?.target?.skill, s.status_block);
    // A terminal state the studio's own run reached: marked on the `ended` event
    // (it clears an earlier recorded stop — Queue.pacing); a not-woken or refused run never is.
    // The studio's own state (`studio_state`) is what it holds, and what its `evaluate_stop` sees.
    const studioState = s.studio_state ?? s.state;
    const studioOutcome = terminal && studioRunId && isTerminal(studioState) ? { run_id: studioRunId, state: studioState } : undefined;
    // Story 22.3: the PR the run opened (a GitHub pull-request URL in the status block's `artifacts[]`), for its notification.
    const pr = prUrl(s.status_block);
    const detail = {
      ...(s.guards_tripped?.length ? { guards_tripped: s.guards_tripped } : {}), ...(studioOutcome ? { studio_outcome: studioOutcome } : {}),
      ...(pr ? { pr } : {}),
    };
    // AC4: a studio outcome in `stop.on_status` stops the job recurring — the
    // `stopped` event is written in the same transaction as `ended`.
    const onStatus = v.defn?.stop?.on_status;
    const stop = studioOutcome && Array.isArray(onStatus) && onStatus.includes(studioOutcome.state)
      ? { stop: { condition: "on_status" as const, state: studioOutcome.state, job_id: v.jobId } } : {};
    // Story 27.1 (operator-decisions §2): a launch that started an engine in the run's worktree
    // writes `launched`; the run stays `running` and `ended` waits for the engine's end (the sweep).
    const now = queue.get(queueRunId);
    if (s.finish_deferred && engine && now?.worktree && now.state === "running" && terminal && !s.hold_lock) {
      queue.markLaunched(queueRunId, engine, {
        ...(s.status_block !== undefined ? { status_block: s.status_block } : {}),
        ...(typeof s.total_cost_usd === "number" ? { worker_cost_usd: s.total_cost_usd } : {}),
        end: { state: s.state, reason: endReason, ...(Object.keys(detail).length ? { detail } : {}), ...stop },
      });
      // Story 27.2 (AC1): an sbx engine's in-VM pid recorded on the run and the supervisor's own `sbx exec`
      // held open for its life (the pin is kept: released only at the deferred `ended`).
      await holdEngine(queue, queueRunId, sbxDeps(worktree));
      return { ...s, run_id: queueRunId, studio_run_id: studioRunId, ...(reason !== undefined ? { reason } : {}) };
    }
    // A deferred finish whose run can no longer wait for its engine: finished now, never left open
    // (a state that is not terminal finishes `blocked`), its outcome on `ended`.
    const deferredFinish = s.finish_deferred && studioRunId && now
      ? await finishStudioRun(verbRunner, now.root, studioRunId, terminal ? s.state : "blocked", s.reason ?? null, s.status_block, s.total_cost_usd)
      : undefined;
    // An engine its status block names but that is not waited for (a `blocked` launch, no deferred
    // finish), or — a launch run naming none — one the launch core may still have started (the
    // launch-orphan rule): probed in the worktree first; an engine found keeps the worktree and takes the lock.
    const probed = now?.worktree && !isTerminal(now.state) && (engine || (now.verb_started && v.defn?.target?.skill === LAUNCH_SKILL))
      ? await queue.launchEngineAt(engineRoot(now), { tier: now.tier, sandbox: now.sandbox }) : undefined;
    // Every other end with a worktree closes out first: push + PR, or "no changes".
    // Never while something may still work the worktree: an sbx worker that may still run in the VM, or an engine.
    const skip = s.hold_lock ? `its worker may still run: ${s.hold_lock}` : probed?.holder ? "an engine may still work the worktree" : undefined;
    // AC3: the engine's metered cost (its run.json, read before the close-out removes the worktree), else the worker's.
    const metered = engine && now?.worktree && existsSync(now.worktree) ? meteredCost(servedRoot(now)!, engine) : undefined;
    const cost = metered ?? s.total_cost_usd;
    const closed = await closeOutNow(queue, queueRunId, { statusBlock: s.status_block, engineRunId: engine ?? null, ...(cost !== undefined ? { costUsd: cost } : {}) }, worktree, skip);
    const ended = { ...detail, ...closed, ...(probed?.holder ? { engine: probed.engine } : {}), ...(deferredFinish ? { finish: deferredFinish } : {}) };
    // Closed out with the probe confirming no engine: the lock is released (the engine id kept), never
    // handed to an engine, nor re-probed, at the worktree the close-out removed.
    const engineDead = !!probed && !probed.holder && !skip;
    const engineEnd = engineDead ? { keepEngine: true, ...(engine ? { engineRunId: engine } : {}) }
      : engine ? { engineRunId: engine } : probed?.holder ? { engineRunId: probed.holder.id } : {};
    await queue.endDriven(queueRunId, terminal ? (s.state as "complete") : "blocked", endReason,
      { ...engineEnd, ...(Object.keys(ended).length ? { detail: ended } : {}), ...stop,
        ...(s.hold_lock ? { holdLock: s.hold_lock } : {}) });
    // Story 27.2: an end with nothing left in the sandbox releases its pin (a skipped close-out: the sweep's late one does).
    if (!skip) await releasePin(queue, queueRunId, sbxDeps(worktree));
  } catch (e) {
    reason = `${reason ? `${reason}; ` : ""}queue: ${message(e)}`;
  }
  return { ...s, run_id: queueRunId, studio_run_id: studioRunId, ...(reason !== undefined ? { reason } : {}) };
}

/** Story 27.1: `finish` of a studio run whose end was deferred to its engine's (never throws). */
async function finishStudioRun(
  verbRunner: VerbRunner, root: string, studioRunId: string, state: string, reason: string | null, block: unknown, cost?: number,
): Promise<{ ok: boolean; detail: string }> {
  try {
    answered(await verbRunner(root, [
      "finish", "--directory", root, "--run-id", studioRunId, "--state", state, ...(reason ? ["--reason", reason] : []),
      ...(block !== undefined ? ["--status-block", JSON.stringify(block)] : []), ...(cost !== undefined ? ["--total-cost-usd", String(cost)] : []),
    ]), "finish");
    return { ok: true, detail: `studio run ${studioRunId} finished ${state}` };
  } catch (e) { return { ok: false, detail: `finish failed: ${message(e)}` }; }
}

/** Story 27.1: the close-out of a run ending now with its worktree cut (never throws): the
 * `ended` detail (`pr` or `no_changes`, and the `closeout` record); `{}` for a run with no worktree. */
async function closeOutNow(
  queue: Queue, runId: string, input: { statusBlock?: unknown; engineRunId?: string | null; costUsd?: number }, deps: WorktreeDeps = {},
  skip?: string,
): Promise<Record<string, unknown>> {
  const run = queue.get(runId);
  if (!run?.worktree || isTerminal(run.state)) return {};
  // Something may still work the worktree: no push, no PR, no removal — the sweep closes it out later.
  if (skip) return { closeout: { result: "skipped", why: skip, worktree: "kept" } };
  const events = queue.events(runId);
  // A sweep's close-out already ran but its end was not written: its recorded result, never a second close-out.
  const pending = pendingCloseOut(events);
  if (pending?.phase === "ended") {
    const d = pending.detail;
    return { ...(d.pr ? { pr: d.pr } : {}), ...(d.no_changes ? { no_changes: true } : {}), ...(d.closeout ? { closeout: d.closeout } : {}) };
  }
  // A draft PR the run's pause opened is marked ready, never opened again.
  const existingPr = priorPr(events);
  try { return closeOutDetail(await closeOut(run, { paused: false, ...input, ...(existingPr ? { existingPr } : {}) }, deps)); }
  catch (e) { return { closeout: { result: "failed", error: message(e), worktree: "kept" } }; }
}

export interface Started {
  jobId: string; root: string; projectId: string; runId: string;
  /** The skill invocation's timeout (the capped guard). */
  guardS: number;
  /** The job's own `max_wall_clock_seconds` (uncapped): `guardS` below it means the cap bounds. */
  jobGuardS?: number;
  defn: Record<string, any>; woke: Record<string, any>; permissionMode?: string;
  tier?: Tier; sandbox?: string;
  /** The registry entry root: the sbx microVM path is derived from it (when the run has no worktree). */
  registryRoot?: string;
  /** Story 27.1: the run's worktree — the worker's cwd, `payload.directory` and the sbx VM path. */
  workRoot?: string;
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
  /** Story 27.5 (DW-15): `costUsd`, the iteration's worker cost, recorded on the `accounted` event (`cost_usd`). */
  accounted(ids: string[], counts: Counts, costUsd?: number): void;
  /** Story 27.5 (DW-15): the worker cost already recorded on the run's `accounted` events (earlier iterations,
   * earlier processes): `finishRun` seeds its sum from it, so a resumed run's `finish` carries the whole sum. */
  costSoFar?(): number | undefined;
  accountedIds(): string[];
  resumes(): number;
  resumed(detail: Record<string, unknown>): void;
  /** The launch-orphan rule's probe of the run's checkout (`root` when the run is not found). */
  launchEngine?(root: string): Promise<LaunchEngine>;
  /** Story 27.2: pin the sbx sandbox before the worker's login preflight (`pinned`/`pin-failed` recorded):
   * null when pinned, else the failure. */
  pin?(sandbox: string): Promise<string | null>;
  /** Story 34.5: the run's live engine MCP env for the worker's sandbox (`InvokeOptions.engineMcpEnv`). */
  engineMcpEnv?(): Record<string, string> | undefined;
  /** Story 27.2: a tripped guard on an sbx launch run kills its in-VM engine by its recorded pid (recorded
   * `engine-kill`); undefined when the run has no engine to kill or no pid is known. `engineRunId`: the engine
   * the launch status block names (a trip at launch return), for its agent session (`killEngine`). */
  killEngine?(why: string, engineRunId?: string): Promise<WorkerKill | undefined>;
}

/** The queue-backed recorder of one queue run. Story 33.3: its pin goes through `pinWithRestart` with `restarted` —
 * the drain pass's set for a resume `drainQueue` drives (shared with the pass's drained runs), else a set of its own
 * (one per recorder, so one per `finishRun` call). */
export function queueRecorder(
  queue: Queue, runId: string, sbx: SandboxDeps = {}, restarted: Set<string> = new Set<string>(), mcp: EngineMcpDeps = { env: sbx.env ?? process.env },
): RunRecorder {
  return {
    pin: async (sb) => {
      const failed = await pinWithRestart(queue, runId, sb, sbx, { restarted });
      try { queue.note(runId, failed ? "pin-failed" : "pinned", { sandbox: sb, ...(failed ? { error: failed } : {}) }); }
      catch { /* the run ended meanwhile: the pin answer still stands */ }
      if (failed) return failed;
      // Story 34.5: a flagged run's engine MCP starts with its pin (once per run); a refusal fails the pin, so the run
      // ends `blocked` naming it.
      const started = await startEngineMcp(queue, runId, mcp);
      return "refused" in started ? engineMcpRefusalText(started.refused) : null;
    },
    engineMcpEnv: () => engineMcpEnv(runId),
    killEngine: async (why, engineRunId) => {
      const r = queue.get(runId);
      if (!r || r.tier !== "sbx" || (!r.engine_run_id && queue.definition(r)?.target?.skill !== LAUNCH_SKILL)) return undefined;
      return killRunEngine(queue, runId, why, sbx, engineRunId);
    },
    session: (sid) => { queue.setSession(runId, sid); },
    worker: (pid, guardS) => {
      // Story 27.5 (DW-19): the pid lands first (its `worker` event committed), the start time after it — a
      // supervisor killed between the two still leaves a usable record.
      try { queue.setWorker(runId, pid, null, guardS); }
      catch (e) {
        // Cancelled between the spawn and this record: the driver's own child, never recorded, is
        // killed before the refusal propagates (`killUnrecorded`); its `endDriven` awaits that kill.
        if (e instanceof RunTerminal && queue.get(runId)?.state === "cancelled") void queue.killUnrecorded(runId, pid, processStartTime(pid));
        throw e;
      }
      const start = processStartTime(pid);
      if (start) { try { queue.setWorkerStart(runId, pid, start); } catch { /* ended meanwhile: the pid stands recorded */ } }
    },
    accounted: (ids, counts, costUsd) => { queue.recordAccounted(runId, ids, counts, costUsd !== undefined ? { cost_usd: costUsd } : {}); },
    costSoFar: () => queue.accountedCost(runId, "worker"),
    accountedIds: () => queue.accountedIds(runId),
    resumes: () => queue.resumeCount(runId),
    resumed: (detail) => { queue.markResumed(runId, detail); },
    launchEngine: (root) => { const r = queue.get(runId); return queue.launchEngineAt(r ? engineRoot(r) : root, r ? { tier: r.tier, sandbox: r.sandbox } : undefined); },
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
  const { jobId, root, projectId, defn, target, guardS, jobGuardS, permissionMode, tier, sandbox, model, effort, registryRoot, workRoot } = v;
  const worker = { permissionMode, tier, sandbox, model, effort, ...(registryRoot !== undefined ? { registryRoot } : {}), ...(workRoot !== undefined ? { workRoot } : {}) };
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
    // Story 28.6: the queue is the checkout's only starter — its own verb is never refused by its own lock.
    out = await verbRunner(root, oneShot
      ? ["submit", "--directory", root, "--id", jobId, "--force-starter"]
      : ["wake", "--directory", root, "--job-id", jobId, "--force-starter"], timeoutS);
  } catch (e) {
    // jobrun creates the run before executing it: ANY failure here (timeout,
    // crash, non-JSON output) may have left one behind — recover, never assume.
    throw new WakeFailed(message(e), { root, projectId, target, verb, timeoutS, jobGuardS, before });
  }
  if (out.ok === false) throw refusal(`${verb}: ${out.error ?? "refused"}`);
  const woke = withQueuedPayload(jobId, out, defn); // Stories 31.7 and 32.2: the enqueued payload reaches the skill
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
  /** sbx: the processes inside the microVM whose command line carries the session id
   * (a read-only `sbx exec <sb> ps -eo pid=,args=`); a failed check answers `ok: false`. */
  sbxWorkers(sandbox: string, sessionId: string): Promise<SbxWorkerProbe>;
}
const defaultTranscriptChecks: TranscriptChecks = {
  host: (sid) => ensureTranscript(sid),
  sbx: (sb, sid) => sbxTranscriptExists(sb, sid),
  sbxWorkers: (sb, sid) => sbxSessionWorkers(sb, sid),
};

export const SBX_VM_WORKER = "sbx worker may still run in the VM";
/** Story 21.6: before an sbx silent exit is resumed in process — the host `sbx exec`
 * exiting never proves the in-VM worker ended. A process carrying the session id,
 * or a failed check (thrown, non-zero, timed out), refuses the resume with
 * `sbx worker may still run in the VM: <pid(s) | probe failed: detail>`. */
export async function sbxVmWorkerCause(check: () => Promise<SbxWorkerProbe>): Promise<string | undefined> {
  let found: SbxWorkerProbe;
  try { found = await check(); }
  catch (e) { found = { ok: false, detail: message(e) }; }
  if (!found.ok) return `${SBX_VM_WORKER}: probe failed: ${found.detail}`;
  return found.pids.length ? `${SBX_VM_WORKER}: ${found.pids.join(", ")}` : undefined;
}

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
    ...(run.worktree ? { workRoot: servedRoot(run)! } : {}),
    tier: options.tier, ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    ...(options.sandbox ? { sandbox: options.sandbox } : {}), ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
  };
}

/** Story 27.3: the paused-run pass's relaunch of a closed-out run under the same queue run, in two stages:
 * the rebuild (`rebuildStarted` from the stored wake answer — a throw is a failed `relaunch` step, the run
 * still paused), then the drive the pass runs after its `close-out` move: `finishRun` with a fresh session id
 * (never `--resume`) and the pinning recorder (`queueRecorder`: `InvokeOptions.pin`), then `mirror` (the new
 * `launched`, `markLaunched` recording the new engine id, its pid and the hold). Nothing story-specific is
 * passed: `tk-studio-launch` skips done stories itself. */
export function relauncher(opts: {
  worktree?: WorktreeDeps; verbRunner?: VerbRunner; invoke?: SkillInvoker;
  rebuild?: (queue: Queue, run: QueueRun, wake: Record<string, any>) => Promise<Started>;
} = {}): NonNullable<PausedDeps["relaunch"]> {
  return async (queue, run) => {
    let wake: unknown = null;
    try { wake = JSON.parse(run.wake ?? "null"); } catch { /* unreadable: none */ }
    if (!wake || typeof wake !== "object") throw new Error("no wake answer recorded: the relaunch cannot be rebuilt");
    const s = await (opts.rebuild ?? rebuildStarted)(queue, run, wake as Record<string, any>);
    const verbs = opts.verbRunner ?? runJobVerb;
    return async () => {
      const summary = await finishRun({ ...s, sessionId: randomUUID(), recorder: queueRecorder(queue, run.run_id, sbxDeps(opts.worktree)) }, verbs, opts.invoke ?? invokeSkill);
      return mirror(queue, run.run_id, { jobId: s.jobId, defn: s.defn }, summary, verbs, opts.worktree);
    };
  };
}

/** Story 27.3: the pass's seams from a run's options. */
const pausedDeps = (opts: RunOptions): PausedDeps => ({
  ...(opts.worktree ?? {}), ...(opts.hygiene ? { hygiene: opts.hygiene } : {}), ...(opts.owner ? { self: opts.owner } : {}),
  relaunch: relauncher({ ...(opts.worktree ? { worktree: opts.worktree } : {}) }),
});

/** Story 27.3: the `resume` verb `POST /runs/{id}/resume` calls — `bmad-loop resolve … --resume` for a paused
 * run whose story did not land (`resumePaused`; throws `ResumeRefused`). */
export function resumeRun(queue: Queue, runId: string, restorePatch?: string, deps: EngineResumeDeps = {}): Promise<ResumeAnswer> {
  return resumePaused(queue, runId, restorePatch !== undefined ? { restorePatch } : {}, deps);
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
      const cause = await launchEngineCause(() => queue.launchEngineAt(engineRoot(run), { tier: run.tier, sandbox: run.sandbox }));
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
 * (a resume whose record fails never runs: `resume not recorded`). On sbx a read-only
 * in-VM process check runs first (`TranscriptChecks.sbxWorkers`): a process carrying the
 * session id, or a failed check, refuses the resume (`sbx worker may still run in the VM:
 * …`) and the summary carries `hold_lock` — the queue run ends keeping its checkout lock
 * until the recorded worker's in-VM deadline. A worker whose
 * record fails is killed and the run ends `blocked` naming `worker record failed`.
 * A resumed iteration accounts only the message ids not already accounted. */
export async function finishRun(
  s: Started, verbRunner: VerbRunner = runJobVerb, invoke: SkillInvoker = invokeSkill, clockMs: () => number = () => performance.now(),
  transcripts: TranscriptChecks = defaultTranscriptChecks,
): Promise<RunSummary> {
  const { jobId, root, projectId, runId, guardS, defn, woke, permissionMode, tier, sandbox, registryRoot, workRoot } = s;
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

  let state: ReturnType<typeof finishStateFor> = "blocked", reason: string | undefined, block: Record<string, unknown> | undefined;
  // Story 27.5 (DW-15): seeded from the cost recorded on earlier iterations' `accounted` events (a restart resumes
  // in a new process); each iteration's cost is recorded as it is accounted (`pendingCost`).
  let cost: number | undefined;
  try { cost = rec?.costSoFar?.(); } catch { cost = undefined; }
  let pendingCost: number | undefined;
  let invoked: Record<string, unknown> | undefined, tripped: GuardTrip[] | undefined, account: RunSummary["account"];
  const routing = (woke.routing ?? {}) as Record<string, unknown>;
  const knowledge = directive.knowledge && typeof directive.knowledge === "object" ? directive.knowledge : undefined;
  // Story 32.2: an engagement-chat run keeps the queue run id its overlaid payload carries (the contract: every chat
  // run_id is the queue run id; the spend pass maps it via studio_run_id); every other job gets the studio run id.
  const payloadRunId = jobId === ENGAGEMENT_CHAT_JOB && typeof directive.payload?.run_id === "string" && directive.payload.run_id
    ? directive.payload.run_id as string : runId;
  // §5: the submission's override, else the resolved job's routing — verbatim; neither → none (AD-14).
  const model = s.model ?? routing.model, effort = s.effort ?? routing.effort;
  // Resume state (Story 21.6).
  let resumes = rec ? rec.resumes() : 0;
  const accountedIds = new Set<string>([...(rec ? rec.accountedIds() : []), ...(s.accountedIds ?? [])]);
  let resuming = !!(s.resumeFirst && sid);
  let spentS = s.resumeFirst?.spentS ?? 0;
  let timeoutS = s.resumeFirst && sid ? s.resumeFirst.remainingS : guardS;
  let accountedLast = false;
  // Story 21.6: an sbx worker that may still run in the VM — the run ends keeping its lock.
  let vmHold: string | undefined;
  const noteAccounted = (a: Accounted) => {
    for (const id of a.message_ids) accountedIds.add(id);
    const c = pendingCost;
    pendingCost = undefined;
    try { rec?.accounted(a.message_ids, { turns: a.turns, tokens: a.tokens }, c); } catch { /* the studio already has the counts */ }
    account = { turns: a.turns, tokens: a.tokens, within_budget: a.within_budget, exceeded: a.exceeded };
  };
  // An iteration's cost not carried by an `accounted` (a job with no turn/token guard): its own `accounted` event.
  const flushCost = () => {
    if (pendingCost === undefined) return;
    const c = pendingCost;
    pendingCost = undefined;
    try { rec?.accounted([], { turns: 0, tokens: 0 }, c); } catch { /* not recorded: the sum misses it on a restart */ }
  };
  for (;;) {
    accountedLast = false; tripped = undefined; block = undefined; reason = undefined;
    try {
      const startedMs = clockMs();
      const spawnGuardS = timeoutS; // the guard this spawn runs under (sbx: its in-VM `timeout`)
      const recording = rec
        ? { ...(sid && !resuming ? { beforeSpawn: () => rec.session(sid) } : {}), onSpawn: (pid: number) => rec.worker(pid, spawnGuardS) } : {};
      const out = await invoke(workRoot ?? root, directive.skill, {
        payload: { ...(directive.payload ?? {}), run_id: payloadRunId }, timeout_s: timeoutS, permission_mode: permissionMode,
        ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}),
        ...(tier ? { tier } : {}), ...(sandbox ? { sandbox } : {}), ...(knowledge ? { knowledge } : {}),
      }, undefined, {
        ...(workRoot !== undefined ? { vmHostRoot: workRoot } : registryRoot !== undefined ? { vmHostRoot: registryRoot } : {}),
        ...(sid ? { sessionId: sid, ...(resuming ? { resume: true } : {}) } : {}), ...recording,
        ...(rec?.pin ? { pin: (sb: string) => rec.pin!(sb) } : {}),
        ...(rec?.engineMcpEnv ? { engineMcpEnv: () => rec.engineMcpEnv!() } : {}),
      });
      // The worker's own time, from its spawn (invokeSkill's worker_elapsed_s) —
      // not the auth preflight or drift check before it; the injected clock only
      // when the result does not carry it.
      const elapsedS = typeof out.worker_elapsed_s === "number" && Number.isFinite(out.worker_elapsed_s)
        ? out.worker_elapsed_s : (clockMs() - startedMs) / 1000;
      invoked = out;
      if (typeof out.total_cost_usd === "number") { cost = (cost ?? 0) + out.total_cost_usd; pendingCost = out.total_cost_usd; }
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
          ? await launchEngineCause(() => rec?.launchEngine ? rec.launchEngine(root) : probeLaunchEngine(defaultProbes, workRoot ?? root, { tier, sandbox }))
          : undefined;
        // sbx: the host `sbx exec` exiting never proves the in-VM worker ended — a process
        // carrying the session id (or a failed check) refuses the resume, and the run ends
        // keeping its checkout lock until the recorded worker's in-VM deadline (`hold_lock`).
        if (!engineCause && tier === "sbx" && sid) {
          vmHold = await sbxVmWorkerCause(() => transcripts.sbxWorkers(sandbox ?? "", sid));
        }
        const refused = engineCause ?? vmHold;
        const verdict: ResumeVerdict = refused ? { ok: false, cause: refused } : await resumeCheck({
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
            flushCost();
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
  flushCost();
  // Story 27.2 (AC2): a tripped guard on an sbx launch run (the in-VM 124/137, the host timer, the wall
  // clock or a turn/token guard) kills its in-VM engine by its recorded pid; one still alive after the wait —
  // or one whose first probe could not be read (`start time unreadable`, nothing signalled) — holds the run
  // and its lock (DW-3: `hold_lock`) until a later probe shows the pid gone (`Queue.engineAliveAfterKill`).
  let engineKill: WorkerKill | undefined;
  if (tripped?.length && tier === "sbx" && rec?.killEngine) {
    engineKill = await rec.killEngine(guardReason(tripped), launchedEngine(directive.skill, block));
    if (engineKill && workerMayRun(engineKill) && !vmHold) vmHold = `engine may still run in the VM: ${engineKill.outcome} (pid ${engineKill.pid})`;
  }
  const extras = {
    ...(block ? { status_block: block } : {}), ...(cost !== undefined ? { total_cost_usd: cost } : {}),
    ...(tripped?.length ? { guards_tripped: tripped } : {}), ...(account ? { account } : {}),
    ...(vmHold ? { hold_lock: vmHold } : {}), ...(engineKill ? { engine_kill: engineKill } : {}),
  };
  // Story 27.1 (operator-decisions §2): a launch that started an engine in the run's worktree is not
  // finished at launch return — the studio run ends with the engine (`sweepEngines` calls `finish`).
  if (workRoot !== undefined && !vmHold && state !== "blocked" && launchedEngine(directive.skill, block) !== undefined) {
    return { ...base, ok: state === "complete", target: "skill", state, ...(reason ? { reason } : {}), ...extras, finish_deferred: true };
  }
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
    // Story 27.5 (DW-23): a refusal on an already-terminal studio run keeps the worker's own (status-block)
    // reason; the refusal rides `finish_refused`, recorded by `mirror` as a `finish-refused` event. Any other
    // failure (a timeout, a `uv` that failed to spawn, the run still running/unknown) keeps `finish failed: …`.
    if (!isTerminal(actual)) return { ...base, ok: false, target: "skill", state: actual, reason: `finish failed: ${message(e)}`, ...extras };
    return { ...base, ok: false, target: "skill", state: actual, ...(reason ? { reason } : {}), ...extras,
      finish_refused: { error: `finish failed: ${message(e)}`, actual_state: actual } };
  }
  return { ...base, ok: state === "complete", target: "skill", state, ...(reason ? { reason } : {}), ...extras, finish };
}

/** The seams of `serve`'s certificate watcher (tests inject them). */
export interface CertWatchDeps {
  env?: Record<string, string | undefined>;
  open?: () => Queue;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (timer: unknown) => void;
  /** One line to stderr (default `console.error`). */
  log?: (line: string) => void;
}

/** Story 27.5 (DW-21): `serve`'s certificate tick (src/cert.ts) — the outcome of a renewal recorded at start, then
 * `certCheck` at once and every CERT_CHECK_MS; a `renew` clears the timer, closes the watcher's queue and answers
 * CERT_RENEW_EXIT, once. No TLS: nothing to watch. A queue that cannot be opened disables the check with one line on
 * stderr. Answers a stop for the watcher (undefined when nothing is watched). */
export function watchCertificate(exit: (code: number) => void, deps: CertWatchDeps = {}): (() => void) | undefined {
  const log = deps.log ?? ((line: string) => console.error(line));
  let tls: ReturnType<typeof tlsConfig>;
  try { tls = tlsConfig(deps.env); } catch { return undefined; }
  if (!tls) return undefined;
  let queue: Queue;
  try { queue = (deps.open ?? (() => Queue.open(deps.env)))(); }
  catch (e) { log(`[supervisor] certificate check disabled: the queue could not be opened (${message(e)})`); return undefined; }
  try { recordCertStart(queue, tls.cert); } catch { /* the queue is busy: recorded on a later start */ }
  const set = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clear = deps.clearInterval ?? ((t: unknown) => clearInterval(t as ReturnType<typeof setInterval>));
  let timer: unknown, done = false;
  const stop = () => { if (done) return; done = true; if (timer !== undefined) clear(timer); try { queue.close(); } catch { /* closed */ } };
  const tick = () => {
    if (done) return;
    try {
      if (certCheck(queue, tls!.cert, (deps.now ?? Date.now)()).action === "renew") { stop(); exit(CERT_RENEW_EXIT); }
    } catch { /* the queue is busy: the next tick */ }
  };
  timer = set(tick, CERT_CHECK_MS);
  tick();
  return stop;
}

/** The seams of `serve`'s starter-lock refresh (tests inject them). */
export interface StarterLockWatchDeps {
  env?: Record<string, string | undefined>;
  open?: () => Queue;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (timer: unknown) => void;
  /** One line to stderr (default `console.error`). */
  log?: (line: string) => void;
}

/** Story 28.6 (DW-6): `serve` rewrites every served project's `starter.lock` at once and every
 * STARTER_LOCK_REFRESH_MS, stamping `since` fresh, so `jobrun.py` judges it live (pid alive, `since` at most a
 * minute old) while the supervisor is up and stale within STARTER_LOCK_STALE_S of it going down. The tick's and
 * the claim's writes (Story 27.2) are unchanged. A queue that cannot be opened disables the refresh with one line
 * on stderr. Never throws. Answers a stop for the watcher (undefined when nothing is watched). */
export function watchStarterLocks(deps: StarterLockWatchDeps = {}): (() => void) | undefined {
  const log = deps.log ?? ((line: string) => console.error(line));
  const env = deps.env ?? process.env;
  let queue: Queue;
  try { queue = (deps.open ?? (() => Queue.open(deps.env)))(); }
  catch (e) { log(`[supervisor] starter-lock refresh disabled: the queue could not be opened (${message(e)})`); return undefined; }
  const set = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clear = deps.clearInterval ?? ((t: unknown) => clearInterval(t as ReturnType<typeof setInterval>));
  const now = () => new Date((deps.now ?? Date.now)());
  let timer: unknown, done = false;
  const stop = () => { if (done) return; done = true; if (timer !== undefined) clear(timer); try { queue.close(); } catch { /* closed */ } };
  const tick = () => {
    if (done) return;
    try { writeStarterLocks(queue, env, now, { fresh: true }); } catch { /* never throws: the next tick */ }
  };
  try { timer = set(tick, STARTER_LOCK_REFRESH_MS); } catch (e) { log(`[supervisor] starter-lock refresh timer failed (${message(e)})`); }
  tick();
  return stop;
}

const USAGE = [
  "usage: bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>] [--tier host|sbx] [--sandbox <name>]",
  "                          [--model <model>] [--effort <effort>]",
  "       bun src/cli.ts submit <job-id> --directory <root> [same options as run] [--editor-in-the-loop]",
  "       bun src/cli.ts recover",
  "       bun src/cli.ts drain",
  "       bun src/cli.ts serve   (the HTTP API on TK_SUPERVISOR_BIND:TK_SUPERVISOR_PORT, bearer TK_SUPERVISOR_TOKEN)",
  "       bun src/cli.ts verify <run id>",
].join("\n");

/** Story 33.8: the `verify` verb's seams (tests): the queue (default `Queue.open()`, closed after) and the leg
 * (default `rerunHostLeg`, `by: "cli"`). */
export interface VerifyVerbSeams { queue?: Queue; leg?: (queue: Queue, runId: string) => Promise<HostLegStarted> }

/** Story 33.8: `bun src/cli.ts verify <run id>` — an ended run's host leg re-run in the foreground (`hostleg.ts`). One
 * JSON object: `{ok: true, run_id, state, head, rerun: true, green, skipped?, reason?, pr, pr_ready?, pr_draft?, pr_body?,
 * commit?, pushed?, worktree}` (Story 35.1: `rerun: true`, a red leg's `reason`, and the `rerun` member's new fields — the
 * body rewrite, the red flip, a slice run's commit and push); exit 0 green, 1 red or skipped, 2 a refusal
 * (`{ok: false, error, detail}`) or a usage error. */
export async function verifyVerb(args: string[], seams: VerifyVerbSeams = {}): Promise<number> {
  if (args.length !== 1 || !args[0]!.trim()) { console.error(USAGE); return 2; }
  const runId = args[0]!;
  let queue: Queue | undefined = seams.queue;
  const owned = !queue;
  try {
    queue ??= Queue.open();
    const started = await (seams.leg ?? ((q: Queue, id: string) => rerunHostLeg(q, id, { by: "cli" })))(queue, runId);
    const r = await started.done;
    const green = !r.skipped && r.green;
    const x = r.rerun;
    console.log(JSON.stringify({
      ok: true, run_id: started.run_id, state: started.state, head: started.head, rerun: true, green,
      ...(r.skipped ? { skipped: true, reason: r.reason } : r.reason !== undefined ? { reason: r.reason } : {}), pr: x.pr,
      ...(x.pr_ready !== undefined ? { pr_ready: x.pr_ready } : {}), ...(x.pr_draft !== undefined ? { pr_draft: x.pr_draft } : {}),
      ...(x.pr_body !== undefined ? { pr_body: x.pr_body } : {}), ...(x.commit !== undefined ? { commit: x.commit } : {}),
      ...(x.pushed !== undefined ? { pushed: x.pushed } : {}), worktree: x.worktree,
    }, null, 2));
    return green ? 0 : 1;
  } catch (e) {
    console.log(JSON.stringify(e instanceof VerifyRefused ? { ok: false, error: e.code, detail: e.message } : { ok: false, error: "VerifyFailed", detail: message(e) }, null, 2));
    return 2;
  } finally { if (owned) { try { queue?.close(); } catch { /* closing failed */ } } }
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === "serve") {
    if (args.length) { console.error(`unknown argument '${args[0]}'\n${USAGE}`); return 2; }
    let url: string;
    try { url = serveApi().url; }
    catch (e) {
      // Refused before binding (bind, port, token, queue): named, never the token's value.
      console.log(JSON.stringify({ ok: false, error: message(e) }, null, 2));
      return 2;
    }
    console.log(JSON.stringify({ ok: true, listening: url }, null, 2));
    // Story 27.5 (DW-21): the certificate is checked at start and on each tick; within 14 days of expiry and
    // outside a live run, `serve` records the request and exits CERT_RENEW_EXIT for the keeper to renew and restart it.
    // Story 28.6: every served project's starter lock is refreshed at once and every minute (fresh `since`).
    return new Promise<number>((done) => { watchStarterLocks(); watchCertificate(done); });
  }
  if (cmd === "verify") return verifyVerb(args);
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
  let editorInTheLoop = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    // Story 22.3: a flag with no value, on `submit` only.
    if (flag === "--editor-in-the-loop" && cmd === "submit") { editorInTheLoop = true; continue; }
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
      console.log(JSON.stringify(await submitJob(jobId, directory, { ...worker, permissionMode, ...(editorInTheLoop ? { editorInTheLoop } : {}) }), null, 2));
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
  // Story 33.1: an uncaught error is one explicit `uncaught:` line (the log tee files it), then exit 70.
  process.on("uncaughtException", (e) => { console.error(`uncaught: ${message(e)}`); process.exit(70); });
  process.on("unhandledRejection", (e) => { console.error(`uncaught: ${message(e)}`); process.exit(70); });
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
