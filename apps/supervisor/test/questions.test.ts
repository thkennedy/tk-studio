// Story 32.3: the questions pass — the planner's questions.json applied once per queue run id (the 32.1 event row
// `questions`, source planner), the engagement's Jira issue blocked through `track.py block --engagement`, the owner's
// Jira answers read from the sync-back's inbox and comment log, and the issue closed once the state moves on. The
// `uvRunner` is a fake (no live Jira, no `uv`); the inbox and comment logs are fixtures.
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { mintChatTurn, prepareChatTurn, type ChatDeps } from "../src/chat";
import { applyInput, newEngagement, readEngagement, writeEngagement } from "../src/engagement";
import { ENGAGEMENT_CHAT_JOB, Queue, type Owner } from "../src/queue";
import { checkQuestions, parseAnswers, questionsFile, questionsPass, type QuestionsDeps } from "../src/questions";
import { REPLY_MAX_BYTES } from "../src/inbox";
import type { RunResult } from "../src/server";
import { tempDir, track } from "./tmp";

const temp = tempDir; // test/tmp.ts closes the tracked queues and removes the folders

const ENG = "ENG-001";
const ISSUE = "TKS-40";
const me: Owner = { pid: process.pid, host: hostname(), nonce: "questions-test" };
const SHIPPED_CHAT = {
  job_schema_version: 1, id: ENGAGEMENT_CHAT_JOB, trigger: "one-shot",
  target: { skill: "tk-studio-engage", payload: { verb: "reply" } },
  guards: { max_turns: 80, max_wall_clock_seconds: 1800 }, stop: { until: "9999-12-31T23:59:59Z" },
};
const QUESTIONS = [
  { id: "scope", text: "How big is the first cut?", options: [{ label: "Small", default: true }, { label: "Large" }], impact: "sets the quote" },
  { id: "db", text: "Which database?", options: [{ label: "sqlite" }, { label: "postgres", default: true }], impact: "the hosting cost" },
];

/** A served, Jira-bound root (or not) with ENG-001 in `intake`. */
function served(o: { bound?: boolean } = {}) {
  const root = temp("tk-sup-q-root-");
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), o.bound === false
    ? "project_id: p\n" : "project_id: p\nplanning:\n  backend: jira\n  jira:\n    project_key: TKS\n");
  writeEngagement(root, newEngagement(ENG, "p", "Build the export", "2026-10-25T05:00:00.000Z"));
  return root;
}

const newQueue = () => {
  const q = track(new Queue(join(temp("tk-sup-q-q-"), "q.db"), { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) }));
  return q;
};

const chatDeps = (): ChatDeps => ({ resolveJob: async (r) => ({ projectId: "p", root: r, definition: structuredClone(SHIPPED_CHAT), target: "skill" }) });

/** One chat turn minted (its `chat-queued` event, its payload's project_root) and, unless `live`, claimed and ended. */
async function chatRun(queue: Queue, root: string, o: { live?: boolean; seq?: number } = {}): Promise<string> {
  const { run_id } = mintChatTurn(queue, await prepareChatTurn(chatDeps(), root), { engagement: ENG, project: "p", root, seq: o.seq ?? 1 });
  if (!o.live) {
    expect((await queue.claim(run_id, me)).claimed).toBe(true);
    queue.end(run_id, "complete");
  }
  return run_id;
}

const writeQuestions = (root: string, runId: string, questions: unknown = QUESTIONS) =>
  writeFileSync(questionsFile(root, ENG), JSON.stringify({ run_id: runId, at: "2026-10-25T05:01:00.000Z", questions }));

/** The fake `uv`: every call recorded; `track.py block`/`close` answered by `answers` (default ok). */
function fakeUv(answers: { block?: () => Record<string, unknown> | Error; close?: () => Record<string, unknown> | Error } = {}) {
  const calls: { root: string; script: string; args: string[]; timeoutS?: number }[] = [];
  const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> => {
    calls.push({ root, script, args, timeoutS });
    const answer = args[0] === "block"
      ? (answers.block ?? (() => ({ ok: true, status: "complete", engagement: ENG, issues: [{ issue: ISSUE, created: true, transitioned: true, commented: true }] })))()
      : (answers.close ?? (() => ({ ok: true, status: "complete", engagement: ENG, issue: ISSUE, moved: ["Block Resolved", "Done"], skipped: [] })))();
    if (answer instanceof Error) throw answer;
    return { exit: answer.status === "blocked" ? 2 : 0, stdout: JSON.stringify(answer, null, 2), stderr: "" };
  };
  return { uv, calls };
}

/** A clock that moves 1 s per call. */
function clock(start = "2026-10-25T06:00:00.000Z") {
  let t = Date.parse(start);
  return () => new Date((t += 1000)).toISOString();
}

function deps(uv: QuestionsDeps["uv"], extra: Partial<QuestionsDeps> = {}): QuestionsDeps {
  return { uv, env: { TK_STUDIO_ROOT: "/studio" }, now: clock(), ...extra };
}

