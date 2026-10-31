import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { finishRun, mirror, type Started } from "../src/cli";
import { Queue } from "../src/queue";
import {
  extractStatusBlock, finishStateFor, hasMalformedStatusBlock, MALFORMED_STATUS_BLOCK, MISSING_STATUS_BLOCK, parseWorkerResult,
} from "../src/server";
import { tempDir, track } from "./tmp";

const block = (status: string, extra = "") => `{"status":"${status}","intent":"tk-studio-activate","artifacts":[]${extra}}`;

describe("status-block extraction (§3: last balanced object with string status+intent)", () => {
  test("keeps the LAST qualifying block", () => {
    const text = `first ${block("partial", ',"reason":"x"')}\nthen ${block("complete")}`;
    expect(extractStatusBlock(text)?.status).toBe("complete");
  });

  test("a later non-block object does not displace the block", () => {
    const text = `${block("complete")}\ntrailing {"note":"not a block"} and {"status":1,"intent":"x"}`;
    expect(extractStatusBlock(text)?.status).toBe("complete");
  });

  test("braces inside strings do not break the scan", () => {
    const text = `chatter "{" ${block("blocked", ',"reason":"saw } and { in text"')}`;
    expect(extractStatusBlock(text)).toMatchObject({ status: "blocked", reason: "saw } and { in text" });
  });

  test("an unclosed brace in chatter does not swallow a trailing block", () => {
    expect(extractStatusBlock(`oops { never closed\n${block("complete")}`)?.status).toBe("complete");
  });

  test("nested objects are part of the top-level block", () => {
    const text = `{"status":"complete","intent":"tk-studio-activate","artifacts":[],"detail":{"status":"inner"}}`;
    expect(extractStatusBlock(text)?.detail).toEqual({ status: "inner" });
  });

  test("missing block → null, and the failure is named (AD-11)", () => {
    expect(extractStatusBlock("all done, no JSON here")).toBeNull();
    expect(extractStatusBlock(`{"status":"complete"}`)).toBeNull(); // intent missing
    expect(MISSING_STATUS_BLOCK).toMatch(/conformance failure \(AD-11\)/);
  });
});

describe("worker --output-format json result", () => {
  test("the block rides `result`; the cost rides `total_cost_usd`", () => {
    const stdout = JSON.stringify({ type: "result", is_error: false, result: `ok\n${block("complete")}`, total_cost_usd: 0.042 });
    const parsed = parseWorkerResult(stdout);
    expect(parsed.totalCostUsd).toBe(0.042);
    expect(extractStatusBlock(parsed.text)?.status).toBe("complete");
  });

  test("no cost when the result omits it; error flag carried", () => {
    const parsed = parseWorkerResult(JSON.stringify({ type: "result", is_error: true, result: "API Error: 401" }));
    expect(parsed).toEqual({ text: "API Error: 401", isError: true });
  });

  test("error subtypes with no string `result` still carry the cost", () => {
    for (const subtype of ["error_max_turns", "error_during_execution"]) {
      const stdout = JSON.stringify({ type: "result", subtype, is_error: true, total_cost_usd: 0.31 });
      expect(parseWorkerResult(stdout)).toMatchObject({ isError: true, totalCostUsd: 0.31 });
    }
  });

  test("non-JSON stdout falls back to the raw text", () => {
    expect(parseWorkerResult(`plain ${block("complete")}`).text).toContain("plain");
  });
});

describe("finish state mapping", () => {
  test("the schema's complete|partial|blocked pass through; anything else, cancelled included, is partial", () => {
    for (const s of ["complete", "partial", "blocked"]) expect(finishStateFor(s)).toBe(s as any);
    expect(finishStateFor("cancelled")).toBe("partial");
    expect(finishStateFor("done")).toBe("partial");
  });
});

