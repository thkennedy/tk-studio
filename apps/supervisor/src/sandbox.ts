/**
 * sandbox.ts — the supervisor holds the engine's sandbox, and nothing else starts a run (Story 27.2).
 *
 *   pin       `sbx run -d --name <sb>` before an sbx worker's login preflight (`invokeSkill`), so the
 *             sandbox is up and pinned for the run; recorded `pinned` (a failure: `pin-failed`, the run
 *             `blocked` naming the pin).
 *   engine    the in-VM engine pid: `<worktree>/.bmad-loop/runs/<engine id>/engine.pid` (`"<pid> <start>"`,
 *             written by bmad-loop, read-only here), else `sbx exec <sb> pgrep -a -f "bmad-loop run"`
 *             matched to the engine run id (and the worktree's VM path); neither naming exactly one pid
 *             → `engine pid: unknown` (no hold, nothing killed — a pid is never guessed).
 *   hold      one `sbx exec <sb> tail --pid=<pid> -f /dev/null` held open for the engine's life
 *             (operator-decisions §6): argv only, spawned detached and unref'd with its stdio ignored (Story 36.5,
 *             DW-109), so it outlives the process that spawned it, and it ends when the engine pid ends. Its recorded
 *             host pid + start time is the adoption rule: any later process (tick or serve) that finds it alive spawns
 *             none, so a run's `hold` events count the real restarts.
 *   kill      `sbx exec <sb> kill -TERM -- -<pid>` (the engine's process group), a bounded wait, then
 *             `kill -KILL -- -<pid>` (sent to the group even when the leader went on TERM); liveness
 *             `sbx exec <sb> cat /proc/<pid>/stat`, its start time (field 22) compared with the recorded one. A pid still alive after the wait is the
 *             `engine alive after kill` outcome — or a first probe that cannot be read, `start time
 *             unreadable` (nothing signalled) — which `workerMayRun` refuses (DW-3: held until a later
 *             probe shows the pid gone, `Queue.engineAliveAfterKill`). A leader that did not go on TERM also
 *             has its agent session killed, `sbx exec <sb> tmux kill-session -t =bmad-loop-<engine id>`
 *             (best effort; only with the engine run id known).
 *   release   `sbx stop <sb>` when a run recording the sandbox ends while a pin on it is outstanding (the
 *             ending run's own, or one an ended run left `pin-kept`), and only when no other
 *             queued/running/paused/external run — nor an ended run whose engine is alive after its kill —
 *             records the same sandbox (else `pin-kept`). Story 35.4: for a run that started an engine MCP,
 *             both events carry `engine_mcp: "stopped" | "stop pending"` (its stop at this release).
 *   restart   Story 33.3: `pinWithRestart`, the one seam both pin sites call. A sandbox `sbx ls` listed as
 *             running before the pin whose login probe says not logged in is stopped and started once
 *             (`sbx stop`, `sbx run -d --name`), probed again and recorded `pin-restart`; the caller's
 *             preflight then judges. The pin record `<studioHome>/sandboxes/<sb>.pin` is written on every
 *             pin and removed when the release stopped the sandbox (the launch check's "started outside
 *             the supervisor" warning reads its absence). Story 36.5: the episode is per sandbox across the queue
 *             (`Queue.openPinRestartOn`), and a pin prunes the VM's old `/tmp` leftovers (`pruneEngineTmp`).
 *   store     Story 36.5 (DW-113): `sbx skills ls`, else the host store folder: is a job's target skill in the
 *             shared skills store the sandboxes load (`skillInStore`)?
 *   starter   `<studioHome>/projects/<project key>/starter.lock`: JSON naming the queue as the only
 *             starter of runs on the checkout, written atomically per tick and per claim; never in the
 *             checkout's tree. Story 28.6: `serve` also rewrites every served project's lock each
 *             STARTER_LOCK_REFRESH_MS with a fresh `since` (`watchStarterLocks`) — a heartbeat, so the
 *             lock goes stale within STARTER_LOCK_STALE_S of the supervisor going down; the per-tick and
 *             per-claim writes keep the previous `since`. That liveness is what `jobrun.py submit`/`wake`
 *             judge before they refuse a hand start (`StarterLocked`).
 *
 * Every `sbx` call is argv only — never `bash`, `sh` or a `-c` string, never a pattern kill.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { ENGINE_MCP_START, ENGINE_MCP_STOP, stopEngineMcp } from "./enginemcp";
import { sbxBin, studioHome } from "./env";
import {
  checkoutKey, isTerminal, parseStatGroup, probeRecordedWorker, processStartTime, servedRoot, workerMayRun, type Queue, type QueueRun, type WorkerKill,
} from "./queue";
import { maxLoginPreflight, readProjectConfig, runProcess, toVmPath, type RunResult, type Spawner } from "./server";

type Env = Record<string, string | undefined>;

/** A hold child: its host pid (when spawned) and the promise that settles when it exits. */
export interface HoldChild { pid?: number; done: Promise<unknown> }

