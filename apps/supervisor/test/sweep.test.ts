// Story 35.7: the `run-sweep` job type's supervisor half — the triage record, the `## Sweep` PR body, the inbox
// line, the three-way end, a paused sweep closed out (never relaunched), and the ledger pass after the merge.
// Pinned against a real throwaway repository (a bare `origin`), the fake `gh` and an injected studio-script runner.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFERRED_REL, jobRunCosts, spendByEpic } from "../src/board";
import { cancelRun, mirror } from "../src/cli";
import { closeOutPaused } from "../src/closeout";
import { endNotice, noticeText } from "../src/hygiene";
import { runCost } from "../src/inbox";
import { mergePass, PLAN_RETRY_LIMIT } from "../src/planstatus";
import { ENGINE_RELEASED, heldEngine, Queue, type QueueEvent } from "../src/queue";
import { engineStopArgv } from "../src/runners";
import { runProcess, toVmPath, type RunResult } from "../src/server";
import {
  emitTriage, engineCostOf, isSweep, ledgerRemedyText, ledgerResolveCommand, stopEngine, sweepStageLogText, SWEEP_ENGINE_PROBE, SWEEP_LEDGER_WAIT_MS, SWEEP_STOP_DEADLINE_MS, sweepRecord, sweepStopPastDeadline, LEDGER_LEASE, LEDGER_RESOLVE, ledgerFingerprint, ledgerPass, recordTriage, summaryFromRecord, SWEEP_ENGINE_STOP, SWEEP_JOB_TYPE, SWEEP_TRIAGE, sweepCostText,
  sweepEndState, sweepSection, sweepTotalCost, withEngineCost, type SweepSummary,
} from "../src/sweep";
import { answerDecisions, parseTriage, postDecisions, SWEEP_DECISIONS_ANSWERED, SWEEP_DECISIONS_POSTED, sweepSummary } from "../src/sweep";
import { launchedCloseOutInput, prBody, prepareWorktree, releaseHeldEngines, sweepEngines, wipMessage, type WorktreeDeps } from "../src/worktree";
import { fakeGh, FIXTURE_POLICY, gitRepo, testGit } from "./fakes";
import { tempDir } from "./tmp";

const me = { pid: process.pid, host: hostname(), nonce: "sweep-test" };
const PR = "https://github.com/acme/widget/pull/42";

const TRIAGE = {
  workflow: "deferred-sweep-triage",
  open_ids: ["DW-1", "DW-2", "DW-3", "DW-4", "DW-5", "DW-6"],
  already_resolved: [{ id: "DW-6", evidence: "lib/x.py:1" }],
  bundles: [{ name: "a", dw_ids: ["DW-1", "DW-2"], intent: "one goal" }, { name: "b", dw_ids: ["DW-3"], intent: "another" }],
  blocked: [{ id: "DW-4", blocker: "Story 36.1 must land first" }],
  skip: [],
  decisions: [{ id: "DW-5", question: "keep or drop?", context: "c", options: [], recommendation: "1" }],
  escalations: [],
};

/** A launched `run-sweep` run in its own worktree (engine `E1`), the studio-script runner recording every call.
 * `prefix`: the project lies below its git top-level (`<checkout>/<prefix>`, served at `<worktree>/<prefix>`).
 * Story 38.3: `sandbox` places the run on the sbx tier, pinned to that sandbox: the engine's status and stop go through
 * the fake `sbx` runner (`exec <sb> uv run …/launch.py status|stop`, answered from `answers`), which records every argv
 * (`sbxCalls`: the pin's release is `["stop", <sb>]`), and the release's engine MCP stop is recorded (`mcpStops`). */
