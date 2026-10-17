import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishRun, guardReason, hasTurnTokenGuard, mirror, recoverAfterTimeout, wallClockGuard, type Started, type TimeoutContext } from "../src/cli";
import { Queue } from "../src/queue";
import {
  buildSbxCommand, buildWorkerCommand, invokeSkill, MAX_LOGIN_MISSING, MISSING_STATUS_BLOCK, readProcStatus, runProcess, signalsToHandle,
  type RunResult, type Spawner,
} from "../src/server";
import {
  claudeConfigDir, locateTranscript, parseTranscript, parseTranscripts, resultCounts, transcriptCounts, TranscriptError, usageTokens,
} from "../src/transcript";

// ---------------------------------------------------------------- AC1: the process-tree kill

/** Is `pid` still a live process? A zombie (reaped later by its new parent) counts as gone. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch { return true; } // no /proc (darwin): kill(0) answered
}

describe.skipIf(process.platform === "win32")("wall-clock guard trip kills the whole POSIX process tree (DW-1)", () => {
  test("a worker that spawned a grandchild: both are gone after the trip; the error still reads `timed out`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-tree-"));
    const pidFile = join(dir, "grandchild.pid");
    // The parent shell backgrounds a grandchild `sleep`, records its pid, then waits on it.
    const run = runProcess("sh", ["-c", `sleep 30 & echo $! > '${pidFile}'; wait`], { timeoutS: 1 });
    await expect(run).rejects.toThrow(/timed out/i);
    const grandchild = Number(readFileSync(pidFile, "utf-8").trim());
    expect(grandchild).toBeGreaterThan(0);
    // The group was SIGKILLed; give the reparented grandchild a moment to be reaped.
    const deadline = Date.now() + 3000;
    while (alive(grandchild) && Date.now() < deadline) await Bun.sleep(50);
    const survived = alive(grandchild);
    if (survived) { try { process.kill(grandchild, "SIGKILL"); } catch { /* gone */ } } // our own child only
    expect(survived).toBe(false);
  }, 15_000);
});

describe.skipIf(process.platform !== "win32")("wall-clock guard trip kills the whole win32 process tree (taskkill /F /T; DW-5)", () => {
  test("a worker that spawned a grandchild: both are gone after the trip; the error still reads `timed out`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-tree-"));
    const pidFile = join(dir, "pids.json");
    // The worker (bun) starts a grandchild (bun) that idles, records both pids, then idles itself.
    const worker = join(dir, "worker.js");
    writeFileSync(worker, [
      `const { spawn } = require("node:child_process");`,
      `const gc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });`,
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ worker: process.pid, grandchild: gc.pid }));`,
      `setTimeout(() => {}, 30000);`,
    ].join("\n"));
    const run = runProcess(process.execPath, [worker], { timeoutS: 3 });
    await expect(run).rejects.toThrow(/timed out/i);
    const pids = JSON.parse(readFileSync(pidFile, "utf-8")) as { worker: number; grandchild: number };
    expect(pids.worker).toBeGreaterThan(0);
    expect(pids.grandchild).toBeGreaterThan(0);
    const deadline = Date.now() + 3000;
    while ((alive(pids.worker) || alive(pids.grandchild)) && Date.now() < deadline) await Bun.sleep(50);
    const survivors = [pids.worker, pids.grandchild].filter(alive);
    for (const pid of survivors) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } // our own test's processes only
    expect(survivors).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------- guard reasons

describe("guard reasons name the bound that actually tripped", () => {
  test("wallClockGuard: the job guard when uncapped, the tick's cap when it bounds", () => {
    expect(wallClockGuard(600, 600)).toEqual({ guard: "max_wall_clock_seconds", value: 600 });
    expect(wallClockGuard(7200, 3600)).toEqual({ guard: "--timeout-cap-s", value: 3600 });
    expect(wallClockGuard(undefined, 900)).toEqual({ guard: "max_wall_clock_seconds", value: 900 });
    expect(guardReason([{ guard: "max_wall_clock_seconds", value: 600 }])).toBe("guard: max_wall_clock_seconds (600s)");
    expect(guardReason([{ guard: "max_turns", value: 40 }, { guard: "max_tokens", value: 1000 }]))
      .toBe("guard: max_turns (40); guard: max_tokens (1000)");
  });
});

// ---------------------------------------------------------------- finishRun: wall clock + account (AC1, AC2)

const RUN_ID = "s-20260928T101010Z";
const BLOCK = { status: "complete", intent: "tk-studio-activate", artifacts: [] };
const woke = { accepted: true, run_id: RUN_ID, state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: {} } };
const started = (guards: Record<string, number>, extra: Partial<Started> = {}): Started => ({
  jobId: "s", root: "proj", projectId: "p", runId: RUN_ID, guardS: guards.max_wall_clock_seconds ?? 600,
  jobGuardS: guards.max_wall_clock_seconds ?? 600,
  defn: { id: "s", trigger: "one-shot", target: { skill: "tk-studio-activate" }, guards }, woke, ...extra,
});

/** A transcript for `sessionId` under a fresh config dir, pointed at by CLAUDE_CONFIG_DIR while `fn` runs. */
async function withTranscript<T>(sessionId: string | null, lines: unknown[], fn: () => Promise<T>): Promise<T> {
  const cfg = mkdtempSync(join(tmpdir(), "tk-sup-claude-cfg-"));
  if (sessionId) {
    mkdirSync(join(cfg, "projects", "some-slug"), { recursive: true });
    writeFileSync(join(cfg, "projects", "some-slug", `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try { return await fn(); }
  finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
}

const assistant = (id: string, usage: Record<string, number>) => ({ type: "assistant", message: { id, usage } });
const THREE_TURNS = [
  { type: "user", message: { content: "go" } },
  assistant("m1", { input_tokens: 100, output_tokens: 10 }),
  assistant("m1", { input_tokens: 100, output_tokens: 20 }), // same message, a later content block: counted once
  assistant("m2", { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 50, cache_read_input_tokens: 500 }),
  assistant("m3", { input_tokens: 1, output_tokens: 1 }),
];
const THREE_TURNS_TOKENS = 120 + 560 + 2;

