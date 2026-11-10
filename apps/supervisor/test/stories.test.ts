// Story 39.4: the story read (`GET /stories/{id}?project=<id>`, `stories.ts` `storyFor`) — the board fixture's plan
// copied into a temp root plus a story spec with a Stage Log, its `-r1` remediation, a `30-50-` spec that must not
// match, a buffer, the story plan's band, `stage-posts.json`, `inbox.json`, the Jira site and a ledger — the routes'
// refusals and auth, the board's four new story fields, and `storyLeaseHolder` per phase.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createApi } from "../src/api";
import { SESSION_COOKIE, signSession } from "../src/auth";
import { boardFor, parseStageLog, stageRowKey, type BoardAnswer } from "../src/board";
import { COLUMN_OWNERS, ownerTransition, storyFor, storyLeaseHolder, type StoryAnswer } from "../src/stories";
import { runFacts } from "../src/board";
import { Queue, type Owner, type Probes, type QueueRun, type WorkerKill } from "../src/queue";
import { tempDir, track } from "./tmp";

const FX = join(import.meta.dir, "fixtures", "board");
const TOKEN = "tok-39-4-stories-secret";
const SECRET = "s".repeat(48);
const ME: Owner = { pid: process.pid, host: hostname(), nonce: "stories-test" };
const DEAD: Owner = { pid: 999_991, host: "elsewhere", nonce: "stories-dead" };
const BASE = "http://100.64.0.1:8787";
const PLAN = join("_bmad-output", "planning-artifacts", "plan");
const FOLDER = join("_bmad-output", "specs", "spec-epic-30");
const KEY = "30-5-the-board-screen";
const PR = (n: number) => `https://github.com/o/r/pull/${n}`;
const HEADER = "| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |\n|---|---|---|---|---|---|---|---|---|---|---|\n";
const row = (cells: string[]) => `| ${cells.join(" | ")} |\n`;
const PLAN_ROW = ["plan", "—", "2026-11-09T17:24:14Z", "2026-11-09T17:48:19Z", "—", "claude-opus-5-5", "high", "—", "—", "—", "done"];
const DEV_ROW = ["dev", "1", "2026-11-10T04:00:00Z", "2026-11-10T04:41:39Z", "sess-1", "claude-opus-5-5", "medium", "26350955", "183986", "13.9103", "done"];
const OPEN_ROW = ["review", "1", "2026-11-10T05:00:00Z", "—", "—", "—", "—", "—", "—", "—", "—"];
const R1_ROW = ["dev", "1", "2026-11-10T03:00:00Z", "2026-11-10T03:10:00Z", "sess-r", "claude-opus-5-5", "medium", "100", "50", "1.5", "done"];
const cellsOf = (cells: string[]) => ({ stage: cells[0]!, pass: cells[1]!, started: cells[2]! });

