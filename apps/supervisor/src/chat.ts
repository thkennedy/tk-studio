/**
 * The engagement chat (Story 32.2, design spec §6.4 and D2, user flow F2 step 1, contract 0.1.27 additive).
 * `api.ts` serves `POST /chat/{engagement}` and `GET /chat/{engagement}` (JSON or the stream); no HTTP here.
 *
 *   the file     `<served root>/_bmad-output/engagements/<ENG-NNN>/chat.jsonl` (Settled shape 3): one JSON object per
 *                line, the owner's `{seq, at, author: "owner", body}`, the planner's `{seq, at, author: "planner", body,
 *                run_id, proposals[]}` (written by `engage.py reply`); `seq` grows by 1 from 1, unique per file. Both
 *                writers take `chat.lock` in the engagement's directory (exclusive create, stale after 30 s), re-read
 *                the last `seq` inside it and append one line (the whole file rewritten atomically). A body is at most
 *                32 KiB UTF-8.
 *   the turn     each owner line queues one run of the shipped one-shot job `engagement-chat` (`queueChatTurn`): the
 *                definition resolved as `validate` resolves it (injected), the run options `tier: host` plus the
 *                served root's planner leg (`plannerLeg`), `stack: true` (Settled shape 2: a turn sent while a chat
 *                run is live mints behind it and waits on the checkout lock — never refused, never adopted), the
 *                run's own payload `{engagement, project, project_root, seq}` on its `enqueued` event (delivered at run
 *                start with its queue `run_id`: `withStoredPayload`), then one `chat-queued` service event `{engagement, project, seq,
 *                run_id, model, effort}`. The planner moves no state.
 *   the spend    `chatSpendPass` (Settled shape 5), at the `finally` sites: per engagement, the ledger's `job-run`
 *                `total_cost_usd` summed over every run its `chat-queued` events name (a run with no `job-run` yet,
 *                or no ledger file at all, counts 0; a later pass corrects it; any other ledger read error skips the
 *                pass, writing nothing) into `spend.planning_usd`, the record re-read fresh and rewritten atomically
 *                (only `planning_usd` merged) when the sum changed. No `engagement` event (the state does not move). Never throws.
 */
import { closeSync, linkSync, openSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { jobRunCosts } from "./board";
import { atomicWrite, engagementPath, ENGAGEMENTS_REL, readEngagement, writeEngagement } from "./engagement";
import { REPLY_MAX_BYTES } from "./inbox";
import { ENGAGEMENT_CHAT_JOB, type Queue } from "./queue";
import { plannerLeg, type ResolvedJob } from "./resolution";

/** A lock older than this is stale and taken over (ms). */
export const CHAT_LOCK_STALE_MS = 30_000;
/** How long a writer waits for a held lock before `ChatBusy` (ms). */
export const CHAT_LOCK_WAIT_MS = 5_000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface ChatLine {
  seq: number; at: string; author: "owner" | "planner"; body: string;
  run_id?: string; proposals?: Record<string, unknown>[];
}

export class ChatBusy extends Error {
  constructor(id: string) {
    super(`ChatBusy: _bmad-output/engagements/${id}/chat.lock is held (another writer is appending)`);
    this.name = "ChatBusy";
  }
}

export const chatDir = (root: string, id: string) => join(root, ENGAGEMENTS_REL, id);
export const chatFile = (root: string, id: string) => join(chatDir(root, id), "chat.jsonl");

/** Every parsed line of the chat (a torn or non-object line, or one without a numeric `seq`, skipped), in file order. */
export function readChat(root: string, id: string): ChatLine[] {
  let text: string;
  try { text = readFileSync(chatFile(root, id), "utf-8"); } catch { return []; }
  const out: ChatLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const o = JSON.parse(raw);
      if (isObject(o) && typeof o.seq === "number" && Number.isFinite(o.seq)) out.push(o as unknown as ChatLine);
    } catch { /* a torn line */ }
  }
  return out;
}

/** The lines with `seq > since`. */
export const chatSince = (root: string, id: string, since: number): ChatLine[] => readChat(root, id).filter((l) => l.seq > since);

const lockPath = (root: string, id: string) => join(chatDir(root, id), "chat.lock");

