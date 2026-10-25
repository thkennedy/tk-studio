/**
 * The engagement's clarifying questions (Story 32.3, user flow F2 step 2, contract 0.1.27 additive): the supervisor
 * applies what the planner wrote, puts the questions in the owner's inbox (one Jira issue per engagement) and reads
 * the owner's answers back. No HTTP here; `cli.ts` runs the pass at its `finally` sites and after an applied
 * `answer`/`go` on `POST /engagements/{id}/input` (`afterEngagementInput`).
 *
 *   the file     `<served root>/_bmad-output/engagements/<id>/questions.json` (Settled shape 1, `engage.py questions`):
 *                `{run_id, at, questions: [{id, text, options: [{label, default?: true}], impact}]}`, 1 to 3 questions,
 *                re-validated here (`checkQuestions`) as `engage.py` checks it.
 *   the pass     `questionsPass`, in order, per engagement its `chat-queued` events name (plus the input route's one):
 *                1. apply — for an ended `engagement-chat` run whose questions file carries its queue `run_id` and whose
 *                   run no `inputs[]` line names yet: the 32.1 event row `questions` through `applyEvent` (source
 *                   `planner`, that `run_id`), the record re-read fresh right before the atomic write (the
 *                   `chatSpendPass` rule) and the `engagement` service event; an invalid file or a state other than
 *                   `intake` applies nothing: one `engagement-questions-skipped {engagement, project, run_id, reason}`
 *                   per run (an unparsable or non-object file: once per engagement and reason).
 *                2. block — `awaiting-answers` with no `engagement-issue` `blocked` or block `refused` since its last
 *                   `questions` or partial `answer` line or its newest `engagement-answers` with `ids: []`:
 *                   `track.py block --engagement` through `uvRunner` (timeout 120), then
 *                   `engagement-issue {engagement, project, issue, action: "blocked", kind: "questions"}` on `ok`; a refusal by name
 *                   `engagement-issue {engagement, project, action: "refused", reason}` once per reason, and no further
 *                   call until a block is owed again (`retry: true`: nothing, the next pass calls again).
 *                3. Jira answers — the `inbox.json` item carrying `engagement`, every owner comment
 *                   (`comments.jsonl`, an edited comment's last line, in comment order) no `engagement-answers` event
 *                   names yet, each comment id once (`engagement-answers {engagement, project, comment, ids[]}`,
 *                   re-read right before each apply): every `<id>: <option>` line with an open question id
 *                   (case-insensitively) is an answer (an option's label when it equals one, case-insensitively, a
 *                   copied `- ` bullet and ` (default)` ignored; the question's own text, a copied header, ignored;
 *                   else the text verbatim), checked as the input route checks an `answer` (each at most
 *                   REPLY_MAX_BYTES) and applied with source `supervisor`; no parsed line, an answer refused, or
 *                   questions still open re-blocks the issue (a refused apply is `ids: []`).
 *                4. close — no longer `awaiting-answers`, questions asked (a `questions` line), and no `closed` or close
 *                   `refused` since the newest `blocked` (or at all, with none): `track.py close --engagement`, then
 *                   `engagement-issue {…, action: "closed"}`; a refusal by name
 *                   `engagement-issue {…, action: "refused", step: "close", reason}` and no further call.
 *                Injected deps, never throws, serialised per served root in-process only (across processes
 *                `track.py`'s `track.lock`). Nothing moves on a timer: the pass runs at run ends and after an input.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jiraBound } from "./closeout";
import { applyEvent, applyInput, checkInputBody, ENGAGEMENTS_REL, readEngagement, writeEngagement, type Engagement, type EngagementState } from "./engagement";
import { readComments, REPLY_MAX_BYTES } from "./inbox";
import { readInbox } from "./office";
import { ENGAGEMENT_CHAT_JOB, isTerminal, type Queue } from "./queue";
import { lastJsonObject, type RunResult } from "./server";
import { studioScript, uvRunner, type WorktreeDeps } from "./worktree";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export const QUESTION_ID_RE = /^[a-z0-9][a-z0-9-]{0,15}$/;
export const QUESTIONS_MAX = 3;
const OPTIONS_MIN = 2, OPTIONS_MAX = 6;
/** Settled shape 4: one answer line of an owner comment (the id matched case-insensitively, then lowercased). */
const ANSWER_LINE_RE = /^\s*([a-z0-9][a-z0-9-]{0,15})\s*:\s*(.+?)\s*$/i;
/** A copied option line's decoration, stripped before the label comparison only: a leading `- ` bullet and a
 * trailing ` (default)`. */
