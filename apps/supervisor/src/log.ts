#!/usr/bin/env bun
/**
 * log.ts — the supervisor's log file (Story 33.1, hole 66: the console tab was the only log).
 *
 * Every line the console shows also lands in `<TK_SUPERVISOR_WORK>/supervisor/logs/supervisor-<YYYY-MM-DD>.log`
 * (one file per UTC day, the newest `KEEP_DAYS` kept), stamped `<ISO UTC time> [<tag>] <text>`, the tag one of
 * `LOG_TAGS`: `serve`, `tick` and `drain` are the three bun processes `start.ps1` runs (each under this file's tee),
 * `keeper` and `pacer` are `start.ps1`'s own two roles (it writes its lines itself, in the same shape).
 *
 * Redaction (NFR5) is the page's `redactCredentials`, reused, never copied: applied before the append and again on
 * read (`readLogTail`), so `GET /status`'s `log` and the page's section never carry a token.
 *
 * As a script it is the tee: `bun src/log.ts --tag <serve|tick|drain> -- <bun script> [args…]` spawns the script
 * under this bun, echoes each of its stdout and stderr lines to the same console stream, appends each stamped and
 * redacted, adds `started: bun <args>` at the spawn, `stopped (exit <code>)` or `stopped (signal <sig>)` at the end
 * (plus `uncaught: <line>` when a non-zero exit printed an error line), and exits with the child's code — so
 * `start.ps1`'s `$LASTEXITCODE` (and the keeper's exit-75 rule) read the child's exit as before. Ctrl+C reaches the
 * child through the shared console; the tee ignores SIGINT (and SIGBREAK on Windows) while the child runs, so it
 * outlives the child to log its `stopped` line, and forwards nothing and kills nothing.
 *
 * A pacer pass (Story 33.7): `--tag <tick|drain> --pass -- …` (only `start.ps1`'s `Invoke-PacerStep` passes it; the
 * recover step never does) also times the child from spawn to `close` and, before its `stopped` line, appends
 * `pass: <ms> ms, exit <code>`; a pass over `SLOW_PASS_MS` appends `warning: pass <tag> took <ms> ms (over 10 min),
 * driving <run ids>` (the queue run ids its output named) and sends that line once through the notifier. The last
 * pass of each step lands in `<TK_SUPERVISOR_WORK>/supervisor/pacer.json` (`readPacer`), served on `GET /status` as
 * `pacer` (contract 0.1.28) and shown on the status page.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { notifier, workDir } from "./env";
import { NOTICE_MAX_BYTES, sendText } from "./hygiene";
import { redactCredentials, tailLines } from "./page";

type Env = Record<string, string | undefined>;

export const LOG_TAGS = ["serve", "tick", "drain", "keeper", "pacer"] as const;
export type LogTag = (typeof LOG_TAGS)[number];
/** Day files kept (the newest by name: the date sorts). */
export const KEEP_DAYS = 14;
/** Lines `GET /status` and the page show. */
export const TAIL_LINES = 20;

const DAY_FILE = /^supervisor-\d{4}-\d{2}-\d{2}\.log$/;

/** The answer `GET /status` carries as `log` (contract 0.1.28) and the page renders. `note` only when `last_lines`
 * is empty for that reason. */
export type LogTail = { path: string | null; last_lines: string[]; note?: "no log" | "TK_SUPERVISOR_WORK is not set" };

/** `<TK_SUPERVISOR_WORK>/supervisor/logs`, or undefined when the work folder is unset. */
export function logDir(env: Env = process.env): string | undefined {
  const work = workDir(env);
  return work ? join(work, "supervisor", "logs") : undefined;
}

/** The UTC day of a clock reading, `YYYY-MM-DD`. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's (UTC) day file, or undefined when the work folder is unset. */
export function logPath(env: Env, now: () => number): string | undefined {
  const dir = logDir(env);
  return dir ? join(dir, `supervisor-${dayOf(now())}.log`) : undefined;
}

/** One log line: `<ISO UTC time> [<tag>] <text>`; an embedded newline becomes a space, a CR is dropped. */
export function formatLine(tag: LogTag, text: string, now: () => number): string {
  return `${new Date(now()).toISOString()} [${tag}] ${text.replace(/\r/g, "").replace(/\n/g, " ")}`;
}

/** A line's redaction: exactly the page's rule (Settled shape 2). */
export function redactLine(text: string, env: Env, token = ""): string {
  return redactCredentials(text, env, token);
}

