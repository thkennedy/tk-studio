// The run page's rules (Story 39.5, CAP-16, addendum §3.2 F-A, `/app/run/<id>`): pure functions vitest drives in
// `environment: "node"`. No DOM and no clock of their own: `fetch` and `now` are injected. The composition is
// `RunScreen.tsx`; the Status screen and the office HUD share `runClock`, `canCancel` and `postCancel`.
//
// The page reads `GET /runs/{id}` (the run row, its queue events, `cost_usd`) and, when a `plan-status` event names the
// story, `GET /stories/{id}?project=` (39.4: the Stage Log rows that cut the engine span into sessions and price each
// stage). Cancel is `POST /runs/{id}/cancel` with the CSRF token `GET /inbox?project=` answers. Before Story 39.6 the
// queue events carry no engine session boundaries: the sessions come from the Stage Log rows and the live `stage`.
// This module imports types only, so the office and status models may import it without an import cycle.
import type { FetchLike, InboxResult } from "../inbox/model";

// ------------------------------------------------------------ the answer (mirrored from apps/supervisor/src/api.ts)

export interface RunEvent {
  seq: number;
  run_id?: string;
  at: string;
  kind: string;
  from_state: string | null;
  to_state: string | null;
  detail: Record<string, any> | null;
}
/** The slice of the queue's run row the page reads (`queue.ts` `QueueRun`). */
export interface RunRow {
  run_id: string;
  job_id: string;
  project_id: string | null;
  state: string;
  reason: string | null;
  created: string;
  updated?: string;
  engine_run_id: string | null;
  worker_pid?: number | null;
  worker_guard_s?: number | null;
  /** JSON: the definition the run was driven with (its `guards`). */
  definition?: string | null;
}
export interface ClaimRefused { reason: string; resolves: string | null }
export interface RunAnswer {
  ok: true;
  run_id: string;
  studio_run_id: string | null;
  state: string;
  cost_usd: number | null;
  claim_refused?: ClaimRefused | null;
  run: RunRow;
  events: RunEvent[];
}
/** The run and its events: what the clock and the timeline read. */
export type RunDetail = Pick<RunAnswer, "run" | "events">;

export const LOADING_RUN = "Loading the run…";

/** The store's row for a run as the run page's re-read key (Settled shape 10 and 11): `GET /runs/{id}` is re-read
 * when the run's `state`, `stage` or open host-verify leg (`leg.since`, operator ruling 2026-11-10) changes. "" with
 * no row. */
export function runRowKey(row: { state?: string | null; stage?: string | null; leg?: { since: string } | null } | null | undefined): string {
  return row ? `${row.state ?? ""}:${row.stage ?? ""}:${row.leg?.since ?? ""}` : "";
}
export const LOADING_CLOCK = "Loading the clock…";
/** A run read that failed: the clock in words, never a loading label forever. */
export const clockUnread = (error: string): string => `The clock could not be read: ${error}`;
/** The run's ending events: `ended`, or `orphaned` (the supervisor's `recover` after a restart, `queue.ts`). */
export const isEndingEvent = (e: { kind: string }): boolean => e.kind === "ended" || e.kind === "orphaned";
export const LOADING_STAGE_LOG = "Loading the Stage Log…";
export const LOADING_STAGE = "Loading the stage…";
export const NO_STORY_YET = "no story yet";
export const notFoundRun = (id: string): string => `No run ${id} in the queue`;

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const TERMINAL: ReadonlySet<string> = new Set(["complete", "partial", "blocked", "cancelled"]);
export const isTerminalState = (s: string | null | undefined): boolean => typeof s === "string" && TERMINAL.has(s);

// ------------------------------------------------------------ the reads

/** Absolute: the page carries `<base href="/app/">`. */
export const runUrl = (id: string): string => `/runs/${encodeURIComponent(id)}`;
export const cancelUrl = (id: string): string => `/runs/${encodeURIComponent(id)}/cancel`;
export const storyStagesUrl = (project: string, id: string): string => `/stories/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`;
export const runPagePath = (id: string): string => `/app/run/${encodeURIComponent(id)}`;

export type RunResult = { ok: true; answer: RunAnswer } | { ok: false; error: string; notFound?: true };
const GET: RequestInit = { credentials: "same-origin", headers: { accept: "application/json" } };
const defaultFetch: FetchLike = (u, i) => fetch(u, i);

