// Story 31.6: the issue read (`GET /inbox?project=<id>&issue=<KEY>`) and the owner's reply (`POST
// /inbox/{key}/reply`) in `src/inbox.ts`, driven through their seams: the registry, the board builder, the ledger
// and the verb's runner are injected, so no test spawns `uv` or reaches Atlassian.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardAnswer } from "../src/board";
import {
  checkReplyBody, DONE_BODY, entityForKey, issueRead, OWNER_SEAT_VARS, postReply, readComments, REPLY_MAX_BYTES, replyEnv,
  runCost, type ReplyRunner,
} from "../src/inbox";
import { buildSbxCommand, sbxEnvPassthrough } from "../src/server";
import { tempDir } from "./tmp";

const ITEMS = [
  { issue: "TKS-3", entity: "ST-003", title: "Gamma", priority: "Highest", blocked_since: "2026-10-24T09:00:00+00:00",
    reason_comment: { id: "10001", body: "[~accountid:acc-owner] Blocked: x\nResolves when: y", created: "2026-10-24T09:00:00.000+0000" }, state: "open" },
  { issue: "TKS-1", priority: null, blocked_since: "2026-10-24T08:00:00+00:00", reason_comment: null, state: "resolved" },
];
const STUDIO_ROOT = join(import.meta.dir, "..", "..", "..");
const OWNER_ENV = {
  TK_STUDIO_ATLASSIAN_OWNER_EMAIL: "owner@example.com", TK_STUDIO_ATLASSIAN_OWNER_TOKEN: "fake-owner-token", TK_ATLASSIAN_CLOUD_ID: "cloud-test",
};

function project(o: { inbox?: boolean; entity?: boolean; comments?: string[] | null } = {}) {
  const root = tempDir("tk-sup-issue-root-");
  const tracking = join(root, "_bmad-output", "tracking");
  mkdirSync(tracking, { recursive: true });
  if (o.inbox !== false) {
    writeFileSync(join(tracking, "inbox.json"), JSON.stringify({ inbox_version: 1, generated_at: "2026-10-24T12:00:00+00:00", project_key: "TKS", items: ITEMS }));
  }
  if (o.entity !== false) {
    const plan = join(root, "_bmad-output", "planning-artifacts", "plan");
    mkdirSync(plan, { recursive: true });
    writeFileSync(join(plan, "ST-003.md"), [
      "---", "id: ST-003", "type: story", "title: Gamma story", "status: blocked", "source: epics.md#story-1.3", "parent: EP-001",
      "external:", "  jira:", "    key: TKS-3", "    status: Blocked - Awaiting User", "    canonical_status: blocked", "---", "", "body", "",
    ].join("\n"));
    writeFileSync(join(plan, "ST-004.md"), ["---", "id: ST-004", "title: Delta", "status: ready", "---", ""].join("\n"));
  }
  if (o.comments !== null) {
    mkdirSync(join(tracking, "TKS-3"), { recursive: true });
    writeFileSync(join(tracking, "TKS-3", "comments.jsonl"), (o.comments ?? [
      JSON.stringify({ issue: "TKS-3", id: "c2", author: "owner", update_author: "owner", body: "looking", created: "2026-10-24T10:00:00.000+0000", updated: "2026-10-24T10:00:00.000+0000", source: "jira" }),
      JSON.stringify({ issue: "TKS-3", id: "c1", author: "agent", update_author: "agent", body: "Blocked: x", created: "2026-10-24T09:00:00.000+0000", updated: "2026-10-24T09:00:00.000+0000", source: "jira" }),
      JSON.stringify({ issue: "TKS-3", id: "c2", author: "owner", update_author: "owner", body: "looking (edited)", created: "2026-10-24T10:00:00.000+0000", updated: "2026-10-24T10:05:00.000+0000", source: "jira" }),
    ]).join("\n") + "\n");
  }
  return root;
}

const BOARD = (_root: string): BoardAnswer => ({
  ok: true, project: "p", built_at: "2026-10-24T12:00:00.000Z", plan: {}, triage: { needs_you: [], working: [], done: [] },
  epics: [{ id: "EP-001", title: "E", status: "in-progress", band_usd: null, spend_usd: 0, findings: 0, stories: [
    { id: "ST-003", key: "1.3", title: "Gamma story", status: "blocked", findings: [],
      run: { run_id: "q-1", state: "paused", pr: "https://github.com/o/r/pull/7", host_verify: null, ended_at: null } },
  ] }],
});