/** Appends one stamped, redacted line to today's file (one append per line: the script and every tee share it).
 * A day file this append creates rotates the folder. Answers the file written, or undefined (no work folder). */
export function appendLine(env: Env, tag: LogTag, text: string, now: () => number): string | undefined {
  const dir = logDir(env);
  const path = logPath(env, now);
  if (!dir || !path) return undefined;
  mkdirSync(dir, { recursive: true });
  const fresh = !existsSync(path);
  appendFileSync(path, formatLine(tag, redactLine(text, env), now) + "\n");
  if (fresh) rotateLogs(dir, now);
  return path;
}

/** Keeps the newest `keep` day files (`supervisor-YYYY-MM-DD.log`, sorted by name) and unlinks the rest; today's
 * file is never removed. Any other file in the folder is never touched. Answers the removed names. */
export function rotateLogs(dir: string, now: () => number, keep = KEEP_DAYS): string[] {
  let names: string[];
  try { names = readdirSync(dir).filter((n) => DAY_FILE.test(n)).sort(); } catch { return []; }
  const today = `supervisor-${dayOf(now())}.log`;
  const removed: string[] = [];
  for (const name of names.slice(0, Math.max(0, names.length - keep))) {
    if (name === today) continue;
    try { unlinkSync(join(dir, name)); removed.push(name); } catch { /* gone already, or held: the next rotation */ }
  }
  return removed;
}

/** The newest log's last `n` lines, each redacted (Settled shape 1): today's file, else the newest day file
 * present; `{path, last_lines: [], note}` when there is none (`path` today's file) or the work folder is unset
 * (`path` null). */
export function readLogTail(env: Env, now: () => number, n = TAIL_LINES): LogTail {
  const dir = logDir(env);
  const today = logPath(env, now);
  if (!dir || !today) return { path: null, last_lines: [], note: "TK_SUPERVISOR_WORK is not set" };
  let path: string | undefined = existsSync(today) ? today : undefined;
  if (!path) {
    let names: string[] = [];
    try { names = readdirSync(dir).filter((x) => DAY_FILE.test(x)).sort(); } catch { /* no folder */ }
    if (names.length) path = join(dir, names[names.length - 1]);
  }
  if (!path) return { path: today, last_lines: [], note: "no log" };
  try { return { path, last_lines: tailLines(path, n).map((l) => redactLine(l, env)) }; }
  catch { return { path, last_lines: [], note: "no log" }; }
}

// ------------------------------------------------------------ the pacer's last pass (Story 33.7)

/** A pass longer than this (ms, 10 min) is logged as a warning and sent once through the notifier. */
export const SLOW_PASS_MS = 600_000;
/** The pacer steps a `--pass` may time. */
export const PASS_TAGS = ["tick", "drain"] as const;
/** The last pass of each pacer step: `GET /status`'s `pacer` (contract 0.1.28) and the page's line. */
export type Pacer = {
  last_tick_ms: number | null; last_drain_ms: number | null; last_pass_at: string | null;
  /** Story 36.5 (CAP-15, DW-63): a pass past SLOW_PASS_MS, written while it runs and removed at its end. */
  running?: PacerRunning;
};
export type PacerRunning = { tag: string; started_at: string; elapsed_ms: number; ids: string[] };

const NO_PACER: Pacer = { last_tick_ms: null, last_drain_ms: null, last_pass_at: null };
/** The queue run id shape (`queue.ts` `mintRunId`: `q-<job id>-<yyyymmddThhmmssZ>-<6 hex>`). */
const RUN_ID = /\bq-[A-Za-z0-9][A-Za-z0-9._-]*-\d{8}T\d{6}Z-[0-9a-f]{6}\b/g;
/** Run ids a slow-pass warning names before `+<n> more`. */
const NAMED_IDS = 5;

/** `<TK_SUPERVISOR_WORK>/supervisor/pacer.json`, or undefined when the work folder is unset. */
export function pacerPath(env: Env = process.env): string | undefined {
  const work = workDir(env);
  return work ? join(work, "supervisor", "pacer.json") : undefined;
}

/** The last pacer passes: each field a number, an ISO string or `null`; all `null` when the file is absent,
 * unreadable or invalid, or the work folder is unset. Never throws. */
