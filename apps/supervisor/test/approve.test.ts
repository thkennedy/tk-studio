// Story 32.6: approval, autonomy and the first run — the approve pass (what is written, the commit, the PR, the job,
// the band re-key and the queued run), the engagement-run pass (launched, the three autonomy levels, the cap, go and
// cancel), the run spend, and every refusal. The "fake adapter" is the injected `uv` (the fake plansync through real
// `uv`, a fake track.py answer), real git against a throwaway origin, `fakeGh`, a fake submitter and a fake graceful
// stop: no live Atlassian, no live `gh`, no push beyond the throwaway origin.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname as dirnameOf, join } from "node:path";
import {
  addJobId, appendEpics, approvePass, engagementRunPass, engagementRunSpendPass, proposedEpics, rekeyBands,
  APPROVE_EVENT, CAP_EVENT, RUN_QUEUED_EVENT, RUN_STOP_EVENT, type ApproveDeps, type Submitter,
} from "../src/approve";
import { applyInput, newEngagement, readEngagement, writeEngagement, type Autonomy, type Engagement } from "../src/engagement";
import type { EndNotice } from "../src/hygiene";
import { Queue, type Owner } from "../src/queue";
import { runProcess, type RunResult } from "../src/server";
import { spawnSync } from "node:child_process";
import { engagementPlacement, engagementSubmitter, StartError } from "../src/cli";
import { fakeGh, fakePlansync, gitRepo, testGit } from "./fakes";
import { tempDir, track } from "./tmp";

const temp = tempDir; // test/tmp.ts closes the tracked queues and removes the folders

const ENG = "ENG-001";
const ISSUE = "TKS-40";
const me: Owner = { pid: process.pid, host: hostname(), nonce: "approve-test" };
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };

const BANDS_HEAD = "# Studio pipeline budget bands (fixture).\nbands_version: 1\ncurrency: usd\nepics:\n  EP-030:\n    usd_estimate: 12.0\n";
const CONFIG = "project_id: p\nvcs: git\n\n# the jobs\njobs:\n  - run-epic-40\n\nworking_set:\n  developer:\n    - bmm\n";
const BOUND = "planning:\n  backend: jira\n  jira:\n    project_key: TKS\n";
const EPICS = "---\nstatus: planned\n---\n# Epics\n\n## Epic 40: Old work\n\nThe old epic.\n\n### Story 40.1: Old story\n\nAs a user,\nI want x,\nSo that y.\n\n**Acceptance Criteria:**\n\nGiven.\n";
const STORY_1 = "As a report reader,\nI want a CSV button,\nSo that I can share the rows.\n\n**Acceptance Criteria:**\n\n**Given** the reports page **When** I press CSV **Then** a file downloads.";
const STORY_2 = "As a report reader,\nI want the export to follow the date range,\nSo that I export only what I see.\n\n**Acceptance Criteria:**\n\n**Given** a range **When** I export **Then** only that range is in the file.";
const PROPOSED = `## Proposed epics and stories\n\n### Epic 1: Report exports\n\nThe export epic.\n\n#### Story 1.1: CSV button\n\n${STORY_1}\n\n#### Story 1.2: Filtered export\n\n${STORY_2}\n`;
const scopeWith = (proposed: string) => `# ${ENG}: Scope of Work\n\n## Goal\n\nExports.\n\n## Deliverables\n\n### CSV\n\nAcceptance signal: a file.\n\n## Exclusions\n\nNone.\n\n## What the studio needs from you\n\n- data by 2026-11-01\n\n## Milestones\n\n- M1\n\n${proposed}`;
const SCOPE = scopeWith(PROPOSED);
const QUOTE = {
  band50: { tokens: 1, usd: 20, share: "share unknown" }, band85: { tokens: 2, usd: 30, share: "share unknown" },
  band95: { tokens: 3, usd: 38, share: "share unknown" }, cap: 40,
  basis: { epics: [{ k: 1, title: "Report exports", stories: 2, ep_id: "EP-033" }] }, computed_at: "2026-10-25T05:00:00.000Z",
};
const PLAN_40 = "---\nshape_version: 1\nid: EP-030\ntype: epic\ntitle: Old work\nstatus: done\nsource: epics.md#epic-40\n---\n";

/** A clock that moves 1 s per call. */
function clock(start = "2026-10-25T06:00:00.000Z") {
  let t = Date.parse(start);
  return () => new Date((t += 1000)).toISOString();
}

const newQueue = () => {
  const q = track(new Queue(join(temp("tk-sup-ap-q-"), "q.db"), { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) }));
  return q;
};

/** A record in `quoted` with the quote, approved by the owner (`approve {autonomy, base_ref?}`) unless `approve: false`. */
function approvedRecord(o: { autonomy?: Autonomy; baseRef?: string; approve?: boolean; quote?: Record<string, unknown> } = {}): Engagement {
  const r: Engagement = { ...newEngagement(ENG, "p", "Build the export", "2026-10-25T05:00:00.000Z"), state: "quoted", quote: o.quote ?? structuredClone(QUOTE) };
  if (o.approve === false) return r;
  const applied = applyInput(r, { verb: "approve", payload: { autonomy: o.autonomy ?? "full", ...(o.baseRef ? { base_ref: o.baseRef } : {}) }, source: "bearer", at: "2026-10-25T05:30:00.000Z" });
  if (!applied.ok) throw new Error("approve refused");
  return applied.record;
}

/** The served root: a git checkout of a project (its origin pushed), the quote's uncommitted band for the predicted
 * EP-033, the scope, and the approved record. */
function servedRepo(o: { scope?: string | null; record?: Engagement; bound?: boolean } = {}) {
  const repo = gitRepo({
    ".tk-studio/config.yaml": CONFIG + (o.bound ? BOUND : ""),
    ".tk-studio/plan-counter.yaml": "counter_version: 1\nnext:\n  epic: 34\n  story: 300\n  task: 1\n",
    ".tk-studio/budget-bands.yaml": BANDS_HEAD,
    "_bmad-output/planning-artifacts/epics.md": EPICS,
    "_bmad-output/planning-artifacts/plan/EP-030.md": PLAN_40,
  });
  const root = repo.checkout;
  writeFileSync(join(root, ".tk-studio", "budget-bands.yaml"), BANDS_HEAD + "  EP-033:\n    usd_estimate: 40.0\n");
  if (o.scope !== null) {
    mkdirSync(join(root, "_bmad-output", "engagements", ENG), { recursive: true });
    writeFileSync(join(root, "_bmad-output", "engagements", ENG, "scope.md"), o.scope ?? SCOPE);
  }
  writeEngagement(root, o.record ?? approvedRecord());
  return { root, origin: repo.origin };
}

/** A fake submitter: each call recorded and minted as a queue run carrying the payload. */
function fakeSubmit(queue: Queue, o: { fail?: string } = {}) {
  const calls: { jobId: string; root: string; baseRef?: string; payload: Record<string, unknown> }[] = [];
  const submit: Submitter = async (jobId, root, opts) => {
    calls.push({ jobId, root, ...opts });
    if (o.fail) throw new Error(o.fail);
    const { run } = queue.enqueue({ jobId, root, projectId: "p", definition: { id: jobId }, payload: opts.payload, ...(opts.baseRef ? { base_ref: opts.baseRef } : {}) });
    return { run_id: run.run_id, placement: { tier: "host", source: "host" } };
  };
  return { submit, calls };
}

/** The deps: real git (the test identity), the fake gh, the fake plansync through `uv`, a fake `track.py`. */
function approveDeps(queue: Queue, extra: Partial<ApproveDeps> & { track?: () => Record<string, unknown> } = {}) {
  const plansync = fakePlansync();
  const gh = fakeGh(temp("tk-sup-ap-gh-"));
  const work = temp("tk-sup-ap-work-");
  const env: Record<string, string | undefined> = { ...process.env, ...IDENTITY, TK_STUDIO_ROOT: plansync.root, GH_BIN: gh.bin, TK_SUPERVISOR_WORK: work, TK_SUPERVISOR_NOTIFY: "" };
  const uvCalls: { script: string; args: string[] }[] = [];
  const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> => {
    uvCalls.push({ script: basename(script), args });
    if (script.endsWith("track.py")) {
      const answer = (extra.track ?? (() => ({ ok: true, status: "complete", engagement: ENG, issues: [{ issue: ISSUE, created: false, transitioned: true, commented: true }] })))();
      return { exit: answer.status === "blocked" ? 2 : 0, stdout: JSON.stringify(answer), stderr: "" };
    }
    return runProcess("uv", ["run", script, ...args], { cwd: root, timeoutS: timeoutS ?? 120, env: { ...env, PYTHONIOENCODING: "utf-8" } });
  };
  const sub = fakeSubmit(queue);
  const stopped: { root: string; engine: string }[] = [];
  const notices: EndNotice[] = [];
  const deps: ApproveDeps = {
    env, uv, now: clock(), submit: sub.submit,
    launchStop: async (root, engine) => { stopped.push({ root, engine }); return { ok: true, detail: `engine ${engine} stopping gracefully` }; },
    notify: async (n) => { notices.push(n); return { ok: true, via: "fake" }; },
    ...extra,
  };
  return { deps, plansync, gh, work, uvCalls, submitted: sub.calls, stopped, notices };
}

const approveEvents = (q: Queue) => q.serviceEvents(APPROVE_EVENT).map((e) => e.detail as Record<string, any>);
const steps = (q: Queue) => approveEvents(q).map((d) => [d.step, d.ok]);
const git = (cwd: string, ...args: string[]) => testGit(cwd, ...args);

