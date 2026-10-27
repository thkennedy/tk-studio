import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { hostname } from "node:os";
import { mirror, runJob, type RunSummary } from "../src/cli";
import { Queue, type JobPacing, type QueueEvent, type QueueRun } from "../src/queue";
import { shouldWake, tickJob, type Args } from "../src/tick";
import { tempDir, track } from "./tmp";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const DEFN = { id: "j", trigger: "loop", cadence: { mode: "self-paced", hint_seconds: 60 }, stop: { on_status: ["partial"] } };
const pacing = (p: Partial<JobPacing>): Pick<JobPacing, "live" | "adoptable" | "lastEnded" | "stopped"> =>
  ({ live: [], adoptable: [], lastEnded: null, stopped: null, ...p });
const liveRun = (state: "queued" | "running") => ({ run_id: "q-j-1", state } as QueueRun);
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

describe("shouldWake over the queue's runs (AC3)", () => {
  test("no queue runs → wake", () => {
    expect(shouldWake(DEFN, pacing({}), NOW)).toEqual({ wake: true, reason: "no prior runs" });
  });

  test("hint not elapsed: the last run ended 10 s ago, hint 60 → skip", () => {
    const d = shouldWake(DEFN, pacing({ lastEnded: ago(10) }), NOW);
    expect(d.wake).toBe(false);
    expect(d.reason).toBe("hint_seconds pacing: 50s remaining");
  });

  test("hint elapsed: the last run ended 61 s ago → wake", () => {
    expect(shouldWake(DEFN, pacing({ lastEnded: ago(61) }), NOW)).toEqual({ wake: true, reason: "pacing window elapsed" });
  });

  test("no hint → wake right after the last run ended", () => {
    const { cadence: _c, ...noHint } = DEFN;
    expect(shouldWake(noHint, pacing({ lastEnded: ago(1) }), NOW).wake).toBe(true);
  });

  test("a running run of the job → skip, even with the hint long elapsed", () => {
    const d = shouldWake(DEFN, pacing({ live: [liveRun("running")], lastEnded: ago(3600) }), NOW);
    expect(d).toEqual({ wake: false, reason: "run q-j-1 still running — no overlap" });
  });

  test("a queued run under a live owner → skip", () => {
    const d = shouldWake(DEFN, pacing({ live: [liveRun("queued")], lastEnded: ago(3600) }), NOW);
    expect(d).toEqual({ wake: false, reason: "run q-j-1 still queued under a live owner — no overlap" });
  });

  test("an ownerless queued run → wake to drive it, the hint not re-applied", () => {
    const d = shouldWake(DEFN, pacing({ adoptable: [liveRun("queued")], lastEnded: ago(1) }), NOW);
    expect(d).toEqual({ wake: true, reason: "driving ownerless queued run q-j-1 (nothing new minted)" });
  });

  test("the stop skip comes before an ownerless queued run", () => {
    const stopped: QueueEvent = { seq: 9, run_id: "q-j-0", at: ago(3600), kind: "stopped", from_state: "partial", to_state: "partial",
      detail: { condition: "on_status", state: "partial", job_id: "j" } };
    expect(shouldWake(DEFN, pacing({ adoptable: [liveRun("queued")], stopped }), NOW).wake).toBe(false);
  });

  test("a recorded stop → skip naming the condition", () => {
    const stopped: QueueEvent = { seq: 9, run_id: "q-j-0", at: ago(3600), kind: "stopped", from_state: "partial", to_state: "partial",
      detail: { condition: "on_status", state: "partial", job_id: "j" } };
    const d = shouldWake(DEFN, pacing({ lastEnded: ago(3600), stopped }), NOW);
    expect(d).toEqual({ wake: false, reason: "stopped — stop.on_status: run q-j-0 ended partial" });
  });

  describe("a recorded stop is re-checked against the current definition", () => {
    const stopped: QueueEvent = { seq: 9, run_id: "q-j-0", at: ago(3600), kind: "stopped", from_state: "partial", to_state: "partial",
      detail: { condition: "on_status", state: "partial", job_id: "j" } };

    test("on_status still lists the stopped state → skip", () => {
      const defn = { ...DEFN, stop: { on_status: ["blocked", "partial"] } };
      expect(shouldWake(defn, pacing({ lastEnded: ago(3600), stopped }), NOW))
        .toEqual({ wake: false, reason: "stopped — stop.on_status: run q-j-0 ended partial" });
    });

    test("on_status removed (or the whole stop) → not skipped for the stop; the other rules apply", () => {
      const { stop: _s, ...noStop } = DEFN;
      expect(shouldWake({ ...DEFN, stop: { max_runs: 5 } }, pacing({ lastEnded: ago(3600), stopped }), NOW))
        .toEqual({ wake: true, reason: "pacing window elapsed" });
      expect(shouldWake(noStop, pacing({ lastEnded: ago(3600), stopped }), NOW).wake).toBe(true);
      // The stale stop is ignored, not the pacing: the hint still holds.
      expect(shouldWake(noStop, pacing({ lastEnded: ago(10), stopped }), NOW))
        .toEqual({ wake: false, reason: "hint_seconds pacing: 50s remaining" });
    });

    test("the stopped state dropped from on_status → not skipped", () => {
      const defn = { ...DEFN, stop: { on_status: ["blocked"] } };
      expect(shouldWake(defn, pacing({ lastEnded: ago(3600), stopped }), NOW))
        .toEqual({ wake: true, reason: "pacing window elapsed" });
    });
  });
});

