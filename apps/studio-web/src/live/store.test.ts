import { describe, expect, it, vi } from "vitest";
import { createOfficeStore, parseId, type OfficeRun } from "./store";

const epic = (over: Partial<OfficeRun["epic"]> = {}): OfficeRun["epic"] => ({
  spec_folder: "spec-epic-30", done: 1, deferred: 0, failed: 0, total: 7, current_story: "30-3", ...over,
});

const snapshot = (id = "b-5") => ({
  at: "2026-10-19T10:00:00.000Z",
  agents: [{ agent_id: "proj/sm", project: "proj", role: "sm", state: "idle", current_run: null, current_story: null }],
  runs: [{
    run_id: "r1", project: "proj", state: "running", engine_run_id: "eng-1", epic: epic(),
    stories: [{ key: "30-3", title: "The Live Stream", status: "current", phase: "dev", overlay: null }],
  }],
  problems: ["one"],
  id,
});

const seeded = (id = "b-5") => {
  const store = createOfficeStore();
  store.applySnapshot(id, snapshot(id));
  return store;
};

describe("parseId", () => {
  it("splits on the last dash", () => {
    expect(parseId("123-45")).toEqual({ boot: "123", seq: 45 });
    expect(parseId("a-b-7")).toEqual({ boot: "a-b", seq: 7 });
  });
  it("is null when malformed", () => {
    for (const bad of ["", "12", "-3", "3-", "b-x", "b-1.5", null, undefined]) expect(parseId(bad as string)).toBeNull();
  });
});