/** `GET /runs/{id}` with the session cookie. Never throws: a 404 reads `No run <id> in the queue`, another refusal
 * `<url> answered <status> <error>`, a network error or a malformed body names itself. */
export async function fetchRun(id: string, fetchFn: FetchLike = defaultFetch): Promise<RunResult> {
  const url = runUrl(id);
  try {
    const res = await fetchFn(url, GET);
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status === 404) return { ok: false, error: notFoundRun(id), notFound: true };
    if (!res.ok) return { ok: false, error: `${url} answered ${res.status}${isObj(body) && typeof body.error === "string" ? ` ${body.error}` : ""}` };
    if (!isObj(body) || body.ok !== true || !isObj(body.run) || !Array.isArray(body.events)) return { ok: false, error: `${url}: no run in the answer` };
    return { ok: true, answer: { ...(body as unknown as RunAnswer), cost_usd: typeof body.cost_usd === "number" && Number.isFinite(body.cost_usd) ? body.cost_usd : null } };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The story id 39.4's route takes (`stories.ts` `STORY_ID_RE`). */
export const STORY_ID_RE = /^ST-\d{3,}$/;

/** The run's story: the latest `plan-status` event whose `detail.id` is an ST id (Story 36.6's `in-progress` event
 * names it on a running launched run); null when none. */
export function storyIdOf(events: readonly RunEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "plan-status" && typeof e.detail?.id === "string" && STORY_ID_RE.test(e.detail.id)) return e.detail.id;
  }
  return null;
}

/** A Stage Log row by CAP-12's names (`stage`, `start`, `stop`, `model`, `tokens`, `cost`) or the table's columns
 * (`pass`, `started`, `ended`, `cost_usd`, as 39.4's `GET /stories/{id}` serves them). */
export interface StageRowLike {
  stage: string | null;
  pass?: string | number | null;
  start?: string | null;
  started?: string | null;
  stop?: string | null;
  ended?: string | null;
  cost?: number | string | null;
  cost_usd?: number | string | null;
  model?: string | null;
}
export type StagesResult = { ok: true; rows: StageRowLike[] } | { ok: false; error: string };

/** `GET /stories/{id}?project=<id>`'s Stage Log rows (`stage_log.rows`). Never throws: a refusal reads `<error>:
 * <detail>` (the supervisor's, e.g. `UnknownStory: …`), else `<url> answered <status>`. */
export async function fetchStoryStages(project: string, id: string, fetchFn: FetchLike = defaultFetch): Promise<StagesResult> {
  const url = storyStagesUrl(project, id);
  try {
    const res = await fetchFn(url, GET);
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      if (isObj(body) && typeof body.error === "string") {
        const detail = typeof body.detail === "string" ? body.detail : null;
        return { ok: false, error: detail ? `${body.error}: ${detail}` : body.error };
      }
      return { ok: false, error: `${url} answered ${res.status}` };
    }
    const rows = isObj(body) && isObj(body.stage_log) && Array.isArray(body.stage_log.rows) ? body.stage_log.rows : null;
    if (!rows) return { ok: false, error: `${url}: no Stage Log in the answer` };
    return { ok: true, rows: rows.filter(isObj) as StageRowLike[] };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const rowStart = (r: StageRowLike): string | null => str(r.start) ?? str(r.started);
const rowStop = (r: StageRowLike): string | null => str(r.stop) ?? str(r.ended);
const COST_RE = /^\$?\d+(\.\d+)?$/;
/** A row's cost: a number, or a string `$1.23` / `1.23`; `—` (or anything else) is no cost. */
export function rowCost(r: StageRowLike): number | null {
  const v = r.cost ?? r.cost_usd;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && COST_RE.test(v.trim())) return Number(v.trim().replace(/^\$/, ""));
  return null;
}

/** `Array.prototype.findLast` (ES2023; the web's lib is ES2022). */
function findLastOf<T>(xs: readonly T[], pred: (x: T) => boolean): T | undefined {
  for (let i = xs.length - 1; i >= 0; i--) if (pred(xs[i])) return xs[i];
  return undefined;
}
const ms = (iso: string | null | undefined): number => (typeof iso === "string" ? Date.parse(iso) : NaN);
const iso = (t: number): string => new Date(t).toISOString();

