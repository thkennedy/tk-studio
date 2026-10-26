import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReport, checkAuthPreflight, checkStatusBlockDoc, checkUnrunnableCoreDoc, compareReports, DRIVER_NAME,
  evaluateHarness, HARNESS_TIMEOUT_S, harnessInvokeArgs, harnessSkip, harnessState, isDirectDrive, isHarnessDrive, parseArgs,
  resolveDriveArgv, runDirectRunner, stagePluginFixture, translateDrive, type Check, type Drive, type RunnerExec, type StatusSchema,
} from "../src/conformance";
import { buildWorkerCommand, DenyProfileRefused, invokeSkill, validateDenyProfile, type Spawner } from "../src/server";
import { tempDir } from "./tmp";

const SANDBOX = join(tmpdir(), "tk-conf-sandbox");
const PLUGIN = join(tmpdir(), "plugin-root");
const SCHEMA: StatusSchema = {
  required: ["status", "intent", "artifacts"],
  properties: { status: { enum: ["complete", "partial", "blocked"] }, intent: {}, artifacts: {}, reason: {} },
};

describe("evolve and launch surfaces", () => {
  test("evolve: evolve.py is the core, `draft` is carried as verb", () => {
    const drive: Drive = { argv: ["lib/evolve.py", "draft", "--directory", "{sandbox}", "--dry-run"], expect: "json" };
    expect(isDirectDrive("tk-studio-evolve", drive)).toBe(false);
    expect(translateDrive("tk-studio-evolve", drive, SANDBOX, PLUGIN)).toEqual({ verb: "draft", directory: SANDBOX, dry_run: true });
  });

  test("launch: launch.py status|start run through the supervisor with the verb", () => {
    const status: Drive = { argv: ["lib/launch.py", "status", "--directory", "{sandbox}"] };
    const start: Drive = { argv: ["lib/launch.py", "start", "--directory", "{sandbox}", "--spec", "_bmad-output/specs/spec-none", "--wait", "0"] };
    expect(isDirectDrive("tk-studio-launch", status)).toBe(false);
    expect(isDirectDrive("tk-studio-launch", start)).toBe(false);
    expect(translateDrive("tk-studio-launch", status, SANDBOX, PLUGIN)).toEqual({ verb: "status", directory: SANDBOX });
    expect(translateDrive("tk-studio-launch", start, SANDBOX, PLUGIN))
      .toEqual({ verb: "start", directory: SANDBOX, spec: "_bmad-output/specs/spec-none", wait: "0" });
  });

  test("launch: pipeline.py resolve|apply are not §2 payload verbs — they run direct", () => {
    expect(isDirectDrive("tk-studio-launch", { argv: ["lib/pipeline.py", "resolve", "--directory", "{sandbox}", "--story", "1-1-conformance"] })).toBe(true);
    expect(isDirectDrive("tk-studio-launch", { argv: ["lib/pipeline.py", "apply", "--directory", "{sandbox}", "--dry-run"] })).toBe(true);
  });
});

describe("plugin-relative --directory", () => {
  test("a relative --directory without {sandbox} resolves against the plugin root", () => {
    const drive: Drive = { argv: ["lib/evolve.py", "draft", "--directory", "contracts/conformance/fixtures/unparseable-proposals-ledger", "--dry-run"] };
    const fixture = join(PLUGIN, "contracts/conformance/fixtures/unparseable-proposals-ledger");
    expect(resolveDriveArgv(drive, SANDBOX, PLUGIN)[3]).toBe(fixture);
    expect(translateDrive("tk-studio-evolve", drive, SANDBOX, PLUGIN)).toEqual({ verb: "draft", directory: fixture, dry_run: true });
  });

  test("a {sandbox} directory is substituted, never re-rooted", () => {
    const drive: Drive = { argv: ["lib/consolidate.py", "run", "--directory", "{sandbox}/nowhere"] };
    expect(resolveDriveArgv(drive, SANDBOX, PLUGIN)[3]).toBe(`${SANDBOX}/nowhere`);
  });
});

