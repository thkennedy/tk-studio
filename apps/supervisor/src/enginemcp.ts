/**
 * enginemcp.ts — one engine MCP per run, started by the pin (Story 34.5).
 *
 *   flag      a queue run whose `editor_in_the_loop` is set (the submission flag of Story 22.3, OR its job
 *             definition's). A run without it starts nothing and records nothing.
 *   config    the tracked `.tk-studio/config.yaml` at the run's `base_ref` (`git show`, `run.prefix`, as
 *             `verify.host` is read): `engine.mcp: {name, start, port}` — `name` the `.mcp.json` `mcpServers` key,
 *             `start` one command line (argv-split, no shell; `{worktree}` replaced by the run's host worktree),
 *             `port` the loopback port the server listens on (`127.0.0.1:<port>`). Optional `path`: the server's
 *             endpoint path (default `/mcp`). Story 35.4: `port: 0` is the per-run port — a free `127.0.0.1` port
 *             resolved at the pin and put in for `{port}` in `start` (a `start` without `{port}` is `no-config`: the
 *             server cannot be told its port), and a second free port for `{ws_port}` when `start` carries it. A
 *             positive `port` keeps its 34.5 meaning (pre-checked; `{port}` replaced with it when present): fixed,
 *             one flagged run at a time. Optional `filter`: the server's verify-only allowlist flag (default
 *             `--exclude-domains`), matched as the token `<filter>` or `<filter>=…` in `start`; without it the start
 *             proceeds and records an `advisory` (never refused).
 *   refusals  checked in this order, nothing started on any, the run ending `blocked` with the key in its reason: `engine-mcp:no-config` (no or a malformed
 *             `engine.mcp`), `engine-mcp:no-mcp-json` (no `.mcp.json` at the base, or no `mcpServers.<name>`),
 *             `engine-mcp:no-engine` (`GODOT` unset or naming no file), `engine-mcp:start-failed` (a forwarder
 *             bind outside the tailnet (`checkBind`, 100.64.0.0/10) or a loopback port already answering, both
 *             refused before anything is spawned; the child exits, or its port does not answer within the bound;
 *             the forwarder cannot bind — whatever was spawned is killed).
 *   start     the measured launch shape of the pick (`hi-godot/godot-ai`, `kb/engine-mcp-godot.md`), in this order:
 *             the server child runs on the host, cwd the served root (Story 35.6: `servedRoot(run)`, `<worktree>/<prefix>`,
 *             the folder whose config it read; `{worktree}` in `start` stays the worktree top), env the worker env
 *             (`buildWorkerEnv`) with `GODOT`
 *             and the launch capabilities: a per-run upstream capability in `GODOT_AI_HTTP_CAPABILITY` (32 random
 *             bytes, base64url), a per-run `GODOT_AI_WS_TOKEN` (64 hex) and `GODOT_AI_DISABLE_TELEMETRY=1`. Once its
 *             port answers, the editor child: `$GODOT --editor --path <the served root's Godot folder>` (the folder of
 *             its `project.godot`, the root or a first-level folder: none is `start-failed` before anything is
 *             spawned), cwd the served root, the same env, so its add-on adopts the running server. Then the forwarder: its own detached child process (`bun src/enginemcp.ts forward --bind <b> --port
 *             <p> --upstream <u>`), a Bun server on `TK_SUPERVISOR_BIND`:`TK_SUPERVISOR_ENGINE_MCP_PORT` (Story 35.4:
 *             unset or blank binds `:0`, the port read from its `engine-mcp-forwarder ready <port>` line; a set value
 *             keeps it fixed) that proxies to `127.0.0.1:<port>` only a request carrying `Authorization: Bearer <per-run
 *             token>` (sha256 + `timingSafeEqual`), bodies streamed both ways; anything else is 401. No JSON-RPC
 *             tool filter: the verify-only rule is the engine skill's and the server's own allowlist
 *             (`--exclude-domains` in `engine.mcp.start`). Upstream, the forwarder replaces the sandbox's bearer with
 *             the server's capability (`Authorization: Bearer <capability>`, every request). The start is recorded
 *             (`engine-mcp-start`) before anything else holds the children; a record that fails kills all three
 *             (forwarder, editor, server) and is `start-failed` (`the start could not be recorded: …`). Only then
 *             are the three children let go (unref), so they outlive the process that started them: a
 *             drain-launched run-epic run keeps its MCP after the one-shot `drain` exits (`start.ps1`'s pacer).
 *   bearer    `randomBytes(32).toString("base64url")`: in the starting process's memory (for its own sessions'
 *             `-e` env) and in the forwarder's spawn env (`TK_ENGINE_MCP_FORWARD_BEARER`) only — never an event,
 *             a log, a file or an argv value. The capability and the WebSocket token likewise: the server's and the
 *             editor's spawn env, the capability also the forwarder's (`TK_ENGINE_MCP_FORWARD_UPSTREAM_BEARER`). The sandbox gets `-e TK_ENGINE_MCP_URL -e TK_ENGINE_MCP_BEARER`,
 *             the values in the spawn env (`engineMcpEnv`).
 *   events    `engine-mcp-start {name, pid, start, url, forwarder_pid, forwarder_start, editor_pid, editor_start, port,
 *             forwarder_port, ws_port?, advisory?}` (`pid`/`start` the server child, `forwarder_*` the forwarder child,
 *             `editor_*` the editor child; each `start` the process start time, as `hold` records it; `port`,
 *             `forwarder_port` and `ws_port` the numbers in use, resolved or fixed; `advisory` the verify-only warning
 *             when `start` has no filter) and `engine-mcp-stop {name, pid, forwarder_pid, editor_pid, why, port,
 *             forwarder_port, ws_port?}` (the ports as recorded at the start; null when the start recorded none).
 *             Idempotent per run through its start event.
 *   stop      at release (`releasePin`, also on a kept pin), from any process, in this order: the forwarder, the
 *             editor, then the server (the measured stop: the editor before the server). The starting process
 *             kills its children; any other kills the recorded pids (`killRecordedWorker`, by pid and start time,
 *             never by name). The stop is recorded once all are gone. Idempotent. The release's `pin-released` /
 *             `pin-kept` name it (`engine_mcp: "stopped" | "stop pending"`, `sandbox.ts`). A child that exits on its own
 *             in the starting process takes the others with it, recorded `engine-mcp-stop {why: "exited"}`.
 *   recovery  a recorded start with no stop, not live in this process: left alone while its driver lives, or
 *             while its run is non-terminal with an engine launched (`engine_run_id`) and every recorded pid
 *             alive; otherwise (a terminal run, a lost driver, a dead server, forwarder or editor) every pid is
 *             killed and `engine-mcp-stop {why: "supervisor restarted"}` recorded once all are gone (else a later
 *             recovery retries). Never re-armed.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { connect, createServer } from "node:net";
import { load as loadYaml } from "js-yaml";
import { dirname } from "node:path";
import { apiBind, engineMcpPort } from "./env";
import { splitCommand } from "./hostverify";
import { isGodot } from "./hygiene";
import {
  isTerminal, killRecordedWorker, probeRecordedWorker, processStartTime, servedRoot, workerMayRun, type Queue, type QueueRun, type WorkerKill,
} from "./queue";
import { buildWorkerEnv, runProcess, type RunResult } from "./server";

type Env = Record<string, string | undefined>;

export const ENGINE_MCP_START = "engine-mcp-start";
export const ENGINE_MCP_STOP = "engine-mcp-stop";
/** The two names the sandbox gets by `-e` (values in the spawn env only). */
export const ENGINE_MCP_URL_ENV = "TK_ENGINE_MCP_URL";
export const ENGINE_MCP_BEARER_ENV = "TK_ENGINE_MCP_BEARER";
export const ENGINE_MCP_ENV_NAMES = [ENGINE_MCP_URL_ENV, ENGINE_MCP_BEARER_ENV] as const;
/** The forwarder child's bearer: its spawn env only (`buildWorkerEnv` strips every `TK_ENGINE_MCP_*` from a worker). */
export const FORWARD_BEARER_ENV = "TK_ENGINE_MCP_FORWARD_BEARER";
/** The server's capability the forwarder puts upstream: the forwarder child's spawn env only. */
export const FORWARD_UPSTREAM_BEARER_ENV = "TK_ENGINE_MCP_FORWARD_UPSTREAM_BEARER";
/** The pick's launch capabilities (`hi-godot/godot-ai`, the operator's spike, `kb/engine-mcp-godot.md`): the server's
 * HTTP bearer and its WebSocket token, supplied per run in the server's and the editor's spawn env (both or neither),
 * and its telemetry off (on by default). */
