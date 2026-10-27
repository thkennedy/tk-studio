// Story 34.5: one engine MCP per run, started by the pin — the start, the stop (a kept pin too), no start without the
// flag, every refusal, the restart recovery, the snapshot still taken and the forwarder's 200/401. Fakes only: a
// `fakeBin` server on an ephemeral loopback port, a fake `git show`, a fake `sbx`; never a real engine.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import { queueRecorder, runJob, StartError, submitJob } from "../src/cli";
import {
  ENGINE_MCP_START, ENGINE_MCP_STOP, engineMcpEnv, engineMcpLive, forwarder, letGoEngineMcp, parseEngineMcp, recoverEngineMcps, startEngineMcp,
  stopEngineMcp, type EngineMcpDeps,
} from "../src/enginemcp";
import { snapshotOnce } from "../src/hygiene";
import { killRecordedWorker, processStartTime, Queue, type Owner, type QueueRun } from "../src/queue";
import { releasePin, type SandboxDeps } from "../src/sandbox";
import type { RunResult } from "../src/server";
import { fakeBin, fakeGh, fakeSbx, fakeStudioRoot, gitInit, RUNTIME_GITIGNORE } from "./fakes";
import { tempDir, track } from "./tmp";

// Another live driver (never this process: `ownerLive` reads a row with this pid and host as a dead predecessor).
const me: Owner = { pid: 4242, host: `${hostname()}-driver`, nonce: "enginemcp-test" };
const SB = "claude-p";
const JOB = { id: "run-epic", trigger: "one-shot", target: { skill: "tk-studio-launch" }, guards: { max_wall_clock_seconds: 600 } };
const NAME = "godot-mcp";

/** Does `pid` still run (signal 0)? */
const pidRunning = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Wait (bounded) for `pid` to go. */
async function gone(pid: number, ms = 5000): Promise<boolean> {
  for (const until = Date.now() + ms; Date.now() < until; await Bun.sleep(50)) if (!pidRunning(pid)) return true;
  return !pidRunning(pid);
}
/** No child's command line carries the bearer (Linux: /proc/<pid>/cmdline; elsewhere the argv is ours, checked by
 * construction: `--bind/--port/--upstream` only). */
function expectNoBearerInArgv(pids: number[], bearer: string) {
  if (process.platform !== "linux") return;
  for (const pid of pids) expect(readFileSync(`/proc/${pid}/cmdline`, "utf-8")).not.toContain(bearer);
}

/** A free loopback port (bound once, released). */
function freePort(): number {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const p = s.port!;
  s.stop(true);
  return p;
}

let serverBin: string, exitBin: string, idleBin: string, godot: string;
let sbx: ReturnType<typeof fakeSbx>;
beforeAll(() => {
  const dir = tempDir("tk-sup-enginemcp-bin-");
  // The fake engine MCP: listens on 127.0.0.1:<--port>, answers what it was asked (method, path, whether a bearer
  // reached it, the body) and its cwd.
  serverBin = fakeBin(join(dir, "mcp-server.js"), `const i = process.argv.indexOf("--port");
const port = Number(process.argv[i + 1]);
Bun.serve({ hostname: "127.0.0.1", port, async fetch(req) {
  const u = new URL(req.url);
  return Response.json({ method: req.method, path: u.pathname, search: u.search, auth: req.headers.get("authorization"),
    body: req.method === "POST" ? await req.text() : null, cwd: process.cwd(), godot: process.env.GODOT ?? null,
    bearer_env: process.env.TK_ENGINE_MCP_BEARER ?? null });
} });
setInterval(() => {}, 1 << 30);
`);
  exitBin = fakeBin(join(dir, "mcp-exit.js"), `process.exit(3);\n`);
  idleBin = fakeBin(join(dir, "mcp-idle.js"), `setInterval(() => {}, 1 << 30);\n`);
  godot = join(dir, "Godot_v4.7.2-stable_mono_win64.exe");
  writeFileSync(godot, "");
  sbx = fakeSbx();
});
afterAll(async () => {
  // Nothing this suite started outlives it.
  for (const [q, id] of started) await stopEngineMcp(q, id, "test teardown");
});
const started: [Queue, string][] = [];

const newQueue = () => track(new Queue(":memory:", { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) }));

