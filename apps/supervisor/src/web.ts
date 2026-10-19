/**
 * The studio web's files (Story 30.2): where the built web lives, which file a `/app` path names, and its
 * content type. One resolver, shared by the `/app` route (`api.ts`) and the read-only page's not-built note
 * (`page.ts`).
 *
 * The web's root, per request, in order:
 *   1. `opts.dir` (tests, and an explicit override): the only candidate when given.
 *   2. The installed slot: the supervisor runs from `<root>/supervisor/<ver>/src`, so `<root>/current.json`'s
 *      `"studio-web": {version, path}` entry (written by the installer) points at the web slot.
 *   3. The source checkout: `apps/studio-web/dist` beside `apps/supervisor`.
 * Both 2 and 3 are found from the supervisor's `src` directory (`opts.appDir`, default this module's own).
 * A root counts as built when it holds `index.html` (the release zip's root is `dist`'s contents).
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve, sep } from "node:path";

/** The build command the 503 `WebNotBuilt` answer and the page's note name. */
export const WEB_BUILD_COMMAND = "cd apps/studio-web && bun install --frozen-lockfile && bun run build";

export interface WebOptions {
  /** The web's root (tests, an explicit override); when given, the only candidate. */
  dir?: string;
  /** The supervisor's `src` directory the slot and checkout candidates are found from (default: this module's). */
  appDir?: string;
}

const built = (root: string) => {
  try { return statSync(join(root, "index.html")).isFile(); } catch { return false; }
};

/** The installed slot's web root from `<root>/current.json` (`"studio-web".path`), or null. */
function slotRoot(appDir: string): string | null {
  const current = join(appDir, "..", "..", "..", "current.json");
  if (!existsSync(current)) return null;
  try {
    const entry = JSON.parse(readFileSync(current, "utf-8"))?.["studio-web"];
    const path = entry && typeof entry === "object" ? entry.path : undefined;
    if (typeof path !== "string" || !path) return null;
    return isAbsolute(path) ? path : resolve(join(current, ".."), path);
  } catch { return null; }
}

/** The built web's root, or null when no candidate holds `index.html`. */
export function webRoot(opts: WebOptions = {}): string | null {
  if (opts.dir !== undefined) return built(opts.dir) ? opts.dir : null;
  const appDir = opts.appDir ?? import.meta.dir;
  for (const root of [slotRoot(appDir), join(appDir, "..", "..", "studio-web", "dist")]) {
    if (root && built(root)) return root;
  }
  return null;
}

export type WebPath = { file: string } | { fallback: string } | { refused: true };

/** A `/app` path (`/app` or `/app/…`, its encoding kept) → the file under `root`, the single-page fallback
 * (`index.html`, for a path with no file), or refused (never the fallback). Each segment after `/app` is
 * decoded; a decode error, an empty segment (`//`), `.`, `..`, or a segment holding `/`, `\`, `:` or NUL is
 * refused, and the resolved path must stay under the root (compared case-folded on Windows) — textually, and then
 * by its real path, so a symlink inside the root cannot lead outside it. */
export function resolveWebPath(root: string, urlPath: string): WebPath {
  const index = join(root, "index.html");
  if (urlPath !== "/app" && !urlPath.startsWith("/app/")) return { refused: true };
  const rest = urlPath.slice("/app".length).replace(/^\//, "");
  if (rest === "") return { fallback: index };
  const segments: string[] = [];
  for (const raw of rest.split("/")) {
    let seg: string;
    try { seg = decodeURIComponent(raw); } catch { return { refused: true }; }
    if (seg === "" || seg === "." || seg === ".." || /[/\\:\0]/.test(seg)) return { refused: true };
    segments.push(seg);
  }
  const base = resolve(root);
  const target = resolve(base, ...segments);
  const fold = (p: string) => process.platform === "win32" ? p.toLowerCase() : p;
  if (isAbsolute(segments.join("/")) || !fold(target).startsWith(fold(base.endsWith(sep) ? base : base + sep))) return { refused: true };
  let isFile = false;
  try { isFile = statSync(target).isFile(); } catch { /* no file: the fallback */ }
  if (!isFile) return { fallback: index };
  let real: string, realBase: string;
  try { real = realpathSync(target); realBase = realpathSync(base); } catch { return { refused: true }; }
  if (!fold(real).startsWith(fold(realBase.endsWith(sep) ? realBase : realBase + sep))) return { refused: true };
  return { file: target };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/** A file's content type by its extension; unknown is `application/octet-stream`. */
export function contentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}