describe("the office store", () => {
  it("starts connecting with no view", () => {
    expect(createOfficeStore().getState()).toEqual({ view: null, lastId: null, status: "connecting", lastEventAt: null });
  });

  it("applies a snapshot: the view without its id, lastId and live", () => {
    const store = seeded();
    const s = store.getState();
    expect(s.lastId).toBe("b-5");
    expect(s.status).toBe("live");
    expect(s.view).not.toHaveProperty("id");
    expect(s.view?.agents).toHaveLength(1);
    expect(s.view?.runs[0].engine_run_id).toBe("eng-1");
    expect(s.view?.problems).toEqual(["one"]);
  });

  it("updates a known agent", () => {
    const store = seeded();
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/sm", state: "typing", from: "idle", at: "x", current_run: "r1", current_story: "30-3" });
    const s = store.getState();
    expect(s.lastId).toBe("b-6");
    expect(s.view?.agents).toEqual([{ agent_id: "proj/sm", project: "proj", role: "sm", state: "typing", current_run: "r1", current_story: "30-3", reason: null }]);
  });

  it("adds a new agent, deriving project and role from its id", () => {
    const store = seeded();
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/dev", state: "thinking", from: null, at: "x", current_run: "r1", current_story: null });
    expect(store.getState().view?.agents[1]).toEqual({ agent_id: "proj/dev", project: "proj", role: "dev", state: "thinking", current_run: "r1", current_story: null, reason: null });
  });

  it("creates a run row from progress before its office.run, then fills its state", () => {
    const store = seeded();
    store.applyDelta("b-6", "office.progress", { run_id: "r2", epic: epic({ done: 0 }) });
    let r2 = store.getState().view?.runs.find((r) => r.run_id === "r2");
    expect(r2).toEqual({ run_id: "r2", project: null, state: null, engine_run_id: null, epic: epic({ done: 0 }), stories: [] });
    store.applyDelta("b-7", "office.run", { run_id: "r2", project: "proj", state: "running", from: null });
    r2 = store.getState().view?.runs.find((r) => r.run_id === "r2");
    expect(r2?.state).toBe("running");
    expect(r2?.project).toBe("proj");
    expect(r2?.engine_run_id).toBeNull();
  });

  it("merges a progress story by key, keeping the snapshot's title, and sets the epic", () => {
    const store = seeded();
    store.applyDelta("b-6", "office.progress", { run_id: "r1", epic: epic({ done: 2 }), story: { key: "30-3", status: "done", phase: null, overlay: "done" } });
    store.applyDelta("b-7", "office.progress", { run_id: "r1", epic: epic({ done: 2 }), story: { key: "30-4", status: "current", phase: "dev", overlay: null } });
    const r1 = store.getState().view!.runs[0];
    expect(r1.epic.done).toBe(2);
    expect(r1.engine_run_id).toBe("eng-1");
    expect(r1.stories).toEqual([
      { key: "30-3", title: "The Live Stream", status: "done", phase: null, overlay: "done" },
      { key: "30-4", status: "current", phase: "dev", overlay: null },
    ]);
  });

  it("changes a live run's state and keeps its engine run id", () => {
    const store = seeded();
    store.applyDelta("b-6", "office.run", { run_id: "r1", project: "proj", state: "paused", from: "running" });
    const r1 = store.getState().view!.runs[0];
    expect(r1.state).toBe("paused");
    expect(r1.engine_run_id).toBe("eng-1");
  });

  it("drops a run leaving the live set (a queue state or null)", () => {
    const store = seeded();
    store.applyDelta("b-6", "office.run", { run_id: "r1", project: "proj", state: "done", from: "running" });
    expect(store.getState().view?.runs).toEqual([]);
    const other = seeded();
    other.applyDelta("b-6", "office.run", { run_id: "r1", project: "proj", state: null, from: "running" });
    expect(other.getState().view?.runs).toEqual([]);
  });

  it("ignores a duplicate delivery (an id at or below the last applied)", () => {
    const store = seeded();
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/sm", state: "typing", from: "idle", at: "x", current_run: null, current_story: null });
    const before = store.getState();
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/sm", state: "blocked", from: "typing", at: "x", current_run: null, current_story: null });
    store.applyDelta("b-4", "office.agent", { agent_id: "proj/sm", state: "blocked", from: "typing", at: "x", current_run: null, current_story: null });
    expect(store.getState()).toBe(before);
  });

  it("ignores a delta from a stale boot", () => {
    const store = seeded("b-2");
    const before = store.getState();
    store.applyDelta("a-9", "office.agent", { agent_id: "proj/sm", state: "typing", from: "idle", at: "x", current_run: null, current_story: null });
    expect(store.getState()).toBe(before);
  });

  it("rebases on a new boot's snapshot", () => {
    const store = seeded("b-40");
    store.applySnapshot("c-1", { ...snapshot("c-1"), agents: [] });
    expect(store.getState().lastId).toBe("c-1");
    expect(store.getState().view?.agents).toEqual([]);
    store.applyDelta("c-2", "office.agent", { agent_id: "p/dev", state: "idle", from: null, at: "x", current_run: null, current_story: null });
    expect(store.getState().view?.agents).toHaveLength(1);
  });

  it("ignores an unknown kind, a malformed id and a delta before any snapshot, without throwing", () => {
    const fresh = createOfficeStore();
    fresh.applyDelta("b-1", "office.agent", { agent_id: "p/dev", state: "idle" });
    expect(fresh.getState().view).toBeNull();
    const store = seeded();
    const before = store.getState();
    expect(() => {
      store.applyDelta("b-6", "office.nope", { agent_id: "proj/sm" });
      store.applyDelta("garbage", "office.agent", { agent_id: "proj/sm", state: "typing" });
      store.applyDelta("b-7", "office.run", "not an object");
      store.applySnapshot("bad", snapshot());
    }).not.toThrow();
    expect(store.getState()).toBe(before);
  });

  it("notifies subscribers on change only, and unsubscribes", () => {
    const store = createOfficeStore();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.setStatus("connecting");
    expect(fn).not.toHaveBeenCalled();
    store.setStatus("reconnecting");
    expect(fn).toHaveBeenCalledTimes(1);
    const a = store.getState();
    expect(store.getState()).toBe(a);
    off();
    store.setStatus("live");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps the view when the status changes", () => {
    const store = seeded();
    const view = store.getState().view;
    store.setStatus("reconnecting");
    expect(store.getState().view).toBe(view);
  });
});

