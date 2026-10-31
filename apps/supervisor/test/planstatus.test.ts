// Story 27.5 (AC1): the plan follows the run — the review pass when a run's PR opens, the merge pass when it
// merges — pinned against a real throwaway repository (the run branch carrying the specs the run marked done), the
// fake planning adapter under a temp TK_STUDIO_ROOT (`fakePlansync`) and the fake `gh` (`pr view`).
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { atBranch, mergePass, PLAN_RETRY_LIMIT, planEntity, planOwner, registryRoot, reviewPass, specKey, stagePass, storyNumber, supervisorRows, type PlanStatusDeps } from "../src/planstatus";
import { openConflicts, Queue, type QueueEvent } from "../src/queue";
import { runProcess, runUv, type RunResult } from "../src/server";
import { runBranch } from "../src/worktree";
import { fakeGh, fakePlansync, gitRepo, testGit } from "./fakes";
import { tempDir } from "./tmp";

const me = { pid: process.pid, host: hostname(), nonce: "planstatus-test" };
const PR = "https://github.com/acme/widget/pull/42";

const spec = (status: string) => `---\ntitle: 'a story'\nstatus: '${status}'\n---\n\nbody\n`;
const entity = (id: string, story: string) => `---\nid: ${id}\ntype: story\nstatus: draft\nsource: "epics.md#story-${story}"\n---\n`;

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

/** A real repo (`main` holding `base` files, a spec already done there), a terminal queue run with a worktree
 * recorded, its run branch carrying `branch` files, a plan directory at `plan` (the own project's, by default). */
async function fixture(opts: { base?: Record<string, string>; branch?: Record<string, string>; plan?: Record<string, string> | null; ended?: Record<string, unknown>; registry?: Record<string, string>; alive?: string[] } = {}) {
  const repo = gitRepo({ "_bmad-output/specs/spec-epic-27/stories/27-1-done-before-spec.md": spec("done"), ...opts.base });
  const gh = fakeGh();
  const plansync = fakePlansync();
  const queue = new Queue(":memory:", { ownerAlive: (o) => o.nonce === me.nonce || (opts.alive ?? []).includes(o.nonce), engineLive: async () => ({ live: false, run_ids: [] }) });
  const queued = queue.enqueue({ jobId: "j", root: repo.checkout, projectId: "proj", definition: { id: "j", target: { skill: "tk-studio-launch" } }, owner: me, base_ref: "main" }).run;
  const claim = await queue.claim(queued.run_id, me);
  if (!claim.claimed) throw new Error("not claimed");
  const runId = queued.run_id;
  queue.recordWorktree(runId, join(tempDir("tk-sup-ps-wt-"), "gone"), { branch: runBranch(runId), base_ref: "main" });
  // The run branch, cut from main, with the run's work committed on it (the worktree itself is gone, as after a close-out).
  testGit(repo.checkout, "checkout", "-q", "-b", runBranch(runId));
  write(repo.checkout, opts.branch ?? { "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done") });
  testGit(repo.checkout, "add", "-A");
  testGit(repo.checkout, "commit", "-q", "--allow-empty", "-m", "the run's work");
  testGit(repo.checkout, "checkout", "-q", "main");
  if (opts.plan !== null) write(repo.checkout, opts.plan ?? { "_bmad-output/planning-artifacts/plan/ST-097.md": entity("ST-097", "27.5"), "_bmad-output/planning-artifacts/plan/ST-093.md": entity("ST-093", "27.1") });
  queue.end(runId, "complete", null, { detail: opts.ended ?? { pr: PR } });
  const deps: PlanStatusDeps = {
    env: { ...process.env, TK_STUDIO_ROOT: plansync.root, GH_BIN: gh.bin },
    registry: async (id) => opts.registry?.[id],
  };
  const plan = (q: Queue = queue): QueueEvent[] => q.events(runId).filter((e) => e.kind === "plan-status");
  return { repo, gh, plansync, queue, runId, deps, plan };
}

describe("the pieces", () => {
  test("spec paths findSpec resolves, as their story key; N.M from the key (a remediation maps to its story)", () => {
    expect(specKey("_bmad-output/implementation-artifacts/spec-27-5-x.md")).toBe("27-5-x");
    expect(specKey("_bmad-output/specs/spec-epic-27/stories/27-5-x-spec.md")).toBe("27-5-x-spec");
    expect(specKey("_bmad-output/specs/spec-epic-27/plans/27-5.md")).toBeUndefined();
    expect(specKey("src/queue.ts")).toBeUndefined();
    expect(storyNumber("27-5-the-plan-r2")).toBe("27.5");
    expect(storyNumber("27.5")).toBe("27.5");
    expect(storyNumber("spec-epic-27")).toBeUndefined();
  });

  test("ST lookup: one entity → its id; none → `no plan entity …`; several → `several plan entities …`", () => {
    const dir = tempDir("tk-sup-ps-plan-");
    write(dir, {
      "_bmad-output/planning-artifacts/plan/ST-097.md": entity("ST-097", "27.5"),
      "_bmad-output/planning-artifacts/plan/ST-010.md": entity("ST-010", "9.9"), "_bmad-output/planning-artifacts/plan/ST-011.md": entity("ST-011", "9.9"),
    });
    expect(planEntity(dir, "27.5")).toEqual({ id: "ST-097" });
    expect(planEntity(dir, "27.6")).toEqual({ reason: "no plan entity for story 27.6" });
    expect(planEntity(dir, "9.9")).toEqual({ reason: "several plan entities for story 9.9" });
  });
});

describe("owner resolution", () => {
  test("own project: no transcribed epics.md on the run branch → the run's own project at its root", async () => {
    const fx = await fixture();
    expect(await planOwner(fx.queue.get(fx.runId)!, fx.deps)).toEqual({ ok: true, owner: "proj", directory: fx.repo.checkout });
  });

  test("transcribed: epics.md `status: transcribed`, `source: \"<org>/<repo> …\"` → the registry entry keyed <repo>", async () => {
    const owner = tempDir("tk-sup-ps-owner-");
    write(owner, { "_bmad-output/planning-artifacts/plan/ST-097.md": entity("ST-097", "27.5") });
    const fx = await fixture({
      plan: null, registry: { "tk-studio": owner },
      branch: {
        "_bmad-output/planning-artifacts/epics.md": "---\nstatus: transcribed\nsource: \"thkennedy/tk-studio _bmad-output/planning-artifacts/epics.md (EP-027)\"\n---\n",
        "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done"),
      },
    });
    expect(await planOwner(fx.queue.get(fx.runId)!, fx.deps)).toEqual({ ok: true, owner: "tk-studio", directory: owner });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plansync.calls()).toEqual([["status", "--directory", owner, "--id", "ST-097", "--status", "review", "--note", `run ${fx.runId} PR ${PR}`, "--caller", "tk-studio-supervisor"]]);
  }, 60_000);

  test("unregistered owner: one skipped event per phase naming it, nothing called", async () => {
    const fx = await fixture({
      plan: null,
      branch: {
        "_bmad-output/planning-artifacts/epics.md": "---\nstatus: transcribed\nsource: \"thkennedy/tk-studio _bmad-output/planning-artifacts/epics.md\"\n---\n",
        "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done"),
      },
    });
    await reviewPass(fx.queue, fx.deps);
    await reviewPass(fx.queue, fx.deps);
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    await mergePass(fx.queue, fx.deps);
    expect(fx.plansync.calls()).toEqual([]);
    expect(fx.plan().map((e) => e.detail)).toEqual([
      { phase: "review", pr: PR, owner: "tk-studio", ok: false, skipped: true, reason: "owner tk-studio not in the registry" },
      { phase: "done", pr: PR, stage: true, owner: "tk-studio", ok: false, skipped: true, reason: "owner tk-studio not in the registry" },
    ]);
  }, 60_000);

  test("an owner with no plan directory: skipped, nothing called", async () => {
    const fx = await fixture({ plan: null });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plansync.calls()).toEqual([]);
    expect(fx.plan().map((e) => e.detail)).toEqual([
      { phase: "review", pr: PR, owner: "proj", ok: false, skipped: true, reason: "owner proj has no plan directory (_bmad-output/planning-artifacts/plan)" },
    ]);
  }, 60_000);
});

