import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  invokeSkill, judgeAuthStatus, MAX_LOGIN_MISSING, maxLoginPreflight, MISSING_STATUS_BLOCK,
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