async function sweepFixture(opts: { prefix?: string; sandbox?: string } = {}) {
  const repo = gitRepo(opts.prefix ? { [`${opts.prefix}.keep`]: "" } : {});
  const root = opts.prefix ? join(repo.checkout, opts.prefix) : repo.checkout;
  // Story 38.5 (CAP-14): a prefixed project's checkout holds its own untracked policy (a run worktree with none is refused).
  if (opts.prefix) { mkdirSync(join(root, ".bmad-loop"), { recursive: true }); writeFileSync(join(root, ".bmad-loop", "policy.toml"), FIXTURE_POLICY); }
  const gh = fakeGh();
  const work = tempDir("tk-sup-sweep-work-");
  const home = tempDir("tk-sup-sweep-home-");
  const studio: { script: string; args: string[]; root: string }[] = [];
  const verbs: string[][] = [];
  const answers = {
    launch: { ok: true, run: { status: "running" } } as unknown,
    ledger: [] as { exit: number; out: unknown }[],
    /** `launch.py stop`'s answer (exit 0: stopped). */
    stop: { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" } as RunResult,
    engineLive: true,
    /** Story 36.2: `meter.py price-run`'s answer (default: refused, the close-out stands on the worker's cost). */
    price: { exit: 2, stdout: JSON.stringify({ ok: false, error: "no price table here" }), stderr: "" } as RunResult,
    /** Story 36.2: `ledger.py emit`'s answer. */
    emit: { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" } as RunResult,
    /** Story 38.3: `plansync.py stage --from-run`'s answer (default: refused, the body says the Stage Log was not read). */
    stageRows: { exit: 2, stdout: JSON.stringify({ ok: false, error: "no stage rows here" }), stderr: "" } as RunResult,
    /** Story 38.4: `track.py block --source sweep`'s answer (default: refused). */
    track: { exit: 2, stdout: JSON.stringify({ ok: false, status: "blocked", reason: "track refused: no binding here" }), stderr: "" } as RunResult,
    /** Story 38.4: any other `sbx exec` (the engine's `decisions` verb), answered here when set. */
    sbx: undefined as ((args: string[]) => RunResult | undefined) | undefined,
  };
  const env = { ...process.env, TK_SUPERVISOR_WORK: work, GH_BIN: gh.bin, TK_STUDIO_ROOT: "/studio-root", TK_STUDIO_HOME: home };
  const sbxCalls: string[][] = [];
  const mcpStops: string[] = [];
  const sbxLaunch = (args: string[]) => args[0] === "exec" && args[2] === "uv" && args[3] === "run" && /\/launch\.py$/.test(args[4] ?? "") ? args[5] : undefined;
  const deps: WorktreeDeps & { self: typeof me } = {
    env, self: me,
    ...(opts.sandbox ? { sbx: {
      run: async (_bin: string, args: string[]): Promise<RunResult> => {
        sbxCalls.push(args);
        if (sbxLaunch(args) === "status") return { exit: 0, stdout: JSON.stringify(answers.launch), stderr: "" };
        if (sbxLaunch(args) === "stop") return answers.stop;
        return answers.sbx?.(args) ?? { exit: 0, stdout: "", stderr: "" };
      },
      stopEngineMcp: async (_q: Queue, runId: string) => { mcpStops.push(runId); return true; },
    } } : {}),
    run: (bin, args, o) => runProcess(bin, args, { cwd: o.cwd, timeoutS: o.timeoutS, env: { ...env, ...(o.env ?? {}) } }),
    uv: async (root, script, args): Promise<RunResult> => {
      studio.push({ script, args, root });
      if (script.endsWith("install_base.py")) return { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
      if (script.endsWith("drift_check.py")) return { exit: 0, stdout: JSON.stringify({ ok: true, result: "clean" }), stderr: "" };
      if (script.endsWith("launch.py") && args[0] === "stop") return answers.stop;
      if (script.endsWith("launch.py")) return { exit: 0, stdout: JSON.stringify(answers.launch), stderr: "" };
      if (script.endsWith("plansync.py") && args[0] === "ledger-resolve") {
        const a = answers.ledger.shift() ?? { exit: 0, out: { ok: true, resolved: [], pending: [], unchanged: [] } };
        return { exit: a.exit, stdout: JSON.stringify(a.out), stderr: "" };
      }
      if (script.endsWith("meter.py") && args[0] === "price-run") return answers.price;
      if (script.endsWith("plansync.py") && args[0] === "stage" && args[1] === "--from-run") return answers.stageRows;
      if (script.endsWith("ledger.py") && args[0] === "emit") return answers.emit;
      if (script.endsWith("track.py") && args[0] === "block") return answers.track;
      return { exit: 2, stdout: "", stderr: "unexpected script" };
    },
    verbs: async (_root, args) => { verbs.push(args); return { ok: true, state: args[args.indexOf("--state") + 1] }; },
  };
  const queue = new Queue(":memory:", {
    ownerAlive: (o) => o.nonce === me.nonce,
    engineLive: async () => (answers.engineLive ? { live: true, run_ids: ["E1"] } : { live: false, run_ids: [] }),
    probeWorker: (pid, start) => ({ pid, start, outcome: "not running" }),
  });
  const defn = { id: SWEEP_JOB_TYPE, target: { skill: "tk-studio-launch", payload: { verb: "sweep" } } };
  const queued = queue.enqueue({ jobId: SWEEP_JOB_TYPE, root, projectId: "proj", definition: defn, owner: me, base_ref: "main", ...(opts.prefix ? { prefix: opts.prefix } : {}),
    ...(opts.sandbox ? { tier: "sbx" as const, sandbox: opts.sandbox } : {}) }).run;
  const claim = await queue.claim(queued.run_id, me);
  if (!claim.claimed) throw new Error("not claimed");
  if (opts.sandbox) queue.note(claim.run.run_id, "pinned", { sandbox: opts.sandbox });
  const wt = await prepareWorktree(queue, claim.run, "proj", root, deps);
  queue.markVerbStarted(claim.run.run_id, "wake", [], { target: "skill", definition: defn });
  const BLOCK = { status: "complete", intent: "tk-studio-launch", artifacts: [".bmad-loop/runs/E1"], reason: "triage still running" };
  await mirror(queue, claim.run.run_id, { jobId: SWEEP_JOB_TYPE, defn }, {
    ok: true, job_id: SWEEP_JOB_TYPE, run_id: "run-sweep-20261029T101010Z", target: "skill", state: "complete", status_block: BLOCK, total_cost_usd: 0.5, finish_deferred: true,
  }, async () => ({}), deps);
  const served = wt; // prepareWorktree answers the served root: `<worktree>/<prefix>`
  const runDir = join(served, ".bmad-loop", "runs", "E1");
  mkdirSync(runDir, { recursive: true });
  const id = claim.run.run_id;
  const journal = (entry: Record<string, unknown>) => writeFileSync(join(runDir, "journal.jsonl"),
    `${existsSync(join(runDir, "journal.jsonl")) ? readFileSync(join(runDir, "journal.jsonl"), "utf-8") : ""}${JSON.stringify(entry)}\n`);
  return {
    repo, root, gh, home, studio, verbs, answers, deps, queue, wt, served, runDir, id, get: () => queue.get(id)!, sbxCalls, mcpStops,
    triage: (t: unknown = TRIAGE) => writeFileSync(join(runDir, "triage.json"), typeof t === "string" ? t : JSON.stringify(t)),
    landed: (name: string) => journal({ ts: 1, kind: "sweep-bundle-closed", story_key: `dw-${name}`, dw_ids: [] }),
    journal,
    commit: (file: string, msg: string) => { writeFileSync(join(served, file), msg); testGit(served, "add", file); testGit(served, "commit", "-q", "-m", msg); },
  };
}

/** The owner checkout's ledger written (the ledger pass's wait watches it). */
const ownerLedger = (root: string, text: string) => {
  const path = join(root, DEFERRED_REL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const summary = (landed: boolean[], triage = true): SweepSummary => ({
  ...(triage ? { triage: { bundles: [{ name: "a", dw_ids: ["DW-1"] }, { name: "b", dw_ids: ["DW-2"] }].slice(0, landed.length), blocked: [], decisions: [], already_resolved: [], skip: [] } } : {}),
  bundles: landed.map((l, i) => ({ name: i ? "b" : "a", dw_ids: [i ? "DW-2" : "DW-1"], cycle: 1, key: i ? "dw-b" : "dw-a", landed: l, ...(l ? {} : { why: "no ledger close in the engine journal" }) })),
});

describe("Story 35.7: the run-sweep job type", () => {
  test("a run is a sweep by its resolved definition's id or type", () => {
    expect(isSweep({ id: "run-sweep" })).toBe(true);
    expect(isSweep({ id: "nightly", type: "run-sweep" })).toBe(true);
    expect(isSweep({ id: "run-epic" })).toBe(false);
    expect(isSweep(null)).toBe(false);
  });

  test("the watch records the triage once: the run-workspace copy and one `sweep-triage` note, never re-noted", async () => {
    const fx = await sweepFixture();
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // running, no triage yet
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_TRIAGE)).toHaveLength(0);
    fx.triage();
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    const notes = fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_TRIAGE);
    expect(notes).toHaveLength(1);
    const copy = join(fx.home, "projects", "proj", "runs", "run-sweep-20261029T101010Z", "sweep", "triage.json");
    expect(notes[0]!.detail).toEqual({
      engine_run_id: "E1", path: copy, ledger: "emitted",
      bundles: [{ name: "a", dw_ids: ["DW-1", "DW-2"] }, { name: "b", dw_ids: ["DW-3"] }],
      blocked: [{ id: "DW-4", blocker: "Story 36.1 must land first" }], decisions: [{ id: "DW-5", question: "keep or drop?", context: "c", options: [], default: null }],
      already_resolved: ["DW-6"], skip: [],
    });
    expect(JSON.parse(readFileSync(copy, "utf-8"))).toEqual(TRIAGE);
    expect(fx.get().state).toBe("running");
  });

  test("an unparseable triage.json is noted once with its error, only once it has settled", async () => {
    const fx = await sweepFixture();
    fx.triage("{not json");
    expect(recordTriage(fx.queue, fx.get(), fx.deps.env)).toBe("waiting"); // fresh: perhaps mid-write
    const old = new Date(Date.now() - 120_000);
    utimesSync(join(fx.runDir, "triage.json"), old, old);
    expect(recordTriage(fx.queue, fx.get(), fx.deps.env)).toBe("error");
    expect(recordTriage(fx.queue, fx.get(), fx.deps.env)).toBe("seen");
    const notes = fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_TRIAGE);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.detail).toMatchObject({ engine_run_id: "E1" });
    expect(typeof notes[0]!.detail!.error).toBe("string");
    expect(notes[0]!.detail!.path).toBeUndefined();
  });

  test("the end: one PR with `## Sweep` before `## Host verify`, partial on a bundle not landed, the inbox line, the job-run finish", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const run = fx.get();
    expect(run.state).toBe("partial");
    expect(run.reason).toBe("sweep: 1/2 bundles; blocked: DW-4; decisions: DW-5");
    const creates = fx.gh.calls().filter((c) => c.argv[0] === "pr" && c.argv[1] === "create");
    expect(creates).toHaveLength(1);
    const body = creates[0]!.body!;
    expect(body).toContain([
      "## Sweep", "", "- a (DW-1, DW-2): landed", "- b (DW-3): not landed — no ledger close in the engine journal", "",
      "### Blocked", "", "- DW-4: Story 36.1 must land first", "", "### Human decisions", "", "- DW-5: keep or drop?", "",
      "Skipped unattended (`--no-prompt`): `bmad-loop decisions` answers them.",
    ].join("\n"));
    expect(body.indexOf("## Sweep")).toBeLessThan(body.indexOf("## Host verify"));
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ pr: PR, sweep: { notice: "1/2 bundles; blocked: DW-4; decisions: DW-5", triage: true, already_resolved: ["DW-6"],
      bundles: [{ name: "a", dw_ids: ["DW-1", "DW-2"], landed: true }, { name: "b", dw_ids: ["DW-3"], landed: false }] } });
    const text = noticeText(endNotice(fx.queue, run));
    // the reason already carries the sweep line verbatim: no second `sweep:` line
    expect(text).toContain("\nreason: sweep: 1/2 bundles; blocked: DW-4; decisions: DW-5\nPR: " + PR);
    expect(text).not.toContain("\nsweep: ");
    // the job-run line: finish with the sweep's state and reason and the metered cost
    expect(fx.verbs).toHaveLength(1);
    expect(fx.verbs[0]!.slice(0, 8)).toEqual(["finish", "--directory", fx.repo.checkout, "--run-id", "run-sweep-20261029T101010Z", "--state", "partial", "--reason"]);
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--total-cost-usd") + 1]).toBe("0.5");
  });

  test("the end-state rule: complete, partial, blocked", () => {
    const skipped = { skipped: "host-tier run" } as any;
    const red = { skipped: false, green: false, command: "x", exit: 1, stdout_tail: [], stderr_tail: ["boom"] } as any;
    expect(sweepEndState(summary([true, true]), skipped).state).toBe("complete");
    expect(sweepEndState(summary([]), undefined).state).toBe("complete"); // zero bundles
    expect(sweepEndState(summary([true, false]), skipped).state).toBe("partial");
    expect(sweepEndState(summary([false, false]), skipped).state).toBe("blocked");
    expect(sweepEndState(summary([], false)).state).toBe("blocked"); // no triage ever
    const r = sweepEndState(summary([true, true]), red);
    expect(r.state).toBe("partial");
    expect(r.reason).toMatch(/^host verify red/);
    expect(sweepSection(summary([], false))[2]).toMatch(/^No triage recorded/);
    const body = prBody({ commits: [], runId: "q1", sweep: summary([true]), verify: skipped });
    expect(body.indexOf("## Sweep")).toBeGreaterThan(body.indexOf("## Metered cost"));
    expect(body.indexOf("## Sweep")).toBeLessThan(body.indexOf("## Host verify"));
  });

  test("a paused sweep is closed out as an end, its engine stopped, never kept paused nor relaunched", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation", paused_story_key: "dw-b" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const run = fx.get();
    expect(run.state).toBe("partial");
    expect(fx.queue.events(fx.id).some((e) => e.kind === "paused")).toBe(false);
    expect(fx.studio.find((s) => s.script.endsWith("launch.py") && s.args[0] === "stop")!.args).toEqual(["stop", "--directory", fx.wt, "--run-id", "E1"]);
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ engine_stop: "stopped", sweep: { bundles: [{ name: "a", landed: true }, { name: "b", landed: false, why: "paused at review" }] } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("- b (DW-3): not landed — paused at review");
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).not.toContain("--draft");
  });

  test("closeOutPaused never takes a sweep run", async () => {
    const fx = await sweepFixture();
    fx.queue.markPaused(fx.id, { engine: { paused_stage: "review" } });
    const before = fx.queue.events(fx.id).length;
    expect(await closeOutPaused(fx.queue, {})).toEqual({ closed: [], awaiting: [] });
    expect(fx.queue.events(fx.id)).toHaveLength(before);
    expect(fx.get().state).toBe("paused");
  });

  test("the ledger pass: nothing until MERGED; pending waited on; then resolved and settled, never called again", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const calls = () => fx.studio.filter((s) => s.script.endsWith("plansync.py") && s.args[0] === "ledger-resolve");
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]); // OPEN: nothing
    expect(calls()).toHaveLength(0);
    fx.gh.answer({ view: "MERGED" });
    fx.answers.ledger.push({ exit: 0, out: { ok: true, resolved: [], pending: ["DW-1", "DW-2", "DW-6"], unchanged: [] } });
    fx.answers.ledger.push({ exit: 0, out: { ok: true, resolved: ["DW-1", "DW-2", "DW-6"], pending: [], unchanged: [] } });
    await mergePass(fx.queue, fx.deps); // the ledger pass runs after the stage pass
    expect(calls()).toHaveLength(1);
    ownerLedger(fx.root, "pulled"); // the wait ends once the owner ledger changes
    expect(calls()[0]!.args).toEqual(["ledger-resolve", "--directory", fx.repo.checkout, "--pr", PR, "--ids", "DW-1,DW-2,DW-6"]);
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]); // settled: idempotent
    expect(calls()).toHaveLength(2);
    const evs = fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE);
    expect(evs.map((e) => e.detail)).toEqual([
      { pr: PR, ids: ["DW-1", "DW-2", "DW-6"], resolved: [], pending: ["DW-1", "DW-2", "DW-6"], ok: true, waiting: true, fingerprint: "absent" },
      { pr: PR, ids: ["DW-1", "DW-2", "DW-6"], resolved: ["DW-1", "DW-2", "DW-6"], pending: [], ok: true, settled: true },
    ]);
    const leases = fx.queue.events(fx.id).filter((e) => e.kind === "plan-lease" && e.detail?.phase === LEDGER_LEASE && e.detail?.owner === null);
    expect(leases.map((e) => e.detail?.settled === true)).toEqual([true, true]);
  });

  test("review 1: a paused sweep whose engine stop fails is never closed out: the worktree kept, one note; the next tick's stop closes it out", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation", paused_story_key: "dw-b" } };
    fx.answers.stop = { exit: 2, stdout: "", stderr: "bmad-loop stop: no such process" };
    const stops = () => fx.studio.filter((s) => s.script.endsWith("launch.py") && s.args[0] === "stop");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // retried, never noted twice
    expect(stops()).toHaveLength(2);
    expect(fx.get().state).toBe("running");
    expect(existsSync(fx.wt)).toBe(true);
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr")).toBe(false);
    expect(fx.queue.events(fx.id).some((e) => e.kind === "closed_out" || e.kind === "ended" || e.kind === "closing-out")).toBe(false);
    const notes = fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.detail).toMatchObject({ engine_run_id: "E1", error: expect.stringMatching(/^stop failed: exit 2: bmad-loop stop: no such process/) });
    // the take was never held: the next tick takes the run
    fx.answers.stop = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("partial");
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail).toMatchObject({ engine_stop: "stopped" });
    expect(fx.gh.calls().filter((c) => c.argv[1] === "create")).toHaveLength(1);
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP)).toHaveLength(1);
  });

  test("review 1: a failed stop whose engine then reads ended is closed out as an end, no further stop", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    fx.answers.stop = { exit: 1, stdout: "", stderr: "boom" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.studio.filter((s) => s.script.endsWith("launch.py") && s.args[0] === "stop")).toHaveLength(1);
    expect(fx.get().state).toBe("blocked"); // bundles triaged, none landed
  });

  test("review 2: a prefixed run's ledger pass calls at its root — already the owner checkout's served root, never <root>/<prefix>", async () => {
    const fx = await sweepFixture({ prefix: "game/" });
    expect(fx.root).toBe(join(fx.repo.checkout, "game/"));
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().reason).toBe("sweep: 1/2 bundles; blocked: DW-4; decisions: DW-5"); // the triage read in the served root
    fx.gh.answer({ view: "MERGED" });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    const call = fx.studio.find((s) => s.script.endsWith("plansync.py") && s.args[0] === "ledger-resolve")!;
    expect(call.args.slice(0, 3)).toEqual(["ledger-resolve", "--directory", fx.root]);
    expect(call.root).toBe(fx.root);
    expect(fx.get().prefix).toBe("game/");
    expect(fx.served).toBe(resolve(fx.get().worktree!, "game/"));
  });

  test("review 4: a late close-out (a terminal sweep run) applies the end rule on its `closed_out` and the inbox line carries the sweep line", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // the triage recorded while running
    const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "run-sweep-20261029T101010Z", state: "running" }] } : { state: "cancelled" };
    await cancelRun(fx.queue, fx.id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.get().state).toBe("cancelled");
    expect(fx.queue.events(fx.id).find((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { result: "skipped" } });
    fx.answers.engineLive = false;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const closed = fx.queue.events(fx.id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({
      pr: PR, sweep: { notice: "1/2 bundles; blocked: DW-4; decisions: DW-5" },
      sweep_end: { state: "partial", reason: "sweep: 1/2 bundles; blocked: DW-4; decisions: DW-5" },
    });
    expect(fx.get().state).toBe("cancelled"); // the terminal row never updated
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("- b (DW-3): not landed — no ledger close in the engine journal");
    const text = noticeText(endNotice(fx.queue, fx.get()));
    expect(text).toContain("\nsweep: 1/2 bundles; blocked: DW-4; decisions: DW-5");
  });

  test("review 6: a sweep cancelled before any close-out notifies with its sweep line (read live, the worktree still there)", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]); // the triage recorded while running
    const sent: string[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => { sent.push(String(init?.body)); return new Response("", { status: 200 }); }) as unknown as typeof fetch;
    const hygiene = { env: { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" }, fetch: fetchFn };
    const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "run-sweep-20261029T101010Z", state: "running" }] } : { state: "cancelled" };
    await cancelRun(fx.queue, fx.id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps, hygiene });
    expect(fx.get().state).toBe("cancelled");
    expect(fx.queue.events(fx.id).some((e) => e.kind === "closed_out")).toBe(false); // the close-out has not run
    expect(fx.queue.events(fx.id).find((e) => e.kind === "notified")).toBeDefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("\nsweep: 1/2 bundles; blocked: DW-4; decisions: DW-5");
  });

  test("review 7: a cancel that wins the race mid-close-out — the raced `closed_out` carries the computed `sweep_end`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    fx.answers.engineLive = false;
    const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "run-sweep-20261029T101010Z", state: "running" }] } : { state: "cancelled" };
    let raced = false;
    const deps: WorktreeDeps = {
      ...fx.deps,
      run: async (bin, args, o) => {
        if (!raced && args[0] === "worktree" && args[1] === "remove") {
          raced = true; // the cancel lands while the sweep holds the run's close-out
          await cancelRun(fx.queue, fx.id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
        }
        return fx.deps.run!(bin, args, o);
      },
    };
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(raced).toBe(true);
    expect(fx.get().state).toBe("cancelled");
    const closed = fx.queue.events(fx.id).filter((e) => e.kind === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.detail).toMatchObject({
      sweep: { notice: "1/2 bundles; blocked: DW-4; decisions: DW-5" },
      sweep_end: { state: "partial", reason: "sweep: 1/2 bundles; blocked: DW-4; decisions: DW-5" },
    });
  });

  test("review 5: a guard-killed sweep keeps the kill's state and reason, the sweep line appended", async () => {
    const TRIP = "guard tripped: max_turns exceeded";
    for (const status of ["stopped", "running"]) {
      const fx = await sweepFixture();
      fx.triage();
      fx.landed("a");
      fx.landed("b");
      fx.commit("a.txt", "sweep bundle dw-a");
      fx.queue.markLaunched(fx.id, "E1", { end: { state: "blocked", reason: TRIP } });
      fx.queue.recordEnginePid(fx.id, { pid: 6509, start: "125610.0", source: "engine.pid" });
      fx.queue.note(fx.id, "engine-kill", { why: "test", worker: { pid: 6509, start: "125610.0", outcome: "killed" } });
      fx.answers.launch = { ok: true, run: { status } };
      expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
      // every bundle landed: the rule alone would say `complete`
      expect(fx.get()).toMatchObject({ state: "blocked", reason: `${TRIP}; sweep: 2/2 bundles; blocked: DW-4; decisions: DW-5` });
      expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("blocked");
    }
  });

  test("review 6: bundles the engine dropped by max_bundles or skipped stay counted, each named for why", async () => {
    const fx = await sweepFixture();
    fx.triage({ ...TRIAGE, bundles: [...TRIAGE.bundles, { name: "c", dw_ids: ["DW-7"], intent: "a third" }] });
    fx.landed("a");
    fx.journal({ ts: 2, kind: "sweep-bundle-skipped", name: "b", dw_ids: ["DW-3"], reason: "failed-or-escalated-earlier" });
    fx.journal({ ts: 3, kind: "sweep-bundles-truncated", dropped: ["c"] });
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get()).toMatchObject({ state: "partial", reason: "sweep: 1/3 bundles; blocked: DW-4; decisions: DW-5" });
    const body = fx.gh.calls().find((c) => c.argv[1] === "create")!.body!;
    expect(body).toContain("- a (DW-1, DW-2): landed\n- b (DW-3): not landed — skipped by the engine\n- c (DW-7): not landed — dropped by max_bundles\n");
  });

  test("review 8: a CLOSED (unmerged) PR settles the ledger pass skipped, plansync never called", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "CLOSED" });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]);
    expect(fx.studio.some((s) => s.script.endsWith("plansync.py") && s.args[0] === "ledger-resolve")).toBe(false);
    expect(fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE).map((e) => e.detail)).toEqual([
      { pr: PR, ids: ["DW-1", "DW-2", "DW-6"], resolved: [], pending: [], ok: false, settled: true, skipped: true, reason: "pr closed unmerged" },
    ]);
  });

  test("review 9: an empty ledger (`sweep-nothing-open`, no triage.json) ends blocked naming it, never an escalation", async () => {
    const fx = await sweepFixture();
    fx.journal({ ts: 1, kind: "sweep-nothing-open", ledger: "_bmad-output/implementation-artifacts/deferred-work.md" });
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get()).toMatchObject({ state: "blocked", reason: "sweep: nothing open in the ledger" });
    expect(fx.gh.calls().some((c) => c.argv[1] === "create")).toBe(false); // nothing committed: no PR
    expect(sweepSection({ bundles: [], nothing_open: true })[2]).toBe("No triage recorded: the ledger had nothing open (`sweep-nothing-open`).");
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail).toMatchObject({ sweep: { notice: "nothing open in the ledger", triage: false, bundles: [] } });
    expect(JSON.stringify(fx.get().reason)).not.toContain("escalated");
    // without the journal record the end still reads as an escalation
    expect(sweepEndState({ bundles: [] }).reason).toBe("sweep: no triage.json (the triage escalated)");
  });

  test("review 9: `[sweep] repeat` cycles: triage-2.json's bundles are summarised by their cycle key, the id lists merged, the ledger ids follow", async () => {
    const fx = await sweepFixture();
    fx.triage();
    writeFileSync(join(fx.runDir, "triage-2.json"), JSON.stringify({
      ...TRIAGE, already_resolved: [{ id: "DW-9", evidence: "x" }],
      bundles: [{ name: "a", dw_ids: ["DW-8"], intent: "the name reused" }, { name: "c", dw_ids: ["DW-7"], intent: "a third" }],
      blocked: [{ id: "DW-4", blocker: "still Story 36.1" }, { id: "DW-10", blocker: "new" }], decisions: [],
    }));
    fx.landed("a"); // cycle 1's `dw-a` only: cycle 2's `a` (`dw2-a`) is never counted landed by it
    fx.journal({ ts: 2, kind: "sweep-cycle", cycle: 2, open: 4 });
    fx.journal({ ts: 3, kind: "sweep-bundle-skipped", name: "a", dw_ids: ["DW-8"], reason: "failed-or-escalated-earlier" });
    fx.journal({ ts: 4, kind: "sweep-bundle-closed", story_key: "dw2-c", dw_ids: ["DW-7"] });
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get()).toMatchObject({ state: "partial", reason: "sweep: 2/4 bundles; blocked: DW-4, DW-10; decisions: DW-5" });
    const body = fx.gh.calls().find((c) => c.argv[1] === "create")!.body!;
    expect(body).toContain([
      "- a (DW-1, DW-2): landed", "- b (DW-3): not landed — no ledger close in the engine journal",
      "- a (cycle 2) (DW-8): not landed — skipped by the engine", "- c (cycle 2) (DW-7): landed", "",
      "### Blocked", "", "- DW-4: still Story 36.1", "- DW-10: new",
    ].join("\n"));
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_TRIAGE)).toHaveLength(1); // the first triage's, once
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail).toMatchObject({ sweep: { already_resolved: ["DW-6", "DW-9"],
      bundles: [{ name: "a", landed: true }, { name: "b", landed: false }, { name: "a", cycle: 2, landed: false }, { name: "c", cycle: 2, landed: true }] } });
    fx.gh.answer({ view: "MERGED" });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    const call = fx.studio.find((s) => s.script.endsWith("plansync.py") && s.args[0] === "ledger-resolve")!;
    expect(call.args.slice(-2)).toEqual(["--ids", "DW-1,DW-2,DW-7,DW-6,DW-9"]);
  });

  test("review 9: the inbox notice drops its `sweep:` line only when the reason line as composed carries it verbatim", () => {
    const base = { run_id: "q1", job_id: SWEEP_JOB_TYPE, project_id: null, studio_run_id: null, state: "partial", pr: PR, sweep: "1/2 bundles; blocked: none; decisions: none" };
    const carried = noticeText({ ...base, reason: "sweep: 1/2 bundles; blocked: none; decisions: none" });
    expect(carried).toBe(`supervisor: run q1 ended partial\njob: ${SWEEP_JOB_TYPE}\nreason: sweep: 1/2 bundles; blocked: none; decisions: none\nPR: ${PR}`);
    const other = noticeText({ ...base, state: "cancelled", reason: "cancelled by the operator" });
    expect(other).toContain("\nreason: cancelled by the operator\nsweep: 1/2 bundles; blocked: none; decisions: none\nPR: " + PR);
    // a reason clipped before its sweep line still shows the whole sweep line
    const clipped = noticeText({ ...base, state: "blocked", reason: `${"x".repeat(5000)}; sweep: 1/2 bundles; blocked: none; decisions: none` });
    expect(clipped).toContain("… [reason truncated]\nsweep: 1/2 bundles; blocked: none; decisions: none\nPR: " + PR);
  });
});

describe("Story 36.1: an inconclusive leg at the sweep's end", () => {
  const summary = { triage: { bundles: [], blocked: [], decisions: [] }, bundles: [{ name: "b", ids: [], landed: true }] } as unknown as SweepSummary;
  const inconclusive = { command: "c", argv: ["c"], cwd: "/w", exit: 0, duration_ms: 1, green: false, stdout_tail: [], stderr_tail: [],
    playable: { verdict: "inconclusive", reason: "infrastructure: sbx: x" } } as any;

  test("sweepEndState: `partial`, the reason naming the inconclusive leg, never red and never complete", () => {
    const r = sweepEndState(summary, inconclusive);
    expect(r.state).toBe("partial");
    expect(r.reason).toMatch(/^host verify inconclusive \(playable\)/);
    expect(r.reason).toContain("infrastructure: sbx: x");
    expect(r.reason).not.toMatch(/host verify red/);
  });
});

