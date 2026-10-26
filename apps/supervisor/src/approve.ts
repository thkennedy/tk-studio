/**
 * Approval, autonomy and the first run (Story 32.6, user flow F2 step 5, B5 item 5, contract 0.1.27 additive): what
 * the owner's `approve {autonomy, base_ref?}` means once 32.1's `record-approval` moved the record `quoted →
 * approved`. No HTTP here; `cli.ts` runs the passes at its `finally` sites and after an applied input on `POST
 * /engagements/{id}/input` (`afterEngagementInput`). Only that typed input starts the approve pass: no chat line, no
 * planner proposal, no timer.
 *
 *   the approve pass  `approvePass`, per `approved` record whose newest `approve` line no `engagement-approve
 *                {step: "done"}` event follows, on the host against the served root's repository, in a dedicated git
 *                worktree on `engagement/ENG-NNN` cut from origin's default branch, or from `origin/engagement/ENG-NNN`
 *                while that branch is on origin and not merged into it (a re-approval after `revise`: the new plan one
 *                more commit on top, its content replacing the earlier plan wholesale — operator ruling 2026-10-25 (2),
 *                never force) (`<TK_SUPERVISOR_WORK>/worktrees/
 *                <project>/engagement-ENG-NNN`, removed once the commit is pushed, or after a failure before an ok
 *                `sync` that wrote nothing; after an ok `sync` it is kept and the next pass resumes in it, so the
 *                promote never repeats (after a failed `sync` that wrote — `partial` — it is kept too and the next
 *                pass re-runs the sync in it, never a second append):
 *                the served root's checkout is never switched or dirtied), under a cross-process lockfile beside it
 *                (`….lock`, a dead pid's reclaimed). Every step event is scoped to the newest `approve` line, so a
 *                re-approval after `revise` runs the pass again. Inputs (`scope.md`, the record, the budget-bands
 *                values) are read from the served root.
 *                The steps, in order, each one `engagement-approve {id, project, step, ok, detail}` service event (a
 *                failed step is retried at the next pass and never moves the state; the pass writes nothing into the
 *                record; a failure equal to the step's newest event is not repeated):
 *                  append  the scope's `## Proposed epics and stories` (`### Epic <k>:` / `#### Story <k>.<m>:`, each
 *                          story's As a / I want / So that / Acceptance Criteria found as substrings, as
 *                          `engage.py STORY_SHAPE`) appended to `epics.md` as `## Epic N` (N = the highest `## Epic`
 *                          number there + 1, + 2, … in order), first body line `engagement: ENG-NNN`, the stories re-emitted as
 *                          `### Story N.M:`. Refusals by name: `NoScope` (no `scope.md`, no proposed story),
 *                          `StoryShape: <k>.<m>`, `NotApproved` (the record is not `approved`);
 *                  sync    `plansync.py sync --directory <worktree>` (normalize, then the projection: the EP- and ST-
 *                          entities, the index, the backlog mirrors, the promote to Jira); its `written[]` and `removed[]` kept;
 *                  job     each appended epic's `run-epic-N` job declared (`.tk-studio/jobs/run-epic-N.json` and its id
 *                          appended to `.tk-studio/config.yaml`'s `jobs:`, every other byte kept), and
 *                          `.tk-studio/budget-bands.yaml` re-keyed: each `quote.basis.epics[].ep_id`'s `usd_estimate`
 *                          (read from the served root) moved to the minted EP id in `quote.epic_bands_text`'s byte
 *                          shape, other entries kept; a `null` `ep_id` writes no band and is named in `no_band`;
 *                  commit  exactly one commit of the union of plansync's `written[]` (its `removed[]` staged as deletions) and the files this pass wrote
 *                          (on a cut from the engagement branch, also the reset to the default branch's tree), pushed
 *                          to origin as a plain fast-forward, never forced (a rejection: `NonFastForward`, retried: the next pass,
 *                          origin's moved tip not in HEAD, moves HEAD onto it keeping the worktree's tree, `reset --soft`,
 *                          and commits on top);
 *                  pr      `gh pr create --base <default branch> --head engagement/ENG-NNN` (an open one reused: it
 *                          carries the new commit):
 *                          `detail.pr {number, url}` — main is protected, the plan change is reviewed like any change;
 *                  queued  the first epic's job queued with `payload {engagement, project}` once `gh pr view` says
 *                          `MERGED`, in every case (an OPEN PR queues nothing; the job resolves from the served root
 *                          only once the PR lands — operator ruling 2026-10-25, option (c)); the approval's
 *                          `base_ref`, when given, is passed to that run as its `base_ref` (its worktree cut from it),
 *                          else the run cuts from the default branch; `detail.run_id` and the placement; then
 *                          `engagement-run-queued {engagement, project, run_id, job}` and the step `done`.
 *   the run pass  `engagementRunPass`, per engagement its `engagement-run-queued` events link to runs:
 *                - `launched` on a linked run: `applyEvent(launched)` (`approved → in-progress`), once per engagement;
 *                - the cap: `spend.runs_usd >= quote.cap` in `in-progress` → `applyEvent(cap)` (`partial`), one
 *                  notifier line, then the live linked run stopped gracefully (`launch.py stop --graceful`) and the
 *                  engagement's issue blocked `track.py block --engagement --kind cap` with `runs_usd`, `cap`,
 *                  `band85.usd` and `band95.usd`; `partial + go {cap}` (32.1's `raise-cap`) then resubmits;
 *                  `cancel` stops the live run gracefully;
 *                - autonomy (`record.autonomy`): `full` the epic end to end, as a run-epic runs today; `steady` and
 *                  `ask` stop the live linked run gracefully once `storyLanded` (or its close-out) names a story;
 *                  `steady` resubmits (same payload) once that run's PR merges, the state staying `in-progress`;
 *                  `ask` applies `run-paused`, blocks the issue `--kind ask`, and an owner comment line `continue`
 *                  (the 32.3 comment-reader rule: an owner comment after the newest agent comment) applies
 *                  `run-resumed` and resubmits;
 *                - Story 32.8: a mid-run `revise` (any linked run of any cycle live while the record is `scoping`)
 *                  stops each live engine gracefully with reason `revise` (a still-queued run cancelled), once per
 *                  engine, and resubmits nothing (a re-approval starts a new cycle); a run that ends on its own (the
 *                  epic done, or failed) is `delivery.ts`'s closeout pass (`run-ended`, the report, the issue Done).
 *                Events: `engagement-run-stop {engagement, project, run_id, engine_run_id, reason, story_key?, ok,
 *                detail}`, `engagement-cap {engagement, project, run_id, runs_usd, cap, notify}`,
 *                `engagement-continue {engagement, project, comment}`, `engagement-issue {…, action: "blocked", kind}`
 *                and the `engagement` service event for every applied row. No new `TRANSITIONS` row.
 *   the spend    `engagementRunSpendPass` beside `chatSpendPass`, at the same three `finally` sites: the ledger's
 *                `job-run` `total_cost_usd` summed over the runs the engagement's `engagement-run-queued` events
 *                name into `spend.runs_usd`, merged alone into a fresh read; never throws.
 *   Injected deps (the submit, the graceful stop, the queued-run cancel, the notifier); every pass never throws and is
 *   serialised per served root in-process; across processes the approve pass holds its per-engagement lockfile and
 *   the run pass re-reads the events right before each write.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import { jobRunCosts } from "./board";
import { frontmatter, jiraBound, storyLanded } from "./closeout";
import {
  applyEvent, atomicWrite, ENGAGEMENTS_REL, readEngagement, writeEngagement,
  type Engagement, type EngagementEvent, type EngagementState, type InputLine,
} from "./engagement";
import { notifier, workDir } from "./env";
import { notify as sendNotice, type EndNotice } from "./hygiene";
import { readComments } from "./inbox";
import { readInbox } from "./office";
import { runPr } from "./planstatus";
import { blockKind } from "./questions";
import { engineRoot, isTerminal, type Queue, type QueueRun } from "./queue";
import { lastJsonObject, type RunResult } from "./server";
import { defaultBranch, gh, runner, studioScript, uvRunner, type WorktreeDeps } from "./worktree";

// ------------------------------------------------------------ deps and events

/** Queue one run of `jobId` for the served root `root` (production: `cli.ts` `submitJob` with the placement
 * fallback); answers its queue run id and the placement used. Throws on a refusal. */
export type Submitter = (
  jobId: string, root: string, o: { baseRef?: string; payload: Record<string, unknown> },
) => Promise<{ run_id: string; placement?: Record<string, unknown> | null }>;
/** Stop a launched engine gracefully (production: `cli.ts` `launchStopGraceful`). Never throws. */
export type GracefulStop = (root: string, engineRunId: string) => Promise<{ ok: boolean; detail: string }>;

export interface ApproveDeps extends WorktreeDeps {
  /** The clock (ISO stamps for the records and the events; default now). */
  now?: () => string;
  /** The run's queueing (see `Submitter`); absent: the `queued` step fails `NoSubmitter`. */
  submit?: Submitter;
  /** The graceful stop (see `GracefulStop`); absent: a stop is recorded failed. */
  launchStop?: GracefulStop;
  /** The cap's one notifier line (default: `TK_SUPERVISOR_NOTIFY` through `hygiene.notify`). */
  notify?: (notice: EndNotice) => Promise<Record<string, unknown>>;
  /** Tests: called between a pass's first read of a record and its fresh re-read before the write. */
  beforeWrite?: (root: string, engagement: string) => void;
  /** Cancel a linked run still queued (production: `cli.ts` `cancelRun`; default: `Queue.end` `cancelled` from
   * `queued`). Throws on a refusal (claimed or ended meanwhile). */
  cancelQueued?: (runId: string) => Promise<unknown>;
}