/** Drives finishRun with a fake invoker answering `out` and a verb runner answering `account` with `acct`;
 * `elapsedS` is what the injected clock says the invocation took (default: none). */
async function drive(
  s: Started, out: Record<string, unknown> | (() => never), acct: Record<string, unknown> | (() => never) = { within_budget: true, exceeded: [] },
  elapsedS = 0,
) {
  const verbs: string[][] = [];
  let nowMs = 1_000_000;
  const summary = await finishRun(s, async (_root, args) => {
    verbs.push(args);
    if (args[0] === "account") return typeof acct === "function" ? acct() : acct;
    return { ok: true };
  }, async () => { nowMs += elapsedS * 1000; return typeof out === "function" ? out() : out; }, () => nowMs);
  return { summary, verbs, finish: verbs.find((v) => v[0] === "finish")!, account: verbs.find((v) => v[0] === "account") };
}
const flag = (argv: string[], f: string) => argv[argv.indexOf(f) + 1];

describe("finishRun: the wall-clock guard trip", () => {
  const timedOut = () => { throw new Error("claude timed out after 300s (process tree killed); stdout tail: "); };

  test("the job guard trips → partial naming max_wall_clock_seconds and its value", async () => {
    const { summary, finish } = await drive(started({ max_wall_clock_seconds: 600 }), timedOut);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe("guard: max_wall_clock_seconds (600s)");
    expect(summary).toMatchObject({ state: "partial", guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }] });
  });

  test("the tick's cap trips (cap < job guard) → partial naming the cap, not the job guard", async () => {
    const { finish } = await drive(started({ max_wall_clock_seconds: 7200 }, { guardS: 300 }), timedOut);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe("guard: --timeout-cap-s (300s)");
  });

  test("a timed-out iteration is not accounted (no transcript read, no `account`)", async () => {
    const { account } = await drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }), timedOut);
    expect(account).toBeUndefined();
  });
});

describe("finishRun: turns/tokens accounted after each iteration (AC2)", () => {
  test("budget ok: `account --turns 3 --tokens T` from the transcript, before finish; finish per the status block", async () => {
    const { summary, verbs, account, finish } = await withTranscript("sess-ok", THREE_TURNS, () =>
      drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }), { status_block: BLOCK, session_id: "sess-ok" }));
    expect(account).toEqual(["account", "--directory", "proj", "--run-id", RUN_ID, "--turns", "3", "--tokens", String(THREE_TURNS_TOKENS)]);
    expect(verbs.findIndex((v) => v[0] === "account")).toBeLessThan(verbs.findIndex((v) => v[0] === "finish"));
    expect(flag(finish, "--state")).toBe("complete");
    expect(summary).toMatchObject({ ok: true, state: "complete", account: { turns: 3, tokens: THREE_TURNS_TOKENS, within_budget: true } });
  });

  test("budget exceeded: within_budget false → partial naming the guard and its value; the block is still recorded", async () => {
    const { summary, finish } = await withTranscript("sess-x", THREE_TURNS, () =>
      drive(started({ max_wall_clock_seconds: 600, max_tokens: 500 }), { status_block: BLOCK, session_id: "sess-x" },
        { within_budget: false, exceeded: ["max_tokens"] }));
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe("guard: max_tokens (500)");
    expect(JSON.parse(flag(finish, "--status-block"))).toEqual(BLOCK);
    expect(summary).toMatchObject({ ok: false, state: "partial", guards_tripped: [{ guard: "max_tokens", value: 500 }] });
  });

  test("every exceeded guard is named", async () => {
    const { finish } = await withTranscript("sess-2", THREE_TURNS, () =>
      drive(started({ max_wall_clock_seconds: 600, max_turns: 2, max_tokens: 500 }), { status_block: BLOCK, session_id: "sess-2" },
        { within_budget: false, exceeded: ["max_turns", "max_tokens"] }));
    expect(flag(finish, "--reason")).toBe("guard: max_turns (2); guard: max_tokens (500)");
  });

  test("no turn/token guard → `account` is not called", async () => {
    const { verbs, finish } = await drive(started({ max_wall_clock_seconds: 600 }), { status_block: BLOCK, session_id: "whatever" });
    expect(verbs.some((v) => v[0] === "account")).toBe(false);
    expect(flag(finish, "--state")).toBe("complete");
  });

  test("transcript missing → partial naming the account failure; `account` never called with guessed counts", async () => {
    const { verbs, finish } = await withTranscript(null, [], () =>
      drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }), { status_block: BLOCK, session_id: "sess-missing" }));
    expect(verbs.some((v) => v[0] === "account")).toBe(false);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toStartWith("guard: account failed — transcript for session sess-missing not found");
  });

  test("transcript ambiguous (two matches) → partial naming it", async () => {
    const { finish } = await withTranscript("sess-dup", THREE_TURNS, async () => {
      const cfg = process.env.CLAUDE_CONFIG_DIR!;
      mkdirSync(join(cfg, "projects", "other-slug"), { recursive: true });
      writeFileSync(join(cfg, "projects", "other-slug", "sess-dup.jsonl"), "");
      return drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }), { status_block: BLOCK, session_id: "sess-dup" });
    });
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toContain("ambiguous: 2 matches");
  });

  test("a failed `account` (refusal) is named in the finish reason, never swallowed", async () => {
    const { finish } = await withTranscript("sess-r", THREE_TURNS, () =>
      drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }), { status_block: BLOCK, session_id: "sess-r" },
        { ok: false, error: "run 's-1' already ended cancelled" }));
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe("guard: account failed — account: run 's-1' already ended cancelled");
  });

  test("sbx tier: counts from the worker result's num_turns/usage (the transcript is inside the microVM)", async () => {
    const { account } = await withTranscript(null, [], () =>
      drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }, { tier: "sbx", sandbox: "claude-p" }),
        { status_block: BLOCK, session_id: "in-vm", num_turns: 7, usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 10 } }));
    expect(account!.slice(-4)).toEqual(["--turns", "7", "--tokens", "17"]);
  });

  test("a preflight-blocked invocation (no worker ran) is not accounted", async () => {
    const { verbs } = await drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }),
      { ran: false, status_block: { status: "blocked", intent: "tk-studio-activate", artifacts: [], reason: "auth preflight" } });
    expect(verbs.some((v) => v[0] === "account")).toBe(false);
  });
});

