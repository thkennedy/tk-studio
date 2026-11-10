// The Office screen's rules (Story 30.4, design spec §6.3, §7.3): pure functions vitest drives in
// `environment: "node"`. No pixi.js, no DOM: `fetch`, `localStorage` and the clock are injected.
// The canvas lives in `src/renderer/scene.ts`, the composition in `OfficeScreen.tsx`.
// Story 39.5 (CAP-17, the 2026-09-01 office grammar, addendum §3.4): the HUD shows the run's `stage` (0.1.35), its clock
// (`runClock` over `GET /runs/{id}`) and a phased bar — the epic as the project bar, its stories as phases, the epic's
// open review findings (`GET /board`) as a count to drain. Every HUD value is held at least `HOLD_MS` before it may
// change (`hold`); the clock and the bars lerp over `LERP_MS` (`tween`, `valueAt`); `hudMotion` applies both. Pure, the
// clock injected.
import type { BoardAnswer } from "../board/model";
import { blockedIssueOf, LIVE_RUN_STATES, OFFICE_STATES, type BlockedIssue, type LiveState, type OfficeAgent, type OfficeRun, type OfficeState, type StoryStatus } from "../live/store";
import { clockLabel, clockUnread, LOADING_CLOCK, runClock, runRowKey, type RunClock, type RunDetail } from "../run/model";

// ------------------------------------------------------------ frames

/** Frame sets by office state: the shared sets (for a role the sheet does not carry), plus the
 * per-role sets built from the atlas by name (Story 30.7). */
export interface FrameSheet<F> {
  frames: Readonly<Record<OfficeState, readonly F[]>>;
  roles?: Readonly<Record<string, Partial<Record<OfficeState, readonly F[]>>>>;
}

export type Warn = (message: string) => void;

/** The gaps already warned about, per sheet: `syncDesks` asks on every store change. */
const warned = new WeakMap<object, Set<string>>();

/** The pose's frames. A role the sheet carries gets its own set for `state`; when that set is
 * missing, the role's `idle` set, with one warning per sheet naming the gap `<role>.<state>`
 * through `warn`. A role the sheet does not carry gets the shared set for `state`, without a
 * warning. An unknown state reads as `offline`. */
export function framesFor<F>(sheet: FrameSheet<F>, role: string, state: string, warn: Warn = console.warn): readonly F[] {
  const s: OfficeState = isOfficeState(state) ? state : "offline";
  const own = sheet.roles?.[role];
  if (!own) return sheet.frames[s];
  const set = own[s];
  if (set?.length) return set;
  const gap = `${role}.${s}`;
  let gaps = warned.get(sheet);
  if (!gaps) warned.set(sheet, (gaps = new Set()));
  if (!gaps.has(gap)) {
    gaps.add(gap);
    const shown = own.idle?.length ? `${role}.idle` : `the shared ${s} set (${role} has no idle frames)`;
    warn(`office sheet: no frames for ${gap}; showing ${shown}`);
  }
  return own.idle?.length ? own.idle : sheet.frames[s];
}

export const isOfficeState = (s: unknown): s is OfficeState => (OFFICE_STATES as readonly unknown[]).includes(s);

// ------------------------------------------------------------ the bubble

/** The DOM bubble over a character: a desk whose work is blocked on the owner (a non-null
 * `blocked_issue`, Story 31.5) shows the persistent "!" naming the issue, whatever its state —
 * it clears only when the projection clears the field (the status changed), never on a comment
 * or a message. Otherwise only `waiting-for-human` and `blocked` have one, naming the
 * projection's reason ("waiting" / "blocked" when the reason is null). */
export function bubbleFor(agent: { state: string; reason?: string | null; blocked_issue?: BlockedIssue | null }): string | null {
  if (agent.blocked_issue) return `! ${agent.blocked_issue.issue}`;
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
  /** The store agent's `blocked_issue` (0.1.26), else null: the "!" follows it alone. */
  blocked_issue: BlockedIssue | null;
}

