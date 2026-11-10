/**
 * The studio chat (Story 39.3, design addendum 2026-11-07 §3.8, AD-11, contract 0.1.35 additive). `api.ts` serves
 * `POST /chat` and `GET /chat?project=` (JSON or the stream); no HTTP here. Beside the engagement chat (`chat.ts`),
 * never factored with it: this module imports `takeOverStale` only.
 *
 *   the file     `<served root>/_bmad-output/tracking/studio-chat.jsonl` (Settled shape 2): one JSON object per line —
 *                the owner's `{seq, at, author: "owner", body}`, a press `{seq, at, author: "owner", body: "pressed:
 *                <label>", pressed {seq, index, kind}[, unqueued: true]}`, the planner's reply `{seq, at, author: "planner", body, run_id,
 *                reply_to, proposals[]}` (written by `studiochat.py reply`), and the failure reply of the pass below
 *                (`failed: true`). `seq` grows by 1 from 1; writers take `studio-chat.lock` beside it (exclusive create,
 *                stale after 30 s, a 5 s wait, then ChatBusy), re-read the last `seq` inside it and rewrite the file
 *                atomically.
 *   the turn     each owner line queues one `studio-chat` run (`mintStudioTurn`): host tier, the planner leg, `stack`,
 *                on its own lock lane `<lock checkout>#studio-chat` (the turns serialize on it, never behind an epic),
 *                the run's own payload `{project, project_root, seq}`, then one `chat-queued` service event `{chat:
 *                "studio", project, seq, run_id, model, effort, behind}` (no `engagement` key: every engagement reader
 *                skips it).
 *   the stream   the worker of a `studio-chat` run runs `--output-format stream-json` and its stdout is tapped
 *                (`studioChatTap`): the top-level text deltas between `<reply>` and `</reply>` land in
 *                `_bmad-output/tracking/studio-chat-stream/<run_id>.txt`, which the route streams as `event:
 *                chat-delta` frames (`deltaFrame`).
 *   the reads    serve writes `_bmad-output/tracking/studio-chat-reads/<seq>.json` at post time (`writeReads`): the
 *                session holds no bearer, so it reads the pages' answers from that file.
 *   the pass     `studioChatPass`: a terminal run with no reply gets the failure reply once; a terminal run's stream
 *                and reads files are removed. Never throws.
 *
 * Every path is a host `join` of the served root (never a VM path).
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { takeOverStale } from "./chat";
import { atomicWrite } from "./engagement";
import { checkoutKey, isTerminal, STUDIO_CHAT_JOB, type Queue } from "./queue";
import { plannerLeg, type ResolvedJob } from "./resolution";

export const STUDIO_CHAT_REL = join("_bmad-output", "tracking", "studio-chat.jsonl");
export const STUDIO_CHAT_LOCK_REL = join("_bmad-output", "tracking", "studio-chat.lock");
export const STREAM_DIR_REL = join("_bmad-output", "tracking", "studio-chat-stream");
export const READS_DIR_REL = join("_bmad-output", "tracking", "studio-chat-reads");
/** An owner line's limit, in characters (code points). */
export const LINE_MAX_CHARS = 4000;
/** A lock older than this is stale and taken over (ms). */
export const STUDIO_LOCK_STALE_MS = 30_000;
/** How long a writer waits for a held lock before ChatBusy (ms). */
export const STUDIO_LOCK_WAIT_MS = 5_000;
/** The excerpt's length in code points before `…`. */
export const EXCERPT_MAX = 40;
/** The proposal kinds that land in Story 39.7: refused by name until then. */
export const NOT_YET_KINDS: readonly string[] = ["stop-after-story", "open-studio"];
/** The stream file is written at most this often (ms). */
export const TAP_THROTTLE_MS = 250;
/** The lock lane suffix (Settled shape 7). */
export const STUDIO_LANE = "#studio-chat";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface StudioLine {
  seq: number; at: string; author: "owner" | "planner"; body: string;
  run_id?: string; reply_to?: number; proposals?: Record<string, unknown>[];
  pressed?: { seq: number; index: number; kind: string }; failed?: boolean;
  /** A `queue` press line whose submit did not answer 2xx: kept (its seq never reused), read as no press. */
  unqueued?: boolean;
}

