// Story 27.4: a host-tier verify leg runs before any PR opens — the command read from the base's tracked
// config (never the worktree or the plugin), split without a shell, run argv-only under the guard, its
// tails clipped and redacted. Verify commands are `process.execPath` (bun) `-e` scripts: the same test
// runs on both hosts.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import {
  gitUsrBin, hostVerify, isRed, pathKey, playableConfig, prSection, redReason, splitCommand, tail, verifyCommand, wallClockTrip,
  type HostVerifyRan, type PlayableJudge,
} from "../src/hostverify";
import { studioRunDir } from "../src/sandbox";
import { fakeBin, gitRepo, testGit } from "./fakes";
import { tempDir } from "./tmp";

/** `"<bun>" -e "<script>"` as one command line (the script uses single quotes only). */
const bunCmd = (script: string) => `"${process.execPath}" -e "${script}"`;

/** A repo whose base (`main`) config carries `config` (none: no file), and a worktree of it. */
function project(config?: string) {
  const repo = gitRepo(config === undefined ? {} : { ".tk-studio/config.yaml": config });
  const wt = join(tempDir("tk-sup-hv-wt-"), "wt");
  testGit(repo.checkout, "worktree", "add", "-q", wt, "-b", "supervisor/run-q1", "main");
  return { repo, wt, run: { root: repo.checkout, worktree: wt, base_ref: "main", tier: "sbx" as string | null } };
}
const hostKey = (cmd: string) => `vcs: git\nverify:\n  host: ${JSON.stringify(cmd)}\n`;
/** Story 34.1: `verify.host` and (when given) `verify.engine`. */
const verifyKeys = (k: { host: string; engine?: string }) =>
  `${hostKey(k.host)}${k.engine === undefined ? "" : `  engine: ${JSON.stringify(k.engine)}\n`}`;

describe("the command line: split into argv, never a shell", () => {
  test("whitespace splits; \"…\" and '…' group; backslashes stay literal; adjacent quoted text joins", () => {
    expect(splitCommand("bun test")).toEqual(["bun", "test"]);
    expect(splitCommand("  bash   scripts/verify.sh  ")).toEqual(["bash", "scripts/verify.sh"]);
    expect(splitCommand(`"C:\\Program Files\\bun.exe" -e 'a b' x`)).toEqual(["C:\\Program Files\\bun.exe", "-e", "a b", "x"]);
    expect(splitCommand(`C:\\tools\\uv.exe run a\\b.py`)).toEqual(["C:\\tools\\uv.exe", "run", "a\\b.py"]);
    expect(splitCommand(`--x="a b"c ""`)).toEqual(["--x=a bc", ""]);
    expect(splitCommand(`a "it's"`)).toEqual(["a", "it's"]);
    expect(splitCommand("bun test && echo hi")).toEqual(["bun", "test", "&&", "echo", "hi"]); // no shell: `&&` is an argument
    expect(splitCommand("   ")).toEqual([]);
  });
});