// ---------------------------------------------------------------- transcript parser + locator

describe("transcript: turns and tokens", () => {
  test("turns = distinct assistant message ids; tokens = the four usage fields over distinct messages", () => {
    expect(parseTranscript(THREE_TURNS.map((l) => JSON.stringify(l)).join("\n"))).toEqual({ turns: 3, tokens: THREE_TURNS_TOKENS });
  });

  test("non-assistant entries, id-less messages and unparseable lines are skipped", () => {
    const text = [
      JSON.stringify({ type: "user", message: { id: "u1", usage: { input_tokens: 999 } } }),
      "not json {",
      JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 999 } } }),
      JSON.stringify(assistant("a", { input_tokens: 2, output_tokens: 3 })),
      "",
    ].join("\r\n");
    expect(parseTranscript(text)).toEqual({ turns: 1, tokens: 5 });
    expect(parseTranscript("")).toEqual({ turns: 0, tokens: 0 });
  });

  test("usageTokens ignores missing and non-numeric fields", () => {
    expect(usageTokens({ input_tokens: 1, output_tokens: "2", cache_read_input_tokens: 4, service_tier: "x" })).toBe(5);
    expect(usageTokens(undefined)).toBe(0);
  });

  test("resultCounts: the sbx result's num_turns and usage; absent → named", () => {
    expect(resultCounts({ num_turns: 2, usage: { input_tokens: 1, output_tokens: 1 } })).toEqual({ turns: 2, tokens: 2 });
    expect(() => resultCounts({ usage: {} })).toThrow(TranscriptError);
    expect(() => resultCounts({ num_turns: 1 })).toThrow(/no usage/);
  });

  test("locateTranscript: exactly one projects/*/<session>.jsonl; none, several or a path-like id → named", () => {
    const cfg = mkdtempSync(join(tmpdir(), "tk-sup-loc-"));
    expect(() => locateTranscript("s1", cfg)).toThrow(TranscriptError);
    mkdirSync(join(cfg, "projects", "a"), { recursive: true });
    writeFileSync(join(cfg, "projects", "a", "s1.jsonl"), "");
    expect(locateTranscript("s1", cfg)).toBe(join(cfg, "projects", "a", "s1.jsonl"));
    mkdirSync(join(cfg, "projects", "b"), { recursive: true });
    writeFileSync(join(cfg, "projects", "b", "s1.jsonl"), "");
    expect(() => locateTranscript("s1", cfg)).toThrow(/ambiguous/);
    expect(() => locateTranscript("../s1", cfg)).toThrow(/not a plain id/);
  });

  /** A config dir holding the parent transcript and, optionally, `<session>/subagents/` files. */
  const sessionTree = (sessionId: string, parent: unknown[], subagents?: Record<string, unknown[]>) => {
    const cfg = mkdtempSync(join(tmpdir(), "tk-sup-subagents-"));
    const slug = join(cfg, "projects", "slug");
    mkdirSync(slug, { recursive: true });
    const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    writeFileSync(join(slug, `${sessionId}.jsonl`), jsonl(parent));
    if (subagents) {
      const sub = join(slug, sessionId, "subagents");
      mkdirSync(sub, { recursive: true });
      for (const [name, lines] of Object.entries(subagents)) writeFileSync(join(sub, name), jsonl(lines));
    }
    return { cfg, sub: join(slug, sessionId, "subagents") };
  };

  test("subagents: the parent plus every `<session>/subagents/*.jsonl` are summed (meta.json ignored)", () => {
    const { cfg, sub } = sessionTree("sess-fan", THREE_TURNS, {
      "agent-a.jsonl": [assistant("a1", { input_tokens: 10, output_tokens: 1 }), assistant("a2", { input_tokens: 20 })],
      "agent-b.jsonl": [{ type: "user", message: { content: "x" } }, assistant("b1", { output_tokens: 7 })],
      "agent-a.meta.json": [assistant("zz", { input_tokens: 999 })],
    });
    mkdirSync(join(sub, "nested.jsonl", "deeper"), { recursive: true }); // not recursive: a directory is not a transcript
    expect(transcriptCounts("sess-fan", cfg)).toEqual({ turns: 3 + 3, tokens: THREE_TURNS_TOKENS + 11 + 20 + 7 });
  });

  test("subagents: no subagents directory → the parent's counts alone", () => {
    const { cfg } = sessionTree("sess-solo", THREE_TURNS);
    expect(transcriptCounts("sess-solo", cfg)).toEqual(parseTranscript(THREE_TURNS.map((l) => JSON.stringify(l)).join("\n")));
    expect(transcriptCounts("sess-solo", cfg)).toEqual({ turns: 3, tokens: THREE_TURNS_TOKENS });
  });

  test("subagents: a message id present in two files is counted once", () => {
    const { cfg } = sessionTree("sess-dup", THREE_TURNS, {
      "agent-a.jsonl": [assistant("m2", { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 50, cache_read_input_tokens: 500 }), assistant("a1", { input_tokens: 4 })],
    });
    expect(transcriptCounts("sess-dup", cfg)).toEqual({ turns: 4, tokens: THREE_TURNS_TOKENS + 4 });
    expect(parseTranscripts(["", JSON.stringify(assistant("x", { input_tokens: 1 })), JSON.stringify(assistant("x", { input_tokens: 1 }))]))
      .toEqual({ turns: 1, tokens: 1 });
  });

  test.skipIf(process.platform === "win32")("subagents: an unreadable subagent file is a named TranscriptError", () => {
    const { cfg, sub } = sessionTree("sess-bad", THREE_TURNS, { "agent-a.jsonl": [] });
    symlinkSync(join(sub, "missing-target"), join(sub, "agent-dangling.jsonl"));
    expect(() => transcriptCounts("sess-bad", cfg)).toThrow(TranscriptError);
    expect(() => transcriptCounts("sess-bad", cfg)).toThrow(/agent-dangling\.jsonl unreadable/);
  });

  test("the config dir: CLAUDE_CONFIG_DIR, else ~/.claude", () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "cfg" }, "home")).toBe("cfg");
    expect(claudeConfigDir({}, "home")).toBe(join("home", ".claude"));
  });
});

