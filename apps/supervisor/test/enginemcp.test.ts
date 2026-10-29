// Story 34.5: one engine MCP per run, started by the pin — the start, the stop (a kept pin too), no start without the
// flag, every refusal, the restart recovery, the snapshot still taken and the forwarder's 200/401. Fakes only: a
// `fakeBin` server on an ephemeral loopback port, a `fakeBin` editor as GODOT, a fake `git show`, a fake `sbx`;
// never a real engine. The launch shape is the operator's measured one for `hi-godot/godot-ai`: the server with its
// launch capabilities in its env, then the editor on the project, the forwarder putting the capability upstream.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { queueRecorder, runJob, StartError, submitJob } from "../src/cli";
import {
  ENGINE_MCP_START, ENGINE_MCP_STOP, engineMcpAdvisory, engineMcpEnv, engineMcpLive, forwarder, letGoEngineMcp, parseEngineMcp, recoverEngineMcps, startEngineMcp,
  stopEngineMcp, type EngineMcpDeps,
} from "../src/enginemcp";
import { engineMcpPort } from "../src/env";
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
/** No child's command line carries a secret (Linux: /proc/<pid>/cmdline; elsewhere the argv is ours, checked by
 * construction: `--bind/--port/--upstream` and `--editor --path` only). */
function expectNoBearerInArgv(pids: number[], ...secrets: string[]) {
  if (process.platform !== "linux") return;
  for (const pid of pids) for (const s of secrets) expect(readFileSync(`/proc/${pid}/cmdline`, "utf-8")).not.toContain(s);
}
/** What the fake editor wrote at its start (`editor.json` in its cwd, the worktree): its argv and its env's capabilities. */
async function editorSaw(wt: string): Promise<{ argv: string[]; capability: string | null; ws: string | null; telemetry: string | null }> {
  const f = join(wt, "editor.json");
  for (const until = Date.now() + 5000; Date.now() < until; await Bun.sleep(50)) {
    try { return JSON.parse(readFileSync(f, "utf-8")); } catch { /* not yet */ }
  }
  return JSON.parse(readFileSync(f, "utf-8"));
}

/** A child spawned by the test (through the `spawn`/`spawnEditor` seams) whose kill is logged by name, with whether
 * the given other pids still ran at that moment. */
function loggedChild(argv: string[], opts: { cwd: string; env: Record<string, string | undefined> }, name: string,
  log: { name: string; running: Record<number, boolean> }[], watch: () => number[] = () => []) {
  const p = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdout: "ignore", stderr: "ignore" });
  return {
    pid: p.pid, exited: p.exited,
    kill() { log.push({ name, running: Object.fromEntries(watch().map((w) => [w, pidRunning(w)])) }); p.kill(); },
    unref() { p.unref(); },
  };
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
    bearer_env: process.env.TK_ENGINE_MCP_BEARER ?? null, capability_env: process.env.GODOT_AI_HTTP_CAPABILITY ?? null,
    ws_env: process.env.GODOT_AI_WS_TOKEN ?? null, telemetry_env: process.env.GODOT_AI_DISABLE_TELEMETRY ?? null });
} });
setInterval(() => {}, 1 << 30);
`);
  exitBin = fakeBin(join(dir, "mcp-exit.js"), `process.exit(3);\n`);
  idleBin = fakeBin(join(dir, "mcp-idle.js"), `setInterval(() => {}, 1 << 30);\n`);
  // The fake Godot editor: records its argv and its env's launch capabilities in its cwd, then idles.
  godot = fakeBin(join(dir, "Godot_v4.7.2-stable_mono_win64.js"), `require("node:fs").writeFileSync("editor.json", JSON.stringify({
  argv: process.argv.slice(2), capability: process.env.GODOT_AI_HTTP_CAPABILITY ?? null, ws: process.env.GODOT_AI_WS_TOKEN ?? null,
  telemetry: process.env.GODOT_AI_DISABLE_TELEMETRY ?? null }));
