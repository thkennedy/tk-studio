// The Office screen's rules (Story 30.4, design spec §6.3, §7.3): pure functions vitest drives in
// `environment: "node"`. No pixi.js, no DOM: `fetch`, `localStorage` and the clock are injected.
// The canvas lives in `src/renderer/scene.ts`, the composition in `OfficeScreen.tsx`.
import { LIVE_RUN_STATES, OFFICE_STATES, type LiveState, type OfficeAgent, type OfficeRun, type OfficeState } from "../live/store";

// ------------------------------------------------------------ frames

/** Frame sets by office state (the placeholder's shared sets), plus optional per-role sets (30.7). */
export interface FrameSheet<F> {
  frames: Readonly<Record<OfficeState, readonly F[]>>;
  roles?: Readonly<Record<string, Partial<Record<OfficeState, readonly F[]>>>>;
}

/** The pose's frames: the role's set for `state` when the sheet has one, else the shared set for
 * `state`. An unknown state reads as `offline`. 30.7 adds per-role sets without changing callers. */
export function framesFor<F>(sheet: FrameSheet<F>, role: string, state: string): readonly F[] {
  const s: OfficeState = isOfficeState(state) ? state : "offline";
  return sheet.roles?.[role]?.[s] ?? sheet.frames[s];
}

export const isOfficeState = (s: unknown): s is OfficeState => (OFFICE_STATES as readonly unknown[]).includes(s);

// ------------------------------------------------------------ the bubble

/** The DOM bubble over a character: only `waiting-for-human` and `blocked` have one, naming the
 * projection's reason ("waiting" / "blocked" when the reason is null). */
export function bubbleFor(agent: { state: string; reason?: string | null }): string | null {
  if (agent.state === "waiting-for-human") return agent.reason || "waiting";
  if (agent.state === "blocked") return agent.reason || "blocked";
  return null;
}

// ------------------------------------------------------------ the registry

/** The slice of a `GET /agents` row the screen reads. */
export interface RegistryRow {
  agent_id: string;
  project?: string;
  role?: string;
  live_state?: string | null;
}

/** One desk: the registry's row, its pose from the store's agent of the same id (else the row's
 * `live_state`, else `offline`) and the store's reason. */
export interface Desk {
  agent_id: string;
  role: string;
  state: OfficeState;
  reason: string | null;
}

const roleOf = (row: RegistryRow): string => row.role ?? row.agent_id.slice(row.agent_id.lastIndexOf("/") + 1);
const projectOf = (row: RegistryRow): string => row.project ?? row.agent_id.slice(0, Math.max(0, row.agent_id.lastIndexOf("/")));

/** The desks for the registry rows, in row order. */
export function desksFrom(rows: readonly RegistryRow[], agents: readonly OfficeAgent[] | null | undefined): Desk[] {
  const live = new Map((agents ?? []).map((a) => [a.agent_id, a]));
  return rows.map((row) => {
    const a = live.get(row.agent_id);
    const raw = a?.state ?? row.live_state;
    return { agent_id: row.agent_id, role: roleOf(row), state: isOfficeState(raw) ? raw : "offline", reason: a?.reason ?? null };
  });
}

