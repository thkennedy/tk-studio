/**
 * sweep.ts — the `run-sweep` job type's supervisor half (Story 35.7).
 *
 *   type       a run is a sweep when its resolved definition's `type` or `id` is `run-sweep` (`isSweep`, decided in the
 *              engine sweep as `isSlice` is). Its launch (`tk-studio-launch` verb `sweep`) started `bmad-loop sweep
 *              --no-prompt` detached in the run's worktree; every bundle commits in place on `supervisor/run-<id>`
 *              (`scm.isolation = "none"`), so one sweep is one branch and one PR.
 *   triage     `recordTriage`, from the engine sweep's watch: the first time `<served root>/.bmad-loop/runs/<engine
 *              id>/triage.json` exists it is copied (atomically) to the run workspace, `<studioHome>/projects/<key>/
 *              runs/<studio run id>/sweep/triage.json`, and noted once as a queue `sweep-triage {engine_run_id, path,
 *              bundles: [{name, dw_ids}], blocked: [{id, blocker}], decisions: [{id, question}], already_resolved:
 *              [id], skip: [id]}` — never re-noted for that engine run. A file that does not parse once it is a minute
 *              old (the engine writes it in place) is noted once as `sweep-triage {engine_run_id, error}`. This is the
 *              queue's store: the ledger's `sweep-triage` event has `launch.py sweep` as its only emitter, and
 *              bmad-loop's own journal key of that name is never read or written.
 *   cycles     under `[sweep] repeat = true` the engine re-triages per cycle into `triage-<N>.json` (N ≥ 2): the summary
 *              reads `triage.json` then `triage-2.json`, … to the first missing; each bundle carries its cycle and key
 *              (`dw-<name>` for cycle 1, `dw<N>-<name>` for N), and blocked, decisions, already_resolved and skip are
 *              the union by id, the latest cycle's entry winning. The `sweep-triage` note stays the first triage's.
 *   landed     a bundle landed when the engine journal holds its bundle ledger-close kind (`sweep-bundle-closed` or
 *              `sweep-bundle-reclosed`) for its key, else when `tasks/<key>/result.json` reads `status: done`;
 *              a paused sweep's bundle (`paused_story_key`) is `not landed — paused at <stage>`; one the engine cut by
 *              `max_bundles` (`sweep-bundles-truncated {dropped}`) or skipped (`sweep-bundle-skipped {name}`) is
 *              `not landed — dropped by max_bundles` / `not landed — skipped by the engine`, still counted in n.
 *   PR body    `## Sweep` before `## Host verify` (`sweepSection`): one line per bundle, `### Blocked`, `### Human
 *              decisions` (skipped unattended; `bmad-loop decisions` answers them).
 *   end        `sweepEndState`: every bundle landed (or none triaged) and the host leg green or skipped → `complete`;
 *              some landed and some not, or the leg red or inconclusive → `partial`; no triage, or bundles and none
 *              landed → `blocked` (no triage because the engine journaled `sweep-nothing-open`: the reason says the
 *              ledger had nothing open, never an escalation). A paused sweep is closed out the same way once its engine is stopped
 *              (`stopSweepEngine`, before the close-out is taken; a failed stop is noted once as `engine-stop
 *              {engine_run_id, error}`, the run and its worktree left as they are and the stop retried next tick),
 *              never relaunched through `closeOutPaused`. A sweep the supervisor killed keeps the kill's state and
 *              reason (`; sweep: <notice>` appended). A late close-out (a terminal run) records the rule's end on
 *              its `closed_out` as `sweep_end`, beside the `sweep` record.
 *   ledger     `ledgerPass`, after the stage pass in every merge pass: each terminal sweep run whose PR is `MERGED`,
 *              under its `plan-lease {phase: "ledger"}`, calls `plansync.py ledger-resolve --directory <the run's
 *              root — already the owner checkout's served root, `<top-level>/<prefix>`, where the worktree's
 *              `<worktree>/<prefix>` ledger lands; never `<root>/<prefix>`> --pr <pr> --ids <landed bundles' dw_ids + already_resolved>` — one `ledger-resolve {pr, ids,
 *              resolved, pending, ok, settled?, error?, skipped?, reason?}` event per attempt; `pending` (the owner
 *              checkout has not pulled the merge) retries on the next tick, bounded by `PLAN_RETRY_LIMIT`. The
 *              supervisor commits nothing: the rewrite lands at the owner root as the Stage Log rows do.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pluginRoot, sbxBin } from "./env";
import { inconclusiveReason, isInconclusive, isRed, redReason, type HostVerifyResult } from "./hostverify";
import { registerSweepLine } from "./hygiene";
import { PLAN_RETRY_LIMIT, runPr, type PlanStatusDeps } from "./planstatus";
import { isTerminal, selfOwner, servedRoot, type Queue, type QueueEvent, type QueueRun, type TerminalState } from "./queue";
import { studioRunDir } from "./sandbox";
import { lastJsonObject, runProcess, toVmPath, type RunResult } from "./server";
import { gh, studioScript, uvRunner, type WorktreeDeps } from "./worktree";

type Env = Record<string, string | undefined>;

/** Story 35.7: the shipped job type whose runs are deferred-work sweeps. */
export const SWEEP_JOB_TYPE = "run-sweep";
/** A run is a sweep when its resolved definition's `type` or `id` is `run-sweep`. */
export const isSweep = (defn: Record<string, any> | null | undefined): boolean =>
  !!defn && (defn.type === SWEEP_JOB_TYPE || defn.id === SWEEP_JOB_TYPE);