setInterval(() => {}, 1 << 30);
`);
  sbx = fakeSbx();
});
afterAll(async () => {
  // Nothing this suite started outlives it.
  for (const [q, id] of started) await stopEngineMcp(q, id, "test teardown");
});
const started: [Queue, string][] = [];

const newQueue = () => track(new Queue(":memory:", { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) }));

/** A claimed sbx run with its worktree cut (a Godot project in its `game/` folder, as TUA's), flagged unless `flag: false`. */
/** Story 35.6: `prefix` the project's place in its worktree (`run.prefix`, e.g. `game/`: the served root is `<wt>/game`). */
async function flaggedRun(q: Queue, opts: { flag?: boolean; prefix?: string } = {}): Promise<{ run: QueueRun; wt: string; root: string }> {
  const root = tempDir("tk-sup-enginemcp-root-");
  const wt = tempDir("tk-sup-enginemcp-wt-");
  mkdirSync(join(wt, "game"));
  writeFileSync(join(wt, "game", "project.godot"), "");
  const run = q.enqueue({
    jobId: "run-epic", root, projectId: "tua", definition: JOB, owner: me, tier: "sbx", sandbox: SB, base_ref: "main",
    ...(opts.flag === false ? {} : { editorInTheLoop: true }), ...(opts.prefix ? { prefix: opts.prefix } : {}),
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
const configFor = (start: string, port: number) => `verify:\n  host: scripts/verify.sh\nengine:\n  mcp:\n    name: ${NAME}\n    start: ${JSON.stringify(start)}\n    port: ${port}\n`; // JSON-quoted: a Windows path's backslashes would be YAML escapes in a bare double-quoted scalar

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
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "a b", port: 9000 } } })).toEqual({ name: "n", start: "a b", port: 9000, path: "/mcp", filter: "--exclude-domains" });
  });
});

describe("start: a flagged run's engine MCP on the host, behind the bearer forwarder", () => {
  test("Start: the server in the worktree with GODOT and its capabilities, the editor on the project, the forwarder on bind:port, `engine-mcp-start` without a secret, the env by name", async () => {
    const q = newQueue();
    const { run, wt } = await flaggedRun(q);
    const { out, deps, port } = await startOk(q, run);
    const url = `http://127.0.0.1:${deps.fwd}/mcp`;
    expect(out).toEqual({ started: true, url });
    expect(engineMcpLive(run.run_id)).toBe(true);
    const ev = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!;
    // Story 35.4: the ports in use (fixed here) and the verify-only advisory (this start line has no --exclude-domains).
    expect(Object.keys(ev.detail!).sort()).toEqual([
      "advisory", "editor_pid", "editor_start", "forwarder_pid", "forwarder_port", "forwarder_start", "name", "pid", "port", "start", "url",
    ]);
    expect(ev.detail).toMatchObject({ name: NAME, url, port, forwarder_port: deps.fwd });
    expect(typeof ev.detail!.pid).toBe("number");
    // The forwarder is its own child process, recorded beside the server.
    expect(typeof ev.detail!.forwarder_pid).toBe("number");
    expect(ev.detail!.forwarder_pid).not.toBe(ev.detail!.pid);
    expect(ev.detail!.forwarder_pid).not.toBe(process.pid);
    expect(pidRunning(ev.detail!.forwarder_pid as number)).toBe(true);
    // The editor: its own child, `$GODOT --editor --path <the project's folder>`, with the server's capabilities.
    const epid = ev.detail!.editor_pid as number;
    expect(typeof epid).toBe("number");
    expect(new Set([epid, ev.detail!.pid, ev.detail!.forwarder_pid]).size).toBe(3);
    expect(pidRunning(epid)).toBe(true);
    const ed = await editorSaw(wt);
    expect(ed.argv).toEqual(["--editor", "--path", join(wt, "game")]);
    const env = engineMcpEnv(run.run_id)!;
    expect(Object.keys(env)).toEqual(["TK_ENGINE_MCP_URL", "TK_ENGINE_MCP_BEARER"]);
    expect(env.TK_ENGINE_MCP_URL).toBe(url);
    expect(env.TK_ENGINE_MCP_BEARER).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Forwarder: 200 proxied with the exact bearer (path, query and body kept, the sandbox's bearer replaced upstream by
    // the server's capability), 401 otherwise.
    const ok = await fetch(`${url}?x=1`, { method: "POST", headers: { Authorization: `Bearer ${env.TK_ENGINE_MCP_BEARER}` }, body: '{"jsonrpc":"2.0"}' });
    expect(ok.status).toBe(200);
    const echoed = await ok.json() as Record<string, unknown>;
    expect(echoed).toMatchObject({ method: "POST", path: "/mcp", search: "?x=1", body: '{"jsonrpc":"2.0"}', godot, bearer_env: null, telemetry_env: "1" });
    // The launch capabilities: per run, the HTTP one urlsafe (32 to 128 chars), the WebSocket one 64 hex, the
    // editor given the same; the capability is what reaches the server, never the sandbox's bearer.
    const capability = String(echoed.capability_env);
    expect(capability).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(String(echoed.ws_env)).toMatch(/^[0-9a-f]{64}$/);
    expect(capability).not.toBe(env.TK_ENGINE_MCP_BEARER);
    expect(echoed.auth).toBe(`Bearer ${capability}`);
    expect(ed).toMatchObject({ capability, ws: echoed.ws_env, telemetry: "1" });
    // No secret in an event, nor in any child's argv.
    for (const secret of [env.TK_ENGINE_MCP_BEARER!, capability, String(echoed.ws_env)]) expect(JSON.stringify(q.events(run.run_id))).not.toContain(secret);
    expectNoBearerInArgv([ev.detail!.pid as number, ev.detail!.forwarder_pid as number, epid], env.TK_ENGINE_MCP_BEARER!, capability, String(echoed.ws_env));
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

  test("Story 35.6: a prefixed run's server and editor start in the served root (the folder whose config was read); {worktree} stays the worktree top", async () => {
    const q = newQueue();
    const { run, wt } = await flaggedRun(q, { prefix: "game/" });
    const served = join(wt, "game");
    const port = freePort();
    const log: { name: string; running: Record<number, boolean> }[] = [];
    const seen: { name: string; argv: string[]; cwd: string }[] = [];
    const git: string[][] = [];
    const deps = depsFor({ config: configFor(`${serverBin} --port ${port} --root {worktree}`, port), mcp: MCP_JSON });
    const out = await startEngineMcp(q, run.run_id, {
      ...deps, git: gitAt({ config: configFor(`${serverBin} --port ${port} --root {worktree}`, port), mcp: MCP_JSON }, git),
      spawn: (argv, o) => { seen.push({ name: "server", argv, cwd: o.cwd }); return loggedChild(argv, o, "server", log); },
      spawnEditor: (argv, o) => { seen.push({ name: "editor", argv, cwd: o.cwd }); return loggedChild(argv, o, "editor", log); },
    });
    started.push([q, run.run_id]);
    expect(out).toMatchObject({ started: true });
    // the config and `.mcp.json` were read under the prefix
    expect(git.map((a) => a[1]).sort()).toEqual(["main:game/.mcp.json", "main:game/.tk-studio/config.yaml"]);
    const server = seen.find((x) => x.name === "server")!, editor = seen.find((x) => x.name === "editor")!;
    expect(server.cwd).toBe(served);
    expect(server.argv.slice(1)).toEqual(["--port", String(port), "--root", wt]);
    expect(editor.cwd).toBe(served);
    expect(editor.argv.slice(1)).toEqual(["--editor", "--path", served]);
    const env = engineMcpEnv(run.run_id)!;
    const echoed = await (await fetch(env.TK_ENGINE_MCP_URL!, { headers: { Authorization: `Bearer ${env.TK_ENGINE_MCP_BEARER}` } })).json() as Record<string, unknown>;
    expect(String(echoed.cwd).toLowerCase()).toBe(served.toLowerCase());
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
    const { deps, port } = await startOk(q, run);
    const startEv = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const pid = startEv.pid as number, fpid = startEv.forwarder_pid as number, epid = startEv.editor_pid as number;
    // Not terminal: releasePin keeps everything.
    expect(await releasePin(q, run.run_id, sbxDeps())).toBe("none");
    expect(engineMcpLive(run.run_id)).toBe(true);
    q.end(run.run_id, "complete", null);
    expect(await releasePin(q, run.run_id, sbxDeps())).toBe("released");
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)?.detail).toEqual({
      name: NAME, pid, forwarder_pid: fpid, editor_pid: epid, why: "released", port, forwarder_port: deps.fwd,
    });
    await expect(fetch(`http://127.0.0.1:${deps.fwd}/mcp`)).rejects.toThrow();
    expect(await gone(pid)).toBe(true);
    expect(await gone(fpid)).toBe(true);
    expect(await gone(epid)).toBe(true);
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
    expect(q.events(run.run_id).at(-1)).toMatchObject({ kind: ENGINE_MCP_STOP, detail: { name: NAME, pid: 987654, editor_pid: null, why: "supervisor restarted" } });
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
    const { out, deps, port } = await startOk(q, run);
    expect("started" in out).toBe(true);
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const pid = d.pid as number, fpid = d.forwarder_pid as number, epid = d.editor_pid as number;
    expect((await killRecordedWorker(pid, d.start as string)).outcome).toBe("killed");
    for (const until = Date.now() + 5000; engineMcpLive(run.run_id) && Date.now() < until;) await Bun.sleep(50);
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(engineMcpEnv(run.run_id)).toBeUndefined(); // no dead URL handed out
    for (const until = Date.now() + 5000; !kinds(q, run.run_id).includes(ENGINE_MCP_STOP) && Date.now() < until;) await Bun.sleep(50);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)?.detail).toEqual({
      name: NAME, pid, forwarder_pid: fpid, editor_pid: epid, why: "exited", port, forwarder_port: deps.fwd, exited: "server",
    });
    expect(await gone(fpid)).toBe(true);
    expect(await gone(epid)).toBe(true);
    // Stopped once: the release records no second stop.
    expect(await stopEngineMcp(q, run.run_id, "released")).toBe(false);
    expect(kinds(q, run.run_id).filter((k) => k === ENGINE_MCP_STOP)).toHaveLength(1);
  });
});

