// Story 30.4: the Office screen's rules without a browser or WebGL: the state-to-frames mapping for
// all eight states (30.7: the per-role sets and the idle fallback), the bubble rule, the desks, the HUD's fields from a fixture store (the null
// seams and no live run), the registry fetch and the project switcher with a fake storage.
import { describe, expect, it } from "vitest";
import { createOfficeStore, OFFICE_STATES, type OfficeAgent, type OfficeState } from "../live/store";
import {
  agentsUrl, bubbleFor, safeHref, desksFrom, fetchAgents, framesFor, hold, HOLD_MS, hudModel, hudMotion, hudRunKey, LERP_MS, LOADING, LOADING_FINDINGS, NONE, PENDING,
  phasedBar, PROJECT_KEY, projectsFrom, rememberedProject, rememberProject, tween, valueAt, type BoardRead, type FrameSheet, type Held, type StorageLike,
} from "./model";
import type { BoardAnswer } from "../board/model";
import type { RunClock, RunEvent, RunRow } from "../run/model";

const shared = Object.fromEntries(OFFICE_STATES.map((s) => [s, [`${s}.0`, `${s}.1`]])) as unknown as Record<OfficeState, string[]>;

describe("framesFor (the state-to-frames mapping)", () => {
  it("maps each of the eight states to its own distinct set", () => {
    const sheet: FrameSheet<string> = { frames: shared };
    const sets = OFFICE_STATES.map((s) => framesFor(sheet, "session", s));
    for (const [i, s] of OFFICE_STATES.entries()) expect(sets[i]).toEqual([`${s}.0`, `${s}.1`]);
    expect(new Set(sets.map((x) => x.join("|"))).size).toBe(8);
    expect(new Set(sets.flat()).size).toBe(16);
  });

  // Story 30.7: a role the sheet carries falls back to its own idle set, warning once per gap.
  const planner = {
    typing: ["planner.typing.0", "planner.typing.1"],
    idle: ["planner.idle.0", "planner.idle.1"],
    offline: ["planner.offline.0", "planner.offline.1"],
  };

  it("prefers the role's set for that state; a missing pose falls back to the role's idle, warning once naming the gap", () => {
    const sheet: FrameSheet<string> = { frames: shared, roles: { planner } };
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(framesFor(sheet, "planner", "typing", warn)).toEqual(planner.typing);
    expect(warnings).toEqual([]);
    expect(framesFor(sheet, "planner", "blocked", warn)).toEqual(planner.idle);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("planner.blocked");
    // a second call (syncDesks asks on every store change) does not warn again
    expect(framesFor(sheet, "planner", "blocked", warn)).toEqual(planner.idle);
    expect(warnings).toHaveLength(1);
    // another gap warns once more, naming it
    expect(framesFor(sheet, "planner", "reading", warn)).toEqual(planner.idle);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("planner.reading");
    // a fresh sheet warns afresh
    framesFor({ frames: shared, roles: { planner } }, "planner", "blocked", warn);
    expect(warnings).toHaveLength(3);
  });

  it("a role on the sheet without the pose or an idle set gets the shared set, warning once accurately", () => {
    const sheet: FrameSheet<string> = { frames: shared, roles: { planner: { typing: planner.typing } } };
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(framesFor(sheet, "planner", "blocked", warn)).toEqual(["blocked.0", "blocked.1"]);
    expect(framesFor(sheet, "planner", "blocked", warn)).toEqual(["blocked.0", "blocked.1"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("planner.blocked");
    expect(warnings[0]).toContain("shared blocked set");
    expect(warnings[0]).not.toContain("showing planner.idle");
  });

  it("an unknown role takes the shared set without a warning; an unknown state reads offline", () => {
    const sheet: FrameSheet<string> = { frames: shared, roles: { planner } };
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(framesFor(sheet, "session", "typing", warn)).toEqual(["typing.0", "typing.1"]);
    expect(framesFor(sheet, "session", "dancing", warn)).toEqual(["offline.0", "offline.1"]);
    expect(framesFor(sheet, "planner", "dancing", warn)).toEqual(planner.offline);
    expect(warnings).toEqual([]);
  });
});

describe("the bubble rule", () => {
  it("only waiting-for-human and blocked get a bubble naming the reason", () => {
    for (const state of OFFICE_STATES) {
      const b = bubbleFor({ state, reason: "reconcile_verdict: escalate" });
      if (state === "waiting-for-human" || state === "blocked") expect(b).toBe("reconcile_verdict: escalate");
      else expect(b).toBeNull();
    }
  });
  it("a null or missing reason says waiting / blocked", () => {
    expect(bubbleFor({ state: "waiting-for-human", reason: null })).toBe("waiting");
    expect(bubbleFor({ state: "blocked" })).toBe("blocked");
    expect(bubbleFor({ state: "blocked", reason: "the launch refused" })).toBe("the launch refused");
  });
});

describe("the \"!\" follows blocked_issue alone (Story 31.5, 0.1.26)", () => {
  const agent = (over: Partial<OfficeAgent> = {}): OfficeAgent => ({
    agent_id: "p/session", project: "p", role: "session", state: "typing", current_run: "r1", current_story: "31-5-x", reason: null, ...over,
  });
  const SNAP = (agents: OfficeAgent[]) => ({ at: "t", agents, runs: [], problems: [], last_run: {} });

  it("a non-null blocked_issue shows the \"!\" in any state; null or absent never does", () => {
    for (const state of OFFICE_STATES) expect(bubbleFor({ state, blocked_issue: { issue: "TKS-2", state: "open" } })).toBe("! TKS-2");
    expect(bubbleFor({ state: "typing", blocked_issue: null })).toBeNull();
    expect(bubbleFor({ state: "typing" })).toBeNull();
  });

  it("the desk carries the store agent's blocked_issue", () => {
    const desks = desksFrom([{ agent_id: "p/session", project: "p", role: "session" }], [agent({ blocked_issue: { issue: "TKS-2", state: "open" } })]);
    expect(desks[0]).toMatchObject({ blocked_issue: { issue: "TKS-2", state: "open" } });
    expect(bubbleFor(desks[0])).toBe("! TKS-2");
  });

  it("set and cleared only by an office.agent delta carrying the field; a comment or message event never touches it", () => {
    const store = createOfficeStore({ now: () => 1 });
    store.applySnapshot("b-1", SNAP([agent()]));
    const issueOf = () => store.getState().view!.agents[0].blocked_issue ?? null;
    expect(issueOf()).toBeNull();
    store.applyDelta("b-2", "office.agent", { agent_id: "p/session", state: "typing", current_run: "r1", current_story: "31-5-x", reason: null, blocked_issue: { issue: "TKS-2", state: "open" } });
    expect(issueOf()).toEqual({ issue: "TKS-2", state: "open" });
    // a comment or a message is no office kind: ignored; an agent delta without the field leaves it as it is
    store.applyDelta("b-3", "comment", { agent_id: "p/session", body: "done" });
    store.applyDelta("b-4", "message", { agent_id: "p/session", body: "done" });
    store.applyDelta("b-5", "office.agent", { agent_id: "p/session", state: "thinking", current_run: "r1", current_story: "31-5-x", reason: null });
    expect(issueOf()).toEqual({ issue: "TKS-2", state: "open" });
    expect(bubbleFor(desksFrom([{ agent_id: "p/session" }], store.getState().view!.agents)[0])).toBe("! TKS-2");
    // the status changed: the projection clears it
    store.applyDelta("b-6", "office.agent", { agent_id: "p/session", state: "thinking", current_run: "r1", current_story: "31-5-x", reason: null, blocked_issue: null });
    expect(issueOf()).toBeNull();
    expect(bubbleFor(desksFrom([{ agent_id: "p/session" }], store.getState().view!.agents)[0])).toBeNull();
  });
});

describe("the desks and the projects", () => {
  const rows = [
    { agent_id: "p/orchestrator", project: "p", role: "orchestrator", live_state: "idle" },
    { agent_id: "p/session", project: "p", role: "session", live_state: "typing" },
    { agent_id: "p/planner", project: "p", role: "planner", live_state: "nonsense" },
    { agent_id: "q/session", project: "q", role: "session", live_state: "offline" },
    { agent_id: "r.s/advisor" },
  ];

  it("the pose comes from the store's agent, else the row's live_state, else offline; in row order", () => {
    const desks = desksFrom(rows.slice(0, 3), [
      { agent_id: "p/orchestrator", project: "p", role: "orchestrator", state: "waiting-for-human", current_run: "r1", current_story: null, reason: "a ruling" },
    ]);
    expect(desks).toEqual([
      { agent_id: "p/orchestrator", role: "orchestrator", state: "waiting-for-human", reason: "a ruling", blocked_issue: null },
      { agent_id: "p/session", role: "session", state: "typing", reason: null, blocked_issue: null },
      { agent_id: "p/planner", role: "planner", state: "offline", reason: null, blocked_issue: null },
    ]);
    expect(desksFrom([rows[4]], null)).toEqual([{ agent_id: "r.s/advisor", role: "advisor", state: "offline", reason: null, blocked_issue: null }]);
  });

  it("projectsFrom lists the distinct projects in first-seen order (the agent_id prefix as a fallback)", () => {
    expect(projectsFrom(rows)).toEqual(["p", "q", "r.s"]);
    expect(projectsFrom([])).toEqual([]);
  });

  it("the URLs are absolute (the page has <base href=\"/app/\">)", () => {
    expect(agentsUrl(null)).toBe("/agents");
    expect(agentsUrl("a b")).toBe("/agents?project=a%20b");
  });
});

describe("fetchAgents", () => {
  it("answers the rows on 200, sending the cookie on the same origin", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const ans = await fetchAgents("p", async (u, i) => {
      calls.push([u, i]);
      return { ok: true, status: 200, json: async () => ({ ok: true, rebuilt_at: null, agents: [{ agent_id: "p/session" }, { nope: 1 }] }) };
    });
    expect(ans).toEqual({ ok: true, agents: [{ agent_id: "p/session" }] });
    expect(calls[0][0]).toBe("/agents?project=p");
    expect(calls[0][1]?.credentials).toBe("same-origin");
  });

  it("a non-200, a network error or a malformed body is an error naming it, never a throw", async () => {
    expect(await fetchAgents(null, async () => ({ ok: false, status: 401, json: async () => ({}) }))).toEqual({ ok: false, error: "/agents answered 401" });
    expect(await fetchAgents(null, async () => { throw new Error("offline"); })).toEqual({ ok: false, error: "/agents: offline" });
    expect(await fetchAgents(null, async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))).toEqual({ ok: false, error: "/agents: no agents in the answer" });
  });
});