describe("stop.on_status: recorded when the run ends, then the pacer skips the job (AC4)", () => {
  function fixture() {
    const dir = tempDir("tk-sup-tick-q-");
    const checkout = tempDir("tk-sup-tick-co-");
    const queue = track(new Queue(join(dir, "q.db"), { ownerAlive: () => true, engineLive: async () => ({ live: false }) }));
    const defn = { ...DEFN, target: { skill: "tk-studio-activate" } };
    const drive = async (s: Partial<RunSummary>) => {
      const { run } = queue.enqueue({ jobId: "j", root: checkout, target: "skill", definition: defn });
      await mirror(queue, run.run_id, { jobId: "j", defn }, { ok: false, job_id: "j", run_id: "j-20260928T101010Z", state: "complete", ...s });
      return run.run_id;
    };
    return { queue, checkout, drive };
  }

  test("a run ending in a listed state records `stopped` in events; the next tick skips the job", async () => {
    const fx = fixture();
    try {
      const runId = await fx.drive({ state: "partial", reason: "guard: max_turns (40)" });
      const stop = fx.queue.events(runId).filter((e) => e.kind === "stopped");
      expect(stop).toHaveLength(1);
      expect(stop[0]).toMatchObject({ from_state: "partial", to_state: "partial", detail: { condition: "on_status", state: "partial", job_id: "j" } });
      const p = fx.queue.pacing("j", fx.checkout);
      const d = shouldWake(DEFN, p, Date.now() + 3_600_000); // the hint long elapsed: only the stop holds it
      expect(d.wake).toBe(false);
      expect(d.reason).toContain("stop.on_status");
    } finally { fx.queue.close(); }
  });

  test("the stop is written in the same transaction as `ended` (next event), and persists past a later not-woken run", async () => {
    const fx = fixture();
    try {
      const runId = await fx.drive({ state: "partial", reason: "guard: max_turns (40)" });
      const evs = fx.queue.events(runId);
      expect(evs.at(-1)!.kind).toBe("stopped");
      expect(evs.at(-2)!.kind).toBe("ended");
      // A later run the studio refused (not-woken → queue `blocked`, no studio run) never clears the stop.
      const defn = { ...DEFN, target: { skill: "tk-studio-activate" } };
      const { run } = fx.queue.enqueue({ jobId: "j", root: fx.checkout, target: "skill", definition: defn });
      await mirror(fx.queue, run.run_id, { jobId: "j", defn }, { ok: false, job_id: "j", run_id: null, state: "not-woken", reason: "stop: on_status" });
      const p = fx.queue.pacing("j", fx.checkout);
      expect(p.latestTerminal!.run_id).toBe(run.run_id);
      expect(shouldWake(DEFN, p, Date.now() + 3_600_000).reason).toContain("stop.on_status");
      // A later run the studio did run to a terminal state (a hand run) clears it.
      await fx.drive({ state: "complete", ok: true });
      expect(shouldWake(DEFN, fx.queue.pacing("j", fx.checkout), Date.now() + 3_600_000).wake).toBe(true);
    } finally { fx.queue.close(); }
  });

  test("a run ending in an unlisted state records no stop; the job keeps recurring", async () => {
    const fx = fixture();
    try {
      const runId = await fx.drive({ state: "complete", ok: true });
      expect(fx.queue.events(runId).some((e) => e.kind === "stopped")).toBe(false);
      expect(shouldWake(DEFN, fx.queue.pacing("j", fx.checkout), Date.now() + 3_600_000).wake).toBe(true);
    } finally { fx.queue.close(); }
  });

  test("a non-studio outcome (not-woken → queue `blocked`) never records a stop", async () => {
    const fx = fixture();
    try {
      const defn = { ...DEFN, stop: { on_status: ["blocked"] }, target: { skill: "tk-studio-activate" } };
      const { run } = fx.queue.enqueue({ jobId: "j", root: fx.checkout, target: "skill", definition: defn });
      await mirror(fx.queue, run.run_id, { jobId: "j", defn }, { ok: false, job_id: "j", run_id: null, state: "not-woken", reason: "stop: max_runs (1) reached" });
      expect(fx.queue.get(run.run_id)!.state).toBe("blocked");
      expect(fx.queue.events(run.run_id).some((e) => e.kind === "stopped")).toBe(false);
    } finally { fx.queue.close(); }
  });
});