export const SERVER_HTTP_CAPABILITY_ENV = "GODOT_AI_HTTP_CAPABILITY";
export const SERVER_WS_TOKEN_ENV = "GODOT_AI_WS_TOKEN";
export const SERVER_TELEMETRY_OFF_ENV = "GODOT_AI_DISABLE_TELEMETRY";
/** The forwarder child's first stdout line once it is bound. */
const FORWARD_READY = "engine-mcp-forwarder ready";

const CONFIG_PATH = ".tk-studio/config.yaml";
const MCP_JSON = ".mcp.json";
/** The server's endpoint path when `engine.mcp.path` is absent. */
export const DEFAULT_ENGINE_MCP_PATH = "/mcp";
/** The server's verify-only allowlist flag when `engine.mcp.filter` is absent (Story 35.4, `kb/engine-mcp-godot.md`). */
export const DEFAULT_ENGINE_MCP_FILTER = "--exclude-domains";
/** How long the child's loopback port (and the forwarder's bind) may take to answer (ms). */
export const ENGINE_MCP_START_TIMEOUT_MS = 60_000;
/** How long a killed child may take to go (ms). */
const STOP_WAIT_MS = 5_000;

export interface EngineMcpConfig { name: string; start: string; port: number; path: string; filter: string }
export interface EngineMcpRefusal { key: string; reason: string; resolves: string }

/** A host child of the engine MCP (the server, or the forwarder). */
export interface McpChild { pid?: number; exited: Promise<unknown>; kill(): void; /** Let the starting process exit without it. */ unref?(): void }

