/**
 * transcript.ts — turns and tokens a worker iteration spent (Story 21.5, AC2).
 *
 * The studio's `account` verb takes the turns and tokens of each worker
 * iteration; the supervisor reads them from the worker's session transcript
 * on the host: `<CLAUDE_CONFIG_DIR ?? ~/.claude>/projects/<cwd slug>/<session_id>.jsonl`,
 * found by session id (no slug derivation), exactly one match — zero or
 * several is a named failure, never a guess. The worker's subagents write
 * their own transcripts beside it, `<slug>/<session_id>/subagents/*.jsonl`:
 * each is read too (a missing directory counts zero, an unreadable file is a
 * named failure) and all are merged by assistant `message.id`, so a message
 * seen in two files counts once.
 *
 * On the sbx tier the transcript lives inside the microVM, so the counts come
 * from the worker's JSON result (`num_turns`, `usage`) instead (recorded DRIFT).
 *
 * Turns = distinct assistant `message.id`s. Tokens = the sum, over distinct
 * assistant messages, of `input_tokens + output_tokens +
 * cache_creation_input_tokens + cache_read_input_tokens` (a message split
 * over several lines is counted once, with its last-seen usage).
 *
 * Resume (Story 21.6): a resumed session (`--resume`, never `--fork-session`)
 * appends to the same `<session_id>.jsonl`, so a resumed iteration counts only
 * the message ids not already accounted (`transcriptNewCounts`). Before a
 * resume the transcript must exist: on the host a missing one is restored from
 * the nightly backup root named by `TK_SUPERVISOR_TRANSCRIPT_BACKUP` (runbook
 * §6's `claude-projects` folder: exactly one `<slug>/<session_id>.jsonl`, copied
 * with its `<session_id>/subagents/` into the same slug directory); on sbx its
 * existence is asked inside the microVM (`sbx exec <sb> find …`, argv only) —
 * the host backup never covers the VM.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sbxBin } from "./env";
import { runProcess, type RunResult } from "./server";

export interface Counts { turns: number; tokens: number }

/** A transcript that cannot be located or read, or a result without counts. */
export class TranscriptError extends Error {
  constructor(msg: string) { super(msg); this.name = "TranscriptError"; }
}

const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;

/** The token sum of one `usage` object (absent or non-numeric fields count 0). */
export function usageTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  let sum = 0;
  for (const f of TOKEN_FIELDS) {
    const v = (usage as Record<string, unknown>)[f];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) sum += v;
  }
  return sum;
}

/** Pure: turns and tokens over one or more transcripts' JSONL texts, merged
 * by assistant `message.id` (a message seen in several texts, or on several
 * lines, counts once, with its last-seen usage). Unparseable lines and
 * non-assistant entries are skipped. */
export function parseTranscripts(texts: readonly string[]): Counts {
  return countsOf(messageUsages(texts));
}

/** Assistant `message.id` → its last-seen usage, over the texts in order. */
function messageUsages(texts: readonly string[]): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry: any;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || typeof entry !== "object" || entry.type !== "assistant") continue;
      const msg = entry.message;
      if (!msg || typeof msg !== "object" || typeof msg.id !== "string" || !msg.id) continue;
      byId.set(msg.id, msg.usage ?? byId.get(msg.id));
    }
  }
  return byId;
}

function countsOf(byId: Map<string, unknown>): Counts {
  let tokens = 0;
  for (const usage of byId.values()) tokens += usageTokens(usage);
  return { turns: byId.size, tokens };
}

/** Pure: turns and tokens from one session transcript's JSONL text. */
export function parseTranscript(text: string): Counts {
  return parseTranscripts([text]);
}