describe("supervisor-routed plugin fixtures are staged into the sandbox", () => {
  const REL = "contracts/conformance/fixtures/unparseable-proposals-ledger";
  const setup = () => {
    const plugin = tempDir("tk-conf-plugin-");
    const sandbox = tempDir("tk-conf-sbx-");
    mkdirSync(join(plugin, REL), { recursive: true });
    writeFileSync(join(plugin, REL, "proposals.md"), "not a ledger");
    return { plugin, sandbox };
  };
  const drive: Drive = { argv: ["lib/evolve.py", "draft", "--directory", REL, "--dry-run"], expect: "refusal", marker: "cannot parse" };

  test("the payload points at a sandbox copy; the plugin original is untouched", () => {
    const { plugin, sandbox } = setup();
    expect(isDirectDrive("tk-studio-evolve", drive)).toBe(false);
    const payload = stagePluginFixture(translateDrive("tk-studio-evolve", drive, sandbox, plugin), plugin, sandbox);
    const staged = payload.directory as string;
    expect(staged).toBe(join(sandbox, "fixtures", REL));
    expect(readFileSync(join(staged, "proposals.md"), "utf-8")).toBe("not a ledger");
    expect(payload).toEqual({ verb: "draft", directory: staged, dry_run: true });
    expect(readdirSync(join(plugin, REL))).toEqual(["proposals.md"]);
    expect(readFileSync(join(plugin, REL, "proposals.md"), "utf-8")).toBe("not a ledger");
    // Deterministic per sandbox: a repeat drive keys the same payload.
    expect(stagePluginFixture(translateDrive("tk-studio-evolve", drive, sandbox, plugin), plugin, sandbox)).toEqual(payload);
  });

  test("a {sandbox} directory is not copied", () => {
    const { plugin, sandbox } = setup();
    const own: Drive = { argv: ["lib/evolve.py", "draft", "--directory", "{sandbox}", "--dry-run"] };
    const payload = stagePluginFixture(translateDrive("tk-studio-evolve", own, sandbox, plugin), plugin, sandbox);
    expect(payload.directory).toBe(sandbox);
    expect(existsSync(join(sandbox, "fixtures"))).toBe(false);
  });

  test("a missing fixture throws (reported as an untranslatable drive), never copies", () => {
    const { plugin, sandbox } = setup();
    const missing: Drive = { argv: ["lib/evolve.py", "draft", "--directory", "contracts/conformance/fixtures/absent"] };
    expect(() => stagePluginFixture(translateDrive("tk-studio-evolve", missing, sandbox, plugin), plugin, sandbox)).toThrow("does not exist in the plugin");
    expect(existsSync(join(sandbox, "fixtures"))).toBe(false);
  });

  test("the direct route keeps the plugin path", () => {
    const { plugin, sandbox } = setup();
    expect(resolveDriveArgv(drive, sandbox, plugin)[3]).toBe(join(plugin, REL));
  });
});

describe("harness drives", () => {
  const harness: Drive = {
    assertion: "denied-core-refusal", prompt: "/tk-studio:tk-studio-detect",
    settings: "fixtures/harness-deny-core.settings.json", expect: "harness-blocked",
  };

  test("no --harness: one ok check naming the skip and its reason — no throw", () => {
    expect(isHarnessDrive(harness)).toBe(true);
    expect(() => isDirectDrive("tk-studio-detect", harness)).not.toThrow();
    const check = harnessSkip(harness);
    expect(check.ok).toBe(true);
    expect(check.assertion).toBe("denied-core-refusal");
    expect(check.detail).toContain("skipped");
    expect(check.detail).toContain("--harness");
    expect(check.detail).toContain("spend-bearing");
  });

  test("--harness: tk_invoke args carry the surface, an empty payload, the bound and the absolute deny profile", () => {
    expect(harnessInvokeArgs("tk-studio-detect", harness, SANDBOX, PLUGIN)).toEqual({
      directory: SANDBOX, skill: "tk-studio-detect", payload: {}, timeout_s: HARNESS_TIMEOUT_S,
      deny_profile: join(PLUGIN, "contracts", "conformance", "fixtures/harness-deny-core.settings.json"),
    });
    expect(HARNESS_TIMEOUT_S).toBe(180);
    expect(harnessInvokeArgs("tk-studio-detect", { ...harness, timeout: 90 }, SANDBOX, PLUGIN).timeout_s).toBe(90);
    expect("deny_profile" in harnessInvokeArgs("tk-studio-detect", { ...harness, settings: undefined }, SANDBOX, PLUGIN)).toBe(false);
  });

  test("harness_pass.state mirrors the runner", () => {
    expect(harnessState(0, false)).toBe("none declared");
    expect(harnessState(1, false)).toBe("skipped: --harness not given (spend-bearing)");
    expect(harnessState(1, true)).toBe("ran");
  });

  const judge = (result: Record<string, unknown> | undefined, toolError?: string, drive: Drive = harness) =>
    evaluateHarness("tk-studio-detect", drive, toolError ? { toolError } : { result }, SCHEMA);
  const blocked = (extra: Record<string, unknown> = {}) => ({
    ran: true, status_block: { status: "blocked", intent: "tk-studio-detect", artifacts: [], reason: "core denied: Bash", ...extra },
  });

  test("pass: schema-valid blocked block, intent = surface, reason named", () => {
    expect(judge(blocked()).ok).toBe(true);
  });

  test("declared marker must be inside the reason", () => {
    const marked = { ...harness, marker: "denied" };
    expect(judge(blocked(), undefined, marked).ok).toBe(true);
    const missing = judge(blocked(), undefined, { ...harness, marker: "unrunnable" });
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain("marker");
  });

  test("a complete block under denial fails", () => {
    const c = judge({ ran: true, status_block: { status: "complete", intent: "tk-studio-detect", artifacts: [] } });
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("'complete'");
  });

  test("a missing block (question / free text) fails", () => {
    const c = judge({ ran: true, conformance_failure: "conformance failure (AD-11): no block", output_tail: "Should I proceed?" });
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("without a terminal status block");
  });

  test("a key outside the schema fails", () => {
    const c = judge(blocked({ question: "proceed?" }));
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("extra [question]");
  });

  test("an empty reason fails", () => {
    expect(judge(blocked({ reason: " " })).ok).toBe(false);
  });

  test("a supervisor preflight refusal (nothing driven) fails", () => {
    const c = judge({ ran: false, status_block: { status: "blocked", intent: "tk-studio-detect", artifacts: [], reason: "auth preflight: harness auth: Max login missing" } });
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("nothing was driven");
  });

  test("a hang fails", () => {
    const c = judge(undefined, "claude timed out after 180s (process tree killed)");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("hang");
  });
});