export interface EngineMcpDeps {
  /** GODOT, TK_SUPERVISOR_BIND, TK_SUPERVISOR_ENGINE_MCP_PORT and the worker env are read from here (default `process.env`). */
  env?: Env;
  /** `git show` at the base (default `runProcess`). */
  git?: (args: string[], opts: { cwd: string; env: Env }) => Promise<RunResult>;
  /** Spawns the server child (default: node `spawn`, no shell, detached so it outlives the starting process). */
  spawn?: (argv: string[], opts: { cwd: string; env: Env }) => McpChild;
  /** Spawns the editor child (default: as `spawn`, its window shown). */
  spawnEditor?: (argv: string[], opts: { cwd: string; env: Env }) => McpChild;
  /** The forwarder bind's tailnet check (default api.ts `checkBind`, 100.64.0.0/10). Tests only may pass another,
   * to bind loopback. */
  checkBind?: (addr: string) => string;
  /** The bound on the port's first answer (ms, default 60 000) and its poll interval (ms, default 100). */
  startTimeoutMs?: number;
  pollMs?: number;
  /** The kill of a recorded pid by its start time, from any process (default `killRecordedWorker`). */
  killRecorded?: (pid: number, start: string | null) => Promise<WorkerKill>;
  /** May a recorded pid still be its process (default `probeRecordedWorker` + `workerMayRun`)? */
  recordedAlive?: (pid: number, start: string | null) => boolean;
  /** Story 35.4: a free `127.0.0.1` port for `port: 0` (and `{ws_port}`) (default `freeLoopbackPort`). */
  freePort?: () => Promise<number>;
}

interface Live {
  name: string; url: string; bearer: string;
  server: McpChild; forwarder: McpChild; editor: McpChild;
  pid: number | null; forwarderPid: number | null; editorPid: number | null;
  ports: Ports;
}

/** The ports a start uses (Story 35.4): the server's, the forwarder's, and the WebSocket one when `{ws_port}` was put in. */
interface Ports { port: number | null; forwarder_port: number | null; ws_port?: number }

/** The engine MCPs this process started, by queue run id: the handles of its three children and the bearer for this
 * process's own sessions. Another process stops them by their recorded pids. */
const live = new Map<string, Live>();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Is an engine MCP this process started for `runId` live? */
export const engineMcpLive = (runId: string): boolean => live.has(runId);

/** The sandbox env of a run with a live engine MCP this process started — `{TK_ENGINE_MCP_URL, TK_ENGINE_MCP_BEARER}` —
 * else undefined. */
export function engineMcpEnv(runId: string): Record<string, string> | undefined {
  const l = live.get(runId);
  return l ? { [ENGINE_MCP_URL_ENV]: l.url, [ENGINE_MCP_BEARER_ENV]: l.bearer } : undefined;
}

/** Tests: drop this process's handle of the run's engine MCP without stopping anything — what the starting process's
 * exit does (its children, detached, run on). */
export function letGoEngineMcp(runId: string): boolean {
  return live.delete(runId);
}

/** A refusal as the run's `blocked` reason: `<reason> (<key>; resolves: <what>)`. */
export const engineMcpRefusalText = (r: EngineMcpRefusal): string => `${r.reason} (${r.key}; resolves: ${r.resolves})`;

// ------------------------------------------------------------ the config at the base

const refusal = (key: string, reason: string, resolves: string): { refused: EngineMcpRefusal } =>
  ({ refused: { key: `engine-mcp:${key}`, reason: `engine MCP: ${reason}`, resolves } });

const NO_CONFIG_RESOLVES = "add `engine.mcp: {name, start, port}` to the project's tracked .tk-studio/config.yaml at the run's base "
  + "(or submit the run without editor_in_the_loop)";
const NO_MCP_JSON_RESOLVES = "confirm the engine MCP with `recommend.py record --mcp <name>` and commit the project's .mcp.json at the run's base";
const NO_ENGINE_RESOLVES = "set GODOT (a User environment variable) to the Godot binary on the host, then restart the supervisor";
// Story 35.4: the hint follows the configured port (`port: 0` names the per-run `{port}`, never `:0` or the port a
// run happened to get) and the forwarder's (unset TK_SUPERVISOR_ENGINE_MCP_PORT is a per-run bind).
const startFailedResolves = (configured: number, env: Env) =>
  `make \`engine.mcp.start\` serve on 127.0.0.1:${configured === 0 ? "{port} (the per-run port, `port: 0`)" : configured} `
  + "from the run's worktree (nothing else listening there), and "
  + (env.TK_SUPERVISOR_ENGINE_MCP_PORT?.trim()
    ? "TK_SUPERVISOR_BIND (a tailnet address, 100.64.0.0/10):TK_SUPERVISOR_ENGINE_MCP_PORT free to bind"
    : "TK_SUPERVISOR_BIND (a tailnet address, 100.64.0.0/10) free to bind (a per-run port; TK_SUPERVISOR_ENGINE_MCP_PORT unset)");

async function showAtBase(run: QueueRun, path: string, deps: EngineMcpDeps): Promise<{ text: string } | { missing: true } | { error: string }> {
  const env = { ...(deps.env ?? process.env), LC_ALL: "C" };
  const args = ["show", `${run.base_ref ?? ""}:${run.prefix ?? ""}${path}`];
  let res: RunResult;
  try {
    res = deps.git ? await deps.git(args, { cwd: run.root, env }) : await runProcess("git", args, { cwd: run.root, timeoutS: 60, env });
  } catch (e) { return { error: `git show: ${clip(message(e))}` }; }
  if (res.exit === 0) return { text: res.stdout };
  const err = `${res.stderr}${res.stdout}`;
  if (/does not exist|exists on disk, but not in/i.test(err)) return { missing: true };
  return { error: `git show exited ${res.exit}: ${clip(err)}` };
}