/** The queue event the watch notes once per engine run (never the ledger's, never bmad-loop's journal key). */
export const SWEEP_TRIAGE = "sweep-triage";
/** A paused sweep's failed engine stop, noted once per engine run (the watch retries the stop each tick). */
export const SWEEP_ENGINE_STOP = "engine-stop";
/** The plan lease phase the ledger pass holds while it calls. */
export const LEDGER_LEASE = "ledger";
/** One ledger pass attempt's event. */
export const LEDGER_RESOLVE = "ledger-resolve";
/** The bundle ledger-close kinds bmad-loop journals (`sweep.py _close_bundle_ledger_when_spec_status`). */
export const BUNDLE_CLOSE_KINDS = ["sweep-bundle-closed", "sweep-bundle-reclosed"] as const;
/** The engine journal's `max_bundles` cut (`sweep.py`: `sweep-bundles-truncated {dropped: [name]}`). */
export const BUNDLES_TRUNCATED = "sweep-bundles-truncated";
/** The engine journal's skipped bundle (`sweep.py`: `sweep-bundle-skipped {name, dw_ids, reason}`). */
export const BUNDLE_SKIPPED = "sweep-bundle-skipped";
/** The engine journal's later-cycle start (`sweep.py`: `sweep-cycle {cycle, open}`; cycle 1 journals none). */
export const SWEEP_CYCLE = "sweep-cycle";
/** The engine journal's empty-ledger end (`sweep.py`): no triage.json is ever written. */
export const NOTHING_OPEN = "sweep-nothing-open";
/** An unparseable triage.json is noted only once it is this old (the engine writes it in place). */
export const TRIAGE_SETTLE_MS = 60_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);

export type Triage = {
  /** `cycle`: set on a summary's merged triage (1 for `triage.json`, N for `triage-<N>.json`). */
  bundles: { name: string; dw_ids: string[]; cycle?: number }[];
  blocked: { id: string; blocker: string }[];
  decisions: { id: string; question: string }[];
  already_resolved: string[];
  skip: string[];
};

const objects = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? str((x as Record<string, unknown>).id) : str(x))).filter(Boolean) : [];

/** The partition's summary (bmad-loop-sweep's result schema), or undefined when `raw` is not an object. */
export function parseTriage(raw: unknown): Triage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  return {
    bundles: objects(r.bundles).map((b) => ({ name: str(b.name), dw_ids: Array.isArray(b.dw_ids) ? b.dw_ids.filter((i): i is string => typeof i === "string") : [] })),
    blocked: objects(r.blocked).map((b) => ({ id: str(b.id), blocker: str(b.blocker) })),
    decisions: objects(r.decisions).map((d) => ({ id: str(d.id), question: str(d.question) })),
    already_resolved: ids(r.already_resolved),
    skip: ids(r.skip),
  };
}

