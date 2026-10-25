/**
 * The office projection (Story 29.3, design spec §7.3, §6.3): the queue's events of a run and the engine's
 * journal in the run's served root projected into the office vocabulary, per registry agent, with per-story
 * `done`/`failed` overlays and `done / total` progress. No HTTP and no HTML here: `api.ts` serves `GET /office`
 * and `GET /office/events`, `page.ts` the Office section.
 *
 * Files only: the run dir is `<servedRoot(run)>/.bmad-loop/runs/<engine_run_id>/` (an `external` run:
 * `engineRoot(run)`), and only `journal.jsonl` and `state.json` are read there (plus the spec folder's
 * `stories.yaml` in the served root, for the denominator). Never through the engine, never git, never a write to
 * the queue, `service_events` or the store. A missing run dir or file is "no engine signal", never an error.
 *
 * Story 31.5 (contract 0.1.26, additive): each agent's `blocked_issue` `{issue, state} | null` — set while its
 * project's `current_story` (`N-M…`) — or, when that gives nothing and the run is `paused`, the story it paused on
 * (the queue `paused` event's `paused_story_key`, else the standing journal `story-escalated` key) — maps, by the plan entity's `source: epics.md#story-N.M` in the run's project
 * root, to an entity with an `open` item in that root's `_bmad-output/tracking/inbox.json` (the sync-back's file,
 * re-read when it changes). Only the inbox moves it: a comment or a message never does.
 *
 * Story 32.1 (contract 0.1.27, additive): `engagements[]` `{id, project, state, title, needs_you}` — every engagement
 * record (`engagement.ts` `listEngagements`) under each project's served root (the hub's `roots()`, the registry's,
 * else its newest queue run's `root`), newest first per project; a malformed record is a `problems[]` line
 * `project <project>: _bmad-output/engagements/<id>/engagement.yaml: <reason>` (root-relative, prefixed by the
 * project, as a run's lines are by `run <run_id>: `). The hub emits `office.engagement` `{id, project, state,
 * from, title, needs_you}` on each change (`state: null` once the record is gone). The records are the truth; the
 * `engagement` service event is never read here.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import { launchedSinceMove, pausedStory } from "./closeout";
import { listEngagements, needsYou, titleOf } from "./engagement";
import { planEntity, runPr, storyNumber } from "./planstatus";
import { engineRoot, isTerminal, servedRoot, type Queue, type QueueEvent, type QueueRun } from "./queue";
import { readAgents, ROLES, type Role } from "./registry";

/** The eight office states (closed by the story), in the story's order; `OFFICE_RANK` holds the grace rank. */
export const OFFICE_STATES = ["offline", "idle", "thinking", "reading", "typing", "running", "waiting-for-human", "blocked"] as const;
export type OfficeState = typeof OFFICE_STATES[number];

/** The grace rank (planner ruling): offline 0 < idle 1 < the working states 2 < blocked 3 < waiting-for-human 4.
 * A change to an equal or higher rank is instant; a lower one waits `graceMs`. */
export const OFFICE_RANK: Readonly<Record<OfficeState, number>> = {
  offline: 0, idle: 1, thinking: 2, reading: 2, typing: 2, running: 2, blocked: 3, "waiting-for-human": 4,
};

/** What a project's selected run shows, read from the queue's events, the journal and `state.json`. */
export interface OfficeSignals {
  /** The project's run: its most recently created live run not `queued` (else its newest queued run), else its most
   * recent run when that one is `blocked`. */
  run: QueueRun | null;
  /** The run is in the live set (`queued`, `running`, `paused`, `external`). */
  live: boolean;
  blocked: boolean;
  queued: boolean;
  /** Queue `paused`; an `awaiting-ruling` as the latest of `awaiting-ruling`, `close-out`, `close-out-failed`,
   * `engine-resume`, `resumed`, `paused`; journal `story-escalated` or
   * `run-paused` with no later `run-resume`/`story-escalation-resolved`; `state.json` `paused_reason` set. */
  waiting: boolean;
  /** `running` with no engine run id yet (no `launched`), or with no `launched` since the latest `close-out`/
   * `engine-resume` (a relaunch or a resume keeps the old engine run id until the new engine's `launched`). */
  launching: boolean;
  /** The open journal session (a `session-start` with no `session-end` since the latest `run-start`/`run-resume`). */
  session: { task_id: string; role: string } | null;
  /** The open session is the studio gate's (`task_id` holds `-studio-pipeline.gate-`). */
  gate: boolean;
  /** The current story's `state.json` phase is `dev-verify`, `review-verify` or `committing`. */
  verifyPhase: boolean;
  /** Journal `run-complete`/`run-stop`/`run-crash` after the latest `run-start`/`run-resume`, or a queue
   * `engine-gone` after the latest `launched`. */
  engineEnded: boolean;
  /** A queue `host-verify` after the latest `launched`; true with no `launched` (no host-verify is pending). */
  hostVerified: boolean;
}

export interface OfficeRow {
  row: number;
  leg: string;
  signal: string;
  when: (s: OfficeSignals) => boolean;
  /** The roles this row lights; every other role is `idle` while the run is live, `offline` otherwise. */
  states: Readonly<Partial<Record<Role, OfficeState>>>;
}

const isReview = (role: string | undefined) => role === "review" || role === "triage";