describe("the project switcher", () => {
  const fake = (init: Record<string, string> = {}) => {
    const data = new Map(Object.entries(init));
    const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    return { data, storage };
  };
  const throwing: StorageLike = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };

  it("remembers the choice per browser and restores it", () => {
    const { data, storage } = fake();
    expect(rememberedProject(["p", "q"], storage)).toBe("p");
    rememberProject("q", storage);
    expect(data.get(PROJECT_KEY)).toBe("q");
    expect(rememberedProject(["p", "q"], storage)).toBe("q");
  });

  it("a stored project absent from the registry falls back to the first; no projects is null", () => {
    const { storage } = fake({ [PROJECT_KEY]: "gone" });
    expect(rememberedProject(["p", "q"], storage)).toBe("p");
    expect(rememberedProject([], storage)).toBeNull();
  });

  it("a storage that throws (or none) is in memory only, never a throw", () => {
    expect(rememberedProject(["p", "q"], throwing)).toBe("p");
    expect(() => rememberProject("q", throwing)).not.toThrow();
    expect(rememberedProject(["p"], null)).toBe("p");
    expect(() => rememberProject("p", null)).not.toThrow();
  });
});

describe("the HUD (a fixture store)", () => {
  const epic = { spec_folder: "spec-epic-30", done: 2, deferred: 0, failed: 1, total: 7, current_story: "30-4" };
  const agent = (role: string, current_run: string | null) =>
    ({ agent_id: `p/${role}`, project: "p", role, state: "typing", current_run, current_story: null, reason: null });
  const fixture = (snapshot: Record<string, unknown>, t = 10_000) => {
    const store = createOfficeStore({ now: () => t });
    store.applySnapshot("b-1", { at: "", problems: [], ...snapshot });
    return store.getState();
  };

  it("a live run: the project, the run id and state, progress, the story and its phase, the engine id, the time since", () => {
    const state = fixture({
      agents: [agent("session", "r1")],
      runs: [{ run_id: "r1", project: "p", state: "running", engine_run_id: "eng-1", epic,
        stories: [{ key: "30-4", status: "current", phase: "dev-running", overlay: null }] }],
      last_run: { p: { run_id: "r0", state: "complete", pr: "https://x/pull/1", ended_at: "t" } },
    });
    expect(hudModel(state, "p", 13_400)).toEqual({
      project: "p",
      live: {
        run_id: "r1", stage: LOADING, clock: null, clockText: "Loading the clock…", state: "running", engine_run_id: "eng-1", done: 2, failed: 1, total: 7,
        story: "30-4", phase: "dev-running",
        bar: phasedBar({ epic, stories: [{ key: "30-4", status: "current", phase: "dev-running", overlay: null }] }, null),
      },
      last: null,
      since: "3s ago",
    });
  });

  it("the null seams: a state-null row is pending, a null engine id and phase are Loading…", () => {
    const state = fixture({
      agents: [agent("session", "r2")],
      runs: [{ run_id: "r2", project: null, state: null, engine_run_id: null, epic: { ...epic, current_story: null }, stories: [] }],
    });
    expect(hudModel(state, "p", 10_000).live).toEqual({
      run_id: "r2", stage: LOADING, clock: null, clockText: "Loading the clock…", state: PENDING, engine_run_id: LOADING, done: 2, failed: 1, total: 7,
      story: NONE, phase: LOADING, bar: phasedBar({ epic: { ...epic, current_story: null }, stories: [] }, null),
    });
    expect(hudModel(state, "p", 10_000).since).toBe("0s ago");
  });

  it("a pending value reads Loading…, never — (TKSTUDIO-213)", () => {
    expect(LOADING).toBe("Loading…");
  });

  it("a new run with a current story but no story rows and no engine id: phase and engine id are Loading…", () => {
    const state = fixture({
      agents: [agent("session", "r3")],
      runs: [{ run_id: "r3", project: "p", state: "running", engine_run_id: null, epic, stories: [] }],
    });
    const live = hudModel(state, "p", 10_000).live;
    expect(live).toMatchObject({ story: "30-4", phase: "Loading…", engine_run_id: "Loading…" });
    expect(live?.phase).not.toBe(NONE);
    expect(live?.engine_run_id).not.toBe(NONE);
  });

  it("no live run: the last ended run's state and PR; a null PR; none at all", () => {
    const ended = fixture({
      agents: [agent("session", null)],
      runs: [{ run_id: "rq", project: "q", state: "running", engine_run_id: "e", epic, stories: [] }],
      last_run: { p: { run_id: "r0", state: "complete", pr: "https://github.com/o/r/pull/3", ended_at: "t" }, q: { run_id: "x", state: "blocked", pr: null, ended_at: "t" } },
    });
    expect(hudModel(ended, "p", 10_000)).toMatchObject({ live: null, last: { run_id: "r0", state: "complete", pr: "https://github.com/o/r/pull/3", href: "https://github.com/o/r/pull/3" } });
    const noPr = fixture({ agents: [], runs: [], last_run: { p: { run_id: "r0", state: "partial", pr: null, ended_at: "t" } } });
    expect(hudModel(noPr, "p", 10_000).last).toEqual({ run_id: "r0", state: "partial", pr: null, href: null });
    const none = fixture({ agents: [], runs: [] });
    expect(hudModel(none, "p", 10_000)).toEqual({ project: "p", live: null, last: null, since: "0s ago" });
  });

  it("a PR that is not http(s) is no link target: href null, the PR kept as text", () => {
    const bad = fixture({ agents: [], runs: [], last_run: { p: { run_id: "r0", state: "complete", pr: "javascript:alert(1)", ended_at: "t" } } });
    expect(hudModel(bad, "p", 10_000).last).toEqual({ run_id: "r0", state: "complete", pr: "javascript:alert(1)", href: null });
  });

  it("before any event: no view, the time since is —", () => {
    expect(hudModel(createOfficeStore().getState(), "p", 5)).toEqual({ project: "p", live: null, last: null, since: NONE });
  });
});

