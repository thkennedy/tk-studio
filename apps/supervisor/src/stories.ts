/**
 * The story (Story 39.4, contract 0.1.35 additive): one plan story read whole, and the owner's one status transition.
 * No HTTP here (`api.ts` serves both routes, and is the only importer of this module); files, the queue and the plan
 * verb only. The cached parts (the plan, the specs' Stage Log tables, the buffers, `stage-posts.json`, the band, the
 * findings) are `board.ts`'s, so a story page and a board card read one figure.
 *
 *   GET  /stories/{id}?project=<id>
 *        {ok, project, built_at, story {id, key, title, status, parent, epic {id, number, title} | null, band, jira_key,
 *        jira_url, updated}, plan_text, stage_log {specs, rows, total}, runs [{run_id, studio_run_id, job_id, state, pr,
 *        host_verify, created, ended_at, cost_usd}], pr, findings [{id, title, severity}], needs_you {run_ids, inbox} | null}
 *        — the entity found by its frontmatter `id` in the plan store (never only the board's epics: an orphan story is
 *        read too); `plan_text` the entity's body after the frontmatter (CRLF to LF, BOM dropped), never rendered;
 *        `jira_url` `https://<planning.jira.site>/browse/<KEY>` from the project's `.tk-studio/config.yaml`; `runs` every
 *        run of the project naming the story by the board's rule, in queue creation order, each costed by `runCost`
 *        (the figure `GET /runs/{id}` answers); `pr` the latest named run's. No machine path: `specs` are root-relative
 *        POSIX. 400 BadStory (not `ST-\d{3,}`) | ProjectRequired, 404 UnknownProject | UnknownStory {project, story}.
 *   POST /stories/{id}/status?project=<id>  {status}
 *        the owner's one transition, `draft → ready`, under a per-`(project, id)` chain: the status re-read, the
 *        transition (anything else 409 StoryStatusNotOwnerWritable {from, to, column, owner}), the lease (a live plan
 *        lease on the story 409 StoryLeaseHeld {run_id, phase, holder {pid, host}, since}) — neither refusal calls or
 *        records anything — then `plansync.py status --status ready` on the host (`callStatus`, argv only), one
 *        `plan-status` service event `{phase: "ready", project, story_key, id, owner, directory, actor: "owner", source,
 *        ok, …the verb's result}`, and the entity re-read (D9: the supervisor never edits a plan file). 200 {ok, project,
 *        story, previous_status, sync: ok|partial|blocked, reason?}; 409 StoryStatusRefused {status, reason} (the
 *        re-read is not `ready`); 500 StoryStatusFailed {detail} (the runner threw, or no JSON).
 *
 * A story `N.M` is held (`storyLeaseHolder`) when a run of the project has a live plan lease that is the per-story
 * `in-progress:<k>` or `draft:<k>` with `storyNumber(k) === N.M`, or the run-wide `review`, `done` or `stage` on a run
 * whose board facts name `N.M` strongly. The owner's own call takes no lease (it has no run); the chain serialises the
 * owner's presses, and the window against a loop pass is the verb's own run (a draft story is not one the loop writes).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  cachedFile, ledgerPath, needsYouRunIds, openInboxItem, readFindings, readPlan, runFacts, stageLogOf, storyBand, storyFiles,
  specIndex, storyRunFacts, type Band, type BoardDeps, type BoardFinding, type HostVerifyOutcome, type PlanStory, type RunFacts,
  type Stamp, type StageLog, type StoryFiles,
} from "./board";
import { frontmatter } from "./closeout";
import { registryRoot, runCost } from "./inbox";
import { readInbox } from "./office";
import { callStatus, storyNumber, type StatusResult } from "./planstatus";
import { selfOwner, type Owner, type Queue } from "./queue";

export const STORY_ID_RE = /^ST-\d{3,}$/;
/** `interchange.py` `STATUS_VALUES`, in enum order. */
export const CANONICAL_STATUSES = ["draft", "ready", "in-progress", "blocked", "review", "done", "dropped"] as const;