describe("Story 32.6: the approve pass (AC1)", () => {
  test("approve with base_ref: epics appended, sync ran, the job and its config id, one commit on engagement/ENG-001, the PR; an OPEN PR queues nothing; on MERGED the run is queued from base_ref with the payload; the served root untouched", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo({ record: approvedRecord({ baseRef: "release" }) });
    const statusBefore = git(root, "status", "--porcelain");
    const fx = approveDeps(queue);
    const out = await approvePass(queue, fx.deps, { root, engagement: ENG });
    expect(out).toEqual({ done: [], refused: [], failed: [] });
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", true], ["pr", true]]);
    // operator ruling (c): a base_ref approval never drives before the PR merges
    expect(fx.submitted).toEqual([]);
    expect(queue.runs()).toEqual([]);
    // the served root's checkout: never switched, never dirtied, the record untouched by the pass
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(root, "status", "--porcelain")).toBe(statusBefore);
    expect(existsSync(join(root, ".tk-studio", "jobs", "run-epic-41.json"))).toBe(false);
    expect(readEngagement(root, ENG)).toEqual(approvedRecord({ baseRef: "release" }));
    // exactly one commit on the branch, the union of written[] and the pass's files
    const branch = "engagement/ENG-001";
    expect(git(origin, "rev-list", "--count", `main..${branch}`)).toBe("1");
    expect(git(origin, "diff", "--name-only", "main", branch).split("\n").sort()).toEqual([
      ".tk-studio/budget-bands.yaml", ".tk-studio/config.yaml", ".tk-studio/jobs/run-epic-41.json", ".tk-studio/plan-counter.yaml",
      "_bmad-output/planning-artifacts/epics.md", "_bmad-output/planning-artifacts/plan/EP-034.md",
    ]);
    const show = (path: string) => git(origin, "show", `${branch}:${path}`) + "\n";
    expect(show("_bmad-output/planning-artifacts/epics.md")).toBe(EPICS
      + `\n## Epic 41: Report exports\n\nengagement: ${ENG}\n\nThe export epic.\n\n### Story 41.1: CSV button\n\n${STORY_1}\n\n### Story 41.2: Filtered export\n\n${STORY_2}\n`);
    expect(show(".tk-studio/config.yaml")).toBe(CONFIG.replace("  - run-epic-40\n", "  - run-epic-40\n  - run-epic-41\n"));
    const minted = JSON.parse(show(".tk-studio/jobs/run-epic-41.json"));
    expect(minted).toMatchObject({ job_schema_version: 1, id: "run-epic-41", type: "run-epic", target: { payload: { epic: 41 } } });
    expect(minted.stop).toEqual({ on_status: ["blocked"] }); // Story 36.6: no rhythm: the engagement's autonomy sets it
    // the band re-keyed from the predicted EP-033 to the minted EP-034 (test_quote.py pins this literal)
    expect(show(".tk-studio/budget-bands.yaml")).toBe(BANDS_HEAD + "  EP-034:\n    usd_estimate: 40.0\n");
    // the worktree is gone; plansync ran sync in it
    expect(existsSync(join(fx.work, "worktrees", "p", `engagement-${ENG}`))).toBe(false);
    expect(git(root, "worktree", "list").split("\n")).toHaveLength(1);
    const sync = fx.plansync.calls().find((a) => a[0] === "sync")!;
    expect(sync[1]).toBe("--directory");
    expect(sync[2]).toContain(`engagement-${ENG}`);
    // the PR: base the default branch, head the engagement branch
    const create = fx.gh.calls().find((c) => c.argv[0] === "pr" && c.argv[1] === "create")!;
    expect(create.argv).toEqual(expect.arrayContaining(["--base", "main", "--head", branch]));
    const pr = approveEvents(queue).find((d) => d.step === "pr")!;
    expect(pr.detail.pr).toEqual({ number: 42, url: "https://github.com/acme/widget/pull/42" });
    const job = approveEvents(queue).find((d) => d.step === "job")!;
    expect(job.detail).toMatchObject({ jobs: ["run-epic-41"], epics: [{ n: 41, ep_id: "EP-034" }], bands: { "EP-034": 40 }, no_band: [] });
    // the merge: queued from base_ref, with the payload; the link event
    fx.gh.answer({ view: "MERGED" });
    expect((await approvePass(queue, fx.deps)).done).toEqual([ENG]);
    expect(steps(queue).slice(5)).toEqual([["queued", true], ["done", true]]);
    expect(fx.submitted).toEqual([{ jobId: "run-epic-41", root, baseRef: "release", payload: { engagement: ENG, project: "p" } }]);
    const queued = approveEvents(queue).find((d) => d.step === "queued")!;
    const runId = queued.detail.run_id;
    expect(queued.detail).toMatchObject({ job: "run-epic-41", base_ref: "release", placement: { tier: "host", source: "host" } });
    expect(queue.get(runId)!.base_ref).toBe("release");
    expect(queue.runPayload(runId)).toEqual({ engagement: ENG, project: "p" });
    expect(queue.serviceEvents(RUN_QUEUED_EVENT).map((e) => e.detail)).toEqual([{ engagement: ENG, project: "p", run_id: runId, job: "run-epic-41" }]);
    expect(readEngagement(root, ENG)!.state).toBe("approved");
    // done: the next pass does nothing
    const n = queue.serviceEvents().length;
    expect(await approvePass(queue, fx.deps)).toEqual({ done: [], refused: [], failed: [] });
    expect(queue.serviceEvents().length).toBe(n);
  }, 60_000);

  test("the placement fallback: the job's own config entry, else the project's highest-numbered run-epic-* entry, else the host tier", () => {
    const dir = temp("tk-sup-ap-cfg-");
    const root = join(dir, "root");
    mkdirSync(join(root, ".tk-studio"), { recursive: true });
    writeFileSync(join(root, ".tk-studio", "config.yaml"), "project_id: p\n");
    const cfg = join(dir, "supervisor.yaml");
    const prev = process.env.TK_SUPERVISOR_CONFIG;
    process.env.TK_SUPERVISOR_CONFIG = cfg;
    try {
      writeFileSync(cfg, "jobs:\n  other/run-epic-50:\n    tier: sbx\n    sandbox: z\n");
      expect(engagementPlacement("run-epic-41", root)).toEqual({ tier: "host", source: "host" });
      writeFileSync(cfg, "jobs:\n  p/run-epic-9:\n    tier: host\n  p/run-epic-12:\n    tier: sbx\n    sandbox: box\n  p/run-epic-3:\n    tier: host\n");
      expect(engagementPlacement("run-epic-41", root)).toEqual({ tier: "sbx", sandbox: "box", source: "run-epic-12" });
      writeFileSync(cfg, "jobs:\n  p/run-epic-41:\n    tier: host\n  p/run-epic-12:\n    tier: sbx\n    sandbox: box\n");
      expect(engagementPlacement("run-epic-41", root)).toEqual({ source: "config" });
    } finally {
      if (prev === undefined) delete process.env.TK_SUPERVISOR_CONFIG; else process.env.TK_SUPERVISOR_CONFIG = prev;
    }
  });

  test("approve without base_ref: an OPEN PR queues nothing (retried); on MERGED the run is queued from main (no base_ref)", async () => {
    const queue = newQueue();
    const { root } = servedRepo();
    const fx = approveDeps(queue);
    expect(await approvePass(queue, fx.deps, { root, engagement: ENG })).toEqual({ done: [], refused: [], failed: [] });
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", true], ["pr", true]]);
    expect(fx.submitted).toEqual([]);
    // the next pass (a finally site, no target given): still OPEN, nothing new, no second commit or PR
    await approvePass(queue, fx.deps);
    expect(steps(queue)).toHaveLength(5);
    expect(fx.gh.calls().filter((c) => c.argv[1] === "create")).toHaveLength(1);
    fx.gh.answer({ view: "MERGED" });
    expect((await approvePass(queue, fx.deps)).done).toEqual([ENG]);
    expect(fx.submitted).toEqual([{ jobId: "run-epic-41", root, payload: { engagement: ENG, project: "p" } }]);
    expect(approveEvents(queue).find((d) => d.step === "queued")!.detail.base_ref).toBeNull();
    expect(readEngagement(root, ENG)!.state).toBe("approved");
  }, 60_000);

  test("a null ep_id writes no band and is named in the job step's detail", async () => {
    const queue = newQueue();
    const quote = { ...structuredClone(QUOTE), basis: { epics: [{ k: 1, title: "Report exports", stories: 2, ep_id: null }] } };
    const { root, origin } = servedRepo({ record: approvedRecord({ quote }) });
    const fx = approveDeps(queue);
    await approvePass(queue, fx.deps, { root, engagement: ENG });
    const job = approveEvents(queue).find((d) => d.step === "job")!;
    expect(job.detail.bands).toEqual({});
    expect(job.detail.no_band).toEqual([{ k: 1, n: 41, reason: "ep_id null" }]);
    expect(git(origin, "diff", "--name-only", "main", "engagement/ENG-001")).not.toContain("budget-bands.yaml");
  }, 60_000);

  test("a failed sync is retried at the next pass and never moves the state; the refusal told once", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const fx = approveDeps(queue);
    fx.plansync.sync("blocked");
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([ENG]);
    expect(steps(queue)).toEqual([["append", true], ["sync", false]]);
    expect(approveEvents(queue)[1]!.detail.reason).toContain("fake sync blocked");
    await approvePass(queue, fx.deps);
    expect(steps(queue)).toHaveLength(2); // the same append and the same refusal: not repeated
    expect(readEngagement(root, ENG)!.state).toBe("approved");
    expect(git(origin, "branch", "--list", "engagement/*")).toBe("");
    fx.plansync.sync("ok");
    await approvePass(queue, fx.deps);
    expect(steps(queue).slice(2)).toEqual([["sync", true], ["job", true], ["commit", true], ["pr", true]]);
  }, 60_000);

  test("the refusals by name on the append step, the state unchanged: NoScope (no scope, no story), StoryShape: k.m, NotApproved", async () => {
    const cases: { name: string; served: Parameters<typeof servedRepo>[0]; reason: string }[] = [
      { name: "no scope.md", served: { scope: null }, reason: "NoScope: no _bmad-output/engagements/ENG-001/scope.md" },
      { name: "no story", served: { scope: scopeWith("## Proposed epics and stories\n\n### Epic 1: Empty\n\nNothing yet.\n") }, reason: "NoScope: _bmad-output/engagements/ENG-001/scope.md proposes no story" },
      { name: "a story missing a part", served: { scope: scopeWith(PROPOSED.replace("So that I export only what I see.\n", "")) }, reason: 'StoryShape: 1.2 (missing "So that")' },
      { name: "not approved", served: { record: { ...approvedRecord(), state: "scoping" } }, reason: "NotApproved: ENG-001 is scoping, not approved" },
    ];
    for (const c of cases) {
      const queue = newQueue();
      const { root } = servedRepo(c.served);
      const before = readEngagement(root, ENG);
      const fx = approveDeps(queue);
      await approvePass(queue, fx.deps, { root, engagement: ENG });
      await approvePass(queue, fx.deps, { root, engagement: ENG });
      const evs = approveEvents(queue);
      expect(evs.map((d) => [d.step, d.ok])).toEqual([["append", false]]); // told once, refused by name
      expect(evs[0]!.detail.reason).toStartWith(c.reason);
      expect(readEngagement(root, ENG)).toEqual(before);
      expect(fx.plansync.calls()).toEqual([]);
      expect(fx.submitted).toEqual([]);
    }
  }, 60_000);

  test("a record never approved (no approve line) is not the pass's: nothing runs, nothing is told", async () => {
    const queue = newQueue();
    const { root } = servedRepo({ record: approvedRecord({ approve: false }) });
    const fx = approveDeps(queue);
    expect(await approvePass(queue, fx.deps, { root, engagement: ENG })).toEqual({ done: [], refused: [], failed: [] });
    expect(approveEvents(queue)).toEqual([]);
  });
});