export interface SandboxDeps {
  /** SBX_BIN and the store (TK_STUDIO_HOME) are read from here (default `process.env`). */
  env?: Env;
  /** A bounded argv-only `sbx` call (default `runProcess`). */
  run?: (bin: string, args: string[], opts: { timeoutS: number }) => Promise<RunResult>;
  /** Spawns the long-lived hold (default `defaultHold`, detached and unref'd). */
  hold?: (bin: string, args: string[]) => HoldChild;
  /** Reads a host file; null when it cannot be read (default `readFileSync`). */
  readFile?: (path: string) => string | null;
  /** Lists a host directory; [] when it cannot be read (default `readdirSync`). */
  listDir?: (path: string) => string[];
  /** The kill's bounded wait after each signal (ms, default 10 000) and its poll interval (ms, default 250). */
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Is a recorded host hold process (pid + start) still running? (default `probeRecordedWorker`). */
  holdAlive?: (pid: number, start: string | null) => boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const bin = (deps: SandboxDeps) => sbxBin(deps.env ?? process.env);
const call = (deps: SandboxDeps, args: string[], timeoutS = 60) =>
  (deps.run ?? ((b, a, o) => runProcess(b, a, { timeoutS: o.timeoutS })))(bin(deps), args, { timeoutS });
const readHost = (deps: SandboxDeps, path: string): string | null => {
  if (deps.readFile) return deps.readFile(path);
  try { return readFileSync(path, "utf-8"); } catch { return null; }
};
const listHost = (deps: SandboxDeps, path: string): string[] => {
  if (deps.listDir) return deps.listDir(path);
  try { return readdirSync(path); } catch { return []; }
};

// ------------------------------------------------------------ argv (argv only, no shell)

export const pinArgv = (sb: string): string[] => ["run", "-d", "--name", sb];
export const releaseArgv = (sb: string): string[] => ["stop", sb];
/** Story 33.3: the sandbox listing read before the pin (is the sandbox already running?). */
export const lsArgv = (): string[] => ["ls"];
export const holdArgv = (sb: string, pid: number): string[] => ["exec", sb, "tail", `--pid=${pid}`, "-f", "/dev/null"];
export const statArgv = (sb: string, pid: number): string[] => ["exec", sb, "cat", `/proc/${pid}/stat`];
export const killArgv = (sb: string, pid: number, sig: "TERM" | "KILL"): string[] => ["exec", sb, "kill", `-${sig}`, "--", `-${pid}`];
export const pgrepArgv = (sb: string): string[] => ["exec", sb, "pgrep", "-a", "-f", "bmad-loop run"];
/** bmad-loop's agent session for an engine run (`runs.session_name`: `bmad-loop-<id>`), killed by its exact
 * name (`=`, as bmad-loop's own tmux backend targets it — never a prefix match). */
export const agentSessionArgv = (sb: string, engineRunId: string): string[] => ["exec", sb, "tmux", "kill-session", "-t", `=bmad-loop-${engineRunId}`];
/** Story 36.5 (DW-60): the day-old test and tool leftovers in the VM's `/tmp`. The globs are `find`'s inside the VM. */
export const pruneTmpArgv = (sb: string): string[] =>
  ["exec", sb, "find", "/tmp", "-maxdepth", "1", "(", "-name", "tk-sup-*", "-o", "-name", "tmp.*", ")", "-mmin", "+1440", "-exec", "rm", "-rf", "--", "{}", "+"];
/** Story 36.5 (DW-113): the shared skills store's listing. */
export const skillsLsArgv = (): string[] => ["skills", "ls"];

// ------------------------------------------------------------ the launch core's status, in the VM (hole 38)

/** `launch.py status` inside the sandbox: `uv` by name (a bare `sbx exec` already carries the VM's PATH with
 * `~/.local/bin`; where uv lives differs per provisioning), the plugin at `TK_STUDIO_ROOT`'s VM path (both
 * engine sandboxes mount the checkout at `/c/GitHub/tk-studio`), the root in VM form. Argv only, no shell. */
export const launchStatusArgv = (sb: string, vmPluginRoot: string, vmRoot: string, engineRunId: string | null): string[] =>
  ["exec", sb, "uv", "run", `${vmPluginRoot}/lib/launch.py`, "status", "--directory", vmRoot, ...(engineRunId ? ["--run-id", engineRunId] : [])];

/** Hole 38: the launch core's `status` answers where the engine lives. The host has no bmad-loop by design
 * (engines live only in Docker Sandboxes), so for an sbx run `launch.py status --directory <root>` runs inside
 * the run's sandbox through `sbx exec`; `root` is the host path of the served root (mapped with `toVmPath`).
 * Throws naming the failure (the caller counts a failed probe live). */
export async function vmLaunchStatus(sb: string, root: string, engineRunId: string | null, deps: SandboxDeps = {}): Promise<RunResult> {
  const env = deps.env ?? process.env;
  // The plugin's VM path is joined with `/` after the mapping: `join` would give the host's separators.
  return call(deps, launchStatusArgv(sb, `${toVmPath(studioRootOf(env)).replace(/\/+$/, "")}/plugins/tk-studio`, toVmPath(root), engineRunId), 120);
}

/** `TK_STUDIO_ROOT` as the sandbox reads it (`pluginRoot` without the env.ts import: sandbox.ts is imported by
 * queue.ts, which env.ts never is). */
function studioRootOf(env: Env): string {
  const root = env.TK_STUDIO_ROOT?.trim();
  if (!root) throw new Error("TK_STUDIO_ROOT is not set: the launch core cannot be located for the in-VM probe");
  return root;
}

/** The hold is bounded only by the engine pid it tails: `runProcess` takes a timeout, so the hold is given
 * the longest one a timer can carry (~24.8 days) — never a guard on the engine's life. */
export const HOLD_TIMEOUT_S = Math.floor((2 ** 31 - 1) / 1000);

// ------------------------------------------------------------ pin and release

/** `sbx run -d --name <sb>`: null when pinned, else the failure (`sbx pin failed: …`). Never throws. */
export async function pinSandbox(sb: string, deps: SandboxDeps = {}): Promise<string | null> {
  try {
    const r = await call(deps, pinArgv(sb), 120);
    return r.exit === 0 ? null : `sbx pin failed: sbx run -d --name ${sb} exited ${r.exit}: ${clip(r.stderr || r.stdout)}`;
  } catch (e) { return `sbx pin failed: sbx run -d --name ${sb}: ${clip(message(e))}`; }
}

/** The states in which a run still holds the sandbox it records. */
export const SANDBOX_HOLDING_STATES = ["queued", "running", "paused", "external"] as const;

/** Release a sandbox's pin when a run that records it ends: `sbx stop <sb>` only while a pin on that sandbox
 * is still outstanding (some run recording it pinned it — this run or an ended one whose release found
 * another holder, `pin-kept` — and no `pin-released` since), so the last holder to end stops it even when it
 * never pinned itself (a queued run cancelled before its claim, a `pin-failed` end). Never while another
 * queued/running/paused/external run records the same sandbox, nor while an ended run's engine (this one's
 * included) is still alive after its kill (DW-3) — else a `pin-kept` event naming them. Never throws;
 * answers what it did. */
/** The runs that hold sandbox `sb` besides `runId`: every other run recording it in one of `states`, plus every ended
 * run recording it whose engine is still alive after its kill (`runId`'s own included — DW-3). Story 33.3: extracted
 * from `releasePin` (its rule unchanged) so the pin's restart refuses to stop a sandbox a live run holds. */
export async function sandboxHolders(
  queue: Queue, sb: string, runId: string, states: readonly string[] = SANDBOX_HOLDING_STATES,
): Promise<string[]> {
  const sameSandbox = queue.runs().filter((r) => r.sandbox === sb);
  const holders = sameSandbox.filter((r) => r.run_id !== runId && states.includes(r.state)).map((r) => r.run_id);
  // An ended run whose kill left its engine alive still holds the sandbox while that pid runs.
  for (const r of sameSandbox.filter((x) => isTerminal(x.state))) {
    if (await queue.engineAliveAfterKill(r)) holders.push(r.run_id);
  }
  return holders;
}

export async function releasePin(queue: Queue, runId: string, deps: SandboxDeps = {}): Promise<"released" | "kept" | "failed" | "none"> {
  try {
    const run = queue.get(runId);
    if (!run || run.tier !== "sbx" || !run.sandbox) return "none";
    // Only a terminal run is ever released: never at launch return, never a running run, never a paused
    // one (a paused run keeps its pin, operator-decisions §2).
    if (!isTerminal(run.state)) return "none";
    // Story 34.5: the run's engine MCP stops at its release — also when the sandbox is kept for another holder.
    await stopEngineMcp(queue, runId, "released");
    // Story 35.4: the release events say so — only for a run that started one: `stopped` once its last start has a
    // stop after it, else `stop pending` (a later release or recovery stops it).
    const mcpEvents = queue.events(runId).filter((e) => e.kind === ENGINE_MCP_START || e.kind === ENGINE_MCP_STOP);
    const engineMcp: Record<string, unknown> = !mcpEvents.length ? {}
      : { engine_mcp: mcpEvents.at(-1)!.kind === ENGINE_MCP_STOP ? "stopped" : "stop pending" };
    const sb = run.sandbox;
    if (!queue.pinOutstanding(sb)) return "none";
    const holders = await sandboxHolders(queue, sb, runId);
    if (holders.length) {
      // Named once per run (a later release of the same run finds it kept already).
      const own = queue.events(runId).filter((e) => e.kind === "pin-kept" || e.kind === "pin-released");
      if (!own.length) queue.note(runId, "pin-kept", { sandbox: sb, held_by: holders, ...engineMcp });
      return "kept";
    }
    let stop: Record<string, unknown>;
    try {
      const r = await call(deps, releaseArgv(sb), 120);
      stop = r.exit === 0 ? { ok: true } : { ok: false, exit: r.exit, detail: clip(r.stderr || r.stdout) };
    } catch (e) { stop = { ok: false, detail: clip(message(e)) }; }
    queue.note(runId, "pin-released", { sandbox: sb, stop, ...engineMcp });
    // Story 33.3: the sandbox is stopped — the supervisor's pin record goes with it.
    if (stop.ok) removePinRecord(sb, deps.env ?? process.env);
    return stop.ok ? "released" : "failed";
  } catch { return "failed"; }
}

// ------------------------------------------------------------ Story 33.3: the pin restarts a logged-out sandbox

/** The `sbx ls` rule (`sandbox_login._listed` plus its status test): a row whose first column (SANDBOX) is `sb` exactly
 * and whose columns carry `running`. */
export function listedRunning(lsOutput: string, sb: string): boolean {
  for (const line of (lsOutput ?? "").split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] === sb) return cols.some((c) => c.toLowerCase() === "running");
  }
  return false;
}