describe("static checks (mirror runner.py)", () => {
  const dir = tempDir("tk-conf-skill-");
  const skill = (name: string, body: string): string => {
    const path = join(dir, `${name}.md`);
    writeFileSync(path, body);
    return readFileSync(path, "utf-8");
  };
  const GOOD = skill("good", [
    "# detect", "",
    '{"status": "blocked", "intent": "tk-studio-detect", "artifacts": [], "reason": "ambiguous — ask"}', "",
    "If the deterministic core is unrunnable (tool call denied), end blocked naming the gap.",
  ].join("\n"));

  test("a documented, schema-valid example with the surface's intent passes", () => {
    expect(checkStatusBlockDoc("tk-studio-detect", GOOD, SCHEMA)).toEqual({ assertion: "status-block", ok: true, detail: "" });
    expect(checkUnrunnableCoreDoc(GOOD).ok).toBe(true);
  });

  test("no example, bad JSON, extra key, wrong intent, bad status each fail", () => {
    const cases: [string, string][] = [
      ["none", "# nothing here"],
      ["badjson", '{"status": "blocked",'],
      ["extra", '{"status": "blocked", "intent": "tk-studio-detect", "artifacts": [], "x": 1}'],
      ["intent", '{"status": "blocked", "intent": "tk-studio-other", "artifacts": []}'],
      ["enum", '{"status": "done", "intent": "tk-studio-detect", "artifacts": []}'],
    ];
    for (const [name, body] of cases) {
      const c = checkStatusBlockDoc("tk-studio-detect", skill(name, body), SCHEMA);
      expect(c.assertion).toBe("status-block");
      expect(c.ok).toBe(false);
      expect(c.detail).not.toBe("");
    }
  });

  test("unrunnable-core requires the canonical paragraph", () => {
    const c = checkUnrunnableCoreDoc(skill("loose", "ends blocked when things go wrong"));
    expect(c).toMatchObject({ assertion: "unrunnable-core", ok: false });
  });

  test("auth-preflight: declared posture required; external calls may not say none", () => {
    expect(checkAuthPreflight({ auth_preflight: "none needed" }).ok).toBe(true);
    expect(checkAuthPreflight({}).ok).toBe(false);
    expect(checkAuthPreflight({ external_calls: true, auth_preflight: "None — trust me" }).ok).toBe(false);
    expect(checkAuthPreflight({ external_calls: true, auth_preflight: "npm registry only" }).ok).toBe(true);
  });
});