function world() {
  const root = tempDir("tk-sup-stories-root-");
  cpSync(join(FX, "plan"), join(root, PLAN), { recursive: true });
  mkdirSync(join(root, "_bmad-output", "implementation-artifacts"), { recursive: true });
  cpSync(join(FX, "deferred-work.md"), join(root, "_bmad-output", "implementation-artifacts", "deferred-work.md"));
  // ST-112 (30.5, draft) carries a Jira key; ST-111 (30.4) none.
  const st112 = join(root, PLAN, "ST-112.md");
  writeFileSync(st112, readFileSync(st112, "utf-8").replace('source: "epics.md#story-30.5"\n', 'source: "epics.md#story-30.5"\nexternal:\n  jira:\n    key: TKS-12\n    status: To Do\n')
    .replace("The Board Screen (board fixture).", "The Board Screen (board fixture).\r\n\r\n<b>never HTML</b>"));
  const stories = join(root, FOLDER, "stories");
  mkdirSync(stories, { recursive: true });
  writeFileSync(join(stories, `${KEY}-spec.md`), `---\ntitle: x\n---\n\n## Intent\n\n\`\`\`\n## Stage Log\n| a | b |\n\`\`\`\n\n## Stage Log\n\n${HEADER}${row(DEV_ROW)}${row(PLAN_ROW)}${row(OPEN_ROW)}| short | row |\n\n## After\n${row(R1_ROW)}`);
  writeFileSync(join(stories, `${KEY}-r1-spec.md`), `## Stage Log\n${HEADER}${row(R1_ROW)}`);
  writeFileSync(join(stories, "30-50-another-story-spec.md"), `## Stage Log\n${HEADER}${row(["dev", "1", "2026-11-01T00:00:00Z", "2026-11-01T01:00:00Z", "x", "m", "e", "1", "1", "99", "done"])}`);
  const stages = join(root, FOLDER, "stages");
  mkdirSync(stages, { recursive: true });
  const asJson = (cells: string[]) => JSON.stringify(Object.fromEntries(["stage", "pass", "started", "ended", "session_id", "model", "effort", "tokens_in", "tokens_out", "cost_usd", "outcome"].map((c, i) => [c, cells[i]])));
  const BUFFERED = ["gate", "—", "2026-11-10T06:00:00Z", "2026-11-10T06:00:30Z", "—", "—", "—", "—", "—", "—", "done"];
  writeFileSync(join(stages, `${KEY}.jsonl`), `${asJson(PLAN_ROW)}\n${asJson(BUFFERED)}\nnot json\n`);
  const plans = join(root, FOLDER, "plans");
  mkdirSync(plans, { recursive: true });
  writeFileSync(join(plans, "30-5.md"), "---\nstory: \"30-5\"\nband: M\n---\n\nplanner text, never served\n");
  writeFileSync(join(plans, "30-50.md"), "---\nband: S\n---\n");
  mkdirSync(join(root, "_bmad-output", "tracking"), { recursive: true });
  writeFileSync(join(root, "_bmad-output", "tracking", "stage-posts.json"), JSON.stringify({
    [stageRowKey(`${KEY}-spec`, cellsOf(DEV_ROW))]: { start: { id: "1", created: "x" }, stop: { id: "2", created: "y" }, worklog: { id: "3" } },
    [stageRowKey(KEY, cellsOf(OPEN_ROW))]: { start: { id: "4", created: "x" } },
    [stageRowKey(KEY, cellsOf(PLAN_ROW))]: { start: { id: "5", created: "x" }, stop: { id: "6", created: "y" }, worklog: "skipped: span <60s" },
    [stageRowKey(`${KEY}-r1`, cellsOf(R1_ROW))]: { start: { id: "7", created: "x" } },
  }));
  writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ generated_at: "x", items: [
    { issue: "TKS-12", entity: "ST-112", title: "Pick a layout", priority: "High", blocked_since: "x", reason_comment: null, state: "resolved" },
    { issue: "TKS-12", title: "Pick a layout", priority: "High", blocked_since: "x", reason_comment: null, state: "open" },
  ] }));
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), "planning:\n  jira:\n    site: example.atlassian.net/\n");

  const home = tempDir("tk-sup-stories-home-");
  mkdirSync(join(home, "measurements"), { recursive: true });
  writeFileSync(join(home, "measurements", "u-m.jsonl"), [
    JSON.stringify({ event: "job-run", project: "p", payload: { job_id: "run-epic-30", run_id: "studio-a", total_cost_usd: 4.25 } }),
  ].join("\n") + "\n");
  const probes: Probes = {
    ownerAlive: (o) => o.nonce === ME.nonce,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
  };
  const queue = track(new Queue(join(tempDir("tk-sup-stories-q-"), "q.db"), probes));
  const bare = tempDir("tk-sup-stories-bare-");
  const registry = async () => ({ projects: { p: { root }, n: { root: bare } } });
  const enqueue = () => queue.enqueue({ jobId: "run-epic-30", root: tempDir("tk-sup-stories-co-"), projectId: "p", target: "skill", definition: { id: "run-epic-30" } }).run;
  const claim = async (run: QueueRun) => { const c = await queue.claim(run.run_id, ME); if (!c.claimed) throw new Error(`not claimed: ${c.why}`); return queue.get(run.run_id)!; };
  const deps = () => ({ queue, registry, env: { TK_STUDIO_HOME: home }, ledger: { user: "u", machine: "m" }, now: () => Date.parse("2026-11-10T07:00:00Z"), self: ME });
  const read = async (id = "ST-112", project = "p") => storyFor(project, id, deps());
  const handler = createApi({ queue, token: TOKEN, session: { secret: SECRET }, submit: async () => { throw new Error("never"); }, registry, env: { TK_STUDIO_HOME: home }, ledger: { user: "u", machine: "m" } });
  const call = (method: string, path: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
    handler(new Request(`${BASE}${path}`, { method, headers }));
  return { root, home, queue, enqueue, claim, deps, read, call, stories };
}