describe("Story 36.2: the sweep's records are whole", () => {
  const PRICED = { ok: true, usd_total: 3.75, prices_date: "2026-10-01", bundles: [{ key: "dw-a", usd: 3.75, source: "metered" }, { key: "dw-b", usd: null }] };
  const priced = (o: unknown = PRICED): RunResult => ({ exit: 0, stdout: JSON.stringify(o), stderr: "" });
  const landedFixture = async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    return fx;
  };

  test("the close-out prices the engine: worker + engine = total and one line per bundle in the body, the sum on the job-run line, `engine_cost_usd` on `ended`", async () => {
    const fx = await landedFixture();
    fx.answers.price = priced();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const call = fx.studio.find((s) => s.script.endsWith("meter.py"))!;
    expect(call.args.slice(0, 3)).toEqual(["price-run", "--run-dir", fx.runDir]);
    expect(call.args.at(-1)).toBe("--json");
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain(
      "## Metered cost\n\n$0.5000 (worker turns) + $3.7500 (engine) = $4.2500\n\n- a: $3.7500 (metered)\n- b: not metered\n\n## Sweep");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--total-cost-usd") + 1]).toBe("4.25");
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ engine_cost_usd: 3.75, sweep: { engine_cost_usd: 3.75,
      bundles: [{ name: "a", cost_usd: 3.75, source: "metered" }, { name: "b", cost_usd: null }] } });
  });

  test("a `price-run` that fails never blocks the close-out: the worker's cost stands, the engine stated as not priced", async () => {
    const fx = await landedFixture();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("## Metered cost\n\n$0.5000 (worker turns); engine not priced: no price table here\n\n## Sweep");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--total-cost-usd") + 1]).toBe("0.5");
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    expect(ended.detail!.engine_cost_usd).toBeUndefined();
    expect(ended.detail).toMatchObject({ sweep: { engine_cost_error: "no price table here" } });
    // no JSON, a gone run dir: the same
    fx.answers.price = { exit: 0, stdout: "not json", stderr: "" };
    expect((await engineCostOf({ worktree: fx.wt, prefix: null, engine_run_id: "E1" }, fx.deps)).error).toBeDefined();
  });

  test("the cost text and the total: nothing priced says nothing, a worker unmetered is never zero-filled in the text", () => {
    const s = summary([true]);
    expect(sweepCostText(s, 0.5)).toBeUndefined();
    expect(sweepTotalCost(s, 0.5)).toBe(0.5);
    const p = withEngineCost(s, { usd: 2, bundles: [{ key: "dw-a", usd: 2, source: "sessions" }] });
    expect(sweepCostText(p, undefined)).toBe("not metered (worker turns) + $2.0000 (engine) = $2.0000\n\n- a: $2.0000 (sessions)");
    expect(sweepTotalCost(p, undefined)).toBe(2);
    const none = withEngineCost(s, { bundles: [{ key: "dw-a", usd: null }] });
    expect(sweepCostText(none, 0.5)).toBe("$0.5000 (worker turns); engine not priced\n\n- a: not metered");
    expect(sweepTotalCost(none, undefined)).toBeUndefined();
  });

  test("the triage's ledger event goes out from the host once, in the lib's shape, and the one note gains `ledger`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    const emits = fx.studio.filter((s) => s.script.endsWith("ledger.py"));
    expect(emits).toHaveLength(1);
    const a = emits[0]!.args;
    expect(a.slice(0, 3)).toEqual(["emit", "--event", SWEEP_TRIAGE]);
    expect(a.slice(-2)).toEqual(["--project", "proj"]);
    expect(JSON.parse(a[a.indexOf("--payload") + 1]!)).toEqual({ run_id: "E1", bundles: 2, dw_ids: ["DW-1", "DW-2", "DW-3"], blocked: ["DW-4"], decisions: ["DW-5"], already_resolved: ["DW-6"], skip: [] });
    const notes = fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_TRIAGE);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.detail!.ledger).toBe("emitted");
    expect(await emitTriage(fx.queue, fx.get(), fx.deps)).toBe("seen");
  });

  test("a failed triage emit is noted on the note, never thrown nor retried by the live tick (Story 37.5: the ledger pass retries it once the run ends); a triage in error emits nothing", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.answers.emit = { exit: 2, stdout: JSON.stringify({ ok: false, error: "ledger refused" }), stderr: "" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.studio.filter((s) => s.script.endsWith("ledger.py"))).toHaveLength(1);
    expect(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!.detail).toMatchObject({ ledger: "error: ledger refused", ledger_errors: 1 });
    const fy = await sweepFixture();
    fy.queue.note(fy.id, SWEEP_TRIAGE, { engine_run_id: "E1", error: "not json" });
    expect(await emitTriage(fy.queue, fy.get(), fy.deps)).toBe("absent");
  });

  test("`pending` is a wait: one `waiting` record, its lease settled and uncounted, no give-up past the limit; an error still counts and gives up", async () => {
    const fx = await landedFixture();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "MERGED" });
    ownerLedger(fx.root, "one");
    // already at the limit: a counted attempt would give up on the very next pass
    for (let i = 0; i < PLAN_RETRY_LIMIT; i++) fx.queue.note(fx.id, "plan-lease", { phase: LEDGER_LEASE, owner: null });
    const pending = { exit: 0, out: { ok: true, resolved: [], pending: ["DW-1"], unchanged: [] } };
    fx.answers.ledger.push(pending, pending, pending);
    const records = () => fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE);
    const leases = () => fx.queue.events(fx.id).filter((e) => e.kind === "plan-lease" && e.detail?.phase === LEDGER_LEASE);
    const calls = () => fx.studio.filter((s) => s.script.endsWith("plansync.py") && s.args[0] === "ledger-resolve");
    const views = () => fx.gh.calls().filter((c) => c.argv[0] === "pr" && c.argv[1] === "view");

    // the first waiting pass holds the lease and releases it settled
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(records()).toHaveLength(1);
    expect(records()[0]!.detail).toMatchObject({ waiting: true, pending: ["DW-1"], ok: true, fingerprint: ledgerFingerprint(fx.root) });
    expect(records()[0]!.detail!.settled).toBeUndefined();
    expect(leases().filter((e) => e.detail?.owner === null).at(-1)!.detail?.settled).toBe(true);

    // the ledger unchanged: no `gh`, no lease, no call, however long it lasts
    const [leasesAt, viewsAt] = [leases().length, views().length];
    for (let i = 0; i < 3; i++) expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]);
    expect(leases()).toHaveLength(leasesAt);
    expect(views()).toHaveLength(viewsAt);
    expect(calls()).toHaveLength(1);

    // the ledger changed, still pending: one call, the one record moved on, then quiet again
    ownerLedger(fx.root, "one and two");
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(calls()).toHaveLength(2);
    expect(records()).toHaveLength(1);
    expect(records()[0]!.detail!.fingerprint).toBe(ledgerFingerprint(fx.root));
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]);
    expect(calls()).toHaveLength(2);

    // an error at the limit is the give-up, unchanged
    ownerLedger(fx.root, "one and two and three");
    fx.answers.ledger.length = 0;
    fx.answers.ledger.push({ exit: 3, out: { ok: false, retryable: true, error: "busy" } });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(records().at(-1)!.detail).toMatchObject({ settled: true, skipped: true, reason: `gave up after ${PLAN_RETRY_LIMIT + 1} attempts: busy` });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]);
  });

  test("the wait ends once the owner ledger changes: the flip settles it", async () => {
    const fx = await landedFixture();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "MERGED" });
    ownerLedger(fx.root, "before the pull");
    fx.answers.ledger.push({ exit: 0, out: { ok: true, resolved: [], pending: ["DW-1"], unchanged: [] } });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]);
    ownerLedger(fx.root, "after the pull, longer");
    fx.answers.ledger.push({ exit: 0, out: { ok: true, resolved: ["DW-1"], pending: [], unchanged: [] } });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === LEDGER_RESOLVE)!.detail).toMatchObject({ settled: true, resolved: ["DW-1"] });
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]);
    expect(fx.studio.filter((s) => s.script.endsWith("plansync.py") && s.args[0] === "ledger-resolve")).toHaveLength(2);
  });

  test("a partial flip is one wait: the next call's empty `resolved` adds no second record, the first flip's ids kept on it", async () => {
    const fx = await landedFixture();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "MERGED" });
    ownerLedger(fx.root, "one");
    fx.answers.ledger.push({ exit: 0, out: { ok: true, resolved: ["DW-1"], pending: ["DW-2"], unchanged: [] } },
      { exit: 0, out: { ok: true, resolved: [], pending: ["DW-2"], unchanged: ["DW-1"] } });
    await ledgerPass(fx.queue, fx.deps);
    ownerLedger(fx.root, "one and two");
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    const records = fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE);
    expect(records).toHaveLength(1);
    expect(records[0]!.detail).toMatchObject({ waiting: true, resolved: ["DW-1"], pending: ["DW-2"], fingerprint: ledgerFingerprint(fx.root) });
  });

  test("a wait after an error records again; an error below the limit releases counted", async () => {
    const fx = await landedFixture();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "MERGED" });
    ownerLedger(fx.root, "one");
    const pending = { exit: 0, out: { ok: true, resolved: [], pending: ["DW-1"], unchanged: [] } };
    fx.answers.ledger.push(pending, { exit: 3, out: { ok: false, retryable: true, error: "busy" } }, pending);
    await ledgerPass(fx.queue, fx.deps);
    ownerLedger(fx.root, "one and two");
    await ledgerPass(fx.queue, fx.deps); // an error: never a wait, so the next pass runs on an unchanged ledger
    await ledgerPass(fx.queue, fx.deps);
    expect(fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE).map((e) => e.detail?.waiting === true)).toEqual([true, false, true]);
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "plan-lease" && e.detail?.owner === null).map((e) => e.detail?.settled === true)).toEqual([true, false, true]);
  });

  test("the engine's end is kept: crashed after every bundle landed is `partial` naming it, through the close-out and the job-run line", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.landed("b");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "crashed" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get()).toMatchObject({ state: "partial", reason: "engine ended 'crashed' after 2/2 bundles" });
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--state") + 1]).toBe("partial");
  });

  test("the end's order: the `blocked` rules, then the leg's reason, then the engine's cap; `finished` and unset are no cap", () => {
    const red = { skipped: false, green: false, command: "x", exit: 1, stdout_tail: [], stderr_tail: ["boom"] } as any;
    const skipped = { skipped: "host-tier run" } as any;
    expect(sweepEndState(summary([true, true]), skipped, "finished").state).toBe("complete");
    expect(sweepEndState(summary([true, true]), skipped).state).toBe("complete"); // the paused-sweep stop: not penalised
    expect(sweepEndState(summary([true, false]), skipped, "interrupted")).toEqual({ state: "partial", reason: "engine ended 'interrupted' after 1/2 bundles" });
    expect(sweepEndState(summary([false, false]), skipped, "crashed").state).toBe("blocked");
    expect(sweepEndState(summary([], false), skipped, "crashed").state).toBe("blocked");
    expect(sweepEndState(summary([true, true]), red, "crashed").reason).toMatch(/^host verify red/);
  });

  test("a paused sweep the supervisor stopped is not penalised: every bundle landed ends `complete`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.landed("b");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("complete");
  });

  test("`summaryFromRecord`: the `ended` record, else the raced `closed_out`, plus the triage note; bundles as recorded", async () => {
    const fx = await landedFixture();
    fx.answers.price = priced();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(summaryFromRecord(fx.queue.events(fx.id))).toBeUndefined();
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const events = fx.queue.events(fx.id);
    const s = summaryFromRecord(events)!;
    expect(existsSync(fx.wt)).toBe(false);
    expect(sweepSection(s).join("\n")).toContain("- a (DW-1, DW-2): landed\n- b (DW-3): not landed — no ledger close in the engine journal\n\n### Blocked\n\n- DW-4: Story 36.1 must land first");
    expect(sweepCostText(s, 0.5)).toContain("$0.5000 (worker turns) + $3.7500 (engine) = $4.2500");
    const raced = events.filter((e) => e.kind !== "ended").concat({ ...events.find((e) => e.kind === "ended")!, kind: "closed_out" });
    expect(summaryFromRecord(raced)!.bundles.map((b) => b.landed)).toEqual([true, false]);
    expect(summaryFromRecord([{ ...events[0]!, kind: "ended", detail: { sweep: { notice: "nothing open in the ledger", triage: false, bundles: [] } } }])).toEqual({ bundles: [], nothing_open: true });
  });

  test("the record keeps every cycle's blocked, decisions and skip: a later cycle's survive where the first triage's note has none", async () => {
    const fx = await landedFixture();
    writeFileSync(join(fx.runDir, "triage-2.json"), JSON.stringify({ ...TRIAGE, bundles: [],
      blocked: [{ id: "DW-10", blocker: "cycle two" }], decisions: [{ id: "DW-11", question: "cycle two?" }], skip: [{ id: "DW-12" }] }));
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const events = fx.queue.events(fx.id);
    expect(events.findLast((e) => e.kind === "ended")!.detail).toMatchObject({ sweep: { skip: ["DW-12"],
      blocked: [{ id: "DW-4", blocker: "Story 36.1 must land first" }, { id: "DW-10", blocker: "cycle two" }],
      decisions: [{ id: "DW-5", question: "keep or drop?" }, { id: "DW-11", question: "cycle two?" }] } });
    const s = summaryFromRecord(events)!;
    expect(s.triage!.skip).toEqual(["DW-12"]);
    const text = sweepSection(s).join("\n");
    expect(text).toContain("- DW-10: cycle two");
    expect(text).toContain("- DW-11: cycle two?");
  });

  /** A sweep the operator cancelled, its close-out skipped: the next tick is the late close-out. */
  const cancelled = async (bundles: string[] = ["a", "b"]) => {
    const fx = await sweepFixture();
    fx.triage();
    for (const b of bundles) fx.landed(b);
    fx.commit("a.txt", "sweep bundle dw-a");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "run-sweep-20261029T101010Z", state: "running" }] } : { state: "cancelled" };
    await cancelRun(fx.queue, fx.id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.get().state).toBe("cancelled");
    fx.answers.engineLive = false;
    return fx;
  };
  const closedOut = (fx: Awaited<ReturnType<typeof cancelled>>) => fx.queue.events(fx.id).findLast((e) => e.kind === "closed_out")!;
  const jobRuns = (fx: Awaited<ReturnType<typeof cancelled>>) => fx.studio.filter((s) => s.script.endsWith("ledger.py") && s.args[2] === "job-run").map((s) => JSON.parse(s.args[s.args.indexOf("--payload") + 1]!));

  test("the late close-out keeps the engine's end: a terminal sweep whose engine crashed after every bundle is `partial`, never `complete`", async () => {
    const fx = await cancelled();
    fx.answers.launch = { ok: true, run: { status: "crashed" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(closedOut(fx).detail).toMatchObject({ sweep_end: { state: "partial", reason: "engine ended 'crashed' after 2/2 bundles" } });
    expect(fx.get().state).toBe("cancelled");
  });

  test("the late close-out: `finished` is no cap, an engine with no terminal status is not known so no cap, and the supervisor's noted stop is not penalised", async () => {
    const done = await cancelled();
    done.answers.launch = { ok: true, run: { status: "finished" } };
    await sweepEngines(done.queue, done.deps);
    expect(closedOut(done).detail!.sweep_end).toMatchObject({ state: "complete" });
    const running = await cancelled();
    await sweepEngines(running.queue, running.deps); // the fixture's status stays `running`
    expect(closedOut(running).detail!.sweep_end).toMatchObject({ state: "complete" });
    const stopped = await cancelled();
    stopped.queue.note(stopped.id, SWEEP_ENGINE_STOP, { engine_run_id: "E1", stopped: true });
    stopped.answers.launch = { ok: true, run: { status: "stopped" } };
    await sweepEngines(stopped.queue, stopped.deps);
    expect(closedOut(stopped).detail!.sweep_end).toMatchObject({ state: "complete" });
    const operator = await cancelled();
    operator.answers.launch = { ok: true, run: { status: "stopped" } };
    await sweepEngines(operator.queue, operator.deps);
    expect(closedOut(operator).detail!.sweep_end).toMatchObject({ state: "partial", reason: "engine ended 'stopped' after 2/2 bundles" });
  }, 30_000); // four cancelled() fixtures through real git: past bun's 5 s default on the win32 host (2026-10-31, hole 108)

  test("the late close-out's priced engine is its own `job-run` line, `<studio run id>:engine`, and `closed_out` carries `engine_cost_usd`", async () => {
    const fx = await cancelled(["a"]);
    fx.answers.price = priced();
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(jobRuns(fx)).toEqual([{ job_id: SWEEP_JOB_TYPE, run_id: "run-sweep-20261029T101010Z:engine", state: "complete", total_cost_usd: 3.75 }]);
    expect(closedOut(fx).detail).toMatchObject({ engine_cost_usd: 3.75, engine_job_run: "run-sweep-20261029T101010Z:engine", sweep: { engine_cost_usd: 3.75 } });
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("$0.5000 (worker turns) + $3.7500 (engine) = $4.2500");
  });

  test("a cancel whose engine stop is confirmed dead closes out at once, priced: `## Sweep`, the priced lines, and `ended` carries `sweep` and `engine_cost_usd`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.price = priced();
    fx.answers.engineLive = false;
    const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "run-sweep-20261029T101010Z", state: "running" }] } : { state: "cancelled" };
    await cancelRun(fx.queue, fx.id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.get().state).toBe("cancelled");
    expect(existsSync(fx.wt)).toBe(false);
    const body = fx.gh.calls().find((c) => c.argv[1] === "create")!.body;
    expect(body).toContain("## Sweep");
    expect(body).toContain("$0.5000 (worker turns) + $3.7500 (engine) = $4.2500");
    expect(body).toContain("- a: $3.7500 (metered)");
    expect(body).toContain("- b: not metered");
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ engine_cost_usd: 3.75, engine_job_run: "run-sweep-20261029T101010Z:engine", sweep: { engine_cost_usd: 3.75, notice: "1/2 bundles; blocked: DW-4; decisions: DW-5" } });
    expect(jobRuns(fx)).toEqual([{ job_id: SWEEP_JOB_TYPE, run_id: "run-sweep-20261029T101010Z:engine", state: "complete", total_cost_usd: 3.75 }]);
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_TRIAGE)).toHaveLength(1);
    // the worktree is gone: nothing is left for the late close-out to price or emit again
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(jobRuns(fx)).toHaveLength(1);
  });

  test("a confirmed-dead cancel that keeps its worktree still emits the engine's line, and no late close-out follows with a second", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.price = priced();
    fx.answers.engineLive = false;
    const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "run-sweep-20261029T101010Z", state: "running" }] } : { state: "cancelled" };
    const deps: WorktreeDeps = { ...fx.deps, run: async (bin, args, o) => args[0] === "worktree" && args[1] === "remove" ? { exit: 1, stdout: "", stderr: "busy" } : fx.deps.run!(bin, args, o) };
    await cancelRun(fx.queue, fx.id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: deps });
    expect(fx.get().state).toBe("cancelled");
    expect(existsSync(fx.wt)).toBe(true);
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    const closeout = ended.detail!.closeout as { result: string; worktree: string };
    expect(closeout.result).not.toBe("skipped");
    expect(closeout.worktree).toStartWith("kept");
    expect(ended.detail).toMatchObject({ engine_cost_usd: 3.75, engine_job_run: "run-sweep-20261029T101010Z:engine" });
    const line = [{ job_id: SWEEP_JOB_TYPE, run_id: "run-sweep-20261029T101010Z:engine", state: "complete", total_cost_usd: 3.75 }];
    expect(jobRuns(fx)).toEqual(line);
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    expect(jobRuns(fx)).toEqual(line);
  });

  /** A sweep's close-out that a cancel beats to the end, `finish` answering `verb` (the cancel's take refused: no line of its own). */
  const racedSweep = async (verb: Record<string, unknown>) => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.price = priced();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    fx.answers.engineLive = false;
    const VERBS = async (_r: string, a: string[]) => a[0] === "status" ? { runs: [{ run_id: "run-sweep-20261029T101010Z", state: "running" }] } : { state: "cancelled" };
    let raced = false;
    const deps: WorktreeDeps = {
      ...fx.deps,
      verbs: async () => verb,
      run: async (bin, args, o) => {
        if (!raced && args[0] === "worktree" && args[1] === "remove") {
          raced = true;
          await cancelRun(fx.queue, fx.id, { verbRunner: VERBS, launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
        }
        return fx.deps.run!(bin, args, o);
      },
    };
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(raced).toBe(true);
    expect(fx.get().state).toBe("cancelled");
    return fx;
  };

  test("a raced sweep whose `finish` was refused: the priced engine on one `:engine` line, named on the raced `closed_out`", async () => {
    const fx = await racedSweep({ ok: false, error: "run already ended cancelled" });
    expect(closedOut(fx).detail).toMatchObject({ finish: { ok: false }, engine_cost_usd: 3.75, engine_job_run: "run-sweep-20261029T101010Z:engine", raced: expect.any(String) });
    expect(jobRuns(fx)).toEqual([{ job_id: SWEEP_JOB_TYPE, run_id: "run-sweep-20261029T101010Z:engine", state: "complete", total_cost_usd: 3.75 }]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(jobRuns(fx)).toHaveLength(1);
  });

  test("a raced sweep whose `finish` succeeded: the run's own line holds the sum, so no `:engine` line, `engine_cost_usd` still recorded", async () => {
    const fx = await racedSweep({ ok: true, state: "partial" });
    expect(closedOut(fx).detail).toMatchObject({ finish: { ok: true }, engine_cost_usd: 3.75 });
    expect(closedOut(fx).detail!.engine_job_run).toBeUndefined();
    expect(jobRuns(fx)).toEqual([]);
  });

  test("the late close-out with no studio run: no line, `engine_job_run` is `skipped: <why>`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.price = priced();
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    fx.queue.db.query("UPDATE runs SET studio_run_id = NULL WHERE run_id = ?").run(fx.id); // before the end: a terminal row is immutable
    await cancelRun(fx.queue, fx.id, { launchStop: async () => ({ ok: true, detail: "stopping" }), worktree: fx.deps });
    expect(fx.get().state).toBe("cancelled");
    fx.answers.engineLive = false;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(jobRuns(fx)).toEqual([]);
    expect(closedOut(fx).detail).toMatchObject({ engine_cost_usd: 3.75, engine_job_run: "skipped: no studio run recorded" });
  });

  test("the late close-out with no price emits no line; a failed emit is recorded and the close-out still lands", async () => {
    const none = await cancelled(["a"]);
    expect(await sweepEngines(none.queue, none.deps)).toEqual([none.id]);
    expect(jobRuns(none)).toEqual([]);
    expect(closedOut(none).detail!.engine_cost_usd).toBeUndefined();
    expect(closedOut(none).detail!.engine_job_run).toBeUndefined();
    const fx = await cancelled(["a"]);
    fx.answers.price = priced();
    fx.answers.emit = { exit: 2, stdout: JSON.stringify({ ok: false, error: "ledger refused" }), stderr: "" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(closedOut(fx).detail).toMatchObject({ engine_cost_usd: 3.75, engine_job_run: "error: ledger refused" });
  });

  test("the `:engine` line in the readers: neither the run's own line dropped nor either counted twice", () => {
    const line = (job_id: string, run_id: string, total_cost_usd: number) => JSON.stringify({ event: "job-run", project: "proj", payload: { job_id, run_id, state: "cancelled", total_cost_usd } });
    const text = [line("run-epic-9", "s-1", 0.5), line("run-epic-9", "s-1:engine", 3.75), line("run-sweep", "s-2", 0.5), line("run-sweep", "s-2:engine", 3.75)].join("\n");
    const costs = jobRunCosts(text);
    // Story 37.5 (DW-139): the bare id answers the full line (own + `:engine`), the `:engine` line folded into it
    expect(costs.get("s-2")!.cost).toBe(4.25);
    expect(costs.get("s-2:engine")).toBeUndefined();
    expect([...costs.values()].reduce((sum, c) => sum + c.cost, 0)).toBe(8.5);
    const file = join(tempDir("tk-sup-sweep-ledger-"), "l.jsonl");
    writeFileSync(file, text);
    expect(runCost(file, "s-2")).toBe(4.25); // Story 37.5 (DW-139): the bare id, own + `:engine` (was the worker's 0.5)
    expect(runCost(file, "s-2:engine")).toBe(3.75);
    expect(spendByEpic(file, "proj").get("9")).toBe(4.25); // each once; a `run-sweep` job is no epic's
    expect(spendByEpic(file, "proj").size).toBe(1);
  });

  const paused = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
  const allLanded = async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.landed("b");
    fx.commit("a.txt", "sweep bundle dw-a");
    return fx;
  };

  test("a sweep stopped on an earlier tick, its close-out refused that tick, ends `complete`: the note holds the stop", async () => {
    const fx = await allLanded();
    fx.answers.launch = paused;
    const take = fx.queue.takeForCloseOut.bind(fx.queue);
    fx.queue.takeForCloseOut = () => null;
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    fx.queue.takeForCloseOut = take;
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP).map((e) => e.detail)).toMatchObject([{ engine_run_id: "E1", stopped: true }]);
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("complete");
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP)).toHaveLength(1);
  });

  test("a stop that reported a failure while the engine did stop is the supervisor's stop too: `complete` next tick", async () => {
    const fx = await allLanded();
    fx.answers.launch = paused;
    fx.answers.stop = { exit: 124, stdout: "", stderr: "timed out" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("complete");
  });

  test("a `stopped` engine with no such note caps at `partial`; another engine run's note does not count, nor a note on a crash", async () => {
    const fx = await allLanded();
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get()).toMatchObject({ state: "partial", reason: "engine ended 'stopped' after 2/2 bundles" });
    const other = await allLanded();
    other.queue.note(other.id, SWEEP_ENGINE_STOP, { engine_run_id: "E0", stopped: true });
    other.answers.launch = { ok: true, run: { status: "stopped" } };
    await sweepEngines(other.queue, other.deps);
    expect(other.get().state).toBe("partial");
    const crashed = await allLanded();
    crashed.queue.note(crashed.id, SWEEP_ENGINE_STOP, { engine_run_id: "E1", error: "stop failed" });
    crashed.answers.launch = { ok: true, run: { status: "crashed" } };
    await sweepEngines(crashed.queue, crashed.deps);
    expect(crashed.get().state).toBe("partial");
  });

  test("the worker's figure is the launch worker's alone: a `run.json` total is never labelled the worker's turns nor summed with the engine", async () => {
    const fx = await landedFixture();
    writeFileSync(join(fx.runDir, "run.json"), JSON.stringify({ total_cost_usd: 9 }));
    fx.queue.note(fx.id, "accounted", { cost_usd: 7, engine_run_id: "E0", source: "engine" });
    expect(launchedCloseOutInput(fx.queue.events(fx.id), fx.get()).costUsd).toBe(16); // any other run: the engine's, summed
    expect(launchedCloseOutInput(fx.queue.events(fx.id), fx.get(), { workerOnly: true }).costUsd).toBe(0.5);
    fx.answers.price = priced();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("$0.5000 (worker turns) + $3.7500 (engine) = $4.2500");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--total-cost-usd") + 1]).toBe("4.25");
  });

  test("no launch-worker figure reads `not metered`, the `run.json` total not used in its place", async () => {
    const fx = await landedFixture();
    fx.queue.markLaunched(fx.id, "E1", { end: { state: "complete", reason: null } });
    writeFileSync(join(fx.runDir, "run.json"), JSON.stringify({ total_cost_usd: 9 }));
    fx.answers.price = priced();
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain("not metered (worker turns) + $3.7500 (engine) = $3.7500");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--total-cost-usd") + 1]).toBe("3.75");
  });
});