/** The claude config dir: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function claudeConfigDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  return dir ? dir : join(home, ".claude");
}

/** `projects/*\/<sessionId>.jsonl` under the config dir — exactly one, else TranscriptError. */
export function locateTranscript(sessionId: string, configDir: string = claudeConfigDir()): string {
  if (!sessionId || /[\\/]/.test(sessionId) || sessionId.includes("..")) {
    throw new TranscriptError(`transcript: session id '${sessionId}' is not a plain id`);
  }
  const projects = join(configDir, "projects");
  if (!existsSync(projects)) throw new TranscriptError(`transcript for session ${sessionId} not found: no ${projects}`);
  const name = `${sessionId}.jsonl`;
  const matches: string[] = [];
  for (const d of readdirSync(projects, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const candidate = join(projects, d.name, name);
    if (existsSync(candidate)) matches.push(candidate);
  }
  if (matches.length === 0) throw new TranscriptError(`transcript for session ${sessionId} not found under ${projects}`);
  if (matches.length > 1) throw new TranscriptError(`transcript for session ${sessionId} is ambiguous: ${matches.length} matches under ${projects}`);
  return matches[0];
}

/** The session's subagent transcripts: every `*.jsonl` directly in
 * `<dirname(parent)>/<sessionId>/subagents/` (not recursive). None → []. */
export function subagentTranscripts(parent: string, sessionId: string): string[] {
  const dir = join(dirname(parent), sessionId, "subagents");
  if (!existsSync(dir)) return [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (e) { throw new TranscriptError(`transcript subagents ${dir} unreadable: ${e instanceof Error ? e.message : e}`); }
  return entries.filter((d) => !d.isDirectory() && d.name.endsWith(".jsonl")).map((d) => join(dir, d.name)).sort();
}

/** The host counts: locate the session's transcript, read it and its
 * subagents' transcripts, and parse them merged by message id. */
export function transcriptCounts(sessionId: string | undefined, configDir: string = claudeConfigDir()): Counts {
  return countsOf(sessionUsages(sessionId, configDir));
}

function sessionUsages(sessionId: string | undefined, configDir: string): Map<string, unknown> {
  if (!sessionId) throw new TranscriptError("transcript: the worker result carried no session_id");
  const path = locateTranscript(sessionId, configDir);
  const texts = [path, ...subagentTranscripts(path, sessionId)].map((p) => {
    try { return readFileSync(p, "utf-8"); }
    catch (e) { throw new TranscriptError(`transcript ${p} unreadable: ${e instanceof Error ? e.message : e}`); }
  });
  return messageUsages(texts);
}

/** The host counts of the message ids NOT in `exclude` (the ones already
 * accounted), and those ids — a resumed session appends to the same transcript. */
export function transcriptNewCounts(
  sessionId: string | undefined, exclude: ReadonlySet<string>, configDir: string = claudeConfigDir(),
): { counts: Counts; ids: string[] } {
  const fresh = new Map([...sessionUsages(sessionId, configDir)].filter(([id]) => !exclude.has(id)));
  return { counts: countsOf(fresh), ids: [...fresh.keys()] };
}

/** The nightly transcript backup root (runbook §6's `claude-projects` folder), from the environment only (AD-15). */
export function transcriptBackupRoot(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.TK_SUPERVISOR_TRANSCRIPT_BACKUP?.trim() || undefined;
}

/** The host transcript of `sessionId` exists, or is restored from the backup
 * first: exactly one `<backup>/<slug>/<sessionId>.jsonl` is copied (with its
 * `<sessionId>/subagents/`) into `<config>/projects/<slug>/`. No backup root,
 * no copy, ambiguous copies, or a failed copy → TranscriptError naming
 * `transcript missing: <sessionId>`. */
export function ensureTranscript(
  sessionId: string, configDir: string = claudeConfigDir(), backupRoot: string | undefined = transcriptBackupRoot(),
): { path: string; restored: boolean } {
  try { return { path: locateTranscript(sessionId, configDir), restored: false }; }
  catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (/ambiguous|not a plain id/.test(why)) throw new TranscriptError(`transcript missing: ${sessionId} (${why})`);
  }
  const missing = (detail: string) => new TranscriptError(`transcript missing: ${sessionId} (${detail})`);
  if (!backupRoot) throw missing("not found; TK_SUPERVISOR_TRANSCRIPT_BACKUP is unset");
  if (!existsSync(backupRoot)) throw missing(`not found; no backup root ${backupRoot}`);
  const name = `${sessionId}.jsonl`;
  let slugs: string[];
  try {
    slugs = readdirSync(backupRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(backupRoot, d.name, name))).map((d) => d.name);
  } catch (e) { throw missing(`backup root unreadable: ${e instanceof Error ? e.message : e}`); }
  if (slugs.length === 0) throw missing(`not found; no copy under the backup root ${backupRoot}`);
  if (slugs.length > 1) throw missing(`${slugs.length} copies under the backup root ${backupRoot} — ambiguous`);
  const from = join(backupRoot, slugs[0]), to = join(configDir, "projects", slugs[0]);
  try {
    mkdirSync(to, { recursive: true });
    copyFileSync(join(from, name), join(to, name));
    const subagents = join(from, sessionId, "subagents");
    if (existsSync(subagents)) cpSync(subagents, join(to, sessionId, "subagents"), { recursive: true });
  } catch (e) { throw missing(`restore from the backup failed: ${e instanceof Error ? e.message : e}`); }
  return { path: locateTranscript(sessionId, configDir), restored: true };
}

