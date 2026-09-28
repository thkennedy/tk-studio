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
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
  if (!sessionId) throw new TranscriptError("transcript: the worker result carried no session_id");
  const path = locateTranscript(sessionId, configDir);
  const texts = [path, ...subagentTranscripts(path, sessionId)].map((p) => {
    try { return readFileSync(p, "utf-8"); }
    catch (e) { throw new TranscriptError(`transcript ${p} unreadable: ${e instanceof Error ? e.message : e}`); }
  });
  return parseTranscripts(texts);
}

/** The sbx counts: the worker result's `num_turns` and `usage` (same token sum). */
export function resultCounts(result: { num_turns?: unknown; usage?: unknown }): Counts {
  if (typeof result.num_turns !== "number" || !Number.isFinite(result.num_turns)) {
    throw new TranscriptError("sbx worker result carried no num_turns");
  }
  if (!result.usage || typeof result.usage !== "object") throw new TranscriptError("sbx worker result carried no usage");
  return { turns: result.num_turns, tokens: usageTokens(result.usage) };
}
