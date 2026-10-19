// Story 30.5: the Board screen's rules from a fixture answer without a browser: the rows (phased bars of
// segments coloured by status, the findings count, the spend bar against the band, a null band), the three
// columns, the PR links (a non-http PR is no link), the ruling text, the board fetch (never throws) and the
// refetch key over the store.
import { describe, expect, it } from "vitest";
import { createOfficeStore } from "../live/store";
import { NONE } from "../office/model";
import {
  boardColumns, boardRows, boardUrl, fetchBoard, findingsText, refetchKey, rulingText, spendBar, statusColour, STATUS_COLOURS,
  type BoardAnswer, type FetchLike,
} from "./model";

const PR = "https://github.com/o/r/pull/7";
const fixture = (): BoardAnswer => ({
  ok: true,
  project: "p",
  built_at: "2026-10-19T12:00:00.000Z",
  plan: {},
  epics: [
    {
      id: "EP-030", title: "Studio Web v0", status: "in-progress", band_usd: 40, spend_usd: 5.25, findings: 2,
      stories: [
        { id: "ST-109", key: "30.2", title: "Serves the web", status: "done", findings: [],
          run: { run_id: "r1", state: "complete", pr: PR, host_verify: "green", ended_at: "2026-10-19T10:00:00.000Z" } },
        { id: "ST-110", key: "30.3", title: "The stream", status: "review",
          findings: [{ id: "DW-2", title: "watchdog", severity: "medium" }],
          run: { run_id: "r2", state: "paused", pr: "javascript:alert(1)", host_verify: null, ended_at: null } },
        { id: "ST-111", key: "30.4", title: "The office", status: "in-progress",
          findings: [{ id: "DW-4", title: "bubble", severity: "low" }], run: null },
        { id: "ST-112", key: "30.5", title: "The board", status: "mystery", findings: [], run: null },
      ],
    },
    { id: "EP-031", title: "Inbox", status: "draft", band_usd: null, spend_usd: 1.5, findings: 0,
      stories: [{ id: "ST-120", key: "31.1", title: "The inbox", status: "draft", findings: [], run: null }] },
  ],
  triage: {
    needs_you: [
      { run_id: "r2", state: "paused", story_key: "30-3-the-stream", pr: "javascript:alert(1)", ruling: "which spec wins?" },
      { run_id: "r3", state: "running", story_key: null, pr: null, ruling: null },
    ],
    working: [{ run_id: "r4", state: "running", story_key: "30-4-the-office", pr: null, ruling: null }],
    done: [{ run_id: "r1", state: "complete", story_key: null, pr: PR, ruling: null }],
  },
});

describe("the rows", () => {
  it("one row per epic, a segment per story coloured by its status (unknown reads as draft)", () => {
    const rows = boardRows(fixture());
    expect(rows.map((r) => r.id)).toEqual(["EP-030", "EP-031"]);
    expect(rows[0].segments.map((s) => [s.key, s.status, s.colour])).toEqual([
      ["30.2", "done", STATUS_COLOURS.done],
      ["30.3", "review", STATUS_COLOURS.review],
      ["30.4", "in-progress", STATUS_COLOURS["in-progress"]],
      ["30.5", "mystery", STATUS_COLOURS.draft],
    ]);
    expect(new Set(["draft", "ready", "in-progress", "blocked", "review", "done", "dropped"].map(statusColour)).size).toBe(7);
    expect(rows[0].colour).toBe(STATUS_COLOURS["in-progress"]);
  });

  it("the findings count is the open findings of the stories, and drains as they close", () => {
    const b = fixture();
    expect(boardRows(b)[0]).toMatchObject({ findings: 2, findingsText: "2 findings" });
    expect(boardRows(b)[0].segments.map((s) => s.findings)).toEqual([0, 1, 1, 0]);
    b.epics[0].stories[1].findings = [];
    expect(boardRows(b)[0]).toMatchObject({ findings: 1, findingsText: "1 finding" });
    expect(findingsText(0)).toBe("0 findings");
  });

  it("the spend bar sits against the band; a null band shows the spend alone", () => {
    const rows = boardRows(fixture());
    expect(rows[0].spend).toEqual({ spend_usd: 5.25, band_usd: 40, fill: 5.25 / 40, over: false, text: "$5.25 / $40.00" });
    expect(rows[1].spend).toEqual({ spend_usd: 1.5, band_usd: null, fill: null, over: false, text: "$1.50" });
    expect(spendBar(50, 40)).toMatchObject({ fill: 1, over: true, text: "$50.00 / $40.00" });
    expect(spendBar(3, 0)).toMatchObject({ band_usd: null, fill: null, text: "$3.00" });
  });

  it("a segment links its latest run's PR only when it is http(s)", () => {
    const segs = boardRows(fixture())[0].segments;
    expect(segs.map((s) => s.href)).toEqual([PR, null, null, null]);
  });
});

describe("the columns", () => {
  it("Needs you, Working, Done in order, each item with its story, its PR link and the ruling it waits for", () => {
    const cols = boardColumns(fixture());
    expect(cols.map((c) => [c.key, c.title, c.items.map((i) => i.run_id)])).toEqual([
      ["needs_you", "Needs you", ["r2", "r3"]],
      ["working", "Working", ["r4"]],
      ["done", "Done", ["r1"]],
    ]);
    expect(cols[0].items[0]).toEqual({ run_id: "r2", state: "paused", story: "30-3-the-stream", href: null, ruling: "waits for: which spec wins?" });
    expect(cols[0].items[1]).toEqual({ run_id: "r3", state: "running", story: NONE, href: null, ruling: null });
    expect(cols[2].items[0].href).toBe(PR);
    expect(rulingText({ ruling: null })).toBeNull();
    expect(rulingText({ ruling: "" })).toBeNull();
  });
});

