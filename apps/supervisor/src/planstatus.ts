/**
 * planstatus.ts — the plan follows the run (Story 27.5, AC1).
 *
 * When a run's PR opens the supervisor calls the owning project's planning adapter, `plansync.py status`
 * (Story 26.5, at `$TK_STUDIO_ROOT`), setting `review` on every story the run marked done; when the PR merges it
 * sets `done`. Each call — or why none was made — is one `plan-status` event on the run (`queue.note`: the run's
 * state never changes, so a refused call never changes it):
 *
 *   {phase: "review"|"done", pr, owner, directory, story_key, id, ok, previous_status?, error?, blocked?, skipped?, reason?, stage?}
 *
 *   stage     `true` on every `done` event a stage-capable merge pass records (Story 35.8, additive): the stage pass owes
 *             only those, so a run merged before 35.8 gets no supervisor rows and is never back-filled.
 *
 *   owner     the run project's `_bmad-output/planning-artifacts/epics.md` frontmatter, read at the run branch: with
 *             `status: transcribed` and `source: "<org>/<repo> …"` the owner is the registry entry keyed `<repo>`;
 *             otherwise the run's own project (its root). An owner not in the registry, or with no
 *             `_bmad-output/planning-artifacts/plan/`, records one skipped event per phase naming it, and calls nothing.
 *   stories   the spec files changed on the run branch (`git diff --name-only <base_ref>...supervisor/run-<id>`, in
 *             the checkout) at the paths `findSpec` resolves (`_bmad-output/implementation-artifacts/spec-<key>.md`,
 *             `_bmad-output/specs/<any>/stories/<key>.md`), whose frontmatter at the run branch reads `status: done`
 *             and at the merge-base (`git merge-base <base_ref> supervisor/run-<id>`, the diff's own base) does not
 *             (a spec already done there, merely edited by the run, is not the run's; a `base_ref` tip the PR has
 *             since merged into is never read);
 *             one per story `N.M` (taken from the key, `^(\d+)[.-](\d+)`: a `-r<n>` remediation maps to its story).
 *   id        the owner plan's single `ST-*.md` whose frontmatter `source` is `epics.md#story-N.M` (none or several:
 *             a skipped event naming it).
 *   review    terminal runs (never `external`) with a worktree recorded, whose PR is on `ended.detail.pr`, else the
 *             latest `closed_out.detail.pr` (a late close-out), and no `plan-status` `review` event yet.
 *   done      runs with a `review` event and no `done` event: `gh pr view <pr> --json state,mergedAt`; `MERGED` → the
 *             `done` calls for the stories the review pass resolved (a story skipped there is skipped again), read
 *             from the run's `review` events again once the `done` lease is held; `CLOSED` → one `{phase: "done",
 *             skipped: true, reason: "pr closed unmerged"}`; `OPEN` or a failed `gh` → nothing recorded, asked again
 *             next tick.
 *
 * The verb: `uv run <plugin>/lib/plansync.py status --directory <owner root> --id ST-NNN --status <phase>
 * --note "run <id> PR <url>" --caller tk-studio-supervisor` (argv only, never a shell). Exit 0 with `{ok: true,
 * previous_status, …}` is `ok: true`; a refusal (`{ok: false, error}`, exit 2) or a blocked re-sync (`{ok: false,
 * blocked: true, reason}`) is `ok: false` with the verb's error or reason — final, never retried for that phase. A
 * transient failure of the call — the runner throws (uv failed to spawn, the 120 s timeout) or the verb answers no
 * JSON object (a Python traceback) — is a retry while nothing is recorded yet in the pass (below); once the pass has
 * recorded something the phase is settled by it, so the failure is recorded `ok: false` with its error. Each pass
 * never throws.
 *
 * Each phase of a run is taken under a lease before anything is called (`Queue.claimPlanPhase`, a `plan-lease {phase,
 * owner}` event in one IMMEDIATE transaction), so overlapping `run`/`recover`/`drain` processes call the verb once per
 * story per phase. A pass that recorded lets the lease go settled (`plan-lease {phase, owner: null, released,
 * settled: true}`); the `done` lease is refused while the run's `review` lease is held by a live owner (a review pass
 * still calling the verb story by story), so the merge pass never settles `done` on a partial review. A transient
 * failure — the epics.md or a spec unreadable at the run branch (or a spec at the merge-base) for any reason but
 * "does not exist", a failed `git diff` or `git merge-base`, a failed registry lookup, a transient verb failure before
 * anything is recorded — records nothing and lets the lease go (`plan-lease {phase, owner: null, released}`): the
 * next tick asks again. Retries are bounded: a retry with `PLAN_RETRY_LIMIT` released (never settled) leases already
 * on the phase (e.g. a deleted run branch, `invalid object name`) records one `{phase, pr, owner?, ok: false,
 * skipped: true, reason: "gave up after <n> attempts: <the retry's reason>"}` instead — the phase is settled and the
 * run's events stop growing.
 *
 * Story 35.8 — the stage pass (`stagePass`, run at the end of every merge pass): for each terminal run with a
 * `plan-status` `done` `ok` event carrying `stage: true` (pulled back to `done` by a stage-capable supervisor; a run
 * merged before 35.8 gets no supervisor rows and is never back-filled), the supervisor's own Stage Log rows are built
 * from the run's queue events (the host clock): each `host-verify` leg a `host-leg` row (pass n over the close-out's
 * legs) or, carrying `rerun`, a `re-run` row (pass n), started at its `started_at` (else the event's `at`) and ended at
 * the event's `at`, the verdict its outcome; each close-out (an `ended`, `closed_out` or `paused` event carrying
 * `closeout` — a paused close-out is recorded on its `paused` transition; one row per close-out record, so a busy
 * queue's `closed_out {closeout, pending}` and the `ended` later written from it are one) a `close-out` row from the
 * leg before it to the event, its `closeout.result` the outcome; the `merge` row at gh's `mergedAt` (the merge pass's
 * own read, else the last `stage-post` event's `merged_at`, else `gh pr view <pr> --json state,mergedAt`). A close-out
 * spans from the leg before it, a host leg or a re-run. Model,
 * effort, tokens and cost are `—` (the host leg runs no model). They are appended to the owner root's spec with
 * `plansync.py stage --append --directory <owner root> --story <story_key> --row-json <rows>` (idempotent by row key),
 * then, when the root is bound to Jira (`jiraBound`), mirrored with `plansync.py stage-post --directory <root> --story
 * <story_key> --id <ST id>` (the start and finish comments and the worklog per row). Each attempt is one `stage-post
 * {story_key, id, directory, appended, posted, ok, detail?, unposted?, settled?, merged_at?}` event on the run (the
 * run's state never changes). `ok: true` only when nothing is left unposted (stage-post's `unposted` 0; unbound: the
 * rows in the table). A refusal (several specs match, no spec and no folder to buffer in, an entity with no
 * `external.jira.key`, no agent token — an answer without `retryable: true`) is recorded once `settled: true`, never
 * retried. A transient failure (the runner threw, no JSON, a Jira/gateway/network failure answered `retryable: true`),
 * rows stage-post still counts `unposted`, or an unknown `mergedAt` is a retry: the next pass tries again, a failure
 * identical to the story's last recorded one not recorded twice. A story whose spec is not yet at the owner checkout
 * (no `<directory>/_bmad-output/specs/<any>/stories/<story_key>.md` or `<story_key>-*.md`, plansync's own glob) waits:
 * still owed, it takes no lease and calls nothing until the spec lands; rows the append answers only `buffered` are the
 * same wait (`waiting: true`, recorded once while it lasts). Waits are uncounted and lease-free — never a retry, never
 * the give-up. The pass holds the run's `plan-lease {phase: "stage"}` while it calls — claimed only while a story is
 * owed (none settled it, or a newer `host-verify`, a re-run's leg, follows its settling event) and its spec is present,
 * the owed stories read again under it; it is let go of `settled` once nothing is left to retry
 * (a tick whose only non-ok outcomes are waits lets the lease go settled, so the retry window starts again after it).
 * Retries are bounded like the other phases': with `PLAN_RETRY_LIMIT` released (not settled) stage leases since the run's last `host-verify` or settled stage lease,
 * each story still retrying records one `{…, ok: false, settled: true, skipped: true, reason: "gave up after <n>
 * attempts: <the retry's reason>"}` and the lease settles — no claim is taken again until a newer `host-verify`
 * re-enters the story. Never throws, never blocks a run.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { frontmatter, jiraBound } from "./closeout";
import { canonicalPr } from "./hygiene";
import { isTerminal, selfOwner, type Owner, type Queue, type QueueEvent, type QueueRun } from "./queue";
import { lastJsonObject, registryShow, type RunResult } from "./server";
import { gh, runBranch, runner, studioScript, uvRunner, type WorktreeDeps } from "./worktree";

export const PLAN_CALLER = "tk-studio-supervisor";
export const EPICS_REL = "_bmad-output/planning-artifacts/epics.md";
export const PLAN_REL = join("_bmad-output", "planning-artifacts", "plan");
/** Story 27.5: the released plan leases a phase may carry before its next retry gives up (a skipped `plan-status`). */
export const PLAN_RETRY_LIMIT = 24;