/** `<served root>/.bmad-loop/runs/<engine id>`. */
export const engineRunDir = (served: string, engineRunId: string) => join(served, ".bmad-loop", "runs", engineRunId);

/** The engine's triage (`file`: a later cycle's `triage-<N>.json`): undefined when there is no file yet; `error`
 * when it does not parse. */
export function readTriage(runDir: string, file = "triage.json"): { triage: Triage; text: string } | { error: string; mtimeMs: number } | undefined {
  const path = join(runDir, file);
  if (!existsSync(path)) return undefined;
  let text = "", mtimeMs = 0;
  try { text = readFileSync(path, "utf-8"); mtimeMs = statSync(path).mtimeMs; }
  catch (e) { return { error: clip(message(e)), mtimeMs: Date.now() }; }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { error: clip(message(e)), mtimeMs }; }
  const triage = parseTriage(raw);
  return triage ? { triage, text } : { error: `${file} is not a JSON object`, mtimeMs };
}

/** `path` written atomically (a temp file renamed over it). */
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try { writeFileSync(tmp, text, "utf-8"); renameSync(tmp, path); }
  finally { try { rmSync(tmp, { force: true }); } catch { /* renamed */ } }
}

/** The run's `sweep-triage` note for its current engine run, if any. */
export const triageNote = (events: readonly QueueEvent[], engineRunId: string | null | undefined): QueueEvent | undefined =>
  engineRunId ? events.findLast((e) => e.kind === SWEEP_TRIAGE && e.detail?.engine_run_id === engineRunId) : undefined;

/** Record the triage once per engine run (see the header). Answers what it did. Never throws. */
export function recordTriage(
  queue: Queue, run: Pick<QueueRun, "run_id" | "worktree" | "prefix" | "engine_run_id" | "studio_run_id" | "project_id" | "root">,
  env: Env = process.env, now: () => number = Date.now,
): "recorded" | "error" | "seen" | "absent" | "waiting" {
  try {
    const eid = run.engine_run_id;
    const served = servedRoot(run);
    if (!eid || !served) return "absent";
    if (triageNote(queue.events(run.run_id), eid)) return "seen";
    const read = readTriage(engineRunDir(served, eid));
    if (!read) return "absent";
    if ("error" in read) {
      if (now() - read.mtimeMs < TRIAGE_SETTLE_MS) return "waiting"; // perhaps mid-write: read again next tick
      queue.note(run.run_id, SWEEP_TRIAGE, { engine_run_id: eid, error: read.error });
      return "error";
    }
    let path: string | undefined, copyError: string | undefined;
    if (run.studio_run_id) {
      try {
        path = join(studioRunDir(run, run.studio_run_id, env), "sweep", "triage.json");
        writeAtomic(path, read.text);
      } catch (e) { path = undefined; copyError = clip(message(e)); }
    } else copyError = "no studio run recorded";
    queue.note(run.run_id, SWEEP_TRIAGE, { engine_run_id: eid, ...(path ? { path } : {}), ...(copyError ? { copy_error: copyError } : {}), ...read.triage });
    return "recorded";
  } catch { return "absent"; }
}

export type BundleOutcome = { name: string; dw_ids: string[]; cycle: number; key: string; landed: boolean; why?: string };
/** A sweep's close-out view: the triage (undefined: none was ever written; every cycle's, merged) and each bundle's
 * outcome. `nothing_open`: no triage because the engine journaled `sweep-nothing-open`. */
export type SweepSummary = { triage?: Triage; bundles: BundleOutcome[]; triage_error?: string; nothing_open?: boolean };

/** The engine's task key of a cycle's bundle (`sweep.py _bundle_key`). */
export const bundleKey = (name: string, cycle: number) => (cycle === 1 ? `dw-${name}` : `dw${cycle}-${name}`);
const BUNDLE_KEY_RE = /^dw\d*-(.+)$/;