export class StudioChatBusy extends Error {
  constructor() {
    super("ChatBusy: _bmad-output/tracking/studio-chat.lock is held (another writer is appending)");
    this.name = "ChatBusy";
  }
}

export const studioChatFile = (root: string) => join(root, STUDIO_CHAT_REL);
const lockFile = (root: string) => join(root, STUDIO_CHAT_LOCK_REL);
export const streamFile = (root: string, runId: string) => join(root, STREAM_DIR_REL, `${runId}.txt`);
export const readsFile = (root: string, seq: number) => join(root, READS_DIR_REL, `${seq}.json`);

/** Every parsed line (a torn or non-object line, or one without a finite numeric `seq`, skipped), in file order. */
export function readStudioChat(root: string): StudioLine[] {
  let text: string;
  try { text = readFileSync(studioChatFile(root), "utf-8"); } catch { return []; }
  const out: StudioLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const o = JSON.parse(raw);
      if (isObject(o) && typeof o.seq === "number" && Number.isFinite(o.seq)) out.push(o as unknown as StudioLine);
    } catch { /* a torn line */ }
  }
  return out;
}

/** The lines with `seq > since`. */
export const studioChatSince = (root: string, since: number): StudioLine[] => readStudioChat(root).filter((l) => l.seq > since);

/** The last line's seq (0 while there is none). */
export const lastStudioSeq = (root: string): number => readStudioChat(root).reduce((m, l) => Math.max(m, l.seq), 0);

// ------------------------------------------------------------ the lock

function tryLock(lock: string, now: () => number): "acquired" | "held" {
  mkdirSync(join(lock, ".."), { recursive: true });
  for (;;) {
    try { closeSync(openSync(lock, "wx")); return "acquired"; } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
    }
    let mtime: number;
    try { mtime = statSync(lock).mtimeMs; } catch { continue; } // released meanwhile
    if (now() - mtime <= STUDIO_LOCK_STALE_MS) return "held";
    takeOverStale(lock, now);
  }
}

const release = (lock: string) => { try { rmSync(lock, { force: true }); } catch { /* best effort */ } };

/** Run `fn` holding `studio-chat.lock` (synchronous waits: the pass's). */
export function withStudioLock<T>(root: string, fn: () => T, waitMs = STUDIO_LOCK_WAIT_MS, now: () => number = Date.now): T {
  const lock = lockFile(root);
  const deadline = now() + waitMs;
  while (tryLock(lock, now) === "held") {
    if (now() >= deadline) throw new StudioChatBusy();
    Bun.sleepSync(20);
  }
  try { return fn(); } finally { release(lock); }
}

/** Run `fn` holding `studio-chat.lock`, its wait an async sleep (the route's: a held lock never stalls the server).
 * `fn` runs synchronously under the lock. */
export async function withStudioLockAsync<T>(
  root: string, fn: () => T, waitMs = STUDIO_LOCK_WAIT_MS, now: () => number = Date.now,
  sleep: (ms: number) => Promise<unknown> = (ms) => Bun.sleep(ms),
): Promise<T> {
  const lock = lockFile(root);
  const deadline = now() + waitMs;
  while (tryLock(lock, now) === "held") {
    if (now() >= deadline) throw new StudioChatBusy();
    await sleep(20);
  }
  try { return fn(); } finally { release(lock); }
}

/** Append one line, the caller holding the lock: the last `seq` re-read, the line given `seq = last + 1`, the file
 * rewritten whole, atomically. Answers the line written. */
