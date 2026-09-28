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
 * Per job, per tick:
 *   - skip while a run is queued/running (no overlap) or while the
 *     `hint_seconds` pacing window since the last run hasn't elapsed
 *     (both read via `tk_job status`);
 *   - otherwise wake → invoke → finish through the queue-backed `runJob`
 *     (src/cli.ts, Story 21.3; `skipRecover`: the tick already recovered):
 *     the queue mints idempotently (a racing wake gets the existing run),
 *     the run takes the checkout lock before `wake` (a live holder leaves it
 *     `queued`, logged as a skip). A queued run recorded with an explicit
 *     permission mode is driven under it. `woken: false` is an answer (stop
 *     condition), not an error. A core-target job executes inside wake under
 *     the job's own `max_wall_clock_seconds` guard (uncapped: the wake
 *     verb's timeout is that guard + 120 s); a skill-target job is invoked
 *     headless under that guard capped at --timeout-cap-s and finished with
 *     its §3 block.
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
import { queueDbPath } from "./queue";

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

interface StatusRun {
  run_id?: string;
  state?: string;
  started?: string;
  ended?: string;
  created?: string;
}

/** Pace one self-paced job from its §4 status rows: never overlap a live run;
 * honor hint_seconds since the last run's end (the hint is the studio's pacing
 * request — the substrate decides, and this substrate honors it). */
export function shouldWake(defn: Record<string, any>, runs: StatusRun[], nowMs: number): WakeDecision {
  const live = runs.find((r) => r.state === "queued" || r.state === "running");
  if (live) return { wake: false, reason: `run ${live.run_id ?? "?"} still ${live.state} — no overlap` };
  const hintS = defn?.cadence?.hint_seconds;
  if (typeof hintS === "number" && hintS > 0) {
    const lastMs = runs
      .map((r) => Date.parse(r.ended ?? r.started ?? r.created ?? ""))
      .filter((t) => Number.isFinite(t))
      .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
    if (Number.isFinite(lastMs) && nowMs - lastMs < hintS * 1000) {
      const remainingH = ((hintS * 1000 - (nowMs - lastMs)) / 3_600_000).toFixed(1);
      return { wake: false, reason: `hint_seconds pacing: ${remainingH}h remaining` };
    }
  }
  return { wake: true, reason: runs.length ? "pacing window elapsed" : "no prior runs" };
}

// ------------------------------------------------------------ directive execution (§3 → run state)

/** The §4 KB-injection directive riding an invoke-skill directive (contract
 * 1.7.0): forwarded to tk_invoke verbatim when shaped like an object — the
 * connector reads the named spine/seed artifacts and injects them into the
 * segment prompt (aid, not gate; the injection act is driver-side, AD-2). */
export function knowledgeOf(directive: Record<string, any> | undefined): Record<string, any> | undefined {
  const k = directive?.knowledge;
  return k && typeof k === "object" && !Array.isArray(k) ? (k as Record<string, any>) : undefined;
}

export interface FinishArgs {
  state: "complete" | "partial" | "blocked";
  reason?: string;
  status_block?: Record<string, unknown>;
}

/** Map a tk_invoke outcome onto the run's terminal state per §3/§4: the
 * block's own status wins; a timeout is the wall-clock guard (partial, guard
 * named); anything without a block is a refusal to guess (blocked). */
export function finishArgsFor(outcome: { toolError?: string; result?: Record<string, any> }, guardS: number): FinishArgs {
  if (outcome.toolError) {
    if (/timed out/i.test(outcome.toolError)) {
      return { state: "partial", reason: `guard: max_wall_clock_seconds (${guardS}s)` };
    }
    return { state: "blocked", reason: `driver error: ${outcome.toolError.slice(0, 300)}` };
  }
  const r = outcome.result ?? {};
  const block = r.status_block as Record<string, unknown> | undefined;
  const status = block && typeof block.status === "string" ? block.status : undefined;
  if (status === "complete" || status === "partial" || status === "blocked") {
    const reason = typeof block!.reason === "string" ? (block!.reason as string) : undefined;
    return { state: status, ...(reason ? { reason } : {}), status_block: block };
  }
  return { state: "blocked", reason: String(r.conformance_failure ?? "run terminated without a §3 status block") };
}

// ------------------------------------------------------------ tick

interface Args {
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

async function tickJob(
  client: ConnectorClient, root: string, job: DeclaredJob, args: Args,
): Promise<"woken" | "skipped" | "refused" | "error"> {
  const defn = job.definition!;
  const statusOut = await client.callTool("tk_job", { verb: "status", directory: root, job_id: job.id }, 120_000);
  let runs: StatusRun[] = [];
  if (statusOut.toolError || statusOut.result?.ok === false) {
    // No runs yet reads as an unknown-id refusal on some paths — wake decides for real.
    log(`${job.id}: status unavailable (${statusOut.toolError ?? statusOut.result?.error}) — deferring to wake`);
  } else {
    runs = (statusOut.result?.runs as StatusRun[] | undefined) ?? [];
  }

  const decision = shouldWake(defn, runs, Date.now());
  if (!decision.wake) {
    log(`${job.id}: skip — ${decision.reason}`);
    return "skipped";
  }
  if (args.dryRun) {
    log(`${job.id}: would wake (${decision.reason}) [dry-run]`);
    return "skipped";
  }

  // Wake → invoke → finish through the queue-backed runJob (Story 21.3):
  // idempotent minting, one engine per checkout. The restart rule already ran
  // once at the start of this tick. The skill invocation's guard is capped at
  // --timeout-cap-s; the wake verb keeps the job's own guard.
  let summary: RunSummary;
  try { summary = await runJob(job.id, root, undefined, { guardCapS: args.timeoutCapS, skipRecover: true }); }
  catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
    // A refusal (registry `show`/`resolve`/`wake` answering ok:false, problems[]): no studio run — refused, not an error.
    if (e instanceof StartError && e.refused) { log(`${job.id}: refused — ${msg}`); return "refused"; }
    log(`${job.id}: run could not start — ${msg}`);
    return "error";
  }
  const where = `run ${summary.run_id ?? "-"}${summary.studio_run_id ? ` (studio ${summary.studio_run_id})` : ""}`;
  log(`${job.id}: ${where} ${summary.state}${summary.reason ? ` — ${summary.reason.slice(0, 200)}` : ""}`);
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
        const outcome = await tickJob(client, root, job, args);
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
  main().then((code) => setTimeout(() => process.exit(code), 100));
}