/** A stale lock taken over atomically: renamed to a unique name (of two writers that saw it stale, one rename wins;
 * the other finds it gone). What was moved is checked once more: not stale (another writer retook the lock between
 * this writer's stat and its rename), it is put back with an exclusive link (never over a lock that exists) before
 * the moved name is removed. The caller then retries the exclusive create. */
export function takeOverStale(lock: string, now: () => number = Date.now): void {
  const aside = `${lock}.stale-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try { renameSync(lock, aside); } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return; // taken over (or released) by another writer
    throw e;
  }
  try {
    if (now() - statSync(aside).mtimeMs <= CHAT_LOCK_STALE_MS) { try { linkSync(aside, lock); } catch { /* retaken meanwhile */ } }
  } finally { try { rmSync(aside, { force: true }); } catch { /* best effort */ } }
}

/** One attempt at `chat.lock`: "acquired" (exclusive create), else "held" (a live lock); a stale one is taken over
 * (`takeOverStale`) and the create retried. */
function tryChatLock(lock: string, now: () => number): "acquired" | "held" {
  for (;;) {
    try { closeSync(openSync(lock, "wx")); return "acquired"; } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
    }
    let mtime: number;
    try { mtime = statSync(lock).mtimeMs; } catch { continue; } // released meanwhile
    if (now() - mtime <= CHAT_LOCK_STALE_MS) return "held";
    takeOverStale(lock, now);
  }
}

const releaseChatLock = (lock: string) => { try { rmSync(lock, { force: true }); } catch { /* best effort */ } };

/** Run `fn` holding `chat.lock` (exclusive create; a lock older than CHAT_LOCK_STALE_MS is taken over; a held one is
 * waited on up to `waitMs`, then ChatBusy). Synchronous: for the CLI side and tests; the route uses `withChatLockAsync`. */
export function withChatLock<T>(root: string, id: string, fn: () => T, waitMs = CHAT_LOCK_WAIT_MS, now: () => number = Date.now): T {
  const lock = lockPath(root, id);
  const deadline = now() + waitMs;
  while (tryChatLock(lock, now) === "held") {
    if (now() >= deadline) throw new ChatBusy(id);
    Bun.sleepSync(20);
  }
  try { return fn(); } finally { releaseChatLock(lock); }
}

/** `withChatLock` whose wait never blocks the event loop (an async sleep between attempts): the chat route's, so a
 * held lock never stalls the server (other requests, the streams' heartbeats). `fn` runs synchronously under the lock. */
export async function withChatLockAsync<T>(
  root: string, id: string, fn: () => T, waitMs = CHAT_LOCK_WAIT_MS, now: () => number = Date.now,
  sleep: (ms: number) => Promise<unknown> = (ms) => Bun.sleep(ms),
): Promise<T> {
  const lock = lockPath(root, id);
  const deadline = now() + waitMs;
  while (tryChatLock(lock, now) === "held") {
    if (now() >= deadline) throw new ChatBusy(id);
    await sleep(20);
  }
  try { return fn(); } finally { releaseChatLock(lock); }
}

/** Append one line, the caller holding `chat.lock`: the last `seq` re-read, the line given `seq = last + 1`; the file
 * rewritten whole, atomically. Answers the line written. */
export function appendChatLineHeld(root: string, id: string, line: Omit<ChatLine, "seq">): ChatLine {
  let text = "";
  try { text = readFileSync(chatFile(root, id), "utf-8"); } catch { /* absent: a new file */ }
  let last = 0;
  for (const l of readChat(root, id)) if (l.seq > last) last = l.seq;
  const written = { seq: last + 1, ...line } as ChatLine;
  if (text && !text.endsWith("\n")) text += "\n";
  atomicWrite(chatFile(root, id), text + JSON.stringify(written) + "\n");
  return written;
}

/** Remove the line `seq` (the caller holding `chat.lock`): the owner line of a turn whose run could not be minted
 * (`ChatQueueFailed`), so no owner line survives without a run. Every other line kept byte for byte; a file left
 * empty is removed. */
export function dropChatLineHeld(root: string, id: string, seq: number): void {
  let text: string;
  try { text = readFileSync(chatFile(root, id), "utf-8"); } catch { return; }
  const kept = text.split("\n").filter((raw) => {
    if (!raw.trim()) return false;
    try { const o = JSON.parse(raw); return !(isObject(o) && o.seq === seq); } catch { return true; }
  });
  if (!kept.length) { rmSync(chatFile(root, id), { force: true }); return; }
  atomicWrite(chatFile(root, id), kept.join("\n") + "\n");
}

/** Append one line under the lock (`appendChatLineHeld` inside `withChatLock`). */
export const appendChatLine = (root: string, id: string, line: Omit<ChatLine, "seq">): ChatLine =>
  withChatLock(root, id, () => appendChatLineHeld(root, id, line));

/** Whether the engagement's record file is JSON text (Settled shape 1), as `engage.py` reads it; 32.1 wrote block YAML. */
export function recordIsJsonText(root: string, id: string): boolean {
  try { JSON.parse(readFileSync(engagementPath(root, id), "utf-8")); return true; } catch { return false; }
}

/** `POST /chat/{engagement}`: `{message}` only, a non-empty string at most REPLY_MAX_BYTES UTF-8. */
export function checkChatBody(raw: unknown): { ok: true; message: string } | { ok: false; detail: string } {
  if (!isObject(raw)) return { ok: false, detail: "the body must be a JSON object" };
  for (const k of Object.keys(raw)) if (k !== "message") return { ok: false, detail: `unknown field '${k}' (allowed: message)` };
  if (typeof raw.message !== "string" || !raw.message.trim()) return { ok: false, detail: "field 'message' must be a non-empty string" };
  if (Buffer.byteLength(raw.message, "utf-8") > REPLY_MAX_BYTES) return { ok: false, detail: `field 'message' exceeds ${REPLY_MAX_BYTES} bytes (UTF-8)` };
  return { ok: true, message: raw.message };
}

// ------------------------------------------------------------ the turn (Settled shape 2)

/** What the chat route needs to queue a turn: the `engagement-chat` definition for a served root, as `validate`
 * resolves it (throws on a refusal), and the root's checkout key and prefix (`resolveCheckout`). */
export interface ChatDeps {
  resolveJob: (root: string) => Promise<ResolvedJob>;
  checkout?: (root: string) => Promise<{ lockCheckout?: string | null; prefix?: string | null }>;
}

export interface ChatTurn { engagement: string; project: string; root: string; seq: number }

/** The resolved definition and placement of a turn, read before the owner's line is appended (a refusal appends
 * nothing). */
export async function prepareChatTurn(deps: ChatDeps, root: string): Promise<{ v: ResolvedJob; where: { lockCheckout?: string | null; prefix?: string | null } }> {
  const v = await deps.resolveJob(root);
  const where = deps.checkout ? await deps.checkout(v.root) : {};
  return { v, where };
}

/** Mint the turn's `engagement-chat` run (synchronous: called right after the append) and record `chat-queued`. */
export function mintChatTurn(
  queue: Queue, prepared: { v: ResolvedJob; where: { lockCheckout?: string | null; prefix?: string | null } }, turn: ChatTurn,
): { run_id: string; model: string | null; effort: string | null } {
  const { v, where } = prepared;
  // `project_root`: the served registry root (as validate-resolution's payload), where chat.jsonl and the record live
  // untracked — the session runs in the run's worktree, so the skill maps it (never `directory`) to `--directory`.
  const payload = { engagement: turn.engagement, project: turn.project, project_root: turn.root, seq: turn.seq };
  const definition = { ...v.definition, target: { ...(v.definition.target ?? {}), payload: { ...(v.definition.target?.payload ?? {}), ...payload } } };
  const leg = plannerLeg(turn.root, v.root);
  const { run } = queue.enqueue({
    jobId: ENGAGEMENT_CHAT_JOB, root: v.root, projectId: v.projectId, target: v.target, definition, ...where,
    tier: "host", ...(leg.model ? { model: leg.model } : {}), ...(leg.effort ? { effort: leg.effort } : {}),
    stack: true, payload,
  });
  const model = leg.model ?? null, effort = leg.effort ?? null;
  try {
    queue.serviceEvent("chat-queued", { engagement: turn.engagement, project: turn.project, seq: turn.seq, run_id: run.run_id, model, effort });
  } catch (e) {
    // No turn without its chat-queued (the spend pass meters by it): the minted run is cancelled, the error rethrown
    // (the route answers ChatQueueFailed and removes the owner line).
    try { queue.end(run.run_id, "cancelled", `ChatQueueFailed: ${e instanceof Error ? e.message : String(e)}`); } catch { /* already ended */ }
    throw e;
  }
  return { run_id: run.run_id, model, effort };
}

// ------------------------------------------------------------ the spend (Settled shape 5)

export interface ChatSpendDeps {
  /** The host ledger file (`ledgerPath`). */
  ledgerFile: string;
  /** Tests: called between the pass's first read of a record and its fresh re-read before the write. */
  beforeWrite?: (root: string, engagement: string) => void;
}

export interface ChatSpendResult { updated: string[] }

/**
 * The chat-spend pass (see the header). Never throws.
 *
 * Risk: a sub-millisecond window between the pass's fresh read and the rename remains against
 * `POST /engagements/{id}/input` in the serve process. If the input route's stale copy reverts `planning_usd`, the
 * next pass corrects it; if the pass overwrites a state change made inside the window, nothing corrects it. A shared
 * engagement.yaml lock is left to a later story (32-5/32-8).
 */
export function chatSpendPass(queue: Queue, deps: ChatSpendDeps): ChatSpendResult {
  const out: ChatSpendResult = { updated: [] };
  try {
    const events = queue.serviceEvents("chat-queued");
    if (!events.length) return out;
    let text = "";
    try { text = readFileSync(deps.ledgerFile, "utf-8"); } catch (e) {
      // only ENOENT is "no ledger yet: every run counts 0"; any other read error (EACCES, EBUSY, EISDIR) skips the
      // pass so a transient failure never overwrites a correct planning_usd with 0
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return out;
    }
    const costs = jobRunCosts(text);
    // per (root, engagement): the runs its chat-queued events name, once each
    const groups = new Map<string, { root: string; engagement: string; runs: Set<string> }>();
    for (const ev of events) {
      const d = ev.detail ?? {};
      const runId = typeof d.run_id === "string" ? d.run_id : null;
      const engagement = typeof d.engagement === "string" ? d.engagement : null;
      if (!runId || !engagement) continue;
      // the record lives at the served registry root the run's payload carries (`project_root`, as mintChatTurn
      // sets it), not necessarily the root resolveJob returned; that root is only the fallback
      const served = queue.runPayload(runId)?.project_root;
      const root = typeof served === "string" && served !== "" ? served : queue.get(runId)?.root;
      if (!root) continue;
      const key = `${root}\u0000${engagement}`;
      const g = groups.get(key) ?? { root, engagement, runs: new Set<string>() };
      g.runs.add(runId);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      try {
        let sum = 0;
        for (const runId of g.runs) {
          const studio = queue.get(runId)?.studio_run_id;
          sum += studio ? costs.get(studio)?.cost ?? 0 : 0;
        }
        sum = Math.round(sum * 1e6) / 1e6;
        const record = readEngagement(g.root, g.engagement);
        if (!record) continue;
        const spend = isObject(record.spend) ? record.spend : { planning_usd: 0, runs_usd: 0 };
        if (spend.planning_usd === sum) continue;
        deps.beforeWrite?.(g.root, g.engagement);
        // This pass runs in run/drain/recover processes beside serve, whose POST /engagements/{id}/input rewrites the
        // same file (32.1 holds no cross-process lock: its read-apply-write runs with no await between): the record
        // is read fresh right before the atomic write, with no await between, and only `spend.planning_usd` is merged
        // into it, so a state change written since the first read survives.
        const fresh = readEngagement(g.root, g.engagement);
        if (!fresh) continue;
        const freshSpend = isObject(fresh.spend) ? fresh.spend : { planning_usd: 0, runs_usd: 0 };
        if (freshSpend.planning_usd === sum) continue;
        writeEngagement(g.root, { ...fresh, spend: { ...freshSpend, planning_usd: sum } });
        out.updated.push(g.engagement);
      } catch { /* this engagement on the next pass */ }
    }
  } catch { /* the next pass */ }
  return out;
}
