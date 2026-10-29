// Story 27.2: the supervisor holds the engine and nothing else starts one — pin, hold, release,
// kill-by-pid, the starter lock and external-run detection, pinned with a fake `sbx` (never a real one).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { cancelRun, claimGate, detectExternal, pinBeforeClaim, driveResumes, ExternalRunRefused, finishRun, mirror, queueRecorder, recoverQueue, watchStarterLocks, type ResumedRun, type Started } from "../src/cli";
import { checkoutKey, Queue, workerMayRun, type Owner, type Probes, type QueueRun, type StudioOps } from "../src/queue";
import {
  holdArgv, holdEngine, killEngine, killRunEngine, lookupEnginePid, pinRecordPath, pinSandbox, pinWithRestart, probeEngine, releasePin, respawnHolds, sandboxHolders,
  STARTER, STARTER_LOCK_REFRESH_MS, starterLockPath, writeStarterLock, writeStarterLocks, type HoldChild, type SandboxDeps,
} from "../src/sandbox";
import { invokeSkill, MISSING_STATUS_BLOCK, runProcess, toVmPath, type RunResult, type Spawner } from "../src/server";
import { shouldWake } from "../src/tick";
import { engineStatus, sweepEngines, type WorktreeDeps } from "../src/worktree";
import { fakeSbx, fakeStudioRoot } from "./fakes";
import { tempDir, track } from "./tmp";

const SB = "claude-p";
const ENGINE = "20261016-101010-ab12";
const LAUNCH = { id: "launch-27", trigger: "one-shot", target: { skill: "tk-studio-launch" }, guards: { max_wall_clock_seconds: 600 } };
const me: Owner = { pid: process.pid, host: hostname(), nonce: "sandbox-test" };

let sbx: ReturnType<typeof fakeSbx>;
let deps: SandboxDeps;
beforeAll(() => {
  sbx = fakeSbx();
  // Story 33.3: the pin record lands in a throwaway store, never the operator's.
  deps = { env: { ...process.env, SBX_BIN: sbx.bin, TK_STUDIO_HOME: tempDir("tk-sup-pin-home-") }, waitMs: 400, pollMs: 50 };
});
afterAll(() => {
  // Every `sbx` call this suite made was argv only: no shell, no `-c` string (AC2).
  for (const c of sbx.calls()) for (const a of c.argv) expect(["bash", "sh", "-c", "-lc"]).not.toContain(a);
});

/** The test queue: owner `me` alive, no launch-core engine, the in-VM engine probe through the fake `sbx`. */
const newQueue = (probes: Partial<Probes> = {}) => new Queue(":memory:", {
  ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }), engineProbe: (sb, pid) => probeEngine(sb, pid, deps), ...probes,
});
/** The restart rule's studio ops, never reached by these runs. */
const noOps: StudioOps = { end: async () => ({ ok: true, detail: "unused" }), find: async () => ({ ok: true, run_id: null }) };
/** The engine-end sweep's deps: git/gh answered ok ("no changes"), the launch status probe answering
 * `status`, the studio verbs ok, `sbx` the fake. */
const sweepWith = (status: "finished" | "paused" | "running"): WorktreeDeps => {
  const run = { status: status === "finished" ? "finished" : "running", ...(status === "paused" ? { paused_stage: "review" } : {}) };
  // Hole 38: an sbx run's engine status is read inside its sandbox, so the fake `sbx` answers it (the host
  // `uv` below answers only what still runs on the host).
  sbx.answer({ ...sbx.answers(), launch_status: { ok: true, runs: [], live: [], run } });
  return {
    env: { ...process.env, TK_STUDIO_ROOT: tempDir("tk-sup-studio-"), SBX_BIN: sbx.bin },
    run: async () => ({ exit: 0, stdout: "", stderr: "" }),
    uv: async () => ({ exit: 0, stderr: "", stdout: JSON.stringify({ ok: true, run }) }),
    verbs: async () => ({ ok: true, state: "complete" }),
    // Story 35.5: the in-VM status probe reads `TK_STUDIO_ROOT` from the sbx deps' env, so it carries it (the repo
    // root, as delivery.test.ts's `deps()`), never inheriting the host's user variable from `process.env`.
    sbx: { ...deps, env: { ...deps.env, TK_STUDIO_ROOT: resolve(import.meta.dir, "..", "..", "..") } },
  };
};
/** The cancel's deps: the studio verbs ok (recorded in `verbCalls`), the graceful stop ok, `sbx` the fake. */
const cancelWith = (verbCalls: string[][] = []): Parameters<typeof cancelRun>[2] => ({
  verbRunner: async (_r, a) => { verbCalls.push(a); return { ok: true }; }, launchStop: async () => ({ ok: true, detail: "stopping" }),
  worktree: { env: { ...process.env, SBX_BIN: sbx.bin }, run: async () => ({ exit: 0, stdout: "", stderr: "" }), sbx: deps },
});
/** Hole 38: the engine-end sweep reads an sbx run's engine status inside its sandbox (`exec <sb> printenv HOME`,
 * then `exec <sb> <home>/.local/bin/uv run …/launch.py status …`). Those two are the probe's, not a step's verb. */
const isStatusProbe = (argv: string[]) => argv[0] === "exec" && argv[2] === "uv" && argv[3] === "run" && /\/launch\.py$/.test(argv[4] ?? "");
/** The fake's calls made while `fn` ran — the sbx verbs the step itself issued (the hole 38 status probe aside;
 * `sbx.calls()` still lists it). */
async function during<T>(fn: () => Promise<T>): Promise<{ out: T; calls: string[][] }> {
  const before = sbx.calls().length;
  const out = await fn();
  return { out, calls: sbx.calls().slice(before).map((c) => c.argv).filter((a) => !isStatusProbe(a)) };
}
/** A worktree with bmad-loop's `engine.pid` for `engine` (absent with `pidLine` null). */
function worktreeWith(pidLine: string | null, engine = ENGINE): string {
  const wt = tempDir("tk-sup-sbx-wt-");
  if (pidLine !== null) {
    mkdirSync(join(wt, ".bmad-loop", "runs", engine), { recursive: true });
    writeFileSync(join(wt, ".bmad-loop", "runs", engine, "engine.pid"), pidLine);
  }
  return wt;
}
/** A claimed sbx launch run with its worktree cut (and pinned unless `pinned: false`). */
async function sbxRun(q: Queue, opts: { pidLine?: string | null; job?: string; sandbox?: string; pinned?: boolean } = {}): Promise<{ run: QueueRun; root: string; wt: string }> {
  const root = tempDir("tk-sup-sbx-checkout-");
  const wt = worktreeWith(opts.pidLine === undefined ? "6509 125610.0" : opts.pidLine);
  const run = q.enqueue({ jobId: opts.job ?? "launch-27", root, projectId: "p27", definition: LAUNCH, owner: me, tier: "sbx", sandbox: opts.sandbox ?? SB }).run;
  expect((await q.claim(run.run_id, me)).claimed).toBe(true);
  q.recordWorktree(run.run_id, wt, { branch: `supervisor/run-${run.run_id}`, base_ref: "main" });
  if (opts.pinned !== false) q.note(run.run_id, "pinned", { sandbox: opts.sandbox ?? SB });
  return { run: q.get(run.run_id)!, root, wt };
}
const launched = (q: Queue, runId: string) => q.markLaunched(runId, ENGINE, { end: { state: "complete", reason: null } });
const fakeHold = () => {
  const spawned: string[][] = [];
  const hold = (_bin: string, args: string[]): HoldChild => { spawned.push(args); return { pid: 424242, done: new Promise(() => { /* held */ }) }; };
  return { spawned, hold };
};
const kinds = (q: Queue, runId: string) => q.events(runId).map((e) => e.kind);
const ok: RunResult = { exit: 0, stdout: "", stderr: "" };
/** git/gh for a close-out with nothing landed: `git log` empty → "no changes", `worktree remove` ok. */
const noChanges: WorktreeDeps["run"] = async () => ok;

// ---------------------------------------------------------------- pin

