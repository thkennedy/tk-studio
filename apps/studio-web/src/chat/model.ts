// The Chat screen's rules (Story 32.7, design spec §6.3 Chat, F2): pure functions vitest drives in
// `environment: "node"`. No DOM: `fetch` and `localStorage` are injected. The composition is `ChatScreen.tsx`, the
// chat stream `stream.ts`.
// The screen reads `GET /engagements?project=`, `GET /engagements/{id}?project=`, `GET /chat/{id}?project=` and
// `GET /runs/{id}` (its `cost_usd`, 0.1.27), and posts `POST /engagements`, `POST /engagements/{id}/input` and
// `POST /chat/{id}` — every engagement read and post carrying `?project=<id>` (a repeated id is 409
// AmbiguousEngagement without it) and every post the CSRF token `GET /inbox?project=<id>` answered (Settled shape 2),
// exactly as the Issue screen's reply. Fetches and posts never throw; a refusal is rendered by its error name.
// Story 39.3: the studio chat's rules (`/app/chat`, `StudioChatScreen.tsx`) sit in their own section at the end.
import type { FetchLike } from "../inbox/model";
import { canAct, costText, replyUrl, type ActionGate } from "../issue/model";
import { NONE, safeHref, type StorageLike } from "../office/model";
import type { OfficeEngagement } from "../live/store";

// ------------------------------------------------------------ mirrored (apps/supervisor engagement.ts, chat.ts)

