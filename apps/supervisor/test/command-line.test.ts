import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  drainQueue, finishRun, guardsFor, launchedEngine, main, mirror, recoverAfterTimeout, recoverQueue, runJob, startRun, type RunSummary, type TimeoutContext, type Validated,
} from "../src/cli";
import { claudeBin, studioRoot, StudioRootMissing } from "../src/env";
import { END_HYGIENE_EVENTS } from "../src/hygiene";
import { checkoutKey, type QueueEvent, Queue } from "../src/queue";
import { STARTER } from "../src/sandbox";
import { ConnectorClient } from "../src/client";
import { runBranch } from "../src/worktree";
import {
  buildWorkerCommand, buildWorkerEnv, CONTINUATION_PROMPT, HostBypassRefused, invokeSkill, MISSING_STATUS_BLOCK, type Spawner, toVmPath,
} from "../src/server";
import { fakeBin, fakeGh, fakePlansync, fakeStudioRoot, gitInit, gitRepo, testGit } from "./fakes";

const REPO = resolve(import.meta.dir, "..");

/** Story 22.3: the operator's run-hygiene variables (User scope on the Windows host) must never
 * reach this suite — its in-process paths and every child it spawns through `...process.env` would
 * send real notifications, copy transcripts into the real backup and snapshot into the real work
 * folder. They are cleared for the suite (restored after it); a test that needs one sets it
 * explicitly (a fixture's `env`, or `process.env` inside the test). */
const OPERATOR_HYGIENE_VARS = [
  "TK_SUPERVISOR_NOTIFY", "TK_SUPERVISOR_NTFY_URL", "TK_SUPERVISOR_TELEGRAM_TOKEN", "TK_SUPERVISOR_TELEGRAM_CHAT",
  "TK_SUPERVISOR_TRANSCRIPT_BACKUP", "TK_SUPERVISOR_WORK",
] as const;
const operatorHygiene: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of OPERATOR_HYGIENE_VARS) { operatorHygiene[k] = process.env[k]; delete process.env[k]; }
});
afterAll(() => {
  for (const k of OPERATOR_HYGIENE_VARS) { if (operatorHygiene[k] === undefined) delete process.env[k]; else process.env[k] = operatorHygiene[k]; }
});

/** A run's lifecycle events: every event but the end hygiene's (Story 22.3), which follows each end. */
const lifecycle = (q: Queue, runId?: string, since?: number): QueueEvent[] =>
  q.events(runId, since).filter((e) => !(END_HYGIENE_EVENTS as readonly string[]).includes(e.kind));

const FORBIDDEN_FLAGS = ["--dangerously-skip-permissions", "--settings", "--permission-prompt-tool", "--allowedTools", "--disallowedTools"];

beforeAll(() => { process.env.TK_STUDIO_HOME = mkdtempSync(join(tmpdir(), "tk-sup-store-")); });

describe("worker command line", () => {
  test("host default: -p <prompt> --output-format json --permission-mode auto", () => {
    const { argv } = buildWorkerCommand({ prompt: "/tk-studio:tk-studio-activate {}" });
    expect(argv).toEqual(["-p", "/tk-studio:tk-studio-activate {}", "--output-format", "json", "--permission-mode", "auto"]);
  });

  test("nothing overrides settings.json permissions.deny", () => {
    const { argv } = buildWorkerCommand({ prompt: "x", permissionMode: "acceptEdits", model: "claude-sonnet-5", effort: "low" });
    for (const flag of FORBIDDEN_FLAGS) expect(argv).not.toContain(flag);
  });

  test("model and effort forwarded verbatim when present", () => {
    expect(buildWorkerCommand({ prompt: "x", model: "claude-sonnet-5", effort: "low" }).argv.slice(-4))
      .toEqual(["--model", "claude-sonnet-5", "--effort", "low"]);
    expect(buildWorkerCommand({ prompt: "x" }).argv).not.toContain("--model");
  });

  test("worker binary from CLAUDE_BIN, default `claude`", () => {
    expect(claudeBin({})).toBe("claude");
    expect(claudeBin({ CLAUDE_BIN: "my-claude" })).toBe("my-claude");
  });

  test("host bypass → HostBypassRefused before any process starts", async () => {
    expect(() => buildWorkerCommand({ prompt: "x", permissionMode: "bypassPermissions" })).toThrow(HostBypassRefused);
    let spawned = 0;
    const spawner: Spawner = async () => { spawned++; return { exit: 0, stdout: "", stderr: "" }; };
    await expect(invokeSkill(tmpdir(), "tk-studio-activate", { permission_mode: "bypassPermissions" }, spawner))
      .rejects.toThrow(HostBypassRefused);
    expect(spawned).toBe(0);
  });

  test("worker env never carries ANTHROPIC_API_KEY; the store passes through", () => {
    const env = buildWorkerEnv({ ANTHROPIC_API_KEY: "sk-test", TK_STUDIO_HOME: "store", PATH: "p" });
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
    expect(env).toEqual({ TK_STUDIO_HOME: "store", PATH: "p" });
  });

  test("worker env never carries the API's bearer token (TK_SUPERVISOR_TOKEN)", () => {
    const env = buildWorkerEnv({ TK_SUPERVISOR_TOKEN: "x", ANTHROPIC_API_KEY: "y", TK_STUDIO_HOME: "z" });
    expect(env).toEqual({ TK_STUDIO_HOME: "z" });
  });

  test("worker env never carries the notifier's credentials (DW-17); the notifier's choice and the chat id pass through", () => {
    const env = buildWorkerEnv({
      TK_SUPERVISOR_TELEGRAM_TOKEN: "bot-token", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/secret-topic",
      TK_SUPERVISOR_NOTIFY: "telegram", TK_SUPERVISOR_TELEGRAM_CHAT: "42", TK_STUDIO_HOME: "z",
    });
    expect(env).toEqual({ TK_SUPERVISOR_NOTIFY: "telegram", TK_SUPERVISOR_TELEGRAM_CHAT: "42", TK_STUDIO_HOME: "z" });
  });

  test("missing TK_STUDIO_ROOT is the named StudioRootMissing", () => {
    expect(() => studioRoot({})).toThrow(StudioRootMissing);
  });
});

describe("argument parsing", () => {
  test.each([
    [["run", "studio-health", "--directory"]],
    [["run", "studio-health", "--directory", ".", "--permission-mode"]],
    [["run", "studio-health", "--directory", "--permission-mode", "auto"]],
    [["run", "studio-health", "--permission-mode", "--directory", "."]],
    [["run", "studio-health", "--directory", ".", "--tier"]],
    [["submit", "studio-health", "--directory", ".", "--sandbox", "--tier", "sbx"]],
    // An empty value is refused like a missing one (never silently treated as absent).
    [["run", "studio-health", "--directory", ".", "--permission-mode", ""]],
    [["submit", "studio-health", "--directory", ".", "--tier", ""]],
  ])("a flag missing its value → usage error, exit 2: %j", async (argv) => {
    const err = console.error;
    const seen: string[] = [];
    console.error = (...a: unknown[]) => { seen.push(a.join(" ")); };
    try { expect(await main(argv)).toBe(2); } finally { console.error = err; }
    expect(seen.join("\n")).toContain("needs a value");
  });

  test("a whitespace-only value is refused like an empty one: `--tier sbx --sandbox ' '` → exit 2, nothing queued", async () => {
    const db = join(mkdtempSync(join(tmpdir(), "tk-sup-blank-")), "queue.db");
    const [err, prev] = [console.error, process.env.TK_SUPERVISOR_DB];
    const seen: string[] = [];
    console.error = (...a: unknown[]) => { seen.push(a.join(" ")); };
    process.env.TK_SUPERVISOR_DB = db;
    try {
      for (const cmd of ["submit", "run"]) {
        expect(await main([cmd, "studio-health", "--directory", ".", "--tier", "sbx", "--sandbox", " "])).toBe(2);
      }
    } finally {
      console.error = err;
      if (prev === undefined) delete process.env.TK_SUPERVISOR_DB; else process.env.TK_SUPERVISOR_DB = prev;
    }
    expect(seen.join("\n")).toContain("--sandbox needs a value");
    expect(existsSync(db)).toBe(false); // the queue was never opened
  });
});

describe("wake/submit failure recovery (timeout or otherwise)", () => {
  type Call = string[];
  const ctx = (target: "skill" | "core", before: string[] = []): TimeoutContext =>
    ({ root: "proj", projectId: "p", target, verb: target === "core" ? "wake" : "submit", timeoutS: 720, before: new Set(before) });
  /** A fake §4 verb runner: `status` answers `runs`, later reflecting the ending verb. */
  function fakeVerbs(runs: Record<string, any>[], ending: (args: string[]) => Record<string, any>) {
    const calls: Call[] = [];
    const states = new Map(runs.map((r) => [r.run_id, r.state]));
    const runner = async (_root: string, args: string[]) => {
      calls.push(args);
      const runId = args[args.indexOf("--run-id") + 1];
      if (args[0] === "status") {
        const all = runs.map((r): Record<string, any> => ({ ...r, state: states.get(r.run_id) }));
        return { job_id: "j", runs: args.includes("--run-id") ? all.filter((r) => r.run_id === runId) : all };
      }
      const out = ending(args);
      if (out.ok !== false) states.set(runId, args[0] === "finish" ? args[args.indexOf("--state") + 1] : "partial");
      return out;
    };
    return { calls, runner };
  }

  test("skill run: adopts only the run absent from the snapshot and finishes it partial naming the timeout", async () => {
    const { calls, runner } = fakeVerbs(
      [{ run_id: "j-20260101T000000Z", state: "queued" }, { run_id: "j-20260928T101010Z", state: "queued" }],
      (args) => ({ run_id: args[args.indexOf("--run-id") + 1], state: "partial" }));
    const out = await recoverAfterTimeout("j", "uv timed out after 720s", ctx("skill", ["j-20260101T000000Z"]), runner);
    expect(out).toMatchObject({ ok: false, run_id: "j-20260928T101010Z", target: "skill", state: "partial" });
    expect(out.reason).toContain("timed out");
    const finish = calls.find((c) => c[0] === "finish")!;
    expect(finish.slice(finish.indexOf("--run-id"), finish.indexOf("--run-id") + 4)).toEqual(["--run-id", "j-20260928T101010Z", "--state", "partial"]);
    expect(finish[finish.indexOf("--reason") + 1]).toContain("timed out");
    expect(calls.some((c) => c.includes("j-20260101T000000Z"))).toBe(false);
    expect(calls.some((c) => c[0] === "cancel")).toBe(false);
  });

  test("core run: cancelled, never finished (AC5b)", async () => {
    const { calls, runner } = fakeVerbs([{ run_id: "j-1", state: "running" }],
      (args) => ({ cancelled: true, runs_ended: [args[args.indexOf("--run-id") + 1]] }));
    const out = await recoverAfterTimeout("j", "uv timed out", ctx("core"), runner);
    expect(out).toMatchObject({ ok: false, run_id: "j-1", target: "core", state: "partial" });
    expect(calls.some((c) => c[0] === "finish")).toBe(false);
    expect(calls.find((c) => c[0] === "cancel")).toEqual(["cancel", "--directory", "proj", "--job-id", "j", "--run-id", "j-1"]);
  });

  test("an already-terminal adopted run is reported as is; nothing ends it", async () => {
    const { calls, runner } = fakeVerbs([{ run_id: "j-1", state: "complete" }], () => { throw new Error("must not be called"); });
    const out = await recoverAfterTimeout("j", "uv timed out", ctx("core"), runner);
    expect(out).toMatchObject({ ok: false, run_id: "j-1", state: "complete" });
    expect(calls.map((c) => c[0])).toEqual(["status"]);
  });

  test("ending the run fails → still reported with its run id, the failure in reason", async () => {
    const { runner } = fakeVerbs([{ run_id: "j-1", state: "queued" }], () => ({ ok: false, error: "store locked" }));
    const out = await recoverAfterTimeout("j", "uv timed out", ctx("skill"), runner);
    expect(out).toMatchObject({ ok: false, run_id: "j-1", state: "queued" });
    expect(out.reason).toContain("store locked");
  });

  test("a non-timeout wake failure after the run exists: that run is ended and reported with its run id, no timeout claimed", async () => {
    const { calls, runner } = fakeVerbs(
      [{ run_id: "j-old", state: "complete" }, { run_id: "j-20260928T101010Z", state: "running" }],
      (args) => ({ run_id: args[args.indexOf("--run-id") + 1], state: "blocked" }));
    const msg = "jobrun emitted no JSON (exit 1): Traceback (most recent call last): KeyError: 'target'";
    const out = await recoverAfterTimeout("j", msg, ctx("skill", ["j-old"]), runner);
    expect(out).toMatchObject({ ok: false, run_id: "j-20260928T101010Z", target: "skill", state: "blocked" });
    expect(out.reason).toContain(`submit failed: ${msg}`);
    expect(out.reason).not.toContain("timed out");
    const finish = calls.find((c) => c[0] === "finish")!;
    expect(finish.slice(finish.indexOf("--run-id"), finish.indexOf("--run-id") + 4)).toEqual(["--run-id", "j-20260928T101010Z", "--state", "blocked"]);
    expect(finish[finish.indexOf("--reason") + 1]).toContain("submit failed before answering");
    expect(finish[finish.indexOf("--reason") + 1]).not.toContain("timed out");
    expect(calls.some((c) => c.includes("j-old"))).toBe(false);
  });

  test("a non-timeout core wake failure: the new run is cancelled, never finished", async () => {
    const { calls, runner } = fakeVerbs([{ run_id: "j-1", state: "queued" }],
      (args) => ({ cancelled: true, runs_ended: [args[args.indexOf("--run-id") + 1]] }));
    const out = await recoverAfterTimeout("j", "jobrun emitted no JSON (exit 1): boom", ctx("core"), runner);
    expect(out).toMatchObject({ ok: false, run_id: "j-1", target: "core", state: "partial" });
    expect(out.reason).not.toContain("timed out");
    expect(calls.some((c) => c[0] === "finish")).toBe(false);
  });

  test("no run beyond the snapshot → not started (never adopts a run it did not start)", async () => {
    const { calls, runner } = fakeVerbs([{ run_id: "j-old", state: "queued" }], () => ({}));
    await expect(recoverAfterTimeout("j", "uv timed out", ctx("skill", ["j-old"]), runner)).rejects.toThrow(/no new run/);
    expect(calls.map((c) => c[0])).toEqual(["status"]);
  });
});

describe("guard timeouts: --timeout-cap-s caps the skill invocation only", () => {
  const CAP = 3600;
  type Seen = { verb: string; timeoutS?: number };
  /** A fake §4 verb runner recording each verb with the timeout it was given. */
  function recordingRunner(answer: (args: string[]) => Record<string, any>) {
    const seen: Seen[] = [];
    const runner = async (_root: string, args: string[], timeoutS?: number) => { seen.push({ verb: args[0], timeoutS }); return answer(args); };
    return { seen, runner };
  }
  const validated = (defn: Record<string, any>, target: "skill" | "core"): Validated =>
    ({ jobId: defn.id, root: "proj", projectId: "p", defn, target, ...guardsFor(defn, CAP) });

  test("guardsFor: the job's own guard stays uncapped; the invocation guard is capped (default 600 s)", () => {
    expect(guardsFor({ guards: { max_wall_clock_seconds: 7200 } }, CAP)).toEqual({ jobGuardS: 7200, guardS: CAP });
    expect(guardsFor({ guards: { max_wall_clock_seconds: 900 } }, CAP)).toEqual({ jobGuardS: 900, guardS: 900 });
    expect(guardsFor({ guards: { max_wall_clock_seconds: 7200 } })).toEqual({ jobGuardS: 7200, guardS: 7200 });
    expect(guardsFor({}, CAP)).toEqual({ jobGuardS: 600, guardS: 600 });
  });

  test("core job past the cap: `wake` (which executes it) gets the uncapped guard + 120 s, never the cap", async () => {
    const defn = { id: "c", trigger: "loop", target: { core: "x" }, guards: { max_wall_clock_seconds: 7200 } };
    const { seen, runner } = recordingRunner((args) => args[0] === "status" ? { runs: [] }
      : { woken: true, run_id: "c-20260928T101010Z", state: "complete" });
    const started = await startRun(validated(defn, "core"), () => {}, runner);
    expect("summary" in started).toBe(false);
    expect(seen.find((s) => s.verb === "wake")!.timeoutS).toBe(7200 + 120);
  });

  test("skill job past the cap: `submit` gets the uncapped guard + 120 s; the headless invocation runs under the cap", async () => {
    const defn = { id: "s", trigger: "one-shot", target: { skill: "tk-studio-activate" }, guards: { max_wall_clock_seconds: 7200 } };
    const { seen, runner } = recordingRunner((args) => {
      if (args[0] === "status") return { runs: [] };
      if (args[0] === "submit") return { accepted: true, run_id: "s-20260928T101010Z", state: "queued",
        directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: {} } };
      return { ok: true, state: "complete" }; // finish
    });
    const started = await startRun(validated(defn, "skill"), () => {}, runner);
    if ("summary" in started) throw new Error(`not started: ${JSON.stringify(started.summary)}`);
    expect(seen.find((s) => s.verb === "submit")!.timeoutS).toBe(7200 + 120);
    const invoked: unknown[] = [];
    const summary = await finishRun(started, runner, async (_root, _skill, args) => {
      invoked.push(args.timeout_s);
      return { status_block: { status: "complete", intent: "tk-studio-activate", artifacts: [] } };
    });
    expect(summary).toMatchObject({ ok: true, state: "complete", run_id: "s-20260928T101010Z" });
    expect(invoked).toEqual([CAP]);
  });
});

