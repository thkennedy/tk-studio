/**
 * The engagement record and its states (Story 32.1, design spec §7.1 and user flow F2, contract 0.1.27 additive).
 * `api.ts` serves the routes, `office.ts` and `board.ts` read the records; no HTTP here.
 *
 *   the record   `<served root>/_bmad-output/engagements/<ENG-NNN>/engagement.yaml` (`shape_version: 1`): `id, project,
 *                state, request, questions[], assumptions[], scope_page, quote, autonomy, approved_at, closeout`, plus
 *                `created`, `updated`, `spend {planning_usd, runs_usd}` and `inputs[]` (the typed-input log, one line
 *                `{at, verb, source, payload?, from, to, run_id?, detail?}` per applied input or event). Canonical
 *                (AD-5): the office and the board read these files; the `engagement` service event is the signal only.
 *   the table    `TRANSITIONS`, the one exported table: each row `{from, verb | event, to, guard?, effect?, source?}`.
 *                Nothing else moves `state` — not a chat message, not the planner, not a timer. `applyInput` applies
 *                the owner's typed verbs (`answer`, `go`, `revise`, `question`, `approve`, `cancel`), `applyEvent` the
 *                supervisor-observed event rows (no caller in 32.1: 32.3, 32.6 and 32.8 wire them). Both are pure.
 *   the id       `ENG-NNN` from `next.engagement` in `.tk-studio/plan-counter.yaml` (default 1), the counter saved
 *                atomically before the record lands (a crash leaves a gap, never a duplicate: `plansync.py`), every
 *                other key and `counter_version` preserved, an id whose directory exists skipped.
 *   the chat     `chatPointer`: `{route: "/chat/<id>", path: "_bmad-output/engagements/<id>/chat.jsonl", last_seq}`
 *                (32.2 writes the file; `last_seq` 0 while it is absent).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { REPLY_MAX_BYTES } from "./inbox";

// ------------------------------------------------------------ the vocabulary

export const ENGAGEMENT_STATES = [
  "intake", "awaiting-answers", "scoping", "quoted", "approved", "in-progress", "delivered",
  "paused", "failed", "partial", "cancelled",
] as const;
export type EngagementState = typeof ENGAGEMENT_STATES[number];
/** The states no input or event leaves: every verb and event is 409 EngagementClosed there. */
export const TERMINAL_STATES: ReadonlySet<EngagementState> = new Set<EngagementState>(["delivered", "failed", "cancelled"]);
/** The owner's typed inputs (`POST /engagements/{id}/input`). */
export const INPUT_VERBS = ["answer", "go", "revise", "question", "approve", "cancel"] as const;
export type InputVerb = typeof INPUT_VERBS[number];
/** The supervisor-observed event rows (Settled shape 4; `questions` is the planner's, 32.3's one exception). */
export const ENGAGEMENT_EVENTS = ["questions", "launched", "run-paused", "run-resumed", "cap", "run-ended"] as const;
export type EngagementEvent = typeof ENGAGEMENT_EVENTS[number];
/** Who applied an input: the bearer or a cookie session (HTTP), the planner (32.3's `question` exception), the
 * supervisor (the event rows). */
export type InputSource = "bearer" | "cookie" | "planner" | "supervisor";
export const AUTONOMY_LEVELS = ["ask", "steady", "full"] as const;
export type Autonomy = typeof AUTONOMY_LEVELS[number];
export const RUN_OUTCOMES = ["delivered", "partial", "failed"] as const;

/** An engagement id: `ENG-` and at least three digits. */
export const ENGAGEMENT_ID_RE = /^ENG-\d{3,}$/;

export interface InputLine {
  at: string; verb: InputVerb | EngagementEvent; source: InputSource; payload?: Record<string, unknown>;
  from: EngagementState; to: EngagementState; run_id?: string; detail?: Record<string, unknown>;
}

export interface Engagement {
  shape_version: 1;
  id: string;
  project: string;
  state: EngagementState;
  request: string;
  questions: Record<string, unknown>[];
  assumptions: Record<string, unknown>[];
  scope_page: Record<string, unknown> | null;
  quote: Record<string, unknown> | null;
  autonomy: Autonomy | null;
  approved_at: string | null;
  closeout: Record<string, unknown> | string | null;
  created: string;
  updated: string;
  spend: { planning_usd: number; runs_usd: number };
  inputs: InputLine[];
}