/** Is `sb` running per `sbx ls`? A failed listing counts as not running. Never throws. */
export async function sandboxRunning(sb: string, deps: SandboxDeps = {}): Promise<boolean> {
  try {
    const r = await call(deps, lsArgv(), 60);
    return r.exit === 0 && listedRunning(r.stdout, sb);
  } catch { return false; }
}

/** One restart step (`sbx stop` or `sbx run -d --name`): null when it succeeded, else a pin failure in
 * `pinSandbox`'s words (`sbx pin failed: sbx <argv> exited <n>: …`). Never throws. */
async function restartStep(argv: string[], deps: SandboxDeps): Promise<string | null> {
  try {
    const r = await call(deps, argv, 120);
    return r.exit === 0 ? null : `sbx pin failed: sbx ${argv.join(" ")} exited ${r.exit}: ${clip(r.stderr || r.stdout)}`;
  } catch (e) { return `sbx pin failed: sbx ${argv.join(" ")}: ${clip(message(e))}`; }
}

/** The login probe's default spawner: the `sbx` the deps name (the same bin and runner as the pin). */
const probeSpawner = (deps: SandboxDeps): Spawner => (_cmd, args, o) =>
  deps.run ? deps.run(bin(deps), args, { timeoutS: o.timeoutS }) : runProcess(bin(deps), args, { timeoutS: o.timeoutS, env: o.env });