export const ENGAGEMENT_STATES = [
  "intake", "awaiting-answers", "scoping", "quoted", "approved", "in-progress", "delivered",
  "paused", "failed", "partial", "cancelled",
] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];
export const TERMINAL_STATES: ReadonlySet<string> = new Set(["delivered", "failed", "cancelled"]);
export const INPUT_VERBS = ["answer", "go", "revise", "question", "approve", "cancel"] as const;
export type InputVerb = (typeof INPUT_VERBS)[number];
export const AUTONOMY_LEVELS = ["ask", "steady", "full"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export interface QuestionOption { label: string; default?: true }
export interface Question { id: string; text: string; options: QuestionOption[]; impact?: string; answer?: string | null }
export interface QuoteBand { tokens: number | null; usd: number; share: number | string | null }
export interface Quote {
  band50: QuoteBand;
  band85: QuoteBand;
  band95: QuoteBand;
  cap: number;
  basis?: { autonomy?: string[]; notes?: string[]; planning_usd?: number; thin?: boolean; [k: string]: unknown };
  computed_at?: string;
}
export interface InputLine { at: string; verb: string; source: string; payload?: Record<string, unknown>; from: string; to: string }
export interface Engagement {
  id: string;
  project: string;
  state: EngagementState;
  request: string;
  questions: Question[];
  assumptions: Record<string, unknown>[];
  scope_page: { id?: string; url?: string; version?: number } | null;
  quote: Quote | null;
  autonomy: Autonomy | null;
  approved_at: string | null;
  created: string;
  updated: string;
  spend: { planning_usd: number; runs_usd: number };
  inputs: InputLine[];
}
export interface Proposal { verb: InputVerb; payload: Record<string, unknown>; label: string }
/** A planner line's `proposals[]` are as written (each read through `proposalOf`). */
export interface ChatLine { seq: number; at: string; author: "owner" | "planner"; body: string; run_id?: string; proposals?: Record<string, unknown>[] }

/** A typed input as posted: `{verb, …payload}`. */
export type Input = { verb: InputVerb } & Record<string, unknown>;

// ------------------------------------------------------------ the actions per state (Settled shape 3)

/** `TRANSITIONS`' verb cells (the event rows excluded), in `INPUT_VERBS` order. A button outside its cell is never
 * rendered; the supervisor's 409 IllegalInput is the backstop. */
export const ACTIONS: Readonly<Record<EngagementState, readonly InputVerb[]>> = {
  intake: ["go", "question", "cancel"],
  "awaiting-answers": ["answer", "go", "question", "cancel"],
  scoping: ["go", "revise", "question", "cancel"],
  quoted: ["revise", "question", "approve", "cancel"],
  approved: ["revise", "question", "cancel"],
  "in-progress": ["revise", "question", "cancel"],
  paused: ["revise", "question", "cancel"],
  partial: ["go", "revise", "question", "cancel"],
  delivered: [],
  failed: [],
  cancelled: [],
};

export const isState = (s: unknown): s is EngagementState => typeof s === "string" && (ENGAGEMENT_STATES as readonly string[]).includes(s);
export const isVerb = (v: unknown): v is InputVerb => typeof v === "string" && (INPUT_VERBS as readonly string[]).includes(v);
export const isAutonomy = (v: unknown): v is Autonomy => typeof v === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(v);

/** Whether the table has a cell for `(state, verb)`. An unknown state allows nothing. */
export const allows = (state: string, verb: string): boolean => isState(state) && (ACTIONS[state] as readonly string[]).includes(verb);

// ------------------------------------------------------------ the stepper (Settled shape 4)

export const MAIN_PATH = ["intake", "awaiting-answers", "scoping", "quoted", "approved", "in-progress", "delivered"] as const;
export const SIDE_EXITS = ["paused", "partial", "failed", "cancelled"] as const;
type MainStep = (typeof MAIN_PATH)[number];
const isMain = (s: unknown): s is MainStep => typeof s === "string" && (MAIN_PATH as readonly string[]).includes(s);
const isSide = (s: unknown): boolean => typeof s === "string" && (SIDE_EXITS as readonly string[]).includes(s);
/** With no `inputs[]` hint, the main step a side exit is closest to: the run's states leave `in-progress`; a cancel
 * with no line names no step, so the start. */
export const CLOSEST_MAIN: Readonly<Record<(typeof SIDE_EXITS)[number], MainStep>> = {
  paused: "in-progress", partial: "in-progress", failed: "in-progress", cancelled: "intake",
};

export type StepStatus = "done" | "current" | "left" | "todo";
export interface Step { state: MainStep; status: StepStatus }
export interface Stepper { steps: Step[]; exit: { state: string; from: MainStep } | null }

/** The main step a side exit left: the newest `inputs[]` line entering it (`to` the exit, `from` another state); a
 * `from` that is itself a side exit (`partial → cancelled`) is followed back the same way; else `CLOSEST_MAIN`. */
export function leftStep(exit: (typeof SIDE_EXITS)[number], inputs: readonly InputLine[]): MainStep {
  let target: string = exit;
  let end = inputs.length;
  for (let guard = 0; guard < SIDE_EXITS.length + 1; guard++) {
    let i = end - 1;
    while (i >= 0 && !(inputs[i]?.to === target && inputs[i]?.from !== target)) i--;
    if (i < 0) break;
    const from = inputs[i].from;
    if (isMain(from)) return from;
    if (!isSide(from)) break;
    target = from;
    end = i;
  }
  return CLOSEST_MAIN[target as (typeof SIDE_EXITS)[number]] ?? CLOSEST_MAIN[exit];
}

/** The state as the main path `intake → … → delivered`, a side exit marked against the step it left. */
export function stepper(e: Pick<Engagement, "state" | "inputs">): Stepper {
  const inputs = Array.isArray(e.inputs) ? e.inputs : [];
  const side = (SIDE_EXITS as readonly string[]).includes(e.state) ? (e.state as (typeof SIDE_EXITS)[number]) : null;
  const at: MainStep = side ? leftStep(side, inputs) : isMain(e.state) ? e.state : "intake";
  const k = MAIN_PATH.indexOf(at);
  const done = !side && e.state === "delivered";
  const steps = MAIN_PATH.map((s, i): Step => ({
    state: s,
    status: i < k || (done && i === k) ? "done" : i === k ? (side ? "left" : "current") : "todo",
  }));
  return { steps, exit: side ? { state: side, from: at } : null };
}

// ------------------------------------------------------------ the question cards

export interface Card {
  id: string;
  text: string;
  impact: string;
  options: { label: string; isDefault: boolean }[];
  /** The recorded answer, else the default option's label, else the first option's (null with no options). */
  selected: string | null;
  answered: boolean;
}

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** The record's questions as cards: options in order, the default marked and pre-selected. */
export function questionCards(questions: readonly Question[] | null | undefined): Card[] {
  return (questions ?? []).filter((q) => q && nonBlank(q.id)).map((q) => {
    const options = (Array.isArray(q.options) ? q.options : []).filter((o) => o && nonBlank(o.label)).map((o) => ({ label: o.label, isDefault: o.default === true }));
    const answered = nonBlank(q.answer);
    const def = options.find((o) => o.isDefault)?.label ?? options[0]?.label ?? null;
    return { id: q.id, text: nonBlank(q.text) ? q.text : NONE, impact: nonBlank(q.impact) ? q.impact : NONE, options, selected: answered ? (q.answer as string) : def, answered };
  });
}

/** `{verb: answer, answers: {<id>: <label>}}` for the open cards, each the owner's choice else its pre-selection;
 * null when nothing is left to answer. */
export function answerInput(cards: readonly Card[], choices: Readonly<Record<string, string>> = {}): Input | null {
  const answers: Record<string, string> = {};
  for (const c of cards) {
    if (c.answered) continue;
    const v = nonBlank(choices[c.id]) ? choices[c.id] : c.selected;
    if (nonBlank(v)) answers[c.id] = v;
  }
  return Object.keys(answers).length ? { verb: "answer", answers } : null;
}

// ------------------------------------------------------------ the quote (the band)

export interface BandView { name: "50" | "85" | "95"; usd: string; share: string; tokens: string }
export interface QuoteView { bands: BandView[]; cap: string; autonomy: string[]; notes: string[] }

const usd = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(2)}` : NONE);
/** A band's share of the weekly token window as a percentage; the quote's own words when unknown. */
export const shareText = (share: unknown): string =>
  typeof share === "number" && Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : typeof share === "string" && share ? share : NONE;

/** The quote as the band: 50/85/95 as share and dollars, the cap and the autonomy levels; null with no quote. */
export function quoteView(q: Quote | null | undefined): QuoteView | null {
  if (!q || typeof q !== "object") return null;
  const band = (name: BandView["name"], b: QuoteBand | undefined): BandView => ({
    name, usd: usd(b?.usd), share: shareText(b?.share), tokens: typeof b?.tokens === "number" ? String(b.tokens) : NONE,
  });
  const autonomy = Array.isArray(q.basis?.autonomy) ? q.basis!.autonomy!.filter(isAutonomy) : [];
  return {
    bands: [band("50", q.band50), band("85", q.band85), band("95", q.band95)],
    cap: usd(q.cap),
    autonomy: autonomy.length ? autonomy : [...AUTONOMY_LEVELS],
    notes: Array.isArray(q.basis?.notes) ? q.basis!.notes!.filter((n): n is string => typeof n === "string") : [],
  };
}

// ------------------------------------------------------------ the inputs (each verb's payload, VERB_FIELDS)

/** The autonomy the Approve control shows and sends: the owner's choice when the quote offers it, else `steady` when
 * offered, else the first offered level; null when the quote offers none. */
export function autonomyChoice(offered: readonly string[], chosen: string | null | undefined): Autonomy | null {
  const levels = offered.filter(isAutonomy);
  if (chosen && isAutonomy(chosen) && levels.includes(chosen)) return chosen;
  return levels.includes("steady") ? "steady" : levels[0] ?? null;
}

/** `{verb: approve, autonomy, base_ref?}` (`base_ref` only when non-blank); null for an autonomy not in the levels,
 * or (given `offered`, the quote's displayed levels) not among them: what is sent is always a shown option. */
export function approveInput(autonomy: string, baseRef = "", offered?: readonly string[]): Input | null {
  if (!isAutonomy(autonomy)) return null;
  if (offered && !offered.includes(autonomy)) return null;
  return { verb: "approve", autonomy, ...(baseRef.trim() ? { base_ref: baseRef.trim() } : {}) };
}

/** A positive dollar figure from the Go box, else null. */
export function capOf(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `{verb: go}`; in `partial`, `{verb: go, cap}` with a positive cap (it replaces the cap), else null (disabled). */
export function goInput(state: string, capText = ""): Input | null {
  if (state !== "partial") return { verb: "go" };
  const cap = capOf(capText);
  return cap === null ? null : { verb: "go", cap };
}

/** `{verb: revise, body?}` (`body` only when non-blank). */
export const reviseInput = (body = ""): Input => ({ verb: "revise", ...(body.trim() ? { body } : {}) });
/** `{verb: question, text}`; null for a blank text. */
export const questionInput = (text: string): Input | null => (text.trim() ? { verb: "question", text } : null);
/** `{verb: cancel, reason?}` (`reason` only when non-blank). */
export const cancelInput = (reason = ""): Input => ({ verb: "cancel", ...(reason.trim() ? { reason: reason.trim() } : {}) });

// ------------------------------------------------------------ the proposals

export interface ProposalButton { label: string; input: Input; enabled: boolean; note: string | null }

/** A well-formed planner proposal (`{verb, payload, label ≤ 80}`), else null. */
export function proposalOf(v: unknown): Proposal | null {
  if (!isObj(v) || !isVerb(v.verb) || !isObj(v.payload) || !nonBlank(v.label) || v.label.length > 80) return null;
  return { verb: v.verb, payload: v.payload, label: v.label };
}

/** A proposal as a button sending exactly `{verb, ...payload}`; outside the state's cell it is disabled, naming the
 * state. */
export function proposalButton(state: string, p: Proposal): ProposalButton {
  const enabled = allows(state, p.verb);
  return { label: p.label, input: { ...p.payload, verb: p.verb }, enabled, note: enabled ? null : `not in ${state}` };
}

/** A line's proposals as buttons (malformed ones dropped). */
export const proposalButtons = (state: string, line: Pick<ChatLine, "proposals">): ProposalButton[] =>
  (Array.isArray(line.proposals) ? line.proposals : []).map(proposalOf).filter((p): p is Proposal => p !== null).map((p) => proposalButton(state, p));

// ------------------------------------------------------------ the state's words (Settled shape 7)

export const APPROVED_TEXT = "approved; the run starts when the plan PR merges";
export const PAUSED_TEXT = "paused: reply `continue` on the engagement's Jira issue";

/** What the state says beside the stepper: approved and paused in their fixed words; partial as `runs_usd` against
 * the cap; a terminal state closed; else null. No PR link is shown (the record carries none). */
export function stateNote(e: Pick<Engagement, "state" | "spend" | "quote">): string | null {
  switch (e.state) {
    case "approved": return APPROVED_TEXT;
    case "paused": return PAUSED_TEXT;
    case "partial": return `partial: spent ${usd(e.spend?.runs_usd)} of the ${usd(e.quote?.cap)} cap; Go with a new cap, or Cancel`;
    case "delivered": case "failed": case "cancelled": return `${e.state}: the engagement is closed`;
    default: return null;
  }
}

/** The scope page's link target (`safeHref`), else null. */
export const scopeHref = (e: Pick<Engagement, "scope_page">): string | null => safeHref(e.scope_page?.url ?? null);

// ------------------------------------------------------------ the list and the nav count (Settled shape 5)

export interface StateGroup { state: EngagementState; engagements: Engagement[] }
/** The project's engagements grouped by state (the states in `ENGAGEMENT_STATES` order, the records as served:
 * newest first); an empty group is left out. */
export function byState(engagements: readonly Engagement[]): StateGroup[] {
  return ENGAGEMENT_STATES.map((state) => ({ state, engagements: engagements.filter((e) => e.state === state) })).filter((g) => g.engagements.length);
}

export const NEEDS_OWNER: ReadonlySet<string> = new Set(["awaiting-answers", "quoted"]);
/** The Chat nav count: the office rows in `awaiting-answers` or `quoted`, across projects; null for none. */
export function chatNavCount(rows: readonly Pick<OfficeEngagement, "state">[] | null | undefined): number | null {
  const n = (rows ?? []).filter((r) => NEEDS_OWNER.has(r.state)).length;
  return n ? n : null;
}

// ------------------------------------------------------------ the remembered engagement (Settled shape 6)

export const CHAT_KEY = "tk-studio.web.chat";
export interface EngagementRef { project: string; id: string }

const defaultStorage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

/** The stored `{project, id}`, else null (absent, malformed, or a storage that throws). */
export function rememberedEngagement(storage: StorageLike | null = defaultStorage()): EngagementRef | null {
  try {
    const raw = storage?.getItem(CHAT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isObj(v) && nonBlank(v.project) && nonBlank(v.id) ? { project: v.project, id: v.id } : null;
  } catch {
    return null;
  }
}

/** Stores the choice; a storage that throws is ignored. */
export function rememberEngagement(ref: EngagementRef, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(CHAT_KEY, JSON.stringify({ project: ref.project, id: ref.id }));
  } catch {
    /* in memory only */
  }
}

// ------------------------------------------------------------ the refusals

export interface Refusal { status: number; name: string | null; state?: string; verb?: string; detail?: string }
export type Failure = { ok: false; error: string; refusal: Refusal | null; retryable: boolean };

/** A refusal as the screen shows it, by its error name: IllegalInput names `{state, verb}`; ChatBusy is retryable;
 * ChatJobUnresolved / ChatQueueFailed kept no line; anything else names the status and the error. */
export function refusalText(r: Refusal): string {
  const tail = r.detail ? ` (${r.detail})` : "";
  switch (r.name) {
    case "IllegalInput": return `IllegalInput: ${r.verb ?? "this input"} is not allowed in ${r.state ?? "this state"}${tail}`;
    case "EngagementClosed": return `EngagementClosed: the engagement is ${r.state ?? "closed"}; ${r.verb ? `${r.verb} cannot be sent` : "nothing more can be sent"}`;
    case "ChatBusy": return "ChatBusy: another message is being written; try again (your text is kept)";
    case "ChatJobUnresolved": return `ChatJobUnresolved: the planner's job could not be resolved; no line was kept${tail}`;
    case "ChatQueueFailed": return `ChatQueueFailed: the planner's turn could not be queued; no line was kept${tail}`;
    case "CsrfRefused": return "CsrfRefused: the page's token was refused; reload the page";
    case "AmbiguousEngagement": return "AmbiguousEngagement: that id is in more than one project";
    // Story 39.3: the studio chat's refusals
    case "LineTooLong": return `LineTooLong: the line is over ${LINE_MAX_CHARS.toLocaleString("en-US")} characters (your text is kept)`;
    case "ProposalNotYet": return `ProposalNotYet: ${NOT_YET_TEXT}`;
    case "ProposalAlreadyPressed": return "ProposalAlreadyPressed: already pressed";
    case null: return `answered ${r.status}`;
    default: return `${r.name}: answered ${r.status}${tail}`;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function failureOf(url: string, res: { status: number; json(): Promise<unknown> }): Promise<Failure> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* no body */ }
  const o = isObj(body) ? body : {};
  const refusal: Refusal = {
    status: res.status,
    name: typeof o.error === "string" ? o.error : null,
    ...(typeof o.state === "string" ? { state: o.state } : {}),
    ...(typeof o.verb === "string" ? { verb: o.verb } : {}),
    ...(typeof o.detail === "string" ? { detail: o.detail } : {}),
  };
  return { ok: false, error: `${url}: ${refusalText(refusal)}`, refusal, retryable: refusal.name === "ChatBusy" };
}

