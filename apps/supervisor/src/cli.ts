#!/usr/bin/env bun
/**
 * Supervisor CLI — one job, woken, invoked headless, finished.
 *
 *   bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>]
 *
 * Flow: Max-login preflight → registry `show` → `resolve` → `wake` (`submit`
 * for a one-shot — `wake` refuses those) → skill target: `claude -p` then
 * `finish` | core target: `wake` already ran it, so `status` reports it.
 * Prints one JSON summary. Exit 0 the run completes. Exit 1 any other run
 * outcome, including the pre-run ones with no run id: no Max login (`blocked`)
 * and a wake/submit answered without waking (`not-woken`); once a run id
 * exists, later failures are reported with it. A wake/submit that fails after
 * the pre-wake snapshot (timeout, crash, non-JSON output) is recovered — jobrun
 * creates the run before executing it: a run of this job absent from that snapshot is
 * the one this CLI started — a non-terminal one is ended through a contract
 * verb (skill: `finish --state blocked`; core: `cancel`) and reported with its
 * run id (exit 1). Exit 2 the invocation or setup is refused before a run
 * exists (bad flag or a flag missing its value, host bypass or unknown
 * --permission-mode, missing TK_STUDIO_ROOT, contract pin, unregistered project
 * or a --directory that is not the registered root, unreadable config, a job
 * `resolve` refuses, a wake/submit refused outright, answering without a
 * run_id, or failing with no new run found).
 */
import { existsSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildWorkerCommand, finishStateFor, invokeSkill, maxLoginPreflight, MISSING_STATUS_BLOCK,
  readProjectConfig, registryShow, requireCompatible, resolveStudioRoot, runJobVerb,
} from "./server";

export interface RunSummary {
  ok: boolean;
  job_id: string;
  project_id?: string;
  run_id?: string | null;
  target?: "skill" | "core";
  state: string;
  reason?: string;
  status_block?: unknown;
  total_cost_usd?: number;
  finish?: unknown;
}

/** Raised only before a run id exists — the run could not start (exit 2). */
class StartError extends Error {}

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

export async function runJob(jobId: string, directory: string, permissionMode?: string): Promise<RunSummary> {
  let started: Awaited<ReturnType<typeof startRun>>;
  try { started = await startRun(jobId, directory, permissionMode); }
  catch (e) {
    // A wake/submit that failed may still have created the run: recover it.
    if (e instanceof WakeFailed) return recoverAfterTimeout(jobId, e.message, e.ctx);
    if (e instanceof StartError) throw e;
    throw new StartError(message(e));
  }
  if ("summary" in started) return started.summary;
  return finishRun(started);
}

interface Started {
  jobId: string; root: string; projectId: string; runId: string; guardS: number;
  defn: Record<string, any>; woke: Record<string, any>; permissionMode?: string;
}