/** A claimed sbx run with its worktree cut, flagged unless `flag: false`. */
async function flaggedRun(q: Queue, opts: { flag?: boolean } = {}): Promise<{ run: QueueRun; wt: string; root: string }> {
  const root = tempDir("tk-sup-enginemcp-root-");
  const wt = tempDir("tk-sup-enginemcp-wt-");
  const run = q.enqueue({
    jobId: "run-epic", root, projectId: "tua", definition: JOB, owner: me, tier: "sbx", sandbox: SB, base_ref: "main",
    ...(opts.flag === false ? {} : { editorInTheLoop: true }),
  }).run;
  expect((await q.claim(run.run_id, me)).claimed).toBe(true);
  q.recordWorktree(run.run_id, wt, { branch: `supervisor/run-${run.run_id}`, base_ref: "main" });
  q.note(run.run_id, "pinned", { sandbox: SB });
  return { run: q.get(run.run_id)!, wt, root };
}

type Files = { config?: string | null; mcp?: string | null };
/** The fake `git show <base>:<path>`: the tracked config and `.mcp.json` at the base (null: absent). */
function gitAt(files: Files, calls: string[][] = []): EngineMcpDeps["git"] {
  return async (args) => {
    calls.push(args);
    const path = args[1]!.slice(args[1]!.indexOf(":") + 1);
    const text = path.endsWith(".tk-studio/config.yaml") ? files.config : path.endsWith(".mcp.json") ? files.mcp : null;
    return text == null ? { exit: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in 'main'` } : { exit: 0, stdout: text, stderr: "" };
  };
}
const MCP_JSON = JSON.stringify({ mcpServers: { [NAME]: { type: "http", url: "${TK_ENGINE_MCP_URL}", headers: { Authorization: "Bearer ${TK_ENGINE_MCP_BEARER}" } } } });
const configFor = (start: string, port: number) => `verify:\n  host: scripts/verify.sh\nengine:\n  mcp:\n    name: ${NAME}\n    start: "${start}"\n    port: ${port}\n`;

/** Deps for a start: the fake git, GODOT, the loopback bind and an ephemeral forwarder port. */
function depsFor(files: Files, extra: Partial<EngineMcpDeps> & { env?: Record<string, string | undefined> } = {}): EngineMcpDeps & { fwd: number } {
  const fwd = freePort();
  return {
    // Loopback only through the explicit test seam: the default check refuses any bind outside 100.64.0.0/10.
    fwd, git: gitAt(files), startTimeoutMs: 10_000, pollMs: 50, checkBind: (a: string) => a, ...extra,
    env: { ...process.env, GODOT: godot, TK_SUPERVISOR_BIND: "127.0.0.1", TK_SUPERVISOR_ENGINE_MCP_PORT: String(fwd), ...(extra.env ?? {}) },
  };
}
const kinds = (q: Queue, id: string) => q.events(id).map((e) => e.kind);
const sbxDeps = (): SandboxDeps => ({ env: { ...process.env, SBX_BIN: sbx.bin, TK_STUDIO_HOME: tempDir("tk-sup-enginemcp-home-") } });

async function startOk(q: Queue, run: QueueRun) {
  const port = freePort();
  const deps = depsFor({ config: configFor(`${serverBin} --port ${port} --root {worktree}`, port), mcp: MCP_JSON });
  const out = await startEngineMcp(q, run.run_id, deps);
  started.push([q, run.run_id]);
  return { out, deps, port };
}

describe("parseEngineMcp: engine.mcp {name, start, port}", () => {
  test("absent, malformed, and the shape (path defaults to /mcp)", () => {
    expect(parseEngineMcp({ verify: { host: "x" } })).toBeNull();
    expect(parseEngineMcp({ engine: { mcp: "x" } })).toEqual({ malformed: "engine.mcp is not a mapping" });
    expect(parseEngineMcp({ engine: { mcp: { name: "", start: "a", port: 1 } } })).toMatchObject({ malformed: expect.stringContaining("name") });
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "  ", port: 1 } } })).toMatchObject({ malformed: expect.stringContaining("start") });
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "a", port: 70000 } } })).toMatchObject({ malformed: expect.stringContaining("port") });
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "a b", port: 9000 } } })).toEqual({ name: "n", start: "a b", port: 9000, path: "/mcp" });
  });
});

describe("start: a flagged run's engine MCP on the host, behind the bearer forwarder", () => {
  test("Start: the child in the worktree with GODOT, the forwarder on bind:port, `engine-mcp-start` without the bearer, the env by name", async () => {
    const q = newQueue();
    const { run, wt } = await flaggedRun(q);
    const { out, deps } = await startOk(q, run);
    const url = `http://127.0.0.1:${deps.fwd}/mcp`;
    expect(out).toEqual({ started: true, url });
    expect(engineMcpLive(run.run_id)).toBe(true);
    const ev = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!;
    expect(Object.keys(ev.detail!).sort()).toEqual(["forwarder_pid", "forwarder_start", "name", "pid", "start", "url"]);
    expect(ev.detail).toMatchObject({ name: NAME, url });
    expect(typeof ev.detail!.pid).toBe("number");
    // The forwarder is its own child process, recorded beside the server.
    expect(typeof ev.detail!.forwarder_pid).toBe("number");
    expect(ev.detail!.forwarder_pid).not.toBe(ev.detail!.pid);
    expect(ev.detail!.forwarder_pid).not.toBe(process.pid);
    expect(pidRunning(ev.detail!.forwarder_pid as number)).toBe(true);
    const env = engineMcpEnv(run.run_id)!;
    expect(Object.keys(env)).toEqual(["TK_ENGINE_MCP_URL", "TK_ENGINE_MCP_BEARER"]);
    expect(env.TK_ENGINE_MCP_URL).toBe(url);
    expect(env.TK_ENGINE_MCP_BEARER).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The bearer is never in an event, nor in either child's argv.
    expect(JSON.stringify(q.events(run.run_id))).not.toContain(env.TK_ENGINE_MCP_BEARER);
    expectNoBearerInArgv([ev.detail!.pid as number, ev.detail!.forwarder_pid as number], env.TK_ENGINE_MCP_BEARER!);

    // Forwarder: 200 proxied with the exact bearer (path, query and body kept, the bearer dropped upstream), 401 otherwise.
    const ok = await fetch(`${url}?x=1`, { method: "POST", headers: { Authorization: `Bearer ${env.TK_ENGINE_MCP_BEARER}` }, body: '{"jsonrpc":"2.0"}' });
    expect(ok.status).toBe(200);
    const echoed = await ok.json() as Record<string, unknown>;
    expect(echoed).toMatchObject({ method: "POST", path: "/mcp", search: "?x=1", auth: null, body: '{"jsonrpc":"2.0"}', godot, bearer_env: null });
    expect(String(echoed.cwd).toLowerCase()).toBe(wt.toLowerCase());
    for (const h of [undefined, "Bearer wrong", `bearer ${env.TK_ENGINE_MCP_BEARER}`, `Bearer ${env.TK_ENGINE_MCP_BEARER}x`]) {
      const r = await fetch(url, { headers: h ? { Authorization: h } : {} });
      expect(r.status).toBe(401);
      await r.text();
    }

    // Idempotent per run: a second start answers the live one, no second event.
    expect(await startEngineMcp(q, run.run_id, deps)).toEqual({ live: true, url });
    expect(kinds(q, run.run_id).filter((k) => k === ENGINE_MCP_START)).toHaveLength(1);
    await stopEngineMcp(q, run.run_id, "test");
  });

  test("No flag: nothing started, nothing recorded, no env", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q, { flag: false });
    const calls: string[][] = [];
    const out = await startEngineMcp(q, run.run_id, { ...depsFor({}), git: gitAt({ config: null, mcp: null }, calls) });
    expect(out).toEqual({ skipped: "not an editor-in-the-loop run" });
    expect(calls).toEqual([]);
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
    expect(engineMcpEnv(run.run_id)).toBeUndefined();
  });
});