/** The sync-back's fixtures: the inbox item carrying `engagement`, and the issue's comment log. */
function syncBack(root: string, comments: Record<string, unknown>[], state = "open") {
  mkdirSync(join(root, "_bmad-output", "tracking", ISSUE), { recursive: true });
  writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({
    inbox_version: 1, generated_at: "2026-10-25T06:10:00+00:00", project_key: "TKS",
    items: [{ issue: ISSUE, engagement: ENG, title: `${ENG}: questions`, priority: null, blocked_since: "2026-10-25T06:00:00+00:00",
      reason_comment: null, state }],
  }));
  writeFileSync(join(root, "_bmad-output", "tracking", ISSUE, "comments.jsonl"),
    comments.map((c) => JSON.stringify({ issue: ISSUE, mentions: [], source: "jira", updated: c.created, update_author: c.author, ...c })).join("\n") + "\n");
}
const agentComment = (id: string, minute: number) => ({ id, author: "agent", body: `[~accountid:o] Blocked: ${ENG} needs 2 answer(s)`, created: `2026-10-25T06:${String(minute).padStart(2, "0")}:00.000+0000` });
const ownerComment = (id: string, minute: number, body: string) => ({ id, author: "owner", body, created: `2026-10-25T06:${String(minute).padStart(2, "0")}:00.000+0000` });

const kinds = (q: Queue, kind: string) => q.serviceEvents(kind).map((e) => e.detail);

describe("Story 32.3: apply (Settled shape 1, once per queue run id)", () => {
  test("an ended chat run's questions.json: questions[] set, awaiting-answers, an inputs[] line of source planner with the run id, one engagement event; then the block", async () => {
    const root = served(), queue = newQueue();
    const runId = await chatRun(queue, root);
    writeQuestions(root, runId);
    const { uv, calls } = fakeUv();
    const out = await questionsPass(queue, deps(uv));
    expect(out.applied).toEqual([ENG]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("awaiting-answers");
    expect(record.questions).toEqual(QUESTIONS);
    expect(record.inputs).toHaveLength(1);
    expect(record.inputs[0]).toMatchObject({ verb: "questions", source: "planner", run_id: runId, from: "intake", to: "awaiting-answers" });
    expect(kinds(queue, "engagement")).toEqual([{ id: ENG, project: "p", state: "awaiting-answers", from: "intake", verb: "questions", source: "planner" }]);
    // the block ran through uv: track.py block --directory <root> --engagement ENG-001, timeout 120
    expect(calls.map((c) => [c.root, c.script.split(/[\\/]/).slice(-2).join("/"), c.args, c.timeoutS])).toEqual([
      [root, "lib/track.py", ["block", "--directory", root, "--engagement", ENG], 120],
    ]);
    expect(kinds(queue, "engagement-issue")).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "questions" }]);
    // once per run id: a second pass applies nothing and blocks nothing again
    const again = await questionsPass(queue, deps(uv));
    expect(again).toEqual({ applied: [], skipped: [], blocked: [], answered: [], closed: [] });
    expect(readEngagement(root, ENG)!.inputs).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("a live run's file, another run's file, or no file applies nothing", async () => {
    const root = served(), queue = newQueue();
    const { uv, calls } = fakeUv();
    const live = await chatRun(queue, root, { live: true });
    writeQuestions(root, live);
    expect((await questionsPass(queue, deps(uv))).applied).toEqual([]);
    const ended = await chatRun(queue, root, { seq: 3 });
    writeQuestions(root, "engagement-chat-someone-else");
    expect((await questionsPass(queue, deps(uv))).applied).toEqual([]);
    rmSync(questionsFile(root, ENG));
    expect((await questionsPass(queue, deps(uv))).applied).toEqual([]);
    expect(readEngagement(root, ENG)!.state).toBe("intake");
    expect(kinds(queue, "engagement-questions-skipped")).toEqual([]);
    expect(calls).toEqual([]);
    writeQuestions(root, ended);
    expect((await questionsPass(queue, deps(uv))).applied).toEqual([ENG]);
  });

  test("an invalid file, or a state other than intake: the record unchanged, one engagement-questions-skipped per run", async () => {
    for (const [why, setup, reason] of [
      ["a fourth question", (root: string, runId: string) => writeQuestions(root, runId, [...QUESTIONS, { ...QUESTIONS[0], id: "c" }, { ...QUESTIONS[0], id: "d" }]), "TooManyQuestions"],
      ["no default", (root: string, runId: string) => writeQuestions(root, runId, [{ ...QUESTIONS[0], options: [{ label: "a" }, { label: "b" }] }]), "QuestionInvalid: questions[0]"],
      ["not JSON", (root: string) => writeFileSync(questionsFile(root, ENG), "{torn"), "QuestionInvalid"],
      ["scoping", (root: string, runId: string) => {
        writeQuestions(root, runId);
        writeEngagement(root, { ...readEngagement(root, ENG)!, state: "scoping" });
      }, "NotIntake"],
    ] as const) {
      const root = served(), queue = newQueue();
      const runId = await chatRun(queue, root);
      setup(root, runId);
      const before = readEngagement(root, ENG)!;
      const { uv } = fakeUv();
      const out = await questionsPass(queue, deps(uv));
      expect(out.applied).toEqual([]);
      expect(out.skipped).toEqual([ENG]);
      expect(readEngagement(root, ENG)).toEqual(before);
      const skipped = kinds(queue, "engagement-questions-skipped");
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toMatchObject({ engagement: ENG, project: "p", run_id: runId });
      expect(String(skipped[0]!.reason)).toContain(reason);
      await questionsPass(queue, deps(uv));
      expect(kinds(queue, "engagement-questions-skipped")).toHaveLength(1); // once
      expect(why).toBeTruthy();
    }
  });

  test("the record is re-read fresh before the write: a field written meanwhile survives", async () => {
    const root = served(), queue = newQueue();
    const runId = await chatRun(queue, root);
    writeQuestions(root, runId);
    const { uv } = fakeUv();
    await questionsPass(queue, deps(uv, {
      beforeWrite: (r, id) => { const rec = readEngagement(r, id)!; writeEngagement(r, { ...rec, spend: { planning_usd: 0.5, runs_usd: 0 } }); },
    }));
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("awaiting-answers");
    expect(record.spend.planning_usd).toBe(0.5);
  });

  test("checkQuestions mirrors engage.py's rules", () => {
    expect(checkQuestions(QUESTIONS)).toEqual({ ok: true, questions: QUESTIONS as never });
    expect(checkQuestions([])).toMatchObject({ ok: false });
    expect(checkQuestions([QUESTIONS[0], { ...QUESTIONS[0] }])).toEqual({ ok: false, reason: "QuestionInvalid: questions[1]: duplicate id 'scope'" });
    expect(checkQuestions([{ ...QUESTIONS[0], id: "Bad Id" }])).toMatchObject({ ok: false });
    expect(checkQuestions([{ ...QUESTIONS[0], options: Array.from({ length: 7 }, (_, i) => ({ label: `o${i}`, ...(i ? {} : { default: true }) })) }])).toMatchObject({ ok: false });
    expect(checkQuestions([{ ...QUESTIONS[0], options: [{ label: "A", default: true }, { label: "a" }] }])).toMatchObject({ ok: false });
    // a closed shape: an unknown question field is QuestionInvalid naming the index (as engage.py refuses it)
    expect(checkQuestions([QUESTIONS[0], { ...QUESTIONS[1], why: "x" }])).toEqual({ ok: false, reason: "QuestionInvalid: questions[1]: unknown field 'why'" });
  });

  test("an unparsable questions.json is skipped once per engagement, not once per ended chat run", async () => {
    const root = served(), queue = newQueue();
    const first = await chatRun(queue, root);
    const second = await chatRun(queue, root, { seq: 3 });
    writeFileSync(questionsFile(root, ENG), "{torn");
    const { uv } = fakeUv();
    await questionsPass(queue, deps(uv));
    await questionsPass(queue, deps(uv));
    const skipped = kinds(queue, "engagement-questions-skipped");
    expect(skipped).toHaveLength(1);
    expect([first, second]).toContain(String(skipped[0]!.run_id));
    expect(readEngagement(root, ENG)!.state).toBe("intake");
  });
});

