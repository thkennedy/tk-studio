import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkerOptions } from "../src/cli";
import { jobOptions, loadSupervisorConfig, SupervisorConfigInvalid } from "../src/config";
import { claudeBin, sbxBin, supervisorConfigPath } from "../src/env";
import {
  buildSbxCommand, buildWorkerCommand, buildWorkerEnv, DenyProfileRefused, HostBypassRefused, invokeSkill, MAX_LOGIN_MISSING, maxLoginPreflight,
  parseRegQuery, SbxSandboxMissing, sbxEnvPassthrough, TierRefused, toVmPath, userEnvFromRegistry, type RunResult, type Spawner,
} from "../src/server";

type Call = { cmd: string; args: string[]; cwd?: string; env?: Record<string, string | undefined> };
const LOGGED_IN: RunResult = { exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) };
const BLOCK = { status: "complete", intent: "tk-studio-activate", artifacts: [] };
const WORKER: RunResult = { exit: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(BLOCK), total_cost_usd: 0.42 }) };

/** A spawner answering the login probe (`auth` anywhere in argv) and the worker. */
function fakeSpawner(auth: RunResult = LOGGED_IN, worker: RunResult = WORKER) {
  const calls: Call[] = [];
  const spawner: Spawner = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env });
    return args.includes("auth") && args.includes("status") ? auth : worker;
  };
  return { calls, spawner };
}

let root: string;
beforeAll(() => {
  process.env.TK_STUDIO_HOME = mkdtempSync(join(tmpdir(), "tk-sup-store-"));
  root = mkdtempSync(join(tmpdir(), "tk-sup-tier-proj-"));
});

describe("toVmPath: the host root as the sbx microVM mounts it", () => {
  // Built by concatenation: no machine path literal in a tracked file.
  const drive = "C" + ":";
  const bs = "\\";
  test.each([
    [`${drive}${bs}GitHub${bs}p`, "/" + "c/GitHub/p"],
    [`${drive}/GitHub/p`, "/" + "c/GitHub/p"],
    [`${drive}${bs}GitHub${bs}p${bs}`, "/" + "c/GitHub/p"],
    ["D" + ":" + `${bs}work${bs}Game One`, "/d/work/Game One"],
    ["/" + "c/GitHub/p", "/" + "c/GitHub/p"],
    ["/srv/p", "/srv/p"],
  ])("%s → %s", (host, vm) => {
    expect(toVmPath(host)).toBe(vm);
  });

  test("a relative path cannot be mapped → named", () => {
    expect(() => toVmPath("GitHub/p")).toThrow("VmPathUnderivable");
  });
});

describe("env seams", () => {
  test("SBX_BIN (default `sbx`); TK_SUPERVISOR_CONFIG optional", () => {
    expect(sbxBin({})).toBe("sbx");
    expect(sbxBin({ SBX_BIN: " my-sbx " })).toBe("my-sbx");
    expect(supervisorConfigPath({})).toBeUndefined();
    expect(supervisorConfigPath({ TK_SUPERVISOR_CONFIG: " " })).toBeUndefined();
    expect(supervisorConfigPath({ TK_SUPERVISOR_CONFIG: "cfg.yaml" })).toBe("cfg.yaml");
  });
});

