/**
 * The agent registry (Story 29.2, design spec §7.2): the agents the supervisor can run per project, derived into
 * the queue file's `agents` table so the web, a driver and the operator name the same agents by the same ids.
 *
 * Derived only: the projects are the host registry's (`registry.py show`, the published read path), each
 * project's route is `pipeline.py resolve --directory <root>` (the shipped defaults when no story is live) or,
 * while a run is live, the run's `.bmad-loop/routing.current.json`. The table is rebuilt whole on `recover`
 * (every tick) and on every claim and end (`cli.ts` `rebuildQuietly`); it is never edited by hand, and the plugin
 * and onboarding are unchanged. No HTTP and no page here: `api.ts` serves `GET /agents`, `page.ts` the section.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginRoot } from "./env";
import { officeStates } from "./office";
import { servedRoot, type AgentRecord, type Queue, type QueueRun } from "./queue";
import { lastJsonObject, registryShow, runUv } from "./server";

/** The seven roles (closed by the story), in the order every read lists them. */
export const ROLES = ["orchestrator", "session", "implementer", "reviewer", "consult", "advisor", "planner"] as const;
export type Role = typeof ROLES[number];

/** The one role → leg mapping (contract §5.1 legs; the planner's ruling). `take: "leg"`: the leg's own model,
 * effort and advisor. `take: "advisor"`: the leg's `advisor` field as the model, effort and advisor `null`
 * (there is no `advisor` leg: it is a field of every leg). The legs `seam`, `review` and `triage` map to no role. */
export const ROLE_LEGS: Readonly<Record<Role, { leg: string; take: "leg" | "advisor" }>> = {
  orchestrator: { leg: "supervise", take: "leg" },
  session: { leg: "session", take: "leg" },
  implementer: { leg: "implementer", take: "leg" },
  reviewer: { leg: "reviewers", take: "leg" },
  consult: { leg: "consult", take: "leg" },
  advisor: { leg: "session", take: "advisor" },
  planner: { leg: "planner", take: "leg" },
};

/** A row's `live_state` when the office projection names none for its role (Story 29.3: no run, or no projection). */
export const OFFLINE = "offline";

/** A route: `{<leg>: {model, effort?, advisor?, …}}` — `pipeline.py resolve`'s `route`, or the top-level legs of
 * `routing.current.json`. */
export type Route = Record<string, unknown>;

/** The live leg of a project: the run that supplies its route. */
export interface LiveLeg { run_id: string; story: string | null }

export type AgentRow = AgentRecord;

export class RouteResolveFailed extends Error {
  constructor(readonly project: string, detail: string) {
    super(`RouteResolveFailed: ${project}: ${detail}`);
    this.name = "RouteResolveFailed";
  }
}

export class PersonasInvalid extends Error {
  constructor(path: string, detail: string) {
    super(`PersonasInvalid: ${path}: ${detail}`);
    this.name = "PersonasInvalid";
  }
}

/** The shipped persona bindings (`apps/supervisor/personas.json`). */
export const PERSONAS_PATH = join(import.meta.dir, "..", "personas.json");

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const legOf = (route: Route | null, leg: string): Record<string, unknown> => {
  const v = route?.[leg];
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
};

/** Seven rows for one project — pure. A missing field is `null`, never invented; `route` null (a refusing
 * resolve) gives `null` model, effort and advisor on every row with the ids kept. `liveStates` (Story 29.3): each
 * role's office state, `offline` for a role it does not name. */
