/**
 * The supervisor's durable queue (Story 21.3): submitted jobs and their runs
 * held in SQLite (`bun:sqlite`), one lock per checkout.
 *
 *   jobs    one row per (job, checkout): the resolved definition `resolve` served
 *   runs    queue runs — `queued` → `running` → complete|partial|blocked|cancelled
 *           (terminal is immutable; a trigger refuses any update of one)
 *   events  one row per transition, committed in the same transaction
 *   locks   one row per checkout: the run holding it, or the detached
 *           bmad-loop engine a `tk-studio-launch` run started
 *
 * Every transition runs in one `BEGIN IMMEDIATE` transaction with its event.
 * Minting is idempotent: while a run of the same job on the same checkout is
 * `queued` or `running`, `enqueue` mints nothing and answers that run.
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
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pluginRoot } from "./env";
import { lastJsonObject, runUv, type RunResult } from "./server";

type Env = Record<string, string | undefined>;

export const TERMINAL_STATES = ["complete", "partial", "blocked", "cancelled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];
export type RunState = "queued" | "running" | TerminalState;
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
  /** Is bmad-loop engine `engineRunId` live on the checkout at `root`? With
   * `null` (an unverified engine): is any engine live there? */
  engineLive(root: string, engineRunId: string | null): Promise<EngineProbe>;
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

export const defaultProbes: Probes = { ownerAlive: (o) => defaultOwnerAlive(o), engineLive: (root, id) => launchStatusProbe(root, id) };

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
  created: string; updated: string;
}

/** The worker options a run records while `queued` (Story 21.4). */
export interface RunOptionsRecord { tier?: string | null; sandbox?: string | null; model?: string | null; effort?: string | null }
const RUN_OPTION_KEYS = ["tier", "sandbox", "model", "effort"] as const;

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
  /** Runs that hold the job: `running`, or `queued` under a live owner — never overlapped. */
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