describe("the editor: its own child, stopped before the server", () => {
  test("the editor exits on its own: the server and the forwarder go too, `engine-mcp-stop {why: \"exited\", exited: \"editor\"}`", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    expect("started" in (await startOk(q, run)).out).toBe(true);
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    expect((await killRecordedWorker(d.editor_pid as number, d.editor_start as string)).outcome).toBe("killed");
    for (const until = Date.now() + 5000; !kinds(q, run.run_id).includes(ENGINE_MCP_STOP) && Date.now() < until;) await Bun.sleep(50);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)?.detail).toMatchObject({ why: "exited", exited: "editor" });
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(await gone(d.pid as number)).toBe(true);
    expect(await gone(d.forwarder_pid as number)).toBe(true);
  });

  test("start-failed: no project.godot in the worktree (root or a first-level folder) — nothing spawned", async () => {
    const q = newQueue();
    const { run, wt } = await flaggedRun(q);
    rmSync(join(wt, "game"), { recursive: true, force: true });
    let spawned = 0;
    const port = freePort();
    const deps = depsFor({ config: configFor(`${serverBin} --port ${port}`, port), mcp: MCP_JSON });
    const out = await startEngineMcp(q, run.run_id, { ...deps, spawn: () => { spawned++; throw new Error("never spawned"); } });
    expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining("project.godot") });
    expect(spawned).toBe(0);
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
  });

  test("start-failed: the editor does not spawn — the server is killed, nothing live", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const port = freePort();
    const deps = depsFor({ config: configFor(`${serverBin} --port ${port}`, port), mcp: MCP_JSON });
    const out = await startEngineMcp(q, run.run_id, { ...deps, spawnEditor: () => { throw new Error("no editor"); } });
    expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining("editor") });
    expect(engineMcpLive(run.run_id)).toBe(false);
    // The server was killed: its port no longer answers.
    for (const until = Date.now() + 5000; Date.now() < until; await Bun.sleep(50)) {
      try { await fetch(`http://127.0.0.1:${port}/`); } catch { break; }
    }
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  test("start-failed: the editor exits before the forwarder is ready — every child stopped, no `engine-mcp-start`", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const port = freePort();
    const log: { name: string; running: Record<number, boolean> }[] = [];
    let serverPid = 0;
    const deps = depsFor({ config: configFor(`${serverBin} --port ${port}`, port), mcp: MCP_JSON });
    const out = await startEngineMcp(q, run.run_id, {
      ...deps,
      spawn: (argv, opts) => { const c = loggedChild(argv, opts, "server", log); serverPid = c.pid; return c; },
      // An editor that spawned (a pid) and exited at once.
      spawnEditor: () => ({ pid: 2_000_000_000, exited: Promise.resolve(1), kill() { log.push({ name: "editor", running: {} }); } }),
    });
    expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining("the editor exited before the MCP was ready") });
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
    expect(log.map((l) => l.name)).toEqual(["editor", "server"]);
    expect(await gone(serverPid)).toBe(true);
    // The forwarder was stopped too: its port no longer answers.
    await expect(fetch(`http://127.0.0.1:${deps.fwd}/mcp`)).rejects.toThrow();
  });

  test("a release from the starting process stops the forwarder, then the editor, then the server", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const port = freePort();
    const log: { name: string; running: Record<number, boolean> }[] = [];
    let fpid = 0;
    const deps = depsFor({ config: configFor(`${serverBin} --port ${port}`, port), mcp: MCP_JSON });
    const out = await startEngineMcp(q, run.run_id, {
      ...deps,
      spawn: (argv, opts) => loggedChild(argv, opts, "server", log, () => [fpid]),
      spawnEditor: (argv, opts) => loggedChild(argv, opts, "editor", log, () => [fpid]),
    });
    started.push([q, run.run_id]);
    expect("started" in out).toBe(true);
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    fpid = d.forwarder_pid as number;
    expect(await stopEngineMcp(q, run.run_id, "released")).toBe(true);
    // The forwarder first (already gone when the editor is killed), the editor before the server.
    expect(log).toEqual([{ name: "editor", running: { [fpid]: false } }, { name: "server", running: { [fpid]: false } }]);
    expect(await gone(d.pid as number)).toBe(true);
    expect(await gone(d.editor_pid as number)).toBe(true);
  });

  test("a recorded stop from another process kills the editor first, then the server, then the forwarder", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    q.note(run.run_id, ENGINE_MCP_START, { name: NAME, pid: 11, start: "a", url: "u", forwarder_pid: 12, forwarder_start: "b", editor_pid: 13, editor_start: "c" });
    const killed: [number, string | null][] = [];
    const killRecorded = async (pid: number, start: string | null) => { killed.push([pid, start]); return { pid, start, outcome: "killed" as const }; };
    expect(await stopEngineMcp(q, run.run_id, "released", { killRecorded })).toBe(true);
    expect(killed).toEqual([[13, "c"], [11, "a"], [12, "b"]]);
    expect(q.events(run.run_id).at(-1)).toMatchObject({ kind: ENGINE_MCP_STOP, detail: { pid: 11, forwarder_pid: 12, editor_pid: 13, why: "released" } });
  });
});