/** The states in which another run's hold on the sandbox forbids the restart (a queued run does not: the run being
 * gated is queued too). */
export const RESTART_BLOCKING_STATES = ["running", "paused", "external"] as const;

export const PIN_RESTART = "pin-restart";

/** Story 36.5 (DW-56, DW-58): the seq of the open `pin-restart` on `sb`, any run's since the sandbox's last healed
 * signal (`Queue.openPinRestartOn`), else null. */
export const openPinRestart = (queue: Queue, sb: string): number | null => queue.openPinRestartOn(sb);

export interface PinContext {
  /** The sandboxes restarted in this pass (`drainQueue`'s, shared by the pass's resumes and drained runs; else one per
   * recorder for a drive outside a drain pass). */
  restarted?: Set<string>;
  /** The login probe's spawner (default: the deps' `sbx`). */
  spawner?: Spawner;
  /** The pin record's clock (default now). */
  now?: () => Date;
  /** Story 36.5: filled by the pin: `probe_clean` when its login probe found the sandbox logged in (a running sandbox's
   * probe, or a cold pin's while a restart episode stands open on it). */
  report?: { probe_clean?: true };
}

/** Story 33.3: the pin both sites call in place of the bare `pinSandbox`. `sbx ls` first (was `sb` running before this
 * pin?), then `sbx run -d --name <sb>`. Only when it was running: probe the login (`maxLoginPreflight`, the
 * preflight's own argv) and, when it says not logged in and (c) this pass has not restarted `sb`, (d) no run's open
 * `pin-restart` stands on it since the sandbox's last healed signal (Story 36.5) and (e) no other run holds it running/paused/external nor an ended run's
 * engine is alive there, stop and start it once, probe again and record `pin-restart {sandbox, probe_before,
 * probe_after, pass_at}`. A failed stop or start is the pin's failure. Story 36.5: a cold pin never restarts, but with
 * an episode open on `sb` it probes too, so a clean answer can close that episode.
 * The pin record is written once pinned. Null when pinned, else the failure; the caller records `pinned`/`pin-failed`
 * and its preflight judges the login. Never throws. */
export async function pinWithRestart(queue: Queue, runId: string, sb: string, deps: SandboxDeps = {}, ctx: PinContext = {}): Promise<string | null> {
  const env = deps.env ?? process.env;
  const running = await sandboxRunning(sb, deps);
  const failed = await pinSandbox(sb, deps);
  if (failed) return failed;
  try {
    if (!running) {
      ctx.restarted?.add(sb); // cold-pinned in this pass: a later run in the pass does not restart it
      // Story 36.5: later pins may all be cold, so an open episode needs its healed signal here too; none open, no probe.
      if (ctx.report && openPinRestart(queue, sb) !== null
        && !(await maxLoginPreflight(ctx.spawner ?? probeSpawner(deps), { tier: "sbx", sandbox: sb }))) ctx.report.probe_clean = true;
    } else {
      const spawner = ctx.spawner ?? probeSpawner(deps);
      const probeBefore = await maxLoginPreflight(spawner, { tier: "sbx", sandbox: sb });
      const restarted = ctx.restarted ?? new Set<string>();
      if (!probeBefore && ctx.report) ctx.report.probe_clean = true;
      if (probeBefore && !restarted.has(sb) && openPinRestart(queue, sb) === null
        && !(await sandboxHolders(queue, sb, runId, RESTART_BLOCKING_STATES)).length) {
        restarted.add(sb);
        const stopFailed = await restartStep(releaseArgv(sb), deps);
        if (stopFailed) return stopFailed;
        const startFailed = await restartStep(pinArgv(sb), deps);
        if (startFailed) { removePinRecord(sb, env); return startFailed; } // stopped and not restarted: no pin stands
        const probeAfter = await maxLoginPreflight(spawner, { tier: "sbx", sandbox: sb });
        const detail = { sandbox: sb, probe_before: probeBefore, probe_after: probeAfter, pass_at: new Date().toISOString() };
        try { queue.note(runId, PIN_RESTART, detail); }
        catch { /* the run ended meanwhile: the restart stands */ }
      }
    }
  } catch { /* a probe or holder lookup that throws leaves the pin as it is: the preflight judges */ }
  writePinRecord(sb, runId, env, ctx.now);
  return null;
}

/** Story 36.5 (DW-60): after a successful pin, the day-old `tk-sup-*` and `tmp.*` in the engine sandbox's `/tmp` go, best
 * effort, unless another live run holds the sandbox. Answers the `pinned` detail's `tmp_pruned`. Never throws. */
export async function pruneEngineTmp(queue: Queue, runId: string, sb: string, deps: SandboxDeps = {}): Promise<true | string> {
  try {
    const holders = await sandboxHolders(queue, sb, runId, RESTART_BLOCKING_STATES);
    if (holders.length) return `skipped: held by ${holders.join(", ")}`;
    const r = await call(deps, pruneTmpArgv(sb), 60);
    return r.exit === 0 ? true : `error: exit ${r.exit}: ${clip(r.stderr || r.stdout, 200)}`;
  } catch (e) { return `error: ${clip(message(e), 200)}`; }
}

// ------------------------------------------------------------ Story 36.5: the shared skills store

/** The plugin folder the engine sandboxes load from the store (runbook §3.8). */
const STORE_PLUGIN = "tk-studio";
const STORE_SUBPATH = ["DockerSandboxes", "sandboxes", "state", "agent-skills"];