describe("Story 36.3: a paused sweep's bounded stop and its WIP (DW-121)", () => {
  const PAUSED = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation", paused_story_key: "dw-b" } };
  const REFUSED: RunResult = { exit: 2, stdout: "", stderr: "sbx exec: sandbox stopped" };
  const notifying = (fx: Awaited<ReturnType<typeof sweepFixture>>, now: () => number) => {
    const sent: string[] = [];
    const env = { ...fx.deps.env, TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" };
    const deps: WorktreeDeps = { ...fx.deps, env, clockMs: now, hygiene: { env, fetch: async (_u, init) => { sent.push(String(init?.body ?? "")); return new Response("ok", { status: 200 }); } } };
    return { deps, sent };
  };
  const firstNoteAt = (fx: Awaited<ReturnType<typeof sweepFixture>>) => Date.parse(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_ENGINE_STOP)!.at);

  test("Story 36.3: a stop unanswered under the deadline is retried with one note; past it: one line, an explicit `blocked` end, the WIP committed, lock and pin held (Story 38.3)", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a"); // `sweepEndState` would read this `partial`
    fx.answers.launch = PAUSED;
    fx.answers.stop = REFUSED;
    fx.commit("a.txt", "bundle a");
    writeFileSync(join(fx.served, "half.txt"), "half-written");
    let now = Date.now();
    const n = notifying(fx, () => now);
    expect(await sweepEngines(fx.queue, n.deps)).toEqual([]);
    now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS - 1000;
    expect(await sweepEngines(fx.queue, n.deps)).toEqual([]);
    expect(fx.get().state).toBe("running");
    expect(n.sent).toEqual([]);
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP)).toHaveLength(1);
    now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS + 1000;
    expect(await sweepEngines(fx.queue, n.deps)).toEqual([fx.id]);
    const line = `paused sweep ${fx.id}: stop unanswered for 30 min — ended blocked, lock and pin held until a stop is confirmed or the engine exits`;
    expect(n.sent).toEqual([line]);
    expect(fx.get().state).toBe("blocked");
    expect(fx.get().reason).toContain(line);
    expect(fx.get().reason).toContain(wipMessage("dw-b", fx.id));
    // Story 38.3 (B1): the unanswered engine may still run, so its lock stays the engine's
    expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id, engine_run_id: "E1" });
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail).toMatchObject({ engine_held: { engine_run_id: "E1" }, lock: { handed_to_engine: "E1" } });
    expect(existsSync(fx.get().worktree!)).toBe(true); // the unanswered engine may still run there
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail).toMatchObject({ closeout: { worktree: "kept" } });
    expect(testGit(fx.repo.origin, "log", "-1", "--format=%s", `supervisor/run-${fx.id}`)).toBe(wipMessage("dw-b", fx.id));
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
    const verify = fx.queue.events(fx.id).filter((e) => e.kind === "host-verify");
    expect(verify.map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused sweep: WIP committed, leg skipped" }]);
    expect(await sweepEngines(fx.queue, n.deps)).toEqual([]); // ended: one line, one end
    expect(n.sent).toHaveLength(1);
  });

  test("Story 36.3: a clean tree past the deadline still ends `blocked`, no leg, the PR a draft", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.answers.launch = PAUSED;
    fx.answers.stop = REFUSED;
    fx.commit("a.txt", "bundle a");
    let now = Date.now();
    const n = notifying(fx, () => now);
    await sweepEngines(fx.queue, n.deps);
    now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS + 1000;
    expect(await sweepEngines(fx.queue, n.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("blocked");
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused sweep: stop unanswered, leg skipped" }]);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
  });

  describe("Story 36.3: the status probe fails after an unanswered stop", () => {
    const UNKNOWN = { ok: false, error: "sbx exec: sandbox stopped" };
    const stops = (fx: Awaited<ReturnType<typeof sweepFixture>>) => fx.studio.filter((c) => c.script.endsWith("launch.py") && c.args[0] === "stop").length;
    /** A first failed stop on a paused engine (one `error` note), with a half-written tree; the status then answers `after`. */
    const firstFailed = async (after: unknown) => {
      const fx = await sweepFixture();
      fx.triage();
      fx.landed("a");
      fx.answers.launch = PAUSED;
      fx.answers.stop = REFUSED;
      fx.commit("a.txt", "bundle a");
      writeFileSync(join(fx.served, "half.txt"), "half-written");
      const clock = { now: Date.now() };
      const n = notifying(fx, () => clock.now);
      expect(await sweepEngines(fx.queue, n.deps)).toEqual([]);
      expect(stops(fx)).toBe(1);
      fx.answers.launch = after;
      return { fx, n, clock };
    };

    test("Story 36.3: `unknown` under the deadline: no end, no stop; past it with the stop still failing: `blocked`, the WIP committed, one line, tree kept", async () => {
      const { fx, n, clock } = await firstFailed(UNKNOWN);
      clock.now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS - 1000;
      expect(await sweepEngines(fx.queue, n.deps)).toEqual([]);
      expect(fx.get().state).toBe("running");
      expect(stops(fx)).toBe(1);
      expect(n.sent).toEqual([]);
      clock.now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS + 1000;
      expect(await sweepEngines(fx.queue, n.deps)).toEqual([fx.id]);
      expect(stops(fx)).toBe(2);
      const line = `paused sweep ${fx.id}: stop unanswered for 30 min — ended blocked, lock and pin held until a stop is confirmed or the engine exits`;
      expect(n.sent).toEqual([line]);
      expect(fx.get().state).toBe("blocked");
      expect(fx.get().reason).toContain(line);
      expect(fx.get().reason).toContain(wipMessage("dw-b", fx.id));
      expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id, engine_run_id: "E1" }); // Story 38.3: held
      expect(existsSync(fx.get().worktree!)).toBe(true);
      expect(testGit(fx.repo.origin, "log", "-1", "--format=%s", `supervisor/run-${fx.id}`)).toBe(wipMessage("dw-b", fx.id));
      expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).toContain("--draft");
      expect(fx.queue.events(fx.id).filter((e) => e.kind === "host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused sweep: WIP committed, leg skipped" }]);
      expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP)).toHaveLength(1);
    });

    test("Story 36.3: `unknown` past the deadline with a WIP commit that fails still ends `blocked`, `wip.error` naming the failure", async () => {
      const { fx, n, clock } = await firstFailed(UNKNOWN);
      testGit(fx.served, "checkout", "-q", "-b", "elsewhere");
      clock.now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS + 1000;
      expect(await sweepEngines(fx.queue, n.deps)).toEqual([fx.id]);
      expect(fx.get().state).toBe("blocked");
      expect(fx.get().reason).toContain("WIP not committed, worktree kept: the worktree is on 'elsewhere'");
      expect((fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail as any).wip.error).toContain("elsewhere");
      expect(n.sent).toHaveLength(1);
      expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id }); // Story 38.3: held
    });

    test("Story 36.3: `unknown` past the deadline with the stop answering `stopped`: no end this tick; the next closes it out as usual", async () => {
      const { fx, n, clock } = await firstFailed(UNKNOWN);
      fx.answers.stop = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
      clock.now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS + 1000;
      expect(await sweepEngines(fx.queue, n.deps)).toEqual([]);
      expect(stops(fx)).toBe(2);
      expect(fx.get().state).toBe("running");
      expect(n.sent).toEqual([]);
      fx.answers.launch = { ok: true, run: { status: "stopped" } };
      expect(await sweepEngines(fx.queue, n.deps)).toEqual([fx.id]);
      expect(fx.get().state).not.toBe("blocked");
      expect(n.sent).toEqual([]);
    });

    test("Story 36.3: `running` past the deadline is never ended or stopped", async () => {
      const { fx, n, clock } = await firstFailed({ ok: true, run: { status: "running" } });
      clock.now = firstNoteAt(fx) + SWEEP_STOP_DEADLINE_MS + 1000;
      expect(await sweepEngines(fx.queue, n.deps)).toEqual([]);
      expect(stops(fx)).toBe(1);
      expect(fx.get().state).toBe("running");
      expect(n.sent).toEqual([]);
    });
  });

  test("Story 36.3: a `{stopped: true}` note starts no deadline; a later failure's `error` note does", () => {
    const at = (iso: string, detail: Record<string, unknown>) => ({ seq: 1, kind: SWEEP_ENGINE_STOP, at: iso, detail }) as unknown as QueueEvent;
    const t0 = Date.parse("2026-10-30T00:00:00.000Z");
    const stopped = at("2026-10-30T00:00:00.000Z", { engine_run_id: "E1", stopped: true });
    expect(sweepStopPastDeadline([stopped], "E1", t0 + 10 * SWEEP_STOP_DEADLINE_MS)).toBe(false);
    const failed = at("2026-10-30T01:00:00.000Z", { engine_run_id: "E1", error: "stop failed" });
    expect(sweepStopPastDeadline([stopped, failed], "E1", t0 + SWEEP_STOP_DEADLINE_MS + 1000)).toBe(false);
    expect(sweepStopPastDeadline([stopped, failed], "E1", Date.parse(failed.at) + SWEEP_STOP_DEADLINE_MS + 1000)).toBe(true);
    expect(sweepStopPastDeadline([failed], "E2", Date.parse(failed.at) + SWEEP_STOP_DEADLINE_MS + 1000)).toBe(false);
  });

  test("Story 36.3: a stop answered with a dirty tree: WIP on the run branch, the leg skipped, the PR a draft, the landed bundle flips and the WIP bundle's stays open", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "bundle a");
    fx.answers.launch = PAUSED;
    writeFileSync(join(fx.served, "half.txt"), "half-written");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toContain(wipMessage("dw-b", fx.id));
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail as Record<string, any>;
    expect(ended.sweep.bundles.map((b: Record<string, unknown>) => [b.name, b.landed])).toEqual([["a", true], ["b", false]]);
    expect(ended.closeout.result).toBe("draft PR");
    expect(ended.wip).toMatchObject({ committed: true, message: wipMessage("dw-b", fx.id) });
    expect(testGit(fx.repo.origin, "show", "--name-only", "--format=%s", `supervisor/run-${fx.id}`).split("\n")).toContain("half.txt");
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused sweep: WIP committed, leg skipped" }]);
    expect(fx.studio.some((s) => s.args[0] === "host-verify")).toBe(false);
  });

  test("Story 36.3: a WIP sweep whose bundles all landed ends `partial`, naming the WIP; never `complete`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.landed("b");
    fx.commit("a.txt", "bundles");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    writeFileSync(join(fx.served, "half.txt"), "half-written");
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toContain("WIP committed on");
  });

  test("Story 36.3: a stop answered with a clean tree proceeds as today: the leg runs, the PR ready, every bundle landed `complete`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.landed("b");
    fx.commit("a.txt", "bundles");
    fx.answers.launch = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("complete");
    expect((fx.queue.events(fx.id).filter((e) => e.kind === "host-verify")[0]!.detail as Record<string, unknown>).reason).not.toContain("paused sweep");
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.argv).not.toContain("--draft");
  });

  test("Story 36.3: an sbx-tier sweep's stop goes through `deps.sbx.run`, a hard stop (no `--graceful`)", async () => {
    const calls: string[][] = [];
    const wt = tempDir("tk-sup-sweep-stop-");
    const answer = await stopEngine({ worktree: wt, prefix: "", engine_run_id: "E1", tier: "sbx", sandbox: "claude-p" },
      { env: { TK_STUDIO_ROOT: "/studio" }, sbx: { run: async (_b, a) => { calls.push(a); return { exit: 0, stdout: "{}", stderr: "" }; } } });
    expect(answer).toBe("stopped");
    expect(calls[0]!.slice(0, 2)).toEqual(["exec", "claude-p"]);
    expect(calls[0]).toContain("stop");
    expect(calls[0]).not.toContain("--graceful");
    // Story 37.6 (AC1): the one builder's argv, `--directory` the VM root.
    expect(calls[0]).toEqual(engineStopArgv(wt, "E1", { tier: "sbx", sandbox: "claude-p" }, { env: { TK_STUDIO_ROOT: "/studio" } }).argv);
    expect(calls[0]).toEqual(["exec", "claude-p", "uv", "run", "/studio/plugins/tk-studio/lib/launch.py", "stop", "--directory", toVmPath(wt), "--run-id", "E1"]);
  });
});