describe("consult ruling 2: the forwarder outlives the process that started it (a drain-launched run)", () => {
  test("the starting process lets go: a working forwarder; the next tick's recovery leaves it; a later release stops all three pids", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run, wt } = await flaggedRun(q);
    const { out, deps, port } = await startOk(q, run);
    expect("started" in out).toBe(true);
    const { TK_ENGINE_MCP_URL: url, TK_ENGINE_MCP_BEARER: bearer } = engineMcpEnv(run.run_id)!;
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const pid = d.pid as number, fpid = d.forwarder_pid as number, epid = d.editor_pid as number;
    // run-epic's launch returns: the driver lets go (owner cleared, engine recorded); then the drain process exits.
    q.markLaunched(run.run_id, "E1", { end: { state: "complete", reason: null } });
    expect(letGoEngineMcp(run.run_id)).toBe(true);
    expect(engineMcpLive(run.run_id)).toBe(false);
    // The forwarder still works: its own process, the bearer in its spawn env only.
    expect(pidRunning(pid) && pidRunning(fpid) && pidRunning(epid)).toBe(true);
    const ok = await fetch(url!, { method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: "{}" });
    expect(ok.status).toBe(200);
    await ok.text();
    const no = await fetch(url!, { method: "POST", body: "{}" });
    expect(no.status).toBe(401);
    await no.text();
    const ed = await editorSaw(wt);
    expect(ed.capability).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(ed.ws).toMatch(/^[0-9a-f]{64}$/);
    expectNoBearerInArgv([pid, fpid, epid], bearer!, ed.capability!, ed.ws!);
    expect(processStartTime(fpid)).toBe(d.forwarder_start as string);
    // The next tick: a non-terminal launched run, every pid alive — left alone (real probes, no injected kill).
    expect(await recoverEngineMcps(q)).toEqual([]);
    expect(kinds(q, run.run_id)).not.toContain(ENGINE_MCP_STOP);
    expect(pidRunning(pid) && pidRunning(fpid) && pidRunning(epid)).toBe(true);
    // A later tick: the engine ended, the deferred `ended` releases the pin — this process holds nothing, so both
    // recorded pids are killed by pid and start time and the stop recorded.
    q.end(run.run_id, "complete", null);
    expect(await releasePin(q, run.run_id, sbxDeps())).toBe("released");
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)?.detail).toEqual({
      name: NAME, pid, forwarder_pid: fpid, editor_pid: epid, why: "released", port, forwarder_port: deps.fwd,
    });
    expect(await gone(pid)).toBe(true);
    expect(await gone(fpid)).toBe(true);
    expect(await gone(epid)).toBe(true);
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
    const pid = d.pid as number, fpid = d.forwarder_pid as number, epid = d.editor_pid as number;
    q.markLaunched(run.run_id, "E1", { end: { state: "complete", reason: null } });
    letGoEngineMcp(run.run_id);
    expect((await killRecordedWorker(fpid, d.forwarder_start as string)).outcome).toBe("killed");
    expect(await recoverEngineMcps(q)).toEqual([run.run_id]);
    expect(await gone(pid)).toBe(true);
    expect(await gone(epid)).toBe(true);
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

  test("Story 35.4: a stop of a start recorded without ports (pre-0.1.30) records port and forwarder_port null", async () => {
    const killing = async (pid: number, start: string | null) => ({ pid, start, outcome: "killed" as const });
    const pre030 = { name: NAME, pid: 987654, start: "1", url: "u", forwarder_pid: 987655, forwarder_start: "2", editor_pid: 987656, editor_start: "3" };
    const want = (why: string) => ({ name: NAME, pid: 987654, forwarder_pid: 987655, editor_pid: 987656, why, port: null, forwarder_port: null });
    // The cross-process stop (this process holds nothing: the recorded pids are killed).
    const q = newQueue();
    const { run } = await flaggedRun(q);
    q.note(run.run_id, ENGINE_MCP_START, pre030);
    expect(await stopEngineMcp(q, run.run_id, "released", { killRecorded: killing })).toBe(true);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)!.detail).toEqual(want("released"));
    // The recovery path.
    const q2 = newQueue();
    const { run: run2 } = await flaggedRun(q2);
    q2.note(run2.run_id, ENGINE_MCP_START, pre030);
    q2.end(run2.run_id, "blocked", "x");
    expect(await recoverEngineMcps(q2, { killRecorded: killing })).toEqual([run2.run_id]);
    expect(q2.events(run2.run_id).find((e) => e.kind === ENGINE_MCP_STOP)!.detail).toEqual(want("supervisor restarted"));
  });
});