export function appendStudioLineHeld(root: string, line: Omit<StudioLine, "seq">): StudioLine {
  let text = "";
  try { text = readFileSync(studioChatFile(root), "utf-8"); } catch { /* absent: a new file */ }
  let last = 0;
  for (const l of readStudioChat(root)) if (l.seq > last) last = l.seq;
  const written = { seq: last + 1, ...line } as StudioLine;
  if (text && !text.endsWith("\n")) text += "\n";
  atomicWrite(studioChatFile(root), text + JSON.stringify(written) + "\n");
  return written;
}

/** Remove the line `seq` (the caller holding the lock): a turn whose run could not be minted. Every other line kept
 * byte for byte; a file left empty is removed. */
export function dropStudioLineHeld(root: string, seq: number): void {
  let text: string;
  try { text = readFileSync(studioChatFile(root), "utf-8"); } catch { return; }
  const kept = text.split("\n").filter((raw) => {
    if (!raw.trim()) return false;
    try { const o = JSON.parse(raw); return !(isObject(o) && o.seq === seq); } catch { return true; }
  });
  if (!kept.length) { rmSync(studioChatFile(root), { force: true }); return; }
  atomicWrite(studioChatFile(root), kept.join("\n") + "\n");
}

/** Mark the line `seq` `unqueued: true` in place (the caller holding the lock): a `queue` press line whose submit did
 * not answer 2xx. The line keeps its seq (a reader may already have streamed it; the next append never reuses it);
 * every other line kept byte for byte. Answers whether the line was found. */
export function markUnqueuedHeld(root: string, seq: number): boolean {
  let text: string;
  try { text = readFileSync(studioChatFile(root), "utf-8"); } catch { return false; }
  let found = false;
  const out = text.split("\n").map((raw) => {
    if (!raw.trim()) return raw;
    try {
      const o = JSON.parse(raw);
      if (!isObject(o) || o.seq !== seq) return raw;
      found = true;
      return JSON.stringify({ ...o, unqueued: true });
    } catch { return raw; }
  });
  if (found) atomicWrite(studioChatFile(root), out.join("\n"));
  return found;
}

// ------------------------------------------------------------ the body (Settled shape 5)

export type StudioChatBody =
  | { ok: true; kind: "text"; project: string; text: string }
  | { ok: true; kind: "pressed"; project: string; pressed: { seq: number; index: number } }
  | { ok: false; error: "SchemaError"; detail: string }
  | { ok: false; error: "LineTooLong"; detail: string; limit: number; length: number };

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** `POST /chat`: exactly `{project, text}` (a non-blank string of at most LINE_MAX_CHARS code points) or `{project,
 * pressed: {seq, index}}`. */
export function checkStudioChatBody(raw: unknown): StudioChatBody {
  const bad = (detail: string): StudioChatBody => ({ ok: false, error: "SchemaError", detail });
  if (!isObject(raw)) return bad("the body must be a JSON object");
  for (const k of Object.keys(raw)) if (!["project", "text", "pressed"].includes(k)) return bad(`unknown field '${k}' (allowed: project, text, pressed)`);
  if (typeof raw.project !== "string" || !raw.project.trim()) return bad("field 'project' must be a non-empty string");
  const project = raw.project.trim();
  const hasText = "text" in raw, hasPressed = "pressed" in raw;
  if (hasText === hasPressed) return bad("exactly one of 'text' and 'pressed' is required");
  if (hasText) {
    if (typeof raw.text !== "string" || !raw.text.trim()) return bad("field 'text' must be a non-blank string");
    const length = [...raw.text].length;
    if (length > LINE_MAX_CHARS) {
      return { ok: false, error: "LineTooLong", detail: `the line is ${length} characters; the limit is ${LINE_MAX_CHARS}`, limit: LINE_MAX_CHARS, length };
    }
    return { ok: true, kind: "text", project, text: raw.text };
  }
  const p = raw.pressed;
  if (!isObject(p)) return bad("field 'pressed' must be an object {seq, index}");
  for (const k of Object.keys(p)) if (k !== "seq" && k !== "index") return bad(`unknown field 'pressed.${k}' (allowed: seq, index)`);
  if (!isIndex(p.seq) || p.seq < 1) return bad("field 'pressed.seq' must be a reply's seq (a positive integer)");
  if (!isIndex(p.index)) return bad("field 'pressed.index' must be a proposal index (a non-negative integer)");
  return { ok: true, kind: "pressed", project, pressed: { seq: p.seq, index: p.index } };
}

