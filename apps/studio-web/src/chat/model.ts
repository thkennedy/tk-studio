// The Chat screen's rules (Story 32.7, design spec §6.3 Chat, F2): pure functions vitest drives in
// `environment: "node"`. No DOM: `fetch` and `localStorage` are injected. The composition is `ChatScreen.tsx`, the
// chat stream `stream.ts`.
// The screen reads `GET /engagements?project=`, `GET /engagements/{id}?project=`, `GET /chat/{id}?project=` and
// `GET /runs/{id}` (its `cost_usd`, 0.1.27), and posts `POST /engagements`, `POST /engagements/{id}/input` and
// `POST /chat/{id}` — every engagement read and post carrying `?project=<id>` (a repeated id is 409
// AmbiguousEngagement without it) and every post the CSRF token `GET /inbox?project=<id>` answered (Settled shape 2),
// exactly as the Issue screen's reply. Fetches and posts never throw; a refusal is rendered by its error name.
import type { FetchLike } from "../inbox/model";
import { canAct, costText, type ActionGate } from "../issue/model";
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