describe("refusals: nothing started on any", () => {
  const port = 1; // never reached
  const goodConfig = configFor(`never-run --port ${port}`, 9);
  test.each([
    ["no-config (no config at the base)", { config: null, mcp: MCP_JSON }, {}, "engine-mcp:no-config"],
    ["no-config (no engine.mcp)", { config: "verify:\n  host: x\n", mcp: MCP_JSON }, {}, "engine-mcp:no-config"],
    ["no-config (malformed)", { config: "engine:\n  mcp:\n    name: x\n", mcp: MCP_JSON }, {}, "engine-mcp:no-config"],
    ["no-mcp-json (no file)", { config: goodConfig, mcp: null }, {}, "engine-mcp:no-mcp-json"],
    ["no-mcp-json (no entry)", { config: goodConfig, mcp: JSON.stringify({ mcpServers: { other: {} } }) }, {}, "engine-mcp:no-mcp-json"],
    ["no-mcp-json (not JSON)", { config: goodConfig, mcp: "{nope" }, {}, "engine-mcp:no-mcp-json"],
    ["no-engine (GODOT unset)", { config: goodConfig, mcp: MCP_JSON }, { GODOT: undefined }, "engine-mcp:no-engine"],
    ["no-engine (GODOT names no file)", { config: goodConfig, mcp: MCP_JSON }, { GODOT: "/nowhere/godot" }, "engine-mcp:no-engine"],
  ] as const)("%s", async (_what, files, env, key) => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const out = await startEngineMcp(q, run.run_id, depsFor(files, { env: { ...env } }));
    expect("refused" in out && out.refused.key).toBe(key);
    expect("refused" in out && out.refused.resolves.length > 0).toBe(true);
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
  });

  test("start-failed: the child exits before its port answers", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const p = freePort();
    const out = await startEngineMcp(q, run.run_id, depsFor({ config: configFor(exitBin, p), mcp: MCP_JSON }));
    expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining("exited") });
    expect(engineMcpLive(run.run_id)).toBe(false);
  });

  test("start-failed: the port does not answer within the bound — the child is killed", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const p = freePort();
    let pid: number | undefined;
    const deps = depsFor({ config: configFor(idleBin, p), mcp: MCP_JSON }, { startTimeoutMs: 600 });
    const out = await startEngineMcp(q, run.run_id, {
      ...deps,
      spawn: (argv, o) => {
        const { spawn } = require("node:child_process") as typeof import("node:child_process");
        const c = spawn(argv[0]!, argv.slice(1), { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: "ignore" });
        pid = c.pid;
        return { pid: c.pid, exited: new Promise((r) => c.once("exit", r)), kill: () => { c.kill("SIGKILL"); } };
      },
    });
    expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining("did not answer") });
    await Bun.sleep(200);
    expect(pid !== undefined && pidRunning(pid)).toBe(false);
  });
});