const BULLET_RE = /^-\s+/;
const DEFAULT_SUFFIX_RE = /\s*\(default\)$/i;

export const questionsFile = (root: string, id: string) => join(root, ENGAGEMENTS_REL, id, "questions.json");

export interface Question { id: string; text: string; options: { label: string; default?: true }[]; impact: string }

/** Settled shape 1, as `engage.py`'s `check_questions`: a fourth is `TooManyQuestions`; any other bad shape
 * `QuestionInvalid` naming the index. */
export function checkQuestions(raw: unknown): { ok: true; questions: Question[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: "QuestionInvalid: the questions must be an array" };
  if (!raw.length) return { ok: false, reason: "QuestionInvalid: at least one question is asked" };
  if (raw.length > QUESTIONS_MAX) return { ok: false, reason: `TooManyQuestions: ${raw.length} questions; at most ${QUESTIONS_MAX} are asked` };
  const ids = new Set<string>();
  const out: Question[] = [];
  for (const [i, q] of raw.entries()) {
    const bad = (why: string) => ({ ok: false as const, reason: `QuestionInvalid: questions[${i}]: ${why}` });
    if (!isObject(q)) return bad("not an object {id, text, options, impact}");
    const extra = Object.keys(q).find((k) => !["id", "text", "options", "impact"].includes(k));
    if (extra) return bad(`unknown field '${extra}'`);
    if (typeof q.id !== "string" || !QUESTION_ID_RE.test(q.id)) return bad(`field 'id' must match ${QUESTION_ID_RE.source}`);
    if (ids.has(q.id)) return bad(`duplicate id '${q.id}'`);
    ids.add(q.id);
    if (!nonEmpty(q.text)) return bad("field 'text' must be a non-empty string");
    if (!nonEmpty(q.impact)) return bad("field 'impact' must be a non-empty string");
    if (!Array.isArray(q.options) || q.options.length < OPTIONS_MIN || q.options.length > OPTIONS_MAX) {
      return bad(`field 'options' must hold ${OPTIONS_MIN} to ${OPTIONS_MAX} options`);
    }
    const labels = new Set<string>();
    let defaults = 0;
    const options: Question["options"] = [];
    for (const [j, o] of q.options.entries()) {
      if (!isObject(o)) return bad(`options[${j}] is not an object {label, default?}`);
      const oExtra = Object.keys(o).find((k) => k !== "label" && k !== "default");
      if (oExtra) return bad(`options[${j}]: unknown field '${oExtra}'`);
      if (!nonEmpty(o.label)) return bad(`options[${j}]: field 'label' must be a non-empty string`);
      const folded = o.label.trim().toLowerCase();
      if (labels.has(folded)) return bad(`options[${j}]: duplicate label '${o.label.trim()}'`);
      labels.add(folded);
      if ("default" in o) {
        if (o.default !== true) return bad(`options[${j}]: field 'default' must be true when present`);
        defaults += 1;
      }
      options.push({ label: o.label.trim(), ...(o.default === true ? { default: true as const } : {}) });
    }
    if (defaults !== 1) return bad(`exactly one option is the default (${defaults} are)`);
    out.push({ id: q.id, text: q.text.trim(), options, impact: q.impact.trim() });
  }
  return { ok: true, questions: out };
}

const hasAnswer = (q: Record<string, unknown>) => q.answer !== undefined && q.answer !== null && q.answer !== "";

