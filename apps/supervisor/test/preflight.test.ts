import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKnowledgeInjection, buildSkillPrompt, invokeSkill, judgeAuthStatus, MAX_LOGIN_MISSING, maxLoginPreflight, MISSING_STATUS_BLOCK,
  type RunResult, type Spawner,
} from "../src/server";

type Call = { cmd: string; args: string[]; env?: Record<string, string | undefined> };
function fakeSpawner(auth: RunResult, worker: RunResult): { spawner: Spawner; calls: Call[] } {
  const calls: Call[] = [];
  return { calls, spawner: async (cmd, args, opts) => { calls.push({ cmd, args, env: opts.env }); return args[0] === "auth" ? auth : worker; } };
}
const LOGGED_IN: RunResult = { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }) };
const worker = (result: string, is_error = false): RunResult => ({ exit: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error, result }) });

let root: string;
beforeAll(() => {
  // Isolate from the real per-user store (the first invoke runs the §6 drift check).
  process.env.TK_STUDIO_HOME = mkdtempSync(join(tmpdir(), "tk-sup-store-"));
  root = mkdtempSync(join(tmpdir(), "tk-sup-proj-"));
});

describe("Max-login judgement (claude auth status --json)", () => {
  test("the claude.ai subscription login passes", () => {
    expect(judgeAuthStatus(0, LOGGED_IN.stdout)).toBeNull();
  });

  test.each([
    ["non-zero exit", 1, LOGGED_IN.stdout],
    ["unparseable", 0, "not json"],
    ["logged out", 0, JSON.stringify({ loggedIn: false })],
    ["API-key auth is not the Max login", 0, JSON.stringify({ loggedIn: true, authMethod: "apiKey" })],
  ])("%s → gap naming the missing Max login", (_n, exit, stdout) => {
    expect(judgeAuthStatus(exit as number, stdout as string)).toContain(MAX_LOGIN_MISSING);
  });
});

describe("preflight probe", () => {
  test("probes `auth status --json` without the API key — never `--version`", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-parent";
    try {
      const { spawner, calls } = fakeSpawner(LOGGED_IN, worker(""));
      expect(await maxLoginPreflight(spawner)).toBeNull();
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(["auth", "status", "--json"]);
      expect(calls[0].env?.ANTHROPIC_API_KEY).toBeUndefined();
    } finally { delete process.env.ANTHROPIC_API_KEY; }
  });

  test("an API key in the parent env does not stand in for the login", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-parent";
    try {
      const { spawner } = fakeSpawner({ exit: 1, stdout: "", stderr: "not logged in" }, worker(""));
      expect(await maxLoginPreflight(spawner)).toContain(MAX_LOGIN_MISSING);
    } finally { delete process.env.ANTHROPIC_API_KEY; }
  });
});