describe("Story 32.6: the pure parts", () => {
  test("proposedEpics: the epics and stories split on the #### headings; a fenced heading is no story", () => {
    const fenced = PROPOSED + "\n```\n#### Story 1.3: not a story\n```\n";
    const out = proposedEpics(scopeWith(fenced), ENG);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.epics.map((e) => [e.k, e.title, e.intro, e.stories.map((s) => [s.m, s.title])])).toEqual([
      [1, "Report exports", "The export epic.", [[1, "CSV button"], [2, "Filtered export"]]],
    ]);
    expect(proposedEpics(scopeWith(PROPOSED + "\n### Epic 1: Again\n\n#### Story 1.9: x\n\n" + STORY_1 + "\n"), ENG)).toMatchObject({ ok: false, reason: expect.stringContaining("repeats ### Epic 1") });
  });

  test("appendEpics numbers from the highest ## Epic; addJobId keeps every other byte; rekeyBands writes epic_bands_text's shape", () => {
    const out = appendEpics("# Epics\n\n## Epic 7: A\n\n## Epic 12: B\n", [{ k: 1, title: "X", intro: "", stories: [{ m: 1, title: "S", body: "body" }] }, { k: 2, title: "Y", intro: "", stories: [{ m: 1, title: "T", body: "b2" }] }], ENG);
    expect(out.epics.map((e) => e.n)).toEqual([13, 14]);
    expect(out.text).toBe("# Epics\n\n## Epic 7: A\n\n## Epic 12: B\n\n## Epic 13: X\n\nengagement: ENG-001\n\n### Story 13.1: S\n\nbody\n\n## Epic 14: Y\n\nengagement: ENG-001\n\n### Story 14.1: T\n\nb2\n");
    expect(addJobId(CONFIG, "run-epic-41")).toBe(CONFIG.replace("  - run-epic-40\n", "  - run-epic-40\n  - run-epic-41\n"));
    expect(addJobId(CONFIG, "run-epic-40")).toBe(CONFIG);
    expect(addJobId("vcs: git\n", "run-epic-1")).toBe("vcs: git\njobs:\n  - run-epic-1\n");
    expect(addJobId("jobs: []\nvcs: git\n", "run-epic-1")).toBe("jobs:\n  - run-epic-1\nvcs: git\n");
    expect(() => addJobId("jobs: run-epic-1\n", "run-epic-2")).toThrow("JobsUnwritable");
    // the literals test_quote.py pins against quote.epic_bands_text
    expect(rekeyBands(BANDS_HEAD, { "EP-034": 40.0 })).toBe(BANDS_HEAD + "  EP-034:\n    usd_estimate: 40.0\n");
    expect(rekeyBands("bands_version: 1\ncurrency: usd\n", { "EP-034": 40.0 })).toBe("bands_version: 1\ncurrency: usd\nepics:\n  EP-034:\n    usd_estimate: 40.0\n");
    expect(rekeyBands(BANDS_HEAD + "other: 1\n", { "EP-030": 61.27 })).toBe(BANDS_HEAD.replace("12.0", "61.27") + "other: 1\n");
    expect(rekeyBands(null, { "EP-001": 1 })).toBe("epics:\n  EP-001:\n    usd_estimate: 1.0\n");
    expect(rekeyBands("epics: {}\nx: 1\n", { "EP-001": 2.5 })).toBe("epics:\n  EP-001:\n    usd_estimate: 2.5\nx: 1\n");
    expect(() => rekeyBands("epics: 3\n", { "EP-001": 1 })).toThrow("not a mapping");
  });
});

// ------------------------------------------------------------ the engagement-run pass

/** A served (non-git) root with the record in `state`, Jira-bound; the engagement's first run linked and queued. */
function linkedRoot(queue: Queue, o: { autonomy?: Autonomy; state?: Engagement["state"]; runsUsd?: number } = {}) {
  const root = temp("tk-sup-ap-root-");
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), "project_id: p\n" + BOUND);
  const r = approvedRecord({ autonomy: o.autonomy ?? "full" });
  writeEngagement(root, { ...r, state: o.state ?? r.state, spend: { planning_usd: 0.5, runs_usd: o.runsUsd ?? 0 } });
  const run = link(queue, root);
  return { root, run };
}

function link(queue: Queue, root: string, after?: string): string {
  const { run } = queue.enqueue({ jobId: "run-epic-41", root, projectId: "p", definition: { id: "run-epic-41" }, payload: { engagement: ENG, project: "p" } });
  queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job: "run-epic-41", ...(after ? { after_run: after } : {}) });
  return run.run_id;
}

/** Claim the run and launch its engine (the `launched` queue event). */
async function launch(queue: Queue, runId: string, engine = "E1") {
  expect((await queue.claim(runId, me)).claimed).toBe(true);
  queue.markLaunched(runId, engine, { end: {} });
}

const PR = "https://github.com/acme/widget/pull/7";

describe("Story 32.6: launched and the three autonomy levels (AC1)", () => {
  test("the first run's launched moves approved → in-progress once (source supervisor); a second launched is a no-op", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue);
    const fx = approveDeps(queue);
    expect((await engagementRunPass(queue, fx.deps)).launched).toEqual([]); // queued, not launched yet
    await launch(queue, run);
    expect((await engagementRunPass(queue, fx.deps)).launched).toEqual([ENG]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("in-progress");
    expect(record.inputs.at(-1)).toMatchObject({ verb: "launched", source: "supervisor", from: "approved", to: "in-progress", run_id: run });
    expect(queue.serviceEvents("engagement").map((e) => e.detail)).toEqual([{ id: ENG, project: "p", state: "in-progress", from: "approved", verb: "launched", source: "supervisor" }]);
    // a second linked run's launched: nothing more
    queue.end(run, "complete");
    const second = link(queue, root, run);
    await launch(queue, second, "E2");
    expect((await engagementRunPass(queue, fx.deps)).launched).toEqual([]);
    expect(readEngagement(root, ENG)!.inputs.filter((l) => l.verb === "launched")).toHaveLength(1);
  });

  test("full: a landed story stops nothing — the epic end to end", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { autonomy: "full" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    await engagementRunPass(queue, fx.deps);
    expect(fx.stopped).toEqual([]);
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
  });

  test("steady: a landed story stops the live run gracefully once; its PR's merge resubmits the same payload, the state staying in-progress", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { autonomy: "steady" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    expect((await engagementRunPass(queue, fx.deps)).stopped).toEqual([run]);
    await engagementRunPass(queue, fx.deps); // once per story
    expect(fx.stopped).toEqual([{ root, engine: "E1" }]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => e.detail)).toEqual([
      { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "steady", story_key: "41-1-csv-button", ok: true, detail: "engine E1 stopping gracefully" },
    ]);
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
    // the run ends with its story's PR: OPEN resubmits nothing
    queue.end(run, "complete", null, { detail: { pr: PR } });
    expect((await engagementRunPass(queue, fx.deps)).resubmitted).toEqual([]);
    fx.gh.answer({ view: "MERGED" });
    expect((await engagementRunPass(queue, fx.deps)).resubmitted).toEqual([ENG]);
    expect(fx.submitted).toEqual([{ jobId: "run-epic-41", root, payload: { engagement: ENG, project: "p" } }]);
    const links = queue.serviceEvents(RUN_QUEUED_EVENT).map((e) => e.detail as Record<string, any>);
    expect(links).toHaveLength(2);
    expect(links[1]).toMatchObject({ engagement: ENG, project: "p", job: "run-epic-41", after_run: run });
    expect(queue.runPayload(links[1]!.run_id)).toEqual({ engagement: ENG, project: "p" });
    await engagementRunPass(queue, fx.deps);
    expect(fx.submitted).toHaveLength(1); // once per stopped run
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
  });

  test("ask: the stop, paused, a kind ask block of the engagement's issue; no continue stays paused; the owner's continue → in-progress and resubmits", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { autonomy: "ask" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    const out = await engagementRunPass(queue, fx.deps);
    expect(out.stopped).toEqual([run]);
    expect(out.paused).toEqual([ENG]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("paused");
    expect(record.inputs.at(-1)).toMatchObject({ verb: "run-paused", source: "supervisor", from: "in-progress", to: "paused", detail: { run_id: run, story_key: "41-1-csv-button" } });
    const blocks = fx.uvCalls.filter((c) => c.script === "track.py");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.args.slice(0, 7)).toEqual(["block", "--directory", root, "--engagement", ENG, "--kind", "ask"]);
    expect(blocks[0]!.args[8]).toContain("landed story 41-1-csv-button");
    expect(queue.serviceEvents("engagement-issue").map((e) => e.detail)).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "ask" }]);
    // no continue: still paused, no second block
    queue.end(run, "complete", null, { detail: { pr: PR } });
    await engagementRunPass(queue, fx.deps);
    expect(readEngagement(root, ENG)!.state).toBe("paused");
    expect(fx.uvCalls.filter((c) => c.script === "track.py")).toHaveLength(1);
    expect(fx.submitted).toEqual([]);
    // the owner's comment after the agent's: continue
    mkdirSync(join(root, "_bmad-output", "tracking", ISSUE), { recursive: true });
    writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ inbox_version: 1, items: [{ issue: ISSUE, engagement: ENG, title: `${ENG}: questions`, state: "open" }] }));
    const comments = [
      { id: "c1", author: "agent", body: `[~accountid:o] Blocked: ${ENG} landed story 41-1-csv-button`, created: "2026-10-25T07:00:00.000+0000" },
      { id: "c2", author: "owner", body: "looks good\ncontinue", created: "2026-10-25T07:05:00.000+0000" },
    ];
    writeFileSync(join(root, "_bmad-output", "tracking", ISSUE, "comments.jsonl"), comments.map((c) => JSON.stringify({ issue: ISSUE, ...c })).join("\n") + "\n");
    const resumed = await engagementRunPass(queue, fx.deps);
    expect(resumed.resumed).toEqual([ENG]);
    expect(resumed.resubmitted).toEqual([ENG]);
    const after = readEngagement(root, ENG)!;
    expect(after.state).toBe("in-progress");
    expect(after.inputs.at(-1)).toMatchObject({ verb: "run-resumed", source: "supervisor", from: "paused", to: "in-progress", detail: { comment: "c2" } });
    expect(fx.submitted).toEqual([{ jobId: "run-epic-41", root, payload: { engagement: ENG, project: "p" } }]);
    // the comment is read once
    await engagementRunPass(queue, fx.deps);
    expect(readEngagement(root, ENG)!.inputs.filter((l) => l.verb === "run-resumed")).toHaveLength(1);
  });
});

