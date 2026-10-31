/**
 * The board (Story 30.5, design spec §6.3, contract 0.1.25): `GET /board?project=<id>` — a served project's plan, its
 * runs and its money on one answer. No HTTP here (`api.ts` serves it); files and the queue only, never git, never a
 * write.
 *
 *   plan      `<root>/_bmad-output/planning-artifacts/plan/`: the `EP-NNN.md` and `ST-NNN.md` entities' frontmatter
 *             (`id`, `title`, `status`, `source`, a story's `parent`); a story's key `N.M` from its `source`
 *             `epics.md#story-N.M`, an epic's number from `epics.md#epic-N`. Cached per plan directory on a
 *             signature of the directory's `mtimeMs` plus each entity's `(mtimeMs, size)` (an in-place edit does
 *             not move a directory's mtime). No directory: `epics: []` and `plan.reason` naming the missing path.
 *   findings  `<root>/_bmad-output/implementation-artifacts/deferred-work.md` (the engine's `deferredwork.py` rule):
 *             `### DW-NN: <title>` entries, each ending at the next heading of any level; open when the first word
 *             of its `status:` line is `open` (no `status:` line: not open); its story `storyNumber(source_spec)`.
 *             Cached on the file's `(size, mtimeMs)`.
 *   spend     the ledger `<studioHome(env)>/measurements/<user>-<machine>.jsonl`, read whole, cached on its
 *             `(size, mtimeMs)`: the `job-run` events whose envelope `project` is the project, deduplicated by
 *             `payload.run_id` (the last wins: a repeat finish emits twice, DW-5), summed per epic `N` of a
 *             `run-epic-N` `job_id`; any other job, or an envelope with no project, counts toward no epic.
 *   band      `<root>/.tk-studio/budget-bands.yaml` `epics: {EP-NNN: {usd_estimate: <number>}}`; absent, malformed
 *             or not a positive number: `null`.
 *   runs      the queue's runs of the project, composed per request: each story's latest run (state, PR, host
 *             verify, end time) and the triage (Needs-you, Working, Done).
 *   engagements  Story 32.1 (contract 0.1.27, additive): the served root's engagement records waiting on the owner
 *             (`awaiting-answers`, `quoted`) as Needs-you items `{engagement, state, title}`, after the run items,
 *             newest first (`engagement.ts` `listEngagements`, cached on the records' files).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import { frontmatter, pausedStory } from "./closeout";
import { studioHome } from "./env";
import { legVerdict, type HostVerifyResult } from "./hostverify";
import { listEngagements, needsYou, titleOf } from "./engagement";
import { awaitingRuling, lastRunOf, LIVE_RUN_STATES, runWaitReason } from "./office";
import { DEFERRED_REL } from "./planseams";
import { PLAN_REL, runPr, storyNumber } from "./planstatus";
import { isTerminal, type Queue, type QueueEvent, type QueueRun } from "./queue";
import { priorPr } from "./worktree";

type Env = Record<string, string | undefined>;

export { DEFERRED_REL };
export const BANDS_REL = join(".tk-studio", "budget-bands.yaml");

// ------------------------------------------------------------ the answer (shared with 30.6 and the web)

export type HostVerifyOutcome = "green" | "red" | "skipped" | "inconclusive";
export interface BoardFinding { id: string; title: string; severity: string | null }
export interface BoardStoryRun { run_id: string; state: string; pr: string | null; host_verify: HostVerifyOutcome | null; ended_at: string | null }
export interface BoardStory { id: string; key: string; title: string; status: string; findings: BoardFinding[]; run: BoardStoryRun | null }
export interface BoardEpic { id: string; title: string; status: string; band_usd: number | null; spend_usd: number; findings: number; stories: BoardStory[] }
export interface TriageItem { run_id: string; state: string; story_key: string | null; pr: string | null; ruling: string | null }
/** Story 32.1 (contract 0.1.27, additive): an engagement waiting on the owner, in the Needs-you column. */
export interface EngagementTriageItem { engagement: string; state: string; title: string }
export interface BoardAnswer {
  ok: true; project: string; built_at: string; plan: { reason?: string }; epics: BoardEpic[];
  triage: { needs_you: (TriageItem | EngagementTriageItem)[]; working: TriageItem[]; done: TriageItem[] };
}