export interface PlanStatusDeps extends WorktreeDeps {
  /** A registry entry's root by project id (default: `registry.py show --project-id`, `registryRoot`); undefined when
   * the entry is absent; a throw is a failed lookup (a timeout, an unreadable answer): nothing is recorded, the next
   * tick asks again. */
  registry?: (projectId: string) => Promise<string | undefined>;
  /** This process, the plan lease's owner (default `selfOwner()`). */
  self?: Owner;
}

export type Phase = "review" | "done";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const failed = (r: RunResult) => `exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;

/** A registry entry's root through `registry.py show --project-id`: undefined when the registry answers that the
 * project is not registered (or names no usable root); any other failure (a timeout, no JSON, an unreadable registry)
 * is thrown — a failed lookup, never read as an absent entry. */
export async function registryRoot(projectId: string, show: (id: string) => Promise<Record<string, any>> = registryShow): Promise<string | undefined> {
  let shown: Record<string, any>;
  try { shown = await show(projectId); }
  catch (e) {
    if (/^registry: .*is not registered/.test(message(e))) return undefined;
    throw e;
  }
  const root = shown.entry?.root;
  return typeof root === "string" && root.trim() ? root : undefined;
}

/** The run's PR: `ended.detail.pr`, else the latest `closed_out.detail.pr` (a late close-out). */
export function runPr(events: readonly QueueEvent[]): string | undefined {
  const ended = canonicalPr(events.findLast((e) => e.kind === "ended")?.detail?.pr);
  if (ended) return ended;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== "closed_out") continue;
    const pr = canonicalPr(e.detail?.pr);
    if (pr) return pr;
  }
  return undefined;
}

const git = (deps: WorktreeDeps, cwd: string, args: string[]) => runner(deps)("git", args, { cwd, timeoutS: 60 });

type AtRef = { text: string } | { absent: true } | { error: string };

/** A file at `ref` (`git show <ref>:<path>` in the checkout `root`): its text; `absent` when git says the path does
 * not exist at that ref; `error` on any other failure (the read is retried next tick). */
async function atRef(root: string, ref: string, path: string, deps: WorktreeDeps): Promise<AtRef> {
  let r: RunResult;
  try { r = await git(deps, root, ["show", `${ref}:${path}`]); }
  catch (e) { return { error: `git show: ${clip(message(e))}` }; }
  if (r.exit === 0) return { text: r.stdout };
  if (/does not exist in|exists on disk, but not in/i.test(r.stderr)) return { absent: true };
  return { error: `git show ${failed(r)}` };
}

/** A file at the run branch (`git show supervisor/run-<id>:<path>`), as `atRef`. */
export const atBranch = (run: Pick<QueueRun, "run_id" | "root">, path: string, deps: WorktreeDeps): Promise<AtRef> =>
  atRef(run.root, runBranch(run.run_id), path, deps);

const isDone = (read: AtRef) => "text" in read && String(frontmatter(read.text).status ?? "").trim() === "done";

export type OwnerResolution =
  | { ok: true; owner: string; directory: string }
  | { ok: false; owner: string; reason: string }
  /** A failed read or lookup: nothing is recorded, the next tick resolves again. */
  | { ok: false; retry: string; owner?: string };

/** The project that owns the run's plan (see the header). */
export async function planOwner(run: Pick<QueueRun, "run_id" | "root" | "project_id">, deps: PlanStatusDeps = {}): Promise<OwnerResolution> {
  const epics = await atBranch(run, EPICS_REL, deps);
  if ("error" in epics) return { ok: false, retry: `epics.md at the run branch: ${epics.error}` };
  const fm = "text" in epics ? frontmatter(epics.text) : {};
  const source = typeof fm.source === "string" ? fm.source.trim() : "";
  const m = String(fm.status ?? "").trim() === "transcribed" ? /^([^/\s]+)\/([^/\s]+)/.exec(source) : null;
  let owner: string, directory: string | undefined;
  if (m) {
    owner = m[2]!;
    try { directory = await (deps.registry ?? registryRoot)(owner); }
    catch (e) { return { ok: false, retry: `registry lookup of ${owner} failed: ${clip(message(e))}`, owner }; }
    if (!directory) return { ok: false, owner, reason: `owner ${owner} not in the registry` };
  } else {
    owner = run.project_id ?? basename(run.root);
    directory = run.root;
  }
  if (!existsSync(join(directory, PLAN_REL))) return { ok: false, owner, reason: `owner ${owner} has no plan directory (${PLAN_REL.replace(/\\/g, "/")})` };
  return { ok: true, owner, directory };
}

/** A spec path `findSpec` resolves, as its story key; undefined for any other path. */
export function specKey(path: string): string | undefined {
  const p = path.replace(/\\/g, "/");
  return /^_bmad-output\/implementation-artifacts\/spec-([^/]+)\.md$/.exec(p)?.[1]
    ?? /^_bmad-output\/specs\/[^/]+\/stories\/([^/]+)\.md$/.exec(p)?.[1];
}

/** `N.M` from a story key (`27-5-…`, `27.5`, a `-r2` remediation of it). */
export const storyNumber = (key: string): string | undefined => {
  const m = /^(\d+)[.-](\d+)/.exec(key);
  return m ? `${Number(m[1])}.${Number(m[2])}` : undefined;
};

/** The stories the run marked done (see the header), one per `N.M`; `error` when no `base_ref` is recorded (a
 * permanent skip); `retry` when the diff, the merge-base or a spec could not be read (asked again next tick). */
export async function doneStories(run: Pick<QueueRun, "run_id" | "root" | "base_ref">, deps: WorktreeDeps = {}):
  Promise<{ stories: { story_key: string; story: string; path: string }[]; error?: string; retry?: string }> {
  if (!run.base_ref) return { stories: [], error: "no base_ref recorded" };
  let r: RunResult;
  try { r = await git(deps, run.root, ["diff", "--name-only", `${run.base_ref}...${runBranch(run.run_id)}`]); }
  catch (e) { return { stories: [], retry: `git diff: ${clip(message(e))}` }; }
  if (r.exit !== 0) return { stories: [], retry: `git diff ${failed(r)}` };
  const seen = new Set<string>();
  const stories: { story_key: string; story: string; path: string }[] = [];
  // The diff's base (`<base_ref>...<branch>`), resolved once, on the first spec that needs it: never the `base_ref`
  // tip, which reads `done` once the run's PR merged into it.
  let mergeBase: string | { retry: string } | undefined;
  const resolveBase = async (): Promise<string | { retry: string }> => {
    let m: RunResult;
    try { m = await git(deps, run.root, ["merge-base", run.base_ref!, runBranch(run.run_id)]); }
    catch (e) { return { retry: `git merge-base: ${clip(message(e))}` }; }
    const sha = m.stdout.trim();
    return m.exit === 0 && /^[0-9a-f]{7,64}$/i.test(sha) ? sha : { retry: `git merge-base ${failed(m)}` };
  };
  for (const path of r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const key = specKey(path);
    const story = key ? storyNumber(key) : undefined;
    if (!key || !story || seen.has(story)) continue;
    const read = await atBranch(run, path, deps);
    if ("error" in read) return { stories: [], retry: `${path} at the run branch: ${read.error}` };
    if (!isDone(read)) continue;
    // Already done at the merge-base: the run merely edited it — not a story it marked done.
    mergeBase ??= await resolveBase();
    if (typeof mergeBase !== "string") return { stories: [], retry: mergeBase.retry };
    const before = await atRef(run.root, mergeBase, path, deps);
    if ("error" in before) return { stories: [], retry: `${path} at the merge-base ${mergeBase.slice(0, 12)}: ${before.error}` };
    if (isDone(before)) continue;
    seen.add(story);
    stories.push({ story_key: key, story, path });
  }
  return { stories };
}

/** The owner plan's entity for story `N.M`: its single `ST-*.md` with `source: epics.md#story-N.M`. */
export function planEntity(directory: string, story: string): { id: string } | { reason: string } {
  const dir = join(directory, PLAN_REL);
  const want = `epics.md#story-${story}`;
  const hits: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* none */ }
  for (const n of names.filter((x) => /^ST-[^/\\]+\.md$/.test(x)).sort()) {
    let fm: Record<string, unknown> = {};
    try { fm = frontmatter(readFileSync(join(dir, n), "utf-8")); } catch { continue; }
    if (typeof fm.source === "string" && fm.source.trim() === want) hits.push(typeof fm.id === "string" && fm.id ? fm.id : n.slice(0, -3));
  }
  if (hits.length === 1) return { id: hits[0]! };
  return { reason: hits.length ? `several plan entities for story ${story}` : `no plan entity for story ${story}` };
}

