/**
 * Story 21.6: a killed run resumes or ends partial, never lost — the I/O matrix
 * at unit level (restart resume through `Queue.recover` + `restartResumer`,
 * the AC2 silent-exit resume in `finishRun`, the transcript restore, the
 * recorded-worker kill).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  driveResumes, finishRun, queueRecorder, recoverWithResume, RESUME_CAP, resumeCheck, restartResumer, studioOps,
  type RunRecorder, type Started, type TranscriptChecks,
} from "../src/cli";
import {
  killRecordedWorker, ORPHANED_REASON, probeRecordedWorker, processStartTime, Queue, workerMayRun,
  type Owner, type Probes, type QueueRun, type WorkerKill,
} from "../src/queue";
import {
  buildWorkerCommand, CONTINUATION_PROMPT, invokeSkill, MAX_LOGIN_MISSING, MISSING_STATUS_BLOCK, runProcess, SBX_GUARD_KILL_AFTER_S,
  WORKER_RECORD_FAILED, type Spawner,
} from "../src/server";
import { ensureTranscript, sbxTranscriptArgv, sbxTranscriptExists, TranscriptError, transcriptNewCounts } from "../src/transcript";

const HOST = hostname();
const A: Owner = { pid: 910101, host: HOST, nonce: "nonce-dead" };
const B: Owner = { pid: 910102, host: HOST, nonce: "nonce-restarted" };
const STUDIO = "j-20260928T101010Z";
const SID = "0b7c1f7e-9a55-4d4e-8f4c-2d6f3f0c9e11";
const BLOCK = { status: "complete", intent: "tk-studio-activate", artifacts: [] };
const WAKE = { directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: {} }, routing: { model: "sonnet" }, state: "queued" };
const GUARDS = { max_wall_clock_seconds: 600, max_turns: 40 };
const usage = { input_tokens: 10, output_tokens: 5 };
const line = (id: string) => JSON.stringify({ type: "assistant", message: { id, usage } });

// Each test gets its own claude config dir (CLAUDE_CONFIG_DIR) and no backup root.
let cfg: string;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["CLAUDE_CONFIG_DIR", "TK_SUPERVISOR_TRANSCRIPT_BACKUP"]) saved[k] = process.env[k];
  cfg = mkdtempSync(join(tmpdir(), "tk-sup-resume-cfg-"));
  process.env.CLAUDE_CONFIG_DIR = cfg;
  delete process.env.TK_SUPERVISOR_TRANSCRIPT_BACKUP;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

function writeTranscript(dir: string, sid: string, ids: string[], slug = "some-slug"): string {
  mkdirSync(join(dir, slug), { recursive: true });
  const path = join(dir, slug, `${sid}.jsonl`);
  writeFileSync(path, ids.map(line).join("\n") + "\n");
  return path;
}

/** A fake §4 verb runner: `status` answers `status`; `account` answers `account`. */
function verbs(o: { status?: string; account?: Record<string, any> } = {}) {
  const calls: string[][] = [];
  const runner = async (_root: string, args: string[]): Promise<Record<string, any>> => {
    calls.push(args);
    if (args[0] === "status") return { job_id: "j", runs: [{ run_id: STUDIO, state: o.status ?? "queued" }] };
    if (args[0] === "account") return o.account ?? { within_budget: true, exceeded: [], counters: { turns: 1, tokens: 15 } };
    if (args[0] === "cancel") return { cancelled: true, runs_ended: [STUDIO] };
    if (args[0] === "finish") return { run_id: STUDIO, state: args[args.indexOf("--state") + 1] };
    return { ok: true };
  };
  return { calls, runner, of: (verb: string) => calls.filter((c) => c[0] === verb) };
}
const flag = (argv: string[], f: string) => argv[argv.indexOf(f) + 1];

/** A dead supervisor's running run: claimed by A, reached the verb, studio run and wake recorded,
 * optionally its session and worker; then A dies. */
async function orphan(o: {
  target?: "skill" | "core"; defn?: Record<string, unknown>; session?: string | null;
  worker?: { pid: number; start: string | null; guardS?: number } | null;
  killWorker?: Probes["killWorker"]; probeWorker?: Probes["probeWorker"]; now?: Probes["now"]; tier?: string; sandbox?: string;
  engineLive?: Probes["engineLive"];
} = {}) {
  const target = o.target ?? "skill";
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-resume-q-"));
  const checkout = mkdtempSync(join(tmpdir(), "tk-sup-resume-co-"));
  const alive = new Set([A.pid, B.pid]);
  const kills: { pid: number; start: string | null; lockOwner: string | null; state: string }[] = [];
  let queue!: Queue;
  const probes: Probes = {
    ownerAlive: (w) => alive.has(w.pid),
    engineLive: o.engineLive ?? (async () => ({ live: false })),
    killWorker: o.killWorker ?? (async (pid, start): Promise<WorkerKill> => {
      // What the queue looked like when the worker was killed: the dead run still held its lock.
      const run = queue.runs()[0];
      kills.push({ pid, start, lockOwner: queue.lock(checkout)?.owner_nonce ?? null, state: run.state });
      return { pid, start, outcome: "killed" };
    }),
    ...(o.probeWorker ? { probeWorker: o.probeWorker } : {}), ...(o.now ? { now: o.now } : {}),
  };
  queue = new Queue(join(dir, "q.db"), probes);
  const defn = { id: "j", trigger: "one-shot", target: target === "core" ? { core: "c" } : { skill: "tk-studio-activate" }, guards: GUARDS, ...o.defn };
  const r = queue.enqueue({ jobId: "j", root: checkout, projectId: "p", target, definition: defn, owner: A, tier: o.tier ?? "host", sandbox: o.sandbox }).run;
  await queue.claim(r.run_id, A);
  queue.markVerbStarted(r.run_id, "submit", [], { target, definition: defn });
  queue.setStudioRun(r.run_id, STUDIO);
  queue.setWake(r.run_id, WAKE);
  if (o.session !== null) queue.setSession(r.run_id, o.session ?? SID);
  if (o.worker !== null) queue.setWorker(r.run_id, o.worker?.pid ?? 424242, o.worker?.start ?? "12345", o.worker?.guardS);
  alive.delete(A.pid); // the supervisor died
  const rebuild = async (run: QueueRun, wake: Record<string, any>): Promise<Started> => ({
    jobId: "j", root: checkout, projectId: "p", runId: STUDIO, guardS: 600, jobGuardS: 600, defn, woke: wake, tier: (o.tier ?? "host") as "host",
    ...(o.sandbox ? { sandbox: o.sandbox } : {}), sessionId: run.session_id ?? undefined,
  });
  return { queue, run: r, checkout, defn, kills, rebuild, alive };
}

const okTranscripts: TranscriptChecks = { host: () => ({ restored: false }), sbx: async () => {} };

// ---------------------------------------------------------------- restart (AC1)