describe("safeHref", () => {
  it("passes http(s) URLs only", () => {
    for (const ok of ["https://github.com/o/r/pull/3", "http://x/pull/1", "HTTPS://X/Y"]) expect(safeHref(ok)).toBe(ok);
    for (const bad of ["javascript:alert(1)", " javascript:alert(1)", "data:text/html,x", "//evil/x", "ftp://x", "github.com/o/r/pull/3", "", null, undefined]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe("the hold and the lerp (Story 39.5, Settled shape 9)", () => {
  it("the first value shows at once; a change is held under 1 s and shown at 1 s", () => {
    let h: Held<string> = hold(null, "A", 0);
    expect(h).toEqual({ value: "A", since: 0 });
    h = hold(h, "B", HOLD_MS - 1);
    expect(h.value).toBe("A");
    h = hold(h, "B", HOLD_MS);
    expect(h).toEqual({ value: "B", since: HOLD_MS });
  });

  it("a burst A→B→A inside 1 s never shows B; an equal value keeps the hold's start", () => {
    let h = hold<string>(null, "A", 0);
    const shown: string[] = [];
    for (const [raw, t] of [["B", 200], ["A", 400], ["A", 1200], ["A", 1500]] as const) {
      h = hold(h, raw, t);
      shown.push(h.value);
    }
    expect(shown).toEqual(["A", "A", "A", "A"]);
    expect(h.since).toBe(0);
    expect(hold({ value: { a: 1 }, since: 5 }, { a: 1 }, 6)).toEqual({ value: { a: 1 }, since: 5 });
  });

  it("independent keys hold independently (hudMotion)", () => {
    const live = (stage: string, story: string) => ({
      run_id: "r", stage, story, clock: null, clockText: "Loading the clock…", state: "running", engine_run_id: "e", done: 0, failed: 0, total: 1, phase: "x",
      bar: { total: 1, done: 0, fraction: 0, phases: [], findings: { count: null, label: LOADING_FINDINGS } },
    });
    let m = hudMotion(null, live("dev attempt 1 of 2", "39-5"), 0);
    m = hudMotion(m.motion, live("dev attempt 1 of 2", "39-6"), 1500);
    expect(m.shown.story).toBe("39-6");
    m = hudMotion(m.motion, live("review pass 1 of 3", "39-7"), 1600);
    expect([m.shown.stage, m.shown.story]).toEqual(["review pass 1 of 3", "39-6"]); // the stage held since 0, the story since 1500
    m = hudMotion(m.motion, live("review pass 1 of 3", "39-7"), 2500);
    expect(m.shown.story).toBe("39-7");
  });

  it("the tween: the first target at once, the midpoint, the end, a retarget from the current value", () => {
    let tw = tween(null, 10, 0);
    expect(valueAt(tw, 0)).toBe(10);
    tw = tween(tw, 20, 1000);
    expect(valueAt(tw, 1000)).toBe(10);
    expect(valueAt(tw, 1000 + LERP_MS / 2)).toBe(15);
    expect(valueAt(tw, 1000 + LERP_MS)).toBe(20);
    const mid = tween(tween(tween(null, 0, 0), 100, 1000), 0, 1000 + LERP_MS / 2);
    expect(mid.from).toBe(50);
    expect(valueAt(mid, 1000 + LERP_MS / 2)).toBe(50);
    expect(tween(tw, 20, 5000)).toBe(tw);
  });

  it("the clock's elapsed and the bars are held, then lerped (hudMotion): moving while a tween is in flight", () => {
    const clock = { elapsed_s: 100, guard_s: 7200, guard: "worker" as const, mode: "guarded" as const, label: "00:01:40 of 02:00:00", over: false, context: "engine: the worker's guard" };
    const live = (elapsed: number, fraction: number) => ({
      run_id: "r", stage: "s", story: "x", clock: { ...clock, elapsed_s: elapsed }, clockText: "", state: "running", engine_run_id: "e", done: 0, failed: 0, total: 2, phase: "x",
      bar: { total: 2, done: 0, fraction, phases: [{ key: "a", status: "current" as const, fill: 0.5 }], findings: { count: 3, label: "3 findings to drain" } },
    });
    let m = hudMotion(null, live(100, 0), 0);
    expect(m.shown).toMatchObject({ clockText: "00:01:40 of 02:00:00", fraction: 0, moving: false, findings: "3 findings to drain", clockContext: "engine: the worker's guard" });
    expect(m.shown.phases).toEqual([{ key: "a", status: "current", fill: 0.5 }]);
    m = hudMotion(m.motion, live(102, 0.5), 1000);
    expect(m.shown.moving).toBe(true);
    m = hudMotion(m.motion, live(102, 0.5), 1000 + LERP_MS / 2);
    expect(m.shown.fraction).toBe(0.25);
    expect(m.shown.clockText).toBe("00:01:41 of 02:00:00");
    m = hudMotion(m.motion, live(102, 0.5), 1000 + LERP_MS);
    expect(m.shown).toMatchObject({ fraction: 0.5, clockText: "00:01:42 of 02:00:00", moving: false });
  });
});

describe("the phased bar and the HUD's stage and clock (Story 39.5, Settled shape 8)", () => {
  const epic = { spec_folder: "_bmad-output/specs/spec-epic-39", done: 1, deferred: 1, failed: 0, total: 5, current_story: "39-5-the-run" };
  const stories = [
    { key: "39-1-a", status: "done" as const, phase: null, overlay: "done" as const },
    { key: "39-2-b", status: "deferred" as const, phase: null, overlay: "failed" as const },
    { key: "39-5-the-run", status: "current" as const, phase: "review-running", overlay: null },
    { key: "39-5-the-run-r1", status: "pending" as const, phase: null, overlay: null, extra: true as const },
  ];
  const board = (findings: number, keys = ["39.1", "39.5"]): BoardRead => ({
    ok: true,
    board: { epics: [{ id: "EP-38", findings: 9, stories: [{ key: "38.1" }] }, { id: "EP-39", findings, stories: keys.map((key) => ({ key })) }] } as unknown as BoardAnswer,
  });

  it("phases: the run's stories (not extra) padded to total; fills 1 done/deferred/failed, 0.5 current, 0 pending; the project bar done/total", () => {
    const b = phasedBar({ epic, stories }, board(4));
    expect(b.phases.map((p) => [p.key, p.status, p.fill])).toEqual([
      ["39-1-a", "done", 1], ["39-2-b", "deferred", 1], ["39-5-the-run", "current", 0.5], ["pending-4", "pending", 0], ["pending-5", "pending", 0],
    ]);
    expect([b.total, b.done, b.fraction]).toEqual([5, 1, 0.2]);
    expect(phasedBar({ epic: { ...epic, total: 0, done: 0 }, stories: [] }, null).fraction).toBe(0);
  });

  it("findings: the board epic holding the run's epic number, its labels while pending, unread, unmatched", () => {
    expect(phasedBar({ epic, stories }, board(4)).findings).toEqual({ count: 4, label: "4 findings to drain" });
    expect(phasedBar({ epic, stories }, null).findings).toEqual({ count: null, label: "Loading the findings…" });
    expect(phasedBar({ epic, stories }, { ok: false, error: "/board answered 500" }).findings.label).toBe("Findings unread: /board answered 500");
    expect(phasedBar({ epic, stories }, board(4, ["40.1"])).findings.label).toBe("No findings read for this epic");
    // No spec folder: the current story's leading number.
    expect(phasedBar({ epic: { ...epic, spec_folder: null }, stories }, board(2)).findings.count).toBe(2);
  });

  it("the HUD: the stage from the store, the clock from the run's detail, pending in words", () => {
    const store = createOfficeStore({ now: () => 0 });
    store.applySnapshot("b-1", {
      at: "", problems: [], agents: [{ agent_id: "p/session", project: "p", role: "session", state: "reading", current_run: "r1", current_story: null, reason: null }],
      runs: [{ run_id: "r1", project: "p", state: "running", engine_run_id: "e", stage: "review pass 2 of 2", epic, stories }],
    });
    const T0 = Date.parse("2026-11-10T00:00:00.000Z");
    const ev = (seq: number, s: number, kind: string, detail: Record<string, unknown> = {}): RunEvent => ({ seq, at: new Date(T0 + s * 1000).toISOString(), kind, from_state: "running", to_state: "running", detail });
    const run = { run_id: "r1", job_id: "j", project_id: "p", state: "running", reason: null, created: new Date(T0).toISOString(), engine_run_id: "e" } as RunRow;
    const detail = { run, events: [ev(1, 0, "claimed"), ev(2, 0, "worker", { guard_s: 7200 })] };
    const live = hudModel(store.getState(), "p", T0 + 4360_000, { board: board(4), detail })!.live!;
    expect(live.stage).toBe("review pass 2 of 2");
    expect(live.clockText).toBe("01:12:40 of 02:00:00");
    expect(live.bar.findings.label).toBe("4 findings to drain");
    const pending = hudModel(store.getState(), "p", T0, { detail: { ...detail, run: { ...run, run_id: "other" } } }).live!;
    expect([pending.clockText, pending.clock, pending.bar.findings.label]).toEqual(["Loading the clock…", null, LOADING_FINDINGS]);
  });
});

describe("the HUD after the review pass (Story 39.5)", () => {
  const base = {
    run_id: "r", stage: "s", story: "x", clock: null as RunClock | null, clockText: "Loading the clock…", state: "running", engine_run_id: "e", done: 0, failed: 0, total: 2, phase: "dev",
    bar: { total: 2, done: 0, fraction: 0, phases: [] as { key: string; status: "pending" | "current" | "done" | "failed" | "deferred"; fill: number }[], findings: { count: null, label: LOADING_FINDINGS } },
  };

  it("hudRunKey: the GET /runs re-read key changes on the live run's leg, stage and state; empty with no live run", () => {
    const at = (runs: Record<string, unknown>[]) => {
      const store = createOfficeStore({ now: () => 0 });
      store.applySnapshot("b-1", { at: "", problems: [], agents: [], runs });
      return store.getState();
    };
    const row = { run_id: "r1", project: "p", state: "running", engine_run_id: "e", stage: "host verify leg", leg: null };
    const before = hudRunKey(at([row]), "p");
    expect(before).not.toBe("");
    expect(hudRunKey(at([{ ...row, leg: { since: "2026-11-10T00:00:00Z" } }]), "p")).not.toBe(before);
    expect(hudRunKey(at([{ ...row, stage: "close-out" }]), "p")).not.toBe(before);
    expect(hudRunKey(at([{ ...row, state: "paused" }]), "p")).not.toBe(before);
    expect(hudRunKey(at([row]), "other")).toBe("");
  });

  it("hudRunKey: the GET /runs re-read key changes on the live run's worker (Settled shape 12)", () => {
    const at = (runs: Record<string, unknown>[]) => {
      const store = createOfficeStore({ now: () => 0 });
      store.applySnapshot("b-1", { at: "", problems: [], agents: [], runs });
      return store.getState();
    };
    const row = { run_id: "r1", project: "p", state: "running", engine_run_id: null, stage: "launching", leg: null, worker: null };
    const before = hudRunKey(at([row]), "p");
    const started = hudRunKey(at([{ ...row, worker: { since: "2026-11-10T00:00:00Z" } }]), "p");
    expect(started).not.toBe(before);
    expect(hudRunKey(at([{ ...row, worker: { since: "2026-11-10T00:05:00Z" } }]), "p")).not.toBe(started);
  });

  it("every HUD value is held: the state, the phase, the counts and the engine id stay at least 1 s", () => {
    let m = hudMotion(null, base, 0);
    expect([m.shown.state, m.shown.phase, m.shown.counts, m.shown.engine_run_id]).toEqual(["running", "dev", "done 0 · failed 0 · total 2", "e"]);
    const next = { ...base, state: "paused", phase: "review", done: 1, engine_run_id: "e2" };
    m = hudMotion(m.motion, next, HOLD_MS - 1);
    expect([m.shown.state, m.shown.phase, m.shown.counts, m.shown.engine_run_id]).toEqual(["running", "dev", "done 0 · failed 0 · total 2", "e"]);
    m = hudMotion(m.motion, next, HOLD_MS);
    expect([m.shown.state, m.shown.phase, m.shown.counts, m.shown.engine_run_id]).toEqual(["paused", "review", "done 1 · failed 0 · total 2", "e2"]);
  });

  it("a guard hand-over (worker → host leg) changes the guard and the elapsed together: never a false over the guard", () => {
    const worker: RunClock = { elapsed_s: 4000, guard_s: 7200, guard: "worker", mode: "guarded", label: "", over: false, context: "engine: the worker's guard" };
    const leg: RunClock = { elapsed_s: 5, guard_s: 600, guard: "host leg", mode: "guarded", label: "", over: false, context: "host leg: the leg's own guard" };
    let m = hudMotion(null, { ...base, clock: worker }, 0);
    expect(m.shown.clockText).toBe("01:06:40 of 02:00:00");
    // The leg's clock lands 0.5 s after a change was shown: still the worker's guard and elapsed, together.
    m = hudMotion(m.motion, { ...base, clock: { ...worker, elapsed_s: 4001 } }, 1000);
    m = hudMotion(m.motion, { ...base, clock: leg }, 1500);
    expect(m.shown).toMatchObject({ over: false, clockContext: "engine: the worker's guard" });
    expect(m.shown.clockText).toMatch(/ of 02:00:00$/);
    // Shown at 1 s: the leg's guard with the leg's own elapsed at once (no lerp backwards from the worker's elapsed).
    m = hudMotion(m.motion, { ...base, clock: leg }, 2000);
    expect(m.shown).toMatchObject({ clockText: "00:00:05 of 00:10:00", over: false, clockContext: "host leg: the leg's own guard" });
  });

  it("a story replacing a placeholder lerps its fill (phases held and lerped by position)", () => {
    const pad = { ...base, bar: { ...base.bar, phases: [{ key: "39-1", status: "done" as const, fill: 1 }, { key: "pending-2", status: "pending" as const, fill: 0 }] } };
    let m = hudMotion(null, pad, 0);
    const real = { ...base, bar: { ...base.bar, phases: [{ key: "39-1", status: "done" as const, fill: 1 }, { key: "39-2", status: "current" as const, fill: 0.5 }] } };
    m = hudMotion(m.motion, real, HOLD_MS);
    expect(m.shown.phases[1]).toEqual({ key: "39-2", status: "current", fill: 0 });
    expect(m.shown.moving).toBe(true);
    m = hudMotion(m.motion, real, HOLD_MS + LERP_MS / 2);
    expect(m.shown.phases[1].fill).toBe(0.25);
    m = hudMotion(m.motion, real, HOLD_MS + LERP_MS);
    expect(m.shown.phases[1].fill).toBe(0.5);
  });

  it("a failed run read: the clock names the failure, never Loading the clock… forever", () => {
    const store = createOfficeStore({ now: () => 0 });
    store.applySnapshot("b-1", { at: "", problems: [], agents: [], runs: [{ run_id: "r1", project: "p", state: "running", engine_run_id: "e" }] });
    const failed = hudModel(store.getState(), "p", 0, { detailError: { run_id: "r1", error: "/runs/r1 answered 500" } }).live!;
    expect(failed.clockText).toBe("The clock could not be read: /runs/r1 answered 500");
    expect(hudModel(store.getState(), "p", 0, { detailError: { run_id: "r0", error: "x" } }).live!.clockText).toBe("Loading the clock…");
  });
});