describe("Story 32.3: the block", () => {
  test("retry: true emits nothing (the next pass calls again); an unbound project is never blocked", async () => {
    const root = served(), queue = newQueue();
    const runId = await chatRun(queue, root);
    writeQuestions(root, runId);
    let retry = true;
    const { uv, calls } = fakeUv({ block: () => (retry ? { ok: false, status: "partial", retry: true } : { ok: true, status: "complete", issues: [{ issue: ISSUE }] }) });
    await questionsPass(queue, deps(uv));
    expect(kinds(queue, "engagement-issue")).toEqual([]);
    await questionsPass(queue, deps(uv));
    expect(calls).toHaveLength(2);
    retry = false;
    await questionsPass(queue, deps(uv));
    expect(kinds(queue, "engagement-issue")).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "questions" }]);
    await questionsPass(queue, deps(uv));
    expect(calls).toHaveLength(3);
    // a spawn failure is no throw
    const root2 = served(), q2 = newQueue();
    writeQuestions(root2, await chatRun(q2, root2));
    const thrown = fakeUv({ block: () => new Error("spawn uv ENOENT") });
    expect((await questionsPass(q2, deps(thrown.uv))).blocked).toEqual([]);
    // unbound: applied, never blocked
    const root3 = served({ bound: false }), q3 = newQueue();
    writeQuestions(root3, await chatRun(q3, root3));
    const unbound = fakeUv();
    expect((await questionsPass(q3, deps(unbound.uv))).applied).toEqual([ENG]);
    expect(unbound.calls).toEqual([]);
  });

  test("a refusal by name: one engagement-issue refused per reason, no further call until a later questions/answer line", async () => {
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    const reason = "track refused: IssueCreateRefused: no Task";
    const refused = fakeUv({ block: () => ({ ok: false, status: "blocked", reason }) });
    await questionsPass(queue, deps(refused.uv));
    expect(kinds(queue, "engagement-issue")).toEqual([{ engagement: ENG, project: "p", action: "refused", reason }]);
    await questionsPass(queue, deps(refused.uv));
    await questionsPass(queue, deps(refused.uv), { root, engagement: ENG });
    expect(refused.calls).toHaveLength(1); // not called again at every run end
    expect(kinds(queue, "engagement-issue")).toHaveLength(1);
    // a later partial answer (the card) makes a block owed again: called once more, told once more
    const partial = applyInput(readEngagement(root, ENG)!, { verb: "answer", payload: { answers: { db: "sqlite" } }, source: "bearer", at: "2026-10-25T07:00:00.000Z" });
    expect(partial.ok && partial.to).toBe("awaiting-answers");
    if (partial.ok) writeEngagement(root, partial.record);
    await questionsPass(queue, deps(refused.uv, { now: clock("2026-10-25T07:30:00.000Z") }), { root, engagement: ENG });
    expect(refused.calls).toHaveLength(2);
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["refused", "refused"]);
  });

  test("two concurrent passes over one root call track.py block once (serialised per served root)", async () => {
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    const { uv, calls } = fakeUv();
    const slow: QuestionsDeps["uv"] = async (r, script, args, timeoutS) => { await Bun.sleep(30); return uv(r, script, args, timeoutS); };
    await Promise.all([questionsPass(queue, deps(slow)), questionsPass(queue, deps(slow), { root, engagement: ENG })]);
    expect(calls.map((c) => c.args[0])).toEqual(["block"]);
    expect(kinds(queue, "engagement-issue")).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "questions" }]);
  });
});