describe("Story 37.5: the sweep's end-rule bugs and cost lines before a fourth sweep", () => {
  const PENDING = { exit: 0, out: { ok: true, resolved: [], pending: ["DW-1", "DW-2"], unchanged: [] } };
  const merged = async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "MERGED" });
    ownerLedger(fx.root, "never pulled");
    return fx;
  };
  const records = (fx: Awaited<ReturnType<typeof sweepFixture>>) => fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE);

  test("B4: an unchanged wait past `SWEEP_LEDGER_WAIT_MS` ends with one `ended: \"wait\"` record and one notifier line, never again", async () => {
    const fx = await merged();
    fx.answers.ledger.push(PENDING);
    const lines: string[] = [];
    const notify = async (text: string) => { lines.push(text); return { ok: true }; };
    expect(await ledgerPass(fx.queue, fx.deps, notify)).toEqual([fx.id]);
    const first = records(fx)[0]!;
    expect(first.detail).toMatchObject({ waiting: true, pending: ["DW-1", "DW-2"] });
    let now = Date.parse(first.at) + SWEEP_LEDGER_WAIT_MS - 1000;
    const deps = { ...fx.deps, now: () => now };
    expect(await ledgerPass(fx.queue, deps, notify)).toEqual([]); // under the bound: quiet
    expect(records(fx)).toHaveLength(1);
    expect(lines).toEqual([]);
    now = Date.parse(first.at) + SWEEP_LEDGER_WAIT_MS + 1000;
    expect(await ledgerPass(fx.queue, deps, notify)).toEqual([fx.id]);
    expect(records(fx)).toHaveLength(2);
    expect(records(fx)[1]!.detail).toMatchObject({ waiting: false, settled: true, ended: "wait", pending: ["DW-1", "DW-2"], ok: true, notify: { ok: true } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`sweep ${fx.id}`);
    expect(lines[0]).toContain("DW-1, DW-2");
    // the settled run is never flipped again on its own: the line carries the manual remedy, the PR and the pending ids
    // Story 38.3 (B4): the remedy is the one builder's, the verb's absolute path under the studio install (joined natively)
    const cmd = ledgerResolveCommand(fx.root, String(first.detail!.pr), ["DW-1", "DW-2"], fx.deps.env);
    expect(lines[0]).toEndWith(`; once the owner checkout has pulled, flip them by hand: ${ledgerRemedyText(cmd)}`);
    expect(lines[0]).toContain(`uv run --no-project python "${join("/studio-root", "plugins", "tk-studio", "lib", "plansync.py")}" ledger-resolve --directory "${fx.root}" --pr ${String(first.detail!.pr)} --ids DW-1,DW-2`);
    // the lease released settled, the one plansync call only
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "plan-lease" && e.detail?.phase === LEDGER_LEASE && e.detail?.owner === null).at(-1)!.detail?.settled).toBe(true);
    for (let i = 0; i < 3; i++) expect(await ledgerPass(fx.queue, deps, notify)).toEqual([]);
    expect(records(fx)).toHaveLength(2);
    expect(lines).toHaveLength(1);
    expect(fx.studio.filter((c) => c.script.endsWith("plansync.py") && c.args[0] === "ledger-resolve")).toHaveLength(1);
  });

  test("B4: a changed `pending` set is a new record and a new clock", async () => {
    const fx = await merged();
    fx.answers.ledger.push(PENDING, { exit: 0, out: { ok: true, resolved: ["DW-1"], pending: ["DW-2"], unchanged: [] } });
    const lines: string[] = [];
    const notify = async (text: string) => { lines.push(text); return { ok: true }; };
    await ledgerPass(fx.queue, fx.deps, notify);
    // the first wait's record two hours old
    const old = new Date(Date.now() - 2 * SWEEP_LEDGER_WAIT_MS).toISOString();
    fx.queue.db.query("UPDATE events SET at = ? WHERE seq = ?").run(old, records(fx)[0]!.seq);
    ownerLedger(fx.root, "pulled once, one id still open");
    const deps = { ...fx.deps, now: () => Date.now() + 1000 };
    expect(await ledgerPass(fx.queue, deps, notify)).toEqual([fx.id]); // changed: a call, a new record
    expect(records(fx).map((e) => e.detail?.pending)).toEqual([["DW-1", "DW-2"], ["DW-2"]]);
    expect(await ledgerPass(fx.queue, deps, notify)).toEqual([]); // the new clock has not run out
    expect(records(fx)).toHaveLength(2);
    expect(lines).toEqual([]);
  });

  test("B4: the merge pass injects the notifier (the cycle rule: `sweep.ts` imports neither `hygiene` nor `worktree`)", async () => {
    const fx = await merged();
    fx.answers.ledger.push(PENDING);
    await ledgerPass(fx.queue, fx.deps);
    const sent: string[] = [];
    const env = { ...fx.deps.env, TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" };
    const at = Date.parse(records(fx)[0]!.at);
    const deps = { ...fx.deps, env, now: () => at + SWEEP_LEDGER_WAIT_MS + 1000, hygiene: { env, fetch: (async (_u: unknown, init?: RequestInit) => { sent.push(String(init?.body ?? "")); return new Response("ok", { status: 200 }); }) as typeof fetch } };
    await mergePass(fx.queue, deps);
    expect(records(fx).at(-1)!.detail).toMatchObject({ ended: "wait", settled: true });
    expect(sent.filter((t) => t.includes("stopped waiting"))).toHaveLength(1);
    expect(readFileSync(resolve(import.meta.dir, "../src/sweep.ts"), "utf-8")).not.toMatch(/^import (?!type)[^;]*from "\.\/(hygiene|worktree)"/m);
  });

  test("B5: a probe answering `unknown` from the start (never paused) notes one `engine-probe`; Story 38.3 (B1): a `running` probe resets the deadline, a later blip starts a new one; past it: the stop, then `blocked`, held", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "bundle a");
    const UNKNOWN = { ok: false, error: "sbx exec: sandbox stopped" };
    fx.answers.launch = UNKNOWN;
    fx.answers.stop = { exit: 2, stdout: "", stderr: "sbx exec: sandbox stopped" };
    const sent: string[] = [];
    let now = Date.now();
    const env = { ...fx.deps.env, TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" };
    const deps: WorktreeDeps = { ...fx.deps, env, clockMs: () => now, hygiene: { env, fetch: async (_u, init) => { sent.push(String(init?.body ?? "")); return new Response("ok", { status: 200 }); } } };
    const probes = () => fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_PROBE);
    const stops = () => fx.studio.filter((c) => c.script.endsWith("launch.py") && c.args[0] === "stop").length;
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    expect(probes()).toHaveLength(1);
    expect(probes()[0]!.detail).toMatchObject({ engine_run_id: "E1", phase: "unknown" });
    expect(typeof probes()[0]!.detail!.error).toBe("string");
    expect(fx.queue.events(fx.id).some((e) => e.kind === SWEEP_ENGINE_STOP)).toBe(false); // never an `engine-stop` note
    fx.answers.launch = { ok: true, run: { status: "running" } };
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // `running`: the streak closed by one `running` note
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // still `running`: no streak open, no note
    expect(probes().map((e) => e.detail?.phase)).toEqual(["unknown", "running"]);
    fx.answers.launch = UNKNOWN;
    // the early blip and the `running` note moved back: the early note is past its deadline by the queue's own clock
    now = Date.now();
    fx.queue.db.query("UPDATE events SET at = ? WHERE seq = ?").run(new Date(now - SWEEP_STOP_DEADLINE_MS - 60_000).toISOString(), probes()[0]!.seq);
    fx.queue.db.query("UPDATE events SET at = ? WHERE seq = ?").run(new Date(now - 10 * 60_000).toISOString(), probes()[1]!.seq);
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // the fresh blip starts a new clock: no stop
    expect(probes().map((e) => e.detail?.phase)).toEqual(["unknown", "running", "unknown"]);
    expect(stops()).toBe(0);
    expect(fx.get().state).toBe("running");
    // the new streak's own note, once per streak
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    expect(probes()).toHaveLength(3);
    now = Date.parse(probes()[2]!.at) + SWEEP_STOP_DEADLINE_MS + 1000;
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(stops()).toBe(1);
    expect(fx.get().state).toBe("blocked");
    // never paused nor asked to stop: the line names the probe; the stop unanswered, the lock and pin held
    expect(sent).toEqual([`sweep ${fx.id}: the status probe answered \`unknown\` for 30 min — ended blocked, lock and pin held until a stop is confirmed or the engine exits`]);
    expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id, engine_run_id: "E1" });
  });

  test("B5: a probe-only stop that answered `stopped` notes `engine-stop {stopped: true}` once; the next tick's `stopped` end commits the WIP and is not penalised", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "bundle a");
    fx.answers.launch = { ok: false, error: "sbx exec: sandbox stopped" };
    fx.answers.stop = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    let now = Date.now();
    const deps: WorktreeDeps = { ...fx.deps, clockMs: () => now };
    const stopNotes = () => fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP);
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    expect(stopNotes()).toHaveLength(0); // the probe alone: an `engine-probe` note, never an `engine-stop` one
    now = Date.parse(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_ENGINE_PROBE)!.at) + SWEEP_STOP_DEADLINE_MS + 1000;
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // the stop answered `stopped`: no end this tick
    expect(stopNotes().map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", stopped: true })]);
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    writeFileSync(join(fx.served, "half.txt"), "half-written");
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("partial");
    expect(fx.get().reason).toContain(wipMessage("dw-b", fx.id));
    expect(fx.get().reason).not.toContain("engine ended 'stopped'"); // the supervisor's own stop: exempted
    expect(testGit(fx.repo.origin, "log", "-1", "--format=%s", `supervisor/run-${fx.id}`)).toBe(wipMessage("dw-b", fx.id));
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused sweep: WIP committed, leg skipped" }]);
    expect(fx.studio.some((s) => s.args[0] === "host-verify")).toBe(false);
  });

  test("B5: a probe-only stop that answered `stopped`, the next tick's probe still `unknown`: ended `blocked` on that tick, no second stop, the probe line", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "bundle a");
    fx.answers.launch = { ok: false, error: "sbx exec: sandbox stopped" };
    fx.answers.stop = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    const sent: string[] = [];
    let now = Date.now();
    const env = { ...fx.deps.env, TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" };
    const deps: WorktreeDeps = { ...fx.deps, env, clockMs: () => now, hygiene: { env, fetch: async (_u, init) => { sent.push(String(init?.body ?? "")); return new Response("ok", { status: 200 }); } } };
    const stopNotes = () => fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP);
    const stops = () => fx.studio.filter((c) => c.script.endsWith("launch.py") && c.args[0] === "stop").length;
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    now = Date.parse(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_ENGINE_PROBE)!.at) + SWEEP_STOP_DEADLINE_MS + 1000;
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // the stop answered `stopped`: noted, no end this tick
    expect(stops()).toBe(1);
    expect(stopNotes().map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", stopped: true })]);
    writeFileSync(join(fx.served, "half.txt"), "half-written");
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]); // still `unknown`: asked once more, then the `blocked` end
    expect(fx.get().state).toBe("blocked");
    expect(stops()).toBe(1); // never a second stop
    expect(stopNotes()).toHaveLength(1);
    // its stop answered, the engine never paused: the line names the probe, never a stop left unanswered
    expect(sent).toEqual([`sweep ${fx.id}: the status probe answered \`unknown\` for 30 min — ended blocked, lock and pin released`]);
    // Story 38.3 (B1): a stop already confirmed releases at once, never held
    expect(fx.queue.lock(fx.root)).toBeNull();
    expect(heldEngine(fx.queue.events(fx.id))).toBeUndefined();
    expect(fx.get().reason).toContain(wipMessage("dw-b", fx.id));
    expect(testGit(fx.repo.origin, "log", "-1", "--format=%s", `supervisor/run-${fx.id}`)).toBe(wipMessage("dw-b", fx.id));
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "host-verify").map((e) => e.detail)).toEqual([{ skipped: true, reason: "paused sweep: WIP committed, leg skipped" }]);
    expect(existsSync(fx.served)).toBe(true); // the worktree kept
  });

  test("B5: `sweepStopPastDeadline` takes the earlier of the `engine-probe` note and the first `engine-stop` error", () => {
    const ev = (kind: string, iso: string, detail: Record<string, unknown>) => ({ seq: 1, kind, at: iso, detail }) as unknown as QueueEvent;
    const probe = ev(SWEEP_ENGINE_PROBE, "2026-11-06T00:00:00.000Z", { engine_run_id: "E1", phase: "unknown", error: "x" });
    const stop = ev(SWEEP_ENGINE_STOP, "2026-11-06T00:20:00.000Z", { engine_run_id: "E1", error: "stop failed" });
    const t = Date.parse(probe.at) + SWEEP_STOP_DEADLINE_MS + 1000;
    expect(sweepStopPastDeadline([probe, stop], "E1", t)).toBe(true);
    expect(sweepStopPastDeadline([stop], "E1", t)).toBe(false);
    expect(sweepStopPastDeadline([probe], "E2", t)).toBe(false);
  });

  test("Story 38.3 (B1): the deadline runs from the first note of the latest non-`running` streak; an older note with no `phase` reads non-`running`", () => {
    const ev = (kind: string, iso: string, detail: Record<string, unknown>) => ({ seq: 1, kind, at: iso, detail }) as unknown as QueueEvent;
    const early = ev(SWEEP_ENGINE_PROBE, "2026-11-07T00:00:00.000Z", { engine_run_id: "E1", phase: "unknown", error: "x" });
    const running = ev(SWEEP_ENGINE_PROBE, "2026-11-07T00:05:00.000Z", { engine_run_id: "E1", phase: "running" });
    const blip = ev(SWEEP_ENGINE_PROBE, "2026-11-07T01:00:00.000Z", { engine_run_id: "E1", phase: "unknown", error: "y" });
    const t = Date.parse(blip.at) + 10 * 60_000; // past the early note's deadline, 10 min after the blip
    expect(sweepStopPastDeadline([early], "E1", t)).toBe(true);
    expect(sweepStopPastDeadline([early, running], "E1", t)).toBe(false); // reset, no streak open
    expect(sweepStopPastDeadline([early, running, blip], "E1", t)).toBe(false);
    expect(sweepStopPastDeadline([early, running, blip], "E1", Date.parse(blip.at) + SWEEP_STOP_DEADLINE_MS + 1000)).toBe(true);
    // a stop error after the reset starts the new streak too; another engine's `running` note resets nothing
    const stopErr = ev(SWEEP_ENGINE_STOP, "2026-11-07T00:50:00.000Z", { engine_run_id: "E1", error: "stop failed" });
    expect(sweepStopPastDeadline([early, running, stopErr, blip], "E1", Date.parse(stopErr.at) + SWEEP_STOP_DEADLINE_MS + 1000)).toBe(true);
    const other = ev(SWEEP_ENGINE_PROBE, "2026-11-07T00:05:00.000Z", { engine_run_id: "E2", phase: "running" });
    expect(sweepStopPastDeadline([early, other], "E1", t)).toBe(true);
    const legacy = ev(SWEEP_ENGINE_PROBE, "2026-11-07T00:00:00.000Z", { engine_run_id: "E1", error: "x" });
    expect(sweepStopPastDeadline([legacy], "E1", t)).toBe(true);
    expect(sweepStopPastDeadline([legacy, running], "E1", t)).toBe(false);
  });

  test("DW-137: the note is patched `emitting` before the emit, then `emitted`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    const during: unknown[] = [];
    const inner = fx.deps.uv!;
    const deps: WorktreeDeps = { ...fx.deps, uv: async (root, script, args, t) => {
      if (script.endsWith("ledger.py")) during.push(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!.detail!.ledger);
      return inner(root, script, args, t);
    } };
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    expect(during).toEqual(["emitting"]);
    expect(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!.detail!.ledger).toBe("emitted");
  });

  test("DW-144: a failed emit is retried by the ledger pass on the ended run until it lands, then never again; an `emitting` marker too", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.answers.emit = { exit: 2, stdout: JSON.stringify({ ok: false, error: "ledger refused" }), stderr: "" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]); // ended: no tick of the watch revisits it
    const emits = () => fx.studio.filter((s) => s.script.endsWith("ledger.py") && s.args.includes(SWEEP_TRIAGE)).length;
    const ledger = () => fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!.detail!.ledger;
    expect(emits()).toBe(1);
    await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(2);
    expect(ledger()).toBe("error: ledger refused");
    fx.answers.emit = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(3);
    expect(ledger()).toBe("emitted");
    await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(3); // never doubled after `emitted`
    // a crash between the marker and the emit reads `emitting`: retried
    const note = fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!;
    fx.queue.patchEventDetail(note.seq, { ledger: "emitting" });
    await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(4);
    expect(ledger()).toBe("emitted");
  });

  test("DW-144: the retry is bounded by `PLAN_RETRY_LIMIT` errors", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.answers.emit = { exit: 2, stdout: JSON.stringify({ ok: false, error: "ledger refused" }), stderr: "" };
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    for (let i = 0; i < PLAN_RETRY_LIMIT + 5; i++) await ledgerPass(fx.queue, fx.deps);
    expect(fx.studio.filter((s) => s.script.endsWith("ledger.py") && s.args.includes(SWEEP_TRIAGE))).toHaveLength(PLAN_RETRY_LIMIT);
    expect(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!.detail).toMatchObject({ ledger_errors: PLAN_RETRY_LIMIT });
  });

  test("DW-144: an `emitting` note whose `emitted` patch keeps failing is re-emitted at most `PLAN_RETRY_LIMIT` times, then never again", async () => {
    const fx = await sweepFixture();
    fx.triage();
    const patch = fx.queue.patchEventDetail.bind(fx.queue);
    fx.queue.patchEventDetail = (seq, p) => { if (p.ledger === "emitted") throw new Error("database is locked"); patch(seq, p); };
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const emits = () => fx.studio.filter((s) => s.script.endsWith("ledger.py") && s.args.includes(SWEEP_TRIAGE)).length;
    const note = () => fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!;
    expect(emits()).toBe(1); // the first emit: its marker counts nothing
    expect(note().detail!.ledger).toBe("emitting");
    expect(note().detail!.ledger_errors).toBeUndefined();
    await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(2);
    expect(note().detail).toMatchObject({ ledger: "emitting", ledger_errors: 1 }); // the retry counted
    for (let i = 0; i < PLAN_RETRY_LIMIT + 5; i++) await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(1 + PLAN_RETRY_LIMIT);
    expect(note().detail).toMatchObject({ ledger: "emitting", ledger_errors: PLAN_RETRY_LIMIT });
  });

  test("DW-144: the retry runs under the ledger lease:while another holder has it, no retry emits; the note is re-read under it", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.answers.emit = { exit: 2, stdout: JSON.stringify({ ok: false, error: "ledger refused" }), stderr: "" };
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const emits = () => fx.studio.filter((s) => s.script.endsWith("ledger.py") && s.args.includes(SWEEP_TRIAGE)).length;
    const note = () => fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!;
    expect(emits()).toBe(1);
    // an overlapping run/recover/drain process holds the lease (a live owner): this pass emits nothing
    const holder = { ...me, pid: me.pid + 1 };
    expect(fx.queue.claimPlanPhase(fx.id, LEDGER_LEASE, holder)).toBe(true);
    fx.answers.emit = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(1);
    expect(note().detail).toMatchObject({ ledger: "error: ledger refused", ledger_errors: 1 });
    // the holder lets go, but lands the emit between this pass's first read and its lease: re-read under it, not due
    fx.queue.releasePlanPhase(fx.id, LEDGER_LEASE, holder, true);
    const claim = fx.queue.claimPlanPhase.bind(fx.queue);
    fx.queue.claimPlanPhase = (runId, phase, self) => {
      if (phase === LEDGER_LEASE) fx.queue.patchEventDetail(note().seq, { ledger: "emitted" });
      return claim(runId, phase, self);
    };
    await ledgerPass(fx.queue, fx.deps);
    fx.queue.claimPlanPhase = claim;
    expect(emits()).toBe(1);
    // the lease free and the emit due again: retried once, the lease released settled (never a ledger-resolve try)
    fx.queue.patchEventDetail(note().seq, { ledger: "emitting" });
    await ledgerPass(fx.queue, fx.deps);
    expect(emits()).toBe(2);
    expect(note().detail!.ledger).toBe("emitted");
    const lease = fx.queue.events(fx.id).findLast((e) => e.kind === "plan-lease" && e.detail?.phase === LEDGER_LEASE)!;
    expect(lease.detail).toMatchObject({ owner: null, settled: true });
  });

  test("DW-136: the priced triage goes into `engine_cost_usd` and the total, a `- triage:` line, the record's `triage_cost_usd`", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.price = { exit: 0, stdout: JSON.stringify({ ok: true, usd_total: 4.75, prices_date: "2026-10-01",
      bundles: [{ key: "dw-a", usd: 3.75, source: "metered" }, { key: "dw-b", usd: null }], triage: { usd: 1, source: "sessions", bound: "upper" } }), stderr: "" };
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(fx.gh.calls().find((c) => c.argv[1] === "create")!.body).toContain(
      "## Metered cost\n\n$0.5000 (worker turns) + $4.7500 (engine) = $5.2500\n\n- a: $3.7500 (metered)\n- b: not metered\n- triage: $1.0000 (sessions)\n\n## Sweep");
    expect(fx.verbs[0]![fx.verbs[0]!.indexOf("--total-cost-usd") + 1]).toBe("5.25");
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    expect(ended.detail).toMatchObject({ engine_cost_usd: 4.75, sweep: { engine_cost_usd: 4.75, triage_cost_usd: 1 } });
    // the record round-trips it (a re-run's body); an unpriced triage reads `not metered`
    const back = summaryFromRecord(fx.queue.events(fx.id))!;
    expect(back.triage_cost_usd).toBe(1);
    const unpriced = withEngineCost(summary([true]), { usd: 2, bundles: [{ key: "dw-a", usd: 2, source: "sessions" }], triage: { usd: null } });
    expect(sweepRecord(unpriced).triage_cost_usd).toBeNull();
    expect(sweepCostText(unpriced, 0.5)).toBe("$0.5000 (worker turns) + $2.0000 (engine) = $2.5000\n\n- a: $2.0000 (sessions)\n- triage: not metered");
    // no `triage` member (an older verb, or no triage session): no line
    expect(sweepCostText(withEngineCost(summary([true]), { usd: 2, bundles: [{ key: "dw-a", usd: 2, source: "sessions" }] }), 0.5)).not.toContain("triage");
  });

  test("DW-139: a late-closed sweep's readers by the bare run id answer the full line; `:verify-<n>` stays out", () => {
    const line = (run_id: string, total_cost_usd: number) => JSON.stringify({ event: "job-run", project: "proj", payload: { job_id: "run-sweep", run_id, state: "complete", total_cost_usd } });
    const text = [line("s-2", 0.5), line("s-2:engine", 3.75), line("s-2:verify-1", 0.25)].join("\n");
    const costs = jobRunCosts(text);
    expect(costs.get("s-2")!.cost).toBe(4.25);
    expect(costs.get("s-2:verify-1")!.cost).toBe(0.25);
    expect([...costs.values()].reduce((sum, c) => sum + c.cost, 0)).toBe(4.5);
    const file = join(tempDir("tk-sup-sweep-ledger-"), "l.jsonl");
    writeFileSync(file, text);
    expect(runCost(file, "s-2")).toBe(4.25);
  });
});

