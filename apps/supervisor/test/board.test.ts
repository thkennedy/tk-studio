// Story 30.5: the board (`GET /board?project=<id>`) from the fixture plan directory (`fixtures/board`: EP and ST
// entities plus `index.md`, `deferred-work.md`, `budget-bands.yaml`, copied into a temp project root), a real
// `Queue` on a temp file driven through its own verbs, and a ledger written into a temp `TK_STUDIO_HOME`.
import { describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../src/api";
import { SESSION_COOKIE, signSession } from "../src/auth";
import { boardFor, openFindings, readPlan, type BoardAnswer, type LiveRunProgress } from "../src/board";
import { Queue, type Owner, type Probes, type QueueRun, type WorkerKill } from "../src/queue";

const FX = join(import.meta.dir, "fixtures", "board");
const TOKEN = "tok-30-5-board-secret";
const SECRET = "b".repeat(48);
const ME: Owner = { pid: process.pid, host: hostname(), nonce: "board-test" };
const BASE = "http://100.64.0.1:8787";
const PLAN = join("_bmad-output", "planning-artifacts", "plan");
const PR = (n: number) => `https://github.com/o/r/pull/${n}`;
const S2 = "30-2-the-supervisor-serves-the-web", S3 = "30-3-the-live-stream-in-the-browser", S4 = "30-4-the-office-screen";
const RED = { command: "bun test", argv: ["bun", "test"], cwd: ".", exit: 1, duration_ms: 5, green: false, stdout_tail: [], stderr_tail: ["1 fail"] };
const GREEN = { ...RED, exit: 0, green: true, stderr_tail: [] };

/** A project root holding the fixture at its real paths. */
function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tk-sup-board-root-"));
  cpSync(join(FX, "plan"), join(root, PLAN), { recursive: true });
  mkdirSync(join(root, "_bmad-output", "implementation-artifacts"), { recursive: true });
  copyFileSync(join(FX, "deferred-work.md"), join(root, "_bmad-output", "implementation-artifacts", "deferred-work.md"));
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  copyFileSync(join(FX, "budget-bands.yaml"), join(root, ".tk-studio", "budget-bands.yaml"));
  return root;
}

const job = (project: string | null, jobId: string, runId: string, cost?: number) => JSON.stringify({
  ts: "2026-10-19T00:00:00.000Z", event: "job-run", user: "u", machine: "m", ...(project ? { project } : {}),
  payload: { job_id: jobId, run_id: runId, state: "complete", ...(cost !== undefined ? { total_cost_usd: cost } : {}) },
});

function world() {
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-board-"));
  const probes: Probes = {
    ownerAlive: (o) => o.nonce === ME.nonce,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
  };
  const queue = new Queue(join(dir, "q.db"), probes);
  const root = fixtureRoot();
  const bare = mkdtempSync(join(tmpdir(), "tk-sup-board-noplan-"));
  const home = mkdtempSync(join(tmpdir(), "tk-sup-board-home-"));
  mkdirSync(join(home, "measurements"), { recursive: true });
  const ledger = join(home, "measurements", "u-m.jsonl");
  writeFileSync(ledger, [
    job("p", "run-epic-30", "s1", 3.5),
    job("p", "run-epic-30", "s1", 4), // a repeat finish (DW-5): the last wins, counted once
    job("p", "run-epic-30", "s2", 1.25),
    job("p", "tidy-docs", "s3", 100), // not a run-epic job: no epic
    job("q", "run-epic-30", "s4", 50), // another project's
    job(null, "run-epic-30", "s5", 70), // no project: never guessed
    job("p", "run-epic-31", "s6"), // no cost recorded
    job("my proj", "run-epic-30", "s8", 2), // the raw project id, as ledger.py writes it
    job("my_proj", "run-epic-30", "s9", 30), // its safe_name: another project's key
    "{not json",
    JSON.stringify({ ts: "x", event: "observation", payload: { job_id: "run-epic-30", run_id: "s7", total_cost_usd: 9 } }),
  ].join("\n") + "\n");
  const registry = async () => ({ projects: { p: { root }, n: { root: bare }, "my proj": { root } } });
  let live: LiveRunProgress[] = [];
  /** A run of `project` on its own checkout (one live run per job and checkout). */
  const enqueue = (project = "p", jobId = "run-epic-30") => {
    const checkout = mkdtempSync(join(tmpdir(), "tk-sup-board-checkout-"));
    return queue.enqueue({ jobId, root: checkout, projectId: project, target: "skill", definition: { id: jobId } }).run;
  };
  const claim = async (run: QueueRun) => {
    const c = await queue.claim(run.run_id, ME);
    if (!c.claimed) throw new Error(`not claimed: ${c.why}`);
    return queue.get(run.run_id)!;
  };
  const deps = (now = Date.now()) => ({
    queue, registry, env: { TK_STUDIO_HOME: home }, ledger: { user: "u", machine: "m" }, now: () => now, liveRuns: () => live,
  });
  const board = async (project = "p", now?: number) => (await boardFor(project, deps(now)))!;
  return { dir, queue, root, bare, home, ledger, registry, enqueue, claim, deps, board, setLive: (l: LiveRunProgress[]) => { live = l; } };
}

