/**
 * resolution.ts — the supervisor's resolution pass (Story 31.7, §6.9 items 4 and 5).
 *
 *   queue    for each served project with a `planning.jira` binding (`jiraBound` on its registry root), the items of
 *            its registry root's `_bmad-output/tracking/inbox.json` whose `state` is `resolved` (`Block Resolved` by
 *            name, written only by a complete, non-error sync-back tick — so a failed tick queues nothing) or
 *            `validating` (a session's `--check` marked it; a live run's key is still recorded). One block
 *            cycle is the key `(project, issue, reason_comment.id ?? blocked_since)`: each key queues one
 *            `validate-resolution` run and records one `validate-queued` service event `{key, project, root, issue,
 *            story, paused_run, spec, run_id, model, effort}`, and a recorded key is never queued again (a fail posts
 *            a new block comment, so the next resolution is a new key) — unless it expired: the run behind the
 *            key's latest `validate-queued` is terminal and no `validation.jsonl` line is newer than its creation
 *            (it ended done, failed, blocked, cancelled or not woken without an outcome), which records one
 *            `validate-expired` service event `{key, run_id, issue, state}` and lets this pass queue the key again —
 *            at most 3 times: a key with 3 `validate-expired` events stays recorded and expires no more, so a
 *            deterministic refusal that writes no line stops minting runs (only a re-block, a new agent `Blocked:`
 *            comment, is a new key). The definition is resolved as `validate`
 *            resolves it (`jobrun.py resolve`, injected) with `target.payload` = `{verb: "validate", project_root,
 *            issues: [{issue, story, paused_run, spec}]}`; the run options are `tier: "host"` plus the planner leg's
 *            `model` and `effort` from the served project's `.bmad-loop/routing.current.json` (the paused run's
 *            served root, else the registry root) when present, else the job's own routing. The paused run is the
 *            `paused` queue run whose latest `track-block` since its latest `paused` names the issue with
 *            `role: story`; `spec` is `findSpec` in its served root. One live run per checkout (the queue's
 *            idempotent mint): an item that meets a live `validate-resolution` run waits for a later pass.
 *   re-arm   after an issue's newest `validate-resolution` run (its latest `validate-queued`; an older cycle's run
 *            is superseded) ended, for that issue whose newest `_bmad-output/tracking/<KEY>/validation.jsonl` line
 *            (written since the run was created) is `pass` and whose `paused_run` is still `paused`: `resumePaused`
 *            (injected) and one `validate-resumed` service event `{run_id, issue, paused_run, ok: true}`; a
 *            refusal is recorded `{…, ok: false, refusal, reason}`, never thrown (`StoryLanded` is left to the
 *            paused-run pass, which relaunches a landed story). Any record is final but a `ResumeFailed` one (a
 *            vmHome or sbx lookup, or the `bmad-loop resolve` spawn, failed): the next pass tries it again — at most
 *            3 times: a `run_id|issue` with 3 `ResumeFailed` events is final. A `fail` line resumes nothing: the
 *            item returns `open` on the next sync-back.
 *
 * Never throws; the next pass tries again.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findSpec, jiraBound, trackBlockSincePause } from "./closeout";
import { readInbox } from "./office";
import { checkoutKey, ENGAGEMENT_CHAT_JOB, isTerminal, servedRoot, VALIDATE_RESOLUTION_JOB, type Queue, type QueueRun } from "./queue";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 500) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What `validate` serves for the job (the resolved definition, the project id, its target kind). */
export interface ResolvedJob { projectId: string; root: string; definition: Record<string, any>; target: string }

export interface ResolutionDeps {
  /** The registry's projects (`registry.py show`: `{projects: {<id>: {root}}}`). */
  registry: () => Promise<Record<string, any>>;
  /** The `validate-resolution` definition for a registry root, as `validate` resolves it (throws on a refusal). */
  resolveJob: (root: string) => Promise<ResolvedJob>;
  /** The root's checkout key and prefix (`resolveCheckout`); absent: the root keys by itself. */
  checkout?: (root: string) => Promise<{ lockCheckout?: string | null; prefix?: string | null }>;
  /** `resumePaused` (throws `ResumeRefused`). */
  resume: (queue: Queue, runId: string) => Promise<unknown>;
}

export interface ResolutionResult { queued: string[]; resumed: string[] }