describe("stop: at release, also on a kept pin", () => {
  test("Release: the terminal run's MCP stops — the forwarder closed, the child gone, `engine-mcp-stop` recorded", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const { deps } = await startOk(q, run);
    const startEv = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const pid = startEv.pid as number, fpid = startEv.forwarder_pid as number;
    // Not terminal: releasePin keeps everything.
    expect(await releasePin(q, run.run_id, sbxDeps())).toBe("none");
    expect(engineMcpLive(run.run_id)).toBe(true);
    q.end(run.run_id, "complete", null);
    expect(await releasePin(q, run.run_id, sbxDeps())).toBe("released");
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)?.detail).toEqual({ name: NAME, pid, forwarder_pid: fpid, why: "released" });
    await expect(fetch(`http://127.0.0.1:${deps.fwd}/mcp`)).rejects.toThrow();
    expect(await gone(pid)).toBe(true);
    expect(await gone(fpid)).toBe(true);
    // Idempotent: a second release records no second stop.
    await releasePin(q, run.run_id, sbxDeps());
    expect(kinds(q, run.run_id).filter((k) => k === ENGINE_MCP_STOP)).toHaveLength(1);
  });

  test("Kept pin: another run holds the sandbox — the pin is kept, this run's MCP still stops", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const other = q.enqueue({ jobId: "other", root: tempDir("tk-sup-enginemcp-other-"), projectId: "p", definition: { id: "other" }, owner: me, tier: "sbx", sandbox: SB }).run;
    expect((await q.claim(other.run_id, me)).claimed).toBe(true);
    await startOk(q, run);
    q.end(run.run_id, "complete", null);
    expect(await releasePin(q, run.run_id, sbxDeps())).toBe("kept");
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(kinds(q, run.run_id)).toContain(ENGINE_MCP_STOP);
  });
});

describe("the recorder's pin starts it; recovery after a supervisor restart", () => {
  test("queueRecorder: a successful pin starts the flagged run's MCP and the recorder hands its env on; a refusal fails the pin", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const port = freePort();
    const deps = depsFor({ config: configFor(`${serverBin} --port ${port}`, port), mcp: MCP_JSON });
    const rec = queueRecorder(q, run.run_id, sbxDeps(), new Set(), deps);
    started.push([q, run.run_id]);
    expect(await rec.pin!(SB)).toBeNull();
    expect(kinds(q, run.run_id)).toContain(ENGINE_MCP_START);
    expect(rec.engineMcpEnv!()).toEqual(engineMcpEnv(run.run_id));
    await stopEngineMcp(q, run.run_id, "test");

    const q2 = newQueue();
    const r2 = (await flaggedRun(q2)).run;
    const rec2 = queueRecorder(q2, r2.run_id, sbxDeps(), new Set(), depsFor({ config: null, mcp: MCP_JSON }));
    expect(await rec2.pin!(SB)).toContain("engine-mcp:no-config");
    expect(rec2.engineMcpEnv!()).toBeUndefined();
  });

  test("Restart: a recorded start not live here, its run ended, is killed by pid and stopped `supervisor restarted`; never re-armed", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    q.note(run.run_id, ENGINE_MCP_START, { name: NAME, pid: 987654, start: "133000000000000000", url: "http://127.0.0.1:8788/mcp" });
    // A live driver (this process's nonce) keeps it: not a lost one.
    const killed: [number, string | null][] = [];
    const killRecorded = async (pid: number, start: string | null) => { killed.push([pid, start]); return { pid, start, outcome: "killed" as const }; };
    expect(await recoverEngineMcps(q, { killRecorded })).toEqual([]);
    q.end(run.run_id, "blocked", "supervisor restarted");
    expect(await recoverEngineMcps(q, { killRecorded })).toEqual([run.run_id]);
    expect(killed).toEqual([[987654, "133000000000000000"]]);
    expect(q.events(run.run_id).at(-1)).toMatchObject({ kind: ENGINE_MCP_STOP, detail: { name: NAME, pid: 987654, why: "supervisor restarted" } });
    // Once: a second recovery finds it stopped.
    expect(await recoverEngineMcps(q, { killRecorded })).toEqual([]);
    // Never re-armed: a later start of the same run starts nothing.
    expect(await startEngineMcp(q, run.run_id, depsFor({ config: null, mcp: null }))).toMatchObject({ skipped: expect.stringContaining("never re-armed") });
  });
});

