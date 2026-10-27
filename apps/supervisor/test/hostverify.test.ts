// Story 27.4: a host-tier verify leg runs before any PR opens — the command read from the base's tracked
// config (never the worktree or the plugin), split without a shell, run argv-only under the guard, its
// tails clipped and redacted. Verify commands are `process.execPath` (bun) `-e` scripts: the same test
// runs on both hosts.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { gitUsrBin, hostVerify, isRed, pathKey, prSection, redReason, splitCommand, tail, verifyCommand, wallClockTrip, type HostVerifyRan } from "../src/hostverify";
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
  });

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