// ------------------------------------------------------------ the timeline (Settled shape 2)

export interface Suite { name: string; seconds: number }
export interface Segment {
  kind: "queued" | "launch" | "worker" | "engine" | "session" | "host-leg" | "re-run" | "close-out" | "paused" | "ended";
  label: string;
  start: string;
  end: string | null;
  outcome?: string;
  suites?: Suite[];
}
export interface Timeline {
  segments: Segment[];
  /** The segment still open (the latest one with no end), else null. */
  open: Segment | null;
  ended: { state: string; words: string } | null;
}
export interface TimelineInput {
  run: RunRow;
  events: readonly RunEvent[];
  /** 39.4's Stage Log rows, or null (unknown story, pending or unread). */
  stageRows: readonly StageRowLike[] | null;
  /** The store's `runs[].stage` for this run (0.1.35), or null. */
  liveStage: string | null;
  now: number;
}

/** 38.1's `LEG_SUITES`, mirrored: the order the suites are shown in; the rest follow by name. */
export const LEG_SUITES = ["lib suite", "conformance", "supervisor", "studio-web"] as const;

export function suitesOf(d: Record<string, any> | null | undefined): Suite[] | undefined {
  const s = d?.suite_durations;
  if (!isObj(s)) return undefined;
  const all = Object.entries(s).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).map(([name, seconds]) => ({ name, seconds: seconds as number }));
  const rank = (n: string) => { const i = (LEG_SUITES as readonly string[]).indexOf(n); return i < 0 ? LEG_SUITES.length : i; };
  return all.sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A `host-verify` detail's outcome: `skipped`, `green`, `inconclusive (guard)` (the guard cut it and no suite is
 * red), else `red`. */
export function legOutcome(d: Record<string, any> | null | undefined): string {
  if (!d) return "red";
  if (d.skipped === true) return "skipped";
  if (d.green === true) return "green";
  const red = Array.isArray(d.verdicts) && d.verdicts.some((l: unknown) => typeof l === "string" && /\bFAILED\b|\bred\b/.test(l));
  if (typeof d.guard === "string" && d.guard !== "" && !red) return "inconclusive (guard)";
  return "red";
}

const ENDED_WORD: Record<string, string> = { complete: "Complete", partial: "Partial", blocked: "Blocked", cancelled: "Cancelled" };
/** An ended run's final state in words: `Complete: <reason>` (else `: no reason recorded`); null while not ended (an
 * `external` run is never ended here). */
export function endedWords(run: Pick<RunRow, "state" | "reason">): string | null {
  const word = ENDED_WORD[run.state];
  if (!word) return null;
  return `${word}: ${str(run.reason) ?? "no reason recorded"}`;
}

const hasOwner = (e: RunEvent) => e.detail?.owner !== null && e.detail?.owner !== undefined;
const SESSION_STAGES = new Set(["dev", "review", "gate", "triage"]);

/** The run's timeline from its queue events (one mapping table, Settled shape 2), the engine span cut into sessions by
 * the Stage Log rows (and the live stage for the open session). */