describe("Story 32.6: the spend and the cap (AC2)", () => {
  const jobRun = (studio: string, usd: number) => JSON.stringify({ event: "job-run", project: "p", payload: { run_id: studio, job_id: "run-epic-41", total_cost_usd: usd } });

  test("engagementRunSpendPass: spend.runs_usd sums the linked runs' job-run costs, merged alone into a fresh read", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress" });
    queue.setStudioRun(run, "studio-a");
    const ledger = join(temp("tk-sup-ap-ledger-"), "me-host.jsonl");
    writeFileSync(ledger, [jobRun("studio-a", 10), "{torn", jobRun("studio-x", 99), ""].join("\n"));
    expect(engagementRunSpendPass(queue, { ledgerFile: ledger })).toEqual({ updated: [ENG] });
    expect(readEngagement(root, ENG)!.spend).toEqual({ planning_usd: 0.5, runs_usd: 10 });
    queue.end(run, "complete");
    const second = link(queue, root, run);
    expect((await queue.claim(second, me)).claimed).toBe(true);
    queue.setStudioRun(second, "studio-b");
    writeFileSync(ledger, readFileSync(ledger, "utf-8") + jobRun("studio-b", 2.5) + "\n");
    engagementRunSpendPass(queue, {
      ledgerFile: ledger,
      // a state change written between the first read and the write survives (only runs_usd merged)
      beforeWrite: (r, id) => { const cur = readEngagement(r, id)!; writeEngagement(r, { ...cur, state: "paused" }); },
    });
    expect(readEngagement(root, ENG)!.spend.runs_usd).toBe(12.5);
    expect(readEngagement(root, ENG)!.state).toBe("paused");
    expect(engagementRunSpendPass(queue, { ledgerFile: ledger })).toEqual({ updated: [] });
    expect(engagementRunSpendPass(queue, { ledgerFile: join(root, "missing-dir", "x.jsonl") }).updated).toEqual([ENG]); // no ledger yet: 0
  });

  test("the cap: runs_usd >= cap in-progress → partial, the live run stopped gracefully, a kind cap block with the figures, one notice; go {cap} → in-progress and resubmits", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", runsUsd: 41.5 });
    const fx = approveDeps(queue);
    await launch(queue, run);
    const out = await engagementRunPass(queue, fx.deps);
    expect(out.capped).toEqual([ENG]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("partial");
    expect(record.inputs.at(-1)).toMatchObject({ verb: "cap", source: "supervisor", from: "in-progress", to: "partial", detail: { runs_usd: 41.5, cap: 40, run_id: run } });
    expect(fx.stopped).toEqual([{ root, engine: "E1" }]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => e.detail?.reason)).toEqual(["cap"]);
    const block = fx.uvCalls.filter((c) => c.script === "track.py");
    expect(block).toHaveLength(1);
    expect(block[0]!.args.slice(0, 7)).toEqual(["block", "--directory", root, "--engagement", ENG, "--kind", "cap"]);
    const reason = block[0]!.args[8]!;
    for (const figure of ["runs_usd: 41.5", "cap: 40", "band85.usd: 30", "band95.usd: 38", "reached its cap"]) expect(reason).toContain(figure);
    expect(queue.serviceEvents("engagement-issue").map((e) => e.detail)).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "cap" }]);
    expect(fx.notices).toHaveLength(1);
    expect(fx.notices[0]).toMatchObject({ run_id: run, job_id: "run-epic-41", state: "partial" });
    expect(queue.serviceEvents(CAP_EVENT).map((e) => e.detail)).toEqual([{ engagement: ENG, project: "p", run_id: run, runs_usd: 41.5, cap: 40, notify: { ok: true, via: "fake" } }]);
    // waits: the next pass blocks, notifies and stops nothing more
    await engagementRunPass(queue, fx.deps);
    expect(fx.notices).toHaveLength(1);
    expect(fx.stopped).toHaveLength(1);
    expect(fx.uvCalls.filter((c) => c.script === "track.py")).toHaveLength(1);
    // the owner's go {cap}: raise-cap replaces the cap, back to in-progress; the stopped run ended → resubmitted
    queue.end(run, "partial", null, { detail: { pr: PR } });
    const go = applyInput(readEngagement(root, ENG)!, { verb: "go", payload: { cap: 80 }, source: "bearer", at: "2026-10-25T08:00:00.000Z" });
    expect(go.ok).toBe(true);
    if (go.ok) writeEngagement(root, go.record);
    const resumed = await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(resumed.resubmitted).toEqual([ENG]);
    expect(resumed.capped).toEqual([]);
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
    expect(readEngagement(root, ENG)!.quote!.cap).toBe(80);
    expect(fx.submitted).toEqual([{ jobId: "run-epic-41", root, payload: { engagement: ENG, project: "p" } }]);
  });

  test("cancel stops the live linked run gracefully, once", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    const cancelled = applyInput(readEngagement(root, ENG)!, { verb: "cancel", source: "bearer", at: "2026-10-25T08:00:00.000Z" });
    if (cancelled.ok) writeEngagement(root, cancelled.record);
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    await engagementRunPass(queue, fx.deps);
    expect(fx.stopped).toEqual([{ root, engine: "E1" }]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => e.detail?.reason)).toEqual(["cancel"]);
    expect(fx.submitted).toEqual([]);
  });

  test("a cap block refused by name is told once and not called again", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", runsUsd: 40 });
    const fx = approveDeps(queue, { track: () => ({ ok: false, status: "blocked", reason: "track refused: planning.jira.owner_account_id is not recorded" }) });
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    await engagementRunPass(queue, fx.deps);
    expect(readEngagement(root, ENG)!.state).toBe("partial"); // runs_usd == cap is the cap
    expect(queue.serviceEvents("engagement-issue").map((e) => e.detail)).toEqual([
      { engagement: ENG, project: "p", action: "refused", kind: "cap", step: "block", reason: "track refused: planning.jira.owner_account_id is not recorded" },
    ]);
    expect(fx.uvCalls.filter((c) => c.script === "track.py")).toHaveLength(1);
  });
});

// ------------------------------------------------------------ review patches (H1, H2, 3-7)

/** The owner's input applied on the record with the deps' clock (so it follows the pass's earlier events). */
function input(root: string, deps: ApproveDeps, verb: "revise" | "go" | "approve" | "cancel", payload?: Record<string, unknown>, patch: Partial<Engagement> = {}) {
  const applied = applyInput({ ...readEngagement(root, ENG)!, ...patch }, { verb, ...(payload ? { payload } : {}), source: "bearer", at: deps.now!() });
  if (!applied.ok) throw new Error(`${verb} refused`);
  writeEngagement(root, applied.record);
}

/** The owner's `continue` comment after the agent's on the engagement's inbox item. */
function continueOn(root: string) {
  mkdirSync(join(root, "_bmad-output", "tracking", ISSUE), { recursive: true });
  writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ inbox_version: 1, items: [{ issue: ISSUE, engagement: ENG, title: `${ENG}: questions`, state: "open" }] }));
  const comments = [
    { id: "c1", author: "agent", body: `[~accountid:o] Blocked: ${ENG} landed story 41-1-csv-button`, created: "2026-10-25T07:00:00.000+0000" },
    { id: "c2", author: "owner", body: "continue", created: "2026-10-25T07:05:00.000+0000" },
  ];
  writeFileSync(join(root, "_bmad-output", "tracking", ISSUE, "comments.jsonl"), comments.map((c) => JSON.stringify({ issue: ISSUE, ...c })).join("\n") + "\n");
}