describe("the review pass (PR open) and the merge pass (PR merged)", () => {
  test("review on PR open: one call per story the run marked done (never the base's, never a spec not done, a remediation deduped); no repeat across ticks", async () => {
    const fx = await fixture({
      branch: {
        "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done"),
        "_bmad-output/implementation-artifacts/spec-27-5-the-plan-follows-the-run-r2.md": spec("done"),
        "_bmad-output/specs/spec-epic-27/stories/27-6-not-yet-spec.md": spec("in-progress"),
        "src/thing.ts": "export {};\n",
      },
    });
    const before = fx.queue.get(fx.runId)!;
    await reviewPass(fx.queue, fx.deps);
    await reviewPass(fx.queue, fx.deps); // the next tick: nothing again
    expect(fx.plansync.calls()).toEqual([["status", "--directory", fx.repo.checkout, "--id", "ST-097", "--status", "review", "--note", `run ${fx.runId} PR ${PR}`, "--caller", "tk-studio-supervisor"]]);
    const events = fx.plan();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from_state: "complete", to_state: "complete" });
    expect(events[0]!.detail).toEqual({
      phase: "review", pr: PR, owner: "proj", directory: fx.repo.checkout, story_key: "27-5-the-plan-follows-the-run-r2", id: "ST-097", ok: true, previous_status: "draft",
    });
    expect(fx.queue.get(fx.runId)).toEqual(before); // the run's state never changes
  }, 60_000);

  test("done on merge: OPEN → nothing; MERGED → the done call for each story resolved at review; no repeat", async () => {
    const fx = await fixture();
    await reviewPass(fx.queue, fx.deps);
    await mergePass(fx.queue, fx.deps); // OPEN (the fake's default)
    expect(fx.plan().map((e) => e.detail!.phase)).toEqual(["review"]);
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    await mergePass(fx.queue, fx.deps);
    // Story 35.8: the stage pass's `stage --append` call rides the merge; only the status calls here.
    expect(fx.plansync.calls().filter((a) => a[0] === "status").map((a) => a[a.indexOf("--status") + 1])).toEqual(["review", "done"]);
    expect(fx.plan().at(-1)!.detail).toEqual({
      phase: "done", pr: PR, stage: true, owner: "proj", directory: fx.repo.checkout, story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", ok: true, previous_status: "draft",
    });
    expect(fx.gh.calls().filter((c) => c.argv[0] === "pr" && c.argv[1] === "view").map((c) => c.argv)).toEqual([
      ["pr", "view", PR, "--json", "state,mergedAt"], ["pr", "view", PR, "--json", "state,mergedAt"],
    ]);
  }, 60_000);

  test("closed unmerged: one done event `pr closed unmerged`, no done call, never asked again", async () => {
    const fx = await fixture();
    await reviewPass(fx.queue, fx.deps);
    fx.gh.answer({ view: "CLOSED" });
    await mergePass(fx.queue, fx.deps);
    await mergePass(fx.queue, fx.deps);
    expect(fx.plansync.calls().map((a) => a[a.indexOf("--status") + 1])).toEqual(["review"]);
    expect(fx.plan().at(-1)!.detail).toEqual({ phase: "done", pr: PR, stage: true, ok: false, skipped: true, reason: "pr closed unmerged" });
    expect(fx.gh.calls().filter((c) => c.argv[1] === "view")).toHaveLength(1);
  }, 60_000);

  test("a refusal (exit 2 {ok:false,error}) or a blocked re-sync is recorded ok:false; the run's state never changes; never retried for that phase", async () => {
    const fx = await fixture();
    fx.plansync.answer("refuse");
    const before = fx.queue.get(fx.runId)!;
    await reviewPass(fx.queue, fx.deps);
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plansync.calls()).toHaveLength(1);
    expect(fx.plan()[0]!.detail).toMatchObject({ phase: "review", id: "ST-097", ok: false, error: "unknown status entity ST-097" });
    expect(fx.queue.get(fx.runId)).toEqual(before);
    fx.plansync.answer("blocked");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(fx.plan().at(-1)!.detail).toMatchObject({ phase: "done", id: "ST-097", ok: false, blocked: true, reason: "backend re-sync blocked" });
    expect(fx.queue.get(fx.runId)).toEqual(before);
  }, 60_000);

  test("ST lookup through the pass: none → `no plan entity for story N.M`, nothing called", async () => {
    const fx = await fixture({ plan: { "_bmad-output/planning-artifacts/plan/ST-093.md": entity("ST-093", "27.1") } });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plansync.calls()).toEqual([]);
    expect(fx.plan()[0]!.detail).toMatchObject({ phase: "review", story_key: "27-5-the-plan-follows-the-run-spec", ok: false, skipped: true, reason: "no plan entity for story 27.5" });
  }, 60_000);

  test("late PR: no PR on `ended` (close-out skipped), the PR on the latest `closed_out` → the review keyed on it", async () => {
    const late = "https://github.com/acme/widget/pull/43";
    const fx = await fixture({ ended: { closeout: { result: "skipped", why: "its driver is live", worktree: "kept" } } });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toEqual([]); // no PR yet: nothing
    fx.queue.note(fx.runId, "closed_out", { pr: late, closeout: { result: "PR", commits: [], worktree: "removed" } });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plansync.calls()).toEqual([["status", "--directory", fx.repo.checkout, "--id", "ST-097", "--status", "review", "--note", `run ${fx.runId} PR ${late}`, "--caller", "tk-studio-supervisor"]]);
    expect(fx.plan()[0]!.detail).toMatchObject({ phase: "review", pr: late, ok: true });
  }, 60_000);

  test("an external run (started outside the queue) is never pulled back — even one carrying a worktree, a PR and a run branch", async () => {
    const fx = await fixture();
    const ext = fx.queue.recordExternal("j", fx.repo.checkout, "j-20261016T101010Z", "running")!;
    // Everything the review pass keys on but the external guard: a worktree, a PR, a run branch with a done spec.
    fx.queue.db.run("UPDATE runs SET worktree = ?, base_ref = 'main' WHERE run_id = ?", [join(tmpdir(), "tk-sup-ps-ext-gone"), ext.run_id]);
    testGit(fx.repo.checkout, "branch", runBranch(ext.run_id), runBranch(fx.runId));
    fx.queue.endExternal(ext.run_id, "complete");
    fx.queue.note(ext.run_id, "closed_out", { pr: PR, closeout: { result: "PR", commits: [], worktree: "removed" } });
    await reviewPass(fx.queue, fx.deps);
    expectOnlyExternalEvents(fx.queue, ext.run_id);
    // The fixture's own (queue) run is pulled back: the pass ran.
    expect(fx.plansync.calls()).toHaveLength(1);
  }, 60_000);
});