describe("fetchBoard (never throws)", () => {
  const answering = (status: number, body: unknown, seen: string[] = []): FetchLike => async (url) => {
    seen.push(url);
    return { ok: status === 200, status, json: async () => (body instanceof Error ? Promise.reject(body) : body) };
  };

  it("reads the absolute /board?project=<id> and answers the board", async () => {
    const seen: string[] = [];
    const res = await fetchBoard("my proj", answering(200, fixture(), seen));
    expect(seen).toEqual(["/board?project=my%20proj"]);
    expect(boardUrl("p")).toBe("/board?project=p");
    expect(res).toEqual({ ok: true, board: fixture() });
  });

  it("a failed fetch, a non-200, a non-JSON or a malformed body is {ok:false, error}", async () => {
    const thrown = await fetchBoard("p", async () => { throw new Error("network down"); });
    expect(thrown).toEqual({ ok: false, error: "/board?project=p: network down" });
    expect(await fetchBoard("p", answering(404, { ok: false, error: "UnknownProject" }))).toEqual({ ok: false, error: "/board?project=p answered 404 UnknownProject" });
    expect(await fetchBoard("p", answering(500, new Error("not json")))).toEqual({ ok: false, error: "/board?project=p answered 500" });
    const notJson = await fetchBoard("p", answering(200, new SyntaxError("Unexpected token <")));
    expect(notJson).toEqual({ ok: false, error: "/board?project=p: Unexpected token <" });
    expect(await fetchBoard("p", answering(200, { ok: true, epics: "x" }))).toEqual({ ok: false, error: "/board?project=p: no board in the answer" });
    expect(await fetchBoard("p", answering(200, null))).toMatchObject({ ok: false });
    // A body the screen would dereference and throw on: no plan, an epic with no stories, a story with no
    // findings, a triage column that is not an array.
    const malformed = (edit: (b: Record<string, any>) => void) => { const b = fixture() as unknown as Record<string, any>; edit(b); return b; };
    for (const body of [
      malformed((b) => { delete b.plan; }),
      malformed((b) => { delete b.epics[1].stories; }),
      malformed((b) => { delete b.epics[0].stories[2].findings; }),
      malformed((b) => { b.epics[0] = null; }),
      malformed((b) => { b.triage.working = "x"; }),
    ]) {
      expect(await fetchBoard("p", answering(200, body))).toEqual({ ok: false, error: "/board?project=p: no board in the answer" });
    }
  });
});

describe("the refetch key", () => {
  const epic = { spec_folder: null, done: 0, deferred: 0, failed: 0, total: 3, current_story: "30-5" };
  const snapshot = {
    at: "", problems: [], agents: [{ agent_id: "p/session", project: "p", role: "session", state: "typing", current_run: "r1", current_story: null, reason: null }],
    runs: [{ run_id: "r1", project: "p", state: "running", engine_run_id: null, epic, stories: [{ key: "30-5", status: "current", phase: null, overlay: null }] }],
    last_run: {},
  };

  it("changes on an office.run or office.progress delta, not on an office.agent one", () => {
    const store = createOfficeStore({ now: () => 1 });
    expect(refetchKey(store.getState(), "p")).toBe("");
    store.applySnapshot("b-1", snapshot);
    expect(refetchKey(store.getState(), null)).toBe("");
    const k1 = refetchKey(store.getState(), "p");
    store.applyDelta("b-2", "office.agent", { agent_id: "p/session", state: "reading", from: "typing", at: "x", current_run: "r1", current_story: null });
    expect(refetchKey(store.getState(), "p")).toBe(k1);
    store.applyDelta("b-3", "office.progress", { run_id: "r1", epic: { ...epic, done: 1 } });
    const k2 = refetchKey(store.getState(), "p");
    expect(k2).not.toBe(k1);
    store.applyDelta("b-4", "office.run", { run_id: "r1", project: "p", state: "paused", from: "running" });
    expect(refetchKey(store.getState(), "p")).not.toBe(k2);
  });

  it("changes only on the selected project's runs and last_run, not on another project's", () => {
    const store = createOfficeStore({ now: () => 1 });
    store.applySnapshot("c-1", { ...snapshot, runs: [...snapshot.runs, { ...snapshot.runs[0], run_id: "q1", project: "q" }] });
    const k1 = refetchKey(store.getState(), "p");
    store.applyDelta("c-2", "office.run", { run_id: "q1", project: "q", state: "paused", from: "running" });
    store.applyDelta("c-3", "office.progress", { run_id: "q1", epic: { ...epic, done: 2 } });
    expect(refetchKey(store.getState(), "p")).toBe(k1);
    expect(refetchKey(store.getState(), "q")).not.toBe(k1);
    store.applyDelta("c-4", "office.run", { run_id: "r1", project: "p", state: "complete", from: "running", last_run: { run_id: "r1", state: "complete", pr: null, ended_at: "2026-10-19T12:00:00.000Z" } });
    expect(refetchKey(store.getState(), "p")).not.toBe(k1);
  });

  it("changes when a run whose project is not known yet (an office.progress before its office.run) changes", () => {
    const store = createOfficeStore({ now: () => 1 });
    store.applySnapshot("d-1", snapshot);
    store.applyDelta("d-2", "office.progress", { run_id: "u1", epic });
    expect(store.getState().view?.runs.find((r) => r.run_id === "u1")?.project).toBeNull();
    const k1 = refetchKey(store.getState(), "p");
    store.applyDelta("d-3", "office.progress", { run_id: "u1", epic: { ...epic, done: 1 } });
    expect(refetchKey(store.getState(), "p")).not.toBe(k1);
  });
});
