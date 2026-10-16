/**
 * The supervisor's durable queue (Story 21.3): submitted jobs and their runs
 * held in SQLite (`bun:sqlite`), one lock per checkout.
 *
 *   jobs    one row per (job, checkout): the resolved definition `resolve` served
 *   runs    queue runs — `queued` → `running` → complete|partial|blocked|cancelled
 *           (Story 27.1: a launch run whose engine paused rests `paused` until it ends)
 *           (Story 27.2: a studio run started outside the queue is recorded `external` — live for the
 *           pacer, no owner, no lock — until its studio run is terminal)
 *           (terminal is immutable; a trigger refuses any update of one — but its
 *           end-hygiene marker `notified`: NULL → lease → done, a stale lease re-leased, Story 22.3)
 *   events  one row per transition, committed in the same transaction
 *   locks   one row per checkout: the run holding it, or the detached
 *           bmad-loop engine a `tk-studio-launch` run started
 *
 * Every transition runs in one `BEGIN IMMEDIATE` transaction with its event.
 * Minting is idempotent: while a run of the same job on the same checkout is
 * `queued`, `running` or `paused` (Story 27.1), `enqueue` mints nothing and answers that run.
 *
 * The database path comes from the environment only (`TK_SUPERVISOR_DB`) and
 * must lie outside the studio store (TK_STUDIO_HOME when set, and ~/.tk-studio
 * always), outside TK_STUDIO_ROOT, and outside any git checkout — checked
 * before the file is created.
 *
 * An owner is host + pid + a per-process nonce (+ the process start time where
 * the platform exposes it). "Mine" compares the nonce, never the pid.
 *
 * "Started" means the run reached the studio's minting verb: `markVerbStarted`
 * records it, with the pre-verb snapshot of the job's studio run ids, just
 * before `submit`/`wake`. The restart rule reads it (see `recover`).
 *
 * Holder liveness is injectable: an owner probe (same host, `kill(pid, 0)`,
 * start time) and an engine probe (the launch core's `status --directory`,
 * whose `live[]` holds the engine while it runs; a failed probe counts as live).
 * No probe runs inside a transaction (a probe may spawn a process): the
 * transaction re-checks the rows it was probed from.
 *
 * Resume (Story 21.6): before the worker works, the run records its pre-minted
 * session id, the worker's pid (POSIX: its process group) with its start time
 * and the guard seconds passed to its spawn, and the wake answer — each with an
 * event, in its own transaction. `recover` kills a recorded worker that still
 * runs as recorded (pid + start time) before it resumes a run or releases its
 * lock — an sbx run is held until its in-VM deadline instead, and `claim` waits
 * on a dead owner's run whose recorded worker may still run (`recordedWorker`,
 * one predicate) — then hands a resumable orphan to the
 * injected `resume` op: a resume takes the run over in one transaction (owner,
 * lock, a `resumed` event); anything else ends it through the same end path as
 * `end` (the `stop` and `studio_outcome` markers included).
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pluginRoot } from "./env";
import { probeEngine, sameStart, type ProbeResult } from "./sandbox";
import { lastJsonObject, runUv, SBX_GUARD_KILL_AFTER_S, type RunResult } from "./server";

type Env = Record<string, string | undefined>;

export const TERMINAL_STATES = ["complete", "partial", "blocked", "cancelled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];
/** Story 27.1: `paused` — a launch run whose engine paused: it keeps its worktree and its checkout
 * lock, and its draft PR is recorded on the `paused` event; it is never terminal.
 * Story 27.2: `external` — a studio run started outside the queue (`jobrun.py` by hand, MCP `tk_job`),
 * recorded so the pacer counts it live; it holds no lock and ends when its studio run is terminal. */
export type RunState = "queued" | "running" | "paused" | "external" | TerminalState;
export const isTerminal = (s: unknown): s is TerminalState => (TERMINAL_STATES as readonly unknown[]).includes(s);

export const ORPHANED_REASON = "orphaned: supervisor restart";
export const REQUEUED_REASON = "requeued: supervisor restart";
export const LAUNCH_SKILL = "tk-studio-launch";

// ------------------------------------------------------------ path + placement

export class QueueDbMissing extends Error {
  constructor() {
    super("QueueDbMissing: TK_SUPERVISOR_DB is not set — point it at a queue database file outside every repo, the studio store and TK_STUDIO_ROOT");
    this.name = "QueueDbMissing";
  }
}

export class QueueDbPlacementRefused extends Error {
  constructor(path: string, why: string) {
    super(`QueueDbPlacementRefused: TK_SUPERVISOR_DB '${path}' ${why} — the queue lives outside every repo and outside the studio store`);
    this.name = "QueueDbPlacementRefused";
  }
}

/** A terminal run is immutable. */
export class RunTerminal extends Error {
  constructor(runId: string, state: string) {
    super(`RunTerminal: queue run '${runId}' already ended ${state} — terminal runs are immutable`);
    this.name = "RunTerminal";
  }
}

/** Absolute and symlink-resolved (as far as the path exists), in its own case.
 * Case-insensitive comparison is foldCase's job; folding here would hand callers
 * a lowercased path on win32 and leak the host's folding into every comparison. */
export function canonicalPath(p: string): string {
  let head = resolve(p);
  const tail: string[] = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) break;
    tail.unshift(head.slice(up.length).replace(/^[\\/]+/, ""));
    head = up;
  }
  try { head = realpathSync(head); } catch { /* keep the resolved head */ }
  return tail.length ? join(head, ...tail) : head;
}

/** Case-folded for comparison where the file system is case-insensitive by
 * default (win32, darwin), so `~/.TK-Studio` is still the store. */
export function foldCase(p: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" || platform === "darwin" ? p.toLowerCase() : p;
}

/** The identity of a checkout for locks and live-run lookup: canonical and
 * case-folded where the file system is case-insensitive, so two spellings of
 * one checkout share one engine lock. */
export function checkoutKey(p: string, platform: NodeJS.Platform = process.platform): string {
  return foldCase(canonicalPath(p), platform);
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The queue database path from the environment, with every placement refusal
 * checked before anything is created. */
export function queueDbPath(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  const raw = env.TK_SUPERVISOR_DB?.trim();
  if (!raw) throw new QueueDbMissing();
  const path = canonicalPath(raw);
  const inside = (parent: string) => isInside(foldCase(path, platform), foldCase(canonicalPath(parent), platform));
  // The store the studio owns: TK_STUDIO_HOME when set, and ~/.tk-studio always (AC1).
  const home = env.TK_STUDIO_HOME?.trim();
  for (const store of [...(home ? [home] : []), join(homedir(), ".tk-studio")]) {
    if (inside(store)) {
      throw new QueueDbPlacementRefused(raw, `lies inside the studio store '${store}' (TK_STUDIO_HOME, and ~/.tk-studio)`);
    }
  }
  const studio = env.TK_STUDIO_ROOT?.trim();
  if (studio && inside(studio)) {
    throw new QueueDbPlacementRefused(raw, `lies inside TK_STUDIO_ROOT '${studio}'`);
  }
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) throw new QueueDbPlacementRefused(raw, `lies inside the git checkout '${dir}'`);
    if (dirname(dir) === dir) break;
  }
  return path;
}

// ------------------------------------------------------------ owners + probes

/** Who drives a run: host + pid + a random per-process nonce, plus the process
 * start time where the platform exposes it (Linux `/proc/<pid>/stat` field 22;
 * win32 the process creation time via PowerShell). */
export interface Owner { pid: number; host: string; nonce: string; start?: string | null }

/** Runs one bounded PowerShell command; null when it cannot run or fails. */
export type PowerShellRunner = (command: string) => string | null;

export const runPowerShell: PowerShellRunner = (command) => {
  try {
    const res = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf-8", timeout: 10_000, windowsHide: true });
    return res.status === 0 && typeof res.stdout === "string" ? res.stdout : null;
  } catch { return null; }
};

/** The start time of `pid`: Linux `/proc/<pid>/stat` field 22; win32 the
 * creation time (UTC, ISO) through a bounded PowerShell call; else — or on
 * any failed read — null (absent). */
export function processStartTime(pid: number, platform: NodeJS.Platform = process.platform, ps: PowerShellRunner = runPowerShell): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === "win32") {
    const out = ps(`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`)?.trim();
    return out && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(out) ? out : null;
  }
  if (platform !== "linux") return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    // Field 2 (comm) may hold spaces and parens: count from after its last ')'.
    const rest = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return rest[19] ?? null; // rest[0] is field 3
  } catch { return null; }
}

let self_: Owner | undefined;
/** This process as an owner: its nonce is minted once per process. */
export const selfOwner = (): Owner =>
  (self_ ??= { pid: process.pid, host: hostname(), nonce: randomBytes(8).toString("hex"), start: processStartTime(process.pid) });

export interface EngineProbe {
  live: boolean;
  /** Set when the probe failed: counted live (fail closed) and named. */
  detail?: string;
  /** The live bmad-loop run ids the probe saw. */
  run_ids?: string[];
}
export interface Probes {
  /** Is another owner's process alive? */
  ownerAlive(owner: Owner): boolean;
  /** Kill a dead owner's recorded worker if it still runs as recorded (default: `killRecordedWorker`). */
  killWorker?(pid: number, start: string | null): Promise<WorkerKill>;
  /** Where a recorded worker stands, without signalling it (default: `probeRecordedWorker`). */
  probeWorker?(pid: number, start: string | null): WorkerKill;
  /** The clock an sbx worker's in-VM deadline is compared against (default `Date.now`). */
  now?(): number;
  /** Is bmad-loop engine `engineRunId` live on the checkout at `root`? With
   * `null` (an unverified engine): is any engine live there? */
  engineLive(root: string, engineRunId: string | null): Promise<EngineProbe>;
  /** Story 27.2 (DW-3): an in-VM engine pid's `/proc/<pid>/stat` through `sbx exec` (argv only; default
   * `probeEngine` in src/sandbox.ts) — re-probed while a run's last engine kill left it alive. */
  engineProbe?(sandbox: string, pid: number): Promise<ProbeResult>;
}

/** On the same host: `kill(pid, 0)` succeeds and the recorded start time (when
 * present and readable) equals the live process's — a reused pid is not the
 * owner. An owner on another host cannot be probed and counts as alive. */
export function defaultOwnerAlive(owner: Owner, startTime: (pid: number) => string | null = processStartTime): boolean {
  if (owner.host !== hostname()) return true;
  try { process.kill(owner.pid, 0); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "EPERM") return false; }
  if (owner.start) {
    const live = startTime(owner.pid);
    if (live !== null && live !== owner.start) return false;
  }
  return true;
}

type UvRunner = (root: string, script: string, args: string[], timeoutS?: number) => Promise<RunResult>;

/** The launch core's `status --directory <root>` (§1 pure-data allowance):
 * the engine holds the checkout while its id is in `live[]` (with a null id:
 * while `live[]` is non-empty). Any failed probe counts as live (fail closed)
 * and is named. */