export function readPacer(env: Env = process.env): Pacer {
  const path = pacerPath(env);
  if (!path) return { ...NO_PACER };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...NO_PACER };
    const ms = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const r = raw.running;
    const running = r && typeof r.tag === "string" && typeof r.started_at === "string" && ms(r.elapsed_ms) !== null
      && Array.isArray(r.ids) && r.ids.every((id: unknown) => typeof id === "string") ? { running: { tag: r.tag, started_at: r.started_at, elapsed_ms: r.elapsed_ms, ids: r.ids } } : {};
    return {
      last_tick_ms: ms(raw.last_tick_ms), last_drain_ms: ms(raw.last_drain_ms),
      last_pass_at: typeof raw.last_pass_at === "string" && raw.last_pass_at ? raw.last_pass_at : null,
      ...running,
    };
  } catch { return { ...NO_PACER }; }
}

/** Records one pass (read-modify-write: only its step's field and `last_pass_at`), atomically (a temp file, then a
 * rename), its own `running` member removed (another step's stays). Nothing is written with the work folder unset; a
 * failure is swallowed (the log line still stands). */
export function writePacer(env: Env, tag: (typeof PASS_TAGS)[number], ms: number, at: string): void {
  updatePacer(env, (cur) => {
    const { running, ...rest } = cur;
    return { ...rest, ...(running && running.tag !== tag ? { running } : {}), [`last_${tag}_ms`]: ms, last_pass_at: at };
  });
}

/** Story 36.5 (DW-63): the pass still running past SLOW_PASS_MS (the same atomic read-modify-write). */
export function writePacerRunning(env: Env, running: PacerRunning): void {
  updatePacer(env, (cur) => ({ ...cur, running }));
}

function updatePacer(env: Env, change: (cur: Pacer) => Pacer): void {
  const path = pacerPath(env);
  if (!path) return;
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    const next = change(readPacer(env));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(next) + "\n");
    renameSync(tmp, path);
  } catch {
    try { unlinkSync(tmp); } catch { /* never written */ }
  }
}

/** The slow-pass warning: the step, the duration and the run ids its output named (at most `NAMED_IDS`). */
export function slowPassLine(tag: string, ms: number, ids: string[]): string {
  const named = ids.length === 0 ? "no run named"
    : ids.slice(0, NAMED_IDS).join(", ") + (ids.length > NAMED_IDS ? ` +${ids.length - NAMED_IDS} more` : "");
  return `warning: pass ${tag} took ${ms} ms (over 10 min), driving ${named}`;
}

/** The longest prefix of `s` (whole code points) within `max` UTF-8 bytes. */
function clipUtf8(s: string, max: number): string {
  if (Buffer.byteLength(s, "utf-8") <= max) return s;
  let out = "";
  for (const ch of s) {
    if (Buffer.byteLength(out + ch, "utf-8") > max) break;
    out += ch;
  }
  return out;
}

// ------------------------------------------------------------ the tee

export interface TeeIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** The bun that runs the child (default `process.execPath`). */
  execPath?: string;
  cwd?: string;
  /** The slow-pass notifier send's fetch (default the global; Story 33.7). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Story 36.5: the slow-pass timer's seam (default the globals; the tests drive a fake clock). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

const USAGE = `usage: bun src/log.ts --tag <${LOG_TAGS.join("|")}> [--pass] -- <bun script> [args...]  (--pass only with ${PASS_TAGS.join("|")})`;
const ERROR_LINE = /^(error|uncaught|unhandled)/i;

/** `--tag <tag> [--pass] -- <script> [args…]` (`--pass` only with `tick` or `drain`), or null (the usage). */
export function parseTeeArgs(argv: string[]): { tag: LogTag; pass: boolean; args: string[] } | null {
  if (argv[0] !== "--tag" || !(LOG_TAGS as readonly string[]).includes(argv[1] ?? "")) return null;
  const pass = argv[2] === "--pass";
  if (pass && !(PASS_TAGS as readonly string[]).includes(argv[1]!)) return null;
  const sep = pass ? 3 : 2;
  if (argv[sep] !== "--" || argv.length < sep + 2) return null;
  return { tag: argv[1] as LogTag, pass, args: argv.slice(sep + 1) };
}

/** The tee's body (injectable for the test): answers the exit code the wrapper exits with (the child's; `null` → 1;
 * the usage → 2). An append that fails never stops the child or the echo. */