describe("pin: `sbx run -d --name <sb>` before the preflight's `sbx exec`", () => {
  const LOGGED_IN: RunResult = { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) };
  const BLOCK = { status: "complete", intent: "tk-studio-activate", artifacts: [] };
  const spawnerOf = (calls: string[][]): Spawner => async (_cmd, args) => {
    calls.push(args);
    return args.includes("auth") ? LOGGED_IN : { exit: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(BLOCK) }) };
  };

  test("Pin: the pin runs first, then the preflight and the worker; recorded `pinned` on the run", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q, { pinned: false });
    const rec = queueRecorder(q, run.run_id, deps);
    const spawned: string[][] = [];
    let spawnedAtPin = -1;
    const { out, calls } = await during(() => invokeSkill(tempDir("tk-sup-pin-"), "tk-studio-activate", { tier: "sbx", sandbox: SB }, spawnerOf(spawned), {
      pin: async (sb) => { spawnedAtPin = spawned.length; return rec.pin!(sb); },
    }));
    // Story 33.3: `sbx ls` first (the sandbox is not listed: no probe, no restart), then the pin.
    expect(calls).toEqual([["ls"], ["run", "-d", "--name", SB]]);
    expect(spawnedAtPin).toBe(0); // nothing spawned before the pin
    expect(spawned[0]).toEqual(["exec", SB, "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"]);
    expect(out).toMatchObject({ ran: true, status_block: BLOCK });
    expect(q.events(run.run_id).find((e) => e.kind === "pinned")?.detail).toEqual({ sandbox: SB });
  });

  test("Story 33.2 (ruling D, re-pinned): the drain's pin runs before the claim — a failed pin leaves the run `queued` with one `claim-refused` naming the pin (a repeat pass updates `pass_at`), no preflight, no claim", async () => {
    sbx.answer({ pin: "fail" });
    const q = newQueue();
    const run = q.enqueue({ jobId: "launch-27", root: tempDir("tk-sup-gate-"), projectId: "p27", definition: LAUNCH, tier: "sbx", sandbox: SB }).run;
    const spawned: string[][] = [];
    const gate = () => claimGate(q, run.run_id, { tier: "sbx", sandbox: SB }, { sbx: deps, spawner: spawnerOf(spawned), hygiene: { env: {} } });
    const { out, calls } = await during(gate);
    expect(calls).toEqual([["ls"], ["run", "-d", "--name", SB]]);
    expect(spawned).toEqual([]); // no preflight after a failed pin
    expect(out?.reason).toStartWith(`sbx pin failed: sbx run -d --name ${SB} exited 1`);
    expect(out?.resolves).toContain(`sbx run -d --name ${SB}`);
    const first = q.events(run.run_id).find((e) => e.kind === "claim-refused")!;
    await gate();
    expect(q.get(run.run_id)?.state).toBe("queued");
    expect(kinds(q, run.run_id).filter((k) => k === "claim-refused")).toHaveLength(1);
    expect(kinds(q, run.run_id).filter((k) => k === "pin-failed")).toHaveLength(1); // no flood either
    expect(kinds(q, run.run_id)).not.toContain("claimed");
    const again = q.events(run.run_id).find((e) => e.kind === "claim-refused")!;
    expect(again.seq).toBe(first.seq);
    expect(String(again.detail!.pass_at) >= String(first.detail!.pass_at)).toBe(true);
    expect(q.claimRefusal(run.run_id)?.reason).toBe(out!.reason);
    // The pin comes back: pinned once, the preflight runs, and the claim may proceed.
    sbx.answer({});
    expect(await gate()).toBeNull();
    expect(await gate()).toBeNull();
    expect(kinds(q, run.run_id).filter((k) => k === "pinned")).toHaveLength(1);
    expect(spawned).toEqual([["exec", SB, "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"], ["exec", SB, "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"]]);
  });

  test("Story 33.2: the Max-login preflight refuses → `claim-refused` naming the renewal steps, the run stays `queued`; the host tier names the host login", async () => {
    sbx.answer({});
    const q = newQueue();
    const run = q.enqueue({ jobId: "launch-27", root: tempDir("tk-sup-gate-"), projectId: "p27", definition: LAUNCH, tier: "sbx", sandbox: SB }).run;
    const loggedOut: Spawner = async () => ({ exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: false }) });
    const out = await claimGate(q, run.run_id, { tier: "sbx", sandbox: SB }, { sbx: deps, spawner: loggedOut, hygiene: { env: {} } });
    expect(out).toEqual({ reason: "harness auth: Max login missing or expired (not logged in)", resolves: `renew the sandbox's Max login: sbx run --name ${SB} → /login → /exit; the next drain pass claims the run` });
    expect(q.get(run.run_id)?.state).toBe("queued");
    expect(q.events(run.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ reason: out!.reason, resolves: out!.resolves });
    const host = q.enqueue({ jobId: "host-job", root: tempDir("tk-sup-gate-"), projectId: "p27", definition: LAUNCH }).run;
    const before = sbx.calls().length;
    const h = await claimGate(q, host.run_id, { tier: "host" }, { spawner: loggedOut, hygiene: { env: {} } });
    expect(sbx.calls().length).toBe(before); // the host tier pins nothing
    expect(h?.resolves).toContain("/login");
    expect(h?.resolves).not.toContain("sbx");
  });

  test("Story 33.2: a pin failing pass after pass on the same sandbox records one `pin-failed`, its `error` updated in place to the latest failure", async () => {
    const q = newQueue();
    const run = q.enqueue({ jobId: "launch-27", root: tempDir("tk-sup-gate-"), projectId: "p27", definition: LAUNCH, tier: "sbx", sandbox: SB }).run;
    const failing = (stderr: string): SandboxDeps => ({ ...deps, run: async () => ({ exit: 1, stderr, stdout: "" }) });
    const first = await pinBeforeClaim(q, run.run_id, SB, failing("sandbox busy (pid 101)"));
    const second = await pinBeforeClaim(q, run.run_id, SB, failing("sandbox busy (pid 202)"));
    expect(first).toContain("pid 101");
    expect(second).toContain("pid 202");
    const failed = q.events(run.run_id).filter((e) => e.kind === "pin-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.detail).toEqual({ sandbox: SB, error: second });
  });

  test("Story 33.2: a queued run with no stored sandbox (config supplies it) records it before the pin — a refused preflight twice leaves one `pinned`", async () => {
    sbx.answer({});
    const q = newQueue();
    const run = q.enqueue({ jobId: "launch-27", root: tempDir("tk-sup-gate-"), projectId: "p27", definition: LAUNCH }).run;
    expect(run.sandbox).toBeNull();
    const loggedOut: Spawner = async () => ({ exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: false }) });
    const gate = () => claimGate(q, run.run_id, { tier: "sbx", sandbox: SB }, { sbx: deps, spawner: loggedOut, hygiene: { env: {} } });
    expect((await gate())?.reason).toContain("Max login");
    expect((await gate())?.reason).toContain("Max login");
    expect(kinds(q, run.run_id).filter((k) => k === "pinned")).toHaveLength(1);
    expect(q.get(run.run_id)).toMatchObject({ state: "queued", tier: "sbx", sandbox: SB });
    expect(q.pinOutstanding(SB)).toBe(true);
  });

  test("Pin fails inside a drive (a relaunch's `invokeSkill` pin) → the run ends `blocked` naming the pin; no preflight, no worker", async () => {
    sbx.answer({ pin: "fail" });
    const q = newQueue();
    const { run, wt } = await sbxRun(q, { pinned: false });
    const spawned: string[][] = [];
    const verbs: string[][] = [];
    const s: Started = {
      jobId: "launch-27", root: run.root, projectId: "p27", runId: "launch-27-20261016T101010Z", guardS: 600, jobGuardS: 600, defn: LAUNCH,
      woke: { accepted: true, run_id: "launch-27-20261016T101010Z", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: {} } },
      tier: "sbx", sandbox: SB, workRoot: wt, recorder: queueRecorder(q, run.run_id, deps),
    };
    const summary = await finishRun(s, async (_r, a) => { verbs.push(a); return { ok: true }; },
      (root, skill, args, _sp, opts) => invokeSkill(root, skill, args, spawnerOf(spawned), opts));
    expect(spawned).toEqual([]);
    expect(summary.state).toBe("blocked");
    expect(summary.reason).toStartWith(`sbx pin failed: sbx run -d --name ${SB} exited 1`);
    const finish = verbs.find((v) => v[0] === "finish")!;
    expect(finish[finish.indexOf("--state") + 1]).toBe("blocked");
    expect(kinds(q, run.run_id)).toContain("pin-failed");
    expect(await pinSandbox(SB, deps)).toContain("sbx pin failed");
  });
});

// ---------------------------------------------------------------- Story 33.3: the pin restarts a logged-out sandbox

