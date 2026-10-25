// Story 31.7: the resolution pass — `validate-resolution` queued once per block cycle from a bound project's
// `resolved` inbox items (host tier, the planner leg's model and effort, the payload naming the paused run and its
// spec), and the paused run re-armed on a `pass` line. Every dependency is a fake: the registry, the job's
// resolve, the resume. Never a real registry, `uv` or engine.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { ResumeRefused } from "../src/closeout";
import { Queue, VALIDATE_RESOLUTION_JOB, type Owner } from "../src/queue";
import { MAX_RESUME_ATTEMPTS, plannerLeg, resolutionKey, resolutionPass, withQueuedPayload, withStoredPayload, type ResolutionDeps } from "../src/resolution";

const me: Owner = { pid: process.pid, host: hostname(), nonce: "resolution-test" };
const ISSUE = "TKS-7";
const STORY = "31-7-the-paused-story";
const SHIPPED = {
  job_schema_version: 1, id: VALIDATE_RESOLUTION_JOB, trigger: "one-shot",
  target: { skill: "tk-studio-track", payload: { verb: "validate" } },
  guards: { max_turns: 60, max_wall_clock_seconds: 1800 }, stop: { until: "9999-12-31T23:59:59Z" }, effort: "high",
};

/** A bound project root (or not) with an inbox holding `items`. */
function project(opts: { bound?: boolean; items?: Record<string, unknown>[] | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tk-sup-res-proj-"));
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), opts.bound === false
    ? "project_id: p31\n" : "project_id: p31\nplanning:\n  backend: jira\n  jira:\n    project_key: TKS\n");
  if (opts.items !== null) {
    mkdirSync(join(root, "_bmad-output", "tracking"), { recursive: true });
    writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({
      inbox_version: 1, generated_at: "2026-10-25T00:00:00+00:00", project_key: "TKS",
      items: opts.items ?? [item()],
    }));
  }
  return root;
}

const item = (state = "resolved", reasonId: string | null = "10001") => ({
  issue: ISSUE, entity: "ST-007", priority: null, blocked_since: "2026-10-24T10:00:00.000+0000",
  reason_comment: reasonId ? { id: reasonId, body: "[~accountid:o] Blocked: x", created: "2026-10-24T10:00:00.000+0000" } : null,
  state,
});

/** A paused launch run on `root` whose pause recorded a `track-block` naming the issue (role story), with the
 * story's spec and, optionally, `routing.current.json` in its worktree. */
async function pausedRun(queue: Queue, root: string, opts: { routing?: boolean; issue?: string; planner?: { model: string; effort: string } } = {}) {
  const run0 = queue.enqueue({ jobId: "run-epic", root, projectId: "p31", definition: { id: "run-epic" }, owner: me, tier: "host" }).run;
  expect((await queue.claim(run0.run_id, me)).claimed).toBe(true);
  const wt = mkdtempSync(join(tmpdir(), "tk-sup-res-wt-"));
  queue.recordWorktree(run0.run_id, wt, { branch: `supervisor/run-${run0.run_id}`, base_ref: "main" });
  queue.markLaunched(run0.run_id, "20261025-010101-ab12", { end: { state: "complete", reason: null } });
  queue.markPaused(run0.run_id, { engine: { run_id: "20261025-010101-ab12", paused_stage: "escalation", paused_story_key: STORY } });
  queue.note(run0.run_id, "track-block", {
    story_key: STORY, engine_run_id: "20261025-010101-ab12", ok: true, status: "complete", reason: null,
    issues: [{ issue: opts.issue ?? ISSUE, role: "story", transitioned: true, commented: true }, { issue: "TKS-8", role: "dependent", transitioned: true, commented: true }],
  });
  const specDir = join(wt, "_bmad-output", "specs", "spec-epic-31", "stories");
  mkdirSync(specDir, { recursive: true });
  const spec = join(specDir, `${STORY}-spec.md`);
  writeFileSync(spec, "---\nstatus: in-progress\n---\n\n<intent-contract>\n</intent-contract>\n");
  if (opts.routing !== false) {
    mkdirSync(join(wt, ".bmad-loop"), { recursive: true });
    writeFileSync(join(wt, ".bmad-loop", "routing.current.json"), JSON.stringify({
      written_at: "2026-10-25T00:00:00Z", planner: { ...(opts.planner ?? { model: "claude-opus-5-5", effort: "high" }), advisor: "off" },
      implementer: { model: "claude-sonnet-5", effort: "medium" },
    }));
  }
  return { run: queue.get(run0.run_id)!, wt, spec };
}