// ---------------------------------------------------------------- sbx in-VM guard

describe("sbx: the in-VM wall-clock guard rides the argv (no shell)", () => {
  test("buildSbxCommand puts `timeout -k <s> <guardS>` before `env`; the prompt stays one argv item", () => {
    const prompt = "p; $(rm -rf /)\nline 2";
    const cmd = buildSbxCommand({ sandbox: "sb", vmRoot: "/vm/p", worker: buildWorkerCommand({ prompt, tier: "sbx" }), guardS: 450 });
    expect(cmd.argv.slice(0, 7)).toEqual(["exec", "sb", "timeout", "-k", "10", "450", "env"]);
    expect(cmd.argv.filter((a) => a === prompt)).toHaveLength(1);
    expect(cmd.argv).not.toContain("sh");
    expect(cmd.argv).not.toContain("bash");
  });

  test("invokeSkill passes its timeout (the guard) to the in-VM `timeout`", async () => {
    const root = mkdtempSync(join(tmpdir(), "tk-sup-sbx-guard-"));
    const calls: string[][] = [];
    const spawner: Spawner = async (_cmd, args): Promise<RunResult> => {
      calls.push(args);
      if (args.includes("auth")) return { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) };
      return { exit: 0, stderr: "", stdout: JSON.stringify({ result: JSON.stringify(BLOCK), is_error: false, session_id: "s", num_turns: 1, usage: {} }) };
    };
    const out = await invokeSkill(root, "tk-studio-activate", { tier: "sbx", sandbox: "sb", timeout_s: 321 }, spawner);
    expect(out).toMatchObject({ session_id: "s", num_turns: 1, usage: {} });
    const worker = calls.find((a) => a.includes("-p"))!;
    expect(worker.slice(0, 7)).toEqual(["exec", "sb", "timeout", "-k", "10", "321", "env"]);
  });
});

// ---------------------------------------------------------------- core backstop trip (AC1 on a core run)

describe("core run: the verb backstop trips → studio run cancelled, queue run partial naming the guard", () => {
  test("cancel, never finish; the queue run ends partial with the guard in its reason and its `ended` event", async () => {
    const calls: string[][] = [];
    let studioState = "running";
    const runner = async (_root: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "status") return { runs: [{ run_id: "c-20260928T101010Z", state: studioState }] };
      if (args[0] === "cancel") { studioState = "cancelled"; return { cancelled: true, runs_ended: ["c-20260928T101010Z"] }; }
      throw new Error(`unexpected verb ${args[0]}`);
    };
    const ctx: TimeoutContext = { root: "proj", projectId: "p", target: "core", verb: "wake", timeoutS: 720, jobGuardS: 600, before: new Set() };
    const summary = await recoverAfterTimeout("c", "uv timed out after 720s (process tree killed)", ctx, runner);
    expect(calls.some((c) => c[0] === "finish")).toBe(false);
    expect(calls.some((c) => c[0] === "cancel")).toBe(true);
    expect(summary).toMatchObject({ ok: false, target: "core", state: "partial", guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }] });
    expect(summary.reason).toStartWith("guard: max_wall_clock_seconds (600s)");
    expect(summary.reason).toContain("studio run cancelled");

    // Mirrored into the queue: partial, the guard in reason and in the ended event.
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-guard-q-"));
    const checkout = mkdtempSync(join(tmpdir(), "tk-sup-guard-co-"));
    const q = new Queue(join(dir, "q.db"), { ownerAlive: () => true, engineLive: async () => ({ live: false }) });
    try {
      const defn = { id: "c", trigger: "loop", target: { core: "x" }, guards: { max_wall_clock_seconds: 600 }, stop: { max_runs: 5 } };
      const { run } = q.enqueue({ jobId: "c", root: checkout, target: "core", definition: defn });
      const mirrored = await mirror(q, run.run_id, { jobId: "c", defn }, summary);
      expect(mirrored.run_id).toBe(run.run_id);
      const ended = q.get(run.run_id)!;
      expect(ended.state).toBe("partial");
      expect(ended.reason).toStartWith("guard: max_wall_clock_seconds (600s)");
      const ev = q.events(run.run_id).find((e) => e.kind === "ended")!;
      expect(ev.to_state).toBe("partial");
      expect(ev.detail).toMatchObject({ reason: ended.reason, guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }] });
    } finally { q.close(); }
  });

  test("a skill run's verb timeout: finished partial, the reason naming the guard backstop; the queue run ends partial", async () => {
    const calls: string[][] = [];
    let studioState = "queued";
    const runner = async (_root: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "status") return { runs: [{ run_id: "s-20260928T101010Z", state: studioState }] };
      if (args[0] === "finish") { studioState = flag(args, "--state")!; return { run_id: "s-20260928T101010Z", state: studioState }; }
      throw new Error(`unexpected verb ${args[0]}`);
    };
    const ctx: TimeoutContext = { root: "proj", projectId: "p", target: "skill", verb: "submit", timeoutS: 720, jobGuardS: 600, before: new Set() };
    const summary = await recoverAfterTimeout("s", "uv timed out after 720s", ctx, runner);
    expect(calls.some((c) => c[0] === "cancel")).toBe(false);
    const finish = calls.find((c) => c[0] === "finish")!;
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toStartWith("guard: max_wall_clock_seconds (600s) — supervisor backstop: submit timed out after 720s");
    expect(summary).toMatchObject({ ok: false, target: "skill", state: "partial", guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }] });
    expect(summary.reason).toStartWith("guard: max_wall_clock_seconds (600s)");

    const dir = mkdtempSync(join(tmpdir(), "tk-sup-guard-q-"));
    const checkout = mkdtempSync(join(tmpdir(), "tk-sup-guard-co-"));
    const q = new Queue(join(dir, "q.db"), { ownerAlive: () => true, engineLive: async () => ({ live: false }) });
    try {
      const defn = { id: "s", trigger: "one-shot", target: { skill: "tk-studio-activate" }, guards: { max_wall_clock_seconds: 600 } };
      const { run } = q.enqueue({ jobId: "s", root: checkout, target: "skill", definition: defn });
      await mirror(q, run.run_id, { jobId: "s", defn }, summary);
      const ended = q.get(run.run_id)!;
      expect(ended.state).toBe("partial");
      expect(ended.reason).toStartWith("guard: max_wall_clock_seconds (600s)");
    } finally { q.close(); }
  });
});