export interface ApproveResult { done: string[]; refused: string[]; failed: string[] }
export interface EngagementRunResult { launched: string[]; capped: string[]; stopped: string[]; paused: string[]; resumed: string[]; resubmitted: string[] }

export const APPROVE_EVENT = "engagement-approve";
export const RUN_QUEUED_EVENT = "engagement-run-queued";
export const RUN_STOP_EVENT = "engagement-run-stop";
export const CAP_EVENT = "engagement-cap";
export const CONTINUE_EVENT = "engagement-continue";
export const APPROVE_STEPS = ["append", "sync", "job", "commit", "pr", "queued"] as const;
export type ApproveStep = typeof APPROVE_STEPS[number] | "done";

export const EPICS_REL = "_bmad-output/planning-artifacts/epics.md";
export const PLAN_DIR_REL = "_bmad-output/planning-artifacts/plan";
export const BANDS_REL = ".tk-studio/budget-bands.yaml";
export const CONFIG_REL = ".tk-studio/config.yaml";
export const JOBS_REL = ".tk-studio/jobs";
export const engagementBranch = (id: string) => `engagement/${id}`;

export type Target = { root: string; engagement: string };
type Detail = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const failed = (r: RunResult) => `exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;
const nowIso = (deps: ApproveDeps) => (deps.now ? deps.now() : new Date().toISOString());
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The in-process serialisation per served root (the `scope.ts` pattern). */
const rootChains = new Map<string, Promise<void>>();
export function serialised(root: string, fn: () => Promise<void>): Promise<void> {
  const next = (rootChains.get(root) ?? Promise.resolve()).then(fn).catch(() => { /* this root on the next pass */ });
  rootChains.set(root, next);
  void next.then(() => { if (rootChains.get(root) === next) rootChains.delete(root); });
  return next;
}

/** The service events of `kind` for one engagement (keyed `engagement`, or `id` for `engagement-approve`). */
export function eventsFor(queue: Queue, kind: string, project: string, engagement: string) {
  const key = kind === APPROVE_EVENT ? "id" : "engagement";
  return queue.serviceEvents(kind).filter((e) => e.detail?.[key] === engagement && e.detail?.project === project);
}

/** The engagements a pass looks at: the input route's one (`only`), every engagement a `chat-queued` event names
 * (its root the run payload's `project_root`, as `chatSpendPass` reads it), every one an `engagement-run-queued`
 * event names (the run's root) and every one an `engagement-approve` event names (its `detail.root`). */
export function targetsOf(queue: Queue, only?: Target): Target[] {
  const out = new Map<string, Target>();
  const key = (t: Target) => `${t.root}\u0000${t.engagement}`;
  const add = (root: unknown, engagement: unknown) => {
    if (typeof root !== "string" || !root || typeof engagement !== "string" || !engagement) return;
    const t = { root, engagement };
    if (only && key(t) !== key(only)) return;
    out.set(key(t), t);
  };
  if (only) out.set(key(only), { ...only });
  for (const ev of queue.serviceEvents("chat-queued")) {
    const d = ev.detail ?? {};
    if (typeof d.run_id !== "string") continue;
    const served = queue.runPayload(d.run_id)?.project_root;
    add(typeof served === "string" && served !== "" ? served : queue.get(d.run_id)?.root, d.engagement);
  }
  for (const ev of queue.serviceEvents(RUN_QUEUED_EVENT)) {
    const d = ev.detail ?? {};
    if (typeof d.run_id === "string") add(queue.get(d.run_id)?.root, d.engagement);
  }
  for (const ev of queue.serviceEvents(APPROVE_EVENT)) add(isObject(ev.detail?.detail) ? ev.detail.detail.root : undefined, ev.detail?.id);
  return [...out.values()];
}

/** Write a record transform on a fresh read (the `chatSpendPass` rule). */
function writeFresh(root: string, id: string, deps: ApproveDeps, apply: (fresh: Engagement) => Engagement | null): Engagement | null {
  deps.beforeWrite?.(root, id);
  const fresh = readEngagement(root, id);
  if (!fresh) return null;
  const next = apply(fresh);
  if (!next) return null;
  writeEngagement(root, next);
  return next;
}

/** One supervisor-observed event row applied on a fresh read (only the row's fields merged), then the `engagement`
 * service event; `once` refuses when the fresh record already holds such a line. Answers whether it applied. */
export function applyRow(
  queue: Queue, deps: ApproveDeps, t: Target, event: EngagementEvent, detail: Detail,
  once?: (fresh: Engagement) => boolean,
): boolean {
  const at = nowIso(deps);
  const moved: { from?: EngagementState; to?: EngagementState } = {};
  const written = writeFresh(t.root, t.engagement, deps, (fresh) => {
    if (once && once(fresh)) return null;
    const applied = applyEvent(fresh, { event, detail, at });
    if (!applied.ok) return null;
    moved.from = applied.from; moved.to = applied.to;
    return { ...fresh, state: applied.record.state, quote: applied.record.quote, updated: applied.record.updated, inputs: applied.record.inputs };
  });
  if (!written) return false;
  queue.serviceEvent("engagement", { id: t.engagement, project: written.project, state: moved.to, from: moved.from, verb: event, source: "supervisor" }, at);
  return true;
}

// ------------------------------------------------------------ the scope's proposed epics (append)

export interface ProposedStory { m: number; title: string; body: string }
export interface ProposedEpic { k: number; title: string; intro: string; stories: ProposedStory[] }

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SCOPE_EPIC_RE = /^Epic\s+(\d+)\s*:\s*(\S.*)$/;
const SCOPE_STORY_RE = /^Story\s+(\d+)\.(\d+)\s*:\s*(\S.*)$/;
/** `engage.py STORY_SHAPE`: each part found as a substring of the story's body. */
const STORY_SHAPE: readonly [string, RegExp][] = [
  ["As a", /\bAs an?\b/], ["I want", /\bI want\b/], ["So that", /\bSo that\b/], ["**Acceptance Criteria:**", /Acceptance Criteria/i],
];
const EPIC_HEAD_RE = /^## Epic (\d+): (.+?)\s*$/;

/** Every ATX heading outside a fence: (line index, level, title). */
function headings(lines: readonly string[]): { i: number; level: number; title: string }[] {
  const out: { i: number; level: number; title: string }[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const opened = FENCE_RE.exec(line);
    if (fence !== null) {
      if (opened && opened[1]![0] === fence[0] && opened[1]!.length >= fence.length) fence = null;
      return;
    }
    if (opened) { fence = opened[1]!; return; }
    const m = HEADING_RE.exec(line);
    if (m) out.push({ i, level: m[1]!.length, title: m[2]!.trim() });
  });
  return out;
}

const scopeRel = (id: string) => `_bmad-output/engagements/${id}/scope.md`;

/** The scope's `## Proposed epics and stories` (see the header): its epics with their stories, or the refusal by
 * name (`NoScope`, `StoryShape: <k>.<m>`). */
export function proposedEpics(text: string, id: string): { ok: true; epics: ProposedEpic[] } | { ok: false; reason: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const heads = headings(lines);
  const top = heads.findIndex((h) => h.level === 2 && h.title.toLowerCase() === "proposed epics and stories");
  if (top < 0) return { ok: false, reason: `NoScope: ${scopeRel(id)} has no "## Proposed epics and stories" section` };
  const sectionEnd = heads.slice(top + 1).find((h) => h.level <= 2)?.i ?? lines.length;
  const inner = heads.slice(top + 1).filter((h) => h.i < sectionEnd);
  const epics: ProposedEpic[] = [];
  const misnumbered: string[] = []; // a `#### Story <k>.<m>` under another epic's `### Epic`
  for (const [n, h] of inner.entries()) {
    if (h.level !== 3) continue;
    const em = SCOPE_EPIC_RE.exec(h.title);
    if (!em) continue;
    const end = inner.slice(n + 1).find((x) => x.level <= 3)?.i ?? sectionEnd;
    const own = inner.slice(n + 1).filter((x) => x.i < end);
    const firstStory = own.find((x) => x.level === 4)?.i ?? end;
    const epic: ProposedEpic = { k: Number(em[1]), title: em[2]!.trim(), intro: lines.slice(h.i + 1, firstStory).join("\n").trim(), stories: [] };
    for (const [j, s] of own.entries()) {
      if (s.level !== 4) continue;
      const sm = SCOPE_STORY_RE.exec(s.title);
      if (!sm) continue;
      if (Number(sm[1]) !== epic.k) misnumbered.push(`StoryShape: ${Number(sm[1])}.${Number(sm[2])} (under ### Epic ${epic.k}: a proposed story is numbered <its epic>.<m>)`);
      const stop = own.slice(j + 1).find((x) => x.level <= 4)?.i ?? end;
      epic.stories.push({ m: Number(sm[2]), title: sm[3]!.trim(), body: lines.slice(s.i + 1, stop).join("\n").trim() });
    }
    epics.push(epic);
  }
  const ks = epics.map((e) => e.k);
  const dup = ks.find((k, i) => ks.indexOf(k) !== i);
  if (dup !== undefined) return { ok: false, reason: `NoScope: ${scopeRel(id)} repeats ### Epic ${dup} (each proposed epic needs its own number)` };
  const zero = epics.find((e) => e.k < 1);
  if (zero) return { ok: false, reason: `NoScope: Epic ${zero.k} in ${scopeRel(id)} (a proposed epic is numbered from 1)` };
  if (!epics.some((e) => e.stories.length)) return { ok: false, reason: `NoScope: ${scopeRel(id)} proposes no story (#### Story <k>.<m>: <title>)` };
  if (misnumbered.length) return { ok: false, reason: misnumbered[0]! };
  for (const e of epics) {
    const ms = e.stories.map((s) => s.m);
    const again = ms.find((m, i) => ms.indexOf(m) !== i);
    if (again !== undefined) return { ok: false, reason: `StoryShape: ${e.k}.${again} repeated (each proposed story of an epic needs its own number)` };
  }
  for (const e of epics) {
    for (const s of e.stories) {
      const missing = STORY_SHAPE.filter(([, re]) => !re.test(s.body)).map(([name]) => name);
      if (missing.length) return { ok: false, reason: `StoryShape: ${e.k}.${s.m} (missing ${missing.map((m) => JSON.stringify(m)).join(", ")})` };
    }
  }
  return { ok: true, epics: epics.filter((e) => e.stories.length) };
}

