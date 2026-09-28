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

// ------------------------------------------------------------ the HTTP API (Story 22.1)
//
//   TK_SUPERVISOR_BIND   the Tailscale address the API binds (required; inside 100.64.0.0/10 —
//                        checked by api.ts `checkBind`)
//   TK_SUPERVISOR_PORT   the API's port (optional, default 8787)
//   TK_SUPERVISOR_TOKEN  the bearer token (required) — never logged, never rendered

/** The default API port (operator-decisions §2). */
export const DEFAULT_API_PORT = 8787;

export class ApiBindMissing extends Error {
  constructor() {
    super("ApiBindMissing: TK_SUPERVISOR_BIND is not set — name the Tailscale address (inside 100.64.0.0/10) the API binds");
    this.name = "ApiBindMissing";
  }
}

export class ApiPortInvalid extends Error {
  constructor(value: string) {
    super(`ApiPortInvalid: TK_SUPERVISOR_PORT '${value}' is not a port number (1-65535)`);
    this.name = "ApiPortInvalid";
  }
}

/** Never carries the token's value: only that it is missing. */
export class ApiTokenMissing extends Error {
  constructor() {
    super("ApiTokenMissing: TK_SUPERVISOR_TOKEN is not set or empty — the API refuses to start without a bearer token");
    this.name = "ApiTokenMissing";
  }
}

/** The address the API binds, as set (unchecked here: `checkBind` refuses a non-tailnet address). */
export function apiBind(env: Env = process.env): string {
  const bind = env.TK_SUPERVISOR_BIND?.trim();
  if (!bind) throw new ApiBindMissing();
  return bind;
}

/** The API port: TK_SUPERVISOR_PORT when set (a port number, else ApiPortInvalid), else 8787. */
export function apiPort(env: Env = process.env): number {
  const raw = env.TK_SUPERVISOR_PORT;
  if (raw === undefined) return DEFAULT_API_PORT;
  const v = raw.trim();
  const n = Number(v);
  if (!/^\d{1,5}$/.test(v) || !Number.isInteger(n) || n < 1 || n > 65535) throw new ApiPortInvalid(raw);
  return n;
}

/** The bearer token (required, non-empty). */
export function apiToken(env: Env = process.env): string {
  const token = env.TK_SUPERVISOR_TOKEN?.trim();
  if (!token) throw new ApiTokenMissing();
  return token;
}