/** The planner leg of a served root's `.bmad-loop/routing.current.json` (`{model, effort}`), else `{}`. */
export function plannerLeg(...roots: (string | null | undefined)[]): { model?: string; effort?: string } {
  for (const root of roots) {
    if (!root) continue;
    const file = join(root, ".bmad-loop", "routing.current.json");
    if (!existsSync(file)) continue;
    try {
      const leg = JSON.parse(readFileSync(file, "utf-8"))?.planner;
      if (!leg || typeof leg !== "object" || Array.isArray(leg)) continue;
      const model = str(leg.model), effort = str(leg.effort);
      return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
    } catch { continue; }
  }
  return {};
}

/** A resolved item's block-cycle key. */
export const resolutionKey = (project: string, item: Record<string, any>): string | null => {
  const issue = str(item.issue);
  const rid = item.reason_comment?.id;
  const cycle = (rid !== undefined && rid !== null ? str(String(rid)) : null) ?? str(item.blocked_since);
  return issue && cycle ? `${project}|${issue}|${cycle}` : null;
};

/** The paused run whose latest `track-block` since its latest `paused` names `issue` with `role: story`. */
export function pausedRunFor(queue: Queue, issue: string, projectId: string): QueueRun | undefined {
  return queue.runs().filter((r) => r.state === "paused" && (!r.project_id || r.project_id === projectId)).find((r) => {
    const block = trackBlockSincePause(queue.events(r.run_id));
    const issues = Array.isArray(block?.issues) ? block!.issues as Record<string, unknown>[] : [];
    return issues.some((i) => i?.issue === issue && i?.role === "story");
  });
}

/** The newest `validation.jsonl` line of an issue under a project root, else undefined. */
export function newestValidation(root: string, issue: string): Record<string, any> | undefined {
  try {
    const lines = readFileSync(join(root, "_bmad-output", "tracking", issue, "validation.jsonl"), "utf-8").split(/\r?\n/);
    for (const raw of lines.reverse()) {
      if (!raw.trim()) continue;
      try { const line = JSON.parse(raw); if (line && typeof line === "object") return line; } catch { /* a torn line */ }
    }
  } catch { /* none */ }
  return undefined;
}

/** Is `at` (the line's stamp, to the second) at or after `created` (the run's, floored to the second)? */
const since = (at: unknown, created: string): boolean => {
  const a = Date.parse(String(at ?? "")), c = Date.parse(created);
  return Number.isFinite(a) && Number.isFinite(c) && a >= Math.floor(c / 1000) * 1000;
};

/** The cap on a `run_id|issue`'s `ResumeFailed` `validate-resumed` events: at it the re-arm is final. */
export const MAX_RESUME_ATTEMPTS = 3;

/** The final re-arms: a `validate-resumed` that is `ok` or any refusal but `ResumeFailed` (a transient one the next
 * pass retries), or `MAX_RESUME_ATTEMPTS` `ResumeFailed` ones. */
function finalResumes(queue: Queue): Set<string> {
  const final = new Set<string>(), failed = new Map<string, number>();
  for (const e of queue.serviceEvents("validate-resumed")) {
    const k = `${e.detail?.run_id}|${e.detail?.issue}`;
    if (e.detail?.ok === true || e.detail?.refusal !== "ResumeFailed") { final.add(k); continue; }
    const n = (failed.get(k) ?? 0) + 1;
    failed.set(k, n);
    if (n >= MAX_RESUME_ATTEMPTS) final.add(k);
  }
  return final;
}