describe("Story 28.6: the queue's own verbs carry --force-starter; the MCP tk_job route carries none", () => {
  const validated = (defn: Record<string, any>, target: "skill" | "core"): Validated =>
    ({ jobId: defn.id, root: "proj", projectId: "p", defn, target, ...guardsFor(defn) });
  const recording = (answer: (args: string[]) => Record<string, any>) => {
    const seen: string[][] = [];
    return { seen, runner: async (_root: string, args: string[]) => { seen.push(args); return answer(args); } };
  };

  test("startRun: the run's `wake` and `submit` argv end in --force-starter; `status` carries none", async () => {
    const loop = recording((a) => a[0] === "status" ? { runs: [] } : { woken: true, run_id: "c-20261017T101010Z", state: "complete" });
    await startRun(validated({ id: "c", trigger: "loop", target: { core: "x" }, guards: { max_wall_clock_seconds: 60 } }, "core"), () => {}, loop.runner);
    expect(loop.seen.find((a) => a[0] === "wake")).toEqual(["wake", "--directory", "proj", "--job-id", "c", "--force-starter"]);
    const once = recording((a) => a[0] === "status" ? { runs: [] } : { accepted: true, run_id: "s-20261017T101010Z", state: "queued",
      directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: {} } });
    await startRun(validated({ id: "s", trigger: "one-shot", target: { skill: "tk-studio-activate" }, guards: { max_wall_clock_seconds: 60 } }, "skill"), () => {}, once.runner);
    expect(once.seen.find((a) => a[0] === "submit")).toEqual(["submit", "--directory", "proj", "--id", "s", "--force-starter"]);
    for (const a of [...loop.seen, ...once.seen].filter((x) => x[0] === "status")) expect(a).not.toContain("--force-starter");
  });

  test("MCP tk_job submit and wake: the jobrun argv carries no --force-starter (a hand start, refused like one)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-mcp-argv-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "uv-calls.jsonl");
    fakeBin(join(bin, "uv"), [
      `const { appendFileSync } = require("node:fs");`,
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
      `console.log(JSON.stringify({ ok: true, accepted: false, woken: false, run_id: null, reason: "fake" }));`,
    ].join("\n"));
    const project = mkdtempSync(join(tmpdir(), "tk-sup-mcp-proj-"));
    const client = new ConnectorClient({ TK_STUDIO_ROOT: resolve(REPO, "..", ".."), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` });
    try {
      await client.init("story-28-6-test");
      const sub = await client.callTool("tk_job", { verb: "submit", directory: project, id: "studio-health" }, 60_000);
      expect(sub.toolError).toBeUndefined();
      const woke = await client.callTool("tk_job", { verb: "wake", directory: project, job_id: "studio-health" }, 60_000);
      expect(woke.toolError).toBeUndefined();
    } finally { client.close(); }
    const calls: string[][] = readFileSync(log, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const verbs = calls.map((argv) => argv.slice(argv.findIndex((a) => a.endsWith("jobrun.py")) + 1));
    expect(verbs).toEqual([
      ["submit", "--directory", project, "--id", "studio-health"],
      ["wake", "--directory", project, "--job-id", "studio-health"],
    ]);
    for (const argv of calls) expect(argv).not.toContain("--force-starter");
  }, 60_000);
});

describe("finishRun: model/effort per §5, tier forwarded, cost to finish (AC3/AC4)", () => {
  const woke = (routing?: Record<string, unknown>) => ({
    accepted: true, run_id: "s-20260928T101010Z", state: "queued", ...(routing ? { routing } : {}),
    directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: {} },
  });
  const started = (w: Record<string, any>, extra: Record<string, unknown> = {}) => ({
    jobId: "s", root: "proj", projectId: "p", runId: "s-20260928T101010Z", guardS: 600,
    defn: { id: "s", trigger: "one-shot", target: { skill: "tk-studio-activate" } }, woke: w, ...extra,
  });
  /** Runs finishRun with a fake invoker answering `out`; returns the invoke args and the finish argv. */
  async function drive(s: ReturnType<typeof started>, out: Record<string, unknown>) {
    const invoked: Record<string, unknown>[] = [];
    const verbs: string[][] = [];
    const summary = await finishRun(s as any, async (_root, args) => { verbs.push(args); return { ok: true }; },
      async (_root, _skill, args) => { invoked.push(args as Record<string, unknown>); return out; });
    return { summary, args: invoked[0], finish: verbs.find((v) => v[0] === "finish")! };
  }
  const BLOCK = { status: "complete", intent: "tk-studio-activate", artifacts: [] };

  test("woke.routing forwarded verbatim when there is no override", async () => {
    const { args } = await drive(started(woke({ model: "claude-x-routing", effort: "high" })), { status_block: BLOCK });
    expect(args).toMatchObject({ model: "claude-x-routing", effort: "high" });
  });

  test("a submission override wins over routing", async () => {
    const { args } = await drive(started(woke({ model: "claude-x-routing", effort: "high" }), { model: "claude-y", effort: "low" }), { status_block: BLOCK });
    expect(args).toMatchObject({ model: "claude-y", effort: "low" });
  });

  test("neither → no model, no effort (the supervisor never chooses one)", async () => {
    const { args } = await drive(started(woke()), { status_block: BLOCK });
    expect("model" in args).toBe(false);
    expect("effort" in args).toBe(false);
  });

  test("the registry entry root rides to the invocation as the sbx VM root source (vmHostRoot), not the caller's root", async () => {
    const opts: unknown[] = [];
    await finishRun(started(woke(), { tier: "sbx", sandbox: "s", registryRoot: "reg-root" }) as any,
      async () => ({ ok: true }),
      async (root, _skill, _args, _spawner, o) => { opts.push({ root, o }); return { status_block: BLOCK }; });
    expect(opts).toEqual([{ root: "proj", o: { vmHostRoot: "reg-root" } }]);
  });

  test("tier, sandbox and permission mode reach the invocation", async () => {
    const { args } = await drive(started(woke(), { tier: "sbx", sandbox: "claude-p", permissionMode: "bypassPermissions" }), { status_block: BLOCK });
    expect(args).toMatchObject({ tier: "sbx", sandbox: "claude-p", permission_mode: "bypassPermissions" });
  });

  test("finish gets the studio run id and --total-cost-usd; a missing block with no session → partial naming MISSING_STATUS_BLOCK and the cause", async () => {
    const ok = await drive(started(woke()), { status_block: BLOCK, total_cost_usd: 0.42 });
    expect(ok.finish.slice(0, 7)).toEqual(["finish", "--directory", "proj", "--run-id", "s-20260928T101010Z", "--state", "complete"]);
    expect(ok.finish.slice(ok.finish.indexOf("--total-cost-usd"), ok.finish.indexOf("--total-cost-usd") + 2)).toEqual(["--total-cost-usd", "0.42"]);
    expect(ok.summary).toMatchObject({ ok: true, total_cost_usd: 0.42 });
    const missing = await drive(started(woke()), { conformance_failure: MISSING_STATUS_BLOCK, total_cost_usd: 0.1 });
    expect(missing.finish.slice(3, 9)).toEqual(["--run-id", "s-20260928T101010Z", "--state", "partial", "--reason", `${MISSING_STATUS_BLOCK}; no session recorded`]);
    expect(missing.finish).toContain("--total-cost-usd");
  });
});

// ---------------------------------------------------------------- end to end
// Real studio verbs (uv + TK_STUDIO_ROOT) against a throwaway store and
// project; only the worker is faked (CLAUDE_BIN printing a json result).

// win32 too (DW-5, DW-10): the fakes are real executables there (`fakeBin`).
const canRunE2E = !!process.env.TK_STUDIO_ROOT && spawnSync("uv", ["--version"]).status === 0;

function e2eFixture(workerResult: string, loggedIn = true, opts: { selfFinish?: boolean; env?: Record<string, string> } = {}) {
  const store = mkdtempSync(join(tmpdir(), "tk-sup-e2e-store-"));
  const project = mkdtempSync(join(tmpdir(), "tk-sup-e2e-proj-"));
  mkdirSync(join(project, ".tk-studio", "jobs"), { recursive: true });
  copyFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), join(project, ".tk-studio", "jobs", "studio-health.json"));
  const plugin = join(process.env.TK_STUDIO_ROOT!, "plugins", "tk-studio");
  const reg = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "register", "--directory", project, "--writer", "onboard"],
    { env: { ...process.env, TK_STUDIO_HOME: store }, encoding: "utf-8" });
  if (reg.status !== 0) throw new Error(`fixture register failed: ${reg.stdout}${reg.stderr}`);
  // Story 27.1: every run takes a worktree — the project is a git repo with a bare `origin`, the work
  // folder is set, `gh` is the fake (a protected `main`), and `tk install`/`tk activate` are fakes
  // under a throwaway TK_STUDIO_ROOT (the real studio mirrored around them).
  const origin = gitInit(project);
  const gh = fakeGh(mkdtempSync(join(tmpdir(), "tk-sup-e2e-gh-")));
  const studio = fakeStudioRoot(process.env.TK_STUDIO_ROOT!);
  const work = mkdtempSync(join(tmpdir(), "tk-sup-e2e-work-"));
  const worktreeEnv = { TK_STUDIO_ROOT: studio.root, TK_SUPERVISOR_WORK: work, GH_BIN: gh.bin };
  const record = join(store, "worker-calls.jsonl");
  const fakeScript = join(store, "fake-claude.js");
  const workerMarker = join(store, "worker-ran.marker");
  const fake = fakeBin(fakeScript, `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, apiKey: process.env.ANTHROPIC_API_KEY ?? null }) + "\\n");
if (args[0] === "auth") {
  // AC4 after-wake kill point: on the invoke's auth preflight (the second auth call — the first is
  // runJob's login check), once (a marker file), kill the parent supervisor by its pid.
  const authKill = process.env.FAKE_CLAUDE_KILL_PARENT_ON_INVOKE_AUTH;
  if (authKill && !fs.existsSync(authKill)) {
    const count = authKill + ".count";
    const n = (fs.existsSync(count) ? Number(fs.readFileSync(count, "utf-8")) : 0) + 1;
    fs.writeFileSync(count, String(n));
    if (n === 2) { fs.writeFileSync(authKill, String(process.pid)); process.kill(Number(process.env.FAKE_PARENT_PID ?? process.ppid), "SIGKILL"); process.exit(1); }
  }
  console.log(JSON.stringify({ loggedIn: ${loggedIn}, authMethod: "claude.ai" })); process.exit(0);
}
fs.writeFileSync(${JSON.stringify(workerMarker)}, "ran\\n");
if (${opts.selfFinish === true}) {
  // Race the supervisor: end this run first, so its own finish is refused.
  const payload = JSON.parse(args[1].split("\\n")[0].replace(/^\\S+ /, ""));
  // The registered checkout, not payload.directory: since Story 27.1 that is the run's worktree.
  require("node:child_process").spawnSync("uv", ["run", ${JSON.stringify(join(plugin, "lib", "jobrun.py"))}, "finish", "--directory", ${JSON.stringify(project)},
    "--run-id", payload.run_id, "--state", "cancelled", "--reason", "raced by the worker"], { encoding: "utf-8" });
}
// A session transcript under CLAUDE_CONFIG_DIR (the fixture's own dir): the supervisor accounts its turns/tokens.
// The supervisor's --session-id is honoured; --resume <id> appends to that session's transcript (never a new id).
const flagValue = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const resumed = flagValue("--resume");
const sessionId = resumed ?? flagValue("--session-id") ?? ("sess-" + process.pid + "-" + Date.now());
const tdir = require("node:path").join(process.env.CLAUDE_CONFIG_DIR, "projects", "fake-slug");
fs.mkdirSync(tdir, { recursive: true });
const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
fs.appendFileSync(require("node:path").join(tdir, sessionId + ".jsonl"),
  JSON.stringify({ type: "assistant", message: { id: resumed ? "msg-resume-" + process.pid : "msg-1", usage } }) + "\\n");
// AC4 mid-invoke kill point: once (a marker file), the worker kills its own parent — the supervisor
// that spawned it, by pid — then keeps working (bounded: 30 s) until the restarted supervisor kills it.
const killMarker = process.env.FAKE_CLAUDE_KILL_PARENT_ONCE;
if (killMarker && !resumed && !fs.existsSync(killMarker)) {
  // Mid-invoke means the worker is recorded. On win32 the record follows a PowerShell start-time read
  // (about half a second), so wait for it (bounded) before killing the supervisor.
  const { Database } = require("bun:sqlite");
  for (const until = Date.now() + 15_000; Date.now() < until;) {
    let recorded = false;
    try {
      const db = new Database(process.env.FAKE_QUEUE_DB, { readonly: true });
      recorded = !!db.query("SELECT 1 FROM runs WHERE state = 'running' AND worker_pid IS NOT NULL").get();
      db.close();
    } catch { /* the queue file is busy or not there yet */ }
    if (recorded) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  fs.writeFileSync(killMarker, String(process.pid));
  process.kill(Number(process.env.FAKE_PARENT_PID ?? process.ppid), "SIGKILL");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
  process.exit(0);
}
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: ${JSON.stringify(workerResult)}, total_cost_usd: 0.0123, session_id: sessionId, num_turns: 1, usage }));
`);
  // A fake `sbx exec <sb> [timeout -k <s> <guard>] env [-u K]… [-C dir] claude …`: records its argv, then runs
  // the fake claude with the env and cwd the wrapper names (argv only, no shell). Story 27.2: it answers the
  // pin (`run -d --name <sb>`), the release (`stop <sb>`) and the in-VM probes and kills (`exec <sb> cat
  // /proc/<pid>/stat` → no such process, `kill`, `pgrep` → no match, the hold's `tail`).
  const sbxRecord = join(store, "sbx-calls.jsonl");
  const fakeSbx = fakeBin(join(store, "fake-sbx.js"), `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(sbxRecord)}, JSON.stringify({ args, apiKey: process.env.ANTHROPIC_API_KEY ?? null }) + "\\n");
// Story 33.3: with FAKE_SBX_STATE (a JSON file {running[], logged_out[]}) \`ls\` lists the running sandboxes, \`stop\` stops
// one (a fresh start brings its login back), \`run -d\` starts it, and the login probe of a logged-out one answers
// loggedIn false. Without it \`ls\` is unsupported (exit 97: not running, so no probe and no restart).
const stateFile = process.env.FAKE_SBX_STATE;
const st = stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf-8")) : null;
const save = () => fs.writeFileSync(stateFile, JSON.stringify(st));
if (st && args[0] === "ls" && args.length === 1) {
  console.log("SANDBOX   AGENT   STATUS");
  for (const sb of st.running) console.log(sb + "   claude   running");
  process.exit(0);
}
if (args[0] === "run" && args[1] === "-d" && args[2] === "--name" && args[3]) {
  if (st && !st.running.includes(args[3])) { st.running.push(args[3]); save(); }
  process.exit(0);
}
if (args[0] === "stop" && args[1]) {
  if (st) { st.running = st.running.filter((s) => s !== args[1]); st.logged_out = st.logged_out.filter((s) => s !== args[1]); save(); }
  process.exit(0);
}
if (st && args[0] === "exec" && st.logged_out.includes(args[1]) && args.slice(2).join(" ") === "env -u ANTHROPIC_API_KEY claude auth status --json") {
  console.log(JSON.stringify({ loggedIn: false })); process.exit(0);
}
if (args[0] === "exec" && args[2] === "cat" && /^\\/proc\\/\\d+\\/stat$/.test(args[3] ?? "")) { console.error("cat: " + args[3] + ": No such file or directory"); process.exit(1); }
if (args[0] === "exec" && (args[2] === "kill" || args[2] === "tail")) process.exit(0);
if (args[0] === "exec" && args[2] === "pgrep") process.exit(1);
const at = args[2] === "timeout" && args[3] === "-k" ? 6 : 2;
if (args[0] !== "exec" || args[at] !== "env") process.exit(97);
const env = { ...process.env };
let i = at + 1, cwd;
while (args[i] === "-u" || args[i] === "-C") { if (args[i] === "-u") delete env[args[i + 1]]; else cwd = args[i + 1]; i += 2; }
if (args[i] !== "claude") process.exit(98);
// The -C folder is a VM path (/c/...). This fake runs on the host: on win32 that folder is C:/...
if (process.platform === "win32" && cwd && cwd[0] === "/" && cwd[2] === "/") cwd = cwd[1].toUpperCase() + ":" + cwd.slice(2);
const r = require("node:child_process").spawnSync(process.execPath, [${JSON.stringify(fakeScript)}, ...args.slice(i + 1)], { env, cwd, stdio: "inherit" });
process.exit(r.status ?? 1);
`);
  // The queue lives outside every repo and outside the store.
  const queueDb = join(mkdtempSync(join(tmpdir(), "tk-sup-e2e-queue-")), "queue.db");
  const extraEnv = { SBX_BIN: fakeSbx, CLAUDE_CONFIG_DIR: join(store, "claude-config"), FAKE_QUEUE_DB: queueDb, ...worktreeEnv, ...(opts.env ?? {}) };
  const cli = (verb: string, jobId: string, dir: string, extra: string[] = []) => spawnSync("bun", [join(REPO, "src", "cli.ts"), verb, jobId, "--directory", dir, ...extra], {
    env: { ...process.env, TK_STUDIO_HOME: store, TK_SUPERVISOR_DB: queueDb, CLAUDE_BIN: fake, ANTHROPIC_API_KEY: "sk-test-parent", ...extraEnv }, encoding: "utf-8", timeout: 120_000,
  });
  const run = (jobId = "studio-health", dir = project, extra: string[] = []) => cli("run", jobId, dir, extra);
  const submit = (jobId = "studio-health", dir = project, extra: string[] = []) => cli("submit", jobId, dir, extra);
  /** `recover` / `drain`: no job, no directory. */
  const bare = (verb: string) => spawnSync("bun", [join(REPO, "src", "cli.ts"), verb], {
    env: { ...process.env, TK_STUDIO_HOME: store, TK_SUPERVISOR_DB: queueDb, CLAUDE_BIN: fake, ANTHROPIC_API_KEY: "sk-test-parent", ...extraEnv }, encoding: "utf-8", timeout: 120_000,
  });
  /** Read the queue file (it may not exist yet: nothing opened it). */
  const queue = <T>(read: (q: Queue) => T): T => {
    const q = new Queue(queueDb);
    try { return read(q); } finally { q.close(); }
  };
  const calls = () => existsSync(record) ? readFileSync(record, "utf-8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const sbxCalls = () => existsSync(sbxRecord) ? readFileSync(sbxRecord, "utf-8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const ledger = () => {
    const dir = join(store, "measurements");
    return existsSync(dir) ? readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf-8").trim().split("\n").map((l) => JSON.parse(l))) : [];
  };
  const jobVerb = (args: string[]) => {
    const res = spawnSync("uv", ["run", join(plugin, "lib", "jobrun.py"), ...args],
      { env: { ...process.env, TK_STUDIO_HOME: store }, encoding: "utf-8" });
    return JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));
  };
  const registeredId = () => {
    const res = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "show"],
      { env: { ...process.env, TK_STUDIO_HOME: store }, encoding: "utf-8" });
    return Object.keys(JSON.parse(res.stdout.slice(res.stdout.indexOf("{"))).projects)[0];
  };
  /** Nothing woken: no studio-health run and no job-run event in the throwaway store. */
  const expectNothingWoken = () => {
    expect(jobVerb(["status", "--directory", project, "--job-id", "studio-health"]).runs).toEqual([]);
    expect(ledger().filter((e) => e.event === "job-run")).toEqual([]);
  };
  /** Story 27.1: the run's worktree path (`<work>/worktrees/<project id>/<run id>`). */
  const worktreeOf = (runId: string) => join(work, "worktrees", basename(project), runId);
  return {
    store, project, fake, run, submit, bare, queue, queueDb, calls, sbxCalls, ledger, workerMarker, jobVerb, registeredId, expectNothingWoken,
    origin, gh, studio, work, worktreeEnv, worktreeOf,
  };
}

