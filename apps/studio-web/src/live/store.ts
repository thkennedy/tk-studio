// The client store (Story 30.3): one per tab, folding the supervisor's office stream
// (`GET /office/events`, Story 29.3) into one view. Pure: no DOM, no EventSource (see stream.ts).
//
// Rules: a snapshot replaces the view atomically (never cleared first), rebases `lastId` and sets
// `status: "live"`. A delta applies only when its boot equals `lastId`'s boot and its seq is
// greater; anything else (a duplicate, a stale boot, a malformed id, an unknown kind) is ignored.
// Story 30.4 (contract 0.1.25): agents carry `reason`, the view carries each project's `last_run`
// (replaced by a snapshot, set by an `office.run` delta carrying one), and `lastEventAt` is the
// client's receive time of the last applied delta or of the last snapshot that changed the view (the
// first one, or one whose agents, runs, problems or last_run differ): the stream watchdog's reconnect
// re-sends an identical snapshot every 15 s on a quiet office, which is not an event (the clock injectable).
// Story 30.6 (0.1.25, additive): a snapshot also carries `supervisor {version, counts}` and the ledger tail; the
// view keeps them from each snapshot (null when absent), deltas leave them as they are, and they are not an event
// (`lastEventAt` compares the four fields above only).
// Story 32.7 (0.1.27, additive): a snapshot carries `engagements[] {id, project, state, title, needs_you}` (replaced by
// each snapshot, `[]` when absent) and an `office.engagement` delta `{id, project, state, from, title?, needs_you?}`
// keyed by project + id sets one row (`state: null` removes it: the record vanished or became unreadable); the Chat
// nav count reads them.

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
  /** What a `waiting-for-human` or `blocked` agent waits for; null otherwise (0.1.25). */
  reason: string | null;
  /** The open inbox item of the agent's current story, else null (0.1.26, Story 31.5): the office's "!" follows it
   * alone. Absent from an older supervisor's answer. */
  blocked_issue?: BlockedIssue | null;
}
/** The inbox item behind an agent's "!" (0.1.26). */
export interface BlockedIssue {
  issue: string;
  state: string;
}
/** A project's newest terminal run (0.1.25). `ended_at` is an ISO string. */
export interface OfficeLastRun {
  run_id: string;
  state: string;
  pr: string | null;
  ended_at: string;
}
/** The supervisor's version and its queue's per-state run counts (snapshot only, 0.1.25, Story 30.6). */
export interface SupervisorInfo {
  version: string;
  counts: Record<string, number>;
}
/** The host ledger's last lines (redacted by the supervisor), or a note naming why there are none (Story 30.6). */
export type LedgerTail = { path: string; lines: string[] } | { path: string; note: string };
/** Story 32.7: an engagement as the office shows it (mirrored from apps/supervisor office.ts, 0.1.27). */
export interface OfficeEngagement {
  id: string;
  project: string;
  state: string;
  title: string;
  needs_you: boolean;
}
export interface OfficeView {
  at: string;
  agents: OfficeAgent[];
  runs: OfficeRun[];
  problems: string[];
  /** Keyed by project; a project that never ended a run has no entry. */
  last_run: Record<string, OfficeLastRun>;
  /** Story 30.6: from the last snapshot; null when it carried none. */
  supervisor?: SupervisorInfo | null;
  /** Story 30.6: from the last snapshot; null when it carried none. */
  ledger?: LedgerTail | null;
  /** Story 32.7: every served project's engagements (snapshot + `office.engagement` deltas); optional in the type. */
  engagements?: OfficeEngagement[];
}

export type OfficeDeltaKind = "office.agent" | "office.progress" | "office.run" | "office.engagement";

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
  /** Client receive time (ms) of the last applied delta or view-changing snapshot; null before the first. */
  lastEventAt: number | null;
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

/** A well-formed `blocked_issue`, or null. */
export function blockedIssueOf(v: unknown): BlockedIssue | null {
  return isObj(v) && typeof v.issue === "string" && typeof v.state === "string" ? { issue: v.issue, state: v.state } : null;
}