type ExecRunner = (bin: string, args: string[], timeoutS: number) => Promise<RunResult>;
const execRunner: ExecRunner = (bin, args, timeoutS) => runProcess(bin, args, { timeoutS });

/** The argv of the in-VM existence check: `sbx exec <sb> find <vm config dir>/projects -name <sid>.jsonl`. */
export function sbxTranscriptArgv(sandbox: string, vmConfigDir: string, sessionId: string): string[] {
  return ["exec", sandbox, "find", `${vmConfigDir.replace(/\/+$/, "")}/projects`, "-name", `${sessionId}.jsonl`];
}

/** An sbx session's transcript exists inside the microVM: the VM config dir is
 * `$HOME/.claude` as the VM reports it (`sbx exec <sb> printenv HOME`), then
 * `find` (argv only, no shell, no glob). Missing, or a failed probe →
 * TranscriptError naming `transcript missing: <sessionId>`. */
export async function sbxTranscriptExists(sandbox: string, sessionId: string, run: ExecRunner = execRunner): Promise<void> {
  const missing = (detail: string) => new TranscriptError(`transcript missing: ${sessionId} (sbx ${sandbox}: ${detail})`);
  if (!sessionId || /[\\/]/.test(sessionId) || sessionId.includes("..")) throw missing("not a plain session id");
  let home: string;
  try {
    const res = await run(sbxBin(), ["exec", sandbox, "printenv", "HOME"], 60);
    home = res.stdout.trim();
    if (res.exit !== 0 || !home.startsWith("/")) throw new Error(`printenv HOME exited ${res.exit}`);
  } catch (e) { throw missing(`no VM home: ${e instanceof Error ? e.message : e}`); }
  let res: RunResult;
  try { res = await run(sbxBin(), sbxTranscriptArgv(sandbox, `${home}/.claude`, sessionId), 60); }
  catch (e) { throw missing(`find failed: ${e instanceof Error ? e.message : e}`); }
  const hits = res.stdout.split(/\r?\n/).filter((l) => l.trim().endsWith(`/${sessionId}.jsonl`));
  if (res.exit !== 0 || hits.length === 0) throw missing("not found inside the microVM (the host backup never covers it)");
}

/** The sbx counts: the worker result's `num_turns` and `usage` (same token sum). */
export function resultCounts(result: { num_turns?: unknown; usage?: unknown }): Counts {
  if (typeof result.num_turns !== "number" || !Number.isFinite(result.num_turns)) {
    throw new TranscriptError("sbx worker result carried no num_turns");
  }
  if (!result.usage || typeof result.usage !== "object") throw new TranscriptError("sbx worker result carried no usage");
  return { turns: result.num_turns, tokens: usageTokens(result.usage) };
}
