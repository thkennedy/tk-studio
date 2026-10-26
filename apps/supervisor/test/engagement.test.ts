// Story 32.1: the engagement record and its states — the one transition table row by row (every `(state, verb)` cell,
// every event row, every refusal), the typed payloads, the title, the id minted from the plan counter (and read back
// by `plansync.py`'s own reader), the record files and the chat pointer. Pure functions first; the files in temp roots.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  applyEvent, applyInput, chatPointer, checkCreateBody, checkInputBody, COUNTER_REL, ENGAGEMENT_EVENTS, ENGAGEMENT_STATES, ENGAGEMENTS_REL,
  EngagementCounterInvalid, engagementPath, EngagementRecordInvalid, INPUT_VERBS, listEngagements, mintEngagementId, needsYou, newEngagement,
  readEngagement, TERMINAL_STATES, titleOf, TRANSITIONS, writeEngagement, type Engagement, type EngagementState, type InputVerb,
} from "../src/engagement";

const AT = "2026-10-25T04:00:00.000Z";
const LIB = resolve(import.meta.dir, "..", "..", "..", "plugins", "tk-studio", "lib");
const made: string[] = [];
const tempRoot = () => { const d = mkdtempSync(join(tmpdir(), "tk-sup-engagement-")); made.push(d); return d; };
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const QUESTIONS = [
  { id: "q1", text: "Which database?", options: ["sqlite", "postgres"], default: "sqlite", impact: "storage" },
  { id: "q2", text: "Which auth?", options: [{ label: "token" }, { label: "oauth", default: true }], impact: "sign-in" },
];
const QUOTE = { band50: 100, band85: 150, band95: 200, cap: 250, basis: "history", computed_at: AT };

/** A record in `state`: the questions seeded, a quote from `quoted` on (none in `scoping` unless asked). */
function inState(state: EngagementState, o: { quote?: boolean } = {}): Engagement {
  const withQuote = o.quote ?? !["intake", "awaiting-answers", "scoping"].includes(state);
  return {
    ...newEngagement("ENG-001", "p", "Build the thing\nwith details", "2026-10-25T03:00:00.000Z"),
    state, questions: QUESTIONS.map((q) => ({ ...q })), quote: withQuote ? { ...QUOTE } : null,
  };
}

const PAYLOAD: Readonly<Record<InputVerb, Record<string, unknown>>> = {
  answer: { answers: { q1: "postgres" } }, go: {}, revise: { body: "narrow it" }, question: { text: "why?" },
  approve: { autonomy: "steady" }, cancel: {},
};

/** The expected outcome of each open `(state, verb)` cell with the `inState` fixture: the state moved to, or 409. */
const CELLS: Readonly<Record<string, Readonly<Record<InputVerb, EngagementState | 409>>>> = {
  intake: { answer: 409, go: "scoping", revise: 409, question: "intake", approve: 409, cancel: "cancelled" },
  "awaiting-answers": { answer: "awaiting-answers", go: "scoping", revise: 409, question: "awaiting-answers", approve: 409, cancel: "cancelled" },
  scoping: { answer: 409, go: 409, revise: "scoping", question: "scoping", approve: 409, cancel: "cancelled" },
  quoted: { answer: 409, go: 409, revise: "scoping", question: "quoted", approve: "approved", cancel: "cancelled" },
  approved: { answer: 409, go: 409, revise: "scoping", question: "approved", approve: 409, cancel: "cancelled" },
  "in-progress": { answer: 409, go: 409, revise: "scoping", question: "in-progress", approve: 409, cancel: "cancelled" },
  paused: { answer: 409, go: 409, revise: "scoping", question: "paused", approve: 409, cancel: "cancelled" },
  partial: { answer: 409, go: "in-progress", revise: "scoping", question: "partial", approve: 409, cancel: "cancelled" },
};

describe("the vocabulary", () => {
  test("the eleven states, the six verbs, the event rows, the three terminal states", () => {
    expect([...ENGAGEMENT_STATES]).toEqual(["intake", "awaiting-answers", "scoping", "quoted", "approved", "in-progress", "delivered", "paused", "failed", "partial", "cancelled"]);
    expect([...INPUT_VERBS]).toEqual(["answer", "go", "revise", "question", "approve", "cancel"]);
    expect([...ENGAGEMENT_EVENTS]).toEqual(["questions", "launched", "run-paused", "run-resumed", "cap", "run-ended"]);
    expect([...TERMINAL_STATES].sort()).toEqual(["cancelled", "delivered", "failed"]);
  });

  test("TRANSITIONS is exactly the plan's table, row by row", () => {
    const rows: unknown[][] = TRANSITIONS.map((r) => [r.from, r.verb ?? `event:${r.event}`, r.to, r.guard ?? null, r.effect ?? null, r.source ?? null]);
    const open = ["intake", "awaiting-answers", "scoping", "quoted", "approved", "in-progress", "paused", "partial"];
    expect(rows).toEqual([
      ["intake", "go", "scoping", null, null, null],
      ["intake", "event:questions", "awaiting-answers", null, "set-questions", "planner"],
      ["awaiting-answers", "answer", "scoping", "every-question-answered", "record-answers", null],
      ["awaiting-answers", "answer", "awaiting-answers", null, "record-answers", null],
      ["awaiting-answers", "go", "scoping", null, "assume-defaults", null],
      ["scoping", "go", "quoted", "quote-present", null, null],
      ["scoping", "revise", "scoping", null, null, null],
      ["quoted", "revise", "scoping", null, "void-quote", null],
      ["quoted", "approve", "approved", null, "record-approval", null],
      ["approved", "revise", "scoping", null, "void-quote", null],
      ["approved", "event:launched", "in-progress", null, null, null],
      ["in-progress", "revise", "scoping", null, "void-quote", null],
      ["in-progress", "event:run-paused", "paused", null, null, null],
      ["in-progress", "event:cap", "partial", null, null, null],
      ["in-progress", "event:run-ended", "delivered", "outcome-delivered", null, null],
      ["in-progress", "event:run-ended", "partial", "outcome-partial", null, null],
      ["in-progress", "event:run-ended", "failed", "outcome-failed", null, null],
      ["paused", "revise", "scoping", null, "void-quote", null],
      ["paused", "event:run-resumed", "in-progress", null, null, null],
      ["partial", "go", "in-progress", null, "raise-cap", null],
      ["partial", "revise", "scoping", null, "void-quote", null],
      ["partial", "event:run-ended", "delivered", "outcome-delivered", null, null],
      ["partial", "event:run-ended", "partial", "outcome-partial", null, null],
      ["partial", "event:run-ended", "failed", "outcome-failed", null, null],
      ...open.map((s) => [s, "question", s, null, null, null]),
      ...open.map((s) => [s, "cancel", "cancelled", null, null, null]),
    ]);
    for (const r of TRANSITIONS) expect(TERMINAL_STATES.has(r.from)).toBe(false);
  });
});

