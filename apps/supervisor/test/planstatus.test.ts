// Story 27.5 (AC1): the plan follows the run — the review pass when a run's PR opens, the merge pass when it
// merges — pinned against a real throwaway repository (the run branch carrying the specs the run marked done), the
// fake planning adapter under a temp TK_STUDIO_ROOT (`fakePlansync`) and the fake `gh` (`pr view`).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { atBranch, mergePass, PLAN_RETRY_LIMIT, planEntity, planOwner, registryRoot, reviewPass, specKey, storyNumber, type PlanStatusDeps } from "../src/planstatus";
import { Queue, type QueueEvent } from "../src/queue";
import { runProcess, runUv } from "../src/server";
import { runBranch } from "../src/worktree";
import { fakeGh, fakePlansync, gitRepo, testGit } from "./fakes";

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
  queue.recordWorktree(runId, join(mkdtempSync(join(tmpdir(), "tk-sup-ps-wt-")), "gone"), { branch: runBranch(runId), base_ref: "main" });
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
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-ps-plan-"));
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
    const owner = mkdtempSync(join(tmpdir(), "tk-sup-ps-owner-"));
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
      { phase: "done", pr: PR, owner: "tk-studio", ok: false, skipped: true, reason: "owner tk-studio not in the registry" },
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
    expect(fx.plansync.calls().map((a) => a[a.indexOf("--status") + 1])).toEqual(["review", "done"]);
    expect(fx.plan().at(-1)!.detail).toEqual({
      phase: "done", pr: PR, owner: "proj", directory: fx.repo.checkout, story_key: "27-5-the-plan-follows-the-run-spec", id: "ST-097", ok: true, previous_status: "draft",
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
    expect(fx.plan().at(-1)!.detail).toEqual({ phase: "done", pr: PR, ok: false, skipped: true, reason: "pr closed unmerged" });
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
    expect(fx.plansync.calls().map((a) => a[a.indexOf("--status") + 1])).toEqual(["review", "done"]);
    expect(fx.plan().map((e) => e.detail!.phase)).toEqual(["review", "done"]);
    // One claim per phase, each let go settled once recorded (never counted as a retry).
    expect(fx.queue.events(fx.runId).filter((e) => e.kind === "plan-lease").map((e) => [e.detail!.phase, e.detail!.owner === null ? "settled" : "claimed", e.detail!.settled ?? null]))
      .toEqual([["review", "claimed", null], ["review", "settled", true], ["done", "claimed", null], ["done", "settled", true]]);
  }, 60_000);

  test("registry: a failed lookup records nothing (asked again next tick, the lease let go); a missing entry is the skip", async () => {
    const owner = mkdtempSync(join(tmpdir(), "tk-sup-ps-owner-"));
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

function expectOnlyExternalEvents(queue: Queue, runId: string): void {
  expect(queue.events(runId).map((e) => e.kind)).toEqual(["external", "ended", "closed_out"]);
}