/** Who writes each column (Settled shape 7; mirrored in the web's `board/model.ts`, never imported across apps). */
export const COLUMN_OWNERS: Readonly<Record<string, string>> = {
  draft: "draft is written by the loop's draft pass (a run that ended without a PR gives its story back, Story 38.2) and plansync normalize",
  ready: "ready is written by the owner, from draft only",
  "in-progress": "in-progress is written by the loop's launched pass when a run starts the story (Story 36.6)",
  blocked: "blocked is written by the Jira pull-back when the story waits on a decision (AD-22)",
  review: "review is written by the loop's review pass when the run's PR opens (Story 27.5)",
  done: "done is written by the loop's merge pass when the PR merges (Story 27.5)",
  dropped: "dropped is written by the Jira pull-back (a DNI issue) or a plan change",
};

export interface StoryView {
  id: string; key: string | null; title: string; status: string; parent: string | null;
  epic: { id: string; number: string | null; title: string } | null; band: Band | null;
  jira_key: string | null; jira_url: string | null; updated: string | null;
}
export interface StoryRun {
  run_id: string; studio_run_id: string | null; job_id: string; state: string; pr: string | null;
  host_verify: HostVerifyOutcome | null; created: string; ended_at: string | null; cost_usd: number | null;
}
export interface StoryAnswer {
  ok: true; project: string; built_at: string; story: StoryView; plan_text: string; stage_log: StageLog; runs: StoryRun[];
  pr: string | null; findings: BoardFinding[]; needs_you: { run_ids: string[]; inbox: Record<string, unknown> | null } | null;
}

/** A route's answer: its HTTP status and body. */
export interface Answer { status: number; body: Record<string, unknown> }

export interface StoryDeps extends BoardDeps {
  /** The verb (default `callStatus(root, id, "ready", note, {env})`: `uv run <plugin>/lib/plansync.py status …`). */
  verb?: (root: string, id: string, note: string) => Promise<StatusResult>;
  /** This process, as the lease reader sees it (default `selfOwner()`). */
  self?: Owner;
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { ok: false, error, ...extra } });

// ------------------------------------------------------------ the read

const bodyCache = new Map<string, Stamp & { value: string }>();
/** The entity's body after its frontmatter: CRLF to LF, the BOM dropped. */
function planBody(text: string): string {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return lines.join("\n");
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end < 0 ? lines.join("\n") : lines.slice(end + 1).join("\n").replace(/^\n+/, "");
}

/** `https://<site>/browse/<KEY>`: null without a site or a key; a site carrying a scheme is kept. */
export function jiraUrl(site: unknown, key: string | null): string | null {
  if (typeof site !== "string" || !site.trim() || !key) return null;
  const base = site.trim().replace(/\/+$/, "");
  return `${/^https?:\/\//i.test(base) ? base : `https://${base}`}/browse/${encodeURIComponent(key)}`;
}

const configCache = new Map<string, Stamp & { value: Record<string, unknown> }>();
/** `<root>/.tk-studio/config.yaml` parsed as `server.ts` `readProjectConfig` does (`{}` when missing or unparseable),
 * cached on its file stamp like the board's reads. */
function projectConfig(root: string): Record<string, unknown> {
  const parse = (text: string): Record<string, unknown> => {
    try { return (loadYaml(text) as Record<string, unknown>) ?? {}; } catch { return {}; }
  };
  return cachedFile(configCache, join(root, ".tk-studio", "config.yaml"), parse, {});
}

function jiraSite(root: string): unknown {
  const planning = projectConfig(root)?.planning;
  const jira = planning && typeof planning === "object" ? (planning as Record<string, unknown>).jira : undefined;
  return jira && typeof jira === "object" ? (jira as Record<string, unknown>).site : undefined;
}

/** The plan entity's status read now from its file (the POST's re-reads: never a cached view). */
function freshStatus(story: PlanStory): string {
  try {
    const s = frontmatter(readFileSync(story.file, "utf-8")).status;
    return typeof s === "string" && s.trim() ? s.trim() : "draft";
  } catch { return story.status; }
}

/** The project's root and the plan story `id`, or the refusal (`UnknownProject`, `UnknownStory`). */
async function locate(project: string, id: string, deps: StoryDeps): Promise<{ root: string; story: PlanStory } | Answer> {
  const served = await registryRoot(project, deps.registry);
  if (!served) return fail(404, "UnknownProject", { project });
  const story = served.root ? readPlan(served.root).stories.find((s) => s.id === id) : undefined;
  if (!served.root || !story) return fail(404, "UnknownStory", { project, story: id, detail: `no story ${id} in project ${project}` });
  return { root: served.root, story };
}