describe("supervisor per-job config", () => {
  const load = (text: string) => loadSupervisorConfig("cfg.yaml", () => text);

  test("unset → no config; empty file → no jobs", () => {
    expect(loadSupervisorConfig(undefined)).toEqual({ jobs: {} });
    expect(load("")).toEqual({ jobs: {} });
  });

  test("parses tier, permission_mode and sandbox keyed <project-id>/<job-id>", () => {
    const cfg = load("jobs:\n  p/studio-health:\n    tier: sbx\n    permission_mode: bypassPermissions\n    sandbox: claude-p\n  p/other:\n    permission_mode: acceptEdits\n");
    expect(jobOptions(cfg, "p", "studio-health")).toEqual({ tier: "sbx", permission_mode: "bypassPermissions", sandbox: "claude-p" });
    expect(jobOptions(cfg, "p", "other")).toEqual({ permission_mode: "acceptEdits" });
    expect(jobOptions(cfg, "p", "unlisted")).toEqual({});
  });

  test.each([
    ["an unknown tier", "jobs:\n  p/j:\n    tier: gpu\n", "tier 'gpu'"],
    ["an unknown permission mode", "jobs:\n  p/j:\n    permission_mode: yolo\n", "permission_mode 'yolo'"],
    ["an unknown job key", "jobs:\n  p/j:\n    model: claude-opus\n", "unknown key 'model'"],
    ["an unknown top-level key", "tiers: {}\n", "unknown top-level key 'tiers'"],
    ["an empty sandbox", "jobs:\n  p/j:\n    sandbox: ''\n", "sandbox"],
    ["a job key without a project id", "jobs:\n  j:\n    tier: sbx\n", "'<project-id>/<job-id>'"],
    ["a job key with an empty project id", "jobs:\n  /j:\n    tier: sbx\n", "'<project-id>/<job-id>'"],
    ["a job key with an empty job id", "jobs:\n  p/:\n    tier: sbx\n", "'<project-id>/<job-id>'"],
    ["a non-mapping", "- a\n- b\n", "not a mapping"],
    ["broken YAML", "jobs: [unclosed\n", "not YAML"],
  ])("%s → SupervisorConfigInvalid", (_n, text, why) => {
    expect(() => load(text)).toThrow(SupervisorConfigInvalid);
    expect(() => load(text)).toThrow(why);
  });

  test("a project id may carry spaces (basename(root) fallback); the job id follows the last `/`", () => {
    const cfg = load("jobs:\n  Game One/studio-health:\n    permission_mode: acceptEdits\n  a/b/j:\n    tier: sbx\n");
    expect(jobOptions(cfg, "Game One", "studio-health")).toEqual({ permission_mode: "acceptEdits" });
    expect(jobOptions(cfg, "a/b", "j")).toEqual({ tier: "sbx" });
  });

  test("an unreadable file → SupervisorConfigInvalid", () => {
    expect(() => loadSupervisorConfig(join(root, "missing.yaml"))).toThrow(SupervisorConfigInvalid);
  });
});