/** A new record in `intake` (the create route's). */
export function newEngagement(id: string, project: string, request: string, at: string): Engagement {
  return {
    shape_version: 1, id, project, state: "intake", request, questions: [], assumptions: [], scope_page: null, quote: null,
    autonomy: null, approved_at: null, closeout: null, created: at, updated: at, spend: { planning_usd: 0, runs_usd: 0 }, inputs: [],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

// ------------------------------------------------------------ the bodies (Settled shape 3)

export interface CreateBody { project: string; request: string }

/** `POST /engagements`: `{project, request}`, both non-empty strings, `request` at most REPLY_MAX_BYTES UTF-8; no
 * other field (32.8's `follows` is not accepted yet). */
export function checkCreateBody(raw: unknown): { ok: true; body: CreateBody } | { ok: false; detail: string } {
  if (!isObject(raw)) return { ok: false, detail: "the body must be a JSON object" };
  for (const k of Object.keys(raw)) {
    if (k !== "project" && k !== "request") return { ok: false, detail: `unknown field '${k}' (allowed: project, request)` };
  }
  if (!nonEmpty(raw.project)) return { ok: false, detail: "field 'project' must be a non-empty string" };
  if (!nonEmpty(raw.request)) return { ok: false, detail: "field 'request' must be a non-empty string" };
  if (Buffer.byteLength(raw.request, "utf-8") > REPLY_MAX_BYTES) {
    return { ok: false, detail: `field 'request' exceeds ${REPLY_MAX_BYTES} bytes (UTF-8)` };
  }
  return { ok: true, body: { project: raw.project.trim(), request: raw.request } };
}

export interface InputBody { verb: InputVerb; payload: Record<string, unknown> }

/** Each verb's fields (besides `verb`): the required ones and the optional ones. */
const VERB_FIELDS: Readonly<Record<InputVerb, { required: readonly string[]; optional: readonly string[] }>> = {
  answer: { required: ["answers"], optional: [] },
  go: { required: [], optional: ["cap"] },
  revise: { required: [], optional: ["body"] },
  question: { required: ["text"], optional: [] },
  approve: { required: ["autonomy"], optional: ["base_ref"] },
  cancel: { required: [], optional: ["reason"] },
};

/** `POST /engagements/{id}/input`: `{verb, …}` with the verb's typed payload (Settled shape 3) and no other field:
 * `answer {answers: {<question id>: <option>}}` non-empty; `go {cap?: number > 0}`; `revise {body?: string}` at most
 * REPLY_MAX_BYTES UTF-8; `question {text}` (the owner's; the planner's `{questions[], run_id}` never arrives here);
 * `approve {autonomy: ask | steady | full, base_ref?}`; `cancel {reason?}`. Every string non-empty. */
export function checkInputBody(raw: unknown): { ok: true; body: InputBody } | { ok: false; detail: string } {
  if (!isObject(raw)) return { ok: false, detail: "the body must be a JSON object" };
  if (!("verb" in raw)) return { ok: false, detail: "missing field 'verb'" };
  const verb = raw.verb;
  if (typeof verb !== "string" || !(INPUT_VERBS as readonly string[]).includes(verb)) {
    return { ok: false, detail: `unknown verb ${JSON.stringify(verb)} (allowed: ${INPUT_VERBS.join(", ")})` };
  }
  const v = verb as InputVerb;
  const fields = VERB_FIELDS[v];
  const allowed = [...fields.required, ...fields.optional];
  for (const k of Object.keys(raw)) {
    if (k !== "verb" && !allowed.includes(k)) {
      return { ok: false, detail: `unknown field '${k}' for verb '${v}' (allowed: ${allowed.length ? allowed.join(", ") : "none"})` };
    }
  }
  for (const k of fields.required) if (!(k in raw)) return { ok: false, detail: `missing field '${k}' for verb '${v}'` };
  const payload: Record<string, unknown> = {};
  for (const k of allowed) if (k in raw) payload[k] = raw[k];
  switch (v) {
    case "answer": {
      const answers = raw.answers;
      if (!isObject(answers) || !Object.keys(answers).length) return { ok: false, detail: "field 'answers' must be a non-empty object of question id to option" };
      for (const [id, option] of Object.entries(answers)) {
        if (!id.trim()) return { ok: false, detail: "field 'answers' has an empty question id" };
        if (!nonEmpty(option)) return { ok: false, detail: `field 'answers.${id}' must be a non-empty string` };
      }
      break;
    }
    case "go":
      if ("cap" in raw && (typeof raw.cap !== "number" || !Number.isFinite(raw.cap) || raw.cap <= 0)) {
        return { ok: false, detail: "field 'cap' must be a number > 0" };
      }
      break;
    case "revise":
      if ("body" in raw) {
        if (!nonEmpty(raw.body)) return { ok: false, detail: "field 'body' must be a non-empty string" };
        if (Buffer.byteLength(raw.body, "utf-8") > REPLY_MAX_BYTES) return { ok: false, detail: `field 'body' exceeds ${REPLY_MAX_BYTES} bytes (UTF-8)` };
      }
      break;
    case "question":
      if (!nonEmpty(raw.text)) return { ok: false, detail: "field 'text' must be a non-empty string" };
      break;
    case "approve":
      if (typeof raw.autonomy !== "string" || !(AUTONOMY_LEVELS as readonly string[]).includes(raw.autonomy)) {
        return { ok: false, detail: `field 'autonomy' must be one of ${AUTONOMY_LEVELS.join(", ")}` };
      }
      if ("base_ref" in raw && !nonEmpty(raw.base_ref)) return { ok: false, detail: "field 'base_ref' must be a non-empty string" };
      break;
    case "cancel":
      if ("reason" in raw && !nonEmpty(raw.reason)) return { ok: false, detail: "field 'reason' must be a non-empty string" };
      break;
  }
  return { ok: true, body: { verb: v, payload } };
}

// ------------------------------------------------------------ the table

/** A guard: when it does not hold the row does not apply (the next row for the same cell is tried; none left is 409
 * IllegalInput naming the guard's `detail`). Evaluated on the record after the row's effect. */
export type GuardName = "every-question-answered" | "quote-present" | "outcome-delivered" | "outcome-partial" | "outcome-failed";
/** An effect: what the row writes besides `state`, `updated` and the `inputs[]` line. */
export type EffectName = "record-answers" | "assume-defaults" | "void-quote" | "record-approval" | "raise-cap" | "set-questions";

export interface TransitionRow {
  from: EngagementState;
  verb?: InputVerb;
  event?: EngagementEvent;
  to: EngagementState;
  guard?: GuardName;
  effect?: EffectName;
  /** The source the row is applied with (event rows only; default `supervisor`). */
  source?: InputSource;
}

/** The non-terminal states, in the table's order. */
const OPEN_STATES: readonly EngagementState[] = ["intake", "awaiting-answers", "scoping", "quoted", "approved", "in-progress", "paused", "partial"];

/** The one transition table (design README §7.1; the planner's reading in the 32.1 plan). A `(state, verb)` cell with
 * no row is 409 IllegalInput; a terminal state 409 EngagementClosed. Rows of one cell are tried in order. */
export const TRANSITIONS: readonly TransitionRow[] = [
  // intake
  { from: "intake", verb: "go", to: "scoping" },
  { from: "intake", event: "questions", to: "awaiting-answers", effect: "set-questions", source: "planner" },
  // awaiting-answers
  { from: "awaiting-answers", verb: "answer", to: "scoping", guard: "every-question-answered", effect: "record-answers" },
  { from: "awaiting-answers", verb: "answer", to: "awaiting-answers", effect: "record-answers" },
  { from: "awaiting-answers", verb: "go", to: "scoping", effect: "assume-defaults" },
  // scoping
  { from: "scoping", verb: "go", to: "quoted", guard: "quote-present" },
  { from: "scoping", verb: "revise", to: "scoping" },
  // quoted
  { from: "quoted", verb: "revise", to: "scoping", effect: "void-quote" },
  { from: "quoted", verb: "approve", to: "approved", effect: "record-approval" },
  // approved
  { from: "approved", verb: "revise", to: "scoping", effect: "void-quote" },
  { from: "approved", event: "launched", to: "in-progress" },
  // in-progress
  { from: "in-progress", verb: "revise", to: "scoping", effect: "void-quote" },
  { from: "in-progress", event: "run-paused", to: "paused" },
  { from: "in-progress", event: "cap", to: "partial" },
  { from: "in-progress", event: "run-ended", to: "delivered", guard: "outcome-delivered" },
  { from: "in-progress", event: "run-ended", to: "partial", guard: "outcome-partial" },
  { from: "in-progress", event: "run-ended", to: "failed", guard: "outcome-failed" },
  // paused
  { from: "paused", verb: "revise", to: "scoping", effect: "void-quote" },
  { from: "paused", event: "run-resumed", to: "in-progress" },
  // partial
  { from: "partial", verb: "go", to: "in-progress", effect: "raise-cap" },
  { from: "partial", verb: "revise", to: "scoping", effect: "void-quote" },
  { from: "partial", event: "run-ended", to: "delivered", guard: "outcome-delivered" },
  { from: "partial", event: "run-ended", to: "partial", guard: "outcome-partial" },
  { from: "partial", event: "run-ended", to: "failed", guard: "outcome-failed" },
  // every open state: the owner's question moves nothing; cancel ends it
  ...OPEN_STATES.map((s): TransitionRow => ({ from: s, verb: "question", to: s })),
  ...OPEN_STATES.map((s): TransitionRow => ({ from: s, verb: "cancel", to: "cancelled" })),
];

/** A question's default option: its `default` string, else the option marked `default: true` (its `label`, `value`
 * or `text`, or the option itself when a string); null when it names none. */
function defaultOf(q: Record<string, unknown>): string | null {
  if (nonEmpty(q.default)) return q.default;
  const options = Array.isArray(q.options) ? q.options : [];
  for (const o of options) {
    if (!isObject(o) || o.default !== true) continue;
    for (const k of ["label", "value", "text"]) if (nonEmpty(o[k])) return o[k] as string;
  }
  return null;
}

const hasAnswer = (q: Record<string, unknown>) => q.answer !== undefined && q.answer !== null && q.answer !== "";

const GUARDS: Readonly<Record<GuardName, { holds: (r: Engagement, args: Record<string, unknown>) => boolean; detail: string }>> = {
  "every-question-answered": { holds: (r) => r.questions.every(hasAnswer), detail: "questions still open" },
  "quote-present": { holds: (r) => r.quote !== null && r.quote !== undefined, detail: "no quote" },
  "outcome-delivered": { holds: (_r, a) => a.outcome === "delivered", detail: "outcome is not delivered" },
  "outcome-partial": { holds: (_r, a) => a.outcome === "partial", detail: "outcome is not partial" },
  "outcome-failed": { holds: (_r, a) => a.outcome === "failed", detail: "outcome is not one of delivered, partial, failed" },
};

const EFFECTS: Readonly<Record<EffectName, (r: Engagement, args: Record<string, unknown>, at: string) => Engagement>> = {
  "record-answers": (r, a) => {
    const answers = isObject(a.answers) ? a.answers : {};
    return { ...r, questions: r.questions.map((q) => (typeof q.id === "string" && Object.hasOwn(answers, q.id) ? { ...q, answer: answers[q.id] } : q)) };
  },
  "assume-defaults": (r) => {
    const assumed = r.questions.filter((q) => !hasAnswer(q)).map((q) => ({ question: q.id ?? null, text: q.text ?? null, assumed: defaultOf(q) }));
    return { ...r, assumptions: [...r.assumptions, ...assumed] };
  },
  "void-quote": (r) => ({ ...r, quote: null }),
  "record-approval": (r, a, at) => ({ ...r, autonomy: a.autonomy as Autonomy, approved_at: at }),
  "raise-cap": (r, a) => (typeof a.cap === "number" && isObject(r.quote) ? { ...r, quote: { ...r.quote, cap: a.cap } } : r),
  "set-questions": (r, a) => (Array.isArray(a.questions) ? { ...r, questions: a.questions.filter((q): q is Record<string, unknown> => isObject(q) && nonEmpty(q.id)).map((q) => ({ ...q })) } : r),
};

export type ApplyResult =
  | { ok: true; record: Engagement; from: EngagementState; to: EngagementState }
  | { ok: false; error: "IllegalInput" | "EngagementClosed" | "SchemaError"; state: EngagementState; verb: string; detail?: string };

/** The rows for one cell. */
export const rowsFor = (state: EngagementState, key: { verb?: InputVerb; event?: EngagementEvent }): TransitionRow[] =>
  TRANSITIONS.filter((r) => r.from === state && (key.verb !== undefined ? r.verb === key.verb : r.event === key.event));

function applyRows(
  record: Engagement, name: string, rows: TransitionRow[], args: Record<string, unknown>, at: string,
  line: (row: TransitionRow, to: EngagementState) => InputLine,
): ApplyResult {
  const from = record.state;
  let refused: string | undefined;
  for (const row of rows) {
    const next = row.effect ? EFFECTS[row.effect](record, args, at) : record;
    if (row.guard && !GUARDS[row.guard].holds(next, args)) { refused = GUARDS[row.guard].detail; continue; }
    return { ok: true, from, to: row.to, record: { ...next, state: row.to, updated: at, inputs: [...record.inputs, line(row, row.to)] } };
  }
  return { ok: false, error: "IllegalInput", state: from, verb: name, ...(refused ? { detail: refused } : {}) };
}

/** An owner's typed input on `record` (pure: a new record, never a write). Terminal: EngagementClosed; no row for the
 * cell: IllegalInput `{state, verb}`; an `answer` naming a question id not in `questions[]`: SchemaError. */
export function applyInput(
  record: Engagement, input: { verb: InputVerb; payload?: Record<string, unknown>; source: InputSource; at: string; run_id?: string },
): ApplyResult {
  const state = record.state;
  if (TERMINAL_STATES.has(state)) return { ok: false, error: "EngagementClosed", state, verb: input.verb };
  const rows = rowsFor(state, { verb: input.verb });
  if (!rows.length) return { ok: false, error: "IllegalInput", state, verb: input.verb };
  const payload = input.payload ?? {};
  if (input.verb === "answer") {
    const known = new Set(record.questions.map((q) => q.id).filter((id): id is string => typeof id === "string"));
    for (const id of Object.keys(isObject(payload.answers) ? payload.answers : {})) {
      if (!known.has(id)) return { ok: false, error: "SchemaError", state, verb: input.verb, detail: `unknown question id ${id}` };
    }
  }
  return applyRows(record, input.verb, rows, payload, input.at, (_row, to) => ({
    at: input.at, verb: input.verb, source: input.source, ...(Object.keys(payload).length ? { payload: { ...payload } } : {}),
    from: state, to, ...(input.run_id ? { run_id: input.run_id } : {}),
  }));
}

/** A supervisor-observed event row on `record` (Settled shape 4; pure). Logged with the row's source (`planner` for
 * `questions`, else `supervisor`) and the event's `detail`. Exported for 32.3, 32.6 and 32.8; no route calls it. */
export function applyEvent(
  record: Engagement, input: { event: EngagementEvent; detail?: Record<string, unknown>; at: string; run_id?: string },
): ApplyResult {
  const state = record.state;
  if (TERMINAL_STATES.has(state)) return { ok: false, error: "EngagementClosed", state, verb: input.event };
  const rows = rowsFor(state, { event: input.event });
  if (!rows.length) return { ok: false, error: "IllegalInput", state, verb: input.event };
  const detail = input.detail ?? {};
  const runId = input.run_id ?? (nonEmpty(detail.run_id) ? detail.run_id : undefined);
  return applyRows(record, input.event, rows, detail, input.at, (row, to) => ({
    at: input.at, verb: input.event, source: row.source ?? "supervisor", from: state, to, detail: { ...detail },
    ...(runId ? { run_id: runId } : {}),
  }));
}

// ------------------------------------------------------------ the projections

/** The request's first non-empty line, trimmed, at most 80 code points. */
export function titleOf(request: string): string {
  const line = request.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  return Array.from(line).slice(0, 80).join("");
}

/** An engagement waiting on the owner: `awaiting-answers` (the questions) or `quoted` (the approval). */
export const needsYou = (state: string): boolean => state === "awaiting-answers" || state === "quoted";

// ------------------------------------------------------------ the files

export const ENGAGEMENTS_REL = join("_bmad-output", "engagements");
export const COUNTER_REL = join(".tk-studio", "plan-counter.yaml");
const YAML_OPTIONS = { lineWidth: -1, noRefs: true } as const;

export class EngagementRecordInvalid extends Error {
  constructor(readonly shown: string, why: string) {
    super(`EngagementRecordInvalid: ${shown}: ${why}`);
    this.name = "EngagementRecordInvalid";
  }
}
export class EngagementCounterInvalid extends Error {
  constructor(why: string) {
    super(`EngagementCounterInvalid: ${COUNTER_REL.split("\\").join("/")}: ${why}`);
    this.name = "EngagementCounterInvalid";
  }
}

/** A record's path; `shownPath` the same relative to the root, with `/` (AD-15). */
export const engagementPath = (root: string, id: string) => join(root, ENGAGEMENTS_REL, id, "engagement.yaml");
export const shownPath = (id: string) => `_bmad-output/engagements/${id}/engagement.yaml`;

/** Write `text` to `path` atomically: a sibling temp file, then a rename (as `plansync.py`'s `_atomic_write`). */
function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    writeFileSync(tmp, text, "utf-8");
    renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) { try { rmSync(tmp, { force: true }); } catch { /* best effort */ } }
  }
}