describe("Story 33.3: the pin restarts a running, logged-out sandbox once", () => {
  const AUTH = ["exec", SB, "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"];
  const GAP = "harness auth: Max login missing or expired (not logged in)";
  /** The preflight's spawner through the fake `sbx` (its `auth` answers), as production's `runProcess` on SBX_BIN. */
  const viaSbx: Spawner = (_cmd, args, o) => runProcess(sbx.bin, args, { timeoutS: o.timeoutS });
  const queuedOn = (q: Queue, job = "launch-27") =>
    q.enqueue({ jobId: job, root: tempDir("tk-sup-restart-"), projectId: "p27", definition: LAUNCH, tier: "sbx", sandbox: SB }).run;
  const gateOf = (q: Queue, runId: string, restarted = new Set<string>()) =>
    claimGate(q, runId, { tier: "sbx", sandbox: SB }, { sbx: deps, spawner: viaSbx, hygiene: { env: {} }, restarted });
  const restarts = (q: Queue, runId: string) => q.events(runId).filter((e) => e.kind === "pin-restart");
  const stops = (calls: string[][]) => calls.filter((c) => c[0] === "stop");

  test("Restart heals: running before the pin, the probe logged out → `sbx stop`, `sbx run -d --name`, a second probe, then the preflight; one `pin-restart {probe_before: gap, probe_after: null}`; the claim may proceed", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out", "in"] });
    const q = newQueue();
    const run = queuedOn(q);
    const { out, calls } = await during(() => gateOf(q, run.run_id));
    expect(out).toBeNull();
    expect(calls).toEqual([["ls"], ["run", "-d", "--name", SB], AUTH, ["stop", SB], ["run", "-d", "--name", SB], AUTH, AUTH]);
    const r = restarts(q, run.run_id);
    expect(r).toHaveLength(1);
    expect(r[0]!.detail).toMatchObject({ sandbox: SB, probe_before: GAP, probe_after: null });
    expect(typeof r[0]!.detail!.pass_at).toBe("string");
    expect(Object.keys(r[0]!.detail!).sort()).toEqual(["pass_at", "probe_after", "probe_before", "sandbox"]);
    expect(kinds(q, run.run_id)).not.toContain("claim-refused");
    expect(kinds(q, run.run_id).filter((k) => k === "pinned")).toHaveLength(1);
  });

  test("Still logged out after the restart: one `pin-restart` with both gaps, the claim refused through 33.2's `max-login` naming the renewal", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue();
    const run = queuedOn(q);
    const out = await gateOf(q, run.run_id);
    expect(out).toEqual({ reason: GAP, resolves: `renew the sandbox's Max login: sbx run --name ${SB} → /login → /exit; the next drain pass claims the run` });
    expect(restarts(q, run.run_id).map((e) => e.detail)).toEqual([expect.objectContaining({ probe_before: GAP, probe_after: GAP })]);
    expect(q.events(run.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: "max-login" });
    expect(q.get(run.run_id)?.state).toBe("queued");
  });

  test("Single restart per pass: two queued runs on one logged-out sandbox in one pass → `sbx stop` once; the second refuses `max-login` with no `pin-restart`", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue();
    const a = queuedOn(q), b = queuedOn(q, "other-job");
    const pass = new Set<string>();
    const { calls } = await during(async () => {
      expect((await gateOf(q, a.run_id, pass))?.reason).toBe(GAP);
      expect((await gateOf(q, b.run_id, pass))?.reason).toBe(GAP);
    });
    expect(stops(calls)).toEqual([["stop", SB]]);
    expect(restarts(q, a.run_id)).toHaveLength(1);
    expect(restarts(q, b.run_id)).toHaveLength(0);
    expect(q.events(b.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: "max-login" });
  });

  test("Same episode, a later pass: the run's open episode already carries a `pin-restart` → no second restart; a new episode (after `claim-refusal-cleared`) may restart again", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue();
    const run = queuedOn(q);
    const { calls } = await during(async () => {
      await gateOf(q, run.run_id); // pass 1: restarts
      await gateOf(q, run.run_id); // pass 2 (its own set): the episode guard holds
    });
    expect(stops(calls)).toHaveLength(1);
    expect(restarts(q, run.run_id)).toHaveLength(1);
    expect(q.events(run.run_id).filter((e) => e.kind === "claim-refused")).toHaveLength(1);
    expect(q.clearClaimRefusals(run.run_id)).toBe(true); // the episode closes
    const again = await during(() => gateOf(q, run.run_id));
    expect(stops(again.calls)).toHaveLength(1);
    expect(restarts(q, run.run_id)).toHaveLength(2);
  });

  test.each(["running", "paused", "external"])("Live holder: another run holds the sandbox `%s` → no restart, no event; the preflight refuses `max-login`", async (state) => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue();
    const holder = await sbxRun(q, { job: "holder-job" });
    expect(holder.run.state).toBe("running");
    if (state !== "running") q.db.run("UPDATE runs SET state = ? WHERE run_id = ?", [state, holder.run.run_id]);
    expect(q.get(holder.run.run_id)!.state).toBe(state);
    const run = queuedOn(q);
    const { out, calls } = await during(() => gateOf(q, run.run_id));
    expect(out?.reason).toBe(GAP);
    expect(stops(calls)).toEqual([]);
    expect(restarts(q, run.run_id)).toHaveLength(0);
    expect(q.events(run.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: "max-login" });
    expect(await sandboxHolders(q, SB, run.run_id, ["running", "paused", "external"])).toEqual([holder.run.run_id]);
  });

  test("Live engine: an ended run on the sandbox whose engine is alive after its kill → no restart, no event; the preflight refuses `max-login`", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue({ engineProbe: async () => ({ alive: true, start: "125610.0" }) });
    const ended = await sbxRun(q, { job: "holder-job" });
    q.note(ended.run.run_id, "engine-kill", { why: "test", sandbox: SB, worker: { pid: 6509, start: "125610.0", outcome: "engine alive after kill" } });
    q.end(ended.run.run_id, "partial", "guard tripped");
    expect(q.get(ended.run.run_id)!.state).toBe("partial");
    const run = queuedOn(q);
    const { out, calls } = await during(() => gateOf(q, run.run_id));
    expect(out?.reason).toBe(GAP);
    expect(stops(calls)).toEqual([]);
    expect(restarts(q, run.run_id)).toHaveLength(0);
    expect(q.events(run.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: "max-login" });
    expect(await sandboxHolders(q, SB, run.run_id, ["running", "paused", "external"])).toEqual([ended.run.run_id]);
  });

  test("A queued holder does not block the restart (the gated run is queued too)", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out", "in"] });
    const q = newQueue();
    queuedOn(q, "other-job");
    const run = queuedOn(q);
    expect(await gateOf(q, run.run_id)).toBeNull();
    expect(restarts(q, run.run_id)).toHaveLength(1);
  });

  test("Stopped before the pin (listed stopped, not listed, `sbx ls` failing) → no probe, no restart, no event; pinned as today", async () => {
    const listings: (Record<string, string> | "fail")[] = [{ [SB]: "stopped" }, { "claude-p-other": "running" }, "fail"];
    for (const ls of listings) {
      sbx.answer({ ls, auth: ["out"] });
      const q = newQueue();
      const run = queuedOn(q);
      const spawned: string[][] = [];
      const loggedIn: Spawner = async (_c, args) => { spawned.push(args); return { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }; };
      const { out, calls } = await during(() => claimGate(q, run.run_id, { tier: "sbx", sandbox: SB }, { sbx: deps, spawner: loggedIn, hygiene: { env: {} } }));
      expect(out).toBeNull();
      expect(calls).toEqual([["ls"], ["run", "-d", "--name", SB]]);
      expect(spawned).toEqual([AUTH]); // the preflight's own probe only
      expect(restarts(q, run.run_id)).toHaveLength(0);
    }
  });

  test("Restart fails: `sbx stop` (or the start) exits non-zero → a pin failure in the pin's words, the same `pin-failed` episode and `pin-failed:<sb>` refusal", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"], stop: "fail" });
    const q = newQueue();
    const run = queuedOn(q);
    const out = await gateOf(q, run.run_id);
    expect(out?.reason).toStartWith(`sbx pin failed: sbx stop ${SB} exited 1`);
    expect(q.events(run.run_id).filter((e) => e.kind === "pin-failed").map((e) => e.detail)).toEqual([{ sandbox: SB, error: out!.reason }]);
    expect(q.events(run.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: `pin-failed:${SB}` });
    expect(restarts(q, run.run_id)).toHaveLength(0);
  });

  test("Restart fails at the start: `sbx stop` succeeds, the restart's `sbx run -d --name` exits non-zero → a pin failure in the pin's words, the same `pin-failed` episode and `pin-failed:<sb>` refusal; the pin record is removed", async () => {
    const path = pinRecordPath(SB, deps.env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sandbox: SB, since: new Date().toISOString(), run_id: "earlier-run", supervisor_pid: process.pid }));
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"], pin: "fail-after-stop" });
    const q = newQueue();
    const run = queuedOn(q);
    const { out, calls } = await during(() => gateOf(q, run.run_id));
    expect(calls).toEqual([["ls"], ["run", "-d", "--name", SB], AUTH, ["stop", SB], ["run", "-d", "--name", SB]]);
    expect(out?.reason).toStartWith(`sbx pin failed: sbx run -d --name ${SB} exited 1`);
    expect(q.events(run.run_id).filter((e) => e.kind === "pin-failed").map((e) => e.detail)).toEqual([{ sandbox: SB, error: out!.reason }]);
    expect(q.events(run.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: `pin-failed:${SB}` });
    expect(restarts(q, run.run_id)).toHaveLength(0);
    expect(existsSync(path)).toBe(false); // left stopped: no pin stands
  });

  test("Cold-pinned in this pass: two queued runs on a sandbox stopped before the first pin that comes up logged out → no `sbx stop`, no `pin-restart`; both refuse `max-login`", async () => {
    sbx.answer({ ls: { [SB]: "stopped" }, auth: ["out"] });
    const q = newQueue();
    const a = queuedOn(q), b = queuedOn(q, "other-job");
    const pass = new Set<string>();
    const { calls } = await during(async () => {
      expect((await gateOf(q, a.run_id, pass))?.reason).toBe(GAP);
      expect((await gateOf(q, b.run_id, pass))?.reason).toBe(GAP);
    });
    expect(stops(calls)).toEqual([]);
    expect(restarts(q, a.run_id)).toHaveLength(0);
    expect(restarts(q, b.run_id)).toHaveLength(0);
    for (const r of [a, b]) expect(q.events(r.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: "max-login" });
  });

  test("The drive's recorder (relaunch/resume) restarts through the same seam once per recorder; still logged out its preflight ends the run `blocked`", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue();
    const { run, wt } = await sbxRun(q, { pinned: false });
    const rec = queueRecorder(q, run.run_id, deps);
    const s: Started = {
      jobId: "launch-27", root: run.root, projectId: "p27", runId: "launch-27-20261016T101010Z", guardS: 600, jobGuardS: 600, defn: LAUNCH,
      woke: { accepted: true, run_id: "launch-27-20261016T101010Z", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: {} } },
      tier: "sbx", sandbox: SB, workRoot: wt, recorder: rec,
    };
    const invoke: Parameters<typeof finishRun>[2] = (r, skill, args, _sp, o) => invokeSkill(r, skill, args, viaSbx, o);
    const { out: summaries, calls } = await during(async () => [ // the relaunch, then the resume: one recorder
      await finishRun(s, async () => ({ ok: true }), invoke),
      await finishRun(s, async () => ({ ok: true }), invoke),
    ]);
    for (const summary of summaries) {
      expect(summary.state).toBe("blocked");
      expect(summary.reason).toBe(`auth preflight: ${GAP}`);
    }
    expect(stops(calls)).toHaveLength(1);
    expect(restarts(q, run.run_id)).toHaveLength(1);
    expect(kinds(q, run.run_id).filter((k) => k === "pinned")).toHaveLength(2); // the recorder's own rule: one per pin
  });

  test("One set per drain pass: a resume `driveResumes` drives restarts the logged-out sandbox and ends `blocked`; a drained run's gate on it in the same pass (the same set) → `sbx stop` once in total", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue();
    const { run: resumedRun, wt } = await sbxRun(q, { pinned: false });
    const s: Started = {
      jobId: "launch-27", root: resumedRun.root, projectId: "p27", runId: "launch-27-20261016T101010Z", guardS: 600, jobGuardS: 600, defn: LAUNCH,
      woke: { accepted: true, run_id: "launch-27-20261016T101010Z", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: {} } },
      tier: "sbx", sandbox: SB, workRoot: wt, recorder: queueRecorder(q, resumedRun.run_id, deps),
    };
    const resumed: ResumedRun[] = [{ run_id: resumedRun.run_id, studio_run_id: "launch-27-20261016T101010Z", resume: 1 }];
    const invoke: Parameters<typeof finishRun>[2] = (r, skill, args, _sp, o) => invokeSkill(r, skill, args, viaSbx, o);
    const drained = queuedOn(q, "other-job");
    const pass = new Set<string>();
    // `driveResumes` builds the resume's recorder with no sbx deps (the process env): point it at the fake and a
    // throwaway store for this test only.
    const prev = { bin: process.env.SBX_BIN, home: process.env.TK_STUDIO_HOME };
    process.env.SBX_BIN = sbx.bin;
    process.env.TK_STUDIO_HOME = deps.env!.TK_STUDIO_HOME;
    let calls: string[][];
    try {
      ({ calls } = await during(async () => {
        await driveResumes(q, resumed, new Map([[resumedRun.run_id, s]]), async () => ({ ok: true }), invoke, deps, pass);
        expect((await gateOf(q, drained.run_id, pass))?.reason).toBe(GAP);
      }));
    } finally {
      if (prev.bin === undefined) delete process.env.SBX_BIN; else process.env.SBX_BIN = prev.bin;
      if (prev.home === undefined) delete process.env.TK_STUDIO_HOME; else process.env.TK_STUDIO_HOME = prev.home;
    }
    expect(pass.has(SB)).toBe(true);
    expect(q.get(resumedRun.run_id)!.state).toBe("blocked");
    expect(stops(calls)).toEqual([["stop", SB]]);
    expect(restarts(q, resumedRun.run_id)).toHaveLength(1);
    expect(restarts(q, drained.run_id)).toHaveLength(0);
    expect(q.events(drained.run_id).find((e) => e.kind === "claim-refused")?.detail).toMatchObject({ key: "max-login" });
  });

  test("Without the pass's set (each resume's recorder its own, as outside a drain): the same resume and gate each restart — the case the shared set closes", async () => {
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out"] });
    const q = newQueue();
    const { run: resumedRun } = await sbxRun(q, { pinned: false });
    expect(await queueRecorder(q, resumedRun.run_id, deps).pin!(SB)).toBeNull(); // its own set
    q.end(resumedRun.run_id, "blocked", "auth preflight: still logged out");
    const drained = queuedOn(q, "other-job");
    const { calls } = await during(() => gateOf(q, drained.run_id));
    expect(stops(calls)).toEqual([["stop", SB]]);
    expect(restarts(q, resumedRun.run_id)).toHaveLength(1);
    expect(restarts(q, drained.run_id)).toHaveLength(1);
  });

  test("Pin record: written on a pin (`{sandbox, since, run_id, supervisor_pid}`), rewritten after a restart, removed when the release stopped the sandbox", async () => {
    const path = pinRecordPath(SB, deps.env);
    rmSync(path, { force: true });
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q, { pinned: false });
    expect(await queueRecorder(q, run.run_id, deps).pin!(SB)).toBeNull();
    const rec = JSON.parse(readFileSync(path, "utf-8"));
    expect(rec).toMatchObject({ sandbox: SB, run_id: run.run_id, supervisor_pid: process.pid });
    expect(Object.keys(rec).sort()).toEqual(["run_id", "sandbox", "since", "supervisor_pid"]);
    // After a restart (another run, its own gate) the record names that run.
    rmSync(path, { force: true });
    sbx.answer({ ls: { [SB]: "running" }, auth: ["out", "in"] });
    const q2 = newQueue();
    const queued = queuedOn(q2);
    expect(await pinWithRestart(q2, queued.run_id, SB, deps)).toBeNull();
    expect(restarts(q2, queued.run_id)).toHaveLength(1);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toMatchObject({ sandbox: SB, run_id: queued.run_id });
    // The release stops the sandbox: the record goes with it.
    sbx.answer({});
    q.end(run.run_id, "complete", null);
    expect(await releasePin(q, run.run_id, deps)).toBe("released");
    expect(existsSync(path)).toBe(false);
  });

  test("Pin record: a failed release (`sbx stop` exits non-zero) keeps it", async () => {
    const path = pinRecordPath(SB, deps.env);
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q, { pinned: false });
    expect(await queueRecorder(q, run.run_id, deps).pin!(SB)).toBeNull();
    sbx.answer({ stop: "fail" });
    q.end(run.run_id, "complete", null);
    expect(await releasePin(q, run.run_id, deps)).toBe("failed");
    expect(existsSync(path)).toBe(true);
  });
});

// ---------------------------------------------------------------- hold + record

describe("hold: the engine pid recorded and one `sbx exec … tail --pid` held for its life", () => {
  test("Hold + record: launch returns with engine.pid `6509 125610.0` → hold spawned; pid, start and sandbox recorded on the run", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    const { spawned, hold } = fakeHold();
    const s = {
      ok: true, job_id: "launch-27", run_id: "launch-27-20261016T101010Z", state: "complete", finish_deferred: true as const,
      status_block: { status: "complete", intent: "tk-studio-launch", artifacts: [`.bmad-loop/runs/${ENGINE}`] },
    };
    await mirror(q, run.run_id, { jobId: "launch-27", defn: LAUNCH }, s, async () => ({ ok: true }), { sbx: { ...deps, hold } });
    const after = q.get(run.run_id)!;
    expect(after).toMatchObject({ state: "running", engine_run_id: ENGINE, engine_pid: 6509, engine_start: "125610.0", sandbox: SB, tier: "sbx" });
    expect(spawned).toEqual([["exec", SB, "tail", "--pid=6509", "-f", "/dev/null"]]);
    expect(q.events(run.run_id).find((e) => e.kind === "engine-pid")?.detail).toMatchObject({ pid: 6509, start: "125610.0", source: "engine.pid", sandbox: SB });
    expect(q.events(run.run_id).find((e) => e.kind === "hold")?.detail).toMatchObject({ sandbox: SB, engine_pid: 6509, pid: 424242, argv: holdArgv(SB, 6509) });
    expect(kinds(q, run.run_id).indexOf("launched")).toBeLessThan(kinds(q, run.run_id).indexOf("hold"));
    // Launch return never releases the pin.
    expect(kinds(q, run.run_id)).not.toContain("pin-released");
  });

  test("the default hold is the supervisor's own argv-only `sbx exec` child (runProcess)", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    launched(q, run.run_id);
    const { calls } = await during(async () => {
      await holdEngine(q, run.run_id, deps);
      await Bun.sleep(400); // the fake's `tail` exits at once
    });
    expect(calls).toEqual([["exec", SB, "tail", "--pid=6509", "-f", "/dev/null"]]);
    expect(typeof (q.events(run.run_id).find((e) => e.kind === "hold")?.detail as Record<string, unknown>).pid).toBe("number");
  });

  test.each([
    ["engine.pid absent, pgrep 0 hits", []],
    ["engine.pid absent, pgrep 2 hits", [`101 bmad-loop run --project /c/w --run-id ${ENGINE}`, `102 bmad-loop run --project /c/w --run-id ${ENGINE}`]],
  ])("Pid unknown (%s) → `engine pid: unknown` recorded, no hold", async (_name, pgrep) => {
    sbx.answer({ pgrep: pgrep as string[] });
    const q = newQueue();
    const { run } = await sbxRun(q, { pidLine: null });
    launched(q, run.run_id);
    const { spawned, hold } = fakeHold();
    const { calls } = await during(() => holdEngine(q, run.run_id, { ...deps, hold }));
    expect(calls).toEqual([["exec", SB, "pgrep", "-a", "-f", "bmad-loop run"]]);
    expect(spawned).toEqual([]);
    expect(q.get(run.run_id)).toMatchObject({ engine_pid: null, engine_start: null });
    expect(q.events(run.run_id).find((e) => e.kind === "engine-pid")?.detail).toMatchObject({ engine_pid: "unknown", sandbox: SB });
    expect(kinds(q, run.run_id)).not.toContain("hold");
  });

  test("the pgrep fallback names the one engine process carrying the run id; its start read from /proc", async () => {
    sbx.answer({ pgrep: [`7001 /usr/bin/python3 bmad-loop run --project /c/w --run-id other-id`, `7002 bmad-loop run --project /c/w --run-id ${ENGINE}`], procs: { 7002: { start: "99000" } } });
    const found = await lookupEnginePid(worktreeWith(null), ENGINE, SB, deps);
    expect(found).toEqual({ pid: 7002, start: "99000", source: "pgrep" });
  });
});