describe("restart: a dead supervisor's skill run resumes or ends partial naming the cause", () => {
  test("resumable: worker killed first (the lock still held), one-transaction takeover, `resumed` event, pacing sees it live; driven with --resume on the stored tier", async () => {
    const fx = await orphan();
    writeTranscript(join(cfg, "projects"), SID, ["m1", "m2"]);
    const v = verbs();
    const { report, prepared } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.resumed).toEqual([{ run_id: fx.run.run_id, studio_run_id: STUDIO, resume: 1 }]);
    expect(report.ended).toEqual([]);
    // The recorded worker was killed while the dead run still held its lock (before any takeover or release).
    expect(fx.kills).toEqual([{ pid: 424242, start: "12345", lockOwner: A.nonce, state: "running" }]);
    // Taken over: running under B, the lock re-owned by B (never released), one `resumed` event.
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "running", owner_nonce: B.nonce, session_id: SID });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ run_id: fx.run.run_id, owner_nonce: B.nonce });
    const resumed = fx.queue.events(fx.run.run_id).filter((e) => e.kind === "resumed");
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ from_state: "running", to_state: "running" });
    expect(resumed[0].detail).toMatchObject({
      resume: 1, session_id: SID, dead_owner: { nonce: A.nonce }, owner: { nonce: B.nonce }, worker: { outcome: "killed" },
    });
    expect(fx.queue.pacing("j", fx.checkout, B).live.map((r) => r.run_id)).toEqual([fx.run.run_id]);
    // After the takeover (never before it), the budget check accounted the interrupted iteration's counts.
    expect(v.of("account")[0]).toEqual(["account", "--directory", fx.checkout, "--run-id", STUDIO, "--turns", "2", "--tokens", "30"]);
    const evs = fx.queue.events(fx.run.run_id);
    const acct = evs.findIndex((e) => e.kind === "accounted");
    expect(acct).toBeGreaterThan(evs.findIndex((e) => e.kind === "resumed"));
    expect(evs[acct].detail).toMatchObject({ turns: 2, tokens: 30, message_ids: ["m1", "m2"], reason: "supervisor restart" });

    // Driving: --resume <sid> with the remaining wall clock; only the new message ids are accounted.
    const invokes: { args: Record<string, any>; opts: Record<string, any> }[] = [];
    const invoke = (async (_root: string, _skill: string, args: Record<string, any>, _sp?: unknown, opts: Record<string, any> = {}) => {
      invokes.push({ args, opts });
      opts.onSpawn?.(process.pid);
      writeFileSync(join(cfg, "projects", "some-slug", `${SID}.jsonl`), ["m1", "m2", "m3"].map(line).join("\n") + "\n");
      return { ran: true, status_block: BLOCK, session_id: SID, total_cost_usd: 0.01 };
    }) as unknown as typeof invokeSkill;
    await driveResumes(fx.queue, report.resumed, prepared, v.runner, invoke);
    expect(invokes).toHaveLength(1);
    expect(invokes[0].opts).toMatchObject({ sessionId: SID, resume: true });
    expect(invokes[0].opts.beforeSpawn).toBeUndefined(); // the session is already recorded
    expect(invokes[0].args.timeout_s).toBeGreaterThan(590);
    expect(invokes[0].args.timeout_s).toBeLessThanOrEqual(600);
    expect(invokes[0].args).toMatchObject({ tier: "host", model: "sonnet" });
    expect(v.of("account").at(-1)).toEqual(["account", "--directory", fx.checkout, "--run-id", STUDIO, "--turns", "1", "--tokens", "15"]);
    expect(report.resumed[0].summary).toMatchObject({ ok: true, state: "complete", run_id: fx.run.run_id, studio_run_id: STUDIO });
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "complete", worker_pid: process.pid });
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("after wake, no session recorded → partial `orphaned: supervisor restart; no session recorded`; studio run finished partial with it", async () => {
    const fx = await orphan({ session: null, worker: null });
    const v = verbs();
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    const reason = `${ORPHANED_REASON}; no session recorded`;
    expect(report.resumed).toEqual([]);
    expect(report.ended).toMatchObject([{ run_id: fx.run.run_id, reason }]);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "partial", reason });
    expect(flag(v.of("finish")[0], "--reason")).toBe(reason);
    expect(flag(v.of("finish")[0], "--state")).toBe("partial");
    expect(fx.kills).toEqual([]); // no worker recorded: nothing to kill
    expect(fx.queue.events(fx.run.run_id).at(-1)).toMatchObject({
      kind: "orphaned", to_state: "partial", detail: { studio_outcome: { run_id: STUDIO, state: "partial" } },
    });
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("guard spent: `account` answers exceeded [max_turns] → partial naming the guard", async () => {
    const fx = await orphan();
    writeTranscript(join(cfg, "projects"), SID, ["m1"]);
    const v = verbs({ account: { within_budget: false, exceeded: ["max_turns"], counters: { turns: 41 } } });
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    const reason = `${ORPHANED_REASON}; guard: max_turns (40)`;
    expect(report.ended).toMatchObject([{ reason }]);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "partial", reason });
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ guards_tripped: [{ guard: "max_turns", value: 40 }] });
  });

  test("guard spent: no wall clock left (the guard's time passed since the worker spawned) → partial naming max_wall_clock_seconds", async () => {
    const fx = await orphan();
    writeTranscript(join(cfg, "projects"), SID, ["m1"]);
    const later = () => Date.now() + 601_000;
    const { report } = await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild, transcripts: okTranscripts, clock: later });
    expect(report.ended).toMatchObject([{ reason: `${ORPHANED_REASON}; guard: max_wall_clock_seconds (600s)` }]);
  });

  test("core run: never resumed — `cancel` + partial `supervisor restart` (unchanged)", async () => {
    const fx = await orphan({ target: "core", session: null });
    const v = verbs({ status: "running" });
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.resumed).toEqual([]);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "partial", reason: ORPHANED_REASON });
    expect(v.of("cancel")).toHaveLength(1);
    expect(v.of("finish")).toHaveLength(0);
    expect(v.of("account")).toHaveLength(0);
  });

  test("studio run already terminal: the queue run ends in that state, no resume, nothing ended again", async () => {
    const fx = await orphan();
    const v = verbs({ status: "complete" });
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.resumed).toEqual([]);
    expect(report.ended).toMatchObject([{ run_id: fx.run.run_id, state: "complete" }]);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "complete", reason: `${ORPHANED_REASON}; studio run ${STUDIO} already complete` });
    expect(v.calls.map((c) => c[0])).toEqual(["status"]);
    expect(fx.queue.events(fx.run.run_id).at(-1)!.detail).toMatchObject({ studio_outcome: { run_id: STUDIO, state: "complete" } });
  });

  test("resume cap: a run already resumed once is not resumed again → partial `resume cap reached (1)`", async () => {
    expect(RESUME_CAP).toBe(1);
    const fx = await orphan();
    fx.queue.markResumed(fx.run.run_id, { reason: "silent worker exit" });
    const { report } = await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.ended).toMatchObject([{ reason: `${ORPHANED_REASON}; resume cap reached (1)` }]);
  });

  test("transcript GC'd with no backup copy (TK_SUPERVISOR_TRANSCRIPT_BACKUP unset) → partial naming `transcript missing: <sid>`", async () => {
    const fx = await orphan();
    const { report } = await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild });
    expect(report.ended[0].reason).toStartWith(`${ORPHANED_REASON}; transcript missing: ${SID}`);
    expect(fx.queue.get(fx.run.run_id)!.state).toBe("partial");
  });

  test("transcript GC'd, one copy in the backup → restored into its slug (+ subagents), then resumed", async () => {
    const fx = await orphan();
    const backup = mkdtempSync(join(tmpdir(), "tk-sup-resume-backup-"));
    writeTranscript(backup, SID, ["m1"], "the-slug");
    mkdirSync(join(backup, "the-slug", SID, "subagents"), { recursive: true });
    writeFileSync(join(backup, "the-slug", SID, "subagents", "agent-1.jsonl"), line("s1") + "\n");
    process.env.TK_SUPERVISOR_TRANSCRIPT_BACKUP = backup;
    const { report } = await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild });
    expect(report.resumed).toHaveLength(1);
    expect(readFileSync(join(cfg, "projects", "the-slug", `${SID}.jsonl`), "utf-8")).toContain("m1");
    expect(existsSync(join(cfg, "projects", "the-slug", SID, "subagents", "agent-1.jsonl"))).toBe(true);
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "resumed")!.detail).toMatchObject({ transcript: "restored from the backup" });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "accounted")!.detail).toMatchObject({ turns: 2, message_ids: ["m1", "s1"] });
  });

  test("stop on a restart end: `stop.on_status: [partial]` → the `stopped` event in the orphan end's transaction (DW-8)", async () => {
    const fx = await orphan({ session: null, defn: { stop: { on_status: ["partial"] } } });
    await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    const evs = fx.queue.events(fx.run.run_id);
    const end = evs.findIndex((e) => e.kind === "orphaned");
    expect(evs[end + 1]).toMatchObject({ kind: "stopped", detail: { condition: "on_status", state: "partial", job_id: "j" } });
    expect(evs[end + 1].seq).toBe(evs[end].seq + 1);
    expect(fx.queue.pacing("j", fx.checkout, B).stopped).toMatchObject({ kind: "stopped" });
  });

  test("a resume check that answers no rebuild (the wake answer missing) ends partial naming it", async () => {
    const fx = await orphan();
    writeTranscript(join(cfg, "projects"), SID, ["m1"]);
    fx.queue.db.run("UPDATE runs SET wake = NULL WHERE run_id = ?", [fx.run.run_id]);
    const { report } = await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.ended).toMatchObject([{ reason: `${ORPHANED_REASON}; no wake answer recorded` }]);
  });

  test("a recorded worker that may still run but cannot be matched is never released under: the run is held as it is", async () => {
    const fx = await orphan({ killWorker: async (pid, start) => ({ pid, start, outcome: "start time unreadable" }) });
    const v = verbs();
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.held).toMatchObject([{ run_id: fx.run.run_id, worker: { outcome: "start time unreadable" } }]);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "running", owner_nonce: A.nonce });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ owner_nonce: A.nonce });
    expect(v.calls).toEqual([]);
  });

  test("legacy ops (no resume op): the orphan end still carries studio_outcome and the stop", async () => {
    const fx = await orphan({ defn: { stop: { on_status: ["partial"] } } });
    await fx.queue.recover(studioOps(verbs().runner), B);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "partial", reason: ORPHANED_REASON });
    expect(fx.queue.events(fx.run.run_id).slice(-2).map((e) => e.kind)).toEqual(["orphaned", "stopped"]);
  });
});

