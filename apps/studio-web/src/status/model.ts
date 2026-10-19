// The Status screen's view (Story 30.6): a pure function of the one store's state. The queue's counts, the
// supervisor's version and the ledger's last events come from the office snapshot's `supervisor` and `ledger`
// (contract 0.1.25, additive); the live runs, the agents and the office section from the same store. No fetch and
// no timer: the screen re-renders on a store change. The read-only page (no JavaScript) is `GET /status`, linked
// absolutely because of the web's `<base href="/app/">`.
import { LIVE_RUN_STATES, type LedgerTail, type LiveState, type OfficeRun } from "../live/store";

export const STATUS_PAGE_URL = "/status";
export const NONE = "—";
export const PENDING = "pending";

export interface StatusCount {
  state: string;
  count: number;
}
export interface StatusRun {
  run_id: string;
  project: string;
  state: string;
  engine_run_id: string;
}
export interface StatusAgent {
  agent_id: string;
  project: string;
  role: string;
  state: string;
  reason: string | null;
  current_run: string;
  current_story: string;
}
export interface StatusOfficeRun {
  run_id: string;
  project: string;
  /** `done/total` of the epic, with the current story (or —). */
  progress: string;
  current_story: string;
  stories: { key: string; title: string | null; status: string }[];
}
export interface StatusLastRun {
  project: string;
  run_id: string;
  state: string;
  pr: string | null;
  ended_at: string;
}
export interface StatusView {
  /** Whether a snapshot has arrived (otherwise every section is empty). */
  loaded: boolean;
  /** The supervisor's version, or — when the snapshot carried none. */
  version: string;
  /** Per state over every queue run, sorted by state; null when the snapshot carried none. */
  counts: StatusCount[] | null;
  /** The sum of `counts` (0 with none). */
  total: number;
  liveRuns: StatusRun[];
  agents: StatusAgent[];
  office: { runs: StatusOfficeRun[]; problems: string[]; lastRuns: StatusLastRun[] };
  /** The ledger tail or its note; null when the snapshot carried none. */
  ledger: LedgerTail | null;
}

/** A store run counts as live only with a known live state (a progress-born row's `state: null` does not). */
export const isLiveRun = (r: OfficeRun): boolean => r.state !== null && LIVE_RUN_STATES.has(r.state);

/** The Status screen's view of the store. */
export function statusView(state: LiveState): StatusView {
  const view = state.view;
  if (!view) {
    return { loaded: false, version: NONE, counts: null, total: 0, liveRuns: [], agents: [], office: { runs: [], problems: [], lastRuns: [] }, ledger: null };
  }
  const supervisor = view.supervisor ?? null;
  const counts = supervisor
    ? Object.entries(supervisor.counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([s, count]) => ({ state: s, count }))
    : null;
  const live = view.runs.filter(isLiveRun);
  return {
    loaded: true,
    version: supervisor?.version || NONE,
    counts,
    total: counts ? counts.reduce((n, c) => n + c.count, 0) : 0,
    liveRuns: live.map((r) => ({ run_id: r.run_id, project: r.project ?? PENDING, state: r.state ?? PENDING, engine_run_id: r.engine_run_id ?? NONE })),
    agents: view.agents.map((a) => ({
      agent_id: a.agent_id, project: a.project, role: a.role, state: a.state, reason: a.reason ?? null,
      current_run: a.current_run ?? NONE, current_story: a.current_story ?? NONE,
    })),
    office: {
      runs: live.map((r) => ({
        run_id: r.run_id,
        project: r.project ?? PENDING,
        progress: `${r.epic?.done ?? 0}/${r.epic?.total ?? 0}`,
        current_story: r.epic?.current_story ?? NONE,
        stories: (r.stories ?? []).map((s) => ({ key: s.key, title: s.title ?? null, status: s.status })),
      })),
      problems: [...view.problems],
      lastRuns: Object.entries(view.last_run ?? {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([project, l]) => ({ project, run_id: l.run_id, state: l.state, pr: l.pr, ended_at: l.ended_at })),
    },
    ledger: view.ledger ?? null,
  };
}