describe("a backstop trip records the studio's real terminal state", () => {
  const coreRunner = () => {
    let studioState = "running";
    return async (_root: string, args: string[]) => {
      if (args[0] === "status") return { runs: [{ run_id: "c-20260928T101010Z", state: studioState }] };
      if (args[0] === "cancel") { studioState = "cancelled"; return { cancelled: true, runs_ended: ["c-20260928T101010Z"] }; }
      throw new Error(`unexpected verb ${args[0]}`);
    };
  };
  const queueFixture = () => new Queue(join(mkdtempSync(join(tmpdir(), "tk-sup-studio-state-q-")), "q.db"),
    { ownerAlive: () => true, engineLive: async () => ({ live: false }) });

  test("core + stop.on_status [partial], cancelled by the backstop: the queue run ends partial, no `stopped` event, studio_outcome cancelled", async () => {
    const ctx: TimeoutContext = { root: "proj", projectId: "p", target: "core", verb: "wake", timeoutS: 720, jobGuardS: 600, before: new Set() };
    const summary = await recoverAfterTimeout("c", "uv timed out after 720s (process tree killed)", ctx, coreRunner());
    expect(summary).toMatchObject({ state: "partial", studio_state: "cancelled" });
    const q = queueFixture();
    try {
      const defn = { id: "c", trigger: "loop", target: { core: "x" }, guards: { max_wall_clock_seconds: 600 }, stop: { on_status: ["partial"] } };
      const { run } = q.enqueue({ jobId: "c", root: mkdtempSync(join(tmpdir(), "tk-sup-studio-state-co-")), target: "core", definition: defn });
      await mirror(q, run.run_id, { jobId: "c", defn }, summary);
      expect(q.get(run.run_id)).toMatchObject({ state: "partial" });
      expect(q.get(run.run_id)!.reason).toStartWith("guard: max_wall_clock_seconds (600s)");
      const events = q.events(run.run_id);
      expect(events.some((e) => e.kind === "stopped")).toBe(false);
      expect(events.find((e) => e.kind === "ended")!.detail).toMatchObject({ studio_outcome: { run_id: "c-20260928T101010Z", state: "cancelled" } });
    } finally { q.close(); }
  });

  test("a skill run finished partial by the backstop keeps its partial studio outcome (and its stop)", async () => {
    let studioState = "queued";
    const runner = async (_root: string, args: string[]) => {
      if (args[0] === "status") return { runs: [{ run_id: "s-20260928T101010Z", state: studioState }] };
      if (args[0] === "finish") { studioState = flag(args, "--state")!; return { run_id: "s-20260928T101010Z", state: studioState }; }
      throw new Error(`unexpected verb ${args[0]}`);
    };
    const ctx: TimeoutContext = { root: "proj", projectId: "p", target: "skill", verb: "wake", timeoutS: 720, jobGuardS: 600, before: new Set() };
    const summary = await recoverAfterTimeout("s", "uv timed out after 720s", ctx, runner);
    expect(summary.studio_state).toBeUndefined();
    const q = queueFixture();
    try {
      const defn = { id: "s", trigger: "loop", target: { skill: "tk-studio-activate" }, guards: { max_wall_clock_seconds: 600 }, stop: { on_status: ["partial"] } };
      const { run } = q.enqueue({ jobId: "s", root: mkdtempSync(join(tmpdir(), "tk-sup-studio-state-co-")), target: "skill", definition: defn });
      await mirror(q, run.run_id, { jobId: "s", defn }, summary);
      const events = q.events(run.run_id);
      expect(events.find((e) => e.kind === "ended")!.detail).toMatchObject({ studio_outcome: { state: "partial" } });
      expect(events.find((e) => e.kind === "stopped")!.detail).toMatchObject({ condition: "on_status", state: "partial" });
    } finally { q.close(); }
  });

  test("a verb timeout on a studio run already terminal: its own state kept, the guard backstop still named, no guards_tripped", async () => {
    const runner = async (_root: string, args: string[]) => {
      if (args[0] === "status") return { runs: [{ run_id: "c-20260928T101010Z", state: "complete" }] };
      throw new Error(`unexpected verb ${args[0]}`);
    };
    const ctx: TimeoutContext = { root: "proj", projectId: "p", target: "core", verb: "wake", timeoutS: 720, jobGuardS: 600, before: new Set() };
    const summary = await recoverAfterTimeout("c", "uv timed out after 720s", ctx, runner);
    expect(summary.state).toBe("complete");
    expect(summary.reason).toBe("guard: max_wall_clock_seconds (600s) — wake failed: uv timed out after 720s");
    expect(summary.guards_tripped).toBeUndefined();
    // Not a timeout → no guard named.
    const other = await recoverAfterTimeout("c", "uv exited 1", ctx, runner);
    expect(other.reason).toBe("wake failed: uv exited 1");
  });
});

