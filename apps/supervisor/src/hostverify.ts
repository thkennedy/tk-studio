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
 *            stdout_tail, stderr_tail}`, or `{skipped: true, reason}`. Green is exit 0; a timeout, a spawn
 *            failure or a non-zero exit is red: the run ends `partial` naming the command, the PR a draft.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Hole 46 (win32 only): Git for Windows' `usr\bin` (Git Bash, `bash.exe`) beside the `Git\cmd` or
 * `Git\bin` entry on PATH, or null. The console's bare `bash` is the WindowsApps WSL launcher, which runs a
 * `verify.host` of `bash …` inside WSL against Windows paths; the leg puts Git Bash first instead. */
export function gitUsrBin(env: Record<string, string | undefined>): string | null {
  if (process.platform !== "win32") return null;
  for (const entry of (env.PATH ?? env.Path ?? "").split(";")) {
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

/** The command the leg runs for `run`, or why it is skipped: another tier (the worker ran on the host),
 * a gone worktree, no config at the base, an unreadable one, no `verify.host`, or not a non-empty string. */
export async function verifyCommand(run: Run, deps: Deps = {}): Promise<{ command: string; argv: string[] } | HostVerifySkipped> {
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
  return { command: host.trim(), argv };
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

/** Run the leg: the command from the base config, in the worktree, argv only, the worker's env, under
 * `guardS` seconds (the tree killed past it), through the `CAPTURE` wrapper. Never throws. */
export async function hostVerify(run: Run, guardS: number, deps: Deps = {}): Promise<HostVerifyResult> {
  const cmd = await verifyCommand(run, deps);
  if ("skipped" in cmd) return cmd;
  const cwd = servedRoot(run)!; // Story 28.5: the root the run serves (`<worktree>/<prefix>`)
  const env = buildWorkerEnv(deps.env ?? process.env);
  // Hole 46: on the Windows host the console's `bash` is the WindowsApps WSL launcher, so a `verify.host`
  // that says `bash …` (and the lib suite's own bash-driven tests) ran inside WSL against Windows paths. Git's
  // own `usr\bin` (Git Bash, not on PATH by default) goes first when it is there.
  const gitBash = gitUsrBin(env);
  if (gitBash) env.PATH = `${gitBash};${env.PATH ?? ""}`;
  const started = Date.now();
  const ran = (r: Partial<HostVerifyRan> & { exit: number | null; stdout?: string; stderr?: string }): HostVerifyRan => ({
    command: cmd.command, argv: cmd.argv, cwd, exit: r.exit, duration_ms: Date.now() - started, ...(gitBash ? { git_bash: gitBash } : {}),
    ...(r.signal ? { signal: r.signal } : {}), ...(r.guard ? { guard: r.guard } : {}), ...(r.error ? { error: r.error } : {}),
    green: r.exit === 0 && !r.guard && !r.error, stdout_tail: tail(r.stdout ?? ""), stderr_tail: tail(r.stderr ?? ""),
  });
  let dir: string;
  try { dir = mkdtempSync(join(tmpdir(), "tk-sup-hv-")); }
  catch (e) { return ran({ exit: null, error: clip(`capture dir: ${message(e)}`) }); }
  const files = { out: join(dir, "stdout"), err: join(dir, "stderr"), status: join(dir, "status.json") };
  const read = (p: string) => { try { return readFileSync(p, "utf-8"); } catch { return ""; } };
  const streams = () => ({ stdout: read(files.out), stderr: read(files.err) });
  try {
    const spec = join(dir, "spec.json");
    writeFileSync(spec, JSON.stringify({ argv: cmd.argv, cwd, ...files }), "utf-8");
    const args = ["-e", CAPTURE, spec];
    let res: RunResult;
    try {
      res = deps.run ? await deps.run(process.execPath, args, { cwd, timeoutS: guardS, env })
        : await runProcess(process.execPath, args, { cwd, timeoutS: guardS, env });
    } catch (e) {
      const m = message(e);
      if (TIMED_OUT.test(m)) return ran({ exit: null, guard: wallClockTrip(guardS), ...streams() });
      return ran({ exit: null, error: clip(m), ...streams() });
    }
    let status: { exit?: number | null; signal?: string | null; error?: string } | undefined;
    try { status = JSON.parse(read(files.status)); } catch { status = undefined; }
    if (!status || typeof status !== "object") {
      return ran({ exit: null, error: clip(`capture wrapper exited ${res.exit}: ${res.stderr}${res.stdout}`), ...streams() });
    }
    if (status.error) return ran({ exit: null, error: clip(status.error), ...streams() });
    return ran({ exit: typeof status.exit === "number" ? status.exit : null, ...(typeof status.signal === "string" && status.signal ? { signal: status.signal } : {}), ...streams() });
  } catch (e) {
    return ran({ exit: null, error: clip(message(e)), ...streams() });
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir left behind */ } }
}

/** Is this result a red verify (it ran and was not green)? */
export const isRed = (v: HostVerifyResult | undefined): v is HostVerifyRan => !!v && !v.skipped && !v.green;

/** The red run's reason (`<how>`: exited <n>, timed out (<guard>), failed to start: <error>, or killed by <signal>):
 * ``host verify red: `<command>` <how>; last lines: <the last 5 stderr lines, else
 * stdout, joined " | ">``. */
export function redReason(v: HostVerifyRan): string {
  const how = v.guard ? `timed out (${v.guard})` : v.error ? `failed to start: ${v.error}` : v.signal ? `killed by ${v.signal}` : `exited ${v.exit}`;
  const lines = (v.stderr_tail.length ? v.stderr_tail : v.stdout_tail).slice(-REASON_LINES);
  return `host verify red: \`${v.command}\` ${how}; last lines: ${lines.length ? lines.join(" | ") : "(none)"}`;
}

/** The PR body's `## Host verify` section: green (command, duration), skipped (reason), red (command, exit or
 * guard, duration, the tails fenced). */
export function prSection(v: HostVerifyResult): string[] {
  const head = ["## Host verify", ""];
  if (v.skipped) return [...head, `Skipped: ${v.reason}`];
  const secs = `${(v.duration_ms / 1000).toFixed(1)}s`;
  if (v.green) return [...head, `Green: \`${v.command}\` (${secs})`];
  const how = v.guard ?? (v.error ? `failed to start: ${v.error}` : v.signal ? `killed by ${v.signal}` : `exit ${v.exit}`);
  // The fence outruns any backtick run in its lines (min 3): a tail line holding ``` never closes it early.
  const fence = (name: string, lines: string[]) => {
    const tick = "`".repeat(Math.max(2, ...lines.map((l) => Math.max(0, ...(l.match(/`+/g) ?? []).map((m) => m.length)))) + 1);
    return [`${name}:`, "", tick, ...(lines.length ? lines : ["(empty)"]), tick, ""];
  };
  return [...head, `**Red:** \`${v.command}\` — ${how} (${secs})`, "", ...fence("stderr (last lines)", v.stderr_tail), ...fence("stdout (last lines)", v.stdout_tail)].slice(0, -1);
}