export async function launchStatusProbe(root: string, engineRunId: string | null, uv: UvRunner = runUv): Promise<EngineProbe> {
  try {
    const res = await uv(root, join(pluginRoot(), "lib", "launch.py"), ["status", "--directory", root], 120);
    const out = lastJsonObject(res.stdout) as Record<string, any> | null;
    if (!out || out.ok !== true || !Array.isArray(out.live)) {
      const why = out?.error ?? (res.stderr.trim() || "no JSON answer");
      return { live: true, detail: `launch status probe failed (exit ${res.exit}): ${String(why).slice(0, 300)}` };
    }
    const ids = (out.live as Record<string, unknown>[]).map((r) => r?.run_id).filter((id): id is string => typeof id === "string");
    return { live: engineRunId === null ? out.live.length > 0 : ids.includes(engineRunId), run_ids: ids };
  } catch (e) {
    return { live: true, detail: `launch status probe failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** What the launch-orphan rule found on a checkout: `holder` when an engine
 * holds it (id `null`: unverified), and the `engine` detail recorded. */
export type LaunchEngine = { holder?: { id: string | null }; engine: Record<string, unknown> };

/** The launch-orphan rule, probed outside any transaction: a failed probe
 * → an unverified engine holder (fail closed, named); a non-empty `live[]`
 * → that engine (the first live id); an empty `live[]` → no holder. */
export async function probeLaunchEngine(probes: Pick<Probes, "engineLive">, root: string): Promise<LaunchEngine> {
  const probe = await probes.engineLive(root, null);
  if (probe.detail) return { holder: { id: null }, engine: { handed_to_engine: "unverified", detail: probe.detail } };
  if (probe.live) {
    const id = probe.run_ids?.[0] ?? null;
    return { holder: { id }, engine: { handed_to_engine: id ?? "unverified", live: probe.run_ids ?? [] } };
  }
  return { engine: { handed_to_engine: null, live: [] } };
}

export const defaultProbes: Probes = { ownerAlive: (o) => defaultOwnerAlive(o), engineLive: (root, id) => launchStatusProbe(root, id) };

/** Is `pid` a live (not zombie) process? */
function pidRunning(pid: number): boolean {
  try { process.kill(pid, 0); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "EPERM") return false; }
  if (process.platform !== "linux") return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch { return false; }
}

/** One `/proc/<pid>/stat` line: its state (field 3) and process group (field 5), read
 * from after the last ')' (field 2, comm, may hold spaces and parens); null when unparsable. */
export function parseStatGroup(stat: string): { state: string; pgrp: number } | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const rest = stat.slice(close + 2).trim().split(/\s+/); // rest[0] is field 3
  const pgrp = Number(rest[2]);
  return rest[0] && Number.isInteger(pgrp) ? { state: rest[0], pgrp } : null;
}

/** Reads `/proc` for `linuxGroupHasLiveMember` (injectable in tests). */
export interface ProcReader {
  /** The entries of `/proc` (throws when unreadable). */
  list(): string[];
  /** `/proc/<pid>/stat`; null when the process is gone (ENOENT/ESRCH); throws on any other failure. */
  stat(pid: string): string | null;
}
const procReader: ProcReader = {
  list: () => readdirSync("/proc"),
  stat: (pid) => {
    try { return readFileSync(`/proc/${pid}/stat`, "utf-8"); }
    catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ESRCH") return null;
      throw e;
    }
  },
};

/** Linux: does process group `pgid` have a member that is not a zombie? A scan of
 * `/proc/<pid>/stat` for pgrp (field 5) == pgid and state (field 3) != 'Z'. null when
 * the scan failed (an unreadable `/proc`, an unreadable or unparsable stat of a live
 * entry): the caller then keeps `kill(-pgid, 0)`'s answer (fail toward alive). */
export function linuxGroupHasLiveMember(pgid: number, proc: ProcReader = procReader): boolean | null {
  let entries: string[];
  try { entries = proc.list(); } catch { return null; }
  let failed = false;
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    let stat: string | null;
    try { stat = proc.stat(name); } catch { failed = true; continue; }
    if (stat === null) continue; // exited since the listing
    const parsed = parseStatGroup(stat);
    if (!parsed) { failed = true; continue; }
    if (parsed.pgrp === pgid && parsed.state !== "Z") return true;
  }
  return failed ? null : false;
}

/** POSIX: is any member of process group `pgid` alive? `kill(-pgid, 0)` first (a pgid
 * stays reserved while any member exists, so a live group is still the recorded one);
 * on Linux a group whose only members are unreaped zombies (e.g. reparented to a PID 1
 * that never reaps) is not alive — a `/proc` scan decides, and a failed scan keeps
 * `kill`'s answer (alive). Other POSIX platforms: `kill(-pgid, 0)` alone. */
export function groupAlive(pgid: number, platform: NodeJS.Platform = process.platform, proc: ProcReader = procReader,
  signal: (pid: number, sig: 0) => void = (pid, sig) => { process.kill(pid, sig); }): boolean {
  try { signal(-pgid, 0); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "EPERM") return false; }
  if (platform !== "linux") return true;
  return linuxGroupHasLiveMember(pgid, proc) ?? true;
}

export interface KillDeps {
  platform?: NodeJS.Platform;
  startTime?: (pid: number) => string | null;
  running?: (pid: number) => boolean;
  /** POSIX: is the process group `pgid` alive (default `groupAlive`: `kill(-pgid, 0)`, and on
   * Linux a member that is not a zombie)? Never asked on win32. */
  groupAlive?: (pgid: number) => boolean;
  /** POSIX: signal the process group; win32: `taskkill /F /T /PID`. Throws on failure. */
  kill?: (pid: number, platform: NodeJS.Platform) => void;
  /** Bounded wait for the killed worker to be gone (ms). */
  waitMs?: number;
}

const killGroupOrTree = (pid: number, platform: NodeJS.Platform) => {
  if (platform === "win32") {
    const res = spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, timeout: 30_000 });
    if (res.status !== 0) throw new Error(`taskkill exited ${res.status}`);
    return;
  }
  process.kill(-pid, "SIGKILL");
};

/** Where a recorded host worker stands, without signalling it: `running` (alive,
 * start time equal to the recorded one), `start time unreadable`, `start time
 * differs` (a reused pid), `group alive` (POSIX: the leader exited but members
 * of its process group still run), or `not running`. */
export function probeRecordedWorker(pid: number, start: string | null, deps: KillDeps = {}): WorkerKill {
  const platform = deps.platform ?? process.platform;
  const running = deps.running ?? pidRunning;
  const startTime = deps.startTime ?? ((p: number) => processStartTime(p, platform));
  if (!Number.isInteger(pid) || pid <= 0) return { pid, start, outcome: "not running" };
  if (!running(pid)) {
    if (platform !== "win32" && (deps.groupAlive ?? ((g: number) => groupAlive(g, platform)))(pid)) {
      return { pid, start, outcome: "group alive", detail: `leader ${pid} exited; members of its process group still run` };
    }
    return { pid, start, outcome: "not running" };
  }
  const live = startTime(pid);
  if (!start || live === null) return { pid, start, outcome: "start time unreadable", detail: "not signalled: the recorded worker cannot be told from a reused pid" };
  if (live !== start) return { pid, start, outcome: "start time differs", detail: `not signalled: pid ${pid} now started ${live} (a reused pid)` };
  return { pid, start, outcome: "running" };
}

/** Kill a recorded worker only while it is still the recorded process: alive,
 * and its start time readable and equal to the recorded one (a reused pid is
 * never signalled; neither is one whose start time cannot be compared). POSIX:
 * SIGKILL to its process group — also when the leader has exited but the group
 * still has members (a pgid stays reserved while any member exists); win32:
 * `taskkill /F /T /PID`. Never by name. Still running after the bounded wait
 * → `kill failed` (`still running after wait`), so the run is held. A kill that
 * throws because the worker (or its group) exited after the probe → `not running`. */
export async function killRecordedWorker(pid: number, start: string | null, deps: KillDeps = {}): Promise<WorkerKill> {
  const platform = deps.platform ?? process.platform;
  const running = deps.running ?? pidRunning;
  const startTime = deps.startTime ?? ((p: number) => processStartTime(p, platform));
  const alive = deps.groupAlive ?? ((g: number) => groupAlive(g, platform));
  const probe = probeRecordedWorker(pid, start, deps);
  if (probe.outcome !== "running" && probe.outcome !== "group alive") return probe;
  const group = probe.outcome === "group alive";
  const still = group ? () => alive(pid) : () => running(pid) && startTime(pid) === start;
  try { (deps.kill ?? killGroupOrTree)(pid, platform); }
  catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // Gone between the probe and the kill (POSIX ESRCH; win32 taskkill fails): not running, never `kill failed`.
    if (!still()) return { pid, start, outcome: "not running", detail: `${group ? "process group" : "worker"} exited before the kill (${why})` };
    return { pid, start, outcome: "kill failed", detail: `${group ? "group: " : ""}${why}` };
  }
  const deadline = Date.now() + (deps.waitMs ?? 5000);
  while (still() && Date.now() < deadline) await Bun.sleep(50);
  if (still()) return { pid, start, outcome: "kill failed", detail: group ? "still running after wait (process group)" : "still running after wait" };
  return group ? { pid, start, outcome: "group killed", detail: `leader ${pid} had exited; its process group was SIGKILLed` } : { pid, start, outcome: "killed" };
}

/** May a recorded worker still run, given what its probe or kill answered? The
 * one predicate every path that frees a checkout lock asks (`recover`, `claim`). */
export function workerMayRun(w: WorkerKill): boolean {
  return w.outcome === "running" || w.outcome === "group alive" || w.outcome === "start time unreadable"
    || w.outcome === "kill failed" || w.outcome === "in-VM deadline not passed" || w.outcome === "engine alive after kill";
}

// ------------------------------------------------------------ rows

export interface QueueRun {
  run_id: string; job_id: string; checkout: string; root: string; project_id: string | null;
  target: string | null; state: RunState; reason: string | null;
  owner_pid: number | null; owner_host: string | null; owner_nonce: string | null; owner_start: string | null;
  studio_run_id: string | null; engine_run_id: string | null;
  /** When the run reached the studio's minting verb (null: never). */
  verb_started: string | null;
  /** JSON array: the job's studio run ids before that verb. */
  verb_snapshot: string | null;
  /** JSON: the definition the run was actually driven with (recorded with `verb_started`). */
  definition: string | null;
  /** The worker permission mode a caller asked for explicitly (null: the default);
   * `drain` and the tick drive the run under it. */
  permission_mode: string | null;
  /** Where the worker runs (`host` | `sbx`), the sbx sandbox name, and the
   * submission's model/effort overrides (Story 21.4) — null: not recorded. */
  tier: string | null;
  sandbox: string | null;
  model: string | null;
  effort: string | null;
  /** Story 22.1: the submission's `base_ref`; Story 27.1: the base the run's worktree is cut from
   * and its PR targets (resolved at claim to the default branch when none was given). */
  base_ref: string | null;
  /** Story 27.1: `default` when `base_ref` was resolved at claim (none given); null otherwise. */
  base_ref_source: string | null;
  /** Story 27.1: the run's git worktree (`<work>/worktrees/<project>/<run id>`), null until cut. */
  worktree: string | null;
  /** Story 27.2: an sbx launch run's in-VM engine pid (its process group) and that pid's start time
   * (`/proc/<pid>/stat` field 22, as bmad-loop's `engine.pid` records it); null: not recorded or unknown. */
  engine_pid: number | null;
  engine_start: string | null;
  /** Story 21.6: the worker's pre-minted session id, its pid (POSIX: its process
   * group) and that pid's start time, and the wake answer (JSON: directive, routing, state). */
  session_id: string | null;
  worker_pid: number | null;
  worker_start: string | null;
  /** The wall-clock guard (s) passed to the recorded worker's spawn: on sbx, its in-VM `timeout`. */
  worker_guard_s: number | null;
  wake: string | null;
  /** Story 22.3: 1 when the submission flagged the run editor-in-the-loop (a Godot project is
   * snapshot before its minting verb); null otherwise. */
  editor_in_the_loop: number | null;
  /** Story 22.3: the end hygiene (notification + transcript copy) marker — null until one process
   * leases the run's end (`claimEnd`, `lease …`), `done …` once its outcomes are recorded
   * (`finishEnd`); runs already terminal when the column was added are marked done. */
  notified: string | null;
  created: string; updated: string;
}

/** The worker options a run records while `queued` (Story 21.4). */
export interface RunOptionsRecord { tier?: string | null; sandbox?: string | null; model?: string | null; effort?: string | null; base_ref?: string | null }
const RUN_OPTION_KEYS = ["tier", "sandbox", "model", "effort", "base_ref"] as const;

export interface QueueEvent {
  seq: number; run_id: string; at: string; kind: string;
  from_state: string | null; to_state: string; detail: Record<string, unknown> | null;
}

/** A `stop.on_status` stop recorded on a terminal run (Story 21.5, AC4). */
export interface StopDetail { condition: "on_status"; state: string; job_id: string }

/** Marker on an `ended` event whose outcome is a terminal state the studio
 * itself reached (mirrored from its run) — the only kind of later run that
 * clears a recorded stop (a not-woken/refused run or an orphan never does). */
export interface StudioOutcome { run_id: string; state: string }

/** What the pacer reads for one (job, checkout). */
export interface JobPacing {
  /** Runs that hold the job: `running`, `paused` (Story 27.1), `external` (Story 27.2: started outside the
   * queue), or `queued` under a live owner — never overlapped. */
  live: QueueRun[];
  /** Ownerless (or dead-owner) `queued` runs: the tick's `runJob` adopts and drives the oldest. */
  adoptable: QueueRun[];
  /** The latest terminal run's end: its ending (`ended`/`orphaned`) event's `at`, else its `updated`. */
  lastEnded: string | null;
  latestTerminal: QueueRun | null;
  /** The `stopped` event still in force: recorded on a terminal run and not
   * cleared by a later run whose studio outcome was terminal (`StudioOutcome`). */
  stopped: QueueEvent | null;
}

export interface LockRow {
  checkout: string; root: string; kind: "run" | "engine"; run_id: string; job_id: string;
  owner_pid: number | null; owner_host: string | null; owner_nonce: string | null; owner_start: string | null;
  engine_run_id: string | null; acquired: string;
}

/** Who holds a checkout lock, as named in a waiting run's reason and answer. */
export interface Holder {
  kind: "run" | "engine"; run_id: string; job_id: string;
  pid?: number | null; host?: string | null;
  /** The engine's bmad-loop run id; null for an unverified engine. */
  engine_run_id?: string | null; detail?: string;
}

export type ClaimResult =
  | { claimed: true; run: QueueRun }
  | { claimed: false; run: QueueRun; why: "terminal" | "running" | "owned" | "lock"; reason: string; holder?: Holder };

/** Ends a minted studio run for an orphaned queue run (injected: the contract verbs live in cli.ts);
 * `state`: the studio run's terminal state once ended (or already). */
export type StudioEnder = (run: QueueRun, reason: string) => Promise<{ ok: boolean; detail: string; state?: string }>;
/** Looks up the job's studio run absent from the pre-verb snapshot (the 21-1
 * adoption rule): `run_id` null when none exists; `ok: false` when the lookup failed. */
export type StudioFinder = (run: QueueRun, snapshot: string[]) =>
  Promise<{ ok: true; run_id: string | null } | { ok: false; detail: string }>;
/** A tripped guard as named on a run (cli.ts `GuardTrip`). */
export interface TripRecord { guard: string; value: number }
/** Whether a dead owner's skill run (with its studio run recorded) resumes: yes,
 * with the detail the `resumed` event carries; or no, naming the cause (appended
 * to `orphaned: supervisor restart`), the guards that tripped, and the studio
 * run's own terminal state when it already ended (the queue run ends in it). */
export type ResumeDecision =
  | { resume: true; detail?: Record<string, unknown> }
  | { resume: false; cause?: string; trips?: TripRecord[]; studioState?: TerminalState };
export type StudioResumer = (run: QueueRun) => Promise<ResumeDecision>;
export interface StudioOps { end: StudioEnder; find: StudioFinder; resume?: StudioResumer }

export interface RecoverReport {
  ended: { run_id: string; studio_run_id: string | null; studio: { ok: boolean; detail: string } | null; reason: string; engine?: Record<string, unknown>; state?: TerminalState }[];
  requeued: string[];
  /** Runs taken over for a resume (driven by the caller): the resume count after the takeover. */
  resumed: { run_id: string; studio_run_id: string; resume: number }[];
  /** Runs left as they are: their recorded worker may still run (it could not be matched
   * or killed, or an sbx worker's in-VM deadline has not passed). */
  held?: { run_id: string; worker: WorkerKill }[];
  /** Ended runs that had kept their checkout lock (an sbx worker that may have still run in
   * the VM), whose lock was freed once their recorded worker may no longer run. */
  released?: { run_id: string; worker?: WorkerKill }[];
}

/** What happened to (or where stands) a recorded worker before its run was resumed or its lock released. */
export interface WorkerKill {
  pid: number; start: string | null;
  outcome: "killed" | "group killed" | "not running" | "start time differs" | "start time unreadable" | "kill failed"
    | "running" | "group alive" | "in-VM deadline not passed" | "in-VM deadline passed"
    /** Story 27.2: an in-VM engine still running as recorded after its kill-by-pid and the wait (DW-3: held). */
    | "engine alive after kill";
  detail?: string;
  /** sbx: the in-VM deadline (recorded spawn + guard seconds + the `-k` grace), ISO. */
  deadline?: string;
  /** sbx, once the deadline passed: what the best-effort kill of the host `sbx exec` answered. */
  host?: WorkerKill;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL, project_id TEXT,
  definition TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
  PRIMARY KEY (job_id, checkout)
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL,
  project_id TEXT, target TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued','running','complete','partial','blocked','cancelled','paused','external')),
  reason TEXT, owner_pid INTEGER, owner_host TEXT, owner_nonce TEXT, owner_start TEXT,
  studio_run_id TEXT, engine_run_id TEXT, verb_started TEXT, verb_snapshot TEXT, definition TEXT,
  permission_mode TEXT, tier TEXT, sandbox TEXT, model TEXT, effort TEXT, base_ref TEXT,
  session_id TEXT, worker_pid INTEGER, worker_start TEXT, worker_guard_s INTEGER, wake TEXT,
  editor_in_the_loop INTEGER, notified TEXT, base_ref_source TEXT, worktree TEXT, engine_pid INTEGER, engine_start TEXT,
  created TEXT NOT NULL, updated TEXT NOT NULL,
  FOREIGN KEY (job_id, checkout) REFERENCES jobs (job_id, checkout)
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_one_live ON runs (job_id, checkout) WHERE state IN ('queued','running','paused','external');
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL,
  from_state TEXT, to_state TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS events_run ON events (run_id, seq);
CREATE TABLE IF NOT EXISTS locks (
  checkout TEXT PRIMARY KEY, root TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('run','engine')),
  run_id TEXT NOT NULL, job_id TEXT NOT NULL, owner_pid INTEGER, owner_host TEXT, owner_nonce TEXT, owner_start TEXT,
  engine_run_id TEXT, acquired TEXT NOT NULL
);
`;

/** The end-hygiene marker (Story 22.3): the one run column a terminal run may still have set, once. */
const NOTIFIED_COLUMN = "notified";
/** The marker the migration writes on runs already terminal when a queue file gains the column:
 * they are never notified (no history flood). */
export const NOTIFIED_BEFORE = "before-end-hygiene";

/** The end-hygiene marker's shapes (Story 22.3): `claimEnd` writes a lease
 * `lease <ISO time> pid <pid>@<host>`; once the notification and transcript-copy outcomes are
 * recorded `finishEnd` turns it into `done <ISO time> pid <pid>@<host>`. A lease older than
 * END_LEASE_STALE_MS is a claimant that died between the claim and the send: a later sweep
 * re-claims it. Any other non-null value (NOTIFIED_BEFORE included) is done. */
const LEASE_PREFIX = "lease ";
const DONE_PREFIX = "done ";
/** How old a lease must be before another sweep may take it over (10 minutes: a send is bounded
 * to 15 s and a transcript copy to a local file copy, so a live claimant is long finished). */
export const END_LEASE_STALE_MS = 10 * 60_000;
/** The ISO time inside a lease marker (`lease ` + 24 characters of `toISOString()`), as SQL. */
const leaseAtSql = (row: string) => `substr(${row}.${NOTIFIED_COLUMN}, ${LEASE_PREFIX.length + 1}, 24)`;

/** A terminal run is immutable: every column but the end-hygiene marker (recreated on each open
 * from the table's own columns, so a column added later is covered too); the marker is set once. */
function immutabilityTriggers(columns: string[]): string {
  const cols = columns.filter((c) => c !== NOTIFIED_COLUMN).join(", ");
  return `
DROP TRIGGER IF EXISTS runs_terminal_immutable;
CREATE TRIGGER runs_terminal_immutable BEFORE UPDATE OF ${cols} ON runs
  WHEN OLD.state IN ('complete','partial','blocked','cancelled')
  BEGIN SELECT RAISE(ABORT, 'RunTerminal: a terminal queue run is immutable'); END;
DROP TRIGGER IF EXISTS runs_notified_once;
CREATE TRIGGER runs_notified_once BEFORE UPDATE OF ${NOTIFIED_COLUMN} ON runs
  WHEN NOT COALESCE(OLD.state IN ('complete','partial','blocked','cancelled') AND (
      (OLD.${NOTIFIED_COLUMN} IS NULL AND NEW.${NOTIFIED_COLUMN} LIKE '${LEASE_PREFIX}%')
      OR (OLD.${NOTIFIED_COLUMN} LIKE '${LEASE_PREFIX}%' AND NEW.${NOTIFIED_COLUMN} LIKE '${LEASE_PREFIX}%'
          AND julianday(${leaseAtSql("OLD")}) <= julianday('now') - ${END_LEASE_STALE_MS / 86_400_000})
      OR (OLD.${NOTIFIED_COLUMN} LIKE '${LEASE_PREFIX}%' AND NEW.${NOTIFIED_COLUMN} LIKE '${DONE_PREFIX}%')
    ), 0)
  BEGIN SELECT RAISE(ABORT, 'EndClaimed: a run end is leased once terminal, re-leased only once stale, then done'); END;
`;
}

/** Nullable run columns added after the first schema: an existing queue file
 * gains each one it lacks (guarded by PRAGMA table_info). */
const ADDED_RUN_COLUMNS = [
  ["permission_mode", "TEXT"], ["tier", "TEXT"], ["sandbox", "TEXT"], ["model", "TEXT"], ["effort", "TEXT"],
  ["session_id", "TEXT"], ["worker_pid", "INTEGER"], ["worker_start", "TEXT"], ["wake", "TEXT"], ["worker_guard_s", "INTEGER"],
  ["base_ref", "TEXT"], ["editor_in_the_loop", "INTEGER"], [NOTIFIED_COLUMN, "TEXT"],
  ["base_ref_source", "TEXT"], ["worktree", "TEXT"], ["engine_pid", "INTEGER"], ["engine_start", "TEXT"],
] as const;

/** Story 27.1: the one-live-run index — a `paused` run is the job's live run too (enqueue mints no second);
 * Story 27.2: so is an `external` one. */
const LIVE_INDEX = "CREATE UNIQUE INDEX IF NOT EXISTS runs_one_live ON runs (job_id, checkout) WHERE state IN ('queued','running','paused','external')";

/** Story 27.1/27.2: an index from before `paused` or `external` is dropped and recreated with them. */
function widenLiveIndex(db: Database): void {
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'runs_one_live'").get() as { sql: string } | null;
  if (row?.sql.includes("'paused'") && row.sql.includes("'external'")) return;
  db.exec("DROP INDEX IF EXISTS runs_one_live");
  db.exec(LIVE_INDEX);
}

/** Story 27.1: a runs table whose state CHECK predates `paused` (Story 27.2: or `external`) is rebuilt once
 * (SQLite cannot alter a CHECK): the same columns and rows, the CHECK widened, the live-run index recreated. */
function widenStateCheck(db: Database): void {
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() as { sql: string } | null;
  const missing = ["'paused'", "'external'"].filter((s) => !row?.sql.includes(s));
  if (!row || !missing.length) return;
  const check = /CHECK\s*\(\s*state\s+IN\s*\(([^)]*)\)\s*\)/;
  if (!check.test(row.sql)) return;
  const ddl = row.sql.replace(check, (_m, list: string) => `CHECK (state IN (${list.trim()},${missing.join(",")}))`)
    .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?runs["`]?/i, "CREATE TABLE runs_widened");
  const cols = (db.query("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name).join(", ");
  db.exec(ddl);
  db.exec(`INSERT INTO runs_widened (${cols}) SELECT ${cols} FROM runs`);
  db.exec("DROP TABLE runs");
  db.exec("ALTER TABLE runs_widened RENAME TO runs");
  db.exec(LIVE_INDEX);
}

/** Story 27.3: the SQL test (over `runs`) that a run is launched — a `launched` event after its latest
 * `close-out` (the paused-run pass's relaunch) or `engine-resume` (`POST /runs/{id}/resume`). A relaunched or
 * resumed run carries the old `launched` event: read without this, a dead relaunch driver would never be
 * recovered and the archived engine id would be probed forever. */
export const LAUNCHED_SQL = `EXISTS (SELECT 1 FROM events e WHERE e.run_id = runs.run_id AND e.kind = 'launched'
  AND e.seq > COALESCE((SELECT MAX(x.seq) FROM events x WHERE x.run_id = runs.run_id AND x.kind IN ('close-out','engine-resume')), 0))`;

/** Story 27.1: where a run's launched engine is probed — its worktree (the engine's `--project`), else its
 * root. A worktree the close-out already removed is never probed (the probe would fail there and fail
 * closed into an unverified engine forever): its root then. */
export const engineRoot = (run: Pick<QueueRun, "root"> & { worktree?: string | null }): string =>
  run.worktree && existsSync(run.worktree) ? run.worktree : run.root;

const now = () => new Date().toISOString();
/** The newest lease time a sweep at `at` may take over (Story 22.3). */
const staleCutoff = (at: number) => new Date(at - END_LEASE_STALE_MS).toISOString();

/** Queue run ids never collide with studio run ids (`<job-id>-<UTC compact>`). */
function mintRunId(jobId: string): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `q-${jobId}-${ts}-${randomBytes(3).toString("hex")}`;
}

/** The owner recorded on a run or lock row. */
function ownerOf(row: { owner_pid: number | null; owner_host: string | null; owner_nonce: string | null; owner_start: string | null }): Owner | null {
  if (row.owner_pid === null) return null;
  return { pid: row.owner_pid, host: row.owner_host ?? "", nonce: row.owner_nonce ?? "", start: row.owner_start };
}

const ownerDetail = (o: Owner) => ({ pid: o.pid, host: o.host, nonce: o.nonce, ...(o.start ? { start: o.start } : {}) });

function holderReason(h: Holder): string {
  if (h.kind === "engine") {
    const engine = h.engine_run_id ? `bmad-loop engine ${h.engine_run_id}` : "an unverified bmad-loop engine";
    return `checkout lock held by ${engine} (launched by run ${h.run_id}, job ${h.job_id})`
      + (h.detail ? `; ${h.detail} — counted live` : "");
  }
  return `checkout lock held by run ${h.run_id} (job ${h.job_id}, pid ${h.pid ?? "?"}${h.host ? `@${h.host}` : ""})`
    + (h.detail ? `; ${h.detail}` : "");
}

/** What a claim decides on: the run, its checkout's lock, the run holding that lock. */
interface ClaimView { run: QueueRun; lock: LockRow | null; held: QueueRun | null }
/** The claim's probe results, computed outside the transaction. */
interface ClaimProbes {
  ownerLive: boolean; holderLive: boolean; launch: boolean; engine?: EngineProbe;
  /** What `recordedWorker` answered for a `running` holder with a dead owner, or an ended
   * holder that kept its lock: live (`holderLive`) while it may still run. */
  holderWorker?: WorkerKill;
}

const sameFields = <T extends object>(a: T | null, b: T | null, keys: (keyof T)[]) =>
  a === null || b === null ? a === b : keys.every((k) => a[k] === b[k]);

/** The rows a claim's probes were computed from are unchanged. */
function sameClaimView(a: ClaimView, b: ClaimView): boolean {
  return sameFields(a.run, b.run, ["state", "owner_pid", "owner_host", "owner_nonce", "owner_start"])
    && sameFields(a.lock, b.lock, ["kind", "run_id", "job_id", "owner_pid", "owner_host", "owner_nonce", "owner_start", "engine_run_id"])
    && sameFields(a.held, b.held, ["state", "definition", "tier", "worker_pid", "worker_start", "worker_guard_s"]);
}

// ------------------------------------------------------------ queue

export class Queue {
  readonly db: Database;
  readonly path: string;
  /** Kills of workers spawned for a run a cancel had already ended (`killUnrecorded`), by queue run id. */
  private readonly unrecorded = new Map<string, Promise<WorkerKill>>();

  constructor(path: string, readonly probes: Probes = defaultProbes) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA busy_timeout = 30000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.transaction(() => {
      // The immutability trigger is recreated below (its column list follows the table's columns).
      this.db.exec("DROP TRIGGER IF EXISTS runs_terminal_immutable; DROP TRIGGER IF EXISTS runs_notified_once;");
      this.db.exec(SCHEMA);
      const columns = () => (this.db.query("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
      const have = new Set(columns());
      for (const [col, type] of ADDED_RUN_COLUMNS) {
        if (!have.has(col)) this.db.exec(`ALTER TABLE runs ADD COLUMN ${col} ${type}`);
      }
      // Story 22.3: runs already terminal when the file gains the marker are never notified.
      if (!have.has(NOTIFIED_COLUMN)) {
        this.db.query(`UPDATE runs SET ${NOTIFIED_COLUMN} = ? WHERE state IN ('complete','partial','blocked','cancelled')`).run(NOTIFIED_BEFORE);
      }
      widenStateCheck(this.db);
      widenLiveIndex(this.db);
      this.db.exec(immutabilityTriggers(columns()));
    }).immediate();
  }

  /** Open the queue at `TK_SUPERVISOR_DB` (placement checked before creation). */
  static open(env: Env = process.env, probes: Probes = defaultProbes): Queue {
    return new Queue(queueDbPath(env), probes);
  }

  close(): void { this.db.close(); }

  get(runId: string): QueueRun | null {
    return (this.db.query("SELECT * FROM runs WHERE run_id = ?").get(runId) as QueueRun | null) ?? null;
  }

  runs(): QueueRun[] {
    return this.db.query("SELECT * FROM runs ORDER BY created, rowid").all() as QueueRun[];
  }

  /** Events in seq order: one run's, or all; with `since`, only those with `seq > since`. */
  events(runId?: string, since?: number): QueueEvent[] {
    const after = since ?? -1;
    const rows = (runId
      ? this.db.query("SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq").all(runId, after)
      : this.db.query("SELECT * FROM events WHERE seq > ? ORDER BY seq").all(after)) as (Omit<QueueEvent, "detail"> & { detail: string | null })[];
    return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  }

  /** The submitted jobs (one per job + checkout), with the resolved definition parsed. */
  jobs(): { job_id: string; checkout: string; root: string; project_id: string | null; definition: Record<string, unknown> | null; created: string; updated: string }[] {
    const rows = this.db.query("SELECT * FROM jobs ORDER BY created, rowid").all() as
      { job_id: string; checkout: string; root: string; project_id: string | null; definition: string; created: string; updated: string }[];
    return rows.map((r) => {
      let definition: Record<string, unknown> | null = null;
      try { definition = JSON.parse(r.definition); } catch { /* unreadable: null */ }
      return { ...r, definition };
    });
  }

  /** Every held checkout lock, oldest first. */
  locks(): LockRow[] {
    return this.db.query("SELECT * FROM locks ORDER BY acquired, rowid").all() as LockRow[];
  }

  /** The pacer's read for one (job, checkout), as seen by `self` (owner liveness). */
  pacing(jobId: string, root: string, self: Owner = selfOwner()): JobPacing {
    const checkout = checkoutKey(root);
    const runs = this.db.query("SELECT * FROM runs WHERE job_id = ? AND checkout = ? ORDER BY created, rowid").all(jobId, checkout) as QueueRun[];
    const live: QueueRun[] = [], adoptable: QueueRun[] = [];
    for (const r of runs) {
      if (r.state === "running" || r.state === "paused" || r.state === "external" || (r.state === "queued" && this.ownerLive(ownerOf(r), self))) live.push(r);
      else if (r.state === "queued") adoptable.push(r);
    }
    // Terminal runs in the order they ended (the ending event's seq; one with no event first, by `updated`).
    const ends = runs.filter((r) => isTerminal(r.state)).map((r) => {
      const ev = this.db.query("SELECT seq, at, detail FROM events WHERE run_id = ? AND kind IN ('ended', 'orphaned') ORDER BY seq DESC LIMIT 1")
        .get(r.run_id) as { seq: number; at: string; detail: string | null } | null;
      let detail: Record<string, unknown> | null = null;
      try { detail = ev?.detail ? JSON.parse(ev.detail) : null; } catch { /* unreadable: no marker */ }
      return { run: r, seq: ev?.seq ?? 0, at: ev?.at ?? r.updated, detail };
    }).sort((x, y) => x.seq - y.seq || Date.parse(x.at) - Date.parse(y.at));
    let stopped: QueueEvent | null = null;
    for (const e of ends) {
      const stop = this.events(e.run.run_id).filter((ev) => ev.kind === "stopped").at(-1);
      if (stop) stopped = stop;
      else if (e.detail?.studio_outcome) stopped = null; // the studio ran a later run to a terminal state
    }
    const last = ends.at(-1);
    return { live, adoptable, lastEnded: last?.at ?? null, latestTerminal: last?.run ?? null, stopped };
  }

  lock(root: string): LockRow | null {
    return (this.db.query("SELECT * FROM locks WHERE checkout = ?").get(checkoutKey(root)) as LockRow | null) ?? null;
  }

  /** The definition a run was driven with (recorded at `verb_started`),
   * else the stored (resolved) definition of its job. */
  definition(run: Pick<QueueRun, "job_id" | "checkout"> & { definition?: string | null }): Record<string, any> | null {
    if (run.definition) { try { return JSON.parse(run.definition); } catch { /* fall back to the job row */ } }
    const row = this.db.query("SELECT definition FROM jobs WHERE job_id = ? AND checkout = ?").get(run.job_id, run.checkout) as { definition: string } | null;
    try { return row ? JSON.parse(row.definition) : null; } catch { return null; }
  }

  /** Is `owner` (recorded on a row) alive, as seen by `self`? Mine (same
   * nonce) is alive; another nonce with my host + pid is a dead predecessor
   * whose pid this process reuses; anything else asks the owner probe. */
  private ownerLive(owner: Owner | null, self: Owner): boolean {
    if (!owner) return false;
    if (owner.nonce === self.nonce) return true;
    if (owner.host === self.host && owner.pid === self.pid) return false;
    return this.probes.ownerAlive(owner);
  }

  /** Is the run's recorded owner alive, as seen by `self` (the owner probe, never a signal)? */
  ownerAlive(run: QueueRun, self: Owner = selfOwner()): boolean {
    return this.ownerLive(ownerOf(run), self);
  }

  /** The in-VM deadline of an sbx run's recorded worker: its recorded spawn time (the
   * latest `worker` event) + the guard seconds passed to that spawn (a record without
   * them: the job's own guard, which bounds every spawn) + the `timeout -k` grace. */
  sbxDeadline(run: QueueRun): { ms: number; guardS: number } {
    const ev = this.db.query("SELECT at FROM events WHERE run_id = ? AND kind = 'worker' ORDER BY seq DESC LIMIT 1").get(run.run_id) as { at: string } | null;
    const spawned = Date.parse(ev?.at ?? run.updated);
    const guardS = run.worker_guard_s ?? (Number(this.definition(run)?.guards?.max_wall_clock_seconds) || 600);
    return { ms: (Number.isFinite(spawned) ? spawned : Date.now()) + (guardS + SBX_GUARD_KILL_AFTER_S) * 1000, guardS };
  }

  /** The one "may the recorded worker still run" predicate every path that frees a
   * checkout lock asks — `recover` (with `kill`) and `claim` (a probe, never a signal):
   * no worker recorded → no; sbx → while its in-VM deadline has not passed (decided
   * from the deadline, never from the host `sbx exec` pid; once passed, `kill` still
   * kills a lingering host process best-effort); host → the pid + start time probe
   * (or kill), then `workerMayRun`. */
  async recordedWorker(run: QueueRun, kill: boolean, opts: { engine?: boolean } = {}): Promise<{ mayRun: boolean; worker?: WorkerKill }> {
    // Story 27.2 (DW-3): a run whose last engine kill left its in-VM engine alive may still run while
    // that engine pid does (re-probed; `engine: false` — the cancel that just killed it — skips this).
    if (opts.engine !== false) {
      const engine = await this.engineAliveAfterKill(run);
      if (engine) return { mayRun: true, worker: engine };
    }
    if (run.worker_pid === null || run.worker_pid === undefined) return { mayRun: false };
    const pid = run.worker_pid, start = run.worker_start;
    if (run.tier === "sbx") {
      const { ms } = this.sbxDeadline(run);
      const deadline = new Date(ms).toISOString();
      if ((this.probes.now?.() ?? Date.now()) < ms) {
        return { mayRun: true, worker: { pid, start, outcome: "in-VM deadline not passed", deadline,
          detail: `held until ${deadline}: the in-VM worker may run until its timeout (the recorded pid is the host sbx exec)` } };
      }
      const host = kill ? await (this.probes.killWorker ?? killRecordedWorker)(pid, start) : undefined;
      return { mayRun: false, worker: { pid, start, outcome: "in-VM deadline passed", deadline, ...(host ? { host } : {}) } };
    }
    const worker = kill ? await (this.probes.killWorker ?? killRecordedWorker)(pid, start)
      : (this.probes.probeWorker ?? probeRecordedWorker)(pid, start);
    return { mayRun: workerMayRun(worker), worker };
  }

  /** Story 27.2 (DW-3): when the run's last recorded engine kill (`engine-kill`) is `engine alive after
   * kill` — or `start time unreadable` (its first probe could not be read, so nothing was signalled; it
   * carries the recorded start) — its engine pid is probed again (`sbx exec <sb> cat /proc/<pid>/stat`,
   * argv only, the start time matched): answers that kill while the engine still runs as recorded (an
   * unreadable probe counts as alive — fail closed), else undefined. Once the probe shows it gone (or a
   * different start time), an `engine-gone` event is recorded, so later checks proceed without probing.
   * Never throws. */
  async engineAliveAfterKill(run: QueueRun): Promise<WorkerKill | undefined> {
    const ev = this.db.query("SELECT kind, detail FROM events WHERE run_id = ? AND kind IN ('engine-kill', 'engine-gone') ORDER BY seq DESC LIMIT 1")
      .get(run.run_id) as { kind: string; detail: string | null } | null;
    if (ev?.kind !== "engine-kill") return undefined;
    let d: Record<string, any> | null = null;
    try { d = ev.detail ? JSON.parse(ev.detail) : null; } catch { return undefined; }
    const w = d?.worker as WorkerKill | undefined;
    const held = w?.outcome === "engine alive after kill"
      || (w?.outcome === "start time unreadable" && typeof w.start === "string" && !!w.start);
    if (!w || !held || !Number.isInteger(w.pid)) return undefined;
    const sb = typeof d?.sandbox === "string" && d.sandbox ? d.sandbox : run.sandbox;
    if (!sb) return { ...w, detail: `${w.detail ?? w.outcome}; no sandbox recorded to probe it again` };
    let p: ProbeResult;
    try { p = await (this.probes.engineProbe ?? ((s: string, pid: number) => probeEngine(s, pid)))(sb, w.pid); }
    catch (e) { p = { unreadable: e instanceof Error ? e.message : String(e) }; }
    if ("unreadable" in p) return { ...w, detail: `pid ${w.pid} in ${sb} may still run: its probe failed (${p.unreadable.slice(0, 200)})` };
    if (p.alive && sameStart(p.start, w.start)) return { ...w, detail: `pid ${w.pid} still runs in ${sb} (probed again after ${w.outcome === "engine alive after kill" ? "its kill" : "its unreadable first probe"})` };
    try {
      const cur = this.get(run.run_id);
      this.event(run.run_id, "engine-gone", cur?.state ?? run.state, cur?.state ?? run.state,
        { sandbox: sb, pid: w.pid, start: w.start, probe: p.alive ? `start time differs (now ${p.start})` : "not running" });
    } catch { /* the queue is busy: the next check probes again */ }
    return undefined;
  }

  /** Story 27.2: is a pin on sandbox `sb` still outstanding — some run recording that sandbox pinned it
   * (`pinned`), and no release (`pin-released`) was recorded on any run recording it since? */
  pinOutstanding(sb: string): boolean {
    const row = this.db.query(
      `SELECT MAX(CASE WHEN e.kind = 'pinned' THEN e.seq END) AS pinned, MAX(CASE WHEN e.kind = 'pin-released' THEN e.seq END) AS released
         FROM events e JOIN runs r ON r.run_id = e.run_id WHERE r.sandbox = ? AND e.kind IN ('pinned', 'pin-released')`,
    ).get(sb) as { pinned: number | null; released: number | null } | null;
    return row?.pinned != null && (row.released == null || row.pinned > row.released);
  }

  private event(runId: string, kind: string, from: string | null, to: string, detail?: Record<string, unknown>): void {
    this.db.query("INSERT INTO events (run_id, at, kind, from_state, to_state, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, now(), kind, from, to, detail && Object.keys(detail).length ? JSON.stringify(detail) : null);
  }

  private must(runId: string): QueueRun {
    const run = this.get(runId);
    if (!run) throw new Error(`queue run '${runId}' not found`);
    return run;
  }

  /** Idempotent mint: validated input only (the caller ran `resolve`). While a
   * run of this job on this checkout is `queued` or `running`, nothing is
   * minted and that run is answered. An explicit `permissionMode` is stored on
   * the minted run, or recorded on the adopted run while it is `queued`; so are
   * the worker options (tier, sandbox, model, effort). */
  enqueue(input: {
    jobId: string; root: string; projectId?: string | null; target?: string | null;
    definition: Record<string, unknown>; owner?: Owner | null; permissionMode?: string | null;
    /** Story 22.3: the submission's editor-in-the-loop flag (stored like `tier`). */
    editorInTheLoop?: boolean;
  } & RunOptionsRecord): { run: QueueRun; minted: boolean } {
    const checkout = checkoutKey(input.root);
    return this.db.transaction(() => {
      const live = this.db.query(
        "SELECT * FROM runs WHERE job_id = ? AND checkout = ? AND state IN ('queued','running','paused','external') ORDER BY created LIMIT 1",
      ).get(input.jobId, checkout) as QueueRun | null;
      if (live) {
        if (input.permissionMode) this.writePermissionMode(live, input.permissionMode);
        this.writeRunOptions(this.must(live.run_id), input);
        if (input.editorInTheLoop) this.writeEditorInTheLoop(this.must(live.run_id));
        return { run: this.must(live.run_id), minted: false };
      }
      const at = now();
      this.db.query(
        `INSERT INTO jobs (job_id, checkout, root, project_id, definition, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (job_id, checkout) DO UPDATE SET root = excluded.root, project_id = excluded.project_id,
           definition = excluded.definition, updated = excluded.updated`,
      ).run(input.jobId, checkout, input.root, input.projectId ?? null, JSON.stringify(input.definition), at, at);
      const runId = mintRunId(input.jobId);
      const owner = input.owner ?? null;
      const mode = input.permissionMode || null;
      const opts = Object.fromEntries(RUN_OPTION_KEYS.map((k) => [k, input[k] || null])) as Record<(typeof RUN_OPTION_KEYS)[number], string | null>;
      const flagged = input.editorInTheLoop ? 1 : null;
      this.db.query(
        `INSERT INTO runs (run_id, job_id, checkout, root, project_id, target, state, reason, owner_pid, owner_host,
           owner_nonce, owner_start, permission_mode, tier, sandbox, model, effort, base_ref, editor_in_the_loop, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(runId, input.jobId, checkout, input.root, input.projectId ?? null, input.target ?? null,
        owner?.pid ?? null, owner?.host ?? null, owner?.nonce ?? null, owner?.start ?? null, mode,
        opts.tier, opts.sandbox, opts.model, opts.effort, opts.base_ref, flagged, at, at);
      this.event(runId, "enqueued", null, "queued", {
        ...(owner ? { owner: ownerDetail(owner) } : {}), ...(mode ? { permission_mode: mode } : {}),
        ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== null)),
        ...(flagged ? { editor_in_the_loop: true } : {}),
      });
      return { run: this.must(runId), minted: true };
    }).immediate();
  }

  /** Record the caller's explicit permission mode on a `queued` run (a run
   * already running or ended keeps the mode it was driven under). */
  recordPermissionMode(runId: string, mode: string): QueueRun {
    return this.db.transaction(() => {
      this.writePermissionMode(this.must(runId), mode);
      return this.must(runId);
    }).immediate();
  }

  /** Record worker options (tier, sandbox, model, effort) on a `queued` run —
   * a run already running or ended keeps the options it was driven under.
   * Absent/null fields are left as recorded; a change writes one `run-options` event. */
  recordRunOptions(runId: string, opts: RunOptionsRecord): QueueRun {
    return this.db.transaction(() => {
      this.writeRunOptions(this.must(runId), opts);
      return this.must(runId);
    }).immediate();
  }

  /** Inside a transaction: the given options that differ are written, with one `run-options` event. */
  private writeRunOptions(run: QueueRun, opts: RunOptionsRecord): void {
    if (run.state !== "queued") return;
    const changed = RUN_OPTION_KEYS.filter((k) => opts[k] && opts[k] !== run[k]);
    if (!changed.length) return;
    this.db.query(`UPDATE runs SET ${changed.map((k) => `${k} = ?`).join(", ")}, updated = ? WHERE run_id = ?`)
      .run(...changed.map((k) => opts[k] as string), now(), run.run_id);
    this.event(run.run_id, "run-options", run.state, run.state, {
      ...Object.fromEntries(changed.map((k) => [k, opts[k]])),
      previous: Object.fromEntries(changed.map((k) => [k, run[k]])),
    });
  }

  /** Inside a transaction: a `queued` run not yet flagged editor-in-the-loop is flagged, with a `run-options` event. */
  private writeEditorInTheLoop(run: QueueRun): void {
    if (run.state !== "queued" || run.editor_in_the_loop) return;
    this.db.query("UPDATE runs SET editor_in_the_loop = 1, updated = ? WHERE run_id = ?").run(now(), run.run_id);
    this.event(run.run_id, "run-options", run.state, run.state, { editor_in_the_loop: true, previous: { editor_in_the_loop: null } });
  }

  /** Inside a transaction: a `queued` run whose recorded mode differs takes `mode`, with its event. */
  private writePermissionMode(run: QueueRun, mode: string): void {
    if (run.state !== "queued" || run.permission_mode === mode) return;
    this.db.query("UPDATE runs SET permission_mode = ?, updated = ? WHERE run_id = ?").run(mode, now(), run.run_id);
    this.event(run.run_id, "permission-mode", run.state, run.state, { permission_mode: mode, previous: run.permission_mode });
  }

  /** Take the checkout lock and move the run to `running`, or leave it
   * `queued` naming the live holder. Every owner and engine probe runs outside
   * the transaction (a probe may spawn a process — PowerShell on win32 — and
   * must never hold the write lock): the transaction re-reads the rows the
   * probes were computed from and retries if any of them changed. A `running`
   * holder with a dead owner is live while its recorded worker may still run
   * (`recordedWorker`: the pid alive with a matching or unreadable start time,
   * its process group alive, or an sbx in-VM deadline not passed). */
  async claim(runId: string, owner: Owner = selfOwner()): Promise<ClaimResult> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const seen = this.claimView(runId);
      const p = await this.claimProbes(seen, runId, owner);
      const out = this.db.transaction((): ClaimResult | "retry" => {
        const view = this.claimView(runId);
        if (!sameClaimView(seen, view)) return "retry";
        const { run, lock, held } = view;
        if (isTerminal(run.state)) {
          return { claimed: false, run, why: "terminal", reason: `run ${runId} already ended ${run.state}` };
        }
        const mine = run.owner_nonce !== null && run.owner_nonce === owner.nonce;
        if (run.state === "paused") {
          // Story 27.1: a paused launch run is continued by its resume, never claimed again.
          return { claimed: false, run, why: "running", reason: `run ${runId} is paused (its engine paused; the resume continues it)` };
        }
        if (run.state === "external") {
          // Story 27.2: a studio run started outside the queue: never driven here; it ends with its studio run.
          return { claimed: false, run, why: "running", reason: `run ${runId} is external (studio run ${run.studio_run_id ?? "?"} started outside the queue)` };
        }
        if (run.state === "running") {
          if (mine) return { claimed: true, run };
          return {
            claimed: false, run, why: "running",
            reason: `run ${runId} is already running (pid ${run.owner_pid ?? "?"}${run.owner_host ? `@${run.owner_host}` : ""})`,
          };
        }
        if (!mine && p.ownerLive) {
          return {
            claimed: false, run, why: "owned",
            reason: `run ${runId} is queued under a live owner (pid ${run.owner_pid}${run.owner_host ? `@${run.owner_host}` : ""})`,
          };
        }
        const detail: Record<string, unknown> = { owner: ownerDetail(owner) };
        if (lock && lock.run_id !== runId) {
          let holder: Holder | undefined;
          const pausedHolder = this.get(lock.run_id)?.state === "paused";
          if (pausedHolder) {
            // Story 27.1: a paused run keeps its checkout lock (and its worktree) for the resume.
            holder = { kind: lock.kind, run_id: lock.run_id, job_id: lock.job_id,
              ...(lock.kind === "engine" ? { engine_run_id: lock.engine_run_id } : { pid: lock.owner_pid, host: lock.owner_host }),
              detail: "its run is paused: the lock is kept for the resume" };
          } else if (lock.kind === "engine") {
            const probe = p.engine!;
            if (probe.live) {
              const engineId = lock.engine_run_id ?? (probe.run_ids?.length ? probe.run_ids.join(",") : null);
              holder = { kind: "engine", run_id: lock.run_id, job_id: lock.job_id, engine_run_id: engineId,
                ...(probe.detail ? { detail: probe.detail } : {}) };
            } else {
              detail.released = { kind: "engine", engine_run_id: lock.engine_run_id, run_id: lock.run_id, why: "engine no longer live" };
            }
          } else if (p.holderLive) {
            const w = p.holderWorker;
            const who = held && isTerminal(held.state) ? `run ended ${held.state}` : "owner dead";
            holder = { kind: "run", run_id: lock.run_id, job_id: lock.job_id, pid: lock.owner_pid, host: lock.owner_host,
              ...(w ? { detail: `${who}, its recorded worker (pid ${w.pid}) may still run: ${w.outcome}${w.deadline ? ` until ${w.deadline}` : ""}` } : {}) };
          } else if (p.launch && p.engine!.live) {
            // The stale launch run's engine (or an unverified one, on a failed probe) takes the lock over.
            const probe = p.engine!;
            const engineId = probe.detail ? null : probe.run_ids?.[0] ?? null;
            this.handToEngine(lock, engineId);
            holder = { kind: "engine", run_id: lock.run_id, job_id: lock.job_id, engine_run_id: engineId,
              ...(probe.detail ? { detail: probe.detail } : {}) };
            detail.handover = { from_run: lock.run_id, why: `holder ${held ? held.state : "missing"} (a tk-studio-launch run)`, to_engine: engineId ?? "unverified" };
          } else {
            detail.released = { kind: "run", run_id: lock.run_id, why: `holder ${held ? held.state : "missing"}${held?.state === "running" ? " with a dead owner" : ""}`,
              ...(p.holderWorker ? { worker: p.holderWorker } : {}) };
          }
          if (holder) {
            const reason = `waiting: ${holderReason(holder)}`;
            this.db.query("UPDATE runs SET reason = ?, owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL, updated = ? WHERE run_id = ?")
              .run(reason, now(), runId);
            this.event(runId, "lock-wait", "queued", "queued", { holder, ...(detail.handover ? { handover: detail.handover } : {}) });
            return { claimed: false, run: this.must(runId), why: "lock", reason, holder };
          }
        }
        this.db.query(
          `INSERT INTO locks (checkout, root, kind, run_id, job_id, owner_pid, owner_host, owner_nonce, owner_start, engine_run_id, acquired)
           VALUES (?, ?, 'run', ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT (checkout) DO UPDATE SET root = excluded.root, kind = 'run', run_id = excluded.run_id,
             job_id = excluded.job_id, owner_pid = excluded.owner_pid, owner_host = excluded.owner_host,
             owner_nonce = excluded.owner_nonce, owner_start = excluded.owner_start,
             engine_run_id = NULL, acquired = excluded.acquired`,
        ).run(run.checkout, run.root, runId, run.job_id, owner.pid, owner.host, owner.nonce, owner.start ?? null, now());
        this.db.query(
          `UPDATE runs SET state = 'running', reason = NULL, owner_pid = ?, owner_host = ?, owner_nonce = ?, owner_start = ?,
             updated = ? WHERE run_id = ?`,
        ).run(owner.pid, owner.host, owner.nonce, owner.start ?? null, now(), runId);
        this.event(runId, "claimed", "queued", "running", detail);
        return { claimed: true, run: this.must(runId) };
      }).immediate();
      if (out !== "retry") return out;
    }
    throw new Error(`claim ${runId}: the run or its checkout lock kept changing under the owner/engine probes`);
  }

  /** The rows a claim decides on: the run, its checkout's lock, and the run holding that lock. */
  private claimView(runId: string): ClaimView {
    const run = this.must(runId);
    const lock = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(run.checkout) as LockRow | null;
    const held = lock?.kind === "run" && lock.run_id !== runId ? this.get(lock.run_id) : null;
    return { run, lock, held };
  }

  /** The probes a claim needs, run on a view read outside any transaction:
   * is the queued run's owner alive; is the lock's run holder alive; is a
   * stale holder a `tk-studio-launch` run (its driven definition, else the
   * job's); and the engine probe for an engine holder or a stale launch holder. */
  private async claimProbes(view: ClaimView, runId: string, self: Owner): Promise<ClaimProbes> {
    const { run, lock, held } = view;
    const out: ClaimProbes = { ownerLive: false, holderLive: false, launch: false };
    if (isTerminal(run.state) || run.state === "running" || run.state === "external") return out;
    const mine = run.owner_nonce !== null && run.owner_nonce === self.nonce;
    if (!mine && (out.ownerLive = this.ownerLive(ownerOf(run), self))) return out;
    if (!lock || lock.run_id === runId) return out;
    if (this.get(lock.run_id)?.state === "paused") return out; // Story 27.1: held for the resume, nothing to probe
    if (lock.kind === "engine") {
      out.engine = await this.probes.engineLive(this.lockRoot(lock), lock.engine_run_id);
      // Story 27.2 (DW-3): an engine its run's kill left alive in the VM holds the lock while its pid runs.
      const lockRun = out.engine.live ? null : this.get(lock.run_id);
      const alive = lockRun ? await this.engineAliveAfterKill(lockRun) : undefined;
      if (alive) out.engine = { live: true, detail: `engine pid ${alive.pid} alive after its kill: ${alive.detail ?? alive.outcome}` };
      return out;
    }
    // A running holder with a live owner — or a run ended with no worker recorded that kept its
    // lock for its live driver (`end`'s `driverLive`) — is live while that owner lives.
    out.holderLive = (held?.state === "running" || (!!held && isTerminal(held.state) && held.worker_pid == null))
      && this.ownerLive(ownerOf(lock), self);
    if (!out.holderLive && held && (held.state === "running" || isTerminal(held.state))) {
      // A dead owner's running holder — or an ended run that kept its lock (`holdLock`) — is live
      // while its recorded worker may still run (never a lock freed under it).
      const w = await this.recordedWorker(held, false);
      if (w.mayRun) out.holderLive = true;
      out.holderWorker = w.worker;
    }
    const defn = held ? this.definition(held) : this.definition({ job_id: lock.job_id, checkout: lock.checkout });
    out.launch = !out.holderLive && defn?.target?.skill === LAUNCH_SKILL;
    // A stale launch-run holder may have started a detached engine: probe before taking over (AD: one engine per checkout).
    if (out.launch) out.engine = await this.probes.engineLive(held ? engineRoot(held) : this.lockRoot(lock), null);
    return out;
  }

  /** Where a lock's engine is probed: its recorded root, else — a worktree since removed — its run's root
   * (as `engineRoot`: a removed path is never probed). */
  private lockRoot(lock: LockRow): string {
    if (existsSync(lock.root)) return lock.root;
    const run = this.get(lock.run_id);
    return run ? engineRoot(run) : lock.root;
  }

  /** The run reached the studio's minting verb: recorded just before
   * `submit`/`wake`, with the job's studio run ids from the pre-verb snapshot. */
  markVerbStarted(
    runId: string, verb: string, snapshot: readonly string[],
    driven?: { target: string; definition: Record<string, unknown> },
  ): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (run.state !== "running") throw new Error(`markVerbStarted: queue run '${runId}' is ${run.state}, not running`);
      // The target and definition recovery uses are the ones actually driven (the fresh `resolve`).
      this.db.query("UPDATE runs SET verb_started = ?, verb_snapshot = ?, target = ?, definition = ?, updated = ? WHERE run_id = ?")
        .run(now(), JSON.stringify([...snapshot]), driven?.target ?? run.target,
          driven ? JSON.stringify(driven.definition) : run.definition, now(), runId);
      this.event(runId, "verb-started", run.state, run.state, {
        verb, snapshot: [...snapshot], ...(driven ? { target: driven.target } : {}),
      });
      return this.must(runId);
    }).immediate();
  }

  /** Record the studio run minted (or adopted) for this queue run. */
  setStudioRun(runId: string, studioRunId: string): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      this.db.query("UPDATE runs SET studio_run_id = ?, updated = ? WHERE run_id = ?").run(studioRunId, now(), runId);
      this.event(runId, "studio-run", run.state, run.state, { studio_run_id: studioRunId });
      return this.must(runId);
    }).immediate();
  }

  /** Inside a transaction: a `running` run records `set` with one `kind` event. */
  private recordOnRunning(runId: string, what: string, kind: string, set: Record<string, string | number | null>, detail: Record<string, unknown>): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (run.state !== "running") throw new Error(`${what}: queue run '${runId}' is ${run.state}, not running`);
      const keys = Object.keys(set);
      if (keys.length) {
        this.db.query(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated = ? WHERE run_id = ?`)
          .run(...keys.map((k) => set[k]), now(), runId);
      }
      this.event(runId, kind, run.state, run.state, detail);
      return this.must(runId);
    }).immediate();
  }

  /** Record the worker's pre-minted session id (before the worker is spawned). */
  setSession(runId: string, sessionId: string): QueueRun {
    return this.recordOnRunning(runId, "setSession", "session", { session_id: sessionId }, { session_id: sessionId });
  }

  /** Record the spawned worker: its pid (POSIX: its process group; win32: the pid), that pid's start
   * time, and the wall-clock guard seconds passed to its spawn (sbx: the in-VM `timeout`). The
   * `worker` event's time is the recorded spawn time. */
  setWorker(runId: string, pid: number, start: string | null, guardS?: number | null): QueueRun {
    const guard = typeof guardS === "number" && Number.isFinite(guardS) && guardS > 0 ? Math.ceil(guardS) : null;
    return this.recordOnRunning(runId, "setWorker", "worker", { worker_pid: pid, worker_start: start, worker_guard_s: guard },
      { pid, ...(start ? { start } : {}), ...(guard !== null ? { guard_s: guard } : {}) });
  }

  /** Record the wake/submit answer a resume rebuilds the run from (directive, routing, state). */
  setWake(runId: string, wake: Record<string, unknown>): QueueRun {
    return this.recordOnRunning(runId, "setWake", "woke", { wake: JSON.stringify(wake) }, { state: wake.state ?? null });
  }

  /** Record the transcript message ids (and their counts) `account` was given for this run. */
  recordAccounted(runId: string, ids: readonly string[], counts: { turns: number; tokens: number }, extra: Record<string, unknown> = {}): QueueRun {
    return this.recordOnRunning(runId, "recordAccounted", "accounted", {}, { ...counts, message_ids: [...ids], ...extra });
  }

  /** Every message id already accounted for this run (its `accounted` and `resumed` events). */
  accountedIds(runId: string): string[] {
    const ids = new Set<string>();
    for (const e of this.events(runId)) {
      const d = e.detail as Record<string, any> | null;
      const list = e.kind === "accounted" ? d?.message_ids : e.kind === "resumed" ? d?.accounted?.message_ids : undefined;
      if (Array.isArray(list)) for (const id of list) if (typeof id === "string") ids.add(id);
    }
    return [...ids];
  }

  /** How many times this run was resumed (its `resumed` events). */
  resumeCount(runId: string): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND kind = 'resumed'").get(runId) as { n: number }).n;
  }

  /** An in-process resume (a silent worker exit, AC2): the owner already holds the run and its lock. */
  markResumed(runId: string, detail: Record<string, unknown>): QueueRun {
    return this.recordOnRunning(runId, "markResumed", "resumed", {}, { resume: this.resumeCount(runId) + 1, ...detail });
  }

  /** Story 22.1: the driver spawned a worker it could not record — `setWorker` refused because a
   * cancel ended the run between the spawn and the record. Its own child is killed by the kill
   * the recorded-worker rule uses (`killWorker`, else `killRecordedWorker`: pid + start time,
   * never by name; the signal is sent before this returns); the driver's `endDriven` awaits
   * that kill before it frees the lock it kept (`releaseDriverLock`). */
  killUnrecorded(runId: string, pid: number, start: string | null): Promise<WorkerKill> {
    let kill: Promise<WorkerKill>;
    try { kill = (this.probes.killWorker ?? killRecordedWorker)(pid, start); }
    catch (e) { kill = Promise.reject(e); }
    const settled = kill.catch((e): WorkerKill => ({ pid, start, outcome: "kill failed", detail: e instanceof Error ? e.message : String(e) }));
    this.unrecorded.set(runId, settled);
    return settled;
  }

  /** Story 22.1: a `worker-kill` event (from/to = the run's terminal state) naming a worker
   * killed after its run ended — one the driver recorded during a cancel (after the cancel
   * read the run), or one it spawned but could not record (`killUnrecorded`). */
  noteWorkerKill(runId: string, worker: WorkerKill, why: string): void {
    this.db.transaction(() => {
      const run = this.must(runId);
      this.event(runId, "worker-kill", run.state, run.state, { why, worker });
    }).immediate();
  }

  /** Put an engine holder on the checkout lock for run `run` (inside a transaction). The lock stays
   * keyed by the checkout; its `root` is where the engine is probed (Story 27.1: the run's worktree). */
  private handToEngine(run: Pick<QueueRun, "checkout" | "root" | "run_id" | "job_id"> & { worktree?: string | null }, engineRunId: string | null): void {
    this.db.query(
      `INSERT INTO locks (checkout, root, kind, run_id, job_id, owner_pid, owner_host, owner_nonce, owner_start, engine_run_id, acquired)
       VALUES (?, ?, 'engine', ?, ?, NULL, NULL, NULL, NULL, ?, ?)
       ON CONFLICT (checkout) DO UPDATE SET kind = 'engine', root = excluded.root, run_id = excluded.run_id, job_id = excluded.job_id,
         owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL,
         engine_run_id = excluded.engine_run_id, acquired = excluded.acquired`,
    ).run(run.checkout, engineRoot(run), run.run_id, run.job_id, engineRunId, now());
  }

  /** The launch-orphan rule over this queue's probes (`probeLaunchEngine`). */
  private async launchEngine(root: string): Promise<LaunchEngine> {
    return probeLaunchEngine(this.probes, root);
  }

  /** The launch-orphan rule's probe, for a caller outside the queue (Story 21.6:
   * a `tk-studio-launch` run is never resumed beside a live or unverified engine).
   * Runs outside any transaction. */
  async launchEngineAt(root: string): Promise<LaunchEngine> {
    return this.launchEngine(root);
  }

  // ---------------------------------------------------------- worktrees and engine lifetimes (Story 27.1)

  /** A `base_ref` resolved at claim (the submission named none): recorded on the running run with
   * its source (`default`), in a `base-ref` event. */
  recordBaseRef(runId: string, baseRef: string, source: "default"): QueueRun {
    return this.recordOnRunning(runId, "recordBaseRef", "base-ref", { base_ref: baseRef, base_ref_source: source }, { base_ref: baseRef, base_ref_source: source });
  }

  /** The run's git worktree, once cut: its path on the run, a `worktree` event naming it and its branch. */
  recordWorktree(runId: string, path: string, detail: { branch: string; base_ref: string; base_ref_source?: string | null }): QueueRun {
    return this.recordOnRunning(runId, "recordWorktree", "worktree", { worktree: path }, { path, ...detail });
  }

  /** `tk-studio-launch` returned with an engine started (operator-decisions §2): the run stays
   * `running` and live for the pacer, its driver lets go (owner cleared, so `recover` never orphans
   * it), the checkout lock is handed to the engine, and a `launched` event carries the status block,
   * the engine run id and the end the close-out writes once the engine's life ends (`end`). */
  markLaunched(runId: string, engineRunId: string, detail: { status_block?: unknown; end: Record<string, unknown> }): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (run.state !== "running") throw new Error(`markLaunched: queue run '${runId}' is ${run.state}, not running`);
      this.db.query(
        `UPDATE runs SET engine_run_id = ?, owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL, updated = ? WHERE run_id = ?`,
      ).run(engineRunId, now(), runId);
      const held = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(run.checkout) as LockRow | null;
      let lock: unknown = "not held";
      if (!held || held.run_id === runId) { this.handToEngine(run, engineRunId); lock = { handed_to_engine: engineRunId }; }
      this.event(runId, "launched", run.state, run.state, { engine_run_id: engineRunId, ...detail, lock });
      return this.must(runId);
    }).immediate();
  }

  // ---------------------------------------------------------- the engine hold and external runs (Story 27.2)

  /** An sbx launch run's in-VM engine pid and its start time, on the run (a `running` or `paused` run), with
   * an `engine-pid` event naming the sandbox and the pid's source; `null`: no source named exactly one pid —
   * the event records `engine pid: unknown` and the columns are left as they are. */
  recordEnginePid(runId: string, found: { pid: number; start: string; source: string } | null, detail: Record<string, unknown> = {}): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (found) {
        this.db.query("UPDATE runs SET engine_pid = ?, engine_start = ?, updated = ? WHERE run_id = ?").run(found.pid, found.start, now(), runId);
        this.event(runId, "engine-pid", run.state, run.state, { ...detail, pid: found.pid, start: found.start, source: found.source });
      } else {
        this.event(runId, "engine-pid", run.state, run.state, { ...detail, engine_pid: "unknown" });
      }
      return this.must(runId);
    }).immediate();
  }

  /** A non-terminal studio run of a served job (its job row is in the queue) that no queue run names, started
   * outside the queue: recorded as an `external` queue run (no owner, no lock) with an `external` event
   * carrying its studio run id. Null — nothing recorded — when the job is not served, a queue run already
   * names that studio run, or the job already has a live queue run on the checkout. */
  recordExternal(jobId: string, root: string, studioRunId: string, studioState: string,
    placement: { tier?: string | null; sandbox?: string | null } = {}): QueueRun | null {
    const checkout = checkoutKey(root);
    return this.db.transaction(() => {
      const job = this.db.query("SELECT * FROM jobs WHERE job_id = ? AND checkout = ?").get(jobId, checkout) as { root: string; project_id: string | null } | null;
      if (!job) return null;
      if (this.db.query("SELECT 1 FROM runs WHERE studio_run_id = ?").get(studioRunId)) return null;
      if (this.db.query("SELECT 1 FROM runs WHERE job_id = ? AND checkout = ? AND state IN ('queued','running','paused','external')").get(jobId, checkout)) return null;
      const runId = mintRunId(jobId), at = now();
      const reason = `external: studio run ${studioRunId} was started outside the queue`;
      // The job's placement (its tier, and the sandbox on sbx) as the queue places its own runs of the job:
      // the release's other-holder check sees an external run on the same sandbox (no `sbx stop` under it).
      const tier = placement.tier ?? null, sandbox = tier === "sbx" ? placement.sandbox ?? null : null;
      this.db.query(
        `INSERT INTO runs (run_id, job_id, checkout, root, project_id, target, state, reason, studio_run_id, tier, sandbox, created, updated)
         VALUES (?, ?, ?, ?, ?, NULL, 'external', ?, ?, ?, ?, ?, ?)`,
      ).run(runId, jobId, checkout, job.root, job.project_id, reason, studioRunId, tier, sandbox, at, at);
      this.event(runId, "external", null, "external", {
        studio_run_id: studioRunId, studio_state: studioState, ...(tier ? { tier } : {}), ...(sandbox ? { sandbox } : {}),
      });
      return this.must(runId);
    }).immediate();
  }

  /** The `external` queue runs, oldest first. */
  externalRuns(): QueueRun[] {
    return this.db.query("SELECT * FROM runs WHERE state = 'external' ORDER BY created, rowid").all() as QueueRun[];
  }

  /** An external run's studio run reached a terminal state: the queue run ends in it (no longer live).
   * `vanished` (the studio no longer lists that run, or refuses it): its outcome is unknown — the queue run
   * ends `partial`, as the restart rule ends a run whose studio outcome it cannot read, the reason naming it. */
  endExternal(runId: string, state: TerminalState, vanished?: string): QueueRun {
    const run = this.must(runId);
    const sid = run.studio_run_id ?? "?";
    return this.end(runId, state, vanished ? `external: studio run ${sid} vanished: ${vanished}` : `external: studio run ${sid} ended ${state}`,
      { from: "external", detail: { external: true, studio_run_id: run.studio_run_id, ...(vanished ? { vanished } : {}) } });
  }

  /** The runs the engine-end sweep probes: `running` launch runs whose driver let go of them after
   * the launch (`markLaunched`), and `paused` runs — each with its worktree and engine recorded. Story 27.3:
   * "launched" is a `launched` event after the latest `close-out`/`engine-resume` (`LAUNCHED_SQL`), so a
   * relaunch or a resume still under its driver is never probed at the engine id it replaced. */
  awaitingEngine(): QueueRun[] {
    return this.db.query(
      `SELECT * FROM runs WHERE worktree IS NOT NULL AND (
         (engine_run_id IS NOT NULL
           AND (state = 'paused' OR (state = 'running' AND ${LAUNCHED_SQL})))
         OR (state IN ('complete','partial','blocked','cancelled')
           AND EXISTS (SELECT 1 FROM events e WHERE e.run_id = runs.run_id AND e.kind = 'ended' AND json_extract(e.detail, '$.closeout.result') = 'skipped')
           AND NOT EXISTS (SELECT 1 FROM events e WHERE e.run_id = runs.run_id AND e.kind = 'closed_out')))
       ORDER BY created, rowid`,
    ).all() as QueueRun[];
  }

  /** A close-out taken (`takeForCloseOut`) that did not finish: the owner released (only while it is
   * still `self`, on a run that is not terminal), so a later sweep can take the run again. A late
   * close-out of a terminal run (`takeEndedCloseOut`) likewise: its `closing-out` lease, while still
   * `self`'s and the run has no `closed_out`, let go of by an appended `closing-out` event with no
   * owner (the terminal row is never updated). */
  releaseCloseOut(runId: string, self: Owner = selfOwner()): void {
    this.db.transaction(() => {
      const run = this.get(runId);
      if (run && isTerminal(run.state)) {
        const evs = this.events(runId);
        if (evs.some((e) => e.kind === "closed_out")) return;
        const lease = evs.findLast((e) => e.kind === "closing-out")?.detail?.owner as Owner | null | undefined;
        if (lease?.nonce === self.nonce) this.event(runId, "closing-out", run.state, run.state, { owner: null, released: ownerDetail(self) });
        return;
      }
      this.db.query(`UPDATE runs SET owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL, updated = ?
         WHERE run_id = ? AND owner_nonce = ? AND state IN ('running','paused')`).run(now(), runId, self.nonce);
    }).immediate();
  }

  /** A terminal run whose close-out was skipped (something may still have been live): the late
   * close-out is taken atomically by appending a `closing-out` lease event (the terminal row is never
   * updated) — refused when it already has its `closed_out` event, or a lease held by a live owner
   * (a lease let go of, `releaseCloseOut`, has no owner). */
  takeEndedCloseOut(runId: string, self: Owner = selfOwner()): boolean {
    return this.db.transaction(() => {
      const run = this.get(runId);
      if (!run || !isTerminal(run.state)) return false;
      const evs = this.events(runId);
      if (evs.some((e) => e.kind === "closed_out")) return false;
      const lease = evs.findLast((e) => e.kind === "closing-out")?.detail?.owner as Owner | undefined;
      if (lease && this.ownerLive(lease, self)) return false;
      this.event(runId, "closing-out", run.state, run.state, { owner: ownerDetail(self) });
      return true;
    }).immediate();
  }

  /** What may still be live around a run before its worktree is closed out: its driver (a kept run
   * lock under a live owner), its recorded worker, or an engine in its worktree. Undefined: all dead. */
  async closeOutBlocker(run: QueueRun, self: Owner = selfOwner(), opts: { asDriver?: boolean } = {}): Promise<string | undefined> {
    // `asDriver`: asked by the run's own driver (a drive that threw), which is not what may still work the worktree.
    if (!opts.asDriver) {
      const lock = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(run.checkout) as LockRow | null;
      if (lock?.kind === "run" && lock.run_id === run.run_id && this.ownerLive(ownerOf(lock), self)) return "its driver is live";
      if (!isTerminal(run.state) && this.ownerLive(ownerOf(run), self)) return "its driver is live";
    }
    const w = await this.recordedWorker(run, false);
    if (w.mayRun) return `its recorded worker may still run (${w.worker?.outcome ?? "unknown"})`;
    if (run.engine_run_id || this.definition(run)?.target?.skill === LAUNCH_SKILL) {
      const { holder, engine } = await this.launchEngine(engineRoot(run));
      if (holder) return `an engine may still work the worktree (${holder.id ?? String(engine.detail ?? "unverified")})`;
    }
    return undefined;
  }

  /** A terminal run whose worktree was closed out and removed (its engine confirmed dead first): the
   * engine lock it still holds — which would be probed in the removed worktree — is released, with a
   * `lock-released` event. False when it holds none. */
  releaseEngineLock(runId: string, why: string): boolean {
    return this.db.transaction(() => {
      const run = this.get(runId);
      if (!run || !isTerminal(run.state)) return false;
      if (!this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ? AND kind = 'engine'").run(run.checkout, runId).changes) return false;
      this.event(runId, "lock-released", run.state, run.state, { why });
      return true;
    }).immediate();
  }

  /** The close-out takes a run awaiting its engine: atomically, only while no live process holds it
   * (no owner, or a dead one), so one close-out per engine end (a PR is never opened twice). */
  takeForCloseOut(runId: string, self: Owner = selfOwner()): QueueRun | null {
    const seen = this.get(runId);
    if (!seen || (seen.state !== "running" && seen.state !== "paused")) return null;
    if (seen.owner_pid !== null && this.ownerLive(ownerOf(seen), self)) return null;
    return this.db.transaction(() => {
      const cur = this.get(runId);
      if (!cur || cur.state !== seen.state || cur.owner_nonce !== seen.owner_nonce || cur.owner_pid !== seen.owner_pid) return null;
      this.db.query("UPDATE runs SET owner_pid = ?, owner_host = ?, owner_nonce = ?, owner_start = ?, updated = ? WHERE run_id = ?")
        .run(self.pid, self.host, self.nonce, self.start ?? null, now(), runId);
      return this.must(runId);
    }).immediate();
  }

  /** Story 27.3: a paused run moves `paused` → `running` under this process (owner = `self`, as `claim`)
   * with one `kind` event: `close-out` (the paused-run pass relaunches the epic; the checkout lock becomes
   * this process's run lock, as a claim takes it, until `markLaunched` hands it to the new engine) or
   * `engine-resume` (`POST /runs/{id}/resume`; the engine keeps its lock). Refused unless the run is paused
   * and no other live process holds it (a close-out lease this process took is its own). */
  resumeFromPause(runId: string, kind: "close-out" | "engine-resume", detail: Record<string, unknown>, self: Owner = selfOwner()): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (run.state !== "paused") throw new Error(`${kind}: queue run '${runId}' is ${run.state}, not paused`);
      if (run.owner_nonce !== null && run.owner_nonce !== self.nonce && this.ownerLive(ownerOf(run), self)) {
        throw new Error(`${kind}: queue run '${runId}' is held by a live process (pid ${run.owner_pid ?? "?"})`);
      }
      this.db.query("UPDATE runs SET state = 'running', owner_pid = ?, owner_host = ?, owner_nonce = ?, owner_start = ?, updated = ? WHERE run_id = ?")
        .run(self.pid, self.host, self.nonce, self.start ?? null, now(), runId);
      // The lock as the paused run held it, recorded on the move so `returnToPause` can put it back.
      let lock: { before: LockRow | null; taken: boolean } | undefined;
      if (kind === "close-out") {
        const held = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(run.checkout) as LockRow | null;
        lock = { before: held && held.run_id === runId ? held : null, taken: !held || held.run_id === runId };
        this.db.query(
          `INSERT INTO locks (checkout, root, kind, run_id, job_id, owner_pid, owner_host, owner_nonce, owner_start, engine_run_id, acquired)
           VALUES (?, ?, 'run', ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT (checkout) DO UPDATE SET root = excluded.root, kind = 'run', run_id = excluded.run_id,
             job_id = excluded.job_id, owner_pid = excluded.owner_pid, owner_host = excluded.owner_host,
             owner_nonce = excluded.owner_nonce, owner_start = excluded.owner_start,
             engine_run_id = NULL, acquired = excluded.acquired
           WHERE locks.run_id = excluded.run_id`,
        ).run(run.checkout, run.root, runId, run.job_id, self.pid, self.host, self.nonce, self.start ?? null, now());
      }
      this.event(runId, kind, "paused", "running", { ...detail, owner: ownerDetail(self), ...(lock ? { lock } : {}) });
      return this.must(runId);
    }).immediate();
  }

  /** Story 27.3: a run moved out of `paused` (`resumeFromPause`) whose relaunch or resume failed before its
   * engine was handed the run goes back to `paused` (as `markPaused`), and the checkout lock the `close-out`
   * move rewrote into this process's run lock is put back as the paused run held it (its engine lock; none:
   * removed). A lock the move did not take, or one since handed on (not this run's `run` lock), is left. */
  returnToPause(runId: string, detail: Record<string, unknown>): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (run.state !== "running") throw new Error(`returnToPause: queue run '${runId}' is ${run.state}, not running`);
      const move = this.db.query(
        "SELECT * FROM events WHERE run_id = ? AND kind IN ('close-out','engine-resume') ORDER BY seq DESC LIMIT 1",
      ).get(runId) as { kind: string; detail: string | null } | null;
      let restored: unknown;
      const lock = move?.kind === "close-out" ? (JSON.parse(move.detail ?? "{}") as Record<string, any>).lock : undefined;
      if (lock && lock.taken) {
        const held = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(run.checkout) as LockRow | null;
        if (held && held.run_id === runId && held.kind === "run") {
          const b = lock.before as LockRow | null;
          if (b) {
            this.db.query(
              `UPDATE locks SET root = ?, kind = ?, run_id = ?, job_id = ?, owner_pid = ?, owner_host = ?, owner_nonce = ?, owner_start = ?,
                 engine_run_id = ?, acquired = ? WHERE checkout = ?`,
            ).run(b.root, b.kind, b.run_id, b.job_id, b.owner_pid, b.owner_host, b.owner_nonce, b.owner_start, b.engine_run_id, b.acquired, run.checkout);
            restored = { kind: b.kind, engine_run_id: b.engine_run_id };
          } else {
            this.db.query("DELETE FROM locks WHERE checkout = ?").run(run.checkout);
            restored = "released (none held before the close-out)";
          }
        }
      }
      this.db.query("UPDATE runs SET state = 'paused', owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL, updated = ? WHERE run_id = ?")
        .run(now(), runId);
      this.event(runId, "paused", run.state, "paused", { ...detail, ...(restored !== undefined ? { lock_restored: restored } : {}) });
      return this.must(runId);
    }).immediate();
  }

  /** The engine paused (operator-decisions §2): the run goes `paused`, keeps its worktree and its
   * checkout lock, and the `paused` event carries the close-out (the draft PR's URL). */
  markPaused(runId: string, detail: Record<string, unknown>): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (run.state !== "running") throw new Error(`markPaused: queue run '${runId}' is ${run.state}, not running`);
      this.db.query("UPDATE runs SET state = 'paused', owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL, updated = ? WHERE run_id = ?")
        .run(now(), runId);
      this.event(runId, "paused", run.state, "paused", detail);
      return this.must(runId);
    }).immediate();
  }

  /** The engine's life ended and the close-out ran: the one `ended` event (the PR URL or "no
   * changes" in `detail`), the engine run id kept on the run, and the checkout lock it held released. */
  endEngine(runId: string, state: TerminalState, reason: string | null | undefined, opts: { detail?: Record<string, unknown>; stop?: StopDetail } = {}): QueueRun {
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      this.writeEnd(run, state, reason, { kind: "ended", ...opts, keepEngine: true });
      return this.must(runId);
    }).immediate();
  }

  /** `end` for a run this process drove. When the run reached the minting
   * verb, its driven definition targets `tk-studio-launch` and no engine is
   * named (a timeout, a missing status block, a `blocked` launch with no
   * `.bmad-loop/runs/<id>`), the launch core is probed first, outside any
   * transaction, by the launch-orphan rule `recover` uses — the core may have
   * started an engine that still works the checkout. */
  async endDriven(runId: string, state: TerminalState, reason?: string | null,
    opts: { engineRunId?: string | null; detail?: Record<string, unknown>; stop?: StopDetail; holdLock?: string; keepEngine?: boolean } = {}): Promise<QueueRun> {
    try {
      // An engine already named (Story 27.1: `null` — one the caller's own probe found unverified), or one
      // the caller's probe confirmed dead (`keepEngine`), is not probed again.
      const run = opts.engineRunId !== undefined || opts.keepEngine ? null : this.get(runId);
      if (run && run.verb_started && !isTerminal(run.state) && this.definition(run)?.target?.skill === LAUNCH_SKILL) {
        const { holder, engine } = await this.launchEngine(engineRoot(run));
        return this.end(runId, state, reason, { ...opts, ...(holder ? { engineRunId: holder.id } : {}), detail: { ...opts.detail, engine } });
      }
      return this.end(runId, state, reason, opts);
    } catch (e) {
      // Ended under its driver (a cancel): the lock it kept for this live driver is freed now the driver is done.
      if (e instanceof RunTerminal) await this.releaseDriverLock(runId);
      throw e;
    }
  }

  /** A run ended with no worker recorded that kept its checkout lock for its live driver
   * (`end`'s `driverLive`): its driver, done, frees it with a `lock-released` event. A worker
   * it spawned but could not record (`killUnrecorded`) is awaited first, named in a
   * `worker-kill` event; one that may still run keeps the lock (never freed under it). */
  private async releaseDriverLock(runId: string): Promise<void> {
    const pending = this.unrecorded.get(runId);
    this.unrecorded.delete(runId);
    const worker = pending ? await pending : undefined;
    if (worker) this.noteWorkerKill(runId, worker, "spawned after the run was cancelled, never recorded");
    if (worker && workerMayRun(worker)) return;
    this.db.transaction(() => {
      const run = this.get(runId);
      if (!run || !isTerminal(run.state) || run.worker_pid != null) return;
      if (!this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ? AND kind = 'run'").run(run.checkout, runId).changes) return;
      this.event(runId, "lock-released", run.state, run.state, { why: "its driver ended after the run was ended (no worker recorded)" });
    }).immediate();
  }

  /** Terminal transition + lock release — or, when the run launched a
   * detached bmad-loop engine, the lock is handed to that engine (`null`: an
   * unverified engine, from a failed launch probe). `stop` (AC4) writes the
   * `stopped` event (from/to = `state`) in the same transaction as `ended`.
   * `holdLock` (Story 21.6, the cause): the run's recorded worker may still run
   * (an sbx worker in the VM) — the run ends but keeps its checkout lock, which
   * `claim` and `recover` free only once `recordedWorker` says it may no longer run
   * (sbx: its in-VM deadline passed). `driverLive` (Story 22.1, a cancel): the run's live
   * driver has recorded no worker yet — `holdLock` keeps the lock without one; the driver's
   * `endDriven` frees it, else `claim`/`recover` once that owner is dead. `keepEngine` (Story 27.1):
   * the caller confirmed the run's engine dead (its worktree closed out) — the engine id is kept on
   * the run and its lock released, never handed to that engine. */
  end(runId: string, state: TerminalState, reason?: string | null,
    opts: { engineRunId?: string | null; detail?: Record<string, unknown>; from?: RunState; stop?: StopDetail; holdLock?: string; driverLive?: boolean; keepEngine?: boolean } = {}): QueueRun {
    if (!isTerminal(state)) throw new Error(`end: '${state}' is not a terminal state`);
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (opts.from && run.state !== opts.from) throw new Error(`end: queue run '${runId}' is ${run.state}, not ${opts.from}`);
      this.writeEnd(run, state, reason, { ...opts, kind: "ended" });
      return this.must(runId);
    }).immediate();
  }

  /** Inside a transaction: the terminal transition, the lock released (or handed
   * to an engine), the ending event (`ended`, or `orphaned` from `recover`), and
   * a `stop` recorded in the same transaction. The one end path. */
  private writeEnd(run: QueueRun, state: TerminalState, reason: string | null | undefined,
    opts: { kind: "ended" | "orphaned"; engineRunId?: string | null; detail?: Record<string, unknown>; stop?: StopDetail; holdLock?: string; driverLive?: boolean;
      /** Story 27.1 (`endEngine`): the engine's life is over — its id stays on the run, any lock this run holds is released. */
      keepEngine?: boolean }): void {
    const runId = run.run_id;
    this.db.query(
      `UPDATE runs SET state = ?, reason = ?, owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL,
         engine_run_id = ?, updated = ? WHERE run_id = ?`,
    ).run(state, reason ?? null, opts.keepEngine ? run.engine_run_id ?? opts.engineRunId ?? null : opts.engineRunId ?? null, now(), runId);
    const detail: Record<string, unknown> = { ...(opts.detail ?? {}) };
    const held = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(run.checkout) as LockRow | null;
    const hasWorker = run.worker_pid !== null && run.worker_pid !== undefined;
    if (opts.holdLock && (hasWorker || opts.driverLive) && held?.kind === "run" && held.run_id === runId) {
      // Its recorded worker may still run: the lock stays with the ended run (freed by `claim`/`recover`
      // once `recordedWorker` says it may no longer run — sbx: at its in-VM deadline).
      detail.lock = { held: opts.holdLock, ...(hasWorker && run.tier === "sbx" ? { until: new Date(this.sbxDeadline(run).ms).toISOString() } : {}) };
    } else if (opts.keepEngine) {
      if (this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ?").run(run.checkout, runId).changes) detail.lock = "released";
    } else if (opts.engineRunId !== undefined) {
      const lock = held;
      if (!lock || lock.run_id === runId) {
        this.handToEngine(run, opts.engineRunId);
        detail.lock = { handed_to_engine: opts.engineRunId ?? "unverified" };
      }
    } else if (this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ? AND kind = 'run'").run(run.checkout, runId).changes) {
      detail.lock = "released";
    }
    this.event(runId, opts.kind, run.state, state, { ...(reason ? { reason } : {}), ...detail });
    if (opts.stop) this.event(runId, "stopped", state, state, { ...opts.stop, state });
  }

  /** Story 22.3: terminal runs whose end hygiene is unclaimed (`notified` null) or whose lease is
   * stale (its claimant died between the claim and the send), oldest first. */
  unclaimedEnds(at: number = Date.now()): QueueRun[] {
    return this.db.query(
      `SELECT * FROM runs r WHERE state IN ('complete','partial','blocked','cancelled')
         AND (${NOTIFIED_COLUMN} IS NULL OR (${NOTIFIED_COLUMN} LIKE '${LEASE_PREFIX}%' AND ${leaseAtSql("r")} <= ?))
       ORDER BY updated, rowid`,
    ).all(staleCutoff(at)) as QueueRun[];
  }

  /** Story 22.3: lease a terminal run's end hygiene — one atomic `UPDATE`, taken when the marker is
   * null or a lease older than END_LEASE_STALE_MS, so exactly one live process (driver, `serve`,
   * recoverer) notifies and copies for each end. Answers the lease written, or null when the end
   * is not terminal, already done, or freshly leased by another process. */
  claimEnd(runId: string, by: Owner = selfOwner(), at: number = Date.now()): string | null {
    const lease = `${LEASE_PREFIX}${new Date(at).toISOString()} pid ${by.pid}@${by.host}`;
    const changed = this.db.query(
      `UPDATE runs SET ${NOTIFIED_COLUMN} = ? WHERE run_id = ? AND state IN ('complete','partial','blocked','cancelled')
         AND (${NOTIFIED_COLUMN} IS NULL OR (${NOTIFIED_COLUMN} LIKE '${LEASE_PREFIX}%' AND ${leaseAtSql("runs")} <= ?))`,
    ).run(lease, runId, staleCutoff(at)).changes;
    return changed === 1 ? lease : null;
  }

  /** Story 22.3: finalise a lease once the notification and transcript-copy outcomes are recorded
   * (`lease …` → `done …`). False when the lease is no longer this one (another sweep took it over). */
  finishEnd(runId: string, lease: string): boolean {
    const done = `${DONE_PREFIX}${new Date().toISOString()}${lease.slice(lease.indexOf(" pid "))}`;
    return this.db.query(`UPDATE runs SET ${NOTIFIED_COLUMN} = ? WHERE run_id = ? AND ${NOTIFIED_COLUMN} = ?`)
      .run(done, runId, lease).changes === 1;
  }

  /** Story 22.3: a hygiene event on a run (from/to = its current state): a snapshot, a
   * notification, a transcript copy — or why one was skipped or failed. */
  note(runId: string, kind: string, detail: Record<string, unknown>): void {
    this.db.transaction(() => {
      const run = this.must(runId);
      this.event(runId, kind, run.state, run.state, detail);
    }).immediate();
  }

  /** `queued` runs no live process owns (ownerless, or a dead owner), oldest first. */
  drainable(self: Owner = selfOwner()): QueueRun[] {
    return (this.db.query("SELECT * FROM runs WHERE state = 'queued' ORDER BY created, rowid").all() as QueueRun[])
      .filter((r) => !this.ownerLive(ownerOf(r), self));
  }

  /** The restart rule (AC4) over every `queued`/`running` run whose owner
   * process no longer exists:
   *   - first, a recorded worker still running as recorded (pid + start time,
   *     or its process group once the leader exited) is killed (Story 21.6,
   *     DW-3/DW-7); one that may still run but cannot be matched or killed —
   *     or an sbx worker whose in-VM deadline (recorded spawn + guard seconds
   *     + the `-k` grace) has not passed — holds the run as it is (`held`:
   *     nothing released; `recordedWorker`, the predicate `claim` asks too);
   *   - `running` with a studio run → the `resume` op (when given) decides
   *     (an sbx run is never resumed here):
   *     resume → taken over in one transaction (owner = self, the lock
   *     re-owned, a `resumed` event; the caller drives it); otherwise ended
   *     `partial` (`orphaned: supervisor restart`, plus the cause the op
   *     names), or in the studio run's own terminal state when it already
   *     ended; the studio run ended too through `ops.end`;
   *   - `running` past `verb_started` with no studio run → `ops.find` looks up
   *     the job's studio run absent from the stored snapshot: found → recorded
   *     and handled as above; none (lookup ok) → re-queued; lookup failed →
   *     ended `partial` naming it (a run that may have executed never re-runs);
   *   - otherwise (never reached the verb, or `queued`) → re-queued.
   * Every end goes through `end`'s path: `studio_outcome` when the studio run
   * reached a terminal state, and the `stopped` event when the job's
   * `stop.on_status` lists it (DW-8). Ending a `tk-studio-launch` run first
   * probes the launch core: a live engine (or a failed probe: an unverified
   * engine) takes the lock over. Every await is followed by a re-check that the
   * run is unchanged and its owner still dead (another recoverer may have taken
   * it over), and before `ops.end` the run is marked this recoverer's (owner =
   * self, a `recovering` event) so no other recoverer resumes or ends it under
   * that call. Last, an ended run that kept its lock (`holdLock`) has it freed
   * once its recorded worker may no longer run (`released`), else it is `held`. */
  async recover(ops: StudioOps, self: Owner = selfOwner()): Promise<RecoverReport> {
    const report: RecoverReport = { ended: [], requeued: [], resumed: [] };
    // A launched run (its driver let go at `launched`) carries an owner only as a close-out lease (the
    // sweep's or a cancel's): a dead lease is re-taken by the engine-end sweep, never resumed or orphaned here.
    const candidates = (this.db.query(
      `SELECT * FROM runs WHERE state IN ('queued','running') AND owner_pid IS NOT NULL
         AND NOT ${LAUNCHED_SQL}
       ORDER BY created, rowid`,
    ).all() as QueueRun[]).filter((r) => r.owner_nonce !== self.nonce && !this.ownerLive(ownerOf(r), self));
    const unchanged = (c: QueueRun, now_: QueueRun | null) =>
      !!now_ && now_.state === c.state && now_.owner_nonce === c.owner_nonce && now_.owner_pid === c.owner_pid
      && now_.owner_host === c.owner_host && now_.studio_run_id === c.studio_run_id && now_.verb_started === c.verb_started;
    const deadOwner = (c: QueueRun) => ({ pid: c.owner_pid, host: c.owner_host, nonce: c.owner_nonce, ...(c.owner_start ? { start: c.owner_start } : {}) });
    // Re-checked after every await: another recoverer (a tick, `drain`) may have taken the run
    // over (a `resumed` takeover, or its own end mark) since the candidates were listed.
    const stillOrphan = (c: QueueRun) => {
      const cur = this.get(c.run_id);
      return unchanged(c, cur) && !this.ownerLive(ownerOf(cur!), self);
    };

    for (const c of candidates) {
      // Before anything resumes the run or releases its lock: its recorded worker (DW-3, DW-7).
      // sbx: held until the in-VM deadline (the host pid is only `sbx exec`).
      const settled = await this.recordedWorker(c, true);
      if (!stillOrphan(c)) continue;
      const worker = settled.worker;
      if (settled.mayRun) {
        // It may still be the worker: never release its lock under it.
        (report.held ??= []).push({ run_id: c.run_id, worker: worker! });
        continue;
      }
      const workerDetail = worker ? { worker } : {};

      let end: { studioRunId: string | null; lookup?: Record<string, unknown>; lookupFailed?: string } | null = null;
      if (c.state === "running" && c.studio_run_id) {
        end = { studioRunId: c.studio_run_id };
      } else if (c.state === "running" && c.verb_started) {
        let snapshot: string[] = [];
        try { snapshot = JSON.parse(c.verb_snapshot ?? "[]"); } catch { /* an empty snapshot: the lookup still decides */ }
        let found: Awaited<ReturnType<StudioFinder>>;
        try { found = await ops.find(c, snapshot); }
        catch (e) { found = { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
        if (!stillOrphan(c)) continue;
        if (!found.ok) end = { studioRunId: null, lookupFailed: found.detail, lookup: { ok: false, detail: found.detail } };
        else if (found.run_id) end = { studioRunId: found.run_id, lookup: { ok: true, adopted: found.run_id } };
        else end = null; // the verb never minted: safe to re-queue
      }

      if (!end) {
        const requeueWhy = c.verb_started ? "the minting verb started but no studio run exists" : undefined;
        const done = this.db.transaction(() => {
          if (!unchanged(c, this.get(c.run_id))) return false;
          this.db.query(
            `UPDATE runs SET state = 'queued', reason = ?, owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL,
               verb_started = NULL, verb_snapshot = NULL, updated = ? WHERE run_id = ?`,
          ).run(REQUEUED_REASON, now(), c.run_id);
          this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ? AND kind = 'run'").run(c.checkout, c.run_id);
          this.event(c.run_id, "requeued", c.state, "queued", {
            reason: REQUEUED_REASON, dead_owner: deadOwner(c), ...workerDetail,
            ...(requeueWhy ? { lookup: { ok: true, adopted: null, why: requeueWhy } } : {}),
          });
          return true;
        }).immediate();
        if (done) report.requeued.push(c.run_id);
        continue;
      }

      const studioRunId = end.studioRunId;
      let decision: ResumeDecision | undefined;
      if (studioRunId && ops.resume) {
        try { decision = await ops.resume({ ...c, studio_run_id: studioRunId }); }
        catch (e) { decision = { resume: false, cause: `resume check failed: ${e instanceof Error ? e.message : String(e)}` }; }
        // An sbx run is never resumed on restart (its in-VM worker ran to its deadline): the op names the guard.
        if (decision.resume && c.tier === "sbx") decision = { resume: false, cause: "an sbx run is never resumed on restart" };
        if (!stillOrphan(c)) continue;
      }
      let lockCause: string | undefined;
      if (decision?.resume && studioRunId) {
        // The takeover: owner = self, the lock re-owned (never released in between), a `resumed` event — one transaction.
        const took = this.db.transaction((): number | "changed" | string => {
          if (!unchanged(c, this.get(c.run_id))) return "changed";
          const lock = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(c.checkout) as LockRow | null;
          if (lock && lock.run_id !== c.run_id) return `checkout lock held by ${lock.kind} ${lock.run_id}`;
          this.db.query(
            `UPDATE runs SET reason = NULL, owner_pid = ?, owner_host = ?, owner_nonce = ?, owner_start = ?, studio_run_id = ?,
               updated = ? WHERE run_id = ?`,
          ).run(self.pid, self.host, self.nonce, self.start ?? null, studioRunId, now(), c.run_id);
          this.db.query(
            `INSERT INTO locks (checkout, root, kind, run_id, job_id, owner_pid, owner_host, owner_nonce, owner_start, engine_run_id, acquired)
             VALUES (?, ?, 'run', ?, ?, ?, ?, ?, ?, NULL, ?)
             ON CONFLICT (checkout) DO UPDATE SET root = excluded.root, kind = 'run', run_id = excluded.run_id,
               job_id = excluded.job_id, owner_pid = excluded.owner_pid, owner_host = excluded.owner_host,
               owner_nonce = excluded.owner_nonce, owner_start = excluded.owner_start,
               engine_run_id = NULL, acquired = excluded.acquired`,
          ).run(c.checkout, c.root, c.run_id, c.job_id, self.pid, self.host, self.nonce, self.start ?? null, now());
          const n = this.resumeCount(c.run_id) + 1;
          this.event(c.run_id, "resumed", c.state, c.state, {
            resume: n, reason: "supervisor restart", dead_owner: deadOwner(c), owner: ownerDetail(self), studio_run_id: studioRunId,
            ...(c.session_id ? { session_id: c.session_id } : {}), ...workerDetail,
            ...(end!.lookup ? { lookup: end!.lookup } : {}), ...(decision.resume ? decision.detail ?? {} : {}),
          });
          return n;
        }).immediate();
        if (typeof took === "number") report.resumed.push({ run_id: c.run_id, studio_run_id: studioRunId, resume: took });
        if (typeof took === "number" || took === "changed") continue;
        lockCause = took;
      }

      const noResume = decision && !decision.resume ? decision : undefined;
      const cause = lockCause ?? noResume?.cause;
      const reason = end.lookupFailed ? `${ORPHANED_REASON}; studio run lookup failed: ${end.lookupFailed.slice(0, 300)}`
        : cause ? `${ORPHANED_REASON}; ${cause}` : ORPHANED_REASON;
      const already = lockCause ? undefined : noResume?.studioState;
      let studio: { ok: boolean; detail: string; state?: string } | null = null;
      // The run as this recoverer leaves it before the end transaction (the end mark below re-owns it).
      let mine = c;
      if (studioRunId && already) studio = { ok: true, detail: `studio run ${studioRunId} already ${already}`, state: already };
      else if (studioRunId) {
        // Before the studio run is ended: mark the queue run this recoverer's (owner = self, state
        // and lock untouched) in one transaction, so no other recoverer resumes or ends it under this
        // `ops.end`. A recoverer that dies after the mark leaves a dead-owner running run: the next
        // `recover` handles it again (the studio run then answers terminal, the queue run ends in it).
        const marked = this.db.transaction(() => {
          if (!unchanged(c, this.get(c.run_id))) return false;
          this.db.query("UPDATE runs SET owner_pid = ?, owner_host = ?, owner_nonce = ?, owner_start = ?, updated = ? WHERE run_id = ?")
            .run(self.pid, self.host, self.nonce, self.start ?? null, now(), c.run_id);
          this.event(c.run_id, "recovering", c.state, c.state, { dead_owner: deadOwner(c), owner: ownerDetail(self), reason });
          return true;
        }).immediate();
        if (!marked) continue;
        mine = { ...c, owner_pid: self.pid, owner_host: self.host, owner_nonce: self.nonce, owner_start: self.start ?? null };
        try { studio = await ops.end({ ...c, studio_run_id: studioRunId }, reason); }
        catch (e) { studio = { ok: false, detail: `ending studio run ${studioRunId} failed: ${e instanceof Error ? e.message : String(e)}` }; }
      }
      const state: TerminalState = already ?? "partial";
      // The studio run's own terminal state (DW-8): recorded, and matched against `stop.on_status`.
      const studioOutcome = studioRunId && studio?.ok && isTerminal(studio.state) ? { run_id: studioRunId, state: studio.state } : undefined;
      const defn = this.definition(c);
      const onStatus = defn?.stop?.on_status;
      const stop: StopDetail | undefined = studioOutcome && Array.isArray(onStatus) && onStatus.includes(studioOutcome.state)
        ? { condition: "on_status", state: studioOutcome.state, job_id: c.job_id } : undefined;
      // A launch run may have started a detached engine before the handover: probe before releasing the lock.
      let engine: Record<string, unknown> | undefined;
      let engineHolder: { id: string | null } | undefined;
      if (defn?.target?.skill === LAUNCH_SKILL) ({ holder: engineHolder, engine } = await this.launchEngine(engineRoot(c)));
      const trips = noResume?.trips?.length ? noResume.trips : undefined;
      const done = this.db.transaction(() => {
        const cur = this.get(c.run_id);
        // Still as this recoverer left it (its end mark, when it ended the studio run).
        if (!unchanged(mine, cur)) return false;
        if (studioRunId !== c.studio_run_id) this.db.query("UPDATE runs SET studio_run_id = ? WHERE run_id = ?").run(studioRunId, c.run_id);
        this.writeEnd(cur!, state, reason, {
          kind: "orphaned", ...(engineHolder ? { engineRunId: engineHolder.id } : {}), ...(stop ? { stop } : {}),
          detail: {
            dead_owner: deadOwner(c), studio_run_id: studioRunId, studio, ...workerDetail,
            ...(end!.lookup ? { lookup: end!.lookup } : {}), ...(engine ? { engine } : {}),
            ...(trips ? { guards_tripped: trips } : {}), ...(studioOutcome ? { studio_outcome: studioOutcome } : {}),
          },
        });
        return true;
      }).immediate();
      if (done) {
        report.ended.push({
          run_id: c.run_id, studio_run_id: studioRunId, studio, reason, ...(engine ? { engine } : {}), ...(state !== "partial" ? { state } : {}),
        });
      }
    }
    await this.releaseKeptLocks(report, self);
    return report;
  }

  /** Ended runs that kept their checkout lock (`holdLock`: a recorded sbx worker that may
   * still run in the VM): each lock is freed once `recordedWorker` says its worker may no
   * longer run (sbx: the in-VM deadline passed), else the run is reported `held`. */
  private async releaseKeptLocks(report: RecoverReport, self: Owner): Promise<void> {
    const kept = this.db.query(
      `SELECT runs.* FROM locks JOIN runs ON runs.run_id = locks.run_id
       WHERE locks.kind = 'run' AND runs.state IN ('complete','partial','blocked','cancelled') ORDER BY locks.acquired`,
    ).all() as QueueRun[];
    for (const k of kept) {
      if (k.worker_pid == null) {
        // Kept for its live driver (`end`'s `driverLive`): freed by that driver, or once it is dead.
        const lock = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(k.checkout) as LockRow | null;
        if (lock && this.ownerLive(ownerOf(lock), self)) continue;
      }
      const settled = await this.recordedWorker(k, true);
      if (settled.mayRun) { (report.held ??= []).push({ run_id: k.run_id, worker: settled.worker! }); continue; }
      const freed = this.db.transaction(() => {
        const lock = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(k.checkout) as LockRow | null;
        if (lock?.kind !== "run" || lock.run_id !== k.run_id) return false;
        this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ? AND kind = 'run'").run(k.checkout, k.run_id);
        this.event(k.run_id, "lock-released", k.state, k.state, { why: "the ended run's recorded worker may no longer run", ...(settled.worker ? { worker: settled.worker } : {}) });
        return true;
      }).immediate();
      if (freed) (report.released ??= []).push({ run_id: k.run_id, ...(settled.worker ? { worker: settled.worker } : {}) });
    }
  }
}
