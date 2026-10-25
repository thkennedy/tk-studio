// Story 32.2: the engagement chat — the file (append under `chat.lock`, read since), the turn (`stack`: a second turn
// mints behind a live chat run and waits on the checkout lock; the per-run payload; `chat-queued`), the payload the
// skill receives at run start, the spend pass into `spend.planning_usd`, and the worker's environment for a chat run.
// Every planner is a fake: no `claude`, no `uv` job, no registry.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendChatLine, CHAT_LOCK_STALE_MS, ChatBusy, chatFile, chatSince, chatSpendPass, checkChatBody, mintChatTurn, prepareChatTurn, readChat,
  takeOverStale, withChatLock, withChatLockAsync, type ChatDeps,
} from "../src/chat";
import { finishRun, type Started } from "../src/cli";
import { prepareWorktree, type WorktreeDeps } from "../src/worktree";
import { fakeGh, gitRepo } from "./fakes";
import { spawnSync } from "node:child_process";
import { newEngagement, readEngagement, writeEngagement } from "../src/engagement";
import { ENGAGEMENT_CHAT_JOB, Queue, type Owner } from "../src/queue";
import { withQueuedPayload, withStoredPayload } from "../src/resolution";
import { buildWorkerEnv, invokeSkill, runProcess, type RunResult, type Spawner } from "../src/server";