describe("Story 36.5 (M7, hole 98): a block missing `intent` is malformed, not absent", () => {
  const started = (): Started => ({
    jobId: "j", root: "proj", projectId: "p", runId: "j-1", guardS: 600, jobGuardS: 600, sessionId: "sid",
    defn: { id: "j", trigger: "one-shot", target: { skill: "tk-studio-evals" }, guards: {} },
    woke: { state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-evals", payload: {} } },
  } as unknown as Started);

  test("a non-§3 `status` reads absent: a worker quoting a tool's JSON keeps its resume", () => {
    for (const quoted of [`{"status":"success"}`, `the tool said {"status":"ok","count":3} and I stopped`, `{"status":"Blocked"}`, `{"status":""}`]) {
      expect(hasMalformedStatusBlock(quoted)).toBe(false);
      expect(extractStatusBlock(quoted)).toBeNull();
    }
  });

  test("each §3 `status` with no `intent` reads malformed", () => {
    for (const status of ["complete", "partial", "blocked"]) expect(hasMalformedStatusBlock(JSON.stringify({ status, reason: "x" }))).toBe(true);
  });

  test("a balanced object with a §3 `status` and no string `intent`; chatter or a whole block is not", () => {
    expect(hasMalformedStatusBlock(`done {"status":"blocked","reason":"no skill"}`)).toBe(true);
    expect(hasMalformedStatusBlock(`{"status":"blocked","intent":3}`)).toBe(true);
    expect(hasMalformedStatusBlock(`no json at all {"other":1}`)).toBe(false);
    expect(hasMalformedStatusBlock(`{"status":3}`)).toBe(false);
    expect(MALFORMED_STATUS_BLOCK).toBe("conformance failure (AD-11): status block malformed: missing intent");
  });

  test("`finishRun` ends it `partial` naming the block, one worker, no resume; a truly absent block keeps its resume path", async () => {
    let invokes = 0;
    const verbs: string[][] = [];
    const out = await finishRun(started(), async (_r, a) => { verbs.push(a); return { ok: true, state: "partial" }; },
      (async () => { invokes++; return { ran: true, exit: 0, worker_elapsed_s: 1, conformance_failure: MALFORMED_STATUS_BLOCK }; }) as never);
    expect(invokes).toBe(1);
    expect(out).toMatchObject({ state: "partial", reason: MALFORMED_STATUS_BLOCK });
    expect(out.own_block).toBeUndefined();
    expect(verbs.find((a) => a[0] === "finish")).toEqual(expect.arrayContaining(["--state", "partial", "--reason", MALFORMED_STATUS_BLOCK]));
    expect(verbs.find((a) => a[0] === "finish")).not.toContain("--own-block");

    const absent = await finishRun(started(), async () => ({ ok: true, runs: [{ state: "complete" }] }),
      (async () => ({ ran: true, exit: 0, worker_elapsed_s: 1, conformance_failure: MISSING_STATUS_BLOCK })) as never);
    expect(String(absent.reason)).toStartWith(MISSING_STATUS_BLOCK);
  });
});

describe("Story 36.5 (M4): `finishRun` carries the marker to `finish --own-block`, the summary and only a `blocked` end", () => {
  test("a pin's block: `--own-block pin`, `own_block` on the summary; a block the worker wrote: neither", async () => {
    const started = {
      jobId: "j", root: "proj", projectId: "p", runId: "j-1", guardS: 600, jobGuardS: 600,
      defn: { id: "j", trigger: "one-shot", target: { skill: "tk-studio-evals" }, guards: {} },
      woke: { state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-evals", payload: {} } },
    } as unknown as Started;
    const verbs: string[][] = [];
    const runner = async (_r: string, a: string[]) => { verbs.push(a); return { ok: true, state: "blocked" }; };
    const blocked = { status: "blocked", intent: "tk-studio-evals", artifacts: [], reason: "sbx pin failed: x" };
    const own = await finishRun(started, runner, (async () => ({ ran: false, status_block: blocked, pin: "sbx pin failed: x", own_block: "pin" })) as never);
    expect(own).toMatchObject({ state: "blocked", own_block: "pin" });
    expect(verbs.find((a) => a[0] === "finish")).toEqual(expect.arrayContaining(["--own-block", "pin"]));
    verbs.length = 0;
    const engine = await finishRun(started, runner, (async () => ({ ran: true, exit: 0, worker_elapsed_s: 1, status_block: blocked })) as never);
    expect(engine.own_block).toBeUndefined();
    expect(verbs.find((a) => a[0] === "finish")).not.toContain("--own-block");
  });
});

describe("Story 36.5: a `finish` that did not land keeps the marker only if the studio run carries it", () => {
  const STUDIO_RUN = "j-1";
  const defn = { id: "j", trigger: "one-shot", target: { skill: "tk-studio-evals" }, stop: { on_status: ["blocked"] }, guards: {} };
  const started = {
    jobId: "j", root: "proj", projectId: "p", runId: STUDIO_RUN, guardS: 600, jobGuardS: 600, defn,
    woke: { run_id: STUDIO_RUN, state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-evals", payload: {} } },
  } as unknown as Started;
  const pinBlock = { status: "blocked", intent: "tk-studio-evals", artifacts: [], reason: "sbx pin failed: x" };
  const pinInvoke = (async () => ({ ran: false, status_block: pinBlock, pin: "sbx pin failed: x", own_block: "pin" })) as never;
  /** `finish` throws; `status` answers `run`, or throws when `run` is null. */
  const refusing = (run: Record<string, unknown> | null) => async (_root: string, args: string[]) => {
    if (args[0] === "finish") throw new Error("run is already terminal");
    if (args[0] === "status") { if (!run) throw new Error("status unreadable"); return { runs: [run] }; }
    return { ok: true };
  };
  const mirrored = async (summary: Awaited<ReturnType<typeof finishRun>>, runner: ReturnType<typeof refusing>) => {
    const q = track(new Queue(join(tempDir("tk-sup-own-refused-q-"), "q.db"), { ownerAlive: () => true, engineLive: async () => ({ live: false }) }));
    const { run } = q.enqueue({ jobId: "j", root: tempDir("tk-sup-own-refused-co-"), target: "skill", definition: defn });
    await mirror(q, run.run_id, { jobId: "j", defn }, summary, runner);
    return q.events(run.run_id);
  };

  test("Story 36.5: a refused finish whose studio run ended without the marker: no `own_block`, and `mirror`'s on_status stop fires", async () => {
    const runner = refusing({ run_id: STUDIO_RUN, state: "blocked" });
    const summary = await finishRun(started, runner, pinInvoke);
    expect(summary).toMatchObject({ state: "blocked", finish_refused: { actual_state: "blocked" } });
    expect(summary.own_block).toBeUndefined();
    const events = await mirrored(summary, runner);
    expect(events.find((e) => e.kind === "stopped")).toBeDefined();
    expect(events.findLast((e) => e.kind === "ended")!.detail).not.toHaveProperty("own_block");
  });

  test("Story 36.5: a refused finish whose studio run carries the marker keeps the run's value: no stop", async () => {
    const runner = refusing({ run_id: STUDIO_RUN, state: "blocked", own_block: "worktree" });
    const summary = await finishRun(started, runner, pinInvoke);
    expect(summary).toMatchObject({ state: "blocked", own_block: "worktree", finish_refused: { actual_state: "blocked" } });
    const events = await mirrored(summary, runner);
    expect(events.map((e) => e.kind)).not.toContain("stopped");
    expect(events.findLast((e) => e.kind === "ended")!.detail).toMatchObject({ own_block: "worktree" });
  });

  test("Story 36.5: a refused finish with no marker from this pass, the studio run's `own_block`, a recorded worker: no stop, `mirror`'s launch probe decides, no own release", async () => {
    const launchDefn = { id: "j", trigger: "one-shot", target: { skill: "tk-studio-launch" }, stop: { on_status: ["blocked"] }, guards: {} };
    const launchStarted = { ...started, defn: launchDefn, woke: { ...started.woke, directive: { kind: "invoke-skill", skill: "tk-studio-launch", payload: {} } } } as unknown as Started;
    const workerBlock = { status: "partial", intent: "tk-studio-launch", artifacts: [] };
    const runner = refusing({ run_id: STUDIO_RUN, state: "blocked", own_block: "pin" });
    const verbs: string[][] = [];
    const summary = await finishRun(launchStarted, async (r, a) => { verbs.push(a); return runner(r, a); },
      (async () => ({ ran: true, exit: 0, worker_elapsed_s: 1, status_block: workerBlock })) as never);
    // This pass held no marker: the worker ended `partial`, and the marker is only the status read's.
    expect(verbs.find((a) => a[0] === "finish")).toEqual(expect.arrayContaining(["--state", "partial"]));
    expect(verbs.find((a) => a[0] === "finish")).not.toContain("--own-block");
    expect(summary).toMatchObject({ state: "blocked", own_block: "pin", finish_refused: { actual_state: "blocked" } });

    const probes: string[] = [];
    const q = track(new Queue(join(tempDir("tk-sup-own-refused-q-"), "q.db"), {
      ownerAlive: () => true,
      engineLive: async (root) => { probes.push(root); return { live: true, run_ids: ["E9"] }; },
    }));
    const checkout = tempDir("tk-sup-own-refused-co-");
    const worktree = tempDir("tk-sup-own-refused-wt-");
    const { run } = q.enqueue({ jobId: "j", root: checkout, target: "skill", definition: launchDefn });
    expect((await q.claim(run.run_id)).claimed).toBe(true);
    q.recordWorktree(run.run_id, worktree, { branch: "b", base_ref: "main" });
    q.markVerbStarted(run.run_id, "wake", [], { target: "skill", definition: launchDefn });
    const recorded = q.setWorker(run.run_id, 910001, null);
    expect(q.ownBlockRulesOutEngine(recorded)).toBe(false);

    await mirror(q, run.run_id, { jobId: "j", defn: launchDefn } as never, summary, runner);
    const events = q.events(run.run_id);
    expect(events.map((e) => e.kind)).not.toContain("stopped");
    // One probe, and it is `mirror`'s: `endDriven` would probe too, but only `mirror`'s skips the close-out.
    expect(probes).toHaveLength(1);
    expect(events.findLast((e) => e.kind === "ended")!.detail).toMatchObject({
      own_block: "pin", engine: { handed_to_engine: "E9" }, lock: { handed_to_engine: "E9" },
      closeout: { result: "skipped", why: "an engine may still work the worktree", worktree: "kept" },
    });
    expect(q.get(run.run_id)).toMatchObject({ state: "blocked", engine_run_id: "E9" });
    expect(q.lock(checkout)).toMatchObject({ kind: "engine", engine_run_id: "E9", run_id: run.run_id });
  });

  test.each([["still running", { run_id: STUDIO_RUN, state: "running" }, "running"], ["status unreadable", null, "unknown"]] as const)(
    "Story 36.5: `finish failed:` with the studio run %s: no `own_block`", async (_name, run, state) => {
      const summary = await finishRun(started, refusing(run), pinInvoke);
      expect(summary).toMatchObject({ state, reason: "finish failed: run is already terminal" });
      expect(summary.own_block).toBeUndefined();
    });
});
