// Story 39.3: the studio chat — the record and its lock, the queueing helpers (`pendingTurns`, `excerpt`,
// `behindNote`), the body check, the stdout tap (`<reply>` markers, deltas kept and ignored, the throttle, the close
// flush), the worker's stream-json argv and its NDJSON result, the studio-chat pass, the quiet end, the quiet lane wait,
// and the invoke's run id. Every planner is a fake: no `claude`, no `uv` job (except the drained lane wait, which needs
// the studio root and uv and is skipped without them).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { finishRun, runJob, type RunRecorder, type Started, type TranscriptChecks } from "../src/cli";
import { endHygiene, STUDIO_CHAT_QUIET } from "../src/hygiene";
import { STUDIO_CHAT_JOB, Queue, type Owner } from "../src/queue";
import { buildWorkerCommand, MISSING_STATUS_BLOCK, parseWorkerResult, runProcess } from "../src/server";
import {
  appendStudioLineHeld, behindNote, checkStudioChatBody, deltaFrame, dropStudioLineHeld, excerpt, failureBody, findProposal, LINE_MAX_CHARS,
  markUnqueuedHeld, mintStudioTurn, pendingTurns, readStream, readStudioChat, readsFile, replyText, STUDIO_CHAT_LOCK_REL, STUDIO_LOCK_STALE_MS, StudioChatBusy,
  studioChatPass, studioChatSince, studioChatTap, streamFile, textDelta, withStudioLock, withStudioLockAsync, writeReads, type StudioLine,
} from "../src/studiochat";
import { fakeBin } from "./fakes";
import { tempDir, track } from "./tmp";

const AT = "2026-11-10T05:00:00.000Z";
const me: Owner = { pid: process.pid, host: hostname(), nonce: "studio-test" };
const STUDIO_JOB = {
  job_schema_version: 1, id: STUDIO_CHAT_JOB, trigger: "one-shot", target: { skill: "tk-studio-engage", payload: { verb: "studio-reply" } },
  requires: { tier: "host" }, guards: { max_turns: 40, max_wall_clock_seconds: 600 }, stop: { until: "9999-12-31T23:59:59Z" },
};
const newQueue = (alive = new Set<number>([me.pid])) =>
  track(new Queue(join(tempDir("tk-sup-studio-q-"), "q.db"), { ownerAlive: (o) => alive.has(o.pid), engineLive: async () => ({ live: false }) }));
const prepared = (root: string) => ({ v: { projectId: "p", root, definition: structuredClone(STUDIO_JOB), target: "skill" }, where: {} });
const owner = (seq: number, body: string): StudioLine => ({ seq, at: AT, author: "owner", body });
const planner = (seq: number, replyTo: number, runId = `r${replyTo}`): StudioLine =>
  ({ seq, at: AT, author: "planner", body: "ok", run_id: runId, reply_to: replyTo, proposals: [] });

/** One stream-json line (NDJSON) of a top-level text delta, or of another kind. */
const sj = (text: string, o: { parent?: string | null; delta?: string } = {}) => JSON.stringify({
  type: "stream_event", parent_tool_use_id: o.parent === undefined ? null : o.parent, session_id: "s",
  event: { type: "content_block_delta", index: 0, delta: o.delta === "thinking" ? { type: "thinking_delta", thinking: text }
    : o.delta === "tool" ? { type: "input_json_delta", partial_json: text } : { type: "text_delta", text } },
}) + "\n";