describe("Story 32.6 review patches: re-approval, the kept worktree, the lock", () => {
  test("H1: a re-approval after revise runs the pass again (a new append, commit and PR); the second cycle's launched moves approved → in-progress", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const fx = approveDeps(queue);
    fx.gh.answer({ view: "MERGED" });
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).done).toEqual([ENG]);
    const run1 = approveEvents(queue).find((d) => d.step === "queued")!.detail.run_id;
    // the plan PR merged; the first run launched (approved → in-progress) and ended
    git(origin, "update-ref", "refs/heads/main", "refs/heads/engagement/ENG-001");
    await launch(queue, run1);
    expect((await engagementRunPass(queue, fx.deps)).launched).toEqual([ENG]);
    queue.end(run1, "complete");
    // the owner revises, the scope is re-quoted, and approved again
    input(root, fx.deps, "revise");
    input(root, fx.deps, "go", undefined, { quote: structuredClone(QUOTE) });
    input(root, fx.deps, "approve", { autonomy: "full" });
    expect(readEngagement(root, ENG)!.state).toBe("approved");
    const before = approveEvents(queue).length;
    expect((await approvePass(queue, fx.deps)).done).toEqual([ENG]);
    expect(approveEvents(queue).slice(before).map((d) => [d.step, d.ok])).toEqual([
      ["append", true], ["sync", true], ["job", true], ["commit", true], ["pr", true], ["queued", true], ["done", true],
    ]);
    const branch = "engagement/ENG-001";
    expect(git(origin, "rev-list", "--count", `main..${branch}`)).toBe("1");
    expect(git(origin, "show", `${branch}:_bmad-output/planning-artifacts/epics.md`)).toContain(`## Epic 42: Report exports\n\nengagement: ${ENG}`);
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr" && c.argv[1] === "create")).toHaveLength(2);
    expect(fx.submitted.map((s) => s.jobId)).toEqual(["run-epic-41", "run-epic-42"]);
    // the second cycle's first launched: approved → in-progress again
    const run2 = approveEvents(queue).findLast((d) => d.step === "queued")!.detail.run_id;
    expect((await engagementRunPass(queue, fx.deps)).launched).toEqual([]); // queued, not launched yet
    await launch(queue, run2, "E2");
    expect((await engagementRunPass(queue, fx.deps)).launched).toEqual([ENG]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("in-progress");
    expect(record.inputs.filter((l) => l.verb === "launched").map((l) => l.run_id)).toEqual([run1, run2]);
    // done again: the next pass does nothing
    const n = queue.serviceEvents().length;
    expect(await approvePass(queue, fx.deps)).toEqual({ done: [], refused: [], failed: [] });
    expect(queue.serviceEvents().length).toBe(n);
  }, 90_000);

  test("ruling (2), never force: a re-approval after revise with the earlier PR open cuts from origin/engagement/ENG-001, lands one more fast-forward commit replacing the earlier plan, and the open PR carries it", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const fx = approveDeps(queue);
    const gitCalls: string[][] = [];
    fx.deps.run = (bin, args, opts) => {
      if (bin === "git") gitCalls.push(args);
      return runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...fx.deps.env, ...(opts.env ?? {}) } });
    };
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([]);
    const branch = "engagement/ENG-001";
    const first = git(origin, "rev-parse", branch);
    const url = "https://github.com/acme/widget/pull/42";
    fx.gh.answer({ open: [url] }); // the earlier PR is still open
    // the owner revises the scope, it is re-quoted and approved again
    writeFileSync(join(root, "_bmad-output", "engagements", ENG, "scope.md"), SCOPE.replace("### Epic 1: Report exports", "### Epic 1: Report exports, revised"));
    input(root, fx.deps, "revise");
    input(root, fx.deps, "go", undefined, { quote: structuredClone(QUOTE) });
    input(root, fx.deps, "approve", { autonomy: "steady" });
    const before = approveEvents(queue).length;
    await approvePass(queue, fx.deps);
    expect(approveEvents(queue).slice(before).map((d) => [d.step, d.ok])).toEqual([["append", true], ["sync", true], ["job", true], ["commit", true], ["pr", true]]);
    // one more commit on top of the earlier one: a fast-forward
    expect(git(origin, "rev-list", "--count", `main..${branch}`)).toBe("2");
    expect(git(origin, "rev-parse", `${branch}~1`)).toBe(first);
    // its content replaces the earlier plan wholesale: the epic once, revised; the entity minted once
    const epics = git(origin, "show", `${branch}:_bmad-output/planning-artifacts/epics.md`);
    expect(epics.match(/^## Epic \d+:/gm)).toEqual(["## Epic 40:", "## Epic 41:"]);
    expect(epics).toContain(`## Epic 41: Report exports, revised\n\nengagement: ${ENG}`);
    expect(git(origin, "diff", "--name-only", "main", branch).split("\n").sort()).toEqual([
      ".tk-studio/budget-bands.yaml", ".tk-studio/config.yaml", ".tk-studio/jobs/run-epic-41.json", ".tk-studio/plan-counter.yaml",
      "_bmad-output/planning-artifacts/epics.md", "_bmad-output/planning-artifacts/plan/EP-034.md",
    ]);
    const commit = approveEvents(queue).findLast((d) => d.step === "commit")!;
    expect(commit.detail.cut).toBe(`origin/${branch}`);
    // the open PR carries the new commit: no second PR
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr" && c.argv[1] === "create")).toHaveLength(1);
    expect(approveEvents(queue).findLast((d) => d.step === "pr")!.detail.pr).toEqual({ number: 42, url });
    // never a force push
    const pushes = gitCalls.filter((a) => a[0] === "push");
    expect(pushes).toHaveLength(2);
    for (const p of pushes) expect(p.some((a) => a.startsWith("--force") || a.startsWith("+"))).toBe(false);
  }, 90_000);

  test("ruling (2): a push origin rejects as non-fast-forward is a named refusal on commit, retried at the next pass, never forced", async () => {
    const queue = newQueue();
    const { root } = servedRepo();
    const fx = approveDeps(queue);
    const pushes: string[][] = [];
    fx.deps.run = (bin, args, opts) => {
      if (bin === "git" && args[0] === "push") {
        pushes.push(args);
        return Promise.resolve({ exit: 1, stdout: "", stderr: " ! [rejected]        engagement/ENG-001 -> engagement/ENG-001 (non-fast-forward)" });
      }
      return runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...fx.deps.env, ...(opts.env ?? {}) } });
    };
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([ENG]);
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", false]]);
    expect(approveEvents(queue).at(-1)!.detail.reason).toStartWith("NonFastForward: origin rejected the push of engagement/ENG-001");
    await approvePass(queue, fx.deps);
    expect(pushes).toHaveLength(2); // retried
    for (const p of pushes) expect(p).toEqual(["push", "-q", "-u", "origin", "engagement/ENG-001"]);
    expect(readEngagement(root, ENG)!.state).toBe("approved");
  }, 90_000);

  test("H2: a push failure after an ok sync keeps the worktree; the next pass does not call plansync sync again and commits from the kept worktree", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    let pushFails = true;
    const fx = approveDeps(queue);
    fx.deps.run = (bin, args, opts) => (bin === "git" && args[0] === "push" && pushFails
      ? Promise.resolve({ exit: 1, stdout: "", stderr: "fatal: unable to access origin" })
      : runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...fx.deps.env, ...(opts.env ?? {}) } }));
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([ENG]);
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", false]]);
    const wt = join(fx.work, "worktrees", "p", `engagement-${ENG}`);
    expect(existsSync(wt)).toBe(true); // kept: its promote is done
    expect(git(origin, "branch", "--list", "engagement/*")).toBe("");
    // a retry still failing: the kept worktree, no second sync, the refusal told once
    await approvePass(queue, fx.deps);
    expect(steps(queue)).toHaveLength(4);
    pushFails = false;
    await approvePass(queue, fx.deps);
    expect(fx.plansync.calls().filter((a) => a[0] === "sync")).toHaveLength(1);
    expect(steps(queue).slice(4)).toEqual([["commit", true], ["pr", true]]);
    const branch = "engagement/ENG-001";
    expect(git(origin, "rev-list", "--count", `main..${branch}`)).toBe("1");
    expect(git(origin, "diff", "--name-only", "main", branch).split("\n")).toContain("_bmad-output/planning-artifacts/plan/EP-034.md");
    expect(git(origin, "show", `${branch}:_bmad-output/planning-artifacts/epics.md`).match(/^## Epic 41:/gm)).toHaveLength(1);
    expect(existsSync(wt)).toBe(false); // removed once pushed
  }, 90_000);

  test("H2: the cross-process lock — held by a live process, the engagement waits for the next pass; a dead pid's lock is reclaimed", async () => {
    const queue = newQueue();
    const { root } = servedRepo();
    const fx = approveDeps(queue);
    const lock = join(fx.work, "worktrees", "p", `engagement-${ENG}.lock`);
    mkdirSync(join(fx.work, "worktrees", "p"), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), at: "2026-10-25T06:00:00.000Z" }));
    expect(await approvePass(queue, fx.deps, { root, engagement: ENG })).toEqual({ done: [], refused: [], failed: [] });
    expect(approveEvents(queue)).toEqual([]);
    expect(fx.plansync.calls()).toEqual([]);
    // stale: its pid is past any pid_max
    writeFileSync(lock, JSON.stringify({ pid: 4_194_305, host: hostname(), at: "2026-10-25T06:00:00.000Z" }));
    await approvePass(queue, fx.deps, { root, engagement: ENG });
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", true], ["pr", true]]);
    expect(existsSync(lock)).toBe(false); // released
  }, 60_000);

  test("4: two engagements approved before either PR merges take different ## Epic numbers", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const other = "ENG-002";
    mkdirSync(join(root, "_bmad-output", "engagements", other), { recursive: true });
    writeFileSync(join(root, "_bmad-output", "engagements", other, "scope.md"), SCOPE.replace(`# ${ENG}`, `# ${other}`));
    writeEngagement(root, { ...approvedRecord(), id: other });
    const fx = approveDeps(queue);
    await approvePass(queue, fx.deps, { root, engagement: ENG });
    await approvePass(queue, fx.deps, { root, engagement: other });
    const jobs = queue.serviceEvents(APPROVE_EVENT).map((e) => e.detail as Record<string, any>).filter((d) => d.step === "job").map((d) => [d.id, d.detail.jobs]);
    expect(jobs).toEqual([[ENG, ["run-epic-41"]], [other, ["run-epic-42"]]]);
    expect(git(origin, "show", `engagement/${other}:_bmad-output/planning-artifacts/epics.md`)).toContain(`## Epic 42: Report exports\n\nengagement: ${other}`);
    // the pure part: the reserved numbers count in the highest ## Epic
    expect(appendEpics("## Epic 7: A\n", [{ k: 1, title: "X", intro: "", stories: [{ m: 1, title: "S", body: "b" }] }], ENG, [9, 3]).epics[0]!.n).toBe(10);
  }, 90_000);
});

describe("Story 32.6 review patches: the pure parts", () => {
  test("5: rekeyBands moves the predicted EP id's entry to the minted one, other entries kept", () => {
    const text = BANDS_HEAD + "  EP-033:\n    usd_estimate: 40.0\n  EP-031:\n    usd_estimate: 5.0\n";
    expect(rekeyBands(text, { "EP-034": 40.0 }, ["EP-033"])).toBe(BANDS_HEAD + "  EP-031:\n    usd_estimate: 5.0\n  EP-034:\n    usd_estimate: 40.0\n");
    // a predicted id equal to a minted one is set, not removed; an absent predicted id changes nothing else
    expect(rekeyBands(text, { "EP-033": 41.0 }, ["EP-033"])).toBe(text.replace("40.0", "41.0"));
    expect(rekeyBands(BANDS_HEAD, { "EP-034": 40.0 }, ["EP-099"])).toBe(BANDS_HEAD + "  EP-034:\n    usd_estimate: 40.0\n");
  });

  test("7: Epic 0 refused NoScope; a repeated #### Story k.m in one epic refused StoryShape: k.m repeated", () => {
    const zero = PROPOSED.replace("### Epic 1: Report exports", "### Epic 0: Report exports").replaceAll("Story 1.", "Story 0.");
    expect(proposedEpics(scopeWith(zero), ENG)).toMatchObject({ ok: false, reason: expect.stringMatching(/^NoScope: Epic 0/) });
    const twice = PROPOSED.replace("#### Story 1.2: Filtered export", "#### Story 1.1: Filtered export");
    expect(proposedEpics(scopeWith(twice), ENG)).toMatchObject({ ok: false, reason: expect.stringMatching(/^StoryShape: 1\.1 repeated/) });
  });
});

