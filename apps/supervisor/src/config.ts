/**
 * The supervisor's own per-job config (Story 21.4) — where a job's worker runs
 * and under which permission mode, decided by the supervisor, never by the
 * plugin (AD-2). Read only from `TK_SUPERVISOR_CONFIG` (unset → no config);
 * never from the plugin or a project's `.tk-studio/`.
 *
 *   jobs:
 *     "<project-id>/<job-id>":
 *       tier: host | sbx
 *       permission_mode: auto | acceptEdits | default | plan | bypassPermissions
 *       sandbox: <sbx sandbox name>
 *
 * The project id may contain spaces and `/`; the job id is what follows the
 * last `/` (non-empty). Every key is optional. A `permission_mode` applies
 * only when the run's effective tier is the entry's own `tier` (none → host). An unknown key or value, or an unreadable file, is a
 * named SupervisorConfigInvalid. A bypass mode on a host-tier job is refused
 * when the run resolves (HostBypassRefused), not here.
 */
import { readFileSync } from "node:fs";
import { load as loadYaml } from "js-yaml";
import { supervisorConfigPath } from "./env";
import { PERMISSION_MODES, TIERS, type Tier } from "./server";

export class SupervisorConfigInvalid extends Error {
  constructor(path: string, why: string) {
    super(`SupervisorConfigInvalid: TK_SUPERVISOR_CONFIG '${path}' ${why}`);
    this.name = "SupervisorConfigInvalid";
  }
}

export interface JobOptions { tier?: Tier; permission_mode?: string; sandbox?: string }
export interface SupervisorConfig { jobs: Record<string, JobOptions> }

const JOB_KEYS = ["tier", "permission_mode", "sandbox"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Load and validate the config at `path` (default: TK_SUPERVISOR_CONFIG; unset → empty). */
export function loadSupervisorConfig(
  path: string | undefined = supervisorConfigPath(), read: (p: string) => string = (p) => readFileSync(p, "utf-8"),
): SupervisorConfig {
  if (path === undefined) return { jobs: {} };
  let parsed: unknown;
  try { parsed = loadYaml(read(path)); }
  catch (e) { throw new SupervisorConfigInvalid(path, `is unreadable or not YAML (${e instanceof Error ? e.message : e})`); }
  if (parsed === undefined || parsed === null) return { jobs: {} };
  if (!isObj(parsed)) throw new SupervisorConfigInvalid(path, "is not a mapping");
  for (const k of Object.keys(parsed)) {
    if (k !== "jobs") throw new SupervisorConfigInvalid(path, `carries unknown top-level key '${k}' (only \`jobs\`)`);
  }
  const rawJobs = parsed.jobs ?? {};
  if (!isObj(rawJobs)) throw new SupervisorConfigInvalid(path, "has a `jobs` that is not a mapping");
  const jobs: Record<string, JobOptions> = {};
  for (const [key, raw] of Object.entries(rawJobs)) {
    // The project id may carry spaces (it falls back to basename(root)); the job id follows the LAST `/`.
    const slash = key.lastIndexOf("/");
    if (slash <= 0 || !key.slice(0, slash).trim() || !key.slice(slash + 1).trim()) {
      throw new SupervisorConfigInvalid(path, `has job key '${key}' — expected '<project-id>/<job-id>'`);
    }
    if (!isObj(raw)) throw new SupervisorConfigInvalid(path, `has job '${key}' that is not a mapping`);
    const opts: JobOptions = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!(JOB_KEYS as readonly string[]).includes(k)) {
        throw new SupervisorConfigInvalid(path, `job '${key}' carries unknown key '${k}' (only ${JOB_KEYS.join(", ")})`);
      }
      if (k === "tier") {
        if (typeof v !== "string" || !(TIERS as readonly string[]).includes(v)) {
          throw new SupervisorConfigInvalid(path, `job '${key}' has tier '${String(v)}' — expected ${TIERS.join("|")}`);
        }
        opts.tier = v as Tier;
      } else if (k === "permission_mode") {
        if (typeof v !== "string" || !(PERMISSION_MODES as readonly string[]).includes(v)) {
          throw new SupervisorConfigInvalid(path, `job '${key}' has permission_mode '${String(v)}' — expected ${PERMISSION_MODES.join("|")}`);
        }
        opts.permission_mode = v;
      } else {
        if (typeof v !== "string" || !v.trim()) throw new SupervisorConfigInvalid(path, `job '${key}' has a sandbox that is not a non-empty string`);
        opts.sandbox = v.trim();
      }
    }
    jobs[key] = opts;
  }
  return { jobs };
}

/** The per-job options for `<project-id>/<job-id>` (none configured → {}). */
export function jobOptions(cfg: SupervisorConfig, projectId: string, jobId: string): JobOptions {
  return cfg.jobs[`${projectId}/${jobId}`] ?? {};
}