/** The one mapping table (planner ruling): the first row whose `when` holds wins. */
export const OFFICE_MAP: readonly OfficeRow[] = [
  { row: 1, leg: "none", signal: "no live run, and the latest run is not blocked", when: (s) => s.run === null, states: {} },
  { row: 2, leg: "blocked run", signal: "the latest run is blocked, no newer run", when: (s) => s.blocked,
    states: { orchestrator: "blocked", session: "blocked" } },
  { row: 3, leg: "queued / lock-wait", signal: "run queued (including after lock-wait)", when: (s) => s.queued, states: {} },
  { row: 4, leg: "paused / awaiting-ruling / escalate",
    signal: "run paused; awaiting-ruling the latest of awaiting-ruling/close-out/close-out-failed/engine-resume/resumed/paused; journal story-escalated/run-paused unresolved; state.json paused_reason set",
    when: (s) => s.waiting, states: { orchestrator: "waiting-for-human", session: "waiting-for-human" } },
  { row: 5, leg: "launch", signal: "run running, no launched event yet (engine_run_id null), or none since the latest close-out/engine-resume", when: (s) => s.launching,
    states: { orchestrator: "thinking" } },
  { row: 6, leg: "planner", signal: "an open journal session whose task_id contains -studio-pipeline.gate-",
    when: (s) => s.session !== null && s.gate, states: { planner: "thinking", session: "thinking" } },
  { row: 7, leg: "dev session", signal: "an open journal session, role dev", when: (s) => s.session?.role === "dev",
    states: { session: "typing", implementer: "typing" } },
  { row: 8, leg: "review session", signal: "an open journal session, role review (or triage)", when: (s) => isReview(s.session?.role),
    states: { session: "reading", reviewer: "reading" } },
  { row: 9, leg: "engine verify", signal: "no open session, engine not ended, current story phase dev-verify/review-verify/committing",
    when: (s) => s.session === null && !s.engineEnded && s.verifyPhase, states: { session: "running" } },
  { row: 10, leg: "host-verify", signal: "engine ended (journal run-complete/run-stop/run-crash or queue engine-gone), a launched and no host-verify after the latest launched",
    when: (s) => s.engineEnded && !s.hostVerified, states: { orchestrator: "running" } },
  { row: 11, leg: "none", signal: "otherwise (between legs, close-out)", when: () => true, states: {} },
];

/** The row that applies, and each role's state by it. */
export function mapRoles(s: OfficeSignals): { row: OfficeRow; states: Record<Role, OfficeState> } {
  const row = OFFICE_MAP.find((r) => r.when(s))!;
  const rest: OfficeState = s.live ? "idle" : "offline";
  const states = Object.fromEntries(ROLES.map((role) => [role, row.states[role] ?? rest])) as Record<Role, OfficeState>;
  return { row, states };
}

// ------------------------------------------------------------ the engine files (cached reads)

export type JournalEntry = Record<string, unknown> & { kind: string };

interface JournalCache { size: number; mtimeMs: number; offset: number; entries: JournalEntry[] }
const journals = new Map<string, JournalCache>();
interface FileCache<T> { size: number; mtimeMs: number; value: T }
const states = new Map<string, FileCache<Record<string, any> | null>>();
const manifests = new Map<string, FileCache<{ id: string; title?: string }[] | null>>();
const specStatuses = new Map<string, FileCache<string>>();
/** A hard bound per cache (the oldest entry goes first); the office projection also prunes every path it did not
 * read (`pruneCaches`), so a run that left the view is not kept parsed for the life of `serve`. */
const CACHE_MAX = 256;
/** The paths read during the projection in progress (null outside one). */
let touched: Set<string> | null = null;

function remember<V>(cache: Map<string, V>, path: string, value: V): void {
  cache.delete(path);
  cache.set(path, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/** Drop every cached path not in `seen` (the latest projection's reads). */
function pruneCaches(seen: ReadonlySet<string>): void {
  for (const cache of [journals, states, manifests, specStatuses] as Map<string, unknown>[]) {
    for (const path of [...cache.keys()]) if (!seen.has(path)) cache.delete(path);
  }
}

/** The cached paths (for tests). */
export function officeCachedPaths(): string[] {
  return [...journals.keys(), ...states.keys(), ...manifests.keys(), ...specStatuses.keys()];
}

const enoent = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT" || (e as NodeJS.ErrnoException)?.code === "ENOTDIR";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A problem line naming `shown` (a run-root-relative path), never the absolute one (AD-15). */
const problemOf = (name: string, abs: string, shown: string, e: unknown) => `${name}: ${shown}: ${message(e).split(abs).join(shown)}`;

/** `<dir>/journal.jsonl`: one JSON object per complete line (a partial or unparseable line is skipped silently).
 * Cached per path by `(size, mtimeMs)`; a file that grew is parsed from where the last read stopped. A missing file
 * is no entries; any other read error is a problem naming `shown` (the path as the problem shows it). */
export function readJournal(dir: string, shown = "journal.jsonl"): { entries: JournalEntry[]; problem?: string } {
  const path = join(dir, "journal.jsonl");
  touched?.add(path);
  let st;
  try { st = statSync(path); } catch (e) {
    journals.delete(path);
    return enoent(e) ? { entries: [] } : { entries: [], problem: problemOf("JournalUnreadable", path, shown, e) };
  }
  if (st.isDirectory()) {
    // A directory in the journal's place: on Linux its `size` makes the read below fail EISDIR; on Windows a
    // directory's `size` is 0, nothing is read and nothing fails, so the problem is named here on both.
    journals.delete(path);
    return { entries: [], problem: problemOf("JournalUnreadable", path, shown, new Error("EISDIR: illegal operation on a directory")) };
  }
  const hit = journals.get(path);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return { entries: hit.entries };
  const base: JournalCache = hit && st.size >= hit.offset ? hit : { size: 0, mtimeMs: 0, offset: 0, entries: [] };
  let buf: Buffer;
  try {
    const fd = openSync(path, "r");
    try {
      buf = Buffer.alloc(Math.max(0, st.size - base.offset));
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, base.offset + got);
        if (n <= 0) break;
        got += n;
      }
      buf = buf.subarray(0, got);
    } finally { closeSync(fd); }
  } catch (e) {
    return enoent(e) ? { entries: [] } : { entries: base.entries, problem: problemOf("JournalUnreadable", path, shown, e) };
  }
  const nl = buf.lastIndexOf(0x0a);
  const entries = [...base.entries];
  if (nl >= 0) {
    for (const line of buf.subarray(0, nl + 1).toString("utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o && typeof o === "object" && !Array.isArray(o) && typeof o.kind === "string") entries.push(o as JournalEntry);
      } catch { /* an unparseable line: skipped */ }
    }
  }
  remember(journals, path, { size: st.size, mtimeMs: st.mtimeMs, offset: base.offset + nl + 1, entries });
  return { entries };
}

function cachedJson<T>(cache: Map<string, FileCache<T>>, path: string, shown: string, parse: (text: string) => T, name: string): { value: T | null; problem?: string } {
  touched?.add(path);
  let st;
  try { st = statSync(path); } catch (e) {
    cache.delete(path);
    return enoent(e) ? { value: null } : { value: null, problem: problemOf(name, path, shown, e) };
  }
  const hit = cache.get(path);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return { value: hit.value };
  let text: string;
  try { text = readFileSync(path, "utf-8"); } catch (e) {
    return enoent(e) ? { value: null } : { value: null, problem: problemOf(name, path, shown, e) };
  }
  let value: T;
  try { value = parse(text); } catch (e) { return { value: null, problem: problemOf(name, path, shown, e) }; }
  remember(cache, path, { size: st.size, mtimeMs: st.mtimeMs, value });
  return { value };
}