describe("Story 32.6 review patches: the run pass", () => {
  test("3: cancel cancels a linked run still queued (no engine) so it never launches; the stop recorded with engine_run_id null", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress" });
    const fx = approveDeps(queue);
    input(root, fx.deps, "cancel");
    expect((await engagementRunPass(queue, fx.deps, { root, engagement: ENG })).stopped).toEqual([run]);
    expect(queue.get(run)!.state).toBe("cancelled");
    expect(fx.stopped).toEqual([]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => e.detail)).toEqual([
      { engagement: ENG, project: "p", run_id: run, engine_run_id: null, reason: "cancel", ok: true, detail: "queued run cancelled before launch" },
    ]);
    await engagementRunPass(queue, fx.deps);
    expect(queue.serviceEvents(RUN_STOP_EVENT)).toHaveLength(1);
  });

  test("3: at the cap a queued linked run is cancelled through the injected cancel path; go {cap} resubmits", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", runsUsd: 41.5 });
    const cancelled: string[] = [];
    const fx = approveDeps(queue, { cancelQueued: async (id) => { cancelled.push(id); queue.end(id, "cancelled", "cancelled: operator request", { from: "queued" }); } });
    const out = await engagementRunPass(queue, fx.deps);
    expect(out.capped).toEqual([ENG]);
    expect(cancelled).toEqual([run]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => [e.detail?.reason, e.detail?.ok])).toEqual([["cap", true]]);
    input(root, fx.deps, "go", { cap: 80 });
    expect((await engagementRunPass(queue, fx.deps, { root, engagement: ENG })).resubmitted).toEqual([ENG]);
  });

  test("6: an ask continue at or past the cap resumes but resubmits nothing; the next pass caps it", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { autonomy: "ask" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    expect((await engagementRunPass(queue, fx.deps)).paused).toEqual([ENG]);
    queue.end(run, "complete", null, { detail: { pr: PR } });
    const cur = readEngagement(root, ENG)!;
    writeEngagement(root, { ...cur, spend: { ...cur.spend, runs_usd: 40 } });
    continueOn(root);
    const resumed = await engagementRunPass(queue, fx.deps);
    expect(resumed.resumed).toEqual([ENG]);
    expect(resumed.resubmitted).toEqual([]);
    expect(fx.submitted).toEqual([]);
    expect((await engagementRunPass(queue, fx.deps)).capped).toEqual([ENG]);
    expect(readEngagement(root, ENG)!.state).toBe("partial");
    expect(fx.submitted).toEqual([]);
  });
});

// ------------------------------------------------------------ review patches, round 2 (P1-P8)

describe("Story 32.6 review patches (round 2): the approve pass", () => {
  test("P1: a remote engagement branch that moved after the first push attempt is fast-forwarded on the next pass (HEAD moved onto it, the worktree's tree kept), never forced", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const fx = approveDeps(queue);
    const branch = "engagement/ENG-001";
    const pushes: string[][] = [];
    let foreign = "";
    fx.deps.run = (bin, args, opts) => {
      if (bin === "git" && args[0] === "push") {
        pushes.push(args);
        if (!foreign) {
          // someone else pushes the branch between the cut and this push: the real push is rejected
          const clone = join(temp("tk-sup-ap-foreign-"), "c");
          git(dirnameOf(clone), "clone", "-q", origin, "c");
          git(clone, "checkout", "-q", "-b", branch);
          writeFileSync(join(clone, "foreign.txt"), "not the plan\n");
          git(clone, "add", "foreign.txt");
          git(clone, "commit", "-q", "-m", "foreign");
          git(clone, "push", "-q", "origin", branch);
          foreign = git(clone, "rev-parse", "HEAD");
        }
      }
      return runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...fx.deps.env, ...(opts.env ?? {}) } });
    };
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([ENG]);
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", false]]);
    expect(approveEvents(queue).at(-1)!.detail.reason).toStartWith("NonFastForward: origin rejected the push of engagement/ENG-001");
    // the next pass: resumed in the kept worktree, moved onto origin's tip, one commit on top, a plain push
    expect((await approvePass(queue, fx.deps)).failed).toEqual([]);
    expect(steps(queue).slice(4)).toEqual([["commit", true], ["pr", true]]);
    expect(git(origin, "rev-parse", `${branch}~1`)).toBe(foreign);
    expect(git(origin, "rev-list", "--count", `main..${branch}`)).toBe("2");
    // the content replaces the remote's wholesale
    expect(git(origin, "ls-tree", "-r", "--name-only", branch).split("\n")).not.toContain("foreign.txt");
    expect(git(origin, "show", `${branch}:_bmad-output/planning-artifacts/epics.md`).match(/^## Epic 41:/gm)).toHaveLength(1);
    expect(fx.plansync.calls().filter((a) => a[0] === "sync")).toHaveLength(1);
    expect(approveEvents(queue).findLast((d) => d.step === "commit")!.detail.cut).toBe(`origin/${branch}`);
    expect(pushes).toHaveLength(2);
    for (const p of pushes) expect(p).toEqual(["push", "-q", "-u", "origin", branch]);
  }, 90_000);

  test("P2: plansync's removed[] is staged — a removed projection file is deleted in the commit", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const fx = approveDeps(queue);
    const gone = "_bmad-output/planning-artifacts/plan/EP-030.md";
    fx.plansync.removes([gone]);
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([]);
    const branch = "engagement/ENG-001";
    expect(git(origin, "diff", "--name-status", "main", branch).split("\n")).toContain(`D\t${gone}`);
    expect(git(origin, "ls-tree", "-r", "--name-only", branch).split("\n")).not.toContain(gone);
    expect(approveEvents(queue).find((d) => d.step === "sync")!.detail.removed).toEqual([gone]);
    expect(approveEvents(queue).find((d) => d.step === "commit")!.detail.removed).toEqual([gone]);
    expect(existsSync(join(root, gone))).toBe(true); // the served root untouched
  }, 60_000);

  test("P3: a sync that fails after writing keeps the worktree; the next pass re-runs the sync there (no second append) and commits the union", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const fx = approveDeps(queue);
    fx.plansync.sync("partial");
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([ENG]);
    expect(steps(queue)).toEqual([["append", true], ["sync", false]]);
    const failedSync = approveEvents(queue)[1]!.detail;
    expect(failedSync).toMatchObject({ reason: "fake sync partial", partial: true });
    expect(failedSync.written).toContain("_bmad-output/planning-artifacts/plan/EP-034.md");
    const wt = join(fx.work, "worktrees", "p", `engagement-${ENG}`);
    expect(existsSync(wt)).toBe(true); // kept: its promote may have stamped keys
    fx.plansync.sync("ok");
    expect((await approvePass(queue, fx.deps)).failed).toEqual([]);
    expect(steps(queue).slice(2)).toEqual([["sync", true], ["job", true], ["commit", true], ["pr", true]]);
    expect(fx.plansync.calls().filter((a) => a[0] === "sync")).toHaveLength(2);
    expect(fx.plansync.calls().every((a) => a[2]!.includes(`engagement-${ENG}`))).toBe(true);
    const branch = "engagement/ENG-001";
    expect(git(origin, "rev-list", "--count", `main..${branch}`)).toBe("1");
    expect(git(origin, "diff", "--name-only", "main", branch).split("\n").sort()).toEqual([
      ".tk-studio/budget-bands.yaml", ".tk-studio/config.yaml", ".tk-studio/jobs/run-epic-41.json", ".tk-studio/plan-counter.yaml",
      "_bmad-output/planning-artifacts/epics.md", "_bmad-output/planning-artifacts/plan/EP-034.md",
    ]);
    expect(git(origin, "show", `${branch}:_bmad-output/planning-artifacts/epics.md`).match(/^## Epic 41:/gm)).toHaveLength(1);
    expect(existsSync(wt)).toBe(false);
  }, 90_000);

  test("P6: a throw in a later step is reported on that step, not on append", async () => {
    const queue = newQueue();
    const { root } = servedRepo();
    const fx = approveDeps(queue);
    fx.deps.run = (bin, args, opts) => {
      if (bin === "git" && args[0] === "add") throw new Error("git add exploded");
      return runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...fx.deps.env, ...(opts.env ?? {}) } });
    };
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([ENG]);
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", false]]);
    expect(approveEvents(queue).at(-1)!.detail.reason).toContain("git add exploded");
  }, 60_000);
});

describe("Story 32.6 review patches (round 2): the pure parts", () => {
  test("P4: a #### Story 2.1 under ### Epic 1 is refused StoryShape: 2.1", () => {
    const wrong = PROPOSED.replace("#### Story 1.2: Filtered export", "#### Story 2.1: Filtered export");
    expect(proposedEpics(scopeWith(wrong), ENG)).toMatchObject({ ok: false, reason: expect.stringMatching(/^StoryShape: 2\.1 /) });
  });

  test("P5: appended epics are numbered contiguously (non-contiguous scope numbers, a dropped story-less epic), each keeping its k", () => {
    const st = (m: number) => ({ m, title: "S", body: "b" });
    const out = appendEpics("## Epic 12: B\n", [{ k: 1, title: "X", intro: "", stories: [st(1)] }, { k: 3, title: "Y", intro: "", stories: [st(1)] }], ENG);
    expect(out.epics.map((e) => [e.k, e.n])).toEqual([[1, 13], [3, 14]]);
    expect(out.text).toContain("## Epic 14: Y\n\nengagement: ENG-001\n\n### Story 14.1: S\n");
    const dropped = proposedEpics(scopeWith(`## Proposed epics and stories\n\n### Epic 1: Empty\n\nLater.\n\n### Epic 2: Exports\n\n#### Story 2.1: CSV\n\n${STORY_1}\n`), ENG);
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(appendEpics("## Epic 40: Old\n", dropped.epics, ENG).epics).toEqual([{ k: 2, n: 41, title: "Exports", stories: 1 }]);
  });
});