// ---------------------------------------------------------------- the supervisor's own signals (POSIX)

describe.skipIf(process.platform === "win32")("a signal to the supervisor kills its detached children's groups, then it exits as before", () => {
  const SERVER = join(import.meta.dir, "..", "src", "server.ts");
  // Only the signals this test process does not itself ignore (a child inherits an ignored one, e.g. under `nohup`).
  const handled = signalsToHandle(readProcStatus());
  test.each((["SIGTERM", "SIGHUP", "SIGINT"] as const).filter((sig) => handled.includes(sig)))("%s: the worker and its grandchild are gone; the supervisor dies of the signal", async (sig) => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-sig-"));
    const script = join(dir, "supervisor.ts");
    writeFileSync(script, [
      `import { runProcess } from ${JSON.stringify(SERVER)};`,
      `import { writeFileSync } from "node:fs";`,
      `const dir = ${JSON.stringify(dir)};`,
      `writeFileSync(dir + "/sup.pid", String(process.pid));`,
      `await runProcess("sh", ["-c", 'echo $$ > "' + dir + '/child.pid"; sleep 30 & echo $! > "' + dir + '/gc.pid"; wait'], { timeoutS: 60 }).catch(() => {});`,
      `console.log("supervisor finished without the signal");`,
    ].join("\n"));
    // Bounded: GNU timeout ends it (and its group) if the signal path hangs.
    const proc = Bun.spawn(["timeout", "-k", "5", "20", process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const deadline = Date.now() + 10_000;
    while (!["sup.pid", "child.pid", "gc.pid"].every((f) => existsSync(join(dir, f)) && readFileSync(join(dir, f), "utf-8").trim()) && Date.now() < deadline) {
      await Bun.sleep(50);
    }
    const pid = (f: string) => Number(readFileSync(join(dir, f), "utf-8").trim());
    const [sup, child, grandchild] = [pid("sup.pid"), pid("child.pid"), pid("gc.pid")];
    process.kill(sup, sig); // by pid: the supervisor process only
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const gone = Date.now() + 3000;
    while ((alive(child) || alive(grandchild)) && Date.now() < gone) await Bun.sleep(50);
    const survivors = [child, grandchild].filter(alive);
    for (const p of survivors) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } } // our own test's processes only
    expect(survivors).toEqual([]);
    expect(out).not.toContain("finished without the signal");
    expect(code).not.toBe(0);
  }, 30_000);

  // `spawn()` returns some milliseconds after the child is already running. The child signals the
  // supervisor as soon as it has written its pids, so the signal lands inside that gap: the handlers
  // must already be installed (run 20260928-191230-73a0 paused on this race, 2026-09-28).
  test.skipIf(!handled.includes("SIGTERM"))("SIGTERM from the child as it starts, while the spawn is still returning: its group is killed all the same", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-sig-"));
    const script = join(dir, "supervisor.ts");
    writeFileSync(script, [
      `import { runProcess } from ${JSON.stringify(SERVER)};`,
      `const dir = ${JSON.stringify(dir)};`,
      `await runProcess("sh", ["-c", 'echo $$ > "' + dir + '/child.pid"; sleep 30 & echo $! > "' + dir + '/gc.pid"; kill -TERM ' + process.pid + '; wait'], { timeoutS: 60 }).catch(() => {});`,
      `console.log("supervisor finished without the signal");`,
    ].join("\n"));
    // Bounded: GNU timeout ends it (and its group) if the signal path hangs.
    const proc = Bun.spawn(["timeout", "-k", "5", "20", process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const pid = (f: string) => Number(readFileSync(join(dir, f), "utf-8").trim());
    const [child, grandchild] = [pid("child.pid"), pid("gc.pid")];
    const gone = Date.now() + 3000;
    while ((alive(child) || alive(grandchild)) && Date.now() < gone) await Bun.sleep(50);
    const survivors = [child, grandchild].filter(alive);
    for (const p of survivors) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } } // our own test's processes only
    expect(survivors).toEqual([]);
    expect(out).not.toContain("finished without the signal");
    expect(code).not.toBe(0);
  }, 30_000);
});

describe("signalsToHandle: a signal inherited as ignored is never handled", () => {
  const status = (sigIgn: string) => `Name:\tbun\nSigPnd:\t0000000000000000\nSigBlk:\t0000000000000000\nSigIgn:\t${sigIgn}\nSigCgt:\t00000000200004f8\n`;
  test("nothing of ours ignored (SIGPIPE/SIGXFSZ are) → SIGINT, SIGTERM, SIGHUP", () => {
    expect(signalsToHandle(status("0000000001001000"))).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
  });
  test("SIGHUP ignored (`nohup`, bit 0) → SIGINT, SIGTERM only", () => {
    expect(signalsToHandle(status("0000000001001001"))).toEqual(["SIGINT", "SIGTERM"]);
  });
  test("SIGINT (bit 1) and SIGTERM (bit 14) ignored → SIGHUP only; all three → none", () => {
    expect(signalsToHandle(status("0000000000004002"))).toEqual(["SIGHUP"]);
    expect(signalsToHandle(status("0000000000004003"))).toEqual([]);
  });
  test("SigIgn unreadable (non-Linux POSIX, no line) → SIGHUP left alone, SIGINT/SIGTERM handled", () => {
    expect(signalsToHandle(null)).toEqual(["SIGINT", "SIGTERM"]);
    expect(signalsToHandle("Name:\tbun\n")).toEqual(["SIGINT", "SIGTERM"]);
  });
});

