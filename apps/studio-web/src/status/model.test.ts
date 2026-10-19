import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOfficeStore } from "../live/store";
import { NONE, PENDING, STATUS_PAGE_URL, statusView } from "./model";

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

  it("src/status holds no interval timer and no fetch (refreshes from the store only)", () => {
    const timer = ["set", "Interval", "("].join("");
    const fetchCall = ["fet", "ch("].join("");
    const dir = fileURLToPath(new URL(".", import.meta.url));
    for (const f of readdirSync(dir).filter((n) => !n.endsWith(".test.ts"))) {
      const text = readFileSync(join(dir, f), "utf-8");
      expect({ f, interval: text.includes(timer), fetch: text.includes(fetchCall) }).toEqual({ f, interval: false, fetch: false });
    }
  });
});