// ------------------------------------------------------------ the queueing (Settled shapes 5, 10)

/** The pending turns, by seq: owner lines with no `pressed` and no reply whose `reply_to` is their seq. */
export function pendingTurns(lines: readonly StudioLine[]): StudioLine[] {
  const answered = new Set<number>();
  for (const l of lines) if (l.author === "planner" && typeof l.reply_to === "number") answered.add(l.reply_to);
  return lines.filter((l) => l.author === "owner" && !l.pressed && !answered.has(l.seq)).sort((a, b) => a.seq - b.seq);
}

/** A line's excerpt: whitespace runs collapsed to one space and trimmed; longer than 40 code points, cut to 40 and
 * `…` appended. */
export function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const cps = [...flat];
  return cps.length > EXCERPT_MAX ? `${cps.slice(0, EXCERPT_MAX).join("")}…` : flat;
}

/** The POST answer's note for a line queued behind `body`'s turn. */
export const behindNote = (body: string): string => `Queued behind the reply to '${excerpt(body)}'`;

/** The run a studio turn (`seq`) of `project` was queued as, from its `chat-queued` event; else null. */
export function turnRunId(queue: Queue, project: string, seq: number): string | null {
  for (const ev of queue.serviceEvents("chat-queued")) {
    const d = ev.detail ?? {};
    if (d.chat === "studio" && d.project === project && d.seq === seq && typeof d.run_id === "string") return d.run_id;
  }
  return null;
}

/** The proposal `index` of the reply `seq`, else null (no such reply, or no such index). */
export function findProposal(lines: readonly StudioLine[], seq: number, index: number): Record<string, unknown> | null {
  const reply = lines.find((l) => l.seq === seq && l.author === "planner");
  const p = reply && Array.isArray(reply.proposals) ? reply.proposals[index] : undefined;
  return isObject(p) && typeof p.kind === "string" ? p : null;
}

// ------------------------------------------------------------ the turn (Settled shapes 5, 7)

export interface StudioTurn { project: string; root: string; seq: number; behind: string | null }

export interface PreparedStudioTurn { v: ResolvedJob; where: { lockCheckout?: string | null; prefix?: string | null } }

/** Mint the turn's `studio-chat` run (synchronous: called right after the append, under the lock) and record
 * `chat-queued`; a failed event cancels the run and rethrows. */
export function mintStudioTurn(queue: Queue, prepared: PreparedStudioTurn, turn: StudioTurn): { run_id: string; model: string | null; effort: string | null } {
  const { v, where } = prepared;
  const payload = { project: turn.project, project_root: turn.root, seq: turn.seq };
  const definition = { ...v.definition, target: { ...(v.definition.target ?? {}), payload: { ...(v.definition.target?.payload ?? {}), ...payload } } };
  const leg = plannerLeg(turn.root, v.root);
  const lane = `${where.lockCheckout || checkoutKey(v.root)}${STUDIO_LANE}`;
  const { run } = queue.enqueue({
    jobId: STUDIO_CHAT_JOB, root: v.root, projectId: v.projectId, target: v.target, definition,
    ...(where.prefix !== undefined ? { prefix: where.prefix } : {}), lockCheckout: lane,
    tier: "host", ...(leg.model ? { model: leg.model } : {}), ...(leg.effort ? { effort: leg.effort } : {}),
    stack: true, payload,
  });
  const model = leg.model ?? null, effort = leg.effort ?? null;
  try {
    queue.serviceEvent("chat-queued", { chat: "studio", project: turn.project, seq: turn.seq, run_id: run.run_id, model, effort, behind: turn.behind });
  } catch (e) {
    try { queue.end(run.run_id, "cancelled", `ChatQueueFailed: ${e instanceof Error ? e.message : String(e)}`); } catch { /* already ended */ }
    throw e;
  }
  return { run_id: run.run_id, model, effort };
}