describe("tier resolution: explicit ?? stored ?? config ?? host", () => {
  test("no tier anywhere → host, mode default (auto applies)", () => {
    expect(resolveWorkerOptions({})).toEqual({ tier: "host" });
  });

  test("each layer wins over the ones after it", () => {
    const config = { tier: "sbx" as const, sandbox: "cfg-sb", permission_mode: "plan" };
    expect(resolveWorkerOptions({}, {}, config)).toEqual({ tier: "sbx", sandbox: "cfg-sb", permissionMode: "plan" });
    expect(resolveWorkerOptions({}, { tier: "host", permissionMode: "acceptEdits" }, config))
      .toEqual({ tier: "host", sandbox: "cfg-sb", permissionMode: "acceptEdits" });
    expect(resolveWorkerOptions({ tier: "sbx", sandbox: "mine" }, { tier: "host" }, config))
      .toEqual({ tier: "sbx", sandbox: "mine", permissionMode: "plan" });
    expect(resolveWorkerOptions({}, { tier: "sbx", sandbox: "a" }, { sandbox: "b" }).sandbox).toBe("a");
  });

  test("acceptEdits via config and via the submission", () => {
    expect(resolveWorkerOptions({}, {}, { permission_mode: "acceptEdits" }).permissionMode).toBe("acceptEdits");
    expect(resolveWorkerOptions({ permissionMode: "acceptEdits" }).permissionMode).toBe("acceptEdits");
  });

  test("model/effort: submission (explicit ?? stored) only — the config never chooses one", () => {
    expect(resolveWorkerOptions({ model: "m-explicit" }, { model: "m-stored", effort: "low" }))
      .toEqual({ tier: "host", model: "m-explicit", effort: "low" });
    expect(resolveWorkerOptions({})).not.toHaveProperty("model");
  });

  test("bypass on the host tier (default, explicit, stored or config) → HostBypassRefused", () => {
    expect(() => resolveWorkerOptions({ permissionMode: "bypassPermissions" })).toThrow(HostBypassRefused);
    expect(() => resolveWorkerOptions({ permissionMode: "bypassPermissions", tier: "host" }, {}, { tier: "sbx", sandbox: "s" })).toThrow(HostBypassRefused);
    expect(() => resolveWorkerOptions({}, { permissionMode: "bypassPermissions" })).toThrow(HostBypassRefused);
    expect(() => resolveWorkerOptions({}, {}, { permission_mode: "bypassPermissions" })).toThrow(HostBypassRefused);
  });

  test("bypass on the sbx tier is accepted", () => {
    expect(resolveWorkerOptions({ tier: "sbx", sandbox: "claude-p", permissionMode: "bypassPermissions" }))
      .toEqual({ tier: "sbx", sandbox: "claude-p", permissionMode: "bypassPermissions" });
    expect(resolveWorkerOptions({}, {}, { tier: "sbx", sandbox: "s", permission_mode: "bypassPermissions" }).permissionMode).toBe("bypassPermissions");
  });

  test("a config entry is one unit: its permission_mode applies only on the entry's own tier (none → host)", () => {
    const sbxBypass = { tier: "sbx" as const, sandbox: "s", permission_mode: "bypassPermissions" };
    // Stored host (frozen at enqueue) + an sbx entry with bypass → host under the default mode, not HostBypassRefused.
    const hostRun = resolveWorkerOptions({}, { tier: "host" }, sbxBypass);
    expect(hostRun.tier).toBe("host");
    expect(hostRun.permissionMode).toBeUndefined();
    expect(buildWorkerCommand({ prompt: "x", tier: hostRun.tier, permissionMode: hostRun.permissionMode }).argv).toContain("auto");
    expect(resolveWorkerOptions({ tier: "host" }, {}, sbxBypass).permissionMode).toBeUndefined();
    // A tierless (host) entry's mode never reaches an sbx run; the stored/explicit mode still wins.
    expect(resolveWorkerOptions({ tier: "sbx", sandbox: "x" }, {}, { permission_mode: "bypassPermissions" }).permissionMode).toBeUndefined();
    expect(resolveWorkerOptions({}, { tier: "sbx", sandbox: "x" }, { permission_mode: "acceptEdits" }).permissionMode).toBeUndefined();
    expect(resolveWorkerOptions({}, { tier: "host", permissionMode: "plan" }, sbxBypass).permissionMode).toBe("plan");
    // Matching tiers: the entry applies whole; a host bypass that would actually run is still refused.
    expect(resolveWorkerOptions({}, {}, sbxBypass).permissionMode).toBe("bypassPermissions");
    expect(() => resolveWorkerOptions({}, { tier: "host" }, { tier: "host", permission_mode: "bypassPermissions" })).toThrow(HostBypassRefused);
    expect(() => resolveWorkerOptions({ permissionMode: "bypassPermissions" }, { tier: "host" }, sbxBypass)).toThrow(HostBypassRefused);
  });

  test("sbx on a root with no microVM path (a UNC share) → VmPathUnderivable at resolution; host unaffected", () => {
    const unc = "\\\\" + "server" + "\\" + "share" + "\\" + "p";
    expect(() => toVmPath(unc)).toThrow("VmPathUnderivable");
    expect(() => resolveWorkerOptions({ tier: "sbx", sandbox: "s" }, {}, {}, unc)).toThrow("VmPathUnderivable");
    expect(() => resolveWorkerOptions({}, { tier: "sbx", sandbox: "s" }, {}, unc)).toThrow("VmPathUnderivable");
    expect(resolveWorkerOptions({}, {}, {}, unc)).toEqual({ tier: "host" });
    expect(resolveWorkerOptions({ tier: "sbx", sandbox: "s" }, {}, {}, "/srv/p")).toEqual({ tier: "sbx", sandbox: "s" });
  });

  test("an unknown tier → TierRefused; sbx without a sandbox → SbxSandboxMissing", () => {
    expect(() => resolveWorkerOptions({ tier: "gpu" })).toThrow(TierRefused);
    expect(() => resolveWorkerOptions({}, { tier: "gpu" })).toThrow(TierRefused);
    expect(() => resolveWorkerOptions({ tier: "sbx" })).toThrow(SbxSandboxMissing);
  });
});