export function rowsFor(projectId: string, route: Route | null, personas: Partial<Record<string, string | null>>, live: LiveLeg | null,
  liveStates: Partial<Record<string, string>> = {}): AgentRow[] {
  return ROLES.map((role) => {
    const { leg, take } = ROLE_LEGS[role];
    const fields = legOf(route, leg);
    const values = take === "advisor"
      ? { model: str(fields.advisor), effort: null, advisor: null }
      : { model: str(fields.model), effort: str(fields.effort), advisor: str(fields.advisor) };
    return {
      agent_id: `${projectId}/${role}`, project: projectId, role, ...values,
      persona: personas[role] ?? null, live_state: liveStates[role] ?? OFFLINE,
      current_run: live?.run_id ?? null, current_story: live?.story ?? null, jira_account: "",
    };
  });
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

const LIVE_STATES = new Set(["running", "paused", "external"]);
const CURRENT_REL = [".bmad-loop", "routing.current.json"];

/** The project's live run among `runs` (the queue's runs, read once per rebuild): the most recently created run in
 * `running`, `paused` or `external` whose served root holds `.bmad-loop/routing.current.json` written for it, read
 * once here (`route`). A file whose `written_at` is before the run's `created`, compared to the second (pipeline.py
 * writes it to the second), was copied from the checkout into a fresh worktree, not yet rewritten by the engine: it
 * counts as no file and the scan goes on; a missing or unparseable `written_at` is accepted. A run with no served root (a removed worktree, an external run) has no live leg. An
 * unreadable or malformed file stops the scan with `error` (`RoutingCurrentUnreadable`). */
export function liveRun(runs: readonly QueueRun[], projectId: string): { run: QueueRun; file: string; route: Route | null; error?: string } | null {
  const live = runs.filter((r) => r.project_id === projectId && LIVE_STATES.has(r.state));
  for (const run of live.reverse()) {
    const served = servedRoot(run);
    if (!served) continue;
    const file = join(served, ...CURRENT_REL);
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
    } catch (e) {
      return { run, file, route: null, error: message(e) };
    }
    const written = Date.parse(String((parsed as Record<string, unknown>).written_at ?? ""));
    const created = Date.parse(run.created);
    if (Number.isFinite(written) && Number.isFinite(created) && written < Math.floor(created / 1000) * 1000) continue; // not this run's file yet
    return { run, file, route: parsed as Route };
  }
  return null;
}

/** The persona bindings: `{<role>: {display_name}}` → `{<role>: display_name}`. A missing file is no bindings
 * (every persona `null`); malformed JSON or shape is the named PersonasInvalid as a problem, never a throw. */
export function loadPersonas(path: string = PERSONAS_PATH): { personas: Record<string, string | null>; problem?: string } {
  let text: string;
  try { text = readFileSync(path, "utf-8"); }
  catch { return { personas: {} }; }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { return { personas: {}, problem: new PersonasInvalid(path, e instanceof Error ? e.message : String(e)).message }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { personas: {}, problem: new PersonasInvalid(path, "not a JSON object keyed by role").message };
  }
  const personas: Record<string, string | null> = {};
  for (const role of ROLES) {
    const entry = (parsed as Record<string, unknown>)[role];
    const name = entry && typeof entry === "object" ? (entry as Record<string, unknown>).display_name : undefined;
    personas[role] = typeof name === "string" && name.trim() ? name : null;
  }
  return { personas };
}

export interface RebuildDeps {
  /** The host registry (default `registryShow()`, the published read path). */
  registry: () => Promise<Record<string, any>>;
  /** A project's shipped-defaults route (default `resolveRoute`). */
  resolve: (root: string, projectId: string) => Promise<Route>;
  /** The persona bindings file (default the shipped `personas.json`). */
  personas: string;
  /** The snapshot time, read once before the registry and the runs (default now, ISO). */
  now: () => string;
  /** Story 29.3: each agent's live state by `agent_id` (default the raw, ungraced office projection,
   * `officeStates`). A throw stamps every row `offline` and names the problem; it never fails the rebuild. */
  live: (queue: Queue) => Record<string, string>;
}

