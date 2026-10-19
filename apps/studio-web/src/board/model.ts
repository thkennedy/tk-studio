// The Board screen's rules (Story 30.5, design spec §6.3): pure functions vitest drives in
// `environment: "node"`. No DOM: `fetch` is injected. The composition is `BoardScreen.tsx`.
// The screen reads only `GET /board?project=<id>` (plus the `/agents` project list the Office already reads).
import type { LiveState } from "../live/store";
import { fetchAgents, NONE, safeHref } from "../office/model";

// ------------------------------------------------------------ the answer (mirrored from apps/supervisor/src/board.ts)

export type HostVerifyOutcome = "green" | "red" | "skipped";
export interface BoardFinding { id: string; title: string; severity: string | null }
export interface BoardStoryRun { run_id: string; state: string; pr: string | null; host_verify: HostVerifyOutcome | null; ended_at: string | null }
export interface BoardStory { id: string; key: string; title: string; status: string; findings: BoardFinding[]; run: BoardStoryRun | null }
export interface BoardEpic { id: string; title: string; status: string; band_usd: number | null; spend_usd: number; findings: number; stories: BoardStory[] }
export interface TriageItem { run_id: string; state: string; story_key: string | null; pr: string | null; ruling: string | null }
export interface BoardAnswer {
  ok: true;
  project: string;
  built_at: string;
  plan: { reason?: string };
  epics: BoardEpic[];
  triage: { needs_you: TriageItem[]; working: TriageItem[]; done: TriageItem[] };
}

// ------------------------------------------------------------ the read

/** Absolute: the page carries `<base href="/app/">`. */
export const BOARD_URL = "/board";
export const boardUrl = (project: string): string => `${BOARD_URL}?project=${encodeURIComponent(project)}`;

/** The Office's fetch seam (`fetchAgents`' own parameter type), reused. */
export type FetchLike = NonNullable<Parameters<typeof fetchAgents>[1]>;
export type BoardResult = { ok: true; board: BoardAnswer } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The parts the screen dereferences: `plan` an object, each epic an object with a `stories` array, each story an
 * object with a `findings` array, and the triage's three columns arrays. */
const isBoardShape = (body: Record<string, unknown>): boolean =>
  body.ok === true && isObj(body.plan) && isObj(body.triage)
  && Array.isArray(body.triage.needs_you) && Array.isArray(body.triage.working) && Array.isArray(body.triage.done)
  && Array.isArray(body.epics)
  && body.epics.every((e) => isObj(e) && Array.isArray(e.stories) && e.stories.every((s) => isObj(s) && Array.isArray(s.findings)));

/** `GET /board?project=<id>` on this origin with the session cookie. Never throws: a non-200 (naming the
 * supervisor's `error` when it sent one), a network error or a malformed body is `{ok:false, error}`. */