// ---------------------------------------------------------------- the recorded worker kill (DW-3, DW-7)

describe.skipIf(process.platform !== "linux")("killRecordedWorker: pid + start time, never by name", () => {
  const liveChild = () => {
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    child.unref();
    return child.pid!;
  };
  const gone = async (pid: number) => {
    const deadline = Date.now() + 3000;
    for (;;) {
      let alive = true;
      try { process.kill(pid, 0); alive = readFileSync(`/proc/${pid}/stat`, "utf-8").split(") ")[1]?.[0] !== "Z"; } catch { alive = false; }
      if (!alive || Date.now() > deadline) return !alive;
      await Bun.sleep(50);
    }
  };

  test("a live worker whose start time matches: its process group is SIGKILLed", async () => {
    const pid = liveChild();
    const start = processStartTime(pid);
    expect(start).not.toBeNull();
    const out = await killRecordedWorker(pid, start);
    expect(out).toMatchObject({ pid, outcome: "killed" });
    expect(await gone(pid)).toBe(true);
  });

  test("a reused pid (alive, start time differs): never signalled, the mismatch named", async () => {
    const pid = liveChild();
    try {
      const out = await killRecordedWorker(pid, "1");
      expect(out.outcome).toBe("start time differs");
      expect(out.detail).toContain("not signalled");
      process.kill(pid, 0); // still alive
    } finally { try { process.kill(-pid, "SIGKILL"); } catch { /* our own child only */ } }
  });

  test("a dead pid: not running, never signalled", async () => {
    let signalled = false;
    const out = await killRecordedWorker(2 ** 22 + 17, "123", { kill: () => { signalled = true; } });
    expect(out.outcome).toBe("not running");
    expect(signalled).toBe(false);
  });

  test("win32: `taskkill /F /T /PID` only after the start time matches (injected)", async () => {
    const killed: [number, string][] = [];
    const deps = { platform: "win32" as const, running: () => killed.length === 0, startTime: () => "2026-09-28T10:00:00.0000000Z", kill: (p: number, pl: string) => { killed.push([p, pl]); } };
    expect((await killRecordedWorker(4242, "2026-09-28T09:00:00.0000000Z", deps)).outcome).toBe("start time differs");
    expect(killed).toEqual([]);
    expect((await killRecordedWorker(4242, "2026-09-28T10:00:00.0000000Z", { ...deps, waitMs: 0 })).outcome).toBe("killed");
    expect(killed).toEqual([[4242, "win32"]]);
  });

  test("recover with a real reused pid: never signalled; the run proceeds (resumes) with the mismatch in its event", async () => {
    const pid = liveChild();
    try {
      const fx = await orphan({ worker: { pid, start: "1" }, killWorker: (p, s) => killRecordedWorker(p, s) });
      writeTranscript(join(cfg, "projects"), SID, ["m1"]);
      const { report } = await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
      expect(report.resumed).toHaveLength(1);
      expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "resumed")!.detail).toMatchObject({ worker: { pid, outcome: "start time differs" } });
      process.kill(pid, 0); // still alive
    } finally { try { process.kill(-pid, "SIGKILL"); } catch { /* our own child only */ } }
  });
});

// ---------------------------------------------------------------- silent exit (AC2)

/** An in-memory recorder (what the queue records, without a queue). */
function memRecorder(): RunRecorder & { log: [string, unknown][] } {
  const log: [string, unknown][] = [];
  let resumes = 0;
  const ids: string[] = [];
  return {
    log,
    session: (sid) => { log.push(["session", sid]); },
    worker: (pid) => { log.push(["worker", pid]); },
    accounted: (list, counts) => { ids.push(...list); log.push(["accounted", { list, counts }]); },
    accountedIds: () => [...ids],
    resumes: () => resumes,
    resumed: (detail) => { resumes++; log.push(["resumed", detail]); },
  };
}

const started = (extra: Partial<Started> = {}): Started => ({
  jobId: "j", root: "proj", projectId: "p", runId: STUDIO, guardS: 600, jobGuardS: 600,
  defn: { id: "j", trigger: "one-shot", target: { skill: "tk-studio-activate" }, guards: GUARDS }, woke: WAKE, ...extra,
});

/** finishRun with a fake invoker answering `outs` in turn (each call appends one message to the transcript). */
async function silent(
  outs: Record<string, unknown>[], extra: Partial<Started> = {}, v = verbs(), rec = memRecorder(), transcripts?: TranscriptChecks,
) {
  const invokes: { args: Record<string, any>; opts: Record<string, any> }[] = [];
  let n = 0;
  const invoke = (async (_root: string, _skill: string, args: Record<string, any>, _sp?: unknown, opts: Record<string, any> = {}) => {
    invokes.push({ args, opts });
    opts.beforeSpawn?.();
    opts.onSpawn?.(1000 + n);
    const path = join(cfg, "projects", "slug", `${SID}.jsonl`);
    mkdirSync(join(cfg, "projects", "slug"), { recursive: true });
    writeFileSync(path, (existsSync(path) ? readFileSync(path, "utf-8") : "") + line(`m${++n}`) + "\n");
    return { worker_elapsed_s: 10, session_id: SID, ...outs[Math.min(n - 1, outs.length - 1)] };
  }) as unknown as typeof invokeSkill;
  const summary = await finishRun({ sessionId: SID, recorder: rec, ...started(extra) }, v.runner, invoke, undefined, transcripts);
  return { summary, invokes, rec, v, finish: v.of("finish")[0] };
}
const SILENT = { ran: true, exit: 0, conformance_failure: MISSING_STATUS_BLOCK };