/** `epics.md` with the proposed epics appended as `## Epic N` (N = the highest `## Epic` number + 1, + 2, … in the
 * scope's order, contiguous whatever the scope's own numbers; each keeps its `k` for the band re-key), each first body
 * line `engagement: ENG-NNN`, its stories `### Story N.M:` (see the header). `reserved`: the epic numbers other
 * engagements' unmerged approvals hold (`reservedEpics`), counted in that highest number. */
export function appendEpics(
  epicsText: string, epics: readonly ProposedEpic[], id: string, reserved: readonly number[] = [],
): { text: string; epics: { k: number; n: number; title: string; stories: number }[] } {
  let max = 0;
  for (const n of reserved) if (Number.isFinite(n)) max = Math.max(max, n);
  for (const line of epicsText.split(/\r?\n/)) {
    const m = EPIC_HEAD_RE.exec(line);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const sections: string[] = [];
  const out: { k: number; n: number; title: string; stories: number }[] = [];
  for (const [i, e] of epics.entries()) {
    const n = max + 1 + i;
    let s = `## Epic ${n}: ${e.title}\n\nengagement: ${id}\n`;
    if (e.intro) s += `\n${e.intro}\n`;
    for (const st of e.stories) s += `\n### Story ${n}.${st.m}: ${st.title}\n\n${st.body}\n`;
    sections.push(s);
    out.push({ k: e.k, n, title: e.title, stories: e.stories.length });
  }
  let head = epicsText;
  if (head && !head.endsWith("\n")) head += "\n";
  if (head) head += "\n";
  return { text: head + sections.join("\n"), epics: out };
}

// ------------------------------------------------------------ the job and the band (job)

/** `.tk-studio/config.yaml` with `jobId` appended to its top-level `jobs:` list, every other byte kept (an id already
 * listed: unchanged; no `jobs:` key: the list appended at the end; `jobs: []`: replaced by the block). Throws
 * `JobsUnwritable` on any other inline `jobs:` value. */
export function addJobId(text: string, jobId: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^jobs\s*:/.test(l));
  if (at < 0) {
    let head = text;
    if (head && !head.endsWith("\n")) head += "\n";
    return `${head}jobs:\n  - ${jobId}\n`;
  }
  const value = lines[at]!.replace(/^jobs\s*:/, "").replace(/(^|\s)#.*$/, "").trim();
  if (value === "[]") { lines.splice(at, 1, "jobs:", `  - ${jobId}`); return lines.join("\n"); }
  if (value) throw new Error(`JobsUnwritable: ${CONFIG_REL}'s top-level jobs is ${JSON.stringify(value)}, not a block list`);
  let last = at, indent = "  ";
  for (let i = at + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(raw)) break;
    const m = /^(\s+)-\s+(.*?)\s*$/.exec(raw);
    if (m) {
      if (m[2]!.replace(/^["']|["']$/g, "") === jobId) return text;
      last = i; indent = m[1]!;
    }
  }
  lines.splice(last + 1, 0, `${indent}- ${jobId}`);
  return lines.join("\n");
}

/** A number as Python's `repr(float)` writes it (`40.0`, `61.27`): `quote.epic_bands_text`'s byte shape. */
const pyFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const EPICS_LINE_RE = /^epics\s*:(?=\s|$)\s*(.*?)\s*$/;
const EMPTY_EPICS_RE = /^(~|null|\{\s*\})$/;

/** `budget-bands.yaml` with `epics.<id>.usd_estimate` set for each of `estimates` in `quote.epic_bands_text`'s byte
 * shape (`epics:` / `  EP-NNN:` / `    usd_estimate: <float>`), every byte outside those entries kept, other epics'
 * entries kept (pinned against the writer by `test_quote.py`). `moved`: the predicted EP ids whose estimate moved to
 * a minted id — each one's entry removed (its key line and its deeper lines), unless `estimates` sets it. Throws on a
 * scalar `epics:` other than empty, `~`, `null` or `{}`. */
export function rekeyBands(text: string | null, estimates: Record<string, number>, moved: readonly string[] = []): string {
  const lines = (text ?? "").split(/(?<=\n)/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (EPICS_LINE_RE.test(lines[i]!.replace(/\r?\n$/, ""))) { start = i; break; }
  const entry = (id: string, usd: number) => [`  ${id}:\n`, `    usd_estimate: ${pyFloat(usd)}\n`];
  if (start < 0) {
    let head = lines.join("");
    if (head && !head.endsWith("\n")) head += "\n";
    return head + ["epics:\n", ...Object.entries(estimates).flatMap(([id, usd]) => entry(id, usd))].join("");
  }
  const value = EPICS_LINE_RE.exec(lines[start]!.replace(/\r?\n$/, ""))![1]!.replace(/(^|\s)#.*$/, "").trim();
  if (value && !EMPTY_EPICS_RE.test(value)) throw new Error(`BandsUnwritable: ${BANDS_REL}'s top-level epics is ${JSON.stringify(value)}, not a mapping`);
  let end = start + 1;
  if (!value) {
    while (end < lines.length) {
      const raw = lines[end]!.replace(/\r?\n$/, "");
      if (raw.trim() && !raw.trimStart().startsWith("#") && !/^\s/.test(raw)) break;
      end += 1;
    }
    while (end > start + 1 && (!lines[end - 1]!.trim() || lines[end - 1]!.trimStart().startsWith("#"))) end -= 1;
  }
  const block = value ? [] : lines.slice(start + 1, end);
  if (block.length && !block[block.length - 1]!.endsWith("\n")) block[block.length - 1] += "\n";
  for (const id of moved) {
    if (Object.hasOwn(estimates, id)) continue;
    const at = block.findIndex((l) => l.replace(/\r?\n$/, "").trimEnd() === `  ${id}:`);
    if (at < 0) continue;
    let stop = at + 1;
    while (stop < block.length && /^ {3,}\S/.test(block[stop]!)) stop += 1;
    block.splice(at, stop - at);
  }
  for (const [id, usd] of Object.entries(estimates)) {
    const at = block.findIndex((l) => l.replace(/\r?\n$/, "").trimEnd() === `  ${id}:`);
    if (at < 0) { block.push(...entry(id, usd)); continue; }
    let stop = at + 1;
    while (stop < block.length && /^ {3,}\S/.test(block[stop]!)) stop += 1;
    const own = block.slice(at + 1, stop).findIndex((l) => /^ {4}usd_estimate\s*:/.test(l));
    if (own >= 0) block[at + 1 + own] = `    usd_estimate: ${pyFloat(usd)}\n`;
    else block.splice(stop, 0, `    usd_estimate: ${pyFloat(usd)}\n`);
  }
  return [...lines.slice(0, start), "epics:\n", ...block, ...lines.slice(value ? start + 1 : end)].join("");
}

/** The plan's EP id for each `## Epic N` (its entity's `source: epics.md#epic-N`), read in `served`. */
function mintedEpics(served: string, ns: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  const dir = join(served, PLAN_DIR_REL);
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => /^EP-.*\.md$/.test(n)); } catch { return out; }
  for (const name of names) {
    let fm: Record<string, unknown> = {};
    try { fm = frontmatter(readFileSync(join(dir, name), "utf-8")); } catch { continue; }
    const m = typeof fm.source === "string" ? /^epics\.md#epic-(\d+)$/.exec(fm.source.trim()) : null;
    if (m && ns.includes(Number(m[1]))) out.set(Number(m[1]), typeof fm.id === "string" && fm.id ? fm.id : name.slice(0, -3));
  }
  return out;
}

// ------------------------------------------------------------ the approve pass

/** The engagement's `engagement-approve` events; `since` (the newest `approve` line's `at`): only those at or after
 * it, so a re-approval after `revise` runs the pass again (finding H1). */
function approveEvents(queue: Queue, project: string, id: string, since?: string) {
  const all = eventsFor(queue, APPROVE_EVENT, project, id);
  return since === undefined ? all : all.filter((e) => e.at >= since);
}

/** One `engagement-approve` event; a step event equal to the step's newest one since the approve line (same `ok`,
 * same detail) is not repeated, so a refusal the next pass meets again is told once. */
function emitStep(queue: Queue, deps: ApproveDeps, t: Target, project: string, since: string, step: ApproveStep, ok: boolean, detail: Detail = {}): void {
  const full = { ...detail, root: t.root };
  const last = approveEvents(queue, project, t.engagement, since).findLast((e) => e.detail?.step === step);
  if (last && last.detail?.ok === ok && JSON.stringify(last.detail?.detail ?? null) === JSON.stringify(full)) return;
  queue.serviceEvent(APPROVE_EVENT, { id: t.engagement, project, step, ok, detail: full }, nowIso(deps));
}

const okStep = (queue: Queue, project: string, id: string, since: string, step: ApproveStep) =>
  approveEvents(queue, project, id, since).findLast((e) => e.detail?.step === step && e.detail?.ok === true);
const stepDetail = (e: { detail: Record<string, unknown> | null } | undefined): Detail => (isObject(e?.detail?.detail) ? e!.detail!.detail as Detail : {});

async function git(deps: ApproveDeps, cwd: string, args: string[], timeoutS = 120): Promise<RunResult> {
  return runner(deps)("git", args, { cwd, timeoutS });
}

/** The newest applied `approve` line (the one the pass serves). */
const approveLine = (record: Engagement): InputLine | undefined => record.inputs.findLast((l) => l.verb === "approve" && l.to === "approved");

/** The approve worktree's path and its cross-process lockfile beside it (`<work>/worktrees/<project>/engagement-
 * ENG-NNN` and `….lock`). */
const worktreePath = (work: string, project: string, id: string) => join(resolve(work), "worktrees", project.replace(/[^A-Za-z0-9._-]/g, "_"), `engagement-${id}`);

/** The epic numbers other engagements of `project` hold in flight: each one's ok `job` or `append` step's
 * `detail.epics[].n` with no ok `queued` step at or after it (approved, not merged yet: their `## Epic N` is not on
 * origin's default branch), so two approvals before either PR merges never take the same `## Epic N` (finding 4); an
 * ok `append` whose sync failed is resumed later with the same `## Epic N` (review P3), so it holds it too (follow-up
 * review F2). */
function reservedEpics(queue: Queue, project: string, id: string): number[] {
  const others = queue.serviceEvents(APPROVE_EVENT).filter((e) => e.detail?.project === project && typeof e.detail?.id === "string" && e.detail.id !== id);
  const out = new Set<number>();
  for (const e of others) {
    if ((e.detail?.step !== "job" && e.detail?.step !== "append") || e.detail?.ok !== true) continue;
    if (others.some((q) => q.detail?.id === e.detail?.id && q.detail?.step === "queued" && q.detail?.ok === true && q.at >= e.at)) continue;
    const epics = stepDetail(e).epics;
    if (Array.isArray(epics)) for (const x of epics) if (isObject(x) && num(x.n) !== undefined) out.add(x.n as number);
  }
  return [...out];
}

/** Whether the process `pid` lives (EPERM: it does, another user's). */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException)?.code === "EPERM"; }
}