/** Parse a record's YAML text: an object with `shape_version: 1`, a string `id`, a known `state` and a string
 * `request`; `questions[]`, `assumptions[]` and `inputs[]` (an absent one `[]`) hold mappings only, each question with
 * a non-empty string `id`. */
function parseRecord(text: string, shown: string): Engagement {
  let doc: unknown;
  try { doc = loadYaml(text); } catch (e) { throw new EngagementRecordInvalid(shown, e instanceof Error ? e.message.split("\n")[0] : String(e)); }
  if (!isObject(doc)) throw new EngagementRecordInvalid(shown, "not a YAML mapping");
  if (doc.shape_version !== 1) throw new EngagementRecordInvalid(shown, `shape_version must be 1, got ${JSON.stringify(doc.shape_version ?? null)}`);
  if (!nonEmpty(doc.id)) throw new EngagementRecordInvalid(shown, "no id");
  if (typeof doc.state !== "string" || !(ENGAGEMENT_STATES as readonly string[]).includes(doc.state)) {
    throw new EngagementRecordInvalid(shown, `unknown state ${JSON.stringify(doc.state ?? null)}`);
  }
  if (typeof doc.request !== "string") throw new EngagementRecordInvalid(shown, "request must be a string");
  for (const key of ["inputs", "questions", "assumptions"] as const) {
    if (!Array.isArray(doc[key])) { doc[key] = []; continue; }
    const at = (doc[key] as unknown[]).findIndex((entry) => !isObject(entry));
    if (at >= 0) throw new EngagementRecordInvalid(shown, `${key}[${at}] is not a mapping`);
  }
  const unnamed = (doc.questions as Record<string, unknown>[]).findIndex((q) => !nonEmpty(q.id));
  if (unnamed >= 0) throw new EngagementRecordInvalid(shown, `questions[${unnamed}] has no id`);
  return doc as unknown as Engagement;
}

