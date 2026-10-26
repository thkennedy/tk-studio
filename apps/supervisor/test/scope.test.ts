// Story 32.4: the scope pass — the newest `revise` input carrying a body, while `scoping`, becomes the new scope.md and
// Confluence page through `engage.py scope --revise-at <at>`; one `engagement-scope` service event per line
// (published, refused or skipped), nothing on a transient result. The `uvRunner` is a fake (no live Confluence, no
// `uv`); the records are fixtures.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { mintChatTurn, prepareChatTurn, type ChatDeps } from "../src/chat";
import { afterEngagementInput } from "../src/cli";
import { applyInput, newEngagement, readEngagement, writeEngagement, type Engagement } from "../src/engagement";
import { ENGAGEMENT_CHAT_JOB, Queue, type Owner } from "../src/queue";
import { newestReviseBody, scopePass, type ScopeDeps } from "../src/scope";
import type { RunResult } from "../src/server";
import { tempDir, track } from "./tmp";

const temp = tempDir; // test/tmp.ts closes the tracked queues and removes the folders

const ENG = "ENG-001";
const me: Owner = { pid: process.pid, host: hostname(), nonce: "scope-test" };
const SHIPPED_CHAT = {
  job_schema_version: 1, id: ENGAGEMENT_CHAT_JOB, trigger: "one-shot",
  target: { skill: "tk-studio-engage", payload: { verb: "reply" } },
  guards: { max_turns: 80, max_wall_clock_seconds: 1800 }, stop: { until: "9999-12-31T23:59:59Z" },
};
const PAGE = { id: "60001", url: "https://example.atlassian.net/wiki/spaces/TKS/pages/60001", version: 2, action: "updated" };

/** A served root with ENG-001 moved to `state` through the table, its `revise` lines applied with these bodies. */
function served(o: { state?: "scoping" | "quoted"; bodies?: (string | null)[] } = {}) {
  const root = temp("tk-sup-s-root-");
  mkdirSync(join(root, ".tk-studio"), { recursive: true });
  writeFileSync(join(root, ".tk-studio", "config.yaml"), "project_id: p\n");
  let record: Engagement = { ...newEngagement(ENG, "p", "Build the export", "2026-10-25T05:00:00.000Z"), state: "scoping" };
  let minute = 10;
  for (const body of o.bodies ?? ["Only the CSV button."]) {
    const applied = applyInput(record, { verb: "revise", payload: body === null ? {} : { body }, source: "cookie", at: `2026-10-25T05:${minute++}:00.000Z` });
    if (!applied.ok) throw new Error(applied.error);
    record = applied.record;
  }
  if (o.state === "quoted") record = { ...record, state: "quoted", quote: { band85: 1 } };
  writeEngagement(root, record);
  return root;
}

const newQueue = () => {
  const q = track(new Queue(join(temp("tk-sup-s-q-"), "q.db"), { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false }) }));
  return q;
};

const chatDeps = (): ChatDeps => ({ resolveJob: async (r) => ({ projectId: "p", root: r, definition: structuredClone(SHIPPED_CHAT), target: "skill" }) });

/** One chat turn minted (its `chat-queued` event names the served root for the `finally` pass), claimed and ended. */
async function chatRun(queue: Queue, root: string): Promise<string> {
  const { run_id } = mintChatTurn(queue, await prepareChatTurn(chatDeps(), root), { engagement: ENG, project: "p", root, seq: 1 });
  expect((await queue.claim(run_id, me)).claimed).toBe(true);
  queue.end(run_id, "complete");
  return run_id;
}

/** The fake `uv`: every call recorded; `engage.py scope` answered by `answer` (default ok, the page). */
function fakeUv(answer: () => Record<string, unknown> | Error = () => ({ ok: true, status: "complete", engagement: ENG, mode: "scope", source: "revise", page: PAGE })) {
  const calls: { root: string; script: string; args: string[]; timeoutS?: number }[] = [];
  const uv = async (root: string, script: string, args: string[], timeoutS?: number): Promise<RunResult> => {
    calls.push({ root, script, args, timeoutS });
    const out = answer();
    if (out instanceof Error) throw out;
    return { exit: out.status === "blocked" ? 2 : 0, stdout: "log line\n" + JSON.stringify(out, null, 2), stderr: "" };
  };
  return { uv, calls };
}

/** A clock that moves 1 s per call. */
function clock(start = "2026-10-25T06:00:00.000Z") {
  let t = Date.parse(start);
  return () => new Date((t += 1000)).toISOString();
}

function deps(uv: ScopeDeps["uv"], extra: Partial<ScopeDeps> = {}): ScopeDeps {
  return { uv, env: { TK_STUDIO_ROOT: "/studio" }, now: clock(), ...extra };
}

const kinds = (q: Queue, kind: string) => q.serviceEvents(kind).map((e) => e.detail);

