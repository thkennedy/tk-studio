// The Board screen's rules (Story 30.5, design spec §6.3): pure functions vitest drives in
// `environment: "node"`. No DOM: `fetch` is injected. The composition is `BoardScreen.tsx`.
// The screen reads only `GET /board?project=<id>` (plus the `/agents` project list the Office already reads).
// Story 39.4: the kanban (the default view; `?view=rows` is the row view above, unchanged): one column per canonical
// status, a card per story of one epic (`?epic=<EP-id>`, `?epic=all`), and the one drag the owner may make, `draft →
// ready`, posted as `POST /stories/{id}/status?project=<id>` with the CSRF token `GET /inbox` answers. Every card comes
// from the one `GET /board` (no per-card read); the stage is the live store story's `phase`.
import type { LiveState } from "../live/store";
import { fetchAgents, NONE, safeHref } from "../office/model";
// type-only (erased): `inbox/model` imports this module at runtime, so `fetchInbox` is passed in, never imported here
import type { InboxResult } from "../inbox/model";

// ------------------------------------------------------------ the answer (mirrored from apps/supervisor/src/board.ts)

export type HostVerifyOutcome = "green" | "red" | "skipped" | "inconclusive";
export interface BoardFinding { id: string; title: string; severity: string | null }
export interface BoardStoryRun { run_id: string; state: string; pr: string | null; host_verify: HostVerifyOutcome | null; ended_at: string | null }
export interface BoardStory {
  id: string; key: string; title: string; status: string; findings: BoardFinding[]; run: BoardStoryRun | null;
  /** Story 39.4 (0.1.35, additive): absent from an older supervisor's answer. */
  band?: "S" | "M" | "L" | null; jira_key?: string | null; cost_usd?: number | null; needs_you?: boolean;
}
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

// ------------------------------------------------------------ Story 39.4: the kanban

/** `interchange.py` `STATUS_VALUES`, in enum order: the kanban's columns. */
export const KANBAN_STATUSES = ["draft", "ready", "in-progress", "blocked", "review", "done", "dropped"] as const;
export const KANBAN_TITLES: Readonly<Record<string, string>> = {
  draft: "Draft", ready: "Ready", "in-progress": "In progress", blocked: "Blocked", review: "Review", done: "Done", dropped: "Dropped",
};

/** Who writes each column (mirrored from apps/supervisor/src/stories.ts, never imported across apps). */
export const COLUMN_OWNERS: Readonly<Record<string, string>> = {
  draft: "draft is written by the loop's draft pass (a run that ended without a PR gives its story back, Story 38.2) and plansync normalize",
  ready: "ready is written by the owner, from draft only",
  "in-progress": "in-progress is written by the loop's launched pass when a run starts the story (Story 36.6)",
  blocked: "blocked is written by the Jira pull-back when the story waits on a decision (AD-22)",
  review: "review is written by the loop's review pass when the run's PR opens (Story 27.5)",
  done: "done is written by the loop's merge pass when the PR merges (Story 27.5)",
  dropped: "dropped is written by the Jira pull-back (a DNI issue) or a plan change",
};

export const DRAG_HINT = "Requests plansync status ready; the loop owns every other column";

export type BoardView = "kanban" | "rows";
/** The board address's query: `?view=rows` the row view (else the kanban), `?epic=<EP-id>|all` (else the default). */
export function boardQuery(search: string): { view: BoardView; epic: string | null } {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { q = new URLSearchParams(); }
  const epic = q.get("epic");
  return { view: q.get("view") === "rows" ? "rows" : "kanban", epic: epic !== null && epic.trim() !== "" ? epic : null };
}
/** The board address for a project and its toggles (the kanban and the default epic carry no query). */
export function boardPath(project: string, view: BoardView, epic: string | null): string {
  const q = new URLSearchParams();
  if (view === "rows") q.set("view", "rows");
  if (epic !== null) q.set("epic", epic);
  const tail = q.toString();
  return `/app/board/${encodeURIComponent(project)}${tail ? `?${tail}` : ""}`;
}

/** The default epic: the last plan epic whose status is neither `done` nor `dropped`, else the last (null with none). */
export function defaultEpic(board: BoardAnswer): string | null {
  const open = board.epics.filter((e) => e.status !== "done" && e.status !== "dropped");
  return (open[open.length - 1] ?? board.epics[board.epics.length - 1])?.id ?? null;
}

