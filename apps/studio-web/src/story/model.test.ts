// Story 39.4: the story page's rules from a fixture answer without a browser: the header (badge, key, id, status,
// band, the Jira link, the PR), the Stage Log row text (a closed priced row, an open row `running`, a host row), the
// total line (priced and unpriced), the "Needs you" strip (an inbox item, a run only, none), the run lines and their
// paths, the findings, the project of the address, and `fetchStory`'s answers and failures (never throws).
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../inbox/model";
import {
  fetchStory, findingText, LOADING_STORY, NO_PROJECT_STORY, needsYouStrip, projectOfSearch, runLine, spanText, stageRowText, storyUrl, storyView, totalLine,
  type StageLogRow, type StoryAnswer,
} from "./model";

const PR = "https://github.com/o/r/pull/372";
const row = (o: Partial<StageLogRow>): StageLogRow => ({
  spec: "39-4-the-kanban-and-the-story", stage: "dev", pass: "1", started: "2026-11-10T04:00:00Z", ended: "2026-11-10T04:41:39Z", session_id: "s",
  model: "claude-opus-5-5", effort: "medium", tokens_in: 26350955, tokens_out: 183986, cost_usd: 13.9103, outcome: "done", buffered: false, posted: true, ...o,
});
const fixture = (): StoryAnswer => ({
  ok: true, project: "p", built_at: "2026-11-10T07:00:00.000Z",
  story: {
    id: "ST-177", key: "39.4", title: "The Kanban and the Story", status: "in-progress", parent: "EP-039",
    epic: { id: "EP-039", number: "39", title: "The Studio Web, Finished" }, band: "L", jira_key: "TKS-177",
    jira_url: "https://example.atlassian.net/browse/TKS-177", updated: "2026-11-10T04:00:00+00:00",
  },
  plan_text: "Line one.\n<script>never</script>\n",
  stage_log: {
    specs: ["_bmad-output/specs/spec-epic-39/stories/39-4-the-kanban-and-the-story-spec.md"],
    rows: [row({ stage: "plan", pass: null, model: null, effort: null, tokens_in: null, tokens_out: null, cost_usd: null, posted: null }), row({}), row({ stage: "review", ended: null, posted: false })],
    total: { rows: 3, priced: 1, tokens_in: 26350955, tokens_out: 183986, cost_usd: 13.9103, seconds: 2499 },
  },
  runs: [
    { run_id: "q-1", studio_run_id: "s-1", job_id: "run-epic-39", state: "complete", pr: PR, host_verify: "green", created: "x", ended_at: "y", cost_usd: 13.9 },
    { run_id: "q-2", studio_run_id: null, job_id: "run-epic-39", state: "paused", pr: null, host_verify: null, created: "x", ended_at: null, cost_usd: null },
  ],
  pr: PR,
  findings: [{ id: "DW-217", title: "The chat stalls", severity: "medium" }, { id: "DW-218", title: "No severity", severity: null }],
  needs_you: { run_ids: ["q-2"], inbox: { issue: "TKS-177", title: "Pick a layout", state: "open" } },
});

