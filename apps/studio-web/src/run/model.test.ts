// Story 39.5 (CAP-16): the run page's rules — the timeline table row by row on a full run's events, the clock rules and
// their exact labels, the cost sources, the events list, Cancel's gating and answers, the ended words.
import { describe, expect, it } from "vitest";
import {
  CANCEL_CONSEQUENCE, canCancel, clockLabel, costView, CSRF_WORDS, endedWords, eventRows, EXTERNAL_WORDS, fetchRun, fetchStoryStages, fmtClock,
  LOADING_STAGE, LOADING_STAGE_LOG, NO_TOKEN_PROJECT, postCancel, requestCancel, runClock, runRowKey, runTimeline, runWindow, storyIdOf, type RunEvent, type RunRow,
  type StageRowLike,
} from "./model";
import { fetchInbox } from "../inbox/model";

const T0 = Date.parse("2026-11-10T00:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const OWNER = { pid: 1, host: "h", nonce: "n" };

let seq = 0;
const ev = (s: number, kind: string, detail: Record<string, unknown> | null = {}, from: string | null = "running", to: string | null = "running"): RunEvent =>
  ({ seq: ++seq, at: at(s), kind, from_state: from, to_state: to, detail });

const run = (over: Partial<RunRow> = {}): RunRow => ({
  run_id: "q-1", job_id: "run-epic-39", project_id: "tk-studio", state: "complete", reason: "PR opened", created: at(0), updated: at(5710),
  engine_run_id: "eng-1", worker_pid: 42, worker_guard_s: 7200, definition: JSON.stringify({ guards: { max_wall_clock_seconds: 3600, host_verify_seconds: 7200 } }),
  ...over,
});

/** A full run: queued (with a lock-wait), claimed, worker, launched, the story named, the close-out's host leg with its
 * suites, the close-out lease, closed out, ended. */
function fullEvents(): RunEvent[] {
  seq = 0;
  return [
    ev(0, "enqueued", {}, null, "queued"),
    ev(10, "lock-wait", {}, "queued", "queued"),
    ev(60, "claimed", {}, "queued", "running"),
    ev(61, "worker", { pid: 42, guard_s: 7200 }),
    ev(120, "launched", { engine_run_id: "eng-1" }),
    ev(130, "plan-status", { phase: "in-progress", story_key: "39-5", id: "ST-178", ok: true }),
    ev(5000, "host-verify-leg", { owner: OWNER, by: "close-out", guard_s: 7200 }),
    ev(5600, "host-verify", { green: true, started_at: at(5001), suite_durations: { "studio-web": 30, zz: 5, "lib suite": 100, supervisor: 200, conformance: 50 } }),
    ev(5610, "closing-out", { owner: OWNER }),
    ev(5700, "closed_out", { pr: "https://github.com/o/r/pull/1" }),
    ev(5710, "ended", { pr: "https://github.com/o/r/pull/1" }, "running", "complete"),
  ];
}

const rows: StageRowLike[] = [
  { stage: "dev", pass: "1", started: at(200), ended: at(1000), cost_usd: 1.5 },
  { stage: "review", pass: "1", started: at(1000), ended: at(2000), cost_usd: "$0.50" as unknown as number },
  { stage: "dev", pass: "2", started: at(2000), ended: at(3000), cost_usd: null },
  { stage: "review", pass: "2", started: at(3000), ended: at(4000), cost_usd: "—" as unknown as number },
  { stage: "gate", pass: null, started: at(4000), ended: at(4900), cost_usd: 0.25 },
  { stage: "dev", pass: "1", started: at(-1000), ended: at(-500), cost_usd: 9 }, // an earlier run of the story
];

describe("runTimeline (Settled shape 2)", () => {
  it("a full run: queued, launch, engine with its Stage Log sessions (two review passes), the host leg with suites, close-out, ended", () => {
    const t = runTimeline({ run: run(), events: fullEvents(), stageRows: rows, liveStage: null, now: T0 + 9_000_000 });
    expect(t.segments.map((s) => [s.kind, s.label, s.start, s.end])).toEqual([
      ["queued", "queued (waiting for the checkout lock)", at(0), at(60)],
      ["launch", "launch", at(60), at(120)],
      ["engine", "engine", at(120), at(5000)],
      ["session", "dev attempt 1", at(200), at(1000)],
      ["session", "review pass 1", at(1000), at(2000)],
      ["session", "dev attempt 2", at(2000), at(3000)],
      ["session", "review pass 2", at(3000), at(4000)],
      ["session", "studio gate", at(4000), at(4900)],
      ["host-leg", "host leg", at(5000), at(5600)],
      ["close-out", "close-out", at(5610), at(5700)],
      ["ended", "ended", at(5710), at(5710)],
    ]);
    const leg = t.segments.find((s) => s.kind === "host-leg")!;
    expect(leg.outcome).toBe("green");
    expect(leg.suites).toEqual([
      { name: "lib suite", seconds: 100 }, { name: "conformance", seconds: 50 }, { name: "supervisor", seconds: 200 }, { name: "studio-web", seconds: 30 }, { name: "zz", seconds: 5 },
    ]);
    expect(t.open).toBeNull();
    expect(t.ended).toEqual({ state: "complete", words: "Complete: PR opened" });
  });

  it("a row with no pass takes its ordinal among that stage's rows in the span; a row outside the engine span is not a session", () => {
    const noPass = rows.map((r) => ({ ...r, pass: null }));
    const t = runTimeline({ run: run(), events: fullEvents(), stageRows: noPass, liveStage: null, now: T0 });
    expect(t.segments.filter((s) => s.kind === "session").map((s) => s.label)).toEqual(["dev attempt 1", "review pass 1", "dev attempt 2", "review pass 2", "studio gate"]);
  });

  it("a live run: the open session is labelled by the live stage from the last session's stop (else Loading the stage…)", () => {
    seq = 0;
    const events = [ev(0, "enqueued", {}, null, "queued"), ev(60, "claimed", {}, "queued", "running"), ev(61, "worker", { guard_s: 3600 }), ev(120, "launched", {})];
    const live = run({ state: "running", reason: null });
    const t = runTimeline({ run: live, events, stageRows: rows.slice(0, 2), liveStage: "dev attempt 2 of 2", now: T0 + 2500_000 });
    expect(t.segments.at(-1)).toEqual({ kind: "session", label: "dev attempt 2 of 2", start: at(2000), end: null });
    expect(t.open).toEqual(t.segments.at(-1));
    expect(t.segments.find((s) => s.kind === "engine")!.end).toBeNull();
    expect(t.ended).toBeNull();
    const pending = runTimeline({ run: live, events, stageRows: null, liveStage: null, now: T0 + 300_000 });
    expect(pending.segments.at(-1)).toEqual({ kind: "session", label: LOADING_STAGE, start: at(120), end: null });
    // An open Stage Log row is the open session: no live-stage segment beside it.
    const openRow = runTimeline({ run: live, events, stageRows: [{ stage: "review", pass: "1", started: at(1000), ended: null }], liveStage: "review pass 1 of 3", now: T0 + 1500_000 });
    expect(openRow.segments.filter((s) => s.kind === "session").map((s) => [s.label, s.end])).toEqual([["review pass 1", null]]);
  });

  it("no launched at all: the claim opens a worker segment, closed by paused; the pause reads its reason", () => {
    seq = 0;
    const events = [ev(0, "enqueued", {}, null, "queued"), ev(60, "claimed", {}, "queued", "running"), ev(90, "paused", { engine: { paused_reason: "a ruling" } }, "running", "paused")];
    const t = runTimeline({ run: run({ state: "paused", reason: null }), events, stageRows: null, liveStage: null, now: T0 + 100_000 });
    expect(t.segments.map((s) => [s.kind, s.label, s.end])).toEqual([["queued", "queued", at(60)], ["worker", "worker", at(90)], ["paused", "paused: a ruling", null]]);
    const none = runTimeline({ run: run({ state: "paused", reason: null }), events: [ev(10, "paused", {}, "running", "paused")], stageRows: null, liveStage: null, now: T0 });
    expect(none.segments[0].label).toBe("paused: no reason recorded");
    const reasoned = runTimeline({ run: run({ state: "paused", reason: "the run's reason" }), events: [ev(10, "paused", { reason: "x" }, "running", "paused")], stageRows: null, liveStage: null, now: T0 });
    expect(reasoned.segments[0].label).toBe("paused: the run's reason");
  });

  it("a pause is closed by close-out / engine-resume / resumed; the engine by engine-gone or paused", () => {
    seq = 0;
    const events = [ev(0, "claimed", {}, "queued", "running"), ev(10, "launched", {}), ev(20, "engine-gone", {}), ev(30, "paused", {}, "running", "paused"), ev(40, "engine-resume", {}, "paused", "running"), ev(50, "launched", {}), ev(60, "paused", {}, "running", "paused"), ev(70, "resumed", {}, "paused", "running")];
    const t = runTimeline({ run: run({ state: "running" }), events, stageRows: [], liveStage: "between sessions", now: T0 + 80_000 });
    expect(t.segments.filter((s) => s.kind !== "session").map((s) => [s.kind, s.start, s.end])).toEqual([
      ["launch", at(0), at(10)], ["engine", at(10), at(20)], ["paused", at(30), at(40)], ["engine", at(50), at(60)], ["paused", at(60), at(70)],
    ]);
  });

  it("a re-run lease (by api) and a host-verify with no lease (pre-38.1): their outcomes", () => {
    seq = 0;
    const events = [
      ev(0, "claimed", {}, "queued", "running"), ev(10, "launched", {}),
      ev(100, "host-verify", { green: false, guard: "guard: host_verify_seconds (600s)", started_at: at(50) }),
      ev(200, "ended", {}, "running", "partial"),
      ev(300, "host-verify-leg", { owner: OWNER, by: "api" }, "partial", "partial"),
      ev(400, "host-verify", { green: false, verdicts: ["== supervisor: FAILED rc=1 in 3s"], rerun: { by: "api" } }, "partial", "partial"),
      ev(500, "host-verify", { skipped: true, reason: "no command", rerun: {} }, "partial", "partial"),
    ];
    const t = runTimeline({ run: run({ state: "partial", reason: null }), events, stageRows: null, liveStage: null, now: T0 });
    expect(t.segments.filter((s) => s.kind === "host-leg" || s.kind === "re-run").map((s) => [s.kind, s.start, s.end, s.outcome])).toEqual([
      ["host-leg", at(50), at(100), "inconclusive (guard)"], ["re-run", at(300), at(400), "red"], ["re-run", at(500), at(500), "skipped"],
    ]);
    expect(t.ended).toEqual({ state: "partial", words: "Partial: no reason recorded" });
  });

  it("the ended words", () => {
    expect(endedWords({ state: "cancelled", reason: "cancelled by the owner" })).toBe("Cancelled: cancelled by the owner");
    expect(endedWords({ state: "blocked", reason: null })).toBe("Blocked: no reason recorded");
    expect(endedWords({ state: "running", reason: null })).toBeNull();
    expect(endedWords({ state: "external", reason: null })).toBeNull();
  });
});

describe("runClock (Settled shape 3)", () => {
  it("the worker's guard: 4360 s into a 7200 s guard reads exactly 01:12:40 of 02:00:00", () => {
    seq = 0;
    const events = [ev(0, "claimed", {}, "queued", "running"), ev(100, "worker", { pid: 1, guard_s: 7200 }), ev(160, "launched", {})];
    const c = runClock({ run: run({ state: "running" }), events }, T0 + (100 + 4360) * 1000 + 999);
    expect(c).toEqual({ elapsed_s: 4360, guard_s: 7200, guard: "worker", mode: "guarded", label: "01:12:40 of 02:00:00", over: false, context: "engine: the worker's guard" });
  });

  it("the worker's guard falls back to worker_guard_s, then the definition's max_wall_clock_seconds, then 600", () => {
    seq = 0;
    const events = [ev(0, "claimed", {}, "queued", "running"), ev(0, "worker", { pid: 1 })];
    expect(runClock({ run: run({ state: "running", worker_guard_s: 1800 }), events }, T0).guard_s).toBe(1800);
    expect(runClock({ run: run({ state: "running", worker_guard_s: null }), events }, T0).guard_s).toBe(3600);
    expect(runClock({ run: run({ state: "running", worker_guard_s: null, definition: null }), events }, T0).guard_s).toBe(600);
  });

  it("an open host-leg lease: counts from the lease against its guard_s, else legGuard(definition), guard host leg", () => {
    seq = 0;
    const base = [ev(0, "claimed", {}, "queued", "running"), ev(1, "worker", { guard_s: 3600 }), ev(2, "launched", {})];
    const leased = [...base, ev(1000, "host-verify-leg", { owner: OWNER, by: "close-out", guard_s: 7200 })];
    const c = runClock({ run: run({ state: "running" }), events: leased }, T0 + 1060_000);
    expect(c).toMatchObject({ elapsed_s: 60, guard_s: 7200, guard: "host leg", label: "00:01:00 of 02:00:00", context: "host leg: the leg's own guard" });
    const bare = [...base, ev(1000, "host-verify-leg", { owner: OWNER })];
    expect(runClock({ run: run({ state: "running" }), events: bare }, T0 + 1000_000).guard_s).toBe(7200); // host_verify_seconds
    expect(runClock({ run: run({ state: "running", definition: null }), events: bare }, T0 + 1000_000).guard_s).toBe(600);
    // The leg's host-verify closes it: the clock leaves the leg.
    const closed = [...leased, ev(1100, "host-verify", { green: true })];
    expect(runClock({ run: run({ state: "running" }), events: closed }, T0 + 1200_000)).toMatchObject({ guard: null, mode: "close-out", label: "00:03:20 in close-out" });
  });

  it("over the guard", () => {
    seq = 0;
    const events = [ev(0, "claimed", {}, "queued", "running"), ev(0, "worker", { guard_s: 60 })];
    const c = runClock({ run: run({ state: "running" }), events }, T0 + 61_000);
    expect(c.over).toBe(true);
    expect(c.label).toBe("00:01:01 of 00:01:00 (over the guard)");
    expect(clockLabel("guarded", 60, 60)).toBe("00:01:00 of 00:01:00");
  });

  it("the unguarded labels: queued, since the claim, paused, in close-out, in all", () => {
    seq = 0;
    expect(runClock({ run: run({ state: "queued", created: at(0) }), events: [] }, T0 + 5_000).label).toBe("00:00:05 queued (no guard until a worker starts)");
    const claimed = [ev(10, "claimed", {}, "queued", "running")];
    expect(runClock({ run: run({ state: "running" }), events: claimed }, T0 + 70_000).label).toBe("00:01:00 since the claim (the guard starts with the worker)");
    const paused = [...claimed, ev(20, "worker", { guard_s: 60 }), ev(30, "paused", {}, "running", "paused")];
    expect(runClock({ run: run({ state: "paused" }), events: paused }, T0 + 40_000)).toMatchObject({ label: "00:00:10 paused", guard: null, guard_s: null });
    const gone = [...claimed, ev(20, "worker", { guard_s: 60 }), ev(30, "launched", {}), ev(50, "engine-gone", {})];
    expect(runClock({ run: run({ state: "running" }), events: gone }, T0 + 80_000).label).toBe("00:00:30 in close-out");
    expect(runClock({ run: run(), events: fullEvents() }, T0 + 99_999_000).label).toBe(`${fmtClock(5710 - 60)} in all, claim to end`);
    expect(fmtClock(360_000)).toBe("100:00:00");
  });
});

describe("costView (Settled shape 4)", () => {
  const window = runWindow(fullEvents());
  it("the Stage Log rows in the run's window, summed per stage in first-seen order; a row outside the window never counts", () => {
    expect(window).toEqual({ start: at(60), end: at(5710) });
    const c = costView({ storyId: "ST-178", stageRows: rows, cost_usd: 3, window, now: T0 });
    expect(c).toEqual({ source: "stage-log", label: "Cost by stage, from the Stage Log of ST-178", stages: [{ stage: "dev", usd: 1.5 }, { stage: "review", usd: 0.5 }, { stage: "gate", usd: 0.25 }], total: 2.25 });
  });

  it("the run total: no story known, no costed rows, the story unread; none when not metered; pending while read", () => {
    expect(costView({ storyId: null, stageRows: null, cost_usd: 3, window, now: T0 })).toMatchObject({ source: "run-total", label: "Run total (no story known for this run)", total: 3 });
    expect(costView({ storyId: "ST-178", stageRows: [rows[5]], cost_usd: 3, window, now: T0 })).toMatchObject({ source: "run-total", label: "Run total (the Stage Log has no costed rows for this run)" });
    expect(costView({ storyId: "ST-178", stageRows: null, error: "UnknownStory: ST-178", cost_usd: 3, window, now: T0 }).label).toBe("Run total (the story could not be read: UnknownStory: ST-178)");
    expect(costView({ storyId: null, stageRows: null, cost_usd: null, window, now: T0 })).toEqual({ source: "none", label: "Not metered yet", stages: [], total: null });
    expect(costView({ storyId: "ST-178", stageRows: null, cost_usd: 3, window, now: T0 })).toMatchObject({ source: "pending", label: LOADING_STAGE_LOG });
  });

  it("CAP-12's names (start, cost) read as the table's", () => {
    const c = costView({ storyId: "ST-178", stageRows: [{ stage: "dev", start: at(100), stop: at(200), cost: "$1.25" }], cost_usd: null, window, now: T0 });
    expect(c.stages).toEqual([{ stage: "dev", usd: 1.25 }]);
  });

  it("storyIdOf: the latest plan-status ST id (STORY_ID_RE)", () => {
    seq = 0;
    expect(storyIdOf(fullEvents())).toBe("ST-178");
    expect(storyIdOf([ev(0, "plan-status", { id: "ST-1" })])).toBeNull();
    expect(storyIdOf([])).toBeNull();
  });
});

describe("the events list and Cancel (Settled shapes 5, 6)", () => {
  it("eventRows: oldest first, the summary names a state move, the body is the detail as JSON", () => {
    const r = eventRows(fullEvents().reverse(), (a) => `T${(Date.parse(a) - T0) / 1000}`);
    expect(r[0].summary).toBe("1 · T0 · enqueued · none → queued");
    expect(r[3].summary).toBe("4 · T61 · worker");
    expect(r[3].body).toBe(JSON.stringify({ pid: 42, guard_s: 7200 }, null, 2));
  });

  it("canCancel: queued, running, paused may; external disabled with its words; terminal none", () => {
    for (const state of ["queued", "running", "paused"]) expect(canCancel({ state })).toEqual({ show: true, enabled: true, note: null });
    expect(canCancel({ state: "external" })).toEqual({ show: true, enabled: false, note: EXTERNAL_WORDS });
    expect(canCancel({ state: "complete" }).show).toBe(false);
    expect(CANCEL_CONSEQUENCE).toMatch(/^Cancel stops this run for good: .*cannot be resumed\. Commits already made stay on the run's branch\.$/);
  });

  it("postCancel posts with x-csrf-token and answers in words", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: status === 200, status, json: async () => body };
    };
    expect(await postCancel("q 1", "tok", answer(200, { ok: true }))).toEqual({ ok: true, words: "Cancelled." });
    expect(calls[0].url).toBe("/runs/q%201/cancel");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("tok");
    expect((await postCancel("q", "t", answer(409, { error: "RunTerminal", state: "complete" }))).words).toBe("Already ended: complete");
    expect((await postCancel("q", "t", answer(409, { error: "ExternalRun" }))).words).toBe(EXTERNAL_WORDS);
    expect((await postCancel("q", "t", answer(403, { error: "CsrfRefused" }))).words).toBe(CSRF_WORDS);
    expect((await postCancel("q", "t", answer(404, { error: "RunNotFound" }))).words).toBe("No run q in the queue");
    expect((await postCancel("q", "t", answer(500, { error: "Boom" }))).words).toBe("/runs/q/cancel answered 500 Boom");
  });

  it("fetchRun and fetchStoryStages: the answer, a 404 in words, the Stage Log rows", async () => {
    const ok = await fetchRun("q-1", async () => ({ ok: true, status: 200, json: async () => ({ ok: true, run: run(), events: [], cost_usd: "x" }) }));
    expect(ok.ok && ok.answer.cost_usd).toBeNull();
    expect(await fetchRun("q-9", async () => ({ ok: false, status: 404, json: async () => ({ error: "RunNotFound" }) }))).toEqual({ ok: false, error: "No run q-9 in the queue", notFound: true });
    const s = await fetchStoryStages("p", "ST-178", async (url) => {
      expect(url).toBe("/stories/ST-178?project=p");
      return { ok: true, status: 200, json: async () => ({ ok: true, stage_log: { rows: [rows[0]], total: {} } }) };
    });
    expect(s).toEqual({ ok: true, rows: [rows[0]] });
    expect(await fetchStoryStages("p", "ST-999", async () => ({ ok: false, status: 404, json: async () => ({ error: "UnknownStory", detail: "no ST-999" }) }))).toEqual({ ok: false, error: "UnknownStory: no ST-999" });
  });
});