describe("start-failed before anything is spawned: the bind and the loopback port", () => {
  test.each([["0.0.0.0"], ["192.168.1.5"], ["127.0.0.1"]])("a forwarder bind outside the tailnet (%s) is refused, naming the bind; nothing spawned", async (bind) => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    let spawned = 0;
    const port = freePort();
    // The default check (api.ts `checkBind`): no test seam here.
    const { checkBind: _seam, ...deps } = depsFor({ config: configFor(`${serverBin} --port ${port}`, port), mcp: MCP_JSON }, { env: { TK_SUPERVISOR_BIND: bind } });
    const out = await startEngineMcp(q, run.run_id, { ...deps, spawn: () => { spawned++; throw new Error("never spawned"); } });
    expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining(`forwarder bind '${bind}'`) });
    expect(JSON.stringify(out)).toContain("100.64.0.0/10");
    expect(spawned).toBe(0);
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
  });

  test("a loopback port already answering is `port already in use`; the server is never spawned", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const squatter = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("someone else") });
    try {
      let spawned = 0;
      const deps = depsFor({ config: configFor(`${serverBin} --port ${squatter.port}`, squatter.port!), mcp: MCP_JSON });
      const out = await startEngineMcp(q, run.run_id, { ...deps, spawn: () => { spawned++; throw new Error("never spawned"); } });
      expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining("port already in use") });
      expect(spawned).toBe(0);
    } finally { squatter.stop(true); }
  });

  test("the child exits once the port answers (another listener answered): start-failed, nothing live", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const port = freePort();
    let other: { stop(force?: boolean): void } | undefined;
    const deps = depsFor({ config: configFor(`fake --port ${port}`, port), mcp: MCP_JSON });
    try {
      const out = await startEngineMcp(q, run.run_id, {
        ...deps,
        // A child that is gone at once while something else serves its port.
        spawn: () => { other = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("") }); return { pid: undefined, exited: Promise.resolve(3), kill: () => {} }; },
      });
      expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining("exited") });
      expect(engineMcpLive(run.run_id)).toBe(false);
    } finally { other?.stop(true); }
  });
});

describe("a child that exits on its own mid-run", () => {
  test("the server dies: the forwarder goes too, the entry is dropped, `engine-mcp-stop {why: \"exited\"}` recorded", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const { out } = await startOk(q, run);
    expect("started" in out).toBe(true);
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const pid = d.pid as number, fpid = d.forwarder_pid as number;
    expect((await killRecordedWorker(pid, d.start as string)).outcome).toBe("killed");
    for (const until = Date.now() + 5000; engineMcpLive(run.run_id) && Date.now() < until;) await Bun.sleep(50);
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(engineMcpEnv(run.run_id)).toBeUndefined(); // no dead URL handed out
    for (const until = Date.now() + 5000; !kinds(q, run.run_id).includes(ENGINE_MCP_STOP) && Date.now() < until;) await Bun.sleep(50);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)?.detail).toEqual({ name: NAME, pid, forwarder_pid: fpid, why: "exited", exited: "server" });
    expect(await gone(fpid)).toBe(true);
    // Stopped once: the release records no second stop.
    expect(await stopEngineMcp(q, run.run_id, "released")).toBe(false);
    expect(kinds(q, run.run_id).filter((k) => k === ENGINE_MCP_STOP)).toHaveLength(1);
  });
});

