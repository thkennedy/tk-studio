/**
 * Delivery: the closeout pass (Story 32.8, user flow F2 steps 7 to 9, B5 items 7 to 9, contract 0.1.27 additive). No
 * HTTP here; `cli.ts` runs the pass after the engagement-run pass at every `finally` site (`approveQuietly`: `recover`,
 * `drain`, `run`), as the resolution pass runs. A run end is seen there, never after an input.
 *
 *   the last run   a record in `in-progress` or `partial`; its newest linked run over every approve cycle (`linksOf`
 *                  without `since`), terminal (`complete | partial | blocked | cancelled`), with no `after_run`
 *                  resubmit naming it, in `in-progress` no ok stop (a `steady` or `ask` stop owes the run pass's
 *                  resubmit or its pause, any other stop step 7's resubmit; the run pass does both only in
 *                  `in-progress`; a `steady` stop on a run with no PR, or with a PR `gh pr view --json state` names
 *                  `CLOSED` (unmerged: step 7 resubmits only a `MERGED` one), awaits no merge and holds nothing back;
 *                  `OPEN`, `MERGED` or gh failing still holds back), and in `partial` no `cap` block owed
 *                  (Jira-bound). Once per last run: an `engagement-closeout` event naming its `run_id` means done (re-
 *                  read right before each notice, another process's pass told already); a later `go {cap}` from
 *                  `partial` gives a new last run, so a new closeout replaces the file and the page.
 *   the input      `{run_id, outcome_hint, runs: [{run_id, job, state, studio_run_id, cost_usd, pr}], stories: [{key,
 *                  run_id, spec_status, pr, pr_state}], epics: [{job, queued}], side_exits: [{at, to, verb, reason}],
 *                  spend {planning_usd, runs_usd}, quote}`: `cost_usd` the ledger's `job-run` `total_cost_usd` of the
 *                  run's `studio_run_id` (`jobRunCosts`, null unmetered: no line, or a cost not positive); `stories`
 *                  the landed keys (`landedStory` and every `close-out` event per linked run), `spec_status` the spec
 *                  frontmatter `status` from `findSpec(servedRoot(run) ?? root, key)` (Story 28.5: `<worktree>/<prefix>`), else (the
 *                  worktree is removed at close-out before this pass, DW-46) read-only from git objects in the served
 *                  root: `git show <ref>:./<spec>` at `origin/<run branch>`, then the local `<run branch>`, the path found by `git
 *                  ls-tree` with `findSpec`'s naming (never a fetch, pull, checkout or reset of the served root),
 *                  `pr` the story's pause PR else the run's, `pr_state` from
 *                  `gh pr view --json state` (null when gh fails); `epics` the jobs the newest ok `engagement-approve`
 *                  `job` step declared against the ones queued; `side_exits` the record's `inputs[]` lines whose `to` is
 *                  `paused`, `partial`, `failed` or `cancelled`, with `detail.reason`, a payload `reason` or the verb.
 *                  Written to a temp file and run as `engage.py closeout --directory <served root> --engagement <id>
 *                  --input-file <path>` on the host (`uv`, timeout 300): the report, its page, the record's
 *                  `closeout`.
 *   the state      `applyEvent(run-ended)` with `detail {outcome, run_id, closeout: <path>}` in a fresh read (source
 *                  `supervisor`): every deliverable done `delivered`; else the last run `blocked` `failed`; else
 *                  `partial` (32.1's rows from `in-progress` and from `partial`; no row changes).
 *   the issue      Jira-bound: `track.py close --engagement` (`Block Resolved` → `Done`, an open cap or ask block
 *                  closed with it): `engagement-issue {…, action: "closed", step: "closeout"}`, or a named refusal
 *                  `{…, action: "refused", step: "close", reason}`; a transient failure is retried at the next pass
 *                  (the row already applied, the report not rewritten), only while the record still sits in that
 *                  outcome's state (a `go {cap}` from `partial` or a `revise` since: no close, no notice, no event).
 *   the notice     one notifier line `engagement ENG-NNN <outcome>: <page url | closeout.md path>`, then
 *                  `engagement-closeout {engagement, project, run_id, outcome, page, ok, notify}`. A lib refusal by
 *                  name (`NoScope`, `EngagementRecordUnreadable`, `CloseoutInputInvalid`, …) is that event with `ok:
 *                  false` and `reason`, the state unmoved; a transient failure (`retry: true`) emits nothing.
 *   Never throws; serialised per served root with the approve module's passes. A `cancelled` (terminal) or `scoping`
 *   record is never closed out.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPROVE_EVENT, applyRow, blockOwed, defaultNotify, eventsFor, landedStory, linksOf, serialised, stops, targetsOf,
  type ApproveDeps, type Target,
} from "./approve";
import { jobRunCosts } from "./board";
import { findSpec, frontmatter, jiraBound } from "./closeout";
import { readEngagement, type Engagement } from "./engagement";
import { canonicalPr, type EndNotice } from "./hygiene";
import { runPr } from "./planstatus";
import { isTerminal, servedRoot, type Queue, type QueueRun } from "./queue";
import { lastJsonObject, type RunResult } from "./server";
import { gh, runBranch, runner, studioScript, uvRunner } from "./worktree";

export const CLOSEOUT_EVENT = "engagement-closeout";
/** The `to` states a side exit names. */
export const SIDE_EXIT_STATES = ["paused", "partial", "failed", "cancelled"] as const;
export const closeoutRel = (id: string) => `_bmad-output/engagements/${id}/closeout.md`;