/** The approve pass's cross-process lock for one engagement (the in-process `serialised` does not cover the serve
 * process against run/recover/drain): `wx`-created with `{pid, host, at}`; a held lock answers null (the engagement
 * waits for the next pass); a stale one (this host, its pid dead; or unreadable and older than a minute) is
 * reclaimed. Answers the release. */
function takeLock(path: string): (() => void) | null {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { return null; }
  const mine = JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, mine, { flag: "wx" });
      return () => {
        try { if (readFileSync(path, "utf-8") === mine) rmSync(path, { force: true }); } catch { /* gone */ }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") return null;
    }
    let text: string;
    try { text = readFileSync(path, "utf-8"); } catch { continue; } // released meanwhile: try again
    let held: Record<string, unknown> | null = null;
    try { const v = JSON.parse(text); held = isObject(v) ? v : null; } catch { held = null; }
    const stale = held
      ? held.host === hostname() && typeof held.pid === "number" && !pidAlive(held.pid)
      : (() => { try { return Date.now() - statSync(path).mtimeMs > 60_000; } catch { return false; } })();
    if (!stale) return null;
    try { if (readFileSync(path, "utf-8") === text) rmSync(path, { force: true }); } catch { /* reclaimed by another */ }
  }
  return null;
}

/** Steps `append` to `commit` in a worktree on `engagement/ENG-NNN` (see the header). Once `sync` succeeded (since
 * the newest approve line) and `commit` has not, the worktree is kept and the next pass resumes in it (no second
 * append, no second `plansync sync` — its promote to Jira already ran — finding H2); after a `partial` failed sync (it
 * wrote) it is kept as well and the next pass re-runs only the sync in it (review P3); it is removed once the commit is
 * pushed, or after a failure before any sync wrote. Answers whether the commit landed and was pushed. */