describe("the worker command line per tier", () => {
  test("host bypass refused; sbx bypass accepted", () => {
    expect(() => buildWorkerCommand({ prompt: "x", permissionMode: "bypassPermissions", tier: "host" })).toThrow(HostBypassRefused);
    expect(buildWorkerCommand({ prompt: "x", permissionMode: "bypassPermissions", tier: "sbx" }).argv)
      .toEqual(["-p", "x", "--output-format", "json", "--permission-mode", "bypassPermissions"]);
    expect(() => buildWorkerCommand({ prompt: "x", tier: "gpu" })).toThrow(TierRefused);
  });

  test("buildSbxCommand: sbx exec <sandbox> timeout -k <s> <guard> env -u ANTHROPIC_API_KEY -C <vm-root> claude <worker argv>", () => {
    const prev = process.env.SBX_BIN;
    process.env.SBX_BIN = "fake-sbx";
    try {
      const worker = buildWorkerCommand({ prompt: "a prompt; $(rm -rf /)\nline 2", tier: "sbx", permissionMode: "bypassPermissions", bin: "host-only-claude" });
      const cmd = buildSbxCommand({ sandbox: "claude-p", vmRoot: "/vm/p", worker, guardS: 300 }, {});
      expect(cmd.bin).toBe("fake-sbx");
      expect(cmd.argv).toEqual(["exec", "claude-p", "timeout", "-k", "10", "300", "env", "-u", "ANTHROPIC_API_KEY", "-C", "/vm/p", "claude",
        "-p", "a prompt; $(rm -rf /)\nline 2", "--output-format", "json", "--permission-mode", "bypassPermissions"]);
    } finally {
      if (prev === undefined) delete process.env.SBX_BIN; else process.env.SBX_BIN = prev;
    }
  });

  test("buildSbxCommand passes the supervisor's TK_ATLASSIAN_* variables into the sandbox by name (sbx exec -e NAME), never by value", () => {
    const worker = buildWorkerCommand({ prompt: "p", tier: "sbx", permissionMode: "bypassPermissions", bin: "host-only-claude" });
    const env = {
      TK_ATLASSIAN_AGENT_TOKEN: "s3cret-token", TK_ATLASSIAN_SITE: "https://acme.atlassian.net", TK_ATLASSIAN_EMPTY: "  ",
      TK_SUPERVISOR_TOKEN: "bearer", ANTHROPIC_API_KEY: "sk", PATH: "/usr/bin",
    };
    expect(sbxEnvPassthrough(env)).toEqual(["TK_ATLASSIAN_AGENT_TOKEN", "TK_ATLASSIAN_SITE"]);
    const cmd = buildSbxCommand({ sandbox: "claude-p", vmRoot: "/vm/p", worker, guardS: 300 }, env);
    expect(cmd.argv.slice(0, 6)).toEqual(["exec", "-e", "TK_ATLASSIAN_AGENT_TOKEN", "-e", "TK_ATLASSIAN_SITE", "claude-p"]);
    expect(cmd.argv.join(" ")).not.toContain("s3cret-token");
    expect(cmd.argv.join(" ")).not.toContain("acme.atlassian.net");
    expect(cmd.argv).not.toContain("TK_SUPERVISOR_TOKEN");
    expect(buildSbxCommand({ sandbox: "claude-p", vmRoot: "/vm/p", worker, guardS: 300 }, { PATH: "/usr/bin" }).argv.slice(0, 2)).toEqual(["exec", "claude-p"]);
  });

  test("hole 60: buildWorkerEnv fills the pass-through variables from the User environment registry when the console lacks them", () => {
    const text = [
      "", "HKEY_CURRENT_USER\\Environment", "    Path    REG_EXPAND_SZ    C:\\Users\\tim\\bin;%PATH%",
      "    TK_ATLASSIAN_SITE    REG_SZ    https://acme.atlassian.net", "    TK_ATLASSIAN_AGENT_TOKEN    REG_SZ    reg-token",
      "    TK_ATLASSIAN_BLANK    REG_SZ    ", "    OTHER_SECRET    REG_SZ    nope", "",
    ].join("\r\n");
    const reg = parseRegQuery(text);
    expect(reg).toEqual({ Path: "C:\\Users\\tim\\bin;%PATH%", TK_ATLASSIAN_SITE: "https://acme.atlassian.net", TK_ATLASSIAN_AGENT_TOKEN: "reg-token", TK_ATLASSIAN_BLANK: "", OTHER_SECRET: "nope" });
    const env = buildWorkerEnv({ PATH: "/usr/bin", TK_ATLASSIAN_SITE: "https://console.atlassian.net", TK_SUPERVISOR_TOKEN: "x" }, () => reg);
    expect(env.TK_ATLASSIAN_SITE).toBe("https://console.atlassian.net"); // the console's value wins
    expect(env.TK_ATLASSIAN_AGENT_TOKEN).toBe("reg-token"); // filled from the registry
    expect(env.TK_ATLASSIAN_BLANK).toBeUndefined(); // an empty registry value is not a value
    expect(env.OTHER_SECRET).toBeUndefined(); // only the pass-through prefixes
    expect(env.Path).toBeUndefined();
    expect(env.TK_SUPERVISOR_TOKEN).toBeUndefined(); // the strip still applies
    expect(buildWorkerEnv({ PATH: "/usr/bin" }, () => ({})).TK_ATLASSIAN_SITE).toBeUndefined();
    expect(userEnvFromRegistry(() => text)).toEqual({}); // under bun test the registry is never consulted
    expect(sbxEnvPassthrough(env)).toEqual(["TK_ATLASSIAN_AGENT_TOKEN", "TK_ATLASSIAN_SITE"]);
  });
});