/** The engine journal's bundle records, read only (unparsable lines skipped), each as its bundle key: `closed`, the
 * bundle ledger-close keys; `dropped`, the bundles `sweep-bundles-truncated {dropped}` cut by `max_bundles`;
 * `skipped`, those `sweep-bundle-skipped {name}` skipped — both keyed by the cycle the latest `sweep-cycle {cycle}`
 * opened (1 before any). `nothingOpen`: a `sweep-nothing-open` record. */
function journalBundles(runDir: string): { closed: Set<string>; dropped: Set<string>; skipped: Set<string>; nothingOpen: boolean } {
  const out = { closed: new Set<string>(), dropped: new Set<string>(), skipped: new Set<string>(), nothingOpen: false };
  let text = "";
  try { text = readFileSync(join(runDir, "journal.jsonl"), "utf-8"); } catch { return out; }
  let cycle = 1;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (!e || typeof e !== "object") continue;
      if ((BUNDLE_CLOSE_KINDS as readonly string[]).includes(e.kind) && typeof e.story_key === "string") out.closed.add(e.story_key);
      else if (e.kind === SWEEP_CYCLE && Number.isInteger(e.cycle) && e.cycle >= 1) cycle = e.cycle;
      else if (e.kind === BUNDLES_TRUNCATED && Array.isArray(e.dropped)) {
        for (const n of e.dropped) if (typeof n === "string") out.dropped.add(bundleKey(n, cycle));
      } else if (e.kind === BUNDLE_SKIPPED && typeof e.name === "string") out.skipped.add(bundleKey(e.name, cycle));
      else if (e.kind === NOTHING_OPEN) out.nothingOpen = true;
    } catch { /* an unparsable line is skipped */ }
  }
  return out;
}

/** `tasks/<bundle key>/result.json` reads `status: done`. */
function resultDone(runDir: string, key: string): boolean {
  try {
    const r = JSON.parse(readFileSync(join(runDir, "tasks", key, "result.json"), "utf-8"));
    return typeof r?.status === "string" && r.status.trim().toLowerCase() === "done";
  } catch { return false; }
}

/** The cycles' triages merged (see the header): bundles in cycle order, each with its cycle; the id lists the union
 * by id, the latest cycle's entry winning. */
function mergeTriages(cycles: Triage[]): Triage {
  const byId = <T extends { id: string }>(pick: (t: Triage) => T[]) => {
    const m = new Map<string, T>();
    for (const t of cycles) for (const x of pick(t)) m.set(x.id, x);
    return [...m.values()];
  };
  const union = (pick: (t: Triage) => string[]) => [...new Set(cycles.flatMap(pick))];
  return {
    bundles: cycles.flatMap((t, i) => t.bundles.map((b) => ({ name: b.name, dw_ids: b.dw_ids, cycle: i + 1 }))),
    blocked: byId((t) => t.blocked), decisions: byId((t) => t.decisions),
    already_resolved: union((t) => t.already_resolved), skip: union((t) => t.skip),
  };
}

/** The sweep's close-out summary, read before the close-out removes the worktree: the first triage from the run's
 * `sweep-triage` note (else the engine's file), then each later cycle's `triage-<N>.json`; each bundle landed or not.
 * `paused`: the engine's paused detail. */