describe("consult ruling 2: the forwarder outlives the process that started it (a drain-launched run)", () => {
  test("the starting process lets go: a working forwarder; the next tick's recovery leaves it; a later release stops both pids", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const { out, deps } = await startOk(q, run);
    expect("started" in out).toBe(true);
    const { TK_ENGINE_MCP_URL: url, TK_ENGINE_MCP_BEARER: bearer } = engineMcpEnv(run.run_id)!;
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const pid = d.pid as number, fpid = d.forwarder_pid as number;
    // run-epic's launch returns: the driver lets go (owner cleared, engine recorded); then the drain process exits.
    q.markLaunched(run.run_id, "E1", { end: { state: "complete", reason: null } });
    expect(letGoEngineMcp(run.run_id)).toBe(true);
    expect(engineMcpLive(run.run_id)).toBe(false);
    // The forwarder still works: its own process, the bearer in its spawn env only.
    expect(pidRunning(pid) && pidRunning(fpid)).toBe(true);
    const ok = await fetch(url!, { method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: "{}" });
    expect(ok.status).toBe(200);
    await ok.text();
    const no = await fetch(url!, { method: "POST", body: "{}" });
    expect(no.status).toBe(401);
    await no.text();
    expectNoBearerInArgv([pid, fpid], bearer!);
    expect(processStartTime(fpid)).toBe(d.forwarder_start as string);
    // The next tick: a non-terminal launched run, both pids alive — left alone (real probes, no injected kill).
    expect(await recoverEngineMcps(q)).toEqual([]);
    expect(kinds(q, run.run_id)).not.toContain(ENGINE_MCP_STOP);
    expect(pidRunning(pid) && pidRunning(fpid)).toBe(true);
    // A later tick: the engine ended, the deferred `ended` releases the pin — this process holds nothing, so both
    // recorded pids are killed by pid and start time and the stop recorded.
    q.end(run.run_id, "complete", null);
    expect(await releasePin(q, run.run_id, sbxDeps())).toBe("released");
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)?.detail).toEqual({ name: NAME, pid, forwarder_pid: fpid, why: "released" });
    expect(await gone(pid)).toBe(true);
    expect(await gone(fpid)).toBe(true);
    await expect(fetch(`http://127.0.0.1:${deps.fwd}/mcp`)).rejects.toThrow();
    expect(JSON.stringify(q.events(run.run_id))).not.toContain(bearer!);
    // Idempotent: nothing left to stop.
    expect(await stopEngineMcp(q, run.run_id, "released")).toBe(false);
    expect(await recoverEngineMcps(q)).toEqual([]);
  });

  test("recovery stops a launched run's MCP whose forwarder died (the server killed too), never re-armed", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    await startOk(q, run);
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const pid = d.pid as number, fpid = d.forwarder_pid as number;
    q.markLaunched(run.run_id, "E1", { end: { state: "complete", reason: null } });
    letGoEngineMcp(run.run_id);
    expect((await killRecordedWorker(fpid, d.forwarder_start as string)).outcome).toBe("killed");
    expect(await recoverEngineMcps(q)).toEqual([run.run_id]);
    expect(await gone(pid)).toBe(true);
    expect(q.events(run.run_id).at(-1)).toMatchObject({ kind: ENGINE_MCP_STOP, detail: { pid, forwarder_pid: fpid, why: "supervisor restarted" } });
  });

  test("recovery records no stop while a kill fails; a later recovery that kills both records it", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    q.note(run.run_id, ENGINE_MCP_START, { name: NAME, pid: 987654, start: "1", url: "u", forwarder_pid: 987655, forwarder_start: "2" });
    q.end(run.run_id, "blocked", "x");
    const failing = async (pid: number, start: string | null) => ({ pid, start, outcome: "kill failed" as const, detail: "still running after wait" });
    expect(await recoverEngineMcps(q, { killRecorded: failing })).toEqual([]);
    expect(kinds(q, run.run_id)).not.toContain(ENGINE_MCP_STOP);
    const killed: number[] = [];
    const killing = async (pid: number, start: string | null) => { killed.push(pid); return { pid, start, outcome: "killed" as const }; };
    expect(await recoverEngineMcps(q, { killRecorded: killing })).toEqual([run.run_id]);
    expect(killed).toEqual([987654, 987655]);
    expect(kinds(q, run.run_id).filter((k) => k === ENGINE_MCP_STOP)).toHaveLength(1);
  });
});