describe("Story 32.3: the owner's Jira answers (Settled shape 4)", () => {
  async function awaiting() {
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    const fake = fakeUv();
    await questionsPass(queue, deps(fake.uv));
    expect(readEngagement(root, ENG)!.state).toBe("awaiting-answers");
    return { root, queue, ...fake };
  }

  test("`scope: Small` matched to its label, free text kept verbatim: all answered, scoping, source supervisor, then the issue closed", async () => {
    const { root, queue, uv, calls } = await awaiting();
    syncBack(root, [
      agentComment("c1", 2),
      ownerComment("c2", 3, "Thanks!\nscope: small\ndb: something else, a managed one\nnotes: ignored"),
    ]);
    const out = await questionsPass(queue, deps(uv));
    expect(out.answered).toEqual([ENG]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("scoping");
    expect(record.questions.map((q) => [q.id, q.answer])).toEqual([["scope", "Small"], ["db", "something else, a managed one"]]);
    expect(record.inputs.at(-1)).toMatchObject({ verb: "answer", source: "supervisor", from: "awaiting-answers", to: "scoping" });
    expect(kinds(queue, "engagement-answers")).toEqual([{ engagement: ENG, project: "p", comment: "c2", ids: ["scope", "db"] }]);
    expect(kinds(queue, "engagement").at(-1)).toEqual({ id: ENG, project: "p", state: "scoping", from: "awaiting-answers", verb: "answer", source: "supervisor" });
    // the close: track.py close --engagement, then engagement-issue closed; once
    expect(calls.at(-1)!.args).toEqual(["close", "--directory", root, "--engagement", ENG]);
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked", "closed"]);
    await questionsPass(queue, deps(uv));
    expect(calls.filter((c) => c.args[0] === "close")).toHaveLength(1);
    expect(kinds(queue, "engagement-answers")).toHaveLength(1); // a comment id is applied once
  });

  test("a partial answer stays awaiting-answers and re-blocks; a comment with no parsed line re-blocks too, each comment once", async () => {
    const { root, queue, uv, calls } = await awaiting();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "db: sqlite")]);
    await questionsPass(queue, deps(uv));
    let record = readEngagement(root, ENG)!;
    expect(record.state).toBe("awaiting-answers");
    expect(record.questions.map((q) => q.answer ?? null)).toEqual([null, "sqlite"]);
    expect(calls.map((c) => c.args[0])).toEqual(["block", "block"]); // re-blocked with the open one
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked", "blocked"]);
    // the next tick: a new agent comment, then an owner comment that answers nothing
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "db: sqlite"), agentComment("c3", 4), ownerComment("c4", 5, "what do you mean?")]);
    await questionsPass(queue, deps(uv));
    record = readEngagement(root, ENG)!;
    expect(record.state).toBe("awaiting-answers");
    expect(kinds(queue, "engagement-answers").map((e) => [e!.comment, e!.ids])).toEqual([["c2", ["db"]], ["c4", []]]);
    expect(calls.map((c) => c.args[0])).toEqual(["block", "block", "block"]);
    // nothing new: nothing moves, nothing is called (no timer of its own)
    await questionsPass(queue, deps(uv));
    expect(calls).toHaveLength(3);
  });

  test("an answer from an item already resolved (31.6's Issue screen) is read too", async () => {
    const { root, queue, uv } = await awaiting();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "scope: Large\ndb: postgres")], "resolved");
    await questionsPass(queue, deps(uv));
    expect(readEngagement(root, ENG)!.state).toBe("scoping");
    expect(readEngagement(root, ENG)!.questions.map((q) => q.answer)).toEqual(["Large", "postgres"]);
  });

  test("parseAnswers: open ids only, labels case-insensitively, unparsed lines ignored", () => {
    const qs = [{ ...QUESTIONS[0], answer: "Small" }, QUESTIONS[1]];
    expect(parseAnswers("scope: Large\n  db :  POSTGRES  \nother: x\nnot a line", qs)).toEqual({ db: "postgres" });
    expect(parseAnswers("db: my own", qs)).toEqual({ db: "my own" });
    expect(parseAnswers("nothing here", qs)).toEqual({});
  });

  test("parseAnswers: the id case-insensitively (lowercased); a copied `- ` bullet and ` (default)` suffix still match the label; free text verbatim", () => {
    expect(parseAnswers("Scope: Small\nDB: - Postgres (Default)", QUESTIONS)).toEqual({ scope: "Small", db: "postgres" });
    expect(parseAnswers("SCOPE: - Large", QUESTIONS)).toEqual({ scope: "Large" });
    expect(parseAnswers("db: - my own (default)", QUESTIONS)).toEqual({ db: "- my own (default)" });
  });

  test("an edited comment (two lines, one id) is handled once, from its last line", async () => {
    const { root, queue, uv } = await awaiting();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "db: sqlite"), ownerComment("c2", 4, "scope: Large\ndb: postgres")]);
    await questionsPass(queue, deps(uv));
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("scoping");
    expect(record.questions.map((q) => q.answer)).toEqual(["Large", "postgres"]);
    expect(kinds(queue, "engagement-answers")).toEqual([{ engagement: ENG, project: "p", comment: "c2", ids: ["scope", "db"] }]);
  });

  test("an answer the apply refuses (the record changed meanwhile): the comment consumed with ids [], the issue re-blocked", async () => {
    const { root, queue, uv, calls } = await awaiting();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "db: sqlite")]);
    // between the first read and the fresh one the question is gone: applyInput refuses the unknown id
    await questionsPass(queue, deps(uv, { beforeWrite: (r, id) => { writeEngagement(r, { ...readEngagement(r, id)!, questions: [QUESTIONS[0]] }); } }));
    expect(readEngagement(root, ENG)!.state).toBe("awaiting-answers");
    expect(kinds(queue, "engagement-answers")).toEqual([{ engagement: ENG, project: "p", comment: "c2", ids: [] }]);
    expect(calls.map((c) => c.args[0])).toEqual(["block", "block"]);
  });

  test("an answer past the input route's bound is not applied; the comment re-blocks", async () => {
    const { root, queue, uv, calls } = await awaiting();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, `scope: Small\ndb: ${"x".repeat(REPLY_MAX_BYTES + 1)}`)]);
    await questionsPass(queue, deps(uv));
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("awaiting-answers");
    expect(record.questions.map((q) => q.answer ?? null)).toEqual(["Small", null]);
    expect(kinds(queue, "engagement-answers")).toEqual([{ engagement: ENG, project: "p", comment: "c2", ids: ["scope"] }]);
    expect(calls.map((c) => c.args[0])).toEqual(["block", "block"]);
  });
});