function deps(root: string, extra: Partial<ResolutionDeps> = {}) {
  const resumed: string[] = [];
  const d: ResolutionDeps = {
    registry: async () => ({ ok: true, projects: { p31: { root } } }),
    resolveJob: async (r) => ({ projectId: "p31", root: r, definition: structuredClone(SHIPPED), target: "skill" }),
    resume: async (_q, id) => { resumed.push(id); return { ok: true }; },
    ...extra,
  };
  return { d, resumed };
}

const newQueue = () => new Queue(":memory:", { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) });
const validationRuns = (q: Queue) => q.runs().filter((r) => r.job_id === VALIDATE_RESOLUTION_JOB);

function writeLine(root: string, line: Record<string, unknown>) {
  const dir = join(root, "_bmad-output", "tracking", ISSUE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "validation.jsonl"), `${JSON.stringify(line)}\n`, { flag: "a" });
}

/** The queued validation run claimed (the lock exemption: its paused holder never makes it wait) and ended. */
async function endValidation(q: Queue, runId: string) {
  expect((await q.claim(runId, me)).claimed).toBe(true);
  q.end(runId, "complete");
}

describe("Story 31.7: the resolution pass queues validate-resolution once per block cycle", () => {
  test("a resolved item in a bound project: one run (host, the planner's model and effort, the payload), one validate-queued", async () => {
    const q = newQueue(), root = project();
    const { run: paused, spec } = await pausedRun(q, root);
    const { d } = deps(root);
    const first = await resolutionPass(q, d);
    const again = await resolutionPass(q, d); // the post-run chain runs twice
    expect(first.queued.length).toBe(1);
    expect(again.queued).toEqual([]);
    const runs = validationRuns(q);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ state: "queued", tier: "host", model: "claude-opus-5-5", effort: "high", project_id: "p31", root });
    const defn = q.definition(runs[0])!;
    expect(defn.target).toEqual({ skill: "tk-studio-track", payload: {
      verb: "validate", project_root: root, issues: [{ issue: ISSUE, story: STORY, paused_run: paused.run_id, spec }],
    } });
    expect(defn.guards).toEqual(SHIPPED.guards);
    const events = q.serviceEvents("validate-queued");
    expect(events.length).toBe(1);
    expect(events[0].detail).toMatchObject({
      key: `p31|${ISSUE}|10001`, project: "p31", issue: ISSUE, story: STORY, paused_run: paused.run_id, spec,
      run_id: runs[0].run_id, model: "claude-opus-5-5", effort: "high",
    });
    // the same key is never queued again, even once the run ended with an outcome
    await endValidation(q, runs[0].run_id);
    writeLine(root, { issue: ISSUE, outcome: "fail", at: new Date(Date.now() + 1000).toISOString() });
    expect((await resolutionPass(q, d)).queued).toEqual([]);
    expect(validationRuns(q).length).toBe(1);
    expect(q.serviceEvents("validate-expired")).toEqual([]);
  });

  test("a run that ended with no outcome line expires: the key is queued again, once", async () => {
    for (const state of ["complete", "blocked", "cancelled"] as const) {
      const q = newQueue(), root = project({ items: [item("validating")] });
      await pausedRun(q, root);
      // an outcome from an earlier cycle is older than the run: it does not count
      writeLine(root, { issue: ISSUE, outcome: "fail", at: "2026-01-01T00:00:00+00:00" });
      const { d } = deps(root);
      writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ items: [item("resolved")] }));
      expect((await resolutionPass(q, d)).queued.length).toBe(1);
      const [first] = validationRuns(q);
      if (state === "cancelled") q.end(first.run_id, "cancelled"); // cancelled while queued (never woken)
      else { expect((await q.claim(first.run_id, me)).claimed).toBe(true); q.end(first.run_id, state); }
      // the session's --check marked it validating; the run ended without --pass/--fail
      writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ items: [item("validating")] }));
      const again = await resolutionPass(q, d);
      expect(again.queued.length).toBe(1);
      expect(q.serviceEvents("validate-expired").map((e) => e.detail)).toEqual([
        { key: `p31|${ISSUE}|10001`, run_id: first.run_id, issue: ISSUE, state: q.get(first.run_id)!.state },
      ]);
      // the re-queued run is live: no further re-queue, no second expiry
      expect((await resolutionPass(q, d)).queued).toEqual([]);
      expect(validationRuns(q).length).toBe(2);
      expect(q.serviceEvents("validate-expired").length).toBe(1);
    }
  });

  test("a key expires at most 3 times: the 4th no-line run queues nothing; a new reason comment queues again", async () => {
    const q = newQueue(), root = project({ items: [item("validating")] });
    await pausedRun(q, root);
    const { d } = deps(root);
    expect((await resolutionPass(q, d)).queued.length).toBe(1);
    for (let n = 1; n <= 3; n++) {
      const runs = validationRuns(q);
      await endValidation(q, runs[runs.length - 1].run_id); // ended with no validation.jsonl line
      expect((await resolutionPass(q, d)).queued.length).toBe(1);
      expect(q.serviceEvents("validate-expired").length).toBe(n);
    }
    const runs = validationRuns(q);
    expect(runs.length).toBe(4);
    await endValidation(q, runs[3].run_id);
    expect((await resolutionPass(q, d)).queued).toEqual([]);
    expect((await resolutionPass(q, d)).queued).toEqual([]);
    expect(validationRuns(q).length).toBe(4);
    expect(q.serviceEvents("validate-expired").length).toBe(3);
    expect(q.serviceEvents("validate-expired").every((e) => e.detail?.key === `p31|${ISSUE}|10001`)).toBe(true);
    // a re-block (a new agent `Blocked:` comment) is a new block cycle: a new key, queued again
    writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ items: [item("resolved", "10002")] }));
    expect((await resolutionPass(q, d)).queued.length).toBe(1);
    expect(q.serviceEvents("validate-queued").at(-1)?.detail?.key).toBe(`p31|${ISSUE}|10002`);
  });

  test("an item meeting a live validation run on the checkout waits: the live run keeps its own planner leg", async () => {
    const q = newQueue(), root = project({ items: [item(), { ...item(), issue: "TKS-9", reason_comment: { id: "20001", body: "Blocked: y", created: "2026-10-24T10:00:00.000+0000" } }] });
    await pausedRun(q, root);
    await pausedRun(q, mkdtempSync(join(tmpdir(), "tk-sup-res-proj2-")), { issue: "TKS-9", planner: { model: "claude-sonnet-5", effort: "low" } });
    const { d } = deps(root);
    expect((await resolutionPass(q, d)).queued.length).toBe(1);
    expect((await resolutionPass(q, d)).queued).toEqual([]);
    const runs = validationRuns(q);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
    expect(q.events(runs[0].run_id).filter((e) => e.kind === "run-options")).toEqual([]);
    expect(q.serviceEvents("validate-queued").map((e) => e.detail?.issue)).toEqual([ISSUE]);
  });

  test("a validating item whose run is still live is not queued again", async () => {
    const q = newQueue(), root = project();
    await pausedRun(q, root);
    const { d } = deps(root);
    await resolutionPass(q, d);
    const [v] = validationRuns(q);
    expect((await q.claim(v.run_id, me)).claimed).toBe(true); // running
    writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ items: [item("validating")] }));
    expect((await resolutionPass(q, d)).queued).toEqual([]);
    expect(validationRuns(q).length).toBe(1);
    expect(q.serviceEvents("validate-expired")).toEqual([]);
  });

  test("a new block cycle (a new block comment after a fail) is a new key", async () => {
    const q = newQueue(), root = project();
    await pausedRun(q, root);
    const { d } = deps(root);
    await resolutionPass(q, d);
    await endValidation(q, validationRuns(q)[0].run_id);
    writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ items: [item("resolved", "10002")] }));
    expect((await resolutionPass(q, d)).queued.length).toBe(1);
    expect(q.serviceEvents("validate-queued").map((e) => e.detail?.key)).toEqual([`p31|${ISSUE}|10001`, `p31|${ISSUE}|10002`]);
  });

  test("nothing for an unbound project, a missing inbox, or open items", async () => {
    for (const root of [project({ bound: false }), project({ items: null }), project({ items: [item("open")] })]) {
      const q = newQueue();
      const { d } = deps(root);
      expect(await resolutionPass(q, d)).toEqual({ queued: [], resumed: [] });
      expect(validationRuns(q)).toEqual([]);
      expect(q.serviceEvents("validate-queued")).toEqual([]);
    }
  });

  test("Story 32.3: an engagement's questions item (resolved or validating) never queues validate-resolution", async () => {
    const eng = (state: string) => ({ ...item(state), issue: "TKS-40", entity: undefined, engagement: "ENG-001", title: "ENG-001: questions" });
    const q = newQueue(), root = project({ items: [eng("resolved"), eng("validating")] });
    const { d } = deps(root);
    expect(await resolutionPass(q, d)).toEqual({ queued: [], resumed: [] });
    expect(validationRuns(q)).toEqual([]);
    expect(q.serviceEvents("validate-queued")).toEqual([]);
    // a story's resolved item beside it still queues
    const q2 = newQueue(), both = project({ items: [eng("resolved"), item()] });
    expect((await resolutionPass(q2, deps(both).d)).queued.length).toBe(1);
    expect(validationRuns(q2).length).toBe(1);
  });

  test("no paused run, no routing file: queued with null paused_run and spec, the job's own routing (no model)", async () => {
    const q = newQueue(), root = project({ items: [item("resolved", null)] });
    const { d } = deps(root);
    await resolutionPass(q, d);
    const [run] = validationRuns(q);
    expect(run).toMatchObject({ tier: "host", model: null, effort: null });
    expect(q.definition(run)!.target.payload.issues).toEqual([{ issue: ISSUE, story: null, paused_run: null, spec: null }]);
    // no reason comment: the cycle is keyed by blocked_since
    expect(q.serviceEvents("validate-queued")[0].detail?.key).toBe(`p31|${ISSUE}|2026-10-24T10:00:00.000+0000`);
  });

  test("a refused resolve or registry is no throw and queues nothing", async () => {
    const q = newQueue(), root = project();
    const { d } = deps(root, { resolveJob: async () => { throw new Error("resolve: refused"); } });
    expect(await resolutionPass(q, d)).toEqual({ queued: [], resumed: [] });
    const { d: d2 } = deps(root, { registry: async () => { throw new Error("registry down"); } });
    expect(await resolutionPass(q, d2)).toEqual({ queued: [], resumed: [] });
    expect(q.serviceEvents("validate-queued")).toEqual([]);
  });
});