/** Everything before a run id exists. Any throw here means no run started. */
async function startRun(jobId: string, directory: string, permissionMode?: string): Promise<Started | { summary: RunSummary }> {
  resolveStudioRoot(); // StudioRootMissing when TK_STUDIO_ROOT is unset (AD-15)
  requireCompatible(); // the contract version pin, before any verb runs
  const root = resolve(directory);
  if (!existsSync(root)) throw new StartError(`directory does not exist: ${directory}`);
  // A host bypass is refused before anything starts (AD-2 ruling).
  buildWorkerCommand({ prompt: "", permissionMode });

  const login = await maxLoginPreflight();
  if (login) return { summary: { ok: false, job_id: jobId, run_id: null, state: "blocked", reason: login } };

  const cfg = readProjectConfig(root);
  if (cfg.unreadable) throw new StartError(`project config unreadable: ${cfg.unreadable}`);
  const pid = cfg.config.project_id;
  // The studio's identity is str(project_id): a numeric id is still the id.
  const projectId = (typeof pid === "string" || typeof pid === "number") && String(pid) ? String(pid) : basename(root);
  const shown = await registryShow(projectId);
  const entryRoot = shown.entry?.root;
  if (typeof entryRoot !== "string" || !samePath(entryRoot, root)) {
    throw new StartError(`registry: project '${projectId}' is registered at '${entryRoot}', not at '${root}' — --directory does not match the registry entry`);
  }

  const resolved = answered(await runJobVerb(root, ["resolve", "--directory", root, "--job-id", jobId]), "resolve");
  if (Array.isArray(resolved.problems) && resolved.problems.length) {
    throw new StartError(`resolve: ${resolved.problems.join("; ")}`);
  }
  if (!resolved.resolved || typeof resolved.resolved !== "object") {
    throw new StartError(`resolve: served no merged definition for '${jobId}'`);
  }
  const defn = resolved.resolved as Record<string, any>;
  const guardS = Number(defn?.guards?.max_wall_clock_seconds) || 600;
  const oneShot = defn?.trigger === "one-shot";
  const verb = oneShot ? "submit" : "wake";
  const target: Target = isCore(defn) ? "core" : "skill";

  // The runs this job already has: a failed wake/submit may only ever
  // adopt a run absent from this snapshot (one this CLI started).
  let before: Set<string>;
  try {
    const snap = answered(await runJobVerb(root, ["status", "--directory", root, "--job-id", jobId]), "status");
    before = new Set(((snap.runs ?? []) as Record<string, any>[])
      .map((r) => r.run_id).filter((id): id is string => typeof id === "string"));
  } catch (e) { throw new StartError(`status (pre-${verb} snapshot): ${message(e)}`); }

  const timeoutS = guardS + 120;
  let out: Record<string, any>;
  try {
    out = await runJobVerb(root, oneShot
      ? ["submit", "--directory", root, "--id", jobId]
      : ["wake", "--directory", root, "--job-id", jobId], timeoutS);
  } catch (e) {
    // jobrun creates the run before executing it: ANY failure here (timeout,
    // crash, non-JSON output) may have left one behind — recover, never assume.
    throw new WakeFailed(message(e), { root, projectId, target, verb, timeoutS, before });
  }
  const woke = answered(out, verb);
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

/** Once a run id is known nothing throws: failures come back as ok:false with the run id. */
async function finishRun(s: Started): Promise<RunSummary> {
  const { jobId, root, projectId, runId, guardS, defn, woke, permissionMode } = s;
  const base = { job_id: jobId, project_id: projectId, run_id: runId };
  const known = typeof woke.state === "string" ? woke.state : "unknown";

  if (isCore(defn) || (typeof woke.state === "string" && woke.state !== "queued")) {
    // Core target: `wake` executed it and ended the run — no worker, no finish.
    let status: Record<string, any>;
    try { status = answered(await runJobVerb(root, ["status", "--directory", root, "--job-id", jobId, "--run-id", runId]), "status"); }
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
    const out = await invokeSkill(root, directive.skill, {
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
    finish = answered(await runJobVerb(root, [
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
      const status = answered(await runJobVerb(root, ["status", "--directory", root, "--job-id", jobId, "--run-id", runId]), "status");
      const run = (status.runs ?? [])[0];
      if (typeof run?.state === "string") actual = run.state;
    } catch { /* stays unknown */ }
    return { ...base, ok: false, target: "skill", state: actual, reason: `finish failed: ${message(e)}`, ...extras };
  }
  return { ...base, ok: state === "complete", target: "skill", state, ...(reason ? { reason } : {}), ...extras, finish };
}

const USAGE = "usage: bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>]";

export async function main(argv: string[]): Promise<number> {
  const [cmd, jobId, ...rest] = argv;
  let directory: string | undefined, permissionMode: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag !== "--directory" && flag !== "--permission-mode") { console.error(`unknown argument '${flag}'\n${USAGE}`); return 2; }
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) { console.error(`${flag} needs a value\n${USAGE}`); return 2; }
    if (flag === "--directory") directory = value; else permissionMode = value;
  }
  if (cmd !== "run" || !jobId || !directory) { console.error(USAGE); return 2; }
  try {
    const summary = await runJob(jobId, directory, permissionMode);
    console.log(JSON.stringify(summary, null, 2));
    return summary.ok ? 0 : 1;
  } catch (e) {
    // runJob throws only before a run id exists: every such error is a start failure (exit 2).
    const error = message(e);
    const state = error.startsWith("HostBypassRefused") ? "blocked" : "not-started";
    console.log(JSON.stringify({ ok: false, job_id: jobId, run_id: null, state, error }, null, 2));
    return e instanceof StartError ? 2 : 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