describe("the snapshot is still taken for a flagged Godot run (Story 22.3, unchanged)", () => {
  test("snapshotOnce records `snapshot` and the MCP starts beside it", async () => {
    const q = newQueue();
    const { run, root } = await flaggedRun(q);
    writeFileSync(join(root, "project.godot"), "");
    const work = tempDir("tk-sup-enginemcp-work-");
    const robocopy: string[][] = [];
    await snapshotOnce(q, run, "tua", root, { env: { TK_SUPERVISOR_WORK: work }, run: async (bin, args): Promise<RunResult> => { robocopy.push([bin, ...args]); return { exit: 1, stdout: "", stderr: "" }; } });
    expect(robocopy).toEqual([["robocopy", root, join(work, "snapshots", "tua", run.run_id), "/E", "/R:3", "/W:5"]]);
    const { out } = await startOk(q, run);
    expect("started" in out).toBe(true);
    expect(kinds(q, run.run_id).filter((k) => k === "snapshot" || k === ENGINE_MCP_START)).toEqual(["snapshot", ENGINE_MCP_START]);
    await stopEngineMcp(q, run.run_id, "test");
  });
});

describe("forwarder: 401 without the exact bearer", () => {
  test("no upstream reached without the bearer", async () => {
    const handler = forwarder("tok", 1);
    expect((await handler(new Request("http://x/mcp"))).status).toBe(401);
    expect((await handler(new Request("http://x/mcp", { headers: { Authorization: "Bearer tok2" } }))).status).toBe(401);
    // With it, an unreachable upstream is a 502, never a 200.
    expect((await handler(new Request("http://x/mcp", { headers: { Authorization: "Bearer tok" } }))).status).toBe(502);
  });
});

// The real submit and drain paths (registry, `resolve`, the claim, the worktree) against a throwaway store, as
// command-line.test.ts's e2e fixture does: a fake `gh`, a fake studio install/activate, a fake `sbx`.
const REPO = resolve(import.meta.dir, "..");
const canRunE2E = !!process.env.TK_STUDIO_ROOT && spawnSync("uv", ["--version"]).status === 0;