// ------------------------------------------------------------ the reads (Settled shape 12)

/** Write the turn's reads file atomically (serve, inside the post's lock). */
export function writeReads(root: string, seq: number, reads: Record<string, unknown>): void {
  atomicWrite(readsFile(root, seq), JSON.stringify(reads, null, 2) + "\n");
}

export const removeReads = (root: string, seq: number): void => { try { rmSync(readsFile(root, seq), { force: true }); } catch { /* best effort */ } };

// ------------------------------------------------------------ the stream (Settled shape 6)

const OPEN = "<reply>", CLOSE = "</reply>";

/** The streamed reply in `acc`: the text after the first `<reply>`, up to `</reply>` or the end, a trailing partial
 * prefix of `</reply>` held back; null before `<reply>`. */
export function replyText(acc: string): string | null {
  const at = acc.indexOf(OPEN);
  if (at < 0) return null;
  const rest = acc.slice(at + OPEN.length);
  const end = rest.indexOf(CLOSE);
  if (end >= 0) return rest.slice(0, end);
  for (let n = Math.min(CLOSE.length - 1, rest.length); n > 0; n--) {
    if (CLOSE.startsWith(rest.slice(rest.length - n))) return rest.slice(0, rest.length - n);
  }
  return rest;
}

/** The kept text of one stream-json line, else null: a top-level (`parent_tool_use_id: null`) `text_delta`. */
export function textDelta(o: unknown): string | null {
  if (!isObject(o) || o.type !== "stream_event" || o.parent_tool_use_id !== null) return null;
  const ev = o.event;
  if (!isObject(ev) || ev.type !== "content_block_delta") return null;
  const d = ev.delta;
  return isObject(d) && d.type === "text_delta" && typeof d.text === "string" ? d.text : null;
}

export interface TapOptions {
  now?: () => number;
  throttleMs?: number;
  /** Schedule a deferred flush (default `setTimeout`, unref'd); tests pass one that records. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

/** The worker's stdout tap: lines parsed, top-level text deltas accumulated, the reply text written to the stream
 * file whenever it grew, at most every `throttleMs` (a deferred flush covers a quiet stretch), finally in `close()`.
 * Every error is swallowed. */
export function studioChatTap(root: string, runId: string, opts: TapOptions = {}): { write(chunk: string): void; close(): void } {
  const now = opts.now ?? Date.now;
  const throttle = opts.throttleMs ?? TAP_THROTTLE_MS;
  const schedule = opts.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return () => clearTimeout(t); });
  let buf = "", acc = "", written = -1, lastAt = -Infinity, cancel: (() => void) | null = null, closed = false;
  const path = streamFile(root, runId);
  const flush = () => {
    try {
      if (cancel) { cancel(); cancel = null; }
      const text = replyText(acc);
      if (text === null || text.length <= written) return;
      atomicWrite(path, text);
      written = text.length;
      lastAt = now();
    } catch { /* never reaches the worker */ }
  };
  const maybe = () => {
    const text = replyText(acc);
    if (text === null || text.length <= written) return;
    const wait = throttle - (now() - lastAt);
    if (wait <= 0) { flush(); return; }
    if (!cancel && !closed) cancel = schedule(() => { cancel = null; flush(); }, wait);
  };
  const line = (raw: string) => {
    if (!raw.trim()) return;
    let o: unknown;
    try { o = JSON.parse(raw); } catch { return; }
    const t = textDelta(o);
    if (t) acc += t;
  };
  return {
    write(chunk: string) {
      try {
        if (closed) return;
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
        maybe();
      } catch { /* swallowed */ }
    },
    close() {
      try {
        if (closed) return;
        line(buf);
        buf = "";
        closed = true;
        flush();
      } catch { /* swallowed */ }
    },
  };
}

