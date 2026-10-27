/**
 * hostverify.ts — a host-tier verify leg runs before any PR opens (Story 27.4).
 *
 * An sbx-tier run's engine runs on Linux in the microVM, so the supervisor runs the project's own
 * `verify.host` command on the host, in the run's worktree, when its engine completes, before the
 * close-out pushes and opens the PR:
 *
 *   command  read from the project's tracked `.tk-studio/config.yaml` at the run's base
 *            (`git show <base_ref>:.tk-studio/config.yaml` in the checkout, never the worktree and never
 *            the plugin, AD-2), so the run's own commits cannot change the gate that judges them.
 *            `verify: {host: "<one command line>"}`, split into argv on whitespace with `"…"`/`'…'`
 *            grouping and backslashes literal; never run through a shell.
 *   spawn    argv only, through the `CAPTURE` wrapper spawned by `runProcess` (`windowsHide`, never
 *            `detached` on win32, the tree killed on timeout), the worker's env (`buildWorkerEnv`), under the
 *            host-tier worker's wall-clock guard; both streams go to files, so a timeout keeps their tails.
 *   result   a `host-verify` event: `{command, argv, cwd, exit, duration_ms, signal?, guard?, error?, green,
 *            stdout_tail, stderr_tail, engine}`, or `{skipped: true, reason}` (no `engine`). Green is exit 0; a
 *            timeout, a spawn failure or a non-zero exit is red: the run ends `partial` naming the command, the
 *            PR a draft.
 *   engine   Story 34.1: the engine gate. `verify: {engine: "<one command line>"}` beside `host` in the same
 *            base config, split the same way, runs only after the host command is green, in the same cwd, as its
 *            own step through the same wrapper under the same full guard. Its env is the host step's (worker env,
 *            Git `usr\bin` first on win32) with the folder of `GODOT` (the leg's env) prepended under `pathKey`
 *            (one key, hole 54); the leg never resolves `godot` itself (the bare-first-token rule of hole 52
 *            applies to the engine argv as to the host's). Recorded as `engine: {verdict: green | red | skipped,
 *            reason?, command?, argv?, cwd?, exit?, duration_ms?, signal?, guard?, error?, stdout_tail?,
 *            stderr_tail?, godot_dir}` (`godot_dir` null when `GODOT` is unset or not an absolute path: the command
 *            still runs, PATH unchanged). Skip reasons: `no verify.engine`, `verify.engine is not a non-empty string`,
 *            `verify.host red`. The leg's `green` is host green and engine not red, so every consumer reads an
 *            engine red through `isRed` as a red leg; its reason reads `host verify red (engine): …`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";

/** Hole 46 (win32 only): Git for Windows' `usr\bin` (Git Bash, `bash.exe`) beside the `Git\cmd` or
 * `Git\bin` entry on PATH, or null. The console's bare `bash` is the WindowsApps WSL launcher, which runs a
 * `verify.host` of `bash …` inside WSL against Windows paths; the leg puts Git Bash first instead. */
/** Hole 54: the key `env` spells PATH with (`Path` under a console-started process on Windows, `PATH` under
 * Git Bash), so the leg edits that key and never adds a second one: a plain object copy of `process.env` is
 * case-sensitive, and a duplicate `PATH` beside `Path` reached the child as a PATH of Git's `usr\bin` alone. */