const storyOf = (b: BoardAnswer, id: string) => b.epics.flatMap((e) => e.stories).find((s) => s.id === id)!;
const ids = (items: { run_id: string }[]) => items.map((i) => i.run_id);

describe("the plan, the findings, the spend (AC1)", () => {
  test("epics with their stories and canonical statuses, in plan order", async () => {
    const w = world();
    const b = await w.board();
    expect(b.ok).toBe(true);
    expect(b.project).toBe("p");
    expect(b.plan).toEqual({});
    expect(b.epics.map((e) => [e.id, e.title, e.status])).toEqual([
      ["EP-030", "Studio Web v0: Office, Board, Status", "in-progress"],
      ["EP-031", "Inbox and Issues", "draft"],
    ]);
    expect(b.epics[0].stories.map((s) => [s.id, s.key, s.status])).toEqual([
      ["ST-109", "30.2", "done"], ["ST-110", "30.3", "review"], ["ST-111", "30.4", "in-progress"], ["ST-112", "30.5", "draft"],
    ]);
    expect(b.epics[1].stories.map((s) => s.id)).toEqual(["ST-120"]);
    expect(storyOf(b, "ST-112").run).toBeNull();
  });

  test("epics in numeric id order: EP-999 before EP-1000", async () => {
    const w = world();
    const entity = (id: string, n: number) => `---\nid: ${id}\ntype: epic\ntitle: "Epic ${n}"\nstatus: draft\nsource: "epics.md#epic-${n}"\n---\n`;
    writeFileSync(join(w.root, PLAN, "EP-1000.md"), entity("EP-1000", 1000));
    writeFileSync(join(w.root, PLAN, "EP-999.md"), entity("EP-999", 999));
    expect((await w.board()).epics.map((e) => e.id)).toEqual(["EP-030", "EP-031", "EP-999", "EP-1000"]);
  });

  test("open findings only, by story; a closed entry is not counted and the count drains", async () => {
    const w = world();
    const b = await w.board();
    expect(storyOf(b, "ST-110").findings).toEqual([{ id: "DW-2", title: "The stream's watchdog reopens every 15 s on a quiet office", severity: "medium" }]);
    // DW-6's status line sits after the next heading: the entry ends there, so it is not open.
    expect(storyOf(b, "ST-111").findings.map((f) => f.id)).toEqual(["DW-4"]);
    expect(b.epics[0].findings).toBe(2);
    expect(b.epics[1].findings).toBe(0);
    // Close DW-2: the count drains.
    const path = join(w.root, "_bmad-output", "implementation-artifacts", "deferred-work.md");
    writeFileSync(path, readFileSync(path, "utf-8").replace("reason: accepted for v0\nstatus: open", "reason: accepted for v0\nstatus: closed 2026-10-20"));
    const after = await w.board();
    expect(storyOf(after, "ST-110").findings).toEqual([]);
    expect(after.epics[0].findings).toBe(1);
  });

  test("the findings rule: legacy bullets and status-less entries are not open; the first word decides", () => {
    const text = "### DW-1: a\nstatus: open\n### DW-2: b\nstatus: opened later\n### DW-3: c\nsource_spec: `1-2-x.md`\n- **DW-9** — legacy\n### DW-4: d\nsource_spec: `3-4-y.md`\nstatus: open \n";
    expect(openFindings(text).map((f) => [f.id, f.story])).toEqual([["DW-1", null], ["DW-4", "3.4"]]);
  });

  test("spend: the project's run-epic job-run events, deduplicated by run id, against the epic's band", async () => {
    const w = world();
    const b = await w.board();
    expect(b.epics[0]).toMatchObject({ id: "EP-030", spend_usd: 5.25, band_usd: 40 });
    expect(b.epics[1]).toMatchObject({ id: "EP-031", spend_usd: 0, band_usd: null });
    // A later line for the same run replaces its cost (the ledger is re-read on a changed size).
    appendFileSync(w.ledger, job("p", "run-epic-30", "s2", 2) + "\n");
    expect((await w.board()).epics[0].spend_usd).toBe(6);
  });

  test("spend matches the ledger's raw project id, never its safe_name", async () => {
    const w = world();
    const b = await w.board("my proj");
    expect(b.epics[0]).toMatchObject({ id: "EP-030", spend_usd: 2 });
  });

  test("no band: no epics block, a non-positive or malformed value, an unparseable file", async () => {
    const w = world();
    const bands = join(w.root, ".tk-studio", "budget-bands.yaml");
    for (const text of [
      "bands:\n  S:\n    usd_estimate: 4.5\n",
      "epics:\n  EP-030:\n    usd_estimate: 0\n",
      "epics:\n  EP-030:\n    usd_estimate: -3\n",
      "epics:\n  EP-030:\n    usd_estimate: lots\n",
      "epics:\n  - EP-030\n",
      "epics:\n  EP-030: 40\n",
      "epics: [unclosed\n",
    ]) {
      writeFileSync(bands, text);
      expect((await w.board()).epics[0].band_usd).toBeNull();
    }
  });

  test("the plan part is cached: an unchanged read hits, a touched or edited entity rebuilds", async () => {
    const w = world();
    const first = readPlan(w.root);
    expect(readPlan(w.root)).toBe(first);
    const entity = join(w.root, PLAN, "ST-112.md");
    const later = new Date(Date.now() + 60_000);
    utimesSync(entity, later, later);
    const touched = readPlan(w.root);
    expect(touched).not.toBe(first);
    expect(touched).toEqual(first);
    expect(readPlan(w.root)).toBe(touched);
    writeFileSync(entity, readFileSync(entity, "utf-8").replace("status: draft", "status: in-progress"));
    expect(storyOf(await w.board(), "ST-112").status).toBe("in-progress");
  });

  test("the plan part is cached: adding or removing an entity file rebuilds", async () => {
    const w = world();
    const first = readPlan(w.root);
    expect(readPlan(w.root)).toBe(first);
    const source = join(w.root, PLAN, "ST-112.md");
    const added = join(w.root, PLAN, "ST-199.md");
    writeFileSync(added, readFileSync(source, "utf-8").replace(/^id: ST-112$/m, "id: ST-199"));
    const grown = readPlan(w.root);
    expect(grown).not.toBe(first);
    expect(grown.stories.some((s) => s.id === "ST-199")).toBe(true);
    expect(readPlan(w.root)).toBe(grown);
    rmSync(added);
    const shrunk = readPlan(w.root);
    expect(shrunk).not.toBe(grown);
    expect(shrunk.stories.some((s) => s.id === "ST-199")).toBe(false);
  });

  test("a project with no plan directory: an empty board naming the reason, the triage still filled", async () => {
    const w = world();
    const run = w.enqueue("n");
    const b = await w.board("n");
    expect(b.epics).toEqual([]);
    expect(b.plan.reason).toBe("no plan directory: _bmad-output/planning-artifacts/plan");
    expect(ids(b.triage.working)).toEqual([run.run_id]);
  });

  test("an unregistered project is null", async () => {
    const w = world();
    expect(await boardFor("nope", w.deps())).toBeNull();
  });
});