describe("Story 32.3: the card answer and go (afterEngagementInput's pass)", () => {
  test("a card answer of every question: the pass for that engagement closes the issue", async () => {
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    const { uv, calls } = fakeUv();
    await questionsPass(queue, deps(uv));
    // the input route's apply (source bearer), then its afterEngagementInput
    const applied = applyInput(readEngagement(root, ENG)!, { verb: "answer", payload: { answers: { scope: "Small", db: "sqlite" } }, source: "bearer", at: "2026-10-25T07:00:00.000Z" });
    expect(applied.ok && applied.to).toBe("scoping");
    if (applied.ok) writeEngagement(root, applied.record);
    const out = await questionsPass(queue, deps(uv), { root, engagement: ENG });
    expect(out.closed).toEqual([ENG]);
    expect(calls.at(-1)!.args).toEqual(["close", "--directory", root, "--engagement", ENG]);
  });

  test("go with questions open: each open default an assumption, scoping, the issue closed; a close retry emits nothing", async () => {
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    let retry = true;
    const { uv, calls } = fakeUv({ close: () => (retry ? { ok: false, status: "partial", retry: true } : { ok: true, status: "complete", issue: ISSUE, moved: ["Block Resolved", "Done"] }) });
    await questionsPass(queue, deps(uv));
    const go = applyInput(readEngagement(root, ENG)!, { verb: "go", source: "cookie", at: "2026-10-25T07:00:00.000Z" });
    if (go.ok) writeEngagement(root, go.record);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("scoping");
    expect(record.assumptions).toEqual([
      { question: "scope", text: "How big is the first cut?", assumed: "Small" },
      { question: "db", text: "Which database?", assumed: "postgres" },
    ]);
    await questionsPass(queue, deps(uv), { root, engagement: ENG });
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked"]);
    retry = false;
    await questionsPass(queue, deps(uv), { root, engagement: ENG });
    expect(kinds(queue, "engagement-issue")).toEqual([
      { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "questions" },
      { engagement: ENG, project: "p", issue: ISSUE, action: "closed" },
    ]);
    expect(calls.filter((c) => c.args[0] === "close")).toHaveLength(2);
  });

  test("an engagement never blocked is never closed", async () => {
    const root = served(), queue = newQueue();
    const { uv, calls } = fakeUv();
    const go = applyInput(readEngagement(root, ENG)!, { verb: "go", source: "bearer", at: "2026-10-25T07:00:00.000Z" });
    if (go.ok) writeEngagement(root, go.record);
    expect(await questionsPass(queue, deps(uv), { root, engagement: ENG })).toEqual({ applied: [], skipped: [], blocked: [], answered: [], closed: [] });
    expect(calls).toEqual([]);
  });
});