/** Settled shape 4: the answers one owner comment carries — each `<id>: <option>` line whose id (case-insensitively)
 * is an open question (the option's label when it equals one, case-insensitively and trimmed, a copied `- ` bullet
 * and ` (default)` suffix ignored; else the text verbatim). A line whose text is the question's own `text` (trimmed,
 * case-insensitively) is the block comment's `<id>: <text>` header copied back, not an answer: ignored; so is an
 * `impact: <text>` line whose text is any open question's `impact` (the comment's `Impact: <impact>` line). */
export function parseAnswers(body: string, questions: readonly Record<string, unknown>[]): Record<string, string> {
  const open = new Map(questions.filter((q) => typeof q.id === "string" && !hasAnswer(q)).map((q) => [q.id as string, q]));
  const impacts = new Set([...open.values()].map((q) => (typeof q.impact === "string" ? q.impact.trim().toLowerCase() : null))
    .filter((i): i is string => i !== null && i !== ""));
  const answers: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const m = ANSWER_LINE_RE.exec(line);
    if (!m) continue;
    const id = m[1]!.toLowerCase();
    const q = open.get(id);
    if (!q) continue;
    const text = m[2]!;
    const folded = text.trim().toLowerCase();
    if (typeof q.text === "string" && q.text.trim().toLowerCase() === folded) continue; // a copied header
    if (id === "impact" && impacts.has(folded)) continue; // a copied `Impact: <impact>` line
    const bare = text.trim().replace(BULLET_RE, "").replace(DEFAULT_SUFFIX_RE, "").trim().toLowerCase();
    const options = Array.isArray(q.options) ? q.options : [];
    const label = options
      .map((o) => (isObject(o) && typeof o.label === "string" ? o.label : typeof o === "string" ? o : null))
      .find((l): l is string => l !== null && l.trim().toLowerCase() === bare);
    answers[id] = label ?? text;
  }
  return answers;
}

export interface QuestionsDeps extends WorktreeDeps {
  /** The clock (ISO stamps for the record and the events; default now). */
  now?: () => string;
  /** Tests: called between the pass's first read of a record and its fresh re-read before the write. */
  beforeWrite?: (root: string, engagement: string) => void;
}

export interface QuestionsResult { applied: string[]; skipped: string[]; blocked: string[]; answered: string[]; closed: string[] }

type Target = { root: string; engagement: string };

/** The in-process serialisation of the pass per served root: each root's work runs after the previous one for that
 * root settled, so two passes in one process never both see a block owed and both call `track.py`. It does not reach
 * across processes: the input route's `afterEngagementInput` runs in `serve`, the `finally` sites in separate
 * `run`/`recover`/`drain` processes. Across them `track.py`'s per-engagement `track.lock` keeps overlapping calls
 * apart (a lock held is a `retry: true`), and step 3 re-reads the `engagement-answers` events right before applying a
 * comment, so a comment another process already applied is skipped (a narrow window remains). */
const rootChains = new Map<string, Promise<void>>();
function serialised(root: string, fn: () => Promise<void>): Promise<void> {
  const next = (rootChains.get(root) ?? Promise.resolve()).then(fn).catch(() => { /* this root on the next pass */ });
  rootChains.set(root, next);
  void next.then(() => { if (rootChains.get(root) === next) rootChains.delete(root); });
  return next;
}

const nowIso = (deps: QuestionsDeps) => (deps.now ? deps.now() : new Date().toISOString());

/** The service events of `kind` for one engagement of one project. */
function eventsFor(queue: Queue, kind: string, project: string, engagement: string) {
  return queue.serviceEvents(kind).filter((e) => e.detail?.engagement === engagement && e.detail?.project === project);
}

/** Write a record transform on a fresh read (the `chatSpendPass` rule): `apply` runs on the record read right before
 * the atomic write, with no await between, so a change written since the first read survives. */
function writeFresh(root: string, id: string, deps: QuestionsDeps, apply: (fresh: Engagement) => Engagement | null): Engagement | null {
  deps.beforeWrite?.(root, id);
  const fresh = readEngagement(root, id);
  if (!fresh) return null;
  const next = apply(fresh);
  if (!next) return null;
  writeEngagement(root, next);
  return next;
}