const made: string[] = [];
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };
// Windows: an open SQLite handle makes the temp dir EBUSY, so every queue the suite opened is closed before the rm.
const queues: Queue[] = [];
afterAll(() => {
  for (const q of queues) { try { q.close(); } catch { /* already closed */ } }
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const AT = "2026-10-25T05:00:00.000Z";
const me: Owner = { pid: process.pid, host: hostname(), nonce: "chat-test" };
const other: Owner = { pid: 910777, host: hostname(), nonce: "chat-test-other" };
const SHIPPED_CHAT = {
  job_schema_version: 1, id: ENGAGEMENT_CHAT_JOB, trigger: "one-shot",
  target: { skill: "tk-studio-engage", payload: { verb: "reply" } },
  guards: { max_turns: 80, max_wall_clock_seconds: 1800 }, stop: { until: "9999-12-31T23:59:59Z" },
};

/** A served root with ENG-001 in `intake` and the planner leg in `.bmad-loop/routing.current.json`. */
function served(o: { routing?: boolean } = {}) {
  const root = temp("tk-sup-chat-root-");
  writeEngagement(root, newEngagement("ENG-001", "p", "Build the export", AT));
  if (o.routing !== false) {
    mkdirSync(join(root, ".bmad-loop"), { recursive: true });
    writeFileSync(join(root, ".bmad-loop", "routing.current.json"), JSON.stringify({ planner: { model: "claude-opus-5-5", effort: "high" } }));
  }
  return root;
}

const fakeDeps = (): ChatDeps => ({
  resolveJob: async (r) => ({ projectId: "p", root: r, definition: structuredClone(SHIPPED_CHAT), target: "skill" }),
});

const newQueue = (alive = new Set<number>([me.pid])) => {
  const q = new Queue(join(temp("tk-sup-chat-q-"), "q.db"), { ownerAlive: (o) => alive.has(o.pid), engineLive: async () => ({ live: false }) });
  queues.push(q);
  return q;
};

describe("the chat file (Settled shape 3)", () => {
  test("appendChatLine: seq grows by 1 from 1, the line as given, one JSON object per line; chatSince reads after a seq", () => {
    const root = served();
    const a = appendChatLine(root, "ENG-001", { at: AT, author: "owner", body: "hello" });
    const b = appendChatLine(root, "ENG-001", { at: AT, author: "planner", body: "hi", run_id: "r1", proposals: [] });
    expect(a).toEqual({ seq: 1, at: AT, author: "owner", body: "hello" });
    expect(b.seq).toBe(2);
    expect(readFileSync(chatFile(root, "ENG-001"), "utf-8").split("\n")).toEqual([JSON.stringify(a), JSON.stringify(b), ""]);
    expect(chatSince(root, "ENG-001", 1)).toEqual([b]);
    expect(chatSince(root, "ENG-001", 2)).toEqual([]);
    expect(existsSync(join(root, "_bmad-output", "engagements", "ENG-001", "chat.lock"))).toBe(false);
  });

  test("the last seq is re-read inside the lock: a line another writer appended (engage.py) is counted; a torn line is skipped", () => {
    const root = served();
    appendChatLine(root, "ENG-001", { at: AT, author: "owner", body: "one" });
    writeFileSync(chatFile(root, "ENG-001"), readFileSync(chatFile(root, "ENG-001"), "utf-8")
      + JSON.stringify({ seq: 2, at: AT, author: "planner", body: "two", run_id: "r", proposals: [] }) + "\n{\"seq\": 7, \"bo");
    expect(appendChatLine(root, "ENG-001", { at: AT, author: "owner", body: "three" }).seq).toBe(3);
    expect(readChat(root, "ENG-001").map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  test("chat.lock: a held lock is ChatBusy after the wait (nothing written); a lock older than 30 s is stale and taken over", () => {
    const root = served();
    const lock = join(root, "_bmad-output", "engagements", "ENG-001", "chat.lock");
    writeFileSync(lock, "");
    expect(() => withChatLock(root, "ENG-001", () => "ran", 0)).toThrow(ChatBusy);
    expect(existsSync(chatFile(root, "ENG-001"))).toBe(false);
    const old = new Date(Date.now() - CHAT_LOCK_STALE_MS - 5000);
    utimesSync(lock, old, old);
    expect(withChatLock(root, "ENG-001", () => "ran", 0)).toBe("ran");
    expect(existsSync(lock)).toBe(false);
  });

  test("checkChatBody: {message} only, a non-empty string at most 32 KiB UTF-8", () => {
    expect(checkChatBody({ message: "hi" })).toEqual({ ok: true, message: "hi" });
    expect(checkChatBody({ message: "é".repeat(16 * 1024) }).ok).toBe(true);
    for (const raw of [{ message: "é".repeat(16 * 1024) + "x" }, { message: "  " }, { message: 3 }, {}, { message: "x", seq: 1 }, [1], null]) {
      expect(checkChatBody(raw).ok).toBe(false);
    }
  });
});

describe("chat.lock takeover and the route's wait (review patches)", () => {
  test("takeOverStale: a stale lock is renamed aside and removed; a lock retaken meanwhile (fresh when moved) is put back, never stolen; a gone lock is a no-op", () => {
    const root = served();
    const dir = join(root, "_bmad-output", "engagements", "ENG-001");
    const lock = join(dir, "chat.lock");
    const locks = () => readdirSync(dir).filter((n) => n.startsWith("chat.lock")).sort();
    writeFileSync(lock, "");
    const old = new Date(Date.now() - CHAT_LOCK_STALE_MS - 5000);
    utimesSync(lock, old, old);
    takeOverStale(lock);
    expect(locks()).toEqual([]);
    // another writer retook the lock between this writer's stat and its rename: what is moved is fresh
    writeFileSync(lock, "");
    takeOverStale(lock);
    expect(locks()).toEqual(["chat.lock"]);
    rmSync(lock);
    takeOverStale(lock);
    expect(locks()).toEqual([]);
  });

  test("withChatLockAsync: the wait yields to the event loop (a timer fires meanwhile), then the lock is taken once released; held past the wait, ChatBusy", async () => {
    const root = served();
    const lock = join(root, "_bmad-output", "engagements", "ENG-001", "chat.lock");
    writeFileSync(lock, "");
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    setTimeout(() => rmSync(lock), 80);
    try {
      expect(await withChatLockAsync(root, "ENG-001", () => "ran", 2_000)).toBe("ran");
    } finally { clearInterval(timer); }
    expect(ticks).toBeGreaterThan(3);
    expect(existsSync(lock)).toBe(false);
    writeFileSync(lock, "");
    await expect(withChatLockAsync(root, "ENG-001", () => "ran", 50)).rejects.toThrow(ChatBusy);
  });
});

describe("the turn (Settled shape 2)", () => {
  test("one engagement-chat run per line: host tier, the planner leg, the per-run payload on its enqueued event, then chat-queued", async () => {
    const root = served();
    const queue = newQueue();
    const prepared = await prepareChatTurn(fakeDeps(), root);
    const minted = mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 1 });
    const run = queue.get(minted.run_id)!;
    expect(run).toMatchObject({ job_id: ENGAGEMENT_CHAT_JOB, state: "queued", tier: "host", model: "claude-opus-5-5", effort: "high", project_id: "p", target: "skill" });
    expect(queue.runPayload(run.run_id)).toEqual({ engagement: "ENG-001", project: "p", project_root: root, seq: 1 });
    expect(queue.events(run.run_id)[0]).toMatchObject({ kind: "enqueued", detail: { tier: "host", model: "claude-opus-5-5", effort: "high", payload: { engagement: "ENG-001", project: "p", project_root: root, seq: 1 } } });
    expect(queue.serviceEvents("chat-queued").map((e) => e.detail)).toEqual([
      { engagement: "ENG-001", project: "p", seq: 1, run_id: run.run_id, model: "claude-opus-5-5", effort: "high" },
    ]);
    // no routing: the job's own (no model, no effort recorded)
    const bare = served({ routing: false });
    const m2 = mintChatTurn(queue, await prepareChatTurn(fakeDeps(), bare), { engagement: "ENG-001", project: "p", root: bare, seq: 1 });
    expect(queue.get(m2.run_id)).toMatchObject({ tier: "host", model: null, effort: null });
    expect(queue.serviceEvents("chat-queued").at(-1)?.detail).toMatchObject({ model: null, effort: null });
  });

  test("a turn sent while a chat run is live mints behind it (stack) and waits on the checkout lock — never refused, never adopted", async () => {
    const root = served();
    const queue = newQueue(new Set([me.pid, other.pid]));
    const prepared = await prepareChatTurn(fakeDeps(), root);
    const first = mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 1 });
    expect((await queue.claim(first.run_id, me)).claimed).toBe(true);
    expect(queue.get(first.run_id)!.state).toBe("running");
    const second = mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 3 });
    expect(second.run_id).not.toBe(first.run_id);
    expect(queue.runPayload(second.run_id)).toEqual({ engagement: "ENG-001", project: "p", project_root: root, seq: 3 });
    expect(queue.runPayload(first.run_id)).toEqual({ engagement: "ENG-001", project: "p", project_root: root, seq: 1 }); // per run, never overwritten
    const waited = await queue.claim(second.run_id, other);
    expect(waited.claimed).toBe(false);
    expect(waited).toMatchObject({ why: "lock" });
    expect(queue.events(second.run_id).at(-1)?.kind).toBe("lock-wait");
    expect(queue.get(second.run_id)!.state).toBe("queued");
    expect(queue.serviceEvents("chat-queued").map((e) => e.detail?.seq)).toEqual([1, 3]);
  });

  test("the skill receives {verb: reply, engagement, project, project_root, seq, run_id} at run start (withStoredPayload, then withQueuedPayload)", async () => {
    const root = served();
    const queue = newQueue();
    const prepared = await prepareChatTurn(fakeDeps(), root);
    const a = mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 1 });
    mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 3 }); // the job row now holds seq 3
    const run = queue.get(a.run_id)!;
    // run start: the definition re-resolved (the shipped `{verb: reply}`), then this run's own payload overlaid
    const defn = withStoredPayload(run.job_id, structuredClone(SHIPPED_CHAT), queue.definition(run), { run_id: run.run_id, payload: queue.runPayload(run.run_id) });
    expect(defn.target).toEqual({ skill: "tk-studio-engage", payload: { verb: "reply", engagement: "ENG-001", project: "p", project_root: root, seq: 1, run_id: run.run_id } });
    // `jobrun.py submit` answers the shipped payload only; the overlay delivers the run's
    const woke = withQueuedPayload(run.job_id, { accepted: true, run_id: "studio-1", directive: { kind: "invoke-skill", skill: "tk-studio-engage", payload: { verb: "reply" } } }, defn);
    expect(woke.directive.payload).toEqual({ verb: "reply", engagement: "ENG-001", project: "p", project_root: root, seq: 1, run_id: run.run_id });
    // no per-run payload (a run minted by POST /jobs): unchanged
    const plain = structuredClone(SHIPPED_CHAT);
    expect(withStoredPayload(ENGAGEMENT_CHAT_JOB, plain, null, { run_id: "x", payload: null })).toBe(plain);
  });

  test("stack is opt-in: every other enqueue still adopts the live run of its (job, checkout)", () => {
    const root = served();
    const queue = newQueue();
    const defn = { id: "studio-health", trigger: "one-shot", target: { skill: "tk-studio-activate" } };
    const a = queue.enqueue({ jobId: "studio-health", root, definition: defn });
    const b = queue.enqueue({ jobId: "studio-health", root, definition: defn });
    expect(a.minted).toBe(true);
    expect(b).toMatchObject({ minted: false, run: { run_id: a.run.run_id } });
    // an engagement-chat enqueue without `stack` adopts as well (only the chat route passes it)
    const c1 = queue.enqueue({ jobId: ENGAGEMENT_CHAT_JOB, root, definition: SHIPPED_CHAT });
    const c2 = queue.enqueue({ jobId: ENGAGEMENT_CHAT_JOB, root, definition: SHIPPED_CHAT });
    expect(c2).toMatchObject({ minted: false, run: { run_id: c1.run.run_id } });
  });
});