export function runUnderLog(argv: string[], env: Env, now: () => number, io: TeeIo): Promise<number> {
  const parsed = parseTeeArgs(argv);
  if (!parsed) { io.stderr(USAGE + "\n"); return Promise.resolve(2); }
  const { tag, pass, args } = parsed;
  const log = (text: string) => { try { appendLine(env, tag, text, now); } catch { /* the console still has it */ } };
  return new Promise<number>((resolve) => {
    let settled = false;
    let errorLine: string | null = null;
    const runIds: string[] = [];
    let started = 0;
    // Story 36.5 (DW-63): the warning and its one notifier line, once: from the timer while the pass runs, else from `finish`.
    let warned = false;
    let sent: Promise<unknown> = Promise.resolve();
    let timer: unknown;
    const warn = (ms: number) => {
      warned = true;
      const warning = slowPassLine(tag, ms, runIds);
      log(warning);
      sent = (async () => {
        try {
          const n = notifier(env);
          if (n.kind !== "none") await sendText(n, clipUtf8(warning, NOTICE_MAX_BYTES), io.fetch ?? fetch);
        } catch { /* a notifier unset, misconfigured or failing: the log line stands */ }
      })();
    };
    const finish = (code: number, why: string) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) (io.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(timer);
      if (code !== 0 && errorLine !== null && !/^uncaught:/i.test(errorLine)) log(`uncaught: ${errorLine}`);
      if (pass) {
        const end = now();
        const ms = Math.max(0, end - started);
        log(`pass: ${ms} ms, exit ${code}`);
        if (ms > SLOW_PASS_MS && !warned) warn(ms);
        writePacer(env, tag as (typeof PASS_TAGS)[number], ms, new Date(end).toISOString());
      }
      void sent.then(() => {
        log(`stopped (${why})`);
        resolve(code);
      });
    };
    log(`started: bun ${args.join(" ")}`);
    started = now();
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(io.execPath ?? process.execPath, args, { stdio: ["inherit", "pipe", "pipe"], env, cwd: io.cwd, windowsHide: false });
    } catch (e) {
      log(`uncaught: ${e instanceof Error ? e.message : String(e)}`);
      finish(1, "spawn failed");
      return;
    }
    const pump = (stream: NodeJS.ReadableStream | null, write: (s: string) => void, isErr: boolean) => {
      const decoder = new StringDecoder("utf8");
      let rest = "";
      const line = (raw: string) => {
        const text = raw.replace(/\r$/, "");
        write(text + "\n");
        log(text);
        if (pass) for (const id of text.match(RUN_ID) ?? []) if (!runIds.includes(id)) runIds.push(id);
        if (isErr && ERROR_LINE.test(text.trim())) errorLine = text.trim();
      };
      const done = new Promise<void>((ok) => {
        if (!stream) { ok(); return; }
        stream.on("data", (chunk: Buffer) => {
          const parts = (rest + decoder.write(chunk)).split("\n");
          rest = parts.pop() ?? "";
          for (const p of parts) line(p);
        });
        stream.on("end", () => { rest += decoder.end(); if (rest) line(rest); rest = ""; ok(); });
        stream.on("error", () => ok());
      });
      return done;
    };
    if (pass) {
      timer = (io.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
        if (settled || warned) return;
        const at = now();
        const elapsed = Math.max(0, at - started);
        warn(elapsed);
        writePacerRunning(env, { tag, started_at: new Date(started).toISOString(), elapsed_ms: elapsed, ids: [...runIds] });
      }, SLOW_PASS_MS);
    }
    const flushed = Promise.all([pump(child.stdout, io.stdout, false), pump(child.stderr, io.stderr, true)]);
    child.on("error", (e) => {
      log(`uncaught: ${e.message}`);
      finish(1, "spawn failed");
    });
    child.on("close", (code, signal) => {
      void flushed.then(() => finish(code ?? 1, code !== null ? `exit ${code}` : `signal ${signal ?? "unknown"}`));
    });
  });
}

/** The script entry: the tee under the real clock and environment. */
export async function main(argv: string[]): Promise<number> {
  // Ctrl+C (and Ctrl+Break on Windows) reaches the child through the shared console and the tee alike: while the
  // child runs the tee ignores both (no-op handlers, nothing forwarded, nothing killed), so it outlives the child
  // and logs its `stopped` line. SIGTERM keeps its default: only a kill aimed at the tee sends it.
  const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGBREAK"] : ["SIGINT"];
  const ignore = () => { /* the child decides */ };
  for (const sig of signals) process.on(sig, ignore);
  try {
    return await runUnderLog(argv, process.env, Date.now, {
      stdout: (s) => { process.stdout.write(s); },
      stderr: (s) => { process.stderr.write(s); },
    });
  } finally {
    for (const sig of signals) process.off(sig, ignore);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => {
    process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
  });
}