describe.skipIf(!canRunE2E)("CLI end to end: studio-health (faked worker)", () => {
  test("submit → invoke → finish records the block, the cost, and a job-run event", () => {
    const fx = e2eFixture(`Drift check clean.\n{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`);
    const res = fx.run();
    expect(res.status).toBe(0);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, target: "skill", state: "complete", total_cost_usd: 0.0123 });
    expect(summary.status_block).toMatchObject({ status: "complete", intent: "tk-studio-activate" });

    const worker = fx.calls().find((c) => c.args[0] === "-p");
    expect(worker.args[1]).toStartWith("/tk-studio:tk-studio-activate ");
    expect(worker.args).toContain("--output-format");
    expect(worker.args.slice(worker.args.indexOf("--permission-mode"), worker.args.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "auto"]);
    expect(worker.apiKey).toBeNull();
    expect(fx.calls().every((c) => !c.args.includes("--version"))).toBe(true);

    const events = fx.ledger().filter((e) => e.event === "job-run" && e.payload.run_id === summary.studio_run_id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ state: "complete", total_cost_usd: 0.0123 });

    // No tier anywhere: the host tier, spawned directly (no sbx), recorded on the queue run.
    expect(fx.sbxCalls()).toEqual([]);
    expect(fx.queue((q) => q.get(summary.run_id))).toMatchObject({ tier: "host", sandbox: null });

    // Story 27.2 (AC3): `run` never runs `recoverQueue` — its claim alone wrote the checkout's starter lock
    // in the store (`<TK_STUDIO_HOME>/projects/<project key>/starter.lock`), never in the checkout.
    const lockFile = join(fx.store, "projects", fx.registeredId().replace(/[^A-Za-z0-9._\-]/g, "_"), "starter.lock");
    expect(JSON.parse(readFileSync(lockFile, "utf-8"))).toMatchObject({ starter: STARTER, checkout: checkoutKey(fx.project) });
    expect(existsSync(join(fx.project, "starter.lock"))).toBe(false);
  }, 120_000);

  test("missing block (AC2 silent exit) → one in-process `--resume <session-id>`; the second silent exit ends partial naming MISSING_STATUS_BLOCK and the cap", () => {
    const fx = e2eFixture("Looked around; nothing to report.");
    const res = fx.run();
    expect(res.status).toBe(1);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ state: "partial", reason: `${MISSING_STATUS_BLOCK}; resume cap reached (1)` });
    expect(fx.ledger().some((e) => e.event === "job-run" && e.payload.state === "partial")).toBe(true);
    // The first invoke carries the pre-minted --session-id; the resume carries --resume with the same id
    // and the continuation prompt as the one -p item; every other flag unchanged.
    const workers = fx.calls().filter((c) => c.args[0] === "-p");
    expect(workers).toHaveLength(2);
    const sid = workers[0].args[workers[0].args.indexOf("--session-id") + 1];
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(workers[1].args.slice(workers[1].args.indexOf("--resume"), workers[1].args.indexOf("--resume") + 2)).toEqual(["--resume", sid]);
    expect(workers[1].args).not.toContain("--session-id");
    expect(workers[1].args).not.toContain("--fork-session");
    expect(workers[1].args[1]).toBe(CONTINUATION_PROMPT);
    const flagsOf = (a: string[]) => a.slice(2).filter((x, i, all) => x !== sid && !["--resume", "--session-id"].includes(x) && all[i - 1] !== "--resume");
    expect(flagsOf(workers[1].args)).toEqual(flagsOf(workers[0].args));
    const [run, events] = fx.queue((q) => [q.get(summary.run_id), lifecycle(q, summary.run_id)] as const);
    expect(run).toMatchObject({ state: "partial", session_id: sid });
    const resumed = events.filter((e) => e.kind === "resumed");
    expect(resumed).toHaveLength(1);
    expect(resumed[0].detail).toMatchObject({ resume: 1, reason: "silent worker exit", session_id: sid, accounted: { turns: 1 } });
    // Each iteration accounted once, only its own messages (msg-1, then the resumed message).
    expect(events.filter((e) => e.kind === "accounted").map((e) => (e.detail as any).message_ids.length)).toEqual([1, 1]);
  }, 120_000);

  test("login absent → blocked naming the Max login; nothing woken, worker never spawned", () => {
    const fx = e2eFixture("unused", false);
    const res = fx.run();
    expect(res.status).toBe(1);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ state: "blocked", run_id: null });
    expect(summary.reason).toContain("Max login");
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    fx.expectNothingWoken();
  }, 120_000);

  test("Story 33.2: drained with no Max login → the run stays `queued` with one `claim-refused` naming the login and the fix (two passes, one event), nothing woken", () => {
    const fx = e2eFixture("unused", false);
    const queued = JSON.parse(fx.submit().stdout);
    for (let pass = 0; pass < 2; pass++) {
      const res = fx.bare("drain");
      expect(res.status).toBe(1);
      expect(JSON.parse(res.stdout).runs[0]).toMatchObject({ run_id: queued.run_id, summary: { ok: false, state: "queued", reason: expect.stringContaining("Max login") } });
    }
    expect(fx.queue((q) => q.get(queued.run_id))!.state).toBe("queued");
    const refused = fx.queue((q) => q.events(queued.run_id).filter((e) => e.kind === "claim-refused"));
    expect(refused).toHaveLength(1);
    expect(refused[0]!.detail).toMatchObject({ reason: expect.stringContaining("Max login"), resolves: expect.stringContaining("/login") });
    // The notifier is not configured under the suite: the skip is recorded on the event, once.
    expect(refused[0]!.detail!.notify).toMatchObject({ ok: false });
    expect(fx.queue((q) => q.events(queued.run_id).map((e) => e.kind))).not.toContain("claimed");
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    fx.expectNothingWoken();
  }, 180_000);

  test("unknown job → non-zero naming the problem, nothing woken", () => {
    const fx = e2eFixture("unused");
    const res = fx.run("no-such-job");
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toContain("no-such-job");
    fx.expectNothingWoken();
  }, 120_000);

  test("host bypass → exit 2 naming HostBypassRefused; CLAUDE_BIN never invoked, nothing woken", () => {
    const fx = e2eFixture("unused");
    const res = fx.run("studio-health", fx.project, ["--permission-mode", "bypassPermissions"]);
    expect(res.status).toBe(2);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: false, state: "blocked", run_id: null });
    expect(summary.error).toContain("HostBypassRefused");
    expect(fx.calls()).toEqual([]); // not even `auth`
    fx.expectNothingWoken();
  }, 120_000);

  test("unknown --permission-mode → exit 2 (bad invocation), nothing woken", () => {
    const fx = e2eFixture("unused");
    const res = fx.run("studio-health", fx.project, ["--permission-mode", "yolo"]);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toContain("permission_mode");
    fx.expectNothingWoken();
  }, 120_000);

  test("unregistered directory claiming a registered project_id → exit 2 naming the root mismatch", () => {
    const fx = e2eFixture("unused");
    const impostor = mkdtempSync(join(tmpdir(), "tk-sup-impostor-"));
    mkdirSync(join(impostor, ".tk-studio", "jobs"), { recursive: true });
    copyFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), join(impostor, ".tk-studio", "jobs", "studio-health.json"));
    writeFileSync(join(impostor, ".tk-studio", "config.yaml"), `project_id: ${fx.registeredId()}\n`);
    const res = fx.run("studio-health", impostor);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toContain("does not match the registry entry");
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    fx.expectNothingWoken();
  }, 120_000);

  test("unreadable project config → exit 2 naming it, not a silent fallback", () => {
    const fx = e2eFixture("unused");
    writeFileSync(join(fx.project, ".tk-studio", "config.yaml"), "project_id: [unclosed\n");
    const res = fx.run();
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toContain("project config unreadable");
    fx.expectNothingWoken();
  }, 120_000);

  test("finish refused after the run exists → exit 1 keeping the run id; the reason stays the worker's own, the refusal a `finish-refused` event (DW-23)", () => {
    const fx = e2eFixture(`{"status":"complete","reason":"the skill finished its own run","intent":"tk-studio-activate","artifacts":[]}`, true, { selfFinish: true });
    const res = fx.run();
    expect(res.status).toBe(1);
    const summary = JSON.parse(res.stdout);
    expect(summary.run_id).toStartWith("q-studio-health-");
    expect(summary.studio_run_id).toStartWith("studio-health-");
    // Story 27.5 (DW-23): the worker's own status-block reason, never the refusal text.
    // (the account the studio refused on the self-finished run is appended, as for any iteration)
    expect(summary.reason).toStartWith("the skill finished its own run");
    expect(summary.reason).not.toContain("finish failed");
    expect(summary.finish_refused.error).toStartWith("finish failed:");
    const run = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", summary.studio_run_id]).runs[0];
    expect(run.state).toBe("cancelled");
    expect(summary.state).toBe(run.state); // the run's real state, not the stale wake/submit answer
    expect(summary.finish_refused.actual_state).toBe(run.state);
    const [queued, refused] = fx.queue((q) => [q.get(summary.run_id), q.events(summary.run_id).filter((e) => e.kind === "finish-refused")] as const);
    expect(queued).toMatchObject({ state: "cancelled", reason: summary.reason });
    expect(refused).toHaveLength(1);
    expect(refused[0]!.detail).toEqual({ error: summary.finish_refused.error, actual_state: "cancelled" });
  }, 120_000);

  // Story 27.5 (DW-23 is limited to a refusal on an already-terminal studio run): a `finish` that fails while the
  // studio run is still running (or its status is unreadable → unknown) keeps the baseline `finish failed: …`.
  test.each([["running"], ["unknown"]])("finish failing with the studio run %s → the reason stays `finish failed: …`, no `finish-refused` event (DW-23)", async (actual) => {
    const runner = async (_root: string, args: string[]) => {
      if (args[0] === "finish") throw new Error("uv timed out after 720s");
      if (args[0] === "status") {
        if (actual === "unknown") throw new Error("status unreadable");
        return { runs: [{ run_id: "s-20260928T101010Z", state: "running" }] };
      }
      return { ok: true };
    };
    const defn = { id: "s", trigger: "one-shot", target: { skill: "tk-studio-activate" } };
    const started = { jobId: "s", root: "proj", projectId: "p", runId: "s-20260928T101010Z", guardS: 600, defn,
      woke: { accepted: true, run_id: "s-20260928T101010Z", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: {} } } };
    const summary = await finishRun(started as any, runner, async () => ({
      status_block: { status: "complete", reason: "the worker's own reason", intent: "tk-studio-activate", artifacts: [] } }));
    expect(summary).toMatchObject({ ok: false, state: actual });
    expect(summary.reason).toBe("finish failed: uv timed out after 720s");
    expect(summary.finish_refused).toBeUndefined();
    const q = new Queue(join(mkdtempSync(join(tmpdir(), "tk-sup-dw23-q-")), "q.db"), { ownerAlive: () => true, engineLive: async () => ({ live: false }) });
    try {
      const { run } = q.enqueue({ jobId: "s", root: mkdtempSync(join(tmpdir(), "tk-sup-dw23-co-")), target: "skill", definition: defn });
      await mirror(q, run.run_id, { jobId: "s", defn }, summary, runner);
      expect(q.events(run.run_id).filter((e) => e.kind === "finish-refused")).toEqual([]);
      expect(q.get(run.run_id)!.reason).toContain("finish failed: uv timed out after 720s");
    } finally { q.close(); }
  });

  test("unregistered project → non-zero naming the registry refusal", () => {
    const fx = e2eFixture("unused");
    const res = fx.run("studio-health", mkdtempSync(join(tmpdir(), "tk-sup-unreg-")));
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toMatch(/registry: .*not registered/);
  }, 120_000);
});

