#!/usr/bin/env bun
/**
 * tick.ts — tick self-paced tk-studio jobs through the connector.
 *
 * A tick maps to the §4 `wake` verb. Whatever schedules this script is the
 * pacing substrate for studio jobs declared `trigger: loop` with
 * `cadence.mode: self-paced`.
 *
 * AD-2 boundary: everything here rides the published contract. Job discovery
 * rides the §4 `resolve` verb (contract 0.1.12): every declared job arrives
 * with type extension applied by the one studio-side resolver — this driver
 * never merges or raw-reads `.tk-studio/jobs/<id>.json` instance files
 * (PROP-008: an instance inheriting trigger/cadence from its type read as
 * trigger-less through the raw file, silently skipping it). Verbs, run
 * state, and skill invocation go through a live connector
 * (`src/server.ts`) — never the studio internals.
 *
 * On start (not under --dry-run), before any per-job gating, the tick runs
 * the queue's restart rule once over the whole queue (`recoverQueue`, the
 * same rule as `cli.ts recover`) and logs what it recovered: a run a killed
 * tick stranded `running` has its studio run ended too, so the no-overlap
 * skip below never holds that job forever. A failed recovery (no
 * TK_STUDIO_ROOT, contract pin, unusable queue) is a tick that cannot run.
 *
 * Per job, per tick, the pacer reads the queue db (TK_SUPERVISOR_DB), not the
 * studio's `status` (Story 21.5):
 *   - skip a stopped job: a terminal queue run carries a `stopped` event
 *     (`stop.on_status` matched when that run ended) and no later run reached
 *     a studio terminal state (a not-woken/refused run or an orphan never
 *     clears it), while the current definition's `stop.on_status` still
 *     lists the stopped state — skipped before any queue run is minted, the
 *     condition logged (the studio's own `wake` would refuse it anyway; a hand
 *     `run`/`submit` still meets that refusal);
 *   - skip while a queue run of the job on this checkout is `running`, `paused`,
 *     `external` (Story 27.2: a studio run started outside the queue, recorded by
 *     the tick's recovery), or `queued` under a live owner (no overlap);
 *   - an ownerless `queued` run (a lock wait, a recovery re-queue, a hand
 *     `submit`) is driven: `runJob`'s idempotent mint adopts it, nothing new
 *     is minted, and the hint is not re-applied;
 *   - otherwise skip while `hint_seconds` since its latest terminal queue run
 *     ended hasn't elapsed;
 *   - otherwise wake → invoke → finish through the queue-backed `runJob`
 *     (src/cli.ts, Story 21.3; `skipRecover`: the tick already recovered):
 *     the queue mints idempotently (a racing wake gets the existing run),
 *     the run takes the checkout lock before `wake` (a live holder leaves it
 *     `queued`, logged as a skip). A queued run recorded with an explicit
 *     permission mode is driven under it. `woken: false` is an answer (stop
 *     condition), not an error. Guards are the wrapper's job (src/cli.ts):
 *     a core-target job executes inside wake, where jobrun enforces its
 *     `max_wall_clock_seconds`; the wake verb's timeout (that guard + 120 s)
 *     is the supervisor's named backstop (the studio run cancelled, the queue
 *     run `partial` naming the guard). A skill-target job is invoked headless
 *     under that guard capped at --timeout-cap-s (a trip kills the worker's
 *     process tree and names the bound that tripped), its turns/tokens
 *     `account`ed when it has `max_turns`/`max_tokens`, and finished with its
 *     §3 block.
 *
 * Cron and fixed-interval loop jobs are NOT ticked here — their directives
 * bind to real schedules at submit; this script is only the self-paced pacer.
 *
 * Usage:
 *   bun run src/tick.ts [--dry-run] [--project ID]...
 *                                       [--directory ROOT]... [--timeout-cap-s N]
 *
 * --directory ticks the given root instead of enumerating the registry
 * (testing / one-off ticks). The root must still be a registered project
 * root: every run is validated through registry `show` (its entry's root
 * must be this directory), so an unregistered root's jobs are refused.
 *
 * Exit codes: 0 tick completed (including nothing-to-do and per-job refusals);
 * 1 a job errored unexpectedly; 2 the tick could not run at all (including an
 * unusable queue: QueueDbMissing / QueueDbPlacementRefused, or a failed
 * start-of-tick recovery, before any job).
 */