async function rearm(queue: Queue, deps: ResolutionDeps, out: ResolutionResult): Promise<void> {
  const recorded = finalResumes(queue);
  // each issue's newest `validate-queued` only (per project and root): an older cycle's run that ended `fail` is
  // never recorded, and a later cycle's `pass` line must not resume through it while that cycle's run is live
  const newest = new Map<string, Record<string, any>>();
  for (const ev of queue.serviceEvents("validate-queued")) {
    const d = (ev.detail ?? {}) as Record<string, any>;
    newest.set(`${d.project ?? ""}|${d.root ?? ""}|${d.issue ?? ""}`, d);
  }
  for (const d of newest.values()) {
    try {
      const runId = str(d.run_id), issue = str(d.issue), root = str(d.root), pausedRun = str(d.paused_run);
      if (!runId || !issue || !root || !pausedRun || recorded.has(`${runId}|${issue}`)) continue;
      const run = queue.get(runId);
      if (!run || !isTerminal(run.state)) continue;
      const line = newestValidation(root, issue);
      if (line?.outcome !== "pass" || !since(line.at, run.created)) continue; // a fail (or none): nothing resumes
      const base = { run_id: runId, issue, paused_run: pausedRun };
      recorded.add(`${runId}|${issue}`); // this pass's attempt; a `ResumeFailed` one is retried by the next pass
      if (queue.get(pausedRun)?.state !== "paused") {
        queue.serviceEvent("validate-resumed", { ...base, ok: false, refusal: "RunNotPaused", reason: `queue run '${pausedRun}' is no longer paused` });
        continue;
      }
      try {
        await deps.resume(queue, pausedRun);
        queue.serviceEvent("validate-resumed", { ...base, ok: true });
        out.resumed.push(pausedRun);
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        queue.serviceEvent("validate-resumed", { ...base, ok: false, refusal: typeof code === "string" ? code : "ResumeFailed", reason: clip(message(e)) });
      }
    } catch { /* the next pass */ }
  }
}

/** The cap on a key's `validate-expired` events: at it the key stays recorded. */
export const MAX_EXPIRIES = 3;

/** The recorded block-cycle keys: each key's latest `validate-queued`, unless its run expired — terminal with no
 * `validation.jsonl` line newer than its creation — which records one `validate-expired` (once per run) and leaves
 * the key unrecorded, so the pass queues it again; a key with `MAX_EXPIRIES` of them stays recorded. */
export function recordedKeys(queue: Queue): Set<string> {
  const expiries = queue.serviceEvents("validate-expired");
  const expired = new Set(expiries.map((e) => String(e.detail?.run_id ?? "")));
  const count = new Map<string, number>();
  for (const e of expiries) {
    const key = str(e.detail?.key);
    if (key) count.set(key, (count.get(key) ?? 0) + 1);
  }
  const latest = new Map<string, Record<string, any>>();
  for (const ev of queue.serviceEvents("validate-queued")) {
    const d = (ev.detail ?? {}) as Record<string, any>;
    const key = str(d.key);
    if (key) latest.set(key, d);
  }
  const recorded = new Set<string>();
  for (const [key, d] of latest) {
    const runId = str(d.run_id);
    if (runId && expired.has(runId)) continue; // expired, not yet re-queued (a live run held the checkout)
    if ((count.get(key) ?? 0) >= MAX_EXPIRIES) { recorded.add(key); continue; }
    try {
      const run = runId ? queue.get(runId) : undefined;
      const issue = str(d.issue), root = str(d.root);
      if (run && isTerminal(run.state) && issue && root) {
        const line = newestValidation(root, issue);
        if (!line || !since(line.at, run.created)) {
          queue.serviceEvent("validate-expired", { key, run_id: runId, issue, state: run.state });
          continue;
        }
      }
    } catch { /* keep it recorded: the next pass looks again */ }
    recorded.add(key);
  }
  return recorded;
}

