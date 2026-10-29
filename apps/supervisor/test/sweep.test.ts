// Story 35.7: the `run-sweep` job type's supervisor half — the triage record, the `## Sweep` PR body, the inbox
// line, the three-way end, a paused sweep closed out (never relaunched), and the ledger pass after the merge.
// Pinned against a real throwaway repository (a bare `origin`), the fake `gh` and an injected studio-script runner.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { cancelRun, mirror } from "../src/cli";
import { closeOutPaused } from "../src/closeout";
import { endNotice, noticeText } from "../src/hygiene";
import { mergePass, PLAN_RETRY_LIMIT } from "../src/planstatus";
import { Queue } from "../src/queue";
import { runProcess, type RunResult } from "../src/server";
import {
  isSweep, LEDGER_LEASE, LEDGER_RESOLVE, ledgerPass, recordTriage, SWEEP_ENGINE_STOP, SWEEP_JOB_TYPE, SWEEP_TRIAGE, sweepEndState, sweepSection,
  type SweepSummary,
} from "../src/sweep";
import { prBody, prepareWorktree, sweepEngines, type WorktreeDeps } from "../src/worktree";
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
      engine_run_id: "E1", path: copy,
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

  test("the ledger pass: nothing until MERGED; pending retried; then resolved and settled, never called again", async () => {
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
    expect(calls()[0]!.args).toEqual(["ledger-resolve", "--directory", fx.repo.checkout, "--pr", PR, "--ids", "DW-1,DW-2,DW-6"]);
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]); // settled: idempotent
    expect(calls()).toHaveLength(2);
    const evs = fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE);
    expect(evs.map((e) => e.detail)).toEqual([
      { pr: PR, ids: ["DW-1", "DW-2", "DW-6"], resolved: [], pending: ["DW-1", "DW-2", "DW-6"], ok: true },
      { pr: PR, ids: ["DW-1", "DW-2", "DW-6"], resolved: ["DW-1", "DW-2", "DW-6"], pending: [], ok: true, settled: true },
    ]);
    const leases = fx.queue.events(fx.id).filter((e) => e.kind === "plan-lease" && e.detail?.phase === LEDGER_LEASE && e.detail?.owner === null);
    expect(leases.map((e) => e.detail?.settled === true)).toEqual([false, true]);
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

  test("review 8: the ledger pass gives up after PLAN_RETRY_LIMIT pending attempts, settled, never called again", async () => {
    const fx = await sweepFixture();
    fx.triage();
    fx.landed("a");
    fx.commit("a.txt", "sweep bundle dw-a");
    fx.answers.launch = { ok: true, run: { status: "finished" } };
    expect(await sweepEngines(fx.queue, fx.deps)).toEqual([fx.id]);
    fx.gh.answer({ view: "MERGED" });
    for (let i = 0; i <= PLAN_RETRY_LIMIT; i++) fx.answers.ledger.push({ exit: 0, out: { ok: true, resolved: [], pending: ["DW-1"], unchanged: [] } });
    for (let i = 0; i <= PLAN_RETRY_LIMIT; i++) expect(await ledgerPass(fx.queue, fx.deps)).toEqual([fx.id]);
    expect(await ledgerPass(fx.queue, fx.deps)).toEqual([]);
    expect(fx.studio.filter((s) => s.script.endsWith("plansync.py"))).toHaveLength(PLAN_RETRY_LIMIT + 1);
    const evs = fx.queue.events(fx.id).filter((e) => e.kind === LEDGER_RESOLVE);
    expect(evs).toHaveLength(PLAN_RETRY_LIMIT + 1);
    expect(evs.slice(0, -1).every((e) => e.detail?.settled === undefined)).toBe(true);
    expect(evs.at(-1)!.detail).toMatchObject({ ok: true, pending: ["DW-1"], settled: true, skipped: true, reason: `gave up after ${PLAN_RETRY_LIMIT + 1} attempts: pending: DW-1` });
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