describe("the spend (Settled shape 5)", () => {
  const jobRun = (studio: string, usd: number) => JSON.stringify({ event: "job-run", project: "p", payload: { run_id: studio, job_id: ENGAGEMENT_CHAT_JOB, total_cost_usd: usd } });

  test("two chat-queued runs costing 0.5 and 0.25: spend.planning_usd 0.75, the record rewritten once, no engagement event", async () => {
    const root = served();
    const queue = newQueue();
    const prepared = await prepareChatTurn(fakeDeps(), root);
    const a = mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 1 });
    const b = mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 3 });
    const c = mintChatTurn(queue, prepared, { engagement: "ENG-001", project: "p", root, seq: 5 }); // no studio run yet: 0
    queue.setStudioRun(a.run_id, "studio-a");
    queue.setStudioRun(b.run_id, "studio-b");
    const ledger = join(temp("tk-sup-chat-ledger-"), "me-host.jsonl");
    writeFileSync(ledger, [jobRun("studio-a", 0.5), "{torn", jobRun("studio-b", 0.25), jobRun("studio-x", 9), ""].join("\n"));
    const before = readEngagement(root, "ENG-001")!;
    expect(chatSpendPass(queue, { ledgerFile: ledger })).toEqual({ updated: ["ENG-001"] });
    const after = readEngagement(root, "ENG-001")!;
    expect(after.spend).toEqual({ planning_usd: 0.75, runs_usd: 0 });
    expect(after.state).toBe(before.state);
    expect(after.inputs).toEqual(before.inputs);
    expect(queue.serviceEvents("engagement")).toEqual([]);
    // unchanged: no rewrite
    const stamp = statSync(join(root, "_bmad-output", "engagements", "ENG-001", "engagement.yaml")).mtimeMs;
    expect(chatSpendPass(queue, { ledgerFile: ledger })).toEqual({ updated: [] });
    expect(statSync(join(root, "_bmad-output", "engagements", "ENG-001", "engagement.yaml")).mtimeMs).toBe(stamp);
    // a later job-run corrects it (the last line per run wins)
    queue.setStudioRun(c.run_id, "studio-c");
    writeFileSync(ledger, readFileSync(ledger, "utf-8") + jobRun("studio-c", 0.125) + "\n" + jobRun("studio-a", 0.625) + "\n");
    chatSpendPass(queue, { ledgerFile: ledger });
    expect(readEngagement(root, "ENG-001")!.spend.planning_usd).toBe(1);
  });

  test("a state change written between the pass's read and its write survives: the record is re-read fresh, only planning_usd merged", async () => {
    const root = served();
    const queue = newQueue();
    const m = mintChatTurn(queue, await prepareChatTurn(fakeDeps(), root), { engagement: "ENG-001", project: "p", root, seq: 1 });
    queue.setStudioRun(m.run_id, "studio-m");
    const ledger = join(temp("tk-sup-chat-ledger-"), "me-host.jsonl");
    writeFileSync(ledger, jobRun("studio-m", 0.5) + "\n");
    const out = chatSpendPass(queue, {
      ledgerFile: ledger,
      // serve's POST /engagements/{id}/input lands here, in another process
      beforeWrite: (r, id) => {
        const rec = readEngagement(r, id)!;
        writeEngagement(r, { ...rec, state: "scoping", updated: "2026-10-25T06:00:00.000Z", spend: { ...rec.spend, runs_usd: 2 } });
      },
    });
    expect(out).toEqual({ updated: ["ENG-001"] });
    const after = readEngagement(root, "ENG-001")!;
    expect(after.state).toBe("scoping");
    expect(after.updated).toBe("2026-10-25T06:00:00.000Z");
    expect(after.spend).toEqual({ planning_usd: 0.5, runs_usd: 2 });
  });

  test("the pass meters into the served root (the run payload's project_root), not the root resolveJob returned", async () => {
    const root = served();
    const resolved = join(root, "checkout"); // resolveJob answers a different root than the served one
    mkdirSync(resolved, { recursive: true });
    const queue = newQueue();
    const deps: ChatDeps = { resolveJob: async () => ({ projectId: "p", root: resolved, definition: structuredClone(SHIPPED_CHAT), target: "skill" }) };
    const m = mintChatTurn(queue, await prepareChatTurn(deps, root), { engagement: "ENG-001", project: "p", root, seq: 1 });
    expect(queue.get(m.run_id)!.root).toBe(resolved);
    queue.setStudioRun(m.run_id, "studio-m");
    const ledger = join(temp("tk-sup-chat-ledger-"), "me-host.jsonl");
    writeFileSync(ledger, jobRun("studio-m", 0.5) + "\n");
    expect(chatSpendPass(queue, { ledgerFile: ledger })).toEqual({ updated: ["ENG-001"] });
    expect(readEngagement(root, "ENG-001")!.spend.planning_usd).toBe(0.5);
    expect(existsSync(join(resolved, "_bmad-output"))).toBe(false);
  });

  test("a ledger read error other than ENOENT (EISDIR) skips the pass: planning_usd keeps 0.75, never a throw", async () => {
    const root = served();
    const queue = newQueue();
    const m = mintChatTurn(queue, await prepareChatTurn(fakeDeps(), root), { engagement: "ENG-001", project: "p", root, seq: 1 });
    queue.setStudioRun(m.run_id, "studio-m");
    const ledger = join(temp("tk-sup-chat-ledger-"), "me-host.jsonl");
    writeFileSync(ledger, jobRun("studio-m", 0.75) + "\n");
    expect(chatSpendPass(queue, { ledgerFile: ledger })).toEqual({ updated: ["ENG-001"] });
    expect(readEngagement(root, "ENG-001")!.spend.planning_usd).toBe(0.75);
    const stamp = statSync(join(root, "_bmad-output", "engagements", "ENG-001", "engagement.yaml")).mtimeMs;
    const dirLedger = temp("tk-sup-chat-ledger-dir-"); // a directory: readFileSync throws EISDIR
    let out: ReturnType<typeof chatSpendPass> | undefined;
    expect(() => { out = chatSpendPass(queue, { ledgerFile: dirLedger }); }).not.toThrow();
    expect(out).toEqual({ updated: [] });
    expect(readEngagement(root, "ENG-001")!.spend.planning_usd).toBe(0.75);
    expect(statSync(join(root, "_bmad-output", "engagements", "ENG-001", "engagement.yaml")).mtimeMs).toBe(stamp);
  });

  test("no ledger, no chat-queued, a missing record: nothing written, never a throw", async () => {
    const queue = newQueue();
    expect(chatSpendPass(queue, { ledgerFile: join(temp("tk-sup-chat-none-"), "absent.jsonl") })).toEqual({ updated: [] });
    const root = served();
    const m = mintChatTurn(queue, await prepareChatTurn(fakeDeps(), root), { engagement: "ENG-001", project: "p", root, seq: 1 });
    queue.setStudioRun(m.run_id, "studio-m");
    rmSync(join(root, "_bmad-output", "engagements", "ENG-001", "engagement.yaml"));
    expect(chatSpendPass(queue, { ledgerFile: join(root, "absent.jsonl") })).toEqual({ updated: [] });
  });
});