export function runTimeline(input: TimelineInput): Timeline {
  const { run, stageRows, liveStage, now } = input;
  const events = [...input.events].sort((a, b) => a.seq - b.seq);
  const segments: Segment[] = [];
  const open: Partial<Record<"queued" | "launch" | "engine" | "leg" | "closeout" | "paused", Segment>> = {};
  const hasLaunched = events.some((e) => e.kind === "launched");
  const close = (k: keyof typeof open, at: string, extra: Partial<Segment> = {}) => {
    const s = open[k];
    if (!s) return;
    s.end = at;
    Object.assign(s, extra);
    delete open[k];
  };
  const begin = (k: keyof typeof open, s: Segment) => {
    segments.push(s);
    open[k] = s;
  };
  const latestPaused = findLastOf(events, (e) => e.kind === "paused");

  for (const e of events) {
    const d = e.detail;
    switch (e.kind) {
      case "enqueued":
        begin("queued", { kind: "queued", label: "queued", start: e.at, end: null });
        break;
      case "lock-wait":
        if (open.queued) open.queued.label = "queued (waiting for the checkout lock)";
        break;
      case "claimed":
        close("queued", e.at);
        begin("launch", hasLaunched ? { kind: "launch", label: "launch", start: e.at, end: null } : { kind: "worker", label: "worker", start: e.at, end: null });
        break;
      case "launched":
        if (open.launch?.kind === "launch") close("launch", e.at);
        begin("engine", { kind: "engine", label: "engine", start: e.at, end: null });
        break;
      case "engine-gone":
        close("engine", e.at);
        break;
      case "host-verify-leg":
        if (hasOwner(e)) {
          close("engine", e.at);
          close("leg", e.at); // a takeover: the earlier lease's leg ends where the new one starts
          const by = str(d?.by);
          begin("leg", by === null || by === "close-out" ? { kind: "host-leg", label: "host leg", start: e.at, end: null } : { kind: "re-run", label: "re-run", start: e.at, end: null });
        } else {
          close("leg", e.at); // the lease let go of
        }
        break;
      case "host-verify": {
        const extra: Partial<Segment> = { outcome: legOutcome(d) };
        const suites = suitesOf(d);
        if (suites) extra.suites = suites;
        if (open.leg) close("leg", e.at, extra);
        else {
          const rerun = isObj(d?.rerun);
          segments.push({ kind: rerun ? "re-run" : "host-leg", label: rerun ? "re-run" : "host leg", start: str(d?.started_at) ?? e.at, end: e.at, ...extra });
        }
        break;
      }
      case "closing-out":
        if (hasOwner(e)) {
          close("engine", e.at);
          begin("closeout", { kind: "close-out", label: "close-out", start: e.at, end: null });
        } else close("closeout", e.at);
        break;
      case "closed_out":
        close("closeout", e.at);
        break;
      case "paused": {
        close("engine", e.at);
        close("closeout", e.at);
        if (open.launch?.kind === "worker") close("launch", e.at);
        const standing = e === latestPaused && run.state === "paused" ? str(run.reason) : null;
        const reason = standing ?? str(d?.reason) ?? str(d?.engine?.paused_reason) ?? "no reason recorded";
        begin("paused", { kind: "paused", label: `paused: ${reason}`, start: e.at, end: null });
        break;
      }
      case "close-out":
      case "engine-resume":
      case "resumed":
        close("paused", e.at);
        break;
      case "ended":
      case "orphaned":
        for (const k of Object.keys(open) as (keyof typeof open)[]) close(k, e.at);
        segments.push({ kind: "ended", label: "ended", start: e.at, end: e.at });
        break;
      default:
        break;
    }
  }

  // The sessions inside each engine span: the Stage Log rows starting in it, else (live) the open session's stage.
  const ended = isTerminalState(run.state);
  const sessions: Segment[] = [];
  for (const eng of segments.filter((s) => s.kind === "engine")) {
    const a = ms(eng.start), b = eng.end === null ? now : ms(eng.end);
    const rows = (stageRows ?? [])
      .filter((r) => r.stage !== null && SESSION_STAGES.has(r.stage) && ms(rowStart(r)) >= a && ms(rowStart(r)) <= b)
      .sort((x, y) => ms(rowStart(x)) - ms(rowStart(y)));
    const ordinal = new Map<string, number>();
    let openRow = false;
    let lastStop: string | null = null;
    for (const r of rows) {
      const n = (ordinal.get(r.stage!) ?? 0) + 1;
      ordinal.set(r.stage!, n);
      const p = r.pass !== null && r.pass !== undefined && String(r.pass) !== "" ? String(r.pass) : String(n);
      const label = r.stage === "dev" ? `dev attempt ${p}` : r.stage === "review" ? `review pass ${p}` : r.stage === "gate" ? "studio gate" : "triage";
      const stop = rowStop(r);
      if (stop === null) openRow = true;
      else if (lastStop === null || ms(stop) > ms(lastStop)) lastStop = stop;
      sessions.push({ kind: "session", label, start: rowStart(r)!, end: stop });
    }
    if (!ended && eng.end === null && !openRow) {
      sessions.push({ kind: "session", label: liveStage ?? LOADING_STAGE, start: lastStop ?? eng.start, end: null });
    }
  }
  const all = [...segments, ...sessions].sort((x, y) => ms(x.start) - ms(y.start));
  const live = [...all].reverse().find((s) => s.end === null) ?? null;
  const words = endedWords(run);
  return { segments: all, open: live, ended: words ? { state: run.state, words } : null };
}

