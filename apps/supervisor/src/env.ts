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
 *   GH_BIN          the GitHub CLI (default `gh`) a run's close-out pushes its PR through (Story 27.1)
 *   TK_SUPERVISOR_CONFIG  the supervisor's own per-job config file (optional:
 *                   unset → no config, every job defaults to the host tier);
 *                   never read from the plugin or a project's .tk-studio/
 */
import { accessSync, constants, statSync } from "node:fs";
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

/** The GitHub CLI (Story 27.1: the default-branch protection check and the run's PR). */
export function ghBin(env: Env = process.env): string {
  return env.GH_BIN?.trim() || "gh";
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
//   TK_SUPERVISOR_ENGINE_MCP_PORT  Story 34.5: the engine MCP forwarder's port on TK_SUPERVISOR_BIND (optional,
//                        default 8788)

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

/** Story 34.5: the engine MCP forwarder's documented fixed port (operator-decisions §2: nothing else listens in the
 * 8000 range). Story 35.4: no longer the default — set TK_SUPERVISOR_ENGINE_MCP_PORT=8788 to keep it fixed. */
export const DEFAULT_ENGINE_MCP_PORT = 8788;

/** Story 34.5: the port the engine MCP forwarder binds on TK_SUPERVISOR_BIND — TK_SUPERVISOR_ENGINE_MCP_PORT when set
 * (a port number, else an error naming the variable; the forwarder fixed, one flagged run at a time). Story 35.4:
 * unset or blank answers 0, a per-run port (the forwarder binds `:0` and reports the port it got). */
export function engineMcpPort(env: Env = process.env): number {
  const raw = env.TK_SUPERVISOR_ENGINE_MCP_PORT;
  if (raw === undefined || !raw.trim()) return 0;
  const v = raw.trim();
  const n = Number(v);
  if (!/^\d{1,5}$/.test(v) || !Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`TK_SUPERVISOR_ENGINE_MCP_PORT '${raw}' is not a port number (1-65535)`);
  }
  return n;
}

/** The bearer token (required, non-empty). */
export function apiToken(env: Env = process.env): string {
  const token = env.TK_SUPERVISOR_TOKEN?.trim();
  if (!token) throw new ApiTokenMissing();
  return token;
}

// ------------------------------------------------------------ phone sign-in (Story 22.5)
//
//   TK_SUPERVISOR_SESSION_SECRET  signs the browser's session cookie (required by `serve`; at least
//                                 32 bytes) — never logged, never rendered, never in a worker's env
//   TK_SUPERVISOR_TLS_CERT        the `tailscale cert` certificate file  } all three or none: with them
//   TK_SUPERVISOR_TLS_KEY         its key file                           } `serve` answers https on the
//   TK_SUPERVISOR_TLS_NAME        the machine's MagicDNS name            } same bind
//                                 `serve` checks the cert and key files are readable before it binds.
//
// Story 29.1: the owner's one account (username, argon2id hash, created_at) lives in the per-user store at
// `<TK_STUDIO_HOME or ~/.tk-studio>/supervisor/account.json` (`account.ts`), never in the environment, a
// checkout or the queue file. The Google and GitHub providers are gone: a provider variable still set is
// ignored, and `serve` warns once per name (`oauthLeftovers`), never its value.
//
// Every error names variables only, never a value.

/** Never carries the secret's value: only that it is missing. */
export class SessionSecretMissing extends Error {
  constructor() {
    super("SessionSecretMissing: TK_SUPERVISOR_SESSION_SECRET is not set or empty — the API refuses to start without the session cookie's signing secret");
    this.name = "SessionSecretMissing";
  }
}

/** The minimum session secret length, in UTF-8 bytes after trimming. */
export const SESSION_SECRET_MIN_BYTES = 32;

/** Never carries the secret's value: only that it is too short. */
export class SessionSecretWeak extends Error {
  constructor() {
    super(`SessionSecretWeak: TK_SUPERVISOR_SESSION_SECRET is shorter than ${SESSION_SECRET_MIN_BYTES} bytes — set a random secret of at least ${SESSION_SECRET_MIN_BYTES} bytes`);
    this.name = "SessionSecretWeak";
  }
}