export function sweepSummary(
  queue: Queue, run: Pick<QueueRun, "run_id" | "worktree" | "prefix" | "engine_run_id">, paused?: Record<string, unknown>,
): SweepSummary {
  const served = servedRoot(run);
  const eid = run.engine_run_id;
  const runDir = served && eid ? engineRunDir(served, eid) : undefined;
  let first: Triage | undefined, triageError: string | undefined;
  const note = triageNote(queue.events(run.run_id), eid);
  if (note && typeof note.detail?.error !== "string") first = parseTriage(note.detail);
  else if (runDir) {
    const read = readTriage(runDir);
    if (read && "triage" in read) first = read.triage;
    else if (read) triageError = read.error;
  }
  if (!first && typeof note?.detail?.error === "string") triageError = note.detail.error;
  const cycles: Triage[] = first ? [first] : [];
  // a later cycle's triage only follows a first one; stop at the first missing N (an unreadable one stops it too)
  for (let n = 2; first && runDir; n++) {
    const read = readTriage(runDir, `triage-${n}.json`);
    if (!read || !("triage" in read)) break;
    cycles.push(read.triage);
  }
  const triage = cycles.length ? mergeTriages(cycles) : undefined;
  const journal = runDir ? journalBundles(runDir) : { closed: new Set<string>(), dropped: new Set<string>(), skipped: new Set<string>(), nothingOpen: false };
  const pausedKey = typeof paused?.paused_story_key === "string" && BUNDLE_KEY_RE.test(paused.paused_story_key) ? paused.paused_story_key : undefined;
  const bundles = (triage?.bundles ?? []).map((b): BundleOutcome => {
    const cycle = b.cycle ?? 1, key = bundleKey(b.name, cycle);
    const base = { name: b.name, dw_ids: b.dw_ids, cycle, key };
    if (journal.closed.has(key) || (runDir && resultDone(runDir, key))) return { ...base, landed: true };
    // Still counted in n (every triaged bundle landed, or not): a bundle the engine never ran says why.
    const why = paused && pausedKey === key ? `paused at ${String(paused.paused_stage ?? "?")}`
      : journal.dropped.has(key) ? "dropped by max_bundles"
      : journal.skipped.has(key) ? "skipped by the engine"
      : paused && !pausedKey ? `the sweep paused at ${String(paused.paused_stage ?? "?")}`
      : "no ledger close in the engine journal";
    return { ...base, landed: false, why };
  });
  return { ...(triage ? { triage } : {}), bundles, ...(triageError ? { triage_error: triageError } : {}), ...(!triage && journal.nothingOpen ? { nothing_open: true } : {}) };
}

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");

/** The inbox line's content (after `sweep: `): `<landed>/<n> bundles; blocked: DW-x, …; decisions: DW-y, …`. */
export function sweepNotice(s: SweepSummary): string {
  if (!s.triage) return s.nothing_open ? "nothing open in the ledger" : "no triage (escalated)";
  const landed = s.bundles.filter((b) => b.landed).length;
  return `${landed}/${s.bundles.length} bundles; blocked: ${list(s.triage.blocked.map((b) => b.id))}; decisions: ${list(s.triage.decisions.map((d) => d.id))}`;
}

// A terminal sweep run's inbox line before its close-out records one (a cancel): read live from its worktree.
registerSweepLine((queue, run) => (isSweep(queue.definition(run)) ? sweepNotice(sweepSummary(queue, run)) : undefined));

/** The PR body's `## Sweep` section (lines), before `## Host verify`. */
export function sweepSection(s: SweepSummary): string[] {
  if (!s.triage && s.nothing_open) return ["## Sweep", "", "No triage recorded: the ledger had nothing open (`sweep-nothing-open`)."];
  if (!s.triage) {
    return ["## Sweep", "", `No triage recorded: the sweep's triage escalated before any triage.json${s.triage_error ? ` (${s.triage_error})` : ""}.`];
  }
  const t = s.triage;
  return [
    "## Sweep",
    "",
    ...(s.bundles.length ? s.bundles.map((b) => `- ${b.name}${b.cycle > 1 ? ` (cycle ${b.cycle})` : ""} (${b.dw_ids.join(", ")}): ${b.landed ? "landed" : `not landed — ${b.why ?? "unknown"}`}`) : ["No bundles."]),
    "",
    "### Blocked",
    "",
    ...(t.blocked.length ? t.blocked.map((b) => `- ${b.id}: ${b.blocker}`) : ["none"]),
    "",
    "### Human decisions",
    "",
    ...(t.decisions.length
      ? [...t.decisions.map((d) => `- ${d.id}: ${d.question}`), "", "Skipped unattended (`--no-prompt`): `bmad-loop decisions` answers them."]
      : ["none"]),
  ];
}

