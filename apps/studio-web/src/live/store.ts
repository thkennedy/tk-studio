// The client store (Story 30.3): one per tab, folding the supervisor's office stream
// (`GET /office/events`, Story 29.3) into one view. Pure: no DOM, no EventSource (see stream.ts).
//
// Rules: a snapshot replaces the view atomically (never cleared first), rebases `lastId` and sets
// `status: "live"`. A delta applies only when its boot equals `lastId`'s boot and its seq is
// greater; anything else (a duplicate, a stale boot, a malformed id, an unknown kind) is ignored.

// ------------------------------------------------------------ mirrored types (apps/supervisor/src/office.ts)
// Mirrored, never imported across apps.

export const OFFICE_STATES = ["offline", "idle", "thinking", "reading", "typing", "running", "waiting-for-human", "blocked"] as const;
export type OfficeState = (typeof OFFICE_STATES)[number];

export const LIVE_RUN_STATES: ReadonlySet<string> = new Set(["queued", "running", "paused", "external"]);

export type StoryStatus = "pending" | "current" | "done" | "deferred" | "failed";
export interface OfficeStory {
  key: string;
  title?: string;
  status: StoryStatus;
  phase: string | null;
  overlay: "done" | "failed" | null;
  extra?: true;
}
export interface OfficeEpic {
  spec_folder: string | null;
  done: number;
  deferred: number;
  failed: number;
  total: number;
  current_story: string | null;
}
export interface OfficeRun {
  run_id: string;
  project: string | null;
  /** `null` only for a run first seen in an `office.progress` delta, until its `office.run` arrives. */
  state: string | null;
  engine_run_id: string | null;
  epic: OfficeEpic;
  stories: OfficeStory[];
}
export interface OfficeAgent {
  agent_id: string;
  project: string;
  role: string;
  state: OfficeState;
  current_run: string | null;
  current_story: string | null;
}
export interface OfficeView {
  at: string;
  agents: OfficeAgent[];
  runs: OfficeRun[];
  problems: string[];
}

export type OfficeDeltaKind = "office.agent" | "office.progress" | "office.run";

// ------------------------------------------------------------ ids

export interface LiveId {
  boot: string;
  seq: number;
}

/** `"<boot>-<seq>"` split on the last `-`; null when malformed. */
export function parseId(id: string | null | undefined): LiveId | null {
  if (typeof id !== "string") return null;
  const at = id.lastIndexOf("-");
  if (at <= 0 || at === id.length - 1) return null;
  const boot = id.slice(0, at);
  const tail = id.slice(at + 1);
  if (!/^\d+$/.test(tail)) return null;
  const seq = Number(tail);
  if (!Number.isSafeInteger(seq)) return null;
  return { boot, seq };
}

// ------------------------------------------------------------ the store

export type StreamStatus = "connecting" | "live" | "reconnecting";

export interface LiveState {
  view: OfficeView | null;
  lastId: string | null;
  status: StreamStatus;
}

