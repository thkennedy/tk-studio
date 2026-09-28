import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { main, recoverAfterTimeout, type TimeoutContext } from "../src/cli";
import { claudeBin, studioRoot, StudioRootMissing } from "../src/env";
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
  ])("a flag missing its value → usage error, exit 2: %j", async (argv) => {
    const err = console.error;
    const seen: string[] = [];
    console.error = (...a: unknown[]) => { seen.push(a.join(" ")); };
    try { expect(await main(argv)).toBe(2); } finally { console.error = err; }
    expect(seen.join("\n")).toContain("needs a value");
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
      if (out.ok !== false) states.set(runId, args[0] === "finish" ? "blocked" : "partial");
      return out;
    };
    return { calls, runner };
  }

  test("skill run: adopts only the run absent from the snapshot and finishes it blocked naming the timeout", async () => {
    const { calls, runner } = fakeVerbs(
      [{ run_id: "j-20260101T000000Z", state: "queued" }, { run_id: "j-20260928T101010Z", state: "queued" }],
      (args) => ({ run_id: args[args.indexOf("--run-id") + 1], state: "blocked" }));
    const out = await recoverAfterTimeout("j", "uv timed out after 720s", ctx("skill", ["j-20260101T000000Z"]), runner);
    expect(out).toMatchObject({ ok: false, run_id: "j-20260928T101010Z", target: "skill", state: "blocked" });
    expect(out.reason).toContain("timed out");
    const finish = calls.find((c) => c[0] === "finish")!;
    expect(finish.slice(finish.indexOf("--run-id"), finish.indexOf("--run-id") + 4)).toEqual(["--run-id", "j-20260928T101010Z", "--state", "blocked"]);
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

// ---------------------------------------------------------------- end to end
// Real studio verbs (uv + TK_STUDIO_ROOT) against a throwaway store and
// project; only the worker is faked (CLAUDE_BIN printing a json result).

const canRunE2E = !!process.env.TK_STUDIO_ROOT && process.platform !== "win32"
  && spawnSync("uv", ["--version"]).status === 0;

function e2eFixture(workerResult: string, loggedIn = true, opts: { selfFinish?: boolean } = {}) {
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
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: ${JSON.stringify(workerResult)}, total_cost_usd: 0.0123 }));
`);
  chmodSync(fake, 0o755);
  const run = (jobId = "studio-health", dir = project, extra: string[] = []) => spawnSync("bun", [join(REPO, "src", "cli.ts"), "run", jobId, "--directory", dir, ...extra], {
    env: { ...process.env, TK_STUDIO_HOME: store, CLAUDE_BIN: fake, ANTHROPIC_API_KEY: "sk-test-parent" }, encoding: "utf-8", timeout: 120_000,
  });
  const calls = () => existsSync(record) ? readFileSync(record, "utf-8").trim().split("\n").map((l) => JSON.parse(l)) : [];
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
  return { store, project, run, calls, ledger, workerMarker, jobVerb, registeredId, expectNothingWoken };
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

    const events = fx.ledger().filter((e) => e.event === "job-run" && e.payload.run_id === summary.run_id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ state: "complete", total_cost_usd: 0.0123 });
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
    expect(summary.run_id).toStartWith("studio-health-");
    expect(summary.reason).toStartWith("finish failed:");
    const run = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "studio-health", "--run-id", summary.run_id]).runs[0];
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
    expect(summary.run_id).toStartWith("maintenance-conformance-");
    expect(["complete", "partial", "blocked", "cancelled"]).toContain(summary.state);
    expect(res.status).toBe(summary.state === "complete" ? 0 : 1);

    // No worker session: the fake CLAUDE_BIN only ever answered the login preflight.
    expect(existsSync(fx.workerMarker)).toBe(false);
    expect(fx.calls().map((c) => c.args[0])).toEqual(["auth"]);

    // No finish beyond wake's own terminal transition: exactly one job-run event, from wake.
    const events = fx.ledger().filter((e) => e.event === "job-run" && e.payload.run_id === summary.run_id);
    expect(events).toHaveLength(1);
    expect(events[0].payload.state).toBe(summary.state);
    expect(summary.finish).toBeUndefined();

    // The outcome is status's record of the run (wake answers no status_block; status does).
    const status = fx.jobVerb(["status", "--directory", fx.project, "--job-id", "maintenance-conformance", "--run-id", summary.run_id]);
    const run = status.runs[0];
    expect(run.run_id).toBe(summary.run_id);
    expect(summary.state).toBe(run.state);
    expect(summary.status_block).toBeDefined();
    expect(summary.status_block).toEqual(run.status_block);
    expect(summary.reason).toBe(run.reason);
  }, 120_000);
});