export type StatusResult = { ok: boolean; previous_status?: unknown; error?: string; blocked?: true; reason?: string;
  /** A transient failure (the runner threw, or no JSON answer): never recorded as such — see the header. */
  transient?: true };

/** `plansync.py status` for one entity (see the header): a refusal or a blocked re-sync is final; a runner that throws
 * (a spawn failure, the timeout) or an answer with no JSON object is `transient`. Never throws. */
export async function callStatus(directory: string, id: string, phase: Phase, note: string, deps: WorktreeDeps = {}): Promise<StatusResult> {
  let r: RunResult;
  try {
    r = await uvRunner(deps)(directory, studioScript(deps, "lib", "plansync.py"),
      ["status", "--directory", directory, "--id", id, "--status", phase, "--note", note.replace(/[\r\n]+/g, " "), "--caller", PLAN_CALLER], 120);
  } catch (e) { return { ok: false, error: `plansync.py status: ${clip(message(e))}`, transient: true }; }
  const out = lastJsonObject(r.stdout) as Record<string, any> | null;
  if (r.exit === 0 && out?.ok === true) return { ok: true, ...(out.previous_status !== undefined ? { previous_status: out.previous_status } : {}) };
  if (!out) return { ok: false, error: `plansync.py status ${failed(r)}`, transient: true };
  return {
    ok: false, error: out.error ? clip(String(out.error)) : out.blocked ? "blocked" : "refused",
    ...(out.blocked === true ? { blocked: true as const } : {}), ...(typeof out.reason === "string" ? { reason: clip(out.reason) } : {}),
  };
}