import { existsSync } from "node:fs";
import { recoverQueue, runJob, StartError, type RunSummary } from "./cli";
import { ConnectorClient } from "./client";
import { Queue, queueDbPath, type JobPacing } from "./queue";

const DEFAULT_TIMEOUT_CAP_S = 3600;

// ------------------------------------------------------------ discovery (§4 resolve, contract 0.1.12)

export interface DeclaredJob {
  id: string;
  definition?: Record<string, any>;
  problem?: string;
}

/** Map a §4 `resolve` response onto this tick's per-job view. Discovery is
 * served, not read: `resolved` is the merged definition (type extension
 * applied studio-side — lib/job.py is the one resolver), and a declared
 * job's problems arrive named on its entry. Config-level problems ride as
 * `(config)` rows so the per-job loop logs them like any other. */
export function declaredJobsFrom(result: Record<string, any>): DeclaredJob[] {
  const configProblems: DeclaredJob[] = (Array.isArray(result.problems) ? result.problems : [])
    .map((p: unknown) => ({ id: "(config)", problem: String(p) }));
  const entries: DeclaredJob[] = (Array.isArray(result.jobs) ? result.jobs : [])
    .map((e: Record<string, any>) => {
      const id = String(e?.job_id ?? "?");
      const problems: unknown[] = Array.isArray(e?.problems) ? e.problems : [];
      if (problems.length) return { id, problem: problems.map(String).join("; ") };
      if (!e?.resolved || typeof e.resolved !== "object" || Array.isArray(e.resolved)) {
        return { id, problem: "resolve served no merged definition" };
      }
      return { id, definition: e.resolved as Record<string, any> };
    });
  return [...configProblems, ...entries];
}

export function isSelfPaced(defn: Record<string, any> | undefined): boolean {
  return defn?.trigger === "loop" && defn?.cadence?.mode === "self-paced";
}

// ------------------------------------------------------------ pacing

export interface WakeDecision {
  wake: boolean;
  reason: string;
}

/** Pace one self-paced job from its queue runs (`Queue.pacing`), in order:
 *   1. a recorded `stop.on_status` stop still in force ends its recurrence —
 *      only while the current definition's `stop.on_status` still lists the
 *      stopped state (an operator who drops it, or the whole list, resumes the
 *      job; the stale stop is ignored and the rules below apply);
 *   2. never overlap a run that holds the job — `running`, `paused`, `external`
 *      (Story 27.2: started outside the queue, live until its studio run ends),
 *      or `queued` under a live owner;
 *   3. an ownerless `queued` run (a lock wait, a recovery re-queue, a hand
 *      `submit`) is driven: wake, and `runJob`'s idempotent mint adopts that
 *      run — nothing new is minted, and the hint is not re-applied (the run
 *      was already asked for);
 *   4. honor hint_seconds since its latest terminal run ended (the hint is the
 *      studio's pacing request — the substrate decides, and this substrate
 *      honors it).
 * Pure: `nowMs` is injected. */
export function shouldWake(
  defn: Record<string, any>, pacing: Pick<JobPacing, "live" | "adoptable" | "lastEnded" | "stopped">, nowMs: number,
): WakeDecision {
  const stop = pacing.stopped?.detail;
  if (stop) {
    const state = stop.state ?? pacing.stopped!.to_state;
    const onStatus = defn?.stop?.on_status;
    if (Array.isArray(onStatus) && onStatus.includes(state)) {
      return { wake: false, reason: `stopped — stop.${stop.condition ?? "on_status"}: run ${pacing.stopped!.run_id} ended ${state}` };
    }
  }
  const live = pacing.live[0];
  if (live) {
    const why = live.state === "queued" ? "queued under a live owner"
      : live.state === "external" ? `external (studio run ${live.studio_run_id ?? "?"} started outside the queue)` : live.state;
    return { wake: false, reason: `run ${live.run_id} still ${why} — no overlap` };
  }
  const adopt = pacing.adoptable[0];
  if (adopt) return { wake: true, reason: `driving ownerless queued run ${adopt.run_id} (nothing new minted)` };
  const lastMs = pacing.lastEnded ? Date.parse(pacing.lastEnded) : Number.NaN;
  const hintS = defn?.cadence?.hint_seconds;
  if (typeof hintS === "number" && hintS > 0 && Number.isFinite(lastMs) && nowMs - lastMs < hintS * 1000) {
    const remainingS = Math.ceil((hintS * 1000 - (nowMs - lastMs)) / 1000);
    return { wake: false, reason: `hint_seconds pacing: ${remainingS}s remaining` };
  }
  return { wake: true, reason: pacing.lastEnded ? "pacing window elapsed" : "no prior runs" };
}