// ---------------------------------------------------------------- release

describe("release: `sbx stop <sb>` at the deferred `ended`, never on paused, never under a second holder", () => {
  const sweepDeps = sweepWith;

  test("Release: the deferred `ended` (engine finished, closed out) with no other run on the sandbox → `sbx stop` once", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    launched(q, run.run_id);
    const before = sbx.calls().length;
    const { calls } = await during(() => sweepEngines(q, sweepDeps("finished")));
    expect(q.get(run.run_id)!.state).toBe("complete");
    expect(calls).toEqual([["stop", SB]]);
    // Hole 38: the engine's status was read inside the sandbox (the host has no bmad-loop), before the stop.
    const probe = sbx.calls().slice(before).map((c) => c.argv).filter(isStatusProbe);
    expect(probe.map((a) => a.slice(0, 4))).toEqual([["exec", SB, "uv", "run"]]);
    expect(probe[0]!.slice(5)).toEqual(["status", "--directory", toVmPath(run.worktree!), "--run-id", ENGINE]);
    expect(kinds(q, run.run_id).slice(-1)).toEqual(["pin-released"]);
    // Released once: a second release finds it done.
    const again = await during(() => releasePin(q, run.run_id, deps));
    expect(again).toEqual({ out: "none", calls: [] });
  });

  test("Story 34.5: a run without the flag — its release records no engine MCP event and stops only the sandbox", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    q.end(run.run_id, "complete", null);
    const { out, calls } = await during(() => releasePin(q, run.run_id, deps));
    expect(out).toBe("released");
    expect(calls).toEqual([["stop", SB]]);
    expect(kinds(q, run.run_id).filter((k) => k.startsWith("engine-mcp"))).toEqual([]);
    // Story 35.4: no `engine_mcp` on the release event of a run that never started one.
    expect(q.events(run.run_id).find((e) => e.kind === "pin-released")?.detail).toEqual({ sandbox: SB, stop: { ok: true } });
  });

  // Story 35.4: the release events say what happened to the run's engine MCP (a recorded start whose pids are gone).
  const recordedMcp = (q: Queue, runId: string) =>
    q.note(runId, "engine-mcp-start", { name: "godot-mcp", pid: 987654, start: "1", url: "u", forwarder_pid: 987655, forwarder_start: "2", port: 50001, forwarder_port: 50002 });

  test("Story 35.4: a run with an `engine-mcp-start` — `pin-released` carries `engine_mcp: \"stopped\"` once its stop is recorded", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    recordedMcp(q, run.run_id);
    q.end(run.run_id, "complete", null);
    expect((await during(() => releasePin(q, run.run_id, deps))).out).toBe("released");
    expect(q.events(run.run_id).find((e) => e.kind === "engine-mcp-stop")?.detail).toMatchObject({ why: "released", port: 50001, forwarder_port: 50002 });
    expect(q.events(run.run_id).find((e) => e.kind === "pin-released")?.detail).toEqual({ sandbox: SB, stop: { ok: true }, engine_mcp: "stopped" });
  });

  test("Story 35.4: a kept pin carries `engine_mcp` too; a stop not recorded yet is `stop pending`", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    const other = await sbxRun(q, { job: "other-job" });
    recordedMcp(q, run.run_id);
    q.end(run.run_id, "complete", null);
    expect((await during(() => releasePin(q, run.run_id, deps))).out).toBe("kept");
    expect(q.events(run.run_id).find((e) => e.kind === "pin-kept")?.detail).toEqual({ sandbox: SB, held_by: [other.run.run_id], engine_mcp: "stopped" });

    // The stop cannot be recorded (the queue refuses the note): left to a later release or recovery.
    const q2 = newQueue();
    const r2 = (await sbxRun(q2)).run;
    recordedMcp(q2, r2.run_id);
    q2.end(r2.run_id, "complete", null);
    const note = q2.note.bind(q2);
    q2.note = (id, kind, detail) => { if (kind === "engine-mcp-stop") throw new Error("database is locked"); note(id, kind, detail); };
    expect((await during(() => releasePin(q2, r2.run_id, deps))).out).toBe("released");
    expect(kinds(q2, r2.run_id)).not.toContain("engine-mcp-stop");
    expect(q2.events(r2.run_id).find((e) => e.kind === "pin-released")?.detail).toEqual({ sandbox: SB, stop: { ok: true }, engine_mcp: "stop pending" });
  });

  test.each(["running", "paused"])("Release, second holder: another %s run records the sandbox → no `sbx stop`", async (state) => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    const other = await sbxRun(q, { job: "other-job" });
    if (state !== "running") q.db.run("UPDATE runs SET state = ? WHERE run_id = ?", [state, other.run.run_id]);
    launched(q, run.run_id);
    const { calls } = await during(() => sweepEngines(q, sweepDeps("finished")));
    expect(q.get(run.run_id)!.state).toBe("complete");
    expect(calls).toEqual([]);
    expect(q.events(run.run_id).find((e) => e.kind === "pin-kept")?.detail).toEqual({ sandbox: SB, held_by: [other.run.run_id] });
  });

  test("Release, second holder: external — a hand-started studio run on the sandbox, recorded by `detectExternal` with its job's placement → no `sbx stop`", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    // A served job on another checkout whose supervisor config places it on the same sbx sandbox.
    const extRoot = tempDir("tk-sup-sbx-ext-placed-");
    q.end(q.enqueue({ jobId: "studio-health", root: extRoot, projectId: "p", definition: { id: "studio-health" } }).run.run_id, "complete", null);
    const cfg = join(tempDir("tk-sup-sbx-cfg-"), "supervisor.yaml");
    writeFileSync(cfg, `jobs:\n  "${basename(extRoot)}/studio-health":\n    tier: sbx\n    sandbox: ${SB}\n`);
    const sid = "studio-health-20261016T111111Z";
    const prev = process.env.TK_SUPERVISOR_CONFIG;
    process.env.TK_SUPERVISOR_CONFIG = cfg;
    let found: Awaited<ReturnType<typeof detectExternal>>;
    try { found = await detectExternal(q, async (_r, a) => (a[0] === "status" ? { ok: true, runs: [{ run_id: sid, state: "running" }] } : { ok: true })); }
    finally { if (prev === undefined) delete process.env.TK_SUPERVISOR_CONFIG; else process.env.TK_SUPERVISOR_CONFIG = prev; }
    expect(found.recorded).toHaveLength(1);
    const ext = q.get(found.recorded[0])!;
    expect(ext).toMatchObject({ state: "external", studio_run_id: sid, tier: "sbx", sandbox: SB });
    expect(q.events(ext.run_id)[0]!.detail).toMatchObject({ studio_run_id: sid, tier: "sbx", sandbox: SB });
    launched(q, run.run_id);
    const { calls } = await during(() => sweepEngines(q, sweepWith("finished")));
    expect(q.get(run.run_id)!.state).toBe("complete");
    expect(calls).toEqual([]);
    expect(q.events(run.run_id).find((e) => e.kind === "pin-kept")?.detail).toEqual({ sandbox: SB, held_by: [ext.run_id] });
  });

  test("a job its config places on the host tier is recorded external with no sandbox (never a holder of one)", async () => {
    const q = newQueue();
    const root = tempDir("tk-sup-sbx-ext-host-");
    q.end(q.enqueue({ jobId: "studio-health", root, projectId: "p", definition: { id: "studio-health" } }).run.run_id, "complete", null);
    const [id] = (await detectExternal(q, async () => ({ ok: true, runs: [{ run_id: "studio-health-20261016T121212Z", state: "running" }] }))).recorded;
    expect(q.get(id!)).toMatchObject({ state: "external", tier: "host", sandbox: null });
  });

  test("Release, last holder never pinned: A ends while B is queued on the sandbox (`pin-kept`); B cancelled before its claim → exactly one `sbx stop`", async () => {
    sbx.answer({});
    const q = newQueue();
    const a = await sbxRun(q);
    const b = q.enqueue({ jobId: "other-job", root: tempDir("tk-sup-sbx-b-"), projectId: "p27", definition: LAUNCH, tier: "sbx", sandbox: SB }).run;
    const { calls } = await during(async () => {
      q.end(a.run.run_id, "complete", null);
      expect(await releasePin(q, a.run.run_id, deps)).toBe("kept");
      expect((await cancelRun(q, b.run_id, cancelWith())).state).toBe("cancelled");
      // Nothing outstanding any more: a later release of either stops nothing.
      expect(await releasePin(q, a.run.run_id, deps)).toBe("none");
      expect(await releasePin(q, b.run_id, deps)).toBe("none");
    });
    expect(calls).toEqual([["stop", SB]]);
    expect(q.events(a.run.run_id).find((e) => e.kind === "pin-kept")?.detail).toEqual({ sandbox: SB, held_by: [b.run_id] });
    expect(kinds(q, b.run_id)).not.toContain("pinned");
    expect(q.events(b.run_id).find((e) => e.kind === "pin-released")?.detail).toEqual({ sandbox: SB, stop: { ok: true } });
  });

  test("Release, last holder external: A ends `pin-kept` because external E records the sandbox; E's studio run ends → `detectExternal` ends E and `sbx stop` once", async () => {
    sbx.answer({});
    const q = newQueue();
    const a = await sbxRun(q);
    const extRoot = tempDir("tk-sup-sbx-ext-last-");
    q.end(q.enqueue({ jobId: "studio-health", root: extRoot, projectId: "p", definition: { id: "studio-health" } }).run.run_id, "complete", null);
    const sid = "studio-health-20261016T131313Z";
    let state = "running";
    const statusCalls: string[][] = [];
    const verbs = async (_r: string, args: string[]) => {
      if (args[0] !== "status") return { ok: true };
      statusCalls.push(args);
      return { ok: true, runs: [{ run_id: sid, state }] };
    };
    const onSandbox = () => ({ tier: "sbx", sandbox: SB });
    const [ext] = (await detectExternal(q, verbs, onSandbox, deps)).recorded;
    expect(q.get(ext!)).toMatchObject({ state: "external", sandbox: SB });
    const { calls } = await during(async () => {
      q.end(a.run.run_id, "complete", null);
      expect(await releasePin(q, a.run.run_id, deps)).toBe("kept");
      state = "complete";
      expect((await detectExternal(q, verbs, onSandbox, deps)).ended).toEqual([ext!]);
      expect(await releasePin(q, ext!, deps)).toBe("none"); // released once
    });
    expect(calls).toEqual([["stop", SB]]);
    expect(q.get(ext!)!.state).toBe("complete");
    expect(q.events(a.run.run_id).find((e) => e.kind === "pin-kept")?.detail).toEqual({ sandbox: SB, held_by: [ext] });
    expect(q.events(ext!).find((e) => e.kind === "pin-released")?.detail).toEqual({ sandbox: SB, stop: { ok: true } });
    // The external run's own status lookup lists the job's runs (no `--run-id`): absence is read from the list.
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(statusCalls.some((c) => c.includes("--run-id"))).toBe(false);
  });

  test("Release, last holder a resume that cannot be driven: its `blocked` end in `driveResumes` stops the pin A left kept, once", async () => {
    sbx.answer({});
    const q = newQueue();
    const a = await sbxRun(q);
    const b = await sbxRun(q, { job: "other-job", pinned: false });
    const resumed: ResumedRun[] = [{ run_id: b.run.run_id, studio_run_id: "other-job-20261016T141414Z", resume: 1 }];
    const { calls } = await during(async () => {
      q.end(a.run.run_id, "complete", null);
      expect(await releasePin(q, a.run.run_id, deps)).toBe("kept");
      await driveResumes(q, resumed, new Map(), async () => ({ ok: true }), invokeSkill, deps);
    });
    expect(resumed[0]!.error).toBe("resume: no rebuilt run to drive");
    expect(q.get(b.run.run_id)!.state).toBe("blocked");
    expect(calls).toEqual([["stop", SB]]);
    expect(q.events(b.run.run_id).find((e) => e.kind === "pin-released")?.detail).toEqual({ sandbox: SB, stop: { ok: true } });
  });

  test("Release, last holder ended on `pin-failed`: the pin A left kept is stopped once", async () => {
    sbx.answer({});
    const q = newQueue();
    const a = await sbxRun(q);
    const b = await sbxRun(q, { job: "other-job", pinned: false });
    const { calls } = await during(async () => {
      q.end(a.run.run_id, "complete", null);
      expect(await releasePin(q, a.run.run_id, deps)).toBe("kept");
      q.note(b.run.run_id, "pin-failed", { sandbox: SB, error: "sbx pin failed" });
      q.end(b.run.run_id, "blocked", "sbx pin failed");
      expect(await releasePin(q, b.run.run_id, deps)).toBe("released");
    });
    expect(calls).toEqual([["stop", SB]]);
  });

  test("no pin outstanding on the sandbox (nobody pinned it) → an ending run that never pinned stops nothing", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q, { pinned: false });
    q.end(run.run_id, "complete", null);
    expect(await during(() => releasePin(q, run.run_id, deps))).toEqual({ out: "none", calls: [] });
  });

  test("Paused: the engine paused → the run is paused, its pin, worktree and lock kept, no `sbx stop`", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run, root, wt } = await sbxRun(q);
    launched(q, run.run_id);
    const { calls } = await during(() => sweepEngines(q, sweepDeps("paused")));
    expect(q.get(run.run_id)!.state).toBe("paused");
    expect(calls).toEqual([]);
    expect(kinds(q, run.run_id)).not.toContain("pin-released");
    expect(existsSync(wt)).toBe(true);
    expect(q.lock(root)).toMatchObject({ kind: "engine", run_id: run.run_id });
    expect(await releasePin(q, run.run_id, deps)).toBe("none"); // a paused run is never released
  });

  test("a non-terminal (running) run that pinned is never released by `releasePin` → no `sbx stop`", async () => {
    sbx.answer({});
    const q = newQueue();
    const { run } = await sbxRun(q);
    launched(q, run.run_id);
    expect(q.get(run.run_id)!.state).toBe("running");
    const { out, calls } = await during(() => releasePin(q, run.run_id, deps));
    expect(out).toBe("none");
    expect(calls).toEqual([]);
    expect(kinds(q, run.run_id)).not.toContain("pin-released");
  });
});