/** `%LOCALAPPDATA%\\DockerSandboxes\\sandboxes\\state\\agent-skills`: resolved, or as the variable (null `dir`: not readable). */
function skillsStore(env: Env): { dir: string | null; shown: string } {
  const base = env.LOCALAPPDATA?.trim();
  return base ? { dir: join(base, ...STORE_SUBPATH), shown: join(base, ...STORE_SUBPATH) } : { dir: null, shown: `%LOCALAPPDATA%\\${STORE_SUBPATH.join("\\")}` };
}

/** One name per line, each line's first whitespace-separated token (tolerant: the output is pinned to the operator's
 * capture when it lands). */
export const parseSkillsList = (out: string): string[] =>
  (out ?? "").split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0] ?? "").filter(Boolean);

export type SkillInStore =
  | { in_store: true }
  /** Neither the listing nor the store folder could answer: nothing proves the skill absent. */
  | { in_store: "unknown"; why: string }
  | { in_store: false; store: string; release: string; via: "sbx skills ls" | "store folder"; text: string };

/** Is `skill` in the shared skills store? `sbx skills ls` names it; a listing that does not (or a verb that is missing)
 * reads the host's store folder (`<skill>/`, `<plugin>/skills/<skill>/`). The release named on a refusal is the store's
 * `<plugin>/.claude-plugin/plugin.json` version, else `unknown`. Never throws. */
export async function skillInStore(skill: string, deps: SandboxDeps = {}): Promise<SkillInStore> {
  const store = skillsStore(deps.env ?? process.env);
  let listed: string[] | null = null, why = "";
  try {
    const r = await call(deps, skillsLsArgv(), 30);
    if (r.exit === 0) listed = parseSkillsList(r.stdout);
    else why = `sbx skills ls exited ${r.exit}: ${clip(r.stderr || r.stdout, 200)}`;
  } catch (e) { why = `sbx skills ls: ${clip(message(e), 200)}`; }
  if (listed?.includes(skill)) return { in_store: true };
  const entries = store.dir ? listHost(deps, store.dir) : [];
  if (entries.includes(skill)) return { in_store: true };
  const plugins = [STORE_PLUGIN, ...entries.filter((e) => e !== STORE_PLUGIN)];
  if (store.dir && plugins.some((p) => listHost(deps, join(store.dir!, p, "skills")).includes(skill))) return { in_store: true };
  if (listed === null && !entries.length) return { in_store: "unknown", why: `${why}; no store folder at ${store.shown}` };
  const via = listed === null ? "store folder" : "sbx skills ls";
  let release = "unknown";
  for (const p of store.dir ? plugins : []) {
    try {
      const version = JSON.parse(readHost(deps, join(store.dir!, p, ".claude-plugin", "plugin.json")) ?? "null")?.version;
      if (typeof version === "string" && version) { release = version; break; }
    } catch { /* an unreadable plugin.json names no release */ }
  }
  const said = listed === null ? `; read from the store folder: ${why}` : "";
  return { in_store: false, store: store.shown, release, via,
    text: `${skill} is not in the sbx skills store (${store.shown}; plugin ${release}${said}); import the release: tk-studio update, then sbx skills import --force` };
}

// ------------------------------------------------------------ Story 33.3: the supervisor's pin record

/** `<studioHome>/sandboxes/<safe sandbox>.pin`. */
export const pinRecordPath = (sb: string, env: Env = process.env): string => join(studioHome(env), "sandboxes", `${safeName(sb)}.pin`);

/** Under `bun test` (the preload's marker) with no TK_STUDIO_HOME, the record would land in the operator's real store:
 * it is not written there (tests set TK_STUDIO_HOME). */
const storeUnsafe = (env: Env): boolean => env.TK_SUPERVISOR_UNDER_TEST === "1" && !env.TK_STUDIO_HOME?.trim();

/** Write the pin record `{sandbox, since, run_id, supervisor_pid}` atomically (a temp file renamed over it). Never
 * throws: answers the path written, or the error. */