describe("Story 38.3: the sweep's path cleared", () => {
  const PAUSED = { ok: true, run: { status: "running", paused_stage: "review", paused_reason: "escalation", paused_story_key: "dw-b" } };
  const REFUSED: RunResult = { exit: 2, stdout: "", stderr: "sbx exec: sandbox stopped" };
  /** A paused sweep whose stop went unanswered past the deadline: ended `blocked`, its lock and pin held. `sandbox`: on
   * the sbx tier, pinned (`sweepFixture`'s `sandbox`). */
  const held = async (opts: { sandbox?: string } = {}) => {
    const fx = await sweepFixture(opts);
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "bundle a");
    fx.answers.launch = PAUSED;
    fx.answers.stop = REFUSED;
    const clock = { now: Date.now() };
    const deps: WorktreeDeps = { ...fx.deps, clockMs: () => clock.now };
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    clock.now = Date.parse(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_ENGINE_STOP)!.at) + SWEEP_STOP_DEADLINE_MS + 1000;
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(fx.get().state).toBe("blocked");
    expect(heldEngine(fx.queue.events(fx.id))).toBe("E1");
    expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id, engine_run_id: "E1" });
    return { fx, deps };
  };
  const released = (fx: Awaited<ReturnType<typeof sweepFixture>>) => fx.queue.events(fx.id).filter((e) => e.kind === ENGINE_RELEASED);

  test("Story 38.3: a held end frees nothing while the probe answers `unknown` (fail closed); a confirmed stop releases the lock, `engine-released {by: \"stop\"}`", async () => {
    const { fx, deps } = await held();
    fx.answers.launch = { ok: false, error: "sbx exec: sandbox stopped" };
    for (let i = 0; i < 3; i++) expect(await releaseHeldEngines(fx.queue, deps)).toEqual([]);
    expect(released(fx)).toEqual([]);
    expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id });
    fx.answers.launch = PAUSED; // still running: one stop, still refused
    expect(await sweepEngines(fx.queue, deps)).toEqual([]);
    expect(released(fx)).toEqual([]);
    fx.answers.stop = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // the pass releases; it closes nothing out
    expect(released(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", by: "stop" })]);
    expect(fx.queue.lock(fx.root)).toBeNull();
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "lock-released").map((e) => e.detail?.why)).toEqual(["its engine's stop was confirmed"]);
    expect(heldEngine(fx.queue.events(fx.id))).toBeUndefined();
    expect(await releaseHeldEngines(fx.queue, deps)).toEqual([]); // released once
    expect(released(fx)).toHaveLength(1);
  });

  test("Story 38.3: a held engine's own exit releases the lock, `engine-released {by: \"exit\"}`", async () => {
    const { fx, deps } = await held();
    fx.answers.launch = { ok: true, run: { status: "stopped" } };
    expect(await releaseHeldEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(released(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", by: "exit" })]);
    expect(fx.queue.lock(fx.root)).toBeNull();
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "lock-released")!.detail?.why).toBe("its engine exited");
  });

  test("Story 38.3: a held engine's kept worktree removed reads as `ended`: the lock released, `engine-released {by: \"exit\"}`, nothing probed", async () => {
    const { fx, deps } = await held();
    fx.answers.launch = { ok: false, error: "sbx exec: sandbox stopped" }; // a probe would answer `unknown`
    rmSync(fx.get().worktree!, { recursive: true, force: true });
    const probes = fx.studio.length;
    expect(await releaseHeldEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(fx.studio.slice(probes)).toEqual([]); // the gone worktree is never probed nor stopped
    expect(released(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", by: "exit", engine: expect.objectContaining({ gone: expect.any(String) }) })]);
    expect(fx.queue.lock(fx.root)).toBeNull();
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "lock-released")!.detail?.why).toBe("its engine exited");
    expect(heldEngine(fx.queue.events(fx.id))).toBeUndefined();
  });

  /** Story 38.3 (B1): a paused sweep with an older streak (a stop refused, then a stop that answered `stopped` while the
   * engine kept running), closed by a `running` probe; the engine now probes paused and its stop is refused again. */
  const secondStreak = async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "bundle a");
    fx.answers.launch = PAUSED;
    fx.answers.stop = REFUSED;
    const clock = { now: Date.now() };
    const deps: WorktreeDeps = { ...fx.deps, clockMs: () => clock.now };
    const stopErrors = () => fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP && e.detail?.error !== undefined);
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // the older streak's `error` note
    fx.queue.note(fx.id, SWEEP_ENGINE_STOP, { engine_run_id: "E1", stopped: true }); // the old stop that answered `stopped`
    fx.answers.launch = { ok: true, run: { status: "running" } };
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // still running: one `running` note closes the older streak
    const old = fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_ENGINE_STOP || e.kind === SWEEP_ENGINE_PROBE);
    expect(old.map((e) => [e.kind, e.detail?.error !== undefined, e.detail?.stopped ?? null, e.detail?.phase ?? null]))
      .toEqual([[SWEEP_ENGINE_STOP, true, null, null], [SWEEP_ENGINE_STOP, false, true, null], [SWEEP_ENGINE_PROBE, false, null, "running"]]);
    // the older streak moved back well past the deadline: only the new streak's clock may count
    for (const [i, e] of old.entries()) {
      fx.queue.db.query("UPDATE events SET at = ? WHERE seq = ?").run(new Date(clock.now - 3 * SWEEP_STOP_DEADLINE_MS + i * 60_000).toISOString(), e.seq);
    }
    expect(stopErrors()).toHaveLength(1);
    fx.answers.launch = PAUSED;
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // paused again, the stop refused: the new streak's own `error` note
    return { fx, deps, clock, stopErrors };
  };

  test("Story 38.3 (B1): a paused sweep's second streak gets its own `engine-stop {error}` note; under the deadline the run is not ended", async () => {
    const { fx, deps, stopErrors } = await secondStreak();
    expect(stopErrors()).toHaveLength(2);
    expect(stopErrors()[1]!.detail).toMatchObject({ engine_run_id: "E1", error: expect.any(String) });
    expect(fx.get().state).toBe("running");
    expect(fx.queue.events(fx.id).some((e) => e.kind === "ended")).toBe(false);
    expect(await sweepEngines(fx.queue, deps)).toEqual([]); // retried: once per streak, no third note
    expect(stopErrors()).toHaveLength(2);
    expect(fx.get().state).toBe("running");
  });

  test("Story 38.3 (B1): past the new streak's deadline the run ends `blocked`, held: the older streak's `{stopped: true}` is not a confirmed stop", async () => {
    const { fx, deps, clock, stopErrors } = await secondStreak();
    const fresh = stopErrors()[1]!;
    clock.now = Date.now();
    fx.queue.db.query("UPDATE events SET at = ? WHERE seq = ?").run(new Date(clock.now - SWEEP_STOP_DEADLINE_MS - 60_000).toISOString(), fresh.seq);
    expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]);
    expect(stopErrors()).toHaveLength(2);
    expect(fx.get().state).toBe("blocked");
    const tail = "lock and pin held until a stop is confirmed or the engine exits";
    const line = `paused sweep ${fx.id}: stop unanswered for 30 min — ended blocked, ${tail}`;
    expect(fx.get().reason).toContain(line);
    expect(fx.get().reason).not.toContain("lock and pin released");
    expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id, engine_run_id: "E1" });
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail).toMatchObject({ engine_held: { engine_run_id: "E1" } });
    expect(heldEngine(fx.queue.events(fx.id))).toBe("E1");
  });

  describe("Story 38.3: the pin of a held sbx sweep", () => {
    const SB = "sb-sweep";
    const pinStops = (fx: Awaited<ReturnType<typeof sweepFixture>>) => fx.sbxCalls.filter((a) => a[0] === "stop" && a[1] === SB);
    const seqOf = (fx: Awaited<ReturnType<typeof sweepFixture>>, kind: string) => fx.queue.events(fx.id).findLast((e) => e.kind === kind)!.seq;

    test("Story 38.3: the held end releases neither the lock nor the pin: no `sbx stop`, no `pin-released`, no engine MCP stop", async () => {
      const { fx, deps } = await held({ sandbox: SB });
      expect(fx.get()).toMatchObject({ tier: "sbx", sandbox: SB });
      expect(fx.sbxCalls.some((a) => a[0] === "exec" && a[1] === SB && a[5] === "status")).toBe(true); // probed in the sandbox
      expect(pinStops(fx)).toEqual([]);
      expect(fx.mcpStops).toEqual([]);
      expect(fx.queue.events(fx.id).filter((e) => e.kind === "pin-released" || e.kind === "pin-kept")).toEqual([]);
      expect(fx.queue.pinOutstanding(SB)).toBe(true);
      fx.answers.launch = { ok: false, error: "sbx exec: sandbox stopped" };
      expect(await sweepEngines(fx.queue, deps)).toEqual([]); // `unknown`: still held
      expect(pinStops(fx)).toEqual([]);
      expect(fx.queue.pinOutstanding(SB)).toBe(true);
    });

    test("Story 38.3: the engine's exit releases the lock, then the pin (`sbx stop`), then `engine-released {by: \"exit\"}`", async () => {
      const { fx, deps } = await held({ sandbox: SB });
      fx.answers.launch = { ok: true, run: { status: "stopped" } };
      expect(await releaseHeldEngines(fx.queue, deps)).toEqual([fx.id]);
      expect(pinStops(fx)).toHaveLength(1);
      expect(fx.mcpStops).toEqual([fx.id]);
      expect(fx.queue.events(fx.id).findLast((e) => e.kind === "pin-released")!.detail).toMatchObject({ sandbox: SB, stop: { ok: true } });
      expect(seqOf(fx, "lock-released")).toBeLessThan(seqOf(fx, "pin-released"));
      expect(seqOf(fx, "pin-released")).toBeLessThan(seqOf(fx, ENGINE_RELEASED));
      expect(released(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", by: "exit" })]);
      expect(fx.queue.pinOutstanding(SB)).toBe(false);
    });

    test("Story 38.3: a confirmed stop (in the sandbox) releases the lock, then the pin, then `engine-released {by: \"stop\"}`", async () => {
      const { fx, deps } = await held({ sandbox: SB });
      fx.answers.stop = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
      const before = fx.sbxCalls.length;
      expect(await releaseHeldEngines(fx.queue, deps)).toEqual([fx.id]);
      expect(fx.sbxCalls.slice(before).filter((a) => a[0] === "exec" && a[5] === "stop")).toHaveLength(1);
      expect(pinStops(fx)).toHaveLength(1);
      expect(seqOf(fx, "lock-released")).toBeLessThan(seqOf(fx, "pin-released"));
      expect(seqOf(fx, "pin-released")).toBeLessThan(seqOf(fx, ENGINE_RELEASED));
      expect(released(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", by: "stop" })]);
    });

    test("Story 38.3: a held end replayed from `closed_out {pending}` carries `holdEngine` and releases no pin", async () => {
      const fx = await sweepFixture({ sandbox: SB });
      fx.triage();
      fx.landed("a");
      fx.commit("a.txt", "bundle a");
      fx.answers.launch = PAUSED;
      fx.answers.stop = REFUSED;
      const clock = { now: Date.now() };
      const deps: WorktreeDeps = { ...fx.deps, clockMs: () => clock.now };
      expect(await sweepEngines(fx.queue, deps)).toEqual([]);
      clock.now = Date.parse(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_ENGINE_STOP)!.at) + SWEEP_STOP_DEADLINE_MS + 1000;
      // The queue busy at the transition: the close-out is recorded with its transition, written by the next tick.
      const endEngine = fx.queue.endEngine.bind(fx.queue);
      let busy = true;
      fx.queue.endEngine = ((...a: Parameters<Queue["endEngine"]>) => { if (busy) { busy = false; throw new Error("database is locked"); } return endEngine(...a); }) as Queue["endEngine"];
      expect(await sweepEngines(fx.queue, deps)).toEqual([]);
      expect(fx.get().state).toBe("running");
      const pending = fx.queue.events(fx.id).findLast((e) => e.kind === "closed_out")!.detail?.pending;
      expect(pending).toMatchObject({ phase: "ended", state: "blocked", holdEngine: "E1", detail: { engine_held: { engine_run_id: "E1" } } });
      expect(await sweepEngines(fx.queue, deps)).toEqual([fx.id]); // the replay
      expect(fx.get().state).toBe("blocked");
      expect(heldEngine(fx.queue.events(fx.id))).toBe("E1");
      expect(fx.queue.lock(fx.root)).toMatchObject({ kind: "engine", run_id: fx.id, engine_run_id: "E1" });
      expect(pinStops(fx)).toEqual([]);
      expect(fx.mcpStops).toEqual([]);
      expect(fx.queue.pinOutstanding(SB)).toBe(true);
      fx.answers.launch = { ok: true, run: { status: "stopped" } };
      expect(await releaseHeldEngines(fx.queue, deps)).toEqual([fx.id]);
      expect(pinStops(fx)).toHaveLength(1);
      expect(released(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ engine_run_id: "E1", by: "exit" })]);
    });

    test("Story 38.3: a release whose `engine-released` note failed is finished on the next tick from the record, never probed again", async () => {
      const { fx, deps } = await held({ sandbox: SB });
      fx.answers.stop = { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
      const note = fx.queue.note.bind(fx.queue);
      let busy = true;
      fx.queue.note = ((runId: string, kind: string, detail: Record<string, unknown>) => {
        if (kind === ENGINE_RELEASED && busy) { busy = false; throw new Error("database is locked"); }
        return note(runId, kind, detail);
      }) as Queue["note"];
      expect(await releaseHeldEngines(fx.queue, deps)).toEqual([]); // the lock and the pin went, the note did not
      expect(fx.queue.lock(fx.root)).toBeNull();
      expect(pinStops(fx)).toHaveLength(1);
      expect(released(fx)).toEqual([]);
      expect(heldEngine(fx.queue.events(fx.id))).toBe("E1");
      // The sandbox stopped by that release: a probe would answer `unknown` for good.
      fx.answers.launch = { ok: false, error: "sbx exec: sandbox stopped" };
      const before = fx.sbxCalls.length;
      expect(await releaseHeldEngines(fx.queue, deps)).toEqual([fx.id]);
      expect(fx.sbxCalls.slice(before)).toEqual([]); // no probe, no stop, no second `sbx stop`
      expect(released(fx).map((e) => e.detail)).toEqual([{ engine_run_id: "E1", by: "stop", resumed: true }]);
      expect(heldEngine(fx.queue.events(fx.id))).toBeUndefined();
      expect(fx.queue.events(fx.id).filter((e) => e.kind === "pin-released")).toHaveLength(1);
      expect(await releaseHeldEngines(fx.queue, deps)).toEqual([]);
    });
  });

  test("Story 38.3: a refused ledger pass ends `refused` with one notifier line carrying the remedy, never a silent settle", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "MERGED" });
    ownerLedger(fx.root, "a ledger with a doubled heading");
    const error = "LedgerDuplicateId: DW-1 at lines 3 and 9";
    fx.answers.ledger.push({ exit: 2, out: { written: [], ok: false, error, status: "blocked", reason: error } });
    const lines: string[] = [];
    const notify = async (text: string) => { lines.push(text); return { ok: true }; };
    expect(await ledgerPass(fx.queue, fx.deps, notify)).toEqual([fx.id]);
    const recs = fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE);
    expect(recs).toHaveLength(1);
    const ids = ["DW-1", "DW-2", "DW-6"];
    expect(recs[0]!.detail).toEqual({ pr: PR, ids, resolved: [], pending: [], ok: false, settled: true, ended: "refused", reason: error, error, notify: { ok: true } });
    const remedy = ledgerRemedyText(ledgerResolveCommand(fx.root, PR, ids, fx.deps.env));
    expect(lines).toEqual([`sweep ${fx.id}: the ledger pass was refused and flipped nothing: ${error}; fix the owner ledger (a duplicate heading: renumber one; a missing id: use its entry's current id), then flip by hand: ${remedy}`]);
    expect(remedy).toContain(`"${join("/studio-root", "plugins", "tk-studio", "lib", "plansync.py")}"`);
    for (let i = 0; i < 2; i++) expect(await ledgerPass(fx.queue, fx.deps, notify)).toEqual([]);
    expect(lines).toHaveLength(1);
    // the lease released settled: never counted, never retried
    expect(fx.queue.events(fx.id).filter((e) => e.kind === "plan-lease" && e.detail?.phase === LEDGER_LEASE && e.detail?.owner === null).at(-1)!.detail?.settled).toBe(true);
  });

  test("Story 38.3: with no notifier injected the refused record says so", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    await sweepEngines(fx.queue, fx.deps);
    fx.gh.answer({ view: "MERGED" });
    fx.answers.ledger.push({ exit: 2, out: { ok: false, error: "LedgerMissingId: DW-6 not in the ledger (the counter's next id: DW-7)" } });
    await ledgerPass(fx.queue, fx.deps);
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === LEDGER_RESOLVE)!.detail).toMatchObject({ ended: "refused", settled: true, notify: { ok: false, skipped: "no notifier injected" } });
  });

  test("Story 38.3: the remedy runs under a fixture root from an unrelated cwd: DW-1 flips, DW-9 refuses `LedgerMissingId`", async () => {
    const fx = await sweepFixture();
    // a real ledger, written utf-8
    mkdirSync(dirname(join(fx.root, DEFERRED_REL)), { recursive: true });
    writeFileSync(join(fx.root, DEFERRED_REL), "# Deferred Work\n\n### DW-1: one\nstatus: done 2026-11-07\nresolution: resolved by sweep bundle dw-a\n\n### DW-2: two\nstatus: open\n", "utf-8");
    const env = { TK_STUDIO_ROOT: resolve(import.meta.dir, "../../..") };
    const cwd = tempDir("tk-sup-sweep-remedy-");
    const run = (ids: string[]) => {
      const cmd = ledgerResolveCommand(fx.root, PR, ids, env);
      expect(cmd.argv[3]).toBe(join(env.TK_STUDIO_ROOT, "plugins", "tk-studio", "lib", "plansync.py"));
      return runProcess(cmd.bin, cmd.argv, { cwd, timeoutS: 50, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    };
    const ok = await run(["DW-1"]);
    expect(ok.exit).toBe(0);
    const ledger = readFileSync(join(fx.root, DEFERRED_REL), "utf-8");
    expect(ledger).toContain("status: resolved 2026-11-07 by acme/widget#42");
    const missing = await run(["DW-9"]);
    expect(missing.exit).toBe(2);
    expect(String((JSON.parse(missing.stdout) as Record<string, unknown>).reason)).toStartWith("LedgerMissingId: DW-9 not in the ledger");
    // the line the notifier sends holds the same builder's text
    expect(ledgerRemedyText(ledgerResolveCommand(fx.root, PR, ["DW-9"], env))).toBe(
      `uv run --no-project python "${join(env.TK_STUDIO_ROOT, "plugins", "tk-studio", "lib", "plansync.py")}" ledger-resolve --directory "${fx.root}" --pr ${PR} --ids DW-9`);
    // with no studio root the text form names the placeholder
    expect(ledgerResolveCommand(fx.root, PR, ["DW-9"], {}, { placeholders: true }).argv[3]).toBe(join("<studio-root>", "plugins", "tk-studio", "lib", "plansync.py"));
  }, 60_000);

  test("Story 38.3 (DW-165): a bundle's engine passes are Stage Log rows in the PR body, after `## Sweep`, rebuilt from the record", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    const columns = ["stage", "pass", "started", "ended", "session_id", "model", "effort", "tokens_in", "tokens_out", "cost_usd", "outcome"];
    const row = { stage: "dev", pass: "1", started: "2026-11-07T10:00:00Z", ended: "2026-11-07T10:10:00Z", session_id: "s-1", model: "claude-opus-5-5", effort: "medium", tokens_in: "1000", tokens_out: "200", cost_usd: "0.0080", outcome: "completed" };
    fx.answers.stageRows = { exit: 0, stdout: JSON.stringify({ ok: true, columns, bundles: [{ key: "dw-a", rows: [row] }, { key: "dw-b", rows: [] }], written: [] }), stderr: "" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const call = fx.studio.find((c) => c.script.endsWith("plansync.py") && c.args[0] === "stage")!;
    expect(call.args).toEqual(["stage", "--from-run", "--run-dir", fx.runDir, "--worktree", fx.served]);
    const table = [
      "## Stage Log", "", "### a (DW-1, DW-2)", "",
      "| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
      "| dev | 1 | 2026-11-07T10:00:00Z | 2026-11-07T10:10:00Z | s-1 | claude-opus-5-5 | medium | 1000 | 200 | 0.0080 | completed |",
      "", "### b (DW-3)", "", "no engine pass recorded",
    ].join("\n");
    const body = fx.gh.calls().find((c) => c.argv[1] === "create")!.body!;
    expect(body).toContain(table);
    expect(body.indexOf("## Sweep")).toBeLessThan(body.indexOf("## Stage Log"));
    expect(body.indexOf("## Stage Log")).toBeLessThan(body.indexOf("## Host verify"));
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail as Record<string, any>;
    expect(ended.sweep.bundles.map((b: Record<string, unknown>) => b.stage_rows)).toEqual([[row], []]);
    // a re-run's body rebuilds from the record (the worktree gone)
    expect(prBody({ runId: fx.id, commits: [], sweep: summaryFromRecord(fx.queue.events(fx.id))! })).toContain(table);
  });

  test("Story 38.3 (DW-165): a verb failure says the Stage Log was not read; a summary with neither rows nor an error has none", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const body = fx.gh.calls().find((c) => c.argv[1] === "create")!.body!;
    expect(body).toContain("## Stage Log\n\nStage Log not read: no stage rows here");
    expect((fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!.detail as Record<string, any>).sweep.stage_error).toBe("no stage rows here");
    expect(sweepStageLogText(summary([true, false]))).toBeUndefined();
    expect(prBody({ runId: "r", commits: [], sweep: summary([true]) })).not.toContain("## Stage Log");
  });
});