describe("the runs and the triage (AC1, AC2)", () => {
  test("each story's latest run: state, PR, host-verify outcome, end time", async () => {
    const w = world();
    const older = await w.claim(w.enqueue());
    w.queue.note(older.run_id, "plan-status", { phase: "review", pr: PR(1), story_key: S2, id: "ST-109", ok: true });
    w.queue.end(older.run_id, "partial", "host verify red", { detail: { pr: PR(1) } });
    const newer = await w.claim(w.enqueue());
    w.queue.note(newer.run_id, "host-verify", GREEN);
    w.queue.note(newer.run_id, "plan-status", { phase: "review", pr: PR(2), story_key: S2, id: "ST-109", ok: true });
    w.queue.end(newer.run_id, "complete", null, { detail: { pr: PR(2) } });
    const ended = w.queue.events(newer.run_id).findLast((e) => e.kind === "ended")!;
    const b = await w.board();
    expect(storyOf(b, "ST-109").run).toEqual({ run_id: newer.run_id, state: "complete", pr: PR(2), host_verify: "green", ended_at: ended.at });
    // A paused run names its story through the pause; a live run through its progress.
    const paused = await w.claim(w.enqueue());
    w.queue.markPaused(paused.run_id, { engine: { paused_story_key: S3, paused_stage: "escalation", paused_reason: "the gate vetoed" }, pr: PR(3) });
    const running = await w.claim(w.enqueue());
    w.setLive([{ run_id: running.run_id, epic: { current_story: S4 }, stories: [{ key: S4, status: "current" }, { key: "30-5-the-board-screen", status: "pending" }] }]);
    const c = await w.board();
    expect(storyOf(c, "ST-110").run).toEqual({ run_id: paused.run_id, state: "paused", pr: PR(3), host_verify: null, ended_at: null });
    expect(storyOf(c, "ST-111").run).toMatchObject({ run_id: running.run_id, state: "running", pr: null });
    expect(storyOf(c, "ST-112").run).toBeNull();
  });

  test("a relaunch's live `done` never takes a story an earlier run covered; a story only it names is its own", async () => {
    const w = world();
    const earlier = await w.claim(w.enqueue());
    w.queue.note(earlier.run_id, "host-verify", GREEN);
    w.queue.note(earlier.run_id, "plan-status", { phase: "review", pr: PR(1), story_key: S2, id: "ST-109", ok: true });
    w.queue.end(earlier.run_id, "complete", null, { detail: { pr: PR(1) } });
    const relaunch = await w.claim(w.enqueue());
    // The office marks 30.2 done from its landed spec file (`specsDone`) and 30.3 likewise, which no run covered.
    w.setLive([{ run_id: relaunch.run_id, epic: { current_story: S4 }, stories: [
      { key: S2, status: "done" }, { key: S3, status: "done" }, { key: S4, status: "current" },
    ] }]);
    const b = await w.board();
    expect(storyOf(b, "ST-109").run).toMatchObject({ run_id: earlier.run_id, state: "complete", pr: PR(1), host_verify: "green" });
    expect(storyOf(b, "ST-110").run).toMatchObject({ run_id: relaunch.run_id, state: "running", pr: null });
    expect(storyOf(b, "ST-111").run).toMatchObject({ run_id: relaunch.run_id, state: "running" });
  });

  test("a story's host-verify outcome: red and skipped", async () => {
    const w = world();
    const red = await w.claim(w.enqueue());
    w.queue.note(red.run_id, "host-verify", RED);
    w.queue.note(red.run_id, "plan-status", { phase: "review", pr: PR(5), story_key: S3, id: "ST-110", ok: true });
    const skipped = await w.claim(w.enqueue());
    w.queue.note(skipped.run_id, "host-verify", { skipped: true, reason: "another tier" });
    w.queue.note(skipped.run_id, "plan-status", { phase: "review", pr: PR(6), story_key: S4, id: "ST-111", ok: true });
    const b = await w.board();
    expect(storyOf(b, "ST-110").run).toMatchObject({ run_id: red.run_id, host_verify: "red" });
    expect(storyOf(b, "ST-111").run).toMatchObject({ run_id: skipped.run_id, host_verify: "skipped" });
  });

  test("the columns: paused, awaiting a ruling and a red host leg need you; running works; ended today is done", async () => {
    const w = world();
    const paused = await w.claim(w.enqueue());
    w.queue.markPaused(paused.run_id, { engine: { paused_story_key: S3, paused_reason: "the gate vetoed" }, pr: PR(3) });
    const awaiting = await w.claim(w.enqueue());
    w.queue.markPaused(awaiting.run_id, { engine: { paused_story_key: S4, paused_reason: "escalated" } });
    w.queue.note(awaiting.run_id, "awaiting-ruling", { story_key: S4, reason: "which spec wins?" });
    const red = await w.claim(w.enqueue());
    w.queue.note(red.run_id, "host-verify", RED);
    const running = await w.claim(w.enqueue());
    const queued = w.enqueue();
    const today = await w.claim(w.enqueue());
    w.queue.note(today.run_id, "host-verify", GREEN);
    w.queue.end(today.run_id, "complete", null, { detail: { pr: PR(7) } });
    const redToday = await w.claim(w.enqueue());
    w.queue.note(redToday.run_id, "host-verify", RED);
    w.queue.end(redToday.run_id, "partial", "host verify red", { detail: { pr: PR(8) } });
    const yesterday = await w.claim(w.enqueue());
    w.queue.end(yesterday.run_id, "complete", null, { detail: { pr: PR(9) } });
    const yAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    w.queue.db.query("UPDATE events SET at = ? WHERE run_id = ? AND kind = 'ended'").run(yAt, yesterday.run_id);
    w.enqueue("q"); // another project's run: never on this board

    const b = await w.board();
    expect(ids(b.triage.needs_you)).toEqual([paused.run_id, awaiting.run_id, red.run_id, redToday.run_id]);
    expect(ids(b.triage.working)).toEqual([running.run_id, queued.run_id]);
    expect(ids(b.triage.done)).toEqual([today.run_id]);
    expect(b.triage.needs_you[0]).toEqual({ run_id: paused.run_id, state: "paused", story_key: S3, pr: PR(3), ruling: "the gate vetoed" });
    expect(b.triage.needs_you[1]).toEqual({ run_id: awaiting.run_id, state: "paused", story_key: S4, pr: null, ruling: "which spec wins?" });
    expect(b.triage.needs_you[2]).toMatchObject({ run_id: red.run_id, state: "running", ruling: null });
    expect(b.triage.needs_you[3]).toEqual({ run_id: redToday.run_id, state: "partial", story_key: null, pr: PR(8), ruling: null });
    expect(b.triage.done[0]).toEqual({ run_id: today.run_id, state: "complete", story_key: null, pr: PR(7), ruling: null });
    // Every live run in exactly one column.
    const live = [paused, awaiting, red, running, queued].map((r) => r.run_id);
    const placed = [...b.triage.needs_you, ...b.triage.working].map((i) => i.run_id).filter((id) => live.includes(id));
    expect(placed.sort()).toEqual([...live].sort());
    // Tomorrow, the runs ended today are no longer done.
    const tomorrow = await w.board("p", Date.now() + 2 * 86_400_000);
    expect(tomorrow.triage.done).toEqual([]);
    expect(ids(tomorrow.triage.needs_you)).toEqual([paused.run_id, awaiting.run_id, red.run_id]);
  });

  test("a red host leg needs you only when recorded after the run's latest `launched`", async () => {
    const w = world();
    const launch = (run: QueueRun, engineId: string) => {
      w.queue.recordWorktree(run.run_id, mkdtempSync(join(tmpdir(), "tk-sup-board-wt-")), { branch: "b", base_ref: "main" });
      w.queue.markLaunched(run.run_id, engineId, { end: {} });
    };
    // Resumed or relaunched after a red host leg, no new host-verify yet: working.
    const resumed = await w.claim(w.enqueue());
    w.queue.note(resumed.run_id, "host-verify", RED);
    launch(resumed, "20261019-000003-board");
    // Red after its launch: still needs you.
    const redAfter = await w.claim(w.enqueue());
    launch(redAfter, "20261019-000004-board");
    w.queue.note(redAfter.run_id, "host-verify", RED);
    const b = await w.board();
    expect(ids(b.triage.working)).toEqual([resumed.run_id]);
    expect(ids(b.triage.needs_you)).toEqual([redAfter.run_id]);
    expect(b.triage.needs_you[0]).toMatchObject({ state: "running" });
  });

  test("a paused run's ruling by the office's full rule: state.json's paused_reason, else the journal's escalation", async () => {
    const w = world();
    /** A paused run whose queue `paused` event carries no reason; its engine files under its worktree. */
    const pausedWith = async (engineId: string, files: { state?: unknown; journal?: unknown[] }) => {
      const run = await w.claim(w.enqueue());
      w.queue.recordWorktree(run.run_id, mkdtempSync(join(tmpdir(), "tk-sup-board-wt-")), { branch: "b", base_ref: "main" });
      const launched = w.queue.markLaunched(run.run_id, engineId, { end: {} });
      const runDir = join(launched.worktree!, ".bmad-loop", "runs", engineId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "state.json"), JSON.stringify(files.state ?? {}));
      writeFileSync(join(runDir, "journal.jsonl"), (files.journal ?? []).map((e) => JSON.stringify(e)).join("\n") + "\n");
      w.queue.markPaused(run.run_id, { engine: { paused_story_key: S3 } });
      return run;
    };
    const fromState = await pausedWith("20261019-000001-board", { state: { paused_reason: "budget band exceeded" } });
    const fromJournal = await pausedWith("20261019-000002-board", { journal: [{ kind: "story-escalated", story_key: S3, reason: "the spec contradicts itself" }] });
    const b = await w.board();
    expect(b.triage.needs_you.map((i) => [i.run_id, i.ruling])).toEqual([
      [fromState.run_id, "budget band exceeded"], [fromJournal.run_id, "the spec contradicts itself"],
    ]);
  });

  test("a run that ended with a ruling still awaited is triaged with no ruling: only a live run is asking", async () => {
    const w = world();
    const ended = await w.claim(w.enqueue());
    w.queue.note(ended.run_id, "awaiting-ruling", { story_key: S4, reason: "which spec wins?" });
    w.queue.end(ended.run_id, "partial", "stopped while awaiting a ruling", { detail: { pr: PR(4) } });
    const b = await w.board();
    expect(b.triage.needs_you).toEqual([]);
    expect(b.triage.done).toEqual([{ run_id: ended.run_id, state: "partial", story_key: S4, pr: PR(4), ruling: null }]);
  });
});