/** The sweep's end (see the header): the state and its reason. */
export function sweepEndState(s: SweepSummary, verify?: HostVerifyResult): { state: TerminalState; reason: string } {
  const line = `sweep: ${sweepNotice(s)}`;
  if (!s.triage && s.nothing_open) return { state: "blocked", reason: "sweep: nothing open in the ledger" };
  if (!s.triage) return { state: "blocked", reason: `sweep: no triage.json (the triage escalated)${s.triage_error ? `: ${s.triage_error}` : ""}` };
  const landed = s.bundles.filter((b) => b.landed).length;
  if (s.bundles.length && !landed) return { state: "blocked", reason: `${line}; no bundle landed` };
  if (isRed(verify)) return { state: "partial", reason: `${redReason(verify)}; ${line}` };
  if (isInconclusive(verify)) return { state: "partial", reason: `${inconclusiveReason(verify)}; ${line}` };
  if (landed < s.bundles.length) return { state: "partial", reason: line };
  return { state: "complete", reason: line };
}

/** The `sweep` record an `ended` (or `closed_out`) event carries: the inbox line, each bundle's outcome (a later
 * cycle's with its `cycle`), and every cycle's already-resolved ids (the ledger pass's input). */
export function sweepRecord(s: SweepSummary): Record<string, unknown> {
  return {
    notice: sweepNotice(s), triage: !!s.triage,
    bundles: s.bundles.map((b) => ({ name: b.name, dw_ids: b.dw_ids, ...(b.cycle > 1 ? { cycle: b.cycle } : {}), landed: b.landed, ...(b.why ? { why: b.why } : {}) })),
    already_resolved: s.triage?.already_resolved ?? [],
  };
}

/** A paused sweep's engine stopped (`launch.py stop`; on sbx inside the run's sandbox): `stopped`, else the failure.
 * Never throws. */