describe("the record and its lock (Settled shape 2)", () => {
  test("append: seq grows by 1 from 1, each kind as given; since reads after a seq; drop removes one line byte for byte", () => {
    const root = tempDir("tk-sup-studio-root-");
    const a = withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "owner", body: "what is running" }));
    const b = withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "planner", body: "Two.", run_id: "r1", reply_to: 1, proposals: [{ kind: "open", label: "Board", route: "/app/board/p" }] }));
    const c = withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "owner", body: "pressed: Board", pressed: { seq: 2, index: 0, kind: "open" } }));
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    const text = readFileSync(join(root, "_bmad-output", "tracking", "studio-chat.jsonl"), "utf-8");
    expect(text.trim().split("\n").map((l) => JSON.parse(l))).toEqual([a, b, c]);
    expect(studioChatSince(root, 2)).toEqual([c]);
    withStudioLock(root, () => dropStudioLineHeld(root, 2));
    expect(readStudioChat(root).map((l) => l.seq)).toEqual([1, 3]);
    // the lock is released after each writer
    expect(existsSync(join(root, STUDIO_CHAT_LOCK_REL))).toBe(false);
  });

  test("markUnqueuedHeld: the line keeps its seq and fields, gains unqueued: true; the next append takes the next seq; every other line kept", () => {
    const root = tempDir("tk-sup-studio-root-");
    withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "owner", body: "queue 38" }));
    const press = withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "owner", body: "pressed: Queue", pressed: { seq: 1, index: 0, kind: "queue" } }));
    const before = readFileSync(join(root, "_bmad-output", "tracking", "studio-chat.jsonl"), "utf-8").split("\n")[0];
    expect(withStudioLock(root, () => markUnqueuedHeld(root, press.seq))).toBe(true);
    expect(withStudioLock(root, () => markUnqueuedHeld(root, 99))).toBe(false);
    const text = readFileSync(join(root, "_bmad-output", "tracking", "studio-chat.jsonl"), "utf-8");
    expect(text.split("\n")[0]).toBe(before);
    expect(readStudioChat(root)[1]).toEqual({ ...press, unqueued: true });
    // a marked press line stays a press line: never a pending turn
    expect(pendingTurns(readStudioChat(root)).map((l) => l.seq)).toEqual([1]);
    expect(withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "owner", body: "next" })).seq).toBe(3);
  });

  test("a held lock: ChatBusy after the wait (sync and async); a stale one (older than 30 s) is taken over", async () => {
    const root = tempDir("tk-sup-studio-root-");
    const lock = join(root, STUDIO_CHAT_LOCK_REL);
    mkdirSync(join(root, "_bmad-output", "tracking"), { recursive: true });
    writeFileSync(lock, "");
    expect(() => withStudioLock(root, () => 1, 50)).toThrow(StudioChatBusy);
    await expect(withStudioLockAsync(root, () => 1, 50)).rejects.toThrow(/ChatBusy/);
    const old = (Date.now() - STUDIO_LOCK_STALE_MS - 5_000) / 1000;
    utimesSync(lock, old, old);
    expect(withStudioLock(root, () => 7, 50)).toBe(7);
    expect(existsSync(lock)).toBe(false);
  });
});

describe("the queueing helpers (Settled shapes 5, 10: the fixtures shared with the web's model.test.ts)", () => {
  test("excerpt: whitespace collapsed and trimmed; past 40 code points cut with …", () => {
    expect(excerpt("  what   is\n running  ")).toBe("what is running");
    expect(excerpt("plan an epic for the export pipeline and the nightly report")).toBe("plan an epic for the export pipeline and…");
    expect(excerpt("x".repeat(40))).toBe("x".repeat(40));
    expect(excerpt("😀".repeat(41))).toBe(`${"😀".repeat(40)}…`);
    expect(behindNote("what is running")).toBe("Queued behind the reply to 'what is running'");
  });

  test("pendingTurns: owner lines with no press and no reply naming them, by seq", () => {
    const lines: StudioLine[] = [owner(1, "a"), planner(2, 1), owner(3, "b"),
      { seq: 4, at: AT, author: "owner", body: "pressed: X", pressed: { seq: 2, index: 0, kind: "open" } }, owner(5, "c")];
    expect(pendingTurns(lines).map((l) => l.seq)).toEqual([3, 5]);
    expect(pendingTurns([...lines, planner(6, 3)]).map((l) => l.seq)).toEqual([5]);
  });

  test("findProposal: the reply's proposal at index, else null", () => {
    const lines: StudioLine[] = [owner(1, "a"), { ...planner(2, 1), proposals: [{ kind: "queue", label: "Q", project: "p", job: "j" }] }];
    expect(findProposal(lines, 2, 0)).toEqual({ kind: "queue", label: "Q", project: "p", job: "j" });
    expect(findProposal(lines, 2, 1)).toBeNull();
    expect(findProposal(lines, 1, 0)).toBeNull();
  });

  test("checkStudioChatBody: text or pressed, exactly one; LineTooLong by code points", () => {
    expect(checkStudioChatBody({ project: "p", text: "hi" })).toEqual({ ok: true, kind: "text", project: "p", text: "hi" });
    expect(checkStudioChatBody({ project: "p", pressed: { seq: 2, index: 0 } })).toEqual({ ok: true, kind: "pressed", project: "p", pressed: { seq: 2, index: 0 } });
    expect(checkStudioChatBody({ project: "p", text: "😀".repeat(LINE_MAX_CHARS) }).ok).toBe(true);
    expect(checkStudioChatBody({ project: "p", text: "😀".repeat(LINE_MAX_CHARS + 1) })).toMatchObject({ ok: false, error: "LineTooLong", limit: 4000, length: 4001 });
    for (const bad of [{ project: "p" }, { project: "p", text: "x", pressed: { seq: 1, index: 0 } }, { project: "p", text: " " }, { project: "p", pressed: { seq: 0, index: 0 } },
      { project: "p", pressed: { seq: 1, index: -1 } }, { project: "p", pressed: { seq: 1, index: 0, kind: "x" } }, { text: "x" }, [], null]) {
      expect(checkStudioChatBody(bad)).toMatchObject({ ok: false, error: "SchemaError" });
    }
  });
});