describe("invokeSkill outcomes", () => {
  test("login absent → blocked naming the Max login; worker never spawned", async () => {
    const { spawner, calls } = fakeSpawner({ exit: 0, stdout: JSON.stringify({ loggedIn: false }), stderr: "" }, worker(""));
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.ran).toBe(false);
    expect(out.status_block).toMatchObject({ status: "blocked" });
    expect(String((out.status_block as any).reason)).toContain(MAX_LOGIN_MISSING);
    expect(calls.some((c) => c.args[0] === "-p")).toBe(false);
  });

  test("worker 401 → blocked naming the Max login, never silent", async () => {
    const { spawner } = fakeSpawner(LOGGED_IN, worker("Failed to authenticate. API Error: 401 authentication_error", true));
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.status_block).toMatchObject({ status: "blocked" });
    expect(String((out.status_block as any).reason)).toContain(MAX_LOGIN_MISSING);
  });

  test("a healthy run whose text mentions 'unauthorized' or 'status 401' is not rewritten to blocked", async () => {
    const text = `Checked the unauthorized-access guard; the probe returned status 401 as expected.\n{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`;
    const { spawner } = fakeSpawner(LOGGED_IN, worker(text));
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.status_block).toMatchObject({ status: "complete" });
    expect(out.run_status_block).toBeUndefined();
  });

  test("worker 401 with its own blocked block → reason names the Max login, the worker's reason kept after it", async () => {
    const text = `API Error: 401 authentication_error\n{"status":"blocked","intent":"tk-studio-activate","artifacts":[],"reason":"could not reach the API"}`;
    const { spawner } = fakeSpawner(LOGGED_IN, worker(text, true));
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    const reason = String((out.status_block as any).reason);
    expect(out.status_block).toMatchObject({ status: "blocked" });
    expect(reason).toStartWith(MAX_LOGIN_MISSING);
    expect(reason).toEndWith("could not reach the API");
  });

  test.each([
    ["its own blocked block", "blocked"],
    ["its own partial block", "partial"],
  ])("an is_error result mentioning an author / OAuth scope keeps %s — not relabelled as a Max-login failure", async (_n, status) => {
    const text = `Tool error: the commit author field is empty and the OAuth scope 'repo' was never granted; cannot authorize the push.\n` +
      `{"status":"${status}","intent":"tk-studio-activate","artifacts":[],"reason":"push tool failed"}`;
    const { spawner } = fakeSpawner(LOGGED_IN, worker(text, true));
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.status_block).toEqual({ status, intent: "tk-studio-activate", artifacts: [], reason: "push tool failed" });
    expect(out.run_status_block).toBeUndefined();
    expect(String((out.status_block as any).reason)).not.toContain(MAX_LOGIN_MISSING);
  });

  test.each([
    ["a bare 401", "API Error: 401 {\"type\":\"error\"}"],
    ["an expired OAuth token", "OAuth token has expired. Please run /login"],
    ["not logged in", "Not logged in · Please run /login"],
  ])("an is_error result with %s → blocked naming the Max login", async (_n, text) => {
    const { spawner } = fakeSpawner(LOGGED_IN, worker(text, true));
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.status_block).toMatchObject({ status: "blocked" });
    expect(String((out.status_block as any).reason)).toContain(MAX_LOGIN_MISSING);
  });

  test.each([
    ["stderr, no JSON on stdout", { exit: 1, stdout: "", stderr: "Not logged in · Please run /login" }],
    ["non-JSON stdout", { exit: 1, stdout: "Error: OAuth token has expired. Please run /login", stderr: "" }],
  ] as [string, RunResult][])("a non-zero exit with the login message in %s → blocked naming the Max login (AC3)", async (_n, res) => {
    const { spawner } = fakeSpawner(LOGGED_IN, res);
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.status_block).toMatchObject({ status: "blocked" });
    expect(String((out.status_block as any).reason)).toStartWith(MAX_LOGIN_MISSING);
    expect(out.conformance_failure).toBeUndefined();
  });

  test("a non-zero exit mentioning only an author / OAuth scope is not relabelled as a Max-login failure", async () => {
    const res: RunResult = { exit: 1, stdout: "", stderr: "Tool error: the commit author field is empty and the OAuth scope 'repo' was never granted; cannot authorize the push." };
    const { spawner } = fakeSpawner(LOGGED_IN, res);
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.status_block).toBeUndefined();
    expect(out.conformance_failure).toBe(MISSING_STATUS_BLOCK);
  });

  test("an error-subtype result with no `result` text still reports its cost", async () => {
    const res: RunResult = { exit: 1, stderr: "", stdout: JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, total_cost_usd: 0.5 }) };
    const { spawner } = fakeSpawner(LOGGED_IN, res);
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.total_cost_usd).toBe(0.5);
  });

  test("worker ends without a block → the named conformance failure (AD-11)", async () => {
    const { spawner } = fakeSpawner(LOGGED_IN, worker("I checked things. All good."));
    const out = await invokeSkill(root, "tk-studio-activate", {}, spawner);
    expect(out.status_block).toBeUndefined();
    expect(out.conformance_failure).toBe(MISSING_STATUS_BLOCK);
  });
});

describe("headless prompt (§1: the skill line comes first)", () => {
  test("knowledge injected → the prompt still starts with /tk-studio:<skill>; the preamble follows it", async () => {
    const spine = join(mkdtempSync(join(tmpdir(), "tk-sup-spine-")), "spine.md");
    writeFileSync(spine, "# spine\nanchor S-1: the loop is headless.\n");
    const { spawner, calls } = fakeSpawner(LOGGED_IN, worker(`{"status":"complete","intent":"tk-studio-activate","artifacts":[]}`));
    const out = await invokeSkill(root, "tk-studio-activate",
      { payload: { verb: "check" }, knowledge: { spine: { path: spine, present: true }, seed: { path: "x", present: false } } }, spawner);
    expect(out.knowledge_injected).toEqual(["spine"]);
    const prompt = calls.find((c) => c.args[0] === "-p")!.args[1];
    expect(prompt).toStartWith("/tk-studio:tk-studio-activate ");
    const [skillLine, ...rest] = prompt.split("\n");
    expect(JSON.parse(skillLine.slice("/tk-studio:tk-studio-activate ".length))).toEqual({ verb: "check", directory: root });
    const body = rest.join("\n");
    expect(body).toContain("PROVISIONAL KNOWLEDGE");
    expect(body).toContain("anchor S-1: the loop is headless.");
    expect(body).toContain("HEADLESS driver invocation");
  });

  test("buildSkillPrompt starts with the skill line with or without a preamble", () => {
    const injection = buildKnowledgeInjection({ spine: { path: "s.md", present: true } }, () => "spine text");
    expect(injection.preamble).not.toBe("");
    for (const inj of [injection, buildKnowledgeInjection(undefined)]) {
      expect(buildSkillPrompt("tk-studio-detect", { directory: "d" }, inj)).toStartWith(`/tk-studio:tk-studio-detect {"directory":"d"}\n`);
    }
  });
});