/** `engine.mcp` from a parsed config, or why it is malformed (null: absent). */
export function parseEngineMcp(config: unknown): EngineMcpConfig | { malformed: string } | null {
  const engine = config && typeof config === "object" ? (config as Record<string, unknown>).engine : undefined;
  if (!engine || typeof engine !== "object" || !("mcp" in engine)) return null;
  const mcp = (engine as Record<string, unknown>).mcp;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return { malformed: "engine.mcp is not a mapping" };
  const m = mcp as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name.trim()) return { malformed: "engine.mcp.name is not a non-empty string" };
  if (typeof m.start !== "string" || !splitCommand(m.start).length) return { malformed: "engine.mcp.start is not a non-empty command line" };
  if (typeof m.port !== "number" || !Number.isInteger(m.port) || m.port < 0 || m.port > 65535) return { malformed: "engine.mcp.port is not a port number (0 per run, or 1-65535)" };
  if (m.port === 0 && !m.start.includes("{port}")) return { malformed: "engine.mcp.start has no {port} for port: 0" };
  if (m.path !== undefined && (typeof m.path !== "string" || !m.path.startsWith("/"))) return { malformed: "engine.mcp.path does not start with /" };
  if (m.filter !== undefined && (typeof m.filter !== "string" || !m.filter.trim() || /\s/.test(m.filter.trim()))) return { malformed: "engine.mcp.filter is not one flag" };
  return {
    name: m.name.trim(), start: m.start.trim(), port: m.port, path: typeof m.path === "string" ? m.path : DEFAULT_ENGINE_MCP_PATH,
    filter: typeof m.filter === "string" ? m.filter.trim() : DEFAULT_ENGINE_MCP_FILTER,
  };
}

/** Story 35.4: the verify-only advisory — null when `start` carries the filter (the token `<filter>` or
 * `<filter>=…`), else the warning the launch row reads too. Never a refusal. */
export function engineMcpAdvisory(config: Pick<EngineMcpConfig, "start" | "port" | "filter">): string | null {
  const has = splitCommand(config.start).some((t) => t === config.filter || t.startsWith(`${config.filter}=`));
  if (has) return null;
  return `warning: engine.mcp.start has no ${config.filter}; the verify-only rule (kb/engine-mcp-godot.md) rests on the engine skill alone; `
    + `port ${config.port === 0 ? "per-run" : `fixed ${config.port} (one flagged run at a time)`}`;
}

/** The run's `engine.mcp` and `.mcp.json` entry at its base, and `GODOT` — the config, or the first refusal. */
export async function engineMcpPlan(run: QueueRun, deps: EngineMcpDeps = {}): Promise<{ config: EngineMcpConfig; godot: string } | { refused: EngineMcpRefusal }> {
  const base = run.base_ref ?? "";
  const configPath = `${run.prefix ?? ""}${CONFIG_PATH}`;
  const shown = await showAtBase(run, CONFIG_PATH, deps);
  if ("missing" in shown) return refusal("no-config", `no ${configPath} at ${base}`, NO_CONFIG_RESOLVES);
  if ("error" in shown) return refusal("no-config", `config unreadable: ${shown.error}`, NO_CONFIG_RESOLVES);
  let parsed: unknown;
  try { parsed = loadYaml(shown.text); }
  catch (e) { return refusal("no-config", `config unreadable: ${clip(message(e))}`, NO_CONFIG_RESOLVES); }
  const cfg = parseEngineMcp(parsed);
  if (!cfg) return refusal("no-config", `no engine.mcp in ${configPath} at ${base}`, NO_CONFIG_RESOLVES);
  if ("malformed" in cfg) return refusal("no-config", cfg.malformed, NO_CONFIG_RESOLVES);

  const mcpPath = `${run.prefix ?? ""}${MCP_JSON}`;
  const mcp = await showAtBase(run, MCP_JSON, deps);
  if (!("text" in mcp)) return refusal("no-mcp-json", "missing" in mcp ? `no ${mcpPath} at ${base}` : `${mcpPath} unreadable: ${mcp.error}`, NO_MCP_JSON_RESOLVES);
  let servers: unknown;
  try { servers = (JSON.parse(mcp.text) as Record<string, unknown> | null)?.mcpServers; }
  catch (e) { return refusal("no-mcp-json", `${mcpPath} is not JSON: ${clip(message(e))}`, NO_MCP_JSON_RESOLVES); }
  if (!servers || typeof servers !== "object" || !(cfg.name in (servers as Record<string, unknown>))) {
    return refusal("no-mcp-json", `${mcpPath} at ${base} has no mcpServers.${cfg.name}`, NO_MCP_JSON_RESOLVES);
  }

  const godot = (deps.env ?? process.env).GODOT?.trim();
  let isFile = false;
  try { isFile = !!godot && statSync(godot).isFile(); } catch { isFile = false; }
  if (!godot) return refusal("no-engine", "GODOT is not set", NO_ENGINE_RESOLVES);
  if (!isFile) return refusal("no-engine", `GODOT '${godot}' names no file`, NO_ENGINE_RESOLVES);
  return { config: cfg, godot };
}

// ------------------------------------------------------------ the children

/** A spawned child as an `McpChild`: its exit, a kill of its whole tree (POSIX: its process group — it is detached,
 * so it leads one; win32: `taskkill /F /T`), never by name. */
function handleOf(child: ChildProcess): McpChild {
  const exited = new Promise<unknown>((res) => { child.once("exit", res); child.once("error", res); });
  return {
    pid: child.pid, exited,
    kill: () => {
      const pid = child.pid;
      if (!pid || child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, timeout: 30_000 });
        else process.kill(-pid, "SIGKILL");
      } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    },
    unref: () => { try { child.unref(); } catch { /* gone */ } },
  };
}