describe("applyInput: every (state, verb) cell", () => {
  for (const [state, cells] of Object.entries(CELLS)) {
    for (const verb of INPUT_VERBS) {
      const want = cells[verb];
      test(`${state} + ${verb} → ${want === 409 ? "409 IllegalInput" : want}`, () => {
        const record = inState(state as EngagementState);
        const before = JSON.stringify(record);
        const r = applyInput(record, { verb, payload: PAYLOAD[verb], source: "bearer", at: AT });
        expect(JSON.stringify(record)).toBe(before); // pure: the input record is never touched
        if (want === 409) {
          expect(r).toMatchObject({ ok: false, error: "IllegalInput", state, verb });
          return;
        }
        if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
        expect(r.from).toBe(state as EngagementState);
        expect(r.to).toBe(want);
        expect(r.record.state).toBe(want);
        expect(r.record.updated).toBe(AT);
        expect(r.record.created).toBe(record.created);
        const payload = PAYLOAD[verb];
        expect(r.record.inputs as unknown[]).toEqual([{ at: AT, verb, source: "bearer", ...(Object.keys(payload).length ? { payload } : {}), from: state, to: want }]);
      });
    }
  }

  for (const state of ["delivered", "failed", "cancelled"] as const) {
    test(`${state}: every verb is 409 EngagementClosed and moves nothing`, () => {
      for (const verb of INPUT_VERBS) {
        const record = inState(state);
        const r = applyInput(record, { verb, payload: PAYLOAD[verb], source: "cookie", at: AT });
        expect(r).toEqual({ ok: false, error: "EngagementClosed", state, verb });
        expect(record.state).toBe(state);
        expect(record.inputs).toEqual([]);
      }
    });
  }

  test("every open cell is covered by CELLS (the eight open states, six verbs each)", () => {
    expect(Object.keys(CELLS).sort()).toEqual(ENGAGEMENT_STATES.filter((s) => !TERMINAL_STATES.has(s)).sort());
  });
});