/** The record `id` under `root`; null when it has no file; EngagementRecordInvalid when it is not a record. */
export function readEngagement(root: string, id: string): Engagement | null {
  let text: string;
  try { text = readFileSync(engagementPath(root, id), "utf-8"); } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT" || (e as NodeJS.ErrnoException)?.code === "ENOTDIR") return null;
    throw new EngagementRecordInvalid(shownPath(id), (e as Error).message.split(root).join("."));
  }
  const record = parseRecord(text, shownPath(id));
  if (record.id !== id) throw new EngagementRecordInvalid(shownPath(id), `id ${JSON.stringify(record.id)} does not match its directory ${id}`);
  return record;
}

/** Write the record atomically (tmp then rename). */
export function writeEngagement(root: string, record: Engagement): void {
  atomicWrite(engagementPath(root, record.id), dumpYaml(record, YAML_OPTIONS));
}

/** Newest first: `created` descending, then the id's number descending. */
const newestFirst = (a: Engagement, b: Engagement) => {
  const ca = String(a.created ?? ""), cb = String(b.created ?? "");
  if (ca !== cb) return ca < cb ? 1 : -1;
  return Number(/\d+/.exec(b.id)?.[0] ?? 0) - Number(/\d+/.exec(a.id)?.[0] ?? 0);
};