// ---------------------------------------------------------------- kill by pid

describe("kill-by-pid: TERM the engine's process group, wait, KILL; probed through `/proc/<pid>/stat`", () => {
  const cancelDeps = () => cancelWith();

  test("Kill dies (cancel, pid live): TERM `-pid`, the leader gone → KILL still sent once to its group, `engine-kill` killed; the run closed out and released", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "TERM" } } });
    const q = newQueue();
    const { run, root } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    const { out, calls } = await during(() => cancelRun(q, run.run_id, cancelDeps()));
    expect(out.state).toBe("cancelled");
    expect(calls.filter((c) => c[2] === "kill")).toEqual([["exec", SB, "kill", "-TERM", "--", "-6509"], ["exec", SB, "kill", "-KILL", "--", "-6509"]]);
    expect(calls.at(-1)).toEqual(["stop", SB]);
    const kill = q.events(run.run_id).find((e) => e.kind === "engine-kill")!.detail as Record<string, any>;
    expect(kill).toMatchObject({ why: "cancel", sandbox: SB, worker: { pid: 6509, outcome: "killed" } });
    expect((q.events(run.run_id).find((e) => e.kind === "ended")!.detail as Record<string, any>).engine_kill).toMatchObject({ outcome: "killed" });
    expect(q.lock(root)).toBeNull();
  });

  test("Kill, the leader dies on TERM: its group still gets `kill -KILL -- -<pid>` once (members ignoring TERM never survive); `killed`, argv only", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "TERM" } } });
    const { out, calls } = await during(() => killEngine(SB, 6509, "125610.0", deps));
    expect(out).toMatchObject({ pid: 6509, outcome: "killed" });
    expect(calls.filter((c) => c[2] === "kill")).toEqual([["exec", SB, "kill", "-TERM", "--", "-6509"], ["exec", SB, "kill", "-KILL", "--", "-6509"]]);
    // The group KILL after the leader went answers "no such process" (exit 1): expected, named in the detail.
    expect(out.detail).toContain("TERM, KILL to the group after its leader exited (exit 1:");
    for (const c of calls) for (const a of c) expect(["bash", "sh", "-c", "-lc"]).not.toContain(a);
  });

  test("Kill dies after KILL: TERM ignored, the bounded wait, then KILL", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "KILL" } } });
    const { out, calls } = await during(() => killEngine(SB, 6509, "125610.0", deps));
    expect(out).toMatchObject({ outcome: "killed" });
    expect(calls.filter((c) => c[2] === "kill")).toEqual([["exec", SB, "kill", "-TERM", "--", "-6509"], ["exec", SB, "kill", "-KILL", "--", "-6509"]]);
    expect(calls.every((c) => c[2] === "kill" || (c[2] === "cat" && c[3] === "/proc/6509/stat"))).toBe(true);
  });

  test("a reused pid (start time differs) or a dead one is never signalled", async () => {
    sbx.answer({ procs: { 6509: { start: "777" } } });
    const reused = await during(() => killEngine(SB, 6509, "125610.0", deps));
    expect(reused.out).toMatchObject({ outcome: "start time differs" });
    sbx.answer({});
    const dead = await during(() => killEngine(SB, 6509, "125610.0", deps));
    expect(dead.out).toMatchObject({ outcome: "not running" });
    expect([...reused.calls, ...dead.calls].some((c) => c[2] === "kill")).toBe(false);
  });

  test("Kill stays alive (cancel): `/proc/<pid>/stat` still matches after the wait → `engine alive after kill`; the run and its lock held (DW-3)", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    const q = newQueue();
    const { run, root, wt } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    const { out, calls } = await during(() => cancelRun(q, run.run_id, cancelDeps()));
    expect(out.state).toBe("cancelled");
    const kill = (q.events(run.run_id).find((e) => e.kind === "engine-kill")!.detail as Record<string, any>).worker;
    expect(kill).toMatchObject({ pid: 6509, outcome: "engine alive after kill" });
    expect(workerMayRun(kill)).toBe(true);
    const ended = q.events(run.run_id).find((e) => e.kind === "ended")!.detail as Record<string, any>;
    expect(ended.closeout).toMatchObject({ result: "skipped", worktree: "kept" });
    expect(existsSync(wt)).toBe(true);
    expect(q.lock(root)).toMatchObject({ kind: "engine", run_id: run.run_id }); // the lock is held
    expect(calls).not.toContainEqual(["stop", SB]); // and the pin
  });

  test("a tripped guard (the in-VM 124 at the guard) kills by the pid the worktree's engine.pid names; still alive → `hold_lock`", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    const q = newQueue();
    const { run, wt } = await sbxRun(q);
    const s: Started = {
      jobId: "launch-27", root: run.root, projectId: "p27", runId: "launch-27-20261016T101010Z", guardS: 600, jobGuardS: 600, defn: LAUNCH,
      woke: { accepted: true, run_id: "launch-27-20261016T101010Z", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: {} } },
      tier: "sbx", sandbox: SB, workRoot: wt, recorder: queueRecorder(q, run.run_id, deps),
    };
    const { out: summary, calls } = await during(() => finishRun(s, async () => ({ ok: true }),
      async () => ({ ran: true, exit: 124, worker_elapsed_s: 600, conformance_failure: MISSING_STATUS_BLOCK })));
    expect(summary).toMatchObject({ state: "partial", guards_tripped: [{ guard: "max_wall_clock_seconds", value: 600 }], engine_kill: { pid: 6509, outcome: "engine alive after kill" } });
    expect(summary.hold_lock).toContain("engine may still run in the VM");
    expect(calls).toContainEqual(["exec", SB, "kill", "-TERM", "--", "-6509"]);
    expect(q.events(run.run_id).find((e) => e.kind === "engine-kill")?.detail).toMatchObject({ why: "guard: max_wall_clock_seconds (600s)" });
    // A trip before the launch returned: no engine run id is known, so no agent session is killed.
    expect(calls.some((c) => c[2] === "tmux")).toBe(false);
  });

  test("no pid known → nothing killed (never a guessed pid)", async () => {
    sbx.answer({ procs: { 6509: { start: "125610" } } });
    const q = newQueue();
    const { run } = await sbxRun(q, { pidLine: null });
    const { out, calls } = await during(() => killRunEngine(q, run.run_id, "cancel", deps));
    expect(out).toBeUndefined();
    expect(calls.some((c) => c[2] === "kill")).toBe(false);
    expect(q.events(run.run_id).find((e) => e.kind === "engine-pid")?.detail).toMatchObject({ engine_pid: "unknown" });
  });

  const SESSION = ["exec", SB, "tmux", "kill-session", "-t", `=bmad-loop-${ENGINE}`];
  const signalled = (calls: string[][]) => calls.filter((c) => c[2] === "kill" || c[2] === "tmux");

  test("Agent session: the leader survived TERM (KILL sent to it live), engine run id known → `tmux kill-session -t =bmad-loop-<id>` after the KILL, in the kill's detail", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "KILL" } }, sessions: [`bmad-loop-${ENGINE}`] });
    const { out, calls } = await during(() => killEngine(SB, 6509, "125610.0", deps, ENGINE));
    expect(out).toMatchObject({ pid: 6509, outcome: "killed" });
    expect(signalled(calls)).toEqual([["exec", SB, "kill", "-TERM", "--", "-6509"], ["exec", SB, "kill", "-KILL", "--", "-6509"], SESSION]);
    expect(out.detail).toContain(`agent session bmad-loop-${ENGINE} killed`);
    expect(sbx.answers().sessions).toEqual([]);
  });

  test("Agent session, best effort: no such session (exit 1) is recorded in the detail, never an error; an engine alive after its kill gets it too", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    const { out, calls } = await during(() => killEngine(SB, 6509, "125610.0", deps, ENGINE));
    expect(out).toMatchObject({ outcome: "engine alive after kill" });
    expect(signalled(calls).at(-1)).toEqual(SESSION);
    expect(out.detail).toContain(`agent session bmad-loop-${ENGINE}: exit 1: can't find session`);
  });

  test("Agent session: none when the leader went on TERM (its own teardown ran), nor when no engine run id is known", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "TERM" } }, sessions: [`bmad-loop-${ENGINE}`] });
    const onTerm = await during(() => killEngine(SB, 6509, "125610.0", deps, ENGINE));
    expect(onTerm.out).toMatchObject({ outcome: "killed" });
    expect(onTerm.calls.some((c) => c[2] === "tmux")).toBe(false);
    // A pre-launch trip: the run records no engine run id and none is given.
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "KILL" } }, sessions: [`bmad-loop-${ENGINE}`] });
    const q = newQueue();
    const { run } = await sbxRun(q);
    const noId = await during(() => killRunEngine(q, run.run_id, "guard: max_wall_clock_seconds (600s)", deps));
    expect(noId.out).toMatchObject({ outcome: "killed" });
    expect(noId.calls.some((c) => c[2] === "tmux")).toBe(false);
    expect(sbx.answers().sessions).toEqual([`bmad-loop-${ENGINE}`]);
  });

  test("Agent session on cancel: the launched run's engine run id is used", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "KILL" } }, sessions: [`bmad-loop-${ENGINE}`] });
    const q = newQueue();
    const { run } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    const { calls } = await during(() => cancelRun(q, run.run_id, cancelWith()));
    expect(signalled(calls)).toEqual([["exec", SB, "kill", "-TERM", "--", "-6509"], ["exec", SB, "kill", "-KILL", "--", "-6509"], SESSION]);
    const kill = (q.events(run.run_id).find((e) => e.kind === "engine-kill")!.detail as Record<string, any>).worker;
    expect(kill.detail).toContain(`agent session bmad-loop-${ENGINE} killed`);
  });
});