describe("the turn (Settled shape 7)", () => {
  test("mintStudioTurn: host, the planner leg, stacked on `<lock checkout>#studio-chat`, the payload, chat-queued {chat: studio, …, behind}", () => {
    const root = tempDir("tk-sup-studio-root-");
    mkdirSync(join(root, ".bmad-loop"), { recursive: true });
    writeFileSync(join(root, ".bmad-loop", "routing.current.json"), JSON.stringify({ planner: { model: "claude-opus-5-5", effort: "high" } }));
    const q = newQueue();
    const a = mintStudioTurn(q, { ...prepared(root), where: { lockCheckout: "/the/checkout" } }, { project: "p", root, seq: 1, behind: null });
    const b = mintStudioTurn(q, { ...prepared(root), where: { lockCheckout: "/the/checkout" } }, { project: "p", root, seq: 2, behind: a.run_id });
    expect(q.get(a.run_id)).toMatchObject({ job_id: STUDIO_CHAT_JOB, tier: "host", model: "claude-opus-5-5", effort: "high", lock_checkout: "/the/checkout#studio-chat" });
    expect(q.runPayload(b.run_id)).toEqual({ project: "p", project_root: root, seq: 2 });
    expect(q.serviceEvents("chat-queued").map((e) => e.detail)).toEqual([
      { chat: "studio", project: "p", seq: 1, run_id: a.run_id, model: "claude-opus-5-5", effort: "high", behind: null },
      { chat: "studio", project: "p", seq: 2, run_id: b.run_id, model: "claude-opus-5-5", effort: "high", behind: a.run_id },
    ]);
  });
});