/** The slice of an office live run the board reads: its story keys and statuses (`OfficeRun`). */
export interface LiveRunProgress { run_id: string; epic?: { current_story?: string | null }; stories: { key: string; status: string }[] }

export interface BoardDeps {
  queue: Queue;
  /** The clock (default `Date.now`): `built_at` and the Done column's local day. */
  now?: () => number;
  /** The store root (`TK_STUDIO_HOME`) and the ledger identity's variables (default `process.env`). */
  env?: Env;
  /** This machine's ledger identity (default: getpass order, the hostname). */
  ledger?: { user: string; machine: string };
  /** The registry's projects (`registry.py show`: `{projects: {<id>: {root, …}}}`). */
  registry: () => Promise<Record<string, any>>;
  /** The live runs' progress (default none; `api.ts` passes the office hub's runs). */
  liveRuns?: () => readonly LiveRunProgress[];
}

// ------------------------------------------------------------ cached file reads

interface Stamp { size: number; mtimeMs: number }
const stampOf = (path: string): Stamp | null => {
  try {
    const st = statSync(path);
    return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch { return null; }
};
const sameStamp = (a: Stamp, b: Stamp) => a.size === b.size && a.mtimeMs === b.mtimeMs;
const CACHE_MAX = 64;
function remember<V>(cache: Map<string, V>, key: string, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/** A file's parse cached on `(size, mtimeMs)`; a missing or unreadable file is `fallback`. */
function cachedFile<T>(cache: Map<string, Stamp & { value: T }>, path: string, parse: (text: string) => T, fallback: T): T {
  const st = stampOf(path);
  if (!st) { cache.delete(path); return fallback; }
  const hit = cache.get(path);
  if (hit && sameStamp(hit, st)) return hit.value;
  let text: string;
  try { text = readFileSync(path, "utf-8"); } catch { return fallback; }
  const value = parse(text);
  remember(cache, path, { ...st, value });
  return value;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ------------------------------------------------------------ the plan

export interface PlanStory { id: string; key: string | null; title: string; status: string; parent: string | null }
export interface PlanEpic { id: string; number: string | null; title: string; status: string }
export interface PlanPart { reason?: string; epics: PlanEpic[]; stories: PlanStory[] }

const ENTITY_RE = /^(EP|ST)-\d{3,}\.md$/;
const plans = new Map<string, { signature: string; value: PlanPart }>();

/** The plan part of a project root, cached on the directory's signature (see the header). */
export function readPlan(root: string): PlanPart {
  const dir = join(root, PLAN_REL);
  let dirStat;
  try { dirStat = statSync(dir); } catch { dirStat = null; }
  if (!dirStat?.isDirectory()) {
    plans.delete(dir);
    return { reason: `no plan directory: ${PLAN_REL.split("\\").join("/")}`, epics: [], stories: [] };
  }
  let names: string[] = [];
  // Numeric id order (`EP-999` before `EP-1000`: the id is `\d{3,}`), then by name.
  const idOf = (n: string) => Number(/\d+/.exec(n)![0]);
  try { names = readdirSync(dir).filter((n) => ENTITY_RE.test(n)).sort((a, b) => idOf(a) - idOf(b) || (a < b ? -1 : a > b ? 1 : 0)); } catch { /* none */ }
  const stamps = names.map((n) => [n, stampOf(join(dir, n))] as const);
  const signature = JSON.stringify([dirStat.mtimeMs, stamps.map(([n, s]) => [n, s?.mtimeMs ?? null, s?.size ?? null])]);
  const hit = plans.get(dir);
  if (hit && hit.signature === signature) return hit.value;
  const epics: PlanEpic[] = [];
  const stories: PlanStory[] = [];
  for (const n of names) {
    let fm: Record<string, unknown> = {};
    try { fm = frontmatter(readFileSync(join(dir, n), "utf-8")); } catch { continue; }
    const id = str(fm.id) ?? n.slice(0, -3);
    const source = str(fm.source) ?? "";
    const title = str(fm.title) ?? id;
    const status = str(fm.status) ?? "draft";
    if (n.startsWith("EP-")) epics.push({ id, number: /^epics\.md#epic-(\d+)$/.exec(source)?.[1] ?? null, title, status });
    else {
      const m = /^epics\.md#story-(\d+)\.(\d+)$/.exec(source);
      stories.push({ id, key: m ? `${Number(m[1])}.${Number(m[2])}` : null, title, status, parent: str(fm.parent) });
    }
  }
  const value: PlanPart = { epics, stories };
  remember(plans, dir, { signature, value });
  return value;
}

// ------------------------------------------------------------ the findings

export interface OpenFinding extends BoardFinding { story: string | null }

const HEADING_RE = /^### (DW-\d+): (.+?)\s*$/gm;
const ANY_HEADING_RE = /^#{1,6} /gm;
const fieldOf = (body: string, name: string): string | null => {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(body);
  return m ? m[1]!.trim() : null;
};

/** The open entries of a deferred-work ledger's text (the engine's `deferredwork.py` rule, see the header). */
export function openFindings(text: string): OpenFinding[] {
  const heads = [...text.matchAll(HEADING_RE)];
  const out: OpenFinding[] = [];
  heads.forEach((m, i) => {
    const start = m.index!;
    let end = i + 1 < heads.length ? heads[i + 1]!.index! : text.length;
    ANY_HEADING_RE.lastIndex = start + m[0].length;
    const other = ANY_HEADING_RE.exec(text);
    if (other && other.index < end) end = other.index;
    const body = text.slice(start, end);
    const status = fieldOf(body, "status") ?? "";
    if (status.split(/\s+/)[0] !== "open") return;
    const spec = (fieldOf(body, "source_spec") ?? "").replace(/`/g, "").trim();
    const base = spec.split(/[\\/]/).pop() ?? "";
    out.push({ id: m[1]!, title: m[2]!, severity: str(fieldOf(body, "severity")), story: base ? storyNumber(base) ?? null : null });
  });
  return out;
}

const findingsCache = new Map<string, Stamp & { value: OpenFinding[] }>();
export const readFindings = (root: string): OpenFinding[] => cachedFile(findingsCache, join(root, DEFERRED_REL), openFindings, []);

// ------------------------------------------------------------ the spend

interface JobRunCost { project: string | null; job_id: string; cost: number }

/** The ledger's `job-run` events by `payload.run_id`, the last line winning. */
export function jobRunCosts(text: string): Map<string, JobRunCost> {
  const out = new Map<string, JobRunCost>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.event !== "job-run" || !o.payload || typeof o.payload !== "object") continue;
    const runId = str(o.payload.run_id), jobId = str(o.payload.job_id);
    if (!runId || !jobId) continue;
    const c = o.payload.total_cost_usd;
    out.delete(runId);
    out.set(runId, { project: str(o.project), job_id: jobId, cost: typeof c === "number" && Number.isFinite(c) && c > 0 ? c : 0 });
  }
  return out;
}

const ledgerCache = new Map<string, Stamp & { value: Map<string, JobRunCost> }>();
/** The studio's `safe_name`: every character outside `[A-Za-z0-9._-]` becomes `_` (as `page.ts`). */
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._\-]/g, "_");
/** getpass order: LOGNAME, USER, LNAME, USERNAME, then the account name (as `page.ts`). */
function ledgerUser(env: Env): string {
  for (const k of ["LOGNAME", "USER", "LNAME", "USERNAME"]) if (env[k]) return env[k]!;
  try { return userInfo().username; } catch { return "unknown"; }
}

export function ledgerPath(env: Env, who?: { user: string; machine: string }): string {
  const w = who ?? { user: ledgerUser(env), machine: hostname() };
  return join(studioHome(env), "measurements", `${safeName(w.user)}-${safeName(w.machine)}.jsonl`);
}

/** The metered spend per epic number for `project` (see the header): the ledger's `project` is the raw project id
 * (`ledger.py` redacts it, it never applies `safe_name`). */
export function spendByEpic(path: string, project: string): Map<string, number> {
  const costs = cachedFile(ledgerCache, path, jobRunCosts, new Map());
  const out = new Map<string, number>();
  for (const c of costs.values()) {
    if (c.project !== project) continue;
    const n = /^run-epic-(\d+)$/.exec(c.job_id)?.[1];
    if (!n) continue;
    const key = String(Number(n));
    out.set(key, (out.get(key) ?? 0) + c.cost);
  }
  return out;
}

// ------------------------------------------------------------ the band

/** `epics.<EP-NNN>.usd_estimate` of the project's budget bands, a positive number, else null. */
export function readBands(root: string): Record<string, number> {
  let doc: unknown;
  try { doc = loadYaml(readFileSync(join(root, BANDS_REL), "utf-8")); } catch { return {}; }
  const epics = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>).epics : undefined;
  if (!epics || typeof epics !== "object" || Array.isArray(epics)) return {};
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(epics as Record<string, unknown>)) {
    const usd = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>).usd_estimate : undefined;
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) out[id] = usd;
  }
  return out;
}

// ------------------------------------------------------------ the runs

/** The latest `host-verify` event's outcome, null with none. */
export function hostVerifyOf(events: readonly QueueEvent[]): HostVerifyOutcome | null {
  const d = events.findLast((e) => e.kind === "host-verify")?.detail as HostVerifyResult | null | undefined;
  if (!d || typeof d !== "object") return null;
  return legVerdict(d);
}

/** Story 36.1: a red or inconclusive leg needs you, only when the latest `host-verify` follows the latest `launched`
 * (worktree.ts `recordedVerify`'s rule). */
function needsYouSince(events: readonly QueueEvent[]): boolean {
  const at = events.findLastIndex((e) => e.kind === "host-verify");
  if (at <= events.findLastIndex((e) => e.kind === "launched")) return false;
  const outcome = hostVerifyOf(events);
  return outcome === "red" || outcome === "inconclusive";
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

interface RunFacts { run: QueueRun; events: QueueEvent[]; stories: Set<string>; weak: Set<string>; storyKey: string | null; pr: string | null; host: HostVerifyOutcome | null; endedAt: string | null }

function factsOf(run: QueueRun, events: QueueEvent[], live: LiveRunProgress | undefined): RunFacts {
  const stories = new Set<string>();
  const add = (k: unknown) => { const n = typeof k === "string" ? storyNumber(k) : undefined; if (n) stories.add(n); };
  for (const e of events) if (e.kind === "plan-status") add(e.detail?.story_key);
  const ruling = awaitingRuling(events);
  const paused = pausedStory(events);
  add(ruling?.detail?.story_key);
  add(paused.story_key);
  // A live story `done` is weak: a close-out relaunch marks earlier stories done from their landed spec files
  // (`specsDone`), not from this run's work, so it names the story only when no other run does (see `boardFor`).
  const weak = new Set<string>();
  for (const s of live?.stories ?? []) {
    if (s.status === "pending") continue;
    if (s.status !== "done") { add(s.key); continue; }
    const n = storyNumber(s.key);
    if (n) weak.add(n);
  }
  const planKey = str(events.findLast((e) => e.kind === "plan-status" && str(e.detail?.story_key))?.detail?.story_key);
  return {
    run, events, stories, weak,
    storyKey: str(ruling?.detail?.story_key) ?? paused.story_key ?? str(live?.epic?.current_story) ?? planKey,
    pr: runPr(events) ?? priorPr(events) ?? null,
    host: hostVerifyOf(events),
    endedAt: isTerminal(run.state) ? lastRunOf(run, events).ended_at : null,
  };
}

/** The triage (see the README): every live run in exactly one column, plus the runs ended on the host's local day;
 * Story 32.1: then the served root's engagements waiting on the owner, in Needs-you. */
function triage(facts: readonly RunFacts[], now: number, root: string | null): BoardAnswer["triage"] {
  const out: BoardAnswer["triage"] = { needs_you: [], working: [], done: [] };
  const today = new Date(now);
  for (const f of facts) {
    const state = f.run.state;
    const live = state !== null && LIVE_RUN_STATES.has(state);
    const ruling = live ? str(runWaitReason(f.run, f.events)) : null;
    const item: TriageItem = { run_id: f.run.run_id, state, story_key: f.storyKey, pr: f.pr, ruling };
    const legNeedsYou = needsYouSince(f.events);
    if (live) {
      if (state === "paused" || awaitingRuling(f.events) !== null || legNeedsYou) out.needs_you.push(item);
      else out.working.push(item);
    } else if (isTerminal(state) && f.endedAt && sameLocalDay(new Date(f.endedAt), today)) {
      (legNeedsYou ? out.needs_you : out.done).push(item);
    }
  }
  for (const e of listEngagements(root)) {
    const state = String(e.state);
    if (needsYou(state)) out.needs_you.push({ engagement: e.id, state, title: titleOf(typeof e.request === "string" ? e.request : "") });
  }
  return out;
}

// ------------------------------------------------------------ the board

/** The board of a registered project, or null when the registry does not serve `project`. */
export async function boardFor(project: string, deps: BoardDeps): Promise<BoardAnswer | null> {
  const shown = await deps.registry();
  const projects = shown?.projects && typeof shown.projects === "object" ? shown.projects as Record<string, any> : undefined;
  const entry = projects && Object.hasOwn(projects, project) ? projects[project] : undefined;
  if (!entry || typeof entry !== "object") return null;
  const root = str(entry.root);
  const now = (deps.now ?? Date.now)();
  const env = deps.env ?? process.env;

  const live = new Map((deps.liveRuns?.() ?? []).map((r) => [r.run_id, r]));
  const facts = deps.queue.runs().filter((r) => r.project_id === project)
    .map((r) => factsOf(r, deps.queue.events(r.run_id), live.get(r.run_id)));

  const plan: PlanPart = root ? readPlan(root) : { reason: "no plan directory: the registry names no root", epics: [], stories: [] };
  const findings = root && !plan.reason ? readFindings(root) : [];
  const spend = plan.reason ? new Map<string, number>() : spendByEpic(ledgerPath(env, deps.ledger), project);
  const bands = root && !plan.reason ? readBands(root) : {};

  // Story key N.M → its latest run (creation order: the last wins) among the runs naming it strongly (plan-status,
  // ruling, pause, a live story not `pending` or `done`); a weak name (a live `done`) only fills a key no run names
  // strongly, so a relaunch never takes over a story an earlier run covered.
  const latest = new Map<string, RunFacts>();
  for (const f of facts) for (const k of f.stories) latest.set(k, f);
  const strong = new Set(latest.keys());
  for (const f of facts) for (const k of f.weak) if (!strong.has(k)) latest.set(k, f);

  const keyOf = (s: PlanStory) => s.key ?? "";
  const byKey = (a: PlanStory, b: PlanStory) => {
    const [a1, a2] = keyOf(a).split(".").map(Number), [b1, b2] = keyOf(b).split(".").map(Number);
    return (a1 ?? 0) - (b1 ?? 0) || (a2 ?? 0) - (b2 ?? 0) || a.id.localeCompare(b.id);
  };
  const epics: BoardEpic[] = plan.epics.map((ep) => {
    const stories: BoardStory[] = plan.stories.filter((s) => s.parent === ep.id).sort(byKey).map((s) => {
      const f = s.key ? latest.get(s.key) : undefined;
      return {
        id: s.id, key: s.key ?? "", title: s.title, status: s.status,
        findings: s.key ? findings.filter((x) => x.story === s.key).map(({ id, title, severity }) => ({ id, title, severity })) : [],
        run: f ? { run_id: f.run.run_id, state: f.run.state, pr: f.pr, host_verify: f.host, ended_at: f.endedAt } : null,
      };
    });
    const spent = ep.number !== null ? spend.get(String(Number(ep.number))) ?? 0 : 0;
    return {
      id: ep.id, title: ep.title, status: ep.status, band_usd: bands[ep.id] ?? null,
      spend_usd: Math.round(spent * 1e6) / 1e6,
      findings: stories.reduce((n, s) => n + s.findings.length, 0), stories,
    };
  });
  return {
    ok: true, project, built_at: new Date(now).toISOString(), plan: plan.reason ? { reason: plan.reason } : {}, epics,
    triage: triage(facts, now, root),
  };
}
