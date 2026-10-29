// Story 32.8: delivery — the closeout pass (the engagement's last run, the composition the lib renders, `run-ended`,
// the issue Done, one notifier line, `engagement-closeout`). The fakes: the injected `uv` (`engage.py closeout` and
// `track.py close` answered from the test, the input file captured), the injected command runner for `gh pr view`,
// the notifier: no live Atlassian, no live `gh`, no notifier.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import { APPROVE_EVENT, RUN_QUEUED_EVENT, RUN_STOP_EVENT, engagementRunPass } from "../src/approve";
import { CLOSEOUT_EVENT, closeoutPass, composeCloseout, lastRunEnded, storyLegs, type CloseoutInput, type DeliveryDeps } from "../src/delivery";
import { applyInput, newEngagement, readEngagement, writeEngagement, type Autonomy, type Engagement } from "../src/engagement";
import type { EndNotice } from "../src/hygiene";
import { Queue, type Owner } from "../src/queue";
import type { RunResult } from "../src/server";
import { tempDir, track } from "./tmp";

const temp = tempDir; // test/tmp.ts closes the tracked queues and removes the folders

const ENG = "ENG-001";
const ISSUE = "TKS-40";
const PR_1 = "https://github.com/acme/widget/pull/7";
const PR_2 = "https://github.com/acme/widget/pull/8";
const PAGE = { id: "70001", url: "https://acme.atlassian.net/wiki/spaces/TKSTUDIO/pages/70001", version: 1, action: "created" };
const REPORT = `_bmad-output/engagements/${ENG}/closeout.md`;
const me: Owner = { pid: process.pid, host: hostname(), nonce: "delivery-test" };
const BOUND = "planning:\n  backend: jira\n  jira:\n    project_key: TKS\n";
const QUOTE = {
  band50: { tokens: 1, usd: 20, share: "x" }, band85: { tokens: 2, usd: 30, share: "x" }, band95: { tokens: 3, usd: 38, share: "x" }, cap: 40,
  basis: { epics: [{ k: 1, title: "Report exports", stories: 2, ep_id: "EP-041" }] }, computed_at: "2026-10-25T05:00:00.000Z",
};

function clock(start = "2026-10-25T06:00:00.000Z") {
  let t = Date.parse(start);
  return () => new Date((t += 1000)).toISOString();
}

const newQueue = () => {
  const q = track(new Queue(join(temp("tk-sup-dl-q-"), "q.db"), { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) }));
  return q;
};

/** An approved record (autonomy `full` unless given) moved to `state`. */
function record(state: Engagement["state"], o: { autonomy?: Autonomy; runsUsd?: number } = {}): Engagement {
  const r: Engagement = { ...newEngagement(ENG, "p", "Build the export", "2026-10-25T05:00:00.000Z"), state: "quoted", quote: structuredClone(QUOTE) };
  const applied = applyInput(r, { verb: "approve", payload: { autonomy: o.autonomy ?? "full" }, source: "bearer", at: "2026-10-25T05:30:00.000Z" });
  if (!applied.ok) throw new Error("approve refused");
  return { ...applied.record, state, spend: { planning_usd: 0.5, runs_usd: o.runsUsd ?? 12 } };
}

/** The served root (not a git checkout): the config (Jira-bound unless `bound: false`), the record, the scope, the
 * approve pass's declared job. */
function servedRoot(queue: Queue, o: { state?: Engagement["state"]; bound?: boolean; autonomy?: Autonomy; runsUsd?: number; jobs?: string[] } = {}) {
  const root = temp("tk-sup-dl-root-");
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), "project_id: p\n" + (o.bound === false ? "" : BOUND));
  writeEngagement(root, record(o.state ?? "in-progress", o));
  mkdirSync(join(root, "_bmad-output", "engagements", ENG), { recursive: true });
  writeFileSync(join(root, "_bmad-output", "engagements", ENG, "scope.md"), "# scope\n");
  queue.serviceEvent(APPROVE_EVENT, { id: ENG, project: "p", step: "job", ok: true, detail: { jobs: o.jobs ?? ["run-epic-41"], root } }, "2026-10-25T05:40:00.000Z");
  return root;
}

/** A landed story's spec in `root` (`findSpec`'s `implementation-artifacts/spec-<key>.md`). */
function spec(root: string, key: string, status = "done") {
  mkdirSync(join(root, "_bmad-output", "implementation-artifacts"), { recursive: true });
  writeFileSync(join(root, "_bmad-output", "implementation-artifacts", `spec-${key}.md`), `---\nstatus: ${status}\n---\n# ${key}\n`);
}

function link(queue: Queue, root: string, o: { job?: string; after?: string } = {}): string {
  const job = o.job ?? "run-epic-41";
  const { run } = queue.enqueue({ jobId: job, root, projectId: "p", definition: { id: job }, payload: { engagement: ENG, project: "p" } });
  queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job, ...(o.after ? { after_run: o.after } : {}) });
  return run.run_id;
}

async function launch(queue: Queue, runId: string, engine = "E1") {
  expect((await queue.claim(runId, me)).claimed).toBe(true);
  queue.markLaunched(runId, engine, { end: {} });
}

/** The deps: `uv` answers `engage.py closeout` (the input captured) and `track.py close`; `gh pr view` answers
 * `prStates` (absent: gh fails); the notifier recorded; the ledger with `costs` by studio run id. */