describe("applyInput: the guarded cells and the effects", () => {
  test("scoping + go: → quoted only with a quote; with none 409 IllegalInput detail \"no quote\"", () => {
    expect(applyInput(inState("scoping"), { verb: "go", source: "bearer", at: AT })).toEqual({ ok: false, error: "IllegalInput", state: "scoping", verb: "go", detail: "no quote" });
    const r = applyInput(inState("scoping", { quote: true }), { verb: "go", source: "bearer", at: AT });
    expect(r).toMatchObject({ ok: true, from: "scoping", to: "quoted" });
    if (r.ok) expect(r.record.quote).toEqual(QUOTE);
  });

  test("awaiting-answers + answer: a partial answer stays, the answers recorded; the last one moves to scoping", () => {
    const first = applyInput(inState("awaiting-answers"), { verb: "answer", payload: { answers: { q1: "postgres" } }, source: "bearer", at: AT });
    if (!first.ok) throw new Error("refused");
    expect(first.to).toBe("awaiting-answers");
    expect(first.record.questions.map((q) => q.answer ?? null)).toEqual(["postgres", null]);
    const second = applyInput(first.record, { verb: "answer", payload: { answers: { q2: "a free-text answer, kept verbatim" } }, source: "cookie", at: "2026-10-25T05:00:00.000Z" });
    if (!second.ok) throw new Error("refused");
    expect(second).toMatchObject({ from: "awaiting-answers", to: "scoping" });
    expect(second.record.questions.map((q) => q.answer)).toEqual(["postgres", "a free-text answer, kept verbatim"]);
    expect(second.record.inputs.map((l) => [l.verb, l.source, l.from, l.to])).toEqual([
      ["answer", "bearer", "awaiting-answers", "awaiting-answers"], ["answer", "cookie", "awaiting-answers", "scoping"],
    ]);
    const both = applyInput(inState("awaiting-answers"), { verb: "answer", payload: { answers: { q1: "sqlite", q2: "token" } }, source: "bearer", at: AT });
    expect(both).toMatchObject({ ok: true, to: "scoping" });
  });

  test("an answer naming a question id not in questions[] is SchemaError, nothing moved", () => {
    const record = inState("awaiting-answers");
    expect(applyInput(record, { verb: "answer", payload: { answers: { q1: "sqlite", q9: "x" } }, source: "bearer", at: AT }))
      .toEqual({ ok: false, error: "SchemaError", state: "awaiting-answers", verb: "answer", detail: "unknown question id q9" });
    expect(record.questions.every((q) => !("answer" in q))).toBe(true);
  });

  test("awaiting-answers + go: each unanswered question's default becomes a stated assumption", () => {
    const answered = applyInput(inState("awaiting-answers"), { verb: "answer", payload: { answers: { q1: "postgres" } }, source: "bearer", at: AT });
    if (!answered.ok) throw new Error("refused");
    const r = applyInput(answered.record, { verb: "go", source: "bearer", at: AT });
    if (!r.ok) throw new Error("refused");
    expect(r.to).toBe("scoping");
    expect(r.record.assumptions).toEqual([{ question: "q2", text: "Which auth?", assumed: "oauth" }]);
    const none = applyInput(inState("awaiting-answers"), { verb: "go", source: "bearer", at: AT });
    if (!none.ok) throw new Error("refused");
    expect(none.record.assumptions).toEqual([
      { question: "q1", text: "Which database?", assumed: "sqlite" }, { question: "q2", text: "Which auth?", assumed: "oauth" },
    ]);
  });

  test("revise voids the quote from quoted, approved, in-progress, paused and partial; in scoping it stays", () => {
    for (const state of ["quoted", "approved", "in-progress", "paused", "partial"] as const) {
      const r = applyInput(inState(state), { verb: "revise", payload: { body: "smaller" }, source: "bearer", at: AT });
      if (!r.ok) throw new Error(`${state} refused`);
      expect(r.to).toBe("scoping");
      expect(r.record.quote).toBeNull();
    }
    const r = applyInput(inState("scoping", { quote: true }), { verb: "revise", source: "bearer", at: AT });
    if (!r.ok) throw new Error("refused");
    expect(r.to).toBe("scoping");
    expect(r.record.quote).toEqual(QUOTE); // 32.4 replaces the scope; the table moves nothing here
  });

  test("approve records autonomy and approved_at; base_ref rides the input line only", () => {
    const r = applyInput(inState("quoted"), { verb: "approve", payload: { autonomy: "full", base_ref: "main" }, source: "cookie", at: AT });
    if (!r.ok) throw new Error("refused");
    expect(r.record).toMatchObject({ state: "approved", autonomy: "full", approved_at: AT });
    expect(r.record.inputs.at(-1)).toEqual({ at: AT, verb: "approve", source: "cookie", payload: { autonomy: "full", base_ref: "main" }, from: "quoted", to: "approved" });
  });

  test("partial + go {cap}: the cap lands on quote.cap when a quote exists, else on the input only", () => {
    const r = applyInput(inState("partial"), { verb: "go", payload: { cap: 400 }, source: "bearer", at: AT });
    if (!r.ok) throw new Error("refused");
    expect(r.to).toBe("in-progress");
    expect(r.record.quote).toEqual({ ...QUOTE, cap: 400 });
    const bare = applyInput(inState("partial", { quote: false }), { verb: "go", payload: { cap: 400 }, source: "bearer", at: AT });
    if (!bare.ok) throw new Error("refused");
    expect(bare.record.quote).toBeNull();
    expect(bare.record.inputs.at(-1)?.payload).toEqual({ cap: 400 });
  });

  test("partial + go {cap} on a record with no quote key: in-progress, and no {cap} quote is created", () => {
    const { quote: _absent, ...rest } = inState("partial");
    const r = applyInput(rest as Engagement, { verb: "go", payload: { cap: 50 }, source: "bearer", at: AT });
    if (!r.ok) throw new Error("refused");
    expect(r.to).toBe("in-progress");
    expect(r.record.quote ?? null).toBeNull();
    expect(r.record.inputs.at(-1)?.payload).toEqual({ cap: 50 });
  });

  test("the owner's question moves nothing in every open state and is still logged", () => {
    for (const state of Object.keys(CELLS) as EngagementState[]) {
      const r = applyInput(inState(state), { verb: "question", payload: { text: "status?" }, source: "cookie", at: AT });
      if (!r.ok) throw new Error(`${state} refused`);
      expect(r.from).toBe(state);
      expect(r.to).toBe(state);
      expect(r.record.inputs).toHaveLength(1);
    }
  });

  test("a run id is logged when given (the planner's exception, 32.3)", () => {
    const r = applyInput(inState("intake"), { verb: "question", payload: { text: "?" }, source: "planner", at: AT, run_id: "r-9" });
    if (!r.ok) throw new Error("refused");
    expect(r.record.inputs[0]).toEqual({ at: AT, verb: "question", source: "planner", payload: { text: "?" }, from: "intake", to: "intake", run_id: "r-9" });
  });
});