describe("the reason, last_run and lastEventAt (Story 30.4, contract 0.1.25)", () => {
  const last = { run_id: "r0", state: "complete", pr: "https://github.com/o/r/pull/3", ended_at: "2026-10-19T09:00:00.000Z" };

  it("mirrors an agent's reason from the snapshot and from an office.agent delta", () => {
    const store = createOfficeStore();
    store.applySnapshot("b-5", { ...snapshot(), agents: [{ ...snapshot().agents[0], state: "blocked", reason: "the launch refused" }] });
    expect(store.getState().view?.agents[0].reason).toBe("the launch refused");
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/sm", state: "waiting-for-human", from: "blocked", at: "x", current_run: "r1", current_story: null, reason: "reconcile_verdict: escalate" });
    expect(store.getState().view?.agents[0]).toMatchObject({ state: "waiting-for-human", reason: "reconcile_verdict: escalate" });
    store.applyDelta("b-7", "office.agent", { agent_id: "proj/sm", state: "idle", from: "waiting-for-human", at: "x", current_run: "r1", current_story: null, reason: null });
    expect(store.getState().view?.agents[0].reason).toBeNull();
  });

  it("the snapshot replaces last_run; a missing or malformed one is empty", () => {
    const store = createOfficeStore();
    store.applySnapshot("b-5", { ...snapshot(), last_run: { proj: last, bad: { run_id: 3 } } });
    expect(store.getState().view?.last_run).toEqual({ proj: last });
    store.applySnapshot("b-9", snapshot("b-9"));
    expect(store.getState().view?.last_run).toEqual({});
  });

  it("an office.run delta carrying last_run sets it for its project and drops the run", () => {
    const store = seeded();
    const ended = { run_id: "r1", state: "complete", pr: null, ended_at: "2026-10-19T11:00:00.000Z" };
    store.applyDelta("b-6", "office.run", { run_id: "r1", project: "proj", state: "complete", from: "running", last_run: ended });
    expect(store.getState().view?.runs).toEqual([]);
    expect(store.getState().view?.last_run).toEqual({ proj: ended });
    // No project on the delta: the run row's project.
    const other = seeded();
    other.applyDelta("b-6", "office.run", { run_id: "r1", state: "blocked", from: "running", last_run: { ...ended, state: "blocked" } });
    expect(other.getState().view?.last_run.proj?.state).toBe("blocked");
  });

  it("an office.run for a run never live (terminal, from null, no row) adds no row and sets last_run", () => {
    const store = seeded();
    const ended = { run_id: "r9", state: "cancelled", pr: null, ended_at: "2026-10-19T12:00:00.000Z" };
    store.applyDelta("b-6", "office.run", { run_id: "r9", project: "proj", state: "cancelled", from: null, last_run: ended });
    expect(store.getState().view?.runs.map((r) => r.run_id)).toEqual(["r1"]);
    expect(store.getState().view?.last_run).toEqual({ proj: ended });
  });

  it("lastEventAt is set on an applied snapshot and delta, unchanged on an ignored one", () => {
    let t = 1000;
    const store = createOfficeStore({ now: () => t });
    store.applySnapshot("b-5", snapshot());
    expect(store.getState().lastEventAt).toBe(1000);
    t = 2000;
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/sm", state: "typing", from: "idle", at: "x", current_run: null, current_story: null });
    expect(store.getState().lastEventAt).toBe(2000);
    t = 3000;
    const before = store.getState();
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/sm", state: "blocked", from: "typing", at: "x", current_run: null, current_story: null });
    store.applyDelta("b-7", "office.nope", {});
    expect(store.getState()).toBe(before);
    expect(store.getState().lastEventAt).toBe(2000);
    store.setStatus("reconnecting");
    expect(store.getState().lastEventAt).toBe(2000);
  });

  it("a reconnect snapshot identical in content keeps lastEventAt (its at and id differ)", () => {
    let t = 1000;
    const store = createOfficeStore({ now: () => t });
    store.applySnapshot("b-5", snapshot());
    t = 16000;
    store.applySnapshot("b-5", { ...snapshot(), at: "2026-10-19T10:00:15.000Z" });
    expect(store.getState().lastEventAt).toBe(1000);
    t = 31000;
    store.applySnapshot("c-1", { ...snapshot("c-1"), at: "2026-10-19T10:00:30.000Z" });
    const s = store.getState();
    expect(s).toMatchObject({ lastId: "c-1", status: "live", lastEventAt: 1000 });
    expect(s.view?.at).toBe("2026-10-19T10:00:30.000Z");
    expect(store.getState()).toBe(s);
  });

  it("a snapshot with changed content (agents, runs, problems or last_run) updates lastEventAt", () => {
    let t = 1000;
    const store = createOfficeStore({ now: () => t });
    store.applySnapshot("b-5", snapshot());
    const changes = [
      { agents: [{ ...snapshot().agents[0], state: "typing" }] },
      { runs: [] },
      { problems: [] },
      { last_run: { proj: last } },
    ];
    for (const change of changes) {
      t += 1000;
      store.applySnapshot("b-5", { ...snapshot(), ...change });
      expect(store.getState().lastEventAt).toBe(t);
    }
  });

  it("a delta-built view equal to a later snapshot (key order aside) keeps lastEventAt", () => {
    let t = 1000;
    const store = createOfficeStore({ now: () => t });
    store.applySnapshot("b-5", { ...snapshot(), agents: [{ ...snapshot().agents[0], reason: null }] });
    t = 2000;
    store.applyDelta("b-6", "office.agent", { agent_id: "proj/sm", state: "typing", from: "idle", at: "x", current_run: null, current_story: null, reason: null });
    t = 17000;
    store.applySnapshot("b-6", { ...snapshot("b-6"), agents: [{ reason: null, state: "typing", agent_id: "proj/sm", project: "proj", role: "sm", current_run: null, current_story: null }] });
    expect(store.getState().lastEventAt).toBe(2000);
  });

  it("an office.run {from: null} for the same last_run run with a late PR updates last_run and adds no live row", () => {
    const store = createOfficeStore();
    const ended = { run_id: "r0", state: "complete", pr: null, ended_at: "2026-10-19T09:00:00.000Z" };
    store.applySnapshot("b-5", { ...snapshot(), last_run: { proj: ended } });
    store.applyDelta("b-6", "office.run", { run_id: "r0", project: "proj", state: "complete", from: null, last_run: { ...ended, pr: last.pr } });
    expect(store.getState().view?.last_run).toEqual({ proj: { ...ended, pr: last.pr } });
    expect(store.getState().view?.runs.map((r) => r.run_id)).toEqual(["r1"]);
  });
});