describe("the chat session's environment is a worker's (buildWorkerEnv)", () => {
  test("a host-tier tk-studio-engage run: every TK_SUPERVISOR_* secret, the API key and the owner seat stripped; run_id reaches the prompt", async () => {
    const secrets: Record<string, string> = {
      ANTHROPIC_API_KEY: "sk-chat", TK_SUPERVISOR_TOKEN: "bearer-chat", TK_SUPERVISOR_SESSION_SECRET: "session-chat",
      TK_SUPERVISOR_TELEGRAM_TOKEN: "tg-chat", TK_SUPERVISOR_NTFY_URL: "https://ntfy.example/chat", TK_SUPERVISOR_OTHER_PASSWORD: "pw-chat",
      TK_STUDIO_ATLASSIAN_OWNER_EMAIL: "owner@example.com", TK_STUDIO_ATLASSIAN_OWNER_TOKEN: "owner-chat",
    };
    const saved: Record<string, string | undefined> = {};
    const home = process.env.TK_STUDIO_HOME;
    for (const [k, v] of Object.entries(secrets)) { saved[k] = process.env[k]; process.env[k] = v; }
    process.env.TK_STUDIO_HOME = temp("tk-sup-chat-store-");
    try {
      const env = buildWorkerEnv(process.env, () => ({}));
      for (const k of Object.keys(secrets)) expect(env[k]).toBeUndefined();
      const calls: { args: string[]; env?: Record<string, string | undefined> }[] = [];
      const block = { status: "complete", intent: "tk-studio-engage", artifacts: [], reason: null };
      const spawner: Spawner = async (_cmd, args, opts): Promise<RunResult> => {
        calls.push({ args, env: opts.env });
        return args.includes("auth") && args.includes("status")
          ? { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }
          : { exit: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(block), total_cost_usd: 0.5 }) };
      };
      const root = served();
      const payload = { verb: "reply", engagement: "ENG-001", project: "p", seq: 1, run_id: "engagement-chat-r1" };
      const out = await invokeSkill(root, "tk-studio-engage", { tier: "host", payload, model: "claude-opus-5-5", effort: "high" }, spawner);
      expect(out).toMatchObject({ ran: true, status_block: block, total_cost_usd: 0.5 });
      const worker = calls.find((c) => c.args.includes("-p"))!;
      expect(worker).toBeDefined();
      const prompt = worker.args[worker.args.indexOf("-p") + 1]!;
      expect(prompt).toStartWith("/tk-studio:tk-studio-engage ");
      expect(JSON.parse(prompt.split("\n")[0]!.replace(/^\S+ /, ""))).toMatchObject({ ...payload, directory: root });
      for (const c of calls) {
        for (const k of Object.keys(secrets)) expect(c.env?.[k]).toBeUndefined();
        expect(JSON.stringify(c.env ?? {})).not.toMatch(/bearer-chat|session-chat|owner-chat|pw-chat/);
      }
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      if (home === undefined) delete process.env.TK_STUDIO_HOME; else process.env.TK_STUDIO_HOME = home;
    }
  });
});