describe("applyEvent: the event rows (Settled shape 4)", () => {
  const cases: [EngagementState, typeof ENGAGEMENT_EVENTS[number], Record<string, unknown>, EngagementState][] = [
    ["approved", "launched", { run_id: "r-1" }, "in-progress"],
    ["in-progress", "run-paused", {}, "paused"],
    ["in-progress", "cap", { spent: 251 }, "partial"],
    ["in-progress", "run-ended", { outcome: "delivered" }, "delivered"],
    ["in-progress", "run-ended", { outcome: "partial" }, "partial"],
    ["in-progress", "run-ended", { outcome: "failed" }, "failed"],
    ["paused", "run-resumed", {}, "in-progress"],
    ["partial", "run-ended", { outcome: "delivered" }, "delivered"],
    ["partial", "run-ended", { outcome: "partial" }, "partial"],
    ["partial", "run-ended", { outcome: "failed" }, "failed"],
  ];
  for (const [from, event, detail, to] of cases) {
    test(`${from} + ${event} ${JSON.stringify(detail)} → ${to}, logged with source supervisor`, () => {
      const r = applyEvent(inState(from), { event, detail, at: AT });
      if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
      expect(r).toMatchObject({ from, to });
      expect(r.record.state).toBe(to);
      expect(r.record.inputs as unknown[]).toEqual([{ at: AT, verb: event, source: "supervisor", from, to, detail, ...(detail.run_id ? { run_id: detail.run_id } : {}) }]);
    });
  }

  test("intake + questions (the planner's, with its run id) → awaiting-answers, questions[] filled", () => {
    const r = applyEvent({ ...inState("intake"), questions: [] }, { event: "questions", detail: { questions: QUESTIONS }, at: AT, run_id: "chat-1" });
    if (!r.ok) throw new Error("refused");
    expect(r.to).toBe("awaiting-answers");
    expect(r.record.questions).toEqual(QUESTIONS);
    expect(r.record.inputs[0]).toMatchObject({ verb: "questions", source: "planner", run_id: "chat-1", from: "intake", to: "awaiting-answers" });
  });

  test("intake + questions: an entry with no id (or a non-mapping) is never stored; the written record reads back cleanly", () => {
    const given = [...QUESTIONS, { text: "no id here" }, { id: "  ", text: "a blank id" }, null, "a string"];
    const r = applyEvent({ ...inState("intake"), questions: [] }, { event: "questions", detail: { questions: given }, at: AT, run_id: "chat-1" });
    if (!r.ok) throw new Error("refused");
    expect(r.to).toBe("awaiting-answers");
    expect(r.record.questions).toEqual(QUESTIONS);
    const root = tempRoot();
    writeEngagement(root, r.record);
    expect(readEngagement(root, r.record.id)).toEqual(r.record);
  });

  test("an event with no row is 409 IllegalInput; a run-ended with no known outcome too; a terminal state EngagementClosed", () => {
    expect(applyEvent(inState("intake"), { event: "launched", at: AT })).toEqual({ ok: false, error: "IllegalInput", state: "intake", verb: "launched" });
    expect(applyEvent(inState("quoted"), { event: "run-ended", detail: { outcome: "delivered" }, at: AT })).toMatchObject({ ok: false, error: "IllegalInput" });
    expect(applyEvent(inState("in-progress"), { event: "run-ended", detail: { outcome: "weird" }, at: AT })).toMatchObject({ ok: false, error: "IllegalInput", state: "in-progress", verb: "run-ended" });
    for (const state of ["delivered", "failed", "cancelled"] as const) {
      for (const event of ENGAGEMENT_EVENTS) {
        expect(applyEvent(inState(state), { event, at: AT })).toEqual({ ok: false, error: "EngagementClosed", state, verb: event });
      }
    }
  });
});