describe.skipIf(!canRunE2E)("CLI end to end: maintenance-conformance (core job)", () => {
  test("wake runs the core to a terminal state; no worker, no finish; outcome reported from status", () => {
    const fx = e2eFixture("unused");
    const res = fx.run("maintenance-conformance");
    const summary = JSON.parse(res.stdout);
    expect(summary.target).toBe("core");
    expect(summary.run_id).toStartWith("q-maintenance-conformance-");
    expect(summary.studio_run_id).toStartWith("maintenance-conformance-");
    expect(["complete", "partial", "blocked", "cancelled"]).toContain(summary.state);
    expect(res.status).toBe(summary.state === "complete" ? 0 : 1);

    // No worker session: the fake CLAUDE_BIN only ever answered the login preflight.
    expect(existsSync(fx.workerMarker)).toBe(false);
    expect(fx.calls().map((c) => c.args[0])).toEqual(["auth"]);

    // No finish beyond wake's own terminal transition: exactly one job-run event, from wake.
    const events = fx.ledger().filter((e) => e.event === "job-run" && e.payload.run_id === summary.studio_run_id);
    expect(events).toHaveLength(1);
    expect(events[0].payload.state).toBe(summary.state);
    expect(summary.finish).toBeUndefined();

    // The outcome is status's record of the run (wake answers no status_block; status does).
    const status = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "maintenance-conformance", "--run-id", summary.studio_run_id]);
    const run = status.runs[0];
    expect(run.run_id).toBe(summary.studio_run_id);
    expect(summary.state).toBe(run.state);
    expect(summary.status_block).toBeDefined();
    expect(summary.status_block).toEqual(run.status_block);
    expect(summary.reason).toBe(run.reason);

    // The queue run mirrors the studio outcome.
    expect(fx.queue((q) => q.get(summary.run_id))).toMatchObject({ state: summary.state, studio_run_id: summary.studio_run_id, target: "core" });
  }, 120_000);
});

describe.skipIf(!canRunE2E)("CLI end to end: the durable queue", () => {
  test("submit an invalid job → exit 2 with resolve's problems verbatim; nothing queued", () => {
    const fx = e2eFixture("unused");
    const bad = JSON.parse(readFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), "utf-8"));
    bad.id = "bad-job";
    delete bad.guards;
    writeFileSync(join(fx.project, ".tk-studio", "jobs", "bad-job.json"), JSON.stringify(bad));
    const res = fx.submit("bad-job");
    expect(res.status).toBe(2);
    const answer = JSON.parse(res.stdout);
    expect(answer).toMatchObject({ ok: false, run_id: null });
    expect(answer.problems).toEqual(["missing required field 'guards'"]);
    expect(answer.error).toContain("missing required field 'guards'");
    expect(fx.queue((q) => [q.runs().length, lifecycle(q).length,
      (q.db.query("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n])).toEqual([0, 0, 0]);
  }, 120_000);

  test("submit twice → the same queued run; minted once; nothing driven", () => {
    const fx = e2eFixture("unused");
    const first = fx.submit();
    const second = fx.submit();
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const [a, b] = [JSON.parse(first.stdout), JSON.parse(second.stdout)];
    expect(a).toMatchObject({ ok: true, state: "queued", minted: true });
    expect(a.run_id).toStartWith("q-studio-health-");
    expect(b).toMatchObject({ ok: true, run_id: a.run_id, state: "queued", minted: false });
    expect(fx.queue((q) => q.runs().map((r) => [r.run_id, r.state]))).toEqual([[a.run_id, "queued"]]);
    fx.expectNothingWoken();
  }, 120_000);

  test("run adopts the submitted run and records its transitions ending in the studio outcome", () => {
    const fx = e2eFixture(`{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`);
    const queued = JSON.parse(fx.submit().stdout);
    const res = fx.run();
    expect(res.status).toBe(0);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, state: "complete", run_id: queued.run_id });
    expect(summary.studio_run_id).toStartWith("studio-health-");
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", summary.studio_run_id]).runs[0];
    expect(studio.state).toBe("complete");
    const [run, events, lock] = fx.queue((q) => [q.get(summary.run_id), lifecycle(q, summary.run_id), q.lock(fx.project)] as const);
    expect(run).toMatchObject({ state: "complete", studio_run_id: summary.studio_run_id, owner_pid: null });
    expect(events.map((e) => [e.kind, e.to_state])).toEqual([
      // Story 27.1: the default base_ref resolved at claim, then the run's worktree — before the minting verb.
      ["enqueued", "queued"], ["claimed", "running"], ["base-ref", "running"], ["worktree", "running"], ["materialised", "running"], ["verb-started", "running"], ["studio-run", "running"],
      // Story 21.6: the wake answer, the pre-minted session, the spawned worker, the accounted messages — before `ended`.
      ["woke", "running"], ["session", "running"], ["worker", "running"], ["accounted", "running"], ["ended", "complete"],
    ]);
    // The pre-verb snapshot is stored with verb_started: no studio-health run existed before.
    expect(events[5].detail).toEqual({ verb: "submit", snapshot: [], target: "skill" });
    // Story 27.1: nothing landed — "no changes" on `ended`, no PR, the worktree removed.
    expect(events.at(-1)!.detail).toMatchObject({ no_changes: true, closeout: { result: "no changes", worktree: "removed" } });
    expect(run!.worktree).toBe(fx.worktreeOf(summary.run_id));
    expect(existsSync(fx.worktreeOf(summary.run_id))).toBe(false);
    expect(fx.gh.calls().map((c) => c.argv[0])).toEqual(["api"]); // the protection check only: no PR
    expect(run).toMatchObject({ verb_snapshot: "[]" });
    expect(run!.verb_started).toBeString();
    expect(lock).toBeNull();
    // Terminal: the next submit mints a new run.
    expect(JSON.parse(fx.submit().stdout)).toMatchObject({ minted: true });
  }, 120_000);

  test("run against a checkout held by a live run → stays queued naming the holder, exit 1; already running → its id, exit 1; nothing driven", async () => {
    const fx = e2eFixture("unused");
    const me = { pid: process.pid, host: hostname(), nonce: "test-holder" }; // this test process: alive
    const q = new Queue(fx.queueDb);
    const holder = q.enqueue({ jobId: "other-job", root: fx.project, definition: { id: "other-job" }, owner: me }).run;
    expect((await q.claim(holder.run_id, me)).claimed).toBe(true);
    const res = fx.run();
    expect(res.status).toBe(1);
    const waiting = JSON.parse(res.stdout);
    expect(waiting).toMatchObject({ ok: false, state: "queued", studio_run_id: null, holder: { kind: "run", run_id: holder.run_id, job_id: "other-job", pid: me.pid } });
    expect(waiting.reason).toContain(holder.run_id);
    expect(fx.queue((q) => q.get(waiting.run_id))).toMatchObject({ state: "queued" });
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    fx.expectNothingWoken();

    // The waiting run is now running under this live process: a second `run` answers it, drives nothing.
    q.end(holder.run_id, "complete");
    expect((await q.claim(waiting.run_id, me)).claimed).toBe(true);
    const again = fx.run();
    expect(again.status).toBe(1);
    expect(JSON.parse(again.stdout)).toMatchObject({ ok: false, run_id: waiting.run_id, state: "running" });
    fx.expectNothingWoken();
    q.close();
  }, 120_000);

  test("TK_SUPERVISOR_DB inside the project checkout → QueueDbPlacementRefused, exit 2, no file created", () => {
    const fx = e2eFixture("unused");
    if (!existsSync(join(fx.project, ".git"))) mkdirSync(join(fx.project, ".git")); // Story 27.1: the fixture is already a checkout
    const path = join(fx.project, "q.db");
    const res = spawnSync("bun", [join(REPO, "src", "cli.ts"), "submit", "studio-health", "--directory", fx.project], {
      env: { ...process.env, TK_STUDIO_HOME: fx.store, TK_SUPERVISOR_DB: path }, encoding: "utf-8", timeout: 120_000,
    });
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toContain("QueueDbPlacementRefused");
    expect(existsSync(path)).toBe(false);
  }, 120_000);
});

describe("launchedEngine (the tk-studio-launch status block names the detached engine)", () => {
  test("a launch run's `.bmad-loop/runs/<id>` artifact names the engine", () => {
    expect(launchedEngine("tk-studio-launch", { status: "complete", artifacts: ["docs/x.md", ".bmad-loop/runs/20260928-101500-ab12"] })).toBe("20260928-101500-ab12");
    expect(launchedEngine("tk-studio-launch", { artifacts: ["./.bmad-loop/runs/E1/"] })).toBe("E1");
    expect(launchedEngine(undefined, { intent: "tk-studio-launch", artifacts: [".bmad-loop\\runs\\E2"] })).toBe("E2");
  });

  test("any other skill, or no engine artifact, names none", () => {
    expect(launchedEngine("tk-studio-activate", { artifacts: [".bmad-loop/runs/E1"] })).toBeUndefined();
    expect(launchedEngine("tk-studio-launch", { artifacts: [".bmad-loop/runs/E1/log.txt", "other"] })).toBeUndefined();
    expect(launchedEngine("tk-studio-launch", undefined)).toBeUndefined();
  });
});

describe("tick: an unusable queue", () => {
  test("TK_SUPERVISOR_DB unset → exit 2 before any job, naming QueueDbMissing", () => {
    const env = { ...process.env };
    delete env.TK_SUPERVISOR_DB;
    const res = spawnSync("bun", [join(REPO, "src", "tick.ts"), "--dry-run"], { env, encoding: "utf-8", timeout: 60_000 });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("QueueDbMissing");
    expect(res.stdout).not.toContain(": skip");
  }, 60_000);
});

describe.skipIf(!canRunE2E)("tick: start-of-tick recovery", () => {
  test("a tick recovers a dead-owner `running` orphan once, before any job gating; --dry-run recovers nothing", () => {
    const fx = e2eFixture("unused");
    // A killed tick left its queue run `running` with its studio run still open (which the no-overlap skip would honour forever).
    const queued = JSON.parse(fx.submit().stdout);
    const minted = fx.jobVerb(["submit", "--directory", fx.project, "--id", "studio-health"]);
    expect(minted.run_id).toStartWith("studio-health-");
    const dead = { pid: deadPid(), host: hostname(), nonce: "dead-tick" };
    fx.queue((q) => q.db.run(
      `UPDATE runs SET state = 'running', owner_pid = ?, owner_host = ?, owner_nonce = ?, verb_started = ?, verb_snapshot = '[]',
         studio_run_id = ? WHERE run_id = ?`, [dead.pid, dead.host, dead.nonce, new Date().toISOString(), minted.run_id, queued.run_id]));
    const tick = (extra: string[]) => spawnSync("bun", [join(REPO, "src", "tick.ts"), "--directory", fx.project, ...extra], {
      env: { ...process.env, TK_STUDIO_HOME: fx.store, TK_SUPERVISOR_DB: fx.queueDb, CLAUDE_BIN: fx.fake },
      encoding: "utf-8", timeout: 120_000,
    });

    const dry = tick(["--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).not.toContain("recovered:");
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "running", owner_nonce: "dead-tick" });

    const res = tick([]);
    expect(res.status).toBe(0);
    const lines = res.stdout.split("\n");
    const recovered = lines.findIndex((l) => l.includes(`recovered: ended [${queued.run_id} (studio ${minted.run_id})]`));
    expect(recovered).toBeGreaterThanOrEqual(0);
    // Recovery precedes every per-project/per-job line.
    expect(lines.slice(0, recovered).filter((l) => l.startsWith("[studio-tick]"))).toEqual([]);
    // Story 21.6: no session was recorded (the dead supervisor never spawned a worker) — the cause is named.
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart; no session recorded", owner_pid: null });
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", minted.run_id]).runs[0];
    expect(studio).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart; no session recorded" });
  }, 180_000);
});

/** A pid that no longer exists (a child that already exited). */
const deadPid = () => spawnSync("true").pid;

describe("recover requires the studio first", () => {
  test("`recover` with TK_STUDIO_ROOT unset → exit 2 naming StudioRootMissing; the queue is unchanged", () => {
    const db = join(mkdtempSync(join(tmpdir(), "tk-sup-rec-queue-")), "q.db");
    const q = new Queue(db);
    const dead = { pid: deadPid(), host: hostname(), nonce: "dead" };
    const r = q.enqueue({ jobId: "j", root: mkdtempSync(join(tmpdir(), "tk-sup-checkout-")), definition: { id: "j" }, owner: dead }).run;
    q.close();
    const env: Record<string, string | undefined> = { ...process.env, TK_SUPERVISOR_DB: db, TK_STUDIO_HOME: mkdtempSync(join(tmpdir(), "tk-sup-store-")) };
    delete env.TK_STUDIO_ROOT;
    for (const verb of ["recover", "drain"]) {
      const res = spawnSync("bun", [join(REPO, "src", "cli.ts"), verb], { env, encoding: "utf-8", timeout: 60_000 });
      expect(res.status).toBe(2);
      expect(JSON.parse(res.stdout).error).toContain("StudioRootMissing");
    }
    const after = new Queue(db);
    try {
      expect(after.get(r.run_id)).toMatchObject({ state: "queued", owner_nonce: "dead", reason: null });
      expect(after.events(r.run_id).map((e) => e.kind)).toEqual(["enqueued"]);
    } finally { after.close(); }
  }, 60_000);
});

describe.skipIf(!canRunE2E)("CLI end to end: restart recovery and drain", () => {
  test("`recover` re-queues a run a dead supervisor left `running` before the minting verb; `drain` then drives it", () => {
    const fx = e2eFixture(`{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`);
    const queued = JSON.parse(fx.submit().stdout);
    const dead = { pid: deadPid(), host: hostname(), nonce: "dead-supervisor" };
    fx.queue((q) => q.db.run(
      "UPDATE runs SET state = 'running', owner_pid = ?, owner_host = ?, owner_nonce = ? WHERE run_id = ?",
      [dead.pid, dead.host, dead.nonce, queued.run_id]));

    const rec = fx.bare("recover");
    expect(rec.status).toBe(0);
    expect(JSON.parse(rec.stdout)).toEqual({ ok: true, ended: [], requeued: [queued.run_id], resumed: [] });
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "queued", reason: "requeued: supervisor restart", owner_pid: null });
    fx.expectNothingWoken();

    const drained = fx.bare("drain");
    expect(drained.status).toBe(0);
    const report = JSON.parse(drained.stdout);
    expect(report).toMatchObject({ ok: true, recovered: { ended: [], requeued: [] } });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({ run_id: queued.run_id, job_id: "studio-health", summary: { ok: true, state: "complete", run_id: queued.run_id } });
    const studioId = report.runs[0].summary.studio_run_id;
    expect(fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", studioId]).runs[0].state).toBe("complete");
    expect(fx.queue((q) => lifecycle(q, queued.run_id).map((e) => e.kind))).toEqual([
      "enqueued", "requeued", "claimed", "base-ref", "worktree", "materialised", "verb-started", "studio-run", "woke", "session", "worker", "accounted", "ended",
    ]);

    // Nothing left to drain.
    const again = fx.bare("drain");
    expect(again.status).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({ ok: true, runs: [] });
  }, 180_000);

  test("`drain`: a queued run whose job now fails `resolve` ends `blocked` with the problems verbatim, with its event", () => {
    const fx = e2eFixture("unused");
    const def = JSON.parse(readFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), "utf-8"));
    def.id = "soon-bad";
    const file = join(fx.project, ".tk-studio", "jobs", "soon-bad.json");
    writeFileSync(file, JSON.stringify(def));
    const queued = JSON.parse(fx.submit("soon-bad").stdout);
    expect(queued).toMatchObject({ ok: true, state: "queued", minted: true });
    delete def.guards; // the definition no longer validates
    writeFileSync(file, JSON.stringify(def));

    const res = fx.bare("drain");
    expect(res.status).toBe(1);
    const report = JSON.parse(res.stdout);
    expect(report.ok).toBe(false);
    expect(report.runs).toEqual([{
      run_id: queued.run_id, job_id: "soon-bad", state: "blocked",
      problems: ["missing required field 'guards'"], error: "resolve: missing required field 'guards'",
    }]);
    const [run, last] = fx.queue((q) => [q.get(queued.run_id), lifecycle(q, queued.run_id).at(-1)] as const);
    expect(run).toMatchObject({ state: "blocked", reason: "resolve: missing required field 'guards'" });
    expect(last).toMatchObject({ kind: "ended", from_state: "queued", to_state: "blocked", detail: { reason: "resolve: missing required field 'guards'" } });
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    // Ended, not queued: the next drain has nothing to do.
    expect(JSON.parse(fx.bare("drain").stdout)).toMatchObject({ ok: true, runs: [] });
  }, 180_000);

  test("drain mode: a listed run ended before it is driven is skipped — nothing minted, no studio verb", async () => {
    const fx = e2eFixture("unused");
    const queued = JSON.parse(fx.submit().stdout);
    const q = new Queue(fx.queueDb);
    try {
      q.end(queued.run_id, "cancelled", "ended elsewhere"); // another process drove and ended it after the listing
      const out = await runJob("studio-health", fx.project, undefined, { queue: q, runId: queued.run_id, skipRecover: true });
      expect(out).toMatchObject({ ok: false, skipped: true, run_id: queued.run_id, state: "cancelled" });
      expect(out.reason).toStartWith("skipped:");
      expect(q.runs().map((r) => r.run_id)).toEqual([queued.run_id]); // nothing minted
    } finally { q.close(); }
    expect(fx.calls()).toEqual([]); // not even the login preflight
    fx.expectNothingWoken();
  }, 180_000);

  test("`drain`: a transport failure during re-validation (uv unavailable) leaves the run queued", () => {
    const fx = e2eFixture("unused");
    const queued = JSON.parse(fx.submit().stdout);
    // A PATH where `uv` resolves nowhere. POSIX: bun's own folder, which the fake worker's shebang needs.
    // win32: an empty folder, because bun's folder may hold `uv` too (WinGet's Links does) and the fake is an .exe.
    const noUv = process.platform === "win32" ? mkdtempSync(join(tmpdir(), "tk-sup-e2e-nopath-")) : dirname(process.execPath);
    const res = spawnSync(process.execPath, [join(REPO, "src", "cli.ts"), "drain"], {
      env: { ...process.env, PATH: noUv, TK_STUDIO_HOME: fx.store, TK_SUPERVISOR_DB: fx.queueDb,
        CLAUDE_BIN: fx.fake }, encoding: "utf-8", timeout: 120_000,
    });
    expect(res.status).toBe(1);
    const entry = JSON.parse(res.stdout).runs[0];
    expect(entry).toMatchObject({ run_id: queued.run_id });
    expect(entry.state).toBeUndefined();
    expect(entry.error).toContain("uv spawn failed");
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "queued" });
    fx.expectNothingWoken();
  }, 180_000);

  test("`drain`: a start failure after the claim ends the run `blocked`, and the report carries that state", () => {
    const fx = e2eFixture("unused");
    const queued = JSON.parse(fx.submit().stdout);
    // The queue refuses to record `verb_started`: a failure after the lock was claimed, before the minting verb.
    fx.queue((q) => q.db.run("CREATE TRIGGER refuse_verb_started BEFORE UPDATE OF verb_started ON runs BEGIN SELECT RAISE(ABORT, 'test: verb start refused'); END"));
    const res = fx.bare("drain");
    expect(res.status).toBe(1);
    const entry = JSON.parse(res.stdout).runs[0];
    expect(entry).toMatchObject({ run_id: queued.run_id, job_id: "studio-health", state: "blocked" });
    expect(entry.error).toContain("queue (recording submit start)");
    const run = fx.queue((q) => q.get(queued.run_id))!;
    expect(run.state).toBe("blocked");
    expect(run.reason).toContain("verb start refused");
    expect(fx.queue((q) => lifecycle(q, queued.run_id).map((e) => [e.kind, e.to_state]))).toEqual([
      ["enqueued", "queued"], ["claimed", "running"], ["base-ref", "running"], ["worktree", "running"], ["materialised", "running"], ["ended", "blocked"],
    ]);
    expect(fx.queue((q) => q.lock(fx.project))).toBeNull();
    fx.expectNothingWoken();
  }, 180_000);

  test("`drain`: a queued run whose checkout no longer exists ends `blocked` naming the missing directory", () => {
    const fx = e2eFixture("unused");
    const queued = JSON.parse(fx.submit().stdout);
    rmSync(fx.project, { recursive: true, force: true });
    const res = fx.bare("drain");
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).runs[0]).toMatchObject({ run_id: queued.run_id, state: "blocked" });
    const run = fx.queue((q) => q.get(queued.run_id))!;
    expect(run.state).toBe("blocked");
    expect(run.reason).toContain("directory does not exist");
    expect(fx.queue((q) => lifecycle(q, queued.run_id).at(-1))).toMatchObject({ kind: "ended", to_state: "blocked" });
  }, 180_000);

  test("`drain`: a transient stop before validation (no Max login) leaves the run queued", () => {
    const fx = e2eFixture("unused", false);
    const queued = JSON.parse(fx.submit().stdout);
    const res = fx.bare("drain");
    expect(res.status).toBe(1);
    // The summary names the drained run and its actual queue state (`queued`); Story 33.2: the refusal it records.
    const entry = JSON.parse(res.stdout).runs[0];
    expect(entry).toMatchObject({ run_id: queued.run_id, summary: { ok: false, state: "queued", run_id: queued.run_id, claim_refused: { reason: expect.stringContaining("Max login") } } });
    expect(entry.summary.reason).toContain("Max login");
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "queued" });
    fx.expectNothingWoken();
  }, 180_000);

  test("`drain` drives a run queued by `run --permission-mode plan` (lock wait) under `plan`, not the default", async () => {
    const fx = e2eFixture(`{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`);
    const me = { pid: process.pid, host: hostname(), nonce: "plan-holder" }; // this test process: alive
    const q = new Queue(fx.queueDb);
    try {
      const holder = q.enqueue({ jobId: "other-job", root: fx.project, definition: { id: "other-job" }, owner: me }).run;
      expect((await q.claim(holder.run_id, me)).claimed).toBe(true);
      const res = fx.run("studio-health", fx.project, ["--permission-mode", "plan"]);
      expect(res.status).toBe(1);
      const waiting = JSON.parse(res.stdout);
      expect(waiting).toMatchObject({ ok: false, state: "queued", waited: "lock" });
      expect(q.get(waiting.run_id)).toMatchObject({ state: "queued", owner_pid: null, permission_mode: "plan" });
      q.end(holder.run_id, "complete");

      const drained = fx.bare("drain");
      expect(drained.status).toBe(0);
      const report = JSON.parse(drained.stdout);
      expect(report.runs).toHaveLength(1);
      expect(report.runs[0]).toMatchObject({ run_id: waiting.run_id, summary: { ok: true, state: "complete", run_id: waiting.run_id } });
      const workers = fx.calls().filter((c) => c.args[0] === "-p");
      expect(workers).toHaveLength(1);
      const at = workers[0].args.indexOf("--permission-mode");
      expect(workers[0].args.slice(at, at + 2)).toEqual(["--permission-mode", "plan"]);
      expect(q.get(waiting.run_id)).toMatchObject({ state: "complete", permission_mode: "plan" });
    } finally { q.close(); }
  }, 180_000);

  test("`run` recovers on start: a dead supervisor's minted run ends `partial` (studio run finished too), then a fresh run is driven", () => {
    const fx = e2eFixture(`{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`);
    // A dead supervisor claimed a run, reached `submit` and minted a studio run, then died before recording it.
    const queued = JSON.parse(fx.submit().stdout);
    const verbStarted = new Date().toISOString();
    const minted = fx.jobVerb(["submit", "--directory", fx.project, "--id", "studio-health"]);
    expect(minted.run_id).toStartWith("studio-health-");
    const dead = { pid: deadPid(), host: hostname(), nonce: "dead-supervisor" };
    fx.queue((q) => q.db.run(
      `UPDATE runs SET state = 'running', owner_pid = ?, owner_host = ?, owner_nonce = ?, verb_started = ?, verb_snapshot = '[]'
       WHERE run_id = ?`, [dead.pid, dead.host, dead.nonce, verbStarted, queued.run_id]));

    const res = fx.run();
    expect(res.status).toBe(0);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, state: "complete" });
    expect(summary.run_id).not.toBe(queued.run_id);
    expect(summary.studio_run_id).not.toBe(minted.run_id);

    const orphan = fx.queue((q) => q.get(queued.run_id))!;
    expect(orphan).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart; no session recorded", studio_run_id: minted.run_id });
    expect(fx.queue((q) => lifecycle(q, queued.run_id).at(-1))).toMatchObject({ kind: "orphaned", detail: { lookup: { ok: true, adopted: minted.run_id }, studio: { ok: true } } });
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", minted.run_id]).runs[0];
    expect(studio).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart; no session recorded" });
  }, 180_000);

  test("engine path: a tk-studio-launch block naming `.bmad-loop/runs/<id>` writes `launched` (the run stays running, its end deferred) and hands the lock to the engine; a claim then waits or frees by the probe", async () => {
    const fx = e2eFixture(`Launched.\n{"status":"complete","intent":"tk-studio-launch","artifacts":[".bmad-loop/runs/20260928-101500-ab12"]}`);
    const def = JSON.parse(readFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), "utf-8"));
    Object.assign(def, { id: "launch-probe", target: { skill: "tk-studio-launch", payload: { verb: "status" } } });
    writeFileSync(join(fx.project, ".tk-studio", "jobs", "launch-probe.json"), JSON.stringify(def));

    const res = fx.run("launch-probe");
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, state: "complete", target: "skill" });
    expect(res.status).toBe(0);
    // Story 27.1 (operator-decisions §2): the launch's return writes `launched`, not `ended`: the run
    // stays `running` (live for the pacer), its driver let go, the checkout lock handed to the engine
    // (probed in the run's worktree, the engine's --project).
    const [run, lock, events] = fx.queue((q) => [q.get(summary.run_id), q.lock(fx.project), lifecycle(q, summary.run_id)] as const);
    expect(run).toMatchObject({ state: "running", engine_run_id: "20260928-101500-ab12", owner_pid: null, worktree: fx.worktreeOf(summary.run_id) });
    expect(lock).toMatchObject({ kind: "engine", engine_run_id: "20260928-101500-ab12", run_id: summary.run_id, root: fx.worktreeOf(summary.run_id) });
    const last = events.at(-1)!;
    expect(last).toMatchObject({ kind: "launched", from_state: "running", to_state: "running" });
    expect(last.detail).toMatchObject({
      engine_run_id: "20260928-101500-ab12", lock: { handed_to_engine: "20260928-101500-ab12" },
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/20260928-101500-ab12"] }, end: { state: "complete" },
    });
    expect(events.some((e) => e.kind === "ended")).toBe(false);
    // operator-decisions §2: `finish` is not called at launch return — the studio run stays open
    // (no job-run event) until the engine-end sweep finishes it.
    expect(summary.finish).toBeUndefined();
    expect(summary.finish_deferred).toBe(true);
    expect(fx.jobVerb(["status", "--directory", fx.project, "--job-id", "launch-probe", "--run-id", summary.studio_run_id]).runs[0].state).not.toBe("complete");
    expect(fx.ledger().filter((e) => e.event === "job-run" && e.payload.run_id === summary.studio_run_id)).toEqual([]);
    // The engine's status cannot be read (no bmad-loop here): the sweep never closes it out on a guess.
    expect(existsSync(fx.worktreeOf(summary.run_id))).toBe(true);

    // A second run on the checkout, probes injected: live → waits naming the engine; failed → waits naming the failure; gone → claims.
    let probe = { live: true } as { live: boolean; detail?: string };
    const me = { pid: process.pid, host: hostname(), nonce: "engine-test" };
    const q = new Queue(fx.queueDb, { ownerAlive: () => true, engineLive: async () => probe });
    try {
      const b = q.enqueue({ jobId: "studio-health", root: fx.project, definition: { id: "studio-health" }, owner: me }).run;
      const live = await q.claim(b.run_id, me);
      expect(live).toMatchObject({ claimed: false, why: "lock", holder: { kind: "engine", engine_run_id: "20260928-101500-ab12" } });
      probe = { live: true, detail: "launch status probe failed (exit 1): no bmad-loop" };
      const failed = await q.claim(b.run_id, me);
      if (failed.claimed) throw new Error("claimed under a failed probe");
      expect(failed.reason).toContain("no bmad-loop");
      probe = { live: false };
      expect((await q.claim(b.run_id, me)).claimed).toBe(true);
      expect(q.lock(fx.project)).toMatchObject({ kind: "run", run_id: b.run_id });
    } finally { q.close(); }
  }, 180_000);
  test("mirror: a tk-studio-launch run whose block names no engine probes the launch core before releasing (injected probe: live → the engine holds the lock)", async () => {
    const fx = e2eFixture(`{"status":"blocked","intent":"tk-studio-launch","reason":"engine start unconfirmed","artifacts":[]}`);
    const def = JSON.parse(readFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), "utf-8"));
    Object.assign(def, { id: "launch-probe", target: { skill: "tk-studio-launch", payload: { verb: "status" } } });
    writeFileSync(join(fx.project, ".tk-studio", "jobs", "launch-probe.json"), JSON.stringify(def));
    const probed: (string | null)[][] = [];
    const q = new Queue(fx.queueDb, { ownerAlive: () => true, engineLive: async (root, id) => { probed.push([root, id]); return { live: true, run_ids: ["E9"] }; } });
    const prev = { home: process.env.TK_STUDIO_HOME, bin: process.env.CLAUDE_BIN, cfg: process.env.CLAUDE_CONFIG_DIR };
    process.env.TK_STUDIO_HOME = fx.store;
    process.env.CLAUDE_BIN = fx.fake;
    process.env.CLAUDE_CONFIG_DIR = join(fx.store, "claude-config"); // the fake worker's transcript (max_turns → account)
    try {
      const summary = await runJob("launch-probe", fx.project, undefined, { queue: q, worktree: { env: { ...process.env, ...fx.worktreeEnv } } });
      expect(summary).toMatchObject({ ok: false, state: "blocked", target: "skill" });
      // Story 27.1: a blocked launch ends at once; the engine is probed in the run's worktree, which an engine found keeps.
      // (the end-of-run sweep probes it again before any late close-out: the engine still live, it waits)
      expect(probed.length).toBeGreaterThanOrEqual(1);
      expect(probed.every(([root, id]) => root === fx.worktreeOf(summary.run_id!) && id === null)).toBe(true);
      expect(lifecycle(q, summary.run_id!).some((e) => e.kind === "closed_out")).toBe(false);
      expect(lifecycle(q, summary.run_id!).at(-1)!.detail).toMatchObject({ closeout: { result: "skipped", worktree: "kept" } });
      expect(q.get(summary.run_id!)).toMatchObject({ state: "blocked", engine_run_id: "E9" });
      expect(q.lock(fx.project)).toMatchObject({ kind: "engine", engine_run_id: "E9", run_id: summary.run_id });
      expect(lifecycle(q, summary.run_id!).at(-1)!.detail).toMatchObject({ lock: { handed_to_engine: "E9" }, engine: { live: ["E9"] } });
    } finally {
      for (const [k, v] of [["TK_STUDIO_HOME", prev.home], ["CLAUDE_BIN", prev.bin], ["CLAUDE_CONFIG_DIR", prev.cfg]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      q.close();
    }
  }, 180_000);
});