describe("Story 32.6 review patches (round 2): the run pass", () => {
  test("P7: an ask stop recorded with its run-paused not applied is paused at the next pass (once), never resubmitted without continue", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { autonomy: "ask" });
    const fx = approveDeps(queue);
    let failWrite = false;
    fx.deps.beforeWrite = () => { if (failWrite) { failWrite = false; throw new Error("record write failed"); } };
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    failWrite = true;
    expect((await engagementRunPass(queue, fx.deps)).paused).toEqual([]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => [e.detail?.reason, e.detail?.ok])).toEqual([["ask", true]]);
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
    queue.end(run, "complete", null, { detail: { pr: PR } });
    const out = await engagementRunPass(queue, fx.deps);
    expect(out.paused).toEqual([ENG]);
    expect(out.resubmitted).toEqual([]);
    const record = readEngagement(root, ENG)!;
    expect(record.state).toBe("paused");
    expect(record.inputs.at(-1)).toMatchObject({ verb: "run-paused", source: "supervisor", detail: { run_id: run, story_key: "41-1-csv-button" } });
    expect(fx.uvCalls.filter((c) => c.script === "track.py").map((c) => c.args[6])).toEqual(["ask"]);
    await engagementRunPass(queue, fx.deps);
    expect(readEngagement(root, ENG)!.inputs.filter((l) => l.verb === "run-paused")).toHaveLength(1);
    expect(fx.submitted).toEqual([]);
  });

  test("P7: the resubmit never resumes from an ask stop with no run-resumed after it", async () => {
    const queue = newQueue();
    const { run } = linkedRoot(queue, { autonomy: "full", state: "in-progress" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "ask", story_key: "41-1-csv-button", ok: true, detail: "stopping" });
    queue.end(run, "complete", null, { detail: { pr: PR } });
    expect((await engagementRunPass(queue, fx.deps)).resubmitted).toEqual([]);
    expect(fx.submitted).toEqual([]);
  });

  test("P8: steady then a newer cap stop — after go {cap} the resubmit still waits for the story PR's merge", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { autonomy: "steady" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    expect((await engagementRunPass(queue, fx.deps)).stopped).toEqual([run]);
    const cur = readEngagement(root, ENG)!;
    writeEngagement(root, { ...cur, spend: { ...cur.spend, runs_usd: 41.5 } });
    expect((await engagementRunPass(queue, fx.deps)).capped).toEqual([ENG]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => e.detail?.reason)).toEqual(["steady", "cap"]);
    queue.end(run, "partial", null, { detail: { pr: PR } });
    input(root, fx.deps, "go", { cap: 80 });
    expect((await engagementRunPass(queue, fx.deps)).resubmitted).toEqual([]); // the story PR is OPEN
    expect(fx.gh.calls().some((c) => c.argv[0] === "pr" && c.argv[1] === "view" && c.argv[2] === PR)).toBe(true);
    fx.gh.answer({ view: "MERGED" });
    expect((await engagementRunPass(queue, fx.deps)).resubmitted).toEqual([ENG]);
    expect(fx.submitted).toEqual([{ jobId: "run-epic-41", root, payload: { engagement: ENG, project: "p" } }]);
  });
});

// ------------------------------------------------------------ follow-up review patches (F1, F2)

/** A run linked under the first approval (05:30), launched, then the owner's revise + go + re-approve: the record
 * approved again with the earlier cycle's run still live and no run linked under the newest approve line. */
async function reapprovedWithLiveRun(queue: Queue) {
  const root = temp("tk-sup-ap-root-");
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), "project_id: p\n" + BOUND);
  writeEngagement(root, { ...approvedRecord(), state: "in-progress", spend: { planning_usd: 0.5, runs_usd: 0 } });
  const { run } = queue.enqueue({ jobId: "run-epic-41", root, projectId: "p", definition: { id: "run-epic-41" }, payload: { engagement: ENG, project: "p" } });
  queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job: "run-epic-41" }, "2026-10-25T05:45:00.000Z");
  await launch(queue, run.run_id);
  const fx = approveDeps(queue);
  input(root, fx.deps, "revise");
  input(root, fx.deps, "go", undefined, { quote: structuredClone(QUOTE) });
  input(root, fx.deps, "approve", { autonomy: "full" });
  expect(readEngagement(root, ENG)!.state).toBe("approved");
  return { root, run: run.run_id, fx };
}

describe("Story 32.6 follow-up review patches", () => {
  test("F1: at the cap a run linked under the first approval, still live after revise + re-approve, is stopped gracefully", async () => {
    const queue = newQueue();
    const { root, run, fx } = await reapprovedWithLiveRun(queue);
    const cur = readEngagement(root, ENG)!;
    writeEngagement(root, { ...cur, state: "in-progress", spend: { ...cur.spend, runs_usd: 41.5 } });
    const out = await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(out.capped).toEqual([ENG]);
    expect(out.stopped).toEqual([run]);
    expect(readEngagement(root, ENG)!.state).toBe("partial");
    expect(fx.stopped).toEqual([{ root, engine: "E1" }]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => [e.detail?.run_id, e.detail?.reason, e.detail?.ok])).toEqual([[run, "cap", true]]);
    expect(fx.notices[0]).toMatchObject({ run_id: run, job_id: "run-epic-41", state: "partial" });
    // the kind cap block of the engagement's issue (BOUND in config.yaml)
    const blocks = () => fx.uvCalls.filter((c) => c.script === "track.py" && c.args[0] === "block");
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]!.args.slice(0, 7)).toEqual(["block", "--directory", root, "--engagement", ENG, "--kind", "cap"]);
    expect(queue.serviceEvents("engagement-issue").map((e) => e.detail).filter((d) => d?.action === "blocked")).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "cap" }]);
    await engagementRunPass(queue, fx.deps);
    expect(fx.stopped).toHaveLength(1); // once
    expect(blocks()).toHaveLength(1); // once
    expect(fx.submitted).toEqual([]);
  });

  test("F1: cancel stops a run linked under the first approval, still live after revise + re-approve", async () => {
    const queue = newQueue();
    const { root, run, fx } = await reapprovedWithLiveRun(queue);
    input(root, fx.deps, "cancel");
    expect((await engagementRunPass(queue, fx.deps, { root, engagement: ENG })).stopped).toEqual([run]);
    expect(fx.stopped).toEqual([{ root, engine: "E1" }]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => [e.detail?.run_id, e.detail?.reason, e.detail?.ok])).toEqual([[run, "cancel", true]]);
    expect(fx.submitted).toEqual([]);
  });

  test("F2: an ok append whose sync failed holds its ## Epic N; a second engagement approved meanwhile takes the next", async () => {
    const queue = newQueue();
    const { root, origin } = servedRepo();
    const other = "ENG-002";
    mkdirSync(join(root, "_bmad-output", "engagements", other), { recursive: true });
    writeFileSync(join(root, "_bmad-output", "engagements", other, "scope.md"), SCOPE.replace(`# ${ENG}`, `# ${other}`));
    writeEngagement(root, { ...approvedRecord(), id: other });
    const fx = approveDeps(queue);
    fx.plansync.sync("partial"); // the worktree kept: the next pass resumes it with the same ## Epic N (review P3)
    expect((await approvePass(queue, fx.deps, { root, engagement: ENG })).failed).toEqual([ENG]);
    expect(steps(queue)).toEqual([["append", true], ["sync", false]]);
    expect(approveEvents(queue)[0]!.detail.epics.map((e: { n: number }) => e.n)).toEqual([41]);
    fx.plansync.sync("ok");
    await approvePass(queue, fx.deps, { root, engagement: other });
    await approvePass(queue, fx.deps, { root, engagement: ENG });
    const jobs = approveEvents(queue).filter((d) => d.step === "job" && d.ok).map((d) => [d.id, d.detail.jobs]);
    expect(jobs).toEqual([[other, ["run-epic-42"]], [ENG, ["run-epic-41"]]]);
    expect(git(origin, "show", `engagement/${other}:_bmad-output/planning-artifacts/epics.md`)).toContain(`## Epic 42: Report exports\n\nengagement: ${other}`);
  }, 120_000);
});

describe("Story 32.8: revise mid-run, go past the cap, the run-end hand-off", () => {
  test("revise mid-run: back to scoping (quote voided); the live engine stopped gracefully with reason revise, once; never resubmitted", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", autonomy: "steady" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    input(root, fx.deps, "revise", { body: "narrow it" });
    const r = readEngagement(root, ENG)!;
    expect([r.state, r.quote]).toEqual(["scoping", null]);
    expect((await engagementRunPass(queue, fx.deps, { root, engagement: ENG })).stopped).toEqual([run]);
    await engagementRunPass(queue, fx.deps);
    expect(fx.stopped).toEqual([{ root, engine: "E1" }]);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => e.detail)).toEqual([
      { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "revise", ok: true, detail: "engine E1 stopping gracefully" },
    ]);
    // the engine finishes its story and stops: nothing resubmitted, no run-ended, the state stays scoping
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    queue.end(run, "partial", null, { detail: { pr: PR } });
    fx.gh.answer({ view: "MERGED" });
    expect((await engagementRunPass(queue, fx.deps)).resubmitted).toEqual([]);
    expect(fx.submitted).toEqual([]);
    expect(readEngagement(root, ENG)!.state).toBe("scoping");
    expect(readEngagement(root, ENG)!.inputs.some((l) => l.verb === "run-ended")).toBe(false);
  });

  test("revise with the linked run still queued: cancelled before it launches (reason revise), once", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress" });
    const fx = approveDeps(queue);
    input(root, fx.deps, "revise");
    expect((await engagementRunPass(queue, fx.deps, { root, engagement: ENG })).stopped).toEqual([run]);
    expect(queue.get(run)!.state).toBe("cancelled");
    expect(queue.get(run)!.reason).toBe(`cancelled: engagement ${ENG} revised`);
    expect(queue.serviceEvents(RUN_STOP_EVENT).map((e) => [e.detail?.reason, e.detail?.ok, e.detail?.engine_run_id])).toEqual([["revise", true, null]]);
    await engagementRunPass(queue, fx.deps);
    expect(queue.serviceEvents(RUN_STOP_EVENT)).toHaveLength(1);
    expect(fx.stopped).toEqual([]);
  });

  test("go past the cap from partial: raise-cap, in-progress, the capped run resubmitted", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", runsUsd: 41.5 });
    const fx = approveDeps(queue);
    await launch(queue, run);
    expect((await engagementRunPass(queue, fx.deps)).capped).toEqual([ENG]);
    queue.end(run, "partial");
    input(root, fx.deps, "go", { cap: 90 });
    expect(readEngagement(root, ENG)!.quote!.cap).toBe(90);
    expect((await engagementRunPass(queue, fx.deps, { root, engagement: ENG })).resubmitted).toEqual([ENG]);
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
  });

  test("the run-end hand-off: a run that ends on its own (no stop) is never resubmitted; the state is left to the closeout pass", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", autonomy: "full" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    queue.end(run, "complete", null, { detail: { pr: PR } });
    const out = await engagementRunPass(queue, fx.deps);
    expect(out.resubmitted).toEqual([]);
    expect(out.stopped).toEqual([]);
    expect(fx.submitted).toEqual([]);
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
  });
});

