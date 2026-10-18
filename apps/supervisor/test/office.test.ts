// Story 29.3: the office projection — the mapping table against the recorded journal (`fixtures/office/inflight`,
// this epic's own run, stripped of every `prompt` and the `policy_snapshot`) and the hand-made fixtures, the grace
// timer on an injected clock, progress and its denominator, the stream (snapshot first, deltas, replay, heartbeat,
// close), the routes, the status page's Office section and the registry's `live_state`. The queue side is a real
// `Queue` on a temp file driven through its own verbs.
import { describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../src/api";
import { SESSION_COOKIE, signSession } from "../src/auth";
import {
  OFFICE_MAP, OFFICE_STATES, OfficeHub, officeCachedPaths, officeStates, projectOffice, type OfficeState, type OfficeView,
} from "../src/office";
import { gatherPage, renderPage } from "../src/page";
import { Queue, type Owner, type Probes, type QueueRun, type WorkerKill } from "../src/queue";
import { readAgents, rebuildAgents, ROLES, rowsFor, type Route } from "../src/registry";

const FX = join(import.meta.dir, "fixtures", "office");
const TOKEN = "tok-29-3-office-secret";
const SECRET = "o".repeat(48);
const ME: Owner = { pid: process.pid, host: hostname(), nonce: "office-test" };
const BASE = "http://100.64.0.1:8787";
const SPEC = "_bmad-output/specs/spec-epic-29";
const S1 = "29-1-the-owners-account-replaces-the-providers", S2 = "29-2-the-agent-registry";
const S3 = "29-3-the-office-projection-semantic-states-progress-and-its", S4 = "29-4-the-contract-names-the-web-as-a-consumer-and-the-runbook";
const INFLIGHT = readFileSync(join(FX, "inflight", "journal.jsonl"), "utf-8").split("\n").filter(Boolean);
/** The recorded journal cut where the 29-2 dev, review and gate sessions are open, and after the dev session ended. */
const CUT = { dev: 19, devEnded: 21, review: 22, gate: 26 } as const;

let engineIds = 0;

function world() {
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-office-"));
  const probes: Probes = {
    ownerAlive: (o) => o.nonce === ME.nonce,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
  };
  const db = join(dir, "q.db");
  const queue = new Queue(db, probes);
  const checkout = mkdtempSync(join(tmpdir(), "tk-sup-office-checkout-"));
  queue.replaceAgents([...rowsFor("p", null, {}, null), ...rowsFor("q", null, {}, null)], "2026-10-18T00:00:00.000Z");
  const enqueue = (jobId = "run-epic-29") =>
    queue.enqueue({ jobId, root: checkout, projectId: "p", target: "skill", definition: { id: jobId } }).run;
  /** Claim the run and cut its worktree (`running`, no engine yet). */
  const claim = async (run: QueueRun) => {
    const c = await queue.claim(run.run_id, ME);
    if (!c.claimed) throw new Error(`not claimed: ${c.why}`);
    const wt = mkdtempSync(join(tmpdir(), "tk-sup-office-wt-"));
    return queue.recordWorktree(run.run_id, wt, { branch: "b", base_ref: "main" });
  };
  /** A launched run: claimed, worktree cut, `launched`, the engine files written under its served root. */
  const launch = async (o: { fixture?: string; lines?: number; phases?: Record<string, string>; manifest?: boolean; files?: boolean } = {}) => {
    const run = await claim(enqueue());
    const engineId = `20261018-0000${String(++engineIds).padStart(2, "0")}-test`;
    queue.markLaunched(run.run_id, engineId, { end: {} });
    const runDir = join(run.worktree!, ".bmad-loop", "runs", engineId);
    if (o.files !== false) {
      mkdirSync(runDir, { recursive: true });
      const name = o.fixture ?? "inflight";
      const text = readFileSync(join(FX, name, "journal.jsonl"), "utf-8").split("\n").filter(Boolean);
      writeFileSync(join(runDir, "journal.jsonl"), text.slice(0, o.lines ?? text.length).join("\n") + "\n");
      const state = JSON.parse(readFileSync(join(FX, name, "state.json"), "utf-8"));
      for (const [k, phase] of Object.entries(o.phases ?? {})) state.tasks[k] = { ...(state.tasks[k] ?? { story_key: k }), phase };
      writeFileSync(join(runDir, "state.json"), JSON.stringify(state));
    }
    if (o.manifest !== false) {
      mkdirSync(join(run.worktree!, SPEC), { recursive: true });
      copyFileSync(join(FX, "stories.yaml"), join(run.worktree!, SPEC, "stories.yaml"));
    }
    return { run: queue.get(run.run_id)!, runDir };
  };
  return { dir, db, queue, checkout, enqueue, claim, launch };
}

const statesOf = (v: OfficeView, project = "p") =>
  Object.fromEntries(v.agents.filter((a) => a.project === project).map((a) => [a.role, a.state])) as Record<string, OfficeState>;
const all = (state: OfficeState, but: Record<string, OfficeState> = {}) => Object.fromEntries(ROLES.map((r) => [r, but[r] ?? state]));

describe("the mapping table (AC1)", () => {
  test("OFFICE_STATES are the eight; OFFICE_MAP is the eleven rows, in order", () => {
    expect([...OFFICE_STATES]).toEqual(["offline", "idle", "thinking", "reading", "typing", "running", "waiting-for-human", "blocked"]);
    expect(OFFICE_MAP.map((r) => r.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const r of OFFICE_MAP) for (const s of Object.values(r.states)) expect(OFFICE_STATES).toContain(s!);
  });

  test("row 1: no run — every role of every project offline; every registry agent exactly once", () => {
    const w = world();
    const v = projectOffice(w.queue);
    expect(v.agents.map((a) => a.agent_id)).toEqual(readAgents(w.queue).agents.map((a) => a.agent_id));
    expect(new Set(v.agents.map((a) => a.agent_id)).size).toBe(14);
    expect(statesOf(v)).toEqual(all("offline"));
    expect(v.runs).toEqual([]);
    expect(v.problems).toEqual([]);
  });

  test("row 3: queued, and queued after lock-wait — all idle", async () => {
    const w = world();
    w.enqueue("a");
    expect(statesOf(projectOffice(w.queue))).toEqual(all("idle"));
    expect(statesOf(projectOffice(w.queue), "q")).toEqual(all("offline")); // another project: no run
    // The checkout's lock held by project q's run: p's run waits queued after lock-wait.
    const w2 = world();
    await w2.claim(w2.queue.enqueue({ jobId: "holder", root: w2.checkout, projectId: "q", target: "skill", definition: { id: "holder" } }).run);
    const waiting = w2.enqueue("waiter");
    expect((await w2.queue.claim(waiting.run_id, ME)).claimed).toBe(false);
    expect(w2.queue.events(waiting.run_id).map((e) => e.kind)).toContain("lock-wait");
    expect(statesOf(projectOffice(w2.queue))).toEqual(all("idle"));
    expect(statesOf(projectOffice(w2.queue), "q")).toEqual(all("idle", { orchestrator: "thinking" }));
  });

  test("a newer queued run never masks a working run of the same project; all queued: the newest queued", async () => {
    const w = world();
    const { run: a } = await w.launch({ lines: CUT.dev, phases: { [S2]: "dev-running" } }); // job run-epic-29, running
    const b = w.enqueue("another-job"); // newer, queued
    const v = projectOffice(w.queue);
    expect(statesOf(v)).toEqual(all("idle", { session: "typing", implementer: "typing" }));
    expect(v.agents.find((x) => x.agent_id === "p/implementer")!.current_run).toBe(a.run_id);
    const w2 = world();
    w2.enqueue("one");
    const newest = w2.enqueue("two");
    expect(projectOffice(w2.queue).agents.find((x) => x.agent_id === "p/session")!.current_run).toBe(newest.run_id);
    expect(b.state).toBe("queued");
  });

  test("row 5: launch (running, no launched) — orchestrator thinking; a missing run dir is no signal", async () => {
    const w = world();
    await w.claim(w.enqueue());
    expect(statesOf(projectOffice(w.queue))).toEqual(all("idle", { orchestrator: "thinking" }));
    const w2 = world();
    await w2.launch({ files: false, manifest: false });
    const v = projectOffice(w2.queue);
    expect(statesOf(v)).toEqual(all("idle"));
    expect(v.problems).toEqual([]);
  });

  test("rows 6, 7, 8 on the recorded journal: gate → planner/session thinking; dev → typing; review → reading", async () => {
    const dev = world(); await dev.launch({ lines: CUT.dev, phases: { [S2]: "dev-running" } });
    expect(statesOf(projectOffice(dev.queue))).toEqual(all("idle", { session: "typing", implementer: "typing" }));
    const review = world(); await review.launch({ lines: CUT.review, phases: { [S2]: "review-running" } });
    expect(statesOf(projectOffice(review.queue))).toEqual(all("idle", { session: "reading", reviewer: "reading" }));
    const gate = world(); await gate.launch({ lines: CUT.gate });
    const v = statesOf(projectOffice(gate.queue));
    expect(v).toEqual(all("idle", { planner: "thinking", session: "thinking" }));
    expect([v.consult, v.advisor]).toEqual(["idle", "idle"]); // no journal signal: idle while live
  });

  test("an unreadable journal is a problem naming the run-relative path, never a machine path (/office, the page)", async () => {
    const w = world();
    const { run, runDir } = await w.launch({ files: false });
    mkdirSync(join(runDir, "journal.jsonl"), { recursive: true }); // exists, but a directory
    writeFileSync(join(runDir, "state.json"), "{}");
    const v = projectOffice(w.queue);
    const want = `JournalUnreadable: run ${run.run_id}: .bmad-loop/runs/${run.engine_run_id}/journal.jsonl: `;
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toStartWith(want);
    const html = renderPage(await gatherPage({ queue: w.queue, token: TOKEN, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" } }));
    const section = html.slice(html.indexOf('<section id="office">'), html.indexOf("</section>", html.indexOf('<section id="office">')));
    expect(section).toContain(want);
    for (const text of [JSON.stringify(v.problems), section]) {
      expect(text).toContain(".bmad-loop/runs/");
      expect(text).not.toContain(run.worktree!);
      expect(text).not.toContain(tmpdir());
    }
  });

  test("the file caches keep only the paths the latest projection read", async () => {
    const w = world();
    const { run, runDir } = await w.launch({ lines: CUT.dev });
    projectOffice(w.queue);
    expect(officeCachedPaths()).toContain(join(runDir, "journal.jsonl"));
    expect(officeCachedPaths()).toContain(join(runDir, "state.json"));
    w.queue.endEngine(run.run_id, "cancelled", "done with it");
    projectOffice(w.queue);
    expect(officeCachedPaths().filter((p) => p.startsWith(run.worktree!))).toEqual([]);
  });

  test("a partial last journal line is skipped silently", async () => {
    const w = world();
    const { runDir } = await w.launch({ lines: CUT.dev });
    appendFileSync(join(runDir, "journal.jsonl"), '{"ts": 1792290564.7, "kind": "session-en');
    const v = projectOffice(w.queue);
    expect(statesOf(v)).toEqual(all("idle", { session: "typing", implementer: "typing" }));
    expect(v.problems).toEqual([]);
  });

  test("row 9: no open session, a verify phase — session running", async () => {
    for (const phase of ["dev-verify", "review-verify", "committing"]) {
      const w = world();
      await w.launch({ lines: CUT.devEnded, phases: { [S2]: phase } });
      expect(statesOf(projectOffice(w.queue))).toEqual(all("idle", { session: "running" }));
    }
    const w = world();
    await w.launch({ lines: CUT.devEnded, phases: { [S2]: "review-running" } });
    expect(statesOf(projectOffice(w.queue))).toEqual(all("idle")); // row 11: between legs
  });

  test("row 10: engine ended, no host-verify — orchestrator running; after host-verify all idle", async () => {
    const w = world();
    const { run } = await w.launch({ fixture: "complete" });
    expect(statesOf(projectOffice(w.queue))).toEqual(all("idle", { orchestrator: "running" }));
    w.queue.note(run.run_id, "host-verify", { ok: true });
    expect(statesOf(projectOffice(w.queue))).toEqual(all("idle"));
    const gone = world();
    const g = await gone.launch({ lines: CUT.dev });
    gone.queue.note(g.run.run_id, "engine-gone", {});
    expect(statesOf(projectOffice(gone.queue))).toEqual(all("idle", { orchestrator: "running" }));
  });

  test("row 4: queue paused, awaiting-ruling, and the escalation fixture — orchestrator/session waiting-for-human", async () => {
    const want = all("idle", { orchestrator: "waiting-for-human", session: "waiting-for-human" });
    const paused = world();
    const p = await paused.launch({ lines: CUT.dev });
    paused.queue.markPaused(p.run.run_id, { engine: { paused_story_key: S2, paused_stage: "escalation", paused_reason: "x" } });
    expect(statesOf(projectOffice(paused.queue))).toEqual(want);
    paused.queue.note(p.run.run_id, "awaiting-ruling", { story_key: S2, reason: "a ruling" });
    expect(statesOf(projectOffice(paused.queue))).toEqual(want);
    const esc = world();
    await esc.launch({ fixture: "paused-escalation" }); // the queue run still running: the journal and state.json say it
    expect(statesOf(projectOffice(esc.queue))).toEqual(want);
  });

  test("a close-out after the ruling ends the wait: paused → awaiting-ruling → close-out (running) is not row 4", async () => {
    const w = world();
    const { run } = await w.launch({ lines: CUT.dev, phases: { [S2]: "dev-running" } });
    w.queue.markPaused(run.run_id, {});
    w.queue.note(run.run_id, "awaiting-ruling", { story_key: S2, reason: "a ruling" });
    w.queue.resumeFromPause(run.run_id, "close-out", { story_key: S2 }, ME);
    expect(w.queue.get(run.run_id)!.state).toBe("running");
    const v = statesOf(projectOffice(w.queue));
    expect([v.orchestrator, v.session]).not.toContain("waiting-for-human");
    expect(v).toEqual(all("idle", { orchestrator: "thinking" })); // row 5: the relaunch's launch leg (no new launched)
  });

  test("row 5 after a close-out or an engine resume: no launched since the move is the launch leg, thinking", async () => {
    const want = all("idle", { orchestrator: "thinking" });
    for (const kind of ["close-out", "engine-resume"] as const) {
      // (a) launched → paused → the move (the old engine id still set, no new launched): row 5, not row 11.
      const w = world();
      const { run } = await w.launch({ fixture: "complete" }); // the old journal ended: no session, no verify phase
      w.queue.note(run.run_id, "host-verify", { ok: true });
      w.queue.markPaused(run.run_id, {});
      w.queue.resumeFromPause(run.run_id, kind, {}, ME);
      expect(w.queue.get(run.run_id)!.engine_run_id).toBe(run.engine_run_id);
      expect(statesOf(projectOffice(w.queue))).toEqual(want);
      // (c) the new engine's launched lands: the run leaves row 5 (no files yet: row 11, all idle).
      w.queue.markLaunched(run.run_id, `${run.engine_run_id}-next`, { end: {} });
      expect(statesOf(projectOffice(w.queue))).toEqual(all("idle"));
      // (b) an engine-gone after the old launched: still row 5 (thinking), not row 10 (running).
      const g = world();
      const { run: gr } = await g.launch({ lines: CUT.dev });
      g.queue.note(gr.run_id, "engine-gone", {});
      g.queue.markPaused(gr.run_id, {});
      g.queue.resumeFromPause(gr.run_id, kind, {}, ME);
      expect(statesOf(projectOffice(g.queue))).toEqual(want);
    }
  });

  test("row 2: the latest run blocked — orchestrator/session blocked, the rest offline", async () => {
    const w = world();
    const run = await w.claim(w.enqueue());
    w.queue.endEngine(run.run_id, "blocked", "the launch refused");
    const v = projectOffice(w.queue);
    expect(statesOf(v)).toEqual(all("offline", { orchestrator: "blocked", session: "blocked" }));
    expect(v.agents.find((a) => a.agent_id === "p/session")!.current_run).toBe(run.run_id);
    expect(v.runs).toEqual([]); // not a live run
  });

  test("an older paused run (awaiting a ruling) is never hidden by a newer running run of another job", async () => {
    const w = world();
    const { run: paused } = await w.launch({ lines: CUT.dev, phases: { [S2]: "dev-running" } });
    w.queue.markPaused(paused.run_id, { engine: { paused_story_key: S2, paused_stage: "escalation", paused_reason: "x" } });
    w.queue.note(paused.run_id, "awaiting-ruling", { story_key: S2, reason: "a ruling" });
    // A newer run of another job on another checkout of the same project: running, its dev session open.
    const root = mkdtempSync(join(tmpdir(), "tk-sup-office-checkout-"));
    const other = await w.claim(w.queue.enqueue({ jobId: "another-job", root, projectId: "p", target: "skill", definition: { id: "another-job" } }).run);
    w.queue.markLaunched(other.run_id, "20261018-009999-other", { end: {} });
    const runDir = join(other.worktree!, ".bmad-loop", "runs", "20261018-009999-other");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "journal.jsonl"), INFLIGHT.slice(0, CUT.dev).join("\n") + "\n");
    expect(w.queue.get(other.run_id)!.state).toBe("running");
    const v = projectOffice(w.queue);
    expect(statesOf(v)).toEqual(all("idle", { orchestrator: "waiting-for-human", session: "waiting-for-human" }));
    for (const role of ["orchestrator", "session"]) expect(v.agents.find((a) => a.agent_id === `p/${role}`)!.current_run).toBe(paused.run_id);
  });

  test("an engine-ended run with no queue launched (an adopted external run) is not row 10: idle, not running", async () => {
    const w = world();
    const root = mkdtempSync(join(tmpdir(), "tk-sup-office-checkout-"));
    const first = w.queue.enqueue({ jobId: "ext", root, projectId: "p", target: "skill", definition: { id: "ext" } }).run;
    w.queue.end(first.run_id, "cancelled", "test");
    const ext = w.queue.recordExternal("ext", root, "ext-20261018T000000Z", "running")!;
    const engineId = "20261018-008888-ext";
    w.queue.db.query("UPDATE runs SET engine_run_id = ? WHERE run_id = ?").run(engineId, ext.run_id);
    const runDir = join(ext.root, ".bmad-loop", "runs", engineId);
    mkdirSync(runDir, { recursive: true });
    copyFileSync(join(FX, "complete", "journal.jsonl"), join(runDir, "journal.jsonl"));
    copyFileSync(join(FX, "complete", "state.json"), join(runDir, "state.json"));
    expect(w.queue.events(ext.run_id).map((e) => e.kind)).not.toContain("launched");
    const v = projectOffice(w.queue);
    expect(v.runs.find((r) => r.run_id === ext.run_id)!.epic).toMatchObject({ done: 4, total: 4 }); // the journal was read
    expect(statesOf(v).orchestrator).not.toBe("running");
    expect(statesOf(v)).toEqual(all("idle"));
  });

  test("a project with live runs but no registry rows adds no agents", async () => {
    const w = world();
    w.queue.enqueue({ jobId: "x", root: w.checkout, projectId: "unregistered", target: "skill", definition: { id: "x" } });
    const v = projectOffice(w.queue);
    expect(v.agents.some((a) => a.project === "unregistered")).toBe(false);
    expect(v.runs.map((r) => r.project)).toEqual(["unregistered"]);
  });
});

describe("the grace timer (AC1, injected clock)", () => {
  function hubOver(raw: { state: OfficeState }) {
    let t = 1_000_000;
    const view = (): OfficeView => ({ at: "", runs: [], problems: [], agents: [{ agent_id: "p/session", project: "p", role: "session", state: raw.state, current_run: null, current_story: null }] });
    const hub = new OfficeHub({ queue: null as unknown as Queue, now: () => t, project: view });
    const shown = () => hub.snapshot().agents[0].state;
    return { hub, shown, advance: (ms: number) => { t += ms; } };
  }

  test("promotion is instant; a demotion lands at 20 s, not at 19.9 s", () => {
    const raw = { state: "idle" as OfficeState };
    const h = hubOver(raw);
    expect(h.shown()).toBe("idle");
    raw.state = "typing";
    expect(h.shown()).toBe("typing");
    raw.state = "reading"; // same rank: instant
    expect(h.shown()).toBe("reading");
    raw.state = "idle";
    expect(h.shown()).toBe("reading");
    h.advance(19_900);
    expect(h.shown()).toBe("reading");
    h.advance(100);
    expect(h.shown()).toBe("idle");
  });

  test("bouncing back up inside the window cancels the demotion", () => {
    const raw = { state: "typing" as OfficeState };
    const h = hubOver(raw);
    h.shown();
    raw.state = "idle"; h.shown();
    h.advance(10_000); raw.state = "typing"; expect(h.shown()).toBe("typing");
    h.advance(5_000); raw.state = "idle"; expect(h.shown()).toBe("typing");
    h.advance(15_000); expect(h.shown()).toBe("typing"); // 15 s since the new drop
    h.advance(5_000); expect(h.shown()).toBe("idle");
  });

  test("waiting-for-human survives an hour of ticks; it leaves only through the same grace", () => {
    const raw = { state: "waiting-for-human" as OfficeState };
    const h = hubOver(raw);
    for (let i = 0; i < 3600; i++) { h.advance(1000); expect(h.shown()).toBe("waiting-for-human"); }
    raw.state = "typing";
    expect(h.shown()).toBe("waiting-for-human");
    h.advance(20_000);
    expect(h.shown()).toBe("typing");
  });

  test("unpolled: a drop first seen after a gap of graceMs counts from the last refresh, not now", () => {
    const raw = { state: "typing" as OfficeState };
    const h = hubOver(raw);
    expect(h.shown()).toBe("typing");
    h.advance(60_000); raw.state = "idle"; // nothing polled for a minute
    expect(h.shown()).toBe("idle");
    raw.state = "typing"; expect(h.shown()).toBe("typing");
    h.advance(25_000); raw.state = "idle";
    expect(h.shown()).toBe("idle"); // 25 s since the higher state was last seen
  });

  test("a change of current_run applies the new run's raw state at once and drops the pending demotion", () => {
    let t = 0;
    const raw = { state: "waiting-for-human" as OfficeState, run: "r1" as string | null };
    const hub = new OfficeHub({ queue: null as unknown as Queue, now: () => t, project: () => ({ at: "", runs: [], problems: [], agents: [{ agent_id: "p/session", project: "p", role: "session", state: raw.state, current_run: raw.run, current_story: null }] }) });
    const shown = () => hub.snapshot().agents[0];
    expect(shown().state).toBe("waiting-for-human");
    raw.state = "offline"; raw.run = null; t += 1000; // the paused run cancelled
    expect(shown()).toMatchObject({ state: "offline", current_run: null });
    raw.state = "idle"; raw.run = "r2"; t += 1000; // a new run queued
    expect(shown()).toMatchObject({ state: "idle", current_run: "r2" });
    raw.state = "typing"; t += 1000; expect(shown().state).toBe("typing");
    raw.state = "idle"; t += 1000; expect(shown().state).toBe("typing"); // the same run: grace as ever
  });

  test("an injected graceMs is honoured", () => {
    let t = 0;
    const raw = { state: "typing" as OfficeState };
    const hub = new OfficeHub({ queue: null as unknown as Queue, now: () => t, graceMs: 5, project: () => ({ at: "", runs: [], problems: [], agents: [{ agent_id: "a", project: "p", role: "session", state: raw.state, current_run: null, current_story: null }] }) });
    hub.snapshot(); raw.state = "idle"; hub.snapshot();
    t = 5;
    expect(hub.snapshot().agents[0].state).toBe("idle");
  });
});

describe("progress (AC2)", () => {
  test("inflight: 1/4, current story 29-2; the remediation entry is extra, outside total", async () => {
    const w = world();
    const { run } = await w.launch();
    const r = projectOffice(w.queue).runs.find((x) => x.run_id === run.run_id)!;
    expect(r.epic).toEqual({ spec_folder: SPEC, done: 1, deferred: 0, failed: 0, total: 4, current_story: S2 });
    expect(r.stories.map((s) => [s.key, s.status, s.overlay, s.phase])).toEqual([
      [S1, "done", "done", "done"], [S2, "current", null, "review-verify"], [S3, "pending", null, null], [S4, "pending", null, null],
      [`${S2}-r1`, "pending", null, null],
    ]);
    expect(r.stories[4].extra).toBe(true);
    expect(r.stories.slice(0, 4).every((s) => s.extra === undefined)).toBe(true);
    expect(r.stories[0].title).toBe("The Owner's Account Replaces the Providers");
    expect(projectOffice(w.queue).agents.find((a) => a.agent_id === "p/planner")).toMatchObject({ current_run: run.run_id, current_story: S2 });
  });

  test("deferred and escalated count apart, each with the failed overlay", async () => {
    const d = world();
    await d.launch({ fixture: "deferred" });
    const dr = projectOffice(d.queue).runs[0];
    expect(dr.epic).toMatchObject({ done: 1, deferred: 2, failed: 0, total: 4, current_story: S4 });
    expect(dr.stories.slice(0, 4).map((s) => [s.status, s.overlay])).toEqual([["done", "done"], ["deferred", "failed"], ["deferred", "failed"], ["current", null]]);
    const e = world();
    await e.launch({ fixture: "paused-escalation" });
    const er = projectOffice(e.queue).runs[0];
    expect(er.epic).toMatchObject({ done: 1, deferred: 0, failed: 1, total: 4, current_story: null });
    expect(er.stories[1]).toMatchObject({ key: S2, status: "failed", overlay: "failed" });
  });

  test("no manifest: the story list falls back to the journal's story-start keys, total = count", async () => {
    const w = world();
    await w.launch({ manifest: false });
    const r = projectOffice(w.queue).runs[0];
    expect(r.stories.map((s) => s.key)).toEqual([S1, S2]);
    expect(r.epic).toMatchObject({ done: 1, total: 4, current_story: S2 });
  });

  test("no manifest: started keys beyond count are extra, never counted (2/2, not 3/2)", async () => {
    const w = world();
    const { runDir } = await w.launch({ files: false, manifest: false });
    mkdirSync(runDir, { recursive: true });
    const keys = [S1, S2, `${S2}-r1`];
    const lines = [
      { kind: "run-start" }, { kind: "stories-validated", count: 2, spec_folder: SPEC },
      ...keys.flatMap((k) => [{ kind: "story-start", story_key: k }, { kind: "story-done", story_key: k }]),
    ];
    writeFileSync(join(runDir, "journal.jsonl"), lines.map((l, i) => JSON.stringify({ ts: 1792300000 + i, ...l })).join("\n") + "\n");
    const r = projectOffice(w.queue).runs[0];
    expect(r.epic).toMatchObject({ done: 2, deferred: 0, failed: 0, total: 2 });
    expect(r.stories.map((s) => [s.key, s.status, s.extra])).toEqual([[S1, "done", undefined], [S2, "done", undefined], [`${S2}-r1`, "done", true]]);
  });

  test("the denominator is the launch's: a resume's later stories-validated never moves total", async () => {
    const w = world();
    const { runDir } = await w.launch({ files: false, manifest: false });
    mkdirSync(runDir, { recursive: true });
    const lines = [
      { kind: "run-start" }, { kind: "stories-validated", count: 4, spec_folder: SPEC },
      { kind: "story-start", story_key: S1 }, { kind: "story-done", story_key: S1 }, { kind: "run-paused" },
      { kind: "run-resume" }, { kind: "stories-validated", count: 6, spec_folder: "elsewhere" },
      { kind: "story-start", story_key: S2 },
    ];
    writeFileSync(join(runDir, "journal.jsonl"), lines.map((l, i) => JSON.stringify({ ts: 1792300000 + i, ...l })).join("\n") + "\n");
    const r = projectOffice(w.queue).runs[0];
    expect(r.epic).toMatchObject({ spec_folder: SPEC, done: 1, total: 4, current_story: S2 });
  });

  test("a relaunch's fresh journal: stories landed earlier count done by their story spec; the journal wins", async () => {
    const w = world();
    const { run, runDir } = await w.launch({ files: false });
    mkdirSync(runDir, { recursive: true });
    const stories = join(run.worktree!, SPEC, "stories");
    mkdirSync(stories, { recursive: true });
    writeFileSync(join(stories, `${S1}-spec.md`), "---\nstatus: done\ntitle: one\n---\n# one\n");
    writeFileSync(join(stories, `${S2}-spec.md`), "---\nstatus: 'Done'\n---\n");
    // Two specs for S4: ambiguous, never overridden (the engine's rule).
    writeFileSync(join(stories, `${S4}-spec.md`), "---\nstatus: done\n---\n");
    writeFileSync(join(stories, `${S4}-other.md`), "---\nstatus: done\n---\n");
    const write = (lines: Record<string, unknown>[]) =>
      writeFileSync(join(runDir, "journal.jsonl"), lines.map((l, i) => JSON.stringify({ ts: 1792300000 + i, ...l })).join("\n") + "\n");
    write([
      { kind: "run-start" }, { kind: "stories-validated", count: 4, spec_folder: SPEC },
      { kind: "story-start", story_key: S3 }, { kind: "story-done", story_key: S3 },
    ]);
    const r = projectOffice(w.queue).runs[0];
    expect(r.epic).toMatchObject({ done: 3, deferred: 0, failed: 0, total: 4, current_story: null });
    expect(r.stories.map((s) => [s.key, s.status, s.overlay])).toEqual([
      [S1, "done", "done"], [S2, "done", "done"], [S3, "done", "done"], [S4, "pending", null], [`${S2}-r1`, "pending", null],
    ]);
    // The journal wins: S2 escalated in this journal stays failed although its spec says done.
    write([
      { kind: "run-start" }, { kind: "stories-validated", count: 4, spec_folder: SPEC },
      { kind: "story-start", story_key: S2 }, { kind: "story-escalated", story_key: S2 },
    ]);
    const e = projectOffice(w.queue).runs[0];
    expect(e.epic).toMatchObject({ done: 1, failed: 1, total: 4 });
    expect(e.stories[1]).toMatchObject({ key: S2, status: "failed", overlay: "failed" });
    expect(projectOffice(w.queue).problems).toEqual([]);
    w.queue.close(); // the queue's SQLite file lives in w.dir: open, it keeps the directory busy on win32
    for (const d of [w.dir, w.checkout, run.worktree!]) rmSync(d, { recursive: true, force: true });
  });

  test("complete: 4/4, no current story", async () => {
    const w = world();
    await w.launch({ fixture: "complete" });
    expect(projectOffice(w.queue).runs[0].epic).toMatchObject({ done: 4, total: 4, current_story: null });
  });
});

describe("the stream (AC3)", () => {
  async function api(w: ReturnType<typeof world>, o: { heartbeatMs?: number; bufferSize?: number } = {}) {
    const hub = new OfficeHub({ queue: w.queue, graceMs: 0, pollMs: 10, ...(o.bufferSize ? { bufferSize: o.bufferSize } : {}) });
    const handler = createApi({ queue: w.queue, token: TOKEN, session: { secret: SECRET }, office: hub, heartbeatMs: o.heartbeatMs ?? 60_000, submit: async () => { throw new Error("never"); } });
    const open = (headers: Record<string, string> = {}) => {
      const ctl = new AbortController();
      const res = handler(new Request(`${BASE}/office/events`, { headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream", ...headers }, signal: ctl.signal }));
      return { ctl, res };
    };
    return { hub, handler, open };
  }
  async function reader(res: Promise<Response>) {
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    const rd = r.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const until = async (pred: (t: string) => boolean) => {
      const deadline = Date.now() + 5000;
      while (!pred(text) && Date.now() < deadline) {
        const { value, done } = await rd.read();
        if (done) break;
        text += dec.decode(value);
      }
      return text;
    };
    return { rd, until, text: () => text };
  }
  const frames = (text: string) => text.split("\n\n").filter((f) => f.startsWith("id:")).map((f) => {
    const [idLine, evLine, dataLine] = f.split("\n");
    return { id: idLine.slice(3), event: evLine.slice(6), data: JSON.parse(dataLine.slice(5)) };
  });

  test("snapshot first, then office.agent, office.progress, office.run in order; Last-Event-ID replays exactly the later deltas", async () => {
    const w = world();
    const { run, runDir } = await w.launch({ lines: CUT.dev, phases: { [S2]: "dev-running" } });
    const a = await api(w);
    const s = a.open();
    const r = await reader(s.res);
    await r.until((t) => t.includes("\n\n"));
    expect(r.text()).toStartWith("id:");
    const first = frames(r.text())[0];
    expect(first.event).toBe("snapshot");
    expect(first.data.agents.find((x: any) => x.agent_id === "p/implementer").state).toBe("typing");
    // A state change: the review session opens.
    appendFileSync(join(runDir, "journal.jsonl"), INFLIGHT.slice(CUT.dev, CUT.review).join("\n") + "\n");
    await r.until((t) => t.includes("event:office.agent"));
    // A story-done line: progress.
    appendFileSync(join(runDir, "journal.jsonl"), JSON.stringify({ ts: 1, kind: "story-done", story_key: S2, commit: "c" }) + "\n");
    await r.until((t) => t.includes("event:office.progress"));
    // A run state change.
    w.queue.markPaused(run.run_id, { engine: {} });
    await r.until((t) => t.includes("event:office.run"));
    const fs = frames(r.text());
    const kinds = fs.map((f) => f.event);
    expect(kinds[0]).toBe("snapshot");
    expect(kinds.indexOf("office.agent")).toBeLessThan(kinds.indexOf("office.progress"));
    expect(kinds.indexOf("office.progress")).toBeLessThan(kinds.indexOf("office.run"));
    expect(fs.find((f) => f.event === "office.agent" && f.data.agent_id === "p/reviewer")!.data).toMatchObject({ state: "reading", from: "idle", current_run: run.run_id });
    const progress = fs.find((f) => f.event === "office.progress")!;
    expect(progress.data).toMatchObject({ run_id: run.run_id, epic: { done: 2, total: 4 }, story: { key: S2, status: "done", overlay: "done" } });
    expect(fs.find((f) => f.event === "office.run")!.data).toEqual({ run_id: run.run_id, project: "p", state: "paused", from: "running" });
    // Ids are `<boot>-<seq>`, increasing.
    for (const f of fs) expect(f.id).toMatch(new RegExp(`^${a.hub.boot}-\\d+$`));
    s.ctl.abort();
    await r.rd.cancel().catch(() => {});

    // The reconnect from the progress frame: exactly the deltas after it, no snapshot.
    const later = fs.slice(fs.indexOf(progress) + 1);
    const again = a.open({ "last-event-id": progress.id });
    const r2 = await reader(again.res);
    await r2.until((t) => later.every((f) => t.includes(`id:${f.id}\n`)));
    expect(r2.text()).not.toContain("event:snapshot");
    expect(frames(r2.text()).map((f) => f.id)).toEqual(later.map((f) => f.id));
    again.ctl.abort();
    await r2.rd.cancel().catch(() => {});

    // A stale, foreign or malformed id gets the snapshot again.
    for (const id of [`${Number(a.hub.boot) - 1}-1`, "x", `${a.hub.boot}-99999`]) {
      const o = a.open({ "last-event-id": id });
      const r3 = await reader(o.res);
      await r3.until((t) => t.includes("\n\n"));
      expect(frames(r3.text())[0].event).toBe("snapshot");
      o.ctl.abort();
      await r3.rd.cancel().catch(() => {});
    }
  });

  test("an id older than the buffer is too old: since() answers null (the stream then sends the snapshot, above)", async () => {
    let t = 0;
    const raw = { state: "idle" as OfficeState };
    const hub = new OfficeHub({ queue: null as unknown as Queue, now: () => t, bufferSize: 2, project: () => ({ at: "", runs: [], problems: [], agents: [{ agent_id: "a", project: "p", role: "session", state: raw.state, current_run: null, current_story: null }] }) });
    const start = hub.snapshot().id;
    for (const s of ["typing", "blocked", "waiting-for-human"] as OfficeState[]) { raw.state = s; t += 30_000; hub.refresh(); }
    expect(hub.since(start)).toBeNull();
    expect(hub.since(`${hub.boot}-1`)!.map((e) => e.seq)).toEqual([2, 3]);
    expect(hub.since(hub.currentId())).toEqual([]);
  });

  test("a heartbeat comment on its own timer; the client's close clears both timers", async () => {
    const w = world();
    await w.launch({ lines: CUT.dev });
    const a = await api(w, { heartbeatMs: 20 });
    const intervals = new Set<unknown>();
    const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
    (globalThis as any).setInterval = (fn: () => void, ms: number) => { const h = realSet(fn, ms); intervals.add(h); return h; };
    (globalThis as any).clearInterval = (h: any) => { intervals.delete(h); return realClear(h); };
    try {
      const s = a.open();
      const r = await reader(s.res);
      await r.until((t) => t.includes(": heartbeat\n\n"));
      expect(r.text()).toContain(": heartbeat\n\n");
      expect(a.hub.subscribers).toBe(1);
      expect(a.hub.polling).toBe(true);
      expect(intervals.size).toBe(2); // the hub's poll and the heartbeat
      s.ctl.abort();
      await r.rd.cancel().catch(() => {});
      expect(a.hub.subscribers).toBe(0);
      expect(a.hub.polling).toBe(false);
      expect(intervals.size).toBe(0);
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
  });
});

describe("the routes (AC3)", () => {
  async function routed() {
    const w = world();
    const launched = await w.launch({ lines: CUT.gate });
    const handler = createApi({ queue: w.queue, token: TOKEN, session: { secret: SECRET }, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" }, submit: async () => { throw new Error("never"); } });
    const call = (method: string, path: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
      handler(new Request(`${BASE}${path}`, { method, headers }));
    return { ...w, ...launched, call };
  }

  test("GET /office: the snapshot (agents, live runs with progress, the time, the id)", async () => {
    const fx = await routed();
    const res = await fx.call("GET", "/office");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.at).toBe("string");
    expect(body.id).toMatch(/^\d+-\d+$/);
    expect(body.agents).toHaveLength(14);
    expect(body.agents.find((a: any) => a.agent_id === "p/planner")).toEqual({ agent_id: "p/planner", project: "p", role: "planner", state: "thinking", current_run: fx.run.run_id, current_story: S2 });
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ run_id: fx.run.run_id, project: "p", state: "running", epic: { done: 1, total: 4, current_story: S2 } });
    // Without the SSE accept the events route answers the JSON snapshot.
    const plain = await fx.call("GET", "/office/events");
    expect(plain.headers.get("content-type")).toStartWith("application/json");
    expect(((await plain.json()) as any).agents).toHaveLength(14);
  });

  test("a session cookie reads /office and /office/events; no auth is 401 JSON; POST is 405 Allow: GET", async () => {
    const fx = await routed();
    const cookie = `${SESSION_COOKIE}=${signSession(SECRET, "token", Date.now())}`;
    for (const path of ["/office", "/office/events"]) {
      expect((await fx.call("GET", path, { cookie })).status).toBe(200);
      const anon = await fx.call("GET", path, {});
      expect(anon.status).toBe(401);
      expect(anon.headers.get("content-type")).toStartWith("application/json");
      expect(await anon.json()).toMatchObject({ ok: false, error: "Unauthorized" });
      const post = await fx.call("POST", path);
      expect(post.status).toBe(405);
      expect(post.headers.get("allow")).toBe("GET");
    }
  });

  test("GETs of /office, /office/events and / write nothing: queue bytes and MAX(seq) unchanged", async () => {
    const fx = await routed();
    fx.queue.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = () => readFileSync(fx.db).toString("base64") + (existsSync(`${fx.db}-wal`) ? readFileSync(`${fx.db}-wal`).toString("base64") : "");
    const maxSeq = () => (fx.queue.db.query("SELECT MAX(seq) AS m FROM events").get() as { m: number | null }).m;
    const service = () => (fx.queue.db.query("SELECT COUNT(*) AS n FROM service_events").get() as { n: number }).n;
    const before = { bytes: bytes(), seq: maxSeq(), service: service() };
    for (const path of ["/office", "/office/events", "/", "/office"]) expect((await fx.call("GET", path)).status).toBe(200);
    expect({ bytes: bytes(), seq: maxSeq(), service: service() }).toEqual(before);
    // The SSE branch: the snapshot frame, polls and a heartbeat, then the close.
    const sse = createApi({ queue: fx.queue, token: TOKEN, session: { secret: SECRET }, env: {}, pollMs: 10, heartbeatMs: 20, submit: async () => { throw new Error("never"); } });
    const ctl = new AbortController();
    const res = await sse(new Request(`${BASE}/office/events`, { headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" }, signal: ctl.signal }));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const rd = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 5000;
    while (!(text.includes("event:snapshot") && text.includes(": heartbeat\n\n")) && Date.now() < deadline) {
      const { value, done } = await rd.read();
      if (done) break;
      text += dec.decode(value);
    }
    await Bun.sleep(50); // a few more polls
    expect(text).toContain("event:snapshot");
    expect(text).toContain(": heartbeat\n\n");
    ctl.abort();
    await rd.cancel().catch(() => {});
    expect({ bytes: bytes(), seq: maxSeq(), service: service() }).toEqual(before);
  });

  test("the raw GET /events stream is unchanged: ids are queue seqs, no office frame", async () => {
    const fx = await routed();
    const res = await fx.call("GET", "/events?since=0");
    const body = await res.json() as any;
    expect(body.events.every((e: any) => typeof e.seq === "number" && !String(e.kind).startsWith("office."))).toBe(true);
  });
});

describe("the status page's Office section (AC3)", () => {
  test("<section id=\"office\"> lists each live run's role: state lines as text", async () => {
    const w = world();
    const { run } = await w.launch({ lines: CUT.dev, phases: { [S2]: "dev-running" } });
    const html = renderPage(await gatherPage({ queue: w.queue, token: TOKEN, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" } }));
    const at = html.indexOf('<section id="office">');
    const section = html.slice(at, html.indexOf("</section>", at));
    expect(section).toContain("<h2>Office</h2>");
    expect(section).toContain(run.run_id);
    expect(section).toContain("epic 1/4");
    expect(section).toContain(`current story ${S2}`);
    expect(section).toContain("<li>implementer: typing</li>");
    expect(section).toContain("<li>session: typing</li>");
    expect(section).toContain("<li>consult: idle</li>");
    expect(section).not.toContain("<script");
  });

  test("a run without the project's agents names the run holding them; none at all keeps the plain note", async () => {
    const w = world();
    const older = await w.launch({ lines: CUT.dev });
    const root = mkdtempSync(join(tmpdir(), "tk-sup-office-checkout-"));
    const newer = await w.claim(w.queue.enqueue({ jobId: "another-job", root, projectId: "p", target: "skill", definition: { id: "another-job" } }).run);
    w.queue.enqueue({ jobId: "x", root, projectId: "unregistered", target: "skill", definition: { id: "x" } });
    const html = renderPage(await gatherPage({ queue: w.queue, token: TOKEN, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" } }));
    const at = html.indexOf('<section id="office">');
    const cards = html.slice(at, html.indexOf("</section>", at)).split('<div class="card">').slice(1);
    const card = (id: string) => cards.find((c) => c.startsWith(`<strong>${id}</strong>`))!;
    expect(card(newer.run_id)).toContain("<li>orchestrator: thinking</li>");
    expect(card(older.run.run_id)).toContain(`<p class="note">the project&#39;s agents are on run ${newer.run_id}</p>`);
    expect(card(older.run.run_id)).not.toContain("no registry agents for this run");
    expect(cards.find((c) => c.includes("project unregistered"))).toContain("no registry agents for this run");
    w.queue.close(); // the queue's SQLite file lives in w.dir: open, it keeps the directory busy on win32
    for (const d of [w.dir, w.checkout, root, older.run.worktree!, newer.worktree!]) rmSync(d, { recursive: true, force: true });
  });

  test("no live run: the section says so", async () => {
    const w = world();
    const html = renderPage(await gatherPage({ queue: w.queue, token: TOKEN, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" } }));
    expect(html).toContain('<section id="office"><h2>Office</h2><p class="note">no live runs</p></section>');
  });
});

describe("the registry's live_state (Story 29.2's field, stamped at rebuild)", () => {
  const ROUTE: Route = { session: { model: "m" }, implementer: { model: "m" }, reviewers: { model: "m" }, consult: { model: "m" }, supervise: { model: "m" }, planner: { model: "m" } };
  const deps = (live?: (q: Queue) => Record<string, string>) => {
    let tick = 0;
    return {
      registry: async () => ({ ok: true, projects: { p: { root: "/nowhere/p" }, q: { root: "/nowhere/q" } } }),
      resolve: async () => ROUTE,
      now: () => `2026-10-18T01:00:${String(++tick).padStart(2, "0")}.000Z`,
      personas: "/nowhere/personas.json",
      ...(live ? { live } : {}),
    };
  };

  test("a rebuild with a live dev run stamps implementer typing; another project stays offline", async () => {
    const w = world();
    await w.launch({ lines: CUT.dev, phases: { [S2]: "dev-running" } });
    expect(officeStates(w.queue)["p/implementer"]).toBe("typing");
    const res = await rebuildAgents(w.queue, deps());
    expect(res).toMatchObject({ rebuilt: true, problems: [] });
    const rows = Object.fromEntries(readAgents(w.queue).agents.map((a) => [a.agent_id, a.live_state]));
    expect(rows["p/implementer"]).toBe("typing");
    expect(rows["p/session"]).toBe("typing");
    expect(rows["p/consult"]).toBe("idle");
    expect(rows["q/implementer"]).toBe("offline");
  });

  test("a throwing projector stamps offline and names the problem; the rebuild still lands", async () => {
    const w = world();
    await w.launch({ lines: CUT.dev });
    const res = await rebuildAgents(w.queue, deps(() => { throw new Error("journal exploded"); }));
    if (!res.rebuilt) throw new Error("not rebuilt");
    expect(res.problems.some((p) => p.startsWith("OfficeProjectionFailed: journal exploded"))).toBe(true);
    expect(readAgents(w.queue).agents.every((a) => a.live_state === "offline")).toBe(true);
  });
});