describe("deny-only settings profile", () => {
  const dir = tempDir("tk-conf-profile-");
  const profile = (name: string, body: unknown): string => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
    return path;
  };

  test("a deny-only profile is accepted and forwarded as --settings", () => {
    const path = profile("deny", { permissions: { deny: ["Bash", "PowerShell"] } });
    expect(validateDenyProfile(path)).toEqual({ path, deny: ["Bash", "PowerShell"] });
    const { argv } = buildWorkerCommand({ prompt: "x", denyProfile: path });
    expect(argv).toEqual(["-p", "x", "--output-format", "json", "--permission-mode", "auto", "--settings", path]);
  });

  test.each([
    ["allow", { permissions: { deny: ["Bash"], allow: ["Read"] } }],
    ["defaultMode", { permissions: { deny: ["Bash"], defaultMode: "bypassPermissions" } }],
    ["extra-top", { permissions: { deny: ["Bash"] }, env: { X: "1" } }],
    ["non-string", { permissions: { deny: ["Bash", 3] } }],
    ["no-deny", { permissions: {} }],
    ["array", [1]],
    ["not-json", "{ nope"],
  ])("anything beyond permissions.deny is refused by name: %s", (name, body) => {
    const path = profile(String(name), body);
    expect(() => buildWorkerCommand({ prompt: "x", denyProfile: path })).toThrow(DenyProfileRefused);
  });

  test("a refused profile starts no process", async () => {
    let spawned = 0;
    const spawner: Spawner = async () => { spawned++; return { exit: 0, stdout: "", stderr: "" }; };
    const bad = profile("bad", { permissions: { allow: ["Bash"] } });
    await expect(invokeSkill(tmpdir(), "tk-studio-detect", { deny_profile: bad }, spawner)).rejects.toThrow(DenyProfileRefused);
    expect(spawned).toBe(0);
  });

  test("a relative profile path is refused by name before any process starts", async () => {
    let spawned = 0;
    const spawner: Spawner = async () => { spawned++; return { exit: 0, stdout: "", stderr: "" }; };
    expect(() => buildWorkerCommand({ prompt: "x", denyProfile: "fixtures/harness-deny-core.settings.json" })).toThrow(DenyProfileRefused);
    await expect(invokeSkill(tmpdir(), "tk-studio-detect", { deny_profile: "deny.json" }, spawner)).rejects.toThrow("not an absolute path");
    expect(spawned).toBe(0);
  });

  test("a valid absolute profile: the worker runs --permission-mode auto with --settings <that path>", async () => {
    const path = profile("worker", { permissions: { deny: ["Bash", "PowerShell"] } });
    const calls: string[][] = [];
    const spawner: Spawner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === "auth") return { exit: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" };
      const block = { status: "blocked", intent: "tk-studio-detect", artifacts: [], reason: "core denied" };
      return { exit: 0, stdout: JSON.stringify({ result: JSON.stringify(block), is_error: false }), stderr: "" };
    };
    const project = tempDir("tk-conf-project-");
    const out = await invokeSkill(project, "tk-studio-detect", { deny_profile: path }, spawner);
    const worker = calls.find((a) => a[0] === "-p");
    expect(worker).toBeDefined();
    expect(worker!.slice(2)).toEqual(["--output-format", "json", "--permission-mode", "auto", "--settings", path]);
    expect((out.status_block as Record<string, unknown>).status).toBe("blocked");
  });

  test("a non-normalised absolute path is validated and forwarded as its resolve() form", () => {
    const path = profile("canonical", { permissions: { deny: ["Bash"] } });
    const dotted = `${dir}/./canonical.json`;
    const raw = `${dir}/a/../canonical.json`;
    const read: string[] = [];
    expect(validateDenyProfile(raw, (p) => { read.push(p); return readFileSync(p, "utf-8"); })).toEqual({ path, deny: ["Bash"] });
    expect(read).toEqual([path]);
    expect(buildWorkerCommand({ prompt: "x", denyProfile: raw }).argv.slice(-2)).toEqual(["--settings", path]);
    expect(buildWorkerCommand({ prompt: "x", denyProfile: dotted }).argv.slice(-2)).toEqual(["--settings", path]);
  });

  test("no profile → no --settings flag", () => {
    expect(buildWorkerCommand({ prompt: "x" }).argv).not.toContain("--settings");
  });
});

