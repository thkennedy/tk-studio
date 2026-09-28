import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  finishRun, guardsFor, launchedEngine, main, recoverAfterTimeout, runJob, startRun, type TimeoutContext, type Validated,
} from "../src/cli";
import { claudeBin, studioRoot, StudioRootMissing } from "../src/env";
import { Queue } from "../src/queue";
import {
  buildWorkerCommand, buildWorkerEnv, HostBypassRefused, invokeSkill, MISSING_STATUS_BLOCK, type Spawner,
} from "../src/server";

const REPO = resolve(import.meta.dir, "..");
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

  test("finish gets the studio run id and --total-cost-usd; a missing block → blocked naming MISSING_STATUS_BLOCK", async () => {
    const ok = await drive(started(woke()), { status_block: BLOCK, total_cost_usd: 0.42 });
    expect(ok.finish.slice(0, 7)).toEqual(["finish", "--directory", "proj", "--run-id", "s-20260928T101010Z", "--state", "complete"]);
    expect(ok.finish.slice(ok.finish.indexOf("--total-cost-usd"), ok.finish.indexOf("--total-cost-usd") + 2)).toEqual(["--total-cost-usd", "0.42"]);
    expect(ok.summary).toMatchObject({ ok: true, total_cost_usd: 0.42 });
    const missing = await drive(started(woke()), { conformance_failure: MISSING_STATUS_BLOCK, total_cost_usd: 0.1 });
    expect(missing.finish.slice(3, 9)).toEqual(["--run-id", "s-20260928T101010Z", "--state", "blocked", "--reason", MISSING_STATUS_BLOCK]);
    expect(missing.finish).toContain("--total-cost-usd");
  });
});

// ---------------------------------------------------------------- end to end
// Real studio verbs (uv + TK_STUDIO_ROOT) against a throwaway store and
// project; only the worker is faked (CLAUDE_BIN printing a json result).

const canRunE2E = !!process.env.TK_STUDIO_ROOT && process.platform !== "win32"
  && spawnSync("uv", ["--version"]).status === 0;

