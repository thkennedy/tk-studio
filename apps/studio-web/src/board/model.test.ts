// Story 30.5: the Board screen's rules from a fixture answer without a browser: the rows (phased bars of
// segments coloured by status, the findings count, the spend bar against the band, a null band), the three
// columns, the PR links (a non-http PR is no link), the ruling text, the board fetch (never throws) and the
// refetch key over the store.
import { describe, expect, it } from "vitest";
import { createOfficeStore, type LiveState } from "../live/store";
import { NONE } from "../office/model";
import {
  boardColumns, boardRows, boardUrl, fetchBoard, findingsText, refetchKey, rulingText, spendBar, statusColour, STATUS_COLOURS,
  type BoardAnswer, type FetchLike,
} from "./model";
import {
  boardPath, boardQuery, cardStage, columnOf, COLUMN_OWNERS, defaultEpic, DRAG_HINT, dropRule, KANBAN_STATUSES, kanbanColumns, postStoryStatus, prNumber,
  requestingText, requestReady, shownEpic, statusAnswerText, storyNumber,
} from "./model";
import { fetchInbox } from "../inbox/model";

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

// ------------------------------------------------------------ Story 39.4: the kanban

const NO_LIVE = { view: null, lastId: null, status: "connecting", lastEventAt: null } as unknown as LiveState;
const liveWith = (runs: { project: string | null; stories: { key: string; status: string; phase: string | null }[] }[]): LiveState =>
  ({ view: { runs: runs.map((r, i) => ({ run_id: `r${i}`, state: "running", engine_run_id: null, epic: null, ...r })) }, lastId: null, status: "live", lastEventAt: null }) as unknown as LiveState;
const kanbanFixture = (): BoardAnswer => {
  const b = fixture();
  const s = b.epics[0]!.stories;
  Object.assign(s[0]!, { band: "M", jira_key: "TKS-9", cost_usd: 13.9103, needs_you: false });
  Object.assign(s[1]!, { band: null, jira_key: null, cost_usd: null, needs_you: true });
  b.epics.push({ id: "EP-032", title: "Done epic", status: "done", band_usd: null, spend_usd: 0, findings: 0,
    stories: [{ id: "ST-130", key: "32.1", title: "Old", status: "done", findings: [], run: null }] });
  return b;
};

