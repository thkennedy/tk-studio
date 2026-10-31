// Story 35.7: the `run-sweep` job type's supervisor half — the triage record, the `## Sweep` PR body, the inbox
// line, the three-way end, a paused sweep closed out (never relaunched), and the ledger pass after the merge.
// Pinned against a real throwaway repository (a bare `origin`), the fake `gh` and an injected studio-script runner.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFERRED_REL, jobRunCosts, spendByEpic } from "../src/board";
import { cancelRun, mirror } from "../src/cli";
import { closeOutPaused } from "../src/closeout";
import { endNotice, noticeText } from "../src/hygiene";
import { runCost } from "../src/inbox";
import { mergePass, PLAN_RETRY_LIMIT } from "../src/planstatus";
import { Queue } from "../src/queue";
import { runProcess, type RunResult } from "../src/server";
import {
  emitTriage, engineCostOf, isSweep, LEDGER_LEASE, LEDGER_RESOLVE, ledgerFingerprint, ledgerPass, recordTriage, summaryFromRecord, SWEEP_ENGINE_STOP, SWEEP_JOB_TYPE, SWEEP_TRIAGE, sweepCostText,
  sweepEndState, sweepSection, sweepTotalCost, withEngineCost, type SweepSummary,
} from "../src/sweep";
import { launchedCloseOutInput, prBody, prepareWorktree, sweepEngines, type WorktreeDeps } from "../src/worktree";
import { fakeGh, gitRepo, testGit } from "./fakes";
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
 * `prefix`: the project lies below its git top-level (`<checkout>/<prefix>`, served at `<worktree>/<prefix>`). */
async function sweepFixture(opts: { prefix?: string } = {}) {
  const repo = gitRepo(opts.prefix ? { [`${opts.prefix}.keep`]: "" } : {});
  const root = opts.prefix ? join(repo.checkout, opts.prefix) : repo.checkout;
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
  };
  const env = { ...process.env, TK_SUPERVISOR_WORK: work, GH_BIN: gh.bin, TK_STUDIO_ROOT: "/studio-root", TK_STUDIO_HOME: home };
  const deps: WorktreeDeps & { self: typeof me } = {
    env, self: me,
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
      if (script.endsWith("ledger.py") && args[0] === "emit") return answers.emit;
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
  const queued = queue.enqueue({ jobId: SWEEP_JOB_TYPE, root, projectId: "proj", definition: defn, owner: me, base_ref: "main", ...(opts.prefix ? { prefix: opts.prefix } : {}) }).run;
  const claim = await queue.claim(queued.run_id, me);
  if (!claim.claimed) throw new Error("not claimed");
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
    repo, root, gh, home, studio, verbs, answers, deps, queue, wt, served, runDir, id, get: () => queue.get(id)!,
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
      blocked: [{ id: "DW-4", blocker: "Story 36.1 must land first" }], decisions: [{ id: "DW-5", question: "keep or drop?" }],
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
    const calls = () => fx.studio.filter((s) => s.script.endsWith("plansync.py"));
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
    const call = fx.studio.find((s) => s.script.endsWith("plansync.py"))!;
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
    expect(fx.studio.some((s) => s.script.endsWith("plansync.py"))).toBe(false);
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
    const call = fx.studio.find((s) => s.script.endsWith("plansync.py"))!;
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

  test("a failed triage emit is noted on the note, never thrown nor retried; a triage in error emits nothing", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.answers.emit = { exit: 2, stdout: JSON.stringify({ ok: false, error: "ledger refused" }), stderr: "" };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([]);
    expect(fx.studio.filter((s) => s.script.endsWith("ledger.py"))).toHaveLength(1);
    expect(fx.queue.events(fx.id).find((e) => e.kind === SWEEP_TRIAGE)!.detail!.ledger).toBe("error: ledger refused");
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
    const calls = () => fx.studio.filter((s) => s.script.endsWith("plansync.py"));
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
    expect(fx.studio.filter((s) => s.script.endsWith("plansync.py"))).toHaveLength(2);
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
    expect(costs.get("s-2")!.cost).toBe(0.5);
    expect(costs.get("s-2:engine")!.cost).toBe(3.75);
    expect([...costs.values()].reduce((sum, c) => sum + c.cost, 0)).toBe(8.5);
    const file = join(tempDir("tk-sup-sweep-ledger-"), "l.jsonl");
    writeFileSync(file, text);
    expect(runCost(file, "s-2")).toBe(0.5); // the exact id: the run's own line
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