function e2eFixture(workerResult: string, loggedIn = true, opts: { selfFinish?: boolean; env?: Record<string, string> } = {}) {
  const store = mkdtempSync(join(tmpdir(), "tk-sup-e2e-store-"));
  const project = mkdtempSync(join(tmpdir(), "tk-sup-e2e-proj-"));
  mkdirSync(join(project, ".tk-studio", "jobs"), { recursive: true });
  copyFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), join(project, ".tk-studio", "jobs", "studio-health.json"));
  const plugin = join(process.env.TK_STUDIO_ROOT!, "plugins", "tk-studio");
  const reg = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "register", "--directory", project, "--writer", "onboard"],
    { env: { ...process.env, TK_STUDIO_HOME: store }, encoding: "utf-8" });
  if (reg.status !== 0) throw new Error(`fixture register failed: ${reg.stdout}${reg.stderr}`);
  const record = join(store, "worker-calls.jsonl");
  const fake = join(store, "fake-claude.js");
  const workerMarker = join(store, "worker-ran.marker");
  writeFileSync(fake, `#!/usr/bin/env bun
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, apiKey: process.env.ANTHROPIC_API_KEY ?? null }) + "\\n");
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: ${loggedIn}, authMethod: "claude.ai" })); process.exit(0); }
fs.writeFileSync(${JSON.stringify(workerMarker)}, "ran\\n");
if (${opts.selfFinish === true}) {
  // Race the supervisor: end this run first, so its own finish is refused.
  const payload = JSON.parse(args[1].split("\\n")[0].replace(/^\\S+ /, ""));
  require("node:child_process").spawnSync("uv", ["run", ${JSON.stringify(join(plugin, "lib", "jobrun.py"))}, "finish", "--directory", payload.directory,
    "--run-id", payload.run_id, "--state", "cancelled", "--reason", "raced by the worker"], { encoding: "utf-8" });
}
// A session transcript under CLAUDE_CONFIG_DIR (the fixture's own dir): the supervisor accounts its turns/tokens.
const sessionId = "sess-" + process.pid + "-" + Date.now();
const tdir = require("node:path").join(process.env.CLAUDE_CONFIG_DIR, "projects", "fake-slug");
fs.mkdirSync(tdir, { recursive: true });
const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
fs.writeFileSync(require("node:path").join(tdir, sessionId + ".jsonl"), JSON.stringify({ type: "assistant", message: { id: "msg-1", usage } }) + "\\n");
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: ${JSON.stringify(workerResult)}, total_cost_usd: 0.0123, session_id: sessionId, num_turns: 1, usage }));
`);
  chmodSync(fake, 0o755);
  // A fake `sbx exec <sb> [timeout -k <s> <guard>] env [-u K]… [-C dir] claude …`: records its argv, then runs
  // the fake claude with the env and cwd the wrapper names (argv only, no shell).
  const sbxRecord = join(store, "sbx-calls.jsonl");
  const fakeSbx = join(store, "fake-sbx.js");
  writeFileSync(fakeSbx, `#!/usr/bin/env bun
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(sbxRecord)}, JSON.stringify({ args, apiKey: process.env.ANTHROPIC_API_KEY ?? null }) + "\\n");
const at = args[2] === "timeout" && args[3] === "-k" ? 6 : 2;
if (args[0] !== "exec" || args[at] !== "env") process.exit(97);
const env = { ...process.env };
let i = at + 1, cwd;
while (args[i] === "-u" || args[i] === "-C") { if (args[i] === "-u") delete env[args[i + 1]]; else cwd = args[i + 1]; i += 2; }
if (args[i] !== "claude") process.exit(98);
const r = require("node:child_process").spawnSync(${JSON.stringify(fake)}, args.slice(i + 1), { env, cwd, stdio: "inherit" });
process.exit(r.status ?? 1);
`);
  chmodSync(fakeSbx, 0o755);
  const extraEnv = { SBX_BIN: fakeSbx, CLAUDE_CONFIG_DIR: join(store, "claude-config"), ...(opts.env ?? {}) };
  // The queue lives outside every repo and outside the store.
  const queueDb = join(mkdtempSync(join(tmpdir(), "tk-sup-e2e-queue-")), "queue.db");
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
  return { store, project, run, submit, bare, queue, queueDb, calls, sbxCalls, ledger, workerMarker, jobVerb, registeredId, expectNothingWoken };
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
  }, 120_000);

  test("missing block → finished blocked with the named conformance failure", () => {
    const fx = e2eFixture("Looked around; nothing to report.");
    const res = fx.run();
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toMatchObject({ state: "blocked", reason: MISSING_STATUS_BLOCK });
    expect(fx.ledger().some((e) => e.event === "job-run" && e.payload.state === "blocked")).toBe(true);
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

  test("finish refused after the run exists → exit 1 keeping the run id, reason names the finish failure", () => {
    const fx = e2eFixture(`{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`, true, { selfFinish: true });
    const res = fx.run();
    expect(res.status).toBe(1);
    const summary = JSON.parse(res.stdout);
    expect(summary.run_id).toStartWith("q-studio-health-");
    expect(summary.studio_run_id).toStartWith("studio-health-");
    expect(summary.reason).toStartWith("finish failed:");
    const run = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", summary.studio_run_id]).runs[0];
    expect(run.state).toBe("cancelled");
    expect(summary.state).toBe(run.state); // the run's real state, not the stale wake/submit answer
  }, 120_000);

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
    expect(fx.queue((q) => [q.runs().length, q.events().length,
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
    const [run, events, lock] = fx.queue((q) => [q.get(summary.run_id), q.events(summary.run_id), q.lock(fx.project)] as const);
    expect(run).toMatchObject({ state: "complete", studio_run_id: summary.studio_run_id, owner_pid: null });
    expect(events.map((e) => [e.kind, e.to_state])).toEqual([
      ["enqueued", "queued"], ["claimed", "running"], ["verb-started", "running"], ["studio-run", "running"], ["ended", "complete"],
    ]);
    // The pre-verb snapshot is stored with verb_started: no studio-health run existed before.
    expect(events[2].detail).toEqual({ verb: "submit", snapshot: [], target: "skill" });
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
    mkdirSync(join(fx.project, ".git"));
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
      env: { ...process.env, TK_STUDIO_HOME: fx.store, TK_SUPERVISOR_DB: fx.queueDb, CLAUDE_BIN: join(fx.store, "fake-claude.js") },
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
    expect(fx.queue((q) => q.get(queued.run_id))).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart", owner_pid: null });
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", minted.run_id]).runs[0];
    expect(studio).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart" });
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
    expect(JSON.parse(rec.stdout)).toEqual({ ok: true, ended: [], requeued: [queued.run_id] });
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
    expect(fx.queue((q) => q.events(queued.run_id).map((e) => e.kind))).toEqual([
      "enqueued", "requeued", "claimed", "verb-started", "studio-run", "ended",
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
    const [run, last] = fx.queue((q) => [q.get(queued.run_id), q.events(queued.run_id).at(-1)] as const);
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
    const res = spawnSync("bun", [join(REPO, "src", "cli.ts"), "drain"], {
      env: { ...process.env, PATH: dirname(process.execPath), TK_STUDIO_HOME: fx.store, TK_SUPERVISOR_DB: fx.queueDb,
        CLAUDE_BIN: join(fx.store, "fake-claude.js") }, encoding: "utf-8", timeout: 120_000,
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
    expect(fx.queue((q) => q.events(queued.run_id).map((e) => [e.kind, e.to_state]))).toEqual([
      ["enqueued", "queued"], ["claimed", "running"], ["ended", "blocked"],
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
    expect(fx.queue((q) => q.events(queued.run_id).at(-1))).toMatchObject({ kind: "ended", to_state: "blocked" });
  }, 180_000);

  test("`drain`: a transient stop before validation (no Max login) leaves the run queued", () => {
    const fx = e2eFixture("unused", false);
    const queued = JSON.parse(fx.submit().stdout);
    const res = fx.bare("drain");
    expect(res.status).toBe(1);
    // The entry reports the run's actual queue state (`queued`), and the summary names the drained run.
    const entry = JSON.parse(res.stdout).runs[0];
    expect(entry).toMatchObject({ run_id: queued.run_id, state: "queued", summary: { ok: false, state: "blocked", run_id: queued.run_id } });
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
    expect(orphan).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart", studio_run_id: minted.run_id });
    expect(fx.queue((q) => q.events(queued.run_id).at(-1))).toMatchObject({ kind: "orphaned", detail: { lookup: { ok: true, adopted: minted.run_id }, studio: { ok: true } } });
    const studio = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", minted.run_id]).runs[0];
    expect(studio).toMatchObject({ state: "partial", reason: "orphaned: supervisor restart" });
  }, 180_000);

  test("engine path: a tk-studio-launch block naming `.bmad-loop/runs/<id>` hands the lock to the engine; a claim then waits or frees by the probe", async () => {
    const fx = e2eFixture(`Launched.\n{"status":"complete","intent":"tk-studio-launch","artifacts":[".bmad-loop/runs/20260928-101500-ab12"]}`);
    const def = JSON.parse(readFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), "utf-8"));
    Object.assign(def, { id: "launch-probe", target: { skill: "tk-studio-launch", payload: { verb: "status" } } });
    writeFileSync(join(fx.project, ".tk-studio", "jobs", "launch-probe.json"), JSON.stringify(def));

    const res = fx.run("launch-probe");
    const summary = JSON.parse(res.stdout);
    expect(summary).toMatchObject({ ok: true, state: "complete", target: "skill" });
    expect(res.status).toBe(0);
    // The mirror handed the checkout lock to the engine.
    const [run, lock, last] = fx.queue((q) => [q.get(summary.run_id), q.lock(fx.project), q.events(summary.run_id).at(-1)] as const);
    expect(run).toMatchObject({ state: "complete", engine_run_id: "20260928-101500-ab12" });
    expect(lock).toMatchObject({ kind: "engine", engine_run_id: "20260928-101500-ab12", run_id: summary.run_id });
    expect(last!.detail).toMatchObject({ lock: { handed_to_engine: "20260928-101500-ab12" } });

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
    process.env.CLAUDE_BIN = join(fx.store, "fake-claude.js");
    process.env.CLAUDE_CONFIG_DIR = join(fx.store, "claude-config"); // the fake worker's transcript (max_turns → account)
    try {
      const summary = await runJob("launch-probe", fx.project, undefined, { queue: q });
      expect(summary).toMatchObject({ ok: false, state: "blocked", target: "skill" });
      expect(probed).toEqual([[fx.project, null]]);
      expect(q.get(summary.run_id!)).toMatchObject({ state: "blocked", engine_run_id: "E9" });
      expect(q.lock(fx.project)).toMatchObject({ kind: "engine", engine_run_id: "E9", run_id: summary.run_id });
      expect(q.events(summary.run_id!).at(-1)!.detail).toMatchObject({ lock: { handed_to_engine: "E9" }, engine: { live: ["E9"] } });
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
    const sbx = fx.sbxCalls();
    expect(sbx.length).toBeGreaterThanOrEqual(2);
    expect(sbx.every((c) => c.args[0] === "exec" && c.args[1] === "claude-p")).toBe(true);
    const probe = sbx.find((c) => c.args.includes("auth"))!;
    expect(probe.args).toEqual(["exec", "claude-p", "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"]);
    const worker = sbx.find((c) => c.args.includes("-p"))!;
    expect(worker.args.slice(0, 13)).toEqual(["exec", "claude-p", "timeout", "-k", "10", "600", "env", "-u", "ANTHROPIC_API_KEY", "-C", fx.project, "claude", "-p"]);
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

  test("sbx VM cwd comes from the registry entry root, not the `--directory` spelling (a symlink samePath accepts)", () => {
    const fx = e2eFixture(BLOCK_OK);
    const spelled = join(mkdtempSync(join(tmpdir(), "tk-sup-e2e-spelled-")), basename(fx.project)); // same basename: the same project id
    symlinkSync(fx.project, spelled, "dir");
    const res = fx.run("studio-health", spelled, ["--tier", "sbx", "--sandbox", "claude-p", "--permission-mode", "bypassPermissions"]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ ok: true, state: "complete" });
    const worker = fx.sbxCalls().find((c) => c.args.includes("-p"))!;
    expect(flagValue(worker.args, "-C")).toBe(fx.project);
    expect(flagValue(worker.args, "-C")).not.toBe(spelled);
    expect(JSON.parse(worker.args[13].split("\n")[0].replace(/^\S+ /, ""))).toMatchObject({ directory: fx.project });
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

  test("stored drive: an invalid stored tier ends the drained run `blocked` naming it", () => {
    const fx = e2eFixture(BLOCK_OK);
    const queued = JSON.parse(fx.submit().stdout);
    fx.queue((q) => q.db.run("UPDATE runs SET tier = 'gpu' WHERE run_id = ?", [queued.run_id]));
    const res = fx.bare("drain");
    expect(res.status).toBe(1);
    const run = fx.queue((q) => q.get(queued.run_id))!;
    expect(run.state).toBe("blocked");
    expect(run.reason).toContain("TierRefused");
    expect(fx.calls().some((c) => c.args[0] === "-p")).toBe(false);
  }, 180_000);

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