describe("Story 39.4: the kanban", () => {
  it("the canonical seven columns in enum order, titled; a non-canonical status sits in Draft with its word", () => {
    const cols = kanbanColumns(kanbanFixture(), NO_LIVE, "p", "EP-030");
    expect(cols.map((c) => [c.status, c.title])).toEqual([
      ["draft", "Draft"], ["ready", "Ready"], ["in-progress", "In progress"], ["blocked", "Blocked"], ["review", "Review"], ["done", "Done"], ["dropped", "Dropped"],
    ]);
    expect(KANBAN_STATUSES).toEqual(Object.keys(STATUS_COLOURS));
    expect(cols.map((c) => c.cards.map((k) => k.id))).toEqual([["ST-112"], [], ["ST-111"], [], ["ST-110"], ["ST-109"], []]);
    expect(cols[0]!.cards[0]).toMatchObject({ status: "mystery", statusWord: "mystery" });
    expect(cols[5]!.cards[0]!.statusWord).toBeNull();
  });

  it("the epic filter: the default is the last epic neither done nor dropped (else the last); all shows every story", () => {
    const b = kanbanFixture();
    expect(defaultEpic(b)).toBe("EP-031");
    expect(kanbanColumns(b, NO_LIVE, "p", null).flatMap((c) => c.cards.map((k) => k.id))).toEqual(["ST-120"]);
    expect(kanbanColumns(b, NO_LIVE, "p", "all").flatMap((c) => c.cards.map((k) => k.id)).sort()).toEqual(["ST-109", "ST-110", "ST-111", "ST-112", "ST-120", "ST-130"]);
    // an ?epic= the board does not carry falls back to the default (the select and the cards agree); all stays all
    expect(shownEpic(b, "EP-999")).toBe("EP-031");
    expect(shownEpic(b, "EP-030")).toBe("EP-030");
    expect(shownEpic(b, "all")).toBe("all");
    expect(shownEpic(b, null)).toBe("EP-031");
    expect(kanbanColumns(b, NO_LIVE, "p", "EP-999").flatMap((c) => c.cards.map((k) => k.id))).toEqual(["ST-120"]);
    b.epics.forEach((e) => { e.status = "done"; });
    expect(defaultEpic(b)).toBe("EP-032");
    expect(defaultEpic({ ...b, epics: [] })).toBeNull();
  });

  it("the card: badge, key and id, title, band, Jira key, PR number, cost, needs-you, and the story path", () => {
    const cols = kanbanColumns(kanbanFixture(), NO_LIVE, "my p", "EP-030");
    const done = cols[5]!.cards[0]!;
    expect(done).toEqual({
      id: "ST-109", status: "done", statusWord: null, epic: { id: "EP-030", title: "Studio Web v0" }, heading: "30.2 · ST-109", title: "Serves the web",
      band: "band M", jira: "TKS-9", pr: { text: "PR #7", href: PR }, cost: "$13.91", stage: null, needsYou: false, path: "/app/story/ST-109?project=my%20p",
    });
    const review = cols[4]!.cards[0]!;
    expect(review).toMatchObject({ band: "no band", jira: "no Jira key", cost: "no cost yet", needsYou: true });
    // a PR that is not http(s) (and names no /pull/<n>) is `PR`, never linked; `no PR` only with no PR
    expect(review.pr).toEqual({ text: "PR", href: null });
    expect(cols[2]!.cards[0]).toMatchObject({ pr: { text: "no PR", href: null }, band: "no band", cost: "no cost yet", needsYou: false });
    // an http(s) PR URL without /pull/<n>: `PR`, linked
    const odd = kanbanFixture();
    odd.epics[0]!.stories[0]!.run!.pr = "https://git.example.com/o/r/merge_requests/9";
    expect(kanbanColumns(odd, NO_LIVE, "p", "EP-030")[5]!.cards[0]!.pr).toEqual({ text: "PR", href: "https://git.example.com/o/r/merge_requests/9" });
    expect(prNumber("https://github.com/o/r/pull/372")).toBe("372");
    expect(prNumber(null)).toBeNull();
    expect(storyNumber("39-4-the-kanban")).toBe("39.4");
    expect(storyNumber("30.5")).toBe("30.5");
  });

  it("the stage: the project's live story numbered like the card and current; starting while its phase is null", () => {
    const live = liveWith([
      { project: "q", stories: [{ key: "30-4-the-office", status: "current", phase: "review" }] },
      { project: "p", stories: [{ key: "30-4-the-office", status: "current", phase: "dev-verify" }, { key: "30-5-the-board", status: "current", phase: null }, { key: "30-2-x", status: "done", phase: "dev" }] },
    ]);
    expect(cardStage(live, "p", "30.4")).toBe("dev-verify");
    expect(cardStage(live, "p", "30.5")).toBe("starting");
    expect(cardStage(live, "p", "30.2")).toBeNull();
    expect(cardStage(NO_LIVE, "p", "30.4")).toBeNull();
    const cols = kanbanColumns(kanbanFixture(), live, "p", "EP-030");
    expect(cols[2]!.cards[0]!.stage).toBe("dev-verify");
    expect(cols[5]!.cards[0]!.stage).toBeNull();
  });

  it("dropRule: draft → ready is the one request; the same column nothing; anything else refused naming the owner", () => {
    expect(dropRule("draft", "ready")).toEqual({ kind: "request", body: { status: "ready" } });
    expect(dropRule("review", "review")).toEqual({ kind: "none" });
    // a non-canonical status sits in Draft: dropped back on Draft is nothing; elsewhere refused with its own word
    expect(columnOf("mystery")).toBe("draft");
    expect(columnOf("review")).toBe("review");
    expect(dropRule("mystery", "draft")).toEqual({ kind: "none" });
    // a non-canonical card (it sits in Draft) dropped on ready: the column is the raw `from` (shape 4), which has no
    // owner of its own, so the draft writer's text is named; the status word kept
    expect(dropRule("approved", "ready")).toEqual({ kind: "refused", reason: `Refused: approved → ready. ${COLUMN_OWNERS.draft}. Only draft → ready is yours.` });
    expect(dropRule("mystery", "done")).toEqual({ kind: "refused", reason: `Refused: mystery → done. ${COLUMN_OWNERS.done}. Only draft → ready is yours.` });
    expect(dropRule("review", "ready")).toEqual({ kind: "refused", reason: `Refused: review → ready. ${COLUMN_OWNERS.review}. Only draft → ready is yours.` });
    expect(dropRule("draft", "done")).toEqual({ kind: "refused", reason: `Refused: draft → done. ${COLUMN_OWNERS.done}. Only draft → ready is yours.` });
    expect(dropRule("ready", "draft")).toEqual({ kind: "refused", reason: `Refused: ready → draft. ${COLUMN_OWNERS.draft}. Only draft → ready is yours.` });
    expect(Object.keys(COLUMN_OWNERS)).toEqual([...KANBAN_STATUSES]);
    expect(DRAG_HINT).toBe("Requests plansync status ready; the loop owns every other column");
    expect(requestingText("ST-177")).toBe("Requesting ready for ST-177 (plansync status and its Jira sync, up to two minutes)…");
  });

  it("the toggles: ?view=rows and ?epic= read and written, the kanban and the default epic carrying no query", () => {
    expect(boardQuery("")).toEqual({ view: "kanban", epic: null });
    expect(boardQuery("?view=rows&epic=all")).toEqual({ view: "rows", epic: "all" });
    expect(boardQuery("?view=odd&epic=")).toEqual({ view: "kanban", epic: null });
    expect(boardPath("my p", "kanban", null)).toBe("/app/board/my%20p");
    expect(boardPath("p", "rows", "EP-039")).toBe("/app/board/p?view=rows&epic=EP-039");
  });

  it("postStoryStatus: 200 is the new story, a 409 keeps the named body, a network error never throws", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const ok: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, project: "p", story: { id: "ST-177", status: "ready" }, previous_status: "draft", sync: "ok" }) };
    };
    const r = await postStoryStatus("p", "ST-177", "tok", ok);
    expect(r.ok).toBe(true);
    expect(seen[0]!.url).toBe("/stories/ST-177/status?project=p");
    expect(seen[0]!.init).toMatchObject({ method: "POST", body: JSON.stringify({ status: "ready" }), headers: { "x-csrf-token": "tok" } });
    expect(statusAnswerText("ST-177", r)).toBe("Ready: ST-177 (was draft)");

    const lease: FetchLike = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: "StoryLeaseHeld", run_id: "q-9", phase: "draft:39-4-x", holder: { pid: 1, host: "h" }, since: "2026-11-10T00:00:00Z" }) });
    const l = await postStoryStatus("p", "ST-177", null, lease);
    expect(l).toMatchObject({ ok: false, status: 409, error: "StoryLeaseHeld" });
    expect(statusAnswerText("ST-177", l)).toBe("StoryLeaseHeld: the loop holds ST-177 (run q-9, draft:39-4-x, since 2026-11-10T00:00:00Z)");
    const owner: FetchLike = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: "StoryStatusNotOwnerWritable", owner: COLUMN_OWNERS.review }) });
    expect(statusAnswerText("ST-1", await postStoryStatus("p", "ST-1", null, owner))).toBe(`StoryStatusNotOwnerWritable: ${COLUMN_OWNERS.review}`);
    const refused: FetchLike = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: "StoryStatusRefused", status: "draft", reason: "pinned" }) });
    expect(statusAnswerText("ST-1", await postStoryStatus("p", "ST-1", null, refused))).toBe("StoryStatusRefused: pinned (still draft)");

    const down: FetchLike = async () => { throw new Error("offline"); };
    const d = await postStoryStatus("p", "ST-177", null, down);
    expect(d).toEqual({ ok: false, status: null, body: null, error: "/stories/ST-177/status?project=p: offline" });
    expect(statusAnswerText("ST-177", d)).toBe("/stories/ST-177/status?project=p: offline");
  });

  it("requestReady: a failed inbox read posts nothing; a read token rides the post", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const down: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return { ok: false, status: 500, json: async () => ({ ok: false, error: "InboxFailed" }) };
    };
    const f = await requestReady("p", "ST-177", fetchInbox, down);
    expect(seen.map((s) => s.url)).toEqual(["/inbox?project=p"]);
    expect(f).toMatchObject({ ok: false, status: null, body: null });
    expect(f.ok ? "" : f.error).toMatch(/^The session token could not be read: \/inbox\?project=p answered 500/);
    expect(statusAnswerText("ST-177", f)).toBe(f.ok ? "" : f.error);

    seen.length = 0;
    const up: FetchLike = async (url, init) => {
      seen.push({ url, init });
      if (url.startsWith("/inbox")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, project: "p", items: [] }), headers: { get: (n: string) => (n.toLowerCase() === "x-csrf-token" ? "tok-1" : null) } };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, project: "p", story: { id: "ST-177", status: "ready" }, previous_status: "draft", sync: "ok" }) };
    };
    const r = await requestReady("p", "ST-177", fetchInbox, up);
    expect(seen.map((s) => s.url)).toEqual(["/inbox?project=p", "/stories/ST-177/status?project=p"]);
    expect(seen[1]!.init).toMatchObject({ method: "POST", headers: { "x-csrf-token": "tok-1" } });
    expect(r.ok).toBe(true);
    expect(statusAnswerText("ST-177", r)).toBe("Ready: ST-177 (was draft)");
  });
});