describe("Story 27.5 review patches: the lease, transient failures", () => {
  test("two overlapping passes on one run call plansync once per story per phase (the plan lease)", async () => {
    const fx = await fixture();
    await Promise.all([reviewPass(fx.queue, fx.deps), reviewPass(fx.queue, fx.deps)]);
    // Another process's pass, while this one's lease is live, is refused too.
    expect(fx.queue.claimPlanPhase(fx.runId, "review", { pid: 1, host: hostname(), nonce: "other-process" })).toBe(false);
    fx.gh.answer({ view: "MERGED" });
    await Promise.all([mergePass(fx.queue, fx.deps), mergePass(fx.queue, fx.deps)]);
    expect(fx.plansync.calls().filter((a) => a[0] === "status").map((a) => a[a.indexOf("--status") + 1])).toEqual(["review", "done"]);
    expect(fx.plan().map((e) => e.detail!.phase)).toEqual(["review", "done"]);
    // One claim per phase, each let go settled once recorded (never counted as a retry); Story 35.8's stage lease aside.
    expect(fx.queue.events(fx.runId).filter((e) => e.kind === "plan-lease" && e.detail!.phase !== "stage").map((e) => [e.detail!.phase, e.detail!.owner === null ? "settled" : "claimed", e.detail!.settled ?? null]))
      .toEqual([["review", "claimed", null], ["review", "settled", true], ["done", "claimed", null], ["done", "settled", true]]);
  }, 60_000);

  test("registry: a failed lookup records nothing (asked again next tick, the lease let go); a missing entry is the skip", async () => {
    const owner = tempDir("tk-sup-ps-owner-");
    write(owner, { "_bmad-output/planning-artifacts/plan/ST-097.md": entity("ST-097", "27.5") });
    let answer: "fail" | "absent" | "ok" = "fail";
    const fx = await fixture({
      plan: null,
      branch: {
        "_bmad-output/planning-artifacts/epics.md": "---\nstatus: transcribed\nsource: \"thkennedy/tk-studio x\"\n---\n",
        "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done"),
      },
    });
    fx.deps.registry = async () => { if (answer === "fail") throw new Error("registry show emitted no JSON (exit 1): timed out"); return answer === "ok" ? owner : undefined; };
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toEqual([]);
    expect(fx.queue.events(fx.runId).filter((e) => e.kind === "plan-lease").map((e) => e.detail!.owner)).toEqual([expect.anything(), null]);
    answer = "absent";
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan().map((e) => e.detail!.reason)).toEqual(["owner tk-studio not in the registry"]);
    // `registryRoot`: the registry's own "not registered" answer is absent; any other failure is thrown.
    expect(await registryRoot("x", async () => { throw new Error("registry: project 'x' is not registered (known: a)"); })).toBeUndefined();
    await expect(registryRoot("x", async () => { throw new Error("registry show emitted no JSON (exit 1): boom"); })).rejects.toThrow("no JSON");
    await expect(registryRoot("x", async () => { throw new Error("registry: registry file unreadable"); })).rejects.toThrow("unreadable");
    expect(await registryRoot("x", async () => ({ ok: true, entry: { root: owner } }))).toBe(owner);
  }, 60_000);

  test("epics.md at the run branch: a read that fails for any reason but \"does not exist\" records nothing this tick", async () => {
    const fx = await fixture();
    const real = fx.deps.run;
    let broken = true;
    fx.deps.run = async (bin, args, o) => broken && bin === "git" && args[0] === "show" && String(args[1]).endsWith(":_bmad-output/planning-artifacts/epics.md")
      ? { exit: 128, stdout: "", stderr: "fatal: unable to read tree 0123abcd" }
      : (real ?? ((b, a, oo) => runProcess(b, a, { cwd: oo.cwd, timeoutS: oo.timeoutS })))(bin, args, o);
    expect(await atBranch(fx.queue.get(fx.runId)!, "_bmad-output/planning-artifacts/epics.md", fx.deps)).toMatchObject({ error: expect.stringContaining("unable to read tree") });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toEqual([]);
    expect(fx.plansync.calls()).toEqual([]);
    broken = false;
    // Absent at the ref: the own project, as before.
    expect(await atBranch(fx.queue.get(fx.runId)!, "_bmad-output/planning-artifacts/epics.md", fx.deps)).toEqual({ absent: true });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan().map((e) => e.detail!.ok)).toEqual([true]);
  }, 60_000);
});