/** A verb call's result as recorded (`transient` is never part of an event). */
const shown = ({ transient: _t, ...res }: StatusResult) => res;

const planEvents = (events: readonly QueueEvent[], phase: Phase) =>
  events.filter((e) => e.kind === "plan-status" && e.detail?.phase === phase);

/** Records one `plan-status` event; false when it could not be (a busy queue: the next tick asks again). Never throws. */
function record(queue: Queue, runId: string, detail: Record<string, unknown>): boolean {
  try { queue.note(runId, "plan-status", detail); return true; } catch { return false; }
}

/** The review pass (see the header). Answers the runs it recorded. Never throws. */
export async function reviewPass(queue: Queue, deps: PlanStatusDeps = {}): Promise<string[]> {
  const out: string[] = [];
  let runs: QueueRun[];
  try { runs = queue.runs().filter((r) => isTerminal(r.state) && r.worktree); } catch { return out; }
  for (const run of runs) {
    try {
      const events = queue.events(run.run_id);
      if (planEvents(events, "review").length) continue;
      if (events.some((e) => e.kind === "external") || events.findLast((e) => e.kind === "ended")?.detail?.external === true) continue;
      const pr = runPr(events);
      if (!pr) continue;
      if (await leased(queue, run.run_id, "review", deps, () => reviewRun(queue, run, pr, deps))) out.push(run.run_id);
    } catch { /* the next tick tries again */ }
  }
  return out;
}