// ------------------------------------------------------------ the clock (Settled shape 3)

export type ClockMode = "guarded" | "queued" | "claim" | "paused" | "close-out" | "ended";
export interface RunClock {
  elapsed_s: number;
  guard_s: number | null;
  guard: "worker" | "host leg" | null;
  mode: ClockMode;
  label: string;
  over: boolean;
  /** The guard that applies, named (`engine: the worker's guard` / `host leg: the leg's own guard`); null unguarded. */
  context: string | null;
}

/** `HH:MM:SS` of whole seconds (floored), hours two digits or more. */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** The clock's label for `elapsed` seconds (the HUD re-labels its lerped value with it). */
export function clockLabel(mode: ClockMode, elapsed: number, guardS: number | null): string {
  const t = fmtClock(elapsed);
  switch (mode) {
    case "guarded":
      return `${t} of ${fmtClock(guardS ?? 0)}${guardS !== null && Math.floor(elapsed) > guardS ? " (over the guard)" : ""}`;
    case "queued": return `${t} queued (no guard until a worker starts)`;
    case "claim": return `${t} since the claim (the guard starts with the worker)`;
    case "paused": return `${t} paused`;
    case "close-out": return `${t} in close-out`;
    case "ended": return `${t} in all, claim to end`;
  }
}