describe("Story 27.5 follow-up patches: bounded retries, the base's done specs", () => {
  const leases = (fx: Awaited<ReturnType<typeof fixture>>) => fx.queue.events(fx.runId).filter((e) => e.kind === "plan-lease");

  test("a deleted run branch (`invalid object name`) gives up after PLAN_RETRY_LIMIT retries: one skipped review event, no further leases", async () => {
    const fx = await fixture();
    testGit(fx.repo.checkout, "branch", "-D", runBranch(fx.runId));
    expect(await atBranch(fx.queue.get(fx.runId)!, "_bmad-output/planning-artifacts/epics.md", fx.deps)).toMatchObject({ error: expect.stringContaining("invalid object name") });
    for (let i = 0; i < PLAN_RETRY_LIMIT; i++) await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toEqual([]); // each retry so far: claimed and released, nothing recorded
    expect(leases(fx).filter((e) => e.detail!.owner === null)).toHaveLength(PLAN_RETRY_LIMIT);
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toHaveLength(1);
    expect(fx.plan()[0]!.detail).toMatchObject({ phase: "review", pr: PR, ok: false, skipped: true });
    expect(String(fx.plan()[0]!.detail!.reason)).toMatch(new RegExp(`^gave up after ${PLAN_RETRY_LIMIT + 1} attempts: epics\\.md at the run branch: .*invalid object name`));
    const settled = leases(fx).length;
    await reviewPass(fx.queue, fx.deps);
    await reviewPass(fx.queue, fx.deps);
    expect(leases(fx)).toHaveLength(settled); // the event stream stops growing
    expect(fx.plan()).toHaveLength(1);
    expect(fx.plansync.calls()).toEqual([]);
  }, 120_000);

  test("a transient `git diff` failure is retried on the next tick, never a permanent skip", async () => {
    const fx = await fixture();
    const real = fx.deps.run;
    let broken = true;
    fx.deps.run = async (bin, args, o) => broken && bin === "git" && args[0] === "diff"
      ? { exit: 128, stdout: "", stderr: "fatal: unable to read tree 0123abcd" }
      : (real ?? ((b, a, oo) => runProcess(b, a, { cwd: oo.cwd, timeoutS: oo.timeoutS })))(bin, args, o);
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toEqual([]);
    expect(leases(fx).map((e) => e.detail!.owner)).toEqual([expect.anything(), null]);
    broken = false;
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan().map((e) => e.detail)).toEqual([expect.objectContaining({ phase: "review", story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", ok: true })]);
  }, 60_000);

  test("a spec already done at the merge-base, merely edited by the run, is not reviewed; one new or not done at the base still is", async () => {
    const fx = await fixture({
      base: { "_bmad-output/specs/spec-epic-27/stories/27-6-in-progress-spec.md": spec("in-progress") },
      plan: {
        "_bmad-output/planning-artifacts/plan/ST-093.md": entity("ST-093", "27.1"), "_bmad-output/planning-artifacts/plan/ST-097.md": entity("ST-097", "27.5"),
        "_bmad-output/planning-artifacts/plan/ST-098.md": entity("ST-098", "27.6"),
      },
      branch: {
        "_bmad-output/specs/spec-epic-27/stories/27-1-done-before-spec.md": `${spec("done")}\nan edit by a later run\n`,
        "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done"),
        "_bmad-output/specs/spec-epic-27/stories/27-6-in-progress-spec.md": spec("done"),
      },
    });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plansync.calls().map((a) => a[a.indexOf("--id") + 1]).sort()).toEqual(["ST-097", "ST-098"]);
    expect(fx.plan().map((e) => e.detail!.story_key)).not.toContain("27-1-done-before-spec");
  }, 60_000);

  test("the run's PR already merged into base_ref (its tip now reads `done`) before the review pass → the story is still reviewed (read at the merge-base)", async () => {
    const fx = await fixture();
    // A squash merge of the run's PR onto main: main's tip now carries the spec `done`; the merge-base stays the fork point.
    write(fx.repo.checkout, { "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done") });
    testGit(fx.repo.checkout, "add", "-A");
    testGit(fx.repo.checkout, "commit", "-q", "-m", "the run's PR, squash-merged");
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plansync.calls()).toEqual([["status", "--directory", fx.repo.checkout, "--id", "ST-097", "--status", "review", "--note", `run ${fx.runId} PR ${PR}`, "--caller", "tk-studio-supervisor"]]);
    expect(fx.plan().map((e) => e.detail)).toEqual([expect.objectContaining({ phase: "review", story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", ok: true })]);
  }, 60_000);
});

describe("Story 27.5 second follow-up: done waits for the review, transient verb failures retry", () => {
  const leases = (fx: Awaited<ReturnType<typeof fixture>>, phase: string) => fx.queue.events(fx.runId).filter((e) => e.kind === "plan-lease" && e.detail!.phase === phase);
  const statuses = (fx: Awaited<ReturnType<typeof fixture>>, status: string) =>
    fx.plansync.calls().filter((a) => a[a.indexOf("--status") + 1] === status).map((a) => a[a.indexOf("--id") + 1]);
  const twoStories = {
    branch: {
      "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done"),
      "_bmad-output/specs/spec-epic-27/stories/27-6-the-next-story-spec.md": spec("done"),
    },
    plan: { "_bmad-output/planning-artifacts/plan/ST-097.md": entity("ST-097", "27.5"), "_bmad-output/planning-artifacts/plan/ST-098.md": entity("ST-098", "27.6") },
  };

  test("a review still in progress under another live owner (one story recorded of two): the merge pass records and calls nothing; once it settles, done for every reviewed story", async () => {
    const other = { pid: 1, host: hostname(), nonce: "other-live-process" };
    const fx = await fixture({ ...twoStories, alive: [other.nonce] });
    // Process `other` is inside its review pass: it holds the review lease and has recorded 27.5, still calling for 27.6.
    expect(fx.queue.claimPlanPhase(fx.runId, "review", other)).toBe(true);
    const at = { phase: "review", pr: PR, owner: "proj", directory: fx.repo.checkout };
    fx.queue.note(fx.runId, "plan-status", { ...at, story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", ok: true, previous_status: "draft" });
    fx.gh.answer({ view: "MERGED" });
    expect(await mergePass(fx.queue, fx.deps)).toEqual([]);
    expect(fx.plansync.calls()).toEqual([]);
    expect(fx.plan().map((e) => e.detail!.phase)).toEqual(["review"]);
    expect(leases(fx, "done")).toEqual([]); // the done lease was never taken
    expect(fx.queue.claimPlanPhase(fx.runId, "done", me)).toBe(false);
    // `other` records 27.6 and lets its lease go settled: the review phase is no longer in progress.
    fx.queue.note(fx.runId, "plan-status", { ...at, story_key: "27-6-the-next-story-spec", id: "ST-098", ok: true, previous_status: "draft" });
    fx.queue.releasePlanPhase(fx.runId, "review", other, true);
    expect(await mergePass(fx.queue, fx.deps)).toEqual([fx.runId]);
    expect(statuses(fx, "done")).toEqual(["ST-097", "ST-098"]);
    expect(fx.plan().filter((e) => e.detail!.phase === "done").map((e) => [e.detail!.story_key, e.detail!.ok]))
      .toEqual([["27-5-the-plan-follows-the-run-spec", true], ["27-6-the-next-story-spec", true]]);
  }, 60_000);

  test("plansync exits non-zero with no JSON (a traceback): nothing recorded, the lease let go, the next pass calls again — for review and for done; a refusal stays final", async () => {
    const fx = await fixture();
    fx.plansync.answer("crash");
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toEqual([]);
    expect(leases(fx, "review").map((e) => [e.detail!.owner === null, e.detail!.settled ?? null])).toEqual([[false, null], [true, null]]);
    fx.plansync.answer("ok");
    await reviewPass(fx.queue, fx.deps);
    expect(statuses(fx, "review")).toEqual(["ST-097", "ST-097"]);
    expect(fx.plan().map((e) => e.detail)).toEqual([expect.objectContaining({ phase: "review", id: "ST-097", ok: true })]);
    fx.gh.answer({ view: "MERGED" });
    fx.plansync.answer("crash");
    await mergePass(fx.queue, fx.deps);
    expect(fx.plan().map((e) => e.detail!.phase)).toEqual(["review"]);
    expect(leases(fx, "done").at(-1)!.detail).toMatchObject({ owner: null });
    // A refusal is final: recorded ok:false, never asked again.
    fx.plansync.answer("refuse");
    await mergePass(fx.queue, fx.deps);
    await mergePass(fx.queue, fx.deps);
    expect(statuses(fx, "done")).toEqual(["ST-097", "ST-097"]);
    expect(fx.plan().at(-1)!.detail).toMatchObject({ phase: "done", id: "ST-097", ok: false, error: "unknown status entity ST-097" });
    expect(fx.plan().at(-1)!.detail).not.toHaveProperty("transient");
  }, 60_000);

  test("the runner throws (the 120 s timeout, a uv spawn failure): retried next pass; recorded ok:true once it answers", async () => {
    const fx = await fixture();
    let fail = true;
    fx.deps.uv = async (root, script, args, t) => {
      if (fail) throw new Error("uv timed out after 120s (process tree killed); stdout tail: ");
      return runUv(root, script, args, t);
    };
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toEqual([]);
    expect(leases(fx, "review").at(-1)!.detail).toMatchObject({ owner: null });
    fail = false;
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan().map((e) => e.detail)).toEqual([expect.objectContaining({ phase: "review", id: "ST-097", ok: true, previous_status: "draft" })]);
  }, 60_000);

  test("a transient failure after the pass recorded a story is recorded ok:false with its error (the phase is settled)", async () => {
    const fx = await fixture(twoStories);
    fx.deps.uv = async (root, script, args, t) => {
      if (args[args.indexOf("--id") + 1] === "ST-098") throw new Error("uv spawn failed: ENOENT");
      return runUv(root, script, args, t);
    };
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan().map((e) => [e.detail!.id, e.detail!.ok])).toEqual([["ST-097", true], ["ST-098", false]]);
    expect(fx.plan()[1]!.detail).toMatchObject({ error: expect.stringContaining("uv spawn failed") });
    expect(fx.plan()[1]!.detail).not.toHaveProperty("transient");
    expect(leases(fx, "review").at(-1)!.detail).toMatchObject({ owner: null, settled: true });
    await reviewPass(fx.queue, fx.deps);
    expect(fx.plan()).toHaveLength(2); // never asked again
  }, 60_000);
});

describe("Story 35.8: the stage pass — the supervisor's Stage Log rows after the merge, mirrored to Jira", () => {
  const MERGED_AT = "2026-10-16T00:00:00Z"; // the fake gh's mergedAt
  /** The run's legs: the close-out's host leg, its close-out, then a re-run (the host clock's stamps). */
  function legs(fx: Awaited<ReturnType<typeof fixture>>): void {
    fx.queue.note(fx.runId, "host-verify", { command: "bun test", green: true, duration_ms: 1000, started_at: "2026-10-15T10:00:00.000Z" });
    fx.queue.note(fx.runId, "closed_out", { pr: PR, closeout: { result: "PR", commits: [], worktree: "removed" } });
    fx.queue.note(fx.runId, "host-verify", { command: "bun test", green: false, duration_ms: 1000, started_at: "2026-10-15T11:00:00.000Z", rerun: { by: "cli" } });
  }
  const stageCalls = (fx: Awaited<ReturnType<typeof fixture>>, verb: string) => fx.plansync.calls().filter((a) => a[0] === verb);
  const stagePosts = (fx: Awaited<ReturnType<typeof fixture>>) => fx.queue.events(fx.runId).filter((e) => e.kind === "stage-post");
  const bind = (fx: Awaited<ReturnType<typeof fixture>>) => write(fx.repo.checkout, { ".tk-studio/config.yaml": "planning:\n  jira:\n    project_key: TKS\n" });
  const stageLeases = (fx: Awaited<ReturnType<typeof fixture>>) => fx.queue.events(fx.runId).filter((e) => e.kind === "plan-lease" && e.detail!.phase === "stage");
  /** The story's spec at the owner checkout (the run's work merged and pulled): the stage pass's precondition. */
  const STAGE_SPEC = "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md";
  const ownerSpec = (fx: Awaited<ReturnType<typeof fixture>>) => write(fx.repo.checkout, { [STAGE_SPEC]: spec("done") });

  test("supervisorRows: each host-verify a host-leg (close-out legs) or re-run row from started_at to the event, each close-out from the leg before it, the merge at mergedAt", () => {
    const at = (seq: number, kind: string, detail: Record<string, unknown>, when: string): QueueEvent =>
      ({ seq, run_id: "r", at: when, kind, from_state: "complete", to_state: "complete", detail });
    const rows = supervisorRows([
      at(1, "host-verify", { green: true, started_at: "2026-10-15T10:00:00.000Z" }, "2026-10-15T10:05:00.000Z"),
      at(2, "ended", { pr: PR, closeout: { result: "PR" } }, "2026-10-15T10:06:00.000Z"),
      at(3, "host-verify", { skipped: true, reason: "no verify.host", rerun: { by: "api" } }, "2026-10-15T12:00:00.000Z"),
      at(4, "plan-status", { phase: "done", ok: true }, "2026-10-16T00:01:00.000Z"),
    ], MERGED_AT);
    expect(rows).toEqual([
      { stage: "host-leg", pass: 1, started: "2026-10-15T10:00:00.000Z", ended: "2026-10-15T10:05:00.000Z", outcome: "green" },
      { stage: "close-out", pass: 1, started: "2026-10-15T10:05:00.000Z", ended: "2026-10-15T10:06:00.000Z", outcome: "PR" },
      { stage: "re-run", pass: 1, started: "2026-10-15T12:00:00.000Z", ended: "2026-10-15T12:00:00.000Z", outcome: "skipped" },
      { stage: "merge", started: MERGED_AT, ended: MERGED_AT, outcome: "merged" },
    ]);
    expect(supervisorRows([])).toEqual([]);
  });

  test("Story 36.1: supervisorRows: an inconclusive leg reads `inconclusive` on its host-leg and re-run rows, beside green and red", () => {
    const at = (seq: number, kind: string, detail: Record<string, unknown>, when: string): QueueEvent =>
      ({ seq, run_id: "r", at: when, kind, from_state: "complete", to_state: "complete", detail });
    const inconclusive = { green: false, playable: { verdict: "inconclusive", reason: "infrastructure: sbx: x" } };
    const rows = supervisorRows([
      at(1, "host-verify", { ...inconclusive, started_at: "2026-10-15T10:00:00.000Z" }, "2026-10-15T10:05:00.000Z"),
      at(2, "host-verify", { ...inconclusive, rerun: { by: "cli" } }, "2026-10-15T11:00:00.000Z"),
      at(3, "host-verify", { green: true, rerun: { by: "api" } }, "2026-10-15T12:00:00.000Z"),
      at(4, "host-verify", { green: false, rerun: { by: "api" } }, "2026-10-15T13:00:00.000Z"),
    ]);
    expect(rows.map((r) => [r.stage, r.pass, r.outcome])).toEqual([
      ["host-leg", 1, "inconclusive"], ["re-run", 1, "inconclusive"], ["re-run", 2, "green"], ["re-run", 3, "red"],
    ]);
  });

  test("supervisorRows: a busy queue's closed_out {closeout, pending} and the ended written from it are one close-out", () => {
    const at = (seq: number, kind: string, detail: Record<string, unknown>, when: string): QueueEvent =>
      ({ seq, run_id: "r", at: when, kind, from_state: "complete", to_state: "complete", detail });
    const closeout = { result: "PR", commits: ["abc"], worktree: "removed", branch: "supervisor/run-r" };
    const rows = supervisorRows([
      at(1, "host-verify", { green: true, started_at: "2026-10-15T10:00:00.000Z" }, "2026-10-15T10:05:00.000Z"),
      at(2, "closed_out", { pr: PR, closeout, pending: { phase: "ended", state: "complete" } }, "2026-10-15T10:06:00.000Z"),
      // the same record, key order aside, on the deferred end
      at(3, "ended", { pr: PR, closeout: { worktree: "removed", branch: "supervisor/run-r", commits: ["abc"], result: "PR" }, finish: {} }, "2026-10-15T10:07:00.000Z"),
      at(4, "host-verify", { green: true, started_at: "2026-10-15T11:00:00.000Z" }, "2026-10-15T11:05:00.000Z"),
      at(5, "closed_out", { pr: PR, closeout: { ...closeout, commits: ["abc", "def"] } }, "2026-10-15T11:06:00.000Z"),
    ]);
    expect(rows.filter((r) => r.stage === "close-out")).toEqual([
      { stage: "close-out", pass: 1, started: "2026-10-15T10:05:00.000Z", ended: "2026-10-15T10:06:00.000Z", outcome: "PR" },
      { stage: "close-out", pass: 2, started: "2026-10-15T11:05:00.000Z", ended: "2026-10-15T11:06:00.000Z", outcome: "PR" },
    ]);
  });

  test("supervisorRows: a paused close-out (commit, push, draft PR on the `paused` transition), then a relaunch's leg and its ended close-out, are two close-out rows", () => {
    const at = (seq: number, kind: string, detail: Record<string, unknown>, when: string): QueueEvent =>
      ({ seq, run_id: "r", at: when, kind, from_state: "running", to_state: kind === "paused" ? "paused" : "complete", detail });
    const rows = supervisorRows([
      at(1, "host-verify", { green: true, started_at: "2026-10-15T10:00:00.000Z" }, "2026-10-15T10:05:00.000Z"),
      at(2, "paused", { engine: { status: "paused" }, pr: PR, closeout: { result: "draft PR", commits: ["abc"], worktree: "kept" } }, "2026-10-15T10:06:00.000Z"),
      at(3, "host-verify", { green: true, started_at: "2026-10-15T11:00:00.000Z" }, "2026-10-15T11:05:00.000Z"),
      at(4, "ended", { pr: PR, closeout: { result: "PR", commits: ["abc", "def"], worktree: "removed" } }, "2026-10-15T11:06:00.000Z"),
    ]);
    expect(rows.filter((r) => r.stage === "close-out")).toEqual([
      { stage: "close-out", pass: 1, started: "2026-10-15T10:05:00.000Z", ended: "2026-10-15T10:06:00.000Z", outcome: "draft PR" },
      { stage: "close-out", pass: 2, started: "2026-10-15T11:05:00.000Z", ended: "2026-10-15T11:06:00.000Z", outcome: "PR" },
    ]);
  });

  test("a run pulled back to done before Story 35.8 (its done ok event carries no `stage`) is never back-filled: no lease, no gh pr view, no stage --append, no stage-post", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    bind(fx);
    // the pre-35.8 supervisor's review and done events, as it recorded them
    fx.queue.note(fx.runId, "plan-status", { phase: "review", pr: PR, owner: "proj", directory: fx.repo.checkout, story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", ok: true, previous_status: "draft" });
    fx.queue.note(fx.runId, "plan-status", { phase: "done", pr: PR, owner: "proj", directory: fx.repo.checkout, story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", ok: true, previous_status: "review" });
    fx.gh.answer({ view: "MERGED" });
    const events = fx.queue.events(fx.runId).length;
    await mergePass(fx.queue, fx.deps);
    await stagePass(fx.queue, fx.deps);
    expect(stageLeases(fx)).toEqual([]);
    expect(fx.gh.calls().filter((c) => c.argv[1] === "view")).toEqual([]);
    expect(stageCalls(fx, "stage")).toEqual([]);
    expect(stageCalls(fx, "stage-post")).toEqual([]);
    expect(fx.queue.events(fx.runId)).toHaveLength(events); // nothing recorded
  }, 60_000);

  test("merged, not bound to Jira: the rows appended to the owner root's spec once, nothing posted, the run's state untouched", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    await reviewPass(fx.queue, fx.deps);
    const before = fx.queue.get(fx.runId)!;
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    await mergePass(fx.queue, fx.deps);
    const appends = stageCalls(fx, "stage");
    expect(appends).toHaveLength(1);
    const argv = appends[0]!;
    expect(argv.slice(0, 6)).toEqual(["stage", "--append", "--directory", fx.repo.checkout, "--story", "27-5-the-plan-follows-the-run-spec"]);
    expect(JSON.parse(argv[argv.indexOf("--row-json") + 1]!).map((r: Record<string, unknown>) => [r.stage, r.pass ?? null, r.outcome])).toEqual([
      ["host-leg", 1, "green"], ["close-out", 1, "PR"], ["re-run", 1, "red"], ["merge", null, "merged"],
    ]);
    expect(stageCalls(fx, "stage-post")).toEqual([]);
    expect(stagePosts(fx).map((e) => e.detail)).toEqual([{
      story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", directory: fx.repo.checkout, appended: 4,
      posted: "skipped: not bound", ok: true, merged_at: MERGED_AT,
    }]);
    expect(fx.queue.get(fx.runId)).toEqual(before); // the run's state never changes
    // the merge pass read mergedAt once: the stage pass asked gh nothing of its own
    expect(fx.gh.calls().filter((c) => c.argv[1] === "view")).toHaveLength(1);
  }, 60_000);

  test("bound to Jira: a failed post is recorded ok:false (state untouched) and retried next pass, an identical failure not re-recorded; posted once it succeeds, then never again", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    bind(fx);
    await reviewPass(fx.queue, fx.deps);
    const before = fx.queue.get(fx.runId)!;
    fx.plansync.stage("post-fail");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage-post")).toEqual([["stage-post", "--directory", fx.repo.checkout, "--story", "27-5-the-plan-follows-the-run-spec", "--id", "ST-097"]]);
    expect(stagePosts(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ ok: false, appended: 4, detail: "stage-post failed: Jira answered 503", merged_at: MERGED_AT })]);
    expect(fx.queue.get(fx.runId)).toEqual(before);
    await mergePass(fx.queue, fx.deps); // retried: called again, the same failure not recorded twice
    expect(stageCalls(fx, "stage-post")).toHaveLength(2);
    expect(stagePosts(fx)).toHaveLength(1);
    fx.plansync.stage("ok");
    await stagePass(fx.queue, fx.deps); // the merged_at recorded on the failure: no gh call needed
    expect(stagePosts(fx).map((e) => [e.detail!.ok, e.detail!.posted])).toEqual([[false, { start: 0, stop: 0, worklog: 0, found: 0 }], [true, { start: 4, stop: 4, worklog: 4, found: 0 }]]);
    await mergePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage-post")).toHaveLength(3);
    expect(stageCalls(fx, "stage")).toHaveLength(3); // every attempt re-appends (idempotent by row key in plansync)
    expect(fx.gh.calls().filter((c) => c.argv[1] === "view")).toHaveLength(1);
    expect(fx.queue.get(fx.runId)).toEqual(before);
  }, 60_000);

  test("a refused append is settled: recorded once, never retried, no lease taken again", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    await reviewPass(fx.queue, fx.deps);
    await stagePass(fx.queue, fx.deps);
    expect(stagePosts(fx)).toEqual([]); // nothing merged yet
    fx.plansync.stage("append-fail");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(stagePosts(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ ok: false, settled: true, appended: 0, posted: "not attempted", detail: "fake stage refused" })]);
    const events = fx.queue.events(fx.runId).length;
    await mergePass(fx.queue, fx.deps);
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage")).toHaveLength(1);
    expect(fx.queue.events(fx.runId)).toHaveLength(events); // no claim, no release, nothing recorded
    expect(stageLeases(fx).at(-1)!.detail).toMatchObject({ owner: null, settled: true });
  }, 60_000);

  test("a refused stage-post (no external.jira.key) is settled once; a crashed append (no JSON) is a retry", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    bind(fx);
    await reviewPass(fx.queue, fx.deps);
    fx.plansync.stage("append-crash");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(stagePosts(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ ok: false, appended: 0, posted: "not attempted" })]);
    expect(stagePosts(fx)[0]!.detail!.settled).toBeUndefined();
    expect(stageLeases(fx).at(-1)!.detail!.settled).toBeUndefined(); // a retry: counted against the limit
    fx.plansync.stage("post-refuse");
    await stagePass(fx.queue, fx.deps);
    expect(stagePosts(fx).at(-1)!.detail).toMatchObject({ ok: false, settled: true, detail: "stage-post: ST-097 carries no external.jira.key" });
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage-post")).toHaveLength(1); // never retried
    expect(stagePosts(fx)).toHaveLength(2);
  }, 60_000);

  test("rows only buffered (the append's answer, the spec present) are a wait: recorded once, uncounted, never the give-up, the lease settled; ok once the spec holds them", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    await reviewPass(fx.queue, fx.deps);
    fx.plansync.stage("buffered");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(stagePosts(fx).map((e) => e.detail)).toEqual([expect.objectContaining({
      ok: false, appended: 4, posted: "not attempted", waiting: true,
      detail: `waiting for the owner checkout: rows buffered, no spec for 27-5-the-plan-follows-the-run-spec under ${fx.repo.checkout} yet`,
    })]);
    for (let i = 0; i <= PLAN_RETRY_LIMIT + 1; i++) await stagePass(fx.queue, fx.deps); // asked again, never given up
    expect(stageCalls(fx, "stage")).toHaveLength(PLAN_RETRY_LIMIT + 3);
    expect(stagePosts(fx)).toHaveLength(1); // the same wait not recorded twice
    expect(stagePosts(fx).some((e) => e.detail!.skipped === true || e.detail!.settled === true)).toBe(false);
    // a wait is no retry: every stage lease let go of settled, none counted
    expect(stageLeases(fx).filter((e) => e.detail!.owner === null && e.detail!.settled !== true)).toEqual([]);
    fx.plansync.stage("ok");
    await stagePass(fx.queue, fx.deps);
    expect(stagePosts(fx).at(-1)!.detail).toMatchObject({ ok: true, posted: "skipped: not bound" });
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage")).toHaveLength(PLAN_RETRY_LIMIT + 4);
  }, 120_000);

  test("no spec at the owner checkout: the story waits across more than PLAN_RETRY_LIMIT ticks — no lease, no call, no give-up; once the spec lands the next tick claims, appends, posts and settles ok", async () => {
    const fx = await fixture();
    legs(fx);
    bind(fx);
    await reviewPass(fx.queue, fx.deps);
    fx.plansync.stage("buffered");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    for (let i = 0; i <= PLAN_RETRY_LIMIT + 1; i++) await stagePass(fx.queue, fx.deps);
    expect(stageLeases(fx)).toEqual([]);
    expect(stageCalls(fx, "stage")).toEqual([]);
    expect(stagePosts(fx)).toEqual([]);
    ownerSpec(fx);
    fx.plansync.stage("ok");
    await stagePass(fx.queue, fx.deps);
    expect(stageLeases(fx).map((e) => e.detail!.owner === null ? (e.detail!.settled === true ? "settled" : "released") : "held")).toEqual(["held", "settled"]);
    expect(stageCalls(fx, "stage")).toHaveLength(1);
    expect(stageCalls(fx, "stage-post")).toHaveLength(1);
    expect(stagePosts(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ ok: true, appended: 4, merged_at: MERGED_AT })]);
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage")).toHaveLength(1); // settled: never again
  }, 120_000);

  test("supervisorRows: a close-out after a re-run spans from the re-run's end — host-leg, close-out, re-run, close-out; and host-leg, re-run, close-out", () => {
    const at = (seq: number, kind: string, detail: Record<string, unknown>, when: string): QueueEvent =>
      ({ seq, run_id: "r", at: when, kind, from_state: "complete", to_state: "complete", detail });
    const closeOuts = (rows: ReturnType<typeof supervisorRows>) => rows.filter((r) => r.stage === "close-out").map((r) => [r.started, r.ended]);
    expect(closeOuts(supervisorRows([
      at(1, "host-verify", { green: true, started_at: "2026-10-15T10:00:00.000Z" }, "2026-10-15T10:05:00.000Z"),
      at(2, "closed_out", { pr: PR, closeout: { result: "PR", n: 1 } }, "2026-10-15T10:06:00.000Z"),
      at(3, "host-verify", { green: true, started_at: "2026-10-15T11:00:00.000Z", rerun: { by: "cli" } }, "2026-10-15T11:05:00.000Z"),
      at(4, "closed_out", { pr: PR, closeout: { result: "PR", n: 2 } }, "2026-10-15T11:06:00.000Z"),
    ]))).toEqual([["2026-10-15T10:05:00.000Z", "2026-10-15T10:06:00.000Z"], ["2026-10-15T11:05:00.000Z", "2026-10-15T11:06:00.000Z"]]);
    expect(closeOuts(supervisorRows([
      at(1, "host-verify", { green: false, started_at: "2026-10-15T10:00:00.000Z" }, "2026-10-15T10:05:00.000Z"),
      at(2, "host-verify", { green: true, started_at: "2026-10-15T10:30:00.000Z", rerun: { by: "api" } }, "2026-10-15T10:40:00.000Z"),
      at(3, "ended", { pr: PR, closeout: { result: "PR" } }, "2026-10-15T10:41:00.000Z"),
    ]))).toEqual([["2026-10-15T10:40:00.000Z", "2026-10-15T10:41:00.000Z"]]);
  });

  test("bound: stage-post's unposted rows keep the story not ok and retried; ok:true only once nothing is unposted", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    bind(fx);
    await reviewPass(fx.queue, fx.deps);
    fx.plansync.stage("post-pending");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(stagePosts(fx).map((e) => e.detail)).toEqual([expect.objectContaining({ ok: false, unposted: 1, detail: "stage-post pending: 1 row(s) not yet posted" })]);
    fx.plansync.stage("ok");
    await stagePass(fx.queue, fx.deps);
    expect(stagePosts(fx).at(-1)!.detail).toMatchObject({ ok: true, unposted: 0 });
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage-post")).toHaveLength(2);
  }, 60_000);

  test("a newer host-verify (a re-run) after the story's ok:true stage-post re-enters it: the re-run row appended and posted", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    await reviewPass(fx.queue, fx.deps);
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(stagePosts(fx).map((e) => e.detail!.ok)).toEqual([true]);
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage")).toHaveLength(1);
    fx.queue.note(fx.runId, "host-verify", { command: "bun test", green: true, duration_ms: 1000, started_at: "2026-10-17T09:00:00.000Z", rerun: { by: "cli" } });
    await stagePass(fx.queue, fx.deps);
    const appends = stageCalls(fx, "stage");
    expect(appends).toHaveLength(2);
    const rows = JSON.parse(appends[1]![appends[1]!.indexOf("--row-json") + 1]!);
    expect(rows.map((r: Record<string, unknown>) => [r.stage, r.pass ?? null, r.outcome])).toEqual([
      ["host-leg", 1, "green"], ["close-out", 1, "PR"], ["re-run", 1, "red"], ["re-run", 2, "green"], ["merge", null, "merged"],
    ]);
    expect(stagePosts(fx).map((e) => [e.detail!.ok, e.detail!.merged_at])).toEqual([[true, MERGED_AT], [true, MERGED_AT]]);
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage")).toHaveLength(2);
    expect(fx.gh.calls().filter((c) => c.argv[1] === "view")).toHaveLength(1);
  }, 60_000);

  test("Jira down: retries are bounded at PLAN_RETRY_LIMIT, one settled give-up recorded, then no lease is claimed again", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    bind(fx);
    await reviewPass(fx.queue, fx.deps);
    fx.plansync.stage("post-fail");
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps);
    expect(stageLeases(fx).filter((e) => e.detail!.owner === null && e.detail!.settled !== true)).toHaveLength(1);
    // the earlier attempts, as other passes left them
    for (let i = 1; i < PLAN_RETRY_LIMIT; i++) {
      expect(fx.queue.claimPlanPhase(fx.runId, "stage", me)).toBe(true);
      fx.queue.releasePlanPhase(fx.runId, "stage", me);
    }
    await stagePass(fx.queue, fx.deps);
    const posts = stagePosts(fx);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.detail).toMatchObject({ ok: false, settled: true, skipped: true });
    expect(String(posts[1]!.detail!.reason)).toBe(`gave up after ${PLAN_RETRY_LIMIT + 1} attempts: stage-post failed: Jira answered 503`);
    expect(stageLeases(fx).at(-1)!.detail).toMatchObject({ owner: null, settled: true });
    const events = fx.queue.events(fx.runId).length;
    await stagePass(fx.queue, fx.deps);
    await mergePass(fx.queue, fx.deps);
    expect(fx.queue.events(fx.runId)).toHaveLength(events); // the event stream stops growing
    expect(stageCalls(fx, "stage-post")).toHaveLength(2);
    // a newer leg re-enters the story, the retry count starting afresh
    fx.plansync.stage("ok");
    fx.queue.note(fx.runId, "host-verify", { command: "bun test", green: true, duration_ms: 1000, started_at: "2026-10-17T09:00:00.000Z", rerun: { by: "cli" } });
    await stagePass(fx.queue, fx.deps);
    expect(stagePosts(fx).at(-1)!.detail).toMatchObject({ ok: true });
  }, 120_000);

  test("the owed stories are read again under the lease: a story another process settled meanwhile is not called", async () => {
    const fx = await fixture();
    ownerSpec(fx);
    legs(fx);
    await reviewPass(fx.queue, fx.deps);
    fx.gh.answer({ view: "MERGED" });
    await mergePass(fx.queue, fx.deps); // done recorded, the stage pass settles it
    fx.queue.note(fx.runId, "host-verify", { command: "bun test", green: true, duration_ms: 1000, rerun: { by: "cli" } });
    // between this pass's first read and its claim, another process posts the re-entered story
    const real = fx.queue.claimPlanPhase.bind(fx.queue);
    fx.queue.claimPlanPhase = (runId, phase, self) => {
      const ok = real(runId, phase, self);
      if (ok && phase === "stage") fx.queue.note(runId, "stage-post", { story_key: "27-5-the-plan-follows-the-run-spec", ok: true });
      return ok;
    };
    await stagePass(fx.queue, fx.deps);
    expect(stageCalls(fx, "stage")).toHaveLength(1); // only the first pass's append
    expect(stageLeases(fx).at(-1)!.detail).toMatchObject({ owner: null, settled: true });
  }, 60_000);
});