describe("Story 38.4: the owner's decisions have a source and a sink", () => {
  const opts = (rec = "2") => ({
    options: [{ key: "1", label: "Keep", effect: "keep-open" }, { key: "2", label: "Drop", effect: "close", resolution: "nothing reads it" }], recommendation: rec,
  });
  const TRIAGE38 = { ...TRIAGE, decisions: [{ id: "DW-5", question: "keep or drop?", context: "c", ...opts() }] };
  const bind = (root: string) => {
    mkdirSync(join(root, ".tk-studio"), { recursive: true });
    writeFileSync(join(root, ".tk-studio", "config.yaml"), "planning:\n  jira:\n    project_key: TKSTUDIO\n");
  };
  const trackCalls = (fx: Awaited<ReturnType<typeof sweepFixture>>) =>
    fx.studio.filter((c) => c.script.endsWith("track.py") && c.args[0] === "block" && c.args.includes("--source") && c.args[c.args.indexOf("--source") + 1] === "sweep");

  test("parseTriage letters the skill's options and the default; a lettered note re-parses unchanged", () => {
    const t = parseTriage({ decisions: [{ id: "DW-7", question: "q", context: "ctx", options: [
      { key: "a", label: "Build  it", effect: "build", intent: "add\nthe flag" }, { key: "b", label: "Close", effect: "close" }], recommendation: "b" }] })!;
    expect(t.decisions).toEqual([{ id: "DW-7", question: "q", context: "ctx", options: [
      { letter: "A", text: "Build it — add the flag", key: "a", effect: "build" }, { letter: "B", text: "Close", key: "b", effect: "close" }], default: "B" }]);
    expect(parseTriage(t)!.decisions).toEqual(t.decisions);
    expect(parseTriage({ decisions: [{ id: "DW-8", question: "q", options: [] }] })!.decisions[0]).toMatchObject({ options: [], default: null });
  });

  test("a bound project: the close-out posts once, the PR body lists the keys, the record keeps them", async () => {
    const fx = await sweepFixture();
    bind(fx.root);
    fx.triage(TRIAGE38);
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.track = { exit: 0, stdout: JSON.stringify({ ok: true, status: "complete", source: "sweep", issues: [{ issue: "TKSTUDIO-230", ids: ["DW-5"], created: true }], skipped: [] }), stderr: "" };
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    const calls = trackCalls(fx);
    expect(calls).toHaveLength(1);
    const a = calls[0]!.args;
    expect(a.slice(0, 5)).toEqual(["block", "--directory", fx.root, "--source", "sweep"]);
    expect(resolve(a[a.indexOf("--triage") + 1]!)).toBe(resolve(join(fx.runDir, "triage.json")));
    expect(a[a.indexOf("--run-id") + 1]).toBe("run-sweep-20261029T101010Z");
    expect(calls[0]!.root).toBe(fx.root);
    const body = fx.gh.calls().find((c) => c.argv[0] === "pr" && c.argv[1] === "create")!.body!;
    expect(body).toContain("### Human decisions\n\n- TKSTUDIO-230: DW-5\n\nAsked in Jira");
    expect(body).not.toContain("- DW-5: keep or drop?");
    const posted = fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_DECISIONS_POSTED);
    expect(posted.map((e) => e.detail)).toEqual([{ engine_run_id: "E1", ok: true, status: "complete", issues: [{ issue: "TKSTUDIO-230", ids: ["DW-5"] }], skipped: [] }]);
    const ended = fx.queue.events(fx.id).findLast((e) => e.kind === "ended")!;
    expect((ended.detail as Record<string, any>).sweep.decision_issues).toEqual([{ issue: "TKSTUDIO-230", ids: ["DW-5"] }]);
    // a re-run's body rebuilds the keys from the record
    expect(sweepSection(summaryFromRecord(fx.queue.events(fx.id))!).join("\n")).toContain("- TKSTUDIO-230: DW-5");
  });

  test("a partial post: the issue lines are asked in Jira, the bare questions keep the unattended line", async () => {
    const fx = await sweepFixture();
    bind(fx.root);
    fx.triage({ ...TRIAGE, decisions: [{ id: "DW-5", question: "keep or drop?", context: "c", ...opts() },
      { id: "DW-9", question: "other?", context: "c", ...opts() }] });
    const s = sweepSummary(fx.queue, fx.get());
    const text = sweepSection({ ...s, decision_issues: [{ issue: "TKSTUDIO-230", ids: ["DW-5"] }] }).join("\n");
    expect(text).toContain("- TKSTUDIO-230: DW-5\n- DW-9: other?\n\n"
      + "The issue lines: asked in Jira (`tk-studio-decision`, `Blocked - Awaiting User`): the owner answers there and the sync-back ingests the answers.\n"
      + "The bare questions (no issue): skipped unattended (`--no-prompt`): `bmad-loop decisions` answers them.");
    // every decision in an issue: the Jira footer alone
    const all = sweepSection({ ...s, decision_issues: [{ issue: "TKSTUDIO-230", ids: ["DW-5", "DW-9"] }] }).join("\n");
    expect(all).toContain("- TKSTUDIO-230: DW-5, DW-9\n\nAsked in Jira (`tk-studio-decision`");
    expect(all).not.toContain("skipped unattended");
    // a re-asked id's issue (the verb's `already re-asked on KEY`) is named in the body
    fx.answers.track = { exit: 0, stdout: JSON.stringify({ ok: true, status: "complete", issues: [],
      skipped: ["DW-5: already re-asked on TKSTUDIO-231", "DW-9: already asked on TKSTUDIO-230"] }), stderr: "" };
    const out = await postDecisions(fx.queue, fx.get(), s, fx.deps, ["DW-5"]);
    expect(out.decision_issues).toEqual([{ issue: "TKSTUDIO-231", ids: ["DW-5"] }, { issue: "TKSTUDIO-230", ids: ["DW-9"] }]);
  });

  test("an unbound root makes no call and keeps the bare questions; a failed post keeps them too, noted", async () => {
    const fx = await sweepFixture();
    fx.triage(TRIAGE38);
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(trackCalls(fx)).toHaveLength(0);
    expect(fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_DECISIONS_POSTED)).toHaveLength(0);
    const body = fx.gh.calls().find((c) => c.argv[0] === "pr" && c.argv[1] === "create")!.body!;
    expect(body).toContain("- DW-5: keep or drop?\n\nSkipped unattended (`--no-prompt`): `bmad-loop decisions` answers them.");

    const fx2 = await sweepFixture();
    bind(fx2.root);
    fx2.triage(TRIAGE38);
    const s = sweepSummary(fx2.queue, fx2.get());
    const out = await postDecisions(fx2.queue, fx2.get(), s, fx2.deps);
    expect(out.decision_issues).toBeUndefined();
    expect(sweepSection(out).join("\n")).toContain("- DW-5: keep or drop?");
    const note = fx2.queue.events(fx2.id).findLast((e) => e.kind === SWEEP_DECISIONS_POSTED)!;
    expect(note.detail).toMatchObject({ ok: false, status: "blocked", error: "track refused: no binding here" });
    // retried on a later close-out: the verb skips what it asked, the earlier issue still named in the body
    fx2.answers.track = { exit: 0, stdout: JSON.stringify({ ok: true, status: "complete", issues: [], skipped: ["DW-5: already asked on TKSTUDIO-230"] }), stderr: "" };
    const again = await postDecisions(fx2.queue, fx2.get(), s, fx2.deps, ["DW-9"]);
    expect(again.decision_issues).toEqual([{ issue: "TKSTUDIO-230", ids: ["DW-5"] }]);
    expect(trackCalls(fx2).at(-1)!.args.slice(-2)).toEqual(["--ask", "DW-9"]);
    // an injected bound check that says no: no call
    const before = trackCalls(fx2).length;
    await postDecisions(fx2.queue, fx2.get(), s, fx2.deps, [], () => false);
    expect(trackCalls(fx2)).toHaveLength(before);
  });

  test("answerDecisions feeds the engine the leading matched keys in the sandbox; a changed option goes to --ask", async () => {
    const fx = await sweepFixture({ sandbox: "sb-1" });
    fx.triage({ ...TRIAGE, decisions: [
      { id: "DW-5", question: "a?", ...opts() },
      { id: "DW-7", question: "b?", options: [{ key: "1", label: "Renamed", effect: "keep-open" }, { key: "2", label: "Drop", effect: "build", intent: "x" }], recommendation: "1" },
      { id: "DW-8", question: "c?", ...opts() }] });
    const record = { version: 1, issues: {}, answers: {
      "DW-5": { letter: "B", text: "Drop — nothing reads it", key: "2", label: "Drop", effect: "close", issue: "TKSTUDIO-230", date: "2026-11-08" },
      "DW-7": { letter: "A", text: "Keep", key: "1", label: "Keep", effect: "keep-open", issue: "TKSTUDIO-231", date: "2026-11-08" },
      "DW-8": { letter: "A", text: "Keep", key: "1", label: "Keep", effect: "keep-open", issue: "TKSTUDIO-232", date: "2026-11-08" } } };
    mkdirSync(join(fx.root, "_bmad-output", "tracking"), { recursive: true });
    writeFileSync(join(fx.root, "_bmad-output", "tracking", "decisions-jira.json"), JSON.stringify(record));
    let pending = ["DW-5", "DW-8", "DW-7"];
    const execs: string[][] = [];
    fx.answers.sbx = (args) => {
      if (args[0] !== "exec" || args[2] !== "sh") return undefined;
      execs.push(args);
      if (args[4]!.includes("decisions --json")) {
        return { exit: 0, stdout: JSON.stringify({ schema_version: 1, decisions: pending.map((id) => ({ id, options: [{ key: "1" }, { key: "2" }] })) }), stderr: "" };
      }
      pending = pending.filter((id) => id !== "DW-5" && id !== "DW-8");
      return { exit: 1, stdout: "", stderr: "EOFError" };
    };
    const s = sweepSummary(fx.queue, fx.get());
    const ask = await answerDecisions(fx.queue, fx.get(), s, fx.deps);
    expect(ask).toEqual(["DW-7"]);
    const vm = toVmPath(fx.served);
    expect(execs.map((a) => a[4])).toEqual([
      `"$HOME/.local/bin/bmad-loop" decisions --json --project '${vm}'`,
      `printf "%s\\n" 2 1 | "$HOME/.local/bin/bmad-loop" decisions --project '${vm}'`,
      `"$HOME/.local/bin/bmad-loop" decisions --json --project '${vm}'`,
    ]);
    expect(execs[0]!.slice(0, 4)).toEqual(["exec", "sb-1", "sh", "-c"]);
    const notes = fx.queue.events(fx.id).filter((e) => e.kind === SWEEP_DECISIONS_ANSWERED);
    expect(notes.map((e) => e.detail)).toEqual([{ engine_run_id: "E1", answered: ["DW-5", "DW-8"], left: [], ok: true }]);
    // once per engine run
    await answerDecisions(fx.queue, fx.get(), s, fx.deps);
    expect(execs).toHaveLength(3);
  });

  test("answerDecisions matches a hand-posted answer by its lettered text; an unreadable triage asks nothing", async () => {
    const fx = await sweepFixture({ sandbox: "sb-3" });
    fx.triage({ ...TRIAGE, decisions: [
      { id: "DW-5", question: "a?", ...opts() },
      { id: "DW-8", question: "c?", ...opts() },
      { id: "DW-9", question: "d?", ...opts() }] });
    mkdirSync(join(fx.root, "_bmad-output", "tracking"), { recursive: true });
    writeFileSync(join(fx.root, "_bmad-output", "tracking", "decisions-jira.json"), JSON.stringify({ version: 1, issues: {}, answers: {
      // a legacy issue's answer: no key, no effect, the label the whole option line
      "DW-5": { letter: "B", text: "Drop  — nothing reads it", key: "", label: "drop — Nothing reads it", effect: "", issue: "TKSTUDIO-220" },
      "DW-8": { letter: "A", text: "Keep", key: "", label: "KEEP", effect: "", issue: "TKSTUDIO-220" },
      "DW-9": { letter: "C", text: "Other", key: "", label: "Something else", effect: "", issue: "TKSTUDIO-220" } } }));
    let pending = ["DW-5", "DW-8", "DW-9"];
    const execs: string[][] = [];
    fx.answers.sbx = (args) => {
      if (args[0] !== "exec" || args[2] !== "sh") return undefined;
      execs.push(args);
      if (args[4]!.includes("decisions --json")) {
        return { exit: 0, stdout: JSON.stringify({ decisions: pending.map((id) => ({ id, options: [{ key: "1" }, { key: "2" }] })) }), stderr: "" };
      }
      pending = pending.filter((id) => id !== "DW-5" && id !== "DW-8");
      return { exit: 1, stdout: "", stderr: "EOFError" };
    };
    const s = sweepSummary(fx.queue, fx.get());
    expect(await answerDecisions(fx.queue, fx.get(), s, fx.deps)).toEqual(["DW-9"]);
    expect(execs.map((a) => a[4]).find((c) => c!.startsWith("printf"))).toBe(`printf "%s\\n" 2 1 | "$HOME/.local/bin/bmad-loop" decisions --project '${toVmPath(fx.served)}'`);

    // the run dir's triage files gone: no id is matched, none goes to --ask
    const fx2 = await sweepFixture({ sandbox: "sb-4" });
    fx2.triage({ ...TRIAGE, decisions: [{ id: "DW-5", question: "a?", ...opts() }] });
    mkdirSync(join(fx2.root, "_bmad-output", "tracking"), { recursive: true });
    writeFileSync(join(fx2.root, "_bmad-output", "tracking", "decisions-jira.json"), JSON.stringify({ version: 1, issues: {}, answers: {
      "DW-5": { letter: "B", key: "2", label: "Drop", effect: "close", issue: "TKSTUDIO-230" } } }));
    const s2 = sweepSummary(fx2.queue, fx2.get());
    expect(s2.triage?.decisions.map((d) => d.id)).toEqual(["DW-5"]);
    rmSync(join(fx2.runDir, "triage.json"));
    const calls: string[][] = [];
    fx2.answers.sbx = (args) => { calls.push(args); return undefined; };
    expect(await answerDecisions(fx2.queue, fx2.get(), s2, fx2.deps)).toEqual([]);
    expect(calls.filter((a) => a[2] === "sh")).toEqual([]);
  });

  test("answerDecisions skips a key failing the check: the walk stops, nothing piped", async () => {
    const fx = await sweepFixture({ sandbox: "sb-2" });
    fx.triage({ ...TRIAGE, decisions: [{ id: "DW-5", question: "a?", options: [{ key: "1;rm", label: "Keep", effect: "keep-open" }, { key: "2", label: "Drop", effect: "close" }], recommendation: "2" }] });
    mkdirSync(join(fx.root, "_bmad-output", "tracking"), { recursive: true });
    writeFileSync(join(fx.root, "_bmad-output", "tracking", "decisions-jira.json"), JSON.stringify({ version: 1, issues: {}, answers: {
      "DW-5": { letter: "A", key: "1;rm", label: "Keep", effect: "keep-open", issue: "TKSTUDIO-230" } } }));
    const execs: string[][] = [];
    fx.answers.sbx = (args) => {
      if (args[2] !== "sh") return undefined;
      execs.push(args);
      return { exit: 0, stdout: JSON.stringify({ decisions: [{ id: "DW-5", options: [{ key: "1;rm" }, { key: "2" }] }] }), stderr: "" };
    };
    expect(await answerDecisions(fx.queue, fx.get(), sweepSummary(fx.queue, fx.get()), fx.deps)).toEqual([]);
    expect(execs.some((a) => a[4]!.startsWith("printf"))).toBe(false);
    expect(fx.queue.events(fx.id).findLast((e) => e.kind === SWEEP_DECISIONS_ANSWERED)!.detail).toEqual({ engine_run_id: "E1", answered: [], left: ["DW-5"], ok: true });
  });
});