// ------------------------------------------------------------ tick

export interface Args {
  dryRun: boolean;
  projects: string[];
  directories: string[];
  timeoutCapS: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, projects: [], directories: [], timeoutCapS: DEFAULT_TIMEOUT_CAP_S };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--dry-run": args.dryRun = true; break;
      case "--project": args.projects.push(argv[++i]); break;
      case "--directory": args.directories.push(argv[++i]); break;
      case "--timeout-cap-s": args.timeoutCapS = Number(argv[++i]); break;
      default: throw new Error(`unknown argument '${argv[i]}'`);
    }
  }
  if (!Number.isFinite(args.timeoutCapS) || args.timeoutCapS <= 0) throw new Error("--timeout-cap-s must be a positive number");
  return args;
}

const log = (msg: string) => console.log(`[studio-tick] ${msg}`);

/** tickJob's seams (tests): the queue it paces from, the run driver, the log, the clock. */
export interface TickDeps {
  /** The queue (TK_SUPERVISOR_DB by default); a supplied queue is not closed here. */
  queue?: Queue;
  run?: typeof runJob;
  log?: (msg: string) => void;
  nowMs?: () => number;
}

/** One self-paced job, one tick: pace from the queue, then drive through `runJob`. */
export async function tickJob(root: string, job: DeclaredJob, args: Args, deps: TickDeps = {}): Promise<"woken" | "skipped" | "refused" | "error"> {
  const log_ = deps.log ?? log, run = deps.run ?? runJob;
  const defn = job.definition!;
  let pacing: JobPacing;
  try {
    if (deps.queue) pacing = deps.queue.pacing(job.id, root);
    else {
      const queue = Queue.open();
      try { pacing = queue.pacing(job.id, root); } finally { queue.close(); }
    }
  } catch (e) {
    log_(`${job.id}: queue unreadable — ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
    return "error";
  }

  const decision = shouldWake(defn, pacing, (deps.nowMs ?? Date.now)());
  if (!decision.wake) {
    log_(`${job.id}: skip — ${decision.reason}`);
    return "skipped";
  }
  if (args.dryRun) {
    log_(`${job.id}: would wake (${decision.reason}) [dry-run]`);
    return "skipped";
  }

  // Wake → invoke → finish through the queue-backed runJob (Story 21.3):
  // idempotent minting, one engine per checkout. The restart rule already ran
  // once at the start of this tick. The skill invocation's guard is capped at
  // --timeout-cap-s; the wake verb keeps the job's own guard.
  let summary: RunSummary;
  try { summary = await run(job.id, root, undefined, { guardCapS: args.timeoutCapS, skipRecover: true, ...(deps.queue ? { queue: deps.queue } : {}) }); }
  catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
    // A refusal (registry `show`/`resolve`/`wake` answering ok:false, problems[]): no studio run — refused, not an error.
    if (e instanceof StartError && e.refused) { log_(`${job.id}: refused — ${msg}`); return "refused"; }
    log_(`${job.id}: run could not start — ${msg}`);
    return "error";
  }
  const where = `run ${summary.run_id ?? "-"}${summary.studio_run_id ? ` (studio ${summary.studio_run_id})` : ""}`;
  log_(`${job.id}: ${where} ${summary.state}${summary.reason ? ` — ${summary.reason.slice(0, 200)}` : ""}`);
  // A lock wait or a run already running elsewhere: nothing was driven, whatever its studio run.
  if (summary.waited || summary.skipped) return "skipped";
  // No studio run minted (blocked before minting, not-woken): a refusal, not a wake.
  if (!summary.studio_run_id) return "refused";
  return "woken";
}

async function main(): Promise<number> {
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(String(e instanceof Error ? e.message : e)); return 2; }
  // An unusable queue (QueueDbMissing / QueueDbPlacementRefused) is a tick that cannot run.
  try { queueDbPath(); }
  catch (e) { console.error(`[studio-tick] tick cannot run: ${e instanceof Error ? e.message : e}`); return 2; }
  // The restart rule, once over the whole queue, before any per-job gating: a
  // run a killed tick stranded `running` (its studio run still open, which the
  // no-overlap skip would honour forever) is ended or re-queued here.
  if (!args.dryRun) {
    try {
      const rec = await recoverQueue();
      const ended = rec.ended.map((e) => `${e.run_id}${e.studio_run_id ? ` (studio ${e.studio_run_id})` : ""}`);
      if (ended.length || rec.requeued.length) {
        log(`recovered: ended [${ended.join(", ")}]; requeued [${rec.requeued.join(", ")}]`);
      } else log("recovered: nothing orphaned");
    } catch (e) {
      console.error(`[studio-tick] tick cannot run: recovery failed: ${e instanceof Error ? e.message : e}`);
      return 2;
    }
  }

  const client = new ConnectorClient();
  let sawError = false;
  try {
    await client.init("studio-jobs-tick");
    let projects: Record<string, { root?: string }>;
    if (args.directories.length) {
      projects = Object.fromEntries(args.directories.map((d) => [d, { root: d }]));
    } else {
      const projectsOut = await client.callTool("tk_projects", {}, 60_000);
      if (projectsOut.toolError) {
        // No registry = no studio on this machine — an inert tick, not a failure.
        log(`no tk-studio projects (${projectsOut.toolError.slice(0, 200)}) — nothing to tick`);
        return 0;
      }
      projects = (projectsOut.result?.projects ?? {}) as Record<string, { root?: string }>;
    }
    for (const [projectId, entry] of Object.entries(projects)) {
      if (args.projects.length && !args.projects.includes(projectId)) continue;
      const root = entry.root;
      if (!root || !existsSync(root)) { log(`${projectId}: root missing (${root}) — skipped`); continue; }
      const resolveOut = await client.callTool("tk_job", { verb: "resolve", directory: root }, 120_000);
      if (resolveOut.toolError || resolveOut.result?.ok === false) {
        // A bare/no-jobs project resolves clean and empty — a refusal here is real breakage.
        log(`${projectId}: resolve unavailable (${String(resolveOut.toolError ?? resolveOut.result?.error).slice(0, 300)}) — jobs unticked`);
        sawError = true;
        continue;
      }
      const declared = declaredJobsFrom(resolveOut.result ?? {});
      for (const job of declared) {
        if (job.problem) { log(`${projectId}/${job.id}: ${job.problem} — skipped`); continue; }
        if (!isSelfPaced(job.definition)) continue;
        const outcome = await tickJob(root, job, args);
        if (outcome === "error") sawError = true;
      }
      const selfPaced = declared.filter((j) => isSelfPaced(j.definition)).length;
      if (selfPaced === 0) log(`${projectId}: no self-paced jobs declared`);
    }
  } catch (e) {
    console.error(`[studio-tick] tick failed: ${e instanceof Error ? e.message : e}`);
    return 2;
  } finally {
    client.close();
  }
  return sawError ? 1 : 0;
}

if (import.meta.main) {
  // Story 33.1: an uncaught error is one explicit `uncaught:` line (the log tee files it), then exit 70.
  process.on("uncaughtException", (e) => { console.error(`uncaught: ${e instanceof Error ? e.message : String(e)}`); process.exit(70); });
  process.on("unhandledRejection", (e) => { console.error(`uncaught: ${e instanceof Error ? e.message : String(e)}`); process.exit(70); });
  main().then((code) => setTimeout(() => process.exit(code), 100));
}
