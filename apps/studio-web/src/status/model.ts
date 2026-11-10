// The Status screen's view (Story 30.6): a pure function of the one store's state. The queue's counts, the
// supervisor's version and the ledger's last events come from the office snapshot's `supervisor` and `ledger`
// (contract 0.1.25, additive); the live runs, the agents and the office section from the same store. The read-only
// page (no JavaScript) is `GET /status`, linked absolutely because of the web's `<base href="/app/">`.
// Story 39.5 (CAP-17): the queue (`queueRows`) — every live run of `GET /status` (JSON), grouped queued, claimed,
// running, paused (then external), each with its job, story, start and clock (`runClock` over its `GET /runs/{id}`),
// a link to its run page, Cancel, and for a paused run the reason in words and the inbox item that resolves it. The
// reads are triggered by store changes (`liveSignature`), never by a timer; a 1 s tick drives the clocks only.
import type { FetchLike } from "../inbox/model";
import { LIVE_RUN_STATES, type LedgerTail, type LiveState, type OfficeRun } from "../live/store";
import { canCancel, clockUnread, LOADING_CLOCK, NO_STORY_YET, runClock, runPagePath, type ClaimRefused, type RunAnswer, type RunResult, type RunRow } from "../run/model";

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

// ------------------------------------------------------------ the queue (Story 39.5, Settled shape 7)

/** A `GET /status` `live[]` run: the queue row with its open claim refusal (0.1.28). */
export type StatusLiveRun = RunRow & { claim_refused?: ClaimRefused | null };
export interface StatusAnswer { ok: true; counts: Record<string, number>; live: StatusLiveRun[] }
export type StatusResult = { ok: true; status: StatusAnswer } | { ok: false; error: string };

export const LOADING_START = "Loading the start…";
export const startUnread = (error: string): string => `The start could not be read: ${error}`;
export const LOADING_QUEUE = "Loading the queue…";
/** The order the queue lists its groups in (the AC's), then `external`. */
export const QUEUE_ORDER = ["queued", "claimed", "running", "paused", "external"] as const;

