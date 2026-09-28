/**
 * Environment-only resolution of the studio seams (AD-15). No machine path is
 * ever hard-coded: the studio root, the per-user store, and the worker binary
 * all come from the environment.
 *
 *   TK_STUDIO_ROOT  the tk-studio repo root (required) — plugin root is
 *                   $TK_STUDIO_ROOT/plugins/tk-studio
 *   TK_STUDIO_HOME  the per-user store override — passed through to every
 *                   child untouched, never read or defaulted here
 *   CLAUDE_BIN      the host worker binary (default `claude`); host-only — the
 *                   sbx worker is always `claude` inside the microVM
 *   SBX_BIN         the host Docker Sandboxes CLI (default `sbx`) for sbx-tier runs
 *   TK_SUPERVISOR_CONFIG  the supervisor's own per-job config file (optional:
 *                   unset → no config, every job defaults to the host tier);
 *                   never read from the plugin or a project's .tk-studio/
 */
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export class StudioRootMissing extends Error {
  constructor() {
    super("StudioRootMissing: TK_STUDIO_ROOT is not set — point it at the tk-studio repo root (AD-15)");
    this.name = "StudioRootMissing";
  }
}

export function studioRoot(env: Env = process.env): string {
  const root = env.TK_STUDIO_ROOT?.trim();
  if (!root) throw new StudioRootMissing();
  return root;
}

export function pluginRoot(env: Env = process.env): string {
  return join(studioRoot(env), "plugins", "tk-studio");
}

export function claudeBin(env: Env = process.env): string {
  return env.CLAUDE_BIN?.trim() || "claude";
}

export function sbxBin(env: Env = process.env): string {
  return env.SBX_BIN?.trim() || "sbx";
}

/** The supervisor's per-job config path, or undefined when unset (no config). */
export function supervisorConfigPath(env: Env = process.env): string | undefined {
  return env.TK_SUPERVISOR_CONFIG?.trim() || undefined;
}