// ---------------------------------------------------------------- DW-3: an engine alive after its kill

describe("DW-3: an engine still alive after its kill holds the run, its lock and the pin until a probe shows it gone", () => {
  test("trip: past the in-VM deadline the kept lock is still held (no release, no close-out, no `sbx stop`) while the pid runs; freed once it is gone", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    let clock = Date.now();
    const q = newQueue({ now: () => clock });
    const { run, root, wt } = await sbxRun(q);
    const s: Started = {
      jobId: "launch-27", root: run.root, projectId: "p27", runId: "launch-27-20261016T101010Z", guardS: 600, jobGuardS: 600, defn: LAUNCH,
      woke: { accepted: true, run_id: "launch-27-20261016T101010Z", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: {} } },
      tier: "sbx", sandbox: SB, workRoot: wt, recorder: queueRecorder(q, run.run_id, deps),
    };
    // The worker is recorded at its spawn (the host `sbx exec`), then the in-VM 124 at the guard.
    const summary = await finishRun(s, async () => ({ ok: true }), async (_r, _sk, _a, _sp, opts) => {
      opts?.onSpawn?.(2 ** 22 + 17);
      return { ran: true, exit: 124, worker_elapsed_s: 600, conformance_failure: MISSING_STATUS_BLOCK };
    });
    expect(summary.engine_kill).toMatchObject({ pid: 6509, outcome: "engine alive after kill" });
    const wdeps = sweepWith("finished");
    await mirror(q, run.run_id, { jobId: "launch-27", defn: LAUNCH }, summary, async () => ({ ok: true }), wdeps);
    expect(q.get(run.run_id)!.state).toBe("partial");
    expect(q.lock(root)).toMatchObject({ kind: "run", run_id: run.run_id });
    clock += 10 * 86_400_000; // long past the in-VM deadline the lock was recorded `until`

    const alive = await during(async () => {
      const rep = await q.recover(noOps, me);
      expect(rep.held?.map((h) => [h.run_id, h.worker.outcome])).toEqual([[run.run_id, "engine alive after kill"]]);
      expect(rep.released ?? []).toEqual([]);
      // Asked by another process (the driver that kept the lock is done): only the engine blocks it.
      expect(await q.closeOutBlocker(q.get(run.run_id)!, { ...me, nonce: "a-later-sweep" })).toContain("engine alive after kill");
      expect(await sweepEngines(q, wdeps)).toEqual([]);
    });
    expect(alive.calls).toContainEqual(["exec", SB, "cat", "/proc/6509/stat"]);
    expect(alive.calls).not.toContainEqual(["stop", SB]);
    expect(q.lock(root)).toMatchObject({ kind: "run", run_id: run.run_id });
    expect(existsSync(wt)).toBe(true);
    expect(kinds(q, run.run_id)).not.toContain("closed_out");

    sbx.answer({}); // the engine pid is gone
    const gone = await during(async () => {
      const rep = await q.recover(noOps, me);
      expect(rep.released?.map((r) => r.run_id)).toEqual([run.run_id]);
      expect(await sweepEngines(q, wdeps)).toEqual([run.run_id]);
    });
    expect(q.lock(root)).toBeNull();
    expect(q.events(run.run_id).find((e) => e.kind === "engine-gone")?.detail).toMatchObject({ sandbox: SB, pid: 6509, probe: "not running" });
    expect(kinds(q, run.run_id)).toContain("closed_out");
    expect(gone.calls.filter((c) => c[0] === "stop")).toEqual([["stop", SB]]);
  });

  test("cancel: the late close-out, the claim and the release wait while the pid runs; once it is gone, closed out and `sbx stop` once", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    const q = newQueue();
    const { run, root, wt } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    expect((await cancelRun(q, run.run_id, cancelWith())).state).toBe("cancelled");
    const next = q.enqueue({ jobId: "next-job", root, projectId: "p27", definition: { id: "next-job" } }).run;
    const wdeps = sweepWith("finished");

    const alive = await during(async () => {
      expect(await sweepEngines(q, wdeps)).toEqual([]);
      expect(await q.closeOutBlocker(q.get(run.run_id)!, me)).toContain("engine alive after kill");
      expect(await releasePin(q, run.run_id, deps)).toBe("kept");
      const claim = await q.claim(next.run_id, me);
      expect(claim).toMatchObject({ claimed: false, why: "lock", reason: expect.stringContaining("alive after its kill") });
    });
    expect(alive.calls).not.toContainEqual(["stop", SB]);
    expect(existsSync(wt)).toBe(true);
    expect(q.lock(root)).toMatchObject({ kind: "engine", run_id: run.run_id });

    sbx.answer({});
    const gone = await during(async () => { expect(await sweepEngines(q, wdeps)).toEqual([run.run_id]); });
    expect(gone.calls.filter((c) => c[0] === "stop")).toEqual([["stop", SB]]);
    expect(kinds(q, run.run_id)).toContain("engine-gone");
    expect(kinds(q, run.run_id)).toContain("closed_out");
    expect((await q.claim(next.run_id, me)).claimed).toBe(true);
  });

  test("an unreadable first probe (`start time unreadable`, nothing signalled) holds the run, its lock and the pin like an engine alive after its kill; released only once a later probe shows the pid gone", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    // `cat /proc/<pid>/stat` cannot be read while `unreadable` (the sandbox daemon unreachable); every other call is the fake's.
    let unreadable = true;
    const flaky: SandboxDeps = {
      ...deps,
      run: async (b, a, o) => unreadable && a[2] === "cat"
        ? { exit: 1, stdout: "", stderr: "sbx: the sandbox daemon is not reachable" } : runProcess(b, a, { timeoutS: o.timeoutS }),
    };
    const q = newQueue({ engineProbe: (sb, pid) => probeEngine(sb, pid, flaky) });
    const { run, root, wt } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    const cancel = cancelWith()!;
    const cancelled = await during(() => cancelRun(q, run.run_id, { ...cancel, worktree: { ...cancel.worktree!, sbx: flaky } }));
    expect(cancelled.out.state).toBe("cancelled");
    expect(cancelled.calls.some((c) => c[2] === "kill")).toBe(false); // never signalled
    const kill = (q.events(run.run_id).find((e) => e.kind === "engine-kill")!.detail as Record<string, any>).worker;
    expect(kill).toMatchObject({ pid: 6509, start: "125610.0", outcome: "start time unreadable" });
    expect((q.events(run.run_id).find((e) => e.kind === "ended")!.detail as Record<string, any>).closeout).toMatchObject({ result: "skipped", worktree: "kept" });
    const next = q.enqueue({ jobId: "next-job", root, projectId: "p27", definition: { id: "next-job" } }).run;
    const wdeps: WorktreeDeps = { ...sweepWith("finished"), sbx: flaky };

    // Still unreadable, then readable and alive as recorded: held either way (fail closed), with no deadline.
    for (const step of ["unreadable", "alive"] as const) {
      unreadable = step === "unreadable";
      const held = await during(async () => {
        expect(await sweepEngines(q, wdeps)).toEqual([]);
        expect(await q.closeOutBlocker(q.get(run.run_id)!, me)).toContain("start time unreadable");
        expect(await releasePin(q, run.run_id, flaky)).toBe("kept");
        expect(await q.claim(next.run_id, me)).toMatchObject({ claimed: false, why: "lock", reason: expect.stringContaining("alive after its kill") });
      });
      expect(held.calls).not.toContainEqual(["stop", SB]);
      expect(existsSync(wt)).toBe(true);
      expect(q.lock(root)).toMatchObject({ kind: "engine", run_id: run.run_id });
      expect(kinds(q, run.run_id)).not.toContain("engine-gone");
    }

    sbx.answer({}); // the engine pid is gone
    const gone = await during(async () => { expect(await sweepEngines(q, wdeps)).toEqual([run.run_id]); });
    expect(gone.calls.filter((c) => c[0] === "stop")).toEqual([["stop", SB]]);
    expect(q.events(run.run_id).find((e) => e.kind === "engine-gone")?.detail).toMatchObject({ sandbox: SB, pid: 6509, probe: "not running" });
    expect(kinds(q, run.run_id)).toContain("closed_out");
    expect((await q.claim(next.run_id, me)).claimed).toBe(true);
  });
});

// ---------------------------------------------------------------- a trip at launch return whose engine was killed

