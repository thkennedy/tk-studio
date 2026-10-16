/**
 * planstatus.ts — the plan follows the run (Story 27.5, AC1).
 *
 * When a run's PR opens the supervisor calls the owning project's planning adapter, `plansync.py status`
 * (Story 26.5, at `$TK_STUDIO_ROOT`), setting `review` on every story the run marked done; when the PR merges it
 * sets `done`. Each call — or why none was made — is one `plan-status` event on the run (`queue.note`: the run's
 * state never changes, so a refused call never changes it):
 *
 *   {phase: "review"|"done", pr, owner, directory, story_key, id, ok, previous_status?, error?, blocked?, skipped?, reason?}
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
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { frontmatter } from "./closeout";
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
      // The lease is taken only once there is something to record (an OPEN PR takes none, tick after tick), and never
      // while the review is still in progress (`claimPlanPhase`); the review events are read again under it.
      const work = async (): Promise<Worked> => {
        if (state === "CLOSED") return record(queue, run.run_id, { phase: "done", pr, ok: false, skipped: true, reason: "pr closed unmerged" });
        let any = false;
        for (const rev of planEvents(queue.events(run.run_id), "review")) {
          const d = (rev.detail ?? {}) as Record<string, unknown>;
          const keep = { phase: "done" as const, pr, ...(d.owner !== undefined ? { owner: d.owner } : {}), ...(d.directory !== undefined ? { directory: d.directory } : {}),
            ...(d.story_key !== undefined ? { story_key: d.story_key } : {}) };
          if (typeof d.id !== "string" || typeof d.directory !== "string") {
            any = record(queue, run.run_id, { ...keep, ok: false, skipped: true, reason: typeof d.reason === "string" ? d.reason : "nothing was resolved at review" }) || any;
            continue;
          }
          const res = await callStatus(d.directory, d.id, "done", `run ${run.run_id} PR ${pr}`, deps);
          if (res.transient && !any) return { retry: res.error ?? "plansync.py status failed", detail: { phase: "done", pr, ...(d.owner !== undefined ? { owner: d.owner } : {}) } };
          any = record(queue, run.run_id, { ...keep, id: d.id, ...shown(res) }) || any;
        }
        return any;
      };
      if (await leased(queue, run.run_id, "done", deps, work)) out.push(run.run_id);
    } catch { /* the next tick tries again */ }
  }
  return out;
}