describe("Story 31.7: the resolution pass re-arms the paused run on a pass", () => {
  test("a pass line after the run ended: resumePaused, one validate-resumed; never twice", async () => {
    const q = newQueue(), root = project();
    const { run: paused } = await pausedRun(q, root);
    const { d, resumed } = deps(root);
    await resolutionPass(q, d);
    const [v] = validationRuns(q);
    // still queued: nothing resumes before the run ends
    writeLine(root, { issue: ISSUE, outcome: "pass", at: new Date(Date.now() + 1000).toISOString(), transition_id: "h2", reply_ids: ["c2"], to: "In Progress" });
    expect((await resolutionPass(q, d)).resumed).toEqual([]);
    await endValidation(q, v.run_id);
    expect((await resolutionPass(q, d)).resumed).toEqual([paused.run_id]);
    expect(resumed).toEqual([paused.run_id]);
    expect(q.serviceEvents("validate-resumed").map((e) => e.detail)).toEqual([{ run_id: v.run_id, issue: ISSUE, paused_run: paused.run_id, ok: true }]);
    await resolutionPass(q, d);
    expect(resumed).toEqual([paused.run_id]);
  });

  test("a fail line resumes nothing and records nothing", async () => {
    const q = newQueue(), root = project();
    await pausedRun(q, root);
    const { d, resumed } = deps(root);
    await resolutionPass(q, d);
    await endValidation(q, validationRuns(q)[0].run_id);
    writeLine(root, { issue: ISSUE, outcome: "fail", at: new Date(Date.now() + 1000).toISOString(), follow_up_comment_id: "10003" });
    expect((await resolutionPass(q, d)).resumed).toEqual([]);
    expect(resumed).toEqual([]);
    expect(q.serviceEvents("validate-resumed")).toEqual([]);
  });

  test("a pass line older than the run (an earlier cycle) resumes nothing", async () => {
    const q = newQueue(), root = project();
    await pausedRun(q, root);
    writeLine(root, { issue: ISSUE, outcome: "pass", at: "2026-01-01T00:00:00+00:00" });
    const { d, resumed } = deps(root);
    await resolutionPass(q, d);
    await endValidation(q, validationRuns(q)[0].run_id);
    await resolutionPass(q, d);
    expect(resumed).toEqual([]);
  });

  test("an older cycle's fail-ended run never resumes on a later cycle's pass line while that cycle's run is live", async () => {
    const q = newQueue(), root = project();
    const { run: paused } = await pausedRun(q, root);
    const { d, resumed } = deps(root);
    await resolutionPass(q, d);
    const [r1] = validationRuns(q);
    await endValidation(q, r1.run_id);
    writeLine(root, { issue: ISSUE, outcome: "fail", at: new Date(Date.now() + 1000).toISOString(), follow_up_comment_id: "10002" });
    // the fail's new block comment, then the owner's reply: a new cycle, R2
    writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), JSON.stringify({ items: [item("resolved", "10002")] }));
    expect((await resolutionPass(q, d)).queued.length).toBe(1);
    const r2 = validationRuns(q).find((r) => r.run_id !== r1.run_id)!;
    expect((await q.claim(r2.run_id, me)).claimed).toBe(true); // running
    writeLine(root, { issue: ISSUE, outcome: "pass", at: new Date(Date.now() + 2000).toISOString(), transition_id: "h2", reply_ids: ["c3"], to: "In Progress" });
    expect((await resolutionPass(q, d)).resumed).toEqual([]);
    expect(resumed).toEqual([]);
    expect(q.serviceEvents("validate-resumed")).toEqual([]);
    q.end(r2.run_id, "complete");
    expect((await resolutionPass(q, d)).resumed).toEqual([paused.run_id]);
    expect(q.serviceEvents("validate-resumed").map((e) => e.detail)).toEqual([{ run_id: r2.run_id, issue: ISSUE, paused_run: paused.run_id, ok: true }]);
  });

  test("a pass line for a paused run that is no longer paused records RunNotPaused and resumes nothing", async () => {
    const q = newQueue(), root = project();
    const { run: paused } = await pausedRun(q, root);
    const { d, resumed } = deps(root);
    await resolutionPass(q, d);
    const [v] = validationRuns(q);
    await endValidation(q, v.run_id);
    writeLine(root, { issue: ISSUE, outcome: "pass", at: new Date(Date.now() + 1000).toISOString() });
    q.end(paused.run_id, "cancelled");
    expect(await resolutionPass(q, d)).toEqual({ queued: [], resumed: [] });
    expect(resumed).toEqual([]);
    const events = q.serviceEvents("validate-resumed");
    expect(events.length).toBe(1);
    expect(events[0].detail).toMatchObject({ run_id: v.run_id, issue: ISSUE, paused_run: paused.run_id, ok: false, refusal: "RunNotPaused" });
    await resolutionPass(q, d);
    expect(q.serviceEvents("validate-resumed").length).toBe(1);
  });

  test("a refused resume is recorded, never thrown", async () => {
    const q = newQueue(), root = project();
    const { run: paused } = await pausedRun(q, root);
    const { d } = deps(root, { resume: async () => { throw new ResumeRefused("StoryLanded", "story landed"); } });
    await resolutionPass(q, d);
    const [v] = validationRuns(q);
    await endValidation(q, v.run_id);
    writeLine(root, { issue: ISSUE, outcome: "pass", at: new Date(Date.now() + 1000).toISOString() });
    expect(await resolutionPass(q, d)).toEqual({ queued: [], resumed: [] });
    const [ev] = q.serviceEvents("validate-resumed");
    expect(ev.detail).toMatchObject({ run_id: v.run_id, issue: ISSUE, paused_run: paused.run_id, ok: false, refusal: "StoryLanded" });
    expect(String(ev.detail?.reason)).toContain("story landed");
    // recorded once: the next pass does not try again
    await resolutionPass(q, d);
    expect(q.serviceEvents("validate-resumed").length).toBe(1);
  });

  test("a transient ResumeFailed is retried on the next pass and resumes once it succeeds", async () => {
    const q = newQueue(), root = project();
    const { run: paused } = await pausedRun(q, root);
    let failing = true;
    const resumed: string[] = [];
    const { d } = deps(root, { resume: async (_q, id) => {
      if (failing) throw new ResumeRefused("ResumeFailed", "resolve spawn failed");
      resumed.push(id); return { ok: true };
    } });
    await resolutionPass(q, d);
    const [v] = validationRuns(q);
    await endValidation(q, v.run_id);
    writeLine(root, { issue: ISSUE, outcome: "pass", at: new Date(Date.now() + 1000).toISOString() });
    expect((await resolutionPass(q, d)).resumed).toEqual([]);
    failing = false;
    expect((await resolutionPass(q, d)).resumed).toEqual([paused.run_id]);
    await resolutionPass(q, d);
    expect(resumed).toEqual([paused.run_id]);
    expect(q.serviceEvents("validate-resumed").map((e) => [e.detail?.ok, e.detail?.refusal ?? null])).toEqual([[false, "ResumeFailed"], [true, null]]);
  });

  test("a permanent ResumeFailed is attempted MAX_RESUME_ATTEMPTS (3) times; a non-transient refusal once", async () => {
    for (const code of ["ResumeFailed", "StoryLanded"] as const) {
      const q = newQueue(), root = project();
      await pausedRun(q, root);
      let calls = 0;
      const { d } = deps(root, { resume: async () => { calls++; throw new ResumeRefused(code, "refused"); } });
      await resolutionPass(q, d);
      await endValidation(q, validationRuns(q)[0].run_id);
      writeLine(root, { issue: ISSUE, outcome: "pass", at: new Date(Date.now() + 1000).toISOString() });
      for (let n = 0; n < 4; n++) await resolutionPass(q, d);
      const want = code === "ResumeFailed" ? MAX_RESUME_ATTEMPTS : 1;
      expect(MAX_RESUME_ATTEMPTS).toBe(3);
      expect(calls).toBe(want);
      expect(q.serviceEvents("validate-resumed").length).toBe(want);
      expect(q.serviceEvents("validate-resumed").every((e) => e.detail?.ok === false && e.detail?.refusal === code)).toBe(true);
    }
  });
});