describe("Story 32.3: review fixes (lost re-block, late owner comments, close refusals, a missing blocked event, copied headers, cross-process apply)", () => {
  type Answer = () => Record<string, unknown> | Error;
  /** ENG-001 applied by a pass on the 06:00 clock (blocked unless `block` says otherwise); `block`/`close` are read
   * at each call, so a test can change them between passes. */
  async function engagementWith(o: { block?: Answer; close?: Answer } = {}) {
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    const answers = { block: o.block, close: o.close };
    const fake = fakeUv({ block: () => (answers.block ?? okBlock)(), close: () => (answers.close ?? okClose)() });
    await questionsPass(queue, deps(fake.uv));
    expect(readEngagement(root, ENG)!.state).toBe("awaiting-answers");
    return { root, queue, answers, ...fake, count: (verb: string) => fake.calls.filter((c) => c.args[0] === verb).length };
  }
  const okBlock: Answer = () => ({ ok: true, status: "complete", issues: [{ issue: ISSUE }] });
  const okClose: Answer = () => ({ ok: true, status: "complete", issue: ISSUE, moved: ["Block Resolved", "Done"] });
  const retry: Answer = () => ({ ok: false, status: "partial", retry: true });
  /** A clock starting at `hour`:00 (each pass after the first gets a later one, as the wall clock would). */
  const at = (hour: number) => clock(`2026-10-25T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const cardAnswerAll = (root: string) => {
    const applied = applyInput(readEngagement(root, ENG)!, { verb: "answer", payload: { answers: { scope: "Small", db: "sqlite" } }, source: "bearer", at: "2026-10-25T07:00:00.000Z" });
    expect(applied.ok && applied.to).toBe("scoping");
    if (applied.ok) writeEngagement(root, applied.record);
  };

  test("finding 1: an unparsed comment whose re-block answers transient: the next pass calls track.py block again; after a successful re-block, no further call", async () => {
    const { root, queue, uv, answers, count } = await engagementWith();
    expect(count("block")).toBe(1);
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "what do you mean?")]);
    answers.block = retry;
    await questionsPass(queue, deps(uv, { now: at(7) }));
    expect(kinds(queue, "engagement-answers")).toEqual([{ engagement: ENG, project: "p", comment: "c2", ids: [] }]);
    expect(count("block")).toBe(2); // the re-block, answered transient: nothing recorded
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked"]);
    // the comment is seen and no inputs line was written, yet the re-block is still owed
    await questionsPass(queue, deps(uv, { now: at(8) }));
    expect(count("block")).toBe(3);
    answers.block = okBlock;
    await questionsPass(queue, deps(uv, { now: at(9) }));
    expect(count("block")).toBe(4);
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked", "blocked"]);
    await questionsPass(queue, deps(uv, { now: at(10) }));
    expect(count("block")).toBe(4); // re-blocked: nothing owed
    expect(kinds(queue, "engagement-answers")).toHaveLength(1);
  });

  test("finding 1: a named refusal of an owed re-block is told once, then owes no further call", async () => {
    const { root, queue, uv, answers, count } = await engagementWith();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "hmm")]);
    answers.block = () => ({ ok: false, status: "blocked", reason: "track refused: OwnerUnmapped" });
    await questionsPass(queue, deps(uv, { now: at(7) }));
    await questionsPass(queue, deps(uv, { now: at(8) }));
    expect(count("block")).toBe(2);
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked", "refused"]);
  });

  test("finding 2: an owner answer the sync carries before a later agent comment (c1, c2, c4 owner, c3 agent) is read", async () => {
    const { root, queue, uv } = await engagementWith();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "db: sqlite")]);
    await questionsPass(queue, deps(uv, { now: at(7) })); // partial: applied, re-blocked (the agent's c3)
    expect(readEngagement(root, ENG)!.state).toBe("awaiting-answers");
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "db: sqlite"), ownerComment("c4", 5, "scope: Large"), agentComment("c3", 6)]);
    const out = await questionsPass(queue, deps(uv, { now: at(8) }));
    expect(out.answered).toEqual([ENG]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("scoping");
    expect(record.questions.map((q) => q.answer)).toEqual(["Large", "sqlite"]);
    expect(kinds(queue, "engagement-answers").map((e) => [e!.comment, e!.ids])).toEqual([["c2", ["db"]], ["c4", ["scope"]]]);
    await questionsPass(queue, deps(uv, { now: at(9) })); // each comment id applied once: a later pass adds nothing
    expect(kinds(queue, "engagement-answers")).toHaveLength(2);
    expect(readEngagement(root, ENG)!.inputs.filter((l) => l.verb === "answer")).toHaveLength(2);
  });

  test("finding 3: a named close refusal: one engagement-issue refused with step close, no further close call (every pass, every input)", async () => {
    const { root, queue, uv, answers, count } = await engagementWith();
    const reason = "track refused: NoTransition: no transition to Done";
    answers.close = () => ({ ok: false, status: "blocked", reason });
    cardAnswerAll(root);
    const out = await questionsPass(queue, deps(uv, { now: at(7) }), { root, engagement: ENG });
    expect(out.closed).toEqual([]);
    expect(kinds(queue, "engagement-issue")).toEqual([
      { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "questions" },
      { engagement: ENG, project: "p", action: "refused", step: "close", reason },
    ]);
    await questionsPass(queue, deps(uv, { now: at(8) }));
    await questionsPass(queue, deps(uv, { now: at(9) }), { root, engagement: ENG });
    expect(count("close")).toBe(1);
    expect(count("block")).toBe(1); // a close refusal never owes a block
    expect(kinds(queue, "engagement-issue")).toHaveLength(2);
  });

  test("finding 3: a close's refused (step close) is not a block's: it neither satisfies an owed block nor tells a block refusal of the same reason", async () => {
    const { root, queue, uv, answers, count } = await engagementWith();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "what do you mean?")]);
    answers.block = retry;
    await questionsPass(queue, deps(uv, { now: at(7) })); // the comment owes a re-block, answered transient
    expect(count("block")).toBe(2);
    const reason = "track refused: OwnerUnmapped";
    queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", action: "refused", step: "close", reason }, "2026-10-25T07:30:00.000Z");
    answers.block = () => ({ ok: false, status: "blocked", reason });
    await questionsPass(queue, deps(uv, { now: at(8) }));
    expect(count("block")).toBe(3); // still owed: the close's refused does not count as the block done
    expect(kinds(queue, "engagement-issue")).toEqual([
      { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "questions" },
      { engagement: ENG, project: "p", action: "refused", step: "close", reason },
      { engagement: ENG, project: "p", action: "refused", reason }, // told, though the close's carried the same reason
    ]);
    await questionsPass(queue, deps(uv, { now: at(9) }));
    expect(count("block")).toBe(3); // the block's refusal owes no further call
  });

  test("finding 4: a block answered transient (no blocked event), then the card answers all: the close is still called and closed recorded", async () => {
    const { root, queue, uv, count } = await engagementWith({ block: retry });
    expect(kinds(queue, "engagement-issue")).toEqual([]);
    cardAnswerAll(root);
    const out = await questionsPass(queue, deps(uv, { now: at(7) }), { root, engagement: ENG });
    expect(out.closed).toEqual([ENG]);
    expect(kinds(queue, "engagement-issue")).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "closed" }]);
    await questionsPass(queue, deps(uv, { now: at(8) }));
    expect(count("close")).toBe(1);
  });

  test("finding 4: no blocked event and the issue never created: NoIssue is one refused with step close, no further call", async () => {
    const { root, queue, uv, count } = await engagementWith({ block: retry, close: () => ({ ok: false, status: "blocked", reason: "NoIssue: ENG-001 has no issue" }) });
    cardAnswerAll(root);
    await questionsPass(queue, deps(uv, { now: at(7) }), { root, engagement: ENG });
    expect(kinds(queue, "engagement-issue")).toEqual([{ engagement: ENG, project: "p", action: "refused", step: "close", reason: "NoIssue: ENG-001 has no issue" }]);
    await questionsPass(queue, deps(uv, { now: at(8) }));
    expect(count("close")).toBe(1);
  });

  test("finding 4: the close's issue key falls back to the blocked event's when the close names none", async () => {
    const { root, queue, uv } = await engagementWith({ close: () => ({ ok: true, status: "complete", moved: ["Block Resolved", "Done"] }) });
    cardAnswerAll(root);
    await questionsPass(queue, deps(uv, { now: at(7) }), { root, engagement: ENG });
    expect(kinds(queue, "engagement-issue").at(-1)).toEqual({ engagement: ENG, project: "p", issue: ISSUE, action: "closed" });
  });

  test("Story 32.6: a cap or ask block is not closed by the questions pass, and is not this pass's block", async () => {
    for (const kind of ["cap", "ask"]) {
      const { root, queue, uv, count } = await engagementWith();
      cardAnswerAll(root);
      // the run pass blocked the same issue for the owner's go {cap} or continue
      queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind }, "2026-10-25T07:30:00.000Z");
      const out = await questionsPass(queue, deps(uv, { now: at(8) }), { root, engagement: ENG });
      expect(out.closed).toEqual([]);
      expect(count("close")).toBe(0);
      expect(kinds(queue, "engagement-issue").map((e) => [e!.action, e!.kind])).toEqual([["blocked", "questions"], ["blocked", kind]]);
    }
    // awaiting-answers: a cap block event is no questions block, so the questions block stays owed
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    const fake = fakeUv({ block: retry });
    await questionsPass(queue, deps(fake.uv));
    queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "cap" }, "2026-10-25T07:30:00.000Z");
    await questionsPass(queue, deps(fake.uv, { now: at(8) }));
    expect(fake.calls.filter((c) => c.args[0] === "block")).toHaveLength(2);
  });

  test("Story 36.3: a cap or ask block followed by its `unblocked` event: the owed questions block closes after it", async () => {
    for (const kind of ["cap", "ask"]) {
      const { root, queue, uv, count } = await engagementWith();
      cardAnswerAll(root);
      queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind }, "2026-10-25T07:30:00.000Z");
      queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "unblocked", kind }, "2026-10-25T07:40:00.000Z");
      const out = await questionsPass(queue, deps(uv, { now: at(8) }), { root, engagement: ENG });
      expect(out.closed).toEqual([ENG]);
      expect(count("close")).toBe(1);
    }
  });

  test("Story 36.3: an `unblocked` of the other kind clears nothing", async () => {
    const { root, queue, uv, count } = await engagementWith();
    cardAnswerAll(root);
    queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "unblocked", kind: "ask" }, "2026-10-25T07:20:00.000Z");
    queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "cap" }, "2026-10-25T07:30:00.000Z");
    await questionsPass(queue, deps(uv, { now: at(8) }), { root, engagement: ENG });
    expect(count("close")).toBe(0);
  });

  test("finding 5: parseAnswers ignores a copied question header (`<id>: <text>`): a pasted block comment answers nothing; a quoted header after a real answer does not overwrite it", () => {
    const pasted = "Blocked: ENG-001 needs 2 answer(s)\nscope: How big is the first cut?\n- Small (default)\n- Large\ndb: which database?  \n- sqlite\n- postgres (default)";
    expect(parseAnswers(pasted, QUESTIONS)).toEqual({});
    expect(parseAnswers("scope: Large\n> quoting you:\nscope: How big is the first cut?", QUESTIONS)).toEqual({ scope: "Large" });
  });

  test("finding 5: a pasted block comment through the pass applies nothing and re-blocks", async () => {
    const { root, queue, uv, count } = await engagementWith();
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "scope: How big is the first cut?\ndb: Which database?")]);
    await questionsPass(queue, deps(uv, { now: at(7) }));
    expect(readEngagement(root, ENG)!.state).toBe("awaiting-answers");
    expect(readEngagement(root, ENG)!.questions.map((q) => q.answer ?? null)).toEqual([null, null]);
    expect(kinds(queue, "engagement-answers")).toEqual([{ engagement: ENG, project: "p", comment: "c2", ids: [] }]);
    expect(count("block")).toBe(2);
  });

  test("finding 6: a comment another process applied after this pass's first read is skipped (the engagement-answers re-read)", async () => {
    const { root, queue, uv, answers } = await engagementWith({ block: retry }); // no blocked event: the next pass owes a block
    syncBack(root, [agentComment("c1", 2), ownerComment("c2", 3, "db: sqlite")]);
    answers.block = okBlock;
    // the other process (`serve`'s hook) records c2 right as this pass takes its first engagement-answers read (just
    // after the block it owed), which returns the list as it stood before
    let armed = false, raced = false;
    const racing = new Proxy(queue, {
      get(target, prop) {
        if (prop === "serviceEvents") {
          return (kind?: string) => {
            const evs = target.serviceEvents(kind);
            if (kind === "engagement-answers" && armed && !raced) {
              raced = true;
              target.serviceEvent("engagement-answers", { engagement: ENG, project: "p", comment: "c2", ids: ["db"] });
            }
            return evs;
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const armingUv: QuestionsDeps["uv"] = async (r, s, a, tS) => { const res = await uv(r, s, a, tS); if (a[0] === "block") armed = true; return res; };
    await questionsPass(racing, deps(armingUv, { now: at(7) }));
    expect(raced).toBe(true);
    expect(kinds(queue, "engagement-answers")).toHaveLength(1); // only the other process's
    expect(readEngagement(root, ENG)!.questions.map((q) => q.answer ?? null)).toEqual([null, null]); // not applied here
  });
});

describe("Story 32.3: review pass 3 (the block's stamp, a copied Impact line)", () => {
  test("a partial card answer written while track.py block runs owes a re-block on the next pass (the blocked event is stamped before the call)", async () => {
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    const now = clock();
    let answered = false;
    const { uv: inner, calls } = fakeUv();
    // the first block "runs" while the card answers one question: the same record path as the input route
    const uv: QuestionsDeps["uv"] = async (r, s, a, tS) => {
      if (a[0] === "block" && !answered) {
        answered = true;
        const applied = applyInput(readEngagement(root, ENG)!, { verb: "answer", payload: { answers: { db: "sqlite" } }, source: "bearer", at: now() });
        expect(applied.ok && applied.to).toBe("awaiting-answers");
        if (applied.ok) writeEngagement(root, applied.record);
      }
      return inner(r, s, a, tS);
    };
    await questionsPass(queue, deps(uv, { now }));
    expect(answered).toBe(true);
    expect(calls.map((c) => c.args[0])).toEqual(["block"]);
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked"]);
    // the comment the block posted listed `db`, answered meanwhile: the next pass re-blocks with the open one
    await questionsPass(queue, deps(uv, { now }));
    expect(calls.map((c) => c.args[0])).toEqual(["block", "block"]);
    expect(kinds(queue, "engagement-issue").map((e) => e!.action)).toEqual(["blocked", "blocked"]);
    await questionsPass(queue, deps(uv, { now }));
    expect(calls).toHaveLength(2); // nothing owed after that
  });

  test("parseAnswers: a question whose id is `impact` ignores a copied `Impact: <impact>` line of the block comment; free text stays verbatim", () => {
    const qs = [
      { id: "impact", text: "How wide is the rollout?", options: [{ label: "Narrow", default: true }, { label: "Wide" }], impact: "the rollout plan" },
      { id: "db", text: "Which database?", options: [{ label: "sqlite" }, { label: "postgres", default: true }], impact: "the hosting cost" },
    ];
    const pasted = "Blocked: ENG-001 needs 2 answer(s)\nimpact: How wide is the rollout?\nImpact: the rollout plan\n- Narrow (default)\n- Wide\n"
      + "db: Which database?\nImpact:  The Hosting Cost \n- sqlite\n- postgres (default)";
    expect(parseAnswers(pasted, qs)).toEqual({});
    expect(parseAnswers("impact: wide\nImpact: the rollout plan", qs)).toEqual({ impact: "Wide" });
    expect(parseAnswers("Impact: just my team, for now", qs)).toEqual({ impact: "just my team, for now" });
    // only the `impact` id: another question's free text equal to an impact is still an answer
    expect(parseAnswers("db: the hosting cost", qs)).toEqual({ db: "the hosting cost" });
  });
});

describe("Story 32.3: never throws", () => {
  test("a broken queue, a malformed record or a throwing runner: no throw", async () => {
    const broken = { serviceEvents: () => { throw new Error("db closed"); } } as unknown as Queue;
    expect(await questionsPass(broken, {})).toEqual({ applied: [], skipped: [], blocked: [], answered: [], closed: [] });
    const root = served(), queue = newQueue();
    writeQuestions(root, await chatRun(queue, root));
    writeFileSync(join(root, "_bmad-output", "engagements", ENG, "engagement.yaml"), "shape_version: 9\n");
    const { uv } = fakeUv({ block: () => new Error("boom") });
    expect(await questionsPass(queue, deps(uv))).toEqual({ applied: [], skipped: [], blocked: [], answered: [], closed: [] });
  });
});
