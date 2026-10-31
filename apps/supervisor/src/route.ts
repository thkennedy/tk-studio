/**
 * Story 36.7 (DW-85): a project's shipped-defaults route, in a leaf so `hostverify.ts` reads it without the dynamic
 * import of `registry.ts` (which reaches hostverify through `office.ts` and `board.ts`). Re-exported from `registry.ts`.
 */
import { join } from "node:path";
import { pluginRoot } from "./env";
import { lastJsonObject, runUv } from "./server";

export type Route = Record<string, unknown>;

export class RouteResolveFailed extends Error {
  constructor(readonly project: string, detail: string) {
    super(`RouteResolveFailed: ${project}: ${detail}`);
    this.name = "RouteResolveFailed";
  }
}

/** A project's shipped-defaults route: `pipeline.py resolve --directory <root>` through `uv` (the `registryShow`
 * pattern). No JSON or `ok: false` throws the named RouteResolveFailed. */
export async function resolveRoute(root: string, projectId: string): Promise<Route> {
  let res;
  try { res = await runUv(root, join(pluginRoot(), "lib", "pipeline.py"), ["resolve", "--directory", root]); }
  catch (e) { throw new RouteResolveFailed(projectId, e instanceof Error ? e.message : String(e)); }
  const parsed = lastJsonObject(res.stdout) as Record<string, any> | null;
  if (parsed === null) throw new RouteResolveFailed(projectId, `resolve emitted no JSON (exit ${res.exit}): ${res.stderr.slice(0, 400)}`);
  if (parsed.ok !== true) throw new RouteResolveFailed(projectId, String(parsed.error ?? "resolve refused"));
  const route = parsed.route;
  if (!route || typeof route !== "object" || Array.isArray(route)) throw new RouteResolveFailed(projectId, "resolve answered no route");
  return route as Route;
}