describe("Story 39.4: the story read (AC1)", () => {
  test("the composition: the frontmatter, the plan text, the Stage Log, the runs, the PR, the findings, needs-you", async () => {
    const w = world();
    const older = await w.claim(w.enqueue());
    w.queue.db.query("UPDATE runs SET studio_run_id = ? WHERE run_id = ?").run("studio-a", older.run_id);
    w.queue.note(older.run_id, "plan-status", { phase: "review", pr: PR(4), story_key: KEY, id: "ST-112", ok: true });
    w.queue.end(older.run_id, "complete", null, { detail: { pr: PR(4) } });
    const paused = await w.claim(w.enqueue());
    w.queue.markPaused(paused.run_id, { engine: { paused_story_key: KEY, paused_reason: "the gate vetoed" }, pr: PR(5) });
    w.enqueue(); // a run naming no story: not the story's

    const a = await w.read();
    expect(a.status).toBe(200);
    const s = a.body as unknown as StoryAnswer;
    expect(s.ok).toBe(true);
    expect(s.project).toBe("p");
    expect(s.story).toEqual({
      id: "ST-112", key: "30.5", title: "The Board Screen", status: "draft", parent: "EP-030",
      epic: { id: "EP-030", number: "30", title: "Studio Web v0: Office, Board, Status" }, band: "M",
      jira_key: "TKS-12", jira_url: "https://example.atlassian.net/browse/TKS-12", updated: "2026-10-19T17:32:12+00:00",
    });
    expect(s.plan_text).toBe("The Board Screen (board fixture).\n\n<b>never HTML</b>\n");
    // The specs: the story's and its remediation, never `30-50-`; root-relative POSIX.
    expect(s.stage_log.specs).toEqual([`_bmad-output/specs/spec-epic-30/stories/${KEY}-r1-spec.md`, `_bmad-output/specs/spec-epic-30/stories/${KEY}-spec.md`]);
    // Rows sorted by started; the buffered duplicate of the plan row dropped, the new buffered row kept.
    expect(s.stage_log.rows.map((r) => [r.spec, r.stage, r.pass, r.buffered, r.posted])).toEqual([
      [KEY, "plan", null, false, true],
      [`${KEY}-r1`, "dev", "1", false, false],
      [KEY, "dev", "1", false, true],
      [KEY, "review", "1", false, true],
      [KEY, "gate", null, true, false],
    ]);
    expect(s.stage_log.rows[2]).toEqual({
      spec: KEY, stage: "dev", pass: "1", started: "2026-11-10T04:00:00Z", ended: "2026-11-10T04:41:39Z", session_id: "sess-1",
      model: "claude-opus-5-5", effort: "medium", tokens_in: 26350955, tokens_out: 183986, cost_usd: 13.9103, outcome: "done", buffered: false, posted: true,
    });
    expect(s.stage_log.rows[3]).toMatchObject({ ended: null, model: null, tokens_in: null, cost_usd: null, outcome: null });
    expect(s.stage_log.total).toEqual({
      rows: 5, priced: 2, tokens_in: 26351055, tokens_out: 184036, cost_usd: 15.4103,
      seconds: (24 * 60 + 5) + 600 + (41 * 60 + 39) + 30,
    });
    // The runs naming it, in creation order, costed by the ledger; the PR the latest's.
    expect(s.runs.map((r) => [r.run_id, r.state, r.pr, r.cost_usd])).toEqual([[older.run_id, "complete", PR(4), 4.25], [paused.run_id, "paused", PR(5), null]]);
    expect(s.runs[0]).toMatchObject({ studio_run_id: "studio-a", job_id: "run-epic-30", host_verify: null });
    expect(typeof s.runs[0]!.created).toBe("string");
    expect(s.pr).toBe(PR(5));
    expect(s.findings).toEqual([]);
    // Needs you: the paused run, and the open inbox item naming the Jira key (the resolved one naming the id is not).
    expect(s.needs_you).toEqual({ run_ids: [paused.run_id], inbox: { issue: "TKS-12", title: "Pick a layout", priority: "High", blocked_since: "x", reason_comment: null, state: "open" } });
    const json = JSON.stringify(s);
    expect(json).not.toContain(w.root);
    // and its JSON-escaped form: on Windows the root's backslashes are doubled in the JSON, so the raw check alone passes trivially
    expect(json).not.toContain(JSON.stringify(w.root).slice(1, -1));
  });

  test("a story with no spec, no run and no inbox item: an empty Stage Log, no band, needs_you null; its findings", async () => {
    const w = world();
    const s = (await w.read("ST-111")).body as unknown as StoryAnswer;
    expect(s.story).toMatchObject({ id: "ST-111", key: "30.4", band: null, jira_key: null, jira_url: null });
    expect(s.stage_log).toEqual({ specs: [], rows: [], total: { rows: 0, priced: 0, tokens_in: null, tokens_out: null, cost_usd: null, seconds: 0 } });
    expect(s.runs).toEqual([]);
    expect(s.pr).toBeNull();
    expect(s.findings.map((f) => f.id)).toEqual(["DW-4"]);
    expect(s.needs_you).toBeNull();
  });

  test("no stage-posts.json: every row's posted is null", async () => {
    const w = world();
    writeFileSync(join(w.root, "_bmad-output", "tracking", "stage-posts.json"), "{}");
    expect(((await w.read()).body as unknown as StoryAnswer).stage_log.rows.every((r) => r.posted === false)).toBe(true);
    const { rmSync } = await import("node:fs");
    rmSync(join(w.root, "_bmad-output", "tracking", "stage-posts.json"));
    expect(((await w.read()).body as unknown as StoryAnswer).stage_log.rows.every((r) => r.posted === null)).toBe(true);
  });

  test("cached on file stamps: an edited spec, plan entity and band are seen", async () => {
    const w = world();
    const first = (await w.read()).body as unknown as StoryAnswer;
    expect(first.stage_log.total.rows).toBe(5);
    writeFileSync(join(w.stories, `${KEY}-r1-spec.md`), `## Stage Log\n${HEADER}`);
    writeFileSync(join(w.root, FOLDER, "plans", "30-5.md"), "---\nband: L\n---\n");
    const entity = join(w.root, PLAN, "ST-112.md");
    writeFileSync(entity, readFileSync(entity, "utf-8").replace("<b>never HTML</b>", "edited"));
    const second = (await w.read()).body as unknown as StoryAnswer;
    expect(second.stage_log.total.rows).toBe(4);
    expect(second.story.band).toBe("L");
    expect(second.plan_text).toContain("edited");
  });

  test("cached on file stamps: an edited, removed or unparseable .tk-studio/config.yaml is seen in jira_url", async () => {
    const w = world();
    const config = join(w.root, ".tk-studio", "config.yaml");
    const url = async () => ((await w.read()).body as unknown as StoryAnswer).story.jira_url;
    expect(await url()).toBe("https://example.atlassian.net/browse/TKS-12");
    expect(await url()).toBe("https://example.atlassian.net/browse/TKS-12"); // the stamp unchanged: the cached parse
    writeFileSync(config, "planning:\n  jira:\n    site: https://other.example.org\n    project: TKS\n");
    expect(await url()).toBe("https://other.example.org/browse/TKS-12");
    writeFileSync(config, "planning: [unclosed\n");
    expect(await url()).toBeNull();
    const { rmSync } = await import("node:fs");
    rmSync(config);
    expect(await url()).toBeNull();
  });

  test("the Stage Log parser mirrors stagelog.py: fences, the next ## heading, 11 cells only", () => {
    const text = "```\n## Stage Log\n```\n## Stage Log\n" + HEADER + row(DEV_ROW) + "| x |\n## Next\n" + row(DEV_ROW);
    expect(parseStageLog(text).map((r) => r.stage)).toEqual(["dev"]);
    expect(parseStageLog("no table")).toEqual([]);
    // the row key: sha1 over UTF-8 bytes of `<sid>|<stage>|<pass>|<started>`, the `-spec` suffix dropped
    expect(stageRowKey("39-4-x-spec", { stage: "plan", pass: "—", started: "2026-11-09T17:24:14Z" })).toBe(stageRowKey("39-4-x", { stage: "plan", pass: "—", started: "2026-11-09T17:24:14Z" }));
    expect(stageRowKey("39-4-x", { stage: "plan", pass: "—", started: "2026-11-09T17:24:14Z" })).toMatch(/^[0-9a-f]{12}$/);
  });

  test("refusals: 404 UnknownStory (no entity, or no plan directory), 400 BadStory, 404 UnknownProject", async () => {
    const w = world();
    expect(await w.read("ST-999")).toMatchObject({ status: 404, body: { ok: false, error: "UnknownStory", project: "p", story: "ST-999" } });
    expect(await w.read("ST-112", "n")).toMatchObject({ status: 404, body: { error: "UnknownStory", project: "n", story: "ST-112" } });
    expect(await w.read("st-112")).toMatchObject({ status: 400, body: { error: "BadStory", story: "st-112" } });
    expect(await w.read("ST-112", "nope")).toMatchObject({ status: 404, body: { error: "UnknownProject", project: "nope" } });
  });

  test("the route: bearer and cookie read it; no project 400; bad id 400; 405 Allow GET; no auth 401", async () => {
    const w = world();
    const ok = await w.call("GET", "/stories/ST-112?project=p");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as StoryAnswer).story.id).toBe("ST-112");
    const cookie = `${SESSION_COOKIE}=${signSession(SECRET, "token", Date.now())}`;
    const viaCookie = await w.call("GET", "/stories/ST-112?project=p", { cookie });
    expect(viaCookie.status).toBe(200);
    expect(await (await w.call("GET", "/stories/ST-112")).json()).toMatchObject({ ok: false, error: "ProjectRequired" });
    const bad = await w.call("GET", "/stories/nope?project=p");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "BadStory", story: "nope" });
    const missing = await w.call("GET", "/stories/ST-999?project=p");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "UnknownStory", project: "p", story: "ST-999" });
    const unknown = await w.call("GET", "/stories/ST-112?project=nope");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "UnknownProject" });
    const post = await w.call("POST", "/stories/ST-112?project=p");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    expect((await w.call("GET", "/stories/ST-112?project=p", {})).status).toBe(401);
  });
});