describe("the snapshot extras (Story 30.6, contract 0.1.25)", () => {
  const supervisor = { version: "0.1.2", counts: { done: 4, running: 1 } };
  const ledger = { path: "measurements/op-box.jsonl", lines: ['{"n":1}', '{"n":2}'] };

  it("keeps supervisor and ledger from the snapshot; a delta leaves them; a later snapshot replaces them", () => {
    const store = createOfficeStore();
    store.applySnapshot("b-5", { ...snapshot(), supervisor, ledger });
    expect(store.getState().view?.supervisor).toEqual(supervisor);
    expect(store.getState().view?.ledger).toEqual(ledger);
    store.applyDelta("b-6", "office.run", { run_id: "r1", project: "proj", state: "paused", from: "running" });
    store.applyDelta("b-7", "office.agent", { agent_id: "proj/sm", state: "typing", from: "idle", at: "x", current_run: "r1", current_story: null, reason: null });
    store.applyDelta("b-8", "office.progress", { run_id: "r1", epic: epic({ done: 2 }) });
    expect(store.getState().view?.supervisor).toEqual(supervisor);
    expect(store.getState().view?.ledger).toEqual(ledger);
    const note = { path: "measurements/op-box.jsonl", note: "measurements/op-box.jsonl not found" };
    store.applySnapshot("b-9", { ...snapshot("b-9"), supervisor: { version: "0.1.3", counts: { done: 5 } }, ledger: note });
    expect(store.getState().view?.supervisor).toEqual({ version: "0.1.3", counts: { done: 5 } });
    expect(store.getState().view?.ledger).toEqual(note);
  });

  it("a snapshot without them (or with malformed ones) leaves them null", () => {
    const store = createOfficeStore();
    store.applySnapshot("b-5", { ...snapshot(), supervisor, ledger });
    store.applySnapshot("b-6", snapshot("b-6"));
    expect(store.getState().view?.supervisor).toBeNull();
    expect(store.getState().view?.ledger).toBeNull();
    store.applySnapshot("b-7", { ...snapshot("b-7"), supervisor: { counts: {} }, ledger: { lines: [] } });
    expect(store.getState().view?.supervisor).toBeNull();
    expect(store.getState().view?.ledger).toBeNull();
  });

  it("an extras-only snapshot change is not an event: lastEventAt stays; the view still updates", () => {
    let t = 1000;
    const store = createOfficeStore({ now: () => t });
    store.applySnapshot("b-5", { ...snapshot(), supervisor, ledger });
    expect(store.getState().lastEventAt).toBe(1000);
    t = 2000;
    const changed = { version: "0.1.2", counts: { done: 5 } };
    store.applySnapshot("b-6", { ...snapshot("b-6"), supervisor: changed, ledger: { ...ledger, lines: ['{"n":3}'] } });
    expect(store.getState().lastEventAt).toBe(1000);
    expect(store.getState().view?.supervisor).toEqual(changed);
    expect(store.getState().view?.ledger).toEqual({ ...ledger, lines: ['{"n":3}'] });
  });
});
