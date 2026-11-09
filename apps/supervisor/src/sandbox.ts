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
 *   login     Story 39.2: the sandbox's Claude login has a clock and a renewal. The read (`readSandboxLogin`): `sbx ls`
 *             (a sandbox not listed running is never exec'd into: `unknown`, `sandbox stopped`, the last
 *             `sandbox-login-check`'s values), the Max-login preflight's own probe judged by `judgeAuthStatus`, and one
 *             `sbx exec <sb> cat /home/agent/.claude/.credentials.json` of which only `claudeAiOauth.expiresAt` and
 *             `refreshTokenExpiresAt` survive (parsed in memory; the stdout is never clipped anywhere). The renewal
 *             (`startSandboxLogin`, `sendSandboxLoginCode`): a per-sandbox `sandbox-login` lease (a service event, ten
 *             minutes), then `claude auth login --claudeai` in the detached tmux session `tk-login-<id>`, its pane read
 *             until the sign-in URL shows; the code goes in by `sbx exec -i <sb> tmux load-buffer -b tk-login-<id> -`
 *             (stdin, never an argument), `paste-buffer -d` and `send-keys Enter`, and the outcome is the pane's
 *             `#{pane_dead} #{pane_dead_status}`. The login's state is the lease plus the session name, never memory.
 *             While the lease is live the claim gate claims no run on the sandbox, the pin never restarts it and the
 *             release keeps it; the drain closes a stale lease `expired` (`expireSandboxLogins`). The sign-in URL is
 *             answered by the start route and by a first refusal's `CodeRefused {…, url}` (the respawned sign-in) only,
 *             never written to an event, a refusal's last_line, a pane line or a log.
 *
 * Every `sbx` call is argv only — never `bash`, `sh` or a `-c` string, never a pattern kill.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { ENGINE_MCP_START, ENGINE_MCP_STOP } from "./enginemcp-kinds";
import { sbxBin, studioHome } from "./env";
import type { SupervisorConfig } from "./config";
import {
  checkoutKey, heldEngine, isTerminal, parseStatGroup, probeRecordedWorker, processStartTime, servedRoot, workerMayRun, type Queue, type QueueRun, type SandboxLoginLease, type WorkerKill,
} from "./queue";
import { buildWorkerEnv, judgeAuthStatus, maxLoginPreflight, readProjectConfig, runProcess, toVmPath, type RunResult, type Spawner } from "./server";

type Env = Record<string, string | undefined>;

/** A hold child: its host pid (when spawned) and the promise that settles when it exits. */
export interface HoldChild { pid?: number; done: Promise<unknown> }

export interface SandboxDeps {
  /** SBX_BIN and the store (TK_STUDIO_HOME) are read from here (default `process.env`). */
  env?: Env;
  /** A bounded argv-only `sbx` call (default `runProcess`). Story 39.2: `input`, when given, is written to the call's
   * stdin (the login code's only path into the sandbox: `sbx exec -i <sb> tmux load-buffer -b <S> -`). */
  run?: (bin: string, args: string[], opts: { timeoutS: number; input?: string }) => Promise<RunResult>;
  /** Spawns the long-lived hold (default `defaultHold`, detached and unref'd). */
  hold?: (bin: string, args: string[]) => HoldChild;
  /** Story 36.7 (DW-85): the run's engine MCP stop at release, injected where the deps are built (`enginemcp.ts`'s
   * `stopEngineMcp`; `cli.ts sbxDeps`, `worktree.ts sbxOf`), so this module never imports the engine MCP. */
  stopEngineMcp?: (queue: Queue, runId: string, why: string) => Promise<boolean>;
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
const call = (deps: SandboxDeps, args: string[], timeoutS = 60, input?: string) =>
  (deps.run ?? ((b, a, o) => runProcess(b, a, { timeoutS: o.timeoutS, ...(o.input !== undefined ? { input: o.input } : {}) })))(
    bin(deps), args, { timeoutS, ...(input !== undefined ? { input } : {}) });
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
 * included) is still alive after its kill (DW-3) — else a `pin-kept` event naming them, once per pin episode (DW-69:
 * once since the run's latest `pinned`, so a host-leg re-run's fresh pin on an ended run reports its own `pin-kept`;
 * a run with no `pinned` counts all its events). Never throws; answers what it did. */
/** The runs that hold sandbox `sb` besides `runId`: every other run recording it in one of `states`, plus every ended
 * run recording it whose engine is still alive after its kill (`runId`'s own included — DW-3). Story 33.3: extracted
 * from `releasePin` (its rule unchanged) so the pin's restart refuses to stop a sandbox a live run holds. Story 38.3
 * (B1): and every other ended run whose engine is held (`heldEngine`: an unanswered stop's `blocked` end, until its
 * `engine-released`), so another run's release never stops the sandbox under it. */
export async function sandboxHolders(
  queue: Queue, sb: string, runId: string, states: readonly string[] = SANDBOX_HOLDING_STATES,
): Promise<string[]> {
  const sameSandbox = queue.runs().filter((r) => r.sandbox === sb);
  const holders = sameSandbox.filter((r) => r.run_id !== runId && states.includes(r.state)).map((r) => r.run_id);
  // An ended run whose kill left its engine alive still holds the sandbox while that pid runs.
  for (const r of sameSandbox.filter((x) => isTerminal(x.state))) {
    if ((r.run_id !== runId && heldEngine(queue.events(r.run_id))) || await queue.engineAliveAfterKill(r)) holders.push(r.run_id);
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
    await deps.stopEngineMcp?.(queue, runId, "released");
    // Story 35.4: the release events say so — only for a run that started one: `stopped` once its last start has a
    // stop after it, else `stop pending` (a later release or recovery stops it).
    const mcpEvents = queue.events(runId).filter((e) => e.kind === ENGINE_MCP_START || e.kind === ENGINE_MCP_STOP);
    const engineMcp: Record<string, unknown> = !mcpEvents.length ? {}
      : { engine_mcp: mcpEvents.at(-1)!.kind === ENGINE_MCP_STOP ? "stopped" : "stop pending" };
    const sb = run.sandbox;
    if (!queue.pinOutstanding(sb)) return "none";
    const holders = await sandboxHolders(queue, sb, runId);
    // Story 39.2: a live `sandbox-login` lease keeps the sandbox up (`sbx stop` would kill the tmux login).
    const lease = queue.openSandboxLogin(sb);
    if (lease) holders.push(`sandbox-login:${lease.login_id}`);
    if (holders.length) {
      // Named once per pin episode (a later release after the same pin finds it kept already). DW-69: only events
      // after the run's latest `pinned` count (none: all of them), so a re-run's fresh pin names its own `pin-kept`.
      const events = queue.events(runId);
      const since = events.findLastIndex((e) => e.kind === "pinned");
      const own = events.slice(since + 1).filter((e) => e.kind === "pin-kept" || e.kind === "pin-released");
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
      // Story 39.2: a live `sandbox-login` lease on `sb` forbids the restart (it would kill the tmux login): a plain pin.
      if (probeBefore && !restarted.has(sb) && openPinRestart(queue, sb) === null && queue.openSandboxLogin(sb) === null
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

/** Story 38.6 (DW-183): `sbx skills ls`'s header line (the 2026-11-06 capture: `SKILL       STORE`). */
const SKILLS_LS_HEADER = /^SKILL\s+STORE\b/;

/** The store's top-level entries `sbx skills ls` names: the header dropped, then each non-empty line's first
 * whitespace-separated token. Pinned to the 2026-11-06 capture (`SKILL  STORE`, then `synced <path>` and
 * `tk-studio <path>`): the listing names the store's entries (the `tk-studio` plugin folder), not skills. */
export const parseSkillsList = (out: string): string[] =>
  (out ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !SKILLS_LS_HEADER.test(l)).map((l) => l.split(/\s+/)[0] ?? "").filter(Boolean);

export type SkillInStore =
  | { in_store: true }
  /** Neither the listing nor the store folder could answer: nothing proves the skill absent. */
  | { in_store: "unknown"; why: string }
  | { in_store: false; store: string; release: string; via: "sbx skills ls" | "store folder"; text: string };

/** Is `skill` in the shared skills store? Story 38.6 (DW-183), in this order: the host's store folder walk is the skill
 * check (`<skill>/`, `<plugin>/skills/<skill>/` → in the store); `sbx skills ls` is the plugin-folder check (a listing
 * that answered without `tk-studio` → absent, `via: "sbx skills ls"`); a readable store folder whose walk lacks the
 * skill → absent, `via: "store folder"`; a listing naming `tk-studio` with no readable store folder, or neither
 * source → `unknown`. The listing never answers `true` alone (a plugin named like a skill). The release named on a
 * refusal is the store's `<plugin>/.claude-plugin/plugin.json` version, else `unknown`. Never throws. */
export async function skillInStore(skill: string, deps: SandboxDeps = {}): Promise<SkillInStore> {
  const store = skillsStore(deps.env ?? process.env);
  let listed: string[] | null = null, why = "";
  try {
    const r = await call(deps, skillsLsArgv(), 30);
    if (r.exit === 0) listed = parseSkillsList(r.stdout);
    else why = `sbx skills ls exited ${r.exit}: ${clip(r.stderr || r.stdout, 200)}`;
  } catch (e) { why = `sbx skills ls: ${clip(message(e), 200)}`; }
  const entries = store.dir ? listHost(deps, store.dir) : [];
  if (entries.includes(skill)) return { in_store: true };
  const plugins = [STORE_PLUGIN, ...entries.filter((e) => e !== STORE_PLUGIN)];
  if (store.dir && plugins.some((p) => listHost(deps, join(store.dir!, p, "skills")).includes(skill))) return { in_store: true };
  const noPlugin = listed !== null && !listed.includes(STORE_PLUGIN);
  if (!noPlugin && !entries.length) {
    if (listed !== null) return { in_store: "unknown", why: `the listing names the ${STORE_PLUGIN} plugin folder, not skills; no store folder at ${store.shown}` };
    return { in_store: "unknown", why: `${why}; no store folder at ${store.shown}` };
  }
  const via = noPlugin ? "sbx skills ls" : "store folder";
  let release = "unknown";
  for (const p of store.dir ? plugins : []) {
    try {
      const version = JSON.parse(readHost(deps, join(store.dir!, p, ".claude-plugin", "plugin.json")) ?? "null")?.version;
      if (typeof version === "string" && version) { release = version; break; }
    } catch { /* an unreadable plugin.json names no release */ }
  }
  const said = noPlugin ? `; the listing names no ${STORE_PLUGIN} plugin folder`
    : `; read from the store folder: ${listed === null ? why : `the listing names the ${STORE_PLUGIN} plugin folder, not skills`}`;
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

// ------------------------------------------------------------ Story 39.2: the sandbox login's clock and renewal

/** The sandbox's credential file (a string constant: a VM path, never a host `join`). */
export const SANDBOX_CREDENTIALS = "/home/agent/.claude/.credentials.json";
/** Claude Code's own warning window: three days or fewer is `expiring`. */
export const LOGIN_WARN_MS = 3 * 86_400_000;
/** The `sandbox-login` lease's life (ten minutes). */
export const LOGIN_LEASE_S = 600;
/** A login id: 6 random bytes in hex. */
export const LOGIN_ID_RE = /^[0-9a-f]{12}$/;
/** A sandbox name the routes accept. */
export const SANDBOX_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
/** The sign-in URL in a pane: the AC's `claude.ai/oauth/authorize` and the installed binary's `claude.com/cai` base. */
export const SIGN_IN_URL_RE = /https:\/\/(?:claude\.ai|claude\.com\/cai)\/oauth\/authorize\?[^\s"'<>]+/g;
/** The CLI's `code#state` line, trimmed. */
export const LOGIN_CODE_RE = /^[A-Za-z0-9._~-]{1,256}#[A-Za-z0-9._~-]{1,256}$/;
/** The service event the Task pass records per sandbox (`hygiene.ts sandboxLoginPass`); the stopped read's last values. */
export const SANDBOX_LOGIN_CHECK = "sandbox-login-check";

export type LoginState = "ok" | "expiring" | "expired" | "unknown";

/** GET /sandbox/login's answer: exactly these keys (`reason` only on `unknown`). No token, email, org or URL. */
export interface SandboxLoginReading {
  ok: true; sandbox: string; logged_in: boolean | null; auth_method: string | null; subscription_type: string | null;
  access_expires_at: string | null; refresh_expires_at: string | null; days_left: number | null; state: LoginState;
  checked_at: string; reason?: string;
}

/** The distinct `jobs.*.sandbox` of the supervisor config, in config order; `project` narrows them to the
 * `jobs."<project>/…"` entries (the project's placement). */
export function configuredSandboxes(cfg: SupervisorConfig, project?: string): string[] {
  const out: string[] = [];
  for (const [key, opts] of Object.entries(cfg.jobs)) {
    if (project !== undefined && key.slice(0, key.lastIndexOf("/")) !== project) continue;
    if (opts.sandbox && !out.includes(opts.sandbox)) out.push(opts.sandbox);
  }
  return out;
}

export const credentialsArgv = (sb: string): string[] => ["exec", sb, "cat", SANDBOX_CREDENTIALS];
/** The Max-login preflight's own probe argv (`server.ts maxLoginPreflight`), verbatim. */
export const authStatusArgv = (sb: string): string[] => ["exec", sb, "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"];

const loginSession = (id: string) => `tk-login-${id}`;
const loginTarget = (id: string) => `=tk-login-${id}:`;
const LOGIN_ARGV = ["env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "login", "--claudeai"];
export const loginStartArgv = (sb: string, id: string): string[] =>
  ["exec", sb, "tmux", "new-session", "-d", "-s", loginSession(id), "-x", "1000", "-y", "50", ...LOGIN_ARGV, ";", "set-option", "-t", loginTarget(id), "remain-on-exit", "on"];
export const loginCaptureArgv = (sb: string, id: string): string[] => ["exec", sb, "tmux", "capture-pane", "-p", "-J", "-S", "-", "-t", loginTarget(id)];
export const loginKillArgv = (sb: string, id: string): string[] => ["exec", sb, "tmux", "kill-session", "-t", `=${loginSession(id)}`];
/** The code's only way in: stdin of `sbx exec -i` (the argv never carries it). */
export const loginLoadBufferArgv = (sb: string, id: string): string[] => ["exec", "-i", sb, "tmux", "load-buffer", "-b", loginSession(id), "-"];
export const loginPasteArgv = (sb: string, id: string): string[] => ["exec", sb, "tmux", "paste-buffer", "-d", "-b", loginSession(id), "-t", loginTarget(id)];
export const loginEnterArgv = (sb: string, id: string): string[] => ["exec", sb, "tmux", "send-keys", "-t", loginTarget(id), "Enter"];
export const loginPaneArgv = (sb: string, id: string): string[] => ["exec", sb, "tmux", "display-message", "-p", "-t", loginTarget(id), "#{pane_dead} #{pane_dead_status}"];
export const loginClearArgv = (sb: string, id: string): string[] => ["exec", sb, "tmux", "clear-history", "-t", loginTarget(id)];
export const loginRespawnArgv = (sb: string, id: string): string[] => ["exec", sb, "tmux", "respawn-pane", "-k", "-t", loginTarget(id), ...LOGIN_ARGV];

/** The last sign-in URL in a pane that carries both the PKCE challenge and the state, else null. */
export function signInUrl(pane: string): string | null {
  const hits = [...(pane ?? "").matchAll(SIGN_IN_URL_RE)].map((m) => m[0]).filter((u) => u.includes("code_challenge=") && u.includes("state="));
  return hits.at(-1) ?? null;
}

const urlState = (url: string | null): string | null => {
  if (!url) return null;
  try { return new URL(url).searchParams.get("state"); } catch { return null; }
};

/** The pane's last non-blank line for a refusal: ANSI stripped, every `https://…` replaced by `[sign-in URL]`, every line
 * carrying the code (or either half of it) or starting `Paste code here` skipped, clipped to 300 characters. */
export function paneLastLine(pane: string, code?: string): string {
  const halves = code ? [code, ...code.split("#")].filter((x) => x.length > 0) : [];
  const lines = (pane ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b[\]PX^_][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Paste code here/.test(l) && !halves.some((h) => l.includes(h)));
  const last = lines.at(-1);
  return last ? last.replace(/https:\/\/\S+/g, "[sign-in URL]").slice(0, 300) : "the pane printed nothing";
}

/** The read's pure judgement (Settled shape 2's precedence table, the first that applies wins). */
export function judgeLogin(
  sb: string, probe: { exit: number | null; stdout: string } | { error: string },
  creds: { exit: number | null; stdout: string } | { error: string }, nowMs: number,
): SandboxLoginReading {
  let loggedIn: boolean | null = null, method: string | null = null, sub: string | null = null, probeFailed: string | null = null;
  // The preflight's rule (ruling 3), reused as is: null is a claude.ai subscription login.
  let preflightGap: string | null = null;
  if ("error" in probe) probeFailed = probe.error;
  else if (probe.exit !== 0) probeFailed = `exit ${probe.exit}`;
  else {
    let s: unknown;
    try { s = JSON.parse(probe.stdout.trim()); } catch { s = undefined; }
    if (!s || typeof s !== "object" || Array.isArray(s)) probeFailed = "unparseable";
    else {
      // Only three keys are read; the probe's object (it carries the email and the org) is never spread.
      const o = s as Record<string, unknown>;
      loggedIn = o.loggedIn === true;
      method = typeof o.authMethod === "string" ? o.authMethod : null;
      sub = typeof o.subscriptionType === "string" ? o.subscriptionType : null;
      preflightGap = judgeAuthStatus(probe.exit, probe.stdout);
    }
  }
  let access: number | null = null, refresh: number | null = null, credsFailed: string | null = null;
  if ("error" in creds) credsFailed = "unreadable";
  else if (creds.exit !== 0) credsFailed = `exit ${creds.exit}`;
  else {
    let c: any;
    try { c = JSON.parse(creds.stdout); } catch { c = undefined; }
    const oauth = c && typeof c === "object" ? c.claudeAiOauth : undefined;
    if (!oauth || typeof oauth !== "object") credsFailed = c === undefined ? "unparseable" : "no refreshTokenExpiresAt";
    else {
      if (typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt)) access = oauth.expiresAt;
      if (typeof oauth.refreshTokenExpiresAt === "number" && Number.isFinite(oauth.refreshTokenExpiresAt)) refresh = oauth.refreshTokenExpiresAt;
      else credsFailed = "no refreshTokenExpiresAt";
    }
  }
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const base = {
    ok: true as const, sandbox: sb, logged_in: probeFailed ? null : loggedIn, auth_method: probeFailed ? null : method,
    subscription_type: probeFailed ? null : sub, access_expires_at: iso(access), refresh_expires_at: iso(refresh),
    days_left: refresh === null ? null : Math.max(0, Math.floor((refresh - nowMs) / 86_400_000)), checked_at: new Date(nowMs).toISOString(),
  };
  if (probeFailed) return { ...base, state: "unknown", reason: `the login probe failed: ${probeFailed}` };
  if (preflightGap !== null && loggedIn !== true) return { ...base, state: "expired" };
  if (preflightGap !== null) return { ...base, state: "unknown", reason: `logged in with '${method}', not the claude.ai subscription (the preflight refuses it)` };
  if (credsFailed || refresh === null) return { ...base, state: "unknown", reason: `the credentials file was not read: ${credsFailed ?? "no refreshTokenExpiresAt"}` };
  if (refresh <= nowMs) return { ...base, state: "expired" };
  if (refresh - nowMs <= LOGIN_WARN_MS) return { ...base, state: "expiring" };
  return { ...base, state: "ok" };
}

/** The latest `sandbox-login-check` recorded for `sb`, else null. */
export function lastLoginCheck(queue: Queue, sb: string): { seq: number; at: string; detail: Record<string, unknown> } | null {
  const e = queue.serviceEvents(SANDBOX_LOGIN_CHECK).findLast((x) => x.detail?.sandbox === sb);
  return e ? { seq: e.seq, at: e.at, detail: e.detail! } : null;
}

/** GET /sandbox/login's read of `sb` (Settled shape 2): `sbx ls`; a sandbox not listed running is never exec'd into
 * (`unknown`, `sandbox stopped`, the last check's values or nulls; nothing started); else the preflight's probe and one
 * `cat` of the credential file, judged by `judgeLogin`. Writes nothing. Never throws. */
export async function readSandboxLogin(queue: Queue, sb: string, deps: SandboxDeps = {}, nowMs: number = Date.now()): Promise<SandboxLoginReading> {
  if (!(await sandboxRunning(sb, deps))) {
    const last = lastLoginCheck(queue, sb);
    const d = last?.detail ?? {};
    const str = (k: string) => (typeof d[k] === "string" ? d[k] as string : null);
    return {
      ok: true, sandbox: sb, logged_in: typeof d.logged_in === "boolean" ? d.logged_in : null, auth_method: str("auth_method"),
      subscription_type: str("subscription_type"), access_expires_at: str("access_expires_at"), refresh_expires_at: str("refresh_expires_at"),
      days_left: typeof d.days_left === "number" ? d.days_left : null, state: "unknown", checked_at: last?.at ?? new Date(nowMs).toISOString(),
      reason: "sandbox stopped",
    };
  }
  const spawned = async (argv: string[]) => {
    try {
      const r = deps.run ? await deps.run(bin(deps), argv, { timeoutS: 30 }) : await runProcess(bin(deps), argv, { timeoutS: 30, env: buildWorkerEnv() });
      return { exit: r.exit, stdout: r.stdout };
    // A timeout's message carries the stdout's tail (the probe's email): cut before it.
    } catch (e) { return { error: clip(message(e).replace(/;\s*stdout tail:[\s\S]*$/, ""), 120).replace(/https:\/\/\S+/g, "[url]") }; }
  };
  const probe = await spawned(authStatusArgv(sb));
  const creds = await spawned(credentialsArgv(sb));
  return judgeLogin(sb, probe, creds, nowMs);
}

/** A route's answer: its HTTP status and body (`{ok, …}`; a refusal `{ok: false, error, …}`). */
export interface LoginAnswer { status: number; body: Record<string, unknown> }
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): LoginAnswer => ({ status, body: { ok: false, error, ...extra } });

export interface LoginDeps {
  sbx?: SandboxDeps;
  /** The pane poll interval (ms, default 1000), the URL wait (default 30 000) and the code's outcome wait (default 60 000). */
  pollMs?: number; urlWaitMs?: number; codeWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The API's per-process memory of the exchange: tries per login (a restart resets them, harmlessly) and the codes in
 * flight. The login's state itself is the lease and the session name. */
export interface LoginMemory { tries: Map<string, number>; inFlight: Set<string> }
export const loginMemory = (): LoginMemory => ({ tries: new Map(), inFlight: new Set() });

const nowOf = (d: LoginDeps) => (d.now ?? Date.now)();
const sleepOf = (d: LoginDeps) => d.sleep ?? ((ms: number) => Bun.sleep(ms));

/** The pane's text (capture), or null when it could not be read. Never throws. */
async function capture(sb: string, id: string, deps: SandboxDeps): Promise<string | null> {
  try { const r = await call(deps, loginCaptureArgv(sb, id), 30); return r.exit === 0 ? r.stdout : null; } catch { return null; }
}
/** `#{pane_dead} #{pane_dead_status}`: dead with its status, alive, or null (unreadable). Never throws. */
async function paneState(sb: string, id: string, deps: SandboxDeps): Promise<{ dead: boolean; status: number | null } | null> {
  try {
    const r = await call(deps, loginPaneArgv(sb, id), 30);
    if (r.exit !== 0) return null;
    const [dead, status] = r.stdout.trim().split(/\s+/);
    return { dead: dead === "1", status: status !== undefined && status !== "" && Number.isFinite(Number(status)) ? Number(status) : null };
  } catch { return null; }
}
async function killLogin(sb: string, id: string, deps: SandboxDeps): Promise<void> {
  try { await call(deps, loginKillArgv(sb, id), 30); } catch { /* best effort */ }
}

/** Wait for a sign-in URL (one whose `state` differs from `notState`, when given) within `waitMs`: the URL, or the
 * failure's last pane line. A dead pane ends the wait. */
async function awaitUrl(sb: string, id: string, d: LoginDeps, waitMs: number, notState: string | null = null): Promise<{ url: string } | { last_line: string }> {
  const deps = d.sbx ?? {};
  const pollMs = d.pollMs ?? 1000;
  let pane = "";
  for (const until = nowOf(d) + waitMs; ;) {
    pane = (await capture(sb, id, deps)) ?? pane;
    const url = signInUrl(pane);
    if (url && (notState === null || urlState(url) !== notState)) return { url };
    const st = await paneState(sb, id, deps);
    if (st?.dead || nowOf(d) >= until) return { last_line: paneLastLine(pane) };
    await sleepOf(d)(pollMs);
  }
}

/** POST /sandbox/login/start (Settled shapes 3, 4, 5): refused by name while a run holds `sb` (`LoginWhileLive`; checked
 * again atomically inside `takeSandboxLogin`, so a claim racing the start never runs beside the login), a
 * live lease stands (`LoginInProgress`) or `sb` is not running (`SandboxStopped`, nothing started) — each writing
 * nothing; else the lease is taken, `claude auth login --claudeai` started in `tk-login-<id>` and its pane read until the
 * sign-in URL shows (a timeout or a dead pane: the session killed, the lease closed `failed`, `LoginStartFailed`).
 * The URL is in the 200 answer (and, after a respawn, in the code route's first `CodeRefused {…, url}`) only, never in
 * an event, a refusal's last_line, a pane line or a log. Never throws. */
export async function startSandboxLogin(queue: Queue, sb: string, d: LoginDeps = {}): Promise<LoginAnswer> {
  const deps = d.sbx ?? {};
  const holder = (await sandboxHolders(queue, sb, "", RESTART_BLOCKING_STATES))[0];
  const legRun = holder ? undefined : queue.runs().find((r) => r.sandbox === sb && queue.verifyLegLive(r.run_id));
  const held = holder ? queue.get(holder) : legRun;
  if (held) return refuse(409, "LoginWhileLive", { sandbox: sb, run_id: held.run_id, state: held.state });
  const live = queue.openSandboxLogin(sb, nowOf(d));
  if (live) return refuse(409, "LoginInProgress", { sandbox: sb, login_id: live.login_id, started_at: live.started_at, expires_at: live.deadline });
  if (!(await sandboxRunning(sb, deps))) return refuse(409, "SandboxStopped", { sandbox: sb });
  const id = randomBytes(6).toString("hex");
  const taken = queue.takeSandboxLogin(sb, id, nowOf(d), LOGIN_LEASE_S);
  // The take re-reads the holders inside its transaction: a drain claim that landed since the check above refuses it.
  if ("held" in taken) return refuse(409, "LoginWhileLive", { sandbox: sb, run_id: taken.held.run_id, state: taken.held.state });
  if ("live" in taken) {
    return refuse(409, "LoginInProgress", { sandbox: sb, login_id: taken.live.login_id, started_at: taken.live.started_at, expires_at: taken.live.deadline });
  }
  const failed = async (last_line: string) => {
    await killLogin(sb, id, deps);
    queue.closeSandboxLogin(id, "failed", nowOf(d));
    return refuse(500, "LoginStartFailed", { sandbox: sb, last_line });
  };
  try {
    const r = await call(deps, loginStartArgv(sb, id), 30);
    if (r.exit !== 0) return await failed(paneLastLine(`${r.stdout}\n${r.stderr}`));
  } catch (e) { return await failed(paneLastLine(message(e))); }
  const got = await awaitUrl(sb, id, d, d.urlWaitMs ?? 30_000);
  if ("last_line" in got) return await failed(got.last_line);
  return { status: 200, body: { ok: true, login_id: id, url: got.url, started_at: taken.lease.started_at, expires_at: taken.lease.deadline } };
}

const INVALID_CODE = /Invalid code\./g;
const invalidCount = (pane: string) => (pane.match(INVALID_CODE) ?? []).length;

/** POST /sandbox/login/code (Settled shapes 3, 4): the code handed to the waiting login through tmux's buffer (stdin
 * only), the outcome read from the pane. The caller checked `loginId` and `code`'s shapes (a bad shape spends no try).
 * Every wait (the outcome's, a respawn's URL) ends by the lease's deadline at the latest: a deadline reached with no
 * success closes the lease `expired` and answers `LoginExpired`, as a code sent late does; a late or in-wait expiry kills
 * the session only on a sandbox listed running (best effort, as the drain's `expireSandboxLogins`), so a late code on a
 * stopped sandbox is still `LoginExpired`, with no exec. Otherwise a sandbox not listed running is never exec'd into:
 * the lease closed `failed`, `SandboxStopped`.
 * Never throws: the exchange's own failures are named, URL-free answers. */
export async function sendSandboxLoginCode(queue: Queue, loginId: string, code: string, mem: LoginMemory, d: LoginDeps = {}): Promise<LoginAnswer> {
  const deps = d.sbx ?? {};
  const known = queue.sandboxLogin(loginId);
  if (!known) return refuse(404, "UnknownLogin", { login_id: loginId });
  if (known.closed) return refuse(409, "LoginClosed", { login_id: loginId, result: known.closed.result });
  const lease: SandboxLoginLease = known.open;
  const sb = lease.sandbox;
  const deadlineMs = Date.parse(lease.deadline);
  const expire = async (): Promise<LoginAnswer> => {
    // Never exec into (and so start) a sandbox stopped under the lease: the kill is best effort on a running one only.
    if (await sandboxRunning(sb, deps)) await killLogin(sb, loginId, deps);
    queue.closeSandboxLogin(loginId, "expired", nowOf(d));
    mem.tries.delete(loginId);
    return refuse(409, "LoginExpired", { login_id: loginId });
  };
  if (!(deadlineMs > nowOf(d))) return await expire();
  if (mem.inFlight.has(loginId)) return refuse(409, "LoginInProgress", { login_id: loginId });
  // Marked before the `ls` await, so a second code racing this one answers LoginInProgress.
  mem.inFlight.add(loginId);
  try {
    // Never exec into (and so start) a sandbox stopped outside the supervisor while the lease stands.
    if (!(await sandboxRunning(sb, deps))) {
      queue.closeSandboxLogin(loginId, "failed", nowOf(d));
      mem.tries.delete(loginId);
      return refuse(409, "SandboxStopped", { sandbox: sb, login_id: loginId });
    }
    const close = async (result: "renewed" | "refused" | "failed") => {
      await killLogin(sb, loginId, deps);
      queue.closeSandboxLogin(loginId, result, nowOf(d));
      mem.tries.delete(loginId);
    };
    const before = (await capture(sb, loginId, deps)) ?? "";
    const oldState = urlState(signInUrl(before));
    const invalidBefore = invalidCount(before);
    try {
      const steps: [string[], string?][] = [[loginLoadBufferArgv(sb, loginId), code], [loginPasteArgv(sb, loginId)], [loginEnterArgv(sb, loginId)]];
      for (const [argv, input] of steps) {
        const r = await call(deps, argv, 30, input);
        if (r.exit !== 0) { await close("failed"); return refuse(500, "LoginFailed", { login_id: loginId, last_line: paneLastLine(`${r.stdout}\n${r.stderr}`, code) }); }
      }
    } catch (e) { await close("failed"); return refuse(500, "LoginFailed", { login_id: loginId, last_line: paneLastLine(message(e), code) }); }
    const pollMs = d.pollMs ?? 1000;
    let pane = before;
    for (const until = Math.min(nowOf(d) + (d.codeWaitMs ?? 60_000), deadlineMs); ;) {
      const st = await paneState(sb, loginId, deps);
      pane = (await capture(sb, loginId, deps)) ?? pane;
      const tries = (mem.tries.get(loginId) ?? 0) + 1;
      if (st?.dead && st.status === 0) {
        await close("renewed");
        const reading = await readSandboxLogin(queue, sb, deps, nowOf(d));
        return { status: 200, body: reading as unknown as Record<string, unknown> };
      }
      if (st?.dead) {
        const last_line = paneLastLine(pane, code);
        if (tries >= 2) { await close("refused"); return refuse(409, "CodeRefused", { login_id: loginId, last_line, tries_left: 0 }); }
        mem.tries.set(loginId, tries);
        // The old code is bound to the old PKCE verifier: a fresh sign-in, its URL's state differing.
        try {
          await call(deps, loginClearArgv(sb, loginId), 30);
          const r = await call(deps, loginRespawnArgv(sb, loginId), 30);
          if (r.exit !== 0) { await close("failed"); return refuse(500, "LoginFailed", { login_id: loginId, last_line: paneLastLine(`${r.stdout}\n${r.stderr}`, code) }); }
        } catch (e) { await close("failed"); return refuse(500, "LoginFailed", { login_id: loginId, last_line: paneLastLine(message(e), code) }); }
        const got = await awaitUrl(sb, loginId, d, Math.min(d.urlWaitMs ?? 30_000, deadlineMs - nowOf(d)), oldState);
        if ("last_line" in got && nowOf(d) >= deadlineMs) return await expire();
        if ("last_line" in got) { await close("failed"); return refuse(500, "LoginFailed", { login_id: loginId, last_line: paneLastLine(got.last_line, code) }); }
        return refuse(409, "CodeRefused", { login_id: loginId, last_line, tries_left: 1, url: got.url });
      }
      if (st && invalidCount(pane) > invalidBefore) {
        const last_line = paneLastLine(pane, code);
        if (tries >= 2) { await close("refused"); return refuse(409, "CodeRefused", { login_id: loginId, last_line, tries_left: 0 }); }
        mem.tries.set(loginId, tries);
        return refuse(409, "CodeRefused", { login_id: loginId, last_line, tries_left: 1 });
      }
      if (nowOf(d) >= deadlineMs) return await expire();
      if (nowOf(d) >= until) { await close("failed"); return refuse(500, "LoginFailed", { login_id: loginId, last_line: paneLastLine(pane, code) }); }
      await sleepOf(d)(pollMs);
    }
  } finally { mem.inFlight.delete(loginId); }
}

/** The drain pass's expiry (Settled shape 6), before its claims: every open lease past its deadline has its tmux session
 * killed (best effort, only on a running sandbox) and is closed `expired` with `closed_by: "drain"`. Answers the ids
 * closed. Never throws. */
export async function expireSandboxLogins(queue: Queue, deps: SandboxDeps = {}, nowMs: number = Date.now()): Promise<string[]> {
  const out: string[] = [];
  let stale: SandboxLoginLease[];
  try { stale = queue.staleSandboxLogins(nowMs); } catch { return out; }
  const running = new Map<string, boolean>();
  for (const l of stale) {
    try {
      if (!running.has(l.sandbox)) running.set(l.sandbox, await sandboxRunning(l.sandbox, deps));
      if (running.get(l.sandbox)) await killLogin(l.sandbox, l.login_id, deps);
      if (queue.closeSandboxLogin(l.login_id, "expired", nowMs, "drain")) out.push(l.login_id);
    } catch { /* the next pass */ }
  }
  return out;
}
