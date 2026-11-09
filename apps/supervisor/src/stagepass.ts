/**
 * stagepass.ts — the stage pass, split out of `planstatus.ts` (DW-87 / TKSTUDIO-220 A); every name is re-exported there.
 *
 * Story 35.8 — the stage pass (`stagePass`, run at the end of every merge pass): for each terminal run with a
 * `plan-status` `done` `ok` event carrying `stage: true` (pulled back to `done` by a stage-capable supervisor; a run
 * merged before 35.8 gets no supervisor rows and is never back-filled), the supervisor's own Stage Log rows are built
 * from the run's queue events (the host clock): each `host-verify` leg a `host-leg` row (pass n over the close-out's
 * legs) or, carrying `rerun`, a `re-run` row (pass n), started at its `started_at` (else the event's `at`) and ended at
 * the event's `at`, its outcome read through `legVerdict`; each close-out (an `ended`, `closed_out` or `paused` event carrying
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
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { legVerdict, type HostVerifyResult } from "./hostverify";
import { canonicalPr, clip, failed, jiraBound, message, planEvents, PLAN_RETRY_LIMIT, runPr } from "./planseams";
import type { PlanStatusDeps } from "./planstatus";
import { isTerminal, selfOwner, type Queue, type QueueEvent, type QueueRun } from "./queue";
import { lastJsonObject, type RunResult } from "./server";
import { gh, studioScript, uvRunner, type WorktreeDeps } from "./worktree";


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
      const outcome = legVerdict(d as HostVerifyResult);
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
  return (done as { story_key: string; id: string; directory: string }[]).filter((d, i, all) => {
    // Story 36.3: a re-asked story's `partial` and clean records owe one set of rows.
    if (all.findIndex((x) => x.story_key === d.story_key) !== i) return false;
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