export async function stopSweepEngine(run: Pick<QueueRun, "worktree" | "prefix" | "engine_run_id" | "tier" | "sandbox">, deps: WorktreeDeps = {}): Promise<string> {
  const served = servedRoot(run), eid = run.engine_run_id;
  if (!served || !eid) return "not stopped: no engine recorded";
  const env = deps.env ?? process.env;
  let r: RunResult;
  try {
    if (run.tier === "sbx" && run.sandbox) {
      const argv = ["exec", run.sandbox, "uv", "run", `${toVmPath(pluginRoot(env)).replace(/\/+$/, "")}/lib/launch.py`, "stop", "--directory", toVmPath(served), "--run-id", eid];
      r = await (deps.sbx?.run ?? ((b, a, o) => runProcess(b, a, { timeoutS: o.timeoutS })))(sbxBin(env), argv, { timeoutS: 120 });
    } else {
      r = await uvRunner(deps)(served, studioScript(deps, "lib", "launch.py"), ["stop", "--directory", served, "--run-id", eid], 120);
    }
  } catch (e) { return `stop failed: ${clip(message(e))}`; }
  return r.exit === 0 ? "stopped" : `stop failed: exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;
}

// ------------------------------------------------------------ the ledger pass

/** The ids a merged sweep's ledger pass flips: the landed bundles' `dw_ids`, then the triage's already-resolved
 * ids, from the run's `ended` (else `closed_out`) `sweep` record; undefined when no record. */
export function ledgerIds(events: readonly QueueEvent[]): string[] | undefined {
  const rec = events.findLast((e) => (e.kind === "ended" || e.kind === "closed_out") && e.detail?.sweep && typeof e.detail.sweep === "object")?.detail?.sweep as Record<string, any> | undefined;
  if (!rec) return undefined;
  const out: string[] = [];
  for (const b of Array.isArray(rec.bundles) ? rec.bundles : []) {
    if (b?.landed === true && Array.isArray(b.dw_ids)) out.push(...b.dw_ids.filter((i: unknown): i is string => typeof i === "string"));
  }
  if (Array.isArray(rec.already_resolved)) out.push(...rec.already_resolved.filter((i: unknown): i is string => typeof i === "string"));
  return [...new Set(out)];
}

const ledgerSettled = (events: readonly QueueEvent[]) => events.some((e) => e.kind === LEDGER_RESOLVE && e.detail?.settled === true);

/** The ledger pass (see the header). Answers the runs it recorded on. Never throws. */
export async function ledgerPass(queue: Queue, deps: PlanStatusDeps = {}): Promise<string[]> {
  const out: string[] = [];
  let runs: QueueRun[];
  try { runs = queue.runs().filter((r) => isTerminal(r.state) && r.worktree); } catch { return out; }
  for (const run of runs) {
    try {
      if (!isSweep(queue.definition(run))) continue;
      const events = queue.events(run.run_id);
      if (ledgerSettled(events)) continue;
      const ids = ledgerIds(events);
      const pr = runPr(events);
      if (!ids || !pr) continue;
      let view: Record<string, unknown> | null = null;
      try {
        const r = await gh(deps, run.root, ["pr", "view", pr, "--json", "state,mergedAt"]);
        view = r.exit === 0 ? lastJsonObject(r.stdout) as Record<string, unknown> | null : null;
      } catch { continue; }
      const state = typeof view?.state === "string" ? view.state.toUpperCase() : undefined;
      if (state !== "MERGED" && state !== "CLOSED") continue; // OPEN, or gh failed: asked again next tick
      const self = deps.self ?? selfOwner();
      if (!queue.claimPlanPhase(run.run_id, LEDGER_LEASE, self)) continue;
      let settle = false;
      try {
        const now = queue.events(run.run_id);
        if (ledgerSettled(now)) { settle = true; continue; }
        const base = { pr, ids };
        let detail: Record<string, unknown>;
        let retry: string | undefined;
        if (state === "CLOSED") detail = { ...base, resolved: [], pending: [], ok: false, settled: true, skipped: true, reason: "pr closed unmerged" };
        else if (!ids.length) detail = { ...base, resolved: [], pending: [], ok: true, settled: true, reason: "no landed bundle or already-resolved entry to flip" };
        else {
          let r: RunResult | undefined, threw: string | undefined;
          try {
            r = await uvRunner(deps)(run.root, studioScript(deps, "lib", "plansync.py"),
              ["ledger-resolve", "--directory", run.root, "--pr", pr, "--ids", ids.join(",")], 120);
          } catch (e) { threw = `plansync.py ledger-resolve: ${clip(message(e))}`; }
          const o = r ? lastJsonObject(r.stdout) as Record<string, any> | null : null;
          if (!o) {
            retry = threw ?? `plansync.py ledger-resolve exit ${r?.exit}: ${clip(r?.stderr || r?.stdout || "")}`;
            detail = { ...base, resolved: [], pending: ids, ok: false, error: retry };
          } else {
            const resolved = Array.isArray(o.resolved) ? o.resolved : [];
            const pending = Array.isArray(o.pending) ? o.pending : [];
            const ok = r!.exit === 0 && o.ok === true;
            detail = { ...base, resolved, pending, ok, ...(!ok ? { error: clip(String(o.error ?? o.reason ?? "refused")) } : {}) };
            if (!ok && o.retryable === true) retry = String(detail.error);
            else if (ok && pending.length) retry = `pending: ${pending.join(", ")}`;
            else detail.settled = true; // done, or a refusal: never retried
          }
        }
        if (retry !== undefined) {
          const tries = now.filter((e) => e.kind === "plan-lease" && e.detail?.phase === LEDGER_LEASE && e.detail?.owner === null && e.detail?.settled !== true).length;
          if (tries >= PLAN_RETRY_LIMIT) detail = { ...detail, settled: true, skipped: true, reason: `gave up after ${tries + 1} attempts: ${retry}` };
        }
        try { queue.note(run.run_id, LEDGER_RESOLVE, detail); settle = detail.settled === true; }
        catch { /* a busy queue: the next tick */ }
        out.push(run.run_id);
      } finally {
        try { queue.releasePlanPhase(run.run_id, LEDGER_LEASE, self, settle); } catch { /* a dead owner's lease is re-taken */ }
      }
    } catch { /* the next tick tries again */ }
  }
  return out;
}