export function pathKey(env: Record<string, string | undefined>): string {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

export function gitUsrBin(env: Record<string, string | undefined>): string | null {
  if (process.platform !== "win32") return null;
  for (const entry of (env[pathKey(env)] ?? "").split(";")) {
    const e = entry.trim().replace(/[\\/]+$/, "");
    if (!/[\\/]Git[\\/](cmd|bin)$/i.test(e)) continue;
    const usrBin = join(dirname(e), "usr", "bin");
    if (existsSync(join(usrBin, "bash.exe"))) return usrBin;
  }
  return null;
}
import { load as loadYaml } from "js-yaml";
import { buildWorkerEnv, runProcess, type RunResult } from "./server";
import { servedRoot, type QueueRun } from "./queue";
import type { WorktreeDeps } from "./worktree";

/** The leg's result: what ran (`green` decides), or why it was skipped. */
export type HostVerifyRan = {
  skipped?: false; command: string; argv: string[]; cwd: string; exit: number | null; duration_ms: number;
  /** The signal that killed the command (not the guard), when one did. */
  signal?: string; guard?: string; error?: string; green: boolean; stdout_tail: string[]; stderr_tail: string[];
  /** Hole 46 (win32): Git's `usr\bin` put first on the leg's PATH, when it was there. */
  git_bash?: string;
  /** Hole 52 (win32): the command's first token as spawned, when it was a bare name found in that `usr\bin`. */
  resolved?: string;
  /** Story 34.1: the engine gate's step (`verify.engine`), run only after a green host command. Optional on
   * the type only for `host-verify` events recorded before 34.1; every ran result of this leg carries it. */
  engine?: EngineStep;
};
/** Story 34.1: the engine gate's step on a ran leg. `reason` only when skipped; the run fields mirror the host
 * command's own; `godot_dir` the folder of `GODOT` prepended to PATH, null when unset or not absolute. */
export type EngineStep = {
  verdict: "green" | "red" | "skipped"; reason?: string; command?: string; argv?: string[]; cwd?: string;
  exit?: number | null; duration_ms?: number; signal?: string; guard?: string; error?: string;
  stdout_tail?: string[]; stderr_tail?: string[]; godot_dir: string | null;
};
export type HostVerifySkipped = { skipped: true; reason: string };
export type HostVerifyResult = HostVerifyRan | HostVerifySkipped;

type Run = Pick<QueueRun, "root" | "worktree" | "base_ref" | "tier" | "prefix">;
type Deps = Pick<WorktreeDeps, "env" | "run">;

/** The tracked config's path, as `git show <rev>:<path>` takes it. */
export const CONFIG_PATH = ".tk-studio/config.yaml";
/** The tail kept of each stream, and the lines a red reason quotes. */
export const TAIL_LINES = 20;
export const REASON_LINES = 5;

/** A line of output for an event: URL userinfo redacted, clipped (worktree.ts's `clip` rule). */
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `verify.host` as argv: split on whitespace, `"…"` or `'…'` grouping (adjacent text joined, `""` an
 * empty argument), backslashes literal (Windows paths). Never a shell. An unterminated quote runs to the end. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = "", started = false, quote: string | null = null;
  for (const ch of line) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { if (started) { out.push(cur); cur = ""; started = false; } continue; }
    cur += ch; started = true;
  }
  if (started) out.push(cur);
  return out;
}

/** Story 34.1: the engine gate's command from the same base config, or why its step is skipped. */
export type EngineCommand = { command: string; argv: string[] } | { skipped: string };
export type VerifyCommand = { command: string; argv: string[]; engine: EngineCommand };

/** The command the leg runs for `run`, or why it is skipped: another tier (the worker ran on the host),
 * a gone worktree, no config at the base, an unreadable one, no `verify.host`, or not a non-empty string.
 * Story 34.1: with `engine`, `verify.engine` split the same way, or its skip (`no verify.engine`, or
 * `verify.engine is not a non-empty string`); a host-side skip skips the whole leg, engine included. */
export async function verifyCommand(run: Run, deps: Deps = {}): Promise<VerifyCommand | HostVerifySkipped> {
  if (run.tier !== "sbx") return { skipped: true, reason: "host-tier run: the worker ran on the host" };
  if (!run.worktree || !existsSync(run.worktree)) return { skipped: true, reason: "worktree gone" };
  const base = run.base_ref ?? "";
  // Story 28.5: a project below its git top-level reads its own config at the base (`<prefix>.tk-studio/…`).
  const configPath = `${run.prefix ?? ""}${CONFIG_PATH}`;
  let res: RunResult;
  try {
    const args = ["show", `${base}:${configPath}`];
    // `LC_ALL=C`: git's "does not exist" message (the no-config skip below) is matched in English.
    const env = { ...(deps.env ?? process.env), LC_ALL: "C" };
    res = deps.run ? await deps.run("git", args, { cwd: run.root, timeoutS: 60, env })
      : await runProcess("git", args, { cwd: run.root, timeoutS: 60, env });
  } catch (e) { return { skipped: true, reason: `config unreadable: git show: ${clip(message(e))}` }; }
  if (res.exit !== 0) {
    const err = `${res.stderr}${res.stdout}`;
    if (/does not exist|exists on disk, but not in/i.test(err)) return { skipped: true, reason: `no ${configPath} at ${base}` };
    return { skipped: true, reason: `config unreadable: git show exited ${res.exit}: ${clip(err)}` };
  }
  let config: unknown;
  try { config = loadYaml(res.stdout); }
  catch (e) { return { skipped: true, reason: `config unreadable: ${clip(message(e))}` }; }
  const verify = config && typeof config === "object" ? (config as Record<string, unknown>).verify : undefined;
  if (!verify || typeof verify !== "object" || !("host" in verify)) return { skipped: true, reason: "no verify.host" };
  const host = (verify as Record<string, unknown>).host;
  const argv = typeof host === "string" ? splitCommand(host) : [];
  if (typeof host !== "string" || !argv.length) return { skipped: true, reason: "verify.host is not a non-empty string" };
  let engine: EngineCommand;
  if (!("engine" in verify)) engine = { skipped: "no verify.engine" };
  else {
    const line = (verify as Record<string, unknown>).engine;
    const engineArgv = typeof line === "string" ? splitCommand(line) : [];
    engine = typeof line !== "string" || !engineArgv.length ? { skipped: "verify.engine is not a non-empty string" }
      : { command: line.trim(), argv: engineArgv };
  }
  return { command: host.trim(), argv, engine };
}