function readDeps(root: string, o: { ledger?: string[] } = {}) {
  const home = tempDir("tk-sup-issue-home-");
  if (o.ledger) {
    mkdirSync(join(home, "measurements"), { recursive: true });
    writeFileSync(join(home, "measurements", "u-m.jsonl"), o.ledger.join("\n") + "\n");
  }
  return {
    registry: async () => ({ projects: { p: { root } } }),
    board: async (p: string) => (p === "p" ? BOARD(root) : null),
    studioRunId: (id: string) => (id === "q-1" ? "studio-run-1" : null),
    env: { TK_STUDIO_HOME: home }, ledger: { user: "u", machine: "m" },
  };
}

const jobRun = (runId: string, cost: unknown) => JSON.stringify({ event: "job-run", project: "p", payload: { run_id: runId, job_id: "run-epic-1", total_cost_usd: cost } });

describe("Story 31.6: the issue read", () => {
  test("the item, the entity's Jira status, the run, the cost and the comments in order (an edit's last line)", async () => {
    const root = project();
    const read = await issueRead("p", "TKS-3", readDeps(root, { ledger: [jobRun("studio-run-1", 1.5), jobRun("other", 9), jobRun("studio-run-1", 2.25)] }));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.answer).toEqual({
      ok: true, project: "p", generated_at: "2026-10-24T12:00:00+00:00", items: [ITEMS[0]],
      issue: {
        key: "TKS-3", entity: "ST-003", title: "Gamma", status: "Blocked - Awaiting User",
        run: { run_id: "q-1", state: "paused", pr: "https://github.com/o/r/pull/7", host_verify: null, ended_at: null },
        cost_usd: 2.25,
        comments: [
          { id: "c1", author: "agent", update_author: "agent", body: "Blocked: x", created: "2026-10-24T09:00:00.000+0000", updated: "2026-10-24T09:00:00.000+0000" },
          { id: "c2", author: "owner", update_author: "owner", body: "looking (edited)", created: "2026-10-24T10:00:00.000+0000", updated: "2026-10-24T10:05:00.000+0000" },
        ],
      },
    });
  });

  test("no ledger line is cost null (not metered); a bad key BadIssue; an unknown project UnknownProject", async () => {
    const root = project();
    const read = await issueRead("p", "TKS-3", readDeps(root));
    expect(read.ok && read.answer.issue.cost_usd).toBeNull();
    expect(await issueRead("p", "tks-3", readDeps(root))).toEqual({ ok: false, error: "BadIssue" });
    expect(await issueRead("p", "TKS-3; rm", readDeps(root))).toEqual({ ok: false, error: "BadIssue" });
    expect(await issueRead("nope", "TKS-3", readDeps(root))).toEqual({ ok: false, error: "UnknownProject" });
  });

  test("no item, no entity and no comment log is UnknownIssue; any one of them answers", async () => {
    const root = project();
    expect(await issueRead("p", "TKS-99", readDeps(root))).toEqual({ ok: false, error: "UnknownIssue" });
    // only the comment log: no item, no entity — the status and run null
    const bare = project({ inbox: false, entity: false });
    const read = await issueRead("p", "TKS-3", readDeps(bare));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.answer.items).toEqual([]);
    expect(read.answer.generated_at).toBeNull();
    expect(read.answer.issue).toMatchObject({ entity: null, title: null, status: null, run: null, cost_usd: null });
    expect(read.answer.issue.comments).toHaveLength(2);
    // only the item: the item's state stands in for the status
    const itemOnly = project({ entity: false, comments: null });
    const r2 = await issueRead("p", "TKS-1", readDeps(itemOnly));
    expect(r2.ok && r2.answer.issue).toMatchObject({ key: "TKS-1", status: "resolved", comments: [] });
  });

  test("a failing registry or board read is IssueReadFailed, never a throw", async () => {
    const root = project();
    const broken = { ...readDeps(root), registry: async () => { throw new Error("registry.py show failed"); } };
    expect(await issueRead("p", "TKS-3", broken)).toEqual({ ok: false, error: "IssueReadFailed", detail: "registry.py show failed" });
    const noBoard = { ...readDeps(root), board: async () => { throw new Error("board boom"); } };
    expect(await issueRead("p", "TKS-3", noBoard)).toEqual({ ok: false, error: "IssueReadFailed", detail: "board boom" });
  });

  test("entityForKey, readComments and runCost read their files only", () => {
    const root = project();
    expect(entityForKey(root, "TKS-3")).toEqual({ id: "ST-003", title: "Gamma story", status: "Blocked - Awaiting User" });
    expect(entityForKey(root, "TKS-4")).toBeNull();
    expect(readComments(root, "TKS-404")).toBeNull();
    const home = tempDir("tk-sup-ledger-");
    const file = join(home, "l.jsonl");
    writeFileSync(file, [jobRun("r", 0), "not json", jobRun("s", "x")].join("\n"));
    expect(runCost(file, "r")).toBe(0);
    expect(runCost(file, "s")).toBeNull();
    expect(runCost(join(home, "missing.jsonl"), "r")).toBeNull();
  });
});