/** A phase's work: whether it recorded anything, or a transient failure (`retry`, the reason) with the fields known so
 * far (`detail`: pr, owner) for the give-up event. */
type Worked = boolean | { retry: string; detail: Record<string, unknown> };

/** Under the run's plan lease for `phase` (`Queue.claimPlanPhase`, one IMMEDIATE transaction): `work` answers whether
 * it recorded anything; when it recorded nothing (a transient failure) — or threw — the lease is let go of, so the
 * next tick asks again. A retry with `PLAN_RETRY_LIMIT` released (not settled) leases already on the phase records the
 * give-up skip instead (see the header). Once something is recorded the lease is let go of settled (`settled: true`:
 * the phase is no longer in progress — the `done` claim waits on exactly that for `review`). False when the lease was
 * refused (another pass holds it, the phase is recorded, or — for `done` — the review is still in progress). */
async function leased(queue: Queue, runId: string, phase: Phase, deps: PlanStatusDeps, work: () => Promise<Worked>): Promise<boolean> {
  const self = deps.self ?? selfOwner();
  if (!queue.claimPlanPhase(runId, phase, self)) return false;
  let recorded = false;
  try {
    const worked = await work();
    if (typeof worked === "boolean") recorded = worked;
    else {
      const tries = queue.events(runId).filter((e) => e.kind === "plan-lease" && e.detail?.phase === phase && e.detail?.owner === null && e.detail?.settled !== true).length;
      if (tries >= PLAN_RETRY_LIMIT) {
        recorded = record(queue, runId, { ...worked.detail, phase, ok: false, skipped: true, reason: `gave up after ${tries + 1} attempts: ${worked.retry}` });
      }
    }
  } finally {
    // Settled once recorded (a failed append leaves the lease naming this process: a `done` claim then waits for it to exit).
    try { queue.releasePlanPhase(runId, phase, self, recorded); } catch { /* a dead owner's lease is re-taken */ }
  }
  return recorded;
}

/** One run's review (see the header), under its lease. Answers whether it recorded anything, or the retry. */
async function reviewRun(queue: Queue, run: QueueRun, pr: string, deps: PlanStatusDeps): Promise<Worked> {
  const base = { phase: "review" as const, pr };
  const owner = await planOwner(run, deps);
  if ("retry" in owner) return { retry: owner.retry, detail: { ...base, ...(owner.owner !== undefined ? { owner: owner.owner } : {}) } };
  if (!owner.ok) return record(queue, run.run_id, { ...base, owner: owner.owner, ok: false, skipped: true, reason: owner.reason });
  const at = { ...base, owner: owner.owner, directory: owner.directory };
  const done = await doneStories(run, deps);
  if (done.retry) return { retry: done.retry, detail: at };
  if (done.error || !done.stories.length) return record(queue, run.run_id, { ...at, ok: false, skipped: true, reason: done.error ?? "no story marked done by the run" });
  let any = false;
  for (const s of done.stories) {
    const entity = planEntity(owner.directory, s.story);
    if ("reason" in entity) { any = record(queue, run.run_id, { ...at, story_key: s.story_key, ok: false, skipped: true, reason: entity.reason }) || any; continue; }
    const res = await callStatus(owner.directory, entity.id, "review", `run ${run.run_id} PR ${pr}`, deps);
    // Transient with nothing recorded yet: a retry (the call is repeated next tick); else the phase is settled by this pass.
    if (res.transient && !any) return { retry: res.error ?? "plansync.py status failed", detail: at };
    any = record(queue, run.run_id, { ...at, story_key: s.story_key, id: entity.id, ...shown(res) }) || any;
  }
  return any;
}

/** The merge pass (see the header). Answers the runs it recorded. Never throws. */
export async function mergePass(queue: Queue, deps: PlanStatusDeps = {}): Promise<string[]> {
  const out: string[] = [];
  /** Story 35.8: each merged run's `mergedAt`, as this pass read it (the stage pass's `merge` row). */
  const merged = new Map<string, string>();
  try { return await mergeRuns(queue, deps, out, merged); }
  finally { try { await stagePass(queue, deps, merged); } catch { /* the next tick tries again */ } }
}