describe("the tap (Settled shape 6)", () => {
  const tapped = (o: { now?: () => number; throttleMs?: number } = {}) => {
    const root = tempDir("tk-sup-studio-tap-");
    const scheduled: { fn: () => void; ms: number }[] = [];
    const tap = studioChatTap(root, "run-1", { ...o, schedule: (fn, ms) => { scheduled.push({ fn, ms }); return () => { const i = scheduled.findIndex((s) => s.fn === fn); if (i >= 0) scheduled.splice(i, 1); }; } });
    return { root, tap, scheduled, text: () => readStream(root, "run-1") };
  };

  test("chunks split mid-line, `<reply>` across chunks, the text between the markers only, a held `</reply>` prefix", () => {
    const fx = tapped({ throttleMs: 0 });
    const ndjson = sj("Let me read the board.\n<re") + sj("ply>Two runs") + sj(" are live.</") + sj("rep") + sj("ly>\nafter");
    // fed in 7-character pieces: every line split mid-way
    for (let i = 0; i < ndjson.length; i += 7) fx.tap.write(ndjson.slice(i, i + 7));
    fx.tap.close();
    expect(fx.text()).toBe("Two runs are live.");
    expect(replyText("<reply>abc</rep")).toBe("abc");
    expect(replyText("<reply>abc</repX")).toBe("abc</repX");
    expect(replyText("no marker")).toBeNull();
  });

  test("sub-agent, thinking and tool deltas, and the whole messages, are ignored", () => {
    const fx = tapped({ throttleMs: 0 });
    fx.tap.write(sj("<reply>A"));
    fx.tap.write(sj("SUB", { parent: "toolu_1" }));
    fx.tap.write(sj("THINK", { delta: "thinking" }));
    fx.tap.write(sj("{\"x\":", { delta: "tool" }));
    fx.tap.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "<reply>WHOLE" }] } }) + "\n");
    fx.tap.write(JSON.stringify({ type: "result", result: "<reply>RESULT</reply>", total_cost_usd: 0.1 }) + "\n");
    fx.tap.write("not json\n");
    fx.tap.write(sj("B"));
    fx.tap.close();
    expect(fx.text()).toBe("AB");
    expect(textDelta(JSON.parse(sj("x", { parent: "t" })))).toBeNull();
  });

  test("the throttle: at most every 250 ms by the injected clock (a deferred flush scheduled), and the close() flush", () => {
    let t = 1_000;
    const fx = tapped({ now: () => t });
    fx.tap.write(sj("<reply>one"));
    expect(fx.text()).toBe("one");
    t += 100;
    fx.tap.write(sj(" two"));
    expect(fx.text()).toBe("one");
    expect(fx.scheduled).toHaveLength(1);
    expect(fx.scheduled[0]!.ms).toBe(150);
    t += 100;
    fx.tap.write(sj(" three"));
    expect(fx.scheduled).toHaveLength(1); // one deferred flush pending, never a second
    t += 60;
    fx.scheduled.shift()!.fn();
    expect(fx.text()).toBe("one two three");
    t += 10;
    fx.tap.write(sj(" four"));
    expect(fx.text()).toBe("one two three");
    fx.tap.close();
    expect(fx.text()).toBe("one two three four");
    expect(fx.scheduled).toHaveLength(0);
  });

  test("a tap error never reaches the worker: an unwritable stream path is swallowed", () => {
    const root = tempDir("tk-sup-studio-tap-");
    writeFileSync(join(root, "_bmad-output"), "a file where the folder should be");
    const tap = studioChatTap(root, "run-1", { throttleMs: 0 });
    expect(() => { tap.write(sj("<reply>x")); tap.close(); }).not.toThrow();
  });

  test("runProcess hands each stdout chunk to onStdout; a throwing tap leaves the result whole", async () => {
    const dir = tempDir("tk-sup-studio-proc-");
    const bin = fakeBin(join(dir, "talk.js"), `process.stdout.write("a\\n"); setTimeout(() => process.stdout.write("b\\n"), 20);`);
    const seen: string[] = [];
    const res = await runProcess(bin, [], { timeoutS: 10, onStdout: (c) => { seen.push(c); throw new Error("tap broke"); } });
    expect(res.stdout).toBe("a\nb\n");
    expect(seen.join("")).toBe("a\nb\n");
  });

  test("deltaFrame: `event: chat-delta`, data {run_id, reply_to, from, text}, no id: line", () => {
    expect(deltaFrame({ run_id: "r", reply_to: 3, from: 4, text: "more" }))
      .toBe(`event: chat-delta\ndata: {"run_id":"r","reply_to":3,"from":4,"text":"more"}\n\n`);
  });
});

describe("the worker (Settled shape 6)", () => {
  test("buildWorkerCommand: stream-json with --verbose --include-partial-messages for the studio chat; json unchanged for every other job", () => {
    const stream = buildWorkerCommand({ prompt: "/tk-studio:tk-studio-engage {}", bin: "claude", outputFormat: "stream-json", model: "m", effort: "high", sessionId: "s1" });
    expect(stream.argv).toEqual(["-p", "/tk-studio:tk-studio-engage {}", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--permission-mode", "auto", "--model", "m", "--effort", "high", "--session-id", "s1"]);
    const plain = buildWorkerCommand({ prompt: "x", bin: "claude" });
    expect(plain.argv).toEqual(["-p", "x", "--output-format", "json", "--permission-mode", "auto"]);
  });

  test("parseWorkerResult on an NDJSON stdout: the last object, the result line, is read unchanged", () => {
    const block = { status: "complete", intent: "tk-studio-engage", artifacts: [], reason: null };
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      sj("<reply>hi</reply>").trim(),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "<reply>hi</reply>" }] } }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: `<reply>hi</reply>\n${JSON.stringify(block)}`, total_cost_usd: 0.12, session_id: "s1", num_turns: 3, usage: { input_tokens: 5 } }),
    ].join("\n") + "\n";
    const r = parseWorkerResult(ndjson);
    expect(r).toMatchObject({ isError: false, totalCostUsd: 0.12, sessionId: "s1", numTurns: 3, usage: { input_tokens: 5 } });
    expect(r.text.endsWith(JSON.stringify(block))).toBe(true);
  });
});