export interface DeliveryDeps extends ApproveDeps {
  /** The host ledger file (`ledgerPath`): the runs' `job-run` costs; absent: every run unmetered. */
  ledgerFile?: string;
}

export interface CloseoutInput {
  run_id: string;
  outcome_hint: "partial" | "failed";
  runs: { run_id: string; job: string; state: string | null; studio_run_id: string | null; cost_usd: number | null; pr: string | null }[];
  stories: { key: string; run_id: string; spec_status: string | null; pr: string | null; pr_state: string | null }[];
  epics: { job: string; queued: boolean }[];
  side_exits: { at: string; to: string; verb: string; reason: string }[];
  spend: { planning_usd: number; runs_usd: number };
  quote: Record<string, unknown> | null;
}

export interface CloseoutResult { closed: string[]; refused: string[] }

type Detail = Record<string, unknown>;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const nowIso = (deps: DeliveryDeps) => (deps.now ? deps.now() : new Date().toISOString());
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The engagement's last run when it ended (see the header), else undefined. `prClosed`: the run's PR was closed
 * unmerged (the async pass asks gh, `closeoutStep`), so a steady stop on it awaits no merge either. */
export function lastRunEnded(queue: Queue, t: Target, record: Engagement, prClosed = false): QueueRun | undefined {
  if (record.state !== "in-progress" && record.state !== "partial") return undefined;
  const project = record.project, id = t.engagement;
  const links = linksOf(queue, project, id);
  const last = links.at(-1);
  if (!last) return undefined;
  const run = queue.get(last.run_id);
  if (!run || !isTerminal(run.state)) return undefined;
  if (links.some((l) => l.after_run === run.run_id)) return undefined;
  // in-progress only (the run pass resubmits and pauses nowhere else): a run the run pass stopped is owed step 7's
  // resubmit — a steady stop once its PR merges, an ask stop after its pause and the owner's continue, a cap stop
  // once go {cap} raised the cap. A steady stop on a run with no PR, or with its PR closed unmerged (`prClosed`),
  // awaits no merge (step 7 resubmits only a merged one): it holds nothing back. In partial a stop holds nothing back:
  // the record closes out (a later go {cap} gives a new last run and a new closeout).
  if (record.state === "in-progress") {
    const settled = prClosed || !runPr(queue.events(run.run_id));
    if (stops(queue, project, id).some((e) => e.detail?.run_id === run.run_id && e.detail?.ok === true
      && !(settled && e.detail?.reason === "steady"))) return undefined;
  }
  if (record.state === "partial" && jiraBound(t.root)) {
    const capLine = record.inputs.findLast((l) => l.verb === "cap");
    if (capLine && blockOwed(queue, project, id, "cap", capLine.at)) return undefined;
  }
  return run;
}

/** A story's PR: the newest `paused` event's PR at or before its `close-out` (or, for the story the run is paused on,
 * the newest one), else the run's. */
function storyPr(events: ReturnType<Queue["events"]>, key: string): string | null {
  let at = events.findLastIndex((e) => e.kind === "close-out" && e.detail?.story_key === key);
  if (at < 0) at = events.length - 1;
  for (let i = at; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== "paused") continue;
    const pr = canonicalPr(e.detail?.pr);
    if (pr) return pr;
  }
  return runPr(events) ?? null;
}

const specsRel = "_bmad-output/specs";
const directSpecRel = (key: string) => `_bmad-output/implementation-artifacts/spec-${key}.md`;