describe("the command is read from the base's tracked config", () => {
  test("verify.host at base_ref → the command and its argv", async () => {
    const fx = project(hostKey("bun test"));
    expect(await verifyCommand(fx.run)).toEqual({ command: "bun test", argv: ["bun", "test"], engine: { skipped: "no verify.engine" } });
  });

  test("a run commit that edits verify.host is ignored: the base's command is used", async () => {
    const fx = project(hostKey("bun test"));
    writeFileSync(join(fx.wt, ".tk-studio", "config.yaml"), hostKey("true"));
    testGit(fx.wt, "commit", "-q", "-am", "weaken the gate");
    writeFileSync(join(fx.wt, ".tk-studio", "config.yaml"), "verify: 7\n"); // and an uncommitted edit
    expect(await verifyCommand(fx.run)).toEqual({ command: "bun test", argv: ["bun", "test"], engine: { skipped: "no verify.engine" } });
  });

  test("absent: no verify block or no host key → skipped `no verify.host`", async () => {
    expect(await verifyCommand(project("vcs: git\n").run)).toEqual({ skipped: true, reason: "no verify.host" });
    expect(await verifyCommand(project("verify:\n  other: x\n").run)).toEqual({ skipped: true, reason: "no verify.host" });
  });

  test("not a non-empty string: a number, an empty or blank string, a list → skipped", async () => {
    for (const body of ["verify:\n  host: 5\n", "verify:\n  host: \"\"\n", "verify:\n  host: \"   \"\n", "verify:\n  host: [bun, test]\n", "verify:\n  host:\n"]) {
      expect(await verifyCommand(project(body).run)).toEqual({ skipped: true, reason: "verify.host is not a non-empty string" });
    }
  });

  test("no config at the base (only in the worktree) → skipped `no .tk-studio/config.yaml at main`", async () => {
    const fx = project();
    // The config only in the worktree (committed on the run branch), none at the base.
    mkdirSync(join(fx.wt, ".tk-studio"), { recursive: true });
    writeFileSync(join(fx.wt, ".tk-studio", "config.yaml"), hostKey("bun test"));
    testGit(fx.wt, "add", ".tk-studio/config.yaml");
    testGit(fx.wt, "commit", "-q", "-m", "add a verify");
    expect(await verifyCommand(fx.run)).toEqual({ skipped: true, reason: "no .tk-studio/config.yaml at main" });
  });

  test("no config at the base under a non-English locale: git runs with `LC_ALL=C`, still `no .tk-studio/config.yaml at main`", async () => {
    const fx = project();
    const env = { ...process.env, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8", LC_MESSAGES: "de_DE.UTF-8", LANGUAGE: "de" };
    expect(await verifyCommand(fx.run, { env })).toEqual({ skipped: true, reason: "no .tk-studio/config.yaml at main" });
    const seen: { bin: string; env?: Record<string, string | undefined> }[] = [];
    const run = async (bin: string, args: string[], o: { cwd: string; timeoutS: number; env?: Record<string, string | undefined> }) => {
      seen.push({ bin, env: o.env });
      return { exit: 128, stdout: "", stderr: "fatal: path '.tk-studio/config.yaml' does not exist in 'main'" };
    };
    expect(await verifyCommand(fx.run, { env, run: run as any })).toEqual({ skipped: true, reason: "no .tk-studio/config.yaml at main" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.env).toMatchObject({ LC_ALL: "C", LANG: "de_DE.UTF-8" });
  });

  test("unparseable config → skipped `config unreadable: <error>`", async () => {
    const out = await verifyCommand(project("verify: [unclosed\n  host: x\n").run);
    expect(out).toMatchObject({ skipped: true });
    expect((out as { reason: string }).reason).toStartWith("config unreadable: ");
  });

  test("a host-tier run → skipped `host-tier run: the worker ran on the host`; a gone worktree → skipped `worktree gone`", async () => {
    const fx = project(hostKey("bun test"));
    expect(await verifyCommand({ ...fx.run, tier: "host" })).toEqual({ skipped: true, reason: "host-tier run: the worker ran on the host" });
    expect(await verifyCommand({ ...fx.run, tier: null })).toEqual({ skipped: true, reason: "host-tier run: the worker ran on the host" });
    rmSync(fx.wt, { recursive: true, force: true });
    expect(await verifyCommand(fx.run)).toEqual({ skipped: true, reason: "worktree gone" });
  });
});

describe("Story 35.8: a ran leg carries its started_at (the Stage Log's host-leg row starts there)", () => {
  test("started_at: an ISO stamp taken before the command ran, never on the PR section; a skipped leg carries none", async () => {
    const fx = project(hostKey(bunCmd("console.log('ok')")));
    const before = Date.now();
    const v = await hostVerify(fx.run, 60) as HostVerifyRan;
    expect(v.green).toBe(true);
    expect(v.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(v.started_at!)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(v.started_at!)).toBeLessThanOrEqual(Date.now());
    expect(prSection(v).join("\n")).not.toContain(v.started_at!);
    rmSync(fx.wt, { recursive: true, force: true });
    expect(await hostVerify(fx.run, 60)).toEqual({ skipped: true, reason: "worktree gone" });
  });
});

describe("the leg runs the command in the worktree under the guard", () => {
  test("green: exit 0, in the worktree, the worker's env (no API key), tails recorded", async () => {
    const fx = project(hostKey(bunCmd("console.log(process.cwd()); console.log(process.env.ANTHROPIC_API_KEY ?? 'no-key')")));
    const v = await hostVerify(fx.run, 60, { env: { ...process.env, ANTHROPIC_API_KEY: "sk-secret" } }) as HostVerifyRan;
    expect(v).toMatchObject({ green: true, exit: 0, cwd: fx.wt, argv: [process.execPath, "-e", expect.any(String)], stderr_tail: [] });
    expect(v.stdout_tail.at(-1)).toBe("no-key");
    expect(v.stdout_tail[0]!.replace(/\\/g, "/").toLowerCase()).toEndWith("/wt");
    expect(v.duration_ms).toBeGreaterThanOrEqual(0);
    expect(v.guard).toBeUndefined();
    expect(isRed(v)).toBe(false);
    expect(prSection(v).join("\n")).toContain("Green: `");
  });

  test("red exit: non-zero exit, the reason names the command and the last 5 stderr lines", async () => {
    const cmd = bunCmd("for (let i = 1; i <= 7; i++) console.error('fail ' + i); console.log('out'); process.exit(3)");
    const fx = project(hostKey(cmd));
    const v = await hostVerify(fx.run, 60) as HostVerifyRan;
    expect(v).toMatchObject({ green: false, exit: 3, command: cmd, stdout_tail: ["out"] });
    expect(v.stderr_tail).toEqual(["fail 1", "fail 2", "fail 3", "fail 4", "fail 5", "fail 6", "fail 7"]);
    expect(isRed(v)).toBe(true);
    expect(redReason(v)).toBe(`host verify red: \`${cmd}\` exited 3; last lines: fail 3 | fail 4 | fail 5 | fail 6 | fail 7`);
    const section = prSection(v).join("\n");
    expect(section).toContain("**Red:**");
    expect(section).toContain("exit 3");
    expect(section).toContain("```\nfail 1\n");
  });

  test("red with no stderr: the reason quotes stdout", async () => {
    const fx = project(hostKey(bunCmd("console.log('only stdout'); process.exit(1)")));
    const v = await hostVerify(fx.run, 60) as HostVerifyRan;
    expect(redReason(v)).toEndWith("exited 1; last lines: only stdout");
  });

  test("red timeout: the tree killed past the guard, `exit: null`, the guard named", async () => {
    const fx = project(hostKey(bunCmd("console.log('started'); setTimeout(() => {}, 60000)")));
    const v = await hostVerify(fx.run, 1) as HostVerifyRan;
    expect(v).toMatchObject({ green: false, exit: null, guard: "guard: max_wall_clock_seconds (1s)" });
    expect(wallClockTrip(1)).toBe(v.guard!);
    expect(redReason(v)).toContain("timed out (guard: max_wall_clock_seconds (1s))");
  }, 20_000);

  test("red timeout keeps both streams: failures printed to stderr (and stdout) before the hang are in the tails, whole lines", async () => {
    const long = "y".repeat(500);
    const script = "for (let i = 1; i <= 3; i++) console.error('FAIL case ' + i); console.log('${long}'); console.log('last out'); setTimeout(() => {}, 60000)";
    const fx = project(hostKey(bunCmd(script.replace("${long}", long))));
    const v = await hostVerify(fx.run, 2) as HostVerifyRan;
    expect(v).toMatchObject({ green: false, exit: null, guard: "guard: max_wall_clock_seconds (2s)" });
    expect(v.stderr_tail).toEqual(["FAIL case 1", "FAIL case 2", "FAIL case 3"]);
    expect(v.stdout_tail).toEqual(["y".repeat(300), "last out"]); // the 500-char line whole (clipped from its start), not a mid-line slice
    expect(redReason(v)).toBe(`host verify red: \`${v.command}\` timed out (guard: max_wall_clock_seconds (2s)); last lines: FAIL case 1 | FAIL case 2 | FAIL case 3`);
  }, 20_000);

  test("red timeout under a fractional guard (90.5-style): named a guard trip, never `failed to start`", async () => {
    const fx = project(hostKey(bunCmd("console.error('hung here'); setTimeout(() => {}, 60000)")));
    const v = await hostVerify(fx.run, 1.5) as HostVerifyRan;
    expect(v).toMatchObject({ green: false, exit: null, guard: "guard: max_wall_clock_seconds (1.5s)" });
    expect(v.error).toBeUndefined();
    expect(v.stderr_tail).toEqual(["hung here"]);
    expect(redReason(v)).toContain("timed out (guard: max_wall_clock_seconds (1.5s))");
    expect(redReason(v)).not.toContain("failed to start");
  }, 20_000);

  // win32 has no POSIX signals: a self-`process.kill` there ends the process with an exit code, never a signal.
  test.skipIf(process.platform === "win32")("red signal: a command killed by a signal (not the guard) → `signal`, `exit: null`, `killed by <signal>`", async () => {
    const cmd = bunCmd("console.error('about to die'); process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 60000)");
    const fx = project(hostKey(cmd));
    const v = await hostVerify(fx.run, 30) as HostVerifyRan;
    expect(v).toMatchObject({ green: false, exit: null, signal: "SIGTERM", stderr_tail: ["about to die"] });
    expect(v.guard).toBeUndefined();
    expect(v.error).toBeUndefined();
    expect(isRed(v)).toBe(true);
    expect(redReason(v)).toBe(`host verify red: \`${cmd}\` killed by SIGTERM; last lines: about to die`);
    expect(prSection(v).join("\n")).toContain("— killed by SIGTERM (");
  }, 20_000);

  test("red spawn failure: the command not found → `error`, `failed to start`", async () => {
    const fx = project(hostKey("tk-sup-no-such-verify-command --x"));
    const v = await hostVerify(fx.run, 60) as HostVerifyRan;
    expect(v).toMatchObject({ green: false, exit: null, argv: ["tk-sup-no-such-verify-command", "--x"] });
    expect(v.error).toBeTruthy();
    expect(redReason(v)).toContain("`tk-sup-no-such-verify-command --x` failed to start: ");
  });

  test("tails: the last 20 lines, each clipped to 300 chars, URL userinfo redacted", async () => {
    const long = "x".repeat(400);
    const fx = project(hostKey(bunCmd(`for (let i = 1; i <= 25; i++) console.log('line ' + i); console.log('${long}'); console.error('push https://bot:tok3n@github.com/acme/w.git failed')`)));
    const v = await hostVerify(fx.run, 60) as HostVerifyRan;
    expect(v.stdout_tail).toHaveLength(20);
    expect(v.stdout_tail[0]).toBe("line 7");
    expect(v.stdout_tail.at(-1)).toBe("x".repeat(300));
    expect(v.stderr_tail).toEqual(["push https://[redacted]@github.com/acme/w.git failed"]);
    expect(JSON.stringify([v.stdout_tail, v.stderr_tail])).not.toContain("tok3n");
    expect(tail("a\r\nb\n\n")).toEqual(["a", "b"]);
  });

  test("skipped: no spawn, the reason carried to the PR section", async () => {
    const fx = project("vcs: git\n");
    const v = await hostVerify(fx.run, 60);
    expect(v).toEqual({ skipped: true, reason: "no verify.host" });
    expect(isRed(v)).toBe(false);
    expect(prSection(v)).toEqual(["## Host verify", "", "Skipped: no verify.host"]);
  });

  test("a tail line holding ``` never closes its fence: the fence is longer than any backtick run in the lines (minimum 3)", () => {
    const line = "expected ```ts block``` got ````";
    const v: HostVerifyRan = { command: "bun test", argv: ["bun", "test"], cwd: "/w", exit: 1, duration_ms: 10, green: false, stdout_tail: ["ok"], stderr_tail: ["FAIL", line] };
    const s = prSection(v);
    const at = s.indexOf(line);
    expect(at).toBeGreaterThan(0);
    const open = s.lastIndexOf("`````", at), close = s.indexOf("`````", at);
    expect(open).toBeGreaterThan(0);
    expect(s[open]).toMatch(/^`{5}$/); // longer than the line's longest run (4)
    expect(s[close]).toBe(s[open]);
    // A tail with no backticks keeps the plain three-backtick fence.
    expect(s.slice(close + 1)).toContain("```");
    expect(s.at(-1)).toBe("```");
  });
});

describe("hole 46: Git Bash goes first on the leg's PATH on win32", () => {
  test("a `Git\\cmd` entry on PATH with a sibling `usr\\bin\\bash.exe` is prepended and recorded (win32 only); none: PATH unchanged", async () => {
    const root = tempDir("tk-sup-git-");
    mkdirSync(join(root, "Git", "cmd"), { recursive: true });
    writeFileSync(join(root, "Git", "cmd", "git.exe"), "");
    mkdirSync(join(root, "Git", "usr", "bin"), { recursive: true });
    writeFileSync(join(root, "Git", "usr", "bin", "bash.exe"), "");
    const win = process.platform === "win32";
    const usrBin = join(root, "Git", "usr", "bin");
    // The pure resolution: the fake Git alone on PATH (no real git there, so this never runs a command).
    const env = { TK_STUDIO_HOME: "store", PATH: [join(root, "elsewhere"), join(root, "Git", "cmd")].join(";") };
    expect(gitUsrBin(env)).toBe(win ? usrBin : null);
    expect(gitUsrBin({ PATH: join(root, "nowhere") })).toBeNull();
    expect(gitUsrBin({ PATH: join(root, "Git", "cmd") + "\\" })).toBe(win ? usrBin : null); // a trailing separator
    // The leg: the config read and the command answered by an injected runner, the command's env captured.
    const seen: Record<string, string | undefined>[] = [];
    const specs: { argv: string[] }[] = [];
    const run = async (bin: string, args: string[], o: { cwd: string; timeoutS: number; env?: Record<string, string | undefined> }) => {
      if (bin === "git") return { exit: 0, stdout: hostKey("bash scripts/verify.sh"), stderr: "" };
      seen.push(o.env ?? {});
      specs.push(JSON.parse(readFileSync(args[2]!, "utf-8"))); // the capture wrapper's spec: what is spawned
      return { exit: 0, stdout: "", stderr: "" };
    };
    const fx = project(hostKey("bash scripts/verify.sh"));
    const v = await hostVerify(fx.run, 60, { env, run: run as any }) as HostVerifyRan;
    expect(seen).toHaveLength(1);
    expect(v.argv).toEqual(["bash", "scripts/verify.sh"]); // the event keeps the config's argv
    if (win) {
      expect(v.git_bash).toBe(usrBin);
      expect(seen[0]!.PATH).toBe(`${usrBin};${env.PATH}`);
      // Hole 52: the bare `bash` is spawned by its full path in that `usr\bin` (the PATH prefix alone changes
      // nothing: Windows resolves a bare name through the parent's PATH), and the event names it.
      expect(specs[0]!.argv).toEqual([join(usrBin, "bash.exe"), "scripts/verify.sh"]);
      expect(v.resolved).toBe(join(usrBin, "bash.exe"));
    } else {
      expect(v.git_bash).toBeUndefined();
      expect(v.resolved).toBeUndefined();
      expect(seen[0]!.PATH).toBe(env.PATH);
      expect(specs[0]!.argv).toEqual(["bash", "scripts/verify.sh"]);
    }
  });

  test("hole 54: an env that spells the key `Path` (a console-started process on Windows) is edited in place, never given a second `PATH`", async () => {
    const root = tempDir("tk-sup-git-");
    mkdirSync(join(root, "Git", "cmd"), { recursive: true });
    mkdirSync(join(root, "Git", "usr", "bin"), { recursive: true });
    writeFileSync(join(root, "Git", "usr", "bin", "bash.exe"), "");
    const win = process.platform === "win32";
    const usrBin = join(root, "Git", "usr", "bin");
    const original = [join(root, "tools"), join(root, "Git", "cmd")].join(";");
    const env = { TK_STUDIO_HOME: "store", Path: original };
    expect(pathKey(env)).toBe("Path");
    expect(pathKey({ PATH: "x" })).toBe("PATH");
    expect(pathKey({})).toBe("PATH");
    expect(gitUsrBin(env)).toBe(win ? usrBin : null);
    const seen: Record<string, string | undefined>[] = [];
    const run = async (bin: string, _args: string[], o: { cwd: string; timeoutS: number; env?: Record<string, string | undefined> }) => {
      if (bin === "git") return { exit: 0, stdout: hostKey("uv run tools/verify_host.py"), stderr: "" };
      seen.push(o.env ?? {});
      return { exit: 0, stdout: "", stderr: "" };
    };
    const fx = project(hostKey("uv run tools/verify_host.py"));
    const v = await hostVerify(fx.run, 60, { env, run: run as any }) as HostVerifyRan;
    expect(seen).toHaveLength(1);
    const keys = Object.keys(seen[0]!).filter((k) => k.toUpperCase() === "PATH");
    expect(keys).toEqual(["Path"]); // the one key, its spelling kept: the child's PATH is the whole PATH
    expect(seen[0]!.Path).toBe(win ? `${usrBin};${original}` : original);
    expect(v.resolved).toBeUndefined(); // `uv` is not in Git's usr\bin: spawned as written, found through the whole PATH
  });

  test("hole 52: a first token that is already a path, or one Git's `usr\\bin` does not hold, is spawned as written", async () => {
    const root = tempDir("tk-sup-git-");
    mkdirSync(join(root, "Git", "cmd"), { recursive: true });
    mkdirSync(join(root, "Git", "usr", "bin"), { recursive: true });
    writeFileSync(join(root, "Git", "usr", "bin", "bash.exe"), "");
    const env = { TK_STUDIO_HOME: "store", PATH: join(root, "Git", "cmd") };
    const specs: { argv: string[] }[] = [];
    const runWith = (command: string) => async (bin: string, args: string[]) => {
      if (bin === "git") return { exit: 0, stdout: hostKey(command), stderr: "" };
      specs.push(JSON.parse(readFileSync(args[2]!, "utf-8")));
      return { exit: 0, stdout: "", stderr: "" };
    };
    for (const command of ["uv run tools/verify_host.py", `"${join(root, "elsewhere", "bash.exe")}" scripts/verify.sh`]) {
      const fx = project(hostKey(command));
      const v = await hostVerify(fx.run, 60, { env, run: runWith(command) as any }) as HostVerifyRan;
      expect(v.resolved).toBeUndefined();
      expect(specs.at(-1)!.argv).toEqual(v.argv);
    }
  });
});

describe("Story 34.1: the engine gate runs after a green verify.host", () => {
  /** A fake `godot` in its own folder that prints a version line and its argv, then exits `code`. */
  function fakeGodot(code: number, lines: string[] = []) {
    const dir = tempDir("tk-sup-godot-");
    const script = [
      "console.log('4.7.2.stable.mono');",
      ...lines.map((l) => `console.error(${JSON.stringify(l)});`),
      "console.log('args ' + process.argv.slice(2).join(' '));",
      `process.exit(${code});`,
    ].join("\n");
    const bin = fakeBin(join(dir, "godot"), script);
    return { dir, bin };
  }
  /** A leg env whose PATH holds bun's and git's folders only (the fake's shebang needs `bun`, the config read
   * needs `git`; no `godot` there: the GODOT-less case below proves it fails to start). */
  const bareEnv = (extra: Record<string, string> = {}) => ({
    TK_STUDIO_HOME: "store", PATH: [dirname(process.execPath), dirname(Bun.which("git")!)].join(delimiter), ...extra,
  });
  /** An injected runner: answers the config, records each step's env and spec in order, answers `exits` in turn. */
  function recorder(config: string, exits: number[]) {
    const steps: { env: Record<string, string | undefined>; argv: string[]; cwd: string }[] = [];
    const run = async (bin: string, args: string[], o: { cwd: string; timeoutS: number; env?: Record<string, string | undefined> }) => {
      if (bin === "git") return { exit: 0, stdout: config, stderr: "" };
      const spec = JSON.parse(readFileSync(args[2]!, "utf-8"));
      steps.push({ env: o.env ?? {}, argv: spec.argv, cwd: spec.cwd });
      writeFileSync(spec.status, JSON.stringify({ exit: exits[steps.length - 1] ?? 0, signal: null }));
      writeFileSync(spec.out, `step ${steps.length}\n`);
      return { exit: 0, stdout: "", stderr: "" };
    };
    return { steps, run };
  }

  test("verifyCommand: verify.engine split the same way; absent → `no verify.engine`; not a non-empty string → skipped", async () => {
    const fx = project(verifyKeys({ host: "bun test", engine: `bash scripts/engine-gate.sh --x "a b"` }));
    expect(await verifyCommand(fx.run)).toEqual({
      command: "bun test", argv: ["bun", "test"],
      engine: { command: `bash scripts/engine-gate.sh --x "a b"`, argv: ["bash", "scripts/engine-gate.sh", "--x", "a b"] },
    });
    expect(await verifyCommand(project(hostKey("bun test")).run)).toMatchObject({ engine: { skipped: "no verify.engine" } });
    for (const tail of ["  engine: 5\n", "  engine: \"\"\n", "  engine: \"  \"\n", "  engine: [godot]\n", "  engine:\n"]) {
      expect(await verifyCommand(project(hostKey("bun test") + tail).run)).toMatchObject({ engine: { skipped: "verify.engine is not a non-empty string" } });
    }
  }, 60_000); // hole 79: seven real repositories and worktrees in one case; bun's 5 s default was a coin toss on the agent PC

  test("ordering: host green then engine green → one result, `green: true`, the host spawned before the engine, in the worktree", async () => {
    const config = verifyKeys({ host: "uv run tools/verify_host.py", engine: "bash scripts/engine-gate.sh" });
    const { steps, run } = recorder(config, [0, 0]);
    const fx = project(config);
    const v = await hostVerify(fx.run, 60, { env: bareEnv({ GODOT: "/opt/godot/godot" }), run: run as any }) as HostVerifyRan;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.argv.at(-1)).toBe("tools/verify_host.py"); // the host first
    expect(steps[1]!.argv.at(-1)).toBe("scripts/engine-gate.sh"); // then the engine
    expect(steps[1]!.cwd).toBe(fx.wt);
    expect(v.green).toBe(true);
    expect(v.stdout_tail).toEqual(["step 1"]);
    expect(v.engine).toMatchObject({ verdict: "green", exit: 0, command: "bash scripts/engine-gate.sh", argv: ["bash", "scripts/engine-gate.sh"], cwd: fx.wt, stdout_tail: ["step 2"], stderr_tail: [], godot_dir: dirname("/opt/godot/godot") });
    expect(v.engine!.reason).toBeUndefined();
    expect(typeof v.engine!.duration_ms).toBe("number");
    expect(isRed(v)).toBe(false);
    expect(prSection(v).join("\n")).toContain("Engine gate: green: `bash scripts/engine-gate.sh` (");
  });

  test("host red: the engine is never spawned, `skipped (verify.host red)`, the reason the host's text unchanged", async () => {
    const config = verifyKeys({ host: "uv run tools/verify_host.py", engine: "godot --headless --quit" });
    const { steps, run } = recorder(config, [2]);
    const v = await hostVerify(project(config).run, 60, { env: bareEnv({ GODOT: "/opt/godot/godot" }), run: run as any }) as HostVerifyRan;
    expect(steps).toHaveLength(1);
    expect(v.green).toBe(false);
    expect(v.engine).toEqual({ verdict: "skipped", reason: "verify.host red", godot_dir: dirname("/opt/godot/godot") });
    expect(redReason(v)).toBe("host verify red: `uv run tools/verify_host.py` exited 2; last lines: step 1");
    expect(prSection(v).at(-1)).toBe("Engine gate: skipped (verify.host red)");
  });

  test("no verify.engine: skipped `no verify.engine`, `green` follows the host; a bad key: skipped, nothing spawned", async () => {
    for (const [config, reason] of [
      [hostKey("uv run tools/verify_host.py"), "no verify.engine"],
      [hostKey("uv run tools/verify_host.py") + "  engine: 7\n", "verify.engine is not a non-empty string"],
    ] as const) {
      const { steps, run } = recorder(config, [0]);
      const v = await hostVerify(project(config).run, 60, { env: bareEnv(), run: run as any }) as HostVerifyRan;
      expect(steps).toHaveLength(1);
      expect(v.green).toBe(true);
      expect(v.engine).toEqual({ verdict: "skipped", reason, godot_dir: null });
      expect(prSection(v).at(-1)).toBe(`Engine gate: skipped (${reason})`);
    }
  });

  test("a host-side skip (no verify.host) carries no `engine`", async () => {
    const v = await hostVerify(project("verify:\n  engine: godot\n").run, 60);
    expect(v).toEqual({ skipped: true, reason: "no verify.host" });
  });

  test("PATH composition: the engine step has the folder of GODOT first under the parent's key; the host step does not", async () => {
    const config = verifyKeys({ host: "uv run tools/verify_host.py", engine: "godot --headless --quit" });
    const godot = join("/opt", "Godot_v4.7.2", "godot_console");
    for (const key of ["PATH", "Path"]) {
      const original = ["/usr/local/bin", "/usr/bin"].join(delimiter);
      const { steps, run } = recorder(config, [0, 0]);
      const v = await hostVerify(project(config).run, 60, { env: { TK_STUDIO_HOME: "store", [key]: original, GODOT: godot }, run: run as any }) as HostVerifyRan;
      expect(steps).toHaveLength(2);
      for (const s of steps) expect(Object.keys(s.env).filter((k) => k.toUpperCase() === "PATH")).toEqual([key]); // one key (hole 54)
      expect(steps[0]!.env[key]).toBe(original);
      expect(steps[1]!.env[key]).toBe(`${dirname(godot)}${delimiter}${original}`);
      expect(steps[1]!.env[key]!.split(delimiter)[0]).toBe(dirname(godot));
      expect(v.engine!.godot_dir).toBe(dirname(godot));
      expect(steps[1]!.argv).toEqual(["godot", "--headless", "--quit"]); // never resolved by the leg
    }
  });

  test("PATH composition with GODOT unset: the engine still runs, PATH unchanged, `godot_dir: null`", async () => {
    const config = verifyKeys({ host: "uv run tools/verify_host.py", engine: "bash scripts/engine-gate.sh" });
    const { steps, run } = recorder(config, [0, 1]);
    const env = { TK_STUDIO_HOME: "store", PATH: "/usr/bin" };
    const v = await hostVerify(project(config).run, 60, { env, run: run as any }) as HostVerifyRan;
    expect(steps).toHaveLength(2);
    expect(steps[1]!.env.PATH).toBe(steps[0]!.env.PATH!);
    expect(v.engine).toMatchObject({ verdict: "red", exit: 1, godot_dir: null });
  });

  test("a bare GODOT (`godot`): no folder prepended (never `.`, the worktree), `godot_dir: null`, the engine still runs", async () => {
    const config = verifyKeys({ host: "uv run tools/verify_host.py", engine: "bash scripts/engine-gate.sh" });
    const { steps, run } = recorder(config, [0, 0]);
    const env = { TK_STUDIO_HOME: "store", PATH: "/usr/bin", GODOT: "godot" };
    const v = await hostVerify(project(config).run, 60, { env, run: run as any }) as HostVerifyRan;
    expect(steps).toHaveLength(2);
    expect(steps[1]!.env.PATH).toBe(steps[0]!.env.PATH!);
    expect(steps[1]!.env.PATH!.split(delimiter)).not.toContain(".");
    expect(v.engine).toMatchObject({ verdict: "green", exit: 0, godot_dir: null });
  });

  test.skipIf(process.platform !== "win32")("win32: Git's usr\\bin stays first for the host step and sits behind the GODOT folder for the engine", async () => {
    const root = tempDir("tk-sup-git-");
    mkdirSync(join(root, "Git", "cmd"), { recursive: true });
    mkdirSync(join(root, "Git", "usr", "bin"), { recursive: true });
    writeFileSync(join(root, "Git", "usr", "bin", "bash.exe"), "");
    const usrBin = join(root, "Git", "usr", "bin");
    const original = join(root, "Git", "cmd");
    const config = verifyKeys({ host: "uv run tools/verify_host.py", engine: "bash scripts/engine-gate.sh" });
    const { steps, run } = recorder(config, [0, 0]);
    const godot = join(root, "Godot", "godot_console.exe");
    const v = await hostVerify(project(config).run, 60, { env: { Path: original, GODOT: godot }, run: run as any }) as HostVerifyRan;
    expect(steps[0]!.env.Path).toBe(`${usrBin};${original}`);
    expect(steps[1]!.env.Path).toBe(`${dirname(godot)};${usrBin};${original}`);
    expect(steps[1]!.argv).toEqual([join(usrBin, "bash.exe"), "scripts/engine-gate.sh"]); // hole 52 as for the host
    expect(v.engine!.argv).toEqual(["bash", "scripts/engine-gate.sh"]);
  });

  test("both verdicts through a fake `godot` found only through the prepended folder", async () => {
    const green = fakeGodot(0);
    const config = verifyKeys({ host: bunCmd("console.log('host ok')"), engine: "godot --headless --quit" });
    const fxG = project(config);
    const g = await hostVerify(fxG.run, 60, { env: bareEnv({ GODOT: green.bin }) }) as HostVerifyRan;
    expect(g.engine).toMatchObject({ verdict: "green", exit: 0, godot_dir: green.dir, cwd: fxG.wt, argv: ["godot", "--headless", "--quit"] });
    expect(g.engine!.stdout_tail).toEqual(["4.7.2.stable.mono", "args --headless --quit"]);
    expect(g.green).toBe(true);

    const red = fakeGodot(1, ["SCRIPT ERROR: Parse Error", "GoDotTest: 1 failing"]);
    const v = await hostVerify(project(config).run, 60, { env: bareEnv({ GODOT: red.bin }) }) as HostVerifyRan;
    expect(v.exit).toBe(0); // the host command itself was green
    expect(v.green).toBe(false);
    expect(v.engine).toMatchObject({ verdict: "red", exit: 1, godot_dir: red.dir, command: "godot --headless --quit" });
    expect(v.engine!.stderr_tail).toEqual(["SCRIPT ERROR: Parse Error", "GoDotTest: 1 failing"]);
    expect(isRed(v)).toBe(true);
    expect(redReason(v)).toBe("host verify red (engine): `godot --headless --quit` exited 1; last lines: SCRIPT ERROR: Parse Error | GoDotTest: 1 failing");
    const section = prSection(v).join("\n");
    expect(section).toContain("Green: `");
    expect(section).toContain("Engine gate: red");
    expect(section).toContain("**Red:** `godot --headless --quit` — exit 1 (");
    expect(section).toContain("```\nSCRIPT ERROR: Parse Error\nGoDotTest: 1 failing\n```");

    // Without GODOT the bare `godot` is found nowhere: the engine fails to start, red.
    const none = await hostVerify(project(config).run, 60, { env: bareEnv() }) as HostVerifyRan;
    expect(none.engine).toMatchObject({ verdict: "red", exit: null, godot_dir: null });
    expect(none.engine!.error).toBeTruthy();
    expect(redReason(none)).toStartWith("host verify red (engine): `godot --headless --quit` failed to start: ");
  }, 30_000);

  test("engine guard trip and spawn failure: `guard` / `error` set, both red", async () => {
    const hung = verifyKeys({ host: bunCmd("console.log('host ok')"), engine: bunCmd("console.error('importing'); setTimeout(() => {}, 60000)") });
    const t = await hostVerify(project(hung).run, 2) as HostVerifyRan;
    expect(t.exit).toBe(0);
    expect(t.engine).toMatchObject({ verdict: "red", exit: null, guard: "guard: max_wall_clock_seconds (2s)", stderr_tail: ["importing"] });
    expect(t.green).toBe(false);
    expect(redReason(t)).toContain("host verify red (engine): ");
    expect(redReason(t)).toContain("timed out (guard: max_wall_clock_seconds (2s))");
    expect(prSection(t).join("\n")).toContain("— guard: max_wall_clock_seconds (2s) (");

    const missing = verifyKeys({ host: bunCmd("console.log('host ok')"), engine: "tk-sup-no-such-engine --x" });
    const m = await hostVerify(project(missing).run, 60) as HostVerifyRan;
    expect(m.engine).toMatchObject({ verdict: "red", exit: null, argv: ["tk-sup-no-such-engine", "--x"] });
    expect(m.engine!.error).toBeTruthy();
    expect(isRed(m)).toBe(true);
    expect(redReason(m)).toContain("`tk-sup-no-such-engine --x` failed to start: ");
  }, 30_000);
});

describe("Story 34.3: the playable-verify step runs after a green engine gate", () => {
  const PLAYABLE = "playable:\n  scenario: scenarios/smoke.json\n  seed: 7\n  ticks: 120\n";
  const base = verifyKeys({ host: "uv run tools/verify_host.py", engine: "bash scripts/engine-gate.sh" });
  const REPORT = {
    schema: 1, verdict: "pass", failed: null, seed: 7, ticks: 120, ticks_run: 120, capture_every: 30, mode: "movie",
    frames: [{ tick: 0, file: "frames/tick-000000.png" }, { tick: 30, file: "frames/tick-000030.png" }],
    moments: [{ name: "jump", tick: 30, frame: "frames/tick-000030.png" }], frame_time_ms: { max: 20, mean: 16.6 }, log_errors: [],
  };
  type PlayableFake = { exit: number; report?: Record<string, unknown> | null; block?: Record<string, unknown> };
  /** A leg env: the plugin root (`TK_STUDIO_ROOT`) and the store (`TK_STUDIO_HOME`) in temp folders. */
  function legEnv() {
    const studio = tempDir("tk-sup-pv-studio-"), home = tempDir("tk-sup-pv-home-");
    return { studio, home, env: { TK_STUDIO_ROOT: studio, TK_STUDIO_HOME: home, PATH: "/usr/bin", GODOT: "/opt/godot/godot" } };
  }
  /** An injected runner: answers the config, then the host and engine steps with `exits`, then a fake `playable.py`:
   * it writes `report.json`, `log.txt` and the frames under the argv's `--out`, its status block on stdout. */
  function recorder(config: string, exits: number[], fake: PlayableFake = { exit: 0, report: REPORT }) {
    const steps: { env: Record<string, string | undefined>; argv: string[]; cwd: string }[] = [];
    const run = async (bin: string, args: string[], o: { cwd: string; timeoutS: number; env?: Record<string, string | undefined> }) => {
      if (bin === "git") return { exit: 0, stdout: config, stderr: "" };
      const spec = JSON.parse(readFileSync(args[2]!, "utf-8"));
      steps.push({ env: o.env ?? {}, argv: spec.argv, cwd: spec.cwd });
      if (!String(spec.argv[2] ?? "").endsWith("playable.py")) { // the host and engine steps
        writeFileSync(spec.status, JSON.stringify({ exit: exits[steps.length - 1] ?? 0, signal: null }));
        writeFileSync(spec.out, `step ${steps.length}\n`);
        return { exit: 0, stdout: "", stderr: "" };
      }
      const out = spec.argv[spec.argv.indexOf("--out") + 1] as string;
      if (fake.report) {
        mkdirSync(join(out, "frames"), { recursive: true });
        for (const f of (fake.report.frames as { file: string }[] | undefined) ?? []) writeFileSync(join(out, f.file), "png");
        writeFileSync(join(out, "report.json"), JSON.stringify(fake.report));
        writeFileSync(join(out, "log.txt"), "log\n");
      }
      const block = fake.block ?? { ok: fake.exit === 0, verdict: fake.report?.verdict, failed: fake.report?.failed ?? null, out, mode: "movie",
        exit: fake.exit, timed_out: false, duration_ms: 1200, status: fake.exit === 0 ? "complete" : "partial", intent: "playable",
        artifacts: ["report.json", "log.txt", "frames/"], reason: null };
      writeFileSync(spec.out, JSON.stringify(block, null, 2) + "\n");
      writeFileSync(spec.status, JSON.stringify({ exit: fake.exit, signal: null }));
      return { exit: 0, stdout: "", stderr: "" };
    };
    return { steps, run };
  }
  /** A fake judge: records its calls and writes `answer` as `judge.json` into the payload's media folder. */
  function fakeJudge(answer: Record<string, unknown> | null, result: Record<string, unknown> = {
    status_block: { status: "complete", intent: "tk-studio-playable-judge", artifacts: ["judge.json"], reason: null }, total_cost_usd: 0.42,
  }) {
    const calls: { root: string; args: Parameters<PlayableJudge>[1] }[] = [];
    const judge: PlayableJudge = async (root, args) => {
      calls.push({ root, args });
      const media = join(root, args.payload.media);
      expect(existsSync(join(media, "report.json"))).toBe(true); // the copy is in place before the judge runs
      if (answer) writeFileSync(join(media, "judge.json"), JSON.stringify(answer));
      return result;
    };
    return { calls, judge };
  }
  const route = async () => ({ "playable-verify": { model: "claude-opus-5", effort: "high" } });
  /** A project whose base config carries `config`, its run carrying the 34.3 fields. */
  function fixture(config: string) {
    const fx = project(config);
    return { ...fx, run: { ...fx.run, sandbox: "tk-sbx", engine_run_id: "20261027-eng", studio_run_id: "run-77", project_id: "acme" } };
  }

  test("verifyCommand: `playable` read from the base config; absent → no key; malformed → named field", async () => {
    expect(await verifyCommand(fixture(base + PLAYABLE).run)).toMatchObject({ playable: { scenario: "scenarios/smoke.json", seed: 7, ticks: 120 } });
    expect("playable" in (await verifyCommand(fixture(base).run) as object)).toBe(false);
    expect(playableConfig("x")).toEqual({ skipped: "playable is malformed: playable" });
    expect(playableConfig([1])).toEqual({ skipped: "playable is malformed: playable" });
    expect(playableConfig({ seed: 1, ticks: 2 })).toEqual({ skipped: "playable is malformed: scenario" });
    expect(playableConfig({ scenario: "/abs.json", seed: 1, ticks: 2 })).toEqual({ skipped: "playable is malformed: scenario" });
    expect(playableConfig({ scenario: "../up.json", seed: 1, ticks: 2 })).toEqual({ skipped: "playable is malformed: scenario" });
    expect(playableConfig({ scenario: "s.json", seed: -1, ticks: 2 })).toEqual({ skipped: "playable is malformed: seed" });
    expect(playableConfig({ scenario: "s.json", seed: "1", ticks: 2 })).toEqual({ skipped: "playable is malformed: seed" });
    expect(playableConfig({ scenario: "s.json", seed: 1, ticks: 0 })).toEqual({ skipped: "playable is malformed: ticks" });
    expect(playableConfig({ scenario: "s.json", seed: 1, ticks: 1.5 })).toEqual({ skipped: "playable is malformed: ticks" });
    expect(playableConfig({ scenario: "s.json", seed: 0, ticks: 1 })).toEqual({ scenario: "s.json", seed: 0, ticks: 1 });
    // `seed` a safe non-negative integer; `ticks` at most int32 (`playable.py` refuses beyond it).
    expect(playableConfig({ scenario: "s.json", seed: 1.5, ticks: 2 })).toEqual({ skipped: "playable is malformed: seed" });
    expect(playableConfig({ scenario: "s.json", seed: 2 ** 53, ticks: 2 })).toEqual({ skipped: "playable is malformed: seed" });
    expect(playableConfig({ scenario: "s.json", seed: 1, ticks: 2147483648 })).toEqual({ skipped: "playable is malformed: ticks" });
    expect(playableConfig({ scenario: "s.json", seed: Number.MAX_SAFE_INTEGER, ticks: 2147483647 }))
      .toEqual({ scenario: "s.json", seed: Number.MAX_SAFE_INTEGER, ticks: 2147483647 });
  }, 60_000);

  test("ordering and pass: host, engine, then playable.py (no --mode, the store --out), the media copied, the routed judge on sbx", async () => {
    const config = base + PLAYABLE;
    const { steps, run } = recorder(config, [0, 0]);
    const { calls, judge } = fakeJudge({ verdict: "pass", findings: [] });
    const { env, studio } = legEnv();
    const fx = fixture(config);
    const v = await hostVerify(fx.run, 60, { env, run: run as any, judge, route }) as HostVerifyRan;
    expect(steps).toHaveLength(3);
    expect(steps[0]!.argv.at(-1)).toBe("tools/verify_host.py");
    expect(steps[1]!.argv.at(-1)).toBe("scripts/engine-gate.sh");
    const store = join(studioRunDir({ project_id: "acme", root: fx.run.root }, "run-77", env), "playable");
    expect(steps[2]!.argv).toEqual(["uv", "run", join(studio, "plugins", "tk-studio", "lib", "playable.py"), "run",
      "--directory", fx.wt, "--scenario", join(fx.wt, "scenarios/smoke.json"), "--seed", "7", "--ticks", "120", "--out", store, "--wall-clock", "60"]);
    expect(steps[2]!.argv).not.toContain("--mode");
    expect(steps[2]!.cwd).toBe(fx.wt);
    const media = join(fx.wt, ".bmad-loop", "runs", "20261027-eng", "playable");
    for (const f of ["report.json", "log.txt", "frames/tick-000000.png", "frames/tick-000030.png"]) expect(existsSync(join(media, f))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.root).toBe(fx.wt);
    expect(calls[0]!.args).toEqual({ tier: "sbx", sandbox: "tk-sbx", model: "claude-opus-5", effort: "high", timeout_s: 60, payload: { media: ".bmad-loop/runs/20261027-eng/playable" } });
    expect(v.green).toBe(true);
    expect(isRed(v)).toBe(false);
    expect(v.playable).toMatchObject({
      verdict: "pass", exit: 0, status: "complete", store, media,
      judge: { status: "complete", verdict: "pass", cost_usd: 0.42, model: "claude-opus-5", effort: "high" },
      frames: [join(store, "frames/tick-000000.png"), join(store, "frames/tick-000030.png")],
    });
    expect(v.playable!.reason).toBeUndefined();
    expect(prSection(v).at(-1)).toBe("Playable: pass (judge claude-opus-5)");
  }, 30_000);

  test("a route without the leg (or none at all) falls back to {claude-sonnet-5, medium}", async () => {
    for (const r of [async () => ({ session: { model: "claude-opus-5" } }), async () => { throw new Error("no route"); }]) {
      const config = base + PLAYABLE;
      const { run } = recorder(config, [0, 0]);
      const { calls, judge } = fakeJudge({ verdict: "pass", findings: [] });
      const v = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: run as any, judge, route: r }) as HostVerifyRan;
      expect(calls[0]!.args).toMatchObject({ model: "claude-sonnet-5", effort: "medium" });
      expect(v.playable!.judge).toMatchObject({ model: "claude-sonnet-5", effort: "medium" });
    }
  }, 30_000);

  test("skipped: no playable (the PR section unchanged), malformed, the engine gate red or skipped; nothing spawned past the gate", async () => {
    const cases: [string, number[], number, string][] = [
      [base, [0, 0], 2, "no playable"],
      [base + "playable: smoke\n", [0, 0], 2, "playable is malformed: playable"],
      [base + "playable:\n  scenario: s.json\n  seed: 1\n", [0, 0], 2, "playable is malformed: ticks"],
      [base + PLAYABLE, [0, 1], 2, "engine gate not green"],
      [hostKey("uv run tools/verify_host.py") + PLAYABLE, [0], 1, "engine gate not green"],
      [base + PLAYABLE, [3], 1, "engine gate not green"],
    ];
    for (const [config, exits, spawned, reason] of cases) {
      const { steps, run } = recorder(config, exits);
      const { calls, judge } = fakeJudge({ verdict: "pass" });
      const v = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: run as any, judge, route }) as HostVerifyRan;
      expect(steps).toHaveLength(spawned);
      expect(calls).toHaveLength(0);
      expect(v.playable).toEqual({ verdict: "skipped", reason });
      const section = prSection(v);
      if (reason === "no playable") {
        expect(v.green).toBe(true);
        expect(section.join("\n")).not.toContain("Playable");
        expect(section.at(-1)).toStartWith("Engine gate: green: `bash scripts/engine-gate.sh` ("); // the 34.1 section, unchanged
      } else expect(section.at(-1)).toBe(`Playable: skipped (${reason})`);
    }
  }, 60_000);

  test("a host-side skip carries no `playable`", async () => {
    const v = await hostVerify({ ...fixture("verify:\n  engine: godot\n" + PLAYABLE).run }, 60);
    expect(v).toEqual({ skipped: true, reason: "no verify.host" });
  });

  test("judge fail: `fail` with the findings and every store frame path; red (playable); the PR section lists both", async () => {
    const config = base + PLAYABLE;
    const { run } = recorder(config, [0, 0]);
    const findings = [{ frame: "frames/tick-000030.png", rubric: "no-magenta-or-error-overlay", note: "magenta floor" },
      { frame: "frames/tick-000000.png", rubric: "hud-reads" }];
    const { judge } = fakeJudge({ verdict: "fail", findings });
    const fx = fixture(config);
    const env = legEnv().env;
    const v = await hostVerify(fx.run, 60, { env, run: run as any, judge, route }) as HostVerifyRan;
    const store = join(studioRunDir({ project_id: "acme", root: fx.run.root }, "run-77", env), "playable");
    expect(v.exit).toBe(0);
    expect(v.engine!.verdict).toBe("green");
    expect(v.green).toBe(false);
    expect(isRed(v)).toBe(true);
    expect(v.playable).toMatchObject({ verdict: "fail", findings, judge: { status: "complete", verdict: "fail", cost_usd: 0.42 },
      frames: [join(store, "frames/tick-000000.png"), join(store, "frames/tick-000030.png")] });
    expect(redReason(v)).toBe("host verify red (playable): no-magenta-or-error-overlay at frames/tick-000030.png: magenta floor");
    const section = prSection(v).join("\n");
    expect(section).toContain("Engine gate: green");
    expect(section).toContain("Playable: fail");
    expect(section).toContain("- `frames/tick-000030.png` — no-magenta-or-error-overlay: magenta floor");
    expect(section).toContain("- `frames/tick-000000.png` — hud-reads");
    expect(section).toContain(`- \`${join(store, "frames/tick-000030.png")}\``);
  }, 30_000);

  test("harness fail (exit 1): `fail`, the judge never run, one finding naming the invariant and the failing tick's frame", async () => {
    const config = base + PLAYABLE;
    const report = { ...REPORT, verdict: "fail", failed: { tick: 30, invariant: "player exists", detail: "node /root/Player missing" } };
    const { run } = recorder(config, [0, 0], { exit: 1, report });
    const { calls, judge } = fakeJudge({ verdict: "pass" });
    const v = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: run as any, judge, route }) as HostVerifyRan;
    expect(calls).toHaveLength(0);
    expect(v.green).toBe(false);
    expect(v.playable).toMatchObject({ verdict: "fail", exit: 1, status: "partial",
      findings: [{ frame: "frames/tick-000030.png", rubric: "harness: player exists", note: "node /root/Player missing" }] });
    expect(v.playable!.judge).toBeUndefined();
    expect(redReason(v)).toBe("host verify red (playable): harness: player exists at frames/tick-000030.png: node /root/Player missing");
    // A failing tick with no frame captured names none.
    const noFrame = recorder(config, [0, 0], { exit: 1, report: { ...report, failed: { tick: 7, invariant: "wall-clock", detail: "60s exceeded" } } });
    const w = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: noFrame.run as any, judge, route }) as HostVerifyRan;
    expect(w.playable!.findings).toEqual([{ frame: null, rubric: "harness: wall-clock", note: "60s exceeded" }]);
    expect(redReason(w)).toBe("host verify red (playable): harness: wall-clock: 60s exceeded");
  }, 30_000);

  test("refusal (exit 2): `fail` with `playable.py refused: <reason>`, nothing copied, no judge", async () => {
    const config = base + PLAYABLE;
    const why = "GODOT is unset: set the GODOT user variable to the console binary";
    const { run } = recorder(config, [0, 0], { exit: 2, report: null, block: { ok: false, error: why, status: "blocked", intent: "playable", artifacts: [], reason: why } });
    const { calls, judge } = fakeJudge({ verdict: "pass" });
    const fx = fixture(config);
    const v = await hostVerify(fx.run, 60, { env: legEnv().env, run: run as any, judge, route }) as HostVerifyRan;
    expect(calls).toHaveLength(0);
    expect(v.playable).toMatchObject({ verdict: "fail", exit: 2, status: "blocked", reason: `playable.py refused: ${why}` });
    expect(existsSync(join(fx.wt, ".bmad-loop", "runs", "20261027-eng", "playable"))).toBe(false);
    expect(redReason(v)).toBe(`host verify red (playable): playable.py refused: ${why}`);
    expect(prSection(v).join("\n")).toContain(`Reason: playable.py refused: ${why}`);
  }, 30_000);

  test("judge broken: blocked, failed, no status block, a throw, no judge.json, a fail without findings, no sandbox → `fail`, never throws", async () => {
    const config = base + PLAYABLE;
    const blocked = { status_block: { status: "blocked", intent: "tk-studio-playable-judge", artifacts: [], reason: "no frames" }, total_cost_usd: 0.1 };
    const cases: [ReturnType<typeof fakeJudge>["judge"] | undefined, string, Partial<Record<string, unknown>>][] = [
      [fakeJudge(null, blocked).judge, "judge: blocked: no frames", { judge: { status: "blocked", cost_usd: 0.1 } }],
      [fakeJudge(null, { conformance_failure: "conformance failure (AD-11): run terminated without a JSON status block (§3)" }).judge,
        "judge: conformance failure (AD-11): run terminated without a JSON status block (§3)", {}],
      [async () => { throw new Error("SbxSandboxMissing"); }, "judge: SbxSandboxMissing", {}],
      [fakeJudge(null).judge, "judge: no readable judge.json verdict", {}],
      [fakeJudge({ verdict: "fail", findings: [] }).judge, "judge: a fail with no findings", {}],
    ];
    for (const [judge, reason, extra] of cases) {
      const { run } = recorder(config, [0, 0]);
      const v = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: run as any, judge, route }) as HostVerifyRan;
      expect(v.green).toBe(false);
      expect(v.playable).toMatchObject({ verdict: "fail", reason, ...extra });
      expect(redReason(v)).toBe(`host verify red (playable): ${reason}`);
    }
    const { run } = recorder(config, [0, 0]);
    const { calls, judge } = fakeJudge({ verdict: "pass" });
    const fx = fixture(config);
    const v = await hostVerify({ ...fx.run, sandbox: null }, 60, { env: legEnv().env, run: run as any, judge, route }) as HostVerifyRan;
    expect(calls).toHaveLength(0);
    expect(v.playable).toMatchObject({ verdict: "fail", reason: "judge: no sandbox recorded for the run" });
  }, 60_000);

  test("a stale worktree copy (an earlier judge.json) is replaced before the judge runs", async () => {
    const config = base + PLAYABLE;
    const fx = fixture(config);
    const media = join(fx.wt, ".bmad-loop", "runs", "20261027-eng", "playable");
    mkdirSync(media, { recursive: true });
    writeFileSync(join(media, "judge.json"), JSON.stringify({ verdict: "pass", findings: [] }));
    const { run } = recorder(config, [0, 0]);
    const v = await hostVerify(fx.run, 60, { env: legEnv().env, run: run as any, judge: fakeJudge(null).judge, route }) as HostVerifyRan;
    expect(v.playable).toMatchObject({ verdict: "fail", reason: "judge: no readable judge.json verdict" });
  }, 30_000);

  test("the default judge pins the sandbox (`sbx run -d --name <sb>`) before its first `sbx exec`; a pin failure is `fail` (`judge: …`)", async () => {
    const config = base + PLAYABLE;
    const log: string[] = [];
    const spawner = async (_bin: string, args: string[]) => {
      log.push(`spawn ${args.join(" ")}`);
      return { exit: 1, stdout: "", stderr: "not logged in" }; // the Max-login probe fails: nothing past it runs
    };
    const pinOk = { run: async (_bin: string, args: string[]) => { log.push(`sbx ${args.join(" ")}`); return { exit: 0, stdout: "", stderr: "" }; } };
    const { run } = recorder(config, [0, 0]);
    const v = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: run as any, route, sbx: pinOk as any, spawner }) as HostVerifyRan;
    expect(log[0]).toBe("sbx run -d --name tk-sbx");
    expect(log[1]).toStartWith("spawn exec tk-sbx ");
    expect(v.playable).toMatchObject({ verdict: "fail", judge: { status: "blocked" } });
    expect(v.playable!.reason).toStartWith("judge: blocked: auth preflight: ");

    log.length = 0;
    const pinBad = { run: async (_bin: string, args: string[]) => { log.push(`sbx ${args.join(" ")}`); return { exit: 1, stdout: "", stderr: "no such sandbox" }; } };
    const again = recorder(config, [0, 0]);
    const w = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: again.run as any, route, sbx: pinBad as any, spawner }) as HostVerifyRan;
    expect(log).toEqual(["sbx run -d --name tk-sbx"]); // never an exec into the stopped sandbox
    expect(w.green).toBe(false);
    expect(w.playable).toMatchObject({ verdict: "fail", reason: "judge: blocked: sbx pin failed: sbx run -d --name tk-sbx exited 1: no such sandbox" });
  }, 30_000);

  test("judge.json re-validated by the host: verdict, rubric ids, frames of report.json, a fail with findings; else `fail` (`judge: …`)", async () => {
    const config = base + PLAYABLE;
    const cases: [Record<string, unknown>, string][] = [
      [{ verdict: "maybe", findings: [] }, "judge: no readable judge.json verdict"],
      [{ verdict: "fail", findings: "lots" }, "judge: judge.json findings is not a list"],
      [{ verdict: "fail", findings: ["x"] }, "judge: finding 0 is not an object"],
      [{ verdict: "fail", findings: [{ frame: "frames/tick-000030.png", rubric: "looks-fun" }] }, 'judge: finding 0 names an unknown rubric "looks-fun"'],
      [{ verdict: "pass", findings: [{ frame: "frames/tick-000000.png", rubric: "hud-reads" }, { frame: "frames/tick-999999.png", rubric: "hud-reads" }] },
        'judge: finding 1 names a frame not in report.json "frames/tick-999999.png"'],
      [{ verdict: "fail", findings: [{ rubric: "hud-reads" }] }, "judge: finding 0 names a frame not in report.json null"],
      [{ verdict: "fail" }, "judge: a fail with no findings"],
    ];
    for (const [answer, reason] of cases) {
      const { run } = recorder(config, [0, 0]);
      const v = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: run as any, judge: fakeJudge(answer).judge, route }) as HostVerifyRan;
      expect(v.green).toBe(false);
      expect(v.playable).toMatchObject({ verdict: "fail", reason });
      expect(v.playable!.findings).toBeUndefined();
    }
    // Every fixed rubric id on a reported frame is accepted.
    const all = ["scene-loaded", "player-visible", "no-magenta-or-error-overlay", "hud-reads", "moments-shown"]
      .map((rubric) => ({ frame: "frames/tick-000030.png", rubric }));
    const { run } = recorder(config, [0, 0]);
    const v = await hostVerify(fixture(config).run, 60, { env: legEnv().env, run: run as any, judge: fakeJudge({ verdict: "fail", findings: all }).judge, route }) as HostVerifyRan;
    expect(v.playable).toMatchObject({ verdict: "fail", findings: all });
    expect(v.playable!.reason).toBeUndefined();
  }, 60_000);

  test("a failed media copy never masks a harness fail (best-effort there), and is still required on the judge path", async () => {
    const config = base + PLAYABLE;
    const blockCopy = (wt: string) => { // the media's parent a file: the copy throws
      mkdirSync(join(wt, ".bmad-loop", "runs"), { recursive: true });
      writeFileSync(join(wt, ".bmad-loop", "runs", "20261027-eng"), "not a folder");
    };
    const report = { ...REPORT, verdict: "fail", failed: { tick: 30, invariant: "player exists", detail: "node /root/Player missing" } };
    const harness = recorder(config, [0, 0], { exit: 1, report });
    const fx = fixture(config);
    blockCopy(fx.wt);
    const { calls, judge } = fakeJudge({ verdict: "pass" });
    const v = await hostVerify(fx.run, 60, { env: legEnv().env, run: harness.run as any, judge, route }) as HostVerifyRan;
    expect(calls).toHaveLength(0);
    expect(v.playable).toMatchObject({ verdict: "fail", exit: 1,
      findings: [{ frame: "frames/tick-000030.png", rubric: "harness: player exists", note: "node /root/Player missing" }] });
    expect(v.playable!.media).toBeUndefined();
    expect(redReason(v)).toBe("host verify red (playable): harness: player exists at frames/tick-000030.png: node /root/Player missing");

    const pass = recorder(config, [0, 0]);
    const gx = fixture(config);
    blockCopy(gx.wt);
    const j = fakeJudge({ verdict: "pass" });
    const w = await hostVerify(gx.run, 60, { env: legEnv().env, run: pass.run as any, judge: j.judge, route }) as HostVerifyRan;
    expect(j.calls).toHaveLength(0);
    expect(w.playable!.verdict).toBe("fail");
    expect(w.playable!.reason).toStartWith("media copy: ");
  }, 30_000);
});