const listCache = new Map<string, { signature: string; engagements: Engagement[]; problems: string[] }>();
const LIST_CACHE_MAX = 64;

/** Every record under `root`, newest first. A malformed record is skipped and named in `problems` (when given) as
 * `_bmad-output/engagements/<id>/engagement.yaml: <reason>` (`shownPath`: root-relative, AD-15). Cached per root on a signature of the
 * directory's `mtimeMs` plus each record file's `(mtimeMs, size)`. */
export function listEngagements(root: string | null | undefined, problems?: string[]): Engagement[] {
  if (!root) return [];
  const dir = join(root, ENGAGEMENTS_REL);
  let dirStat;
  try { dirStat = statSync(dir); } catch { listCache.delete(dir); return []; }
  if (!dirStat.isDirectory()) { listCache.delete(dir); return []; }
  let ids: string[] = [];
  try { ids = readdirSync(dir).filter((n) => ENGAGEMENT_ID_RE.test(n)).sort(); } catch { /* none */ }
  const stamps = ids.map((id) => {
    try { const st = statSync(engagementPath(root, id)); return [id, st.mtimeMs, st.size] as const; } catch { return [id, null, null] as const; }
  });
  const signature = JSON.stringify([dirStat.mtimeMs, stamps]);
  const hit = listCache.get(dir);
  if (hit && hit.signature === signature) {
    problems?.push(...hit.problems);
    return [...hit.engagements];
  }
  const engagements: Engagement[] = [];
  const found: string[] = [];
  for (const [id, mtime] of stamps) {
    if (mtime === null) continue; // a directory with no record yet
    try {
      const r = readEngagement(root, id);
      if (r) engagements.push(r);
    } catch (e) {
      const why = e instanceof EngagementRecordInvalid ? e.message.slice(`EngagementRecordInvalid: ${shownPath(id)}: `.length) : String(e);
      found.push(`${shownPath(id)}: ${why}`);
    }
  }
  engagements.sort(newestFirst);
  listCache.delete(dir);
  listCache.set(dir, { signature, engagements, problems: found });
  while (listCache.size > LIST_CACHE_MAX) listCache.delete(listCache.keys().next().value!);
  problems?.push(...found);
  return [...engagements];
}