describe.skipIf(process.platform === "win32")("a supervisor started with SIGHUP ignored stays immune to SIGHUP", () => {
  const SERVER = join(import.meta.dir, "..", "src", "server.ts");
  test("SIGHUP after a tracked child ran, and during a tracked child: the supervisor and its child both survive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-nohup-"));
    const script = join(dir, "supervisor.ts");
    writeFileSync(script, [
      `import { runProcess } from ${JSON.stringify(SERVER)};`,
      `import { existsSync, writeFileSync } from "node:fs";`,
      `const dir = ${JSON.stringify(dir)};`,
      `writeFileSync(dir + "/sup.pid", String(process.pid));`,
      `await runProcess("sh", ["-c", "exit 0"], { timeoutS: 10 });`,
      `writeFileSync(dir + "/after-first", "1");`,
      `while (!existsSync(dir + "/hup1-sent")) await Bun.sleep(20);`,
      `const r = await runProcess("sh", ["-c", 'echo $$ > "' + dir + '/child.pid"; while [ ! -f "' + dir + '/go" ]; do sleep 0.05; done'], { timeoutS: 15 });`,
      `console.log("survived exit=" + r.exit);`,
    ].join("\n"));
    // Bounded: GNU timeout ends it if the protocol hangs. `trap "" HUP; exec` hands bun an ignored SIGHUP, as `nohup` does.
    const proc = Bun.spawn(["timeout", "-k", "5", "20", "sh", "-c", 'trap "" HUP; exec "$0" "$1"', process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const waitFor = async (f: string) => {
      const deadline = Date.now() + 10_000;
      while (!(existsSync(join(dir, f)) && readFileSync(join(dir, f), "utf-8").trim()) && Date.now() < deadline) await Bun.sleep(20);
    };
    await waitFor("after-first");
    const sup = Number(readFileSync(join(dir, "sup.pid"), "utf-8").trim());
    process.kill(sup, "SIGHUP"); // by pid: after a tracked child ran, none live
    await Bun.sleep(200);
    writeFileSync(join(dir, "hup1-sent"), "1");
    await waitFor("child.pid");
    process.kill(sup, "SIGHUP"); // during a tracked child
    await Bun.sleep(200);
    writeFileSync(join(dir, "go"), "1");
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    expect(out).toContain("survived exit=0");
    expect(code).toBe(0);
  }, 30_000);
});

// ---------------------------------------------------------------- the original reason is never dropped (account)

describe("finishRun: an account failure or trip keeps the iteration's own named reason", () => {
  const G = { max_wall_clock_seconds: 600, max_turns: 40 };

  test("no status block (AD-11) + no session_id: partial, MISSING_STATUS_BLOCK kept, the account failure appended", async () => {
    const { summary, finish } = await withTranscript(null, [], () => drive(started(G), { ran: true, exit: 1, conformance_failure: MISSING_STATUS_BLOCK }));
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; no session recorded; guard: account failed — transcript: the worker result carried no session_id`);
    expect(summary.state).toBe("partial");
  });

  test("a blocked block (Max login missing) + account failure: stays blocked, the login reason first", async () => {
    const block = { status: "blocked", intent: "tk-studio-activate", artifacts: [], reason: `${MAX_LOGIN_MISSING} — worker answered 401/auth failure (§1)` };
    const { finish } = await withTranscript(null, [], () => drive(started(G), { ran: true, exit: 1, status_block: block }));
    expect(flag(finish, "--state")).toBe("blocked");
    expect(flag(finish, "--reason")).toStartWith(`${MAX_LOGIN_MISSING} — worker answered 401/auth failure (§1); guard: account failed — `);
  });

  test("a blocked block + a tripped budget guard: partial (AC2), the original reason kept alongside the guard", async () => {
    const block = { status: "blocked", intent: "tk-studio-activate", artifacts: [], reason: MAX_LOGIN_MISSING };
    const { summary, finish } = await withTranscript("sess-b", THREE_TURNS, () =>
      drive(started(G), { ran: true, status_block: block, session_id: "sess-b" }, { within_budget: false, exceeded: ["max_turns"] }));
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MAX_LOGIN_MISSING}; guard: max_turns (40)`);
    expect(summary.guards_tripped).toEqual([{ guard: "max_turns", value: 40 }]);
  });

  test("a partial block with its own reason + account refusal: partial, both named", async () => {
    const block = { status: "partial", intent: "tk-studio-activate", artifacts: [], reason: "half done" };
    const { finish } = await withTranscript("sess-p", THREE_TURNS, () =>
      drive(started(G), { status_block: block, session_id: "sess-p" }, { ok: false, error: "no such run" }));
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe("half done; guard: account failed — account: no such run");
  });

  test("hasTurnTokenGuard: only a numeric max_turns/max_tokens counts", () => {
    expect(hasTurnTokenGuard({ guards: { max_turns: 3 } })).toBe(true);
    expect(hasTurnTokenGuard({ guards: { max_tokens: 1000 } })).toBe(true);
    expect(hasTurnTokenGuard({ guards: { max_turns: null, max_tokens: "10" } })).toBe(false);
    expect(hasTurnTokenGuard({ guards: { max_wall_clock_seconds: 60 } })).toBe(false);
    expect(hasTurnTokenGuard({})).toBe(false);
  });
});

// ---------------------------------------------------------------- sbx: the in-VM timeout fires first (AC1)