function expectOnlyExternalEvents(queue: Queue, runId: string): void {
  expect(queue.events(runId).map((e) => e.kind)).toEqual(["external", "ended", "closed_out"]);
}

describe("Story 36.3: an AD-5 conflict ends the pass `partial` (DW-130)", () => {
  // The shape `jirabackend.pull_back` emits: `canonical` the entity's file, `backend` the issue key, both sides in `fields`.
  const CONFLICT = { id: "ST-097", canonical: "/home/agent/repo/plan/ST-097.md", backend: "TKS-97", fields: ["status: canonical='done' backend='Blocked - Awaiting User' (promoted: 'draft')"] };
  /** The fixture with `plansync.py status` answering a held conflict while `held.now`, every other call the fake's; a notifier into `sent`. */
  async function conflicted(heldAt: "review" | "done" = "done") {
    const fx = await fixture();
    const held: { now: boolean; answer?: (id: string) => RunResult | undefined } = { now: true };
    const sent: string[] = [], statuses: string[][] = [];
    const env = { ...fx.deps.env, TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/t" };
    const deps: PlanStatusDeps = {
      ...fx.deps, env,
      hygiene: { env, fetch: async (_u, init) => { sent.push(String(init?.body ?? "")); return new Response("ok", { status: 200 }); } },
      uv: async (root, script, args, t) => {
        if (args[0] !== "status") return runUv(root, script, args, t);
        statuses.push(args);
        const phase = args[args.indexOf("--status") + 1];
        const given = phase === "done" ? held.answer?.(args[args.indexOf("--id") + 1]!) : undefined;
        if (given) return given;
        const conflicts = phase === heldAt && held.now ? [CONFLICT] : [];
        return { exit: 0, stdout: JSON.stringify({ ok: true, previous_status: "review", sync: { ok: true, projection: { conflicts } } }), stderr: "" };
      },
    };
    await reviewPass(fx.queue, deps);
    fx.gh.answer({ view: "MERGED" });
    return { fx, deps, held, sent, statuses };
  }
  const doneEvents = (fx: Awaited<ReturnType<typeof fixture>>) => fx.plan().filter((e) => e.detail!.phase === "done").map((e) => e.detail!);
  const doneCalls = (s: string[][]) => s.filter((a) => a[a.indexOf("--status") + 1] === "done");

  test("Story 36.3: a `review` pass holding the conflict: the record `partial` with `conflict`, one notifier line", async () => {
    const { fx, deps, sent } = await conflicted("review");
    await reviewPass(fx.queue, deps);
    const review = fx.plan().filter((e) => e.detail!.phase === "review").map((e) => e.detail!);
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ phase: "review", id: "ST-097", ok: true, status: "partial", conflict: [CONFLICT] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("plan-status review holds an AD-5 conflict");
    expect(sent[0]).toContain("TKS-97 (ST-097)");
  }, 60_000);

  test("Story 36.3: the `done` record is `partial` naming the conflict, `stage: true` kept, one notifier line naming both sides; rows still owed", async () => {
    const { fx, deps, sent } = await conflicted();
    write(fx.repo.checkout, { "_bmad-output/specs/spec-epic-27/stories/27-5-the-plan-follows-the-run-spec.md": spec("done") }); // pulled: the stage pass's precondition
    await mergePass(fx.queue, deps);
    expect(doneEvents(fx)).toHaveLength(1);
    expect(doneEvents(fx)[0]).toMatchObject({ phase: "done", stage: true, id: "ST-097", ok: true, status: "partial", conflict: [CONFLICT] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("AD-5 conflict");
    expect(sent[0]).toContain("TKS-97 (ST-097)");
    expect(sent[0]).toContain("canonical='done'");
    expect(sent[0]).toContain("backend='Blocked - Awaiting User'");
    expect(sent[0]).not.toContain("/home/agent");
    // owed: the pass's `stage --append` went out for the story
    expect(fx.plansync.calls().some((a) => a[0] === "stage")).toBe(true);
  }, 60_000);

  test("Story 36.3: re-asked on later ticks, the same conflict not recorded or told twice, until the pull-back answers without one", async () => {
    const { fx, deps, held, sent, statuses } = await conflicted();
    await mergePass(fx.queue, deps);
    await mergePass(fx.queue, deps);
    expect(doneCalls(statuses)).toHaveLength(2);
    expect(doneEvents(fx)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    held.now = false;
    await mergePass(fx.queue, deps);
    expect(doneCalls(statuses)).toHaveLength(3);
    expect(doneEvents(fx).at(-1)).toMatchObject({ id: "ST-097", ok: true, stage: true });
    expect(doneEvents(fx).at(-1)!.conflict).toBeUndefined();
    await mergePass(fx.queue, deps);
    expect(doneCalls(statuses)).toHaveLength(3); // settled
  }, 60_000);

  test("Story 36.3: the re-ask is bounded by `PLAN_RETRY_LIMIT`: a give-up record ends it, never auto-resolved", async () => {
    const { fx, deps, statuses } = await conflicted();
    for (let i = 0; i < PLAN_RETRY_LIMIT + 2; i++) await mergePass(fx.queue, deps);
    const n = doneCalls(statuses).length;
    expect(doneEvents(fx).at(-1)).toMatchObject({ ok: false, skipped: true, reason: expect.stringContaining("AD-5 conflict") });
    await mergePass(fx.queue, deps);
    expect(doneCalls(statuses)).toHaveLength(n);
  }, 120_000);

  const conflictOn = (id: string): RunResult => ({ exit: 0, stdout: JSON.stringify({ ok: true, sync: { projection: { conflicts: [{ ...CONFLICT, id }] } } }), stderr: "" });
  const clean: RunResult = { exit: 0, stdout: JSON.stringify({ ok: true, sync: { projection: { conflicts: [] } } }), stderr: "" };

  test("Story 36.3: another entity's conflict in the project neither makes the record `partial` nor notifies", async () => {
    const { fx, deps, held, sent } = await conflicted();
    held.answer = () => conflictOn("ST-999");
    await mergePass(fx.queue, deps);
    expect(doneEvents(fx)).toHaveLength(1);
    expect(doneEvents(fx)[0]!.status).toBeUndefined();
    expect(doneEvents(fx)[0]!.conflict).toBeUndefined();
    expect(sent).toEqual([]);
  }, 60_000);

  test("Story 36.3: an idless skip recorded after a conflict is no give-up: the conflict is still re-asked; a give-up is `gave_up: true`", async () => {
    const { fx, deps, held, statuses } = await conflicted();
    const review = fx.plan().find((e) => e.detail!.phase === "review")!.detail!;
    fx.queue.note(fx.runId, "plan-status", { phase: "review", pr: review.pr, story_key: "27-6-no-entity", ok: false, skipped: true, reason: "no plan entity for story 27.6" });
    await mergePass(fx.queue, deps);
    expect(doneEvents(fx).at(-1)).toMatchObject({ story_key: "27-6-no-entity", skipped: true });
    expect(doneEvents(fx).at(-1)!.gave_up).toBeUndefined();
    expect(openConflicts(fx.queue.events(fx.runId))).toEqual(["ST-097"]);
    held.now = false;
    await mergePass(fx.queue, deps);
    expect(doneCalls(statuses)).toHaveLength(2);
    expect(doneEvents(fx).at(-1)).toMatchObject({ id: "ST-097", ok: true });
    fx.queue.note(fx.runId, "plan-status", { phase: "done", id: "ST-097", ok: true, status: "partial", conflict: [CONFLICT] });
    expect(openConflicts(fx.queue.events(fx.runId))).toEqual(["ST-097"]);
    fx.queue.note(fx.runId, "plan-status", { phase: "done", ok: false, skipped: true, gave_up: true, reason: "gave up" });
    expect(openConflicts(fx.queue.events(fx.runId))).toEqual([]);
  }, 60_000);

  test("Story 36.3: two conflicts re-asked, the first clean and the second transient: the second stays open, retried", async () => {
    const { fx, deps, held, statuses } = await conflicted();
    const review = fx.plan().find((e) => e.detail!.phase === "review")!.detail!;
    fx.queue.note(fx.runId, "plan-status", { ...review, story_key: "27-6-the-second", id: "ST-098" });
    held.answer = (id) => conflictOn(id);
    await mergePass(fx.queue, deps);
    expect(openConflicts(fx.queue.events(fx.runId)).sort()).toEqual(["ST-097", "ST-098"]);
    held.answer = (id) => id === "ST-097" ? clean : { exit: 1, stdout: "Traceback", stderr: "" };
    await mergePass(fx.queue, deps);
    expect(openConflicts(fx.queue.events(fx.runId))).toEqual(["ST-098"]);
    expect(doneEvents(fx).filter((d) => d.id === "ST-098").map((d) => d.error)).toEqual([undefined]);
    const asked = doneCalls(statuses).length;
    held.answer = () => clean;
    await mergePass(fx.queue, deps);
    expect(doneCalls(statuses)).toHaveLength(asked + 1);
    expect(openConflicts(fx.queue.events(fx.runId))).toEqual([]);
  }, 60_000);

  test("Story 36.3: a clean answer records no status or conflict", async () => {
    const { fx, deps, held } = await conflicted();
    held.now = false;
    await mergePass(fx.queue, deps);
    expect(doneEvents(fx)[0]!.status).toBeUndefined();
    expect(doneEvents(fx)[0]!.conflict).toBeUndefined();
  }, 60_000);
});