describe("the invoke's run_id (finishRun's payloadRunId): always run, no TK_STUDIO_ROOT or uv needed", () => {
  test("an engagement-chat invoke keeps the queue run id and carries project_root; any other job gets the studio run id", async () => {
    const root = served();
    const workRoot = temp("tk-sup-chat-wt-");
    const block = { status: "complete", intent: "tk-studio-engage", artifacts: [], reason: null };
    const seen: { root: string; skill: string; payload: Record<string, any> }[] = [];
    const invoke = async (r: string, skill: string, args: Record<string, any>) => {
      seen.push({ root: r, skill, payload: args.payload as Record<string, any> });
      return { ran: true, exit: 0, status_block: block } as any;
    };
    const QUEUE_RUN = "engagement-chat-20261025T050000Z-queue";
    const STUDIO = "engagement-chat-20261025T050000Z-studio";
    const payload = { verb: "reply", engagement: "ENG-001", project: "p", project_root: root, seq: 1, run_id: QUEUE_RUN };
    const chat: Started = {
      jobId: ENGAGEMENT_CHAT_JOB, root, projectId: "p", runId: STUDIO, guardS: 600, defn: structuredClone(SHIPPED_CHAT),
      woke: { accepted: true, run_id: STUDIO, state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-engage", payload } },
      workRoot, tier: "host",
    };
    const summary = await finishRun(chat, async () => ({ ok: true }), invoke);
    expect(summary).toMatchObject({ run_id: STUDIO, status_block: block });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.skill).toBe("tk-studio-engage");
    expect(seen[0]!.root).toBe(workRoot);
    expect(seen[0]!.payload.run_id).toBe(QUEUE_RUN);
    expect(seen[0]!.payload.project_root).toBe(root);
    // any other job: the studio run id replaces a payload run_id
    const other: Started = {
      ...chat, jobId: "studio-health", runId: "studio-health-r1", defn: { id: "studio-health", trigger: "one-shot", target: { skill: "tk-studio-activate" } },
      woke: { accepted: true, run_id: "studio-health-r1", state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: { run_id: "queue-id" } } },
    };
    await finishRun(other, async () => ({ ok: true }), invoke);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.payload.run_id).toBe("studio-health-r1");
  });
});