/** `<dir>/state.json` (written atomically by the engine), cached by `(size, mtimeMs)`. Missing: `null`. */
export function readEngineState(dir: string, shown = "state.json"): { state: Record<string, any> | null; problem?: string } {
  const r = cachedJson(states, join(dir, "state.json"), shown, (text) => {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a JSON object");
    return v as Record<string, any>;
  }, "EngineStateUnreadable");
  return { state: r.value, ...(r.problem ? { problem: r.problem } : {}) };
}

/** The spec folder's manifest: its entries' `id` and `title`, in document order. Missing: `null`. */
function readManifest(path: string, shown: string): { entries: { id: string; title?: string }[] | null; problem?: string } {
  const r = cachedJson(manifests, path, shown, (text) => {
    const v = loadYaml(text);
    if (!Array.isArray(v)) throw new Error("not a YAML list of stories");
    return v.filter((e) => e && typeof e === "object" && typeof (e as any).id === "string")
      .map((e) => ({ id: String((e as any).id), ...(typeof (e as any).title === "string" ? { title: (e as any).title as string } : {}) }));
  }, "ManifestUnreadable");
  return { entries: r.value, ...(r.problem ? { problem: r.problem } : {}) };
}

/** The manifest stories whose story spec on disk is `done` — the engine's own done rule (bmad_loop
 * `stories.resolve_story_spec` + `_classify`): `<root>/<specFolder>/stories/<id>-*.md` (exact-case `<id>-` prefix),
 * exactly one match and not a sentinel (`<id>-unresolved.md`/`<id>-ambiguous.md`), its `---` frontmatter `status`
 * (stripped, lowercased) `done`. Zero or several matches, no frontmatter or unparseable YAML: not done. Each spec's
 * status is cached by `(size, mtimeMs)`; a read error other than a missing file is a problem naming the
 * run-relative path (AD-15). */
function specsDone(root: string, specFolder: string, ids: readonly string[], shownPrefix: string, problems: string[]): Set<string> {
  const done = new Set<string>();
  if (!ids.length) return done;
  const dir = join(root, specFolder, "stories");
  let names: string[];
  try { names = readdirSync(dir); } catch (e) {
    if (!enoent(e)) problems.push(problemOf("StoriesUnreadable", dir, `${shownPrefix}${specFolder}/stories`, e));
    return done;
  }
  for (const id of ids) {
    const matches = names.filter((n) => n.startsWith(`${id}-`) && n.endsWith(".md"));
    if (matches.length !== 1 || matches[0] === `${id}-unresolved.md` || matches[0] === `${id}-ambiguous.md`) continue;
    const r = cachedJson(specStatuses, join(dir, matches[0]), `${shownPrefix}${specFolder}/stories/${matches[0]}`, (text) => {
      if (!text.startsWith("---")) return "";
      const end = text.indexOf("---", 3);
      if (end < 0) return "";
      try {
        const fm = loadYaml(text.slice(3, end));
        return fm && typeof fm === "object" && !Array.isArray(fm) ? String((fm as any).status ?? "").trim().toLowerCase() : "";
      } catch { return ""; /* unparseable frontmatter: no status (the engine's degrade) */ }
    }, "StorySpecUnreadable");
    if (r.problem) problems.push(r.problem);
    if (r.value === "done") done.add(id);
  }
  return done;
}

// ------------------------------------------------------------ the projection

export const LIVE_RUN_STATES: ReadonlySet<string> = new Set(["queued", "running", "paused", "external"]);

/** The root a run's engine files live under: the served root (an `external` run: `engineRoot`). */
function runRoot(run: QueueRun): string | null {
  return run.state === "external" ? engineRoot(run) : servedRoot(run);
}

/** The engine run's dir (`closeout.ts` `runDirOf`, inlined), or null with no engine run id or served root. */
export function engineRunDir(run: QueueRun): string | null {
  const root = runRoot(run);
  return root && run.engine_run_id ? join(root, ".bmad-loop", "runs", run.engine_run_id) : null;
}

/** A project's run (planner ruling, review patches): among its live runs (a project can hold several, one per job
 * and checkout) the newest `paused` one (a run awaiting a ruling is never hidden by another job's run:
 * waiting-for-human never expires on its own), else the newest other run that is not `queued`, else the newest
 * queued one; none live: the most recent run when `blocked`. `runs` in creation order. */
export function selectRun(runs: readonly QueueRun[], project: string): QueueRun | null {
  const mine = runs.filter((r) => r.project_id === project);
  const live = mine.filter((r) => LIVE_RUN_STATES.has(r.state));
  if (live.length) return live.findLast((r) => r.state === "paused") ?? live.findLast((r) => r.state !== "queued") ?? live.at(-1)!;
  const last = mine.at(-1);
  return last?.state === "blocked" ? last : null;
}

export type StoryStatus = "pending" | "current" | "done" | "deferred" | "failed";
export interface OfficeStory {
  key: string; title?: string; status: StoryStatus; phase: string | null; overlay: "done" | "failed" | null; extra?: true;
}
export interface OfficeEpic { spec_folder: string | null; done: number; deferred: number; failed: number; total: number; current_story: string | null }
export interface OfficeRun { run_id: string; project: string | null; state: string; engine_run_id: string | null; epic: OfficeEpic; stories: OfficeStory[] }
/** `reason` (Story 30.4, contract 0.1.25, additive): what a `waiting-for-human` or `blocked` agent waits for; null in
 * every other state. */
export interface OfficeAgent {
  agent_id: string; project: string; role: string; state: OfficeState; current_run: string | null; current_story: string | null;
  reason: string | null;
  /** Story 31.5 (contract 0.1.26, additive): the open inbox item of the agent's current story, else null. */
  blocked_issue?: BlockedIssue | null;
}
/** Story 31.5: the inbox item the office's "!" follows. */
export interface BlockedIssue { issue: string; state: string }

// ------------------------------------------------------------ the inbox (Story 31.5)

/** The sync-back's inbox file, relative to a project root. */
export const INBOX_REL = join("_bmad-output", "tracking", "inbox.json");
/** The inbox as `GET /inbox` serves it: the file's `generated_at` and `items` as written; a missing, unreadable or
 * malformed file is `{generated_at: null, items: []}`, never an error. */