describe("Story 31.7: helpers", () => {
  test("the enqueued payload overlays a validate-resolution invoke-skill directive only", () => {
    const woke = { state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-track", payload: { verb: "validate" }, then: "x" } };
    const defn = { target: { skill: "tk-studio-track", payload: { verb: "validate", project_root: "/p", issues: [{ issue: ISSUE }] } } };
    expect(withQueuedPayload(VALIDATE_RESOLUTION_JOB, woke, defn).directive).toEqual({
      kind: "invoke-skill", skill: "tk-studio-track", then: "x", payload: { verb: "validate", project_root: "/p", issues: [{ issue: ISSUE }] },
    });
    expect(withQueuedPayload("studio-health", woke, defn)).toBe(woke);
    expect(withQueuedPayload(VALIDATE_RESOLUTION_JOB, woke, null)).toBe(woke);
  });

  test("the stored payload overlays a validate-resolution definition only (runJob's minted and adopted runs)", () => {
    const defn = { id: VALIDATE_RESOLUTION_JOB, target: { skill: "tk-studio-track", payload: { verb: "validate" } } };
    const stored = { target: { skill: "tk-studio-track", payload: { verb: "validate", project_root: "/p", issues: [{ issue: ISSUE }] } } };
    expect(withStoredPayload(VALIDATE_RESOLUTION_JOB, defn, stored)).toEqual({ ...defn, target: stored.target });
    expect(withStoredPayload("studio-health", defn, stored)).toBe(defn);
    expect(withStoredPayload(VALIDATE_RESOLUTION_JOB, defn, null)).toBe(defn);
  });

  test("the planner leg is read from the first root holding routing.current.json", () => {
    const a = mkdtempSync(join(tmpdir(), "tk-sup-res-a-")), b = mkdtempSync(join(tmpdir(), "tk-sup-res-b-"));
    mkdirSync(join(b, ".bmad-loop"));
    writeFileSync(join(b, ".bmad-loop", "routing.current.json"), JSON.stringify({ planner: { model: "m", effort: "e" } }));
    expect(plannerLeg(null, a, b)).toEqual({ model: "m", effort: "e" });
    expect(plannerLeg(a)).toEqual({});
  });

  test("the key is (project, issue, reason id else blocked_since)", () => {
    expect(resolutionKey("p", { issue: ISSUE, reason_comment: { id: 42 }, blocked_since: "t" })).toBe(`p|${ISSUE}|42`);
    expect(resolutionKey("p", { issue: ISSUE, reason_comment: null, blocked_since: "t" })).toBe(`p|${ISSUE}|t`);
    expect(resolutionKey("p", { issue: ISSUE })).toBeNull();
  });
});