/** The story view; `files` is the story's files from one `specIndex(root)` (Settled shape 3: one readdir per folder). */
function storyView(root: string, story: PlanStory, files: StoryFiles | null, status: string = story.status): StoryView {
  const ep = story.parent ? readPlan(root).epics.find((e) => e.id === story.parent) : undefined;
  return {
    id: story.id, key: story.key, title: story.title, status, parent: story.parent,
    epic: ep ? { id: ep.id, number: ep.number, title: ep.title } : null,
    band: files ? storyBand(files) : null,
    jira_key: story.jira_key, jira_url: jiraUrl(jiraSite(root), story.jira_key), updated: story.updated,
  };
}

/** `GET /stories/{id}?project=<id>` (see the header). Throws only what the registry read throws. */
export async function storyFor(project: string, id: string, deps: StoryDeps): Promise<Answer> {
  if (!STORY_ID_RE.test(id)) return fail(400, "BadStory", { story: id });
  const found = await locate(project, id, deps);
  if ("status" in found) return found;
  const { root, story } = found;
  const now = (deps.now ?? Date.now)();
  const env = deps.env ?? process.env;
  const files = story.key ? storyFiles(root, story.key, specIndex(root)) : null;
  const stage_log: StageLog = story.key && files
    ? stageLogOf(root, story.key, files)
    : { specs: [], rows: [], total: { rows: 0, priced: 0, tokens_in: null, tokens_out: null, cost_usd: null, seconds: 0 } };
  const facts = runFacts(deps, project);
  const named: RunFacts[] = story.key ? storyRunFacts(facts, story.key) : [];
  const ledger = ledgerPath(env, deps.ledger);
  const runs: StoryRun[] = named.map((f) => ({
    run_id: f.run.run_id, studio_run_id: f.run.studio_run_id, job_id: f.run.job_id, state: f.run.state, pr: f.pr,
    host_verify: f.host, created: f.run.created, ended_at: f.endedAt,
    cost_usd: f.run.studio_run_id ? runCost(ledger, f.run.studio_run_id) : null,
  }));
  const waiting = needsYouRunIds(facts, now);
  const run_ids = named.filter((f) => waiting.has(f.run.run_id)).map((f) => f.run.run_id);
  const inbox = openInboxItem(readInbox(root).items, story.id, story.jira_key);
  const answer: StoryAnswer = {
    ok: true, project, built_at: new Date(now).toISOString(),
    story: storyView(root, story, files),
    plan_text: cachedFile(bodyCache, story.file, planBody, ""),
    stage_log,
    runs,
    pr: named.length ? named[named.length - 1]!.pr : null,
    findings: story.key ? readFindings(root).filter((x) => x.story === story.key).map(({ id: fid, title, severity }) => ({ id: fid, title, severity })) : [],
    needs_you: run_ids.length || inbox ? { run_ids, inbox } : null,
  };
  return { status: 200, body: answer as unknown as Record<string, unknown> };
}

// ------------------------------------------------------------ the lease

const PER_STORY = /^(in-progress|draft):(.+)$/;
const RUN_WIDE = new Set(["review", "done", "stage"]);

/** The live plan lease holding story `N.M` in `project` (see the header), else null. A read: nothing is written. */
export function storyLeaseHolder(queue: Queue, facts: readonly RunFacts[], story: string, self: Owner = selfOwner()):
  { run_id: string; phase: string; holder: { pid: number; host: string }; since: string } | null {
  for (const f of facts) {
    const phases = new Set<string>();
    for (const e of f.events) if (e.kind === "plan-lease" && typeof e.detail?.phase === "string") phases.add(e.detail.phase);
    for (const phase of phases) {
      const per = PER_STORY.exec(phase);
      const names = per ? storyNumber(per[2]!) === story : RUN_WIDE.has(phase) && f.stories.has(story);
      if (!names) continue;
      const held = queue.planLeaseHolder(f.run.run_id, phase, self);
      if (held) return { run_id: f.run.run_id, phase, holder: { pid: held.owner.pid, host: held.owner.host }, since: held.at };
    }
  }
  return null;
}

// ------------------------------------------------------------ the transition

/** The owner's transition: null for `draft → ready`, else the column that owns it and its owner (Settled shape 4,
 * contract 0.1.35): `column` is `to` unless `to` is `ready`, then the raw `from`; `owner` is `COLUMN_OWNERS[column]`,
 * the draft writer's for a non-canonical `from` (it sits in Draft). */