export interface InboxFile { generated_at: string | null; items: Record<string, unknown>[] }
const inboxCache = new Map<string, { signature: string; value: InboxFile }>();

/** A project root's inbox (cached on the file's `(mtimeMs, size)`: a changed file is read again). */
export function readInbox(root: string | null | undefined): InboxFile {
  const empty: InboxFile = { generated_at: null, items: [] };
  if (!root) return empty;
  const path = join(root, INBOX_REL);
  let signature: string;
  try { const st = statSync(path); signature = `${st.mtimeMs}:${st.size}`; } catch { inboxCache.delete(path); return empty; }
  const hit = inboxCache.get(path);
  if (hit && hit.signature === signature) return hit.value;
  let value = empty;
  try {
    const doc = JSON.parse(readFileSync(path, "utf-8"));
    if (doc && typeof doc === "object" && !Array.isArray(doc) && Array.isArray(doc.items)) {
      value = {
        generated_at: typeof doc.generated_at === "string" ? doc.generated_at : null,
        items: doc.items.filter((i: unknown) => !!i && typeof i === "object" && !Array.isArray(i)),
      };
    }
  } catch { /* unreadable or not JSON: empty */ }
  inboxCache.set(path, { signature, value });
  return value;
}

/** The `blocked_issue` of a project's current story (see the header); null when none. */
export function blockedIssueFor(root: string | null | undefined, currentStory: string | null): BlockedIssue | null {
  const story = currentStory ? storyNumber(currentStory) : undefined;
  if (!root || !story) return null;
  const open = readInbox(root).items.filter((i) => i.state === "open" && typeof i.issue === "string");
  if (!open.length) return null;
  const entity = planEntity(root, story);
  if (!("id" in entity)) return null;
  const hit = open.find((i) => i.entity === entity.id);
  return hit ? { issue: hit.issue as string, state: "open" } : null;
}

const sameBlocked = (a: BlockedIssue | null | undefined, b: BlockedIssue | null | undefined): boolean =>
  (a?.issue ?? null) === (b?.issue ?? null) && (a?.state ?? null) === (b?.state ?? null);
/** A project's newest terminal run (Story 30.4, contract 0.1.25): its end state, its PR (`runPr`) and when it ended
 * (the latest `ended`/`orphaned` event's `at`, else the run's `updated`), an ISO string. */
export interface OfficeLastRun { run_id: string; state: string; pr: string | null; ended_at: string }
/** Story 32.1 (contract 0.1.27, additive): an engagement as the office shows it. */
export interface OfficeEngagement { id: string; project: string; state: string; title: string; needs_you: boolean }
/** `last_run` (Story 30.4, additive): keyed by project; a project that never ended a run has no entry. `engagements`
 * (Story 32.1, additive): every served project's engagement records — always set by `projectOffice` and the hub
 * (`[]` with none); optional in the type only, so an injected projector or a page-built view may omit it. */