async function mergeRuns(queue: Queue, deps: PlanStatusDeps, out: string[], merged: Map<string, string>): Promise<string[]> {
  let runs: QueueRun[];
  try { runs = queue.runs().filter((r) => isTerminal(r.state) && r.worktree); } catch { return out; }
  for (const run of runs) {
    try {
      const events = queue.events(run.run_id);
      const seen = planEvents(events, "review");
      if (!seen.length || planEvents(events, "done").length) continue;
      const pr = canonicalPr(seen[0]!.detail?.pr) ?? runPr(events);
      if (!pr) continue;
      let r: RunResult;
      try { r = await gh(deps, run.root, ["pr", "view", pr, "--json", "state,mergedAt"]); } catch { continue; }
      const view = r.exit === 0 ? lastJsonObject(r.stdout) as Record<string, unknown> | null : null;
      const state = typeof view?.state === "string" ? view.state.toUpperCase() : undefined;
      if (state !== "MERGED" && state !== "CLOSED") continue; // OPEN, or gh failed: asked again next tick
      if (state === "MERGED" && typeof view?.mergedAt === "string" && view.mergedAt) merged.set(run.run_id, view.mergedAt);
      // The lease is taken only once there is something to record (an OPEN PR takes none, tick after tick), and never
      // while the review is still in progress (`claimPlanPhase`); the review events are read again under it.
      const work = async (): Promise<Worked> => {
        // Story 35.8: `stage: true` marks a done event this (stage-capable) pass recorded — the only ones the stage pass owes.
        if (state === "CLOSED") return record(queue, run.run_id, { phase: "done", pr, stage: true, ok: false, skipped: true, reason: "pr closed unmerged" });
        let any = false;
        for (const rev of planEvents(queue.events(run.run_id), "review")) {
          const d = (rev.detail ?? {}) as Record<string, unknown>;
          const keep = { phase: "done" as const, pr, stage: true, ...(d.owner !== undefined ? { owner: d.owner } : {}), ...(d.directory !== undefined ? { directory: d.directory } : {}),
            ...(d.story_key !== undefined ? { story_key: d.story_key } : {}) };
          if (typeof d.id !== "string" || typeof d.directory !== "string") {
            any = record(queue, run.run_id, { ...keep, ok: false, skipped: true, reason: typeof d.reason === "string" ? d.reason : "nothing was resolved at review" }) || any;
            continue;
          }
          const res = await callStatus(d.directory, d.id, "done", `run ${run.run_id} PR ${pr}`, deps);
          if (res.transient && !any) return { retry: res.error ?? "plansync.py status failed", detail: { phase: "done", pr, stage: true, ...(d.owner !== undefined ? { owner: d.owner } : {}) } };
          any = record(queue, run.run_id, { ...keep, id: d.id, ...shown(res) }) || any;
        }
        return any;
      };
      if (await leased(queue, run.run_id, "done", deps, work)) out.push(run.run_id);
    } catch { /* the next tick tries again */ }
  }
  return out;
}

// ------------------------------------------------------------ Story 35.8: the stage pass

/** Story 35.8: the plan lease phase the stage pass holds while it calls. */
export const STAGE_LEASE = "stage";

/** Story 35.8: one supervisor row of a story's Stage Log (model, effort, tokens and cost stay `—`). */
export type StageRow = { stage: "host-leg" | "re-run" | "close-out" | "merge"; pass?: number; started: string; ended: string; outcome: string };

/** A value as JSON with every object's keys sorted: a close-out record's identity, whatever event carried it. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v ?? null);

/** Story 35.8: the run's supervisor rows from its queue events, oldest first, then the merge at `mergedAt`. One
 * close-out row per close-out record, on an `ended`, `closed_out` or `paused` event (a paused close-out — commit, push,
 * draft PR — is recorded on the `paused` transition): a busy queue's `closed_out {closeout, pending}` and the `ended`
 * later written from it carry the same record, one occurrence. */
export function supervisorRows(events: readonly QueueEvent[], mergedAt?: string): StageRow[] {
  const rows: StageRow[] = [];
  let legs = 0, reruns = 0, closeouts = 0;
  let legEnd: string | undefined;
  const seen = new Set<string>();
  for (const e of events) {
    const d = e.detail && typeof e.detail === "object" ? e.detail as Record<string, any> : undefined;
    if (!d) continue;
    if (e.kind === "host-verify") {
      const outcome = d.skipped === true ? "skipped" : d.green === true ? "green" : "red";
      const started = typeof d.started_at === "string" && d.started_at ? d.started_at : e.at;
      // a close-out spans from the leg before it — a host leg or a re-run's
      if (d.rerun && typeof d.rerun === "object") rows.push({ stage: "re-run", pass: ++reruns, started, ended: e.at, outcome });
      else rows.push({ stage: "host-leg", pass: ++legs, started, ended: e.at, outcome });
      legEnd = e.at;
    } else if ((e.kind === "ended" || e.kind === "closed_out" || e.kind === "paused") && d.closeout && typeof d.closeout === "object") {
      const identity = stable(d.closeout);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const result = typeof d.closeout.result === "string" ? d.closeout.result : "unknown";
      rows.push({ stage: "close-out", pass: ++closeouts, started: legEnd ?? e.at, ended: e.at, outcome: result });
      legEnd = undefined;
    }
  }
  if (mergedAt) rows.push({ stage: "merge", started: mergedAt, ended: mergedAt, outcome: "merged" });
  return rows;
}

type StageDetail = {
  story_key: string; id: string; directory: string; appended: unknown; posted: unknown; ok: boolean; detail?: string;
  /** stage-post's count of rows not yet fully mirrored (buffered, open, or a post missing). */
  unposted?: number;
  /** A refusal (or the give-up): final, never retried — only a newer `host-verify` re-enters the story. */
  settled?: true; skipped?: true; reason?: string;
  /** Rows only buffered: waiting for the spec at the owner checkout — never counted, never the give-up. */
  waiting?: true;
};
/** One story's attempt: the detail to record, and — a transient failure or rows still unposted — the retry's reason;
 * `wait`: the rows only buffered (the spec not at the owner checkout yet), owed but no retry. */