/** The last `TAIL_LINES` non-empty-ended lines of a stream, each clipped and redacted. */
export function tail(text: string, n = TAIL_LINES): string[] {
  const t = text.replace(/\s+$/, "");
  return t ? t.split(/\r?\n/).slice(-n).map((l) => clip(l)) : [];
}

/** `guard: max_wall_clock_seconds (<n>s)` — as a host-tier worker's trip is named (cli.ts `guardReason`). */
export const wallClockTrip = (guardS: number) => `guard: max_wall_clock_seconds (${guardS}s)`;

/** The capture wrapper the command runs under: `<bun> -e CAPTURE <spec.json>` (spawned through `runProcess`, so
 * argv only, `windowsHide`, never `detached` on win32, the tree killed past the guard, the worker's env). It
 * spawns the command argv-only (`windowsHide`, not detached: in the wrapper's tree) with its stdout/stderr
 * written straight to files, so a command the guard kills still has the output it printed before the hang
 * (both streams, whole lines). It records `{exit, signal}` or `{error}` (a spawn failure) in the status file. */
export const CAPTURE = [
  "const fs = require('fs'), cp = require('child_process');",
  "const s = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));",
  "const done = (r) => { fs.writeFileSync(s.status, JSON.stringify(r)); process.exit(0); };",
  "const fail = (e) => done({ error: String((e && e.message) || e) });",
  "let c;",
  "try { c = cp.spawn(s.argv[0], s.argv.slice(1), { cwd: s.cwd, stdio: ['ignore', fs.openSync(s.out, 'a'), fs.openSync(s.err, 'a')], windowsHide: true }); } catch (e) { fail(e); }",
  "c.on('error', fail);",
  "c.on('exit', (code, signal) => done({ exit: code, signal: signal || null }));",
].join("\n");

/** A guard trip as `runProcess` names it: "`<cmd>` timed out after <n>s (process tree killed)" (`<n>` may be fractional). */
const TIMED_OUT = / timed out after [\d.]+s \(process tree killed\)/;

/** One step's outcome: what the capture wrapper recorded, shaped as the event's run fields. */
type StepOutcome = {
  exit: number | null; duration_ms: number; signal?: string; guard?: string; error?: string; stdout_tail: string[]; stderr_tail: string[];
};
const stepGreen = (o: StepOutcome) => o.exit === 0 && !o.guard && !o.error;

/** Hole 52: a bare first token that Git's `usr\bin` holds is spawned by its full path there (or null). */
function resolveBare(argv: string[], gitBash: string | null): string | undefined {
  if (!gitBash || !argv[0] || /[\\/]/.test(argv[0])) return undefined;
  const exe = join(gitBash, /\.exe$/i.test(argv[0]) ? argv[0] : `${argv[0]}.exe`);
  return existsSync(exe) ? exe : undefined;
}

/** Run one argv in `cwd` under the `CAPTURE` wrapper with `env`, bounded by `guardS` (the tree killed past
 * it), and shape its outcome. Never throws. */