/** The server child: no shell, detached on every platform (win32 included: a non-detached child dies with its
 * parent's job), so it outlives the process that started it. */
const defaultSpawn = (argv: string[], opts: { cwd: string; env: Env }): McpChild =>
  handleOf(spawn(argv[0]!, argv.slice(1), { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, stdio: "ignore", windowsHide: true, detached: true }));

/** The editor child: as the server's, its window not hidden (the Godot editor is a window on the host's session). */
const defaultEditorSpawn = (argv: string[], opts: { cwd: string; env: Env }): McpChild =>
  handleOf(spawn(argv[0]!, argv.slice(1), { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, stdio: "ignore", windowsHide: false, detached: true }));

/** The forwarder child (`bun <this file> forward …`, detached), the bearer and the upstream capability in its spawn env only. `ready`: the port
 * it reports itself bound on (`engine-mcp-forwarder ready <port>`; Story 35.4: `port` 0 binds a free one), else why not
 * (it exited, or the bound passed). */
function spawnForwarder(o: { bind: string; port: number; upstream: number; bearer: string; upstreamBearer: string; env: Env; timeoutMs: number }): McpChild & { ready: Promise<{ port: number } | { error: string }> } {
  const child = spawn(process.execPath, [import.meta.path, "forward", "--bind", o.bind, "--port", String(o.port), "--upstream", String(o.upstream)], {
    env: { ...o.env, [FORWARD_BEARER_ENV]: o.bearer, [FORWARD_UPSTREAM_BEARER_ENV]: o.upstreamBearer } as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: true,
  });
  const h = handleOf(child);
  let out = "", err = "";
  const ready = new Promise<{ port: number } | { error: string }>((res) => {
    let settled = false;
    const settle = (v: { port: number } | { error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Its pipes go: the forwarder writes nothing after it is ready, and the starting process may exit without it.
      try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* closed */ }
      res(v);
    };
    const timer = setTimeout(() => settle({ error: `the forwarder did not report itself bound within ${Math.round(o.timeoutMs / 1000)} s` }), o.timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf-8");
      const m = new RegExp(`${FORWARD_READY} (\\d+)\\r?\\n`).exec(out);
      if (!m) return;
      const bound = Number(m[1]);
      settle(Number.isInteger(bound) && bound > 0 && bound <= 65535 ? { port: bound } : { error: `the forwarder reported no port (${clip(m[0], 80)})` });
    });
    child.stderr?.on("data", (d: Buffer) => { err += d.toString("utf-8"); });
    void h.exited.then(() => settle({ error: `the forwarder exited${err.trim() ? `: ${clip(err, 200)}` : ""}` }));
  });
  return { ...h, ready };
}

/** Story 35.4: a free `127.0.0.1` port — bound at `:0`, read, released. Free at that moment only: the start's
 * `portAnswers` pre-check and `awaitPort`'s other-listener check stay the race guards. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = a && typeof a === "object" ? a.port : 0;
      srv.close(() => (port > 0 ? res(port) : rej(new Error("no port bound on 127.0.0.1:0"))));
    });
  });
}

/** Does `127.0.0.1:<port>` accept a TCP connection? */
function portAnswers(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => { s.removeAllListeners(); s.destroy(); res(ok); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.setTimeout(1000, () => done(false));
  });
}

/** Wait for the child's port, the child's exit or the bound: null when the port answered and the child still runs
 * after it, else why not. */
async function awaitPort(child: McpChild, port: number, deps: EngineMcpDeps): Promise<string | null> {
  let exited = false;
  void child.exited.then(() => { exited = true; });
  const bound = deps.startTimeoutMs ?? ENGINE_MCP_START_TIMEOUT_MS;
  const poll = deps.pollMs ?? 100;
  const deadline = Date.now() + bound;
  for (;;) {
    if (exited) return "the server exited before its port answered";
    if (await portAnswers(port)) {
      // The answer is the child's only if the child still runs after it.
      await Bun.sleep(Math.min(poll, 100));
      return exited ? `the server exited after 127.0.0.1:${port} answered (another process answers there)` : null;
    }
    if (Date.now() >= deadline) return `127.0.0.1:${port} did not answer within ${Math.round(bound / 1000)} s`;
    await Bun.sleep(poll);
  }
}

/** The forwarder's handler: a request with exactly `Authorization: Bearer <bearer>` is proxied to
 * `127.0.0.1:<upstream>` (path and query kept, the host header dropped, the bearer replaced by `Bearer
 * <upstreamBearer>` — the server's capability — or dropped without one, bodies streamed); anything else is 401.
 * Exported for the tests. */
export function forwarder(bearer: string, upstream: number, upstreamBearer?: string): (req: Request) => Promise<Response> {
  const expected = createHash("sha256").update(`Bearer ${bearer}`).digest();
  return async (req) => {
    const got = createHash("sha256").update(req.headers.get("authorization") ?? "").digest();
    if (!timingSafeEqual(got, expected)) return new Response("unauthorized\n", { status: 401, headers: { "content-type": "text/plain" } });
    const u = new URL(req.url);
    const headers = new Headers(req.headers);
    headers.delete("authorization");
    headers.delete("host");
    if (upstreamBearer) headers.set("authorization", `Bearer ${upstreamBearer}`);
    try {
      const init: RequestInit & { duplex?: string; decompress?: boolean } = {
        method: req.method, headers, redirect: "manual", decompress: false,
        ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: req.body, duplex: "half" }),
      };
      const res = await fetch(`http://127.0.0.1:${upstream}${u.pathname}${u.search}`, init);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      return new Response(`engine MCP unreachable: ${clip(message(e), 120)}\n`, { status: 502, headers: { "content-type": "text/plain" } });
    }
  };
}