/** A run's streamed reply text so far, else null (no file). */
export function readStream(root: string, runId: string): string | null {
  try { return readFileSync(streamFile(root, runId), "utf-8"); } catch { return null; }
}

/** One `chat-delta` frame (no `id:` line: `Last-Event-ID` stays the chat seq). */
export const deltaFrame = (d: { run_id: string; reply_to: number; from: number; text: string }): string =>
  `event: chat-delta\ndata: ${JSON.stringify({ run_id: d.run_id, reply_to: d.reply_to, from: d.from, text: d.text })}\n\n`;

// ------------------------------------------------------------ the pass (Settled shape 9)

export interface StudioChatPassResult { failed: string[]; cleaned: string[] }

/** The failure reply's body: the run's end state and its reason, one line, at most 200 characters. */
export function failureBody(state: string, reason: string | null | undefined): string {
  const flat = (reason ?? "no reason recorded").replace(/\s+/g, " ").trim() || "no reason recorded";
  const cps = [...flat];
  return `No reply: the run ended ${state}: ${cps.length > 200 ? cps.slice(0, 200).join("") : flat}`;
}

/** The studio-chat pass (see the header). For each `chat-queued` event with `chat: "studio"` whose run is terminal,
 * at the run's payload `project_root` (else its root): the failure reply appended once when no reply names the run
 * (or answers the line), then the stream and reads files removed. Idempotent; never throws. Each root's chat is read
 * at most once per pass (re-read under the lock only before an append, then refreshed). */
export function studioChatPass(queue: Queue, opts: { now?: () => number } = {}): StudioChatPassResult {
  const out: StudioChatPassResult = { failed: [], cleaned: [] };
  const clock = opts.now ?? Date.now;
  const chats = new Map<string, StudioLine[]>();
  const chatOf = (root: string): StudioLine[] => {
    let lines = chats.get(root);
    if (!lines) { lines = readStudioChat(root); chats.set(root, lines); }
    return lines;
  };
  try {
    for (const ev of queue.serviceEvents("chat-queued")) {
      try {
        const d = ev.detail ?? {};
        if (d.chat !== "studio" || typeof d.run_id !== "string" || typeof d.seq !== "number") continue;
        const run = queue.get(d.run_id);
        if (!run || !isTerminal(run.state)) continue;
        const served = queue.runPayload(d.run_id)?.project_root;
        const root = typeof served === "string" && served !== "" ? served : run.root;
        const runId = d.run_id, seq = d.seq;
        const answered = (lines: StudioLine[]) => lines.some((l) => l.author === "planner" && (l.run_id === runId || l.reply_to === seq));
        if (!answered(chatOf(root))) {
          const appended = withStudioLock(root, () => {
            const fresh = readStudioChat(root);
            chats.set(root, fresh);
            if (answered(fresh)) return false;
            const line = appendStudioLineHeld(root, {
              at: new Date(clock()).toISOString(), author: "planner", body: failureBody(run.state, run.reason),
              run_id: runId, reply_to: seq, proposals: [], failed: true,
            });
            chats.set(root, [...fresh, line]);
            return true;
          });
          if (appended) out.failed.push(runId);
        }
        const hadFiles = readStream(root, runId) !== null || statOk(readsFile(root, seq));
        try { rmSync(streamFile(root, runId), { force: true }); } catch { /* the next pass */ }
        removeReads(root, seq);
        if (hadFiles) out.cleaned.push(runId);
      } catch { /* this turn on the next pass */ }
    }
  } catch { /* the next pass */ }
  return out;
}

const statOk = (p: string): boolean => { try { statSync(p); return true; } catch { return false; } };
