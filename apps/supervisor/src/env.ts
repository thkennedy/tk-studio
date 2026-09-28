/**
 * Environment-only resolution of the studio seams (AD-15). No machine path is
 * ever hard-coded: the studio root, the per-user store, and the worker binary
 * all come from the environment.
 *
 *   TK_STUDIO_ROOT  the tk-studio repo root (required) — plugin root is
 *                   $TK_STUDIO_ROOT/plugins/tk-studio
 *   TK_STUDIO_HOME  the per-user store override — passed through to every
 *                   child untouched, never read or defaulted here
 *   CLAUDE_BIN      the worker binary (default `claude`)
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