describe("the passes (Settled shapes 7, 9)", () => {
  test("studioChatPass: a terminal run with no reply gets the failure reply once; its stream and reads files are removed; idempotent", () => {
    const root = tempDir("tk-sup-studio-root-");
    const q = newQueue();
    withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "owner", body: "what is running" }));
    const a = mintStudioTurn(q, prepared(root), { project: "p", root, seq: 1, behind: null });
    withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "owner", body: "and the cost?" }));
    const b = mintStudioTurn(q, prepared(root), { project: "p", root, seq: 2, behind: a.run_id });
    writeReads(root, 1, { at: AT });
    writeReads(root, 2, { at: AT });
    mkdirSync(join(root, "_bmad-output", "tracking", "studio-chat-stream"), { recursive: true });
    writeFileSync(streamFile(root, a.run_id), "partial");
    // a still queued: nothing happens
    expect(studioChatPass(q)).toEqual({ failed: [], cleaned: [] });
    q.end(a.run_id, "blocked", "worker died\nwith a second line");
    const first = studioChatPass(q, { now: () => Date.parse(AT) });
    expect(first.failed).toEqual([a.run_id]);
    expect(readStudioChat(root).at(-1)).toEqual({
      seq: 3, at: AT, author: "planner", body: "No reply: the run ended blocked: worker died with a second line", run_id: a.run_id, reply_to: 1, proposals: [], failed: true,
    });
    expect(existsSync(streamFile(root, a.run_id))).toBe(false);
    expect(existsSync(readsFile(root, 1))).toBe(false);
    expect(existsSync(readsFile(root, 2))).toBe(true); // b still queued
    expect(studioChatPass(q).failed).toEqual([]);
    expect(readStudioChat(root)).toHaveLength(3);
    // b answered by its session, then ended: no failure reply, only its files removed
    withStudioLock(root, () => appendStudioLineHeld(root, { at: AT, author: "planner", body: "$0.42", run_id: b.run_id, reply_to: 2, proposals: [] }));
    q.end(b.run_id, "complete", null as unknown as string);
    expect(studioChatPass(q)).toEqual({ failed: [], cleaned: [b.run_id] });
    expect(readStudioChat(root)).toHaveLength(4);
    expect(existsSync(readsFile(root, 2))).toBe(false);
    expect(failureBody("partial", "x".repeat(300)).length).toBe("No reply: the run ended partial: ".length + 200);
  });

  test("the quiet end: a studio-chat run's end records notify-skipped and sends no line (a configured notifier, a fake fetch)", async () => {
    const root = tempDir("tk-sup-studio-root-");
    const q = newQueue();
    const { run_id } = mintStudioTurn(q, prepared(root), { project: "p", root, seq: 1, behind: null });
    q.end(run_id, "complete", "done");
    const calls: unknown[] = [];
    const fetchFn = (async (...a: unknown[]) => { calls.push(a); return new Response("ok"); }) as unknown as typeof fetch;
    await endHygiene(q, q.get(run_id)!, { env: { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" }, fetch: fetchFn });
    expect(calls).toEqual([]);
    expect(q.events(run_id).find((e) => e.kind === "notify-skipped")!.detail).toEqual({ why: STUDIO_CHAT_QUIET });
    expect(STUDIO_CHAT_QUIET).toBe("a studio-chat turn answers in the page (Story 39.3)");
  });

  test("the invoke's run_id: a studio-chat run keeps the queue run id, streams (stream-json) and its tap writes the served root's stream file", async () => {
    const root = tempDir("tk-sup-studio-root-");
    const workRoot = tempDir("tk-sup-studio-wt-");
    const block = { status: "complete", intent: "tk-studio-engage", artifacts: [], reason: null };
    const QUEUE_RUN = "studio-chat-20261110T050000Z-queue";
    const STUDIO = "studio-chat-20261110T050000Z-studio";
    const seen: { root: string; payload: Record<string, any>; opts: Record<string, any> }[] = [];
    const invoke = async (r: string, _skill: string, args: Record<string, any>, _sp: unknown, o: Record<string, any>) => {
      seen.push({ root: r, payload: args.payload as Record<string, any>, opts: o });
      o.onStdout?.(sj("<reply>Two runs.</reply>"));
      return { ran: true, exit: 0, status_block: block } as any;
    };
    const payload = { verb: "studio-reply", project: "p", project_root: root, seq: 1, run_id: QUEUE_RUN };
    const started: Started = {
      jobId: STUDIO_CHAT_JOB, root, projectId: "p", runId: STUDIO, guardS: 600, defn: structuredClone(STUDIO_JOB),
      woke: { accepted: true, run_id: STUDIO, state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-engage", payload } },
      workRoot, tier: "host",
    };
    const summary = await finishRun(started, async () => ({ ok: true }), invoke as any);
    expect(summary).toMatchObject({ run_id: STUDIO, status_block: block });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.root).toBe(workRoot);
    expect(seen[0]!.payload.run_id).toBe(QUEUE_RUN);
    expect(seen[0]!.opts.outputFormat).toBe("stream-json");
    expect(readStream(root, QUEUE_RUN)).toBe("Two runs.");
    expect(existsSync(streamFile(workRoot, QUEUE_RUN))).toBe(false);
    // any other job: json (no outputFormat), no tap
    const other: Started = { ...started, jobId: "studio-health", runId: "studio-health-r1", defn: { id: "studio-health", trigger: "one-shot", target: { skill: "tk-studio-activate" } },
      woke: { accepted: true, run_id: "studio-health-r1", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: { run_id: "queue-id" } } } };
    await finishRun(other, async () => ({ ok: true }), invoke as any);
    expect(seen[1]!.payload.run_id).toBe("studio-health-r1");
    expect(seen[1]!.opts.outputFormat).toBeUndefined();
    expect(seen[1]!.opts.onStdout).toBeUndefined();
  });

  test("a resumed studio-chat worker (a silent exit, then the resume) keeps the run's one tap: the stream file only grows", async () => {
    const root = tempDir("tk-sup-studio-root-");
    const cfg = tempDir("tk-sup-studio-cfg-");
    const prevCfg = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = cfg;
    try {
      const QUEUE_RUN = "studio-chat-20261110T060000Z-queue";
      const STUDIO = "studio-chat-20261110T060000Z-studio";
      const SID = "0b7c1f7e-9a55-4d4e-8f4c-2d6f3f0c9e12";
      const block = { status: "complete", intent: "tk-studio-engage", artifacts: [], reason: null };
      const lengths: number[] = [];
      let n = 0;
      const invoke = async (_r: string, _skill: string, _args: Record<string, any>, _sp: unknown, o: Record<string, any> = {}) => {
        o.beforeSpawn?.();
        o.onSpawn?.(2000 + n);
        const path = join(cfg, "projects", "slug", `${SID}.jsonl`);
        mkdirSync(join(cfg, "projects", "slug"), { recursive: true });
        writeFileSync(path, (existsSync(path) ? readFileSync(path, "utf-8") : "") + JSON.stringify({ type: "assistant", message: { id: `m${++n}`, usage: { input_tokens: 1, output_tokens: 1 } } }) + "\n");
        if (n === 1) {
          o.onStdout?.(sj("<reply>Two runs are live, ")); // the first write flushes at once
          lengths.push(readStream(root, QUEUE_RUN)?.length ?? -1);
          return { ran: true, exit: 0, worker_elapsed_s: 1, session_id: SID, conformance_failure: MISSING_STATUS_BLOCK } as any;
        }
        // the resumed worker carries on (a fresh tap would hold no `<reply>` and drop this, or restart the file shorter)
        o.onStdout?.(sj("and one waits.</reply>"));
        lengths.push(readStream(root, QUEUE_RUN)?.length ?? -1);
        return { ran: true, exit: 0, worker_elapsed_s: 1, session_id: SID, status_block: block } as any;
      };
      let resumes = 0;
      const ids: string[] = [];
      const rec: RunRecorder = {
        session: () => {}, worker: () => {}, accounted: (list) => { ids.push(...list); }, accountedIds: () => [...ids],
        resumes: () => resumes, resumed: () => { resumes++; },
      } as RunRecorder;
      const verbs = async (_root: string, args: string[]): Promise<Record<string, any>> => {
        if (args[0] === "status") return { job_id: STUDIO_CHAT_JOB, runs: [{ run_id: STUDIO, state: "queued" }] };
        if (args[0] === "account") return { within_budget: true, exceeded: [], counters: { turns: 1, tokens: 2 } };
        if (args[0] === "finish") return { run_id: STUDIO, state: args[args.indexOf("--state") + 1] };
        return { ok: true };
      };
      const transcripts: TranscriptChecks = { host: () => ({ restored: false }), sbx: async () => {}, sbxWorkers: async () => ({ ok: true as const, pids: [] as string[] }) } as TranscriptChecks;
      const payload = { verb: "studio-reply", project: "p", project_root: root, seq: 1, run_id: QUEUE_RUN };
      const started: Started = {
        jobId: STUDIO_CHAT_JOB, root, projectId: "p", runId: STUDIO, guardS: 600, jobGuardS: 600, defn: structuredClone(STUDIO_JOB),
        woke: { accepted: true, run_id: STUDIO, state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-engage", payload } },
        tier: "host", sessionId: SID, recorder: rec,
      };
      const summary = await finishRun(started, verbs, invoke as any, undefined, transcripts);
      expect(n).toBe(2);
      expect(summary).toMatchObject({ state: "complete" });
      // the resumed worker's tap never rewrote the file shorter than what the first one wrote
      expect(lengths[0]).toBe("Two runs are live, ".length);
      expect(lengths[1]).toBeGreaterThanOrEqual(lengths[0]!);
      expect(resumes).toBe(1);
      // closed once at the run's end: the whole accumulated text flushed
      expect(readStream(root, QUEUE_RUN)).toBe("Two runs are live, and one waits.");
    } finally {
      if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prevCfg;
    }
  });
});

// The drained lane wait: `runJob` re-validates the stored job (`jobrun.py resolve` over uv, the studio root, a registered
// project), as `drain.test.ts`'s fresh-validate branch does; skipped where those are absent.
const STUDIO_ROOT = process.env.TK_STUDIO_ROOT || resolve(import.meta.dir, "..", "..", "..");
const hasUv = spawnSync("uv", ["--version"]).status === 0;
const studioJobShipped = existsSync(join(STUDIO_ROOT, "plugins", "tk-studio", "jobs", "studio-chat.json"));

describe.skipIf(!process.env.TK_STUDIO_ROOT || !hasUv || !studioJobShipped)("the quiet lane wait (drained, with the studio root and uv)", () => {
  const prev: Record<string, string | undefined> = {};
  const dir = tempDir("tk-sup-studio-bin-");
  const claude = fakeBin(join(dir, "fake-claude.js"), `console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));`);
  const values = () => ({ TK_STUDIO_ROOT: STUDIO_ROOT, TK_STUDIO_HOME: tempDir("tk-sup-studio-store-"), TK_SUPERVISOR_CONFIG: "", CLAUDE_BIN: claude });
  beforeAll(() => { for (const [k, v] of Object.entries(values())) { prev[k] = process.env[k]; process.env[k] = v; } });
  afterAll(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  test("a studio-chat run waiting on its lane records no claim-refused (no notifier line), answers waited: lock", async () => {
    const root = tempDir("tk-sup-studio-proj-");
    const plugin = join(STUDIO_ROOT, "plugins", "tk-studio");
    const reg = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "register", "--directory", root, "--writer", "onboard"],
      { env: process.env, encoding: "utf-8", timeout: 120_000 });
    if (reg.status !== 0) throw new Error(`register failed: ${reg.stdout}${reg.stderr}`);
    // the holder stays live (its owner probe answers alive); the drain's own owner too
    const q = track(new Queue(":memory:", { ownerAlive: () => true, engineLive: async () => ({ live: false }) }));
    const a = mintStudioTurn(q, prepared(root), { project: "p", root, seq: 1, behind: null });
    const b = mintStudioTurn(q, prepared(root), { project: "p", root, seq: 2, behind: a.run_id });
    const holder: Owner = { pid: 940001, host: hostname(), nonce: "studio-holder" };
    expect((await q.claim(a.run_id, holder)).claimed).toBe(true);
    const out = await runJob(STUDIO_CHAT_JOB, root, undefined, { queue: q, runId: b.run_id, skipRecover: true, hygiene: { env: {} }, owner: { pid: process.pid, host: hostname(), nonce: "studio-drain" } });
    expect(out).toMatchObject({ ok: false, state: "queued", waited: "lock" });
    expect((out as any).claim_refused).toBeUndefined();
    expect(q.events(b.run_id).map((e) => e.kind)).not.toContain("claim-refused");
  }, 120_000);
});