async function queueResolved(queue: Queue, deps: ResolutionDeps, out: ResolutionResult): Promise<void> {
  const shown = await deps.registry();
  const projects = shown?.projects && typeof shown.projects === "object" && !Array.isArray(shown.projects)
    ? shown.projects as Record<string, any> : {};
  const recorded = recordedKeys(queue);
  for (const project of Object.keys(projects).sort()) {
    try {
      const root = str(projects[project]?.root);
      if (!root || !jiraBound(root)) continue;
      const resolved = readInbox(root).items.filter((i) => i.state === "resolved" || i.state === "validating");
      for (const item of resolved) {
        const key = resolutionKey(project, item as Record<string, any>);
        if (!key || recorded.has(key)) continue;
        const issue = str(item.issue)!;
        const paused = pausedRunFor(queue, issue, project);
        const block = paused ? trackBlockSincePause(queue.events(paused.run_id)) : undefined;
        const story = str(block?.story_key);
        const served = paused ? servedRoot(paused) : null;
        const spec = served && story ? findSpec(served, story) ?? null : null;
        const v = await deps.resolveJob(root);
        const payload = { ...(v.definition.target?.payload ?? {}), verb: "validate", project_root: root,
          issues: [{ issue, story, paused_run: paused?.run_id ?? null, spec }] };
        const definition = { ...v.definition, target: { ...(v.definition.target ?? {}), payload } };
        const leg = plannerLeg(served, root);
        // one live run per checkout: a live one waits (enqueue would overwrite its model/effort with this leg)
        const checkout = checkoutKey(v.root);
        if (queue.runs().some((r) => r.job_id === VALIDATE_RESOLUTION_JOB && r.checkout === checkout
          && ["queued", "running", "paused", "external"].includes(r.state))) break;
        const where = deps.checkout ? await deps.checkout(v.root) : {};
        const { run, minted } = queue.enqueue({
          jobId: VALIDATE_RESOLUTION_JOB, root: v.root, projectId: v.projectId, target: v.target, definition, ...where,
          tier: "host", ...(leg.model ? { model: leg.model } : {}), ...(leg.effort ? { effort: leg.effort } : {}),
        });
        if (!minted) break; // the backstop: the rest wait for a later pass
        recorded.add(key);
        queue.serviceEvent("validate-queued", {
          key, project, root, issue, story, paused_run: paused?.run_id ?? null, spec, run_id: run.run_id,
          model: leg.model ?? null, effort: leg.effort ?? null,
        });
        out.queued.push(run.run_id);
      }
    } catch { /* this project on the next pass */ }
  }
}

/** The resolution pass (see the header). Runs right after the paused-run pass. Never throws. */
export async function resolutionPass(queue: Queue, deps: ResolutionDeps): Promise<ResolutionResult> {
  const out: ResolutionResult = { queued: [], resumed: [] };
  try { await rearm(queue, deps, out); } catch { /* the next pass */ }
  try { await queueResolved(queue, deps, out); } catch { /* the next pass */ }
  return out;
}

/** The jobs whose queued runs carry an enqueued payload (Story 31.7 `validate-resolution`, Story 32.2 `engagement-chat`). */
const PAYLOAD_JOBS: ReadonlySet<string> = new Set([VALIDATE_RESOLUTION_JOB, ENGAGEMENT_CHAT_JOB]);

/** Story 31.7: the definition a `validate-resolution` run is driven with — `defn` with the queue's stored
 * definition's `target.payload` (the payload the pass enqueued) overlaid; any other job, or no stored payload,
 * answers `defn` unchanged. Story 32.2: an `engagement-chat` run is driven with its own payload (`run.payload`, the
 * `enqueued` event's: `{engagement, project, seq}`, never the job row's, which the latest mint overwrites) plus its
 * `run_id`, over the definition's `target.payload` (`{verb: "reply"}`); no per-run payload answers `defn` unchanged. */
export function withStoredPayload(
  jobId: string, defn: Record<string, any>, stored: Record<string, any> | null | undefined,
  run?: { run_id: string; payload?: Record<string, unknown> | null } | null,
): Record<string, any> {
  if (jobId === ENGAGEMENT_CHAT_JOB) {
    const own = run?.payload;
    if (!run || !own || typeof own !== "object") return defn;
    return { ...defn, target: { ...(defn.target ?? {}), payload: { ...(defn.target?.payload ?? {}), ...own, run_id: run.run_id } } };
  }
  const payload = stored?.target?.payload;
  if (jobId !== VALIDATE_RESOLUTION_JOB || !payload || typeof payload !== "object") return defn;
  return { ...defn, target: { ...(defn.target ?? {}), payload } };
}

/** Story 31.7: a queued `validate-resolution` run is driven with the payload the pass enqueued — the stored
 * definition's `target.payload` overlaid on the invoke-skill directive `jobrun.py submit` answered (which carries
 * only the shipped type's `{verb: "validate"}`). Story 32.2: an `engagement-chat` run likewise (`{verb: "reply",
 * engagement, project, seq, run_id}`). Any other job, or a directive that is not invoke-skill, is answered unchanged. */
export function withQueuedPayload(jobId: string, woke: Record<string, any>, defn: Record<string, any> | null | undefined): Record<string, any> {
  const payload = defn?.target?.payload;
  const directive = woke?.directive;
  if (!PAYLOAD_JOBS.has(jobId) || !payload || typeof payload !== "object" || directive?.kind !== "invoke-skill") return woke;
  return { ...woke, directive: { ...directive, payload: { ...(directive.payload ?? {}), ...payload } } };
}