describe.skipIf(!canRunE2E)("CLI end to end: worker tiers (Story 21.4)", () => {
  const BLOCK_OK = `{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`;
  const flagValue = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  test("`submit --permission-mode bypassPermissions` (no sbx tier) → exit 2 blocked HostBypassRefused; no process, no queue run", () => {
    const fx = e2eFixture("unused");
    const res = fx.submit("studio-health", fx.project, ["--permission-mode", "bypassPermissions"]);
    expect(res.status).toBe(2);
    const answer = JSON.parse(res.stdout);
    expect(answer).toMatchObject({ ok: false, state: "blocked", run_id: null });
    expect(answer.error).toContain("HostBypassRefused");
    expect(fx.calls()).toEqual([]);
    expect(fx.sbxCalls()).toEqual([]);
    expect(fx.queue((q) => q.runs().length)).toBe(0);
  }, 120_000);

  test("`run --tier host --permission-mode bypassPermissions` → HostBypassRefused, zero spawns, zero queue runs", () => {
    const fx = e2eFixture("unused");
    const res = fx.run("studio-health", fx.project, ["--tier", "host", "--permission-mode", "bypassPermissions"]);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout)).toMatchObject({ state: "blocked" });
    expect(JSON.parse(res.stdout).error).toContain("HostBypassRefused");
    expect([fx.calls(), fx.sbxCalls()]).toEqual([[], []]);
    expect(fx.queue((q) => q.runs().length)).toBe(0);
  }, 120_000);

  test.each([
    ["run", ["--tier", "gpu"], "TierRefused"],
    ["run", ["--tier", "sbx"], "SbxSandboxMissing"],
    ["submit", ["--tier", "gpu"], "TierRefused"],
    ["submit", ["--tier", "sbx"], "SbxSandboxMissing"],
  ])("`%s %j` → exit 2 named refusal, nothing queued, no process", (verb, flags, name) => {
    const fx = e2eFixture("unused");
    const res = (verb === "submit" ? fx.submit : fx.run)("studio-health", fx.project, flags as string[]);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toContain(name as string);
    expect([fx.calls(), fx.sbxCalls()]).toEqual([[], []]);
    expect(fx.queue((q) => q.runs().length)).toBe(0);
  }, 120_000);

  test("`run --tier sbx --sandbox claude-p --permission-mode bypassPermissions`: login probe and worker through `sbx exec`", () => {
    const fx = e2eFixture(BLOCK_OK);
    const res = fx.run("studio-health", fx.project, ["--tier", "sbx", "--sandbox", "claude-p", "--permission-mode", "bypassPermissions", "--model", "m-over"]);
    expect(res.status).toBe(0);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, state: "complete", total_cost_usd: 0.0123 });
    const all = fx.sbxCalls();
    // Story 27.2: the pin once, before the worker's own login preflight (`invokeSkill`'s `sbx exec`) and the
    // worker; the release (`sbx stop`) last, once.
    const pins = all.flatMap((c, i) => c.args[0] === "run" ? [i] : []);
    expect(pins).toHaveLength(1);
    expect(all[pins[0]].args).toEqual(["run", "-d", "--name", "claude-p"]);
    expect(all.findLastIndex((c) => c.args.includes("auth"))).toBeGreaterThan(pins[0]);
    expect(all.findIndex((c) => c.args.includes("-p"))).toBeGreaterThan(pins[0]);
    expect(all.filter((c) => c.args[0] === "stop").map((c) => c.args)).toEqual([["stop", "claude-p"]]);
    expect(all.at(-1)!.args).toEqual(["stop", "claude-p"]);
    expect(fx.queue((q) => q.events(summary.run_id).map((e) => e.kind))).toEqual(expect.arrayContaining(["pinned", "pin-released"]));
    const sbx = all.filter((c) => c.args[0] === "exec");
    expect(sbx.length).toBeGreaterThanOrEqual(2);
    expect(sbx.every((c) => c.args[1] === "claude-p")).toBe(true);
    const probe = sbx.find((c) => c.args.includes("auth"))!;
    expect(probe.args).toEqual(["exec", "claude-p", "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"]);
    const worker = sbx.find((c) => c.args.includes("-p"))!;
    // Story 27.1: the VM cwd is the run's worktree (`/c/...` for a win32 host path), never the checkout.
    expect(worker.args.slice(0, 13)).toEqual(["exec", "claude-p", "timeout", "-k", "10", "600", "env", "-u", "ANTHROPIC_API_KEY", "-C", toVmPath(fx.worktreeOf(summary.run_id)), "claude", "-p"]);
    expect(worker.args[13]).toStartWith("/tk-studio:tk-studio-activate ");
    expect(flagValue(worker.args, "--permission-mode")).toBe("bypassPermissions");
    expect(flagValue(worker.args, "--model")).toBe("m-over");
    expect(worker.apiKey).toBeNull(); // stripped on the host too
    expect(fx.calls().filter((c) => c.args[0] === "-p").every((c) => c.apiKey === null)).toBe(true);
    expect(fx.queue((q) => q.get(summary.run_id))).toMatchObject({ state: "complete", tier: "sbx", sandbox: "claude-p", model: "m-over" });
    // finish got the studio run id and the cost: the job-run event carries both.
    const events = fx.ledger().filter((e) => e.event === "job-run" && e.payload.run_id === summary.studio_run_id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ state: "complete", total_cost_usd: 0.0123 });
  }, 120_000);

  test("sbx VM cwd is the run's worktree (Story 27.1), never the `--directory` spelling or the checkout (a symlink samePath accepts)", () => {
    const fx = e2eFixture(BLOCK_OK);
    const spelled = join(mkdtempSync(join(tmpdir(), "tk-sup-e2e-spelled-")), basename(fx.project)); // same basename: the same project id
    try { symlinkSync(fx.project, spelled, "dir"); }
    catch { console.warn("symlink unavailable on this platform — skipping the caller-spelling case"); return; }
    const res = fx.run("studio-health", spelled, ["--tier", "sbx", "--sandbox", "claude-p", "--permission-mode", "bypassPermissions"]);
    expect(res.status).toBe(0);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, state: "complete" });
    const worker = fx.sbxCalls().find((c) => c.args.includes("-p"))!;
    expect(flagValue(worker.args, "-C")).toBe(fx.worktreeOf(summary.run_id));
    expect(flagValue(worker.args, "-C")).not.toBe(spelled);
    expect(flagValue(worker.args, "-C")).not.toBe(fx.project);
    expect(JSON.parse(worker.args[13].split("\n")[0].replace(/^\S+ /, ""))).toMatchObject({ directory: fx.worktreeOf(summary.run_id) });
  }, 120_000);

  test("stored drive: `submit --tier sbx --sandbox s --model m` then `drain` → driven via sbx with --model m", () => {
    const fx = e2eFixture(BLOCK_OK);
    const sub = fx.submit("studio-health", fx.project, ["--tier", "sbx", "--sandbox", "s-stored", "--model", "m-stored", "--effort", "low"]);
    expect(sub.status).toBe(0);
    const queued = JSON.parse(sub.stdout);
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "queued", tier: "sbx", sandbox: "s-stored", model: "m-stored", effort: "low" });
    expect(fx.sbxCalls()).toEqual([]); // submit spawns no worker and no probe
    const drained = fx.bare("drain");
    expect(drained.status).toBe(0);
    expect(JSON.parse(drained.stdout).runs[0]).toMatchObject({ run_id: queued.run_id, summary: { ok: true, state: "complete" } });
    const worker = fx.sbxCalls().find((c) => c.args.includes("-p"))!;
    expect(worker.args.slice(0, 2)).toEqual(["exec", "s-stored"]);
    expect(flagValue(worker.args, "--model")).toBe("m-stored");
    expect(flagValue(worker.args, "--effort")).toBe("low");
    expect(flagValue(worker.args, "--permission-mode")).toBe("auto");
  }, 180_000);

  test("Story 33.3: a drained run whose sandbox runs logged out before the pin → stopped and started once, probed again, claimed; one `pin-restart {probe_before: gap, probe_after: null}`", () => {
    const state = join(mkdtempSync(join(tmpdir(), "tk-sup-e2e-sbxstate-")), "state.json");
    writeFileSync(state, JSON.stringify({ running: ["s-restart"], logged_out: ["s-restart"] }));
    const fx = e2eFixture(BLOCK_OK, true, { env: { FAKE_SBX_STATE: state } });
    const queued = JSON.parse(fx.submit("studio-health", fx.project, ["--tier", "sbx", "--sandbox", "s-restart"]).stdout);
    const drained = fx.bare("drain");
    // The claim is the gate's answer (what the worker's drive then does is the sbx-tier suite's own concern).
    expect(JSON.parse(drained.stdout).runs[0]).toMatchObject({ run_id: queued.run_id });
    expect(JSON.parse(drained.stdout).runs[0].summary?.claim_refused).toBeUndefined();
    expect(fx.queue((q) => q.get(queued.run_id))!.state).not.toBe("queued");
    const restarts = fx.queue((q) => q.events(queued.run_id).filter((e) => e.kind === "pin-restart"));
    expect(restarts).toHaveLength(1);
    expect(restarts[0]!.detail).toMatchObject({ sandbox: "s-restart", probe_before: "harness auth: Max login missing or expired (not logged in)", probe_after: null });
    const ks = fx.queue((q) => q.events(queued.run_id).map((e) => e.kind));
    expect(ks).not.toContain("claim-refused");
    expect(ks).toContain("claimed");
    expect(ks.indexOf("pin-restart")).toBeLessThan(ks.indexOf("claimed"));
    // The gate's sbx verbs: the listing, the pin, the probe, the restart (stop, start), the second probe, the preflight.
    const verbs = fx.sbxCalls().map((c) => c.args[0] === "exec" ? (c.args.includes("auth") ? "auth" : "exec") : c.args[0]);
    expect(verbs.slice(0, 7)).toEqual(["ls", "run", "auth", "stop", "run", "auth", "auth"]);
  }, 180_000);

  test("Story 33.2 (ruling D, re-pinned): an invalid stored tier leaves the drained run `queued` with one `claim-refused` naming it; once it clears the next drain claims it (`claim-refusal-cleared`)", () => {
    const fx = e2eFixture(BLOCK_OK);
    const queued = JSON.parse(fx.submit().stdout);
    fx.queue((q) => q.db.run("UPDATE runs SET tier = 'gpu' WHERE run_id = ?", [queued.run_id]));
    const res = fx.bare("drain");
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).runs[0]).toMatchObject({ run_id: queued.run_id, summary: { ok: false, state: "queued", claim_refused: { reason: expect.stringContaining("TierRefused") } } });
    let run = fx.queue((q) => q.get(queued.run_id))!;
    expect(run.state).toBe("queued");
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    const refused = () => fx.queue((q) => q.events(queued.run_id).filter((e) => e.kind === "claim-refused"));
    expect(refused()).toHaveLength(1);
    expect(refused()[0]!.detail).toMatchObject({ reason: expect.stringContaining("TierRefused"), resolves: expect.stringContaining("tier") });
    const firstPass = String(refused()[0]!.detail!.pass_at);
    // A second pass over the same reason: the same event, `pass_at` moved, never a second event.
    expect(fx.bare("drain").status).toBe(1);
    expect(refused()).toHaveLength(1);
    expect(String(refused()[0]!.detail!.pass_at) >= firstPass).toBe(true);
    // The reason clears: the next pass claims the run and records the clearing.
    fx.queue((q) => q.db.run("UPDATE runs SET tier = 'host' WHERE run_id = ?", [queued.run_id]));
    expect(fx.bare("drain").status).toBe(0);
    run = fx.queue((q) => q.get(queued.run_id))!;
    expect(run.state).toBe("complete");
    const ks = fx.queue((q) => q.events(queued.run_id).map((e) => e.kind));
    expect(ks.filter((k) => k === "claim-refusal-cleared")).toHaveLength(1);
    expect(ks.indexOf("claim-refusal-cleared")).toBeGreaterThan(ks.indexOf("claimed"));
  }, 240_000);

  test("Story 33.2 (ruling D): an sbx tier with no sandbox (SbxSandboxMissing) leaves the drained run `queued` with one `claim-refused` naming it across passes, nothing woken", () => {
    const fx = e2eFixture(BLOCK_OK);
    const queued = JSON.parse(fx.submit().stdout);
    fx.queue((q) => q.db.run("UPDATE runs SET tier = 'sbx', sandbox = NULL WHERE run_id = ?", [queued.run_id]));
    for (let pass = 0; pass < 2; pass++) {
      const res = fx.bare("drain");
      expect(res.status).toBe(1);
      expect(JSON.parse(res.stdout).runs[0]).toMatchObject({ run_id: queued.run_id, summary: { ok: false, state: "queued", claim_refused: { reason: expect.stringContaining("SbxSandboxMissing") } } });
    }
    expect(fx.queue((q) => q.get(queued.run_id))!.state).toBe("queued");
    const refused = fx.queue((q) => q.events(queued.run_id).filter((e) => e.kind === "claim-refused"));
    expect(refused).toHaveLength(1);
    expect(refused[0]!.detail).toMatchObject({ key: "placement:SbxSandboxMissing", reason: expect.stringContaining("SbxSandboxMissing"), resolves: expect.stringContaining("sandbox") });
    expect(fx.queue((q) => q.events(queued.run_id).map((e) => e.kind))).not.toContain("claimed");
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
  }, 240_000);

  test("a tier frozen at enqueue never mixes with a mode configured for another tier: stored host + config sbx/bypass → drained on host under auto", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "tk-sup-cfg-"));
    const cfg = join(cfgDir, "supervisor.yaml");
    writeFileSync(cfg, ""); // no config at submission
    const fx = e2eFixture(BLOCK_OK, true, { env: { TK_SUPERVISOR_CONFIG: cfg } });
    const sub = fx.submit();
    expect(sub.status).toBe(0);
    const queued = JSON.parse(sub.stdout);
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "queued", tier: "host", permission_mode: null });
    // The operator then configures the job for sbx with bypass: that entry is one unit, for the sbx tier only.
    writeFileSync(cfg, `jobs:\n  ${fx.registeredId()}/studio-health:\n    tier: sbx\n    sandbox: s-cfg\n    permission_mode: bypassPermissions\n`);
    const drained = fx.bare("drain");
    expect(drained.status).toBe(0);
    expect(JSON.parse(drained.stdout).runs[0]).toMatchObject({ run_id: queued.run_id, summary: { ok: true, state: "complete" } });
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "complete", tier: "host" });
    const worker = fx.calls().find((c) => c.args[0] === "-p");
    expect(flagValue(worker.args, "--permission-mode")).toBe("auto");
    expect(fx.sbxCalls()).toEqual([]);
  }, 180_000);

  test("supervisor config (TK_SUPERVISOR_CONFIG): acceptEdits for this job; a bad config → exit 2 SupervisorConfigInvalid, nothing queued", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "tk-sup-cfg-"));
    const cfg = join(cfgDir, "supervisor.yaml");
    const fx = e2eFixture(BLOCK_OK, true, { env: { TK_SUPERVISOR_CONFIG: cfg } });
    writeFileSync(cfg, `jobs:\n  ${fx.registeredId()}/studio-health:\n    permission_mode: acceptEdits\n`);
    const res = fx.run();
    expect(res.status).toBe(0);
    const worker = fx.calls().find((c) => c.args[0] === "-p");
    expect(flagValue(worker.args, "--permission-mode")).toBe("acceptEdits");
    expect(fx.queue((q) => q.get(JSON.parse(res.stdout).run_id))).toMatchObject({ tier: "host", permission_mode: null });

    writeFileSync(cfg, "jobs:\n  p/studio-health:\n    tier: gpu\n");
    const before = fx.queue((q) => q.runs().length);
    const bad = fx.run();
    expect(bad.status).toBe(2);
    expect(JSON.parse(bad.stdout).error).toContain("SupervisorConfigInvalid");
    expect(fx.queue((q) => q.runs().length)).toBe(before);
  }, 180_000);

  test("`submit` with a bad TK_SUPERVISOR_CONFIG → exit 2 SupervisorConfigInvalid; zero spawns, zero queue runs", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "tk-sup-cfg-"));
    const cfg = join(cfgDir, "supervisor.yaml");
    writeFileSync(cfg, "jobs:\n  p/studio-health:\n    tier: gpu\n");
    const fx = e2eFixture(BLOCK_OK, true, { env: { TK_SUPERVISOR_CONFIG: cfg } });
    const bad = fx.submit();
    expect(bad.status).toBe(2);
    expect(JSON.parse(bad.stdout).error).toContain("SupervisorConfigInvalid");
    expect([fx.calls(), fx.sbxCalls()]).toEqual([[], []]);
    expect(fx.queue((q) => q.runs().length)).toBe(0);
  }, 120_000);
});