export type RebuildResult =
  | { rebuilt: true; rebuilt_at: string; projects: string[]; problems: string[] }
  | { rebuilt: false; problem: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Rebuild the `agents` table: every served project's seven rows, replaced whole in one transaction with one
 * `rebuilt_at` (the snapshot time, taken before the registry and the runs are read). A snapshot older than the stored
 * rebuild is not written (`rebuilt: false`, `RebuildSuperseded`). A failed registry read leaves the table unchanged (`rebuilt: false`); a refusing resolve keeps the
 * project's rows with `null` model, effort and advisor and names the problem. Writes no `service_events`; never
 * caches a route across rebuilds. */
export async function rebuildAgents(queue: Queue, deps: Partial<RebuildDeps> = {}): Promise<RebuildResult> {
  const registry = deps.registry ?? (() => registryShow());
  const resolve = deps.resolve ?? resolveRoute;
  // The snapshot time, taken before anything is read: an overlapping rebuild that read later wins (`replaceAgents`).
  const at = (deps.now ?? (() => new Date().toISOString()))();
  let projects: Record<string, unknown>;
  try {
    const shown = await registry();
    if (!shown || shown.ok === false) return { rebuilt: false, problem: `registry: ${String(shown?.error ?? "show refused")}` };
    const p = shown.projects;
    if (!p || typeof p !== "object" || Array.isArray(p)) return { rebuilt: false, problem: "registry: show answered no projects" };
    projects = p as Record<string, unknown>;
  } catch (e) {
    return { rebuilt: false, problem: `registry: ${message(e)}` };
  }
  const problems: string[] = [];
  const loaded = loadPersonas(deps.personas ?? PERSONAS_PATH);
  if (loaded.problem) problems.push(loaded.problem);
  const rows: AgentRow[] = [];
  const ids = Object.keys(projects).sort();
  const runs = queue.runs(); // once per rebuild, shared by every project's live-leg lookup
  let liveStates: Record<string, string> = {};
  try { liveStates = deps.live ? deps.live(queue) : officeStates(queue, runs); }
  catch (e) { problems.push(`OfficeProjectionFailed: ${message(e)} — live_state offline`); }
  for (const id of ids) {
    const entry = projects[id] as Record<string, unknown> | null;
    let route: Route | null = null, live: LiveLeg | null = null;
    const found = liveRun(runs, id);
    if (found?.route) {
      route = found.route;
      live = { run_id: found.run.run_id, story: str(found.route.story) };
    } else if (found) {
      problems.push(`RoutingCurrentUnreadable: ${id}: run ${found.run.run_id}: ${found.error} — resolved instead`);
    }
    if (!route) {
      try {
        const root = entry && typeof entry.root === "string" && entry.root.trim() ? entry.root : null;
        if (!root) throw new RouteResolveFailed(id, "the registry entry has no usable root");
        route = await resolve(root, id);
      } catch (e) {
        problems.push(e instanceof RouteResolveFailed ? e.message : new RouteResolveFailed(id, message(e)).message);
        route = null;
      }
    }
    const states: Record<string, string> = {};
    for (const role of ROLES) { const st = liveStates[`${id}/${role}`]; if (typeof st === "string") states[role] = st; }
    rows.push(...rowsFor(id, route, loaded.personas, live, states));
  }
  if (!queue.replaceAgents(rows, at)) {
    return { rebuilt: false, problem: `RebuildSuperseded: a newer rebuild is stored; this snapshot (${at}) is not written` };
  }
  return { rebuilt: true, rebuilt_at: at, projects: ids, problems };
}

/** The table as consumers read it: rows ordered by project then `ROLES` order, and the time of the rebuild
 * (`null` before the first). Reads only, never rebuilds. */
export function readAgents(queue: Queue, project?: string): { rebuilt_at: string | null; agents: AgentRow[] } {
  const { rebuilt_at, rows } = queue.agents(project);
  const rank = (role: string) => { const i = (ROLES as readonly string[]).indexOf(role); return i < 0 ? ROLES.length : i; };
  const agents = [...rows].sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : rank(a.role) - rank(b.role)));
  return { rebuilt_at, agents };
}