describe("Story 31.6: the reply", () => {
  test("the body schema: exactly one of a non-empty body (at most 32 KiB) or done: true", () => {
    expect(checkReplyBody({ project: "p", body: "hi" })).toEqual({ ok: true, body: { project: "p", body: "hi" } });
    expect(checkReplyBody({ project: "p", done: true })).toEqual({ ok: true, body: { project: "p", done: true } });
    for (const bad of [null, [], "x", {}, { project: "p" }, { project: "p", body: "x", done: true }, { project: "p", body: "  " },
      { project: "p", done: false }, { project: "", body: "x" }, { project: "p", body: "x", extra: 1 },
      { project: "p", body: "é".repeat(REPLY_MAX_BYTES / 2 + 1) }]) {
      expect(checkReplyBody(bad).ok).toBe(false);
    }
    expect(checkReplyBody({ project: "p", body: "a".repeat(REPLY_MAX_BYTES) }).ok).toBe(true);
  });

  function replyFx(o: { stdout?: string; stderr?: string; throws?: boolean; env?: Record<string, string>; userEnv?: Record<string, string> } = {}) {
    const root = project();
    const calls: { root: string; script: string; args: string[]; env: Record<string, string | undefined>; body: string | null }[] = [];
    const run: ReplyRunner = async (r, script, args, env) => {
      const file = args[args.indexOf("--body-file") + 1]!;
      calls.push({ root: r, script, args, env, body: existsSync(file) ? readFileSync(file, "utf-8") : null });
      if (o.throws) throw new Error("uv spawn failed: ENOENT");
      return { exit: 0, stdout: o.stdout ?? JSON.stringify({ ok: true, issue: "TKS-3", commented: true, transitioned: true, status: "complete", intent: "tk-studio-track", artifacts: [], reason: null }), stderr: o.stderr ?? "" };
    };
    const deps = {
      registry: async () => ({ projects: { p: { root } } }), env: { TK_STUDIO_ROOT: STUDIO_ROOT, ...(o.env ?? OWNER_ENV) }, userEnv: () => o.userEnv ?? {}, run,
    };
    return { root, calls, deps };
  }

  test("a reply runs track.py reply on the host with the body in a temp file, removed afterwards", async () => {
    const fx = replyFx();
    const answer = await postReply("TKS-3", { project: "p", body: "Use the second option." }, fx.deps);
    expect(answer).toEqual({ status: 200, body: { ok: true, project: "p", issue: "TKS-3", commented: true, transitioned: true, status: "complete" } });
    const [call] = fx.calls;
    expect(call!.root).toBe(fx.root);
    expect(call!.script.split(/[\\/]/).slice(-2)).toEqual(["lib", "track.py"]);
    expect(call!.args.slice(0, 5)).toEqual(["reply", "--directory", fx.root, "--issue", "TKS-3"]);
    expect(call!.args[5]).toBe("--body-file");
    expect(call!.body).toBe("Use the second option.");
    // the body never on the command line; the file is gone afterwards
    expect(call!.args.join(" ")).not.toContain("second option");
    expect(existsSync(call!.args[6]!)).toBe(false);
    // the verb's env holds the owner seat (the host child), and the sandbox pass-through never forwards it
    expect(call!.env.TK_STUDIO_ATLASSIAN_OWNER_TOKEN).toBe("fake-owner-token");
    expect(sbxEnvPassthrough(call!.env)).not.toContain("TK_STUDIO_ATLASSIAN_OWNER_TOKEN");
    expect(sbxEnvPassthrough(call!.env)).not.toContain("TK_STUDIO_ATLASSIAN_OWNER_EMAIL");
    const sbx = buildSbxCommand({ sandbox: "s", vmRoot: "/w", worker: { bin: "claude", argv: ["-p"] }, guardS: 10 }, call!.env);
    expect(sbx.argv.join(" ")).not.toContain("OWNER");
  });

  test("Done writes `Done.`", async () => {
    const fx = replyFx();
    expect((await postReply("TKS-3", { project: "p", done: true }, fx.deps)).status).toBe(200);
    expect(fx.calls[0]!.body).toBe(DONE_BODY);
  });

  test("an absent owner variable or cloud id is 409 OwnerSeatMissing naming it, with no spawn", async () => {
    for (const name of OWNER_SEAT_VARS) {
      const env: Record<string, string> = { ...OWNER_ENV };
      delete env[name];
      const fx = replyFx({ env });
      const answer = await postReply("TKS-3", { project: "p", done: true }, fx.deps);
      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ ok: false, error: "OwnerSeatMissing", missing: [name] });
      expect(fx.calls).toEqual([]);
    }
  });

  test("the User environment fills an absent owner variable (hole 60), never overrides a set one", async () => {
    const fx = replyFx({ env: { TK_ATLASSIAN_CLOUD_ID: "cloud-test" }, userEnv: { ...OWNER_ENV, TK_ATLASSIAN_CLOUD_ID: "other" } });
    expect((await postReply("TKS-3", { project: "p", done: true }, fx.deps)).status).toBe(200);
    expect(fx.calls[0]!.env).toMatchObject(OWNER_ENV);
    expect(replyEnv({ TK_ATLASSIAN_CLOUD_ID: "a" }, { TK_ATLASSIAN_CLOUD_ID: "b", OTHER: "x" })).toEqual({ TK_ATLASSIAN_CLOUD_ID: "a" });
  });

  test("the verb's outcomes: blocked 409 ReplyRefused, retry 503 ReplyRetry, no JSON or a spawn failure 500 ReplyFailed", async () => {
    const blocked = replyFx({ stdout: JSON.stringify({ ok: false, status: "blocked", intent: "tk-studio-track", artifacts: [], reason: "track refused: x" }) });
    expect(await postReply("TKS-3", { project: "p", done: true }, blocked.deps)).toEqual({ status: 409, body: { ok: false, error: "ReplyRefused", reason: "track refused: x", commented: false } });
    // A refusal after the comment landed (the wrong-seat author, or no transition to Block Resolved) says so: the web
    // keeps its actions disabled rather than letting a retry post a duplicate.
    const wrongSeat = replyFx({ stdout: JSON.stringify({ ok: false, status: "blocked", commented: true, intent: "tk-studio-track", artifacts: [], reason: "track refused: seat" }) });
    expect(await postReply("TKS-3", { project: "p", done: true }, wrongSeat.deps)).toEqual({ status: 409, body: { ok: false, error: "ReplyRefused", reason: "track refused: seat", commented: true } });
    const landed = replyFx({ stdout: JSON.stringify({ ok: false, retry: true, commented: true, status: "partial", intent: "tk-studio-track", artifacts: [], reason: "r" }) });
    expect((await postReply("TKS-3", { project: "p", done: true }, landed.deps)).body).toMatchObject({ error: "ReplyRetry", commented: true });
    const retry = replyFx({ stdout: JSON.stringify({ ok: false, retry: true, status: "partial", intent: "tk-studio-track", artifacts: [], reason: "track retry: y" }) });
    expect(await postReply("TKS-3", { project: "p", done: true }, retry.deps)).toEqual({ status: 503, body: { ok: false, error: "ReplyRetry", reason: "track retry: y", commented: false } });
    const chatter = replyFx({ stdout: "no json here" });
    expect((await postReply("TKS-3", { project: "p", done: true }, chatter.deps)).body).toMatchObject({ ok: false, error: "ReplyFailed" });
    const spawn = replyFx({ throws: true });
    const failed = await postReply("TKS-3", { project: "p", done: true }, spawn.deps);
    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({ ok: false, error: "ReplyFailed" });
    expect(existsSync(spawn.calls[0]!.args[6]!)).toBe(false);
  });

  test("a 500 detail or a passed-through reason never carries the owner's token or another credential value", async () => {
    const env = { ...OWNER_ENV, SOME_API_PASSWORD: "hunter2-pass" };
    const leaky = `Traceback: auth fake-owner-token for owner@example.com via cloud-test; pw hunter2-pass`;
    const chatter = replyFx({ stdout: "no json", stderr: leaky, env });
    const failed = await postReply("TKS-3", { project: "p", done: true }, chatter.deps);
    expect(failed.status).toBe(500);
    const detail = String(failed.body.detail);
    expect(detail).toContain("emitted no JSON");
    for (const secret of ["fake-owner-token", "owner@example.com", "cloud-test", "hunter2-pass"]) expect(detail).not.toContain(secret);
    expect(detail).toContain("[redacted]");
    const refused = replyFx({ stdout: JSON.stringify({ ok: false, status: "blocked", intent: "tk-studio-track", artifacts: [], reason: "track refused: token fake-owner-token rejected" }) });
    const answer = await postReply("TKS-3", { project: "p", done: true }, refused.deps);
    expect(answer.body).toEqual({ ok: false, error: "ReplyRefused", reason: "track refused: token [redacted] rejected", commented: false });
    const spawn = replyFx({ throws: true, env: { ...OWNER_ENV, TK_STUDIO_ATLASSIAN_OWNER_TOKEN: "ENOENT" } });
    expect(String((await postReply("TKS-3", { project: "p", done: true }, spawn.deps)).body.detail)).not.toContain("ENOENT");
  });

  test("two replies to one issue run one after the other; each answers its own run; a failure never blocks the next", async () => {
    const fx = replyFx();
    const events: string[] = [];
    let n = 0;
    const run: ReplyRunner = async () => {
      const me = ++n;
      events.push(`start ${me}`);
      await new Promise((r) => setTimeout(r, 30));
      events.push(`end ${me}`);
      if (me === 1) throw new Error("first spawn failed");
      return { exit: 0, stdout: JSON.stringify({ ok: true, commented: true, transitioned: false, status: "complete", reason: null, skipped: ["comment: already"] }), stderr: "" };
    };
    const deps = { ...fx.deps, run };
    const [a, b] = await Promise.all([
      postReply("TKS-3", { project: "p", done: true }, deps),
      postReply("TKS-3", { project: "p", done: true }, deps),
    ]);
    expect(events).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    expect(a).toMatchObject({ status: 500, body: { error: "ReplyFailed", detail: "first spawn failed" } });
    expect(b).toMatchObject({ status: 200, body: { ok: true, transitioned: false } });
    // another issue is not held behind them, and the chain drains (a later reply runs at once)
    events.length = 0; n = 1;
    const [c, d] = await Promise.all([
      postReply("TKS-3", { project: "p", done: true }, deps),
      postReply("TKS-4", { project: "p", done: true }, deps),
    ]);
    expect(events).toEqual(["start 2", "start 3", "end 2", "end 3"]);
    expect([c.status, d.status]).toEqual([200, 200]);
  });

  test("an unknown project is 404 UnknownProject, a bad key 400 BadIssue, neither spawns", async () => {
    const fx = replyFx();
    expect(await postReply("TKS-3", { project: "nope", done: true }, fx.deps)).toEqual({ status: 404, body: { ok: false, error: "UnknownProject", project: "nope" } });
    expect((await postReply("tks 3", { project: "p", done: true }, fx.deps)).status).toBe(400);
    expect(fx.calls).toEqual([]);
  });
});