function applyAgent(view: OfficeView, d: Record<string, unknown>): OfficeView | null {
  const agentId = d.agent_id;
  if (typeof agentId !== "string" || typeof d.state !== "string") return null;
  const patch: Partial<OfficeAgent> & Pick<OfficeAgent, "state" | "current_run" | "current_story" | "reason"> = {
    state: d.state as OfficeState,
    current_run: strOrNull(d.current_run),
    current_story: strOrNull(d.current_story),
    reason: strOrNull(d.reason),
    // Only an `office.agent` delta that carries the field moves it (0.1.26): nothing else ever touches it.
    ...("blocked_issue" in d ? { blocked_issue: blockedIssueOf(d.blocked_issue) } : {}),
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

/** A well-formed `last_run` object, or null. */
function lastRunOf(v: unknown): OfficeLastRun | null {
  if (!isObj(v) || typeof v.run_id !== "string" || typeof v.state !== "string") return null;
  return { run_id: v.run_id, state: v.state, pr: strOrNull(v.pr), ended_at: typeof v.ended_at === "string" ? v.ended_at : "" };
}

function lastRunsOf(v: unknown): Record<string, OfficeLastRun> {
  const out: Record<string, OfficeLastRun> = {};
  if (!isObj(v)) return out;
  for (const [project, entry] of Object.entries(v)) {
    const last = lastRunOf(entry);
    if (last) out[project] = last;
  }
  return out;
}

/** A well-formed `supervisor` object, or null. */
function supervisorOf(v: unknown): SupervisorInfo | null {
  if (!isObj(v) || typeof v.version !== "string") return null;
  const counts: Record<string, number> = {};
  if (isObj(v.counts)) for (const [k, n] of Object.entries(v.counts)) if (typeof n === "number") counts[k] = n;
  return { version: v.version, counts };
}

/** A well-formed ledger tail, or null. */
function ledgerOf(v: unknown): LedgerTail | null {
  if (!isObj(v) || typeof v.path !== "string") return null;
  if (Array.isArray(v.lines)) return { path: v.path, lines: v.lines.filter((l): l is string => typeof l === "string") };
  if (typeof v.note === "string") return { path: v.path, note: v.note };
  return null;
}

function applyRun(view: OfficeView, d: Record<string, unknown>): OfficeView | null {
  const runId = d.run_id;
  if (typeof runId !== "string") return null;
  const state = strOrNull(d.state);
  const i = view.runs.findIndex((r) => r.run_id === runId);
  if (state === null || !LIVE_RUN_STATES.has(state)) {
    // A run leaving the live set terminal carries its project's `last_run` (0.1.25).
    const last = lastRunOf(d.last_run);
    const project = strOrNull(d.project) ?? (i >= 0 ? view.runs[i].project : null);
    const next = last && project !== null ? { ...view, last_run: { ...view.last_run, [project]: last } } : view;
    return i >= 0 ? { ...next, runs: next.runs.filter((r) => r.run_id !== runId) } : next;
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

/** A well-formed snapshot engagement row, or null. */
function engagementOf(v: unknown): OfficeEngagement | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.project !== "string" || typeof v.state !== "string") return null;
  return { id: v.id, project: v.project, state: v.state, title: typeof v.title === "string" ? v.title : "", needs_you: v.needs_you === true };
}

function engagementsOf(v: unknown): OfficeEngagement[] {
  return Array.isArray(v) ? v.map(engagementOf).filter((e): e is OfficeEngagement => e !== null) : [];
}

/** Story 32.7: one row keyed by project + id; `state: null` removes it, else the row is set (added when new). */
function applyEngagement(view: OfficeView, d: Record<string, unknown>): OfficeView | null {
  if (typeof d.id !== "string" || typeof d.project !== "string") return null;
  const rows = view.engagements ?? [];
  const i = rows.findIndex((e) => e.project === d.project && e.id === d.id);
  if (d.state === null) return i >= 0 ? { ...view, engagements: rows.filter((_, k) => k !== i) } : view;
  if (typeof d.state !== "string") return null;
  const prev = i >= 0 ? rows[i] : null;
  const row: OfficeEngagement = {
    id: d.id,
    project: d.project,
    state: d.state,
    title: typeof d.title === "string" ? d.title : prev?.title ?? "",
    needs_you: typeof d.needs_you === "boolean" ? d.needs_you : prev?.needs_you ?? false,
  };
  return { ...view, engagements: i >= 0 ? rows.map((e, k) => (k === i ? row : e)) : [...rows, row] };
}

/** Deep equality of JSON values, key order ignored. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameJson(a[k], b[k]));
}

/** A snapshot changes the view when its content (not its `at`) differs. */
const sameContent = (a: OfficeView, b: OfficeView): boolean =>
  sameJson(a.agents, b.agents) && sameJson(a.runs, b.runs) && sameJson(a.problems, b.problems) && sameJson(a.last_run, b.last_run);

export interface StoreDeps {
  /** The clock for `lastEventAt` (default `Date.now`). */
  now?: () => number;
}

export function createOfficeStore(deps: StoreDeps = {}): OfficeStore {
  const now = deps.now ?? (() => Date.now());
  let state: LiveState = { view: null, lastId: null, status: "connecting", lastEventAt: null };
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
      const { at, agents, runs, problems, last_run, supervisor, ledger, engagements } = data;
      if (!Array.isArray(agents) || !Array.isArray(runs)) return;
      const view: OfficeView = {
        at: typeof at === "string" ? at : "",
        agents: agents as OfficeAgent[],
        runs: runs as OfficeRun[],
        problems: Array.isArray(problems) ? (problems as string[]) : [],
        last_run: lastRunsOf(last_run),
        supervisor: supervisorOf(supervisor),
        ledger: ledgerOf(ledger),
        engagements: engagementsOf(engagements),
      };
      // A reconnect's identical snapshot keeps the time of the last real change.
      const changed = !state.view || state.lastEventAt === null || !sameContent(state.view, view);
      set({ view, lastId: id, status: "live", lastEventAt: changed ? now() : state.lastEventAt });
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
        else if (kind === "office.engagement") view = applyEngagement(state.view, data);
        else return;
      } catch {
        return;
      }
      if (!view) return;
      // A resume's replay applies deltas after a drop: the stream is live again.
      set({ view, lastId: id, status: "live", lastEventAt: now() });
    },
    setStatus(s) {
      if (state.status === s) return;
      set({ ...state, status: s });
    },
  };
}