describe("Story 32.4: the scope pass (Settled shape 4)", () => {
  test("a revise body while scoping: engage.py scope --revise-at <at> through uv, one engagement-scope published event, once", async () => {
    const root = served(), queue = newQueue();
    await chatRun(queue, root);
    const at = readEngagement(root, ENG)!.inputs.at(-1)!.at;
    const { uv, calls } = fakeUv();
    const out = await scopePass(queue, deps(uv));
    expect(out).toEqual({ published: [ENG], refused: [], skipped: [] });
    expect(calls.map((c) => [c.root, c.script.split(/[\\/]/).slice(-2).join("/"), c.args, c.timeoutS])).toEqual([
      [root, "lib/engage.py", ["scope", "--directory", root, "--engagement", ENG, "--revise-at", at], 120],
    ]);
    expect(kinds(queue, "engagement-scope")).toEqual([{ engagement: ENG, project: "p", revise_at: at, action: "published", page: PAGE }]);
    // once per line: the next pass runs nothing and emits nothing
    expect(await scopePass(queue, deps(uv))).toEqual({ published: [], refused: [], skipped: [] });
    expect(calls).toHaveLength(1);
    expect(kinds(queue, "engagement-scope")).toHaveLength(1);
    // the pass moves no state and writes no record field
    expect(readEngagement(root, ENG)!.state).toBe("scoping");
  });

  test("a named refusal is one refused event with the reason, never retried", async () => {
    const root = served(), queue = newQueue();
    await chatRun(queue, root);
    const reason = "engage refused: ConfluenceUnbound: planning.confluence.space_id is not recorded";
    const { uv, calls } = fakeUv(() => ({ ok: false, status: "blocked", reason }));
    expect((await scopePass(queue, deps(uv))).refused).toEqual([ENG]);
    await scopePass(queue, deps(uv));
    expect(calls).toHaveLength(1);
    const events = kinds(queue, "engagement-scope");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ engagement: ENG, project: "p", action: "refused", reason });
  });

  test("a record no longer in scoping: one skipped event naming the state, nothing run", async () => {
    const root = served({ state: "quoted" }), queue = newQueue();
    await chatRun(queue, root);
    const { uv, calls } = fakeUv();
    expect((await scopePass(queue, deps(uv))).skipped).toEqual([ENG]);
    await scopePass(queue, deps(uv));
    expect(calls).toEqual([]);
    const events = kinds(queue, "engagement-scope");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ engagement: ENG, project: "p", action: "skipped", reason: "state quoted" });
  });

  test("a transient result (retry: true, a spawn error, no JSON) emits nothing and the next pass calls again", async () => {
    const root = served(), queue = newQueue();
    await chatRun(queue, root);
    const answers: (() => Record<string, unknown> | Error)[] = [
      () => ({ ok: true, status: "partial", retry: true, reason: "engage scope busy: ScopeBusy" }),
      () => new Error("spawn uv ENOENT"),
      () => ({}),
    ];
    let n = 0;
    const { uv, calls } = fakeUv(() => (n < answers.length ? answers[n++]!() : { ok: true, status: "complete", page: PAGE }));
    for (let i = 0; i < 3; i++) {
      expect(await scopePass(queue, deps(uv))).toEqual({ published: [], refused: [], skipped: [] });
      expect(kinds(queue, "engagement-scope")).toEqual([]);
    }
    expect((await scopePass(queue, deps(uv))).published).toEqual([ENG]);
    expect(calls).toHaveLength(4);
  });

  test("the newest body wins: an older revise line is never run; a revise with no body runs nothing", async () => {
    const root = served({ bodies: ["First thoughts.", "Second thoughts."] }), queue = newQueue();
    await chatRun(queue, root);
    const lines = readEngagement(root, ENG)!.inputs;
    const { uv, calls } = fakeUv();
    await scopePass(queue, deps(uv));
    await scopePass(queue, deps(uv));
    expect(calls.map((c) => c.args.at(-1))).toEqual([lines.at(-1)!.at]);
    expect(newestReviseBody(readEngagement(root, ENG)!)!.payload).toEqual({ body: "Second thoughts." });
    const bare = served({ bodies: [null] }), q2 = newQueue();
    await chatRun(q2, bare);
    const none = fakeUv();
    expect(await scopePass(q2, deps(none.uv))).toEqual({ published: [], refused: [], skipped: [] });
    expect(none.calls).toEqual([]);
    expect(kinds(q2, "engagement-scope")).toEqual([]);
  });

  test("targets: the chat-queued roots at the finally sites, or the one engagement the input route names", async () => {
    const root = served(), queue = newQueue();
    const { uv, calls } = fakeUv();
    // no chat run names the root: the finally pass has no target
    expect(await scopePass(queue, deps(uv))).toEqual({ published: [], refused: [], skipped: [] });
    expect(calls).toEqual([]);
    expect((await scopePass(queue, deps(uv), { root, engagement: ENG })).published).toEqual([ENG]);
    // the input route's hook in production: the questions pass (nothing for an unbound root), then the scope pass
    const other = served({ bodies: ["Hooked."] }), q2 = newQueue();
    const hooked = fakeUv();
    await afterEngagementInput(q2, other, ENG, deps(hooked.uv));
    expect(hooked.calls.map((c) => c.args.slice(0, 1))).toEqual([["scope"]]);
    expect(kinds(q2, "engagement-scope")).toHaveLength(1);
  });
});
