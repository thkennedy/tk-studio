import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOfficeStore } from "../live/store";
import type { RunAnswer, RunEvent } from "../run/model";
import { beginCancel, cancelButtons, CANCELLING, fetchStatus, LOADING_QUEUE, LOADING_START, liveSignature, queueNotice, mergeDetails, NONE, PENDING, queueRows, STATUS_PAGE_URL, statusView, type StatusAnswer, type StatusLiveRun } from "./model";

const epic = (done: number, total: number, current: string | null) => ({ spec_folder: "spec-epic-30", done, deferred: 0, failed: 0, total, current_story: current });

/** A store fed one snapshot with the extras, then a progress-born row (`state: null`) by delta. */
function fixture() {
  const store = createOfficeStore();
  store.applySnapshot("b-5", {
    at: "2026-10-19T10:00:00.000Z",
    agents: [
      { agent_id: "proj/implementer", project: "proj", role: "implementer", state: "typing", current_run: "r1", current_story: "30-6", reason: null },
      { agent_id: "proj/sm", project: "proj", role: "sm", state: "waiting-for-human", current_run: "r2", current_story: null, reason: "reconcile_verdict: escalate" },
    ],
    runs: [
      { run_id: "r1", project: "proj", state: "running", engine_run_id: "eng-1", epic: epic(5, 7, "30-6"), stories: [{ key: "30-6", title: "The Status Screen", status: "current", phase: "dev", overlay: null }] },
      { run_id: "r2", project: "proj", state: "paused", engine_run_id: null, epic: epic(1, 3, null), stories: [] },
      { run_id: "r3", project: "proj", state: "complete", engine_run_id: "eng-3", epic: epic(3, 3, null), stories: [] },
    ],
    problems: ["one problem"],
    last_run: { proj: { run_id: "r0", state: "complete", pr: "https://github.com/o/r/pull/3", ended_at: "2026-10-19T09:00:00.000Z" } },
    supervisor: { version: "0.1.2", counts: { running: 1, paused: 1, complete: 4, cancelled: 2 } },
    ledger: { path: "measurements/op-box.jsonl", lines: ['{"n":1}', '{"n":2}'] },
    id: "b-5",
  });
  store.applyDelta("b-6", "office.progress", { run_id: "r9", epic: epic(0, 2, null) });
  return store;
}

describe("statusView (Story 30.6)", () => {
  it("the counts (sorted, with the total), the version and the ledger lines from the snapshot", () => {
    const v = statusView(fixture().getState());
    expect(v.loaded).toBe(true);
    expect(v.version).toBe("0.1.2");
    expect(v.counts).toEqual([{ state: "cancelled", count: 2 }, { state: "complete", count: 4 }, { state: "paused", count: 1 }, { state: "running", count: 1 }]);
    expect(v.total).toBe(8);
    expect(v.ledger).toEqual({ path: "measurements/op-box.jsonl", lines: ['{"n":1}', '{"n":2}'] });
  });

  it("live runs exclude state: null rows and terminal states", () => {
    const store = fixture();
    expect(store.getState().view?.runs.map((r) => r.run_id)).toEqual(["r1", "r2", "r3", "r9"]);
    const v = statusView(store.getState());
    expect(v.liveRuns).toEqual([
      { run_id: "r1", project: "proj", state: "running", engine_run_id: "eng-1" },
      { run_id: "r2", project: "proj", state: "paused", engine_run_id: NONE },
    ]);
    expect(v.office.runs.map((r) => r.run_id)).toEqual(["r1", "r2"]);
  });

  it("the agents and the office section (runs' epic and stories, agents' state and reason, problems, last_run)", () => {
    const v = statusView(fixture().getState());
    expect(v.agents).toEqual([
      { agent_id: "proj/implementer", project: "proj", role: "implementer", state: "typing", reason: null, current_run: "r1", current_story: "30-6" },
      { agent_id: "proj/sm", project: "proj", role: "sm", state: "waiting-for-human", reason: "reconcile_verdict: escalate", current_run: "r2", current_story: NONE },
    ]);
    expect(v.office.runs[0]).toEqual({ run_id: "r1", project: "proj", progress: "5/7", current_story: "30-6", stories: [{ key: "30-6", title: "The Status Screen", status: "current" }] });
    expect(v.office.problems).toEqual(["one problem"]);
    expect(v.office.lastRuns).toEqual([{ project: "proj", run_id: "r0", state: "complete", pr: "https://github.com/o/r/pull/3", ended_at: "2026-10-19T09:00:00.000Z" }]);
  });

  it("before a snapshot, and a snapshot without the extras", () => {
    const empty = statusView(createOfficeStore().getState());
    expect(empty).toMatchObject({ loaded: false, version: NONE, counts: null, total: 0, liveRuns: [], agents: [], ledger: null });
    const store = createOfficeStore();
    store.applySnapshot("b-1", { at: "x", agents: [], runs: [], problems: [], id: "b-1" });
    const bare = statusView(store.getState());
    expect(bare).toMatchObject({ loaded: true, version: NONE, counts: null, ledger: null });
    expect(PENDING).toBe("pending");
  });

  it("a ledger note passes through; the page link is the absolute /status", () => {
    const store = createOfficeStore();
    const note = { path: "measurements/op-box.jsonl", note: "measurements/op-box.jsonl not found" };
    store.applySnapshot("b-1", { at: "x", agents: [], runs: [], problems: [], ledger: note, id: "b-1" });
    expect(statusView(store.getState()).ledger).toEqual(note);
    expect(STATUS_PAGE_URL).toBe("/status");
  });

  // Story 39.5: the screen reads `GET /status` and the live runs' `GET /runs/{id}` on store changes, never on a timer;
  // its one interval ticks the clocks' `now` only, and the only `fetch` is the model's injectable default seam.
  it("src/status holds no fetch timer: the screen's one interval ticks now; fetch only as the model's default seam", () => {
    const timer = ["set", "Interval", "("].join("");
    const fetchCall = ["fet", "ch("].join("");
    const dir = fileURLToPath(new URL(".", import.meta.url));
    for (const f of readdirSync(dir).filter((n) => !n.endsWith(".test.ts"))) {
      const text = readFileSync(join(dir, f), "utf-8");
      const intervals = text.split(timer).length - 1;
      const fetches = text.split(fetchCall).length - 1;
      if (f === "StatusScreen.tsx") {
        expect({ f, intervals, fetches }).toEqual({ f, intervals: 1, fetches: 0 });
        expect(text).toContain(`${timer}() => setNow(Date.now()), 1000)`);
      } else {
        expect({ f, intervals, fetches }).toEqual({ f, intervals: 0, fetches: f === "model.ts" ? 1 : 0 });
      }
    }
  });
});