const thrown = (url: string, e: unknown): Failure => ({ ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}`, refusal: null, retryable: false });
const malformed = (url: string, what: string): Failure => ({ ok: false, error: `${url}: no ${what} in the answer`, refusal: null, retryable: false });

// ------------------------------------------------------------ the reads

const q = (project: string) => `project=${encodeURIComponent(project)}`;
export const engagementsUrl = (project: string): string => `/engagements?${q(project)}`;
export const engagementUrl = (project: string, id: string): string => `/engagements/${encodeURIComponent(id)}?${q(project)}`;
export const inputUrl = (project: string, id: string): string => `/engagements/${encodeURIComponent(id)}/input?${q(project)}`;
export const createUrl = (project: string): string => `/engagements?${q(project)}`;
export const chatUrl = (project: string, id: string, since = 0): string => `/chat/${encodeURIComponent(id)}?${q(project)}${since > 0 ? `&since=${since}` : ""}`;
export const runUrl = (runId: string): string => `/runs/${encodeURIComponent(runId)}`;

const GET: RequestInit = { credentials: "same-origin", headers: { accept: "application/json" } };
const defaultFetch: FetchLike = (u, i) => fetch(u, i);

// `request` and `project` are read in render (the list's first line, the shown record's project), so a row without them is dropped.
const engagementOf = (v: unknown): v is Engagement =>
  isObj(v) && typeof v.id === "string" && typeof v.state === "string" && typeof v.request === "string" && typeof v.project === "string";
const lineOf = (v: unknown): v is ChatLine => isObj(v) && typeof v.seq === "number" && Number.isSafeInteger(v.seq) && (v.author === "owner" || v.author === "planner") && typeof v.body === "string";

export type EngagementsResult = { ok: true; engagements: Engagement[]; problems: string[] } | Failure;
/** `GET /engagements?project=<id>`: the project's records, newest first. Never throws. */
export async function fetchEngagements(project: string, fetchFn: FetchLike = defaultFetch): Promise<EngagementsResult> {
  const url = engagementsUrl(project);
  try {
    const res = await fetchFn(url, GET);
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !Array.isArray(body.engagements)) return malformed(url, "engagements");
    return {
      ok: true,
      engagements: (body.engagements as unknown[]).filter(engagementOf),
      problems: Array.isArray(body.problems) ? body.problems.filter((p): p is string => typeof p === "string") : [],
    };
  } catch (e) {
    return thrown(url, e);
  }
}

export type EngagementResult = { ok: true; engagement: Engagement; last_seq: number } | Failure;
/** `GET /engagements/{id}?project=<id>`: the record and its chat's `last_seq`. Never throws. */
export async function fetchEngagement(project: string, id: string, fetchFn: FetchLike = defaultFetch): Promise<EngagementResult> {
  const url = engagementUrl(project, id);
  try {
    const res = await fetchFn(url, GET);
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !engagementOf(body.engagement)) return malformed(url, "engagement");
    const last = isObj(body.chat) && typeof body.chat.last_seq === "number" ? body.chat.last_seq : 0;
    return { ok: true, engagement: body.engagement, last_seq: last };
  } catch (e) {
    return thrown(url, e);
  }
}

export type ChatResult = { ok: true; lines: ChatLine[]; last_seq: number } | Failure;
/** `GET /chat/{id}?project=<id>[&since=<seq>]`: the lines after `since`. Never throws. */
export async function fetchChat(project: string, id: string, since = 0, fetchFn: FetchLike = defaultFetch): Promise<ChatResult> {
  const url = chatUrl(project, id, since);
  try {
    const res = await fetchFn(url, GET);
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !Array.isArray(body.lines)) return malformed(url, "lines");
    const lines = (body.lines as unknown[]).filter(lineOf);
    return { ok: true, lines, last_seq: typeof body.last_seq === "number" ? body.last_seq : lines.reduce((m, l) => Math.max(m, l.seq), since) };
  } catch (e) {
    return thrown(url, e);
  }
}

/** `GET /runs/{id}`'s `cost_usd` (0.1.27): a number, null when not metered; a failure is `{ok:false}`. Never throws. */
export async function fetchRunCost(runId: string, fetchFn: FetchLike = defaultFetch): Promise<{ ok: true; cost_usd: number | null } | { ok: false }> {
  try {
    const res = await fetchFn(runUrl(runId), GET);
    if (!res.ok) return { ok: false };
    const body = await res.json();
    if (!isObj(body) || body.ok !== true) return { ok: false };
    return { ok: true, cost_usd: typeof body.cost_usd === "number" && Number.isFinite(body.cost_usd) ? body.cost_usd : null };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ the posts

const post = (csrf: string | null, body: unknown): RequestInit => ({
  method: "POST", credentials: "same-origin",
  headers: { accept: "application/json", "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
  body: JSON.stringify(body),
});

export type CreateResult = { ok: true; engagement: Engagement } | Failure;
/** `POST /engagements?project=<id>` `{project, request}`. Never throws. */
export async function postEngagement(project: string, request: string, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<CreateResult> {
  const url = createUrl(project);
  try {
    const res = await fetchFn(url, post(csrf, { project, request }));
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !engagementOf(body.engagement)) return malformed(url, "engagement");
    return { ok: true, engagement: body.engagement };
  } catch (e) {
    return thrown(url, e);
  }
}

export type InputResult = { ok: true; engagement: Engagement; from: string; to: string } | Failure;
/** `POST /engagements/{id}/input?project=<id>` with exactly the input `{verb, …}`. Never throws. */
export async function postInput(project: string, id: string, input: Input, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<InputResult> {
  const url = inputUrl(project, id);
  try {
    const res = await fetchFn(url, post(csrf, input));
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !engagementOf(body.engagement)) return malformed(url, "engagement");
    return { ok: true, engagement: body.engagement, from: String(body.from ?? ""), to: String(body.to ?? "") };
  } catch (e) {
    return thrown(url, e);
  }
}

export type ChatPostResult = { ok: true; seq: number; run_id: string } | Failure;
/** `POST /chat/{id}?project=<id>` `{message}`. Never throws; a 503 ChatBusy is `retryable` (the text is kept). */
export async function postChat(project: string, id: string, message: string, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<ChatPostResult> {
  const url = chatUrl(project, id);
  try {
    const res = await fetchFn(url, post(csrf, { message }));
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || typeof body.seq !== "number") return malformed(url, "chat line");
    return { ok: true, seq: body.seq, run_id: typeof body.run_id === "string" ? body.run_id : "" };
  } catch (e) {
    return thrown(url, e);
  }
}

// ------------------------------------------------------------ the gate

/** Every send waits for the loaded engagement and the project's CSRF token, with nothing in flight (`canAct`). */
export const canSendInput = (input: Input | null, g: Omit<ActionGate, "sent">): boolean => input !== null && canAct({ ...g, sent: false });
export const canSendText = (text: string, g: Omit<ActionGate, "sent">): boolean => text.trim() !== "" && canAct({ ...g, sent: false });

// ------------------------------------------------------------ the transcript

/** The lines merged by `seq` (a duplicate seq ignored, the first kept), in seq order. */
export function mergeLines(have: readonly ChatLine[], incoming: readonly ChatLine[]): ChatLine[] {
  const seen = new Set(have.map((l) => l.seq));
  const add = incoming.filter((l) => lineOf(l) && !seen.has(l.seq) && (seen.add(l.seq), true));
  return add.length ? [...have, ...add].sort((a, b) => a.seq - b.seq) : (have as ChatLine[]);
}

/** The planner's run cost on hover: fetched lazily per `run_id` (on hover or focus), at most one fetch in flight per
 * run. Only a metered (non-null) cost is cached for good; a null shows `not metered` and a failure shows nothing, and
 * either is fetched again on the next hover or focus (the run's `job-run` line may land later). Never throws. */
export interface CostCache {
  /** The text for a run: `$0.42`, `not metered`, or null (not fetched yet, or the last read failed). */
  text(runId: string): string | null;
  /** Fetches unless a metered cost is cached; while a fetch is in flight, returns that same promise. */
  request(runId: string): Promise<void>;
}
export function createCostCache(fetchFn: FetchLike = defaultFetch, onChange: () => void = () => {}): CostCache {
  const metered = new Map<string, number>();
  const unmetered = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  return {
    text: (runId) => (metered.has(runId) ? costText(metered.get(runId)) : unmetered.has(runId) ? costText(null) : null),
    request(runId) {
      if (metered.has(runId)) return Promise.resolve();
      const had = pending.get(runId);
      if (had) return had;
      const p = fetchRunCost(runId, fetchFn).then((r) => {
        pending.delete(runId);
        if (r.ok && r.cost_usd !== null) {
          metered.set(runId, r.cost_usd);
          unmetered.delete(runId);
        } else if (r.ok) unmetered.add(runId);
        else unmetered.delete(runId);
        onChange();
      });
      pending.set(runId, p);
      return p;
    },
  };
}

// ------------------------------------------------------------ the studio chat (Story 39.3)
//
// `/app/chat` is a conversation with the studio (addendum §3.8), not with an engagement: `GET /chat?project=` reads
// the record `_bmad-output/tracking/studio-chat.jsonl`, `POST /chat {project, text}` queues one `studio-chat` run per
// owner line, and the stream's `event: chat-delta` frames carry the reply text as the session produces it. Each
// proposal is a button whose press sends a request the supervisor already knows (Settled shape 4); the press is then
// recorded as the owner's line `pressed: <label>` (`POST /chat {project, pressed: {seq, index}}`).

/** The owner's line limit, in code points (the supervisor's `LINE_MAX_CHARS`). */
export const LINE_MAX_CHARS = 4000;
/** The text box shows its count past this many characters. */
export const LINE_COUNT_FROM = 3500;
export const PENDING_TEXT = "Waiting for the planner's reply (about a minute)";
export const NOT_YET_TEXT = "Not built yet: Story 39.7";
export const PRESSED_TEXT = "Pressed";
/** The streaming reply's trailing cursor (U+258D). */
export const CURSOR = "▍";

export const STUDIO_KINDS = ["queue", "answer", "open", "engagement", "stop-after-story", "open-studio"] as const;
export type StudioKind = (typeof STUDIO_KINDS)[number];
/** The two kinds Story 39.7 lands: rendered disabled until then. */
export const NOT_YET_KINDS: ReadonlySet<string> = new Set(["stop-after-story", "open-studio"]);

export type StudioProposal =
  | { kind: "queue"; label: string; project: string; job: string }
  | { kind: "answer"; label: string; id: string; letter: string; note: string; issue: string }
  | { kind: "open"; label: string; route: string }
  | { kind: "engagement"; label: string; title: string }
  | { kind: "stop-after-story" | "open-studio"; label: string };

/** One line of the studio chat: the owner's line, a press line (`pressed`), or the planner's reply (`reply_to`). */
export interface StudioLine {
  seq: number;
  at: string;
  author: "owner" | "planner";
  body: string;
  run_id?: string | null;
  reply_to?: number;
  proposals?: unknown[];
  pressed?: { seq: number; index: number; kind?: string };
  failed?: boolean;
  /** A `queue` press line whose submit did not answer 2xx: kept, but no press (the proposal is pressable again). */
  unqueued?: boolean;
}

/** An `event: chat-delta` frame's data: the reply text from `from` (a code-unit offset) on. */
export interface ChatDelta { run_id: string; reply_to: number; from: number; text: string }

const JOB_RE = /^[a-z][a-z0-9-]*$/;
const ANSWER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LETTER_RE = /^[A-Z]$/;
const ISSUE_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const ROUTE_RE = /^\/app(\/[A-Za-z0-9._~%-]+)*$/;
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** A recorded proposal read back (Settled shape 3); anything else (an unknown kind, a missing field) is null and
 * renders no button. */
export function proposalOfStudio(v: unknown): StudioProposal | null {
  if (!isObj(v) || !nonEmpty(v.label) || [...v.label].length > 80) return null;
  const label = v.label;
  switch (v.kind) {
    case "queue":
      return nonEmpty(v.project) && typeof v.job === "string" && JOB_RE.test(v.job) ? { kind: "queue", label, project: v.project, job: v.job } : null;
    case "answer":
      return typeof v.id === "string" && ANSWER_ID_RE.test(v.id) && typeof v.letter === "string" && LETTER_RE.test(v.letter) &&
        typeof v.note === "string" && typeof v.issue === "string" && ISSUE_RE.test(v.issue)
        ? { kind: "answer", label, id: v.id, letter: v.letter, note: v.note, issue: v.issue }
        : null;
    case "open":
      return typeof v.route === "string" && ROUTE_RE.test(v.route) ? { kind: "open", label, route: v.route } : null;
    case "engagement":
      return nonEmpty(v.title) ? { kind: "engagement", label, title: v.title } : null;
    case "stop-after-story":
    case "open-studio":
      return { kind: v.kind, label };
    default:
      return null;
  }
}

/** What a press sends (Settled shape 4): a typed request, a navigation, or nothing (a 39.7 kind, disabled). */
export type ProposalAction =
  | { kind: "request"; url: string; body: Record<string, unknown> }
  | { kind: "navigate"; route: string }
  | { kind: "disabled"; note: string };

// The decision lines `sweepdecisions.py parse_answers` ingests (its `ID_LINE_RE`, `ALL_LINE_RE`, `DEFAULT_LINE_RE`,
// after a leading `- `/`* ` and `LEADING_MENTIONS_RE`): a note line shaped like one would record a decision the
// button's label never named (`studiochat.py` refuses such a note; this drops it as defence in depth).
const DECISION_LINE_RES = [/^(DW-\d+)\s*[:=]\s*([A-Z])\s*[.!]?$/i, /^all\s*[:=]\s*([A-Z])\s*[.!]?$/i, /^default\s*[.!]?$/i];
const LEADING_MENTIONS_RE = /^(?:\[~accountid:[^\]\s]+\][\s,:]*)+/;
/** A note line `parse_answers` would read as a decision. */
export const isDecisionLine = (raw: string): boolean => {
  const line = raw.trim().replace(/^[-*]\s*/, "").replace(LEADING_MENTIONS_RE, "");
  return DECISION_LINE_RES.some((re) => re.test(line));
};

/** The answer line: `<id>: <letter>`, the note on its own line when it is not blank (a trailing text on the answer
 * line is a qualified answer, never ingested: `sweepdecisions.py`'s `QUALIFIED_RE`); a note line shaped like a
 * decision line is dropped. */
export const answerBody = (id: string, letter: string, note: string): string => {
  const kept = note.split(/\r?\n/).filter((l) => !isDecisionLine(l)).join("\n").trim();
  return `${id}: ${letter}${kept ? `\n${kept}` : ""}`;
};

/** The press of proposal `index` of reply `seq` in `chat`'s studio chat. */
export function proposalAction(chat: string, seq: number, index: number, p: StudioProposal): ProposalAction {
  switch (p.kind) {
    case "queue":
      return { kind: "request", url: "/jobs", body: { project: p.project, job: p.job, proposal: { chat, seq, index } } };
    case "answer":
      return { kind: "request", url: replyUrl(p.issue), body: { project: chat, body: answerBody(p.id, p.letter, p.note) } };
    case "open":
      return { kind: "navigate", route: p.route };
    case "engagement":
      return { kind: "request", url: createUrl(chat), body: { project: chat, request: p.title } };
    default:
      return { kind: "disabled", note: NOT_YET_TEXT };
  }
}

export interface StudioButton { index: number; label: string; proposal: StudioProposal; action: ProposalAction; enabled: boolean; note: string | null }

/** The pressed proposals, as `<reply seq>:<index>` (from the press lines; one marked `unqueued` is no press). */
export function pressedKeys(lines: readonly StudioLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) if (l.pressed && l.unqueued !== true && typeof l.pressed.seq === "number" && typeof l.pressed.index === "number") out.add(`${l.pressed.seq}:${l.pressed.index}`);
  return out;
}

/** A reply's buttons: a 39.7 kind disabled with its note, a pressed one disabled ("Pressed"); an unreadable proposal
 * keeps its index but renders nothing. */
export function studioButtons(chat: string, reply: StudioLine, pressed: ReadonlySet<string>): StudioButton[] {
  const out: StudioButton[] = [];
  (reply.proposals ?? []).forEach((raw, index) => {
    const proposal = proposalOfStudio(raw);
    if (!proposal) return;
    const action = proposalAction(chat, reply.seq, index, proposal);
    const wasPressed = pressed.has(`${reply.seq}:${index}`);
    out.push({
      index, label: proposal.label, proposal, action,
      enabled: action.kind !== "disabled" && !wasPressed,
      note: action.kind === "disabled" ? action.note : wasPressed ? PRESSED_TEXT : null,
    });
  });
  return out;
}

// --- the stream's assembly (Settled shape 6)

/** The streamed text with a delta applied: `text.slice(0, from) + delta.text` when `from <= text.length` (in order,
 * an overlap, or from 0 after a reconnect); a `from` past the end (a gap) is ignored. */
export const applyDelta = (text: string, delta: Pick<ChatDelta, "from" | "text">): string =>
  Number.isSafeInteger(delta.from) && delta.from >= 0 && delta.from <= text.length ? text.slice(0, delta.from) + delta.text : text;

/** The streaming replies by the owner line they answer (`reply_to`). */
export type Streams = Readonly<Record<number, { run_id: string; text: string }>>;

const answered = (lines: readonly StudioLine[]): Set<number> => {
  const out = new Set<number>();
  for (const l of lines) if (l.author === "planner" && typeof l.reply_to === "number") out.add(l.reply_to);
  return out;
};

/** A delta folded in; a delta for an owner line whose reply is already in the record is dropped (the record is
 * authoritative). A delta of another run for the same line starts over. */
export function withDelta(streams: Streams, delta: ChatDelta, lines: readonly StudioLine[]): Streams {
  if (answered(lines).has(delta.reply_to)) return streams;
  const had = streams[delta.reply_to];
  const base = had && had.run_id === delta.run_id ? had.text : "";
  if (delta.from > base.length) return streams; // a gap: ignored
  const text = applyDelta(base, delta);
  if (had && had.run_id === delta.run_id && text === had.text) return streams;
  return { ...streams, [delta.reply_to]: { run_id: delta.run_id, text } };
}

/** The streams whose reply has landed dropped (an `event: chat` reply with `reply_to` R drops R's streaming text). */
export function withoutAnswered(streams: Streams, lines: readonly StudioLine[]): Streams {
  const done = answered(lines);
  const keys = Object.keys(streams).map(Number).filter((k) => done.has(k));
  if (!keys.length) return streams;
  const out: Record<number, { run_id: string; text: string }> = { ...streams };
  for (const k of keys) delete out[k];
  return out;
}

export const isChatDelta = (v: unknown): v is ChatDelta =>
  isObj(v) && typeof v.run_id === "string" && typeof v.reply_to === "number" && Number.isSafeInteger(v.reply_to) &&
  typeof v.from === "number" && Number.isSafeInteger(v.from) && v.from >= 0 && typeof v.text === "string";

// --- the pending turns and their label (Settled shapes 5, 10)

/** A line's excerpt: whitespace runs collapsed to one space and trimmed; past 40 code points, cut to 40 and `…`. */
export function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const cps = [...flat];
  return cps.length > 40 ? `${cps.slice(0, 40).join("")}…` : flat;
}

/** The pending turns, by seq: owner lines with no `pressed` and no reply whose `reply_to` is their seq. */
export function pendingTurns(lines: readonly StudioLine[]): StudioLine[] {
  const done = answered(lines);
  return lines.filter((l) => l.author === "owner" && !l.pressed && !done.has(l.seq)).sort((a, b) => a.seq - b.seq);
}

/** The pending label of owner line `seq` (null when it is not pending). Position 1 is the turn being answered; at
 * position n ≥ 2 it names the previous pending line's excerpt and the position. */
export function pendingLabel(lines: readonly StudioLine[], seq: number): string | null {
  const pending = pendingTurns(lines);
  const i = pending.findIndex((l) => l.seq === seq);
  if (i < 0) return null;
  if (i === 0) return PENDING_TEXT;
  return `${PENDING_TEXT} — queued behind the reply to '${excerpt(pending[i - 1]!.body)}' (position ${i + 1})`;
}

/** The code points of a text (the supervisor's 4,000 is counted in code points). */
export const codePoints = (text: string): number => [...text].length;

// --- the reads and the posts

export const studioChatUrl = (project: string, since = 0): string => `/chat?${q(project)}${since > 0 ? `&since=${since}` : ""}`;
export const STUDIO_CHAT_URL = "/chat";
export const JOBS_URL = "/jobs";

const studioLineOf = (v: unknown): v is StudioLine => lineOf(v);

export type StudioChatResult = { ok: true; lines: StudioLine[]; last_seq: number } | Failure;
/** `GET /chat?project=<id>[&since=<seq>]`: the studio chat's lines after `since`. Never throws. */
export async function fetchStudioChat(project: string, since = 0, fetchFn: FetchLike = defaultFetch): Promise<StudioChatResult> {
  const url = studioChatUrl(project, since);
  try {
    const res = await fetchFn(url, GET);
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !Array.isArray(body.lines)) return malformed(url, "lines");
    const lines = (body.lines as unknown[]).filter(studioLineOf);
    return { ok: true, lines, last_seq: typeof body.last_seq === "number" ? body.last_seq : lines.reduce((m, l) => Math.max(m, l.seq), since) };
  } catch (e) {
    return thrown(url, e);
  }
}

export type StudioPostResult = { ok: true; seq: number; run_id: string | null; behind: { seq: number; run_id: string } | null; note: string | null } | Failure;

async function postStudio(project: string, payload: Record<string, unknown>, csrf: string | null, fetchFn: FetchLike): Promise<StudioPostResult> {
  const url = STUDIO_CHAT_URL;
  try {
    const res = await fetchFn(url, post(csrf, { project, ...payload }));
    if (!res.ok) return await failureOf(url, res);
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || typeof body.seq !== "number") return malformed(url, "chat line");
    const b = body.behind;
    return {
      ok: true, seq: body.seq,
      run_id: typeof body.run_id === "string" ? body.run_id : null,
      behind: isObj(b) && typeof b.seq === "number" && typeof b.run_id === "string" ? { seq: b.seq, run_id: b.run_id } : null,
      note: typeof body.note === "string" ? body.note : null,
    };
  } catch (e) {
    return thrown(url, e);
  }
}

/** `POST /chat {project, text}`: the owner's line. Never throws; 400 LineTooLong and 503 ChatBusy are named. */
export const postStudioLine = (project: string, text: string, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<StudioPostResult> =>
  postStudio(project, { text }, csrf, fetchFn);

/** `POST /chat {project, pressed: {seq, index}}`: the press line (the supervisor writes `pressed: <label>`). */
export const postPress = (project: string, seq: number, index: number, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<StudioPostResult> =>
  postStudio(project, { pressed: { seq, index } }, csrf, fetchFn);

export type SendResult = { ok: true } | Failure;
/** One proposal request (`POST` its body with the CSRF header). Never throws; a refusal is named. */
export async function sendRequest(url: string, body: Record<string, unknown>, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<SendResult> {
  try {
    const res = await fetchFn(url, post(csrf, body));
    if (!res.ok) return await failureOf(url, res);
    return { ok: true };
  } catch (e) {
    return thrown(url, e);
  }
}

/** `POST /jobs {project, job, proposal: {chat, seq, index}}`: a `queue` press (the cookie is admitted only with a
 * recorded matching proposal, Settled shape 11). */
export const postJob = (project: string, job: string, proposal: { chat: string; seq: number; index: number }, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<SendResult> =>
  sendRequest(JOBS_URL, { project, job, proposal }, csrf, fetchFn);

/** A press's result: the press line's result, and `sent` — the proposal's request was answered 2xx (a `queue`,
 * `answer` or `engagement` press). A failure with `sent` true is a press line that failed after its request went
 * out: the caller keeps that button disabled (pressing again would repeat the request). A `queue` press posts no
 * press line: the supervisor's `POST /jobs` gate records it with the submit (`seq: null` here; the line arrives on
 * the stream). */
export type PressResult = (StudioPostResult | { ok: true; seq: null; run_id: null; behind: null; note: null }) & { sent: boolean };

/** The error shown when the request went out but the press line failed (`press` → `{ok: false, sent: true}`). */
export const sentUnrecordedText = (error: string): string => `The request was sent, but its press line was not recorded: ${error}`;

/** A press: the action's request (none for `open`), then, on a 2xx, the press line — except a `queue` press
 * (`POST /jobs`), whose press line the supervisor's gate records atomically with its check (one press per proposal
 * held by the server, not this page). `open` posts the press line before the caller navigates. Never throws. */
export async function press(chat: string, seq: number, index: number, action: ProposalAction, csrf: string | null, fetchFn: FetchLike = defaultFetch): Promise<PressResult> {
  if (action.kind === "disabled") return { ok: false, error: action.note, refusal: null, retryable: false, sent: false };
  const sent = action.kind === "request";
  if (sent) {
    const r = await sendRequest(action.url, action.body, csrf, fetchFn);
    if (!r.ok) return { ...r, sent: false };
    if (action.url === JOBS_URL) return { ok: true, seq: null, run_id: null, behind: null, note: null, sent: true };
  }
  return { ...(await postPress(chat, seq, index, csrf, fetchFn)), sent };
}

// ------------------------------------------------------------ the sent presses, per tab (Story 39.3)

/** The `answer` and `engagement` presses whose request went out but whose press line failed (`<reply seq>:<index>`)
 * have no server binding (a `queue` press does: its gate records the line): they are kept in this tab's
 * `sessionStorage` per project, so a reload keeps those buttons disabled. */
export const STUDIO_SENT_KEY = "tk-studio.web.studio-chat.sent";
const sentKey = (project: string) => `${STUDIO_SENT_KEY}.${project}`;
const sessionStore = (): StorageLike | null => {
  try {
    return (globalThis as { sessionStorage?: StorageLike }).sessionStorage ?? null;
  } catch {
    return null;
  }
};

/** The remembered sent presses of `project` (empty when absent, malformed, or the storage throws). */
export function rememberedSent(project: string, storage: StorageLike | null = sessionStore()): Set<string> {
  try {
    const raw = storage?.getItem(sentKey(project));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && /^\d+:\d+$/.test(k)) : []);
  } catch {
    return new Set();
  }
}

/** Remember `project`'s sent presses (best effort: a storage that throws is ignored). */
export function rememberSent(project: string, keys: Iterable<string>, storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.setItem(sentKey(project), JSON.stringify([...keys]));
  } catch {
    /* best effort */
  }
}