/** The epic the kanban shows for the address's `?epic=`: `all` as is; a named epic on the board as is; else (none
 * named, or one the board does not carry) the default epic, so the select and the cards always agree. */
export function shownEpic(board: BoardAnswer, epic: string | null): string | null {
  if (epic === "all") return "all";
  if (epic !== null && board.epics.some((e) => e.id === epic)) return epic;
  return defaultEpic(board);
}

/** The PR number of a PR URL (`/pull/<n>`), else null. */
export const prNumber = (url: string | null | undefined): string | null => (typeof url === "string" ? /\/pull\/(\d+)/.exec(url)?.[1] ?? null : null);

/** `N.M` from a story key (`27-5-…`, `27.5`, a `-r2` remediation of it), as the supervisor's `storyNumber`. */
export const storyNumber = (key: string | null | undefined): string | null => {
  const m = typeof key === "string" ? /^(\d+)[.-](\d+)/.exec(key) : null;
  return m ? `${Number(m[1])}.${Number(m[2])}` : null;
};

/** The card's stage: the `phase` of the project's live store story numbered `key` whose status is `current`
 * (`starting` while its phase is null), else null (no line shown). */
export function cardStage(live: LiveState, project: string | null, key: string): string | null {
  const n = storyNumber(key);
  if (!n || !live.view) return null;
  for (const r of live.view.runs) {
    if (project !== null && r.project !== null && r.project !== project) continue;
    const s = (r.stories ?? []).find((x) => x.status === "current" && storyNumber(x.key) === n);
    if (s) return s.phase ?? "starting";
  }
  return null;
}

export interface KanbanCard {
  id: string;
  /** The story's own status (the drag's `from`). */
  status: string;
  /** Its status word when not canonical (the card sits in Draft), else null. */
  statusWord: string | null;
  epic: { id: string; title: string };
  heading: string;
  title: string;
  band: string;
  jira: string;
  pr: { text: string; href: string | null };
  cost: string;
  stage: string | null;
  needsYou: boolean;
  /** `/app/story/<id>?project=<project>`. */
  path: string;
}
export interface KanbanColumn { status: string; title: string; cards: KanbanCard[] }

export const storyPath = (id: string, project: string): string => `/app/story/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`;

/** The kanban: the canonical seven columns in enum order, each with the cards of `epic` (`all`: every epic; null, or an
 * epic the board does not carry: the default epic, `shownEpic`) in board order. */
export function kanbanColumns(board: BoardAnswer, live: LiveState, project: string, epic: string | null): KanbanColumn[] {
  const which = shownEpic(board, epic);
  const shown = which === "all" ? board.epics : board.epics.filter((e) => e.id === which);
  const columns: KanbanColumn[] = KANBAN_STATUSES.map((status) => ({ status, title: KANBAN_TITLES[status]!, cards: [] }));
  for (const e of shown) {
    for (const s of e.stories) {
      const canonical = (KANBAN_STATUSES as readonly string[]).includes(s.status);
      const pr = s.run?.pr ?? null;
      const n = prNumber(pr);
      const card: KanbanCard = {
        id: s.id,
        status: s.status,
        statusWord: canonical ? null : s.status,
        epic: { id: e.id, title: e.title },
        heading: s.key ? `${s.key} · ${s.id}` : s.id,
        title: s.title,
        band: s.band ? `band ${s.band}` : "no band",
        jira: s.jira_key ? s.jira_key : "no Jira key",
        // `PR #<n>` with a `/pull/<n>`, else `PR`; linked only through `safeHref`; `no PR` only with no PR at all
        pr: pr ? { text: n ? `PR #${n}` : "PR", href: safeHref(pr) } : { text: "no PR", href: null },
        cost: typeof s.cost_usd === "number" ? usd(s.cost_usd) : "no cost yet",
        stage: cardStage(live, project, s.key),
        needsYou: s.needs_you === true,
        path: storyPath(s.id, project),
      };
      columns[canonical ? KANBAN_STATUSES.indexOf(s.status as (typeof KANBAN_STATUSES)[number]) : 0]!.cards.push(card);
    }
  }
  return columns;
}