// Story 35.4: per-run ports, the start recorded before the children are let go (and their kill on a failed record),
// the verify-only advisory. Fakes only, as above.
describe("Story 35.4: the engine MCP before the first flagged run", () => {
  /** A config with `port` and optional `filter` (block style, the start JSON-quoted). */
  const config354 = (start: string, port: number, filter?: string) => configFor(start, port) + (filter ? `    filter: ${JSON.stringify(filter)}\n` : "");
  /** The deps with the forwarder per run (TK_SUPERVISOR_ENGINE_MCP_PORT unset). */
  const perRunDeps = (files: Files, extra: Partial<EngineMcpDeps> = {}) => depsFor(files, { ...extra, env: { TK_SUPERVISOR_ENGINE_MCP_PORT: undefined } });
  /** A server child through the `spawn` seam that records its argv and its calls (`unref`, `kill`) in `order`. */
  const recording = (order: string[], name: string, argvs: string[][] = []) => (argv: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => {
    argvs.push(argv);
    const p = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdout: "ignore", stderr: "ignore" });
    return { pid: p.pid, exited: p.exited, kill() { order.push(`kill:${name}`); p.kill(); }, unref() { order.push(`unref:${name}`); p.unref(); } };
  };

  test("parse: `port: 0` admitted with `{port}` in start, `no-config` without it; `filter` optional (default --exclude-domains)", async () => {
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "srv --port {port}", port: 0 } } }))
      .toEqual({ name: "n", start: "srv --port {port}", port: 0, path: "/mcp", filter: "--exclude-domains" });
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "srv --port 8000", port: 0 } } })).toEqual({ malformed: "engine.mcp.start has no {port} for port: 0" });
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "srv", port: -1 } } })).toMatchObject({ malformed: expect.stringContaining("port") });
    expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "srv", port: 8000, filter: "--deny" } } })).toMatchObject({ port: 8000, filter: "--deny" });
    for (const filter of ["", "  ", 3, "--a --b"]) {
      expect(parseEngineMcp({ engine: { mcp: { name: "n", start: "srv", port: 8000, filter } } })).toEqual({ malformed: "engine.mcp.filter is not one flag" });
    }
    // At the pin: nothing spawned, the run's reason names the key.
    const q = newQueue();
    const { run } = await flaggedRun(q);
    let spawned = 0;
    const out = await startEngineMcp(q, run.run_id, { ...perRunDeps({ config: config354(`${serverBin} --port 8000`, 0), mcp: MCP_JSON }), spawn: () => { spawned++; throw new Error("never"); } });
    expect("refused" in out && out.refused).toMatchObject({ key: "engine-mcp:no-config", reason: "engine MCP: engine.mcp.start has no {port} for port: 0" });
    expect(spawned).toBe(0);
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
  });

  test("`port: 0`: a free server port put in for `{port}`, a second for `{ws_port}`; the events carry them", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const order: string[] = [], argvs: string[][] = [];
    const resolved: number[] = [];
    const out = await startEngineMcp(q, run.run_id, {
      ...perRunDeps({ config: config354(`${serverBin} --port {port} --ws-port {ws_port} --root {worktree}`, 0), mcp: MCP_JSON }),
      freePort: async () => { const p = freePort(); resolved.push(p); return p; },
      spawn: recording(order, "server", argvs),
    });
    started.push([q, run.run_id]);
    expect("started" in out).toBe(true);
    expect(resolved).toHaveLength(2);
    const [port, ws] = resolved as [number, number];
    expect(port).not.toBe(ws);
    expect(argvs[0]!.slice(1)).toEqual(["--port", String(port), "--ws-port", String(ws), "--root", run.worktree!]);
    const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    expect(d).toMatchObject({ port, ws_port: ws });
    expect(await stopEngineMcp(q, run.run_id, "test")).toBe(true);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_STOP)!.detail).toMatchObject({ port, forwarder_port: d.forwarder_port, ws_port: ws });
  });

  test("two flagged runs on one box, `port: 0` and the forwarder per run: both start, distinct ports, neither start-failed", async () => {
    const q = newQueue();
    const a = (await flaggedRun(q)).run, b = (await flaggedRun(q)).run;
    const files = { config: config354(`${serverBin} --port {port}`, 0), mcp: MCP_JSON };
    const outA = await startEngineMcp(q, a.run_id, perRunDeps(files));
    started.push([q, a.run_id]);
    const outB = await startEngineMcp(q, b.run_id, perRunDeps(files));
    started.push([q, b.run_id]);
    expect("started" in outA && "started" in outB).toBe(true);
    const da = q.events(a.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    const db = q.events(b.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
    for (const d of [da, db]) {
      expect(typeof d.port).toBe("number");
      expect(typeof d.forwarder_port).toBe("number");
      expect(d.port).toBeGreaterThan(0);
      expect(d.forwarder_port).toBeGreaterThan(0);
      expect(d).not.toHaveProperty("ws_port");
    }
    expect(da.port).not.toBe(db.port);
    expect(da.forwarder_port).not.toBe(db.forwarder_port);
    // The forwarder on `:0` reports the port it bound: the URL carries it, and it serves behind the bearer.
    for (const [id, d] of [[a.run_id, da], [b.run_id, db]] as const) {
      const env = engineMcpEnv(id)!;
      expect(env.TK_ENGINE_MCP_URL).toBe(`http://127.0.0.1:${d.forwarder_port}/mcp`);
      expect(d.url).toBe(env.TK_ENGINE_MCP_URL);
      const ok = await fetch(env.TK_ENGINE_MCP_URL!, { method: "POST", headers: { Authorization: `Bearer ${env.TK_ENGINE_MCP_BEARER}` }, body: "{}" });
      expect(ok.status).toBe(200);
      await ok.text();
    }
    expect(await stopEngineMcp(q, a.run_id, "test")).toBe(true);
    expect(await stopEngineMcp(q, b.run_id, "test")).toBe(true);
  });

  test("a fixed port keeps its 34.5 meaning: `{port}` replaced with it, the port on the event; a busy one still pre-checks", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const fixed = freePort();
    const argvs: string[][] = [];
    let asked = 0;
    const out = await startEngineMcp(q, run.run_id, {
      ...depsFor({ config: config354(`${serverBin} --port {port}`, fixed), mcp: MCP_JSON }),
      freePort: async () => { asked++; return freePort(); }, spawn: recording([], "server", argvs),
    });
    started.push([q, run.run_id]);
    expect("started" in out).toBe(true);
    expect(asked).toBe(0); // never resolved, never ignored
    expect(argvs[0]!.slice(1)).toEqual(["--port", String(fixed)]);
    expect(q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail).toMatchObject({ port: fixed });
    await stopEngineMcp(q, run.run_id, "test");

    const squatter = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("someone else") });
    try {
      const q2 = newQueue();
      const r2 = (await flaggedRun(q2)).run;
      let spawned = 0;
      const busy = await startEngineMcp(q2, r2.run_id, {
        ...depsFor({ config: config354(`${serverBin} --port {port}`, squatter.port!), mcp: MCP_JSON }), spawn: () => { spawned++; throw new Error("never"); },
      });
      expect("refused" in busy && busy.refused).toMatchObject({ key: "engine-mcp:start-failed", reason: expect.stringContaining(`127.0.0.1:${squatter.port}: port already in use`) });
      expect(spawned).toBe(0);
    } finally { squatter.stop(true); }
  });

  test("the start is recorded before any of the children is let go (unref)", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const order: string[] = [];
    const note = q.note.bind(q);
    q.note = (id, kind, detail) => { order.push(`note:${kind}`); note(id, kind, detail); };
    const out = await startEngineMcp(q, run.run_id, {
      ...perRunDeps({ config: config354(`${serverBin} --port {port}`, 0), mcp: MCP_JSON }),
      spawn: recording(order, "server"), spawnEditor: recording(order, "editor"),
    });
    started.push([q, run.run_id]);
    expect("started" in out).toBe(true);
    expect(order).toEqual([`note:${ENGINE_MCP_START}`, "unref:server", "unref:editor"]);
    await stopEngineMcp(q, run.run_id, "test");
  });

  test("a record that throws: all three killed (forwarder, editor, server), none let go, nothing live, start-failed with the reason", async () => {
    const q = newQueue();
    const { run } = await flaggedRun(q);
    const order: string[] = [];
    const note = q.note.bind(q);
    q.note = (id, kind, detail) => { if (kind === ENGINE_MCP_START) throw new Error("database is locked"); note(id, kind, detail); };
    const deps = depsFor({ config: config354(`${serverBin} --port {port}`, 0), mcp: MCP_JSON });
    let serverPid = 0, editorPid = 0;
    const out = await startEngineMcp(q, run.run_id, {
      ...deps,
      spawn: (argv, o) => { const c = recording(order, "server")(argv, o); serverPid = c.pid; return c; },
      spawnEditor: (argv, o) => { const c = recording(order, "editor")(argv, o); editorPid = c.pid; return c; },
    });
    expect("refused" in out && out.refused).toMatchObject({
      key: "engine-mcp:start-failed", reason: "engine MCP: the start could not be recorded: database is locked",
    });
    expect(order).toEqual(["kill:editor", "kill:server"]);
    expect(engineMcpLive(run.run_id)).toBe(false);
    expect(engineMcpEnv(run.run_id)).toBeUndefined();
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
    expect(await gone(serverPid)).toBe(true);
    expect(await gone(editorPid)).toBe(true);
    // The forwarder went first: its port no longer answers.
    await expect(fetch(`http://127.0.0.1:${deps.fwd}/mcp`)).rejects.toThrow();
  });

  test("the verify-only advisory on `engine-mcp-start`: absent with the filter (`<filter>` or `<filter>=…`), named without it; never refused", async () => {
    const want = "warning: engine.mcp.start has no --exclude-domains; the verify-only rule (kb/engine-mcp-godot.md) rests on the engine skill alone; port per-run";
    expect(engineMcpAdvisory({ start: "srv --port {port}", port: 0, filter: "--exclude-domains" })).toBe(want);
    expect(engineMcpAdvisory({ start: "srv --port 8000", port: 8000, filter: "--deny" }))
      .toBe("warning: engine.mcp.start has no --deny; the verify-only rule (kb/engine-mcp-godot.md) rests on the engine skill alone; port fixed 8000 (one flagged run at a time)");
    expect(engineMcpAdvisory({ start: "srv --exclude-domains scene,node", port: 0, filter: "--exclude-domains" })).toBeNull();
    expect(engineMcpAdvisory({ start: "srv --exclude-domains=scene,node", port: 0, filter: "--exclude-domains" })).toBeNull();
    expect(engineMcpAdvisory({ start: "srv --exclude-domainsX", port: 0, filter: "--exclude-domains" })).toBe(want);
    expect(engineMcpAdvisory({ start: "srv --deny scene", port: 0, filter: "--deny" })).toBeNull();
    for (const [start, filter, advisory] of [
      [`${serverBin} --port {port}`, undefined, want],
      [`${serverBin} --port {port} --exclude-domains=scene`, undefined, undefined],
      [`${serverBin} --port {port} --deny scene`, "--deny", undefined],
    ] as const) {
      const q = newQueue();
      const { run } = await flaggedRun(q);
      const out = await startEngineMcp(q, run.run_id, perRunDeps({ config: config354(start, 0, filter), mcp: MCP_JSON }));
      started.push([q, run.run_id]);
      expect("started" in out).toBe(true);
      const d = q.events(run.run_id).find((e) => e.kind === ENGINE_MCP_START)!.detail!;
      if (advisory) expect(d.advisory).toBe(advisory);
      else expect(d).not.toHaveProperty("advisory");
      await stopEngineMcp(q, run.run_id, "test");
    }
  });

  test("start-failed resolves: `port: 0` names the per-run `{port}`, never `:0` or the port it got; a fixed port's is unchanged", async () => {
    const refusedBy = async (deps: EngineMcpDeps) => {
      const q = newQueue();
      const { run } = await flaggedRun(q);
      const out = await startEngineMcp(q, run.run_id, deps);
      expect("refused" in out && out.refused.key).toBe("engine-mcp:start-failed");
      return "refused" in out ? out.refused.resolves : "";
    };
    const noSpawn = () => { throw new Error("no spawn"); };
    const perRun = "make `engine.mcp.start` serve on 127.0.0.1:{port} (the per-run port, `port: 0`) from the run's worktree "
      + "(nothing else listening there), and TK_SUPERVISOR_BIND (a tailnet address, 100.64.0.0/10) free to bind "
      + "(a per-run port; TK_SUPERVISOR_ENGINE_MCP_PORT unset)";
    const files0 = { config: config354(`${serverBin} --port {port}`, 0), mcp: MCP_JSON };
    // before the port resolves (the bind refused), and after (the server does not spawn on the port it got)
    const before = await refusedBy({ ...perRunDeps(files0), checkBind: () => { throw new Error("no bind"); } });
    const got = freePort();
    const after = await refusedBy({ ...perRunDeps(files0), freePort: async () => got, spawn: noSpawn });
    for (const r of [before, after]) {
      expect(r).toBe(perRun);
      expect(r).not.toContain("127.0.0.1:0");
      expect(r).not.toContain(String(got));
    }
    // a fixed port with TK_SUPERVISOR_ENGINE_MCP_PORT set: today's text
    const p = freePort();
    expect(await refusedBy({ ...depsFor({ config: config354(`${serverBin} --port ${p}`, p), mcp: MCP_JSON }), spawn: noSpawn })).toBe(
      `make \`engine.mcp.start\` serve on 127.0.0.1:${p} from the run's worktree (nothing else listening there), and `
      + "TK_SUPERVISOR_BIND (a tailnet address, 100.64.0.0/10):TK_SUPERVISOR_ENGINE_MCP_PORT free to bind");
    // a fixed port with TK_SUPERVISOR_ENGINE_MCP_PORT unset: the fixed server port, the per-run forwarder
    const p2 = freePort();
    expect(await refusedBy({ ...perRunDeps({ config: config354(`${serverBin} --port ${p2}`, p2), mcp: MCP_JSON }), spawn: noSpawn })).toBe(
      `make \`engine.mcp.start\` serve on 127.0.0.1:${p2} from the run's worktree (nothing else listening there), and `
      + "TK_SUPERVISOR_BIND (a tailnet address, 100.64.0.0/10) free to bind (a per-run port; TK_SUPERVISOR_ENGINE_MCP_PORT unset)");
  });

  test("engineMcpPort: unset or blank is 0 (per run), a port is fixed, anything else throws naming the variable", () => {
    expect(engineMcpPort({})).toBe(0);
    for (const v of ["", "  ", "\t"]) expect(engineMcpPort({ TK_SUPERVISOR_ENGINE_MCP_PORT: v })).toBe(0);
    expect(engineMcpPort({ TK_SUPERVISOR_ENGINE_MCP_PORT: "8788" })).toBe(8788);
    expect(engineMcpPort({ TK_SUPERVISOR_ENGINE_MCP_PORT: " 8788 " })).toBe(8788);
    for (const v of ["abc", "0", "70000", "-1", "80.5"]) {
      expect(() => engineMcpPort({ TK_SUPERVISOR_ENGINE_MCP_PORT: v })).toThrow(/TK_SUPERVISOR_ENGINE_MCP_PORT/);
    }
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
    for (const k of ["TK_STUDIO_HOME", "SBX_BIN", "TK_SUPERVISOR_NOTIFY", "PATH"]) prev[k] = process.env[k];
    process.env.TK_STUDIO_HOME = store;
    process.env.SBX_BIN = sbx.bin;
    delete process.env.TK_SUPERVISOR_NOTIFY;
    // The project is a Godot one (the editor opens it), so Story 22.3's snapshot runs: a fake robocopy on PATH.
    const bin = tempDir("tk-sup-enginemcp-robocopy-");
    fakeBin(join(bin, process.platform === "win32" ? "robocopy.js" : "robocopy"), "process.exit(1);\n");
    process.env.PATH = [bin, process.env.PATH].filter((p) => p).join(delimiter);
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
    const { q, runId } = await drainOne({
      ".tk-studio/config.yaml": configFor(`${serverBin} --port ${port} --root {worktree}`, port), ".mcp.json": MCP_JSON, "game/project.godot": "",
    });
    // The worker's `sbx exec` got the two names by `-e`, never a value.
    const worker = sbx.calls().slice(before).find((c) => c.argv[0] === "exec" && c.argv.includes("-p"))!;
    expect(worker.argv.slice(0, worker.argv.indexOf(SB))).toEqual(expect.arrayContaining(["-e", "TK_ENGINE_MCP_URL", "TK_ENGINE_MCP_BEARER"]));
    expect(worker.argv.join(" ")).not.toContain("http://127.0.0.1");
    const ks = kinds(q, runId);
    for (const k of ["claimed", "worktree", "snapshot", ENGINE_MCP_START]) expect(ks).toContain(k);
    expect(ks.indexOf("snapshot")).toBeGreaterThan(ks.indexOf("worktree"));
    expect(ks.indexOf(ENGINE_MCP_START)).toBeGreaterThan(ks.indexOf("snapshot"));
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
    expect(await gone(d.editor_pid as number)).toBe(true);
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