describe("finishRun: on sbx, the in-VM `timeout` exit (124/137) with no status block, once the guard's time passed, is the wall-clock trip", () => {
  const sbx = { tier: "sbx" as const, sandbox: "claude-p" };
  test.each([124, 137])("exit %d at the guard (elapsed 600s) → partial naming the guard, guards_tripped set, not accounted", async (exit) => {
    const { summary, finish, account } = await drive(started({ max_wall_clock_seconds: 600, max_turns: 40 }, sbx),
      { ran: true, exit, conformance_failure: MISSING_STATUS_BLOCK }, undefined, 600);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe("guard: max_wall_clock_seconds (600s)");
    expect(summary).toMatchObject({ state: "partial", guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }] });
    expect(account).toBeUndefined();
  });

  test("exit 137 once the guard's time passed overall, but the worker's own time (worker_elapsed_s) short of it → blocked, the preflight's time not counted", async () => {
    // The injected clock says 600s (the auth preflight and drift check ran first);
    // the worker itself ran 480s — an early SIGKILL, not the in-VM timeout.
    const { summary, finish } = await drive(started({ max_wall_clock_seconds: 600 }, sbx),
      { ran: true, exit: 137, worker_elapsed_s: 480, conformance_failure: MISSING_STATUS_BLOCK }, undefined, 600);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; no session recorded`);
    expect(summary.state).toBe("partial");
    expect(summary.guards_tripped).toBeUndefined();
  });

  test("exit 124 with the worker's own time (worker_elapsed_s) at the guard → partial naming the guard", async () => {
    const { summary, finish } = await drive(started({ max_wall_clock_seconds: 600 }, sbx),
      { ran: true, exit: 124, worker_elapsed_s: 600.2, conformance_failure: MISSING_STATUS_BLOCK }, undefined, 0);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe("guard: max_wall_clock_seconds (600s)");
    expect(summary).toMatchObject({ state: "partial", guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }] });
  });

  test("invokeSkill reports worker_elapsed_s: the worker's own run time, the auth preflight's excluded", async () => {
    const root = mkdtempSync(join(tmpdir(), "tk-sup-sbx-elapsed-"));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const spawner: Spawner = async (_cmd, args): Promise<RunResult> => {
      if (args.includes("auth")) { await sleep(400); return { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }; }
      await sleep(60);
      return { exit: 137, stderr: "", stdout: "" };
    };
    const out = await invokeSkill(root, "tk-studio-activate", { tier: "sbx", sandbox: "sb", timeout_s: 600 }, spawner);
    expect(out.ran).toBe(true);
    expect(typeof out.worker_elapsed_s).toBe("number");
    expect(out.worker_elapsed_s as number).toBeGreaterThanOrEqual(0.05);
    expect(out.worker_elapsed_s as number).toBeLessThan(0.4);
  });

  test("the cap bounds → names the cap", async () => {
    const { finish } = await drive(started({ max_wall_clock_seconds: 7200 }, { ...sbx, guardS: 300 }), { ran: true, exit: 124, conformance_failure: MISSING_STATUS_BLOCK }, undefined, 312);
    expect(flag(finish, "--reason")).toBe("guard: --timeout-cap-s (300s)");
  });

  test.each([124, 137])("exit %d well before the guard (an OOM or another SIGKILL) → partial, the AD-11 failure kept, no guard named", async (exit) => {
    const { summary, finish } = await drive(started({ max_wall_clock_seconds: 600 }, sbx),
      { ran: true, exit, conformance_failure: MISSING_STATUS_BLOCK }, undefined, 42);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; no session recorded`);
    expect(summary.state).toBe("partial");
    expect(summary.guards_tripped).toBeUndefined();
  });

  test("exit 137 just short of the guard (599.9s of 600s) → partial", async () => {
    const { finish } = await drive(started({ max_wall_clock_seconds: 600 }, sbx), { ran: true, exit: 137, conformance_failure: MISSING_STATUS_BLOCK }, undefined, 599.9);
    expect(flag(finish, "--state")).toBe("partial");
  });

  test("host tier exit 124 is not an in-VM trip: partial, missing status block kept", async () => {
    const { finish } = await drive(started({ max_wall_clock_seconds: 600 }), { ran: true, exit: 124, conformance_failure: MISSING_STATUS_BLOCK }, undefined, 600);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; no session recorded`);
  });
});

// ---------------------------------------------------------------- reasons in seconds; the trip reaches the queue's `ended` event

describe("guard reasons print seconds consistently", () => {
  test("a backstop trip with no job guard: `max_wall_clock_seconds backstop (720s)`", async () => {
    expect(guardReason([{ guard: "max_wall_clock_seconds backstop", value: 720 }])).toBe("guard: max_wall_clock_seconds backstop (720s)");
    const runner = async (_root: string, args: string[]) => {
      if (args[0] === "status") return { runs: [{ run_id: "c-20260928T101010Z", state: "running" }] };
      if (args[0] === "cancel") return { cancelled: true, runs_ended: ["c-20260928T101010Z"] };
      throw new Error(`unexpected verb ${args[0]}`);
    };
    const ctx: TimeoutContext = { root: "proj", projectId: "p", target: "core", verb: "wake", timeoutS: 720, before: new Set() };
    const summary = await recoverAfterTimeout("c", "uv timed out after 720s", ctx, runner);
    expect(summary.reason).toStartWith("guard: max_wall_clock_seconds backstop (720s) — ");
  });
});

describe("a host skill wall-clock trip through finishRun → mirror lands in the queue run's `ended` event", () => {
  test("partial, the guard in the reason and in `guards_tripped`", async () => {
    const { summary } = await drive(started({ max_wall_clock_seconds: 600 }),
      () => { throw new Error("claude timed out after 600s (process tree killed); stdout tail: "); });
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-guard-host-q-"));
    const checkout = mkdtempSync(join(tmpdir(), "tk-sup-guard-host-co-"));
    const q = new Queue(join(dir, "q.db"), { ownerAlive: () => true, engineLive: async () => ({ live: false }) });
    try {
      const defn = started({ max_wall_clock_seconds: 600 }).defn;
      const { run } = q.enqueue({ jobId: "s", root: checkout, target: "skill", definition: defn });
      await mirror(q, run.run_id, { jobId: "s", defn }, summary);
      expect(q.get(run.run_id)).toMatchObject({ state: "partial", reason: "guard: max_wall_clock_seconds (600s)" });
      const ev = q.events(run.run_id).find((e) => e.kind === "ended")!;
      expect(ev.to_state).toBe("partial");
      expect(ev.detail).toMatchObject({ reason: "guard: max_wall_clock_seconds (600s)", guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }] });
    } finally { q.close(); }
  });
});