describe("silent exit (AC2): the same resume-or-partial rule, capped at one resume", () => {
  test("first silent exit → one in-process resume (--resume, the remaining wall clock); its block is finished", async () => {
    const { summary, invokes, rec, v, finish } = await silent([SILENT, { ran: true, exit: 0, status_block: BLOCK }]);
    expect(invokes).toHaveLength(2);
    expect(invokes[0].opts).toMatchObject({ sessionId: SID });
    expect(invokes[0].opts.resume).toBeUndefined();
    expect(invokes[1].opts).toMatchObject({ sessionId: SID, resume: true });
    expect(invokes[1].args.timeout_s).toBe(590);
    expect(flag(finish, "--state")).toBe("complete");
    expect(summary).toMatchObject({ ok: true, state: "complete" });
    // The session recorded once (before the first spawn), each worker on spawn, each iteration accounted once.
    expect(rec.log.filter(([k]) => k === "session")).toEqual([["session", SID]]);
    expect(rec.log.filter(([k]) => k === "worker")).toHaveLength(2);
    expect(rec.log.filter(([k]) => k === "resumed")).toHaveLength(1);
    expect(v.of("account").map((a) => flag(a, "--turns"))).toEqual(["1", "1"]);
  });

  test("second silent exit → partial, the reason carrying MISSING_STATUS_BLOCK and `resume cap reached (1)`", async () => {
    const { summary, invokes, finish } = await silent([SILENT, SILENT]);
    expect(invokes).toHaveLength(2);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; resume cap reached (1)`);
    expect(summary.state).toBe("partial");
  });

  test("silent exit with the studio run already ended → partial naming it, never resumed", async () => {
    const { invokes, finish } = await silent([SILENT], {}, verbs({ status: "cancelled" }));
    expect(invokes).toHaveLength(1);
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; studio run ${STUDIO} already cancelled`);
  });

  test("silent exit with no wall clock left → partial naming the guard", async () => {
    const { invokes, finish, summary } = await silent([{ ...SILENT, worker_elapsed_s: 600 }]);
    expect(invokes).toHaveLength(1);
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; guard: max_wall_clock_seconds (600s)`);
    expect(summary.guards_tripped).toEqual([{ guard: "max_wall_clock_seconds", value: 600 }]);
  });

  test.each([
    ["auth block", { ran: true, exit: 1, status_block: { status: "blocked", intent: "tk-studio-activate", artifacts: [], reason: MAX_LOGIN_MISSING } }, "blocked"],
    ["preflight ran:false", { ran: false, preflight: ["x"], status_block: { status: "blocked", intent: "tk-studio-activate", artifacts: [], reason: "auth preflight: x" } }, "blocked"],
    ["sbx 124 at the guard", { ran: true, exit: 124, worker_elapsed_s: 600, conformance_failure: MISSING_STATUS_BLOCK }, "partial"],
  ])("%s: unchanged outcome, never resumed", async (_name, out, state) => {
    const extra = _name.startsWith("sbx") ? { tier: "sbx" as const, sandbox: "sb" } : {};
    const { invokes, finish } = await silent([out as Record<string, unknown>], extra);
    expect(invokes).toHaveLength(1);
    expect(flag(finish, "--state")).toBe(state);
    expect(flag(finish, "--reason")).not.toContain("resume");
  });

  test("host wall-clock timeout: unchanged (partial naming the guard), never resumed", async () => {
    let calls = 0;
    const invoke = (async () => { calls++; throw new Error("claude timed out after 600s (process tree killed)"); }) as unknown as typeof invokeSkill;
    const v = verbs();
    const summary = await finishRun({ sessionId: SID, recorder: memRecorder(), ...started() }, v.runner, invoke);
    expect(calls).toBe(1);
    expect(summary).toMatchObject({ state: "partial", reason: "guard: max_wall_clock_seconds (600s)" });
  });
});

// ---------------------------------------------------------------- the resume check, the worker command, the transcripts

describe("resumeCheck order and the pieces it rests on", () => {
  const input = (extra: Record<string, unknown> = {}) => ({
    root: "proj", jobId: "j", studioRunId: STUDIO, sessionId: SID, resumes: 0, defn: { guards: GUARDS }, guardS: 600, jobGuardS: 600,
    spentS: 0, counts: () => ({ counts: { turns: 1, tokens: 15 }, ids: ["m1"] }), ...extra,
  });

  test("checked in order: session, cap, studio state, transcript, budget — the first failure is the cause", async () => {
    const v = verbs();
    expect(await resumeCheck(input({ sessionId: null }), v.runner, okTranscripts)).toMatchObject({ ok: false, cause: "no session recorded" });
    expect(await resumeCheck(input({ resumes: 1 }), v.runner, okTranscripts)).toMatchObject({ ok: false, cause: "resume cap reached (1)" });
    expect(v.calls).toEqual([]);
    const missing: TranscriptChecks = { host: () => { throw new TranscriptError(`transcript missing: ${SID} (x)`); }, sbx: async () => {} };
    expect(await resumeCheck(input(), v.runner, missing)).toMatchObject({ ok: false, cause: `transcript missing: ${SID} (x)` });
    expect(v.calls.map((c) => c[0])).toEqual(["status"]); // no account for a run that cannot resume
    const ok = await resumeCheck(input({ spentS: 100 }), verbs({ account: { within_budget: true, exceeded: [], counters: { wall_clock_seconds: 250 } } }).runner, okTranscripts);
    expect(ok).toMatchObject({ ok: true, remainingS: 350 }); // account's wall_clock_seconds wins over spentS
  });

  test("sbx: the existence check runs inside the microVM", async () => {
    const seen: string[] = [];
    const sbx: TranscriptChecks = { host: () => { throw new Error("host never read on sbx"); }, sbx: async (sb, sid) => { seen.push(`${sb}:${sid}`); } };
    expect(await resumeCheck(input({ tier: "sbx", sandbox: "sb" }), verbs().runner, sbx)).toMatchObject({ ok: true });
    expect(seen).toEqual([`sb:${SID}`]);
  });

  test("buildWorkerCommand: --session-id on a first invoke, --resume on a resume; never --fork-session", () => {
    const first = buildWorkerCommand({ prompt: "p", sessionId: SID, bin: "claude" }).argv;
    expect(first.slice(-2)).toEqual(["--session-id", SID]);
    const again = buildWorkerCommand({ prompt: "p", sessionId: SID, resume: true, bin: "claude" }).argv;
    expect(again.slice(-2)).toEqual(["--resume", SID]);
    expect([...first, ...again]).not.toContain("--fork-session");
  });

  test("invokeSkill: a resume passes the continuation prompt as the one -p item; beforeSpawn runs after the preflight, onSpawn with the pid", async () => {
    const order: string[] = [];
    const spawner: Spawner = async (_cmd, args, opts) => {
      if (args.includes("auth")) { order.push("preflight"); return { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }; }
      order.push(`worker ${args[1] === CONTINUATION_PROMPT ? "continuation" : "skill"} ${args.slice(-2).join(" ")}`);
      opts.onSpawn?.(4242);
      return { exit: 0, stderr: "", stdout: JSON.stringify({ result: JSON.stringify(BLOCK), session_id: SID }) };
    };
    const root = mkdtempSync(join(tmpdir(), "tk-sup-resume-inv-"));
    await invokeSkill(root, "tk-studio-activate", { timeout_s: 60 }, spawner, {
      sessionId: SID, resume: true, beforeSpawn: () => order.push("beforeSpawn"), onSpawn: (pid) => order.push(`onSpawn ${pid}`),
    });
    expect(order).toEqual(["preflight", "beforeSpawn", `worker continuation --resume ${SID}`, "onSpawn 4242"]);
  });

  test("transcriptNewCounts: only message ids not already accounted", () => {
    writeTranscript(join(cfg, "projects"), SID, ["m1", "m2", "m3"]);
    expect(transcriptNewCounts(SID, new Set(["m1", "m2"]), cfg)).toEqual({ counts: { turns: 1, tokens: 15 }, ids: ["m3"] });
  });

  test("ensureTranscript: present → found; missing + one backup copy → restored; none, unset, or ambiguous → `transcript missing: <sid>`", () => {
    const backup = mkdtempSync(join(tmpdir(), "tk-sup-resume-bk-"));
    expect(() => ensureTranscript(SID, cfg, undefined)).toThrow(`transcript missing: ${SID}`);
    expect(() => ensureTranscript(SID, cfg, backup)).toThrow(/transcript missing: .*no copy/);
    writeTranscript(backup, SID, ["m1"], "slug-a");
    expect(ensureTranscript(SID, cfg, backup)).toMatchObject({ restored: true, path: join(cfg, "projects", "slug-a", `${SID}.jsonl`) });
    expect(ensureTranscript(SID, cfg, backup)).toMatchObject({ restored: false });
    const cfg2 = mkdtempSync(join(tmpdir(), "tk-sup-resume-cfg2-"));
    cpSync(join(backup, "slug-a"), join(backup, "slug-b"), { recursive: true });
    expect(() => ensureTranscript(SID, cfg2, backup)).toThrow(/transcript missing: .*ambiguous/);
  });

  test("sbx existence: `sbx exec <sb> printenv HOME`, then `find <home>/.claude/projects -name <sid>.jsonl` — argv only", async () => {
    expect(sbxTranscriptArgv("sb", "/vm-user/.claude", SID)).toEqual(["exec", "sb", "find", "/vm-user/.claude/projects", "-name", `${SID}.jsonl`]);
    const runs: string[][] = [];
    const found = async (_bin: string, args: string[]) => {
      runs.push(args);
      return args.includes("printenv") ? { exit: 0, stdout: "/vmhome\n", stderr: "" } : { exit: 0, stdout: `/vmhome/.claude/projects/s/${SID}.jsonl\n`, stderr: "" };
    };
    await sbxTranscriptExists("sb", SID, found);
    expect(runs).toEqual([["exec", "sb", "printenv", "HOME"], ["exec", "sb", "find", "/vmhome/.claude/projects", "-name", `${SID}.jsonl`]]);
    const none = async (_bin: string, args: string[]) => (args.includes("printenv") ? { exit: 0, stdout: "/vmhome\n", stderr: "" } : { exit: 0, stdout: "", stderr: "" });
    await expect(sbxTranscriptExists("sb", SID, none)).rejects.toThrow(`transcript missing: ${SID}`);
  });

  test("queueRecorder: the session, the worker (pid + its start time), accounted ids and resumes land on the queue run", async () => {
    const fx = await orphan({ session: null, worker: null });
    fx.queue.db.run("UPDATE runs SET owner_nonce = ? WHERE run_id = ?", [B.nonce, fx.run.run_id]);
    const rec = queueRecorder(fx.queue, fx.run.run_id);
    rec.session(SID);
    rec.worker(process.pid);
    rec.accounted(["m1"], { turns: 1, tokens: 15 });
    rec.resumed({ reason: "silent worker exit" });
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ session_id: SID, worker_pid: process.pid, worker_start: processStartTime(process.pid) });
    expect(rec.accountedIds()).toEqual(["m1"]);
    expect(rec.resumes()).toBe(1);
  });
});

describe("restartResumer: a core target recorded only in the driven definition is never resumed", () => {
  test("stored target skill, driven core → no resume, no cause", async () => {
    const fx = await orphan({ defn: { target: { core: "c" } } });
    const decision = await restartResumer(fx.queue, verbs().runner, new Map(), { rebuild: fx.rebuild, transcripts: okTranscripts })(fx.queue.get(fx.run.run_id)!);
    expect(decision).toEqual({ resume: false });
  });
});

// ---------------------------------------------------------------- review patches

/** Is `pid` gone (or a zombie) within 3 s? Linux only (/proc). */
async function goneWithin(pid: number): Promise<boolean> {
  const deadline = Date.now() + 3000;
  for (;;) {
    let alive = true;
    try { process.kill(pid, 0); alive = readFileSync(`/proc/${pid}/stat`, "utf-8").split(") ")[1]?.[0] !== "Z"; } catch { alive = false; }
    if (!alive || Date.now() > deadline) return !alive;
    await Bun.sleep(50);
  }
}

describe("sbx restart: held until the in-VM deadline, then partial naming the wall-clock guard, never resumed", () => {
  const never: TranscriptChecks = {
    host: () => { throw new Error("the host transcript is never read for an sbx run"); },
    sbx: async () => { throw new Error("an sbx run on restart never reaches the transcript check"); },
  };

  test("the worker record carries the guard seconds passed to its spawn (column + `worker` event)", async () => {
    const fx = await orphan({ tier: "sbx", sandbox: "sb", worker: { pid: 424242, start: "12345", guardS: 300 } });
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ worker_pid: 424242, worker_start: "12345", worker_guard_s: 300 });
    expect(fx.queue.events(fx.run.run_id).find((e) => e.kind === "worker")!.detail).toEqual({ pid: 424242, start: "12345", guard_s: 300 });
  });

  test("deadline not passed (spawn + guard + the -k grace): run and lock left as they are, reported in held[] — whatever the host pid", async () => {
    let clock = 0;
    const fx = await orphan({ tier: "sbx", sandbox: "sb", worker: { pid: 424242, start: "12345", guardS: 300 }, now: () => clock });
    const spawned = Date.parse(fx.queue.events(fx.run.run_id).find((e) => e.kind === "worker")!.at);
    const deadline = spawned + (300 + SBX_GUARD_KILL_AFTER_S) * 1000;
    expect(SBX_GUARD_KILL_AFTER_S).toBe(10);
    clock = deadline - 1;
    const v = verbs();
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: never });
    expect(report.held).toMatchObject([{ run_id: fx.run.run_id, worker: { pid: 424242, outcome: "in-VM deadline not passed", deadline: new Date(deadline).toISOString() } }]);
    expect(report.resumed).toEqual([]);
    expect(report.ended).toEqual([]);
    expect(fx.kills).toEqual([]); // decided from the deadline: the host sbx exec pid is not even probed
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "running", owner_nonce: A.nonce });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ run_id: fx.run.run_id, owner_nonce: A.nonce });
    expect(v.calls).toEqual([]);
  });

  test("deadline passed: ended partial naming max_wall_clock_seconds; never resumed (no account, no transcript check); the lock released", async () => {
    let clock = 0;
    const fx = await orphan({ tier: "sbx", sandbox: "sb", worker: { pid: 424242, start: "12345", guardS: 300 }, now: () => clock });
    clock = Date.parse(fx.queue.events(fx.run.run_id).find((e) => e.kind === "worker")!.at) + 310_000;
    const v = verbs({ status: "running" });
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: never });
    const reason = `${ORPHANED_REASON}; guard: max_wall_clock_seconds (600s)`;
    expect(report.held).toBeUndefined();
    expect(report.resumed).toEqual([]);
    expect(report.ended).toMatchObject([{ run_id: fx.run.run_id, reason }]);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "partial", reason });
    expect(v.of("account")).toEqual([]);
    expect(flag(v.of("finish")[0], "--reason")).toBe(reason);
    const end = fx.queue.events(fx.run.run_id).at(-1)!;
    expect(end).toMatchObject({ kind: "orphaned", detail: {
      guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }],
      worker: { outcome: "in-VM deadline passed", host: { outcome: "killed" } },
    } });
    expect(fx.queue.resumeCount(fx.run.run_id)).toBe(0);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("a worker record without guard seconds: the job's own guard bounds the deadline", async () => {
    let clock = 0;
    const fx = await orphan({ tier: "sbx", sandbox: "sb", now: () => clock });
    const spawned = Date.parse(fx.queue.events(fx.run.run_id).find((e) => e.kind === "worker")!.at);
    expect(fx.queue.sbxDeadline(fx.queue.get(fx.run.run_id)!)).toEqual({ ms: spawned + 610_000, guardS: 600 });
    clock = spawned + 609_000;
    expect((await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild, transcripts: never })).report.held).toHaveLength(1);
  });

  test("no worker recorded (session recorded, never spawned): partial naming it, never resumed", async () => {
    const fx = await orphan({ tier: "sbx", sandbox: "sb", worker: null });
    const v = verbs();
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: never });
    expect(report.ended).toMatchObject([{ reason: `${ORPHANED_REASON}; no worker recorded (an sbx run is never resumed on restart)` }]);
    expect(v.of("account")).toEqual([]);
  });
});

describe("claim: a running holder with a dead owner is live while its recorded worker may still run", () => {
  /** Another job on the dead run's checkout, claimed by the live B. */
  async function contend(fx: Awaited<ReturnType<typeof orphan>>) {
    const k = fx.queue.enqueue({ jobId: "k", root: fx.checkout, projectId: "p", target: "skill", definition: { id: "k", target: { skill: "tk-studio-activate" } }, owner: B }).run;
    return { k, claim: await fx.queue.claim(k.run_id, B) };
  }
  const probeAs = (outcome: WorkerKill["outcome"]) => (pid: number, start: string | null): WorkerKill => ({ pid, start, outcome });

  test.each(["running", "start time unreadable", "group alive"] as const)("host worker `%s` → the claimant waits queued naming the holder; the lock stays", async (outcome) => {
    const fx = await orphan({ probeWorker: probeAs(outcome) });
    const { k, claim } = await contend(fx);
    expect(claim).toMatchObject({ claimed: false, why: "lock", holder: { kind: "run", run_id: fx.run.run_id } });
    expect(claim.claimed ? "" : claim.reason).toContain(`owner dead, its recorded worker (pid 424242) may still run: ${outcome}`);
    expect(fx.queue.get(k.run_id)!.state).toBe("queued");
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ run_id: fx.run.run_id, owner_nonce: A.nonce });
    expect(fx.kills).toEqual([]); // a claim probes, it never signals
  });

  test.each(["not running", "start time differs"] as const)("host worker `%s` → the stale lock is released and claimed", async (outcome) => {
    const fx = await orphan({ probeWorker: probeAs(outcome) });
    const { k, claim } = await contend(fx);
    expect(claim.claimed).toBe(true);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ run_id: k.run_id, owner_nonce: B.nonce });
    expect(fx.queue.events(k.run_id).at(-1)!.detail).toMatchObject({ released: { run_id: fx.run.run_id, why: "holder running with a dead owner" } });
  });

  test("sbx holder: waits until the in-VM deadline (the host pid never asked), then claims", async () => {
    let clock = 0;
    const fx = await orphan({
      tier: "sbx", sandbox: "sb", worker: { pid: 424242, start: "12345", guardS: 300 }, now: () => clock,
      probeWorker: () => { throw new Error("an sbx worker is decided by its deadline, not the host pid"); },
    });
    const spawned = Date.parse(fx.queue.events(fx.run.run_id).find((e) => e.kind === "worker")!.at);
    clock = spawned + 309_000;
    const first = await contend(fx);
    expect(first.claim).toMatchObject({ claimed: false, why: "lock" });
    expect(first.claim.claimed ? "" : first.claim.reason).toContain("in-VM deadline not passed until");
    clock = spawned + 311_000;
    expect((await fx.queue.claim(first.k.run_id, B)).claimed).toBe(true);
  });

  test("recover and claim ask the same predicate", () => {
    const w = (outcome: WorkerKill["outcome"]) => workerMayRun({ pid: 1, start: null, outcome });
    expect(["running", "group alive", "start time unreadable", "kill failed", "in-VM deadline not passed"].every((o) => w(o as WorkerKill["outcome"]))).toBe(true);
    expect(["killed", "group killed", "not running", "start time differs", "in-VM deadline passed"].some((o) => w(o as WorkerKill["outcome"]))).toBe(false);
  });
});

describe("killRecordedWorker: a worker that outlives the kill, and a group whose leader exited (injected)", () => {
  test("still running with a matching start time after the wait → `kill failed` (`still running after wait`); recover holds the run", async () => {
    const killed: number[] = [];
    const out = await killRecordedWorker(4242, "s1", { platform: "linux", running: () => true, startTime: () => "s1", kill: (p) => { killed.push(p); }, waitMs: 60 });
    expect(out).toMatchObject({ pid: 4242, outcome: "kill failed", detail: "still running after wait" });
    expect(killed).toEqual([4242]);
    const fx = await orphan({ killWorker: async () => out });
    const v = verbs();
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.held).toMatchObject([{ run_id: fx.run.run_id, worker: { outcome: "kill failed", detail: "still running after wait" } }]);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "running", owner_nonce: A.nonce });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ owner_nonce: A.nonce });
    expect(v.calls).toEqual([]);
  });

  test("leader exited, its process group alive: probed with kill(-pid, 0), SIGKILLed as a group, the outcome reported", async () => {
    let groupUp = true;
    const killed: number[] = [];
    const deps = {
      platform: "linux" as const, running: () => false, startTime: () => null, waitMs: 500,
      groupAlive: (pgid: number) => { expect(pgid).toBe(4242); return groupUp; },
      kill: (p: number) => { killed.push(p); groupUp = false; },
    };
    expect(probeRecordedWorker(4242, "s1", deps)).toMatchObject({ outcome: "group alive" });
    expect(await killRecordedWorker(4242, "s1", deps)).toMatchObject({ pid: 4242, outcome: "group killed" });
    expect(killed).toEqual([4242]);
    // The group gone too: not running, never signalled.
    expect(await killRecordedWorker(4242, "s1", { ...deps, kill: () => { throw new Error("never signalled"); } })).toMatchObject({ outcome: "not running" });
    // The group survives the kill: held.
    const stuck = await killRecordedWorker(4242, "s1", { ...deps, groupAlive: () => true, kill: () => {}, waitMs: 60 });
    expect(stuck).toMatchObject({ outcome: "kill failed", detail: "still running after wait (process group)" });
    expect(workerMayRun(stuck)).toBe(true);
    // win32 has no process groups: never probed.
    expect(probeRecordedWorker(4242, "s1", { ...deps, platform: "win32", groupAlive: () => { throw new Error("asked on win32"); } })).toMatchObject({ outcome: "not running" });
  });
});

describe("restart accounting: only the process that won the takeover accounts, once", () => {
  test("two concurrent recoverers: one takeover, the interrupted counts accounted once, after it", async () => {
    const fx = await orphan();
    writeTranscript(join(cfg, "projects"), SID, ["m1", "m2"]);
    const C: Owner = { pid: 910103, host: HOST, nonce: "nonce-other" };
    const other = new Queue(fx.queue.path, {
      ownerAlive: (w) => w.pid !== A.pid, engineLive: async () => ({ live: false }),
      killWorker: async (pid, start) => ({ pid, start, outcome: "not running" }),
    });
    // Both resume checks reach `status` before either answers: both have passed eligibility before any takeover.
    let arrived = 0, release!: () => void;
    const barrier = new Promise<void>((r) => { release = r; });
    const gated = (v: ReturnType<typeof verbs>) => async (root: string, args: string[]) => {
      if (args[0] === "status") { if (++arrived === 2) release(); await Promise.race([barrier, Bun.sleep(3000)]); }
      return v.runner(root, args);
    };
    const v1 = verbs(), v2 = verbs();
    try {
      const [x, y] = await Promise.all([
        recoverWithResume(fx.queue, B, gated(v1), { rebuild: fx.rebuild, transcripts: okTranscripts }),
        recoverWithResume(other, C, gated(v2), { rebuild: fx.rebuild, transcripts: okTranscripts }),
      ]);
      expect(arrived).toBe(2);
      expect([...x.report.resumed, ...y.report.resumed]).toHaveLength(1);
      expect([...x.report.ended, ...y.report.ended]).toEqual([]);
      expect([...v1.of("account"), ...v2.of("account")]).toHaveLength(1);
      const evs = fx.queue.events(fx.run.run_id);
      expect(evs.filter((e) => e.kind === "resumed")).toHaveLength(1);
      expect(evs.filter((e) => e.kind === "accounted")).toHaveLength(1);
      expect(evs.findIndex((e) => e.kind === "accounted")).toBeGreaterThan(evs.findIndex((e) => e.kind === "resumed"));
    } finally { other.close(); }
  });

  test("a takeover refused by another lock holder ends partial naming it — nothing accounted", async () => {
    const fx = await orphan();
    writeTranscript(join(cfg, "projects"), SID, ["m1"]);
    fx.queue.db.run("UPDATE locks SET run_id = 'q-other', job_id = 'other' WHERE checkout = ?", [fx.run.checkout]);
    const v = verbs();
    const { report } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.ended).toMatchObject([{ reason: `${ORPHANED_REASON}; checkout lock held by run q-other` }]);
    expect(v.of("account")).toEqual([]);
    expect(fx.queue.events(fx.run.run_id).filter((e) => e.kind === "accounted")).toEqual([]);
  });

  test("a budget trip found after the takeover ends the owned run partial naming the guard (studio run finished too)", async () => {
    const fx = await orphan({ defn: { stop: { on_status: ["partial"] } } });
    writeTranscript(join(cfg, "projects"), SID, ["m1"]);
    const v = verbs({ account: { within_budget: false, exceeded: ["max_turns"], counters: { turns: 41 } } });
    const { report, prepared } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    const reason = `${ORPHANED_REASON}; guard: max_turns (40)`;
    expect(report.resumed).toEqual([]);
    expect(prepared.size).toBe(0);
    expect(report.ended).toMatchObject([{ run_id: fx.run.run_id, studio_run_id: STUDIO, reason, studio: { ok: true } }]);
    expect(flag(v.of("finish")[0], "--reason")).toBe(reason);
    const evs = fx.queue.events(fx.run.run_id);
    expect(evs.map((e) => e.kind).slice(-4)).toEqual(["resumed", "accounted", "ended", "stopped"]);
    expect(evs.at(-2)).toMatchObject({ to_state: "partial", detail: { guards_tripped: [{ guard: "max_turns", value: 40 }], studio_outcome: { run_id: STUDIO, state: "partial" }, lock: "released" } });
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });
});

describe("recording failures are never swallowed", () => {
  test("a resume whose record fails never runs: partial keeping MISSING_STATUS_BLOCK and naming `resume not recorded`", async () => {
    const rec = memRecorder();
    rec.resumed = () => { throw new Error("database is locked"); };
    const { invokes, finish, summary } = await silent([SILENT, { ran: true, exit: 0, status_block: BLOCK }], {}, verbs(), rec);
    expect(invokes).toHaveLength(1);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; resume not recorded: database is locked`);
    expect(summary).toMatchObject({ ok: false, state: "partial" });
  });

  describe.skipIf(process.platform !== "linux")("a failed worker record kills the worker", () => {
    test("runProcess: `onSpawn` throws → the child's tree killed, the call fails `worker record failed: <cause>`", async () => {
      let pid = 0;
      await expect(runProcess("sleep", ["30"], { timeoutS: 60, onSpawn: (p) => { pid = p; throw new Error("disk full"); } }))
        .rejects.toThrow(`${WORKER_RECORD_FAILED}: disk full`);
      expect(pid).toBeGreaterThan(0);
      expect(await goneWithin(pid)).toBe(true);
    });

    test("finishRun: the invoke fails `blocked` naming it (never a guard trip, never resumed); the worker is gone", async () => {
      let workerPid = 0;
      const spawner: Spawner = async (_cmd, args, opts) => args.includes("auth")
        ? { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }
        : runProcess("sleep", ["30"], { timeoutS: 60, onSpawn: opts.onSpawn });
      const rec = memRecorder();
      rec.worker = (pid) => { workerPid = pid; throw new Error("RunTerminal: already ended"); };
      const invoke = ((root: string, skill: string, args: Record<string, unknown>, _sp: unknown, opts: Record<string, unknown>) =>
        invokeSkill(root, skill, args, spawner, opts)) as unknown as typeof invokeSkill;
      const v = verbs();
      const root = mkdtempSync(join(tmpdir(), "tk-sup-resume-rec-"));
      const summary = await finishRun({ sessionId: SID, recorder: rec, ...started({ root }) }, v.runner, invoke);
      expect(summary).toMatchObject({ ok: false, state: "blocked", reason: `${WORKER_RECORD_FAILED}: RunTerminal: already ended` });
      expect(flag(v.of("finish")[0], "--state")).toBe("blocked");
      expect(rec.log.filter(([k]) => k === "resumed")).toEqual([]);
      expect(workerPid).toBeGreaterThan(0);
      expect(await goneWithin(workerPid)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------- follow-up review (Story 21.6)

const LAUNCH_DEFN = { id: "j", trigger: "one-shot", target: { skill: "tk-studio-launch", payload: { verb: "status" } }, guards: GUARDS };

describe("a launch run is never resumed beside a live or unverified engine", () => {
  test("restart: a live engine refuses the resume (`launch engine live: <id>`), nothing accounted, the lock handed to the engine", async () => {
    const probed: (string | null)[][] = [];
    const fx = await orphan({ defn: LAUNCH_DEFN, engineLive: async (root, id) => { probed.push([root, id]); return { live: true, run_ids: ["E9"] }; } });
    writeTranscript(join(cfg, "projects"), SID, ["m1"]);
    const v = verbs();
    const { report, prepared } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    const reason = `${ORPHANED_REASON}; launch engine live: E9`;
    expect(report.resumed).toEqual([]);
    expect(prepared.size).toBe(0);
    expect(report.ended).toMatchObject([{ run_id: fx.run.run_id, reason, engine: { handed_to_engine: "E9" } }]);
    expect(v.of("account")).toEqual([]);
    expect(probed.length).toBeGreaterThanOrEqual(1);
    expect(probed.every(([root, id]) => root === fx.checkout && id === null)).toBe(true);
    expect(fx.queue.get(fx.run.run_id)).toMatchObject({ state: "partial", reason, engine_run_id: "E9" });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "E9" });
    expect(fx.queue.events(fx.run.run_id).filter((e) => e.kind === "resumed")).toEqual([]);
  });

  test("restart: a failed probe refuses the resume (`launch engine unverified: <detail>`); an empty live[] resumes as before", async () => {
    const detail = "launch status probe failed (exit 1): no bmad-loop";
    const fx = await orphan({ defn: LAUNCH_DEFN, engineLive: async () => ({ live: true, detail }) });
    writeTranscript(join(cfg, "projects"), SID, ["m1"]);
    const { report } = await recoverWithResume(fx.queue, B, verbs().runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.resumed).toEqual([]);
    expect(report.ended).toMatchObject([{ reason: `${ORPHANED_REASON}; launch engine unverified: ${detail}` }]);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: null });

    const idle = await orphan({ defn: LAUNCH_DEFN, engineLive: async () => ({ live: false, run_ids: [] }) });
    const r2 = await recoverWithResume(idle.queue, B, verbs().runner, { rebuild: idle.rebuild, transcripts: okTranscripts });
    expect(r2.report.resumed).toHaveLength(1);
    expect(r2.report.ended).toEqual([]);
  });

  test("in process: a silent exit of a launch run with a live engine ends partial naming it, never resumed; an unverified one too; an idle one resumes", async () => {
    const withEngine = (found: { live: boolean; run_ids?: string[]; detail?: string }) => {
      const rec = memRecorder();
      rec.launchEngine = async () => found.detail
        ? { holder: { id: null }, engine: { handed_to_engine: "unverified", detail: found.detail } }
        : found.live ? { holder: { id: found.run_ids![0] }, engine: { handed_to_engine: found.run_ids![0], live: found.run_ids } }
        : { engine: { handed_to_engine: null, live: [] } };
      return rec;
    };
    const live = await silent([SILENT, { ran: true, exit: 0, status_block: BLOCK }], { defn: LAUNCH_DEFN }, verbs(), withEngine({ live: true, run_ids: ["E9"] }));
    expect(live.invokes).toHaveLength(1);
    expect(flag(live.finish, "--state")).toBe("partial");
    expect(flag(live.finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; launch engine live: E9`);
    expect(live.v.of("status")).toEqual([]); // no resume check ran
    expect(live.rec.log.filter(([k]) => k === "resumed")).toEqual([]);
    expect(live.v.of("account")).toHaveLength(1); // the iteration is still accounted, once, before finish

    const unverified = await silent([SILENT], { defn: LAUNCH_DEFN }, verbs(), withEngine({ live: true, detail: "launch status probe failed: boom" }));
    expect(unverified.invokes).toHaveLength(1);
    expect(flag(unverified.finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; launch engine unverified: launch status probe failed: boom`);

    const idle = await silent([SILENT, { ran: true, exit: 0, status_block: BLOCK }], { defn: LAUNCH_DEFN }, verbs(), withEngine({ live: false }));
    expect(idle.invokes).toHaveLength(2);
    expect(flag(idle.finish, "--state")).toBe("complete");
  });

  test("queueRecorder: the launch probe asks the queue's engine probe on the queue run's checkout", async () => {
    const probed: (string | null)[][] = [];
    const fx = await orphan({ defn: LAUNCH_DEFN, engineLive: async (root, id) => { probed.push([root, id]); return { live: true, run_ids: ["E7"] }; } });
    const found = await queueRecorder(fx.queue, fx.run.run_id).launchEngine!("elsewhere");
    expect(found).toMatchObject({ holder: { id: "E7" }, engine: { handed_to_engine: "E7" } });
    expect(probed).toEqual([[fx.checkout, null]]);
  });
});

describe("account only when the job has max_turns or max_tokens", () => {
  const sbxOk: TranscriptChecks = { host: () => { throw new Error("host never read on sbx"); }, sbx: async () => {} };
  const SBX = { tier: "sbx" as const, sandbox: "sb" };
  const SBX_SILENT = { ran: true, exit: 1, conformance_failure: MISSING_STATUS_BLOCK }; // no JSON result: no num_turns/usage

  test("an unguarded sbx silent exit with no JSON result resumes: no account, no accounted event, the wall clock from the time spent", async () => {
    const defn = { id: "j", trigger: "one-shot", target: { skill: "tk-studio-activate" }, guards: { max_wall_clock_seconds: 600 } };
    const { invokes, v, rec, finish, summary } = await silent([SBX_SILENT, { ran: true, exit: 0, status_block: BLOCK }], { ...SBX, defn }, verbs(), memRecorder(), sbxOk);
    expect(invokes).toHaveLength(2);
    expect(invokes[1].opts).toMatchObject({ sessionId: SID, resume: true });
    expect(invokes[1].args.timeout_s).toBe(590);
    expect(v.of("account")).toEqual([]);
    expect(rec.log.filter(([k]) => k === "accounted")).toEqual([]);
    const resumed = rec.log.find(([k]) => k === "resumed")![1] as Record<string, unknown>;
    expect(resumed.accounted).toBeUndefined();
    expect(flag(finish, "--state")).toBe("complete");
    expect(summary.account).toBeUndefined();
  });

  test("a guarded sbx silent exit with no JSON result ends partial naming `account failed` (never accounted as zero)", async () => {
    const { invokes, v, finish } = await silent([SBX_SILENT], SBX, verbs(), memRecorder(), sbxOk);
    expect(invokes).toHaveLength(1);
    expect(v.of("account")).toEqual([]);
    expect(flag(finish, "--state")).toBe("partial");
    expect(flag(finish, "--reason")).toBe(`${MISSING_STATUS_BLOCK}; guard: account failed — sbx worker result carried no num_turns`);
  });

  test("resumeCheck: an unguarded job never reads its counts nor runs `account`; remaining = guard − spent", async () => {
    const v = verbs();
    const verdict = await resumeCheck({
      root: "proj", jobId: "j", studioRunId: STUDIO, sessionId: SID, resumes: 0, defn: { guards: { max_wall_clock_seconds: 600 } },
      guardS: 600, jobGuardS: 600, spentS: 100, counts: () => { throw new Error("counts read for an unguarded job"); },
    }, v.runner, okTranscripts);
    expect(verdict).toEqual({ ok: true, remainingS: 500, restored: false });
    expect(v.of("account")).toEqual([]);
    const spent = await resumeCheck({
      root: "proj", jobId: "j", studioRunId: STUDIO, sessionId: SID, resumes: 0, defn: {}, guardS: 600, jobGuardS: 600, spentS: 600,
      counts: () => { throw new Error("never"); },
    }, v.runner, okTranscripts);
    expect(spent).toMatchObject({ ok: false, cause: "guard: max_wall_clock_seconds (600s)" });
    expect(v.of("account")).toEqual([]);
  });
});

describe("a failed account in the resume check is attempted once", () => {
  test("the account verb fails in the resume check: never run again after the loop; the reason names the failure once", async () => {
    const base = verbs();
    const calls: string[][] = [];
    const runner = async (root: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "account") throw new Error("jobrun account: database is locked");
      return base.runner(root, args);
    };
    const v = { ...base, runner, of: (verb: string) => calls.filter((c) => c[0] === verb) };
    const { invokes, finish, summary, rec } = await silent([SILENT], {}, v as ReturnType<typeof verbs>);
    expect(invokes).toHaveLength(1);
    expect(v.of("account")).toHaveLength(1);
    expect(flag(finish, "--state")).toBe("partial");
    const reason = flag(finish, "--reason");
    expect(reason).toBe(`${MISSING_STATUS_BLOCK}; guard: account failed — jobrun account: database is locked`);
    expect(reason.split("account failed").length - 1).toBe(1);
    expect(summary.state).toBe("partial");
    expect(rec.log.filter(([k]) => k === "accounted")).toEqual([]);
  });

  test("counts that cannot be read in the resume check: not read again after the loop", async () => {
    // Guarded sbx with no JSON result: the resume check's counts throw once; the post-loop block never re-runs them.
    const { v, finish } = await silent([{ ran: true, exit: 1, conformance_failure: MISSING_STATUS_BLOCK }], { tier: "sbx", sandbox: "sb" }, verbs(), memRecorder(),
      { host: () => ({ restored: false }), sbx: async () => {} });
    expect(v.of("account")).toEqual([]);
    expect(flag(finish, "--reason").split("account failed").length - 1).toBe(1);
  });
});

describe("the restart's accounted ids are never counted again", () => {
  test("recordAccounted fails after the restart's account: the resumed iteration still counts only its new message ids", async () => {
    const fx = await orphan();
    writeTranscript(join(cfg, "projects"), SID, ["m1", "m2"]);
    let failed = 0;
    fx.queue.recordAccounted = () => { failed++; throw new Error("database is locked"); };
    const v = verbs();
    const { report, prepared } = await recoverWithResume(fx.queue, B, v.runner, { rebuild: fx.rebuild, transcripts: okTranscripts });
    expect(report.resumed).toHaveLength(1);
    expect(failed).toBe(1);
    expect(fx.queue.accountedIds(fx.run.run_id)).toEqual([]); // the `accounted` event was never written
    expect(v.of("account")[0]).toEqual(["account", "--directory", fx.checkout, "--run-id", STUDIO, "--turns", "2", "--tokens", "30"]);
    expect(prepared.get(fx.run.run_id)!.accountedIds).toEqual(["m1", "m2"]);
    const invoke = (async (_root: string, _skill: string, _args: Record<string, any>, _sp?: unknown, opts: Record<string, any> = {}) => {
      opts.onSpawn?.(process.pid);
      writeFileSync(join(cfg, "projects", "some-slug", `${SID}.jsonl`), ["m1", "m2", "m3"].map(line).join("\n") + "\n");
      return { ran: true, status_block: BLOCK, session_id: SID };
    }) as unknown as typeof invokeSkill;
    await driveResumes(fx.queue, report.resumed, prepared, v.runner, invoke);
    expect(v.of("account")).toHaveLength(2);
    expect(v.of("account")[1]).toEqual(["account", "--directory", fx.checkout, "--run-id", STUDIO, "--turns", "1", "--tokens", "15"]);
    expect(report.resumed[0].summary).toMatchObject({ ok: true, state: "complete" });
  });
});