describe("the route (AC1)", () => {
  function routed() {
    const w = world();
    const handler = createApi({
      queue: w.queue, token: TOKEN, session: { secret: SECRET }, env: { TK_STUDIO_HOME: w.home }, registry: w.registry,
      ledger: { user: "u", machine: "m" }, submit: async () => { throw new Error("never"); },
    });
    const call = (method: string, path: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
      handler(new Request(`${BASE}${path}`, { method, headers }));
    return { ...w, call };
  }

  test("GET /board?project=p: 200 with the board; no project 400; unknown 404; POST 405 Allow: GET", async () => {
    const fx = routed();
    const ok = await fx.call("GET", "/board?project=p");
    expect(ok.status).toBe(200);
    const body = await ok.json() as BoardAnswer;
    expect(body.ok).toBe(true);
    expect(body.epics.map((e) => e.id)).toEqual(["EP-030", "EP-031"]);
    expect(body.epics[0]).toMatchObject({ spend_usd: 5.25, band_usd: 40, findings: 2 });
    expect(typeof body.built_at).toBe("string");
    expect(body.triage).toEqual({ needs_you: [], working: [], done: [] });
    for (const path of ["/board", "/board?project=", "/board?project=%20"]) {
      const res = await fx.call("GET", path);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, error: "ProjectRequired" });
    }
    const unknown = await fx.call("GET", "/board?project=nope");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ ok: false, error: "UnknownProject", project: "nope" });
    for (const proto of ["__proto__", "constructor"]) { // an inherited member is no project
      const res = await fx.call("GET", `/board?project=${proto}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ ok: false, error: "UnknownProject", project: proto });
    }
    const post = await fx.call("POST", "/board?project=p");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
  });

  test("a session cookie reads /board; no auth is 401 JSON", async () => {
    const fx = routed();
    const cookie = `${SESSION_COOKIE}=${signSession(SECRET, "token", Date.now())}`;
    const viaCookie = await fx.call("GET", "/board?project=p", { cookie });
    expect(viaCookie.status).toBe(200);
    expect(((await viaCookie.json()) as BoardAnswer).epics).toHaveLength(2);
    const anon = await fx.call("GET", "/board?project=p", {});
    expect(anon.status).toBe(401);
    expect(anon.headers.get("content-type")).toStartWith("application/json");
    expect(await anon.json()).toMatchObject({ ok: false, error: "Unauthorized" });
  });
});