/** `GET /status` as JSON (a non-HTML `Accept`) with the session cookie. Never throws. */
export async function fetchStatus(fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<StatusResult> {
  const url = STATUS_PAGE_URL;
  try {
    const res = await fetchFn(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    const obj = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!res.ok) return { ok: false, error: `${url} answered ${res.status}${obj && typeof obj.error === "string" ? ` ${obj.error}` : ""}` };
    if (!obj || obj.ok !== true || !Array.isArray(obj.live)) return { ok: false, error: `${url}: no queue in the answer` };
    const live = (obj.live as unknown[]).filter((r): r is StatusLiveRun => typeof r === "object" && r !== null && typeof (r as StatusLiveRun).run_id === "string");
    return { ok: true, status: { ok: true, counts: (obj.counts ?? {}) as Record<string, number>, live } };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface QueueRow {
  run_id: string;
  /** The queue state, `claimed` for a running run with neither a worker nor an engine yet. */
  state: string;
  job: string;
  story: string;
  start: string;
  clock: string;
  href: string;
  cancel: { show: boolean; enabled: boolean; note: string | null };
  /** A paused run: the reason in words and the inbox item that resolves it. */
  paused: { reason: string; inbox: { key: string; href: string } | null } | null;
  /** A queued run the drain could not claim: `Waiting to be claimed: <reason>` (` (resolve: <resolves>)`). */
  refused: string | null;
}

/** The store's live-run signature (each `run_id:state:stage:leg.since:worker.since`, the leg and the worker per the
 * operator rulings 2026-11-10): the queue is re-read when it changes. */
export function liveSignature(state: LiveState): string {
  return (state.view?.runs ?? []).map((r) => `${r.run_id}:${r.state ?? ""}:${r.stage ?? ""}:${r.leg?.since ?? ""}:${r.worker?.since ?? ""}`).join("|");
}

/** What stands where the queue goes (R4, review pass 3): the `GET /status` error, else `Loading the queue…` while no
 * answer was read, never both; null once a queue is shown with no error. A failed re-read after an answer keeps the
 * queue and names the error above it. */
export function queueNotice(status: StatusAnswer | null, error: string | null): { error: string } | { loading: string } | null {
  if (error !== null) return { error };
  return status === null ? { loading: LOADING_QUEUE } : null;
}

export const CANCELLING = "Cancelling…";
/** A queue row's Cancel buttons while a Cancel of that run is in flight (R5, review pass 3): disabled and saying so
 * (`Cancelling…`), so a second click posts nothing; otherwise as `canCancel` gates them. */
export function cancelButtons(
  runId: string, gate: { enabled: boolean }, inFlight: ReadonlySet<string>,
): { disabled: boolean; label: string | null } {
  if (inFlight.has(runId)) return { disabled: true, label: CANCELLING };
  return { disabled: !gate.enabled, label: null };
}

/** Starts a Cancel of `runId` unless one is in flight (R5): the in-flight set with it added, or null (post nothing). */
export function beginCancel(inFlight: ReadonlySet<string>, runId: string): Set<string> | null {
  if (inFlight.has(runId)) return null;
  return new Set([...inFlight, runId]);
}

const claimedOf = (r: StatusLiveRun): boolean => r.state === "running" && !r.worker_pid && !r.engine_run_id;

/** Each live run's reads merged into the last ones (Settled shape 7): a successful read replaces the run's answer; a
 * failed one keeps the previous answer (never back to a loading label) and records the failure; a run no longer read
 * (not live) drops out. */
export function mergeDetails(
  prev: Readonly<Record<string, RunAnswer | undefined>>,
  reads: readonly { run_id: string; result: RunResult }[],
): { details: Record<string, RunAnswer | undefined>; errors: Record<string, string> } {
  const details: Record<string, RunAnswer | undefined> = {};
  const errors: Record<string, string> = {};
  for (const { run_id, result } of reads) {
    if (result.ok) details[run_id] = result.answer;
    else {
      if (prev[run_id]) details[run_id] = prev[run_id];
      errors[run_id] = result.error;
    }
  }
  return { details, errors };
}

/** The queue rows (Settled shape 7): `details` holds each run's `GET /runs/{id}` answer (absent while unread), `errors`
 * each failed read (a run never read shows the failure, not a loading label). */
export function queueRows(
  status: StatusAnswer, details: Readonly<Record<string, RunAnswer | undefined>>, live: LiveState, now: number,
  errors: Readonly<Record<string, string>> = {},
): QueueRow[] {
  const view = live.view;
  const rank = (s: string) => { const i = (QUEUE_ORDER as readonly string[]).indexOf(s); return i < 0 ? QUEUE_ORDER.length : i; };
  const rows = status.live.map((r) => ({ r, state: claimedOf(r) ? "claimed" : r.state }));
  rows.sort((a, b) => rank(a.state) - rank(b.state) || (a.r.created < b.r.created ? -1 : a.r.created > b.r.created ? 1 : 0));
  return rows.map(({ r, state }) => {
    const detail = details[r.run_id];
    const storeRun = view?.runs.find((x) => x.run_id === r.run_id);
    const claimedAt = detail ? [...detail.events].reverse().find((e) => e.kind === "claimed")?.at ?? null : null;
    const failed = errors[r.run_id] ?? null;
    const start = r.state === "queued" ? r.created : detail ? claimedAt ?? r.created : failed !== null ? startUnread(failed) : LOADING_START;
    const clock = detail ? runClock(detail, now).label
      : r.state === "queued" ? runClock({ run: r, events: [] }, now).label
        : failed !== null ? clockUnread(failed) : LOADING_CLOCK;
    let paused: QueueRow["paused"] = null;
    if (r.state === "paused") {
      const mine = (view?.agents ?? []).filter((a) => a.current_run === r.run_id && (r.project_id === null || a.project === r.project_id));
      const reason = mine.find((a) => a.reason)?.reason ?? (r.reason || null);
      const issue = mine.find((a) => a.blocked_issue?.issue)?.blocked_issue?.issue ?? null;
      paused = {
        reason: `Paused: ${reason ?? "no reason recorded"}`,
        inbox: issue ? { key: issue, href: `/app/inbox/${encodeURIComponent(issue)}` } : null,
      };
    }
    const refusal = r.state === "queued" && r.claim_refused ? r.claim_refused : null;
    return {
      run_id: r.run_id,
      state,
      job: r.job_id,
      story: storeRun?.epic?.current_story ?? NO_STORY_YET,
      start,
      clock,
      href: runPagePath(r.run_id),
      cancel: canCancel(r),
      paused,
      refused: refusal ? `Waiting to be claimed: ${refusal.reason}${refusal.resolves ? ` (resolve: ${refusal.resolves})` : ""}` : null,
    };
  });
}