async function runStep(argv: string[], cwd: string, env: Record<string, string | undefined>, guardS: number, deps: Deps): Promise<StepOutcome> {
  const started = Date.now();
  const out = (r: { exit: number | null; signal?: string; guard?: string; error?: string; stdout?: string; stderr?: string }): StepOutcome => ({
    exit: r.exit, duration_ms: Date.now() - started,
    ...(r.signal ? { signal: r.signal } : {}), ...(r.guard ? { guard: r.guard } : {}), ...(r.error ? { error: r.error } : {}),
    stdout_tail: tail(r.stdout ?? ""), stderr_tail: tail(r.stderr ?? ""),
  });
  let dir: string;
  try { dir = mkdtempSync(join(tmpdir(), "tk-sup-hv-")); }
  catch (e) { return out({ exit: null, error: clip(`capture dir: ${message(e)}`) }); }
  const files = { out: join(dir, "stdout"), err: join(dir, "stderr"), status: join(dir, "status.json") };
  const read = (p: string) => { try { return readFileSync(p, "utf-8"); } catch { return ""; } };
  const streams = () => ({ stdout: read(files.out), stderr: read(files.err) });
  try {
    const spec = join(dir, "spec.json");
    writeFileSync(spec, JSON.stringify({ argv, cwd, ...files }), "utf-8");
    const args = ["-e", CAPTURE, spec];
    let res: RunResult;
    try {
      res = deps.run ? await deps.run(process.execPath, args, { cwd, timeoutS: guardS, env })
        : await runProcess(process.execPath, args, { cwd, timeoutS: guardS, env });
    } catch (e) {
      const m = message(e);
      if (TIMED_OUT.test(m)) return out({ exit: null, guard: wallClockTrip(guardS), ...streams() });
      return out({ exit: null, error: clip(m), ...streams() });
    }
    let status: { exit?: number | null; signal?: string | null; error?: string } | undefined;
    try { status = JSON.parse(read(files.status)); } catch { status = undefined; }
    if (!status || typeof status !== "object") {
      return out({ exit: null, error: clip(`capture wrapper exited ${res.exit}: ${res.stderr}${res.stdout}`), ...streams() });
    }
    if (status.error) return out({ exit: null, error: clip(status.error), ...streams() });
    return out({ exit: typeof status.exit === "number" ? status.exit : null, ...(typeof status.signal === "string" && status.signal ? { signal: status.signal } : {}), ...streams() });
  } catch (e) {
    return out({ exit: null, error: clip(message(e)), ...streams() });
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir left behind */ } }
}

/** Run the leg: the command from the base config, in the worktree, argv only, the worker's env, under
 * `guardS` seconds (the tree killed past it), through the `CAPTURE` wrapper; then (Story 34.1), when it is
 * green, `verify.engine` the same way with the folder of `GODOT` first on PATH, under the full guard again.
 * Never throws. */
export async function hostVerify(run: Run, guardS: number, deps: Deps = {}): Promise<HostVerifyResult> {
  const cmd = await verifyCommand(run, deps);
  if ("skipped" in cmd) return cmd;
  const cwd = servedRoot(run)!; // Story 28.5: the root the run serves (`<worktree>/<prefix>`)
  const env = buildWorkerEnv(deps.env ?? process.env);
  // Hole 46: on the Windows host the console's `bash` is the WindowsApps WSL launcher, so a `verify.host`
  // that says `bash …` (and the lib suite's own bash-driven tests) ran inside WSL against Windows paths. Git's
  // own `usr\bin` (Git Bash, not on PATH by default) goes first when it is there.
  const gitBash = gitUsrBin(env);
  if (gitBash) { const key = pathKey(env); env[key] = `${gitBash};${env[key] ?? ""}`; }
  // Hole 52: Windows resolves a bare command name through the parent's PATH, never the child's, so the
  // prefix alone still ran the WindowsApps stub (exit 127, nothing printed). A bare first token that Git's
  // `usr\bin` holds (`bash`, `sh`, …) is spawned by its full path there; the event records it as `resolved`.
  const argv = [...cmd.argv];
  const resolved = resolveBare(argv, gitBash);
  if (resolved) argv[0] = resolved;
  const host = await runStep(argv, cwd, env, guardS, deps);
  // Story 34.1: the engine gate. `GODOT` from the leg's env; its folder first on the step's PATH (one key).
  // Only an absolute `GODOT`: a bare or relative one (`godot`, `godot.exe`) has `.` for its folder, which would
  // put the worktree first, so a binary the run committed could shadow the gate; then PATH is left unchanged.
  const godot = (deps.env ?? process.env).GODOT;
  const godotDir = typeof godot === "string" && godot.trim() && isAbsolute(godot.trim()) ? dirname(godot.trim()) : null;
  let engine: EngineStep;
  if (!stepGreen(host)) engine = { verdict: "skipped", reason: "verify.host red", godot_dir: godotDir };
  else if ("skipped" in cmd.engine) engine = { verdict: "skipped", reason: cmd.engine.skipped, godot_dir: godotDir };
  else {
    const engineEnv = { ...env };
    if (godotDir) { const key = pathKey(engineEnv); engineEnv[key] = [godotDir, engineEnv[key]].filter((p) => p).join(delimiter); }
    const engineArgv = [...cmd.engine.argv];
    const engineResolved = resolveBare(engineArgv, gitBash);
    if (engineResolved) engineArgv[0] = engineResolved;
    const step = await runStep(engineArgv, cwd, engineEnv, guardS, deps);
    engine = { verdict: stepGreen(step) ? "green" : "red", command: cmd.engine.command, argv: cmd.engine.argv, cwd, ...step, godot_dir: godotDir };
  }
  return {
    command: cmd.command, argv: cmd.argv, cwd, exit: host.exit, duration_ms: host.duration_ms, ...(gitBash ? { git_bash: gitBash } : {}), ...(resolved ? { resolved } : {}),
    ...(host.signal ? { signal: host.signal } : {}), ...(host.guard ? { guard: host.guard } : {}), ...(host.error ? { error: host.error } : {}),
    green: stepGreen(host) && engine.verdict !== "red", stdout_tail: host.stdout_tail, stderr_tail: host.stderr_tail, engine,
  };
}