export async function fetchBoard(project: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<BoardResult> {
  const url = boardUrl(project);
  try {
    const res = await fetchFn(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) {
      let named = "";
      try {
        const body = await res.json();
        if (isObj(body) && typeof body.error === "string") named = ` ${body.error}`;
      } catch {
        /* no JSON body */
      }
      return { ok: false, error: `${url} answered ${res.status}${named}` };
    }
    const body = await res.json();
    if (!isObj(body) || !isBoardShape(body)) {
      return { ok: false, error: `${url}: no board in the answer` };
    }
    const t = body.triage as Record<string, unknown[]>;
    const list = (v: unknown[]): TriageItem[] => (v as TriageItem[]).filter((i) => isObj(i) && typeof i.run_id === "string");
    return {
      ok: true,
      board: { ...(body as unknown as BoardAnswer), triage: { needs_you: list(t.needs_you), working: list(t.working), done: list(t.done) } },
    };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------ the rows

/** The canonical statuses' colours (`interchange.py`); an unknown status reads as `draft`. */
export const STATUS_COLOURS: Readonly<Record<string, string>> = {
  draft: "#5a5a5a",
  ready: "#4a6fa5",
  "in-progress": "#c9a227",
  blocked: "#b03030",
  review: "#8a5cc2",
  done: "#3f9a4a",
  dropped: "#2e2e2e",
};
export const statusColour = (status: string): string => STATUS_COLOURS[status] ?? STATUS_COLOURS.draft;

export interface Segment {
  id: string;
  key: string;
  title: string;
  status: string;
  colour: string;
  findings: number;
  /** The story's latest run's PR as a link target (`safeHref`), else null. */
  href: string | null;
}
export interface SpendBar {
  spend_usd: number;
  band_usd: number | null;
  /** The bar's fill, 0..1, against the band; null with no band (the spend shown alone). */
  fill: number | null;
  over: boolean;
  text: string;
}
export interface BoardRow {
  id: string;
  title: string;
  status: string;
  colour: string;
  segments: Segment[];
  findings: number;
  findingsText: string;
  spend: SpendBar;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

export function spendBar(spend_usd: number, band_usd: number | null): SpendBar {
  const spend = Number.isFinite(spend_usd) && spend_usd > 0 ? spend_usd : 0;
  if (band_usd === null || !(band_usd > 0)) return { spend_usd: spend, band_usd: null, fill: null, over: false, text: usd(spend) };
  return { spend_usd: spend, band_usd, fill: Math.min(1, spend / band_usd), over: spend > band_usd, text: `${usd(spend)} / ${usd(band_usd)}` };
}

export const findingsText = (n: number): string => (n === 1 ? "1 finding" : `${n} findings`);

/** One row per epic: its phased bar (one segment per story, coloured by status), the findings count and the
 * spend bar. */
export function boardRows(board: BoardAnswer): BoardRow[] {
  return board.epics.map((e) => {
    const segments = e.stories.map((s) => ({
      id: s.id,
      key: s.key,
      title: s.title,
      status: s.status,
      colour: statusColour(s.status),
      findings: s.findings.length,
      href: safeHref(s.run?.pr),
    }));
    const findings = segments.reduce((n, s) => n + s.findings, 0);
    return {
      id: e.id,
      title: e.title,
      status: e.status,
      colour: statusColour(e.status),
      segments,
      findings,
      findingsText: findingsText(findings),
      spend: spendBar(e.spend_usd, e.band_usd),
    };
  });
}

// ------------------------------------------------------------ the columns

export type ColumnKey = "needs_you" | "working" | "done";
export interface ColumnItem {
  run_id: string;
  state: string;
  story: string;
  /** The run's PR as a link target (`http(s)://` only), else null. */
  href: string | null;
  /** The ruling it waits for, as shown; null when there is none. */
  ruling: string | null;
}
export interface Column {
  key: ColumnKey;
  title: string;
  items: ColumnItem[];
}

export const COLUMN_TITLES: Readonly<Record<ColumnKey, string>> = { needs_you: "Needs you", working: "Working", done: "Done" };

export const rulingText = (item: Pick<TriageItem, "ruling">): string | null => (item.ruling ? `waits for: ${item.ruling}` : null);

export function boardColumns(board: BoardAnswer): Column[] {
  return (["needs_you", "working", "done"] as const).map((key) => ({
    key,
    title: COLUMN_TITLES[key],
    items: board.triage[key].map((i) => ({
      run_id: i.run_id,
      state: i.state,
      story: i.story_key ?? NONE,
      href: safeHref(i.pr),
      ruling: rulingText(i),
    })),
  }));
}

// ------------------------------------------------------------ the refetch

/** What the board of `project` refetches on: that project's runs in the store (an `office.run` or `office.progress`
 * delta: their ids, states and epic progress and story statuses; a run whose project is not known yet counts) and
 * its `last_run`. An agent-only change, or another project's run, leaves it unchanged. */
export function refetchKey(state: LiveState, project: string | null): string {
  const view = state.view;
  if (!view || project === null) return "";
  const last = view.last_run?.[project];
  return JSON.stringify([
    view.runs.filter((r) => r.project === project || r.project === null).map((r) => [
      r.run_id, r.state, r.epic?.done ?? 0, r.epic?.failed ?? 0, r.epic?.current_story ?? null,
      (r.stories ?? []).map((s) => `${s.key}:${s.status}`),
    ]),
    last ? [last.run_id, last.state, last.pr] : null,
  ]);
}