export class TlsConfigIncomplete extends Error {
  constructor(missing: string[]) {
    super(`TlsConfigIncomplete: set all of TK_SUPERVISOR_TLS_CERT, TK_SUPERVISOR_TLS_KEY and TK_SUPERVISOR_TLS_NAME, or none — ${missing.join(", ")} not set or empty`);
    this.name = "TlsConfigIncomplete";
  }
}

/** Names the variable whose file is missing or unreadable, never its value (the path). */
export class TlsCertUnreadable extends Error {
  constructor(variable: string) {
    super(`TlsCertUnreadable: the file ${variable} names is missing or unreadable — run \`tailscale cert\` first, then set the TLS variables`);
    this.name = "TlsCertUnreadable";
  }
}

/** The session cookie's signing secret (required, at least 32 UTF-8 bytes after trimming). */
export function sessionSecret(env: Env = process.env): string {
  const secret = env.TK_SUPERVISOR_SESSION_SECRET?.trim();
  if (!secret) throw new SessionSecretMissing();
  if (Buffer.byteLength(secret, "utf-8") < SESSION_SECRET_MIN_BYTES) throw new SessionSecretWeak();
  return secret;
}

export interface TlsConfig { cert: string; key: string; name: string }

/** The Tailscale certificate: all three variables, or null when none is set (http, as in 22.1). */
export function tlsConfig(env: Env = process.env): TlsConfig | null {
  const names = ["TK_SUPERVISOR_TLS_CERT", "TK_SUPERVISOR_TLS_KEY", "TK_SUPERVISOR_TLS_NAME"] as const;
  const values = names.map((n) => env[n]?.trim() ?? "");
  const missing = names.filter((_, i) => !values[i]);
  if (missing.length === names.length) return null;
  if (missing.length) throw new TlsConfigIncomplete([...missing]);
  return { cert: values[0], key: values[1], name: values[2] };
}

/** The certificate and key files exist as files and are readable (else TlsCertUnreadable, naming the variable). */
export function checkTlsFiles(tls: TlsConfig): void {
  for (const [variable, path] of [["TK_SUPERVISOR_TLS_CERT", tls.cert], ["TK_SUPERVISOR_TLS_KEY", tls.key]] as const) {
    try {
      if (!statSync(path).isFile()) throw new Error("not a file");
      accessSync(path, constants.R_OK);
    } catch {
      throw new TlsCertUnreadable(variable);
    }
  }
}

/** Story 29.1: the `TK_SUPERVISOR_OAUTH_*` names still set (non-empty) — ignored, each warned once at start. */
export function oauthLeftovers(env: Env = process.env): string[] {
  return Object.keys(env).filter((k) => /^TK_SUPERVISOR_OAUTH_/.test(k) && (env[k]?.trim() ?? "") !== "").sort();
}

// ------------------------------------------------------------ run hygiene (Story 22.3)
//
//   TK_SUPERVISOR_NOTIFY          which notifier runs on every terminal run: `ntfy` | `telegram`;
//                                 unset → none (the run's events record that none was configured)
//   TK_SUPERVISOR_NTFY_URL        the full ntfy topic URL (with `ntfy`)
//   TK_SUPERVISOR_TELEGRAM_TOKEN  the Telegram bot token (with `telegram`) — never logged, never rendered
//   TK_SUPERVISOR_TELEGRAM_CHAT   the Telegram chat id (with `telegram`)
//   TK_SUPERVISOR_WORK            the work folder holding editor-in-the-loop snapshots (for a flagged run)
//                                 and every run's git worktree (Story 27.1: required for every run)

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

/** No work folder: a flagged (editor-in-the-loop) submission is refused before anything is queued
 * (`snapshot`); a claimed run ends `blocked` before its worktree is cut (`worktree`, Story 27.1). */
export class WorkDirMissing extends Error {
  constructor(need: "snapshot" | "worktree" = "snapshot") {
    super(need === "worktree"
      ? "WorkDirMissing: TK_SUPERVISOR_WORK is not set — every run needs the work folder its git worktree is cut under (<work>/worktrees/<project>/<run id>)"
      : "WorkDirMissing: TK_SUPERVISOR_WORK is not set — an editor-in-the-loop run needs the work folder its snapshot lands in");
    this.name = "WorkDirMissing";
  }
}

/** The work folder snapshots and worktrees land under, or undefined when unset. */
export function workDir(env: Env = process.env): string | undefined {
  return env.TK_SUPERVISOR_WORK?.trim() || undefined;
}