/** Is this result a red verify (it ran and was not green)? */
export const isRed = (v: HostVerifyResult | undefined): v is HostVerifyRan => !!v && !v.skipped && !v.green;

/** The red run's reason (`<how>`: exited <n>, timed out (<guard>), failed to start: <error>, or killed by <signal>):
 * ``host verify red: `<command>` <how>; last lines: <the last 5 stderr lines, else
 * stdout, joined " | ">``. */
export function redReason(v: HostVerifyRan): string {
  // Story 34.1: a green host command with a red engine gate names the engine command (`(engine)`).
  const e = v.engine?.verdict === "red" ? v.engine : undefined;
  const s = e ? { command: e.command ?? "", exit: e.exit ?? null, signal: e.signal, guard: e.guard, error: e.error, stdout_tail: e.stdout_tail ?? [], stderr_tail: e.stderr_tail ?? [] } : v;
  const how = s.guard ? `timed out (${s.guard})` : s.error ? `failed to start: ${s.error}` : s.signal ? `killed by ${s.signal}` : `exited ${s.exit}`;
  const lines = (s.stderr_tail.length ? s.stderr_tail : s.stdout_tail).slice(-REASON_LINES);
  return `host verify red${e ? " (engine)" : ""}: \`${s.command}\` ${how}; last lines: ${lines.length ? lines.join(" | ") : "(none)"}`;
}

/** The PR body's `## Host verify` section: green (command, duration), skipped (reason), red (command, exit or
 * guard, duration, the tails fenced). Story 34.1: then one `Engine gate: green | red | skipped (<reason>)` line
 * (a ran leg recorded before 34.1 has none); on red the engine command, exit or guard, duration and its tails
 * fenced the same way. */
export function prSection(v: HostVerifyResult): string[] {
  const head = ["## Host verify", ""];
  if (v.skipped) return [...head, `Skipped: ${v.reason}`];
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const how = (s: { exit?: number | null; signal?: string; guard?: string; error?: string }) =>
    s.guard ?? (s.error ? `failed to start: ${s.error}` : s.signal ? `killed by ${s.signal}` : `exit ${s.exit}`);
  // The fence outruns any backtick run in its lines (min 3): a tail line holding ``` never closes it early.
  const fence = (name: string, lines: string[]) => {
    const tick = "`".repeat(Math.max(2, ...lines.map((l) => Math.max(0, ...(l.match(/`+/g) ?? []).map((m) => m.length)))) + 1);
    return [`${name}:`, "", tick, ...(lines.length ? lines : ["(empty)"]), tick, ""];
  };
  const hostGreen = v.exit === 0 && !v.guard && !v.error;
  const hostLines = hostGreen ? [`Green: \`${v.command}\` (${secs(v.duration_ms)})`]
    : [`**Red:** \`${v.command}\` — ${how(v)} (${secs(v.duration_ms)})`, "", ...fence("stderr (last lines)", v.stderr_tail), ...fence("stdout (last lines)", v.stdout_tail)].slice(0, -1);
  const e = v.engine;
  if (!e) return [...head, ...hostLines];
  let engineLines: string[];
  if (e.verdict === "skipped") engineLines = [`Engine gate: skipped (${e.reason})`];
  else if (e.verdict === "green") engineLines = [`Engine gate: green: \`${e.command}\` (${secs(e.duration_ms ?? 0)})`];
  else engineLines = ["Engine gate: red", "", `**Red:** \`${e.command}\` — ${how(e)} (${secs(e.duration_ms ?? 0)})`, "",
    ...fence("engine stderr (last lines)", e.stderr_tail ?? []), ...fence("engine stdout (last lines)", e.stdout_tail ?? [])].slice(0, -1);
  return [...head, ...hostLines, "", ...engineLines];
}