describe("Story 39.4: ownerTransition (shape 4)", () => {
  test("draft → ready is null; a drop on ready names `from` as the column, the draft owner for a non-canonical status", () => {
    expect(ownerTransition("draft", "ready")).toBeNull();
    expect(ownerTransition("review", "ready")).toEqual({ column: "review", owner: COLUMN_OWNERS.review! });
    // contract 0.1.35: `column` is `from` when `to` is `ready` (the raw status); a non-canonical one reads the draft writer's text
    expect(ownerTransition("approved", "ready")).toEqual({ column: "approved", owner: COLUMN_OWNERS.draft! });
    expect(ownerTransition("approved", "done")).toEqual({ column: "done", owner: COLUMN_OWNERS.done! });
  });
});

describe("Story 39.4: the board's story fields (shape 8)", () => {
  test("band, jira_key, cost_usd (the Stage Log total) and needs_you; run and findings unchanged", async () => {
    const w = world();
    const b = (await boardFor("p", w.deps())) as BoardAnswer;
    const story = (id: string) => b.epics.flatMap((e) => e.stories).find((s) => s.id === id)!;
    expect(story("ST-112")).toMatchObject({ band: "M", jira_key: "TKS-12", cost_usd: 15.4103, needs_you: true, run: null, findings: [] });
    expect(story("ST-111")).toMatchObject({ band: null, jira_key: null, cost_usd: null, needs_you: false });
    // needs_you through a paused run naming the story
    const paused = await w.claim(w.enqueue());
    w.queue.markPaused(paused.run_id, { engine: { paused_story_key: "30-4-the-office-screen", paused_reason: "x" } });
    const c = (await boardFor("p", w.deps())) as BoardAnswer;
    expect(c.epics.flatMap((e) => e.stories).find((s) => s.id === "ST-111")!.needs_you).toBe(true);
  });
});

