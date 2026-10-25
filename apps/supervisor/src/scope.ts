/**
 * The engagement's scope revised from the Chat screen (Story 32.4, user flow F2 step 3, contract 0.1.27 additive): a
 * `revise` input carrying a `body` becomes the new `scope.md` and the new Confluence page (the page is authoritative
 * while `scoping`, D9). No HTTP here; `cli.ts` runs the pass at its `finally` sites and after an applied `revise` on
 * `POST /engagements/{id}/input` (`afterEngagementInput`, after the questions pass).
 *
 *   the pass     `scopePass`, per engagement its `chat-queued` events name (plus the input route's one): the record's
 *                newest `inputs[]` `revise` line that carries `payload.body`, when no `engagement-scope` service event
 *                names its `at` yet —
 *                - in `scoping`: `engage.py scope --directory <root> --engagement <id> --revise-at <at>` through
 *                  `uvRunner` (timeout 120), the body written verbatim as `scope.md` and published (unchecked);
 *                  `engagement-scope {engagement, project, revise_at, action: "published", page}` on `ok`, or
 *                  `{…, action: "refused", reason}` once for a refusal by name (`blocked`); a transient result
 *                  (`retry: true`, a spawn error, no JSON) emits nothing and the next pass calls again;
 *                - in any other state (the record moved on before the pass ran): `{…, action: "skipped",
 *                  reason: "state <s>"}` once, nothing run.
 *                A `revise` with no body changes no file (the planner's next turn rewrites the scope). An older line
 *                with a body that a newer one superseded is never run: the newest body wins.
 *                Injected deps, never throws, serialised per served root in-process only (across processes
 *                `engage.py`'s `scope.lock`, and the events re-read right before each emit).
 */
import { readEngagement, type Engagement, type InputLine } from "./engagement";
import type { Queue } from "./queue";
import { lastJsonObject, type RunResult } from "./server";
import { studioScript, uvRunner, type WorktreeDeps } from "./worktree";

export interface ScopeDeps extends WorktreeDeps {
  /** The clock (ISO stamps for the events; default now). */
  now?: () => string;
}

export interface ScopeResult { published: string[]; refused: string[]; skipped: string[] }

type Target = { root: string; engagement: string };

const SCOPE_EVENT = "engagement-scope";

/** The in-process serialisation of the pass per served root (the `questions.ts` pattern): two passes in one process
 * never both run `engage.py scope` for one line. Across processes `scope.lock` keeps the writers apart and the
 * events are re-read right before each emit. */
const rootChains = new Map<string, Promise<void>>();
function serialised(root: string, fn: () => Promise<void>): Promise<void> {
  const next = (rootChains.get(root) ?? Promise.resolve()).then(fn).catch(() => { /* this root on the next pass */ });
  rootChains.set(root, next);
  void next.then(() => { if (rootChains.get(root) === next) rootChains.delete(root); });
  return next;
}

const nowIso = (deps: ScopeDeps) => (deps.now ? deps.now() : new Date().toISOString());

/** The newest `revise` line carrying a non-empty `payload.body`, or undefined. */
export function newestReviseBody(record: Engagement): InputLine | undefined {
  return record.inputs.findLast((l) => l.verb === "revise" && typeof l.payload?.body === "string" && (l.payload.body as string).trim() !== "");
}

/** Whether an `engagement-scope` event already names this line. */
const told = (queue: Queue, project: string, engagement: string, at: string) =>
  queue.serviceEvents(SCOPE_EVENT).some((e) => e.detail?.engagement === engagement && e.detail?.project === project && e.detail?.revise_at === at);

/** `engage.py scope --revise-at` on the host: the parsed result, or null on a transient failure (a spawn error, no
 * JSON, `retry: true`). */
async function runScope(deps: ScopeDeps, t: Target, at: string): Promise<Record<string, any> | null> {
  let r: RunResult;
  const args = ["scope", "--directory", t.root, "--engagement", t.engagement, "--revise-at", at];
  try { r = await uvRunner(deps)(t.root, studioScript(deps, "lib", "engage.py"), args, 120); } catch { return null; }
  const out = lastJsonObject(r.stdout) as Record<string, any> | null;
  if (!out || typeof out.status !== "string" || out.retry === true) return null;
  return out;
}

/** One engagement: its newest `revise` body, once. */
async function scopeStep(queue: Queue, deps: ScopeDeps, t: Target, out: ScopeResult): Promise<void> {
  const record = readEngagement(t.root, t.engagement);
  if (!record) return;
  const line = newestReviseBody(record);
  if (!line) return;
  const project = record.project;
  if (told(queue, project, t.engagement, line.at)) return;
  const base = { engagement: t.engagement, project, revise_at: line.at };
  if (record.state !== "scoping") {
    queue.serviceEvent(SCOPE_EVENT, { ...base, action: "skipped", reason: `state ${record.state}` }, nowIso(deps));
    out.skipped.push(t.engagement);
    return;
  }
  const r = await runScope(deps, t, line.at);
  if (!r) return; // transient: nothing, the next pass calls again
  if (told(queue, project, t.engagement, line.at)) return; // another process emitted it meanwhile
  if (r.ok === true && r.status === "complete") {
    queue.serviceEvent(SCOPE_EVENT, { ...base, action: "published", page: r.page ?? null }, nowIso(deps));
    out.published.push(t.engagement);
    return;
  }
  if (r.status !== "blocked") return;
  const reason = typeof r.reason === "string" && r.reason !== "" ? r.reason : "engage refused";
  queue.serviceEvent(SCOPE_EVENT, { ...base, action: "refused", reason }, nowIso(deps));
  out.refused.push(t.engagement);
}

/**
 * The scope pass (see the header). `only`: one engagement (the input route's). Never throws.
 */
export async function scopePass(queue: Queue, deps: ScopeDeps = {}, only?: Target): Promise<ScopeResult> {
  const out: ScopeResult = { published: [], refused: [], skipped: [] };
  try {
    const targets = new Map<string, Target>();
    const key = (t: Target) => `${t.root}\u0000${t.engagement}`;
    if (only) targets.set(key(only), { ...only });
    for (const ev of queue.serviceEvents("chat-queued")) {
      const d = ev.detail ?? {};
      const runId = typeof d.run_id === "string" ? d.run_id : null;
      const engagement = typeof d.engagement === "string" ? d.engagement : null;
      if (!runId || !engagement) continue;
      // the served registry root the run's payload carries (as chatSpendPass reads it)
      const served = queue.runPayload(runId)?.project_root;
      const root = typeof served === "string" && served !== "" ? served : queue.get(runId)?.root;
      if (!root) continue;
      const t = { root, engagement };
      if (only && key(t) !== key(only)) continue;
      targets.set(key(t), t);
    }
    for (const t of targets.values()) {
      await serialised(t.root, async () => {
        try { await scopeStep(queue, deps, t, out); } catch { /* this engagement on the next pass */ }
      });
    }
  } catch { /* the next pass */ }
  return out;
}