describe("tickJob paces from the real queue (AC3, AC4)", () => {
  const ARGS: Args = { dryRun: false, projects: [], directories: [], timeoutCapS: 3600 };
  const JOB = { id: "j", definition: { ...DEFN, target: { skill: "tk-studio-activate" } } };
  function fixture(ownerAlive = () => true) {
    const dir = tempDir("tk-sup-tickjob-q-");
    const checkout = tempDir("tk-sup-tickjob-co-");
    const queue = track(new Queue(join(dir, "q.db"), { ownerAlive, engineLive: async () => ({ live: false }) }));
    const lines: string[] = [];
    const calls: { minted: boolean; run_id: string }[] = [];
    // Stands in for runJob: its first step, the queue's idempotent mint, then a studio outcome mirrored.
    const run: typeof runJob = async (jobId, root) => {
      const { run: r, minted } = queue.enqueue({ jobId, root, target: "skill", definition: JOB.definition });
      calls.push({ minted, run_id: r.run_id });
      return mirror(queue, r.run_id, { jobId, defn: JOB.definition }, { ok: true, job_id: jobId, run_id: "j-20260928T111111Z", state: "complete" });
    };
    const runs = () => (queue.db.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n;
    const tick = () => tickJob(checkout, JOB, ARGS, { queue, run, log: (m) => lines.push(m), nowMs: () => Date.now() + 3_600_000 });
    return { queue, checkout, lines, calls, runs, tick };
  }

  test("a stopped job → skipped, the condition logged, no queue run minted", async () => {
    const fx = fixture();
    try {
      const { run } = fx.queue.enqueue({ jobId: "j", root: fx.checkout, target: "skill", definition: JOB.definition });
      await mirror(fx.queue, run.run_id, { jobId: "j", defn: JOB.definition }, { ok: false, job_id: "j", run_id: "j-1", state: "partial" });
      const before = fx.runs();
      expect(await fx.tick()).toBe("skipped");
      expect(fx.calls).toEqual([]);
      expect(fx.runs()).toBe(before);
      expect(fx.lines.join("\n")).toContain(`j: skip — stopped — stop.on_status: run ${run.run_id} ended partial`);
    } finally { fx.queue.close(); }
  });

  test("a job with a running run → skipped, logged, no queue run minted", async () => {
    const fx = fixture();
    try {
      const { run } = fx.queue.enqueue({ jobId: "j", root: fx.checkout, target: "skill", definition: JOB.definition });
      expect((await fx.queue.claim(run.run_id)).claimed).toBe(true);
      expect(await fx.tick()).toBe("skipped");
      expect(fx.calls).toEqual([]);
      expect(fx.runs()).toBe(1);
      expect(fx.lines.join("\n")).toContain(`j: skip — run ${run.run_id} still running — no overlap`);
    } finally { fx.queue.close(); }
  });

  test("a queued run under a live owner → skipped, no queue run minted", async () => {
    const fx = fixture(() => true);
    try {
      const other = { pid: 999_999, host: hostname(), nonce: "someone-else" };
      const { run } = fx.queue.enqueue({ jobId: "j", root: fx.checkout, target: "skill", definition: JOB.definition, owner: other });
      expect(await fx.tick()).toBe("skipped");
      expect(fx.calls).toEqual([]);
      expect(fx.runs()).toBe(1);
      expect(fx.lines.join("\n")).toContain(`run ${run.run_id} still queued under a live owner`);
    } finally { fx.queue.close(); }
  });

  test("an ownerless queued run → driven, nothing new minted", async () => {
    const fx = fixture();
    try {
      // A lock-waited / re-queued / submitted run: queued, no owner. The last run ended moments ago (hint not elapsed).
      const { run: prev } = fx.queue.enqueue({ jobId: "j", root: fx.checkout, target: "skill", definition: JOB.definition });
      fx.queue.end(prev.run_id, "complete");
      const { run } = fx.queue.enqueue({ jobId: "j", root: fx.checkout, target: "skill", definition: JOB.definition });
      const tickNow = () => tickJob(fx.checkout, JOB, ARGS, { queue: fx.queue, run: async (...a) => {
        const { run: r, minted } = fx.queue.enqueue({ jobId: a[0], root: a[1], target: "skill", definition: JOB.definition });
        fx.calls.push({ minted, run_id: r.run_id });
        return mirror(fx.queue, r.run_id, { jobId: a[0], defn: JOB.definition }, { ok: true, job_id: a[0], run_id: "j-2", state: "complete" });
      }, log: (m) => fx.lines.push(m), nowMs: Date.now });
      expect(await tickNow()).toBe("woken");
      expect(fx.calls).toEqual([{ minted: false, run_id: run.run_id }]);
      expect(fx.runs()).toBe(2);
      expect(fx.queue.get(run.run_id)!.state).toBe("complete");
      expect(fx.lines.join("\n")).not.toContain("skip");
    } finally { fx.queue.close(); }
  });
});