describe("Story 39.4: storyLeaseHolder (shape 6)", () => {
  test("a per-story lease, a run-wide lease on a naming run, released, a dead owner", async () => {
    const w = world();
    const run = await w.claim(w.enqueue());
    const facts = () => runFacts(w.deps(), "p");
    expect(storyLeaseHolder(w.queue, facts(), "30.5", ME)).toBeNull();
    // per-story: draft:<key> names 30.5 by its number
    expect(w.queue.claimPlanPhase(run.run_id, `draft:${KEY}`, ME)).toBe(true);
    const held = storyLeaseHolder(w.queue, facts(), "30.5", ME)!;
    expect(held).toMatchObject({ run_id: run.run_id, phase: `draft:${KEY}`, holder: { pid: ME.pid, host: ME.host } });
    expect(JSON.stringify(held)).not.toContain(ME.nonce);
    expect(typeof held.since).toBe("string");
    expect(storyLeaseHolder(w.queue, facts(), "30.4", ME)).toBeNull();
    w.queue.releasePlanPhase(run.run_id, `draft:${KEY}`, ME);
    expect(storyLeaseHolder(w.queue, facts(), "30.5", ME)).toBeNull();
    // run-wide: `review` held on a run that does not name 30.5 is not its lease; once the run names it, it is
    expect(w.queue.claimPlanPhase(run.run_id, "review", ME)).toBe(true);
    expect(storyLeaseHolder(w.queue, facts(), "30.5", ME)).toBeNull();
    w.queue.markPaused(run.run_id, { engine: { paused_story_key: KEY, paused_reason: "x" } });
    expect(storyLeaseHolder(w.queue, facts(), "30.5", ME)).toMatchObject({ run_id: run.run_id, phase: "review" });
    // a dead owner's lease holds nothing
    const other = await w.claim(w.enqueue());
    expect(w.queue.claimPlanPhase(other.run_id, "in-progress:30-4-the-office-screen", DEAD)).toBe(true);
    expect(storyLeaseHolder(w.queue, facts(), "30.4", ME)).toBeNull();
  });
});