describe("the story page's view (AC4)", () => {
  it("the header: badge, key and id, title, status, band, the Jira key as a link, the PR", () => {
    expect(storyView(fixture())).toEqual({
      badge: { text: "EP-039", title: "The Studio Web, Finished" }, heading: "39.4 · ST-177", title: "The Kanban and the Story", status: "in-progress",
      band: "band L", jira: { text: "TKS-177", href: "https://example.atlassian.net/browse/TKS-177" }, pr: { text: "PR #372", href: PR },
    });
    const bare = fixture();
    Object.assign(bare.story, { epic: null, key: null, band: null, jira_key: null, jira_url: null });
    bare.pr = null;
    expect(storyView(bare)).toMatchObject({ badge: null, heading: "ST-177", band: "no band", jira: { text: "no Jira key", href: null }, pr: { text: "no PR", href: null } });
    // a Jira key without a site is plain text; a non-http URL is never a link
    Object.assign(bare.story, { jira_key: "TKS-1", jira_url: "javascript:alert(1)" });
    expect(storyView(bare).jira).toEqual({ text: "TKS-1", href: null });
  });

  it("the Stage Log rows: stage and pass, local start, the span or running, model and effort or host, tokens, cost, posted", () => {
    const local = (iso: string) => `L(${iso})`;
    const [plan, dev, review] = fixture().stage_log.rows.map((r) => stageRowText(r, local));
    expect(dev).toEqual({
      stage: "dev 1", started: "L(2026-11-10T04:00:00Z)", span: "41m 39s", model: "claude-opus-5-5 medium",
      tokens: "26,350,955 in / 183,986 out", cost: "$13.9103", outcome: "done", posted: "posted to Jira",
    });
    expect(plan).toMatchObject({ stage: "plan", model: "host", tokens: "none", cost: "none", posted: "" });
    expect(review).toMatchObject({ stage: "review 1", span: "running", posted: "not posted" });
    expect(spanText(30)).toBe("30s");
    expect(spanText(3723)).toBe("1h 2m 3s");
  });

  it("the total line: priced, and no priced rows yet", () => {
    expect(totalLine(fixture().stage_log.total)).toBe("Total: $13.91 over 1 priced of 3 rows · 26,350,955 in / 183,986 out · 41m 39s");
    expect(totalLine({ rows: 2, priced: 0, tokens_in: null, tokens_out: null, cost_usd: null, seconds: 60 })).toBe("Total: no priced rows yet (2 rows)");
  });

  it("the Needs-you strip: the inbox item first, else the waiting run, else none", () => {
    const a = fixture();
    expect(needsYouStrip(a)).toEqual({ text: "TKS-177 Pick a layout (open)", path: "/app/inbox/TKS-177?project=p" });
    a.needs_you = { run_ids: ["q-2"], inbox: null };
    expect(needsYouStrip(a)).toEqual({ text: "run q-2 waits on you", path: "/app/run/q-2" });
    a.needs_you = null;
    expect(needsYouStrip(a)).toBeNull();
    a.needs_you = { run_ids: [], inbox: null };
    expect(needsYouStrip(a)).toBeNull();
  });

  it("the runs link /app/run/<id>; the findings read DW-NN title (severity)", () => {
    const [done, paused] = fixture().runs.map(runLine);
    expect(done).toEqual({ text: "run q-1 · complete · $13.90", path: "/app/run/q-1", pr: { text: "PR #372", href: PR } });
    expect(paused).toEqual({ text: "run q-2 · paused · unmetered", path: "/app/run/q-2", pr: { text: "no PR", href: null } });
    expect(fixture().findings.map(findingText)).toEqual(["DW-217 The chat stalls (medium)", "DW-218 No severity"]);
  });

  it("the project of the address, and the pending text", () => {
    expect(projectOfSearch("?project=my%20p")).toBe("my p");
    expect(projectOfSearch("?project=")).toBeNull();
    expect(projectOfSearch("?project=%20p%20")).toBe("p");
    expect(projectOfSearch("?project=%20%20")).toBeNull();
    expect(projectOfSearch("")).toBeNull();
    expect(LOADING_STORY).toBe("Loading the story…");
    expect(NO_PROJECT_STORY).toBe("No project: open the story from the board");
  });
});

describe("fetchStory (never throws)", () => {
  it("the answer on 200, the URL with the project", async () => {
    const seen: string[] = [];
    const f: FetchLike = async (url) => { seen.push(url); return { ok: true, status: 200, json: async () => fixture() }; };
    expect(await fetchStory("my p", "ST-177", f)).toEqual({ ok: true, story: fixture() });
    expect(seen).toEqual(["/stories/ST-177?project=my%20p"]);
    expect(storyUrl("p", "ST-1")).toBe("/stories/ST-1?project=p");
  });

  it("a named refusal reads <error>: <detail>; an unnamed one the status; a malformed body and a network error name themselves", async () => {
    const named: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: "UnknownStory", project: "p", story: "ST-999", detail: "no story ST-999 in project p" }) });
    expect(await fetchStory("p", "ST-999", named)).toEqual({ ok: false, error: "UnknownStory: no story ST-999 in project p" });
    const bad: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: "BadStory", story: "x" }) });
    expect(await fetchStory("p", "x", bad)).toEqual({ ok: false, error: "BadStory: x" });
    const bare: FetchLike = async () => ({ ok: false, status: 502, json: async () => { throw new Error("no json"); } });
    expect(await fetchStory("p", "ST-1", bare)).toEqual({ ok: false, error: "/stories/ST-1?project=p answered 502" });
    const malformed: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, story: {} }) });
    expect(await fetchStory("p", "ST-1", malformed)).toEqual({ ok: false, error: "/stories/ST-1?project=p: no story in the answer" });
    const down: FetchLike = async () => { throw new Error("offline"); };
    expect(await fetchStory("p", "ST-1", down)).toEqual({ ok: false, error: "/stories/ST-1?project=p: offline" });
  });
});