/** A `track.py` verb on the host (as `closeout.ts` `trackBlock`): the parsed result, or null on a transient failure
 * (a spawn error, no JSON, `retry: true`). */
async function track(deps: QuestionsDeps, root: string, args: string[]): Promise<Record<string, any> | null> {
  let r: RunResult;
  try { r = await uvRunner(deps)(root, studioScript(deps, "lib", "track.py"), args, 120); } catch { return null; }
  const out = lastJsonObject(r.stdout) as Record<string, any> | null;
  if (!out || typeof out.status !== "string" || out.retry === true) return null;
  return out;
}

/** Step 1: apply the questions an ended chat run wrote (once per run id). */
function applyStep(queue: Queue, deps: QuestionsDeps, runId: string, t: Target, out: QuestionsResult): void {
  const run = queue.get(runId);
  if (!run || run.job_id !== ENGAGEMENT_CHAT_JOB || !isTerminal(run.state)) return;
  let text: string;
  try { text = readFileSync(questionsFile(t.root, t.engagement), "utf-8"); } catch { return; }
  let doc: unknown = null;
  try { doc = JSON.parse(text); } catch { /* invalid: skipped below */ }
  if (isObject(doc) && doc.run_id !== runId) return; // another run's file
  const record = readEngagement(t.root, t.engagement);
  if (!record) return;
  if (record.inputs.some((l) => l.verb === "questions" && l.run_id === runId)) return; // applied once
  const project = record.project;
  // an unreadable file names no run: skipped once per engagement and reason, not once per ended run
  const perFile = !isObject(doc);
  const skip = (reason: string) => {
    if (queue.serviceEvents("engagement-questions-skipped").some((e) => e.detail?.engagement === t.engagement && e.detail?.project === project
      && (perFile ? e.detail?.reason === reason : e.detail?.run_id === runId))) return;
    queue.serviceEvent("engagement-questions-skipped", { engagement: t.engagement, project, run_id: runId, reason });
    out.skipped.push(t.engagement);
  };
  if (!isObject(doc)) return skip("QuestionInvalid: questions.json is not a JSON object");
  const checked = checkQuestions(doc.questions);
  if (!checked.ok) return skip(checked.reason);
  if (record.state !== "intake") return skip(`NotIntake: ${t.engagement} is ${record.state}`);
  const at = nowIso(deps);
  const moved: { from?: EngagementState; to?: EngagementState; refused?: string } = {};
  const written = writeFresh(t.root, t.engagement, deps, (fresh) => {
    if (fresh.inputs.some((l) => l.verb === "questions" && l.run_id === runId)) return null;
    const applied = applyEvent(fresh, { event: "questions", detail: { questions: checked.questions }, at, run_id: runId });
    if (!applied.ok) { moved.refused = `${applied.error === "IllegalInput" ? "NotIntake" : applied.error}: ${t.engagement} is ${applied.state}`; return null; }
    moved.from = applied.from; moved.to = applied.to;
    // merge only this pass's fields onto the fresh record
    return { ...fresh, state: applied.record.state, questions: applied.record.questions, updated: applied.record.updated, inputs: applied.record.inputs };
  });
  if (moved.refused) return skip(moved.refused);
  if (!written) return;
  queue.serviceEvent("engagement", { id: t.engagement, project, state: moved.to, from: moved.from, verb: "questions", source: "planner" }, at);
  out.applied.push(t.engagement);
}

/** Story 32.6: an `engagement-issue` event's block kind — `questions` (this pass's; an event without `kind` is one),
 * `cap` or `ask` (the approve module's run pass, `track.py block --engagement --kind`). */
export const blockKind = (e: { detail: Record<string, unknown> | null }): string =>
  (typeof e.detail?.kind === "string" && e.detail.kind ? e.detail.kind : "questions");

/** A block-step event of this pass: a `questions` block, or its named `refused` (a close's `refused` carries `step:
 * "close"`). A `cap` or `ask` block is not this pass's (Story 32.6). */