/** The switcher's projects: the distinct `project` (else the `agent_id` prefix), in first-seen order. */
export function projectsFrom(rows: readonly RegistryRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const p = projectOf(row);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Absolute: the page carries `<base href="/app/">`. */
export const AGENTS_URL = "/agents";
export const agentsUrl = (project?: string | null): string =>
  project ? `${AGENTS_URL}?project=${encodeURIComponent(project)}` : AGENTS_URL;

export type AgentsAnswer = { ok: true; agents: RegistryRow[] } | { ok: false; error: string };
type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** `GET /agents[?project=<id>]` on this origin with the session cookie. Never throws: a non-200, a
 * network error or a malformed body is `{ok:false, error}` naming it. */
export async function fetchAgents(project: string | null, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<AgentsAnswer> {
  const url = agentsUrl(project);
  try {
    const res = await fetchFn(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, error: `${url} answered ${res.status}` };
    const body = (await res.json()) as { agents?: unknown };
    if (!body || !Array.isArray(body.agents)) return { ok: false, error: `${url}: no agents in the answer` };
    return { ok: true, agents: (body.agents as RegistryRow[]).filter((r) => r && typeof r.agent_id === "string") };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------ the remembered project

export const PROJECT_KEY = "tk-studio.office.project";
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const defaultStorage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

/** The stored choice when it is still among `projects`, else the first project (null with none).
 * A storage that throws counts as no stored choice. */
export function rememberedProject(projects: readonly string[], storage: StorageLike | null = defaultStorage()): string | null {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(PROJECT_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored !== null && projects.includes(stored)) return stored;
  return projects[0] ?? null;
}

/** Stores the choice; a storage that throws is ignored (the choice stays in memory only). */
export function rememberProject(project: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(PROJECT_KEY, project);
  } catch {
    /* in memory only */
  }
}

// ------------------------------------------------------------ the HUD

export const PENDING = "pending";
export const NONE = "—";

export interface HudLive {
  run_id: string;
  /** The run's queue state, `pending` while unknown (a progress-born row). */
  state: string;
  /** `—` until the snapshot names it. */
  engine_run_id: string;
  done: number;
  failed: number;
  total: number;
  story: string;
  phase: string;
}
export interface HudLast {
  run_id: string;
  state: string;
  pr: string | null;
  /** The PR as a link target: `pr` only when it is `http(s)://` (`safeHref`), else null (shown as text). */
  href: string | null;
}
export interface HudModel {
  project: string;
  live: HudLive | null;
  /** With no live run: the last ended run, or null ("no run yet"). */
  last: HudLast | null;
  /** The time since the last applied event, `Ns ago` (`—` before any). */
  since: string;
}

const isLive = (r: OfficeRun) => r.state === null || LIVE_RUN_STATES.has(r.state);

/** The project's run in flight: the run its agents point at (`current_run`, the supervisor's own
 * selection), else its newest live row; a row whose `state` is still null counts as pending. */
function liveRunOf(state: LiveState, project: string): OfficeRun | null {
  const view = state.view;
  if (!view) return null;
  const pointed = new Set(view.agents.filter((a) => a.project === project && a.current_run).map((a) => a.current_run));
  const runs = view.runs.filter(isLive).reverse();
  return runs.find((r) => pointed.has(r.run_id)) ?? runs.find((r) => r.project === project) ?? null;
}

/** `url` when its scheme is `http:` or `https:`, else null: any other scheme (`javascript:`, `data:`, …)
 * is never a link target. */
export function safeHref(url: string | null | undefined): string | null {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

export function sinceText(lastEventAt: number | null, now: number): string {
  if (lastEventAt === null) return NONE;
  return `${Math.max(0, Math.floor((now - lastEventAt) / 1000))}s ago`;
}

/** The HUD's fields for `project` from the store's state at `now` (ms). */
export function hudModel(state: LiveState, project: string, now: number): HudModel {
  const since = sinceText(state.lastEventAt, now);
  const run = liveRunOf(state, project);
  if (run) {
    const current = run.epic?.current_story ?? null;
    const story = current ? run.stories.find((s) => s.key === current) : undefined;
    return {
      project,
      live: {
        run_id: run.run_id,
        state: run.state ?? PENDING,
        engine_run_id: run.engine_run_id ?? NONE,
        done: run.epic?.done ?? 0,
        failed: run.epic?.failed ?? 0,
        total: run.epic?.total ?? 0,
        story: current ?? NONE,
        phase: story?.phase ?? NONE,
      },
      last: null,
      since,
    };
  }
  const last = state.view?.last_run?.[project];
  return {
    project,
    live: null,
    last: last ? { run_id: last.run_id, state: last.state || PENDING, pr: last.pr ?? null, href: safeHref(last.pr) } : null,
    since,
  };
}