function deps(o: {
  lib?: (input: CloseoutInput) => Record<string, unknown>; track?: () => Record<string, unknown>;
  prStates?: Record<string, string>; costs?: Record<string, number>;
  /** The served root's git objects by ref (`{<ref>: {<path>: text}}`): `ls-tree` and `show` answered from it; a ref
   * absent fails as git does. Absent: every git call fails. */
  refs?: Record<string, Record<string, string>>;
} = {}) {
  const inputs: CloseoutInput[] = [];
  const uvCalls: { script: string; args: string[] }[] = [];
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];
  const notices: EndNotice[] = [];
  const ledger = join(temp("tk-sup-dl-ledger-"), "u-m.jsonl");
  writeFileSync(ledger, Object.entries(o.costs ?? {}).map(([sid, usd]) => JSON.stringify({
    event: "job-run", project: "p", payload: { run_id: sid, job_id: "run-epic-41", total_cost_usd: usd },
  })).join("\n") + "\n");
  const uv = async (_root: string, script: string, args: string[]): Promise<RunResult> => {
    uvCalls.push({ script: basename(script), args });
    if (script.endsWith("engage.py")) {
      const input = JSON.parse(readFileSync(args[args.indexOf("--input-file") + 1]!, "utf-8")) as CloseoutInput;
      inputs.push(input);
      const answer = (o.lib ?? (() => ({ ok: true, status: "complete", engagement: ENG, outcome: "delivered", page: PAGE, written: [REPORT] })))(input);
      return { exit: answer.status === "blocked" ? 2 : 0, stdout: JSON.stringify(answer), stderr: "" };
    }
    if (script.endsWith("track.py")) {
      const answer = (o.track ?? (() => ({ ok: true, status: "complete", engagement: ENG, issue: ISSUE, moved: ["Block Resolved", "Done"] })))();
      return { exit: answer.status === "blocked" ? 2 : 0, stdout: JSON.stringify(answer), stderr: "" };
    }
    throw new Error(`unexpected script ${script}`);
  };
  const run = async (bin: string, args: string[]): Promise<RunResult> => {
    if (bin === "git") {
      gitCalls.push(args);
      if (!o.refs || args[0] !== "-C") return { exit: 1, stdout: "", stderr: "not a git repository" }; // gh's `remote get-url`
      const verb = args[2];
      if (verb === "ls-tree") {
        const tree = o.refs[args[5]!];
        if (!tree) return { exit: 128, stdout: "", stderr: `fatal: Not a valid object name ${args[5]}` };
        const specs = args.slice(args.indexOf("--") + 1);
        const paths = Object.keys(tree).filter((p) => specs.some((s) => p === s || p.startsWith(`${s}/`)));
        return { exit: 0, stdout: paths.map((p) => `${p}\n`).join(""), stderr: "" };
      }
      if (verb === "show") {
        const [ref, path] = [args[3]!.slice(0, args[3]!.indexOf(":")), args[3]!.slice(args[3]!.indexOf(":") + 1).replace(/^\.\//, "")];
        const text = o.refs[ref]?.[path];
        return text === undefined ? { exit: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in '${ref}'` } : { exit: 0, stdout: text, stderr: "" };
      }
      return { exit: 1, stdout: "", stderr: `unexpected git ${verb}` };
    }
    ghCalls.push(args);
    const state = o.prStates?.[args[2]!];
    return state ? { exit: 0, stdout: JSON.stringify({ state }), stderr: "" } : { exit: 1, stdout: "", stderr: "gh failed" };
  };
  const d: DeliveryDeps = {
    // Story 35.5 (hole 84): the injected env carries every variable production reads — `studioScript` reaches
    // `TK_STUDIO_ROOT`, which the host's user env happens to set and the sandbox does not.
    env: { ...process.env, TK_STUDIO_ROOT: resolve(import.meta.dir, "..", "..", ".."), GH_BIN: "gh-fake", TK_SUPERVISOR_NOTIFY: "" }, uv, run, now: clock(), ledgerFile: ledger,
    notify: async (n) => { notices.push(n); return { ok: true, via: "fake" }; },
    launchStop: async (_root, engine) => ({ ok: true, detail: `engine ${engine} stopping gracefully` }),
  };
  return { deps: d, inputs, uvCalls, ghCalls, gitCalls, notices };
}

const closeouts = (q: Queue) => q.serviceEvents(CLOSEOUT_EVENT).map((e) => e.detail as Record<string, any>);
const libCalls = (fx: ReturnType<typeof deps>) => fx.uvCalls.filter((c) => c.script === "engage.py");
const trackCalls = (fx: ReturnType<typeof deps>) => fx.uvCalls.filter((c) => c.script === "track.py");

/** Two stories landed over two linked runs (the first stopped and resubmitted under steady, the second ended on its
 * own), both specs `status: done`, both PRs merged. */
async function deliveredEngagement(queue: Queue, o: { bound?: boolean } = {}) {
  const root = servedRoot(queue, { autonomy: "steady", bound: o.bound });
  const first = link(queue, root);
  await launch(queue, first, "E1");
  queue.setStudioRun(first, "s-1");
  queue.note(first, "close-out", { story_key: "41-1-csv-button" });
  queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: first, engine_run_id: "E1", reason: "steady", story_key: "41-1-csv-button", ok: true, detail: "stopping" });
  queue.end(first, "complete", null, { detail: { pr: PR_1 } });
  const second = link(queue, root, { after: first });
  await launch(queue, second, "E2");
  queue.setStudioRun(second, "s-2");
  queue.note(second, "close-out", { story_key: "41-2-filtered-export" });
  queue.end(second, "complete", null, { detail: { pr: PR_2 } });
  spec(root, "41-1-csv-button");
  spec(root, "41-2-filtered-export");
  return { root, first, second };
}

describe("Story 32.8: the closeout pass (AC1)", () => {
  test("delivered: the composition, engage.py closeout, run-ended in-progress → delivered, the issue Done, one notifier line with the page, the event; once", async () => {
    const queue = newQueue();
    const { root, first, second } = await deliveredEngagement(queue);
    const fx = deps({ prStates: { [PR_1]: "MERGED", [PR_2]: "merged" }, costs: { "s-1": 4.25 } });
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [ENG], refused: [] });
    // the lib call and the composition (Settled shape 2)
    expect(libCalls(fx)).toHaveLength(1);
    expect(libCalls(fx)[0]!.args.slice(0, 5)).toEqual(["closeout", "--directory", root, "--engagement", ENG]);
    expect(fx.inputs[0]).toEqual({
      run_id: second, outcome_hint: "partial",
      runs: [
        { run_id: first, job: "run-epic-41", state: "complete", studio_run_id: "s-1", cost_usd: 4.25, pr: PR_1 },
        { run_id: second, job: "run-epic-41", state: "complete", studio_run_id: "s-2", cost_usd: null, pr: PR_2 },
      ],
      stories: [
        { key: "41-1-csv-button", run_id: first, spec_status: "done", pr: PR_1, pr_state: "MERGED" },
        { key: "41-2-filtered-export", run_id: second, spec_status: "done", pr: PR_2, pr_state: "MERGED" },
      ],
      epics: [{ job: "run-epic-41", queued: true }],
      side_exits: [],
      spend: { planning_usd: 0.5, runs_usd: 12 },
      quote: QUOTE,
    });
    // the state through run-ended (source supervisor), its detail naming the run and the report
    const r = readEngagement(root, ENG)!;
    expect(r.state).toBe("delivered");
    expect(r.inputs.at(-1)).toMatchObject({ verb: "run-ended", source: "supervisor", from: "in-progress", to: "delivered", run_id: second, detail: { outcome: "delivered", run_id: second, closeout: REPORT } });
    expect(queue.serviceEvents("engagement").map((e) => e.detail).at(-1)).toEqual({ id: ENG, project: "p", state: "delivered", from: "in-progress", verb: "run-ended", source: "supervisor" });
    // the issue to Done
    expect(trackCalls(fx).map((c) => c.args)).toEqual([["close", "--directory", root, "--engagement", ENG]]);
    expect(queue.serviceEvents("engagement-issue").map((e) => e.detail)).toEqual([{ engagement: ENG, project: "p", issue: ISSUE, action: "closed", step: "closeout" }]);
    // one notifier line with the link, then the event
    expect(fx.notices).toHaveLength(1);
    expect(fx.notices[0]).toMatchObject({ run_id: second, job_id: "run-epic-41", project_id: "p", studio_run_id: "s-2", state: "delivered", reason: `engagement ${ENG} delivered: ${PAGE.url}` });
    expect(closeouts(queue)).toEqual([{ engagement: ENG, project: "p", run_id: second, outcome: "delivered", page: { id: PAGE.id, url: PAGE.url, version: 1 }, ok: true, notify: { ok: true, via: "fake" } }]);
    // once per last run
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
    expect(fx.uvCalls).toHaveLength(2);
    expect(fx.notices).toHaveLength(1);
  });

  test("partial: a deliverable not done → run-ended partial; unbound Jira closes nothing; no page links the closeout.md path", async () => {
    const queue = newQueue();
    const { root } = await deliveredEngagement(queue, { bound: false });
    const fx = deps({ lib: () => ({ ok: true, status: "complete", engagement: ENG, outcome: "partial", page: null, written: [REPORT] }) });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    expect(readEngagement(root, ENG)!.state).toBe("partial");
    expect(trackCalls(fx)).toEqual([]);
    expect(fx.notices[0]!.reason).toBe(`engagement ${ENG} partial: ${REPORT}`);
    expect(closeouts(queue)[0]).toMatchObject({ outcome: "partial", page: null, ok: true });
    // gh failed for every PR: pr_state null
    expect(fx.inputs[0]!.stories.map((s) => s.pr_state)).toEqual([null, null]);
  });

  test("failed: the last run blocked → outcome_hint failed, run-ended failed", async () => {
    const queue = newQueue();
    const root = servedRoot(queue);
    const run = link(queue, root);
    await launch(queue, run);
    queue.end(run, "blocked", "engine failed");
    const fx = deps({ lib: (input) => ({ ok: true, status: "complete", engagement: ENG, outcome: input.outcome_hint, page: PAGE, written: [REPORT] }) });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    expect(fx.inputs[0]).toMatchObject({ run_id: run, outcome_hint: "failed", stories: [], runs: [{ run_id: run, state: "blocked", cost_usd: null, pr: null }] });
    expect(readEngagement(root, ENG)!.state).toBe("failed");
  });

  test("the composition: side exits with their reason, an unqueued epic, a spec not done, a paused story's PR", async () => {
    const queue = newQueue();
    const root = servedRoot(queue, { jobs: ["run-epic-41", "run-epic-42"] });
    const cur = readEngagement(root, ENG)!;
    const lines = [
      { at: "2026-10-25T06:10:00.000Z", verb: "cap", source: "supervisor", from: "in-progress", to: "partial", detail: { runs_usd: 41, cap: 40 } },
      { at: "2026-10-25T06:20:00.000Z", verb: "go", source: "bearer", payload: { cap: 80 }, from: "partial", to: "in-progress" },
      { at: "2026-10-25T06:30:00.000Z", verb: "run-paused", source: "supervisor", from: "in-progress", to: "paused", detail: { reason: "landed 41-1", run_id: "x" } },
      { at: "2026-10-25T06:40:00.000Z", verb: "question", source: "bearer", payload: { text: "?" }, from: "paused", to: "paused" },
    ] as Engagement["inputs"];
    writeEngagement(root, { ...cur, inputs: [...cur.inputs, ...lines] });
    const run = link(queue, root);
    await launch(queue, run);
    queue.note(run, "paused", { story_key: "41-1-csv-button", pr: PR_1 });
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    queue.end(run, "complete", null, { detail: { pr: PR_2 } });
    spec(root, "41-1-csv-button", "in-review");
    const fx = deps({ prStates: { [PR_1]: "OPEN" } });
    const input = await composeCloseout(queue, fx.deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(run)!);
    expect(input.side_exits).toEqual([
      { at: "2026-10-25T06:10:00.000Z", to: "partial", verb: "cap", reason: "cap" },
      { at: "2026-10-25T06:30:00.000Z", to: "paused", verb: "run-paused", reason: "landed 41-1" },
    ]);
    expect(input.epics).toEqual([{ job: "run-epic-41", queued: true }, { job: "run-epic-42", queued: false }]);
    expect(input.stories).toEqual([{ key: "41-1-csv-button", run_id: run, spec_status: "in-review", pr: PR_1, pr_state: "OPEN" }]);
    expect(fx.ghCalls).toEqual([["pr", "view", PR_1, "--json", "state"]]);
  });
});

describe("Story 32.8: the last run (Settled shape 1)", () => {
  test("not the last run: a live run, an after_run resubmit, a steady stop awaiting its PR, an in-progress run the pass stopped (cap)", async () => {
    const queue = newQueue();
    const root = servedRoot(queue);
    const t = { root, engagement: ENG };
    const run = link(queue, root);
    await launch(queue, run);
    const fx = deps();
    expect(lastRunEnded(queue, t, readEngagement(root, ENG)!)).toBeUndefined(); // live
    queue.end(run, "complete", null, { detail: { pr: PR_1 } });
    expect(lastRunEnded(queue, t, readEngagement(root, ENG)!)?.run_id).toBe(run);
    queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "steady", story_key: "41-1", ok: true, detail: "" });
    expect(lastRunEnded(queue, t, readEngagement(root, ENG)!)).toBeUndefined(); // step 7's resubmit owed
    const queue2 = newQueue();
    const root2 = servedRoot(queue2);
    const run2 = link(queue2, root2);
    await launch(queue2, run2);
    queue2.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run2, engine_run_id: "E1", reason: "cap", ok: true, detail: "" });
    queue2.end(run2, "partial");
    expect(lastRunEnded(queue2, { root: root2, engagement: ENG }, readEngagement(root2, ENG)!)).toBeUndefined(); // in-progress: resubmit owed
    expect(await closeoutPass(queue2, fx.deps)).toEqual({ closed: [], refused: [] });
    expect(fx.uvCalls).toEqual([]);
  });

  test("partial after the cap: no closeout while the cap block is owed; once blocked, the report and run-ended partial → partial", async () => {
    const queue = newQueue();
    const root = servedRoot(queue, { runsUsd: 41 });
    const run = link(queue, root);
    await launch(queue, run);
    const fx = deps({ lib: () => ({ ok: true, status: "complete", engagement: ENG, outcome: "partial", page: PAGE, written: [REPORT] }) });
    // the run pass: the cap (partial), the graceful stop, the cap block (its track call refused transiently here)
    const blocking = deps({ track: () => ({ ok: false, status: "partial", retry: true }) });
    await engagementRunPass(queue, { ...fx.deps, uv: blocking.deps.uv });
    expect(readEngagement(root, ENG)!.state).toBe("partial");
    queue.end(run, "partial");
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] }); // the cap block owed
    queue.serviceEvent("engagement-issue", { engagement: ENG, project: "p", issue: ISSUE, action: "blocked", kind: "cap" });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    const r = readEngagement(root, ENG)!;
    expect(r.state).toBe("partial");
    expect(r.inputs.at(-1)).toMatchObject({ verb: "run-ended", from: "partial", to: "partial", run_id: run });
    expect(fx.inputs[0]!.side_exits).toEqual([{ at: expect.any(String), to: "partial", verb: "cap", reason: "cap" }]);
  });

  test("repeat after go {cap} from partial: the new last run ends → a new closeout, partial → delivered", async () => {
    const queue = newQueue();
    const root = servedRoot(queue, { state: "partial", bound: false });
    const first = link(queue, root);
    await launch(queue, first);
    queue.end(first, "partial");
    let outcome = "partial";
    const fx = deps({ lib: () => ({ ok: true, status: "complete", engagement: ENG, outcome, page: PAGE, written: [REPORT] }) });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    const go = applyInput(readEngagement(root, ENG)!, { verb: "go", payload: { cap: 80 }, source: "bearer", at: "2026-10-25T09:00:00.000Z" });
    if (!go.ok) throw new Error("go refused");
    writeEngagement(root, go.record);
    const second = link(queue, root, { after: first });
    await launch(queue, second, "E2");
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([]); // live
    queue.end(second, "complete");
    outcome = "delivered";
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    expect(readEngagement(root, ENG)!.state).toBe("delivered");
    expect(closeouts(queue).map((e) => [e.run_id, e.outcome])).toEqual([[first, "partial"], [second, "delivered"]]);
    expect(fx.notices).toHaveLength(2);
  });

  test("never a scoping (a mid-run revise) or a cancelled record", async () => {
    for (const state of ["scoping", "cancelled", "paused", "approved"] as const) {
      const queue = newQueue();
      const root = servedRoot(queue, { state });
      const run = link(queue, root);
      await launch(queue, run);
      queue.end(run, "complete");
      const fx = deps();
      expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
      expect(fx.uvCalls).toEqual([]);
      expect(readEngagement(root, ENG)!.state).toBe(state);
    }
  });
});

describe("Story 32.8 review: the spec read from the pushed run branch (the worktree removed, DW-46)", () => {
  /** The lib's verdict (Settled shape 3) over the composition: every story landed (`spec_status: done`) and merged
   * → delivered; else partial, the first story not landed named. */
  const verdict = (input: CloseoutInput) => {
    const notLanded = input.stories.find((s) => s.spec_status !== "done");
    const unmerged = input.stories.find((s) => s.pr_state !== "MERGED");
    const why = notLanded ? `story ${notLanded.key} not landed` : unmerged ? `PR ${unmerged.pr} not merged` : null;
    return { ok: true, status: "complete", engagement: ENG, outcome: why ? "partial" : "delivered", why, page: PAGE, written: [REPORT] };
  };
  const SPEC_REL = "_bmad-output/specs/spec-epic-41/stories/41-1-csv-button-spec.md";

  /** One linked run whose worktree was removed at close-out; its story landed and its PR merged; the spec nowhere on
   * disk (the served root never pulled). */
  async function archived(queue: Queue) {
    const root = servedRoot(queue, { bound: false });
    const run = link(queue, root);
    await launch(queue, run);
    queue.recordWorktree(run, join(root, "..", "removed-worktree-" + run), { branch: `supervisor/run-${run}`, base_ref: "main" });
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    queue.end(run, "complete", null, { detail: { pr: PR_1 } });
    return { root, run };
  }

  test("the done spec only on origin's run branch, the PR merged → delivered; read-only git (ls-tree, show), never a fetch", async () => {
    const queue = newQueue();
    const { root, run } = await archived(queue);
    const branch = `supervisor/run-${run}`;
    const fx = deps({
      lib: verdict, prStates: { [PR_1]: "MERGED" },
      refs: { [`origin/${branch}`]: { [SPEC_REL]: "---\nstatus: done\n---\n# 41-1\n", "_bmad-output/specs/spec-epic-41/stories/41-2-other-spec.md": "x" } },
    });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    expect(fx.inputs[0]!.stories).toEqual([{ key: "41-1-csv-button", run_id: run, spec_status: "done", pr: PR_1, pr_state: "MERGED" }]);
    expect(readEngagement(root, ENG)!.state).toBe("delivered");
    expect(fx.gitCalls.filter((a) => a[0] === "-C")).toEqual([
      ["-C", root, "ls-tree", "-r", "--name-only", `origin/${branch}`, "--", "_bmad-output/implementation-artifacts/spec-41-1-csv-button.md", "_bmad-output/specs"],
      ["-C", root, "show", `origin/${branch}:./${SPEC_REL}`],
    ]);
  });

  test("origin's ref missing: the local run branch is read; no ref at all → spec_status null, story <key> not landed", async () => {
    const queue = newQueue();
    const { run } = await archived(queue);
    const branch = `supervisor/run-${run}`;
    const local = deps({ lib: verdict, prStates: { [PR_1]: "MERGED" }, refs: { [branch]: { "_bmad-output/implementation-artifacts/spec-41-1-csv-button.md": "---\nstatus: done\n---\n" } } });
    const t = { root: queue.get(run)!.root, engagement: ENG };
    const input = await composeCloseout(queue, local.deps, t, readEngagement(t.root, ENG)!, queue.get(run)!);
    expect(input.stories[0]!.spec_status).toBe("done");
    expect(local.gitCalls.filter((a) => a[0] === "-C").map((a) => a[5] ?? a[3])).toEqual([`origin/${branch}`, branch, `${branch}:./_bmad-output/implementation-artifacts/spec-41-1-csv-button.md`]);
    const none = deps({ lib: verdict, prStates: { [PR_1]: "MERGED" }, refs: {} });
    expect((await closeoutPass(queue, none.deps)).closed).toEqual([ENG]);
    expect(none.inputs[0]!.stories[0]!.spec_status).toBeNull();
    expect(verdict(none.inputs[0]!).why).toBe("story 41-1-csv-button not landed");
    expect(readEngagement(t.root, ENG)!.state).toBe("partial");
    // read-only: only ls-tree and show against the served root (gh's own `remote get-url` aside)
    expect(none.gitCalls.filter((a) => a[0] === "-C").every((a) => a[2] === "ls-tree" || a[2] === "show")).toBe(true);
    expect(none.gitCalls.filter((a) => a[0] !== "-C")).toEqual(none.gitCalls.filter((a) => a.join(" ") === "remote get-url origin"));
  });

  test("a nested served root (Story 28.5): the spec read at <worktree>/<prefix>, never at the worktree's top", async () => {
    const queue = newQueue();
    const root = servedRoot(queue, { bound: false });
    const { run } = queue.enqueue({ jobId: "run-epic-41", root, projectId: "p", definition: { id: "run-epic-41" }, prefix: "apps/widget/", payload: { engagement: ENG, project: "p" } });
    queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job: "run-epic-41" });
    await launch(queue, run.run_id);
    const worktree = temp("tk-sup-dl-wt-");
    queue.recordWorktree(run.run_id, worktree, { branch: `supervisor/run-${run.run_id}`, base_ref: "main" });
    spec(join(worktree, "apps", "widget"), "41-1-csv-button", "in-progress");
    spec(worktree, "41-1-csv-button", "done"); // the repository top's copy: not the project's
    queue.note(run.run_id, "close-out", { story_key: "41-1-csv-button" });
    queue.end(run.run_id, "complete", null, { detail: { pr: PR_1 } });
    const fx = deps({ prStates: { [PR_1]: "MERGED" } });
    const input = await composeCloseout(queue, fx.deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(run.run_id)!);
    expect(input.stories).toEqual([{ key: "41-1-csv-button", run_id: run.run_id, spec_status: "in-progress", pr: PR_1, pr_state: "MERGED" }]);
    expect(fx.gitCalls.filter((a) => a[0] === "-C")).toEqual([]); // read from disk, no git fallback
  });
});

describe("Story 32.8 review: partial closes out past a stop; an unmetered run is null", () => {
  test("in-progress: a steady stop on a run with no PR awaits no merge (step 7 never resubmits it) → the run ended blocked is the last run, failed", async () => {
    const queue = newQueue();
    const root = servedRoot(queue, { bound: false, autonomy: "steady" });
    const run = link(queue, root);
    await launch(queue, run);
    queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "steady", story_key: "41-1", ok: true, detail: "" });
    queue.end(run, "blocked");
    const t = { root, engagement: ENG };
    expect(lastRunEnded(queue, t, readEngagement(root, ENG)!)?.run_id).toBe(run);
    const fx = deps({ lib: (input) => ({ ok: true, status: "complete", engagement: ENG, outcome: input.outcome_hint, page: null, written: [REPORT] }) });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    expect(fx.inputs[0]!.outcome_hint).toBe("failed");
    expect(readEngagement(root, ENG)!.state).toBe("failed");
    // an ask (or cap) stop still holds back without a PR
    const queue2 = newQueue();
    const root2 = servedRoot(queue2, { bound: false, autonomy: "ask" });
    const run2 = link(queue2, root2);
    await launch(queue2, run2);
    queue2.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run2, engine_run_id: "E1", reason: "ask", story_key: "41-1", ok: true, detail: "" });
    queue2.end(run2, "blocked");
    expect(lastRunEnded(queue2, { root: root2, engagement: ENG }, readEngagement(root2, ENG)!)).toBeUndefined();
  });

  test("partial: an ok steady (or ask) stop on the last run holds nothing back (the resubmit and the pause are in-progress only)", async () => {
    for (const reason of ["steady", "ask"]) {
      const queue = newQueue();
      const root = servedRoot(queue, { state: "partial", bound: false, autonomy: reason as Autonomy });
      const run = link(queue, root);
      await launch(queue, run);
      queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason, story_key: "41-1", ok: true, detail: "" });
      queue.end(run, "complete", null, { detail: { pr: PR_1 } });
      const t = { root, engagement: ENG };
      expect(lastRunEnded(queue, t, readEngagement(root, ENG)!)?.run_id).toBe(run);
      // the same stop in in-progress: the resubmit (or the pause) is owed
      expect(lastRunEnded(queue, t, { ...readEngagement(root, ENG)!, state: "in-progress" })).toBeUndefined();
      const fx = deps({ lib: () => ({ ok: true, status: "complete", engagement: ENG, outcome: "partial", page: null, written: [REPORT] }) });
      expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
      expect(readEngagement(root, ENG)!.inputs.at(-1)).toMatchObject({ verb: "run-ended", from: "partial", to: "partial", run_id: run });
    }
  });

  test("a job-run line with no or a zero total_cost_usd is unmetered: cost_usd null, not 0", async () => {
    const queue = newQueue();
    const root = servedRoot(queue, { bound: false });
    const a = link(queue, root);
    await launch(queue, a);
    queue.setStudioRun(a, "s-zero");
    queue.end(a, "complete");
    const fx = deps({ costs: { "s-zero": 0 } });
    const input = await composeCloseout(queue, fx.deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(a)!);
    expect(input.runs).toEqual([{ run_id: a, job: "run-epic-41", state: "complete", studio_run_id: "s-zero", cost_usd: null, pr: null }]);
  });
});

describe("Story 32.8: refusals and retries (never throws)", () => {
  test("a lib refusal by name: the event ok false with the reason, the state unmoved, one notice; not called again", async () => {
    const queue = newQueue();
    const { root, second } = await deliveredEngagement(queue);
    const fx = deps({ lib: () => ({ ok: false, status: "blocked", engagement: ENG, outcome: null, page: null, written: [], reason: "engage refused: NoScope: no _bmad-output/engagements/ENG-001/scope.md" }) });
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [ENG] });
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
    expect(closeouts(queue)).toEqual([{ engagement: ENG, project: "p", run_id: second, outcome: null, page: null, ok: false, reason: "engage refused: NoScope: no _bmad-output/engagements/ENG-001/scope.md", notify: { ok: true, via: "fake" } }]);
    expect(trackCalls(fx)).toEqual([]);
    await closeoutPass(queue, fx.deps);
    expect(libCalls(fx)).toHaveLength(1);
  });

  test("a transient lib failure (retry: true, a throw, no JSON) emits nothing and is called again", async () => {
    const queue = newQueue();
    const { root } = await deliveredEngagement(queue);
    let calls = 0;
    const fx = deps({ lib: () => { calls += 1; if (calls === 1) return { ok: false, status: "partial", retry: true }; if (calls === 2) throw new Error("uv died"); return { ok: true, status: "complete", outcome: "delivered", page: PAGE, written: [] }; } });
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
    expect(closeouts(queue)).toEqual([]);
    expect(readEngagement(root, ENG)!.state).toBe("in-progress");
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
  });

  test("a transient issue close: the row applied, no event; the next pass closes, tells once and never re-renders", async () => {
    const queue = newQueue();
    const { root } = await deliveredEngagement(queue);
    let transient = true;
    const fx = deps({ prStates: { [PR_1]: "MERGED", [PR_2]: "MERGED" }, track: () => (transient ? { ok: false, status: "partial", retry: true } : { ok: true, status: "complete", issue: ISSUE }) });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([]);
    expect(readEngagement(root, ENG)!.state).toBe("delivered");
    expect(closeouts(queue)).toEqual([]);
    expect(fx.notices).toEqual([]);
    transient = false;
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    expect(libCalls(fx)).toHaveLength(1);
    expect(fx.notices).toHaveLength(1);
    expect(closeouts(queue)[0]).toMatchObject({ outcome: "delivered", ok: true });
    // a close refused by name is recorded and the closeout still told
    const queue2 = newQueue();
    await deliveredEngagement(queue2);
    const fx2 = deps({ track: () => ({ ok: false, status: "blocked", reason: "track refused: NoIssue: no issue" }) });
    expect((await closeoutPass(queue2, fx2.deps)).closed).toEqual([ENG]);
    expect(queue2.serviceEvents("engagement-issue").map((e) => e.detail)).toEqual([{ engagement: ENG, project: "p", action: "refused", step: "close", reason: "track refused: NoIssue: no issue" }]);
  });
});

describe("Story 32.8 follow-up review: a closed PR, a record moved on, another process's notice", () => {
  /** One linked run in `in-progress` the run pass stopped under steady, ended with its PR. */
  async function steadyStopped(queue: Queue) {
    const root = servedRoot(queue, { bound: false, autonomy: "steady" });
    const run = link(queue, root);
    await launch(queue, run);
    queue.note(run, "close-out", { story_key: "41-1-csv-button" });
    queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "steady", story_key: "41-1-csv-button", ok: true, detail: "" });
    queue.end(run, "complete", null, { detail: { pr: PR_1 } });
    return { root, run };
  }
  const partialLib = () => ({ ok: true, status: "complete", engagement: ENG, outcome: "partial", page: null, written: [REPORT] });

  test("in-progress: a steady stop whose PR was CLOSED unmerged awaits nothing (step 7 resubmits only MERGED) → the closeout", async () => {
    const queue = newQueue();
    const { root, run } = await steadyStopped(queue);
    const t = { root, engagement: ENG };
    expect(lastRunEnded(queue, t, readEngagement(root, ENG)!)).toBeUndefined(); // sync: the merge still awaited
    expect(lastRunEnded(queue, t, readEngagement(root, ENG)!, true)?.run_id).toBe(run);
    const fx = deps({ lib: partialLib, prStates: { [PR_1]: "closed" } });
    expect((await closeoutPass(queue, fx.deps)).closed).toEqual([ENG]);
    expect(readEngagement(root, ENG)!.inputs.at(-1)).toMatchObject({ verb: "run-ended", from: "in-progress", to: "partial", run_id: run });
    expect(fx.notices).toHaveLength(1);
    expect(closeouts(queue)).toHaveLength(1);
  });

  test("in-progress: the same steady stop with its PR OPEN, MERGED (step 7's resubmit owed) or gh failing still holds back", async () => {
    for (const state of ["OPEN", "MERGED", undefined]) {
      const queue = newQueue();
      const { root } = await steadyStopped(queue);
      const fx = deps({ lib: partialLib, prStates: state ? { [PR_1]: state } : {} });
      expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
      expect(fx.ghCalls).toEqual([["pr", "view", PR_1, "--json", "state"]]);
      expect(fx.uvCalls).toEqual([]);
      expect(readEngagement(root, ENG)!.state).toBe("in-progress");
    }
    // a cap stop beside the closed PR's steady stop still holds back (no gh call: held by more than the PR)
    const queue = newQueue();
    const { run } = await steadyStopped(queue);
    queue.serviceEvent(RUN_STOP_EVENT, { engagement: ENG, project: "p", run_id: run, engine_run_id: "E1", reason: "cap", ok: true, detail: "" });
    const fx = deps({ lib: partialLib, prStates: { [PR_1]: "CLOSED" } });
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
    expect(fx.ghCalls).toEqual([]);
  });

  test("run-ended applied, the issue close transient, the record since moved on (go {cap} → in-progress, revise → scoping): no close, no notice, no event", async () => {
    for (const verb of ["go", "revise"] as const) {
      const queue = newQueue();
      const root = servedRoot(queue);
      const run = link(queue, root);
      await launch(queue, run);
      queue.end(run, "complete");
      const first = deps({ lib: partialLib, track: () => ({ ok: false, status: "partial", retry: true }) });
      expect((await closeoutPass(queue, first.deps)).closed).toEqual([]);
      expect(readEngagement(root, ENG)!.state).toBe("partial");
      expect(trackCalls(first)).toHaveLength(1);
      const moved = applyInput(readEngagement(root, ENG)!, { verb, payload: verb === "go" ? { cap: 80 } : {}, source: "bearer", at: "2026-10-25T09:00:00.000Z" });
      if (!moved.ok) throw new Error(`${verb} refused`);
      writeEngagement(root, moved.record);
      expect(readEngagement(root, ENG)!.state).toBe(verb === "go" ? "in-progress" : "scoping");
      const fx = deps({ lib: partialLib });
      expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
      expect(fx.uvCalls).toEqual([]);
      expect(fx.notices).toEqual([]);
      expect(closeouts(queue)).toEqual([]);
      expect(queue.serviceEvents("engagement-issue")).toEqual([]);
    }
  });

  test("another process's pass tells mid-pass (its engagement-closeout for the run): no second notice, no second event", async () => {
    // the success notice: the event recorded while this pass closes the issue
    const queue = newQueue();
    const { second } = await deliveredEngagement(queue);
    const other = { engagement: ENG, project: "p", run_id: second, outcome: "delivered", page: null, ok: true, notify: { ok: true, via: "other" } };
    const fx = deps({ prStates: { [PR_1]: "MERGED", [PR_2]: "MERGED" }, track: () => { queue.serviceEvent(CLOSEOUT_EVENT, other); return { ok: true, status: "complete", issue: ISSUE }; } });
    expect(await closeoutPass(queue, fx.deps)).toEqual({ closed: [], refused: [] });
    expect(fx.notices).toEqual([]);
    expect(closeouts(queue)).toEqual([other]);
    // the refusal notice: the event recorded while this pass's lib runs
    const queue2 = newQueue();
    const { second: second2 } = await deliveredEngagement(queue2);
    const other2 = { ...other, run_id: second2, outcome: null, ok: false, reason: "engage refused: NoScope" };
    const fx2 = deps({ lib: () => { queue2.serviceEvent(CLOSEOUT_EVENT, other2); return { ok: false, status: "blocked", engagement: ENG, outcome: null, page: null, written: [], reason: "engage refused: NoScope" }; } });
    expect(await closeoutPass(queue2, fx2.deps)).toEqual({ closed: [], refused: [] });
    expect(fx2.notices).toEqual([]);
    expect(closeouts(queue2)).toEqual([other2]);
  });
});

describe("Story 34.8: the slice's verdicts per story in the closeout input (AC2)", () => {
  test("a slice run's last host-verify gives one slice per story; a non-slice run gives none (no `slices` key)", async () => {
    const queue = newQueue();
    const root = servedRoot(queue);
    const job = "run-epic-41";
    const { run } = queue.enqueue({ jobId: job, root, projectId: "p", definition: { id: job, type: "run-vertical-slice" }, payload: { engagement: ENG, project: "p" } });
    queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job });
    await launch(queue, run.run_id, "E1");
    // the real order (`worktree.ts`): each completion notes its `host-verify` before that story's `close-out`
    queue.note(run.run_id, "host-verify", { green: true, engine: { verdict: "green" }, assets: { verdict: "green", steps: [] }, playable: { verdict: "pass", contact_sheet: "/store/sheets/leg-1.png" } });
    queue.note(run.run_id, "close-out", { story_key: "41-1-csv-button" });
    queue.note(run.run_id, "host-verify", { green: true, engine: { verdict: "green" }, assets: { verdict: "green", steps: [] }, playable: { verdict: "pass", contact_sheet: "/store/sheets/leg-2.png" } });
    queue.note(run.run_id, "close-out", { story_key: "41-2-filtered-export" });
    queue.end(run.run_id, "complete", null, { detail: { pr: PR_1 } });
    const fx = deps();
    const input = await composeCloseout(queue, fx.deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(run.run_id)!);
    expect(input.slices).toEqual([
      { story: "41-1-csv-button", engine: "green", assets: "green", playable: "pass", contact_sheet: "/store/sheets/leg-1.png" },
      { story: "41-2-filtered-export", engine: "green", assets: "green", playable: "pass", contact_sheet: "/store/sheets/leg-2.png" },
    ]);

    const plain = newQueue();
    const plainRoot = servedRoot(plain);
    const r = link(plain, plainRoot);
    await launch(plain, r, "E2");
    plain.note(r, "close-out", { story_key: "41-1-csv-button" });
    plain.note(r, "host-verify", { green: true, engine: { verdict: "green" }, playable: { verdict: "skipped", reason: "no playable" } });
    plain.end(r, "complete", null, { detail: { pr: PR_1 } });
    const plainInput = await composeCloseout(plain, fx.deps, { root: plainRoot, engagement: ENG }, readEngagement(plainRoot, ENG)!, plain.get(r)!);
    expect("slices" in plainInput).toBe(false);
  });

  test("Story 35.6: a later host-verify (a re-run on the branch tip) supersedes only the last story's leg; the earlier story keeps its own", async () => {
    const queue = newQueue();
    const root = servedRoot(queue);
    const { run } = queue.enqueue({ jobId: "run-epic-41", root, projectId: "p", definition: { id: "run-epic-41", type: "run-vertical-slice" }, payload: { engagement: ENG, project: "p" } });
    queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job: "run-epic-41" });
    await launch(queue, run.run_id, "E1");
    queue.note(run.run_id, "host-verify", { green: true, engine: { verdict: "green" }, assets: { verdict: "green", steps: [] }, playable: { verdict: "pass", contact_sheet: "/store/sheets/leg-1.png" } });
    queue.note(run.run_id, "close-out", { story_key: "41-1-csv-button" });
    queue.note(run.run_id, "host-verify", { green: true, engine: { verdict: "green" }, assets: { verdict: "green", steps: [] }, playable: { verdict: "pass", contact_sheet: "/store/sheets/leg-2.png" } });
    queue.note(run.run_id, "close-out", { story_key: "41-2-filtered-export" });
    queue.end(run.run_id, "complete", null, {});
    queue.note(run.run_id, "host-verify", { green: false, reason: "host verify red (assets): x", engine: { verdict: "green" }, assets: { verdict: "red", steps: [] }, playable: { verdict: "fail", contact_sheet: "/store/sheets/leg-3.png" } });
    const input = await composeCloseout(queue, deps().deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(run.run_id)!);
    expect(input.slices).toEqual([
      { story: "41-1-csv-button", engine: "green", assets: "green", playable: "pass", contact_sheet: "/store/sheets/leg-1.png" },
      { story: "41-2-filtered-export", engine: "green", assets: "red", playable: "fail", contact_sheet: "/store/sheets/leg-3.png" },
    ]);
  });

  test("Story 35.6: each story carries its own leg's report and frames; absent when the leg has none", async () => {
    const queue = newQueue();
    const root = servedRoot(queue);
    const { run } = queue.enqueue({ jobId: "run-epic-41", root, projectId: "p", definition: { id: "run-epic-41", type: "run-vertical-slice" }, payload: { engagement: ENG, project: "p" } });
    queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job: "run-epic-41" });
    await launch(queue, run.run_id, "E1");
    const leg = (stamp: string) => ({
      verdict: "pass", contact_sheet: `/store/sheets/${stamp}.png`, report: `/store/legs/${stamp}/report.json`,
      leg_frames: [`/store/legs/${stamp}/frames/tick-000000.png`, `/store/legs/${stamp}/frames/tick-000030.png`],
      frames: ["/store/frames/tick-000000.png"], sampled: ["tick-000000.png", "tick-000030.png"],
    });
    queue.note(run.run_id, "host-verify", { green: true, engine: { verdict: "green" }, assets: { verdict: "green", steps: [] }, playable: leg("1-1-1") });
    queue.note(run.run_id, "close-out", { story_key: "41-1-csv-button" });
    queue.note(run.run_id, "host-verify", { green: true, engine: { verdict: "green" }, assets: { verdict: "green", steps: [] }, playable: leg("2-2-2") });
    queue.note(run.run_id, "close-out", { story_key: "41-2-filtered-export" });
    // a paused-ruling close-out runs no leg: its window holds none
    queue.note(run.run_id, "close-out", { story_key: "41-3-paused" });
    queue.end(run.run_id, "complete", null, {});
    const input = await composeCloseout(queue, deps().deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(run.run_id)!);
    expect(input.slices).toEqual([
      { story: "41-1-csv-button", engine: "green", assets: "green", playable: "pass", contact_sheet: "/store/sheets/1-1-1.png",
        report: "/store/legs/1-1-1/report.json", frames: ["/store/legs/1-1-1/frames/tick-000000.png", "/store/legs/1-1-1/frames/tick-000030.png"] },
      { story: "41-2-filtered-export", engine: "green", assets: "green", playable: "pass", contact_sheet: "/store/sheets/2-2-2.png",
        report: "/store/legs/2-2-2/report.json", frames: ["/store/legs/2-2-2/frames/tick-000000.png", "/store/legs/2-2-2/frames/tick-000030.png"] },
      { story: "41-3-paused", engine: "not run", assets: "not run", playable: "not run" },
    ]);
  });

  test("Story 35.6: storyLegs windows: a landed key with no close-out takes the window after the run's last close-out", () => {
    const ev = (kind: string, detail: Record<string, unknown>) => ({ kind, detail }) as any;
    const a = { leg: "a" }, b = { leg: "b" }, c = { leg: "c" };
    const events = [ev("host-verify", a), ev("close-out", { story_key: "A" }), ev("close-out", { story_key: "B" }), ev("host-verify", b), ev("host-verify", c)];
    const legs = storyLegs(events, ["A", "B", "L"]);
    expect(legs.get("A")).toBe(a);
    expect(legs.get("B")).toBe(c); // the last story takes the re-runs after its close-out
    expect(legs.get("L")).toBe(c); // after the last close-out
    expect(storyLegs([ev("close-out", { story_key: "A" })], ["A"]).get("A")).toBeUndefined();
    expect(storyLegs([ev("host-verify", a)], ["run-1"]).get("run-1")).toBe(a);
  });

  test("a slice run with no host-verify event reads `not run`; a skipped leg reads `skipped`", async () => {
    for (const [hv, want] of [[undefined, "not run"], [{ skipped: true, reason: "worktree gone" }, "skipped"]] as const) {
      const queue = newQueue();
      const root = servedRoot(queue);
      const { run } = queue.enqueue({ jobId: "run-epic-41", root, projectId: "p", definition: { id: "run-epic-41", type: "run-vertical-slice" }, payload: { engagement: ENG, project: "p" } });
      queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job: "run-epic-41" });
      await launch(queue, run.run_id, "E1");
      if (hv) queue.note(run.run_id, "host-verify", hv);
      queue.end(run.run_id, "complete", null, {});
      const input = await composeCloseout(queue, deps().deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(run.run_id)!);
      expect(input.slices).toEqual([{ story: run.run_id, engine: want, assets: want, playable: want }]);
    }
  });

  test("one story key in two linked slice runs (a resubmit): one slice line, the later run's", async () => {
    const queue = newQueue();
    const root = servedRoot(queue);
    const slice = (after?: string) => {
      const { run } = queue.enqueue({ jobId: "run-epic-41", root, projectId: "p", definition: { id: "run-epic-41", type: "run-vertical-slice" }, payload: { engagement: ENG, project: "p" } });
      queue.serviceEvent(RUN_QUEUED_EVENT, { engagement: ENG, project: "p", run_id: run.run_id, job: "run-epic-41", ...(after ? { after_run: after } : {}) });
      return run.run_id;
    };
    const first = slice();
    await launch(queue, first, "E1");
    queue.note(first, "host-verify", { green: false, engine: { verdict: "green" }, assets: { verdict: "red", steps: [] }, playable: { verdict: "skipped" } });
    queue.note(first, "close-out", { story_key: "41-1-csv-button" });
    queue.end(first, "partial", null, {});
    const second = slice(first);
    await launch(queue, second, "E2");
    queue.note(second, "host-verify", { green: true, engine: { verdict: "green" }, assets: { verdict: "green", steps: [] }, playable: { verdict: "pass", contact_sheet: "/store/s-2/contact-sheet.png" } });
    queue.note(second, "close-out", { story_key: "41-1-csv-button" });
    queue.end(second, "complete", null, {});
    const input = await composeCloseout(queue, deps().deps, { root, engagement: ENG }, readEngagement(root, ENG)!, queue.get(second)!);
    expect(input.slices).toEqual([{ story: "41-1-csv-button", engine: "green", assets: "green", playable: "pass", contact_sheet: "/store/s-2/contact-sheet.png" }]);
  });
});