describe("hole 77: a shell script's own lines reach the capture", () => {
  // MSYS bash cannot write to an append-only handle (`echo: write error: Bad file descriptor`): with the
  // capture's files opened for appending, every echo failed, the script's lines vanished from the tails and
  // its exit followed its closing echo (TUA's `verify: OK`): red on every run. The files are fresh, so they
  // are opened for writing. On win32 the step's `bash` is Git's (hole 52); elsewhere the system's.
  const haveBash = process.platform === "win32" ? gitUsrBin(process.env) !== null : Bun.which("bash") !== null;
  test.skipIf(!haveBash)("bash: every echo lands in stdout_tail, in order, and the closing echo exits 0", async () => {
    const fx = project(hostKey('bash -c "echo first; true; echo verify: OK"'));
    const v = await hostVerify(fx.run, 60, { env: { ...process.env } }) as HostVerifyRan;
    expect(v).toMatchObject({ green: true, exit: 0, stderr_tail: [] });
    expect(v.stdout_tail).toEqual(["first", "verify: OK"]);
  });
});

describe("Story 34.8: a slice run's assets step, contact sheet and PR section", () => {
  const PLAYABLE = "playable:\n  scenario: scenarios/smoke.json\n  seed: 7\n  ticks: 120\n";
  const base = verifyKeys({ host: "uv run tools/verify_host.py", engine: "bash scripts/engine-gate.sh" });
  const REPORT = {
    schema: 1, verdict: "pass", failed: null, seed: 7, ticks: 120, ticks_run: 120, capture_every: 30, mode: "movie",
    frames: [{ tick: 0, file: "frames/tick-000000.png" }, { tick: 30, file: "frames/tick-000030.png" }],
    moments: [], frame_time_ms: { max: 20, mean: 16.6 }, log_errors: [],
  };
  const legEnv = () => ({ TK_STUDIO_ROOT: tempDir("tk-sup-vs-studio-"), TK_STUDIO_HOME: tempDir("tk-sup-vs-home-"), PATH: "/usr/bin", GODOT: "/opt/godot/godot" });
  /** A slice fixture: the base config, the run's 34.3 fields, and (unless `manifest: false`) the manifest in the worktree. */
  function fixture(config: string, o: { manifest?: boolean } = {}) {
    const fx = project(config);
    if (o.manifest !== false) { mkdirSync(join(fx.wt, "assets"), { recursive: true }); writeFileSync(join(fx.wt, "assets", "manifest.yaml"), "schema: 1\n"); }
    return { ...fx, run: { ...fx.run, sandbox: "tk-sbx", engine_run_id: "20261027-eng", studio_run_id: "run-77", project_id: "acme" } };
  }
  /** The runner: the config; the host and engine steps exit per `exits`; `assets.py <verb>` exits per `assets`; `playable.py
   * run` writes the report and frames; `playable.py sheet` writes the sheet and names the sampled frames. */
  function recorder(config: string, o: { exits?: number[]; assets?: Record<string, number>; sheet?: number } = {}) {
    const steps: string[][] = [];
    let plain = 0;
    const run = async (bin: string, args: string[]) => {
      if (bin === "git") return { exit: 0, stdout: config, stderr: "" };
      const spec = JSON.parse(readFileSync(args[2]!, "utf-8"));
      const argv = spec.argv as string[];
      steps.push(argv);
      const script = String(argv[2] ?? "");
      const status = (exit: number, block?: Record<string, unknown>) => {
        writeFileSync(spec.out, block ? JSON.stringify(block, null, 2) + "\n" : `step\n`);
        writeFileSync(spec.status, JSON.stringify({ exit, signal: null }));
        return { exit: 0, stdout: "", stderr: "" };
      };
      if (script.endsWith("assets.py")) {
        const exit = o.assets?.[argv[3]!] ?? 0;
        return status(exit, { ok: exit === 0, entries: [], status: exit === 0 ? "complete" : exit === 1 ? "partial" : "blocked", intent: "assets", artifacts: [], reason: exit ? `${argv[3]} not ok` : null });
      }
      if (script.endsWith("playable.py") && argv[3] === "sheet") {
        const out = argv[argv.indexOf("--out") + 1]!;
        const exit = o.sheet ?? 0;
        if (exit === 0) writeFileSync(out, "sheet-png");
        return status(exit, { ok: exit === 0, frames: ["tick-000000.png", "tick-000030.png"], status: exit === 0 ? "complete" : "blocked", intent: "playable", artifacts: [], reason: null });
      }
      if (script.endsWith("playable.py")) {
        const out = argv[argv.indexOf("--out") + 1]!;
        mkdirSync(join(out, "frames"), { recursive: true });
        for (const f of REPORT.frames) writeFileSync(join(out, f.file), "png");
        writeFileSync(join(out, "report.json"), JSON.stringify(REPORT));
        writeFileSync(join(out, "log.txt"), "log\n");
        return status(1, { ok: false, verdict: "fail", failed: null, status: "partial", intent: "playable", artifacts: [], reason: "harness" });
      }
      return status(o.exits?.[plain++] ?? 0);
    };
    return { steps, run };
  }
  const verbs = (steps: string[][]) => steps.map((a) => String(a[2] ?? "").endsWith("assets.py") || String(a[2] ?? "").endsWith("playable.py")
    ? `${String(a[2]).split(/[\\/]/).at(-1)} ${a[3]}` : String(a.at(-1)));

  test("isSlice: the resolved definition's type or id is run-vertical-slice", async () => {
    const { isSlice, SLICE_JOB_TYPE } = await import("../src/hostverify");
    expect(SLICE_JOB_TYPE).toBe("run-vertical-slice");
    expect(isSlice({ id: "run-epic-41", type: "run-vertical-slice" })).toBe(true);
    expect(isSlice({ id: "run-vertical-slice" })).toBe(true);
    expect(isSlice({ id: "run-epic-41", type: "run-epic" })).toBe(false);
    expect(isSlice(null)).toBe(false);
  });

  test("assetsLayout: the served root, .git, .tk-studio, absolute or escaping values fall back to the defaults; ./ is stripped", async () => {
    const { assetsLayout, DEFAULT_ART_PATH, DEFAULT_MANIFEST } = await import("../src/hostverify");
    for (const bad of [".", "./", "", " ", ".//", "./.", ".git", ".git/hooks", "./.git/x", ".tk-studio", ".tk-studio/proof", "/abs", "C:/x", "../up", "a/../../b"]) {
      expect(assetsLayout({ assets: { art_path: bad, manifest: bad } })).toEqual({ manifest: DEFAULT_MANIFEST, art_path: DEFAULT_ART_PATH });
    }
    expect(assetsLayout({ assets: { art_path: "./art", manifest: ".\\assets\\m.yaml" } })).toEqual({ manifest: "assets/m.yaml", art_path: "art" });
    expect(assetsLayout({ assets: { art_path: "art/world/greybox/", manifest: "assets/manifest.yaml" } })).toEqual({ manifest: "assets/manifest.yaml", art_path: "art/world/greybox" });
  });

  test("assets green: check, greybox, match after the host command and before the engine gate; never generate, never --mirror", async () => {
    const config = base + PLAYABLE + "assets:\n  manifest: assets/manifest.yaml\n  art_path: art/world/greybox\n";
    const fx = fixture(config);
    const { steps, run } = recorder(config);
    const env = legEnv();
    const v = await hostVerify(fx.run, 60, { env, run: run as any }, { slice: true }) as HostVerifyRan;
    expect(verbs(steps)).toEqual(["tools/verify_host.py", "assets.py check", "assets.py greybox", "assets.py match", "scripts/engine-gate.sh", "playable.py run", "playable.py sheet"]);
    for (const a of steps.filter((x) => String(x[2]).endsWith("assets.py"))) {
      expect(a.slice(4)).toEqual(["--directory", fx.wt, "--manifest", "assets/manifest.yaml", "--art-path", "art/world/greybox"]);
      expect(a).not.toContain("--mirror");
    }
    expect(steps.some((a) => a.includes("generate"))).toBe(false);
    expect(v.assets).toMatchObject({ verdict: "green", manifest: "assets/manifest.yaml", art_path: "art/world/greybox" });
    expect(v.assets!.steps.map((s) => [s.verb, s.exit, s.status])).toEqual([["check", 0, "complete"], ["greybox", 0, "complete"], ["match", 0, "complete"]]);
    expect(v.engine!.verdict).toBe("green");
    // the harness failed here: the sheet still made from the frames and copied with the media
    expect(dirname(v.playable!.contact_sheet!)).toBe(join(v.playable!.store!, "sheets")); // this leg's own copy
    expect(existsSync(join(v.playable!.store!, "contact-sheet.png"))).toBe(true);
    expect(v.playable!.sampled).toEqual(["tick-000000.png", "tick-000030.png"]);
    expect(existsSync(join(v.playable!.media!, "contact-sheet.png"))).toBe(true);
    expect(prSection(v)).toContain("Assets: green");
  }, 30_000);

  test("two slice legs on one store: each records its own contact_sheet, the first one's still on disk; the media copy unchanged", async () => {
    const config = base + PLAYABLE;
    const fx = fixture(config);
    const env = legEnv();
    const one = await hostVerify(fx.run, 60, { env, run: recorder(config).run as any }, { slice: true }) as HostVerifyRan;
    const two = await hostVerify(fx.run, 60, { env, run: recorder(config).run as any }, { slice: true }) as HostVerifyRan;
    expect(one.playable!.store).toBe(two.playable!.store!);
    const store = one.playable!.store!;
    for (const v of [one, two]) {
      expect(dirname(v.playable!.contact_sheet!)).toBe(join(store, "sheets"));
      expect(v.playable!.contact_sheet!.endsWith(".png")).toBe(true);
    }
    expect(one.playable!.contact_sheet).not.toBe(two.playable!.contact_sheet);
    expect(existsSync(one.playable!.contact_sheet!)).toBe(true);
    expect(existsSync(two.playable!.contact_sheet!)).toBe(true);
    // the media copy keeps the contact-sheet.png name and never gains the per-leg sheets
    expect(existsSync(join(two.playable!.media!, "contact-sheet.png"))).toBe(true);
    expect(existsSync(join(two.playable!.media!, "sheets"))).toBe(false);
  }, 30_000);

  test("match exit 1 is a fault: recorded, not red; the engine gate runs", async () => {
    const config = base;
    const fx = fixture(config);
    const { steps, run } = recorder(config, { assets: { match: 1 } });
    const v = await hostVerify(fx.run, 60, { env: legEnv(), run: run as any }, { slice: true }) as HostVerifyRan;
    expect(v.assets!.verdict).toBe("green");
    expect(v.assets!.steps.at(-1)).toMatchObject({ verb: "match", exit: 1, status: "fault" });
    expect(v.assets).toMatchObject({ manifest: "assets/manifest.yaml", art_path: "art/greybox" }); // the defaults
    expect(verbs(steps)).toContain("scripts/engine-gate.sh");
    expect(v.green).toBe(true);
  }, 30_000);

  test("assets red (check or greybox exit 1 or 2, match exit 2): the later verbs and the engine gate skipped, the leg red", async () => {
    for (const [verb, exit, ran] of [["check", 1, 1], ["check", 2, 1], ["greybox", 1, 2], ["greybox", 2, 2], ["match", 2, 3]] as const) {
      const fx = fixture(base);
      const { steps, run } = recorder(base, { assets: { [verb]: exit } });
      const v = await hostVerify(fx.run, 60, { env: legEnv(), run: run as any }, { slice: true }) as HostVerifyRan;
      expect(v.assets!.verdict).toBe("red");
      expect(v.assets!.steps).toHaveLength(ran);
      expect(v.assets!.reason).toContain(`assets.py ${verb} exited ${exit}`);
      expect(v.engine).toMatchObject({ verdict: "skipped", reason: "assets red" });
      expect(verbs(steps)).not.toContain("scripts/engine-gate.sh");
      expect(v.green).toBe(false);
      expect(isRed(v)).toBe(true);
      expect(redReason(v)).toStartWith("host verify red (assets): assets.py ");
      expect(prSection(v)).toContain(`Assets: red (${v.assets!.reason})`);
    }
  }, 60_000);

  test("no manifest: skipped (no manifest), the leg continues; a red host command skips the step", async () => {
    const fx = fixture(base, { manifest: false });
    const { steps, run } = recorder(base);
    const v = await hostVerify(fx.run, 60, { env: legEnv(), run: run as any }, { slice: true }) as HostVerifyRan;
    expect(v.assets).toMatchObject({ verdict: "skipped", reason: "no manifest", steps: [] });
    expect(verbs(steps)).toEqual(["tools/verify_host.py", "scripts/engine-gate.sh"]);
    expect(prSection(v)).toContain("Assets: skipped (no manifest)");
    const red = recorder(base, { exits: [1] });
    const r = await hostVerify(fixture(base).run, 60, { env: legEnv(), run: red.run as any }, { slice: true }) as HostVerifyRan;
    expect(r.assets).toEqual({ verdict: "skipped", reason: "verify.host red", steps: [] });
    expect(verbs(red.steps)).toEqual(["tools/verify_host.py"]);
  }, 30_000);

  test("a non-slice run: no assets step, no sheet, no assets field, the PR section unchanged", async () => {
    const config = base + PLAYABLE;
    const fx = fixture(config);
    const { steps, run } = recorder(config);
    const v = await hostVerify(fx.run, 60, { env: legEnv(), run: run as any }) as HostVerifyRan;
    expect(verbs(steps)).toEqual(["tools/verify_host.py", "scripts/engine-gate.sh", "playable.py run"]);
    expect("assets" in v).toBe(false);
    expect(v.playable!.contact_sheet).toBeUndefined();
    expect(prSection(v).some((l) => l.startsWith("Assets:"))).toBe(false);
  }, 30_000);

  test("the PR section with the committed proof: the sheet embedded and the frames listed, on pass and fail alike", () => {
    const proof = { sheetUrl: "https://github.com/acme/tua/blob/abc123/.tk-studio/proof/q1/contact-sheet.png?raw=true", frames: [".tk-studio/proof/q1/frames/tick-000000.png"] };
    const ran = (playable: HostVerifyRan["playable"]): HostVerifyRan => ({
      command: "c", argv: ["c"], cwd: "/w", exit: 0, duration_ms: 1, green: true, stdout_tail: [], stderr_tail: [],
      engine: { verdict: "green", command: "e", duration_ms: 1, godot_dir: null }, playable,
      assets: { verdict: "green", steps: [] },
    });
    for (const p of [{ verdict: "pass" as const }, { verdict: "fail" as const, reason: "harness", frames: ["/store/frames/tick-000000.png"] }]) {
      const lines = prSection(ran(p), proof);
      expect(lines).toContain(`![contact sheet](${proof.sheetUrl})`);
      expect(lines).toContain("- `.tk-studio/proof/q1/frames/tick-000000.png`");
      expect(lines.filter((l) => l === "Frames:")).toHaveLength(1);
      expect(lines.indexOf("Assets: green")).toBeLessThan(lines.findIndex((l) => l.startsWith("Engine gate:")));
    }
  });

  test("proof with no committed frames (the sheet failed): a failed playable still lists its store frame paths", () => {
    const v: HostVerifyRan = {
      command: "c", argv: ["c"], cwd: "/w", exit: 0, duration_ms: 1, green: false, stdout_tail: [], stderr_tail: [],
      engine: { verdict: "green", command: "e", duration_ms: 1, godot_dir: null },
      playable: { verdict: "fail", reason: "harness", frames: ["/store/frames/tick-000000.png"] },
      assets: { verdict: "green", steps: [] },
    };
    const lines = prSection(v, { frames: [] });
    expect(lines).toContain("- `/store/frames/tick-000000.png`");
    expect(lines.filter((l) => l === "Frames:")).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("![contact sheet]"))).toBe(false);
  });
});