export function writePinRecord(sb: string, runId: string, env: Env = process.env, now: () => Date = () => new Date()): { path: string } | { error: string } {
  try {
    if (storeUnsafe(env)) return { error: "TK_STUDIO_HOME is not set under bun test — the pin record is not written" };
    const path = pinRecordPath(sb, env);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ sandbox: sb, since: now().toISOString(), run_id: runId, supervisor_pid: process.pid }, null, 2)}\n`, "utf-8");
    renameSync(tmp, path);
    return { path };
  } catch (e) { return { error: clip(message(e)) }; }
}

/** Remove the pin record (the sandbox was stopped). Never throws. */
export function removePinRecord(sb: string, env: Env = process.env): void {
  try {
    if (storeUnsafe(env)) return;
    rmSync(pinRecordPath(sb, env), { force: true });
  } catch { /* advisory: the launch check reads it as pinned until the next pin rewrites it */ }
}

// ------------------------------------------------------------ the engine pid

export interface EnginePid { pid: number; start: string; source: "engine.pid" | "pgrep" }
export type EnginePidLookup = EnginePid | { unknown: string };

/** `"<pid> <start>"` (bmad-loop's engine.pid): both tokens required; null otherwise. */
export function parseEnginePid(text: string | null): { pid: number; start: string } | null {
  const tokens = (text ?? "").trim().split(/\s+/);
  const pid = Number(tokens[0]);
  if (!Number.isInteger(pid) || pid <= 1 || tokens.length < 2 || !Number.isFinite(Number(tokens[1]))) return null;
  return { pid, start: tokens[1]! };
}

/** One `/proc/<pid>/stat` line: alive (not a zombie) and its start time (field 22); null when unparsable. */
export function parseProcStat(stat: string): { alive: boolean; start: string } | null {
  const g = parseStatGroup(stat);
  if (!g) return null;
  const rest = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/); // rest[0] is field 3
  const start = rest[19];
  return start !== undefined && Number.isFinite(Number(start)) ? { alive: g.state !== "Z", start } : null;
}

/** Start times compared as numbers (`125610.0` from engine.pid equals field 22's `125610`). */
export const sameStart = (a: string | null | undefined, b: string | null | undefined): boolean =>
  a != null && b != null && Number.isFinite(Number(a)) && Number(a) === Number(b);

export type ProbeResult = { alive: true; start: string } | { alive: false } | { unreadable: string };

/** `sbx exec <sb> cat /proc/<pid>/stat`: alive with its start time, gone, or unreadable (the probe failed). */
export async function probeEngine(sb: string, pid: number, deps: SandboxDeps = {}): Promise<ProbeResult> {
  let r: RunResult;
  try { r = await call(deps, statArgv(sb, pid), 30); }
  catch (e) { return { unreadable: clip(message(e)) }; }
  if (r.exit !== 0) {
    return /no such file|no such process|not found/i.test(r.stderr) ? { alive: false } : { unreadable: `exit ${r.exit}: ${clip(r.stderr || r.stdout)}` };
  }
  const parsed = parseProcStat(r.stdout);
  if (!parsed) return { unreadable: "unparsable /proc stat" };
  return parsed.alive ? { alive: true, start: parsed.start } : { alive: false };
}

/** The in-VM engine pid of a run's engine (see the header). `engineRunId` null (a trip before the launch
 * returned): the worktree's only `engine.pid`, and pgrep lines at the worktree's VM path. Never throws. */
export async function lookupEnginePid(worktree: string | null, engineRunId: string | null, sb: string, deps: SandboxDeps = {}): Promise<EnginePidLookup> {
  if (worktree) {
    const runs = join(worktree, ".bmad-loop", "runs");
    const ids = engineRunId ? [engineRunId] : listHost(deps, runs);
    const found = ids.map((id) => parseEnginePid(readHost(deps, join(runs, id, "engine.pid")))).filter((p): p is { pid: number; start: string } => !!p);
    if (found.length === 1) return { ...found[0]!, source: "engine.pid" };
  }
  let vm: string | undefined;
  try { vm = worktree ? toVmPath(worktree) : undefined; } catch { vm = undefined; }
  if (!engineRunId && !vm) return { unknown: "no engine.pid and nothing to match a pgrep line to" };
  let r: RunResult;
  try { r = await call(deps, pgrepArgv(sb), 30); }
  catch (e) { return { unknown: `no engine.pid; pgrep failed: ${clip(message(e))}` }; }
  // pgrep exits 1 when nothing matches.
  if (r.exit !== 0 && r.exit !== 1) return { unknown: `no engine.pid; pgrep exited ${r.exit}: ${clip(r.stderr || r.stdout)}` };
  const pids = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => {
    const args = l.slice(l.indexOf(" ") + 1).split(/\s+/);
    if (engineRunId) return args.some((a, i) => a === engineRunId && args[i - 1] === "--run-id");
    return args.some((a, i) => a === vm && args[i - 1] === "--project");
  }).map((l) => Number(l.split(/\s+/)[0])).filter((p) => Number.isInteger(p) && p > 1);
  if (pids.length !== 1) return { unknown: `no engine.pid; pgrep matched ${pids.length} engine processes` };
  const probe = await probeEngine(sb, pids[0]!, deps);
  if (!("alive" in probe) || !probe.alive) return { unknown: `pgrep named pid ${pids[0]}, but its start time could not be read` };
  return { pid: pids[0]!, start: probe.start, source: "pgrep" };
}

// ------------------------------------------------------------ the hold

/** The holds this process spawned, by queue run id. */
const holds = new Map<string, HoldChild>();

/** Story 36.5 (DW-109): the hold, detached and unref'd so it outlives this process; `done` settles on its `exit`. */
export function defaultHold(b: string, args: string[], spawner: typeof spawn = spawn): HoldChild {
  const child = spawner(b, args, { detached: true, stdio: "ignore", windowsHide: true });
  const done = new Promise<void>((ok) => { child.once("exit", () => ok()); child.once("error", () => ok()); });
  child.unref();
  return { pid: child.pid, done };
}

/** Spawn the hold for a run's engine (one per run in this process). Answers the hold's host pid. */
export function startHold(runId: string, sb: string, pid: number, deps: SandboxDeps = {}): HoldChild {
  const have = holds.get(runId);
  if (have) return have;
  const child = (deps.hold ?? defaultHold)(bin(deps), holdArgv(sb, pid));
  holds.set(runId, child);
  void child.done.finally(() => { if (holds.get(runId) === child) holds.delete(runId); });
  return child;
}

/** Is a hold this process spawned for `runId` still open? */
export const holding = (runId: string): boolean => holds.has(runId);

/** After `markLaunched` (an sbx launch run): the engine pid recorded on the run (or `engine pid: unknown`),
 * then the hold spawned and recorded (`hold`: the sandbox, the engine pid, the hold's host pid). Never throws. */
export async function holdEngine(queue: Queue, runId: string, deps: SandboxDeps = {}): Promise<void> {
  try {
    const run = queue.get(runId);
    if (!run || run.tier !== "sbx" || !run.sandbox) return;
    const found = await lookupEnginePid(servedRoot(run), run.engine_run_id, run.sandbox, deps);
    if ("unknown" in found) { queue.recordEnginePid(runId, null, { why: found.unknown, sandbox: run.sandbox }); return; }
    queue.recordEnginePid(runId, found, { sandbox: run.sandbox });
    spawnRecordedHold(queue, runId, run.sandbox, found.pid, deps);
  } catch (e) {
    try { queue.note(runId, "hold-failed", { error: clip(message(e)) }); } catch { /* the queue is busy */ }
  }
}

function spawnRecordedHold(queue: Queue, runId: string, sb: string, pid: number, deps: SandboxDeps, extra: Record<string, unknown> = {}): void {
  const child = startHold(runId, sb, pid, deps);
  const hostPid = child.pid;
  queue.note(runId, "hold", {
    sandbox: sb, engine_pid: pid, argv: holdArgv(sb, pid),
    ...(hostPid ? { pid: hostPid, ...(processStartTime(hostPid) ? { start: processStartTime(hostPid) } : {}) } : {}), ...extra,
  });
}

/** The restart rule for holds (`recoverQueue`): every launched or paused sbx run with a recorded engine pid
 * that still runs as recorded (its start time matched) has its hold respawned — unless a hold recorded for it
 * may still run (this process's, or another's by host pid + start time: `workerMayRun`, so only a dead or reused pid
 * counts as gone). Answers the run ids held again. */
export async function respawnHolds(queue: Queue, deps: SandboxDeps = {}): Promise<string[]> {
  const out: string[] = [];
  let runs: QueueRun[];
  try {
    runs = queue.runs().filter((r) => r.tier === "sbx" && r.sandbox && r.engine_pid != null
      && (r.state === "paused" || (r.state === "running" && queue.events(r.run_id).some((e) => e.kind === "launched"))));
  } catch { return out; }
  for (const r of runs) {
    try {
      if (holding(r.run_id)) continue;
      const last = queue.events(r.run_id).findLast((e) => e.kind === "hold")?.detail as Record<string, any> | null | undefined;
      const alive = deps.holdAlive ?? ((p: number, s: string | null) => workerMayRun(probeRecordedWorker(p, s)));
      if (typeof last?.pid === "number" && alive(last.pid, typeof last.start === "string" ? last.start : null)) continue;
      const probe = await probeEngine(r.sandbox!, r.engine_pid!, deps);
      if (!("alive" in probe) || !probe.alive || !sameStart(probe.start, r.engine_start)) continue;
      spawnRecordedHold(queue, r.run_id, r.sandbox!, r.engine_pid!, deps, { respawned: "supervisor restart" });
      out.push(r.run_id);
    } catch { /* the next recovery tries again */ }
  }
  return out;
}

// ------------------------------------------------------------ kill by pid

/** Kill the engine's process group in the VM by its recorded pid, only while that pid still runs as
 * recorded (start time matched): TERM, a bounded wait, KILL, a bounded wait. A leader gone after TERM still
 * has KILL sent once to its group (members that ignore TERM never survive a `killed`). Liveness is judged
 * by the leader's `/proc/<pid>/stat`. Never by name. A leader that did not go on TERM (KILL sent to it still
 * live) never ran its own SIGTERM teardown of the agent tmux session (outside its process group): with the
 * engine run id known, that session is then killed by its exact name (`agentSessionArgv`, best effort — a
 * non-zero exit such as "no server running" is recorded in the detail, never an error). */
export async function killEngine(sb: string, pid: number, start: string, deps: SandboxDeps = {}, engineRunId?: string | null): Promise<WorkerKill> {
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  const waitMs = deps.waitMs ?? 10_000, pollMs = deps.pollMs ?? 250;
  const first = await probeEngine(sb, pid, deps);
  if ("unreadable" in first) return { pid, start, outcome: "start time unreadable", detail: `not signalled: ${first.unreadable}` };
  if (!first.alive) return { pid, start, outcome: "not running" };
  if (!sameStart(first.start, start)) return { pid, start, outcome: "start time differs", detail: `not signalled: pid ${pid} now started ${first.start} (a reused pid)` };
  // Still the recorded engine: alive with its start time (an unreadable probe counts as alive).
  const still = async () => { const p = await probeEngine(sb, pid, deps); return !("alive" in p) || (p.alive && sameStart(p.start, start)); };
  const waitGone = async () => {
    for (const until = Date.now() + waitMs; Date.now() < until;) {
      if (!(await still())) return true;
      await sleep(pollMs);
    }
    return !(await still());
  };
  const signals: string[] = [];
  const signal = async (sig: "TERM" | "KILL", note = "") => {
    try {
      const r = await call(deps, killArgv(sb, pid, sig), 30);
      signals.push(r.exit === 0 ? `${sig}${note}` : `${sig}${note} (exit ${r.exit}: ${clip(r.stderr || r.stdout, 120)})`);
    } catch (e) { signals.push(`${sig}${note} (${clip(message(e), 120)})`); }
  };
  // The agent session, after a KILL reached a leader still live after TERM (see above).
  let session = "";
  const killSession = async () => {
    if (!engineRunId) return;
    const name = `bmad-loop-${engineRunId}`;
    try {
      const r = await call(deps, agentSessionArgv(sb, engineRunId), 30);
      session = r.exit === 0 ? `; agent session ${name} killed` : `; agent session ${name}: exit ${r.exit}: ${clip(r.stderr || r.stdout, 120)}`;
    } catch (e) { session = `; agent session ${name}: ${clip(message(e), 120)}`; }
  };
  for (const sig of ["TERM", "KILL"] as const) {
    await signal(sig);
    if (await waitGone()) {
      // The leader went on TERM: members of its group that ignore TERM may still run, so KILL reaches the
      // group once anyway (a "no such process" exit is expected: the whole group was gone).
      if (sig === "TERM") await signal("KILL", " to the group after its leader exited");
      else await killSession();
      return { pid, start, outcome: "killed", detail: `process group -${pid} in ${sb}: ${signals.join(", ")}${session}` };
    }
  }
  await killSession();
  return { pid, start, outcome: "engine alive after kill", detail: `pid ${pid} still runs in ${sb} after ${signals.join(", ")} and the wait${session}` };
}

/** Kill-by-pid for a run (a cancel, a tripped guard): its recorded engine pid, else the lookup (recorded
 * then: the pid, or `engine pid: unknown` and nothing killed). The kill and its outcome are an
 * `engine-kill` event. The engine run id (for its agent session, `killEngine`): the run's, else
 * `engineRunId` (a trip at launch return: the id the launch status block names); neither → none.
 * Undefined when the run is not an sbx run or no pid is known. Never throws. */
export async function killRunEngine(
  queue: Queue, runId: string, why: string, deps: SandboxDeps = {}, engineRunId?: string | null,
): Promise<WorkerKill | undefined> {
  try {
    const run = queue.get(runId);
    if (!run || run.tier !== "sbx" || !run.sandbox) return undefined;
    let pid = run.engine_pid, start = run.engine_start;
    if (pid == null || !start) {
      const found = await lookupEnginePid(servedRoot(run), run.engine_run_id, run.sandbox, deps);
      if ("unknown" in found) { queue.recordEnginePid(runId, null, { why: found.unknown, sandbox: run.sandbox }); return undefined; }
      queue.recordEnginePid(runId, found, { sandbox: run.sandbox });
      ({ pid, start } = found);
    }
    const kill = await killEngine(run.sandbox, pid, start, deps, run.engine_run_id ?? engineRunId ?? null);
    queue.note(runId, "engine-kill", { why, sandbox: run.sandbox, worker: kill });
    return kill;
  } catch (e) {
    try { queue.note(runId, "engine-kill", { why, error: clip(message(e)) }); } catch { /* the queue is busy */ }
    return undefined;
  }
}

// ------------------------------------------------------------ the starter lock file

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._\-]/g, "_");

/** The studio's project key for a checkout: the run's project id, else the checkout's `.tk-studio/config.yaml`
 * `project_id`, else its basename — the key the status page reads the store by (safe-named). */
export function projectKeyOf(p: { project_id: string | null; root: string }): string {
  if (p.project_id) return safeName(p.project_id);
  const pid = readProjectConfig(p.root).config.project_id;
  return safeName((typeof pid === "string" || typeof pid === "number") && String(pid) ? String(pid) : basename(p.root));
}

export const STARTER = "tk-studio-supervisor queue";

/** Story 28.6: how often `serve` rewrites the served projects' starter locks (fresh `since`). */
export const STARTER_LOCK_REFRESH_MS = 60_000;

/** `<studioHome>/projects/<project key>/starter.lock`. */
export const starterLockPath = (p: { project_id: string | null; root: string }, env: Env = process.env): string =>
  join(studioHome(env), "projects", projectKeyOf(p), "starter.lock");

/** A studio run's record directory in the store, `<studioHome>/projects/<project key>/runs/<studio run id>/`
 * (the layout the status page reads). */
export const studioRunDir = (p: { project_id: string | null; root: string }, studioRunId: string, env: Env = process.env): string =>
  join(studioHome(env), "projects", projectKeyOf(p), "runs", safeName(studioRunId));

/** Write the checkout's starter lock (atomically: a temp file renamed over it). `since` is a heartbeat, not
 * a start time: `serve`'s refresh timer (Story 28.6, `fresh`) stamps it `now()` every STARTER_LOCK_REFRESH_MS,
 * so the lock goes stale within STARTER_LOCK_STALE_S (`jobrun.py`'s 900 s) of the supervisor going down; the
 * per-tick and per-claim writes keep the previous `since` while the same supervisor process rewrites it. Refused (never written) when the path would lie in the checkout's tree. Never throws:
 * answers the path written, or the error. */
export function writeStarterLock(
  p: { project_id: string | null; root: string }, env: Env = process.env, now: () => Date = () => new Date(),
  opts: { fresh?: boolean } = {},
): { path: string } | { error: string } {
  try {
    const path = starterLockPath(p, env);
    const rel = relative(checkoutKey(p.root), checkoutKey(dirname(path)));
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return { error: `the starter lock '${path}' would lie in the checkout's tree — not written` };
    const checkout = checkoutKey(p.root);
    let since = now().toISOString();
    if (!opts.fresh) try {
      const prev = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
      if (prev?.starter === STARTER && prev.checkout === checkout && prev.supervisor_pid === process.pid && typeof prev.since === "string") since = prev.since;
    } catch { /* unreadable: rewritten */ }
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ starter: STARTER, checkout, since, supervisor_pid: process.pid }, null, 2)}\n`, "utf-8");
    renameSync(tmp, path);
    return { path };
  } catch (e) { return { error: clip(message(e)) }; }
}

/** The starter lock of every project the queue serves (a checkout with a submitted job). Never throws. */
export function writeStarterLocks(
  queue: Queue, env: Env = process.env, now: () => Date = () => new Date(), opts: { fresh?: boolean } = {},
): ({ path: string } | { error: string })[] {
  const seen = new Set<string>();
  const out: ({ path: string } | { error: string })[] = [];
  let jobs: ReturnType<Queue["jobs"]>;
  try { jobs = queue.jobs(); } catch { return out; }
  for (const j of jobs) {
    if (seen.has(j.checkout)) continue;
    seen.add(j.checkout);
    out.push(writeStarterLock({ project_id: j.project_id, root: j.root }, env, now, opts));
  }
  return out;
}