describe("Story 34.8: approve's type rule (AC1)", () => {
  test("a record with game: true mints run-epic-N as type run-vertical-slice; the id stays run-epic-N", async () => {
    const queue = newQueue();
    const record = { ...approvedRecord({ baseRef: "release" }), game: true } as Engagement;
    const { root, origin } = servedRepo({ record });
    const fx = approveDeps(queue);
    await approvePass(queue, fx.deps, { root, engagement: ENG });
    expect(steps(queue).slice(0, 3)).toEqual([["append", true], ["sync", true], ["job", true]]);
    const job = JSON.parse(git(origin, "show", "engagement/ENG-001:.tk-studio/jobs/run-epic-41.json"));
    expect(job).toMatchObject({ job_schema_version: 1, id: "run-epic-41", type: "run-vertical-slice", target: { payload: { epic: 41 } } });
    expect(job).not.toHaveProperty("stop"); // Story 36.6: the slice mint keeps its type's
    expect(approveEvents(queue).find((d) => d.step === "job")!.detail.jobs).toEqual(["run-epic-41"]);
  });

  test("a record without game (or game false) mints run-epic, unchanged", async () => {
    for (const game of [undefined, false]) {
      const queue = newQueue();
      const record = { ...approvedRecord({ baseRef: "release" }), ...(game === undefined ? {} : { game }) } as Engagement;
      const { root, origin } = servedRepo({ record });
      const fx = approveDeps(queue);
      await approvePass(queue, fx.deps, { root, engagement: ENG });
      const job = JSON.parse(git(origin, "show", "engagement/ENG-001:.tk-studio/jobs/run-epic-41.json"));
      expect(job.type).toBe("run-epic");
    }
  }, 60_000); // two served repos per case: 5.2 s idle on the host, past bun's 5 s default under an engine's load (hole 97)
});

describe("Story 35.5: an approve-minted run-epic-N the host placement cannot run (hole 90)", () => {
  test("the submit's TierRequired refusal rides the queued step's existing refusal path: queued false naming the per-job config entry, nothing queued; requires never loosened", async () => {
    const queue = newQueue();
    const { root } = servedRepo({ record: approvedRecord({ baseRef: "release" }) });
    const reason = 'TierRequired: job run-epic-41 requires tier sbx; placement resolved host (explicit) — set jobs.p/run-epic-41 {tier: "sbx", sandbox: "<name>"} in TK_SUPERVISOR_CONFIG';
    const refusing = fakeSubmit(queue, { fail: reason });
    const fx = approveDeps(queue, { submit: refusing.submit });
    await approvePass(queue, fx.deps, { root, engagement: ENG });
    expect(steps(queue)).toEqual([["append", true], ["sync", true], ["job", true], ["commit", true], ["pr", true]]);
    fx.gh.answer({ view: "MERGED" });
    await approvePass(queue, fx.deps);
    expect(steps(queue).slice(5)).toEqual([["queued", false]]);
    expect(approveEvents(queue).find((d) => d.step === "queued")!.detail).toMatchObject({ reason });
    expect(refusing.calls.map((c) => c.jobId)).toEqual(["run-epic-41"]);
    expect(queue.runs()).toEqual([]);
    expect(queue.serviceEvents(RUN_QUEUED_EVENT)).toEqual([]);
  }, 60_000);
});

// Story 35.5 (review): the real chain an approve-minted run takes — `engagementSubmitter` → `engagementPlacement`'s host
// fallback → `submitJob` (the registry, `resolve`) → the requires-tier check — against a throwaway store (as
// enginemcp.test.ts's e2e block does), with no per-job entry anywhere in the supervisor config.
const canRunChain = !!process.env.TK_STUDIO_ROOT && spawnSync("uv", ["--version"]).status === 0;

describe.skipIf(!canRunChain)("Story 35.5: the production submitter on the host fallback (hole 90)", () => {
  const store = temp("tk-sup-ap-store-");
  const prev: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of ["TK_STUDIO_HOME", "TK_SUPERVISOR_CONFIG"]) prev[k] = process.env[k];
    process.env.TK_STUDIO_HOME = store;
    delete process.env.TK_SUPERVISOR_CONFIG; // no config: the host fallback
  });
  afterAll(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  test("an approve-minted run-epic-N placed on the host fallback is refused TierRequired by name through the real submit, nothing enqueued", async () => {
    const repo = gitRepo({
      ".tk-studio/config.yaml": CONFIG.replace("run-epic-40", "run-epic-41"),
      ".tk-studio/jobs/run-epic-41.json": JSON.stringify({ job_schema_version: 1, id: "run-epic-41", type: "run-epic", target: { payload: { epic: 41 } } }),
    });
    const root = repo.checkout;
    const plugin = join(process.env.TK_STUDIO_ROOT!, "plugins", "tk-studio");
    const reg = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "register", "--directory", root, "--writer", "onboard"],
      { env: { ...process.env, TK_STUDIO_HOME: store }, encoding: "utf-8", timeout: 120_000 });
    if (reg.status !== 0) throw new Error(`register failed: ${reg.stdout}${reg.stderr}`);
    expect(engagementPlacement("run-epic-41", root)).toEqual({ tier: "host", source: "host" });
    const queue = newQueue();
    const err = await engagementSubmitter({ queue })("run-epic-41", root, { payload: { engagement: ENG, project: "p" } }).catch((e) => e);
    expect(err).toBeInstanceOf(StartError);
    expect(String(err.message)).toBe('TierRequired: job run-epic-41 requires tier sbx; placement resolved host (explicit) — set '
      + 'jobs.p/run-epic-41 {tier: "sbx", sandbox: "<name>"} in TK_SUPERVISOR_CONFIG');
    expect(queue.runs()).toEqual([]);
    expect(queue.serviceEvents(RUN_QUEUED_EVENT)).toEqual([]);
  }, 180_000);
});

describe("Story 36.3: go or continue closes the cap or ask block (DW-47)", () => {
  const unblocks = (fx: ReturnType<typeof approveDeps>) => fx.uvCalls.filter((c) => c.script === "track.py" && c.args[0] === "unblock").map((c) => c.args);
  const issueEvents = (q: Queue) => q.serviceEvents("engagement-issue").map((e) => e.detail as Record<string, unknown>);

  async function capped(track?: () => Record<string, unknown>) {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", runsUsd: 41.5 });
    const fx = approveDeps(queue, track ? { track } : {});
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    expect(readEngagement(root, ENG)!.state).toBe("partial");
    queue.end(run, "partial", null, { detail: { pr: PR } });
    return { queue, root, run, fx };
  }
  const goOn = (root: string) => {
    const go = applyInput(readEngagement(root, ENG)!, { verb: "go", payload: { cap: 80 }, source: "bearer", at: "2026-10-25T08:00:00.000Z" });
    if (go.ok) writeEngagement(root, go.record);
  };

  test("Story 36.3: the owner's go {cap}: one unblock --kind cap, `unblocked` recorded, not again on the next pass", async () => {
    const { queue, root, fx } = await capped();
    await engagementRunPass(queue, fx.deps);
    expect(unblocks(fx)).toEqual([]); // no go yet
    goOn(root);
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(unblocks(fx)).toEqual([["unblock", "--directory", root, "--engagement", ENG, "--kind", "cap", "--reason", "go by the owner"]]);
    expect(issueEvents(queue).at(-1)).toEqual({ engagement: ENG, project: "p", issue: ISSUE, action: "unblocked", kind: "cap" });
    expect(fx.uvCalls.filter((c) => c.script === "track.py" && c.args[0] === "close")).toEqual([]); // never `Done`
  });

  test("Story 36.3: a transient unblock is called again on the next pass; a refusal by name once", async () => {
    let answer: Record<string, unknown> = { ok: true, status: "complete", issues: [{ issue: ISSUE }] };
    const { queue, root, fx } = await capped(() => answer);
    goOn(root);
    answer = { ok: false, status: "partial", retry: true };
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(issueEvents(queue).some((e) => e.action === "unblocked")).toBe(false);
    expect(unblocks(fx)).toHaveLength(1);
    answer = { ok: false, status: "blocked", reason: "track refused: NoIssue" };
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(unblocks(fx)).toHaveLength(2);
    expect(issueEvents(queue).at(-1)).toMatchObject({ action: "refused", kind: "cap", step: "unblock", reason: "track refused: NoIssue" });
  });

  test("Story 36.3: a cap's transient unblock retried after an ask block opened on the shared issue is not made; the ask's answer closes it", async () => {
    let answer: Record<string, unknown> = { ok: true, status: "complete", issues: [{ issue: ISSUE }] };
    const { queue, root, fx } = await capped(() => answer);
    goOn(root);
    answer = { ok: false, status: "partial", retry: true };
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(unblocks(fx).map((a) => a[a.indexOf("--kind") + 1])).toEqual(["cap"]);
    queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "ask" }, "2026-10-25T08:30:00.000Z");
    answer = { ok: true, status: "complete", issues: [{ issue: ISSUE }] };
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(unblocks(fx).map((a) => a[a.indexOf("--kind") + 1])).toEqual(["cap"]); // the newer block unanswered: no move
    const record = readEngagement(root, ENG)!;
    writeEngagement(root, { ...record, inputs: [...record.inputs, { verb: "run-resumed", from: "paused", to: "in-progress", payload: {}, source: "bearer", at: "2026-10-25T08:40:00.000Z" }] });
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(unblocks(fx).map((a) => a[a.indexOf("--kind") + 1])).toEqual(["cap", "ask"]);
    expect(issueEvents(queue).filter((e) => e.action === "unblocked").map((e) => e.kind)).toEqual(["ask"]);
  });

  test("Story 36.3: the owner's continue: one unblock --kind ask, `unblocked` recorded", async () => {
    const queue = newQueue();
    const { root, run } = linkedRoot(queue, { state: "in-progress", autonomy: "ask" });
    const fx = approveDeps(queue);
    await launch(queue, run);
    queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "ask", story_key: "41-1-csv-button", ok: true, detail: "stopped" }, "2026-10-25T06:30:00.000Z");
    await engagementRunPass(queue, fx.deps);
    expect(readEngagement(root, ENG)!.state).toBe("paused");
    expect(issueEvents(queue).at(-1)).toMatchObject({ action: "blocked", kind: "ask" });
    continueOn(root);
    await engagementRunPass(queue, fx.deps, { root, engagement: ENG });
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
    expect(unblocks(fx)).toEqual([["unblock", "--directory", root, "--engagement", ENG, "--kind", "ask", "--reason", "continue by the owner"]]);
    expect(issueEvents(queue).at(-1)).toMatchObject({ action: "unblocked", kind: "ask" });
  });

  test("Story 36.3: a linked run's stop is told its tier", async () => {
    const queue = newQueue();
    const { run } = linkedRoot(queue, { state: "in-progress", runsUsd: 41.5 });
    const where: unknown[] = [];
    const fx = approveDeps(queue, { launchStop: async (_r, e, w) => { where.push(w); return { ok: true, detail: `engine ${e}` }; } });
    await launch(queue, run);
    await engagementRunPass(queue, fx.deps);
    expect(where).toEqual([{ tier: queue.get(run)!.tier, sandbox: queue.get(run)!.sandbox }]);
  });
});