// ------------------------------------------------------------ the id (Settled shape 2)

/** Mint the next `ENG-NNN` of `root`'s plan counter (see the header) and save the counter before returning: the
 * caller writes the record after. Skips an id whose directory already exists. */
export function mintEngagementId(root: string): string {
  const path = join(root, COUNTER_REL);
  let counter: Record<string, unknown>;
  let text: string | null = null;
  try { text = readFileSync(path, "utf-8"); } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw new EngagementCounterInvalid((e as Error).message.split(root).join("."));
  }
  if (text === null) counter = { counter_version: 1, next: { epic: 1, story: 1, task: 1 } };
  else {
    let doc: unknown;
    try { doc = loadYaml(text); } catch (e) { throw new EngagementCounterInvalid(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    if (!isObject(doc) || !isObject(doc.next)) throw new EngagementCounterInvalid("'next' must be a mapping");
    counter = doc;
  }
  const next = { ...(counter.next as Record<string, unknown>) };
  let n = next.engagement === undefined ? 1 : next.engagement;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new EngagementCounterInvalid("'next.engagement' must be an int >= 1");
  let id: string;
  for (;;) {
    id = `ENG-${String(n).padStart(3, "0")}`;
    n += 1;
    if (!existsSync(join(root, ENGAGEMENTS_REL, id))) break; // ids are never reused: a taken one is skipped
  }
  next.engagement = n;
  atomicWrite(path, dumpYaml({ ...counter, next }, YAML_OPTIONS));
  return id;
}

// ------------------------------------------------------------ the chat pointer (Settled shape 1)

export interface ChatPointer { route: string; path: string; last_seq: number }

/** The chat of `id`: its route, its root-relative file and the last line's `seq` (0 while the file is absent). */
export function chatPointer(root: string, id: string): ChatPointer {
  const rel = `_bmad-output/engagements/${id}/chat.jsonl`;
  let last = 0;
  try {
    const lines = readFileSync(join(root, ENGAGEMENTS_REL, id, "chat.jsonl"), "utf-8").split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const o = JSON.parse(lines[i]!);
        if (isObject(o) && typeof o.seq === "number" && Number.isFinite(o.seq)) { last = o.seq; break; }
      } catch { /* a partial line: the one before */ }
    }
  } catch { /* absent: 0 */ }
  return { route: `/chat/${id}`, path: rel, last_seq: last };
}
