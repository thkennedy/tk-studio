/**
 * DW-184, DW-195: the live-host-leg signal, read from the supervisor's queue read-only — the same SQL and rule as
 * `tools/verify_host.py` `live_legs`. A live leg is a run whose latest `host-verify-leg` lease has a non-null owner,
 * no later `host-verify`, and either no `deadline` (a lease written before DW-184: live, as before) or a `deadline`
 * still ahead; a `deadline` not in the strict form (`DEADLINE_RE`) reads as none. The owner's pid is never probed (on win32 `os.kill` is
 * TerminateProcess).
 *
 * `besideLegRefusal` is test/preload.ts's guard (hole 118): a hand `bun test` beside a live leg is refused (exit 2)
 * unless `TK_VERIFY_BESIDE_LEG=1`; the leg's own run (`TK_SUPERVISOR_HOST_LEG` set) never reads the queue.
 *
 * This module imports only `bun:sqlite` and node builtins, never queue.ts: the preload must stay light.
 */
import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";

/** Set by the supervisor's host leg on its own run (hostverify.ts). */
export const HOST_LEG_ENV = "TK_SUPERVISOR_HOST_LEG";
/** The supervisor's configured queue path. */
export const QUEUE_ENV = "TK_SUPERVISOR_DB";
/** Set to `1` to run a `bun test` beside a live leg anyway (the leg's env and `verify_host.py --beside-leg` set it). */
export const BESIDE_LEG_ENV = "TK_VERIFY_BESIDE_LEG";

export const LIVE_LEGS_SQL = `
SELECT l.run_id, l.at, l.detail FROM events l
WHERE l.kind = 'host-verify-leg'
  AND l.seq = (SELECT MAX(seq) FROM events WHERE run_id = l.run_id AND kind = 'host-verify-leg')
  AND NOT EXISTS (SELECT 1 FROM events h WHERE h.run_id = l.run_id AND h.kind = 'host-verify' AND h.seq > l.seq)
`;

export type LiveLeg = { run_id: string; by: string; at: string };

/** How long the read waits on a busy queue: verify_host.py `QUEUE_TIMEOUT_S` (5 s), the same wait. */
const QUEUE_BUSY_TIMEOUT_MS = 5_000;

/** The lease's clock fields: `guard_s` and its ISO `deadline` (`nowMs` plus the guard's seconds). */
export function leaseClock(guardS: number, nowMs: number = Date.now()): { guard_s: number; deadline: string } {
  return { guard_s: guardS, deadline: new Date(nowMs + guardS * 1000).toISOString() };
}

/** The only deadline form read (verify_host.py `DEADLINE_RE`, the same rule): extended ISO-8601 with an explicit `Z`
 * or `±HH:MM` offset, untrimmed; a zoneless, padded or basic-format value is no deadline. */
export const DEADLINE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;

/** A lease `deadline` as epoch ms, or NaN when it is not a string in `DEADLINE_RE`'s form or names an impossible
 * date/time (hour 0-23, minute and second 0-59, a real day of the month, an offset under 24h). */
export function leaseDeadlineMs(raw: unknown): number {
  if (typeof raw !== "string") return NaN;
  const m = DEADLINE_RE.exec(raw);
  if (!m) return NaN;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const ms = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0;
  if (h > 23 || mi > 59 || s > 59) return NaN;
  const local = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const check = new Date(local);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return NaN;
  if (m[8] === "Z") return local;
  const oh = Number(m[10]), om = Number(m[11]);
  if (oh > 23 || om > 59) return NaN;
  return local - (m[9] === "-" ? -1 : 1) * (oh * 60 + om) * 60_000;
}

/** Whether one lease's detail is live at `nowMs` (see the header). */
export function leaseLive(detail: unknown, nowMs: number): boolean {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return false;
  const d = detail as Record<string, unknown>;
  if (d.owner === null || d.owner === undefined) return false;
  const deadline = leaseDeadlineMs(d.deadline);
  return Number.isNaN(deadline) || deadline > nowMs;
}

/** The live host legs in the queue at `dbPath`, read-only: `{legs}`; `{legs: [], error}` when it could not be read. */
export function liveLegs(dbPath: string, nowMs: number): { legs: LiveLeg[]; error?: string } {
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    db.run(`PRAGMA busy_timeout = ${QUEUE_BUSY_TIMEOUT_MS}`);
    const rows = db.query(LIVE_LEGS_SQL).all() as { run_id: unknown; at: unknown; detail: unknown }[];
    const legs: LiveLeg[] = [];
    for (const row of rows) {
      const d = typeof row.detail === "string" && row.detail ? JSON.parse(row.detail) : {};
      if (!leaseLive(d, nowMs)) continue;
      legs.push({ run_id: String(row.run_id), by: String((d as Record<string, unknown>).by || "re-run"), at: String(row.at) });
    }
    return { legs };
  } catch (e) {
    return { legs: [], error: (e instanceof Error ? e.message : String(e)) || "unreadable" };
  } finally {
    try { db?.close(); } catch { /* closing only */ }
  }
}

/** The preload's refusal text while a host leg is live on this box, or null to let the tests run (no queue, the
 * override, the leg's own run, or no live leg). An unreadable queue writes one stderr note and answers null. */
export function besideLegRefusal(env: Record<string, string | undefined>, nowMs: number): string | null {
  if (env[HOST_LEG_ENV]) return null;
  if (env[BESIDE_LEG_ENV] === "1") return null;
  const raw = (env[QUEUE_ENV] ?? "").trim();
  if (!raw) return null;
  try {
    if (!existsSync(raw) || !statSync(raw).isFile()) return null;
  } catch { return null; }
  const { legs, error } = liveLegs(raw, nowMs);
  if (error !== undefined) {
    process.stderr.write(`bun test: the queue at ${raw} was not read (${error}); running without the beside-leg check\n`);
    return null;
  }
  if (!legs.length) return null;
  const named = legs.map((l) => `queue run ${l.run_id} (by ${l.by}, since ${l.at})`).join("; ");
  return `bun test: refused: a host leg is live on this box: ${named}; a hand test beside the leg slows its bounded drives `
    + `(hole 118): wait for its host-verify event (GET /runs/${legs[0]!.run_id}), or set ${BESIDE_LEG_ENV}=1 to run anyway`;
}