/** The forwarder child's entry (`forward --bind <b> --port <p> --upstream <u>`, the bearer in `TK_ENGINE_MCP_FORWARD_BEARER`,
 * the server's capability in `TK_ENGINE_MCP_FORWARD_UPSTREAM_BEARER`):
 * binds, reports `engine-mcp-forwarder ready <port>` on stdout, and serves until it is killed. Answers an exit code
 * when it cannot start. */
export function forwardMain(argv: string[]): number | null {
  const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const bearer = process.env[FORWARD_BEARER_ENV];
  const upstreamBearer = process.env[FORWARD_UPSTREAM_BEARER_ENV] || undefined;
  delete process.env[FORWARD_BEARER_ENV];
  delete process.env[FORWARD_UPSTREAM_BEARER_ENV];
  const bind = flag("--bind"), port = Number(flag("--port")), upstream = Number(flag("--upstream"));
  if (!bearer || !bind || !Number.isInteger(port) || !Number.isInteger(upstream) || port < 0 || port > 65535 || upstream < 1) {
    console.error(`forward: needs --bind, --port, --upstream and ${FORWARD_BEARER_ENV}`);
    return 2;
  }
  let server: { port?: number };
  try { server = Bun.serve({ hostname: bind, port, idleTimeout: 0, fetch: forwarder(bearer, upstream, upstreamBearer) }); }
  catch (e) { console.error(`could not bind ${bind}:${port}: ${clip(message(e))}`); return 3; }
  process.stdout.write(`${FORWARD_READY} ${server.port ?? port}\n`);
  return null;
}

// ------------------------------------------------------------ start, stop, recovery

export type EngineMcpStart = { started: true; url: string } | { live: true; url: string } | { skipped: string } | { refused: EngineMcpRefusal };

/** Kill a child and wait (bounded) for it to go. */
async function killAndWait(c: McpChild): Promise<void> {
  try { c.kill(); } catch { /* gone */ }
  await Promise.race([c.exited, Bun.sleep(STOP_WAIT_MS)]);
}

/** The `engine-mcp-stop` detail (Story 35.4: the ports as the start recorded them). */
const stopDetail = (name: string | null, pid: number | null, forwarderPid: number | null, editorPid: number | null, why: string, ports: Ports, extra: Record<string, unknown> = {}) =>
  ({ name, pid, forwarder_pid: forwarderPid, editor_pid: editorPid, why, ...ports, ...extra });

/** Stop the children in the measured order: the forwarder (no new request), the editor, then the server. */
async function killInOrder(c: { forwarder: McpChild; editor: McpChild; server: McpChild }): Promise<void> {
  await killAndWait(c.forwarder);
  await killAndWait(c.editor);
  await killAndWait(c.server);
}

/** Start the run's engine MCP once (see the header): nothing for a run without the flag (`skipped`), the live one
 * again for a run this process already started, nothing for a run whose start is recorded but not live here (never
 * re-armed); else the refusal or the start, recorded `engine-mcp-start`. Never throws. */