describe.skipIf(!canRunE2E)("end to end: the definition's flag, and a drained flagged run's start in runJob", () => {
  const store = tempDir("tk-sup-enginemcp-store-");
  const plugin = () => join(process.env.TK_STUDIO_ROOT!, "plugins", "tk-studio");
  const prev: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of ["TK_STUDIO_HOME", "SBX_BIN", "TK_SUPERVISOR_NOTIFY"]) prev[k] = process.env[k];
    process.env.TK_STUDIO_HOME = store;
    process.env.SBX_BIN = sbx.bin;
    delete process.env.TK_SUPERVISOR_NOTIFY;
  });
  afterAll(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  /** A registered git project (on `main`, pushed to a bare origin) whose job `em-flagged` flags the run in its definition. */
  function project(files: Record<string, string> = {}): { root: string; projectId: string } {
    const root = tempDir("tk-sup-enginemcp-proj-");
    mkdirSync(join(root, ".tk-studio", "jobs"), { recursive: true });
    const health = JSON.parse(readFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), "utf-8"));
    writeFileSync(join(root, ".tk-studio", "jobs", "em-flagged.json"), JSON.stringify({ ...health, id: "em-flagged", editor_in_the_loop: true }));
    copyFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), join(root, ".tk-studio", "jobs", "studio-health.json"));
    const reg = spawnSync("uv", ["run", join(plugin(), "lib", "registry.py"), "register", "--directory", root, "--writer", "onboard"],
      { env: { ...process.env, TK_STUDIO_HOME: store }, encoding: "utf-8", timeout: 120_000 });
    if (reg.status !== 0) throw new Error(`register failed: ${reg.stdout}${reg.stderr}`);
    gitInit(root, { ".gitignore": RUNTIME_GITIGNORE, ...files });
    return { root, projectId: basename(root) };
  }

  test("Patch: a run its JOB DEFINITION flags is queued flagged; without TK_SUPERVISOR_WORK it is refused WorkDirMissing, nothing queued", async () => {
    const { root } = project();
    const q = track(new Queue(":memory:"));
    const err = await submitJob("em-flagged", root, { queue: q, hygiene: { env: {} } }).catch((e) => e);
    expect(err).toBeInstanceOf(StartError);
    expect(String(err.message)).toStartWith("WorkDirMissing:");
    expect(q.runs()).toEqual([]);
    const work = tempDir("tk-sup-enginemcp-work-");
    const ok = await submitJob("em-flagged", root, { queue: q, hygiene: { env: { TK_SUPERVISOR_WORK: work } } });
    expect(q.get(String(ok.run_id))).toMatchObject({ state: "queued", editor_in_the_loop: 1 });
    // A definition without the flag (no submission flag either) stays unflagged.
    const plain = await submitJob("studio-health", root, { queue: q, hygiene: { env: {} } });
    expect(q.get(String(plain.run_id))!.editor_in_the_loop).toBeNull();
  }, 180_000);

  /** Drain one queued flagged sbx run of `em-flagged` through runJob (`opts.runId`). */
  async function drainOne(files: Record<string, string>, env: Record<string, string | undefined> = {}) {
    const { root, projectId } = project(files);
    const q = track(new Queue(join(tempDir("tk-sup-enginemcp-q-"), "q.db")));
    const defn = JSON.parse(readFileSync(join(root, ".tk-studio", "jobs", "em-flagged.json"), "utf-8"));
    const queued = q.enqueue({ jobId: "em-flagged", root, projectId, definition: defn, tier: "sbx", sandbox: SB, editorInTheLoop: true }).run;
    const work = tempDir("tk-sup-enginemcp-work-");
    const fwd = freePort();
    const wtEnv = {
      ...process.env, TK_STUDIO_ROOT: fakeStudioRoot(process.env.TK_STUDIO_ROOT!).root, TK_SUPERVISOR_WORK: work, GH_BIN: fakeGh(tempDir("tk-sup-enginemcp-gh-")).bin,
      SBX_BIN: sbx.bin, GODOT: godot, TK_SUPERVISOR_BIND: "127.0.0.1", TK_SUPERVISOR_ENGINE_MCP_PORT: String(fwd), ...env,
    };
    started.push([q, queued.run_id]);
    const out = await runJob("em-flagged", root, undefined, {
      queue: q, runId: queued.run_id, skipRecover: true, agents: false, worktree: { env: wtEnv }, hygiene: { env: { TK_SUPERVISOR_WORK: work } },
      engineMcp: { checkBind: (a: string) => a, startTimeoutMs: 10_000, pollMs: 50 }, // loopback through the test seam only
    }).catch((e) => e);
    return { q, runId: queued.run_id, out, fwd };
  }

  test("Patch: a drained flagged run starts its MCP beside snapshotOnce, after its claim and worktree", async () => {
    sbx.answer({});
    const port = freePort();
    const before = sbx.calls().length;
    const { q, runId } = await drainOne({ ".tk-studio/config.yaml": configFor(`${serverBin} --port ${port} --root {worktree}`, port), ".mcp.json": MCP_JSON });
    // The worker's `sbx exec` got the two names by `-e`, never a value.
    const worker = sbx.calls().slice(before).find((c) => c.argv[0] === "exec" && c.argv.includes("-p"))!;
    expect(worker.argv.slice(0, worker.argv.indexOf(SB))).toEqual(expect.arrayContaining(["-e", "TK_ENGINE_MCP_URL", "TK_ENGINE_MCP_BEARER"]));
    expect(worker.argv.join(" ")).not.toContain("http://127.0.0.1");
    const ks = kinds(q, runId);
    for (const k of ["claimed", "worktree", "snapshot-skipped", ENGINE_MCP_START]) expect(ks).toContain(k);
    expect(ks.indexOf("snapshot-skipped")).toBeGreaterThan(ks.indexOf("worktree"));
    expect(ks.indexOf(ENGINE_MCP_START)).toBeGreaterThan(ks.indexOf("snapshot-skipped"));
    const d = q.events(runId).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    expect(d).toMatchObject({ name: NAME });
    // The MCP started before the drive: the worker's session ran after it (the fake sbx answers no status block).
    expect(ks.indexOf("worker")).toBeGreaterThan(ks.indexOf(ENGINE_MCP_START));
    // Its release follows the pin's rule (here the worker "may still run in the VM", so the pin is held); the
    // stop is idempotent from any process and takes both children.
    expect(await stopEngineMcp(q, runId, "test")).toBe(true);
    expect(kinds(q, runId)).toContain(ENGINE_MCP_STOP);
    expect(await gone(d.pid as number)).toBe(true);
    expect(await gone(d.forwarder_pid as number)).toBe(true);
  }, 180_000);

  test("Patch: a refusal there ends the drained run `blocked`, the key in its reason; nothing started, no worker", async () => {
    sbx.answer({});
    const port = freePort();
    const before = sbx.calls().length;
    const { q, runId, out } = await drainOne({ ".tk-studio/config.yaml": configFor(`${serverBin} --port ${port}`, port) }); // no .mcp.json
    expect(out).toBeInstanceOf(StartError);
    expect(q.get(runId)).toMatchObject({ state: "blocked", reason: expect.stringContaining("engine-mcp:no-mcp-json") });
    expect(kinds(q, runId).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
    expect(engineMcpLive(runId)).toBe(false);
    expect(sbx.calls().slice(before).some((c) => c.argv.includes("-p"))).toBe(false);
  }, 180_000);
});