describe("a guard trip at launch return whose engine the supervisor killed: the run reaches its end and close-out", () => {
  test("Trip killed: a turn guard trips at launch return, the engine ignores TERM and dies on KILL (its status stays in-progress) → the sweep ends the run with the trip's state and reason, closes it out, releases the pin", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "KILL" } }, sessions: [`bmad-loop-${ENGINE}`] });
    const q = newQueue();
    const { run, root, wt } = await sbxRun(q);
    const defn = { ...LAUNCH, guards: { max_wall_clock_seconds: 600, max_turns: 5 } };
    const studioRun = "launch-27-20261016T101010Z";
    const verbCalls: string[][] = [];
    const verbs = async (_r: string, a: string[]) => {
      verbCalls.push(a);
      return a[0] === "account" ? { ok: true, within_budget: false, exceeded: ["max_turns"] } : { ok: true, state: "partial" };
    };
    const s: Started = {
      jobId: "launch-27", root: run.root, projectId: "p27", runId: studioRun, guardS: 600, jobGuardS: 600, defn,
      woke: { accepted: true, run_id: studioRun, state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: {} } },
      tier: "sbx", sandbox: SB, workRoot: wt, recorder: queueRecorder(q, run.run_id, deps),
    };
    const block = { status: "complete", intent: "tk-studio-launch", artifacts: [`.bmad-loop/runs/${ENGINE}`] };
    const summary = await finishRun(s, verbs, async () => ({ ran: true, exit: 0, status_block: block, num_turns: 9, usage: { input_tokens: 100, output_tokens: 50 } }));
    expect(summary).toMatchObject({ state: "partial", finish_deferred: true, engine_kill: { pid: 6509, outcome: "killed" } });
    expect(summary.hold_lock).toBeUndefined();
    expect(summary.reason).toContain("max_turns");
    const wdeps: WorktreeDeps = { ...sweepWith("running"), verbs: verbs as WorktreeDeps["verbs"] };
    await mirror(q, run.run_id, { jobId: "launch-27", defn }, summary, verbs, wdeps);
    expect(q.get(run.run_id)!.state).toBe("running"); // launched: waiting on an engine end that will never be written
    expect(sbx.answers().procs).toEqual({}); // the engine is gone, its `launch.py status` still in-progress

    const swept = await during(() => sweepEngines(q, wdeps));
    expect(swept.out).toEqual([run.run_id]);
    const ended = q.get(run.run_id)!;
    expect(ended.state).toBe("partial");
    expect(ended.reason).toBe(summary.reason!);
    const endEv = q.events(run.run_id).find((e) => e.kind === "ended")!.detail as Record<string, any>;
    expect(endEv.engine).toMatchObject({ run_id: ENGINE, killed: { pid: 6509, by: "engine-kill", outcome: "killed" } });
    expect(endEv.closeout).toBeDefined();
    // The deferred studio `finish` carries the trip's state and guard reason.
    const finish = verbCalls.find((a) => a[0] === "finish")!;
    expect(finish.slice(finish.indexOf("--state"), finish.indexOf("--state") + 2)).toEqual(["--state", "partial"]);
    expect(finish[finish.indexOf("--reason") + 1]).toBe(summary.reason!);
    expect(q.lock(root)).toBeNull();
    expect(swept.calls.filter((c) => c[0] === "stop")).toEqual([["stop", SB]]); // the last holder: its pin released
    // A later sweep finds nothing left to do.
    expect(await sweepEngines(q, wdeps)).toEqual([]);
  });

  test("an engine whose recorded kill left it alive is still waited for while its status answers in-progress", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    const q = newQueue();
    const { run } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    q.note(run.run_id, "engine-kill", { why: "test", sandbox: SB, worker: { pid: 6509, start: "125610.0", outcome: "engine alive after kill" } });
    expect(await sweepEngines(q, sweepWith("running"))).toEqual([]);
    expect(q.get(run.run_id)!.state).toBe("running");
  });

  /** The sweep's deps with the engine's `launch.py status` probe failing (no JSON, a non-zero exit): `engineStatus` answers `unknown`. */
  const sweepUnknown = (verbCalls: string[][] = []): WorktreeDeps => ({
    ...sweepWith("running"),
    uv: async () => ({ exit: 1, stdout: "", stderr: "launch.py: the status could not be read" }),
    verbs: async (_r: string, a: string[]) => { verbCalls.push(a); return { ok: true, state: "partial" }; },
  });

  test("an engine killed by the supervisor (`killed`, pid and start matched) whose status probe fails (`unknown`) → the sweep ends the run with the trip's state and reason, closes it out, releases the lock and `sbx stop` once", async () => {
    sbx.answer({ sessions: [`bmad-loop-${ENGINE}`] }); // the engine pid is gone
    const q = newQueue();
    const { run, root } = await sbxRun(q);
    const reason = "guard tripped: max_turns exceeded";
    q.setStudioRun(run.run_id, "launch-27-20261016T101010Z");
    q.markLaunched(run.run_id, ENGINE, { end: { state: "partial", reason } });
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    q.note(run.run_id, "engine-kill", { why: "test", sandbox: SB, worker: { pid: 6509, start: "125610.0", outcome: "killed" } });
    const verbCalls: string[][] = [];
    const wdeps = sweepUnknown(verbCalls);
    expect(await engineStatus(q.get(run.run_id)!.worktree!, ENGINE, wdeps)).toMatchObject({ phase: "unknown" });

    const swept = await during(() => sweepEngines(q, wdeps));
    expect(swept.out).toEqual([run.run_id]);
    const ended = q.get(run.run_id)!;
    expect(ended.state).toBe("partial");
    expect(ended.reason).toBe(reason);
    const endEv = q.events(run.run_id).find((e) => e.kind === "ended")!.detail as Record<string, any>;
    expect(endEv.engine).toMatchObject({ run_id: ENGINE, killed: { pid: 6509, by: "engine-kill", outcome: "killed" } });
    expect(endEv.closeout).toBeDefined();
    const finish = verbCalls.find((a) => a[0] === "finish")!;
    expect(finish[finish.indexOf("--run-id") + 1]).toBe("launch-27-20261016T101010Z");
    expect(finish[finish.indexOf("--state") + 1]).toBe("partial");
    expect(finish[finish.indexOf("--reason") + 1]).toBe(reason);
    expect(q.lock(root)).toBeNull();
    expect(swept.calls.filter((c) => c[0] === "stop")).toEqual([["stop", SB]]); // the last holder: its pin released
    expect(await sweepEngines(q, wdeps)).toEqual([]);
  });

  test("an engine whose recorded kill left it alive is still waited for while its status probe fails (`unknown`): not ended, not closed out, no `sbx stop`", async () => {
    sbx.answer({ procs: { 6509: { start: "125610", dies_on: "never" } } });
    const q = newQueue();
    const { run, root, wt } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    q.note(run.run_id, "engine-kill", { why: "test", sandbox: SB, worker: { pid: 6509, start: "125610.0", outcome: "engine alive after kill" } });
    const wdeps = sweepUnknown();
    expect(await engineStatus(wt, ENGINE, wdeps)).toMatchObject({ phase: "unknown" });

    const swept = await during(() => sweepEngines(q, wdeps));
    expect(swept.out).toEqual([]);
    expect(swept.calls).toContainEqual(["exec", SB, "cat", "/proc/6509/stat"]); // probed again: still alive
    expect(swept.calls).not.toContainEqual(["stop", SB]);
    expect(q.get(run.run_id)!.state).toBe("running");
    expect(kinds(q, run.run_id)).not.toContain("closed_out");
    expect(kinds(q, run.run_id)).not.toContain("ended");
    expect(kinds(q, run.run_id)).not.toContain("engine-gone");
    expect(q.lock(root)).not.toBeNull();
    expect(existsSync(wt)).toBe(true);
  });
});

// ---------------------------------------------------------------- restart

describe("Restart: `recoverQueue` respawns the hold of a launched sbx run whose engine pid is still live (respawnHolds)", () => {
  async function recorded(q: Queue, start = "125610.0") {
    const { run } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start, source: "engine.pid" });
    return run;
  }

  test("pid live, start time matched → the hold respawned and recorded", async () => {
    sbx.answer({ procs: { 6509: { start: "125610" } } });
    const q = newQueue();
    const run = await recorded(q);
    const { spawned, hold } = fakeHold();
    expect(await respawnHolds(q, { ...deps, hold })).toEqual([run.run_id]);
    expect(spawned).toEqual([holdArgv(SB, 6509)]);
    expect(q.events(run.run_id).findLast((e) => e.kind === "hold")?.detail).toMatchObject({ respawned: "supervisor restart", engine_pid: 6509 });
  });

  test("pid dead, or its start time differs → no hold", async () => {
    const q = newQueue();
    await recorded(q);
    const { spawned, hold } = fakeHold();
    sbx.answer({});
    expect(await respawnHolds(q, { ...deps, hold })).toEqual([]);
    sbx.answer({ procs: { 6509: { start: "1" } } });
    expect(await respawnHolds(q, { ...deps, hold })).toEqual([]);
    expect(spawned).toEqual([]);
  });

  test("a recorded hold that still runs is not spawned twice", async () => {
    sbx.answer({ procs: { 6509: { start: "125610" } } });
    const q = newQueue();
    const run = await recorded(q);
    q.note(run.run_id, "hold", { sandbox: SB, engine_pid: 6509, pid: 31337, start: "1" });
    const { spawned, hold } = fakeHold();
    expect(await respawnHolds(q, { ...deps, hold, holdAlive: (pid) => pid === 31337 })).toEqual([]);
    expect(spawned).toEqual([]);
  });
});

// ---------------------------------------------------------------- the starter lock file

describe("Lock file: `<studioHome>/projects/<key>/starter.lock` names the queue as the only starter", () => {
  test("written atomically in the store for every served project, with the SPEC's JSON shape", () => {
    const home = tempDir("tk-sup-sbx-store-");
    const q = newQueue();
    const root = tempDir("tk-sup-sbx-served-");
    q.enqueue({ jobId: "studio-health", root, projectId: "proj-27", definition: { id: "studio-health" } });
    const env = { TK_STUDIO_HOME: home };
    expect(writeStarterLocks(q, env)).toEqual([{ path: join(home, "projects", "proj-27", "starter.lock") }]);
    const path = starterLockPath({ project_id: "proj-27", root }, env);
    const lock = JSON.parse(readFileSync(path, "utf-8"));
    expect(lock).toEqual({ starter: STARTER, checkout: checkoutKey(root), since: lock.since, supervisor_pid: process.pid });
    expect(lock.starter).toBe("tk-studio-supervisor queue");
    expect(Number.isFinite(Date.parse(lock.since))).toBe(true);
    expect(readdirSync(dirname(path))).toEqual(["starter.lock"]); // no temp file left behind
    // Rewritten each tick: `since` kept by the same supervisor.
    writeStarterLock({ project_id: "proj-27", root }, env, () => new Date(Date.parse(lock.since) + 60_000));
    expect(JSON.parse(readFileSync(path, "utf-8")).since).toBe(lock.since);
    expect(existsSync(join(root, "starter.lock"))).toBe(false);
  });

  test("never in the checkout's tree: a store inside the checkout is refused, nothing written", () => {
    const root = tempDir("tk-sup-sbx-intree-");
    const out = writeStarterLock({ project_id: "p", root }, { TK_STUDIO_HOME: join(root, ".store") });
    expect(out).toMatchObject({ error: expect.stringContaining("checkout's tree") });
    expect(existsSync(join(root, ".store"))).toBe(false);
  });
});