export async function startEngineMcp(queue: Queue, runId: string, deps: EngineMcpDeps = {}): Promise<EngineMcpStart> {
  let run: QueueRun | null;
  try { run = queue.get(runId); } catch (e) { return { skipped: `run unreadable: ${clip(message(e))}` }; }
  if (!run || !run.editor_in_the_loop) return { skipped: "not an editor-in-the-loop run" };
  const have = live.get(runId);
  if (have) return { live: true, url: have.url };
  if (queue.events(runId).some((e) => e.kind === ENGINE_MCP_START)) return { skipped: "engine MCP already started for this run (never re-armed)" };
  const plan = await engineMcpPlan(run, deps);
  if ("refused" in plan) return plan;
  const { config } = plan;
  // Story 35.4: the server's port — fixed (`port` > 0), or resolved below for `port: 0`.
  let serverPort = config.port;
  const failed = (why: string) => refusal("start-failed", why, startFailedResolves(config.port, deps.env ?? process.env));
  const worktree = run.worktree;
  if (!worktree || !existsSync(worktree)) return failed("the run has no worktree to start the server in");
  // Story 35.6 (hole 92): the server starts in the folder whose config it read (`run.prefix`): the served root.
  const served = servedRoot(run)!;
  const projectGodot = isGodot(served);
  if (!projectGodot) return failed("the served root holds no project.godot (its root or a first-level folder) to open the editor on");
  const env = deps.env ?? process.env;
  // The forwarder binds the tailnet address only — refused before anything is spawned.
  let bind: string, port: number;
  try { bind = apiBind(env); } catch (e) { return failed(`no forwarder bind: ${clip(message(e))}`); }
  try { bind = (deps.checkBind ?? (await import("./api")).checkBind)(bind); }
  catch (e) { return failed(`the forwarder bind '${bind}' is refused: ${clip(message(e))}`); }
  // The forwarder's port: a set TK_SUPERVISOR_ENGINE_MCP_PORT keeps it fixed; unset is 0, a per-run bind.
  try { port = engineMcpPort(env); } catch (e) { return failed(clip(message(e))); }
  // Story 35.4: `port: 0` resolves a free loopback port (and `{ws_port}` a second one when `start` carries it).
  const free = deps.freePort ?? freeLoopbackPort;
  let wsPort: number | undefined;
  try {
    if (serverPort === 0) serverPort = await free();
    if (config.start.includes("{ws_port}")) {
      for (let i = 0; i < 5 && (wsPort === undefined || wsPort === serverPort); i++) wsPort = await free();
      if (wsPort === serverPort) return failed(`no free 127.0.0.1 port for {ws_port} apart from ${serverPort}`);
    }
  } catch (e) { return failed(`no free 127.0.0.1 port: ${clip(message(e))}`); }
  // A port already answering would pass for the server's: refused before the server is spawned.
  if (await portAnswers(serverPort)) return failed(`127.0.0.1:${serverPort}: port already in use before the server started`);
  const argv = splitCommand(config.start).map((a) => {
    let v = a.split("{worktree}").join(worktree).split("{port}").join(String(serverPort));
    if (wsPort !== undefined) v = v.split("{ws_port}").join(String(wsPort));
    return v;
  });
  const advisory = engineMcpAdvisory(config);
  const workerEnv = buildWorkerEnv(env, () => ({}));
  // The launch capabilities, per run: the server's HTTP bearer (the forwarder's upstream) and its WebSocket token.
  const capability = randomBytes(32).toString("base64url");
  const childEnv: Env = {
    ...workerEnv, GODOT: plan.godot,
    [SERVER_HTTP_CAPABILITY_ENV]: capability, [SERVER_WS_TOKEN_ENV]: randomBytes(32).toString("hex"), [SERVER_TELEMETRY_OFF_ENV]: "1",
  };
  let server: McpChild;
  try { server = (deps.spawn ?? defaultSpawn)(argv, { cwd: served, env: childEnv }); }
  catch (e) { return failed(`the server did not spawn: ${clip(message(e))}`); }
  const waited = await awaitPort(server, serverPort, deps);
  if (waited) { await killAndWait(server); return failed(waited); }
  // The editor on the project: its add-on adopts the running server.
  let editor: McpChild;
  try { editor = (deps.spawnEditor ?? defaultEditorSpawn)([plan.godot, "--editor", "--path", dirname(projectGodot)], { cwd: served, env: childEnv }); }
  catch (e) { await killAndWait(server); return failed(`the editor did not spawn: ${clip(message(e))}`); }
  if (!editor.pid) { await killAndWait(editor); await killAndWait(server); return failed("the editor did not spawn"); }
  // An editor that exits before the forwarder is ready leaves no MCP: tracked so the start refuses instead.
  let editorExited = false;
  void editor.exited.then(() => { editorExited = true; });
  const bearer = randomBytes(32).toString("base64url");
  let fwd: McpChild & { ready: Promise<{ port: number } | { error: string }> };
  try {
    fwd = spawnForwarder({ bind, port, upstream: serverPort, bearer, upstreamBearer: capability, env: workerEnv, timeoutMs: deps.startTimeoutMs ?? ENGINE_MCP_START_TIMEOUT_MS });
  } catch (e) { await killAndWait(editor); await killAndWait(server); return failed(`the forwarder did not spawn: ${clip(message(e))}`); }
  const ready = await fwd.ready;
  if ("error" in ready) {
    await killInOrder({ forwarder: fwd, editor, server });
    return failed(`the forwarder could not bind ${port ? `${bind}:${port}` : `${bind} (per-run port)`}: ${ready.error}`);
  }
  if (editorExited) {
    await killInOrder({ forwarder: fwd, editor, server });
    return failed("the editor exited before the MCP was ready");
  }
  // The forwarder's real port (the one it bound: a set port, or the free one `:0` gave it).
  const forwarderPort = ready.port;
  const url = `http://${bind}:${forwarderPort}${config.path}`;
  const ports: Ports = { port: serverPort, forwarder_port: forwarderPort, ...(wsPort !== undefined ? { ws_port: wsPort } : {}) };
  const pid = server.pid ?? null, forwarderPid = fwd.pid ?? null, editorPid = editor.pid ?? null;
  const start = pid ? processStartTime(pid) : null;
  const forwarderStart = forwarderPid ? processStartTime(forwarderPid) : null;
  const editorStart = editorPid ? processStartTime(editorPid) : null;
  // Story 35.4: recorded before anything lets go of the children — a start the queue does not hold would be orphans.
  try {
    queue.note(runId, ENGINE_MCP_START, {
      name: config.name, pid, start, url, forwarder_pid: forwarderPid, forwarder_start: forwarderStart, editor_pid: editorPid, editor_start: editorStart,
      ...ports, ...(advisory ? { advisory } : {}),
    });
  } catch (e) {
    await killInOrder({ forwarder: fwd, editor, server });
    return failed(`the start could not be recorded: ${clip(message(e))}`);
  }
  // All three run on without this process (a drain exits; the run's release, from any process, stops them by pid).
  server.unref?.();
  editor.unref?.();
  fwd.unref?.();
  const entry: Live = { name: config.name, url, bearer, server, forwarder: fwd, editor, pid, forwarderPid, editorPid, ports };
  live.set(runId, entry);
  // One of the three ended on its own: the others go with it, and the stop is recorded (no dead URL handed out).
  const onExit = (which: "server" | "forwarder" | "editor") => async () => {
    if (live.get(runId) !== entry) return; // stopped, or let go
    live.delete(runId);
    await killInOrder(entry);
    try { queue.note(runId, ENGINE_MCP_STOP, stopDetail(config.name, pid, forwarderPid, editorPid, "exited", ports, { exited: which })); }
    catch { /* the queue is busy, or the run ended: recovery stops what is left */ }
  };
  void server.exited.then(onExit("server"));
  void fwd.exited.then(onExit("forwarder"));
  void editor.exited.then(onExit("editor"));
  return { started: true, url };
}