export interface OfficeView {
  at: string; agents: OfficeAgent[]; runs: OfficeRun[]; problems: string[]; last_run: Record<string, OfficeLastRun>;
  engagements?: OfficeEngagement[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const lastIndex = <T>(xs: readonly T[], pred: (x: T) => boolean) => { for (let i = xs.length - 1; i >= 0; i--) if (pred(xs[i])) return i; return -1; };
const kindIn = (...kinds: string[]) => (e: { kind: string }) => kinds.includes(e.kind);
const VERIFY_PHASES = new Set(["dev-verify", "review-verify", "committing"]);
const RULING_KINDS = ["awaiting-ruling", "close-out", "close-out-failed", "engine-resume", "resumed", "paused"];

/** Awaiting a ruling (Story 30.5 exports the rule `analyseRun` uses, for the board): the latest of the
 * pause/ruling/move-out kinds, when it is `awaiting-ruling` (the page's ruling check, `page.ts`, with `resumed`): a
 * close-out, a failed close-out, an engine resume or a newer pause ends it. Null otherwise. */
export function awaitingRuling(events: readonly QueueEvent[]): QueueEvent | null {
  const last = events.findLast(kindIn(...RULING_KINDS));
  return last?.kind === "awaiting-ruling" ? last : null;
}

/** The latest queue `paused` event's engine `paused_reason`, only while that pause stands: no close-out, failed
 * close-out, engine resume or resume after it (an `awaiting-ruling` does not end a pause), so an earlier, resumed
 * pause never names a new wait. Null otherwise. */
export function standingPauseReason(events: readonly QueueEvent[]): string | null {
  const lastMove = events.findLast(kindIn(...RULING_KINDS.filter((k) => k !== "awaiting-ruling")));
  const pausedEngine = lastMove?.kind === "paused" ? lastMove.detail?.engine as Record<string, unknown> | undefined : undefined;
  return str(pausedEngine?.paused_reason);
}

/** What a waiting run waits for (Story 30.4): the first non-empty of the awaiting ruling's reason, state.json's
 * `paused_reason`, the latest queue `paused` event's engine `paused_reason` (while that pause stands), the latest
 * journal escalation's reason (while it stands unresolved). */
function waitReasonOf(events: readonly QueueEvent[], entries: readonly JournalEntry[], state: Record<string, any> | null): string | null {
  const escalated = lastIndex(entries, kindIn("story-escalated", "run-paused")) > lastIndex(entries, kindIn("run-resume", "story-escalation-resolved"));
  return str(awaitingRuling(events)?.detail?.reason)
    ?? str(state?.paused_reason)
    ?? standingPauseReason(events)
    ?? (escalated ? str(entries.findLast(kindIn("story-escalated", "run-paused"))?.reason) : null);
}

/** A run's wait reason by the office's one rule (`waitReasonOf`; Story 30.5 exports it for the board's triage),
 * reading the run's journal and state.json; their read problems are the office projection's to report. */
export function runWaitReason(run: QueueRun, events: readonly QueueEvent[]): string | null {
  const dir = engineRunDir(run);
  if (!dir || !existsSync(dir)) return waitReasonOf(events, [], null);
  return waitReasonOf(events, readJournal(dir).entries, readEngineState(dir).state);
}

/** The story a `paused` run paused on (Story 31.5): the latest queue `paused` event's engine `paused_story_key`
 * (`pausedStory`), else the latest journal `story-escalated` `story_key` while that escalation stands unresolved
 * (no `run-resume` or `story-escalation-resolved` after it). Null for any other run state. */
function pausedStoryOf(run: QueueRun, events: readonly QueueEvent[], entries: readonly JournalEntry[]): string | null {
  if (run.state !== "paused") return null;
  const queued = pausedStory(events).story_key;
  if (queued) return queued;
  const at = lastIndex(entries, kindIn("story-escalated"));
  if (at < 0 || at < lastIndex(entries, kindIn("run-resume", "story-escalation-resolved"))) return null;
  return str(entries[at].story_key);
}

interface RunAnalysis { signals: Omit<OfficeSignals, "run">; epic: OfficeEpic; stories: OfficeStory[]; waitReason: string | null; pausedStory: string | null }

/** Progress (AC2, planner ruling on the denominator): the first `stories-validated.count` manifest entries are the
 * run's stories, later ones `extra`; with no manifest the journal's `story-start` keys, the first `count` of them
 * (journal order) the run's stories and later ones `extra`, `total = count`. The denominator is the launch's: the
 * FIRST `stories-validated` (the engine journals one per process, so a resume journals another). A manifest story
 * with no terminal journal kind (`done`/`deferred`/`failed`) that is not the current story is `done` when its story
 * spec at the run's root is `done` (`specsDone`, the engine's own rule): a close-out relaunch starts a fresh engine
 * run (a new journal) whose scheduler silently skips stories landed in earlier iterations. The journal always wins
 * over the spec file; the denominator is unchanged. */
function progress(root: string | null, shownPrefix: string, entries: readonly JournalEntry[], state: Record<string, any> | null, problems: string[]): { epic: OfficeEpic; stories: OfficeStory[] } {
  const validated = entries.find((e) => e.kind === "stories-validated");
  const count = typeof validated?.count === "number" && validated.count >= 0 ? Math.floor(validated.count) : null;
  const specFolder = str(validated?.spec_folder) ?? str(state?.spec_folder);
  const status = new Map<string, "started" | "done" | "deferred" | "failed">();
  const started: string[] = [];
  for (const e of entries) {
    const key = str(e.story_key);
    if (!key) continue;
    if (e.kind === "story-start") { status.set(key, "started"); if (!started.includes(key)) started.push(key); }
    else if (e.kind === "story-done") status.set(key, "done");
    else if (e.kind === "story-deferred" || e.kind === "story-skipped") status.set(key, "deferred");
    else if (e.kind === "story-escalated") status.set(key, "failed");
    else if (e.kind === "story-escalation-resolved" && status.get(key) === "failed") status.set(key, "started");
  }
  let current: string | null = null;
  for (let i = entries.length - 1; i >= 0 && current === null; i--) {
    const key = entries[i].kind === "story-start" ? str(entries[i].story_key) : null;
    if (key && status.get(key) === "started") current = key;
  }
  let list: { key: string; title?: string; extra: boolean }[];
  let total: number;
  let specDone = new Set<string>();
  const manifest = root && specFolder ? readManifest(join(root, specFolder, "stories.yaml"), `${shownPrefix}${specFolder}/stories.yaml`) : null;
  if (manifest?.problem) problems.push(manifest.problem);
  if (manifest?.entries) {
    const n = count ?? manifest.entries.length;
    list = manifest.entries.map((m, i) => ({ key: m.id, ...(m.title ? { title: m.title } : {}), extra: i >= n }));
    for (const k of started) if (!list.some((s) => s.key === k)) list.push({ key: k, extra: true });
    total = count ?? manifest.entries.length;
    const unsettled = manifest.entries.map((m) => m.id).filter((k) => k !== current && (status.get(k) ?? "started") === "started");
    specDone = specsDone(root!, specFolder!, unsettled, shownPrefix, problems);
  } else {
    list = started.map((k, i) => ({ key: k, extra: count !== null && i >= count }));
    total = count ?? started.length;
  }
  const tasks = state?.tasks && typeof state.tasks === "object" ? state.tasks as Record<string, any> : {};
  const stories: OfficeStory[] = list.map(({ key, title, extra }) => {
    const st = specDone.has(key) ? "done" : status.get(key);
    const s: StoryStatus = st === "done" || st === "deferred" || st === "failed" ? st : key === current ? "current" : "pending";
    const phase = str(tasks[key]?.phase);
    return {
      key, ...(title ? { title } : {}), status: s, phase,
      overlay: s === "done" ? "done" : s === "deferred" || s === "failed" ? "failed" : null,
      ...(extra ? { extra: true as const } : {}),
    };
  });
  const counted = stories.filter((s) => !s.extra);
  return {
    epic: {
      spec_folder: specFolder, total, current_story: current,
      done: counted.filter((s) => s.status === "done").length,
      deferred: counted.filter((s) => s.status === "deferred").length,
      failed: counted.filter((s) => s.status === "failed").length,
    },
    stories,
  };
}

/** One run's signals and progress, from its queue events and its engine files. */
function analyseRun(run: QueueRun, events: readonly QueueEvent[], problems: string[]): RunAnalysis {
  const dir = engineRunDir(run);
  // A problem names the file relative to the run's root, prefixed by the queue run (AD-15: no machine path).
  const shownPrefix = `run ${run.run_id}: `;
  const shownDir = `${shownPrefix}.bmad-loop/runs/${run.engine_run_id}`;
  let entries: JournalEntry[] = [], state: Record<string, any> | null = null;
  if (dir && existsSync(dir)) {
    const j = readJournal(dir, `${shownDir}/journal.jsonl`);
    if (j.problem) problems.push(j.problem);
    entries = j.entries;
    const s = readEngineState(dir, `${shownDir}/state.json`);
    if (s.problem) problems.push(s.problem);
    state = s.state;
  }
  const { epic, stories } = progress(runRoot(run), shownPrefix, entries, state, problems);

  const ruling = awaitingRuling(events);
  const awaiting = ruling !== null;
  const escalated = lastIndex(entries, kindIn("story-escalated", "run-paused")) > lastIndex(entries, kindIn("run-resume", "story-escalation-resolved"));
  const pausedReason = state?.paused_reason !== null && state?.paused_reason !== undefined && state?.paused_reason !== "";
  const launchedAt = lastIndex(events, kindIn("launched"));
  const startAt = lastIndex(entries, kindIn("run-start", "run-resume"));
  const engineEnded = lastIndex(entries, kindIn("run-complete", "run-stop", "run-crash")) > startAt
    || (launchedAt >= 0 && lastIndex(events, kindIn("engine-gone")) > launchedAt);
  let session: OfficeSignals["session"] = null;
  if (!engineEnded) {
    const open = new Map<string, { task_id: string; role: string }>();
    for (const e of entries.slice(Math.max(0, startAt))) {
      const id = str(e.task_id);
      if (!id) continue;
      if (e.kind === "session-start") { open.delete(id); open.set(id, { task_id: id, role: String(e.role ?? "") }); }
      else if (e.kind === "session-end") open.delete(id);
    }
    session = [...open.values()].at(-1) ?? null;
  }
  const phase = epic.current_story ? str((state?.tasks as Record<string, any> | undefined)?.[epic.current_story]?.phase) : null;
  const waitReason = waitReasonOf(events, entries, state);
  return {
    signals: {
      live: LIVE_RUN_STATES.has(run.state), blocked: run.state === "blocked", queued: run.state === "queued",
      waiting: run.state === "paused" || awaiting || escalated || pausedReason,
      launching: run.state === "running" && (!run.engine_run_id
        || (events.some(kindIn("close-out", "engine-resume")) && !launchedSinceMove(events))),
      session, gate: session !== null && session.task_id.includes("-studio-pipeline.gate-"),
      verifyPhase: phase !== null && VERIFY_PHASES.has(phase),
      // Host-verify is pending only after a `launched` (the supervisor never host-verifies a run it did not
      // launch, e.g. an adopted `external` run): with none, the run never enters row 10.
      engineEnded, hostVerified: launchedAt < 0 || lastIndex(events, kindIn("host-verify")) > launchedAt,
    },
    epic, stories, waitReason, pausedStory: pausedStoryOf(run, events, entries),
  };
}

const NO_SIGNALS: Omit<OfficeSignals, "run"> = {
  live: false, blocked: false, queued: false, waiting: false, launching: false, session: null, gate: false,
  verifyPhase: false, engineEnded: false, hostVerified: false,
};

/** Two `last_run` entries equal in every field. */
const sameLastRun = (a: OfficeLastRun | undefined, b: OfficeLastRun): boolean =>
  !!a && a.run_id === b.run_id && a.state === b.state && a.pr === b.pr && a.ended_at === b.ended_at;

/** A terminal run as a project's `last_run` (Story 30.4). */
export function lastRunOf(run: QueueRun, events: readonly QueueEvent[]): OfficeLastRun {
  const end = events.findLast(kindIn("ended", "orphaned"));
  return { run_id: run.run_id, state: run.state, pr: runPr(events) ?? null, ended_at: end?.at ?? run.updated };
}

/** What an agent in `state` waits for (Story 30.4): the run's wait reason when `waiting-for-human`, the run's queue
 * `reason` when `blocked`, else null. */
function reasonFor(state: OfficeState, run: QueueRun | null, waitReason: string | null): string | null {
  if (state === "waiting-for-human") return waitReason;
  if (state === "blocked") return str(run?.reason);
  return null;
}

/** The projection's core over one read of the runs: each project's role states, and the live runs' progress. */
function projectCore(queue: Queue, given?: readonly QueueRun[]): {
  runs: QueueRun[]; problems: string[];
  forProject: (project: string) => { run: QueueRun | null; states: Record<Role, OfficeState>; current_story: string | null; waitReason: string | null; paused_story: string | null };
  liveRuns: () => OfficeRun[];
  lastRuns: () => Record<string, OfficeLastRun>;
} {
  const runs = [...(given ?? queue.runs())];
  const problems: string[] = [];
  const analyses = new Map<string, RunAnalysis>();
  const analysis = (run: QueueRun) => {
    let a = analyses.get(run.run_id);
    if (!a) { a = analyseRun(run, queue.events(run.run_id), problems); analyses.set(run.run_id, a); }
    return a;
  };
  return {
    runs, problems,
    forProject: (project) => {
      const run = selectRun(runs, project);
      const a = run ? analysis(run) : null;
      const { states } = mapRoles({ run, ...(a?.signals ?? NO_SIGNALS) });
      return { run, states, current_story: a?.epic.current_story ?? null, waitReason: a?.waitReason ?? null, paused_story: a?.pausedStory ?? null };
    },
    liveRuns: () => runs.filter((r) => LIVE_RUN_STATES.has(r.state)).map((r) => {
      const a = analysis(r);
      return { run_id: r.run_id, project: r.project_id, state: r.state, engine_run_id: r.engine_run_id, epic: a.epic, stories: a.stories };
    }),
    lastRuns: () => {
      const newest = new Map<string, QueueRun>();
      for (const r of runs) if (r.project_id && isTerminal(r.state)) newest.set(r.project_id, r);
      const out: Record<string, OfficeLastRun> = {};
      for (const [project, r] of newest) out[project] = lastRunOf(r, queue.events(r.run_id));
      return out;
    },
  };
}

/** Story 32.1: every engagement of the projects the registry agents or `roots` name (see the header). The root of a
 * project is `roots[project]` (the registry's served root, where the routes and the board read and write), else its
 * newest queue run's `root`; with `roots` known (defined: a registry read has succeeded), a registry project with
 * neither is a problem line. */
function engagementsOf(runs: readonly QueueRun[], agentProjects: readonly string[], roots: Record<string, string> | undefined, problems: string[]): OfficeEngagement[] {
  const projects = [...new Set([...agentProjects, ...Object.keys(roots ?? {})])];
  const out: OfficeEngagement[] = [];
  for (const project of projects) {
    const root = roots?.[project] ?? runs.findLast((r) => r.project_id === project)?.root;
    if (!root) {
      if (roots && agentProjects.includes(project)) problems.push(`engagements: no served root for ${project}`);
      continue;
    }
    const found: string[] = [];
    const listed = listEngagements(root, found);
    for (const line of found) problems.push(`project ${project}: ${line}`);
    for (const e of listed) {
      const state = String(e.state);
      out.push({ id: e.id, project, state, title: titleOf(typeof e.request === "string" ? e.request : ""), needs_you: needsYou(state) });
    }
  }
  return out;
}

/** The raw (ungraced) projection: every registry agent (`readAgents`) exactly once with its state, the live runs
 * with story and epic progress, the time. A project with live runs but no registry rows adds no agents. Story 32.1:
 * `roots` (project id → served root) feeds `engagements[]`. */
export function projectOffice(queue: Queue, deps: { now?: () => number; roots?: () => Record<string, string> | undefined } = {}): OfficeView {
  const seen = new Set<string>();
  touched = seen;
  try {
    const core = projectCore(queue);
    const byProject = new Map<string, ReturnType<typeof core.forProject> & { blocked: BlockedIssue | null }>();
    const rows = readAgents(queue).agents;
    const agents: OfficeAgent[] = rows.map((row) => {
      let p = byProject.get(row.project);
      if (!p) {
        const f = core.forProject(row.project);
        let blocked: BlockedIssue | null = null;
        // A paused run's escalated story is `failed` in the progress (no `current_story`): the paused story is the
        // fallback, for `blocked_issue` only (`current_story` on the wire is unchanged).
        try {
          blocked = f.run ? blockedIssueFor(f.run.root, f.current_story) : null;
          if (!blocked && f.run && f.paused_story && f.paused_story !== f.current_story) blocked = blockedIssueFor(f.run.root, f.paused_story);
        } catch { /* no signal */ }
        p = { ...f, blocked };
        byProject.set(row.project, p);
      }
      const state = (p.states as Record<string, OfficeState>)[row.role] ?? (p.run && LIVE_RUN_STATES.has(p.run.state) ? "idle" : "offline");
      return {
        agent_id: row.agent_id, project: row.project, role: row.role, state, current_run: p.run?.run_id ?? null, current_story: p.current_story,
        reason: reasonFor(state, p.run, p.waitReason), blocked_issue: p.blocked,
      };
    });
    const runs = core.liveRuns();
    const last_run = core.lastRuns();
    const engagements = engagementsOf(core.runs, rows.map((r) => r.project), deps.roots?.(), core.problems);
    pruneCaches(seen); // only after a whole projection: a throw keeps the caches as they were
    return { at: new Date((deps.now ?? Date.now)()).toISOString(), agents, runs, problems: core.problems, last_run, engagements };
  } finally { touched = null; }
}

/** The raw states by `agent_id` (`<project>/<role>`) for every project that has a run in the queue — the
 * registry's `live_state` at rebuild (Story 29.2's field). A project absent here is `offline`. `runs`: the queue's
 * runs already read by the caller (the rebuild reads them once). */
export function officeStates(queue: Queue, runs?: readonly QueueRun[]): Record<string, OfficeState> {
  const core = projectCore(queue, runs);
  const out: Record<string, OfficeState> = {};
  for (const project of new Set(core.runs.map((r) => r.project_id).filter((p): p is string => !!p))) {
    const { states } = core.forProject(project);
    for (const role of ROLES) out[`${project}/${role}`] = states[role];
  }
  return out;
}

// ------------------------------------------------------------ the hub (grace, ids, replay)

export type OfficeEventKind = "office.agent" | "office.progress" | "office.run" | "office.engagement";
export interface OfficeEvent { id: string; seq: number; kind: OfficeEventKind; data: Record<string, unknown> }
export type OfficeSnapshot = OfficeView & { id: string };

export interface OfficeHubOptions {
  queue: Queue;
  /** The clock in ms (default `Date.now`). */
  now?: () => number;
  /** A demotion holds this long first (default 20 000). */
  graceMs?: number;
  /** How often a subscribed hub re-projects (default 1000). */
  pollMs?: number;
  /** How many delta events are kept for `Last-Event-ID` replay (default 1000). */
  bufferSize?: number;
  /** The projector (default the raw `projectOffice`). */
  project?: (queue: Queue) => OfficeView;
  /** Story 32.1: the served roots by project id (the registry's), for `engagements[]` (default none); `undefined`
   * while the registry's roots are not yet known (no problem line then). */
  roots?: () => Record<string, string> | undefined;
}

/** The graced live view and its delta stream. In memory only: the ids are `<boot>-<seq>` (boot the hub's start
 * ms); nothing is written to the queue, `service_events` or the store. */
export class OfficeHub {
  readonly boot: string;
  private readonly queue: Queue;
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly pollMs: number;
  private readonly bufferSize: number;
  private readonly project: (queue: Queue) => OfficeView;
  private seq = 0;
  private buffer: OfficeEvent[] = [];
  private view: OfficeView | null = null;
  /** The time of the last refresh (when the shown states were last observed raw), null before the first. */
  private viewAt: number | null = null;
  private demoting = new Map<string, number>();
  private listeners = new Set<(events: OfficeEvent[]) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(o: OfficeHubOptions) {
    this.queue = o.queue;
    this.now = o.now ?? Date.now;
    this.graceMs = o.graceMs ?? 20_000;
    this.pollMs = o.pollMs ?? 1000;
    this.bufferSize = Math.max(1, o.bufferSize ?? 1000);
    this.project = o.project ?? ((q) => projectOffice(q, { now: this.now, ...(o.roots ? { roots: o.roots } : {}) }));
    // The process-start ms (Date.now at construction), kept distinct from every earlier hub of this process.
    OfficeHub.lastBoot = Math.max(Date.now(), OfficeHub.lastBoot + 1);
    this.boot = String(OfficeHub.lastBoot);
  }
  private static lastBoot = 0;

  /** The id of the latest delta (`<boot>-0` before any). */
  currentId(): string { return `${this.boot}-${this.seq}`; }
  get subscribers(): number { return this.listeners.size; }
  get polling(): boolean { return this.timer !== undefined; }

  /** The graced state: a change to an equal or higher rank is instant; a lower raw state applies once it has been
   * below the shown state for `graceMs`; coming back up cancels the demotion. A demotion first seen after a gap of
   * at least `graceMs` since the last refresh (nothing polled) starts at that refresh — the last moment the higher
   * state was observed — not now, so a late read does not serve the stale state a further `graceMs`. */
  private graced(id: string, shown: OfficeState, raw: OfficeState, t: number): OfficeState {
    if (OFFICE_RANK[raw] >= OFFICE_RANK[shown]) { this.demoting.delete(id); return raw; }
    let since = this.demoting.get(id);
    if (since === undefined) {
      since = this.viewAt !== null && t - this.viewAt >= this.graceMs ? this.viewAt : t;
      this.demoting.set(id, since);
    }
    if (t - since >= this.graceMs) { this.demoting.delete(id); return raw; }
    return shown;
  }

  private emit(out: OfficeEvent[], kind: OfficeEventKind, data: Record<string, unknown>): void {
    this.seq += 1;
    out.push({ id: `${this.boot}-${this.seq}`, seq: this.seq, kind, data });
  }

  /** Re-project, apply grace, diff against the last view: one event per change (agents, then progress, then runs). */
  refresh(): OfficeEvent[] {
    const t = this.now();
    const at = new Date(t).toISOString();
    const raw = this.project(this.queue);
    const prev = this.view;
    const prevAgents = new Map((prev?.agents ?? []).map((a) => [a.agent_id, a]));
    const agents = raw.agents.map((a) => {
      const p = prevAgents.get(a.agent_id);
      if (!p) return a;
      // A new run for the agent: its raw state at once, never the old run's held under the new one.
      if (p.current_run !== a.current_run) { this.demoting.delete(a.agent_id); return a; }
      const state = this.graced(a.agent_id, p.state, a.state, t);
      // The reason follows the shown state: a held state keeps the previous reason (Story 30.4).
      return { ...a, state, reason: state === a.state ? (a.reason ?? null) : (p.reason ?? null) };
    });
    for (const id of [...this.demoting.keys()]) if (!agents.some((a) => a.agent_id === id)) this.demoting.delete(id);
    const engagements = raw.engagements ?? [];
    const next: OfficeView = { at, agents, runs: raw.runs, problems: raw.problems, last_run: raw.last_run ?? {}, engagements };
    this.view = next;
    this.viewAt = t;
    if (!prev) return [];
    const out: OfficeEvent[] = [];
    for (const a of agents) {
      const p = prevAgents.get(a.agent_id);
      if (p && p.state === a.state && p.current_run === a.current_run && p.current_story === a.current_story && (p.reason ?? null) === (a.reason ?? null)
        && sameBlocked(p.blocked_issue, a.blocked_issue)) continue;
      this.emit(out, "office.agent", {
        agent_id: a.agent_id, state: a.state, from: p?.state ?? null, at, current_run: a.current_run, current_story: a.current_story, reason: a.reason ?? null,
        blocked_issue: a.blocked_issue ?? null,
      });
    }
    const prevRuns = new Map(prev.runs.map((r) => [r.run_id, r]));
    for (const r of next.runs) {
      const p = prevRuns.get(r.run_id);
      const before = new Map((p?.stories ?? []).map((s) => [s.key, JSON.stringify(s)]));
      const changed = r.stories.filter((s) => before.get(s.key) !== JSON.stringify(s));
      if (p && !changed.length && JSON.stringify(p.epic) === JSON.stringify(r.epic)) continue;
      if (!p || !changed.length) this.emit(out, "office.progress", { run_id: r.run_id, epic: r.epic });
      else for (const s of changed) this.emit(out, "office.progress", { run_id: r.run_id, epic: r.epic, story: s });
    }
    const nextRuns = new Map(next.runs.map((r) => [r.run_id, r]));
    for (const r of next.runs) {
      const p = prevRuns.get(r.run_id);
      if (!p || p.state !== r.state) this.emit(out, "office.run", { run_id: r.run_id, project: r.project, state: r.state, from: p?.state ?? null });
    }
    // A run leaving the live set terminal carries its project's `last_run` (Story 30.4, contract 0.1.25), only when
    // that run is the snapshot's `last_run` for the project: a delta never says other than the snapshot does.
    const covered = new Set<string>();
    for (const p of prev.runs) {
      if (nextRuns.has(p.run_id)) continue;
      const ended = this.queue.get(p.run_id);
      const state = ended?.state ?? null;
      const shown = p.project ? next.last_run[p.project] : undefined;
      const last = ended && isTerminal(state) && shown?.run_id === p.run_id ? shown : null;
      if (last && p.project) covered.add(p.project);
      this.emit(out, "office.run", { run_id: p.run_id, project: p.project, state, from: p.state, ...(last ? { last_run: last } : {}) });
    }
    // A project's `last_run` that changed in any field with no leaving run carrying it (a run created and ended
    // between two refreshes, never seen live, or a PR arriving on a later `closed_out` after the run ended): one
    // `office.run` for that run, `from` null, carrying the new `last_run`.
    for (const [project, last] of Object.entries(next.last_run)) {
      if (covered.has(project) || sameLastRun(prev.last_run[project], last)) continue;
      this.emit(out, "office.run", { run_id: last.run_id, project, state: last.state, from: null, last_run: last });
    }
    // Story 32.1: an engagement that appeared, changed state, title or needs_you, or vanished (`state: null`). Keyed by
    // project and id: each served root mints its own `ENG-NNN` series.
    const engKey = (e: OfficeEngagement) => `${e.project}\u0000${e.id}`;
    const prevEngagements = new Map((prev.engagements ?? []).map((e) => [engKey(e), e]));
    const nextIds = new Set(engagements.map(engKey));
    for (const e of engagements) {
      const p = prevEngagements.get(engKey(e));
      if (p && p.state === e.state && p.title === e.title && p.needs_you === e.needs_you) continue;
      this.emit(out, "office.engagement", { id: e.id, project: e.project, state: e.state, from: p?.state ?? null, title: e.title, needs_you: e.needs_you });
    }
    for (const p of prev.engagements ?? []) {
      if (!nextIds.has(engKey(p))) this.emit(out, "office.engagement", { id: p.id, project: p.project, state: null, from: p.state });
    }
    if (out.length) {
      this.buffer.push(...out);
      if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize);
      for (const fn of [...this.listeners]) { try { fn(out); } catch { /* a listener's failure is its own */ } }
    }
    return out;
  }

  /** Refresh, then the view with the current id. */
  snapshot(): OfficeSnapshot {
    this.refresh();
    return { ...this.view!, id: this.currentId() };
  }

  /** The buffered deltas after `id`; null when `id` is malformed, from another boot, ahead of this hub or older
   * than the buffer (the caller sends the snapshot again). */
  since(id: string | null | undefined): OfficeEvent[] | null {
    const m = /^(\d+)-(\d+)$/.exec((id ?? "").trim());
    if (!m || m[1] !== this.boot) return null;
    const seq = Number(m[2]);
    if (seq > this.seq) return null;
    const oldest = this.buffer[0]?.seq ?? this.seq + 1;
    if (seq < oldest - 1) return null;
    return this.buffer.filter((e) => e.seq > seq);
  }

  /** Receive each refresh's deltas; the hub polls only while at least one subscriber is attached. */
  subscribe(fn: (events: OfficeEvent[]) => void): () => void {
    this.listeners.add(fn);
    if (!this.timer) {
      this.timer = setInterval(() => { try { this.refresh(); } catch { /* the next tick tries again */ } }, this.pollMs);
    }
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size && this.timer) { clearInterval(this.timer); this.timer = undefined; }
    };
  }
}
