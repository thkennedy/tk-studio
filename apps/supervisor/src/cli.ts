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
 * exists, later failures are reported with it. Exit 2 the invocation or setup
 * is refused before a run exists (bad flag incl. host bypass or unknown
 * --permission-mode, missing TK_STUDIO_ROOT, contract pin, unregistered project
 * or a --directory that is not the registered root, unreadable config, a job
 * `resolve` refuses, a wake/submit refused outright or failing with no run).
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
  const t0 = Date.now();
  let started: Awaited<ReturnType<typeof startRun>>;
  try { started = await startRun(jobId, directory, permissionMode); }
  catch (e) {
    if (e instanceof StartError) throw e;
    const msg = message(e);
    // A wake/submit that timed out may still have created the run: find it.
    const found = /timed out/i.test(msg) ? await findRunSince(jobId, directory, t0) : null;
    if (found) return { ...found, reason: `wake/submit failed: ${msg}` };
    throw new StartError(msg);
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
  const projectId = typeof pid === "string" && pid ? pid : basename(root);
  const shown = await registryShow(projectId);
  const entryRoot = shown.entry?.root;
  if (typeof entryRoot !== "string" || !samePath(entryRoot, root)) {
    throw new StartError(`registry: project '${projectId}' is registered at '${entryRoot}', not at '${root}' — --directory does not match the registry entry`);
  }

  const resolved = answered(await runJobVerb(root, ["resolve", "--directory", root, "--job-id", jobId]), "resolve");
  if (Array.isArray(resolved.problems) && resolved.problems.length) {
    throw new StartError(`resolve: ${resolved.problems.join("; ")}`);
  }
  const defn = resolved.resolved as Record<string, any>;
  const guardS = Number(defn?.guards?.max_wall_clock_seconds) || 600;
  const oneShot = defn?.trigger === "one-shot";
  const woke = answered(await runJobVerb(root, oneShot
    ? ["submit", "--directory", root, "--id", jobId]
    : ["wake", "--directory", root, "--job-id", jobId], guardS + 120), oneShot ? "submit" : "wake");
  if (woke.woken !== true && woke.accepted !== true) {
    return { summary: { job_id: jobId, project_id: projectId, ok: false, run_id: null, state: "not-woken", reason: String(woke.reason ?? "refused") } };
  }
  return { jobId, root, projectId, runId: String(woke.run_id ?? ""), guardS, defn, woke, permissionMode };
}

/** After a wake/submit timeout: the newest run of this job started since `t0`, if any. */
async function findRunSince(jobId: string, directory: string, t0: number): Promise<RunSummary | null> {
  try {
    const root = resolve(directory);
    const status = await runJobVerb(root, ["status", "--directory", root, "--job-id", jobId]);
    const runs = ((status.runs ?? []) as Record<string, any>[])
      .filter((r) => typeof r.run_id === "string" && Date.parse(String(r.started)) >= t0 - 2000)
      .sort((a, b) => Date.parse(String(a.started)) - Date.parse(String(b.started)));
    const run = runs.at(-1);
    return run ? { ok: false, job_id: jobId, run_id: run.run_id, state: String(run.state ?? "unknown") } : null;
  } catch { return null; }
}

/** Once a run id is known nothing throws: failures come back as ok:false with the run id. */
async function finishRun(s: Started): Promise<RunSummary> {
  const { jobId, root, projectId, runId, guardS, defn, woke, permissionMode } = s;
  const base = { job_id: jobId, project_id: projectId, run_id: runId };
  const known = typeof woke.state === "string" ? woke.state : "unknown";

  if (defn?.target?.core || (typeof woke.state === "string" && woke.state !== "queued")) {
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
    return { ...base, ok: false, target: "skill", state: known, reason: `finish failed: ${message(e)}`, ...extras };
  }
  return { ...base, ok: state === "complete", target: "skill", state, ...(reason ? { reason } : {}), ...extras, finish };
}

const USAGE = "usage: bun src/cli.ts run <job-id> --directory <root> [--permission-mode <mode>]";

export async function main(argv: string[]): Promise<number> {
  const [cmd, jobId, ...rest] = argv;
  let directory: string | undefined, permissionMode: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--directory") directory = rest[++i];
    else if (rest[i] === "--permission-mode") permissionMode = rest[++i];
    else { console.error(`unknown argument '${rest[i]}'\n${USAGE}`); return 2; }
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