const isBlockDone = (e: { detail: Record<string, unknown> | null }) =>
  blockKind(e) === "questions" && (e.detail?.action === "blocked" || (e.detail?.action === "refused" && e.detail?.step !== "close"));

/** Step 2: block the engagement's issue (`track.py block --engagement`). A refusal by name (`ok: false`, `blocked`:
 * `IssueCreateRefused`, a binding or owner gap) is one `engagement-issue {…, action: "refused", reason}` per reason
 * since a block was last owed (`blockOwedSince`), and owes no further call until a block is owed again. */
async function blockStep(queue: Queue, deps: QuestionsDeps, t: Target, record: Engagement, out: QuestionsResult): Promise<void> {
  const project = record.project;
  // stamped before the call: `track.py` reads the open questions before its Jira calls, so a partial answer written
  // while it runs (up to 120 s) is newer than this event and owes a corrected re-block on the next pass
  const at = nowIso(deps);
  const r = await track(deps, t.root, ["block", "--directory", t.root, "--engagement", t.engagement]);
  if (!r) return; // transient (retry: true, a spawn error, no JSON): nothing, the next pass calls again
  if (r.ok !== true) {
    if (r.status !== "blocked") return;
    const reason = typeof r.reason === "string" && r.reason !== "" ? r.reason : "track refused";
    const since = blockOwedSince(queue, record);
    const told = eventsFor(queue, "engagement-issue", project, t.engagement)
      .some((e) => isBlockDone(e) && e.detail?.action === "refused" && e.detail?.reason === reason && (!since || e.at >= since));
    if (!told) queue.serviceEvent("engagement-issue", { engagement: t.engagement, project, action: "refused", reason }, at);
    return;
  }
  const issue = Array.isArray(r.issues) && typeof r.issues[0]?.issue === "string" ? r.issues[0].issue : null;
  queue.serviceEvent("engagement-issue", { engagement: t.engagement, project, issue, action: "blocked", kind: "questions" }, at);
  out.blocked.push(t.engagement);
}

/** The stamp a block is owed since: the later of the record's last `questions` or partial `answer` line and the
 * newest `engagement-answers` event that applied nothing (`ids: []`: no parsed line, only oversize answers, or an
 * apply refused). A comment whose apply left questions open wrote a partial `answer` line, which owes it already. */
function blockOwedSince(queue: Queue, record: Engagement): string | undefined {
  const asked = record.inputs.findLast((l) => l.verb === "questions" || (l.verb === "answer" && l.to === "awaiting-answers"))?.at;
  const unanswered = eventsFor(queue, "engagement-answers", record.project, record.id)
    .filter((e) => Array.isArray(e.detail?.ids) && (e.detail.ids as unknown[]).length === 0).at(-1)?.at;
  if (!asked || !unanswered) return asked ?? unanswered;
  return unanswered > asked ? unanswered : asked;
}

/** Whether the issue owes a block: no `blocked` (or a block's named `refused`) event since `blockOwedSince`, so a
 * re-block a comment owed and `track.py` answered transient is called again on the next pass. */
function blockOwed(queue: Queue, record: Engagement): boolean {
  const since = blockOwedSince(queue, record);
  const done = eventsFor(queue, "engagement-issue", record.project, record.id).filter(isBlockDone).at(-1);
  if (!done) return true;
  return !!since && done.at < since;
}