interface LockRow {
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

/** Ends a minted studio run for an orphaned queue run (injected: the contract verbs live in cli.ts). */
export type StudioEnder = (run: QueueRun, reason: string) => Promise<{ ok: boolean; detail: string }>;
/** Looks up the job's studio run absent from the pre-verb snapshot (the 21-1
 * adoption rule): `run_id` null when none exists; `ok: false` when the lookup failed. */
export type StudioFinder = (run: QueueRun, snapshot: string[]) =>
  Promise<{ ok: true; run_id: string | null } | { ok: false; detail: string }>;
export interface StudioOps { end: StudioEnder; find: StudioFinder }

export interface RecoverReport {
  ended: { run_id: string; studio_run_id: string | null; studio: { ok: boolean; detail: string } | null; reason: string; engine?: Record<string, unknown> }[];
  requeued: string[];
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
  state TEXT NOT NULL CHECK (state IN ('queued','running','complete','partial','blocked','cancelled')),
  reason TEXT, owner_pid INTEGER, owner_host TEXT, owner_nonce TEXT, owner_start TEXT,
  studio_run_id TEXT, engine_run_id TEXT, verb_started TEXT, verb_snapshot TEXT, definition TEXT,
  permission_mode TEXT, tier TEXT, sandbox TEXT, model TEXT, effort TEXT,
  created TEXT NOT NULL, updated TEXT NOT NULL,
  FOREIGN KEY (job_id, checkout) REFERENCES jobs (job_id, checkout)
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_one_live ON runs (job_id, checkout) WHERE state IN ('queued','running');
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
CREATE TRIGGER IF NOT EXISTS runs_terminal_immutable BEFORE UPDATE ON runs
  WHEN OLD.state IN ('complete','partial','blocked','cancelled')
  BEGIN SELECT RAISE(ABORT, 'RunTerminal: a terminal queue run is immutable'); END;
`;

/** Nullable run columns added after the first schema: an existing queue file
 * gains each one it lacks (guarded by PRAGMA table_info). */
const ADDED_RUN_COLUMNS = ["permission_mode", "tier", "sandbox", "model", "effort"] as const;

const now = () => new Date().toISOString();

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
  return `checkout lock held by run ${h.run_id} (job ${h.job_id}, pid ${h.pid ?? "?"}${h.host ? `@${h.host}` : ""})`;
}

/** What a claim decides on: the run, its checkout's lock, the run holding that lock. */
interface ClaimView { run: QueueRun; lock: LockRow | null; held: QueueRun | null }
/** The claim's probe results, computed outside the transaction. */
interface ClaimProbes { ownerLive: boolean; holderLive: boolean; launch: boolean; engine?: EngineProbe }

const sameFields = <T extends object>(a: T | null, b: T | null, keys: (keyof T)[]) =>
  a === null || b === null ? a === b : keys.every((k) => a[k] === b[k]);

/** The rows a claim's probes were computed from are unchanged. */
function sameClaimView(a: ClaimView, b: ClaimView): boolean {
  return sameFields(a.run, b.run, ["state", "owner_pid", "owner_host", "owner_nonce", "owner_start"])
    && sameFields(a.lock, b.lock, ["kind", "run_id", "job_id", "owner_pid", "owner_host", "owner_nonce", "owner_start", "engine_run_id"])
    && sameFields(a.held, b.held, ["state", "definition"]);
}

// ------------------------------------------------------------ queue

export class Queue {
  readonly db: Database;
  readonly path: string;

  constructor(path: string, readonly probes: Probes = defaultProbes) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA busy_timeout = 30000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.transaction(() => {
      this.db.exec(SCHEMA);
      const have = new Set((this.db.query("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name));
      for (const col of ADDED_RUN_COLUMNS) {
        if (!have.has(col)) this.db.exec(`ALTER TABLE runs ADD COLUMN ${col} TEXT`);
      }
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

  events(runId?: string): QueueEvent[] {
    const rows = (runId
      ? this.db.query("SELECT * FROM events WHERE run_id = ? ORDER BY seq").all(runId)
      : this.db.query("SELECT * FROM events ORDER BY seq").all()) as (Omit<QueueEvent, "detail"> & { detail: string | null })[];
    return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  }

  /** The pacer's read for one (job, checkout), as seen by `self` (owner liveness). */
  pacing(jobId: string, root: string, self: Owner = selfOwner()): JobPacing {
    const checkout = checkoutKey(root);
    const runs = this.db.query("SELECT * FROM runs WHERE job_id = ? AND checkout = ? ORDER BY created, rowid").all(jobId, checkout) as QueueRun[];
    const live: QueueRun[] = [], adoptable: QueueRun[] = [];
    for (const r of runs) {
      if (r.state === "running" || (r.state === "queued" && this.ownerLive(ownerOf(r), self))) live.push(r);
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
  } & RunOptionsRecord): { run: QueueRun; minted: boolean } {
    const checkout = checkoutKey(input.root);
    return this.db.transaction(() => {
      const live = this.db.query(
        "SELECT * FROM runs WHERE job_id = ? AND checkout = ? AND state IN ('queued','running') ORDER BY created LIMIT 1",
      ).get(input.jobId, checkout) as QueueRun | null;
      if (live) {
        if (input.permissionMode) this.writePermissionMode(live, input.permissionMode);
        this.writeRunOptions(this.must(live.run_id), input);
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
      this.db.query(
        `INSERT INTO runs (run_id, job_id, checkout, root, project_id, target, state, reason, owner_pid, owner_host,
           owner_nonce, owner_start, permission_mode, tier, sandbox, model, effort, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(runId, input.jobId, checkout, input.root, input.projectId ?? null, input.target ?? null,
        owner?.pid ?? null, owner?.host ?? null, owner?.nonce ?? null, owner?.start ?? null, mode,
        opts.tier, opts.sandbox, opts.model, opts.effort, at, at);
      this.event(runId, "enqueued", null, "queued", {
        ...(owner ? { owner: ownerDetail(owner) } : {}), ...(mode ? { permission_mode: mode } : {}),
        ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== null)),
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
   * probes were computed from and retries if any of them changed. */
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
          if (lock.kind === "engine") {
            const probe = p.engine!;
            if (probe.live) {
              const engineId = lock.engine_run_id ?? (probe.run_ids?.length ? probe.run_ids.join(",") : null);
              holder = { kind: "engine", run_id: lock.run_id, job_id: lock.job_id, engine_run_id: engineId,
                ...(probe.detail ? { detail: probe.detail } : {}) };
            } else {
              detail.released = { kind: "engine", engine_run_id: lock.engine_run_id, run_id: lock.run_id, why: "engine no longer live" };
            }
          } else if (p.holderLive) {
            holder = { kind: "run", run_id: lock.run_id, job_id: lock.job_id, pid: lock.owner_pid, host: lock.owner_host };
          } else if (p.launch && p.engine!.live) {
            // The stale launch run's engine (or an unverified one, on a failed probe) takes the lock over.
            const probe = p.engine!;
            const engineId = probe.detail ? null : probe.run_ids?.[0] ?? null;
            this.handToEngine(lock, engineId);
            holder = { kind: "engine", run_id: lock.run_id, job_id: lock.job_id, engine_run_id: engineId,
              ...(probe.detail ? { detail: probe.detail } : {}) };
            detail.handover = { from_run: lock.run_id, why: `holder ${held ? held.state : "missing"} (a tk-studio-launch run)`, to_engine: engineId ?? "unverified" };
          } else {
            detail.released = { kind: "run", run_id: lock.run_id, why: `holder ${held ? held.state : "missing"}${held?.state === "running" ? " with a dead owner" : ""}` };
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
    if (isTerminal(run.state) || run.state === "running") return out;
    const mine = run.owner_nonce !== null && run.owner_nonce === self.nonce;
    if (!mine && (out.ownerLive = this.ownerLive(ownerOf(run), self))) return out;
    if (!lock || lock.run_id === runId) return out;
    if (lock.kind === "engine") {
      out.engine = await this.probes.engineLive(lock.root, lock.engine_run_id);
      return out;
    }
    out.holderLive = held?.state === "running" && this.ownerLive(ownerOf(lock), self);
    const defn = held ? this.definition(held) : this.definition({ job_id: lock.job_id, checkout: lock.checkout });
    out.launch = !out.holderLive && defn?.target?.skill === LAUNCH_SKILL;
    // A stale launch-run holder may have started a detached engine: probe before taking over (AD: one engine per checkout).
    if (out.launch) out.engine = await this.probes.engineLive(lock.root, null);
    return out;
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

  /** Put an engine holder on the checkout lock for run `run` (inside a transaction). */
  private handToEngine(run: Pick<QueueRun, "checkout" | "root" | "run_id" | "job_id">, engineRunId: string | null): void {
    this.db.query(
      `INSERT INTO locks (checkout, root, kind, run_id, job_id, owner_pid, owner_host, owner_nonce, owner_start, engine_run_id, acquired)
       VALUES (?, ?, 'engine', ?, ?, NULL, NULL, NULL, NULL, ?, ?)
       ON CONFLICT (checkout) DO UPDATE SET kind = 'engine', run_id = excluded.run_id, job_id = excluded.job_id,
         owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL,
         engine_run_id = excluded.engine_run_id, acquired = excluded.acquired`,
    ).run(run.checkout, run.root, run.run_id, run.job_id, engineRunId, now());
  }

  /** The launch-orphan rule, probed outside any transaction: a failed probe
   * → an unverified engine holder (fail closed, named); a non-empty `live[]`
   * → that engine (the first live id); an empty `live[]` → no holder. */
  private async launchEngine(root: string): Promise<{ holder?: { id: string | null }; engine: Record<string, unknown> }> {
    const probe = await this.probes.engineLive(root, null);
    if (probe.detail) return { holder: { id: null }, engine: { handed_to_engine: "unverified", detail: probe.detail } };
    if (probe.live) {
      const id = probe.run_ids?.[0] ?? null;
      return { holder: { id }, engine: { handed_to_engine: id ?? "unverified", live: probe.run_ids ?? [] } };
    }
    return { engine: { handed_to_engine: null, live: [] } };
  }

  /** `end` for a run this process drove. When the run reached the minting
   * verb, its driven definition targets `tk-studio-launch` and no engine is
   * named (a timeout, a missing status block, a `blocked` launch with no
   * `.bmad-loop/runs/<id>`), the launch core is probed first, outside any
   * transaction, by the launch-orphan rule `recover` uses — the core may have
   * started an engine that still works the checkout. */
  async endDriven(runId: string, state: TerminalState, reason?: string | null,
    opts: { engineRunId?: string; detail?: Record<string, unknown>; stop?: StopDetail } = {}): Promise<QueueRun> {
    const run = opts.engineRunId ? null : this.get(runId);
    if (run && run.verb_started && !isTerminal(run.state) && this.definition(run)?.target?.skill === LAUNCH_SKILL) {
      const { holder, engine } = await this.launchEngine(run.root);
      return this.end(runId, state, reason, { ...opts, ...(holder ? { engineRunId: holder.id } : {}), detail: { ...opts.detail, engine } });
    }
    return this.end(runId, state, reason, opts);
  }

  /** Terminal transition + lock release — or, when the run launched a
   * detached bmad-loop engine, the lock is handed to that engine (`null`: an
   * unverified engine, from a failed launch probe). `stop` (AC4) writes the
   * `stopped` event (from/to = `state`) in the same transaction as `ended`. */
  end(runId: string, state: TerminalState, reason?: string | null,
    opts: { engineRunId?: string | null; detail?: Record<string, unknown>; from?: RunState; stop?: StopDetail } = {}): QueueRun {
    if (!isTerminal(state)) throw new Error(`end: '${state}' is not a terminal state`);
    return this.db.transaction(() => {
      const run = this.must(runId);
      if (isTerminal(run.state)) throw new RunTerminal(runId, run.state);
      if (opts.from && run.state !== opts.from) throw new Error(`end: queue run '${runId}' is ${run.state}, not ${opts.from}`);
      this.db.query(
        `UPDATE runs SET state = ?, reason = ?, owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL,
           engine_run_id = ?, updated = ? WHERE run_id = ?`,
      ).run(state, reason ?? null, opts.engineRunId ?? null, now(), runId);
      const detail: Record<string, unknown> = { ...(opts.detail ?? {}) };
      if (opts.engineRunId !== undefined) {
        const lock = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(run.checkout) as LockRow | null;
        if (!lock || lock.run_id === runId) {
          this.handToEngine(run, opts.engineRunId);
          detail.lock = { handed_to_engine: opts.engineRunId ?? "unverified" };
        }
      } else if (this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ? AND kind = 'run'").run(run.checkout, runId).changes) {
        detail.lock = "released";
      }
      this.event(runId, "ended", run.state, state, { ...(reason ? { reason } : {}), ...detail });
      if (opts.stop) this.event(runId, "stopped", state, state, { ...opts.stop, state });
      return this.must(runId);
    }).immediate();
  }

  /** `queued` runs no live process owns (ownerless, or a dead owner), oldest first. */
  drainable(self: Owner = selfOwner()): QueueRun[] {
    return (this.db.query("SELECT * FROM runs WHERE state = 'queued' ORDER BY created, rowid").all() as QueueRun[])
      .filter((r) => !this.ownerLive(ownerOf(r), self));
  }

  /** The restart rule (AC4) over every `queued`/`running` run whose owner
   * process no longer exists:
   *   - `running` with a studio run → ended `partial` (`orphaned: supervisor
   *     restart`), the studio run ended too through `ops.end`;
   *   - `running` past `verb_started` with no studio run → `ops.find` looks up
   *     the job's studio run absent from the stored snapshot: found → recorded
   *     and ended as above; none (lookup ok) → re-queued; lookup failed →
   *     ended `partial` naming it (a run that may have executed never re-runs);
   *   - otherwise (never reached the verb, or `queued`) → re-queued.
   * Ending a `tk-studio-launch` run first probes the launch core: a live
   * engine (or a failed probe: an unverified engine) takes the lock over. */
  async recover(ops: StudioOps, self: Owner = selfOwner()): Promise<RecoverReport> {
    const report: RecoverReport = { ended: [], requeued: [] };
    const candidates = (this.db.query(
      "SELECT * FROM runs WHERE state IN ('queued','running') AND owner_pid IS NOT NULL ORDER BY created, rowid",
    ).all() as QueueRun[]).filter((r) => r.owner_nonce !== self.nonce && !this.ownerLive(ownerOf(r), self));
    const unchanged = (c: QueueRun, now_: QueueRun | null) =>
      !!now_ && now_.state === c.state && now_.owner_nonce === c.owner_nonce && now_.owner_pid === c.owner_pid
      && now_.owner_host === c.owner_host && now_.studio_run_id === c.studio_run_id && now_.verb_started === c.verb_started;
    const deadOwner = (c: QueueRun) => ({ pid: c.owner_pid, host: c.owner_host, nonce: c.owner_nonce, ...(c.owner_start ? { start: c.owner_start } : {}) });

    for (const c of candidates) {
      let end: { studioRunId: string | null; lookup?: Record<string, unknown>; lookupFailed?: string } | null = null;
      if (c.state === "running" && c.studio_run_id) {
        end = { studioRunId: c.studio_run_id };
      } else if (c.state === "running" && c.verb_started) {
        let snapshot: string[] = [];
        try { snapshot = JSON.parse(c.verb_snapshot ?? "[]"); } catch { /* an empty snapshot: the lookup still decides */ }
        let found: Awaited<ReturnType<StudioFinder>>;
        try { found = await ops.find(c, snapshot); }
        catch (e) { found = { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
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
            reason: REQUEUED_REASON, dead_owner: deadOwner(c), ...(requeueWhy ? { lookup: { ok: true, adopted: null, why: requeueWhy } } : {}),
          });
          return true;
        }).immediate();
        if (done) report.requeued.push(c.run_id);
        continue;
      }

      const reason = end.lookupFailed ? `${ORPHANED_REASON}; studio run lookup failed: ${end.lookupFailed.slice(0, 300)}` : ORPHANED_REASON;
      let studio: { ok: boolean; detail: string } | null = null;
      if (end.studioRunId) {
        try { studio = await ops.end({ ...c, studio_run_id: end.studioRunId }, ORPHANED_REASON); }
        catch (e) { studio = { ok: false, detail: `ending studio run ${end.studioRunId} failed: ${e instanceof Error ? e.message : String(e)}` }; }
      }
      // A launch run may have started a detached engine before the handover: probe before releasing the lock.
      let engine: Record<string, unknown> | undefined;
      let engineHolder: { id: string | null } | undefined;
      if (this.definition(c)?.target?.skill === LAUNCH_SKILL) ({ holder: engineHolder, engine } = await this.launchEngine(c.root));
      const done = this.db.transaction(() => {
        if (!unchanged(c, this.get(c.run_id))) return false;
        this.db.query(
          `UPDATE runs SET state = 'partial', reason = ?, owner_pid = NULL, owner_host = NULL, owner_nonce = NULL, owner_start = NULL,
             studio_run_id = ?, engine_run_id = ?, updated = ? WHERE run_id = ?`,
        ).run(reason, end!.studioRunId, engineHolder?.id ?? null, now(), c.run_id);
        const lock = this.db.query("SELECT * FROM locks WHERE checkout = ?").get(c.checkout) as LockRow | null;
        let lockDetail: unknown;
        if (engineHolder && (!lock || lock.run_id === c.run_id)) {
          this.handToEngine(c, engineHolder.id);
          lockDetail = { handed_to_engine: engineHolder.id ?? "unverified" };
        } else if (this.db.query("DELETE FROM locks WHERE checkout = ? AND run_id = ? AND kind = 'run'").run(c.checkout, c.run_id).changes) {
          lockDetail = "released";
        }
        this.event(c.run_id, "orphaned", c.state, "partial", {
          reason, dead_owner: deadOwner(c), studio_run_id: end!.studioRunId, studio,
          ...(end!.lookup ? { lookup: end!.lookup } : {}), ...(engine ? { engine } : {}), ...(lockDetail ? { lock: lockDetail } : {}),
        });
        return true;
      }).immediate();
      if (done) report.ended.push({ run_id: c.run_id, studio_run_id: end.studioRunId, studio, reason, ...(engine ? { engine } : {}) });
    }
    return report;
  }
}