const PLUGIN_LIB = process.env.TK_STUDIO_ROOT ? join(process.env.TK_STUDIO_ROOT, "plugins", "tk-studio", "lib") : "";
const canRunEngage = !!PLUGIN_LIB && existsSync(join(PLUGIN_LIB, "engage.py")) && spawnSync("uv", ["--version"]).status === 0;

describe.skipIf(!canRunEngage)("the real drive path: prepareWorktree → finishRun → invokeSkill (review patch)", () => {
  /** A served root that is a git repo (bare origin, fake gh), ENG-001 untracked in it, one chat turn minted and
   * claimed, its worktree cut; then the run start's overlays and `finishRun` with the real `invokeSkill`, whose fake
   * `claude -p` runs the real `engage.py reply --directory <payload.project_root>`. */
  test("the invoke gets project_root = the served root and run_id = the queue run id; the reply lands in the served root's chat.jsonl, which chatSince reads (never the worktree)", async () => {
    const repo = gitRepo();
    const root = repo.checkout;
    writeEngagement(root, newEngagement("ENG-001", "p", "Build the export", AT));
    appendChatLine(root, "ENG-001", { at: AT, author: "owner", body: "Which reports?" });
    const gh = fakeGh();
    const work = temp("tk-sup-chat-work-");
    const env = { ...process.env, TK_SUPERVISOR_WORK: work, GH_BIN: gh.bin, TK_STUDIO_ROOT: "/studio-root" };
    const deps: WorktreeDeps = {
      env,
      run: (bin, args, o) => runProcess(bin, args, { cwd: o.cwd, timeoutS: o.timeoutS, env: { ...env, ...(o.env ?? {}) } }),
      uv: async (_root, script): Promise<RunResult> => {
        if (script.endsWith("install_base.py")) return { exit: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
        if (script.endsWith("drift_check.py")) return { exit: 0, stdout: JSON.stringify({ ok: true, result: "clean" }), stderr: "" };
        return { exit: 2, stdout: "", stderr: "unexpected script" };
      },
      verbs: async (_root, args) => ({ ok: true, state: args[args.indexOf("--state") + 1] }),
    };
    const queue = newQueue();
    const minted = mintChatTurn(queue, await prepareChatTurn(fakeDeps(), root), { engagement: "ENG-001", project: "p", root, seq: 1 });
    const claim = await queue.claim(minted.run_id, me);
    if (!claim.claimed) throw new Error("not claimed");
    const workRoot = await prepareWorktree(queue, claim.run, "p", root, deps);
    expect(workRoot).not.toBe(root);
    expect(existsSync(chatFile(workRoot, "ENG-001"))).toBe(false); // untracked: the worktree never holds the chat
    // run start (runJob): the definition re-resolved, this run's payload overlaid; the minting verb's directive likewise
    const run = queue.get(minted.run_id)!;
    const defn = withStoredPayload(run.job_id, structuredClone(SHIPPED_CHAT), queue.definition(run), { run_id: run.run_id, payload: queue.runPayload(run.run_id) });
    const STUDIO = "engagement-chat-20261025T050000Z-studio";
    const woke = withQueuedPayload(run.job_id, { accepted: true, run_id: STUDIO, state: "queued", directive: { kind: "invoke-skill", skill: "tk-studio-engage", payload: { verb: "reply" } } }, defn);
    const calls: { args: string[]; cwd?: string; payload?: Record<string, any> }[] = [];
    const block = { status: "complete", intent: "tk-studio-engage", artifacts: [], reason: null };
    const spawner: Spawner = async (_cmd, args, o): Promise<RunResult> => {
      if (args.includes("auth") && args.includes("status")) return { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) };
      const prompt = args[args.indexOf("-p") + 1]!;
      const payload = JSON.parse(prompt.split("\n")[0]!.replace(/^\S+ /, ""));
      calls.push({ args, cwd: o.cwd, payload });
      // the planner session, as SKILL.md maps the payload: project_root → --directory, run_id → --run-id
      const bodyFile = join(temp("tk-sup-chat-body-"), "body.md");
      writeFileSync(bodyFile, "The monthly and the yearly reports.");
      const r = spawnSync("uv", ["run", join(PLUGIN_LIB, "engage.py"), "reply", "--directory", payload.project_root,
        "--engagement", payload.engagement, "--body-file", bodyFile, "--run-id", payload.run_id], { encoding: "utf-8" });
      if (r.status !== 0) throw new Error(`engage.py reply failed: ${r.stdout}${r.stderr}`);
      return { exit: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(block) }) };
    };
    const started: Started = {
      jobId: ENGAGEMENT_CHAT_JOB, root, projectId: "p", runId: STUDIO, guardS: 600, defn, woke, workRoot, tier: "host",
    };
    const summary = await finishRun(started, async () => ({ ok: true }), (r, skill, args, _sp, o) => invokeSkill(r, skill, args, spawner, o));
    // the worker ran and ended on its block (the guard's transcript accounting is not this test's: no transcript here)
    expect(summary).toMatchObject({ run_id: STUDIO, status_block: block });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.cwd).toBe(workRoot);
    expect(call!.payload).toMatchObject({ verb: "reply", engagement: "ENG-001", project: "p", seq: 1, project_root: root, run_id: minted.run_id, directory: workRoot });
    expect(call!.payload!.run_id).not.toBe(STUDIO);
    const reply = chatSince(root, "ENG-001", 1);
    expect(reply).toMatchObject([{ seq: 2, author: "planner", body: "The monthly and the yearly reports.", run_id: minted.run_id, proposals: [] }]);
    expect(existsSync(chatFile(workRoot, "ENG-001"))).toBe(false);
    // any other job keeps today's behaviour: the studio run id replaces a payload run_id
    const other: Started = { ...started, jobId: "studio-health", runId: "studio-health-r1",
      woke: { ...woke, directive: { kind: "invoke-skill", skill: "tk-studio-activate", payload: { run_id: "queue-id" } } } };
    const seen: Record<string, any>[] = [];
    await finishRun(other, async () => ({ ok: true }), async (_r, _skill, args) => { seen.push(args.payload as Record<string, any>); return { ran: true, exit: 0, status_block: block } as any; });
    expect(seen[0]!.run_id).toBe("studio-health-r1");
  }, 60_000);
});
