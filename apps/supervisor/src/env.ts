/**
 * Environment-only resolution of the studio seams (AD-15). No machine path is
 * ever hard-coded: the studio root, the per-user store, and the worker binary
 * all come from the environment.
 *
 *   TK_STUDIO_ROOT  the tk-studio repo root (required) — plugin root is
 *                   $TK_STUDIO_ROOT/plugins/tk-studio
 *   TK_STUDIO_HOME  the per-user store override — passed through to every
 *                   child untouched; read only by `studioHome` (the status
 *                   page's read-only view of the store, Story 22.2)
 *   CLAUDE_BIN      the host worker binary (default `claude`); host-only — the
 *                   sbx worker is always `claude` inside the microVM
 *   SBX_BIN         the host Docker Sandboxes CLI (default `sbx`) for sbx-tier runs
 *   TK_SUPERVISOR_CONFIG  the supervisor's own per-job config file (optional:
 *                   unset → no config, every job defaults to the host tier);
 *                   never read from the plugin or a project's .tk-studio/
 */
import { homedir } from "node:os";
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

/** The per-user store root: TK_STUDIO_HOME when set, else `~/.tk-studio`. */
export function studioHome(env: Env = process.env): string {
  return env.TK_STUDIO_HOME?.trim() || join(homedir(), ".tk-studio");
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

// ------------------------------------------------------------ run hygiene (Story 22.3)
//
//   TK_SUPERVISOR_NOTIFY          which notifier runs on every terminal run: `ntfy` | `telegram`;
//                                 unset → none (the run's events record that none was configured)
//   TK_SUPERVISOR_NTFY_URL        the full ntfy topic URL (with `ntfy`)
//   TK_SUPERVISOR_TELEGRAM_TOKEN  the Telegram bot token (with `telegram`) — never logged, never rendered
//   TK_SUPERVISOR_TELEGRAM_CHAT   the Telegram chat id (with `telegram`)
//   TK_SUPERVISOR_WORK            the work folder holding editor-in-the-loop snapshots (for a flagged run)

/** The notifier the environment selects: none, ntfy (its topic URL) or Telegram (bot token + chat). */
export type Notifier =
  | { kind: "none" }
  | { kind: "ntfy"; url: string }
  | { kind: "telegram"; token: string; chat: string };

/** `TK_SUPERVISOR_NOTIFY` names no known notifier. */
export class NotifierUnknown extends Error {
  constructor(value: string) {
    super(`NotifierUnknown: TK_SUPERVISOR_NOTIFY '${value}' is not a notifier (ntfy, telegram, or unset for none)`);
    this.name = "NotifierUnknown";
  }
}

/** A selected notifier missing one of its variables. Names the variable, never a value. */
export class NotifierConfigMissing extends Error {
  constructor(notifier: string, variable: string) {
    super(`NotifierConfigMissing: TK_SUPERVISOR_NOTIFY=${notifier} needs ${variable}, which is not set or empty`);
    this.name = "NotifierConfigMissing";
  }
}

/** The notifier, validated: unset → none; a selected notifier needs its own variables (a named start error). */
export function notifier(env: Env = process.env): Notifier {
  const kind = env.TK_SUPERVISOR_NOTIFY?.trim();
  if (!kind) return { kind: "none" };
  if (kind === "ntfy") {
    const url = env.TK_SUPERVISOR_NTFY_URL?.trim();
    if (!url) throw new NotifierConfigMissing(kind, "TK_SUPERVISOR_NTFY_URL");
    return { kind, url };
  }
  if (kind === "telegram") {
    const token = env.TK_SUPERVISOR_TELEGRAM_TOKEN?.trim();
    if (!token) throw new NotifierConfigMissing(kind, "TK_SUPERVISOR_TELEGRAM_TOKEN");
    const chat = env.TK_SUPERVISOR_TELEGRAM_CHAT?.trim();
    if (!chat) throw new NotifierConfigMissing(kind, "TK_SUPERVISOR_TELEGRAM_CHAT");
    return { kind, token, chat };
  }
  throw new NotifierUnknown(kind);
}

/** A flagged (editor-in-the-loop) submission with no work folder: refused before anything is queued. */
export class WorkDirMissing extends Error {
  constructor() {
    super("WorkDirMissing: TK_SUPERVISOR_WORK is not set — an editor-in-the-loop run needs the work folder its snapshot lands in");
    this.name = "WorkDirMissing";
  }
}

/** The work folder snapshots land under, or undefined when unset. */
export function workDir(env: Env = process.env): string | undefined {
  return env.TK_SUPERVISOR_WORK?.trim() || undefined;
}