async function worktreeSteps(queue: Queue, deps: ApproveDeps, t: Target, record: Engagement, since: string): Promise<boolean> {
  const project = record.project, id = t.engagement;
  const emit = (step: ApproveStep, ok: boolean, detail: Detail) => emitStep(queue, deps, t, project, since, step, ok, detail);
  const fail = (step: ApproveStep, reason: string, extra: Detail = {}) => { emit(step, false, { reason, ...extra }); return false; };
  const work = workDir(deps.env ?? process.env);
  const wt = work ? worktreePath(work, project, id) : null;
  const appendOk = okStep(queue, project, id, since, "append"), syncOk = okStep(queue, project, id, since, "sync");
  // a sync that failed after writing (`partial`: its promote may have stamped keys) keeps the worktree too: the next
  // pass re-runs the sync there, never a second append (review P3)
  const syncLast = approveEvents(queue, project, id, since).findLast((e) => e.detail?.step === "sync");
  const partial = !syncOk && !!appendOk && syncLast?.detail?.ok === false && stepDetail(syncLast).partial === true && syncLast.at >= appendOk.at
    ? stepDetail(syncLast) : null;
  const keptEpics = stepDetail(appendOk).epics;
  const kept = syncOk ? stepDetail(syncOk) : partial ?? {};
  const keptPaths = (k: string): string[] => (Array.isArray(kept[k]) ? (kept[k] as unknown[]).filter((p): p is string => typeof p === "string" && p !== "") : []);
  // "resume": append and sync done; "resync": append done, the sync partial; "fresh": cut and append
  let mode: "fresh" | "resync" | "resume" = !!(appendOk && wt && existsSync(wt) && Array.isArray(keptEpics))
    ? (syncOk && Array.isArray(stepDetail(syncOk).written) ? "resume" : partial ? "resync" : "fresh") : "fresh";
  // the inputs, read from the served root
  let proposed: ProposedEpic[] = [];
  const readProposed = (): string | null => {
    let scope: string;
    try { scope = readFileSync(join(t.root, ENGAGEMENTS_REL, id, "scope.md"), "utf-8"); }
    catch { return `NoScope: no ${scopeRel(id)}`; }
    const p = proposedEpics(scope, id);
    if (!p.ok) return p.reason;
    proposed = p.epics;
    return null;
  };
  if (mode === "fresh") { const refused = readProposed(); if (refused) return fail("append", refused); }
  // the worktree: the served root's repository, cut from origin's default branch
  let top: string, prefix: string;
  try {
    const a = await git(deps, t.root, ["rev-parse", "--show-toplevel"], 30);
    const b = await git(deps, t.root, ["rev-parse", "--show-prefix"], 30);
    if (a.exit !== 0 || b.exit !== 0) return fail("append", `NotAGitCheckout: the served root is not a git checkout (${failed(a.exit !== 0 ? a : b)})`);
    top = resolve(a.stdout.trim()); prefix = b.stdout.trim();
  } catch (e) { return fail("append", `NotAGitCheckout: ${clip(message(e))}`); }
  let theDefault: string;
  try { theDefault = await defaultBranch(t.root, deps); } catch (e) { return fail("append", `NoDefaultBranch: ${clip(message(e))}`); }
  try { await git(deps, t.root, ["fetch", "--quiet", "origin", theDefault], 300); } catch { /* offline: origin's last known tip */ }
  const defaultRef = `origin/${theDefault}`;
  try {
    if ((await git(deps, t.root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${defaultRef}^{commit}`], 30)).exit !== 0) {
      return fail("append", `NoOriginBranch: refs/remotes/${defaultRef} does not resolve (the served root needs an origin)`);
    }
  } catch (e) { return fail("append", `NoOriginBranch: ${clip(message(e))}`); }
  if (!wt) return fail("append", "WorkDirMissing: TK_SUPERVISOR_WORK is not set (the approve worktree lives under it)");
  const branch = engagementBranch(id);
  // operator ruling 2026-10-25 (2), never force: an engagement branch on origin not yet merged into the default
  // branch (a re-approval after `revise` with the earlier PR open) is the cut, the new plan one more commit on top of
  // it whose content replaces the earlier plan wholesale (the tree reset to the default branch's, then the pass's
  // writes), pushed as a plain fast-forward; absent or merged, the cut is the default branch
  let base = defaultRef, onBranch = false, branchOnOrigin = false;
  try {
    const listed = await git(deps, t.root, ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`], 120);
    if (listed.exit !== 0 && listed.exit !== 2) return fail("append", `OriginUnreachable: git ls-remote ${failed(listed)}`);
    if (listed.exit === 0) {
      branchOnOrigin = true;
      const fetched = await git(deps, t.root, ["fetch", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], 300);
      if (fetched.exit !== 0) return fail("append", `OriginUnreachable: git fetch ${branch} ${failed(fetched)}`);
      const merged = await git(deps, t.root, ["merge-base", "--is-ancestor", `refs/remotes/origin/${branch}`, `refs/remotes/${defaultRef}`], 60);
      if (merged.exit === 1) { base = `origin/${branch}`; onBranch = true; }
      else if (merged.exit !== 0) return fail("append", `NoMergeBase: git merge-base ${failed(merged)}`);
    }
  } catch (e) { return fail("append", `OriginUnreachable: ${clip(message(e))}`); }
  const removeWorktree = async () => {
    try { await git(deps, top, ["worktree", "remove", "--force", wt], 60); } catch { /* removed below */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* best effort */ }
    try { await git(deps, top, ["worktree", "prune"], 60); } catch { /* best effort */ }
  };
  if (mode !== "fresh") {
    // the kept worktree must still be ours: on the engagement branch
    let head = "";
    try { head = (await git(deps, wt, ["rev-parse", "--abbrev-ref", "HEAD"], 30)).stdout.trim(); } catch { /* not a worktree */ }
    if (head !== branch) {
      mode = "fresh";
      const refused = readProposed();
      if (refused) return fail("append", refused);
    }
  }
  if (mode === "fresh") {
    if (existsSync(wt)) await removeWorktree();
    try {
      mkdirSync(dirname(wt), { recursive: true });
      const add = await git(deps, top, ["worktree", "add", "--relative-paths", wt, "-B", branch, base]);
      if (add.exit !== 0) return fail("append", `WorktreeAdd: git worktree add ${failed(add)}`);
      if (onBranch) {
        // the earlier plan replaced wholesale in content: the index and the files reset to the default branch's tree
        const reset = await git(deps, wt, ["read-tree", "-u", "--reset", defaultRef]);
        if (reset.exit !== 0) return fail("append", `WorktreeAdd: git read-tree ${failed(reset)}`);
      }
    } catch (e) { return fail("append", `WorktreeAdd: ${clip(message(e))}`); }
  }
  const ours = new Set<string>(); // served-relative paths this pass wrote
  // an ok sync (its promote done) not yet pushed, or a partial one: the worktree stays for the next pass
  let keep = mode !== "fresh";
  /** A failed sync that already wrote (now or at an earlier pass): the worktree kept, its paths recorded so the next
   * pass re-runs the sync in it and commits the union. */
  const partialExtra = (w: string[], r: string[]): Detail => {
    if (!w.length && !r.length) return {};
    keep = true;
    const real = realpathSync(wt);
    const rel = (ps: string[]) => [...new Set(ps.map((p: string) => relative(real, p).split("\\").join("/")))];
    return { partial: true, written: rel(w), removed: rel(r) };
  };
  let step: ApproveStep = mode === "resume" ? "job" : mode === "resync" ? "sync" : "append"; // the step running (review P6)
  const resume = mode === "resume";
  try {
    // canonical, so plansync's resolved `written[]` paths fall under it
    const real = realpathSync(wt);
    const served = prefix ? join(real, prefix) : real;
    // the untracked overlay the projection may read (never staged)
    const local = join(t.root, ".tk-studio", "config.local.yaml");
    if (existsSync(local)) { mkdirSync(join(served, ".tk-studio"), { recursive: true }); copyFileSync(local, join(served, ".tk-studio", "config.local.yaml")); }
    let appendedEpics: { k: number; n: number; title: string; stories: number }[];
    let written: string[], removed: string[];
    // a fresh cut (no kept worktree) carries none of an earlier pass's paths
    const keptAbs = (k: string) => (mode === "fresh" ? [] : keptPaths(k).map((p) => join(real, p)));
    const keptEpicsOf = () => (keptEpics as unknown[]).filter(isObject).map((e) => ({ k: Number(e.k), n: Number(e.n), title: String(e.title ?? ""), stories: Number(e.stories ?? 0) }));
    const rel = (ps: string[]) => [...new Set(ps.map((p: string) => relative(real, p).split("\\").join("/")))];
    if (resume) {
      // resumed in the kept worktree: the append and the sync (its promote) already done
      appendedEpics = keptEpicsOf();
      written = keptAbs("written");
      removed = keptAbs("removed");
      ours.add(EPICS_REL);
    } else {
      if (mode === "resync") {
        // the append already in the kept worktree; the sync re-run there
        appendedEpics = keptEpicsOf();
        ours.add(EPICS_REL);
      } else {
        // append
        let epicsText = "";
        try { epicsText = readFileSync(join(served, EPICS_REL), "utf-8"); } catch { /* absent: a new epics.md */ }
        const appended = appendEpics(epicsText, proposed, id, reservedEpics(queue, project, id));
        atomicWrite(join(served, EPICS_REL), appended.text);
        ours.add(EPICS_REL);
        emit("append", true, { epics: appended.epics });
        appendedEpics = appended.epics;
      }
      // sync (normalize, then the projection)
      step = "sync";
      let r: RunResult;
      try { r = await uvRunner(deps)(served, studioScript(deps, "lib", "plansync.py"), ["sync", "--directory", served], 600); }
      catch (e) { return fail("sync", `plansync.py sync: ${clip(message(e))}`, partialExtra(keptAbs("written"), keptAbs("removed"))); }
      const synced = lastJsonObject(r.stdout) as Record<string, any> | null;
      const paths = (v: unknown): string[] => (Array.isArray(v) ? v : []).filter((p: unknown): p is string => typeof p === "string" && p !== "")
        .map((p: string) => (isAbsolute(p) ? p : join(served, p)));
      // a partial sync's paths (an earlier pass's) kept in the union: the re-run may not report them again
      written = [...keptAbs("written"), ...paths(synced?.written)];
      removed = [...keptAbs("removed"), ...paths(synced?.removed)];
      if (!synced || synced.ok !== true) {
        const reason = synced ? clip(String(synced.reason ?? synced.error ?? "plansync refused")) : `plansync.py sync ${failed(r)}`;
        return fail("sync", reason, partialExtra(written, removed));
      }
      emit("sync", true, { written: rel(written), ...(removed.length ? { removed: rel(removed) } : {}) });
      keep = true;
    }
    // job: the run-epic-N jobs, then the band re-key
    step = "job";
    const minted = mintedEpics(served, appendedEpics.map((e) => e.n));
    const jobs: string[] = [];
    const at = nowIso(deps).slice(0, 10);
    let config = "";
    try { config = readFileSync(join(served, CONFIG_REL), "utf-8"); } catch { /* absent: a new config */ }
    for (const e of appendedEpics) {
      const jobId = `run-epic-${e.n}`;
      const jobPath = join(served, JOBS_REL, `${jobId}.json`);
      // a resumed pass keeps the job file it already wrote (its declared date)
      if (!(resume && existsSync(jobPath))) {
        const job = {
          job_schema_version: 1, id: jobId, type: "run-epic",
          description: `${project} Epic ${e.n} (${e.title}) for engagement ${id} through the supervisor queue (declared ${at} by the approve pass, Story 32.6).`,
          target: { payload: { epic: e.n } },
        };
        atomicWrite(jobPath, JSON.stringify(job, null, 2) + "\n");
      }
      ours.add(`${JOBS_REL}/${jobId}.json`);
      try { config = addJobId(config, jobId); } catch (err) { return fail("job", clip(message(err))); }
      jobs.push(jobId);
    }
    atomicWrite(join(served, CONFIG_REL), config);
    ours.add(CONFIG_REL);
    const basis = isObject(record.quote) && isObject(record.quote.basis) && Array.isArray(record.quote.basis.epics) ? record.quote.basis.epics : [];
    let servedBands: Record<string, unknown> = {};
    try {
      const doc = loadYaml(readFileSync(join(t.root, BANDS_REL), "utf-8")) as Record<string, unknown> | null;
      if (isObject(doc) && isObject(doc.epics)) servedBands = doc.epics;
    } catch { /* no bands: nothing re-keyed */ }
    const estimates: Record<string, number> = {};
    const moved: string[] = [];
    const noBand: Detail[] = [];
    for (const e of appendedEpics) {
      const b = basis.find((x) => isObject(x) && x.k === e.k) as Record<string, unknown> | undefined;
      const ep = b?.ep_id, mintedId = minted.get(e.n);
      if (typeof ep !== "string" || !ep) { noBand.push({ k: e.k, n: e.n, reason: "ep_id null" }); continue; }
      if (!mintedId) { noBand.push({ k: e.k, n: e.n, ep_id: ep, reason: "no minted EP id" }); continue; }
      const usd = isObject(servedBands[ep]) ? num((servedBands[ep] as Record<string, unknown>).usd_estimate) : undefined;
      if (usd === undefined) { noBand.push({ k: e.k, n: e.n, ep_id: ep, reason: "no usd_estimate" }); continue; }
      estimates[mintedId] = usd;
      if (ep !== mintedId) moved.push(ep);
    }
    if (Object.keys(estimates).length) {
      let bands: string | null = null;
      try { bands = readFileSync(join(served, BANDS_REL), "utf-8"); } catch { /* absent: a new file */ }
      try { atomicWrite(join(served, BANDS_REL), rekeyBands(bands, estimates, moved)); } catch (err) { return fail("job", clip(message(err))); }
      ours.add(BANDS_REL);
    }
    emit("job", true, {
      jobs, epics: appendedEpics.map((e) => ({ n: e.n, ep_id: minted.get(e.n) ?? null })), bands: estimates, no_band: noBand,
    });
    // commit: exactly the union of written[] (and removed[]'s deletions) and this pass's files; one commit; push
    step = "commit";
    const files = [...new Set([
      ...written.map((p: string) => relative(real, p)),
      ...[...ours].map((rel) => (prefix ? join(prefix, rel) : rel)),
    ].map((p) => p.split("\\").join("/")))].filter((p) => p && !p.startsWith(".."));
    const gone = rel(removed).filter((p) => p && !p.startsWith("..") && !files.includes(p));
    if (gone.length) {
      // plansync's removed[] (driver contract, tk-studio-plan-sync): their deletions staged (review P2)
      const rm = await git(deps, real, ["rm", "-q", "--cached", "--ignore-unmatch", "--", ...gone]);
      if (rm.exit !== 0) return fail("commit", `git rm ${failed(rm)}`);
    }
    const staged = await git(deps, real, ["add", "--", ...files]);
    if (staged.exit !== 0) return fail("commit", `git add ${failed(staged)}`);
    // origin's engagement branch moved past what this worktree holds (a push rejected as non-fast-forward, or a cut
    // that went stale): HEAD moved onto origin's tip keeping this worktree's tree (`reset --soft`), so the commit
    // below lands on top of it, its content replacing the remote's wholesale, and the push is a plain fast-forward
    // (operator ruling 2026-10-25 (2), never force — review P1)
    let rebased = false;
    if (branchOnOrigin) {
      const remote = `refs/remotes/origin/${branch}`;
      const tip = await git(deps, real, ["rev-parse", "--verify", "--quiet", `${remote}^{commit}`], 30);
      if (tip.exit === 0 && tip.stdout.trim()) {
        const contained = await git(deps, real, ["merge-base", "--is-ancestor", tip.stdout.trim(), "HEAD"], 60);
        if (contained.exit === 1) {
          const moved = await git(deps, real, ["reset", "-q", "--soft", tip.stdout.trim()], 60);
          if (moved.exit !== 0) return fail("commit", `git reset --soft ${failed(moved)}`);
          rebased = true;
        } else if (contained.exit !== 0) return fail("commit", `NoMergeBase: git merge-base ${failed(contained)}`);
      }
    }
    // a resumed pass whose commit was made locally (its push failed, nothing reached origin): amended when anything
    // changed, else pushed as is
    const ahead = resume && !rebased ? Number((await git(deps, real, ["rev-list", "--count", `${base}..HEAD`], 30)).stdout.trim()) || 0 : 0;
    const pending = (await git(deps, real, ["diff", "--cached", "--quiet"], 30)).exit !== 0;
    if (pending) {
      const msg = `engagement ${id}: the approved plan (${appendedEpics.map((e) => `Epic ${e.n}`).join(", ")}; ${jobs.join(", ")})`;
      const committed = await git(deps, real, ["commit", "-q", ...(ahead ? ["--amend"] : []), "-m", msg]);
      if (committed.exit !== 0) return fail("commit", `git commit ${failed(committed)}`);
    }
    const sha = (await git(deps, real, ["rev-parse", "HEAD"], 30)).stdout.trim();
    // a plain fast-forward push, never forced (operator ruling 2026-10-25 (2)); a rejection is a named refusal
    // retried at the next pass
    const pushed = await git(deps, real, ["push", "-q", "-u", "origin", branch], 300);
    if (pushed.exit !== 0) {
      const rejected = /non-fast-forward|\[rejected\]|fetch first|stale info/i.test(`${pushed.stderr}\n${pushed.stdout}`);
      return fail("commit", `${rejected ? "NonFastForward: origin rejected the push of" : "git push"} ${branch} ${failed(pushed)}`);
    }
    keep = false;
    emit("commit", true, { branch, base: theDefault, cut: base, sha, files, ...(gone.length ? { removed: gone } : {}) });
    return true;
  } catch (e) {
    return fail(step, clip(message(e)));
  } finally {
    if (!keep) await removeWorktree();
  }
}

/** A PR URL's number (`…/pull/<n>`). */
const prNumber = (url: string): number | null => { const m = /\/pull\/(\d+)/.exec(url); return m ? Number(m[1]) : null; };

/** Step `pr`: the approve branch's PR against the default branch (an open one reused). */
async function prStep(queue: Queue, deps: ApproveDeps, t: Target, project: string, since: string): Promise<boolean> {
  const commit = stepDetail(okStep(queue, project, t.engagement, since, "commit"));
  const branch = typeof commit.branch === "string" ? commit.branch : engagementBranch(t.engagement);
  const base = typeof commit.base === "string" ? commit.base : "main";
  const fail = (reason: string) => { emitStep(queue, deps, t, project, since, "pr", false, { reason }); return false; };
  let url: string | undefined;
  try {
    const listed = await gh(deps, t.root, ["pr", "list", "--head", branch, "--state", "open", "--json", "url"]);
    if (listed.exit === 0) {
      try {
        const rows = JSON.parse(listed.stdout.trim() || "[]");
        if (Array.isArray(rows) && typeof rows[0]?.url === "string") url = rows[0].url;
      } catch { /* none read: create */ }
    }
    if (!url) {
      const dir = mkdtempSync(join(tmpdir(), "tk-sup-approve-"));
      try {
        const body = join(dir, "body.md");
        writeFileSync(body, `The plan engagement ${t.engagement} approved (Story 32.6): the scope's proposed epics and stories in \`epics.md\`, `
          + `the plan entities \`plansync sync\` wrote, the run-epic job and the re-keyed budget band. Reviewed like any change; `
          + `the first run is queued on its merge (cut from the approval's \`base_ref\` when it named one, else from the default branch).\n`, "utf-8");
        const created = await gh(deps, t.root, ["pr", "create", "--base", base, "--head", branch, "--title", `${t.engagement}: the approved plan`, "--body-file", body]);
        if (created.exit !== 0) return fail(`gh pr create ${failed(created)}`);
        url = created.stdout.trim().split(/\r?\n/).reverse().find((l) => /^https?:\/\/\S+\/pull\/\d+/.test(l.trim()))?.trim();
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  } catch (e) { return fail(`gh: ${clip(message(e))}`); }
  if (!url) return fail("gh pr create printed no PR URL");
  emitStep(queue, deps, t, project, since, "pr", true, { pr: { number: prNumber(url), url }, branch, base });
  return true;
}

/** Step `queued`: the first epic's job, on the PR's merge in every case (operator ruling (c)); `base_ref`, when the
 * approval named one, passed to the run. */
async function queueStep(queue: Queue, deps: ApproveDeps, t: Target, record: Engagement, line: InputLine): Promise<boolean> {
  const project = record.project, since = line.at;
  const job = stepDetail(okStep(queue, project, t.engagement, since, "job")).jobs;
  const jobId = Array.isArray(job) && typeof job[0] === "string" ? job[0] : null;
  const fail = (reason: string) => { emitStep(queue, deps, t, project, since, "queued", false, { reason }); return false; };
  if (!jobId) return fail("NoJob: the job step declared no run-epic job");
  const baseRef = typeof line.payload?.base_ref === "string" && line.payload.base_ref.trim() ? line.payload.base_ref.trim() : undefined;
  // nothing drives before the merge: the job resolves from the served root only once the PR lands
  const pr = stepDetail(okStep(queue, project, t.engagement, since, "pr")).pr as Record<string, unknown> | undefined;
  const url = typeof pr?.url === "string" ? pr.url : null;
  if (!url) return fail("NoPr: the pr step recorded no PR");
  let r: RunResult;
  try { r = await gh(deps, t.root, ["pr", "view", url, "--json", "state,mergedAt"]); } catch { return false; }
  const view = r.exit === 0 ? lastJsonObject(r.stdout) as Record<string, unknown> | null : null;
  const state = typeof view?.state === "string" ? view.state.toUpperCase() : undefined;
  if (state === "CLOSED") return fail(`PrClosed: ${url} was closed unmerged`);
  if (state !== "MERGED") return false; // OPEN, or gh failed: asked again at the next pass
  if (!deps.submit) return fail("NoSubmitter: no run submitter wired");
  const payload = { engagement: t.engagement, project };
  let queued: { run_id: string; placement?: Record<string, unknown> | null };
  try { queued = await deps.submit(jobId, t.root, { ...(baseRef ? { baseRef } : {}), payload }); }
  catch (e) { return fail(clip(message(e))); }
  queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: t.engagement, project, run_id: queued.run_id, job: jobId }, nowIso(deps));
  emitStep(queue, deps, t, project, since, "queued", true, { run_id: queued.run_id, job: jobId, placement: queued.placement ?? null, base_ref: baseRef ?? null });
  return true;
}

async function approveStep(queue: Queue, deps: ApproveDeps, t: Target, out: ApproveResult): Promise<void> {
  const first = readEngagement(t.root, t.engagement);
  if (!first) return;
  if (!approveLine(first)) return; // never approved: nothing to do
  const project = first.project, id = t.engagement;
  // the cross-process lock (held elsewhere: this engagement at the next pass)
  const work = workDir(deps.env ?? process.env);
  const release = work ? takeLock(`${worktreePath(work, project, id)}.lock`) : () => {};
  if (!release) return;
  try {
    // re-read under the lock: every step event below is scoped to the newest approve line (finding H1)
    const record = readEngagement(t.root, id);
    if (!record) return;
    const line = approveLine(record);
    if (!line) return;
    const since = line.at;
    if (approveEvents(queue, project, id, since).some((e) => e.detail?.step === "done")) return;
    if (record.state !== "approved" && !okStep(queue, project, id, since, "queued")) {
      emitStep(queue, deps, t, project, since, "append", false, { reason: `NotApproved: ${id} is ${record.state}, not approved` });
      out.refused.push(id);
      return;
    }
    if (!okStep(queue, project, id, since, "commit") && !(await worktreeSteps(queue, deps, t, record, since))) { out.failed.push(id); return; }
    if (!okStep(queue, project, id, since, "pr") && !(await prStep(queue, deps, t, project, since))) { out.failed.push(id); return; }
    if (!okStep(queue, project, id, since, "queued") && !(await queueStep(queue, deps, t, record, line))) return;
    emitStep(queue, deps, t, project, since, "done", true, {});
    out.done.push(id);
  } finally { release(); }
}

/** The approve pass (see the header). `only`: one engagement (the input route's). Never throws. */
export async function approvePass(queue: Queue, deps: ApproveDeps = {}, only?: Target): Promise<ApproveResult> {
  const out: ApproveResult = { done: [], refused: [], failed: [] };
  try {
    for (const t of targetsOf(queue, only)) {
      await serialised(t.root, async () => {
        try { await approveStep(queue, deps, t, out); } catch { /* this engagement on the next pass */ }
      });
    }
  } catch { /* the next pass */ }
  return out;
}

// ------------------------------------------------------------ the engagement-run pass

export interface Link { run_id: string; job: string; after_run?: string; at: string }

/** The engagement's linked runs; `since` (the newest `approve` line's `at`): only those queued at or after it (a
 * re-approval after `revise` starts a new cycle — finding H1). */
export function linksOf(queue: Queue, project: string, id: string, since?: string): Link[] {
  return eventsFor(queue, RUN_QUEUED_EVENT, project, id)
    .filter((e) => typeof e.detail?.run_id === "string" && typeof e.detail?.job === "string" && (since === undefined || e.at >= since))
    .map((e) => ({ run_id: e.detail!.run_id as string, job: e.detail!.job as string, at: e.at,
      ...(typeof e.detail?.after_run === "string" ? { after_run: e.detail.after_run } : {}) }));
}

export const stops = (queue: Queue, project: string, id: string) => eventsFor(queue, RUN_STOP_EVENT, project, id);

/** Stop one linked run's engine gracefully, recording `engagement-run-stop` (a failure equal to the newest one for
 * this run and reason not repeated). A run with no engine yet is not stopped (nothing recorded). */
async function stopRun(queue: Queue, deps: ApproveDeps, t: Target, project: string, run: QueueRun, reason: string, storyKey?: string): Promise<boolean> {
  if (!run.engine_run_id) return false;
  const r = deps.launchStop ? await deps.launchStop(engineRoot(run), run.engine_run_id) : { ok: false, detail: "no graceful stop wired" };
  const detail = {
    engagement: t.engagement, project, run_id: run.run_id, engine_run_id: run.engine_run_id, reason,
    ...(storyKey ? { story_key: storyKey } : {}), ok: r.ok, detail: clip(r.detail),
  };
  const last = stops(queue, project, t.engagement).findLast((e) => e.detail?.run_id === run.run_id && e.detail?.reason === reason);
  if (!(r.ok === false && last?.detail?.ok === false && last.detail?.detail === detail.detail)) queue.serviceEvent(RUN_STOP_EVENT, detail, nowIso(deps));
  return r.ok;
}

/** A linked run still `queued` (unclaimed, no engine) cancelled before it launches (`deps.cancelQueued`, production:
 * `cli.ts` `cancelRun`; default: the queue's `cancelled` end from `queued`), recorded as `engagement-run-stop` with
 * `engine_run_id: null`. Answers whether it was cancelled. */
async function cancelQueued(queue: Queue, deps: ApproveDeps, t: Target, project: string, run: QueueRun, reason: string): Promise<boolean> {
  let ok = true, detail = "queued run cancelled before launch";
  try {
    if (deps.cancelQueued) await deps.cancelQueued(run.run_id);
    else queue.end(run.run_id, "cancelled", `cancelled: engagement ${t.engagement} ${reason === "cap" ? "reached its cap" : reason === "revise" ? "revised" : "cancelled"}`, { from: "queued" });
  } catch (e) { ok = false; detail = `cancel failed: ${clip(message(e))}`; }
  if (!ok) {
    if (queue.get(run.run_id)?.state !== "queued") return false; // claimed or ended meanwhile: the next pass sees it
    const last = stops(queue, project, t.engagement).findLast((e) => e.detail?.run_id === run.run_id && e.detail?.reason === reason);
    if (last?.detail?.ok === false && last.detail?.detail === detail) return false; // told once
  }
  queue.serviceEvent(RUN_STOP_EVENT, { engagement: t.engagement, project, run_id: run.run_id, engine_run_id: null, reason, ok, detail }, nowIso(deps));
  return ok;
}

/** The story a live run landed: `storyLanded` on its pause, else its newest `close-out` (the paused-run pass closed
 * the landed story out and relaunched the epic). */
export function landedStory(queue: Queue, run: QueueRun): string | undefined {
  const events = queue.events(run.run_id);
  const landed = storyLanded(run, events);
  if (landed) return landed;
  const closed = events.findLast((e) => e.kind === "close-out")?.detail?.story_key;
  return typeof closed === "string" && closed ? closed : undefined;
}

/** `track.py block --engagement --kind <kind> --reason <reason>` on the host (as `questions.ts`): the parsed result,
 * or null on a transient failure. */
async function trackBlock(deps: ApproveDeps, root: string, id: string, kind: "cap" | "ask", reason: string): Promise<Record<string, any> | null> {
  let r: RunResult;
  try { r = await uvRunner(deps)(root, studioScript(deps, "lib", "track.py"), ["block", "--directory", root, "--engagement", id, "--kind", kind, "--reason", reason], 120); }
  catch { return null; }
  const out = lastJsonObject(r.stdout) as Record<string, any> | null;
  if (!out || typeof out.status !== "string" || out.retry === true) return null;
  return out;
}

/** A `cap` or `ask` block owed since `since` (the newest `cap` or `run-paused` line): no `engagement-issue` event of
 * that kind (blocked, or a block's named refusal) at or after it. */
export const blockOwed = (queue: Queue, project: string, id: string, kind: string, since: string) =>
  !eventsFor(queue, "engagement-issue", project, id).some((e) => blockKind(e) === kind && (e.detail?.action === "blocked" || e.detail?.action === "refused") && e.at >= since);

async function blockIssue(queue: Queue, deps: ApproveDeps, t: Target, project: string, kind: "cap" | "ask", reason: string): Promise<boolean> {
  const at = nowIso(deps);
  const r = await trackBlock(deps, t.root, t.engagement, kind, reason);
  if (!r) return false;
  if (r.ok !== true) {
    if (r.status !== "blocked") return false;
    queue.serviceEvent("engagement-issue", { engagement: t.engagement, project, action: "refused", kind, step: "block", reason: typeof r.reason === "string" && r.reason ? r.reason : "track refused" }, at);
    return false;
  }
  const issue = Array.isArray(r.issues) && typeof r.issues[0]?.issue === "string" ? r.issues[0].issue : null;
  queue.serviceEvent("engagement-issue", { engagement: t.engagement, project, issue, action: "blocked", kind }, at);
  return true;
}

const usd = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `$${Math.round(v * 100) / 100}` : "unknown");