export type DropRule = { kind: "none" } | { kind: "request"; body: { status: "ready" } } | { kind: "refused"; reason: string };

/** The column a status sits in: itself when canonical, else `draft` (a non-canonical status sits in Draft). */
export const columnOf = (status: string): string => ((KANBAN_STATUSES as readonly string[]).includes(status) ? status : "draft");

/** The one drag the owner may make: `draft → ready`; the same column is nothing (the card's column, `columnOf(from)`,
 * so a non-canonical card dropped back on Draft is nothing); anything else refused naming the column's owner (Settled
 * shape 4, contract 0.1.35: the column is `to` unless `to` is `ready`, then the raw `from`; a non-canonical `from` has
 * no owner of its own and reads the draft writer's). */
export function dropRule(from: string, to: string): DropRule {
  if (columnOf(from) === to) return { kind: "none" };
  if (from === "draft" && to === "ready") return { kind: "request", body: { status: "ready" } };
  const column = to !== "ready" ? to : from;
  return { kind: "refused", reason: `Refused: ${from} → ${to}. ${COLUMN_OWNERS[column] ?? COLUMN_OWNERS.draft}. Only draft → ready is yours.` };
}

export const requestingText = (id: string): string => `Requesting ready for ${id} (plansync status and its Jira sync, up to two minutes)…`;

export const storyStatusUrl = (id: string, project: string): string => `/stories/${encodeURIComponent(id)}/status?project=${encodeURIComponent(project)}`;
export type StatusPostResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number | null; body: Record<string, unknown> | null; error: string };

/** `POST /stories/{id}/status?project=<id>` `{status: "ready"}` with the CSRF token. Never throws: a non-200 keeps the
 * supervisor's body (its `error` named), a network error or a non-JSON answer is `{ok:false}` naming it. */
export async function postStoryStatus(project: string, id: string, csrf: string | null, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<StatusPostResult> {
  const url = storyStatusUrl(id, project);
  try {
    const res = await fetchFn(url, {
      method: "POST", credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: JSON.stringify({ status: "ready" }),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.ok && isObj(body) && body.ok === true) return { ok: true, body };
    const named = isObj(body) && typeof body.error === "string" ? body.error : null;
    return { ok: false, status: res.status, body: isObj(body) ? body : null, error: named ?? `${url} answered ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, body: null, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The drop's request: read the CSRF token (`readInbox`, i.e. `fetchInbox` from `../inbox/model`, passed in because
 * that module imports this one), then post. A failed inbox read posts nothing (a cookie session would only earn
 * `403 CsrfRefused`): `{ok:false, status:null}` naming the read's failure, so the board is not re-read. */
export async function requestReady(
  project: string, id: string,
  readInbox: (project: string, fetchFn: FetchLike) => Promise<InboxResult>,
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<StatusPostResult> {
  const inbox = await readInbox(project, fetchFn);
  if (!inbox.ok) return { ok: false, status: null, body: null, error: `The session token could not be read: ${inbox.error}` };
  return postStoryStatus(project, id, inbox.csrf, fetchFn);
}

/** The strip's words for a post's result: `Ready: <id> (was <previous>)`, or the supervisor's error and its owner,
 * holder or reason in words. */
export function statusAnswerText(id: string, r: StatusPostResult): string {
  const b = r.body ?? {};
  const word = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (r.ok) return `Ready: ${id} (was ${word(b.previous_status) ?? "draft"})`;
  switch (r.error) {
    case "StoryLeaseHeld":
      return `StoryLeaseHeld: the loop holds ${id} (run ${word(b.run_id) ?? "?"}, ${word(b.phase) ?? "?"}, since ${word(b.since) ?? "?"})`;
    case "StoryStatusNotOwnerWritable":
      return `StoryStatusNotOwnerWritable: ${word(b.owner) ?? "the loop owns that column"}`;
    case "StoryStatusRefused":
      return `StoryStatusRefused: ${word(b.reason) ?? "refused"} (still ${word(b.status) ?? "?"})`;
    default: {
      const detail = word(b.detail) ?? word(b.reason);
      return detail ? `${r.error}: ${detail}` : r.error;
    }
  }
}