/** Step 3: the owner's Jira answers. Answers whether the issue should be re-blocked. */
function jiraAnswersStep(queue: Queue, deps: QuestionsDeps, t: Target, record: Engagement, out: QuestionsResult): boolean {
  const item = readInbox(t.root).items.find((i) => i.engagement === t.engagement && typeof i.issue === "string");
  if (!item) return false;
  const comments = readComments(t.root, item.issue as string) ?? [];
  const named = () => new Set(eventsFor(queue, "engagement-answers", record.project, t.engagement).map((e) => String(e.detail?.comment)));
  const seen = named();
  // every owner comment no `engagement-answers` event names yet, in comment order — not only those after the newest
  // agent comment: a re-block's agent comment can land after an owner comment the previous sync did not carry yet.
  // An edited comment is a second line with the same id: its last line is the comment, handled once
  const latest = comments.filter((c, i) => !comments.slice(i + 1).some((d) => d.id === c.id));
  let reblock = false;
  for (const c of latest) {
    if (c.author !== "owner" || (c.update_author !== undefined && c.update_author !== null && c.update_author !== "owner")) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    // re-read right before the apply: another process (`serve`'s input hook, a `run`/`recover`/`drain` finally site)
    // may have applied this comment since the first read
    if (named().has(c.id)) continue;
    const current = readEngagement(t.root, t.engagement);
    if (!current || current.state !== "awaiting-answers") return false;
    const parsed = parseAnswers(c.body, current.questions);
    // the input route's typed-payload check, and each answer within its owner-text bound: an answer past either is
    // not applied, and the comment re-blocks
    const answers = Object.fromEntries(Object.entries(parsed).filter(([, v]) => Buffer.byteLength(v, "utf-8") <= REPLY_MAX_BYTES));
    if (Object.keys(answers).length < Object.keys(parsed).length) reblock = true;
    const ids = Object.keys(answers).length && checkInputBody({ verb: "answer", answers }).ok ? Object.keys(answers) : [];
    const at = nowIso(deps);
    if (!ids.length) {
      queue.serviceEvent("engagement-answers", { engagement: t.engagement, project: record.project, comment: c.id, ids: [] }, at);
      reblock = true;
      continue;
    }
    const moved: { from?: EngagementState; to?: EngagementState } = {};
    const written = writeFresh(t.root, t.engagement, deps, (fresh) => {
      const applied = applyInput(fresh, { verb: "answer", payload: { answers }, source: "supervisor", at });
      if (!applied.ok) return null;
      moved.from = applied.from; moved.to = applied.to;
      return { ...fresh, state: applied.record.state, questions: applied.record.questions, updated: applied.record.updated, inputs: applied.record.inputs };
    });
    if (!written) {
      // refused or vanished: the comment is consumed, nothing applied; the owner is told what is still open
      queue.serviceEvent("engagement-answers", { engagement: t.engagement, project: record.project, comment: c.id, ids: [] }, at);
      reblock = true;
      continue;
    }
    queue.serviceEvent("engagement-answers", { engagement: t.engagement, project: record.project, comment: c.id, ids }, at);
    queue.serviceEvent("engagement", { id: t.engagement, project: record.project, state: moved.to, from: moved.from, verb: "answer", source: "supervisor" }, at);
    out.answered.push(t.engagement);
    if (moved.to === "awaiting-answers") reblock = true;
    else return false;
  }
  return reblock;
}

/** Step 4: close the issue once the state left `awaiting-answers`. Owed for a record whose questions were asked (a
 * `questions` line) until a `closed` or a close's `refused` event follows its newest `blocked` one — with or without
 * a `blocked` event (a block can move the issue and still answer transient, recording none). A refusal by name
 * (`ok: false`, `blocked`: `NoIssue`, `NoTransition` (no transition to `Done`, or to `Block Resolved` from `Blocked`),
 * `EngagementNotFound`, a binding or owner gap) is one
 * `engagement-issue {…, action: "refused", step: "close", reason}` and owes no further call; a transient failure
 * emits nothing (the next pass calls again). Story 32.6: only a `questions` block is closed here — the newest `blocked`
 * counted is a `questions` one, and nothing is closed while the issue's newest block is a `cap` or `ask` one (the
 * same Jira issue, blocked for the owner's `go {cap}` or `continue`). */