/** The cap's figures: `runs_usd`, `cap`, `band85.usd`, `band95.usd`. */
function capReason(record: Engagement): string {
  const q = isObject(record.quote) ? record.quote : {};
  const b85 = isObject(q.band85) ? q.band85.usd : undefined, b95 = isObject(q.band95) ? q.band95.usd : undefined;
  return `reached its cap: runs_usd ${usd(record.spend?.runs_usd)} of cap ${usd(q.cap)}\n`
    + `runs_usd: ${record.spend?.runs_usd ?? 0}\ncap: ${q.cap ?? null}\nband85.usd: ${b85 ?? null}\nband95.usd: ${b95 ?? null}`;
}

export async function defaultNotify(deps: ApproveDeps, notice: EndNotice): Promise<Record<string, unknown>> {
  try {
    const selected = notifier(deps.env ?? process.env);
    if (selected.kind === "none") return { ok: false, skipped: "no notifier configured (TK_SUPERVISOR_NOTIFY is unset)" };
    return await sendNotice(selected, notice);
  } catch (e) { return { ok: false, error: clip(message(e)) }; }
}

/** The owner's `continue` (the 32.3 comment-reader rule): the first owner comment after the newest agent comment on
 * the engagement's inbox item with a line `continue`, that no `engagement-continue` event names yet. */