/** `findSpec`'s naming over a ref's paths (`git ls-tree -r --name-only`): `implementation-artifacts/spec-<key>.md`,
 * else the single `_bmad-output/specs/<any>/stories/<key>-*.md`. Undefined: none, or several. */
export function specPathIn(paths: readonly string[], key: string): string | undefined {
  if (paths.includes(directSpecRel(key))) return directSpecRel(key);
  const hits = paths.filter((p) => {
    const parts = p.split("/");
    return parts.length === 5 && p.startsWith(`${specsRel}/`) && parts[3] === "stories"
      && parts[4]!.startsWith(`${key}-`) && parts[4]!.endsWith(".md");
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/** A story's spec text at `ref` in the served root's git objects, read-only (`git -C <root> ls-tree`, then `git -C
 * <root> show <ref>:./<path>`: ls-tree names paths from the cwd, `./` resolves them there, a nested served root too);
 * null when the ref, the path or the read fails. */
async function specAtRef(deps: DeliveryDeps, root: string, ref: string, key: string): Promise<string | null> {
  const git = (args: string[]) => runner(deps)("git", ["-C", root, ...args], { cwd: root, timeoutS: 60 });
  let r: RunResult;
  try { r = await git(["ls-tree", "-r", "--name-only", ref, "--", directSpecRel(key), specsRel]); } catch { return null; }
  if (r.exit !== 0) return null;
  const path = specPathIn(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), key);
  if (!path) return null;
  try { r = await git(["show", `${ref}:./${path}`]); } catch { return null; }
  return r.exit === 0 ? r.stdout : null;
}

/** The spec frontmatter `status` of a story: `findSpec(servedRoot(run) ?? root, key)` (Story 28.5: the project at
 * `<worktree>/<prefix>`), else the spec on the pushed run
 * branch (`origin/<run branch>`, then the local `<run branch>`; the worktree is removed at close-out, DW-46); null
 * when none is read. Never fetches, pulls, checks out or resets the served root. */
export async function specStatus(deps: DeliveryDeps, root: string, run: QueueRun, key: string): Promise<string | null> {
  const spec = findSpec(servedRoot(run) ?? root, key);
  if (spec) {
    try { return str(frontmatter(readFileSync(spec, "utf-8")).status); } catch { return null; }
  }
  if (!key || /[\\/]/.test(key) || key.includes("..")) return null;
  const branch = runBranch(run.run_id);
  for (const ref of [`origin/${branch}`, branch]) {
    const text = await specAtRef(deps, root, ref, key);
    if (text !== null) return str(frontmatter(text).status);
  }
  return null;
}

/** `gh pr view <pr> --json state`, upper-cased; null when gh fails. */
async function prState(deps: DeliveryDeps, root: string, pr: string): Promise<string | null> {
  let r: RunResult;
  try { r = await gh(deps, root, ["pr", "view", pr, "--json", "state"]); } catch { return null; }
  const view = r.exit === 0 ? lastJsonObject(r.stdout) as Record<string, unknown> | null : null;
  return typeof view?.state === "string" && view.state ? view.state.toUpperCase() : null;
}

/** The ledger's text (`deps.ledgerFile`; absent or unreadable: none, every run unmetered). */
function ledgerText(deps: DeliveryDeps): string {
  if (!deps.ledgerFile) return "";
  try { return readFileSync(deps.ledgerFile, "utf-8"); } catch { return ""; }
}

/** The composition the lib renders (see the header). */
export async function composeCloseout(queue: Queue, deps: DeliveryDeps, t: Target, record: Engagement, last: QueueRun): Promise<CloseoutInput> {
  const project = record.project, id = t.engagement;
  const links = linksOf(queue, project, id);
  const costs = jobRunCosts(ledgerText(deps));
  const runs: CloseoutInput["runs"] = [];
  const stories: CloseoutInput["stories"] = [];
  const states = new Map<string, string | null>();
  const seen = new Set<string>();
  for (const link of links) {
    const run = queue.get(link.run_id);
    if (!run) {
      runs.push({ run_id: link.run_id, job: link.job, state: null, studio_run_id: null, cost_usd: null, pr: null });
      continue;
    }
    const events = queue.events(run.run_id);
    const cost = run.studio_run_id ? costs.get(run.studio_run_id) : undefined;
    runs.push({
      run_id: run.run_id, job: link.job, state: run.state, studio_run_id: run.studio_run_id,
      cost_usd: cost && cost.cost > 0 ? cost.cost : null, pr: runPr(events) ?? null, // unmetered: null (`jobRunCosts` maps it to 0)
    });
    const keys: string[] = [];
    for (const e of events) {
      const k = e.kind === "close-out" ? str(e.detail?.story_key) : null;
      if (k && !keys.includes(k)) keys.push(k);
    }
    const landed = landedStory(queue, run);
    if (landed && !keys.includes(landed)) keys.push(landed);
    for (const key of keys) {
      if (seen.has(key)) continue; // a story counted once, at its first run
      seen.add(key);
      const pr = storyPr(events, key);
      let state: string | null = null;
      if (pr) {
        if (!states.has(pr)) states.set(pr, await prState(deps, t.root, pr));
        state = states.get(pr) ?? null;
      }
      stories.push({ key, run_id: run.run_id, spec_status: await specStatus(deps, t.root, run, key), pr, pr_state: state });
    }
  }
  const jobStep = eventsFor(queue, APPROVE_EVENT, project, id).findLast((e) => e.detail?.step === "job" && e.detail?.ok === true);
  const declared = isObject(jobStep?.detail?.detail) && Array.isArray(jobStep.detail.detail.jobs) ? jobStep.detail.detail.jobs : [];
  const epics = declared.filter((j): j is string => typeof j === "string" && j !== "")
    .map((job) => ({ job, queued: links.some((l) => l.job === job) }));
  const side_exits = record.inputs
    .filter((l) => (SIDE_EXIT_STATES as readonly string[]).includes(l.to) && l.to !== l.from)
    .map((l) => ({
      at: l.at, to: l.to, verb: l.verb,
      reason: str(l.detail?.reason) ?? str(l.payload?.reason) ?? l.verb,
    }));
  const spend = isObject(record.spend) ? record.spend : { planning_usd: 0, runs_usd: 0 };
  return {
    run_id: last.run_id, outcome_hint: last.state === "blocked" ? "failed" : "partial", runs, stories, epics, side_exits,
    spend: { planning_usd: Number(spend.planning_usd) || 0, runs_usd: Number(spend.runs_usd) || 0 },
    quote: isObject(record.quote) ? record.quote : null,
  };
}

/** `engage.py closeout` on the host: the parsed result, or null on a transient failure (`retry: true`, no status
 * block, the process failing). */
async function runCloseout(deps: DeliveryDeps, root: string, id: string, input: CloseoutInput): Promise<Record<string, any> | null> {
  let dir: string;
  try { dir = mkdtempSync(join(tmpdir(), "tk-sup-closeout-")); } catch { return null; }
  try {
    const file = join(dir, "closeout-input.json");
    writeFileSync(file, JSON.stringify(input, null, 2) + "\n", "utf-8");
    let r: RunResult;
    try {
      r = await uvRunner(deps)(root, studioScript(deps, "lib", "engage.py"),
        ["closeout", "--directory", root, "--engagement", id, "--input-file", file], 300);
    } catch { return null; }
    const out = lastJsonObject(r.stdout) as Record<string, any> | null;
    if (!out || typeof out.status !== "string" || out.retry === true) return null;
    if (out.status !== "complete" && out.status !== "blocked") return null;
    return out;
  } catch { return null; } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** `track.py close --engagement` (Jira-bound projects): true once closed or refused by name, false on a transient
 * failure (the next pass calls again). */
async function closeIssue(queue: Queue, deps: DeliveryDeps, t: Target, project: string): Promise<boolean> {
  if (!jiraBound(t.root)) return true;
  let r: RunResult;
  try { r = await uvRunner(deps)(t.root, studioScript(deps, "lib", "track.py"), ["close", "--directory", t.root, "--engagement", t.engagement], 120); }
  catch { return false; }
  const out = lastJsonObject(r.stdout) as Record<string, any> | null;
  if (!out || typeof out.status !== "string" || out.retry === true) return false;
  const at = nowIso(deps);
  if (out.ok !== true) {
    if (out.status !== "blocked") return false;
    const reason = typeof out.reason === "string" && out.reason ? out.reason : "track refused";
    queue.serviceEvent("engagement-issue", { engagement: t.engagement, project, action: "refused", step: "close", reason }, at);
    return true;
  }
  queue.serviceEvent("engagement-issue", { engagement: t.engagement, project, issue: typeof out.issue === "string" ? out.issue : null, action: "closed", step: "closeout" }, at);
  return true;
}

/** The run's PR when an ok `steady` stop names the run (its merge awaited), else undefined. */
function steadyPr(queue: Queue, project: string, id: string, runId: string): string | undefined {
  const steady = stops(queue, project, id).some((e) => e.detail?.run_id === runId && e.detail?.ok === true && e.detail?.reason === "steady");
  return steady ? runPr(queue.events(runId)) : undefined;
}

const pageOf = (v: unknown): Detail | null =>
  (isObject(v) && typeof v.id === "string" ? { id: v.id, url: v.url ?? null, version: v.version ?? null } : null);

async function closeoutStep(queue: Queue, deps: DeliveryDeps, t: Target, out: CloseoutResult): Promise<void> {
  const record = readEngagement(t.root, t.engagement);
  if (!record) return;
  const project = record.project, id = t.engagement;
  const last = linksOf(queue, project, id).at(-1);
  if (!last) return;
  const told = () => eventsFor(queue, CLOSEOUT_EVENT, project, id).some((e) => e.detail?.run_id === last.run_id);
  if (told()) return; // once per last run
  const run = queue.get(last.run_id);
  if (!run) return;
  const ended = (r: Engagement) => r.inputs.findLast((l) => l.verb === "run-ended" && l.detail?.run_id === run.run_id);
  let outcome: string, page: Detail | null;
  const line = ended(record);
  if (line) {
    // the row already applied (an earlier pass's issue close was transient): the close, the notice, the event
    // — only while the record still sits in that outcome's state (a go {cap} from partial, a revise: a live engagement)
    outcome = String(line.detail?.outcome ?? "partial");
    if (record.state !== outcome) return;
    page = pageOf(isObject(record.closeout) ? record.closeout.page : null);
  } else {
    if (!lastRunEnded(queue, t, record, true)) return; // held back by more than a steady stop's PR
    const awaited = record.state === "in-progress" ? steadyPr(queue, project, id, run.run_id) : undefined;
    if (awaited && (await prState(deps, t.root, awaited)) !== "CLOSED") return; // OPEN, MERGED (step 7) or gh failed
    const input = await composeCloseout(queue, deps, t, record, run);
    const lib = await runCloseout(deps, t.root, id, input);
    if (!lib) return; // transient: the next pass
    const notice = (o: string, reason: string): EndNotice => ({
      run_id: run.run_id, job_id: run.job_id, project_id: run.project_id ?? project, studio_run_id: run.studio_run_id,
      state: o, reason,
    });
    if (lib.status === "blocked") {
      if (told()) return; // another process's pass told meanwhile
      const reason = clip(typeof lib.reason === "string" && lib.reason ? lib.reason : "engage refused");
      const notify = await (deps.notify ?? ((n: EndNotice) => defaultNotify(deps, n)))(notice("closeout-refused", `engagement ${id} closeout refused: ${reason}`))
        .catch((e) => ({ ok: false, error: clip(message(e)) }));
      queue.serviceEvent(CLOSEOUT_EVENT, { engagement: id, project, run_id: run.run_id, outcome: null, page: null, ok: false, reason, notify }, nowIso(deps));
      out.refused.push(id);
      return;
    }
    outcome = String(lib.outcome);
    page = pageOf(lib.page);
    const once = (f: Engagement) => !!ended(f);
    if (!applyRow(queue, deps, t, "run-ended", { outcome, run_id: run.run_id, closeout: closeoutRel(id) }, once)) return; // refused or moved: the next pass
  }
  if (!(await closeIssue(queue, deps, t, project))) return; // transient: the next pass closes, then tells
  if (told()) return; // another process's pass told meanwhile (the events re-read right before the write)
  const link = typeof page?.url === "string" && page.url ? page.url : closeoutRel(id);
  const notice: EndNotice = {
    run_id: run.run_id, job_id: run.job_id, project_id: run.project_id ?? project, studio_run_id: run.studio_run_id,
    state: outcome, reason: `engagement ${id} ${outcome}: ${link}`,
  };
  const notify = await (deps.notify ?? ((n: EndNotice) => defaultNotify(deps, n)))(notice).catch((e) => ({ ok: false, error: clip(message(e)) }));
  queue.serviceEvent(CLOSEOUT_EVENT, { engagement: id, project, run_id: run.run_id, outcome, page, ok: true, notify }, nowIso(deps));
  out.closed.push(id);
}

/** The closeout pass (see the header). `only`: one engagement. Never throws. */
export async function closeoutPass(queue: Queue, deps: DeliveryDeps = {}, only?: Target): Promise<CloseoutResult> {
  const out: CloseoutResult = { closed: [], refused: [] };
  try {
    for (const t of targetsOf(queue, only)) {
      await serialised(t.root, async () => {
        try { await closeoutStep(queue, deps, t, out); } catch { /* this engagement on the next pass */ }
      });
    }
  } catch { /* the next pass */ }
  return out;
}