// ---------------------------------------------------------------- AC4: the supervisor killed at three points (Story 21.6)
// Only the supervisor this test spawned is killed — by its pid, from its own child (`process.ppid`):
// a fake `uv` in front of the real one (after `submit` answers; instead of `finish`) or the fake worker
// (mid-invoke). Never by name pattern; every child is bounded by a timeout.

/** How `spawnSync` reports a process killed with SIGKILL: the signal on POSIX; on win32 (TerminateProcess) exit code 1, no signal. */
const KILLED = process.platform === "win32" ? 1 : "SIGKILL";

describe.skipIf(!canRunE2E)("CLI end to end: a killed run resumes or ends partial, never lost (AC4)", () => {
  const BLOCK_TEXT = `Resumed and done.\n{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`;
  /** A fake `uv` on PATH: runs the real uv, and once (a marker file) kills its parent supervisor at `at`. */
  function killingUv(at: "submit" | "finish") {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-e2e-uv-"));
    const realUv = Bun.which("uv");
    if (!realUv) throw new Error("uv not on PATH");
    const marker = join(dir, "killed.marker");
    fakeBin(join(dir, "uv"), `const fs = require("node:fs");
const args = process.argv.slice(2);
const once = args[0] === "run" && String(args[1]).endsWith("jobrun.py") && args[2] === ${JSON.stringify(at)} && !fs.existsSync(${JSON.stringify(marker)});
const kill = () => { fs.writeFileSync(${JSON.stringify(marker)}, "1"); process.kill(Number(process.env.FAKE_PARENT_PID ?? process.ppid), "SIGKILL"); process.exit(1); };
if (once && ${JSON.stringify(at)} === "finish") kill(); // before finish: the verb never runs
const r = require("node:child_process").spawnSync(${JSON.stringify(realUv)}, args, { stdio: once ? ["inherit", "ignore", "inherit"] : "inherit", timeout: 120_000 });
if (once) kill(); // after the verb answered, before the supervisor reads it
process.exit(r.status ?? 1);
`);
    return { env: { PATH: `${dir}${delimiter}${process.env.PATH}` }, marker };
  }
  const events = (fx: ReturnType<typeof e2eFixture>, runId: string) => fx.queue((q) => lifecycle(q, runId));
  const onlyRun = (fx: ReturnType<typeof e2eFixture>) => fx.queue((q) => q.runs())[0];

  test("after `wake` (the verb answered, the supervisor died before recording it) → `recover` ends it partial naming no session", () => {
    const uv = killingUv("submit");
    const fx = e2eFixture(BLOCK_TEXT, true, { env: uv.env });
    const res = fx.run();
    expect(res.signal ?? res.status).toBe(KILLED);
    expect(existsSync(uv.marker)).toBe(true);
    const dead = onlyRun(fx);
    expect(dead).toMatchObject({ state: "running", studio_run_id: null, session_id: null });
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);

    const rec = fx.bare("recover");
    expect(rec.status).toBe(0);
    const reason = "orphaned: supervisor restart; no session recorded";
    const out = JSON.parse(rec.stdout);
    expect(out).toMatchObject({ ok: true, resumed: [], ended: [{ run_id: dead.run_id, reason }] });
    const run = fx.queue((q) => q.get(dead.run_id))!;
    expect(run).toMatchObject({ state: "partial", reason });
    expect(run.studio_run_id).toStartWith("studio-health-");
    // Story 27.5 (DW-25): the orphan close-out follows the orphan end ("no changes": nothing landed).
    expect(events(fx, dead.run_id).findLast((e) => e.kind === "orphaned")).toMatchObject({ kind: "orphaned", detail: { lookup: { ok: true, adopted: run.studio_run_id }, studio: { ok: true } } });
    expect(events(fx, dead.run_id).at(-1)).toMatchObject({ kind: "closed_out", detail: { orphaned: true, no_changes: true } });
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", run.studio_run_id!]).runs[0];
    expect(studio).toMatchObject({ state: "partial", reason });
    expect(fx.queue((q) => q.lock(fx.project))).toBeNull();
  }, 180_000);

  test("after `wake` (the studio run and the wake answer recorded; killed on the invoke's auth preflight, before the worker) → partial naming no session, events recorded", () => {
    const marker = join(tmpdir(), `tk-sup-authkill-${process.pid}-${Date.now()}`);
    const fx = e2eFixture(BLOCK_TEXT, true, { env: { FAKE_CLAUDE_KILL_PARENT_ON_INVOKE_AUTH: marker } });
    const res = fx.run();
    expect(res.signal ?? res.status).toBe(KILLED);
    expect(existsSync(marker)).toBe(true);
    const dead = onlyRun(fx);
    expect(dead).toMatchObject({ state: "running", session_id: null, worker_pid: null });
    expect(dead.studio_run_id).toStartWith("studio-health-");
    expect(JSON.parse(dead.wake!)).toMatchObject({ state: "queued", directive: { kind: "invoke-skill" } });
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);

    const rec = fx.bare("recover");
    expect(rec.status).toBe(0);
    const reason = "orphaned: supervisor restart; no session recorded";
    expect(JSON.parse(rec.stdout)).toMatchObject({ ok: true, resumed: [], ended: [{ run_id: dead.run_id, studio_run_id: dead.studio_run_id, reason }] });
    expect(fx.queue((q) => q.get(dead.run_id))).toMatchObject({ state: "partial", reason, studio_run_id: dead.studio_run_id });
    // `recovering`: the recoverer marks the run its own before it ends the studio run (no other recoverer ends it under that call).
    expect(events(fx, dead.run_id).map((e) => e.kind)).toEqual(["enqueued", "claimed", "base-ref", "worktree", "materialised", "verb-started", "studio-run", "woke", "recovering", "orphaned",
      "closing-out", "closed_out"]); // Story 27.5 (DW-25): the orphan close-out
    expect(events(fx, dead.run_id).findLast((e) => e.kind === "orphaned")).toMatchObject({ to_state: "partial", detail: { studio: { ok: true }, studio_outcome: { run_id: dead.studio_run_id, state: "partial" } } });
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", dead.studio_run_id!]).runs[0];
    expect(studio).toMatchObject({ state: "partial", reason });
    expect(fx.queue((q) => q.lock(fx.project))).toBeNull();
  }, 180_000);

  test("drain's exit status counts the resumed runs it drives: a resumed run ending blocked → exit 1", () => {
    const blocked = `Could not finish.\n{"status":"blocked","intent":"tk-studio-activate","artifacts":[],"reason":"gap named"}`;
    const fx = e2eFixture(blocked, true, { env: { FAKE_CLAUDE_KILL_PARENT_ONCE: join(tmpdir(), `tk-sup-kill-drain-${process.pid}-${Date.now()}`) } });
    const res = fx.run();
    expect(res.signal ?? res.status).toBe(KILLED);
    const dead = onlyRun(fx);
    const drained = fx.bare("drain");
    const out = JSON.parse(drained.stdout);
    expect(out.runs).toEqual([]);
    expect(out.recovered.resumed).toMatchObject([{ run_id: dead.run_id, summary: { ok: false, state: "blocked" } }]);
    expect(out.ok).toBe(false);
    expect(drained.status).toBe(1);
    expect(fx.queue((q) => q.get(dead.run_id))).toMatchObject({ state: "blocked" });
  }, 180_000);

  test("mid-invoke (the worker still running) → `recover` kills the recorded worker, then resumes it with --resume <session-id>; its block is finished", async () => {
    const fx = e2eFixture(BLOCK_TEXT, true, { env: { FAKE_CLAUDE_KILL_PARENT_ONCE: join(tmpdir(), `tk-sup-kill-${process.pid}-${Date.now()}`) } });
    const res = fx.run();
    expect(res.signal ?? res.status).toBe(KILLED);
    const dead = onlyRun(fx);
    expect(dead.state).toBe("running");
    expect(dead.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dead.worker_pid).toBeGreaterThan(0);
    const worker = dead.worker_pid!;
    // POSIX: the detached worker outlived its supervisor. win32: the worker is never detached (21-4 AC1), and
    // the job object it is spawned in ends it with its supervisor, so the restart finds no worker to kill.
    if (process.platform !== "win32") process.kill(worker, 0);

    const rec = fx.bare("recover");
    expect(rec.status).toBe(0);
    const out = JSON.parse(rec.stdout);
    expect(out.ended).toEqual([]);
    expect(out.resumed).toMatchObject([{ run_id: dead.run_id, resume: 1, summary: { ok: true, state: "complete", run_id: dead.run_id } }]);
    // The old worker was killed (pid + start time matched) before the takeover; on win32 it was already gone.
    let gone = false;
    try { process.kill(worker, 0); gone = readFileSync(`/proc/${worker}/stat`, "utf-8").split(") ")[1]?.[0] === "Z"; } catch { gone = true; }
    expect(gone).toBe(true);
    const evs = events(fx, dead.run_id);
    const resumed = evs.find((e) => e.kind === "resumed")!;
    expect(resumed.detail).toMatchObject({ resume: 1, session_id: dead.session_id, worker: { pid: worker, outcome: process.platform === "win32" ? "not running" : "killed" } });
    // The interrupted iteration is accounted after the takeover, then the resumed one.
    expect(evs.filter((e) => e.kind === "accounted").map((e) => (e.detail as any).message_ids))
      .toEqual([["msg-1"], [expect.stringMatching(/^msg-resume-/)]]);
    expect(evs.at(-1)).toMatchObject({ kind: "ended", to_state: "complete" });
    // The resume: --resume with the same session id, never a new one.
    const workers = fx.calls().filter((c) => c.args[0] === "-p");
    expect(workers).toHaveLength(2);
    expect(workers[0].args).toContain(dead.session_id);
    expect(workers[1].args.slice(workers[1].args.indexOf("--resume"), workers[1].args.indexOf("--resume") + 2)).toEqual(["--resume", dead.session_id]);
    const run = fx.queue((q) => q.get(dead.run_id))!;
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", run.studio_run_id!]).runs[0];
    expect(studio.state).toBe("complete");
    expect(fx.queue((q) => q.lock(fx.project))).toBeNull();
  }, 180_000);

  test("before `finish` (the worker printed its block, the supervisor died) → resumed; only the new messages are accounted; the resumed block is finished", () => {
    const uv = killingUv("finish");
    const fx = e2eFixture(BLOCK_TEXT, true, { env: uv.env });
    const res = fx.run();
    expect(res.signal ?? res.status).toBe(KILLED);
    const dead = onlyRun(fx);
    expect(dead).toMatchObject({ state: "running" });
    expect(events(fx, dead.run_id).filter((e) => e.kind === "accounted")).toHaveLength(1); // accounted before the kill

    const drained = fx.bare("drain");
    expect(drained.status).toBe(0);
    const out = JSON.parse(drained.stdout);
    expect(out.recovered.resumed).toMatchObject([{ run_id: dead.run_id, summary: { ok: true, state: "complete" } }]);
    const evs = events(fx, dead.run_id);
    // Nothing new to account on the restart (msg-1 was accounted), then only the resumed message.
    expect(evs.find((e) => e.kind === "resumed")!.detail).toMatchObject({ worker: { outcome: "not running" } });
    expect(evs.filter((e) => e.kind === "accounted").map((e) => (e.detail as any).message_ids)).toEqual([["msg-1"], [], [expect.stringMatching(/^msg-resume-/)]]);
    expect(evs.at(-1)).toMatchObject({ kind: "ended", to_state: "complete" });
    const run = fx.queue((q) => q.get(dead.run_id))!;
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", run.studio_run_id!]).runs[0];
    expect(studio.state).toBe("complete");
    expect(fx.ledger().filter((e) => e.event === "job-run" && e.payload.run_id === run.studio_run_id)).toHaveLength(1);
  }, 180_000);
});