function continueComment(queue: Queue, t: Target, project: string): string | undefined {
  const item = readInbox(t.root).items.find((i) => i.engagement === t.engagement && typeof i.issue === "string");
  if (!item) return undefined;
  const comments = readComments(t.root, item.issue as string) ?? [];
  const newestAgent = comments.findLastIndex((c) => c.author !== "owner");
  const used = new Set(eventsFor(queue, CONTINUE_EVENT, project, t.engagement).map((e) => String(e.detail?.comment)));
  return comments.slice(newestAgent + 1)
    .find((c) => c.author === "owner" && !used.has(c.id) && c.body.split(/\r?\n/).some((l) => /^\s*continue\s*$/i.test(l)))?.id;
}

/** The base the engagement's runs cut from: the newest `approve` line's `base_ref`, else none (the default branch). */
const baseRefOf = (record: Engagement): string | undefined => {
  const b = approveLine(record)?.payload?.base_ref;
  return typeof b === "string" && b.trim() ? b.trim() : undefined;
};

async function runStep(queue: Queue, deps: ApproveDeps, t: Target, out: EngagementRunResult): Promise<void> {
  const first = readEngagement(t.root, t.engagement);
  if (!first) return;
  let record: Engagement = first;
  const project = record.project, id = t.engagement;
  const since = approveLine(record)?.at;
  const links = linksOf(queue, project, id, since);
  // every cycle's links: the cap's notice run and step 4's stops cover a run linked under an earlier approval still
  // live after revise + re-approval (follow-up review F1)
  const allLinks = linksOf(queue, project, id);
  if (!allLinks.length) return;
  const runOf = (l: Link) => queue.get(l.run_id);
  const live = () => links.map(runOf).filter((r): r is QueueRun => !!r && !isTerminal(r.state));
  const liveAll = () => allLinks.map(runOf).filter((r): r is QueueRun => !!r && !isTerminal(r.state));
  const reread = () => { record = readEngagement(t.root, id) ?? record; };
  // 1. the first run's `launched`: approved → in-progress, once per approval
  if (record.state === "approved") {
    const launched = links.map(runOf).find((r) => r && queue.events(r.run_id).some((e) => e.kind === "launched"));
    const once = (f: Engagement) => f.inputs.some((l) => l.verb === "launched" && (since === undefined || l.at >= since));
    if (launched && applyRow(queue, deps, t, "launched", { run_id: launched.run_id, engine_run_id: launched.engine_run_id }, once)) out.launched.push(id);
  }
  reread();
  // 2. the cap: in-progress at or past the quote's cap → partial, one notice
  const cap = isObject(record.quote) ? num(record.quote.cap) : undefined;
  const runsUsd = num(record.spend?.runs_usd) ?? 0;
  if (record.state === "in-progress" && cap !== undefined && runsUsd >= cap) {
    const run = liveAll().at(-1);
    if (applyRow(queue, deps, t, "cap", { runs_usd: runsUsd, cap, ...(run ? { run_id: run.run_id } : {}) })) {
      const notice: EndNotice = {
        run_id: run?.run_id ?? "", job_id: run?.job_id ?? allLinks.at(-1)!.job, project_id: run?.project_id ?? project, studio_run_id: run?.studio_run_id ?? null,
        state: "partial", reason: `engagement ${id} ${capReason(record).split("\n")[0]}: reply go {cap} or cancel`,
      };
      const notify = await (deps.notify ?? ((n: EndNotice) => defaultNotify(deps, n)))(notice).catch((e) => ({ ok: false, error: clip(message(e)) }));
      queue.serviceEvent(CAP_EVENT, { engagement: id, project, run_id: run?.run_id ?? null, runs_usd: runsUsd, cap, notify }, nowIso(deps));
      out.capped.push(id);
    }
  }
  reread();
  // 3. autonomy steady | ask: the live run stopped once a story landed; ask pauses. An ok ask stop of this cycle's
  // runs with no `run-paused` line after it (the stop recorded, the pause not applied): the pause applied now, once
  // (review P7)
  const linked = new Set(links.map((l) => l.run_id));
  if (record.state === "in-progress" && record.autonomy === "ask") {
    const askStop = stops(queue, project, id).filter((e) => e.detail?.reason === "ask" && e.detail?.ok === true && linked.has(String(e.detail?.run_id))).at(-1);
    const pausedAfter = (f: Engagement) => !!askStop && f.inputs.some((l) => l.verb === "run-paused" && l.at >= askStop.at);
    if (askStop && !pausedAfter(record)) {
      const story = typeof askStop.detail?.story_key === "string" ? askStop.detail.story_key : undefined;
      if (applyRow(queue, deps, t, "run-paused", { run_id: askStop.detail?.run_id, ...(story ? { story_key: story } : {}) }, pausedAfter)) out.paused.push(id);
      reread();
    }
  }
  if (record.state === "in-progress" && (record.autonomy === "steady" || record.autonomy === "ask")) {
    for (const run of live()) {
      const story = landedStory(queue, run);
      if (!story) continue;
      if (stops(queue, project, id).some((e) => e.detail?.run_id === run.run_id && e.detail?.story_key === story && e.detail?.ok === true)) continue;
      if (!(await stopRun(queue, deps, t, project, run, record.autonomy, story))) continue;
      out.stopped.push(run.run_id);
      if (record.autonomy === "ask" && applyRow(queue, deps, t, "run-paused", { run_id: run.run_id, story_key: story })) out.paused.push(id);
      reread();
    }
  }
  reread();
  // 4. partial (the cap), cancelled, or (Story 32.8) scoping after a mid-run revise: every live linked engine stopped
  // gracefully, once per engine (it finishes its current story); a linked run still queued (unclaimed, no engine yet)
  // cancelled through the queue's cancel path so it never launches; any approve cycle's (follow-up review F1); a
  // revise stop is never resubmitted (step 7 runs only in-progress; a re-approval starts a new cycle)
  if (record.state === "partial" || record.state === "cancelled" || record.state === "scoping") {
    const reason = record.state === "partial" ? "cap" : record.state === "cancelled" ? "cancel" : "revise";
    for (const run of liveAll()) {
      if (run.state === "queued" && !run.engine_run_id) {
        if (await cancelQueued(queue, deps, t, project, run, reason)) out.stopped.push(run.run_id);
        continue;
      }
      if (stops(queue, project, id).some((e) => e.detail?.run_id === run.run_id && e.detail?.engine_run_id === run.engine_run_id
        && e.detail?.ok === true && (e.detail?.reason === reason || e.detail?.reason === "cap"))) continue;
      if (await stopRun(queue, deps, t, project, run, reason)) out.stopped.push(run.run_id);
    }
  }
  // 5. the blocks owed: cap (partial) and ask (paused), Jira-bound projects only
  if (jiraBound(t.root)) {
    const capLine = record.inputs.findLast((l) => l.verb === "cap");
    if (record.state === "partial" && capLine && blockOwed(queue, project, id, "cap", capLine.at)) await blockIssue(queue, deps, t, project, "cap", capReason(record));
    const pauseLine = record.inputs.findLast((l) => l.verb === "run-paused");
    if (record.state === "paused" && pauseLine && blockOwed(queue, project, id, "ask", pauseLine.at)) {
      const story = typeof pauseLine.detail?.story_key === "string" ? pauseLine.detail.story_key : "a story";
      await blockIssue(queue, deps, t, project, "ask", `landed story ${story} (spend so far: runs_usd ${usd(record.spend?.runs_usd)}, planning_usd ${usd(record.spend?.planning_usd)})\nthe next story waits for the owner's continue`);
    }
  }
  // 6. ask: the owner's `continue` → in-progress
  if (record.state === "paused" && record.autonomy === "ask") {
    const comment = continueComment(queue, t, project);
    if (comment && applyRow(queue, deps, t, "run-resumed", { comment })) {
      queue.serviceEvent(CONTINUE_EVENT, { engagement: id, project, comment }, nowIso(deps));
      out.resumed.push(id);
    }
  }
  reread();
  // 7. the resubmit: in-progress, the newest linked run stopped by this pass and ended, not resubmitted yet; never
  // at or past the cap (an ask `continue` over the cap: the next pass's cap step makes it partial)
  if (record.state !== "in-progress" || !links.length) return; // no run of this cycle: nothing to resubmit (F1)
  const capNow = isObject(record.quote) ? num(record.quote.cap) : undefined;
  if (capNow !== undefined && (num(record.spend?.runs_usd) ?? 0) >= capNow) return;
  const last = links.at(-1)!;
  const prev = runOf(last);
  if (!prev || !isTerminal(prev.state)) return;
  if (links.some((l) => l.after_run === prev.run_id)) return;
  const prevStops = stops(queue, project, id).filter((e) => e.detail?.run_id === prev.run_id && e.detail?.ok === true);
  if (!prevStops.length) return; // ended on its own (the epic done, or failed): 32.8's run end
  // an ask stop resumes only through the owner's `continue`: no `run-resumed` line after it, no resubmit (review P7)
  const askStop = prevStops.filter((e) => e.detail?.reason === "ask").at(-1);
  if (askStop && !record.inputs.some((l) => l.verb === "run-resumed" && l.at >= askStop.at)) return;
  // a steady stop gates on its story PR's merge, whichever stop (a later cap) is newest (review P8)
  if (prevStops.some((e) => e.detail?.reason === "steady")) {
    const pr = runPr(queue.events(prev.run_id));
    if (!pr) return;
    let r: RunResult;
    try { r = await gh(deps, t.root, ["pr", "view", pr, "--json", "state,mergedAt"]); } catch { return; }
    const view = r.exit === 0 ? lastJsonObject(r.stdout) as Record<string, unknown> | null : null;
    if (typeof view?.state !== "string" || view.state.toUpperCase() !== "MERGED") return; // OPEN, CLOSED or gh failed
  }
  if (!deps.submit) return;
  const baseRef = baseRefOf(record);
  let queued: { run_id: string };
  try { queued = await deps.submit(last.job, t.root, { ...(baseRef ? { baseRef } : {}), payload: { engagement: id, project } }); }
  catch { return; } // the next pass asks again
  if (linksOf(queue, project, id, since).some((l) => l.after_run === prev.run_id)) return; // another process resubmitted meanwhile
  queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: id, project, run_id: queued.run_id, job: last.job, after_run: prev.run_id }, nowIso(deps));
  out.resubmitted.push(id);
}