describe("Story 28.6 (DW-6): serve refreshes every served project's starter lock every minute, `since` fresh", () => {
  test("written at once and on each injected tick with `since` = now and `supervisor_pid` = this process; stop clears it", () => {
    const home = tempDir("tk-sup-sbx-refresh-");
    const q = newQueue();
    const rootA = tempDir("tk-sup-sbx-refresh-a-");
    const rootB = tempDir("tk-sup-sbx-refresh-b-");
    q.enqueue({ jobId: "studio-health", root: rootA, projectId: "proj-a", definition: { id: "studio-health" } });
    q.enqueue({ jobId: "studio-health", root: rootB, projectId: "proj-b", definition: { id: "studio-health" } });
    let closed = 0;
    const close = q.close.bind(q);
    q.close = () => { closed++; close(); };
    const env = { TK_STUDIO_HOME: home };
    const t0 = Date.parse("2026-10-17T10:00:00.000Z");
    let clock = t0;
    const timers: { fn: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    const lockOf = (projectId: string, root: string) => JSON.parse(readFileSync(starterLockPath({ project_id: projectId, root }, env), "utf-8"));
    const stop = watchStarterLocks({
      env, open: () => q, now: () => clock,
      setInterval: (fn, ms) => { timers.push({ fn, ms }); return "the-lock-timer"; }, clearInterval: (t) => cleared.push(t),
    });
    expect(stop).toBeFunction();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(STARTER_LOCK_REFRESH_MS);
    expect(STARTER_LOCK_REFRESH_MS).toBe(60_000);
    // written at once
    expect(lockOf("proj-a", rootA)).toEqual({ starter: STARTER, checkout: checkoutKey(rootA), since: new Date(t0).toISOString(), supervisor_pid: process.pid });
    expect(lockOf("proj-b", rootB)).toEqual({ starter: STARTER, checkout: checkoutKey(rootB), since: new Date(t0).toISOString(), supervisor_pid: process.pid });
    // each tick stamps `since` fresh (the 27.2 writes keep theirs: same pid, same checkout)
    clock = t0 + 60_000;
    timers[0]!.fn();
    expect(lockOf("proj-a", rootA).since).toBe(new Date(t0 + 60_000).toISOString());
    clock = t0 + 3 * 3_600_000;
    timers[0]!.fn();
    expect(lockOf("proj-b", rootB)).toMatchObject({ since: new Date(t0 + 3 * 3_600_000).toISOString(), supervisor_pid: process.pid });
    // the since-preserving default is unchanged
    writeStarterLock({ project_id: "proj-a", root: rootA }, env, () => new Date(clock + 60_000));
    expect(lockOf("proj-a", rootA).since).toBe(new Date(t0 + 3 * 3_600_000).toISOString());
    stop!();
    expect(cleared).toEqual(["the-lock-timer"]);
    expect(closed).toBe(1);
    clock = t0 + 4 * 3_600_000;
    timers[0]!.fn(); // a tick already queued after the stop writes nothing
    expect(lockOf("proj-a", rootA).since).toBe(new Date(t0 + 3 * 3_600_000).toISOString());
    stop!();
    expect(cleared).toHaveLength(1);
  });

  test("a queue that cannot be opened → one line on stderr, nothing watched; a failing write never throws", () => {
    const lines: string[] = [];
    const timers: unknown[] = [];
    expect(watchStarterLocks({
      env: {}, open: () => { throw new Error("QueueDbMissing: TK_SUPERVISOR_DB is not set"); }, log: (l) => lines.push(l),
      setInterval: (fn) => { timers.push(fn); return 1; },
    })).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("[supervisor] starter-lock refresh disabled: the queue could not be opened (QueueDbMissing");
    expect(timers).toEqual([]);
    const q = newQueue();
    q.jobs = () => { throw new Error("busy"); };
    const stop = watchStarterLocks({ env: {}, open: () => q, setInterval: () => 1, clearInterval: () => {} });
    expect(stop).toBeFunction();
    stop!();
  });
});

// ---------------------------------------------------------------- external runs

describe("External: a studio run started outside the queue is recorded and counted live until it ends (DW-6)", () => {
  const SID = "studio-health-20261016T101010Z";
  const verbsFor = (state: () => string) => async (_root: string, a: string[]) =>
    a[0] === "status" ? { ok: true, runs: [{ run_id: SID, state: state() }] } : { ok: true };
  const served = (q: Queue) => {
    const root = tempDir("tk-sup-sbx-ext-");
    const r = q.enqueue({ jobId: "studio-health", root, projectId: "p", definition: { id: "studio-health" } }).run;
    q.end(r.run_id, "complete", null);
    return root;
  };

  test("External: a non-terminal studio run no queue run names → an `external` queue run with its studio run id; the pacer sees it live", async () => {
    const q = newQueue();
    const root = served(q);
    const out = await detectExternal(q, verbsFor(() => "running"));
    expect(out.recorded).toHaveLength(1);
    const ext = q.get(out.recorded[0])!;
    expect(ext).toMatchObject({ state: "external", studio_run_id: SID, job_id: "studio-health", owner_pid: null });
    expect(q.events(ext.run_id).map((e) => [e.kind, e.detail])).toEqual([["external", { studio_run_id: SID, studio_state: "running", tier: "host" }]]);
    const pacing = q.pacing("studio-health", root, me);
    expect(pacing.live.map((r) => r.run_id)).toEqual([ext.run_id]);
    const d = shouldWake({ trigger: "loop", cadence: { mode: "self-paced" } }, pacing, Date.now());
    expect(d).toEqual({ wake: false, reason: `run ${ext.run_id} still external (studio run ${SID} started outside the queue) — no overlap` });
    // The queue mints no second run beside it, and never drives it.
    const again = q.enqueue({ jobId: "studio-health", root, definition: { id: "studio-health" } });
    expect(again).toMatchObject({ minted: false, run: { run_id: ext.run_id } });
    expect(await q.claim(ext.run_id, me)).toMatchObject({ claimed: false, why: "running" });
    // A second tick records nothing new.
    expect((await detectExternal(q, verbsFor(() => "running"))).recorded).toEqual([]);
  });

  test("External ends: its studio run becomes terminal → the external queue run ends in that state; no longer live", async () => {
    const q = newQueue();
    const root = served(q);
    let state = "running";
    const [id] = (await detectExternal(q, verbsFor(() => state))).recorded;
    state = "complete";
    expect((await detectExternal(q, verbsFor(() => state))).ended).toEqual([id]);
    expect(q.get(id)).toMatchObject({ state: "complete" });
    expect(q.pacing("studio-health", root, me).live).toEqual([]);
  });

  /** A throwaway studio store (TK_STUDIO_HOME) for the vanished check, `sbx` the fake. */
  const storeDeps = (): SandboxDeps & { home: string } => {
    const home = tempDir("tk-sup-sbx-store-");
    return { ...deps, env: { ...deps.env, TK_STUDIO_HOME: home }, home };
  };

  test("External vanished: the job's status list no longer carries its studio run → the external run ends `partial`, the reason naming the vanished studio run", async () => {
    const q = newQueue();
    const root = served(q);
    const store = storeDeps(); // its record directory is not in the store
    const [id] = (await detectExternal(q, verbsFor(() => "running"), undefined, store)).recorded;
    expect((await detectExternal(q, async () => ({ ok: true, runs: [{ run_id: "studio-health-20261016T090909Z", state: "complete" }] }), undefined, store)).ended).toEqual([id]);
    const ended = q.get(id!)!;
    expect(ended.state).toBe("partial");
    expect(ended.reason).toBe(`external: studio run ${SID} vanished: status no longer lists studio run ${SID}`);
    expect(q.events(id!).at(-1)).toMatchObject({ kind: "ended", from_state: "external", to_state: "partial", detail: { external: true, studio_run_id: SID } });
    expect(q.pacing("studio-health", root, me).live).toEqual([]);
  });

  test("External not listed but its record still in the store (`<studioHome>/projects/<key>/runs/<id>/`, its run.json unreadable to the studio) → unchanged, still live, no `sbx stop`; once the directory is gone it ends `partial`", async () => {
    sbx.answer({});
    const q = newQueue();
    const a = await sbxRun(q);
    const root = served(q);
    const store = storeDeps();
    const onSandbox = () => ({ tier: "sbx", sandbox: SB });
    const [id] = (await detectExternal(q, verbsFor(() => "running"), onSandbox, store)).recorded;
    q.end(a.run.run_id, "complete", null);
    expect(await releasePin(q, a.run.run_id, store)).toBe("kept"); // E holds the sandbox
    const dir = join(store.home, "projects", "p", "runs", SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), "{ not json");
    // The studio's `job.list_runs(key, job_id=…)` turns an unreadable run.json into `{run_id, error}` with no
    // `job_id`, which its job filter then drops: the run is omitted, not reported.
    const unlisted = async (_r: string, a2: string[]) => (a2[0] === "status" ? { ok: true, runs: [] } : { ok: true });
    const kept = await during(() => detectExternal(q, unlisted, onSandbox, store));
    expect(kept.out.ended).toEqual([]);
    expect(q.get(id!)!.state).toBe("external");
    expect(kinds(q, id!)).toEqual(["external"]);
    expect(q.pacing("studio-health", root, me).live.map((r) => r.run_id)).toEqual([id]);
    expect(kept.calls).not.toContainEqual(["stop", SB]);

    rmSync(dir, { recursive: true });
    const gone = await during(() => detectExternal(q, unlisted, onSandbox, store));
    expect(gone.out.ended).toEqual([id]);
    expect(q.get(id!)!).toMatchObject({ state: "partial", reason: `external: studio run ${SID} vanished: status no longer lists studio run ${SID}` });
    expect(gone.calls.filter((c) => c[0] === "stop")).toEqual([["stop", SB]]);
  });

  test("a status refusal (the job definition currently has problems) leaves the external run live: unchanged, still counted by the pacer", async () => {
    const q = newQueue();
    const root = served(q);
    const [id] = (await detectExternal(q, verbsFor(() => "running"))).recorded;
    const refusal = async () => ({ ok: false, error: "job 'studio-health': missing required field 'guards'" });
    expect(await detectExternal(q, refusal)).toEqual({ recorded: [], ended: [] });
    expect(q.get(id!)!.state).toBe("external");
    expect(kinds(q, id!)).toEqual(["external"]);
    const pacing = q.pacing("studio-health", root, me);
    expect(pacing.live.map((r) => r.run_id)).toEqual([id]);
    expect(shouldWake({ trigger: "loop", cadence: { mode: "self-paced" } }, pacing, Date.now()).wake).toBe(false);
    // Once the definition is fixed and the run is listed terminal, it ends as usual.
    expect((await detectExternal(q, verbsFor(() => "complete"))).ended).toEqual([id]);
  });

  test("a failed status lookup (the verb could not run) leaves the external run live", async () => {
    const q = newQueue();
    served(q);
    const [id] = (await detectExternal(q, verbsFor(() => "running"))).recorded;
    expect((await detectExternal(q, async () => { throw new Error("uv: spawn failed"); })).ended).toEqual([]);
    expect(q.get(id!)!.state).toBe("external");
  });

  test("a cancel of an external run is refused naming it as started outside the queue; it stays live, nothing is stopped", async () => {
    const q = newQueue();
    const root = served(q);
    const [id] = (await detectExternal(q, verbsFor(() => "running"))).recorded;
    const verbCalls: string[][] = [];
    const err = await cancelRun(q, id!, cancelWith(verbCalls)).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalRunRefused);
    expect(err.message).toContain(`studio run ${SID} was started outside the queue`);
    expect(verbCalls).toEqual([]);
    expect(q.get(id!)!.state).toBe("external");
    expect(kinds(q, id!)).toEqual(["external"]);
    expect(q.pacing("studio-health", root, me).live.map((r) => r.run_id)).toEqual([id]);
  });

  test("a studio run a queue run already names, or one of a job the queue does not serve, is never external", async () => {
    const q = newQueue();
    const root = served(q);
    const live = q.enqueue({ jobId: "studio-health", root, definition: { id: "studio-health" } }).run;
    q.setStudioRun((await q.claim(live.run_id, me)).run.run_id, SID);
    expect((await detectExternal(q, verbsFor(() => "running"))).recorded).toEqual([]);
    expect(q.recordExternal("unserved-job", root, "unserved-job-20261016T101010Z", "running")).toBeNull();
  });

  test("a queue file whose state CHECK predates `external` is rebuilt with it", () => {
    const path = join(tempDir("tk-sup-sbx-db-"), "q.db");
    const db = new Database(path);
    db.exec(`CREATE TABLE jobs (job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL, project_id TEXT, definition TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (job_id, checkout));
      CREATE TABLE runs (run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL, project_id TEXT, target TEXT,
        state TEXT NOT NULL CHECK (state IN ('queued','running','complete','partial','blocked','cancelled','paused')), reason TEXT,
        owner_pid INTEGER, owner_host TEXT, owner_nonce TEXT, owner_start TEXT, studio_run_id TEXT, engine_run_id TEXT, verb_started TEXT,
        verb_snapshot TEXT, definition TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE UNIQUE INDEX runs_one_live ON runs (job_id, checkout) WHERE state IN ('queued','running','paused');`);
    db.close();
    const q = track(new Queue(path));
    try {
      const sql = (q.db.query("SELECT sql FROM sqlite_master WHERE name = 'runs'").get() as { sql: string }).sql;
      expect(sql).toContain("'external'");
      expect((q.db.query("SELECT sql FROM sqlite_master WHERE name = 'runs_one_live'").get() as { sql: string }).sql).toContain("'external'");
    } finally { q.close(); }
  });
});

// ---------------------------------------------------------------- the wiring of `recoverQueue` (each tick)

describe.skipIf(!process.env.TK_STUDIO_ROOT)("recoverQueue wiring: holds respawned, external runs detected, starter locks written", () => {
  test("one recover: the restart's hold respawned, a hand-started studio run recorded external, every served project's starter.lock written", async () => {
    sbx.answer({ procs: { 6509: { start: "125610" } } });
    const q = newQueue();
    const { run } = await sbxRun(q);
    launched(q, run.run_id);
    q.recordEnginePid(run.run_id, { pid: 6509, start: "125610.0", source: "engine.pid" });
    const extRoot = tempDir("tk-sup-sbx-recover-ext-");
    q.end(q.enqueue({ jobId: "studio-health", root: extRoot, projectId: "p-ext", definition: { id: "studio-health" } }).run.run_id, "complete", null);
    const sid = "studio-health-20261016T131313Z";
    const home = tempDir("tk-sup-sbx-recover-home-");
    const studio = fakeStudioRoot();
    const { spawned, hold } = fakeHold();
    const wdeps: WorktreeDeps = { ...sweepWith("running"), sbx: { ...deps, hold } };
    wdeps.env = { ...wdeps.env, TK_STUDIO_ROOT: studio.root, TK_STUDIO_HOME: home };
    await recoverQueue({ queue: q, owner: me, worktree: wdeps, hygiene: { env: {} } },
      async (_r, a) => (a[0] === "status" && a.includes("studio-health") ? { ok: true, runs: [{ run_id: sid, state: "running" }] } : { ok: true, runs: [] }));
    // respawnHolds: the hold of the launched run whose engine pid still runs as recorded.
    expect(spawned).toEqual([holdArgv(SB, 6509)]);
    expect(q.events(run.run_id).findLast((e) => e.kind === "hold")?.detail).toMatchObject({ respawned: "supervisor restart" });
    // detectExternal: the hand-started studio run, an `external` queue run.
    expect(q.runs().filter((r) => r.state === "external").map((r) => r.studio_run_id)).toEqual([sid]);
    // writeStarterLocks: both served projects.
    for (const key of ["p27", "p-ext"]) {
      expect(JSON.parse(readFileSync(join(home, "projects", key, "starter.lock"), "utf-8"))).toMatchObject({ starter: STARTER, supervisor_pid: process.pid });
    }
  });
});

describe("no shell in any sbx argv", () => {
  test("src/sandbox.ts names no `bash`, `sh`, `-c` or `-lc` argv item", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "sandbox.ts"), "utf-8");
    expect(src.match(/"(bash|sh|-c|-lc)"/g)).toBeNull();
  });
});