describe("invokeSkill on the sbx tier (injected spawner)", () => {
  test("login probe and worker both run through `sbx exec`; the prompt is one argv item; --settings/--model/--effort ride inside", async () => {
    mkdirSync(join(root, ".tk-studio"), { recursive: true });
    const profile = join(root, ".tk-studio", "deny.settings.json");
    writeFileSync(profile, JSON.stringify({ permissions: { deny: ["Bash(rm:*)"] } }));
    process.env.ANTHROPIC_API_KEY = "sk-test-parent";
    try {
      const { calls, spawner } = fakeSpawner();
      const out = await invokeSkill(root, "tk-studio-activate", {
        tier: "sbx", sandbox: "claude-p", permission_mode: "bypassPermissions", model: "m-x", effort: "high", deny_profile: profile,
      }, spawner);
      expect(out).toMatchObject({ ran: true, status_block: BLOCK, total_cost_usd: 0.42 });
      const vm = toVmPath(root);
      const [probe, worker] = calls.filter((c) => c.cmd === sbxBin());
      expect(probe.args).toEqual(["exec", "claude-p", "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"]);
      expect(worker.args.slice(0, 13)).toEqual(["exec", "claude-p", "timeout", "-k", "10", "600", "env", "-u", "ANTHROPIC_API_KEY", "-C", vm, "claude", "-p"]);
      const prompt = worker.args[13];
      expect(prompt).toStartWith("/tk-studio:tk-studio-activate ");
      expect(JSON.parse(prompt.split("\n")[0].replace(/^\S+ /, ""))).toMatchObject({ directory: vm, model: "m-x", effort: "high" });
      expect(worker.args.slice(14)).toEqual([
        "--output-format", "json", "--permission-mode", "bypassPermissions",
        "--settings", `${vm}/.tk-studio/deny.settings.json`, "--model", "m-x", "--effort", "high",
      ]);
      for (const c of [probe, worker]) expect(c.env?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(calls.some((c) => c.cmd === claudeBin() || c.args[0] === "-p")).toBe(false); // nothing on the host
    } finally { delete process.env.ANTHROPIC_API_KEY; }
  });

  test("sbx login missing → blocked naming the Max login; the worker never starts", async () => {
    const { calls, spawner } = fakeSpawner({ exit: 0, stderr: "", stdout: JSON.stringify({ loggedIn: false }) });
    const out = await invokeSkill(root, "tk-studio-activate", { tier: "sbx", sandbox: "claude-p" }, spawner);
    expect(out.ran).toBe(false);
    expect(String((out.status_block as any).reason)).toContain(MAX_LOGIN_MISSING);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.slice(0, 2)).toEqual(["exec", "claude-p"]);
  });

  test("maxLoginPreflight: host unchanged; sbx through the wrapper", async () => {
    const { calls, spawner } = fakeSpawner();
    expect(await maxLoginPreflight(spawner)).toBeNull();
    expect(await maxLoginPreflight(spawner, { tier: "sbx", sandbox: "s1" })).toBeNull();
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      [claudeBin(), "auth", "status", "--json"],
      [sbxBin(), "exec", "s1", "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status", "--json"],
    ]);
  });

  test("refusals before any process: sbx without a sandbox, an unknown tier, host bypass, a profile outside the root", async () => {
    const { calls, spawner } = fakeSpawner();
    await expect(invokeSkill(root, "tk-studio-activate", { tier: "sbx" }, spawner)).rejects.toThrow(SbxSandboxMissing);
    await expect(invokeSkill(root, "tk-studio-activate", { tier: "gpu" }, spawner)).rejects.toThrow(TierRefused);
    await expect(invokeSkill(root, "tk-studio-activate", { permission_mode: "bypassPermissions" }, spawner)).rejects.toThrow(HostBypassRefused);
    const outside = join(mkdtempSync(join(tmpdir(), "tk-sup-outside-")), "deny.json");
    writeFileSync(outside, JSON.stringify({ permissions: { deny: ["Bash"] } }));
    await expect(invokeSkill(root, "tk-studio-activate", { tier: "sbx", sandbox: "s", deny_profile: outside }, spawner))
      .rejects.toThrow(DenyProfileRefused);
    expect(calls).toEqual([]);
  });

  test("an sbx deny profile named `..<name>` directly inside the root is inside, not outside", async () => {
    const profile = join(root, "..deny.json");
    writeFileSync(profile, JSON.stringify({ permissions: { deny: ["Bash(rm:*)"] } }));
    const { calls, spawner } = fakeSpawner();
    await invokeSkill(root, "tk-studio-activate", { tier: "sbx", sandbox: "s", deny_profile: profile }, spawner);
    const worker = calls.find((c) => c.args.includes("-p"))!;
    expect(worker.args[worker.args.indexOf("--settings") + 1]).toBe(`${toVmPath(root)}/..deny.json`);
    const sibling = join(root, "..", `${"deny-sibling-"}${process.pid}.json`);
    writeFileSync(sibling, JSON.stringify({ permissions: { deny: ["Bash"] } }));
    await expect(invokeSkill(root, "tk-studio-activate", { tier: "sbx", sandbox: "s", deny_profile: sibling }, spawner))
      .rejects.toThrow(DenyProfileRefused);
  });

  test("vmHostRoot (the registry entry root) — not the caller's spelling of the root — gives the VM cwd, payload directory and deny-profile path", async () => {
    const reg = mkdtempSync(join(tmpdir(), "tk-sup-reg-proj-"));
    mkdirSync(join(reg, ".tk-studio"), { recursive: true });
    writeFileSync(join(reg, ".tk-studio", "deny.json"), JSON.stringify({ permissions: { deny: ["Bash(rm:*)"] } }));
    const spelled = join(mkdtempSync(join(tmpdir(), "tk-sup-spelled-")), "p-link");
    try { symlinkSync(reg, spelled, "dir"); }
    catch { console.warn("symlink unavailable on this platform — skipping the caller-spelling case"); return; }
    const { calls, spawner } = fakeSpawner();
    await invokeSkill(spelled, "tk-studio-activate", {
      tier: "sbx", sandbox: "s", deny_profile: join(spelled, ".tk-studio", "deny.json"),
    }, spawner, { vmHostRoot: reg });
    const vm = toVmPath(reg);
    expect(vm).not.toBe(toVmPath(spelled));
    const worker = calls.find((c) => c.args.includes("-p"))!;
    expect(worker.args.slice(9, 11)).toEqual(["-C", vm]);
    expect(JSON.parse(worker.args[13].split("\n")[0].replace(/^\S+ /, ""))).toMatchObject({ directory: vm });
    expect(worker.args[worker.args.indexOf("--settings") + 1]).toBe(`${vm}/.tk-studio/deny.json`);
    // Without the option (the MCP path with no registry) the given root is mapped, as before.
    const bare = fakeSpawner();
    await invokeSkill(spelled, "tk-studio-activate", { tier: "sbx", sandbox: "s" }, bare.spawner);
    expect(bare.calls.find((c) => c.args.includes("-p"))!.args.slice(9, 11)).toEqual(["-C", toVmPath(spelled)]);
  });

  test("an sbx deny profile is checked on real paths: a real file inside maps; a symlink inside pointing outside is refused", () => {
    const proj = mkdtempSync(join(tmpdir(), "tk-sup-real-proj-"));
    const inside = join(proj, "deny.json");
    writeFileSync(inside, JSON.stringify({ permissions: { deny: ["Bash(rm:*)"] } }));
    const argv = buildWorkerCommand({ prompt: "", tier: "sbx", root: proj, denyProfile: inside }).argv;
    expect(argv[argv.indexOf("--settings") + 1]).toBe(`${toVmPath(proj)}/deny.json`);
    const outside = join(mkdtempSync(join(tmpdir(), "tk-sup-real-out-")), "deny.json");
    writeFileSync(outside, JSON.stringify({ permissions: { deny: ["Bash"] } }));
    const link = join(proj, "linked-deny.json");
    try { symlinkSync(outside, link, "file"); }
    catch { console.warn("symlink unavailable on this platform — skipping the symlink case"); return; }
    expect(() => buildWorkerCommand({ prompt: "", tier: "sbx", root: proj, denyProfile: link })).toThrow(DenyProfileRefused);
    // The host tier is unchanged: the (validated) link path rides as-is.
    const host = buildWorkerCommand({ prompt: "", root: proj, denyProfile: link }).argv;
    expect(host[host.indexOf("--settings") + 1]).toBe(link);
  });

  test("host tier (default): claude directly, no sbx, --permission-mode auto", async () => {
    const { calls, spawner } = fakeSpawner();
    await invokeSkill(root, "tk-studio-activate", {}, spawner);
    const worker = calls.find((c) => c.args[0] === "-p")!;
    expect(worker.cmd).toBe(claudeBin());
    expect(worker.args.slice(2)).toEqual(["--output-format", "json", "--permission-mode", "auto"]);
    expect(calls.some((c) => c.cmd === sbxBin())).toBe(false);
  });
});