describe("checkInputBody: the typed payload per verb", () => {
  const ok = (raw: unknown) => { const r = checkInputBody(raw); if (!r.ok) throw new Error(r.detail); return r.body; };
  const refused = (raw: unknown, detail: string | RegExp) => {
    const r = checkInputBody(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(detail);
  };

  test("the good bodies, each verb's payload carried without `verb`", () => {
    expect(ok({ verb: "answer", answers: { q1: "a" } })).toEqual({ verb: "answer", payload: { answers: { q1: "a" } } });
    expect(ok({ verb: "go" })).toEqual({ verb: "go", payload: {} });
    expect(ok({ verb: "go", cap: 12.5 })).toEqual({ verb: "go", payload: { cap: 12.5 } });
    expect(ok({ verb: "revise" })).toEqual({ verb: "revise", payload: {} });
    expect(ok({ verb: "revise", body: "x" })).toEqual({ verb: "revise", payload: { body: "x" } });
    expect(ok({ verb: "question", text: "why?" })).toEqual({ verb: "question", payload: { text: "why?" } });
    for (const autonomy of ["ask", "steady", "full"]) expect(ok({ verb: "approve", autonomy })).toEqual({ verb: "approve", payload: { autonomy } });
    expect(ok({ verb: "approve", autonomy: "ask", base_ref: "feat/x" })).toEqual({ verb: "approve", payload: { autonomy: "ask", base_ref: "feat/x" } });
    expect(ok({ verb: "cancel" })).toEqual({ verb: "cancel", payload: {} });
    expect(ok({ verb: "cancel", reason: "changed my mind" })).toEqual({ verb: "cancel", payload: { reason: "changed my mind" } });
  });

  test("not an object, no verb, an unknown verb", () => {
    for (const raw of [null, [], "go", 3]) refused(raw, "the body must be a JSON object");
    refused({}, "missing field 'verb'");
    refused({ verb: "launch" }, /^unknown verb "launch"/);
    refused({ verb: "questions" }, /^unknown verb/);
    refused({ verb: 7 }, /^unknown verb/);
  });

  test("a missing required field", () => {
    refused({ verb: "answer" }, "missing field 'answers' for verb 'answer'");
    refused({ verb: "question" }, "missing field 'text' for verb 'question'");
    refused({ verb: "approve" }, "missing field 'autonomy' for verb 'approve'");
  });

  test("an extra field: every verb, and the planner's `{questions[], run_id}` shape never over HTTP", () => {
    for (const verb of INPUT_VERBS) refused({ verb, ...PAYLOAD[verb], project: "p" }, `unknown field 'project' for verb '${verb}'`);
    refused({ verb: "question", text: "?", questions: [], run_id: "r" }, "unknown field 'questions' for verb 'question'");
    refused({ verb: "question", questions: [{ id: "q1" }], run_id: "r" }, /unknown field 'questions'/);
    refused({ verb: "go", cap: 1, answers: {} }, "unknown field 'answers' for verb 'go'");
  });

  test("a wrong type or an empty value", () => {
    refused({ verb: "answer", answers: {} }, /non-empty object/);
    refused({ verb: "answer", answers: ["a"] }, /non-empty object/);
    refused({ verb: "answer", answers: { q1: "" } }, "field 'answers.q1' must be a non-empty string");
    refused({ verb: "answer", answers: { q1: 2 } }, "field 'answers.q1' must be a non-empty string");
    for (const cap of [0, -1, "5", Number.POSITIVE_INFINITY, null]) refused({ verb: "go", cap }, "field 'cap' must be a number > 0");
    refused({ verb: "revise", body: "" }, "field 'body' must be a non-empty string");
    refused({ verb: "revise", body: 3 }, "field 'body' must be a non-empty string");
    refused({ verb: "question", text: "  " }, "field 'text' must be a non-empty string");
    refused({ verb: "approve", autonomy: "yolo" }, "field 'autonomy' must be one of ask, steady, full");
    refused({ verb: "approve", autonomy: "ask", base_ref: "" }, "field 'base_ref' must be a non-empty string");
    refused({ verb: "cancel", reason: 1 }, "field 'reason' must be a non-empty string");
  });

  test("a revise body over 32 KiB (UTF-8) is refused; exactly 32 KiB passes", () => {
    expect(checkInputBody({ verb: "revise", body: "x".repeat(32 * 1024) }).ok).toBe(true);
    refused({ verb: "revise", body: "x".repeat(32 * 1024 + 1) }, "field 'body' exceeds 32768 bytes (UTF-8)");
    refused({ verb: "revise", body: "é".repeat(16 * 1024 + 1) }, /exceeds 32768 bytes/);
  });
});

describe("checkCreateBody", () => {
  test("{project, request, follows?}: both non-empty strings, no other field (Story 32.8: `follows`), request at most 32 KiB", () => {
    expect(checkCreateBody({ project: " p ", request: "Do it\n" })).toEqual({ ok: true, body: { project: "p", request: "Do it\n" } });
    for (const [raw, detail] of [
      [null, "the body must be a JSON object"], [{ project: "p" }, "field 'request' must be a non-empty string"],
      [{ request: "x" }, "field 'project' must be a non-empty string"], [{ project: "p", request: " " }, "field 'request' must be a non-empty string"],
      [{ project: "p", request: "x", other: 1 }, "unknown field 'other' (allowed: project, request, follows)"],
      [{ project: "p", request: "x".repeat(32 * 1024 + 1) }, "field 'request' exceeds 32768 bytes (UTF-8)"],
    ] as const) expect(checkCreateBody(raw)).toEqual({ ok: false, detail });
  });
});

describe("Story 32.8: follows and the three mid-run inputs", () => {
  test("follows: an engagement id is accepted and carried by the new record; anything else is a SchemaError detail", () => {
    expect(checkCreateBody({ project: "p", request: "Change it", follows: "ENG-001" })).toEqual({ ok: true, body: { project: "p", request: "Change it", follows: "ENG-001" } });
    for (const follows of ["ENG-1", "eng-001", "", 7, null, ["ENG-001"], " ENG-001"]) {
      expect(checkCreateBody({ project: "p", request: "x", follows })).toEqual({ ok: false, detail: "field 'follows' must be an engagement id (ENG-001)" });
    }
    expect(newEngagement("ENG-002", "p", "Change it", AT, "ENG-001").follows).toBe("ENG-001");
    expect("follows" in newEngagement("ENG-002", "p", "Change it", AT)).toBe(false);
  });

  test("question: a self-loop in every live state, logged {verb, payload {text}, source}, nothing else moved", () => {
    for (const state of ["in-progress", "paused", "partial", "approved"] as EngagementState[]) {
      const before = inState(state);
      const r = applyInput(before, { verb: "question", payload: { text: "how far along?" }, source: "bearer", at: AT });
      if (!r.ok) throw new Error(`${state} refused`);
      expect(r.to).toBe(state);
      expect(r.record.inputs).toEqual([{ at: AT, verb: "question", source: "bearer", payload: { text: "how far along?" }, from: state, to: state }]);
      expect({ ...r.record, inputs: [], updated: before.updated }).toEqual({ ...before, inputs: [] });
    }
  });

  test("revise mid-run: in-progress, paused and partial go back to scoping with the quote voided", () => {
    for (const state of ["in-progress", "paused", "partial"] as EngagementState[]) {
      const r = applyInput(inState(state), { verb: "revise", payload: { body: "narrow it" }, source: "cookie", at: AT });
      if (!r.ok) throw new Error(`${state} refused`);
      expect([r.from, r.to, r.record.quote]).toEqual([state, "scoping", null]);
    }
  });

  test("go past a cap (partial → in-progress, raise-cap) and past open questions (awaiting-answers → scoping, assume-defaults)", () => {
    const capped = applyInput(inState("partial"), { verb: "go", payload: { cap: 400 }, source: "bearer", at: AT });
    if (!capped.ok) throw new Error("refused");
    expect([capped.to, capped.record.quote?.cap]).toEqual(["in-progress", 400]);
    const asked = applyInput(inState("awaiting-answers"), { verb: "go", source: "bearer", at: AT });
    if (!asked.ok) throw new Error("refused");
    expect(asked.to).toBe("scoping");
    expect(asked.record.assumptions.map((a) => a.question)).toEqual(["q1", "q2"]);
  });

  test("run-ended from in-progress and from partial moves per its outcome; a delivered record takes no further input", () => {
    for (const from of ["in-progress", "partial"] as EngagementState[]) {
      for (const outcome of ["delivered", "partial", "failed"]) {
        const r = applyEvent(inState(from), { event: "run-ended", detail: { outcome, run_id: "q-1", closeout: "_bmad-output/engagements/ENG-001/closeout.md" }, at: AT });
        if (!r.ok) throw new Error(`${from} ${outcome} refused`);
        expect(r.to).toBe(outcome as EngagementState);
        expect(r.record.inputs.at(-1)).toMatchObject({ verb: "run-ended", source: "supervisor", run_id: "q-1", detail: { outcome } });
      }
    }
    expect(applyEvent(inState("paused"), { event: "run-ended", detail: { outcome: "partial" }, at: AT })).toMatchObject({ ok: false, error: "IllegalInput" });
    expect(applyInput(inState("delivered"), { verb: "question", payload: { text: "?" }, source: "bearer", at: AT })).toMatchObject({ ok: false, error: "EngagementClosed" });
  });
});

describe("titleOf and needsYou", () => {
  test("the first non-empty line, trimmed, at most 80 code points (multi-byte counted as one)", () => {
    expect(titleOf("Build the thing\nwith details")).toBe("Build the thing");
    expect(titleOf("\n\n   \r\n  Second paragraph first  \r\nmore")).toBe("Second paragraph first");
    expect(titleOf("x".repeat(100))).toBe("x".repeat(80));
    const wide = "漢".repeat(90);
    expect(titleOf(wide)).toBe("漢".repeat(80));
    expect(Array.from(titleOf("é".repeat(81) + "\nz"))).toHaveLength(80);
    expect(titleOf("")).toBe("");
  });

  test("needs_you: awaiting-answers and quoted only", () => {
    expect(ENGAGEMENT_STATES.filter(needsYou)).toEqual(["awaiting-answers", "quoted"]);
  });
});

describe("mintEngagementId: the plan counter's engagement series", () => {
  const counterOf = (root: string) => loadYaml(readFileSync(join(root, COUNTER_REL), "utf-8")) as Record<string, any>;

  test("no counter: ENG-001, the counter written with plansync's defaults plus next.engagement 2", () => {
    const root = tempRoot();
    expect(mintEngagementId(root)).toBe("ENG-001");
    expect(counterOf(root)).toEqual({ counter_version: 1, next: { epic: 1, story: 1, task: 1, engagement: 2 } });
    expect(mintEngagementId(root)).toBe("ENG-002");
    expect(counterOf(root).next.engagement).toBe(3);
  });

  test("an existing counter: every other key and counter_version preserved, the series grows past 999", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".tk-studio"));
    writeFileSync(join(root, COUNTER_REL), "counter_version: 1\nnext:\n  epic: 33\n  story: 130\n  task: 1\n");
    expect(mintEngagementId(root)).toBe("ENG-001");
    expect(counterOf(root)).toEqual({ counter_version: 1, next: { epic: 33, story: 130, task: 1, engagement: 2 } });
    expect(readFileSync(join(root, COUNTER_REL), "utf-8")).toBe("counter_version: 1\nnext:\n  epic: 33\n  story: 130\n  task: 1\n  engagement: 2\n");
    writeFileSync(join(root, COUNTER_REL), "counter_version: 1\nnext:\n  epic: 33\n  story: 130\n  task: 1\n  engagement: 1000\n");
    expect(mintEngagementId(root)).toBe("ENG-1000");
  });

  test("an id whose directory exists is skipped, never reused", () => {
    const root = tempRoot();
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-001"), { recursive: true });
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-002"), { recursive: true });
    expect(mintEngagementId(root)).toBe("ENG-003");
    expect(counterOf(root).next.engagement).toBe(4);
  });

  test("the counter lands before the record: after the mint the counter is saved and no record exists yet", () => {
    const root = tempRoot();
    const id = mintEngagementId(root);
    expect(counterOf(root).next.engagement).toBe(2);
    expect(existsSync(join(root, ENGAGEMENTS_REL, id))).toBe(false);
  });

  test("a counter that is not a mapping, or a next.engagement that is not an int >= 1, is EngagementCounterInvalid", () => {
    for (const text of ["- a\n- b\n", "counter_version: 1\nnext:\n  epic: 1\n  story: 1\n  task: 1\n  engagement: 0\n", "counter_version: 1\nnext:\n  engagement: two\n", "{ bad"]) {
      const root = tempRoot();
      mkdirSync(join(root, ".tk-studio"));
      writeFileSync(join(root, COUNTER_REL), text);
      expect(() => mintEngagementId(root)).toThrow(EngagementCounterInvalid);
      expect(readFileSync(join(root, COUNTER_REL), "utf-8")).toBe(text); // untouched
    }
  });

  // The written counter read back by `plansync.py`'s own `load_counter` (miniyaml): it parses and epic, story and task
  // are unchanged. Needs a Python 3 on PATH (the studio's lib is stdlib-only).
  const python = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf-8" }).status === 0);
  test.skipIf(!python)("plansync.py's load_counter reads the written counter: epic, story and task unchanged", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".tk-studio"));
    writeFileSync(join(root, COUNTER_REL), "counter_version: 1\nnext:\n  epic: 33\n  story: 130\n  task: 7\n");
    mintEngagementId(root);
    mintEngagementId(root);
    const script = "import sys, json\nsys.path.insert(0, sys.argv[1])\nimport plansync\nprint(json.dumps(plansync.load_counter(sys.argv[2])))";
    const res = spawnSync(python!, ["-c", script, LIB, root], { encoding: "utf-8" });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ counter_version: 1, next: { epic: 33, story: 130, task: 7, engagement: 3 } });
  });
});