export function ownerTransition(from: string, to: string): { column: string; owner: string } | null {
  if (from === "draft" && to === "ready") return null;
  const column = to !== "ready" ? to : from;
  return { column, owner: COLUMN_OWNERS[column] ?? COLUMN_OWNERS.draft! };
}

/** The status body: exactly `{status}`, a canonical status. */
export function checkStatusBody(body: unknown): { ok: true; status: string } | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, detail: "the body must be a JSON object" };
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== "status") return { ok: false, detail: `unknown field '${k}' (allowed: status)` };
  if (typeof b.status !== "string" || !(CANONICAL_STATUSES as readonly string[]).includes(b.status)) {
    return { ok: false, detail: `field 'status' must be one of ${CANONICAL_STATUSES.join(", ")}` };
  }
  return { ok: true, status: b.status };
}

/** In-flight owner presses per `(project, id)` (`inbox.ts` `replyChains`' precedent): a second press waits for the
 * first to settle, then re-reads, so two presses never both call the verb. */
const statusChains = new Map<string, Promise<unknown>>();

/** `POST /stories/{id}/status?project=<id>` with a checked `to` (see the header). Never throws past the registry read. */
export async function setStoryStatus(project: string, id: string, to: string, via: "cookie" | "bearer", deps: StoryDeps): Promise<Answer> {
  if (!STORY_ID_RE.test(id)) return fail(400, "BadStory", { story: id });
  const slot = JSON.stringify([project, id]);
  const run = () => setStoryStatusNow(project, id, to, via, deps);
  const mine = (statusChains.get(slot) ?? Promise.resolve()).then(run, run);
  const tail = mine.catch(() => undefined);
  statusChains.set(slot, tail);
  try { return await mine; } finally { if (statusChains.get(slot) === tail) statusChains.delete(slot); }
}

async function setStoryStatusNow(project: string, id: string, to: string, via: "cookie" | "bearer", deps: StoryDeps): Promise<Answer> {
  const found = await locate(project, id, deps);
  if ("status" in found) return found;
  const { root, story } = found;
  // 1. the status, re-read now
  const from = freshStatus(story);
  // 2. the transition
  const refused = ownerTransition(from, to);
  if (refused) return fail(409, "StoryStatusNotOwnerWritable", { project, story: id, from, to, ...refused });
  // 3. the lease
  const key = story.key;
  if (key) {
    const held = storyLeaseHolder(deps.queue, runFacts(deps, project), key, deps.self ?? selfOwner());
    if (held) return fail(409, "StoryLeaseHeld", { project, story: id, ...held });
  }
  // 4. the verb
  const note = `the owner moved ${id} draft → ready (${via})`;
  const verb = deps.verb ?? ((r: string, i: string, n: string) => callStatus(r, i, "ready", n, { env: deps.env }));
  let res: StatusResult;
  try { res = await verb(root, id, note); }
  catch (e) { res = { ok: false, error: `plansync.py status: ${e instanceof Error ? e.message : String(e)}`, transient: true }; }
  // 5. the service event (once per call, a refused or transient one too)
  const { transient: _t, ...shown } = res;
  try {
    deps.queue.serviceEvent("plan-status", {
      phase: "ready", project, story_key: key, id, owner: project, directory: root, actor: "owner", source: via, ...shown,
    });
  } catch { /* a busy queue: the answer still says what the verb did */ }
  if (res.transient) return fail(500, "StoryStatusFailed", { project, story: id, detail: res.error ?? "plansync.py status failed" });
  // 6. the entity re-read
  const now = freshStatus(story);
  const reread = readPlan(root).stories.find((s) => s.id === id) ?? story;
  if (now !== "ready") {
    return fail(409, "StoryStatusRefused", { project, story: id, status: now, reason: res.reason ?? res.error ?? "the status did not land" });
  }
  const sync = res.status === "partial" ? "partial" : res.blocked ? "blocked" : "ok";
  return {
    status: 200,
    body: {
      ok: true, project, story: storyView(root, reread, reread.key ? storyFiles(root, reread.key, specIndex(root)) : null, now),
      previous_status: res.previous_status ?? from, sync,
      ...(sync === "blocked" && res.reason ? { reason: res.reason } : {}),
    },
  };
}