describe("the queue (Story 39.5, Settled shape 7)", () => {
  const T0 = Date.parse("2026-11-10T00:00:00.000Z");
  const at = (s: number) => new Date(T0 + s * 1000).toISOString();
  const base = (over: Partial<StatusLiveRun>): StatusLiveRun => ({
    run_id: "x", job_id: "run-epic-39", project_id: "proj", state: "running", reason: null, created: at(0), engine_run_id: null, worker_pid: null,
    worker_guard_s: null, definition: null, ...over,
  });
  const status: StatusAnswer = {
    ok: true, counts: {},
    live: [
      base({ run_id: "r-paused", state: "paused", created: at(5), engine_run_id: "eng-p", worker_pid: 3 }),
      base({ run_id: "r-running", state: "running", created: at(4), engine_run_id: "eng-r", worker_pid: 2 }),
      base({ run_id: "r-claimed", state: "running", created: at(3) }),
      base({ run_id: "r-q2", state: "queued", created: at(2), claim_refused: { reason: "the checkout is locked", resolves: "the holder ends" } }),
      base({ run_id: "r-q1", state: "queued", created: at(1) }),
    ],
  };
  let seq = 0;
  const ev = (s: number, kind: string, detail: Record<string, unknown> = {}): RunEvent => ({ seq: ++seq, at: at(s), kind, from_state: "running", to_state: "running", detail });
  const detail = (run: StatusLiveRun, events: RunEvent[]): RunAnswer => ({ ok: true, run_id: run.run_id, studio_run_id: null, state: run.state, cost_usd: null, run, events });

  function store() {
    const s = createOfficeStore();
    s.applySnapshot("b-1", {
      at: "x", problems: [], id: "b-1",
      agents: [
        { agent_id: "proj/orchestrator", project: "proj", role: "orchestrator", state: "waiting-for-human", current_run: "r-paused", current_story: null, reason: "a ruling on 39-5", blocked_issue: { issue: "TKS-42", state: "open" } },
      ],
      runs: [{ run_id: "r-running", project: "proj", state: "running", engine_run_id: "eng-r", stage: "review pass 2 of 2", epic: epic(1, 4, "39-5-the-run"), stories: [] }],
    });
    return s;
  }

  it("the groups in order (queued, claimed, running, paused), by created within a group; each links its run page", () => {
    const rows = queueRows(status, {}, store().getState(), T0 + 60_000);
    expect(rows.map((r) => [r.run_id, r.state])).toEqual([["r-q1", "queued"], ["r-q2", "queued"], ["r-claimed", "claimed"], ["r-running", "running"], ["r-paused", "paused"]]);
    expect(rows.map((r) => r.href)).toEqual(rows.map((r) => `/app/run/${r.run_id}`));
    expect(rows.every((r) => r.job === "run-epic-39" && r.cancel.show && r.cancel.enabled)).toBe(true);
  });

  it("the story from the store (else no story yet); start and clock pending in words until the run's detail is read", () => {
    const rows = queueRows(status, {}, store().getState(), T0 + 60_000);
    const byId = Object.fromEntries(rows.map((r) => [r.run_id, r]));
    expect(byId["r-running"].story).toBe("39-5-the-run");
    expect(byId["r-claimed"].story).toBe("no story yet");
    expect(byId["r-running"]).toMatchObject({ start: LOADING_START, clock: "Loading the clock…" });
    expect(byId["r-q1"]).toMatchObject({ start: at(1), clock: "00:00:59 queued (no guard until a worker starts)" });
    const running = status.live[1];
    seq = 0;
    const read = queueRows(status, { "r-running": detail(running, [ev(10, "claimed"), ev(20, "worker", { guard_s: 7200 }), ev(30, "launched")]) }, store().getState(), T0 + 4380_000);
    expect(read.find((r) => r.run_id === "r-running")).toMatchObject({ start: at(10), clock: "01:12:40 of 02:00:00" });
  });

  it("a failed re-read keeps the last answer; a run never read shows the failure, not a loading label (mergeDetails)", () => {
    const running = status.live[1];
    seq = 0;
    const answer = detail(running, [ev(10, "claimed"), ev(20, "worker", { guard_s: 7200 }), ev(30, "launched")]);
    const first = mergeDetails({}, [{ run_id: "r-running", result: { ok: true, answer } }, { run_id: "r-claimed", result: { ok: false, error: "/runs/r-claimed answered 500" } }]);
    expect(first.details).toEqual({ "r-running": answer });
    expect(first.errors).toEqual({ "r-claimed": "/runs/r-claimed answered 500" });
    const again = mergeDetails(first.details, [{ run_id: "r-running", result: { ok: false, error: "/runs/r-running: offline" } }]);
    expect(again.details).toEqual({ "r-running": answer });
    const rows = queueRows(status, again.details, store().getState(), T0 + 4380_000, { ...first.errors, ...again.errors });
    const byId = Object.fromEntries(rows.map((r) => [r.run_id, r]));
    expect(byId["r-running"]).toMatchObject({ start: at(10), clock: "01:12:40 of 02:00:00" });
    expect(byId["r-claimed"]).toMatchObject({
      start: "The start could not be read: /runs/r-claimed answered 500", clock: "The clock could not be read: /runs/r-claimed answered 500",
    });
    // A run no longer read (not live) drops out.
    expect(mergeDetails(first.details, []).details).toEqual({});
  });

  it("a paused run: the agent's reason in words and its inbox item; without either, the run's reason or none recorded", () => {
    const rows = queueRows(status, {}, store().getState(), T0);
    expect(rows.find((r) => r.run_id === "r-paused")!.paused).toEqual({ reason: "Paused: a ruling on 39-5", inbox: { key: "TKS-42", href: "/app/inbox/TKS-42" } });
    const bare = createOfficeStore();
    bare.applySnapshot("b-1", { at: "x", agents: [], runs: [], problems: [], id: "b-1" });
    const noAgent = queueRows(status, {}, bare.getState(), T0).find((r) => r.run_id === "r-paused")!;
    expect(noAgent.paused).toEqual({ reason: "Paused: no reason recorded", inbox: null });
    const withReason: StatusAnswer = { ...status, live: [base({ run_id: "r-p", state: "paused", reason: "the run's reason" })] };
    expect(queueRows(withReason, {}, bare.getState(), T0)[0].paused!.reason).toBe("Paused: the run's reason");
    expect(rows.find((r) => r.run_id === "r-running")!.paused).toBeNull();
  });

  it("a queued run the drain refused names the reason and what resolves it", () => {
    const rows = queueRows(status, {}, store().getState(), T0);
    expect(rows.find((r) => r.run_id === "r-q2")!.refused).toBe("Waiting to be claimed: the checkout is locked (resolve: the holder ends)");
    expect(rows.find((r) => r.run_id === "r-q1")!.refused).toBeNull();
  });

  it("Cancel: an external run is disabled with its words; the signature names each run's state and stage", () => {
    const ext: StatusAnswer = { ...status, live: [base({ run_id: "r-x", state: "external" })] };
    expect(queueRows(ext, {}, store().getState(), T0)[0].cancel).toEqual({ show: true, enabled: false, note: "Started outside the queue: the supervisor never cancels it" });
    expect(liveSignature(store().getState())).toBe("r-running:running:review pass 2 of 2::");
  });

  it("the signature changes when a run's worker does (operator ruling 2026-11-10, the second)", () => {
    const s = store();
    const before = liveSignature(s.getState());
    const since = "2026-11-10T08:00:00Z";
    s.applyDelta("b-9", "office.progress", { run_id: "r-running", epic: s.getState().view!.runs[0].epic, stage: "review pass 2 of 2", leg: null, worker: { since } });
    const started = liveSignature(s.getState());
    expect(started).not.toBe(before);
    expect(started).toContain(since);
    s.applyDelta("b-10", "office.progress", { run_id: "r-running", epic: s.getState().view!.runs[0].epic, stage: "review pass 2 of 2", leg: null, worker: null });
    expect(liveSignature(s.getState())).toBe(before);
  });

  it("R4: a failed first GET /status stands in place of Loading the queue…, never both", () => {
    expect(queueNotice(null, null)).toEqual({ loading: LOADING_QUEUE });
    expect(queueNotice(null, "/status answered 502")).toEqual({ error: "/status answered 502" });
    expect(queueNotice(status, null)).toBeNull();
    expect(queueNotice(status, "/status answered 502")).toEqual({ error: "/status answered 502" }); // a failed re-read: the queue stays
  });

  it("R5: a run's Cancel in flight disables its buttons and says so; a second click posts nothing", () => {
    const none = new Set<string>();
    expect(cancelButtons("r-1", { enabled: true }, none)).toEqual({ disabled: false, label: null });
    expect(cancelButtons("r-1", { enabled: false }, none)).toEqual({ disabled: true, label: null });
    const flying = beginCancel(none, "r-1")!;
    expect([...flying]).toEqual(["r-1"]);
    expect(cancelButtons("r-1", { enabled: true }, flying)).toEqual({ disabled: true, label: CANCELLING });
    expect(CANCELLING).toBe("Cancelling…");
    expect(cancelButtons("r-2", { enabled: true }, flying)).toEqual({ disabled: false, label: null }); // another row
    expect(beginCancel(flying, "r-1")).toBeNull(); // the second click: nothing to post
    expect([...beginCancel(flying, "r-2")!].sort()).toEqual(["r-1", "r-2"]);
  });

  it("the signature changes when a run's leg does (operator ruling 2026-11-10)", () => {
    const s = store();
    const before = liveSignature(s.getState());
    const since = "2026-11-10T08:00:00Z";
    s.applyDelta("b-9", "office.progress", { run_id: "r-running", epic: s.getState().view!.runs[0].epic, stage: "review pass 2 of 2", leg: { since } });
    const leased = liveSignature(s.getState());
    expect(leased).not.toBe(before);
    expect(leased).toContain(since);
    s.applyDelta("b-10", "office.progress", { run_id: "r-running", epic: s.getState().view!.runs[0].epic, stage: "review pass 2 of 2", leg: null });
    expect(liveSignature(s.getState())).toBe(before);
  });

  it("the screen renders the Queue section (rows linking q.href) before the counts; the old Live runs list is gone", () => {
    const text = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "StatusScreen.tsx"), "utf-8");
    const queue = text.indexOf("<h2 style={h2}>Queue");
    expect(queue).toBeGreaterThan(-1);
    expect(queue).toBeLessThan(text.indexOf("<h2 style={h2}>Counts</h2>"));
    expect(text.indexOf("<a href={q.href}")).toBeGreaterThan(queue);
    expect(text.indexOf("<a href={q.href}")).toBeLessThan(text.indexOf("<h2 style={h2}>Counts</h2>"));
    expect(text).not.toContain("Live runs (");
  });

  it("fetchStatus reads GET /status as JSON", async () => {
    const r = await fetchStatus(async (url, init) => {
      expect(url).toBe("/status");
      expect((init?.headers as Record<string, string>).accept).toBe("application/json");
      return { ok: true, status: 200, json: async () => ({ ok: true, counts: { running: 1 }, live: [status.live[0], { nope: 1 }] }) };
    });
    expect(r.ok && r.status.live.map((x) => x.run_id)).toEqual(["r-paused"]);
    expect(await fetchStatus(async () => ({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) }))).toEqual({ ok: false, error: "/status answered 401 Unauthorized" });
  });
});