describe("the record files", () => {
  const record = (id: string, created: string, state: EngagementState = "intake") => ({ ...newEngagement(id, "p", `Request ${id}`, created), state });

  test("write then read: the same record, shape_version 1, every §7.1 field; the write leaves no temp file", () => {
    const root = tempRoot();
    const r = { ...record("ENG-001", AT), request: "multi\nline: with: colons\n", questions: QUESTIONS.map((q) => ({ ...q })) };
    writeEngagement(root, r);
    expect(readEngagement(root, "ENG-001")).toEqual(r);
    const doc = loadYaml(readFileSync(engagementPath(root, "ENG-001"), "utf-8")) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual([
      "shape_version", "id", "project", "state", "request", "questions", "assumptions", "scope_page", "quote", "autonomy", "approved_at", "closeout",
      "created", "updated", "spend", "inputs",
    ]);
    expect(doc.spend).toEqual({ planning_usd: 0, runs_usd: 0 });
    expect(typeof doc.created).toBe("string"); // never a YAML timestamp read back as a Date
    expect(readdirSync(join(root, ENGAGEMENTS_REL, "ENG-001"))).toEqual(["engagement.yaml"]);
    writeEngagement(root, { ...r, state: "scoping" });
    expect(readEngagement(root, "ENG-001")?.state).toBe("scoping");
    expect(readdirSync(join(root, ENGAGEMENTS_REL, "ENG-001"))).toEqual(["engagement.yaml"]);
  });

  test("Story 32.2 (Settled shape 1): the record is written as JSON text (JSON.stringify(record, null, 2) and a newline), read back by js-yaml and by JSON.parse alike; the plan counter stays block YAML", () => {
    const root = tempRoot();
    const r = { ...record("ENG-001", AT), request: "multi\nline: with: colons\n", questions: QUESTIONS.map((q) => ({ ...q })),
      spend: { planning_usd: 0.75, runs_usd: 0 } };
    writeEngagement(root, r);
    const text = readFileSync(engagementPath(root, "ENG-001"), "utf-8");
    expect(text).toBe(JSON.stringify(r, null, 2) + "\n");
    expect(JSON.parse(text)).toEqual(r);
    expect(loadYaml(text)).toEqual(r);
    expect(readEngagement(root, "ENG-001")).toEqual(r);
    mintEngagementId(root);
    const counter = readFileSync(join(root, COUNTER_REL), "utf-8");
    expect(counter.trimStart().startsWith("{")).toBe(false);
    expect(counter).toContain("engagement: ");
  });

  test("a missing record is null; one that is not a record is EngagementRecordInvalid naming the root-relative path", () => {
    const root = tempRoot();
    expect(readEngagement(root, "ENG-001")).toBeNull();
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-002"), { recursive: true });
    for (const text of ["shape_version: 2\nid: ENG-002\nstate: intake\n", "- a list\n", "shape_version: 1\nid: ENG-002\nstate: lost\n", "{ nope"]) {
      writeFileSync(engagementPath(root, "ENG-002"), text);
      let err: unknown;
      try { readEngagement(root, "ENG-002"); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(EngagementRecordInvalid);
      expect((err as Error).message).toStartWith("EngagementRecordInvalid: _bmad-output/engagements/ENG-002/engagement.yaml: ");
      expect((err as Error).message).not.toContain(root);
    }
  });

  test("listEngagements: newest first (created, then id); a malformed record skipped and named root-relative; stray names ignored", () => {
    const root = tempRoot();
    writeEngagement(root, record("ENG-001", "2026-10-25T01:00:00.000Z"));
    writeEngagement(root, record("ENG-002", "2026-10-25T03:00:00.000Z"));
    writeEngagement(root, record("ENG-003", "2026-10-25T03:00:00.000Z"));
    writeEngagement(root, record("ENG-010", "2026-10-25T02:00:00.000Z"));
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-004"));
    writeFileSync(engagementPath(root, "ENG-004"), "shape_version: 9\n");
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-005")); // a directory with no record yet: nothing, no problem
    mkdirSync(join(root, ENGAGEMENTS_REL, "notes"));
    const problems: string[] = [];
    expect(listEngagements(root, problems).map((e) => e.id)).toEqual(["ENG-003", "ENG-002", "ENG-010", "ENG-001"]);
    expect(problems).toEqual(["_bmad-output/engagements/ENG-004/engagement.yaml: shape_version must be 1, got 9"]);
    // cached: the same answer and the same problem again; a rewrite is seen
    const again: string[] = [];
    expect(listEngagements(root, again).map((e) => e.id)).toEqual(["ENG-003", "ENG-002", "ENG-010", "ENG-001"]);
    expect(again).toEqual(problems);
    writeEngagement(root, { ...record("ENG-001", "2026-10-25T01:00:00.000Z"), state: "cancelled", request: "a longer request than before" });
    expect(listEngagements(root).find((e) => e.id === "ENG-001")?.state).toBe("cancelled");
    expect(listEngagements(null)).toEqual([]);
    expect(listEngagements(tempRoot())).toEqual([]);
  });

  test("questions/assumptions/inputs entries that are not mappings, a question with no id, a non-string request: invalid on read, skipped and named", () => {
    const root = tempRoot();
    writeEngagement(root, record("ENG-001", "2026-10-25T01:00:00.000Z"));
    // Story 32.2: the record is JSON text (Settled shape 1): each case is the written record with one field changed.
    const base = { ...JSON.parse(readFileSync(engagementPath(root, "ENG-001"), "utf-8")), id: "ENG-002" } as Record<string, unknown>;
    const variant = (o: Record<string, unknown>) => JSON.stringify({ ...base, ...o }, null, 2) + "\n";
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-002"), { recursive: true });
    const cases: [string, string][] = [
      [variant({ questions: [null] }), "questions[0] is not a mapping"],
      [variant({ assumptions: [3] }), "assumptions[0] is not a mapping"],
      [variant({ inputs: [["a"]] }), "inputs[0] is not a mapping"],
      [variant({ questions: [{ id: "q1", text: "a" }, { text: "no id" }] }), "questions[1] has no id"],
      [variant({ request: 7 }), "request must be a string"],
    ];
    for (const [text, why] of cases) {
      writeFileSync(engagementPath(root, "ENG-002"), text);
      let err: unknown;
      try { readEngagement(root, "ENG-002"); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(EngagementRecordInvalid);
      expect((err as Error).message).toBe(`EngagementRecordInvalid: _bmad-output/engagements/ENG-002/engagement.yaml: ${why}`);
      const problems: string[] = [];
      expect(listEngagements(root, problems).map((e) => e.id)).toEqual(["ENG-001"]);
      expect(problems).toEqual([`_bmad-output/engagements/ENG-002/engagement.yaml: ${why}`]);
    }
    // an absent array still defaults to []
    const { questions: _q, inputs: _i, ...absent } = base;
    writeFileSync(engagementPath(root, "ENG-002"), JSON.stringify(absent, null, 2) + "\n");
    expect(readEngagement(root, "ENG-002")).toMatchObject({ questions: [], inputs: [] });
  });

  test("a record whose id is not its directory's is EngagementRecordInvalid naming both; listEngagements skips and names it", () => {
    const root = tempRoot();
    writeEngagement(root, record("ENG-001", "2026-10-25T01:00:00.000Z"));
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-007"), { recursive: true });
    writeFileSync(engagementPath(root, "ENG-007"), readFileSync(engagementPath(root, "ENG-001"), "utf-8"));
    let err: unknown;
    try { readEngagement(root, "ENG-007"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EngagementRecordInvalid);
    expect((err as Error).message).toBe('EngagementRecordInvalid: _bmad-output/engagements/ENG-007/engagement.yaml: id "ENG-001" does not match its directory ENG-007');
    const problems: string[] = [];
    expect(listEngagements(root, problems).map((e) => e.id)).toEqual(["ENG-001"]);
    expect(problems).toEqual(['_bmad-output/engagements/ENG-007/engagement.yaml: id "ENG-001" does not match its directory ENG-007']);
  });
});

describe("the contract's engagement state table is TRANSITIONS", () => {
  test("every (from, verb | event, to) row of driver-contract.md's table is a TRANSITIONS row, and every TRANSITIONS row is in the table", () => {
    // Normalized: backticks dropped, `event <name>` an event row, a trailing ` (stays)` dropped from `to`; the one
    // refusal row (the terminal states, `to` "—") checked against TERMINAL_STATES instead.
    const contract = readFileSync(resolve(import.meta.dir, "..", "..", "..", "plugins", "tk-studio", "contracts", "driver-contract.md"), "utf-8");
    const heading = "### The engagement state table (0.1.27, Story 32.1)";
    expect(contract).toContain(heading);
    const section = contract.slice(contract.indexOf(heading) + heading.length);
    const lines = section.split("\n");
    const start = lines.findIndex((l) => l.startsWith("| from | input | to |"));
    expect(start).toBeGreaterThan(-1);
    expect(lines[start + 1]).toMatch(/^\|( --- \|)+$/);
    const body: string[] = [];
    for (const l of lines.slice(start + 2)) { if (!l.startsWith("|")) break; body.push(l); }
    const unticked = (cell: string) => cell.trim().replaceAll("`", "");
    const cellsOf = (l: string) => l.split(/(?<!\\)\|/).slice(1, -1).map(unticked);
    for (const l of body) expect(cellsOf(l)).toHaveLength(6);
    // The refusal row (no `to`): the terminal states, every verb and event 409 EngagementClosed; not a TRANSITIONS row.
    const refusals = body.map(cellsOf).filter((c) => c[2] === "—");
    expect(refusals).toEqual([[[...TERMINAL_STATES].join(", "), "any verb or event", "—", "—", "—", "409 EngagementClosed"]]);
    const table = body.map(cellsOf).filter((c) => c[2] !== "—").map((cells) => {
      const [from, input, to] = cells as [string, string, string];
      const key = input.startsWith("event ") ? `event:${input.slice("event ".length).trim()}` : `verb:${input}`;
      return `${from} | ${key} | ${to.replace(/ \(stays\)$/, "")}`;
    });
    const code = TRANSITIONS.map((r) => `${r.from} | ${r.event !== undefined ? `event:${r.event}` : `verb:${r.verb}`} | ${r.to}`);
    expect(table.length).toBeGreaterThan(0);
    expect(new Set(table).size).toBe(table.length); // no row twice
    expect(table.filter((row) => !code.includes(row))).toEqual([]); // the contract names no row the code lacks
    expect(code.filter((row) => !table.includes(row))).toEqual([]); // the code has no row the contract lacks
    expect([...table].sort()).toEqual([...code].sort());
  });
});

describe("chatPointer (Settled shape 1)", () => {
  test("no chat.jsonl: last_seq 0; with one, the last complete line's seq", () => {
    const root = tempRoot();
    expect(chatPointer(root, "ENG-001")).toEqual({ route: "/chat/ENG-001", path: "_bmad-output/engagements/ENG-001/chat.jsonl", last_seq: 0 });
    mkdirSync(join(root, ENGAGEMENTS_REL, "ENG-001"), { recursive: true });
    const lines = [1, 2, 3].map((seq) => JSON.stringify({ seq, at: AT, author: seq % 2 ? "owner" : "planner", body: "b" }));
    writeFileSync(join(root, ENGAGEMENTS_REL, "ENG-001", "chat.jsonl"), lines.join("\n") + "\n{\"seq\": 4, \"bo");
    expect(chatPointer(root, "ENG-001").last_seq).toBe(3);
  });
});