export interface OfficeStore {
  /** A stable reference between changes (for `useSyncExternalStore`). */
  getState(): LiveState;
  /** Called after each change; returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
  applySnapshot(id: string, data: unknown): void;
  applyDelta(id: string, kind: string, data: unknown): void;
  setStatus(s: StreamStatus): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function applyAgent(view: OfficeView, d: Record<string, unknown>): OfficeView | null {
  const agentId = d.agent_id;
  if (typeof agentId !== "string" || typeof d.state !== "string") return null;
  const patch = {
    state: d.state as OfficeState,
    current_run: strOrNull(d.current_run),
    current_story: strOrNull(d.current_story),
  };
  const i = view.agents.findIndex((a) => a.agent_id === agentId);
  let agents: OfficeAgent[];
  if (i >= 0) {
    agents = view.agents.slice();
    agents[i] = { ...agents[i], ...patch };
  } else {
    // A first appearance carries no project or role: derive them from `<project>/<role>`.
    const slash = agentId.lastIndexOf("/");
    const project = slash > 0 ? agentId.slice(0, slash) : agentId;
    const role = slash > 0 ? agentId.slice(slash + 1) : "";
    agents = [...view.agents, { agent_id: agentId, project, role, ...patch }];
  }
  return { ...view, agents };
}

function applyProgress(view: OfficeView, d: Record<string, unknown>): OfficeView | null {
  const runId = d.run_id;
  if (typeof runId !== "string" || !isObj(d.epic)) return null;
  const epic = d.epic as unknown as OfficeEpic;
  const story = isObj(d.story) && typeof d.story.key === "string" ? (d.story as unknown as OfficeStory) : null;
  const i = view.runs.findIndex((r) => r.run_id === runId);
  // A run new to the live set sends its progress before its `office.run`: create the row.
  const base: OfficeRun = i >= 0 ? view.runs[i] : { run_id: runId, project: null, state: null, engine_run_id: null, epic, stories: [] };
  let stories = base.stories;
  if (story) {
    const j = stories.findIndex((s) => s.key === story.key);
    const prev = j >= 0 ? stories[j] : undefined;
    // A delta never carries `title`: keep the snapshot's.
    const merged: OfficeStory = prev?.title !== undefined && story.title === undefined ? { ...story, title: prev.title } : story;
    stories = j >= 0 ? stories.map((s, k) => (k === j ? merged : s)) : [...stories, merged];
  }
  const run: OfficeRun = { ...base, epic, stories };
  const runs = i >= 0 ? view.runs.map((r, k) => (k === i ? run : r)) : [...view.runs, run];
  return { ...view, runs };
}

function applyRun(view: OfficeView, d: Record<string, unknown>): OfficeView | null {
  const runId = d.run_id;
  if (typeof runId !== "string") return null;
  const state = strOrNull(d.state);
  const i = view.runs.findIndex((r) => r.run_id === runId);
  if (state === null || !LIVE_RUN_STATES.has(state)) {
    return i >= 0 ? { ...view, runs: view.runs.filter((r) => r.run_id !== runId) } : view;
  }
  const project = d.project === undefined ? undefined : strOrNull(d.project);
  if (i >= 0) {
    const prev = view.runs[i];
    const run: OfficeRun = { ...prev, state, project: project === undefined ? prev.project : project };
    return { ...view, runs: view.runs.map((r, k) => (k === i ? run : r)) };
  }
  const run: OfficeRun = {
    run_id: runId,
    project: project ?? null,
    state,
    engine_run_id: null,
    epic: { spec_folder: null, done: 0, deferred: 0, failed: 0, total: 0, current_story: null },
    stories: [],
  };
  return { ...view, runs: [...view.runs, run] };
}

export function createOfficeStore(): OfficeStore {
  let state: LiveState = { view: null, lastId: null, status: "connecting" };
  const listeners = new Set<() => void>();
  const set = (next: LiveState) => {
    state = next;
    for (const fn of [...listeners]) fn();
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    applySnapshot(id, data) {
      if (!parseId(id) || !isObj(data)) return;
      const { at, agents, runs, problems } = data;
      if (!Array.isArray(agents) || !Array.isArray(runs)) return;
      const view: OfficeView = {
        at: typeof at === "string" ? at : "",
        agents: agents as OfficeAgent[],
        runs: runs as OfficeRun[],
        problems: Array.isArray(problems) ? (problems as string[]) : [],
      };
      set({ view, lastId: id, status: "live" });
    },
    applyDelta(id, kind, data) {
      const next = parseId(id);
      const last = parseId(state.lastId);
      if (!next || !last || next.boot !== last.boot || next.seq <= last.seq) return;
      if (!state.view || !isObj(data)) return;
      let view: OfficeView | null;
      try {
        if (kind === "office.agent") view = applyAgent(state.view, data);
        else if (kind === "office.progress") view = applyProgress(state.view, data);
        else if (kind === "office.run") view = applyRun(state.view, data);
        else return;
      } catch {
        return;
      }
      if (!view) return;
      // A resume's replay applies deltas after a drop: the stream is live again.
      set({ view, lastId: id, status: "live" });
    },
    setStatus(s) {
      if (state.status === s) return;
      set({ ...state, status: s });
    },
  };
}