const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
function definitionOf(run: RunRow): Record<string, any> | null {
  if (typeof run.definition !== "string") return null;
  try {
    const v = JSON.parse(run.definition);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}
/** `hostverify.ts legGuard`, mirrored: `guards.host_verify_seconds`, else `max_wall_clock_seconds`, else 600. */
export function legGuardOf(defn: Record<string, any> | null): number {
  const g = isObj(defn?.guards) ? defn!.guards : {};
  return positive(g.host_verify_seconds) ?? positive(g.max_wall_clock_seconds) ?? 600;
}
const lastIdx = (events: readonly RunEvent[], pred: (e: RunEvent) => boolean): number => {
  for (let i = events.length - 1; i >= 0; i--) if (pred(events[i])) return i;
  return -1;
};
const kindIs = (...kinds: string[]) => (e: RunEvent) => kinds.includes(e.kind);

function make(mode: ClockMode, anchor: number | null, until: number, guardS: number | null = null, guard: RunClock["guard"] = null): RunClock {
  const elapsed = anchor === null || Number.isNaN(anchor) ? 0 : Math.max(0, Math.floor((until - anchor) / 1000));
  return {
    elapsed_s: elapsed, guard_s: guardS, guard, mode, label: clockLabel(mode, elapsed, guardS),
    over: guardS !== null && elapsed > guardS,
    context: guard === "worker" ? "engine: the worker's guard" : guard === "host leg" ? "host leg: the leg's own guard" : null,
  };
}

/** The run's clock against the guard that applies (first match wins, Settled shape 3). */
export function runClock(detail: RunDetail, now: number): RunClock {
  const { run } = detail;
  const events = [...detail.events].sort((a, b) => a.seq - b.seq);
  // Ended (an `ended` or an `orphaned` event): the clock stops, the latest claimed to the end — before any open lease.
  if (isTerminalState(run.state)) {
    const claimed = findLastOf(events, (e) => e.kind === "claimed");
    const end = findLastOf(events, isEndingEvent);
    return make("ended", ms(claimed?.at ?? run.created), ms(end?.at ?? run.updated ?? run.created));
  }
  // A host leg open: the latest owned lease with no host-verify (nor a later lease event) after it.
  const lease = lastIdx(events, kindIs("host-verify-leg"));
  if (lease >= 0 && hasOwner(events[lease]) && lastIdx(events, kindIs("host-verify")) < lease) {
    const e = events[lease];
    return make("guarded", ms(e.at), now, positive(e.detail?.guard_s) ?? legGuardOf(definitionOf(run)), "host leg");
  }
  if (run.state === "running") {
    const move = lastIdx(events, kindIs("claimed", "close-out", "engine-resume"));
    const worker = lastIdx(events, kindIs("worker"));
    const stopped = events.some((e, i) => i > worker && (e.kind === "engine-gone" || ((e.kind === "closing-out" || e.kind === "host-verify-leg") && hasOwner(e))));
    if (worker >= 0 && worker > move && !stopped) {
      const w = events[worker];
      const defn = definitionOf(run);
      const guardS = positive(w.detail?.guard_s) ?? positive(run.worker_guard_s) ?? positive(defn?.guards?.max_wall_clock_seconds) ?? 600;
      return make("guarded", ms(w.at), now, guardS, "worker");
    }
  }
  if (run.state === "queued") return make("queued", ms(run.created), now);
  const claimed = findLastOf(events, (e) => e.kind === "claimed");
  if (run.state === "paused") return make("paused", ms(findLastOf(events, (e) => e.kind === "paused")?.at ?? run.updated ?? run.created), now);
  if (run.state === "running" || run.state === "external") {
    const moved = lastIdx(events, kindIs("claimed", "close-out", "engine-resume"));
    const closing = (e: RunEvent) => e.kind === "engine-gone" || e.kind === "host-verify" || ((e.kind === "closing-out" || e.kind === "host-verify-leg") && hasOwner(e));
    // Between legs of the close-out: from the close-out segment's start (its first closing event since the move).
    const start = events.findIndex((e, i) => i > moved && closing(e));
    if (start >= 0) return make("close-out", ms(events[start].at), now);
    // Running, no worker yet (or none since the move): since the latest claim.
    return make("claim", ms(claimed?.at ?? run.created), now);
  }
  // Any other state (none reaches here today): as ended, the latest claimed to the ending event.
  const end = findLastOf(events, isEndingEvent);
  return make("ended", ms(claimed?.at ?? run.created), ms(end?.at ?? run.updated ?? run.created));
}

// ------------------------------------------------------------ the cost (Settled shape 4)

export interface CostStage { stage: string; usd: number }
export interface CostView {
  source: "stage-log" | "run-total" | "none" | "pending";
  label: string;
  stages: CostStage[];
  total: number | null;
}
export interface CostInput {
  storyId: string | null;
  /** The story's Stage Log rows; null while the read is pending. */
  stageRows: readonly StageRowLike[] | null;
  /** The story read's failure, else null. */
  error?: string | null;
  /** The run's project: null means the story's Stage Log can never be read (no `?project=`), so the run's total
   * shows; omitted, the read is assumed possible. */
  project?: string | null;
  cost_usd: number | null;
  /** The run's window: its claim to its end (null: now). */
  window: { start: string | null; end: string | null };
  now: number;
}

/** The run's window: the first `claimed` to the ending (`ended` or `orphaned`; null while live). */
export function runWindow(events: readonly RunEvent[]): { start: string | null; end: string | null } {
  return { start: events.find((e) => e.kind === "claimed")?.at ?? null, end: findLastOf(events, isEndingEvent)?.at ?? null };
}

/** The cost per stage from the Stage Log rows inside the run's window, else the run's total, in words. */
export function costView(i: CostInput): CostView {
  const total = (reason: string): CostView =>
    i.cost_usd === null ? { source: "none", label: "Not metered yet", stages: [], total: null }
      : { source: "run-total", label: `Run total (${reason})`, stages: [], total: i.cost_usd };
  if (i.storyId === null) return total("no story known for this run");
  if (i.project === null) return total(`the story could not be read: ${NO_PROJECT_WORDS}`);
  if (i.error) return total(`the story could not be read: ${i.error}`);
  if (i.stageRows === null) return { source: "pending", label: LOADING_STAGE_LOG, stages: [], total: null };
  const a = ms(i.window.start), b = i.window.end === null ? i.now : ms(i.window.end);
  const sums = new Map<string, number>();
  for (const r of i.stageRows) {
    const t = ms(rowStart(r));
    if (Number.isNaN(a) || Number.isNaN(t) || t < a || t > b) continue;
    const c = rowCost(r);
    if (c === null) continue;
    const k = r.stage ?? "?";
    sums.set(k, (sums.get(k) ?? 0) + c);
  }
  if (!sums.size) return total("the Stage Log has no costed rows for this run");
  const stages = [...sums].map(([stage, usd]) => ({ stage, usd }));
  return { source: "stage-log", label: `Cost by stage, from the Stage Log of ${i.storyId}`, stages, total: stages.reduce((n, s) => n + s.usd, 0) };
}

// ------------------------------------------------------------ the events list (Settled shape 6)

export interface EventRow { seq: number; summary: string; body: string }
const localTime = (at: string): string => {
  const t = Date.parse(at);
  return Number.isNaN(t) ? at : new Date(t).toLocaleString();
};
/** One row per event, oldest first: `<seq> · <local time> · <kind>` (` · <from> → <to>` when the state moved), the
 * detail as indented JSON (folded by the page). */
export function eventRows(events: readonly RunEvent[], local: (at: string) => string = localTime): EventRow[] {
  return [...events].sort((a, b) => a.seq - b.seq).map((e) => ({
    seq: e.seq,
    summary: `${e.seq} · ${local(e.at)} · ${e.kind}${e.from_state !== e.to_state ? ` · ${e.from_state ?? "none"} → ${e.to_state ?? "none"}` : ""}`,
    body: JSON.stringify(e.detail, null, 2) ?? "null",
  }));
}

// ------------------------------------------------------------ Cancel (Settled shape 5)

export const CANCEL_CONSEQUENCE =
  "Cancel stops this run for good: a launched engine is stopped gracefully, the worker is killed and the run ends cancelled; it cannot be resumed. Commits already made stay on the run's branch.";
export const EXTERNAL_WORDS = "Started outside the queue: the supervisor never cancels it";
export const CSRF_WORDS = "The page's token was refused; reload the page";
export const NO_PROJECT_WORDS = "no project on the run";
export const NO_TOKEN_PROJECT = "No project on the run: the page's token cannot be read, so nothing was posted";

/** Who may cancel: `queued`, `running`, `paused` may; `external` shows a disabled Cancel naming why; a terminal run
 * shows none. */
export function canCancel(run: Pick<RunRow, "state">): { show: boolean; enabled: boolean; note: string | null } {
  if (run.state === "queued" || run.state === "running" || run.state === "paused") return { show: true, enabled: true, note: null };
  if (run.state === "external") return { show: true, enabled: false, note: EXTERNAL_WORDS };
  return { show: false, enabled: false, note: null };
}

export type CancelResult = { ok: true; words: string } | { ok: false; words: string };
/** `POST /runs/{id}/cancel` with `x-csrf-token`. Never throws; every answer is in words. */
export async function postCancel(runId: string, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<CancelResult> {
  const url = cancelUrl(runId);
  try {
    const res = await fetchFn(url, {
      method: "POST", credentials: "same-origin",
      headers: { accept: "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.ok) return { ok: true, words: "Cancelled." };
    const error = isObj(body) && typeof body.error === "string" ? body.error : null;
    if (res.status === 409 && error === "RunTerminal") return { ok: false, words: `Already ended: ${isObj(body) && typeof body.state === "string" ? body.state : "unknown"}` };
    if (res.status === 409 && error === "ExternalRun") return { ok: false, words: EXTERNAL_WORDS };
    if (res.status === 403 && error === "CsrfRefused") return { ok: false, words: CSRF_WORDS };
    if (res.status === 404) return { ok: false, words: notFoundRun(runId) };
    return { ok: false, words: `${url} answered ${res.status}${error ? ` ${error}` : ""}` };
  } catch (e) {
    return { ok: false, words: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Cancel's request: read the CSRF token (`readInbox`, i.e. `fetchInbox` from `../inbox/model`, passed in because that
 * module imports this one through the office model), then post. No project, a failed inbox read or an answer without a
 * token posts nothing (a cookie session would only earn `403 CsrfRefused`): the reason in words. */
export async function requestCancel(
  runId: string, project: string | null,
  readInbox: (project: string, fetchFn: FetchLike) => Promise<InboxResult>,
  fetchFn: FetchLike = defaultFetch,
): Promise<CancelResult> {
  if (project === null) return { ok: false, words: NO_TOKEN_PROJECT };
  const inbox = await readInbox(project, fetchFn);
  if (!inbox.ok) return { ok: false, words: `The session token could not be read, so nothing was posted: ${inbox.error}` };
  if (!inbox.csrf) return { ok: false, words: "The inbox answered without a session token, so nothing was posted" };
  return postCancel(runId, inbox.csrf, fetchFn);
}