type StageOutcome = { detail: StageDetail; retry?: string; wait?: true };

/** `plansync.py <args>` for the stage pass: the answer's JSON (`ok` false unless exit 0 and `ok: true`), or `transient`
 * (the runner threw: a spawn failure, the timeout; or no JSON answer: a traceback). Never throws. */
async function callStage(directory: string, args: string[], deps: WorktreeDeps): Promise<{ out: Record<string, any>; transient?: true }> {
  let r: RunResult;
  try { r = await uvRunner(deps)(directory, studioScript(deps, "lib", "plansync.py"), args, 120); }
  catch (e) { return { out: { ok: false, error: `plansync.py ${args[0]}: ${clip(message(e))}` }, transient: true }; }
  const out = lastJsonObject(r.stdout) as Record<string, any> | null;
  if (!out) return { out: { ok: false, error: `plansync.py ${args[0]} ${failed(r)}` }, transient: true };
  return { out: r.exit === 0 && out.ok === true ? out : { ...out, ok: false } };
}

const why = (out: Record<string, any>, fallback: string) => clip(String(out.reason ?? out.error ?? fallback));

/** One story's rows appended to the owner root's spec, then (bound to Jira) posted. A refusal (several specs match, no
 * spec and no folder to buffer in, no `external.jira.key`, no agent token: an answer without `retryable: true`) is
 * settled; a transient failure or rows stage-post still counts `unposted` are a retry; rows only buffered (the spec not
 * at the owner checkout yet) are a wait — owed, uncounted. Never throws. */
async function stageStory(d: { story_key: string; id: string; directory: string }, rows: StageRow[], deps: WorktreeDeps): Promise<StageOutcome> {
  const base = { story_key: d.story_key, id: d.id, directory: d.directory };
  const app = await callStage(d.directory, ["stage", "--append", "--directory", d.directory, "--story", d.story_key, "--row-json", JSON.stringify(rows)], deps);
  if (app.out.ok !== true) {
    const detail: StageDetail = { ...base, appended: 0, posted: "not attempted", ok: false, detail: why(app.out, "stage --append refused") };
    return app.transient || app.out.retryable === true ? { detail, retry: detail.detail! } : { detail: { ...detail, settled: true } };
  }
  const count = typeof app.out.appended === "number" ? app.out.appended : 0;
  if (app.out.buffered === true) {
    const detail = `waiting for the owner checkout: rows buffered, no spec for ${d.story_key} under ${d.directory} yet`;
    return { detail: { ...base, appended: count, posted: "not attempted", ok: false, detail, waiting: true }, wait: true };
  }
  if (!jiraBound(d.directory)) return { detail: { ...base, appended: count, posted: "skipped: not bound", ok: true } };
  const post = await callStage(d.directory, ["stage-post", "--directory", d.directory, "--story", d.story_key, "--id", d.id], deps);
  const unposted = typeof post.out.unposted === "number" ? post.out.unposted : undefined;
  const detail: StageDetail = { ...base, appended: count, posted: post.out.posted ?? null, ok: post.out.ok === true && !unposted, ...(unposted !== undefined ? { unposted } : {}) };
  if (detail.ok) return { detail };
  detail.detail = why(post.out, unposted ? `${unposted} row(s) not yet posted` : "stage-post failed");
  // ok but rows left unposted (an older verb) is pending too; only an answer without `retryable` is a refusal
  return post.transient || post.out.retryable === true || post.out.ok === true ? { detail, retry: detail.detail } : { detail: { ...detail, settled: true } };
}

const sameFailure = (a: Record<string, unknown> | null | undefined, b: StageDetail) =>
  !!a && a.ok === false && a.settled !== true && a.detail === b.detail && JSON.stringify(a.posted ?? null) === JSON.stringify(b.posted ?? null)
  && (a.unposted ?? null) === (b.unposted ?? null);

const lastSeq = (events: readonly QueueEvent[], pick: (e: QueueEvent) => boolean) => events.findLast(pick)?.seq ?? 0;

/** Whether the owner checkout holds the story's spec — plansync's own resolution (`stage --story`):
 * `<directory>/_bmad-output/specs/<any>/stories/<sid>.md` or `<sid>-*.md`, `sid` the key less a `-spec` suffix. A story
 * without one is owed but waits: no lease is taken for it. */
export function ownerSpecPresent(directory: string, storyKey: string): boolean {
  const sid = storyKey.endsWith("-spec") ? storyKey.slice(0, -"-spec".length) : storyKey;
  const specs = join(directory, "_bmad-output", "specs");
  let folders: string[] = [];
  try { folders = readdirSync(specs); } catch { return false; }
  for (const folder of folders) {
    let names: string[] = [];
    try { names = readdirSync(join(specs, folder, "stories")); } catch { continue; }
    if (names.some((n) => n.endsWith(".md") && (n === `${sid}.md` || n.startsWith(`${sid}-`)))) return true;
  }
  return false;
}

/** The run's stories the stage pass still owes: each `plan-status` `done` `ok` story marked `stage: true` (recorded by
 * a stage-capable merge pass: a run merged before Story 35.8 is never back-filled) with no `stage-post` that settled
 * it (`ok: true`, or `settled: true`), or whose settling one a newer `host-verify` (a re-run's leg) follows. */