/** The engagement-run pass (see the header). `only`: one engagement (the input route's). Never throws. */
export async function engagementRunPass(queue: Queue, deps: ApproveDeps = {}, only?: Target): Promise<EngagementRunResult> {
  const out: EngagementRunResult = { launched: [], capped: [], stopped: [], paused: [], resumed: [], resubmitted: [] };
  try {
    for (const t of targetsOf(queue, only)) {
      await serialised(t.root, async () => {
        try { await runStep(queue, deps, t, out); } catch { /* this engagement on the next pass */ }
      });
    }
  } catch { /* the next pass */ }
  return out;
}

// ------------------------------------------------------------ the spend (spend.runs_usd)

export interface RunSpendDeps {
  /** The host ledger file (`ledgerPath`). */
  ledgerFile: string;
  /** Tests: called between the pass's first read of a record and its fresh re-read before the write. */
  beforeWrite?: (root: string, engagement: string) => void;
}

/** `spend.runs_usd` (see the header): `chatSpendPass`'s mapping over the `engagement-run-queued` events. Never
 * throws. */
export function engagementRunSpendPass(queue: Queue, deps: RunSpendDeps): { updated: string[] } {
  const out = { updated: [] as string[] };
  try {
    const events = queue.serviceEvents(RUN_QUEUED_EVENT);
    if (!events.length) return out;
    let text = "";
    try { text = readFileSync(deps.ledgerFile, "utf-8"); } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return out; // a transient read error never writes 0
    }
    const costs = jobRunCosts(text);
    const groups = new Map<string, { root: string; engagement: string; runs: Set<string> }>();
    for (const ev of events) {
      const d = ev.detail ?? {};
      const runId = typeof d.run_id === "string" ? d.run_id : null;
      const engagement = typeof d.engagement === "string" ? d.engagement : null;
      const root = runId ? queue.get(runId)?.root : undefined;
      if (!runId || !engagement || !root) continue;
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
        if (spend.runs_usd === sum) continue;
        deps.beforeWrite?.(g.root, g.engagement);
        const fresh = readEngagement(g.root, g.engagement);
        if (!fresh) continue;
        const freshSpend = isObject(fresh.spend) ? fresh.spend : { planning_usd: 0, runs_usd: 0 };
        if (freshSpend.runs_usd === sum) continue;
        writeEngagement(g.root, { ...fresh, spend: { ...freshSpend, runs_usd: sum } });
        out.updated.push(g.engagement);
      } catch { /* this engagement on the next pass */ }
    }
  } catch { /* the next pass */ }
  return out;
}