describe("the run page's row key (Settled shape 11: leg)", () => {
  it("changes when the run's state, stage or leg does; empty with no row", () => {
    const row = { state: "running", stage: "host verify leg", leg: null as { since: string } | null };
    const before = runRowKey(row);
    expect(runRowKey(null)).toBe("");
    expect(runRowKey({ ...row, leg: { since: at(10) } })).not.toBe(before);
    expect(runRowKey({ ...row, leg: { since: at(20) } })).not.toBe(runRowKey({ ...row, leg: { since: at(10) } }));
    expect(runRowKey({ ...row, stage: "close-out" })).not.toBe(before);
    expect(runRowKey({ ...row, state: "paused" })).not.toBe(before);
    expect(runRowKey({ state: "running", stage: "host verify leg" })).toBe(before); // an older supervisor: no leg
  });
});

describe("the review pass (Story 39.5)", () => {
  it("an orphaned run: the timeline closes its open segments and draws the end; the clock and the cost window stop there", () => {
    seq = 0;
    const events = [
      ev(0, "enqueued", {}, null, "queued"), ev(60, "claimed", {}, "queued", "running"), ev(61, "worker", { guard_s: 7200 }), ev(120, "launched", {}),
      ev(900, "orphaned", { reason: "orphaned: supervisor restart" }, "running", "partial"),
    ];
    const r = run({ state: "partial", reason: "orphaned: supervisor restart", updated: at(950) });
    const t = runTimeline({ run: r, events, stageRows: [], liveStage: "dev attempt 1 of 2", now: T0 + 99_000_000 });
    expect(t.segments.map((s) => [s.kind, s.end])).toEqual([["queued", at(60)], ["launch", at(120)], ["engine", at(900)], ["ended", at(900)]]);
    expect(t.open).toBeNull();
    expect(t.ended).toEqual({ state: "partial", words: "Partial: orphaned: supervisor restart" });
    expect(runClock({ run: r, events }, T0 + 99_000_000)).toMatchObject({ mode: "ended", label: `${fmtClock(900 - 60)} in all, claim to end`, guard: null });
    expect(runWindow(events)).toEqual({ start: at(60), end: at(900) });
  });

  it("an ended run after an owned host-verify-leg lease with no host-verify reads in all, claim to end (never a live leg clock)", () => {
    for (const [state, kind] of [["complete", "ended"], ["cancelled", "ended"], ["partial", "orphaned"]] as const) {
      seq = 0;
      const events = [ev(0, "claimed", {}, "queued", "running"), ev(1, "worker", { guard_s: 60 }), ev(2, "launched", {}),
        ev(100, "host-verify-leg", { owner: OWNER, by: "close-out", guard_s: 600 }), ev(200, kind, {}, "running", state)];
      const c = runClock({ run: run({ state }), events }, T0 + 99_000_000);
      expect(c).toMatchObject({ mode: "ended", guard: null, over: false, label: "00:03:20 in all, claim to end" });
    }
  });

  it("a takeover lease (a second owned host-verify-leg while a leg is open) closes the earlier leg at the takeover's at", () => {
    seq = 0;
    const events = [ev(0, "claimed", {}, "queued", "running"), ev(10, "launched", {}),
      ev(100, "host-verify-leg", { owner: OWNER, by: "close-out" }), ev(300, "host-verify-leg", { owner: { ...OWNER, pid: 2 }, by: "close-out" }),
      ev(400, "host-verify", { green: true })];
    const t = runTimeline({ run: run({ state: "running", reason: null }), events, stageRows: [], liveStage: null, now: T0 + 500_000 });
    expect(t.segments.filter((s) => s.kind === "host-leg").map((s) => [s.start, s.end, s.outcome])).toEqual([[at(100), at(300), undefined], [at(300), at(400), "green"]]);
  });

  it("costView: a story but no project on the run never reads the Stage Log: the run's total, never Loading forever", () => {
    const window = runWindow(fullEvents());
    expect(costView({ storyId: "ST-178", stageRows: null, project: null, cost_usd: 3, window, now: T0 })).toMatchObject({
      source: "run-total", label: "Run total (the story could not be read: no project on the run)", total: 3,
    });
    expect(costView({ storyId: "ST-178", stageRows: null, project: "p", cost_usd: 3, window, now: T0 }).source).toBe("pending");
  });

  it("requestCancel: no project, a failed inbox read or no token posts nothing; a read token rides the post", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const answer = (inboxOk: boolean, token: string | null) => async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.startsWith("/inbox")) {
        return inboxOk
          ? { ok: true, status: 200, json: async () => ({ ok: true, project: "p", items: [] }), headers: { get: (n: string) => (n.toLowerCase() === "x-csrf-token" ? token : null) } }
          : { ok: false, status: 500, json: async () => ({ ok: false, error: "InboxFailed" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    expect(await requestCancel("q-1", null, fetchInbox, answer(true, "tok"))).toEqual({ ok: false, words: NO_TOKEN_PROJECT });
    expect(seen).toEqual([]);
    const failed = await requestCancel("q-1", "p", fetchInbox, answer(false, null));
    expect(failed.ok).toBe(false);
    expect(failed.words).toMatch(/^The session token could not be read, so nothing was posted: \/inbox\?project=p answered 500/);
    expect(seen.map((s) => s.url)).toEqual(["/inbox?project=p"]);
    seen.length = 0;
    expect((await requestCancel("q-1", "p", fetchInbox, answer(true, null))).ok).toBe(false);
    expect(seen.map((s) => s.url)).toEqual(["/inbox?project=p"]);
    seen.length = 0;
    expect(await requestCancel("q-1", "p", fetchInbox, answer(true, "tok"))).toEqual({ ok: true, words: "Cancelled." });
    expect(seen.map((s) => s.url)).toEqual(["/inbox?project=p", "/runs/q-1/cancel"]);
    expect((seen[1].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("tok");
  });
});