function stageTodo(events: readonly QueueEvent[]): { story_key: string; id: string; directory: string }[] {
  const done = planEvents(events, "done").map((e) => (e.detail ?? {}) as Record<string, unknown>)
    .filter((d) => d.ok === true && d.stage === true && typeof d.directory === "string" && typeof d.id === "string" && typeof d.story_key === "string");
  const leg = lastSeq(events, (e) => e.kind === "host-verify");
  return (done as { story_key: string; id: string; directory: string }[]).filter((d) => {
    const settled = lastSeq(events, (e) => e.kind === "stage-post" && e.detail?.story_key === d.story_key && (e.detail?.ok === true || e.detail?.settled === true));
    return !settled || leg > settled;
  });
}

/** The stage pass (see the header). `mergedAt` carries the merge pass's own reads. Answers the runs it worked on. Never
 * throws. */
export async function stagePass(queue: Queue, deps: PlanStatusDeps = {}, mergedAt: ReadonlyMap<string, string> = new Map()): Promise<string[]> {
  const out: string[] = [];
  let runs: QueueRun[];
  try { runs = queue.runs().filter((r) => isTerminal(r.state) && r.worktree); } catch { return out; }
  for (const run of runs) {
    try {
      const ready = (todo: ReturnType<typeof stageTodo>) => todo.filter((d) => ownerSpecPresent(d.directory, d.story_key));
      // nothing owed, or every owed story still waiting for its spec at the owner checkout: no lease taken
      if (!ready(stageTodo(queue.events(run.run_id))).length) continue;
      const self = deps.self ?? selfOwner();
      if (!queue.claimPlanPhase(run.run_id, STAGE_LEASE, self)) continue;
      let settle = false;
      try {
        // Read again under the lease: another process may have settled the stories meanwhile.
        const events = queue.events(run.run_id);
        const todo = ready(stageTodo(events));
        if (!todo.length) { settle = true; continue; }
        const isStage = (e: QueueEvent) => e.kind === "plan-lease" && e.detail?.phase === STAGE_LEASE && e.detail?.owner === null;
        const since = Math.max(lastSeq(events, (e) => e.kind === "host-verify"), lastSeq(events, (e) => isStage(e) && e.detail?.settled === true));
        const tries = events.filter((e) => isStage(e) && e.detail?.settled !== true && e.seq > since).length;
        const earlier = events.filter((e) => e.kind === "stage-post");
        let merged = mergedAt.get(run.run_id) ?? earlier.map((e) => e.detail?.merged_at).findLast((m): m is string => typeof m === "string" && !!m);
        let outcomes: StageOutcome[];
        if (!merged) {
          const pr = canonicalPr(planEvents(events, "done").find((e) => e.detail?.ok === true)?.detail?.pr) ?? runPr(events);
          let view: Record<string, unknown> | null = null;
          if (pr) {
            try {
              const r = await gh(deps, run.root, ["pr", "view", pr, "--json", "state,mergedAt"]);
              view = r.exit === 0 ? lastJsonObject(r.stdout) as Record<string, unknown> | null : null;
            } catch { /* unknown: a retry */ }
          }
          if (typeof view?.mergedAt === "string" && view.mergedAt) merged = view.mergedAt;
        }
        if (merged) {
          const rows = supervisorRows(events, merged);
          outcomes = [];
          for (const d of todo) outcomes.push(await stageStory(d, rows, deps));
        } else {
          const detail = "the PR's mergedAt is unknown (gh pr view)";
          outcomes = todo.map((d) => ({ detail: { ...d, appended: 0, posted: "not attempted", ok: false, detail }, retry: detail }));
        }
        let retrying = false;
        for (const o of outcomes) {
          let detail: StageDetail = o.detail;
          if (o.wait) {
            // a wait is never a retry: not counted, never the give-up; recorded once while it lasts
            const last = earlier.findLast((e) => e.detail?.story_key === detail.story_key)?.detail;
            if (sameFailure(last, detail)) continue;
          } else if (o.retry !== undefined && tries >= PLAN_RETRY_LIMIT) {
            detail = { ...detail, settled: true, skipped: true, reason: `gave up after ${tries + 1} attempts: ${o.retry}` };
          } else if (o.retry !== undefined) {
            retrying = true;
            const last = earlier.findLast((e) => e.detail?.story_key === detail.story_key)?.detail;
            if (sameFailure(last, detail)) continue; // the same failure: not recorded twice
          }
          try { queue.note(run.run_id, "stage-post", { ...detail, ...(merged ? { merged_at: merged } : {}) }); }
          catch { retrying = true; /* a busy queue: the next tick */ }
        }
        settle = !retrying;
        out.push(run.run_id);
      } finally {
        // Settled once nothing is left to retry (a wait is not a retry); a retry's release is counted against
        // PLAN_RETRY_LIMIT.
        try { queue.releasePlanPhase(run.run_id, STAGE_LEASE, self, settle); } catch { /* a dead owner's lease is re-taken */ }
      }
    } catch { /* the next tick tries again */ }
  }
  return out;
}