describe("report and comparison", () => {
  const ok = (assertion: string): Check => ({ assertion, ok: true, detail: "" });
  const statics = ["registered", "status-block", "unrunnable-core", "auth-preflight"].map(ok);
  const surfaces = (): Record<string, Check[]> => ({
    "tk-studio-detect": [...statics, ok("headless-clean"), ok("blocked-on-ambiguity"), ok("denied-core-refusal")],
    "tk-studio-evolve": [...statics, ok("headless-clean")],
  });

  test("report names the studio supervisor as driver and carries harness_pass", () => {
    const r = buildReport(1, surfaces(), { declared: 1, state: harnessState(1, false) });
    expect(r.driver).toBe(DRIVER_NAME);
    expect(DRIVER_NAME).toBe("tk-studio-supervisor");
    expect(r).toMatchObject({ ok: true, surfaces_checked: 2, checks_run: 12, harness_pass: { declared: 1, state: "skipped: --harness not given (spend-bearing)" } });
  });

  test("equal reports compare ok", () => {
    expect(compareReports({ ok: true, surfaces: surfaces() }, { ok: true, surfaces: surfaces() })).toEqual({ ok: true, divergences: [] });
  });

  test("a check-count divergence fails", () => {
    const sup = surfaces();
    sup["tk-studio-evolve"] = sup["tk-studio-evolve"].slice(0, 4);
    const c = compareReports({ ok: true, surfaces: sup }, { ok: true, surfaces: surfaces() });
    expect(c.ok).toBe(false);
    expect(c.divergences).toEqual(["tk-studio-evolve: 4 checks through the supervisor vs 5 direct"]);
  });

  test("an assertion-name divergence fails", () => {
    const sup = surfaces();
    sup["tk-studio-evolve"][4] = ok("blocked-on-ambiguity");
    expect(compareReports({ ok: true, surfaces: sup }, { ok: true, surfaces: surfaces() }).ok).toBe(false);
  });

  test("a surface-set divergence fails, both directions named", () => {
    const sup = surfaces();
    delete sup["tk-studio-evolve"];
    sup["tk-studio-launch"] = [...statics];
    const c = compareReports({ ok: true, surfaces: sup }, { ok: true, surfaces: surfaces() });
    expect(c.ok).toBe(false);
    expect(c.divergences).toContain("tk-studio-evolve: checked direct, not through the supervisor");
    expect(c.divergences).toContain("tk-studio-launch: checked through the supervisor, not direct");
  });

  test("one side not ok fails", () => {
    expect(compareReports({ ok: false, surfaces: surfaces() }, { ok: true, surfaces: surfaces() }).divergences)
      .toEqual(["supervisor-driven report is not ok"]);
    expect(compareReports({ ok: true, surfaces: surfaces() }, { ok: false, surfaces: surfaces() }).divergences)
      .toEqual(["direct runner report is not ok"]);
  });
});

describe("direct runner (--compare-direct baseline)", () => {
  const report = { ok: false, surfaces_checked: 1, checks_run: 1, harness_pass: { declared: 0, state: "none declared" }, failures: [], surfaces: { a: [] } };
  const exec = (res: Awaited<ReturnType<RunnerExec>>, seen: string[][] = []): RunnerExec =>
    async (_cmd, args) => { seen.push(args); return res; };

  test("exit 1 with a report returns it; --harness forwarded iff given", async () => {
    const seen: string[][] = [];
    expect(await runDirectRunner(PLUGIN, true, exec({ stdout: JSON.stringify(report), exit: 1, timedOut: false }, seen))).toEqual(report);
    expect(seen[0].slice(2)).toEqual(["run", "--no-emit", "--harness"]);
    await runDirectRunner(PLUGIN, false, exec({ stdout: JSON.stringify(report), exit: 0, timedOut: false }, seen));
    expect(seen[1]).not.toContain("--harness");
  });

  test("an exit other than 0/1 throws (runner unrunnable → exit 2)", async () => {
    await expect(runDirectRunner(PLUGIN, false, exec({ stdout: '{"ok": false, "error": "x"}', exit: 2, timedOut: false }))).rejects.toThrow("exited 2");
  });

  test("stdout carrying no report throws", async () => {
    await expect(runDirectRunner(PLUGIN, false, exec({ stdout: "Traceback ...", exit: 1, timedOut: false }))).rejects.toThrow("no report");
  });

  test("a timeout throws", async () => {
    await expect(runDirectRunner(PLUGIN, false, exec({ stdout: "", exit: 2, timedOut: true }))).rejects.toThrow("timed out");
  });
});

describe("arguments", () => {
  test("--harness and --compare-direct parse", () => {
    expect(parseArgs(["--harness", "--compare-direct", "--json"])).toMatchObject({ harness: true, compareDirect: true, json: true });
  });

  test("--compare-direct with --surface is refused (the comparison is whole-suite)", () => {
    expect(() => parseArgs(["--compare-direct", "--surface", "tk-studio-detect"])).toThrow("--surface");
  });

  test("a flag missing its value is refused", () => {
    expect(() => parseArgs(["--surface"])).toThrow("needs a value");
  });
});