const roleOf = (row: RegistryRow): string => row.role ?? row.agent_id.slice(row.agent_id.lastIndexOf("/") + 1);
const projectOf = (row: RegistryRow): string => row.project ?? row.agent_id.slice(0, Math.max(0, row.agent_id.lastIndexOf("/")));

/** The desks for the registry rows, in row order. */
export function desksFrom(rows: readonly RegistryRow[], agents: readonly OfficeAgent[] | null | undefined): Desk[] {
  const live = new Map((agents ?? []).map((a) => [a.agent_id, a]));
  return rows.map((row) => {
    const a = live.get(row.agent_id);
    const raw = a?.state ?? row.live_state;
    return {
      agent_id: row.agent_id, role: roleOf(row), state: isOfficeState(raw) ? raw : "offline", reason: a?.reason ?? null,
      blocked_issue: blockedIssueOf(a?.blocked_issue),
    };
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
/** A pending live value (the run's engine id, the current story's phase): TKSTUDIO-213. */
export const LOADING = "Loading…";

export interface HudLive {
  run_id: string;
  /** Story 39.5: the run's stage (`office.progress.stage`), `Loading…` until the store names it. */
  stage: string;
  /** Story 39.5: the run's clock (`runClock` of its `GET /runs/{id}`), null until read. */
  clock: RunClock | null;
  /** The clock's label, `Loading the clock…` until read. */
  clockText: string;
  /** Story 39.5: the phased bar. */
  bar: PhasedBar;
  /** The run's queue state, `pending` while unknown (a progress-born row). */
  state: string;
  /** `Loading…` until the snapshot names it. */
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

/** Story 39.5: the HUD's reads — the project's board (null while pending) and the live run's `GET /runs/{id}` (or its
 * failure, `detailError`: the clock then reads `The clock could not be read: …`, never a loading label forever). */
export interface HudExtras {
  board?: BoardRead | null;
  detail?: (RunDetail & { run_id?: string }) | null;
  detailError?: { run_id: string; error: string } | null;
}

/** The HUD's `GET /runs/{id}` re-read key (Settled shapes 11 and 12): the live run's id and its store row's `runRowKey`
 * (its `state`, `stage`, open host-verify `leg.since` and the worker's `worker.since`); "" with no live run. The screen re-reads when it changes. */
export function hudRunKey(state: LiveState, project: string): string {
  const run = liveRunOf(state, project);
  return run ? `${run.run_id}|${runRowKey(run)}` : "";
}

/** The HUD's fields for `project` from the store's state at `now` (ms). */
export function hudModel(state: LiveState, project: string, now: number, extras: HudExtras = {}): HudModel {
  const since = sinceText(state.lastEventAt, now);
  const run = liveRunOf(state, project);
  if (run) {
    const current = run.epic?.current_story ?? null;
    const story = current ? run.stories.find((s) => s.key === current) : undefined;
    const detail = extras.detail && extras.detail.run.run_id === run.run_id ? extras.detail : null;
    const clock = detail ? runClock(detail, now) : null;
    return {
      project,
      live: {
        run_id: run.run_id,
        stage: run.stage ?? LOADING,
        clock,
        clockText: clock
          ? clock.label
          : extras.detailError && extras.detailError.run_id === run.run_id ? clockUnread(extras.detailError.error) : LOADING_CLOCK,
        bar: phasedBar(run, extras.board ?? null),
        state: run.state ?? PENDING,
        engine_run_id: run.engine_run_id ?? LOADING,
        done: run.epic?.done ?? 0,
        failed: run.epic?.failed ?? 0,
        total: run.epic?.total ?? 0,
        story: current ?? NONE,
        phase: story?.phase ?? LOADING,
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

// ------------------------------------------------------------ the phased bar (Story 39.5, Settled shape 8)

/** The board read the HUD takes: the answer, its failure, or null while pending. */
export type BoardRead = { ok: true; board: BoardAnswer } | { ok: false; error: string };
export const LOADING_FINDINGS = "Loading the findings…";
export interface Phase { key: string; status: StoryStatus; fill: number }
export interface PhasedBar {
  total: number;
  done: number;
  /** The project bar: `done / total` (0 when `total` is 0). */
  fraction: number;
  /** The run's stories (not `extra`), padded with `pending` phases up to `total`. */
  phases: Phase[];
  findings: { count: number | null; label: string };
}

const FILL: Record<StoryStatus, number> = { done: 1, deferred: 1, failed: 1, current: 0.5, pending: 0 };

/** The epic number a run works on: its `spec_folder`'s `spec-epic-<N>`, else the current story's leading `N`. */
export function epicNumberOf(run: Pick<OfficeRun, "epic">): string | null {
  const m = /spec-epic-(\d+)/.exec(run.epic?.spec_folder ?? "");
  if (m) return m[1];
  const c = /^(\d+)[-.]/.exec(run.epic?.current_story ?? "");
  return c ? c[1] : null;
}

/** The phased bar of a live run (the epic the project bar, its stories the phases) and its epic's findings to drain
 * (the board epic whose stories hold an `N.M` key of the run's epic number). */
export function phasedBar(run: Pick<OfficeRun, "epic" | "stories">, board: BoardRead | null): PhasedBar {
  const total = Math.max(0, run.epic?.total ?? 0);
  const done = run.epic?.done ?? 0;
  const phases: Phase[] = (run.stories ?? []).filter((s) => !s.extra).map((s) => ({ key: s.key, status: s.status, fill: FILL[s.status] ?? 0 }));
  // The padding's keys name its position; `hudMotion` holds and lerps each phase by position, so a story replacing a
  // placeholder lerps its fill from the placeholder's.
  for (let i = phases.length; i < total; i++) phases.push({ key: `pending-${i + 1}`, status: "pending", fill: 0 });
  let findings: PhasedBar["findings"];
  if (board === null) findings = { count: null, label: LOADING_FINDINGS };
  else if (!board.ok) findings = { count: null, label: `Findings unread: ${board.error}` };
  else {
    const n = epicNumberOf(run);
    const epic = n === null ? undefined : board.board.epics.find((e) => e.stories.some((s) => s.key.startsWith(`${n}.`)));
    findings = epic ? { count: epic.findings, label: `${epic.findings} findings to drain` } : { count: null, label: "No findings read for this epic" };
  }
  return { total, done, fraction: total > 0 ? done / total : 0, phases, findings };
}

// ------------------------------------------------------------ the hold and the lerp (Story 39.5, Settled shape 9)

export const HOLD_MS = 1000;
export const LERP_MS = 500;
export interface Held<T> { value: T; since: number }
export interface Tween { from: number; to: number; start: number }

/** A HUD value held at least `HOLD_MS`: the first shows at once; an equal (JSON) raw value keeps `prev`; a different
 * one replaces the shown value only once it has shown `HOLD_MS`, then shows from `now`. A burst A→B→A inside the hold
 * never shows B. */
export function hold<T>(prev: Held<T> | null, raw: T, now: number): Held<T> {
  if (prev === null) return { value: raw, since: now };
  if (JSON.stringify(prev.value) === JSON.stringify(raw)) return prev;
  return now - prev.since >= HOLD_MS ? { value: raw, since: now } : prev;
}

/** The tween's value at `now`: linear from `from` to `to` over `LERP_MS`, the target from `start + LERP_MS` on. */
export function valueAt(tw: Tween, now: number): number {
  const k = Math.min(1, Math.max(0, (now - tw.start) / LERP_MS));
  return tw.from + (tw.to - tw.from) * k;
}

/** Toward `target`: the first target shows at once; a new target starts from the current value (a retarget mid-tween
 * never jumps); the same target keeps `prev`. */
export function tween(prev: Tween | null, target: number, now: number): Tween {
  if (prev === null) return { from: target, to: target, start: now - LERP_MS };
  if (prev.to === target) return prev;
  return { from: valueAt(prev, now), to: target, start: now };
}

/** Whether a tween is still moving at `now` (the screen animates with `requestAnimationFrame` while one is). */
export const inFlight = (tw: Tween, now: number): boolean => now < tw.start + LERP_MS && tw.from !== tw.to;

/** The HUD's motion state: each held value by key, each tween by key. */
export interface HudMotion { held: Record<string, Held<unknown>>; tweens: Record<string, Tween> }
/** What the HUD shows of a live run after the hold and the lerp. */
export interface HudShown {
  run_id: string;
  /** The run's queue state, held. */
  state: string;
  story: string;
  /** The current story's phase, held. */
  phase: string;
  /** `done N · failed N · total N`, held as one. */
  counts: string;
  /** The engine's run id, held. */
  engine_run_id: string;
  stage: string;
  findings: string;
  clockText: string;
  clockContext: string | null;
  over: boolean;
  fraction: number;
  phases: Phase[];
  moving: boolean;
}

/** Apply the hold to every HUD value (the run id and state, the story and its phase, the stage, the counts, the
 * engine id, the findings, the clock — its mode, guard, context and elapsed seconds held as one value, so a guard hand-over never shows
 * the new guard against the old elapsed — and each phase by its position), then the lerp to the clock's elapsed
 * seconds, the project bar's fraction and each phase's fill (by position: a story replacing a placeholder lerps). */
export function hudMotion(prev: HudMotion | null, live: HudLive, now: number): { motion: HudMotion; shown: HudShown } {
  const held: Record<string, Held<unknown>> = {};
  const tweens: Record<string, Tween> = {};
  const h = <T,>(key: string, raw: T): T => {
    const next = hold((prev?.held[key] as Held<T> | undefined) ?? null, raw, now);
    held[key] = next;
    return next.value;
  };
  const t = (key: string, target: number): number => {
    const next = tween(prev?.tweens[key] ?? null, target, now);
    tweens[key] = next;
    return valueAt(next, now);
  };
  const run_id = h("run_id", live.run_id);
  const state = h("state", live.state);
  const story = h("story", live.story);
  const phase = h("phase", live.phase);
  const stage = h("stage", live.stage);
  const counts = h("counts", `done ${live.done} · failed ${live.failed} · total ${live.total}`);
  const findings = h("findings", live.bar.findings.label);
  const engine_run_id = h("engine_run_id", live.engine_run_id);
  const clock = h<{ mode: RunClock["mode"]; guard_s: number | null; context: string | null; elapsed_s: number } | { text: string }>(
    "clock",
    live.clock ? { mode: live.clock.mode, guard_s: live.clock.guard_s, context: live.clock.context, elapsed_s: live.clock.elapsed_s } : { text: live.clockText },
  );
  let clockText: string;
  let clockContext: string | null = null;
  let over = false;
  if ("mode" in clock) {
    // The tween is keyed by the clock's mode and guard: a hand-over starts the new clock at its own value, never a
    // lerp from the old guard's elapsed (backwards, and over the new guard on the way).
    const elapsed = t(`elapsed:${clock.mode}:${clock.guard_s ?? ""}`, clock.elapsed_s);
    clockText = clockLabel(clock.mode, elapsed, clock.guard_s);
    clockContext = clock.context;
    over = clock.guard_s !== null && Math.floor(elapsed) > clock.guard_s;
  } else clockText = clock.text;
  const fraction = t("fraction", h("fraction_raw", live.bar.fraction));
  const phases = live.bar.phases.map((p, i) => {
    const held = h(`phase:${i}`, { key: p.key, status: p.status });
    return { key: held.key, status: held.status, fill: t(`fill:${i}`, FILL[held.status] ?? 0) };
  });
  const moving = Object.values(tweens).some((tw) => inFlight(tw, now));
  return {
    motion: { held, tweens },
    shown: { run_id, state, story, phase, counts, engine_run_id, stage, findings, clockText, clockContext, over, fraction, phases, moving },
  };
}