// ---------------------------------------------------------------- Story 22.3: run hygiene and win32 fakes

describe("the fake-bin helper (DW-5: win32-runnable fakes)", () => {
  test("Story 22.3: the operator's hygiene variables are cleared for this suite and its children", () => {
    for (const k of OPERATOR_HYGIENE_VARS) expect(process.env[k]).toBeUndefined();
    const res = spawnSync(process.execPath, ["-e", `console.log(JSON.stringify(${JSON.stringify(OPERATOR_HYGIENE_VARS)}.filter((k) => k in process.env)))`],
      { env: { ...process.env }, encoding: "utf-8" });
    expect(JSON.parse(res.stdout)).toEqual([]);
  });

  test("POSIX: the shebang script itself, executable; win32: an .exe beside the script that runs it, arguments and exit code kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-fakebin-"));
    const fake = fakeBin(join(dir, "fake-a.js"), `console.log(JSON.stringify(process.argv.slice(2))); process.exit(7);`);
    expect(fake).toBe(join(dir, process.platform === "win32" ? "fake-a.exe" : "fake-a.js"));
    expect(readFileSync(join(dir, "fake-a.js"), "utf-8")).toStartWith("#!/usr/bin/env bun\n");
    const res = spawnSync(fake, ["a b", "c"], { encoding: "utf-8" }); // no shell, like the production spawn
    expect(res.error).toBeUndefined();
    expect(JSON.parse(res.stdout)).toEqual(["a b", "c"]);
    expect(res.status).toBe(7);
    // A bare name (a fake `uv` on PATH): `uv.exe` on win32, `uv` elsewhere.
    expect(fakeBin(join(dir, "uv"), "")).toBe(join(dir, process.platform === "win32" ? "uv.exe" : "uv"));
  }, 120_000);

  test("--editor-in-the-loop is a `submit` flag only: on `run` it is an unknown argument (exit 2)", async () => {
    const err = console.error;
    const lines: string[] = [];
    console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try { expect(await main(["run", "j", "--directory", ".", "--editor-in-the-loop"])).toBe(2); }
    finally { console.error = err; }
    expect(lines[0]).toStartWith("unknown argument '--editor-in-the-loop'");
  });
});

