// Story 27.4: a host-tier verify leg runs before any PR opens — the command read from the base's tracked
// config (never the worktree or the plugin), split without a shell, run argv-only under the guard, its
// tails clipped and redacted. Verify commands are `process.execPath` (bun) `-e` scripts: the same test
// runs on both hosts.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitUsrBin, hostVerify, isRed, prSection, redReason, splitCommand, tail, verifyCommand, wallClockTrip, type HostVerifyRan } from "../src/hostverify";
import { gitRepo, testGit } from "./fakes";

/** `"<bun>" -e "<script>"` as one command line (the script uses single quotes only). */
const bunCmd = (script: string) => `"${process.execPath}" -e "${script}"`;

/** A repo whose base (`main`) config carries `config` (none: no file), and a worktree of it. */
function project(config?: string) {
  const repo = gitRepo(config === undefined ? {} : { ".tk-studio/config.yaml": config });
  const wt = join(mkdtempSync(join(tmpdir(), "tk-sup-hv-wt-")), "wt");
  testGit(repo.checkout, "worktree", "add", "-q", wt, "-b", "supervisor/run-q1", "main");
  return { repo, wt, run: { root: repo.checkout, worktree: wt, base_ref: "main", tier: "sbx" as string | null } };
}
const hostKey = (cmd: string) => `vcs: git\nverify:\n  host: ${JSON.stringify(cmd)}\n`;

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
    expect(await verifyCommand(fx.run)).toEqual({ command: "bun test", argv: ["bun", "test"] });
  });

  test("a run commit that edits verify.host is ignored: the base's command is used", async () => {
    const fx = project(hostKey("bun test"));
    writeFileSync(join(fx.wt, ".tk-studio", "config.yaml"), hostKey("true"));
    testGit(fx.wt, "commit", "-q", "-am", "weaken the gate");
    writeFileSync(join(fx.wt, ".tk-studio", "config.yaml"), "verify: 7\n"); // and an uncommitted edit
    expect(await verifyCommand(fx.run)).toEqual({ command: "bun test", argv: ["bun", "test"] });
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
    const root = mkdtempSync(join(tmpdir(), "tk-sup-git-"));
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

  test("hole 52: a first token that is already a path, or one Git's `usr\\bin` does not hold, is spawned as written", async () => {
    const root = mkdtempSync(join(tmpdir(), "tk-sup-git-"));
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