async function closeStep(queue: Queue, deps: QuestionsDeps, t: Target, record: Engagement, out: QuestionsResult): Promise<void> {
  if (!record.inputs.some((l) => l.verb === "questions")) return;
  const issueEvents = eventsFor(queue, "engagement-issue", record.project, t.engagement);
  const newestBlock = issueEvents.findLast((e) => e.detail?.action === "blocked");
  if (newestBlock && blockKind(newestBlock) !== "questions") return;
  const lastBlocked = issueEvents.findLastIndex((e) => e.detail?.action === "blocked" && blockKind(e) === "questions");
  const settled = issueEvents.slice(lastBlocked + 1)
    .some((e) => e.detail?.action === "closed" || (e.detail?.action === "refused" && e.detail?.step === "close"));
  if (settled) return;
  const r = await track(deps, t.root, ["close", "--directory", t.root, "--engagement", t.engagement]);
  if (!r) return; // transient: nothing, the next pass calls again
  if (r.ok !== true) {
    if (r.status !== "blocked") return;
    const reason = typeof r.reason === "string" && r.reason !== "" ? r.reason : "track refused";
    queue.serviceEvent("engagement-issue", { engagement: t.engagement, project: record.project, action: "refused", step: "close", reason }, nowIso(deps));
    return;
  }
  const blockedIssue = lastBlocked >= 0 ? issueEvents[lastBlocked]!.detail?.issue ?? null : null;
  const issue = typeof r.issue === "string" ? r.issue : blockedIssue;
  queue.serviceEvent("engagement-issue", { engagement: t.engagement, project: record.project, issue, action: "closed" }, nowIso(deps));
  out.closed.push(t.engagement);
}

/** One engagement: steps 2 to 4 (step 1 runs per run, before). */
async function engagementSteps(queue: Queue, deps: QuestionsDeps, t: Target, out: QuestionsResult): Promise<void> {
  let record = readEngagement(t.root, t.engagement);
  if (!record) return;
  const bound = jiraBound(t.root);
  if (record.state === "awaiting-answers") {
    const tried = bound && blockOwed(queue, record);
    if (tried) await blockStep(queue, deps, t, record, out);
    const reblock = jiraAnswersStep(queue, deps, t, record, out);
    record = readEngagement(t.root, t.engagement) ?? record;
    if (record.state === "awaiting-answers") {
      // re-block once the owner's comment left questions open, or a block still owed; a block already tried in this
      // pass is not called again unless a comment re-blocks, and a re-block answered transient stays owed for the
      // next pass (`blockOwed`: its `ids: []` event or partial `answer` line is newer than any block event)
      if (bound && (reblock || (!tried && blockOwed(queue, record)))) await blockStep(queue, deps, t, record, out);
      return;
    }
  }
  if (bound) await closeStep(queue, deps, t, record, out);
}

/**
 * The questions pass (see the header). `only`: one engagement (the input route's), its chat runs' files included.
 * Never throws.
 */
export async function questionsPass(queue: Queue, deps: QuestionsDeps = {}, only?: Target): Promise<QuestionsResult> {
  const out: QuestionsResult = { applied: [], skipped: [], blocked: [], answered: [], closed: [] };
  try {
    const targets = new Map<string, Target & { runs: string[] }>();
    const key = (t: Target) => `${t.root}\u0000${t.engagement}`;
    if (only) targets.set(key(only), { ...only, runs: [] });
    for (const ev of queue.serviceEvents("chat-queued")) {
      const d = ev.detail ?? {};
      const runId = typeof d.run_id === "string" ? d.run_id : null;
      const engagement = typeof d.engagement === "string" ? d.engagement : null;
      if (!runId || !engagement) continue;
      // the served registry root the run's payload carries (as chatSpendPass reads it)
      const served = queue.runPayload(runId)?.project_root;
      const root = typeof served === "string" && served !== "" ? served : queue.get(runId)?.root;
      if (!root) continue;
      const t = { root, engagement };
      if (only && key(t) !== key(only)) continue;
      const g = targets.get(key(t)) ?? { ...t, runs: [] };
      g.runs.push(runId);
      targets.set(key(t), g);
    }
    for (const t of targets.values()) {
      await serialised(t.root, async () => {
        try {
          for (const runId of t.runs) {
            try { applyStep(queue, deps, runId, t, out); } catch { /* this run on the next pass */ }
          }
          await engagementSteps(queue, deps, t, out);
        } catch { /* this engagement on the next pass */ }
      });
    }
  } catch { /* the next pass */ }
  return out;
}