describe.skipIf(!canRunE2E)("CLI end to end: editor-in-the-loop snapshot and end hygiene (Story 22.3)", () => {
  /** A fake `robocopy` on PATH: records its argv, creates the target, exits `exit`. */
  function fakeRobocopy(exit: number) {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-e2e-robocopy-"));
    const record = join(dir, "calls.jsonl");
    fakeBin(join(dir, "robocopy"), `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(args) + "\\n");
fs.mkdirSync(args[1], { recursive: true });
process.exit(${exit});
`);
    const calls = (): string[][] => existsSync(record) ? readFileSync(record, "utf-8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    return { env: { PATH: `${dir}${delimiter}${process.env.PATH}` }, calls };
  }
  const BLOCK = `{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`;

  test("submit --editor-in-the-loop with no TK_SUPERVISOR_WORK → exit 2, WorkDirMissing, nothing queued", () => {
    const fx = e2eFixture("unused", true, { env: { TK_SUPERVISOR_WORK: "" } });
    const res = fx.submit("studio-health", fx.project, ["--editor-in-the-loop"]);
    expect(res.status).toBe(2);
    const answer = JSON.parse(res.stdout);
    expect(answer).toMatchObject({ ok: false, run_id: null, state: "not-started" });
    expect(answer.error).toStartWith("WorkDirMissing:");
    expect(fx.queue((q) => q.runs().length)).toBe(0);
  }, 120_000);

  test("a flagged Godot run (project.godot in game/): robocopy <root> <work>/snapshots/<pid>/<run> /E before wake, the path on the run; its end notified-or-recorded once", () => {
    const work = mkdtempSync(join(tmpdir(), "tk-sup-e2e-work-"));
    const robo = fakeRobocopy(1);
    const fx = e2eFixture(BLOCK, true, { env: { ...robo.env, TK_SUPERVISOR_WORK: work, TK_SUPERVISOR_NOTIFY: "" } });
    mkdirSync(join(fx.project, "game"));
    writeFileSync(join(fx.project, "game", "project.godot"), "");
    const submitted = JSON.parse(fx.submit("studio-health", fx.project, ["--editor-in-the-loop"]).stdout);
    expect(fx.queue((q) => q.get(submitted.run_id))).toMatchObject({ state: "queued", editor_in_the_loop: 1 });
    const res = fx.run();
    expect(res.status).toBe(0);
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, run_id: submitted.run_id, state: "complete" });
    const target = join(work, "snapshots", summary.project_id, summary.run_id);
    expect(robo.calls()).toEqual([[resolve(fx.project), target, "/E", "/R:3", "/W:5"]]);
    expect(existsSync(target)).toBe(true);
    const evs = fx.queue((q) => q.events(summary.run_id));
    const kinds = evs.map((e) => e.kind);
    expect(kinds.indexOf("snapshot")).toBeGreaterThan(kinds.indexOf("claimed"));
    expect(kinds.indexOf("snapshot")).toBeLessThan(kinds.indexOf("verb-started"));
    expect(evs.find((e) => e.kind === "snapshot")!.detail).toMatchObject({ path: target });
    // The end hygiene, once: no notifier configured → recorded; the host transcript copy → recorded (no backup set).
    expect(kinds.slice(kinds.indexOf("ended") + 1)).toEqual(["notify-skipped", "transcript-copy-failed"]);
  }, 120_000);

  test("a selected notifier missing its variables (or an unknown one): `run`, `recover` and `drain` refuse to start, naming it, never the token", () => {
    const secret = "424242:tg-e2e-never-printed";
    const cases = [
      [{ TK_SUPERVISOR_NOTIFY: "telegram", TK_SUPERVISOR_TELEGRAM_TOKEN: secret, TK_SUPERVISOR_TELEGRAM_CHAT: "" }, "NotifierConfigMissing", "TK_SUPERVISOR_TELEGRAM_CHAT"],
      [{ TK_SUPERVISOR_NOTIFY: "telegram", TK_SUPERVISOR_TELEGRAM_TOKEN: "", TK_SUPERVISOR_TELEGRAM_CHAT: "-100" }, "NotifierConfigMissing", "TK_SUPERVISOR_TELEGRAM_TOKEN"],
      [{ TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "", TK_SUPERVISOR_TELEGRAM_TOKEN: secret }, "NotifierConfigMissing", "TK_SUPERVISOR_NTFY_URL"],
      [{ TK_SUPERVISOR_NOTIFY: "slack", TK_SUPERVISOR_TELEGRAM_TOKEN: secret }, "NotifierUnknown", "TK_SUPERVISOR_NOTIFY"],
    ] as const;
    for (const [env, name, variable] of cases) {
      const fx = e2eFixture(BLOCK, true, { env });
      // `submit` only queues (no notifier needed); every driving verb refuses before the queue is touched.
      const submitted = JSON.parse(fx.submit().stdout);
      expect(submitted).toMatchObject({ ok: true, state: "queued" });
      for (const res of [fx.run(), fx.bare("recover"), fx.bare("drain")]) {
        expect(res.status).toBe(2);
        const answer = JSON.parse(res.stdout);
        expect(answer.ok).toBe(false);
        expect(answer.error).toStartWith(`${name}:`);
        expect(answer.error).toContain(variable);
        expect(`${res.stdout}${res.stderr}`).not.toContain(secret);
      }
      expect(fx.queue((q) => q.get(submitted.run_id))).toMatchObject({ state: "queued", owner_pid: null });
      expect(fx.queue((q) => q.events(submitted.run_id).map((e) => e.kind))).toEqual(["enqueued"]);
      expect(fx.calls()).toEqual([]);
      fx.expectNothingWoken();
    }
  }, 240_000);

  /** A recording fetch (Story 22.3's notifier, injected in process): answers 200. */
  function recordingFetch() {
    const bodies: string[] = [];
    const fetchFn = async (_url: string, init?: RequestInit) => { bodies.push(String(init?.body)); return new Response("ok"); };
    return { bodies, fetchFn };
  }
  const NTFY = { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/tk-e2e-topic" };

  test("`recover` sweeps the ends it makes: an orphaned run (dead owner, past its verb) → exactly one notification naming run id, state and reason", async () => {
    const db = join(mkdtempSync(join(tmpdir(), "tk-sup-e2e-queue-")), "queue.db");
    const dead = { pid: deadPid(), host: hostname(), nonce: "dead-supervisor" };
    const me = { pid: process.pid, host: hostname(), nonce: "recover-sweep" };
    const q = new Queue(db, { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) });
    try {
      const run = q.enqueue({
        jobId: "studio-health", root: mkdtempSync(join(tmpdir(), "tk-sup-checkout-")), owner: dead,
        definition: { id: "studio-health", trigger: "one-shot", target: { skill: "tk-studio-activate" } },
      }).run;
      expect((await q.claim(run.run_id, dead)).claimed).toBe(true);
      q.markVerbStarted(run.run_id, "wake", [], { target: "skill", definition: { id: "studio-health" } });
      q.setStudioRun(run.run_id, "studio-health-20260929T101010Z");
      const f = recordingFetch();
      // The studio verbs injected: the studio run still `running`, then finished `partial`.
      const verbs = async (_root: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "studio-health-20260929T101010Z", state: "running" }] } : { state: "partial" };
      const report = await recoverQueue({ queue: q, owner: me, hygiene: { env: NTFY, fetch: f.fetchFn } }, verbs);
      expect(report.ended.map((e: { run_id: string }) => e.run_id)).toEqual([run.run_id]);
      const ended = q.get(run.run_id)!;
      expect(ended.state).toBe("partial");
      expect(ended.reason).toStartWith("orphaned: supervisor restart");
      expect(f.bodies).toHaveLength(1);
      expect(f.bodies[0]).toContain(`run ${run.run_id} ended partial`);
      expect(f.bodies[0]).toContain(`reason: ${ended.reason}`);
      expect(q.events(run.run_id).filter((e) => e.kind === "notified")).toHaveLength(1);
      expect(q.get(run.run_id)!.notified).toStartWith("done ");
    } finally { q.close(); }
  }, 120_000);

  test("Story 27.5: `recover` ends a cancelled run's studio run the cancel left open, and its plan passes set review and done on a merged PR", async () => {
    const db = join(mkdtempSync(join(tmpdir(), "tk-sup-e2e-queue-")), "queue.db");
    const me = { pid: process.pid, host: hostname(), nonce: "recover-wiring" };
    const q = new Queue(db, { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false, run_ids: [] }) });
    try {
      // A cancelled run whose studio run no record shows ended (its cancel's ender never ran).
      const sid = "studio-health-20261016T121212Z";
      const cancelled = q.enqueue({
        jobId: "studio-health", root: mkdtempSync(join(tmpdir(), "tk-sup-checkout-")), owner: me,
        definition: { id: "studio-health", trigger: "one-shot", target: { skill: "tk-studio-activate" } },
      }).run;
      expect((await q.claim(cancelled.run_id, me)).claimed).toBe(true);
      q.setStudioRun(cancelled.run_id, sid);
      q.end(cancelled.run_id, "cancelled", "cancelled: operator request");
      // A terminal worktree run with an open PR, its run branch marking story 27.5 done, the plan's ST-097 for it.
      const repo = gitRepo();
      const reviewed = q.enqueue({ jobId: "j", root: repo.checkout, projectId: "proj", definition: { id: "j", target: { skill: "tk-studio-launch" } }, owner: me, base_ref: "main" }).run;
      expect((await q.claim(reviewed.run_id, me)).claimed).toBe(true);
      q.recordWorktree(reviewed.run_id, join(mkdtempSync(join(tmpdir(), "tk-sup-wt-")), "gone"), { branch: runBranch(reviewed.run_id), base_ref: "main" });
      testGit(repo.checkout, "checkout", "-q", "-b", runBranch(reviewed.run_id));
      const specRel = "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md";
      mkdirSync(dirname(join(repo.checkout, specRel)), { recursive: true });
      writeFileSync(join(repo.checkout, specRel), "---\nstatus: 'done'\n---\n");
      testGit(repo.checkout, "add", "-A");
      testGit(repo.checkout, "commit", "-q", "-m", "the run's work");
      testGit(repo.checkout, "checkout", "-q", "main");
      mkdirSync(join(repo.checkout, "_bmad-output", "planning-artifacts", "plan"), { recursive: true });
      writeFileSync(join(repo.checkout, "_bmad-output", "planning-artifacts", "plan", "ST-097.md"), "---\nid: ST-097\nstatus: draft\nsource: \"epics.md#story-27.5\"\n---\n");
      const PR = "https://github.com/acme/widget/pull/42";
      q.end(reviewed.run_id, "complete", null, { detail: { pr: PR } });
      const gh = fakeGh();
      gh.answer({ view: "MERGED" });
      const plansync = fakePlansync();
      const verbs = async (_root: string, a: string[]) => a[0] === "status" ? { ok: true, runs: [{ run_id: sid, state: "running" }] } : { ok: true, state: "partial" };
      const f = recordingFetch();
      await recoverQueue({
        queue: q, owner: me, hygiene: { env: NTFY, fetch: f.fetchFn },
        plan: { env: { ...process.env, TK_STUDIO_ROOT: plansync.root, GH_BIN: gh.bin }, registry: async () => undefined, self: me },
      }, verbs);
      expect(q.events(cancelled.run_id).filter((e) => e.kind === "studio-run-ended").map((e) => e.detail)).toEqual([
        expect.objectContaining({ studio_run_id: sid, late: true, by: "recover" }),
      ]);
      expect(q.events(reviewed.run_id).filter((e) => e.kind === "plan-status").map((e) => [e.detail!.phase, e.detail!.id, e.detail!.ok]))
        .toEqual([["review", "ST-097", true], ["done", "ST-097", true]]);
      expect(plansync.calls().map((a) => a[a.indexOf("--status") + 1])).toEqual(["review", "done"]);
    } finally { q.close(); }
  }, 120_000);

  test("`drain` sweeps the ends it makes: a queued run whose job now fails `resolve` ends `blocked` → exactly one notification naming run id, state and reason", async () => {
    const fx = e2eFixture("unused");
    const def = JSON.parse(readFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), "utf-8"));
    def.id = "soon-bad";
    const file = join(fx.project, ".tk-studio", "jobs", "soon-bad.json");
    writeFileSync(file, JSON.stringify(def));
    const queued = JSON.parse(fx.submit("soon-bad").stdout);
    expect(queued).toMatchObject({ ok: true, state: "queued" });
    delete def.guards; // the definition no longer validates: drain itself ends the run (runJob refused before its claim)
    writeFileSync(file, JSON.stringify(def));
    const prev = { home: process.env.TK_STUDIO_HOME, bin: process.env.CLAUDE_BIN, cfg: process.env.CLAUDE_CONFIG_DIR };
    process.env.TK_STUDIO_HOME = fx.store;
    process.env.CLAUDE_BIN = fx.fake;
    process.env.CLAUDE_CONFIG_DIR = join(fx.store, "claude-config");
    const q = new Queue(fx.queueDb);
    const f = recordingFetch();
    try {
      const report = await drainQueue({ queue: q, hygiene: { env: NTFY, fetch: f.fetchFn } });
      expect(report.runs).toMatchObject([{ run_id: queued.run_id, state: "blocked" }]);
      const reason = "resolve: missing required field 'guards'";
      expect(q.get(queued.run_id)).toMatchObject({ state: "blocked", reason });
      expect(f.bodies).toHaveLength(1);
      expect(f.bodies[0]).toContain(`run ${queued.run_id} ended blocked`);
      expect(f.bodies[0]).toContain(`reason: ${reason}`);
      expect(q.events(queued.run_id).filter((e) => e.kind === "notified")).toHaveLength(1);
      expect(q.get(queued.run_id)!.notified).toStartWith("done ");
    } finally {
      for (const [k, v] of [["TK_STUDIO_HOME", prev.home], ["CLAUDE_BIN", prev.bin], ["CLAUDE_CONFIG_DIR", prev.cfg]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      q.close();
    }
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
  }, 180_000);

  test("Story 33.2 (AC1): a drained run behind a checkout lock held by a live holder stays `queued` with exactly one `claim-refused` naming the holder across passes and one notifier line; once the lock frees the next pass claims it (`claim-refusal-cleared`)", async () => {
    const fx = e2eFixture(`{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`);
    // A live holder that is not this process (the drain's own recovery would read this pid under another nonce as a
    // dead supervisor): the test runner's parent, alive for the test's life.
    const me = { pid: process.ppid, host: hostname(), nonce: "lock-holder-33-2" };
    const prev = { home: process.env.TK_STUDIO_HOME, bin: process.env.CLAUDE_BIN, cfg: process.env.CLAUDE_CONFIG_DIR };
    process.env.TK_STUDIO_HOME = fx.store;
    process.env.CLAUDE_BIN = fx.fake;
    process.env.CLAUDE_CONFIG_DIR = join(fx.store, "claude-config");
    const q = new Queue(fx.queueDb);
    const f = recordingFetch();
    try {
      const holder = q.enqueue({ jobId: "other-job", root: fx.project, definition: { id: "other-job" }, owner: me }).run;
      expect((await q.claim(holder.run_id, me)).claimed).toBe(true);
      const queued = JSON.parse(fx.submit().stdout);
      const refused = () => q.events(queued.run_id).filter((e) => e.kind === "claim-refused");
      for (let pass = 0; pass < 2; pass++) {
        const report = await drainQueue({ queue: q, hygiene: { env: NTFY, fetch: f.fetchFn } });
        expect(report.runs).toMatchObject([{ run_id: queued.run_id,
          summary: { ok: false, state: "queued", waited: "lock", claim_refused: { reason: expect.stringContaining(holder.run_id) } } }]);
        expect(Object.keys((report.runs[0] as { summary: RunSummary }).summary.claim_refused!).sort()).toEqual(["reason", "resolves"]);
      }
      expect(q.get(queued.run_id)!.state).toBe("queued");
      expect(refused()).toHaveLength(1);
      expect(refused()[0]!.detail).toMatchObject({ key: `lock:${holder.run_id}`, reason: expect.stringContaining(`checkout lock held by run ${holder.run_id}`), notify: { ok: true, via: "ntfy" } });
      expect(f.bodies).toHaveLength(1);
      expect(f.bodies[0]).toContain(`run ${queued.run_id} stays queued, claim refused:`);
      expect(f.bodies[0]).toContain(holder.run_id);
      expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
      // The lock frees: the next pass claims the run and records the clearing once.
      q.end(holder.run_id, "complete");
      const drained = fx.bare("drain");
      expect(drained.status).toBe(0);
      expect(q.get(queued.run_id)!.state).toBe("complete");
      const ks = q.events(queued.run_id).map((e) => e.kind);
      expect(ks.filter((k) => k === "claim-refused")).toHaveLength(1);
      expect(ks.filter((k) => k === "claim-refusal-cleared")).toHaveLength(1);
      expect(ks.indexOf("claim-refusal-cleared")).toBeGreaterThan(ks.indexOf("claimed"));
      expect(f.bodies).toHaveLength(1);
    } finally {
      for (const [k, v] of [["TK_STUDIO_HOME", prev.home], ["CLAUDE_BIN", prev.bin], ["CLAUDE_CONFIG_DIR", prev.cfg]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      q.close();
    }
  }, 240_000);

  test("a snapshot that fails (robocopy exit 8) ends the run `blocked` before wake: no studio run, no worker", () => {
    const work = mkdtempSync(join(tmpdir(), "tk-sup-e2e-work-"));
    const robo = fakeRobocopy(8);
    const fx = e2eFixture(BLOCK, true, { env: { ...robo.env, TK_SUPERVISOR_WORK: work } });
    writeFileSync(join(fx.project, "project.godot"), "");
    const submitted = JSON.parse(fx.submit("studio-health", fx.project, ["--editor-in-the-loop"]).stdout);
    const res = fx.run();
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, run_id: submitted.run_id, error: "snapshot failed: robocopy exited 8" });
    expect(fx.queue((q) => q.get(submitted.run_id))).toMatchObject({ state: "blocked", reason: "snapshot failed: robocopy exited 8", studio_run_id: null });
    expect(fx.queue((q) => q.events(submitted.run_id).map((e) => e.kind))).not.toContain("verb-started");
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    fx.expectNothingWoken();
  }, 120_000);
});

describe.skipIf(!canRunE2E)("CLI end to end: every run gets its own worktree (Story 27.1)", () => {
  const BLOCK = `{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`;

  test("AC1/AC2: the run is cut a worktree from the default branch, materialised (the drift check first, `tk install` at the pin only on drift, `tk activate` clean) and worked there; the checkout never switched", () => {
    const fx = e2eFixture(BLOCK);
    const git = (...a: string[]) => spawnSync("git", a, { cwd: fx.project, encoding: "utf-8" }).stdout.trim();
    const before = [git("rev-parse", "--abbrev-ref", "HEAD"), git("rev-parse", "HEAD")];
    const res = fx.run();
    expect(res.status).toBe(0);
    const summary = JSON.parse(res.stdout);
    const wt = fx.worktreeOf(summary.run_id);
    expect(fx.queue((q) => q.get(summary.run_id))).toMatchObject({ state: "complete", base_ref: "main", base_ref_source: "default", worktree: wt });
    // The studio's own motions, through uv, inside the worktree.
    // Hole 42: the fresh worktree is drift-clean (the fake studio root answers clean), so no install runs.
    expect(fx.studio.calls()).toEqual([
      { script: "drift_check", argv: ["--directory", wt] },
      { script: "drift_check", argv: ["--directory", wt] },
      ...fx.studio.calls().slice(2), // the worker's own startup drift check (invokeSkill), on the worktree too
    ]);
    expect(fx.studio.calls().slice(2).every((c) => c.argv[1] === wt)).toBe(true);
    // The worker ran with the worktree as its directory; wake/finish kept the registered root.
    const worker = fx.calls().find((c) => c.args[0] === "-p");
    expect(JSON.parse(worker.args[1].split("\n")[0].replace(/^\S+ /, ""))).toMatchObject({ directory: wt });
    expect(fx.gh.calls().map((c) => c.argv)).toEqual([["api", "repos/{owner}/{repo}/branches/main"]]);
    expect([git("rev-parse", "--abbrev-ref", "HEAD"), git("rev-parse", "HEAD")]).toEqual(before);
  }, 120_000);

  test("AC1: an unprotected default branch → the run ends `blocked` naming it before wake; no worktree, no worker", () => {
    const fx = e2eFixture(BLOCK);
    fx.gh.answer({ protected: [] });
    const res = fx.run();
    expect(res.status).toBe(2);
    const answer = JSON.parse(res.stdout);
    expect(answer.error).toBe("worktree protection: base_ref 'main' is the repository's default branch and is not protected on GitHub — refused");
    expect(fx.queue((q) => q.get(answer.run_id))).toMatchObject({ state: "blocked", worktree: null, studio_run_id: null });
    expect(existsSync(fx.worktreeOf(answer.run_id))).toBe(false);
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
    fx.expectNothingWoken();
  }, 120_000);

  test("AC2: activate drift inside the worktree → `blocked` naming the step; no TK_SUPERVISOR_WORK → `blocked` WorkDirMissing", () => {
    const fx = e2eFixture(BLOCK);
    fx.studio.answer({ drift: "drift" });
    const res = fx.run();
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).error).toBe("worktree activate drift: result 'drift'");
    fx.expectNothingWoken();
    const nowork = e2eFixture(BLOCK, true, { env: { TK_SUPERVISOR_WORK: "" } });
    const out = JSON.parse(nowork.run().stdout);
    expect(out.error).toStartWith("worktree work folder: WorkDirMissing: TK_SUPERVISOR_WORK is not set");
    expect(nowork.queue((q) => q.get(out.run_id))).toMatchObject({ state: "blocked" });
  }, 120_000);
});
