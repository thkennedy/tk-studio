// Story 30.4: the Office screen's rules without a browser or WebGL: the state-to-frames mapping for
// all eight states (30.7: the per-role sets and the idle fallback), the bubble rule, the desks, the HUD's fields from a fixture store (the null
// seams and no live run), the registry fetch and the project switcher with a fake storage.
import { describe, expect, it } from "vitest";
import { createOfficeStore, OFFICE_STATES, type OfficeState } from "../live/store";
import {
  agentsUrl, bubbleFor, safeHref, desksFrom, fetchAgents, framesFor, hudModel, NONE, PENDING, PROJECT_KEY, projectsFrom,
  rememberedProject, rememberProject, type FrameSheet, type StorageLike,
} from "./model";

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
      { agent_id: "p/orchestrator", role: "orchestrator", state: "waiting-for-human", reason: "a ruling" },
      { agent_id: "p/session", role: "session", state: "typing", reason: null },
      { agent_id: "p/planner", role: "planner", state: "offline", reason: null },
    ]);
    expect(desksFrom([rows[4]], null)).toEqual([{ agent_id: "r.s/advisor", role: "advisor", state: "offline", reason: null }]);
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
      live: { run_id: "r1", state: "running", engine_run_id: "eng-1", done: 2, failed: 1, total: 7, story: "30-4", phase: "dev-running" },
      last: null,
      since: "3s ago",
    });
  });

  it("the null seams: a state-null row is pending, a null engine id and phase are —", () => {
    const state = fixture({
      agents: [agent("session", "r2")],
      runs: [{ run_id: "r2", project: null, state: null, engine_run_id: null, epic: { ...epic, current_story: null }, stories: [] }],
    });
    expect(hudModel(state, "p", 10_000).live).toEqual({
      run_id: "r2", state: PENDING, engine_run_id: NONE, done: 2, failed: 1, total: 7, story: NONE, phase: NONE,
    });
    expect(hudModel(state, "p", 10_000).since).toBe("0s ago");
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