/** The run's recorded engine MCP start with no stop after it, else null. */
function openStart(queue: Queue, runId: string): {
  name: string | null; pid: number | null; start: string | null; forwarderPid: number | null; forwarderStart: string | null;
  editorPid: number | null; editorStart: string | null; ports: Ports;
} | null {
  const last = queue.events(runId).filter((e) => e.kind === ENGINE_MCP_START || e.kind === ENGINE_MCP_STOP).at(-1);
  if (!last || last.kind !== ENGINE_MCP_START) return null;
  const d = (last.detail ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    name: str(d.name), pid: num(d.pid), start: str(d.start), forwarderPid: num(d.forwarder_pid), forwarderStart: str(d.forwarder_start),
    editorPid: num(d.editor_pid), editorStart: str(d.editor_start),
    ports: { port: num(d.port), forwarder_port: num(d.forwarder_port), ...(num(d.ws_port) ? { ws_port: num(d.ws_port)! } : {}) },
  };
}

/** Is a kill's answer "that process is gone" (killed, not running, or its pid now another process's)? */
const gone = (w: WorkerKill) => w.outcome === "killed" || w.outcome === "group killed" || w.outcome === "not running" || w.outcome === "start time differs";

/** Kill the recorded pids from any process, in the measured order (the editor before the server, the forwarder
 * last: a record without an editor keeps the server-then-forwarder order): true once all are gone. */
async function stopRecorded(rec: NonNullable<ReturnType<typeof openStart>>, deps: EngineMcpDeps): Promise<boolean> {
  const kill = deps.killRecorded ?? killRecordedWorker;
  let ok = true;
  for (const [pid, start] of [[rec.editorPid, rec.editorStart], [rec.pid, rec.start], [rec.forwarderPid, rec.forwarderStart]] as const) {
    if (!pid) continue;
    try { if (!gone(await kill(pid, start))) ok = false; } catch { ok = false; }
  }
  return ok;
}

/** Stop the run's engine MCP, from any process: the one this process started through its handles, else the recorded
 * one by its pids (`killRecordedWorker`); `engine-mcp-stop` recorded once all are gone. Idempotent (nothing
 * started, or already stopped: nothing done). Answers whether it recorded the stop. Never throws. */
export async function stopEngineMcp(queue: Queue, runId: string, why: string, deps: EngineMcpDeps = {}): Promise<boolean> {
  const l = live.get(runId);
  if (l) {
    live.delete(runId);
    await killInOrder(l);
    try { queue.note(runId, ENGINE_MCP_STOP, stopDetail(l.name, l.pid, l.forwarderPid, l.editorPid, why, l.ports)); } catch { return false; }
    return true;
  }
  let rec: ReturnType<typeof openStart>;
  try { rec = openStart(queue, runId); } catch { return false; }
  if (!rec) return false;
  if (!(await stopRecorded(rec, deps))) return false; // a later release or recovery tries again
  try { queue.note(runId, ENGINE_MCP_STOP, stopDetail(rec.name, rec.pid, rec.forwarderPid, rec.editorPid, why, rec.ports)); } catch { return false; }
  return true;
}

/** The restart rule (see the header): every recorded engine MCP start with no stop, not live in this process, is
 * left alone while its driver lives or while its run is non-terminal with an engine launched and every recorded pid
 * alive; else every pid is killed and `engine-mcp-stop {why: "supervisor restarted"}` recorded once all are gone.
 * Never re-armed. Answers the run ids stopped. Never throws. */
export async function recoverEngineMcps(queue: Queue, deps: EngineMcpDeps = {}): Promise<string[]> {
  const out: string[] = [];
  const alive = deps.recordedAlive ?? ((pid: number, start: string | null) => workerMayRun(probeRecordedWorker(pid, start)));
  let runs: QueueRun[];
  try { runs = queue.runs(); } catch { return out; }
  for (const r of runs) {
    try {
      if (live.has(r.run_id)) continue;
      const rec = openStart(queue, r.run_id);
      if (!rec) continue;
      if (!isTerminal(r.state)) {
        if (queue.ownerAlive(r)) continue; // its driver (another process) still holds it
        // A launched engine runs on after its driver let go (`markLaunched`): its MCP stays while all three recorded pids (server, forwarder, editor) live.
        if (r.engine_run_id && rec.pid && rec.forwarderPid && alive(rec.pid, rec.start) && alive(rec.forwarderPid, rec.forwarderStart)
          && (!rec.editorPid || alive(rec.editorPid, rec.editorStart))) continue;
      }
      if (!(await stopRecorded(rec, deps))) continue; // not gone yet: the next recovery tries again
      queue.note(r.run_id, ENGINE_MCP_STOP, stopDetail(rec.name, rec.pid, rec.forwarderPid, rec.editorPid, "supervisor restarted", rec.ports));
      out.push(r.run_id);
    } catch { /* the next recovery tries again */ }
  }
  return out;
}

if (import.meta.main && process.argv[2] === "forward") {
  const code = forwardMain(process.argv.slice(3));
  if (code !== null) process.exit(code);
}
