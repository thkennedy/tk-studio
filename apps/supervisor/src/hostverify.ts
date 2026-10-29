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
 *   playable Story 34.3: the playable-verify step. `playable: {scenario, seed, ticks}` (top level of the same base
 *            config; `scenario` relative to the served root) runs only after a green engine gate: `uv run
 *            <plugin>/lib/playable.py run --directory <served root> --scenario <served root>/<scenario> --seed <n>
 *            --ticks <t> --out <store> --wall-clock <guard>` (never `--mode`: movie is the ruling) through the same
 *            wrapper under the same guard, the plugin from the supervisor's checkout (`TK_STUDIO_ROOT`), never the
 *            served project. `--out` is the run's store folder (`<studio run dir>/playable/`, else
 *            `<studioHome>/runs/<engine run id>/playable/`); its `report.json`, `log.txt` and `frames/` are then
 *            copied into the worktree's ignored `.bmad-loop/runs/<engine run id>/playable/`, the only copy the sandboxed
 *            judge can read. On exit 0 with `verdict: pass` the judge runs: `tk-studio-playable-judge` through
 *            `invokeSkill` on the sbx tier (`deps.judge`), its model and effort from the route's `playable-verify`
 *            leg (default `claude-sonnet-5`, `medium`), reading only `report.json` and the frames; its verdict is
 *            read back from `<media>/judge.json`. Recorded as `playable: {verdict: pass | fail | skipped, reason?,
 *            exit?, status?, failed?, duration_ms?, store?, media?, judge?, findings?, frames?}`. Skip reasons: `no
 *            playable`, `playable is malformed: <field>`, `engine gate not green`. On a configured project every
 *            other non-pass is `fail` (a harness fail, a refusal, a judge that ended blocked or failed). The leg's
 *            `green` is also playable not fail; its reason reads `host verify red (playable): …`.
 *   slice    Story 34.8: a `run-vertical-slice` run (its resolved definition's `type` or `id`, `isSlice`, decided once
 *            by the caller and passed as `opts.slice`). Only on a slice run: the assets step, after a green host
 *            command and before the engine gate (the import sees the placed files): skipped `no manifest` when the
 *            base config's `assets.manifest` (default `assets/manifest.yaml`) is absent in the served root, else
 *            `uv run <plugin>/lib/assets.py check`, then `greybox`, then `match` (each `--directory <served root>
 *            --manifest <m> --art-path <a>`, the base config's `assets.art_path`, default `art/greybox`), never
 *            `--mirror` (the env or default resolves it; no mirror ends `complete`, its entries `skipped`) and never
 *            `generate`. `check`/`greybox` not exit 0 is red, `match` exit 1 is `fault` (recorded, not red, the
 *            placeholder kept), any other `match` non-zero is red; a red step ends the step (the later verbs not
 *            run). Recorded as `assets: {verdict: green | red | skipped, reason?, manifest?, art_path?, steps:
 *            [{verb, exit, status, duration_ms, stdout_tail?, stderr_tail?}]}` (`status` the verb's status block
 *            status, `fault`, or `error` with no block). A red assets step skips the engine gate (`assets red`)
 *            and makes the leg red (`host verify red (assets): …`). Then, after `playable.py run` wrote frames,
 *            `playable.py sheet --frames <store>/frames --out <store>/contact-sheet.png` (copied with the media;
 *            recorded as the playable step's `contact_sheet` — the leg's own copy under `<store>/sheets/` — and
 *            `sampled`). A non-slice run's leg is unchanged.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

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
import { buildWorkerEnv, invokeSkill, lastJsonObject, runProcess, type RunResult, type Spawner } from "./server";
import { servedRoot, type QueueEvent, type QueueRun } from "./queue";
import { pluginRoot, studioHome } from "./env";
import { pinSandbox, studioRunDir } from "./sandbox";
import type { WorktreeDeps } from "./worktree";

/** The leg's result: what ran (`green` decides), or why it was skipped. */
export type HostVerifyRan = {
  skipped?: false; command: string; argv: string[]; cwd: string; exit: number | null; duration_ms: number;
  /** Story 35.8: when the leg started (ISO, the host's clock) — the Stage Log's host-leg row starts here and ends at
   * the `host-verify` event's `at`. Optional on the type only for events recorded before 35.8. */
  started_at?: string;
  /** The signal that killed the command (not the guard), when one did. */
  signal?: string; guard?: string; error?: string; green: boolean; stdout_tail: string[]; stderr_tail: string[];
  /** Hole 46 (win32): Git's `usr\bin` put first on the leg's PATH, when it was there. */
  git_bash?: string;
  /** Hole 52 (win32): the command's first token as spawned, when it was a bare name found in that `usr\bin`. */
  resolved?: string;
  /** Story 34.1: the engine gate's step (`verify.engine`), run only after a green host command. Optional on
   * the type only for `host-verify` events recorded before 34.1; every ran result of this leg carries it. */
  engine?: EngineStep;
  /** Story 34.3: the playable-verify step, run only after a green engine gate. Optional on the type only for
   * `host-verify` events recorded before 34.3 (a reader treats a missing one as not run); every ran result of
   * this leg carries it. */
  playable?: PlayableStep;
  /** Story 34.8: the assets step, written on every ran leg of a slice run only (absent on any other run). */
  assets?: AssetsStep;
};
/** Story 34.8: one asset-ladder verb's run on a slice run's leg. */
export type AssetsStepRun = {
  verb: "check" | "greybox" | "match"; exit: number | null; status: string; duration_ms: number;
  stdout_tail?: string[]; stderr_tail?: string[];
};
/** Story 34.8: the assets step. `manifest` and `art_path` are the base config's (what the close-out commits). */
export type AssetsStep = {
  verdict: "green" | "red" | "skipped"; reason?: string; manifest?: string; art_path?: string; steps: AssetsStepRun[];
};
/** Story 34.3: one judge (or harness) finding: the frame it names (out-relative, `frames/<name>.png`; null when a
 * harness fail names no frame) and the rubric line (`<rubric id>` or `harness: <invariant>`). */
export type PlayableFinding = { frame: string | null; rubric: string; note?: string };
/** Story 34.3: the judge session's outcome on a playable step. */
export type PlayableJudgeOutcome = { status: string; verdict?: "pass" | "fail"; cost_usd?: number; model?: string; effort?: string };
/** Story 34.3: the playable-verify step on a ran leg. `reason` when skipped or failed without findings of its own;
 * `exit`, `status`, `failed`, `duration_ms` are `playable.py`'s; `store` its `--out`; `media` the worktree copy the
 * judge reads; `frames` the store paths of every frame. */
export type PlayableStep = {
  verdict: "pass" | "fail" | "skipped"; reason?: string; exit?: number | null; status?: string; failed?: unknown;
  duration_ms?: number; store?: string; media?: string; judge?: PlayableJudgeOutcome; findings?: PlayableFinding[]; frames?: string[];
  /** Story 34.8 (slice runs only): the contact sheet's store path and the frame names it sampled. */
  contact_sheet?: string; sampled?: string[];
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

/** Story 34.3: the run's sandbox (the judge's tier), engine and studio run ids (the media folders) and project id
 * (the route) ride along; a run without them (an older caller) gets a `fail` playable step only when it declares one. */
type Run = Pick<QueueRun, "root" | "worktree" | "base_ref" | "tier" | "prefix">
  & Partial<Pick<QueueRun, "sandbox" | "engine_run_id" | "studio_run_id" | "project_id">>;
/** Story 34.3: the judge session (default: `invokeSkill` on the sbx tier, mounted at the served root). */
export type PlayableJudge = (servedRoot: string, args: {
  tier: "sbx"; sandbox: string; model: string; effort: string; timeout_s: number; payload: { media: string };
}) => Promise<Record<string, unknown>>;
/** Story 34.3: the project's route (`pipeline.py resolve`), whose `playable-verify` leg routes the judge. */
export type PlayableRoute = (root: string, projectId: string) => Promise<Record<string, unknown>>;
/** `sbx`: the seam the default judge's pin (`sbx run -d --name <sb>`) runs through; `spawner`: the default judge's
 * `invokeSkill` spawner (its preflight and worker; default `runProcess`). */
type Deps = Pick<WorktreeDeps, "env" | "run" | "sbx"> & { judge?: PlayableJudge; route?: PlayableRoute; spawner?: Spawner };

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
/** Story 34.3: `playable: {scenario, seed, ticks}` from the same base config, or why its step is skipped. Absent
 * from the command when the config declares no `playable` (the step then reads `no playable`). */
export type PlayableConfig = { scenario: string; seed: number; ticks: number } | { skipped: string };
/** Story 34.8: the asset layout from the same base config (`assets.manifest`, `assets.art_path`, served-root relative). */
export type AssetsLayout = { manifest: string; art_path: string };
export type VerifyCommand = { command: string; argv: string[]; engine: EngineCommand; playable?: PlayableConfig; assets?: AssetsLayout };

/** Story 34.8: the shipped job type whose runs get the assets step, the contact sheet and the proof commit. */
export const SLICE_JOB_TYPE = "run-vertical-slice";
/** Story 34.8: a run is a slice when its resolved definition's `type` or `id` is `run-vertical-slice`. */
export const isSlice = (defn: Record<string, any> | null | undefined): boolean =>
  !!defn && (defn.type === SLICE_JOB_TYPE || defn.id === SLICE_JOB_TYPE);
/** Story 34.8: `assets.py`'s layout defaults. */
export const DEFAULT_MANIFEST = "assets/manifest.yaml";
export const DEFAULT_ART_PATH = "art/greybox";
const layoutPath = (v: unknown, dflt: string): string => {
  const t = typeof v === "string" ? v.trim().replace(/\\/g, "/").replace(/\/+$/, "").replace(/^(\.\/+)+/, "") : "";
  const parts = t.split("/");
  // The served root itself (`.`), or a path under `.git` or `.tk-studio`, would stage more than the named paths.
  return !t || t === "." || isAbsolute(t) || /^[A-Za-z]:/.test(t) || parts.includes("..")
    || parts[0] === ".git" || parts[0] === ".tk-studio" ? dflt : t;
};
/** Story 34.8: the base config's asset layout (a missing, absolute or escaping value, the served root, or a path
 * under `.git` or `.tk-studio`: the default). */
export function assetsLayout(config: unknown): AssetsLayout {
  const a = config && typeof config === "object" ? (config as Record<string, unknown>).assets : undefined;
  const o = a && typeof a === "object" && !Array.isArray(a) ? a as Record<string, unknown> : {};
  return { manifest: layoutPath(o.manifest, DEFAULT_MANIFEST), art_path: layoutPath(o.art_path, DEFAULT_ART_PATH) };
}

/** The largest `ticks` `playable.py` accepts (int32). */
export const MAX_TICKS = 2147483647;
/** Story 34.3: the config's `playable` entry, validated (`playable is malformed: <field>` naming the first bad field). */
export function playableConfig(value: unknown): PlayableConfig {
  const bad = (field: string) => ({ skipped: `playable is malformed: ${field}` });
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad("playable");
  const v = value as Record<string, unknown>;
  const scenario = typeof v.scenario === "string" ? v.scenario.trim() : "";
  if (!scenario || isAbsolute(scenario) || /^[A-Za-z]:/.test(scenario) || scenario.split(/[\\/]/).includes("..")) return bad("scenario");
  if (typeof v.seed !== "number" || !Number.isSafeInteger(v.seed) || v.seed < 0) return bad("seed");
  // `playable.py` refuses ticks beyond int32.
  if (typeof v.ticks !== "number" || !Number.isSafeInteger(v.ticks) || v.ticks <= 0 || v.ticks > MAX_TICKS) return bad("ticks");
  return { scenario, seed: v.seed, ticks: v.ticks };
}

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
  // Story 34.3: the top-level `playable` entry, read from the same parsed base config (never the worktree).
  const cfg = config as Record<string, unknown>;
  return {
    command: host.trim(), argv, engine, ...("playable" in cfg ? { playable: playableConfig(cfg.playable) } : {}),
    // Story 34.8: the asset layout, only when the config names one (the leg falls back to the defaults).
    ...("assets" in cfg ? { assets: assetsLayout(cfg) } : {}),
  };
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
 * (both streams, whole lines). The files are fresh in a fresh folder and opened for writing, never for
 * appending (hole 77: MSYS bash cannot write to an append-only handle, `echo: write error: Bad file
 * descriptor`, so a bash `verify.host` lost every line of its own and exited by its closing echo). It records `{exit, signal}` or `{error}` (a spawn failure) in the status file. */
export const CAPTURE = [
  "const fs = require('fs'), cp = require('child_process');",
  "const s = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));",
  "const done = (r) => { fs.writeFileSync(s.status, JSON.stringify(r)); process.exit(0); };",
  "const fail = (e) => done({ error: String((e && e.message) || e) });",
  "let c;",
  "try { c = cp.spawn(s.argv[0], s.argv.slice(1), { cwd: s.cwd, stdio: ['ignore', fs.openSync(s.out, 'w'), fs.openSync(s.err, 'w')], windowsHide: true }); } catch (e) { fail(e); }",
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
async function runStep(
  argv: string[], cwd: string, env: Record<string, string | undefined>, guardS: number, deps: Deps, sink?: { stdout?: string },
): Promise<StepOutcome> {
  const started = Date.now();
  const out = (r: { exit: number | null; signal?: string; guard?: string; error?: string; stdout?: string; stderr?: string }): StepOutcome => {
    // Story 34.3: the whole stdout for a caller that reads a status block from it (never on the event).
    if (sink) sink.stdout = r.stdout ?? "";
    return {
      exit: r.exit, duration_ms: Date.now() - started,
      ...(r.signal ? { signal: r.signal } : {}), ...(r.guard ? { guard: r.guard } : {}), ...(r.error ? { error: r.error } : {}),
      stdout_tail: tail(r.stdout ?? ""), stderr_tail: tail(r.stderr ?? ""),
    };
  };
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
 * green, `verify.engine` the same way with the folder of `GODOT` first on PATH, under the full guard again;
 * then (Story 34.3), when the engine gate is green, the playable step (`playable.py run`, the media copy, the
 * judge). Never throws. */
export async function hostVerify(run: Run, guardS: number, deps: Deps = {}, opts: { slice?: boolean } = {}): Promise<HostVerifyResult> {
  const startedAt = new Date().toISOString();
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
  // Story 34.8: the assets step (a slice run only), after a green host command, before the engine gate.
  let assets: AssetsStep | undefined;
  if (opts.slice) {
    const layout = cmd.assets ?? assetsLayout(undefined);
    if (!stepGreen(host)) assets = { verdict: "skipped", reason: "verify.host red", steps: [] };
    else assets = await assetsStep(layout, cwd, env, guardS, deps);
  }
  // Story 34.1: the engine gate. `GODOT` from the leg's env; its folder first on the step's PATH (one key).
  // Only an absolute `GODOT`: a bare or relative one (`godot`, `godot.exe`) has `.` for its folder, which would
  // put the worktree first, so a binary the run committed could shadow the gate; then PATH is left unchanged.
  const godot = (deps.env ?? process.env).GODOT;
  const godotDir = typeof godot === "string" && godot.trim() && isAbsolute(godot.trim()) ? dirname(godot.trim()) : null;
  let engine: EngineStep;
  if (!stepGreen(host)) engine = { verdict: "skipped", reason: "verify.host red", godot_dir: godotDir };
  else if (assets?.verdict === "red") engine = { verdict: "skipped", reason: "assets red", godot_dir: godotDir };
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
  // Story 34.3: the playable-verify step, only after a green engine gate.
  let playable: PlayableStep;
  if (!cmd.playable) playable = { verdict: "skipped", reason: NO_PLAYABLE };
  else if ("skipped" in cmd.playable) playable = { verdict: "skipped", reason: cmd.playable.skipped };
  else if (engine.verdict !== "green") playable = { verdict: "skipped", reason: "engine gate not green" };
  else playable = await playableStep(run, cmd.playable, cwd, env, guardS, deps, opts.slice === true);
  return {
    command: cmd.command, argv: cmd.argv, cwd, exit: host.exit, duration_ms: host.duration_ms, started_at: startedAt, ...(gitBash ? { git_bash: gitBash } : {}), ...(resolved ? { resolved } : {}),
    ...(host.signal ? { signal: host.signal } : {}), ...(host.guard ? { guard: host.guard } : {}), ...(host.error ? { error: host.error } : {}),
    green: stepGreen(host) && assets?.verdict !== "red" && engine.verdict !== "red" && playable.verdict !== "fail",
    stdout_tail: host.stdout_tail, stderr_tail: host.stderr_tail, engine, playable, ...(assets ? { assets } : {}),
  };
}

/** Story 34.8: the ladder's verbs in order; never `generate`, never `--mirror`. */
export const ASSET_VERBS = ["check", "greybox", "match"] as const;

/** Story 34.8: the assets step (see the header). Never throws. */
async function assetsStep(
  layout: AssetsLayout, cwd: string, env: Record<string, string | undefined>, guardS: number, deps: Deps,
): Promise<AssetsStep> {
  const where = { manifest: layout.manifest, art_path: layout.art_path };
  if (!existsSync(join(cwd, layout.manifest))) return { verdict: "skipped", reason: "no manifest", ...where, steps: [] };
  let script: string;
  try { script = join(pluginRoot(deps.env ?? process.env), "lib", "assets.py"); }
  catch (e) { return { verdict: "red", reason: `assets.py not found: ${clip(message(e))}`, ...where, steps: [] }; }
  const steps: AssetsStepRun[] = [];
  for (const verb of ASSET_VERBS) {
    const argv = ["uv", "run", script, verb, "--directory", cwd, "--manifest", layout.manifest, "--art-path", layout.art_path];
    const sink: { stdout?: string } = {};
    const o = await runStep(argv, cwd, { ...env, PYTHONIOENCODING: "utf-8" }, guardS, deps, sink);
    const block = lastJsonObject(sink.stdout ?? "") as Record<string, unknown> | null;
    const fault = verb === "match" && o.exit === 1 && !o.guard && !o.error;
    const status = fault ? "fault" : typeof block?.status === "string" ? block.status : "error";
    steps.push({
      verb, exit: o.exit, status, duration_ms: o.duration_ms,
      ...(o.stdout_tail.length ? { stdout_tail: o.stdout_tail } : {}), ...(o.stderr_tail.length ? { stderr_tail: o.stderr_tail } : {}),
    });
    if (stepGreen(o) || fault) continue;
    const how = o.guard ? `timed out (${o.guard})` : o.error ? `failed to start: ${o.error}` : `exited ${o.exit}`;
    const why = typeof block?.reason === "string" && block.reason ? `: ${clip(block.reason)}` : "";
    return { verdict: "red", reason: `assets.py ${verb} ${how}${why}`, ...where, steps };
  }
  return { verdict: "green", ...where, steps };
}

/** Story 34.3: the skip reason of a project whose config declares no `playable`. */
export const NO_PLAYABLE = "no playable";
/** Story 34.3: the judge's skill, and the route leg (with its default) that picks its model and effort. */
export const PLAYABLE_JUDGE_SKILL = "tk-studio-playable-judge";
export const PLAYABLE_LEG = "playable-verify";
export const PLAYABLE_LEG_DEFAULT = { model: "claude-sonnet-5", effort: "medium" } as const;
/** The media files `playable.py` writes and the leg copies into the worktree for the judge. */
const MEDIA = ["report.json", "log.txt", "frames", "contact-sheet.png"];
/** Story 34.8: the contact sheet `playable.py sheet` writes beside the report (slice runs only). */
export const CONTACT_SHEET = "contact-sheet.png";
/** Story 34.8: each slice leg's own copy of its sheet, under the store (never copied with the media). */
const SHEETS_DIR = "sheets";
let sheetSeq = 0;

/** The judge's fixed rubric ids: a `judge.json` finding naming any other is refused. */
export const PLAYABLE_RUBRIC = ["scene-loaded", "player-visible", "no-magenta-or-error-overlay", "hud-reads", "moments-shown"] as const;

/** The default judge: `invokeSkill` with the sandbox pinned first (`sbx run -d --name <sb>`), so a re-run on an
 * ended run (its sandbox stopped) never `sbx exec`s into a stopped sandbox; a pin failure is a `blocked` block. */
const defaultJudge = (deps: Deps): PlayableJudge => (root, args) =>
  invokeSkill(root, PLAYABLE_JUDGE_SKILL, args, deps.spawner ?? runProcess, {
    vmHostRoot: root,
    pin: (sb) => pinSandbox(sb, { ...(deps.env ? { env: deps.env } : {}), ...(deps.sbx ?? {}) }),
  });
const defaultRoute: PlayableRoute = async (root, projectId) => {
  // Loaded on use: registry.ts reaches this module through office.ts and board.ts.
  const { resolveRoute } = await import("./registry");
  return resolveRoute(root, projectId);
};

/** The `playable-verify` leg's `{model, effort}` from the project's route, or the shipped default (a route without
 * the leg, an older served project, or an unresolvable route). Never throws. */
async function judgeRoute(run: Run, deps: Deps): Promise<{ model: string; effort: string }> {
  try {
    const route = await (deps.route ?? defaultRoute)(run.root, run.project_id ?? basename(run.root));
    const leg = route?.[PLAYABLE_LEG] as Record<string, unknown> | undefined;
    if (!leg || typeof leg !== "object") return { ...PLAYABLE_LEG_DEFAULT };
    return {
      model: typeof leg.model === "string" && leg.model ? leg.model : PLAYABLE_LEG_DEFAULT.model,
      effort: typeof leg.effort === "string" && leg.effort ? leg.effort : PLAYABLE_LEG_DEFAULT.effort,
    };
  } catch { return { ...PLAYABLE_LEG_DEFAULT }; }
}

const readJson = (path: string): Record<string, unknown> | undefined => {
  try {
    const v = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  } catch { return undefined; }
};

/** Copy the store's media into the worktree's media folder: built beside it, then renamed into place (the judge
 * never sees a half-copied folder), any earlier copy (and its `judge.json`) removed first. */
function copyMedia(store: string, media: string): void {
  rmSync(media, { recursive: true, force: true });
  mkdirSync(dirname(media), { recursive: true });
  const tmp = `${media}.tk-studio-${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    for (const name of MEDIA) {
      const from = join(store, name);
      if (existsSync(from)) cpSync(from, join(tmp, name), { recursive: true });
    }
    renameSync(tmp, media);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Story 34.3: run `playable.py`, copy its media, drive the judge. Every non-pass is `fail`. Never throws. */
async function playableStep(
  run: Run, cfg: { scenario: string; seed: number; ticks: number }, cwd: string, env: Record<string, string | undefined>,
  guardS: number, deps: Deps, slice = false,
): Promise<PlayableStep> {
  const legEnv = deps.env ?? process.env;
  const engineId = run.engine_run_id ?? "";
  if (!engineId) return { verdict: "fail", reason: "no engine run id: the media has no worktree folder" };
  let script: string;
  try { script = join(pluginRoot(legEnv), "lib", "playable.py"); }
  catch (e) { return { verdict: "fail", reason: `playable.py not found: ${clip(message(e))}` }; }
  const store = run.studio_run_id
    ? join(studioRunDir({ project_id: run.project_id ?? null, root: run.root }, run.studio_run_id, legEnv), "playable")
    : join(studioHome(legEnv), "runs", engineId, "playable");
  const mediaRel = `.bmad-loop/runs/${engineId}/playable`;
  const media = join(cwd, ".bmad-loop", "runs", engineId, "playable");
  const wallClock = Math.min(Math.max(1, guardS), 86400);
  const argv = ["uv", "run", script, "run", "--directory", cwd, "--scenario", join(cwd, cfg.scenario),
    "--seed", String(cfg.seed), "--ticks", String(cfg.ticks), "--out", store, "--wall-clock", String(wallClock)];
  try { mkdirSync(store, { recursive: true }); }
  catch (e) { return { verdict: "fail", reason: `playable store: ${clip(message(e))}`, store }; }
  const sink: { stdout?: string } = {};
  const step = await runStep(argv, cwd, { ...env, PYTHONIOENCODING: "utf-8" }, guardS, deps, sink);
  const block = lastJsonObject(sink.stdout ?? "") as Record<string, unknown> | null;
  const base: PlayableStep = {
    verdict: "fail", exit: step.exit, duration_ms: step.duration_ms, store,
    ...(typeof block?.status === "string" ? { status: block.status } : {}),
    ...(block && block.failed != null ? { failed: block.failed } : {}),
  };
  if (step.guard) return { ...base, reason: `playable.py timed out (${step.guard})` };
  if (step.error) return { ...base, reason: `playable.py failed to start: ${step.error}` };
  const lastLine = () => clip([...step.stderr_tail, ...step.stdout_tail].at(-1) ?? "(no output)");
  if (step.exit === 2) {
    return { ...base, reason: `playable.py refused: ${typeof block?.reason === "string" && block.reason ? clip(block.reason) : lastLine()}` };
  }
  if (step.exit !== 0 && step.exit !== 1) return { ...base, reason: `playable.py exited ${step.exit}: ${lastLine()}` };
  const report = readJson(join(store, "report.json"));
  const frameList = Array.isArray(report?.frames)
    ? (report!.frames as unknown[]).flatMap((f) => (f && typeof f === "object" && typeof (f as any).file === "string" ? [(f as any).file as string] : []))
    : [];
  const frames = frameList.map((f) => join(store, f));
  let withFrames: PlayableStep = { ...base, ...(frames.length ? { frames } : {}) };
  if (!report) return { ...withFrames, reason: `playable.py exited ${step.exit} with no readable report.json` };
  // Story 34.8: the contact sheet (a slice run only), written into the store before the media copy. A sheet that
  // fails is left out (no `contact_sheet`), never a verdict.
  if (slice && frames.length) {
    const sheetPath = join(store, CONTACT_SHEET);
    try { rmSync(sheetPath, { force: true }); } catch { /* an earlier sheet: overwritten or left out below */ }
    const sheetSink: { stdout?: string } = {};
    const sheet = await runStep(["uv", "run", script, "sheet", "--frames", join(store, "frames"), "--out", sheetPath],
      cwd, { ...env, PYTHONIOENCODING: "utf-8" }, guardS, deps, sheetSink);
    const made = lastJsonObject(sheetSink.stdout ?? "") as Record<string, unknown> | null;
    if (sheet.exit === 0 && existsSync(sheetPath)) {
      const sampled = Array.isArray(made?.frames) ? (made!.frames as unknown[]).filter((f): f is string => typeof f === "string") : [];
      // The store is per run and every leg of it writes the same `contact-sheet.png`: the sheet recorded is this
      // leg's own copy under `<store>/sheets/`, so an earlier story's verdicts never embed a later leg's sheet.
      let legSheet = sheetPath;
      try {
        const own = join(store, SHEETS_DIR, `${Date.now()}-${process.pid}-${++sheetSeq}.png`);
        mkdirSync(dirname(own), { recursive: true });
        copyFileSync(sheetPath, own);
        legSheet = own;
      } catch { /* the shared sheet, as before */ }
      withFrames = { ...withFrames, contact_sheet: legSheet, sampled };
    }
  }
  // The harness-fail branch is decided before the copy: there the copy is best-effort (a failed one never masks the
  // `harness: <invariant>` finding); on the judge path it is required.
  const harnessFail = step.exit === 1 || report.verdict !== "pass";
  let copyError: string | undefined;
  try { copyMedia(store, media); }
  catch (e) { copyError = clip(message(e)); }
  if (copyError && !harnessFail) return { ...withFrames, reason: `media copy: ${copyError}` };
  const withMedia: PlayableStep = copyError ? withFrames : { ...withFrames, media };
  if (harnessFail) {
    // A harness fail: one finding naming the failing invariant (and the failing tick's frame, when captured).
    const failed = (report.failed ?? block?.failed ?? {}) as Record<string, unknown>;
    const tick = failed.tick;
    const frame = typeof tick === "number"
      ? ((report.frames as any[] | undefined)?.find((f) => f && f.tick === tick)?.file ?? null) : null;
    const invariant = typeof failed.invariant === "string" && failed.invariant ? failed.invariant : "unknown";
    const note = typeof failed.detail === "string" && failed.detail ? clip(failed.detail) : undefined;
    const reason = step.exit === 0 ? `playable.py exited 0 but report.json verdict is ${JSON.stringify(report.verdict)}` : undefined;
    return { ...withMedia, ...(reason ? { reason } : {}), findings: [{ frame, rubric: `harness: ${invariant}`, ...(note ? { note } : {}) }] };
  }
  // The judge: a routed `claude -p` session on the project's sandbox tier over the worktree's media copy only.
  const { model, effort } = await judgeRoute(run, deps);
  const judgeBase: PlayableJudgeOutcome = { status: "blocked", model, effort };
  const sandbox = typeof run.sandbox === "string" ? run.sandbox.trim() : "";
  if (!sandbox) return { ...withMedia, judge: judgeBase, reason: "judge: no sandbox recorded for the run" };
  let res: Record<string, unknown>;
  try {
    res = await (deps.judge ?? defaultJudge(deps))(cwd, { tier: "sbx", sandbox, model, effort, timeout_s: guardS, payload: { media: mediaRel } });
  } catch (e) { return { ...withMedia, judge: judgeBase, reason: `judge: ${clip(message(e))}` }; }
  const cost = typeof res?.total_cost_usd === "number" && Number.isFinite(res.total_cost_usd) && res.total_cost_usd >= 0 ? res.total_cost_usd : undefined;
  const sb = res?.status_block as Record<string, unknown> | undefined;
  const status = typeof sb?.status === "string" ? sb.status : "failed";
  const judge: PlayableJudgeOutcome = { status, ...(cost !== undefined ? { cost_usd: cost } : {}), model, effort };
  if (!sb) return { ...withMedia, judge, reason: `judge: ${clip(String(res?.conformance_failure ?? "no status block"))}` };
  if (status !== "complete") return { ...withMedia, judge, reason: `judge: ${status}: ${clip(String(sb.reason ?? "no reason"))}` };
  // The host re-validates `judge.json` (never trusts the session's own check): a `pass|fail` verdict, every finding
  // on a fixed rubric id and a frame of `report.json`'s `frames[]`, a `fail` with at least one finding.
  const judged = readJson(join(media, "judge.json"));
  const verdict = judged?.verdict;
  if (verdict !== "pass" && verdict !== "fail") return { ...withMedia, judge, reason: "judge: no readable judge.json verdict" };
  judge.verdict = verdict;
  const rawFindings = judged!.findings === undefined ? [] : judged!.findings;
  if (!Array.isArray(rawFindings)) return { ...withMedia, judge, reason: "judge: judge.json findings is not a list" };
  const findings: PlayableFinding[] = [];
  for (const [i, f] of (rawFindings as unknown[]).entries()) {
    const x = f && typeof f === "object" && !Array.isArray(f) ? f as Record<string, unknown> : undefined;
    if (!x) return { ...withMedia, judge, reason: `judge: finding ${i} is not an object` };
    if (typeof x.rubric !== "string" || !(PLAYABLE_RUBRIC as readonly string[]).includes(x.rubric)) {
      return { ...withMedia, judge, reason: `judge: finding ${i} names an unknown rubric ${clip(JSON.stringify(x.rubric ?? null), 80)}` };
    }
    if (typeof x.frame !== "string" || !frameList.includes(x.frame)) {
      return { ...withMedia, judge, reason: `judge: finding ${i} names a frame not in report.json ${clip(JSON.stringify(x.frame ?? null), 120)}` };
    }
    findings.push({ frame: x.frame, rubric: x.rubric, ...(typeof x.note === "string" && x.note ? { note: clip(x.note) } : {}) });
  }
  if (verdict === "fail" && !findings.length) return { ...withMedia, judge, reason: "judge: a fail with no findings" };
  if (verdict === "pass") return { ...withMedia, verdict: "pass", judge, ...(findings.length ? { findings } : {}) };
  return { ...withMedia, judge, findings };
}

/** Is this result a red verify (it ran and was not green)? */
export const isRed = (v: HostVerifyResult | undefined): v is HostVerifyRan => !!v && !v.skipped && !v.green;

/** The red run's reason (`<how>`: exited <n>, timed out (<guard>), failed to start: <error>, or killed by <signal>):
 * ``host verify red: `<command>` <how>; last lines: <the last 5 stderr lines, else
 * stdout, joined " | ">``. */
export function redReason(v: HostVerifyRan): string {
  // Story 34.8: a green host command with a red assets step names the step's reason.
  if (v.assets?.verdict === "red" && v.exit === 0 && !v.guard && !v.error) return `host verify red (assets): ${v.assets.reason ?? "red"}`;
  // Story 34.3: a green host and engine with a failed playable step names its first finding, else its reason.
  const p = v.playable?.verdict === "fail" && v.exit === 0 && !v.guard && !v.error && v.engine?.verdict !== "red" ? v.playable : undefined;
  if (p) {
    const f = p.findings?.[0];
    const what = f ? `${f.rubric}${f.frame ? ` at ${f.frame}` : ""}${f.note ? `: ${f.note}` : ""}` : p.reason ?? "fail";
    return `host verify red (playable): ${what}`;
  }
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
 * fenced the same way. Story 34.3: then one `Playable: pass | fail | skipped (<reason>)` line (none on a leg
 * recorded before 34.3, nor for a project without `playable`: its section unchanged); on fail the reason, the
 * findings and every frame's store path. */
/** Story 34.8: the proof the close-out committed on a slice run: the contact sheet's web URL at the head commit
 * (absent when origin's web URL is unknown or no sheet was made) and the committed frame paths (repo-relative). */
export type PrProof = { sheetUrl?: string; frames: string[] };

/** Story 35.1: one host leg of a run in the PR body's `Legs:` line — the close-out's leg, or a re-run (`by`). */
export type LegHistoryEntry = { leg: "close-out" | "re-run"; verdict: "green" | "red" | "skipped"; recorded_at: string; by?: "api" | "cli" };

/** Story 35.1: a leg's verdict word. */
export const legVerdict = (v: HostVerifyResult): LegHistoryEntry["verdict"] => (v.skipped ? "skipped" : v.green ? "green" : "red");

/** Story 35.1: the run's legs, oldest first: its `host-verify` events after its latest `launched` (the `recordedVerify`
 * rule; a `rerun` member makes a re-run, its `by` kept), plus `current`, the one being written (not yet an event). */
export function legHistory(events: readonly QueueEvent[], current?: LegHistoryEntry): LegHistoryEntry[] {
  const from = events.findLastIndex((e) => e.kind === "launched");
  const legs: LegHistoryEntry[] = [];
  for (const e of events.slice(from + 1)) {
    if (e.kind !== "host-verify" || !e.detail || typeof e.detail !== "object") continue;
    const d = e.detail as Record<string, any>;
    const verdict = d.skipped === true ? "skipped" : d.green === true ? "green" : "red";
    const rerun = d.rerun && typeof d.rerun === "object" ? d.rerun as Record<string, unknown> : undefined;
    const by = rerun?.by === "api" || rerun?.by === "cli" ? rerun.by : undefined;
    legs.push(rerun ? { leg: "re-run", verdict, recorded_at: e.at, ...(by ? { by } : {}) } : { leg: "close-out", verdict, recorded_at: e.at });
  }
  return current ? [...legs, current] : legs;
}

/** Story 35.1: the `Legs: <k> — …` line (entries oldest first, joined by `; `). */
export const legsLine = (legs: readonly LegHistoryEntry[]): string =>
  `Legs: ${legs.length} — ${legs.map((l) => `${l.leg} ${l.verdict} ${l.recorded_at}${l.leg === "re-run" && l.by ? ` (by ${l.by})` : ""}`).join("; ")}`;

/** Story 35.1: `legs` (the run's host legs, the latest last) renders the `Legs:` history as the first line under the
 * heading, then the latest leg's section as before; none (or an empty list) leaves the section unchanged. */
export function prSection(v: HostVerifyResult, proof?: PrProof, legs?: readonly LegHistoryEntry[]): string[] {
  const head = ["## Host verify", "", ...(legs?.length ? [legsLine(legs), ""] : [])];
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
  // Story 34.3: then one `Playable: pass | fail | skipped (<reason>)` line; on fail the reason, the findings and
  // every store frame path (the worktree copy is removed with the worktree). A project without `playable` keeps
  // its section unchanged (no line for `no playable`).
  const p = v.playable;
  let playableLines: string[] = [];
  if (p?.verdict === "skipped" && p.reason === NO_PLAYABLE) playableLines = [];
  else if (p?.verdict === "skipped") playableLines = ["", `Playable: skipped (${p.reason})`];
  else if (p?.verdict === "pass") playableLines = ["", `Playable: pass${p.judge?.model ? ` (judge ${p.judge.model})` : ""}`];
  else if (p) {
    playableLines = ["", "Playable: fail", ...(p.reason ? ["", `Reason: ${p.reason}`] : [])];
    if (p.findings?.length) playableLines.push("", "Findings:", "", ...p.findings.map((f) =>
      `- \`${f.frame ?? "(no frame)"}\` — ${f.rubric}${f.note ? `: ${f.note}` : ""}`));
    // Story 34.8: the store paths unless the proof lists committed frames (a failed sheet commits none).
    if (p.frames?.length && !proof?.frames.length) playableLines.push("", "Frames:", "", ...p.frames.map((f) => `- \`${f}\``));
  }
  // Story 34.8: a slice run's committed proof, on pass and fail alike: the contact sheet embedded, the frames listed.
  if (proof) {
    if (proof.sheetUrl) playableLines.push("", `![contact sheet](${proof.sheetUrl})`);
    if (proof.frames.length) playableLines.push("", "Frames:", "", ...proof.frames.map((f) => `- \`${f}\``));
  }
  // Story 34.8: the assets step's line (a slice run only).
  const a = v.assets;
  const assetLines = !a ? [] : [a.verdict === "green" ? "Assets: green" : `Assets: ${a.verdict} (${a.reason ?? "no reason"})`, ""];
  let engineLines: string[];
  if (e.verdict === "skipped") engineLines = [`Engine gate: skipped (${e.reason})`];
  else if (e.verdict === "green") engineLines = [`Engine gate: green: \`${e.command}\` (${secs(e.duration_ms ?? 0)})`];
  else engineLines = ["Engine gate: red", "", `**Red:** \`${e.command}\` — ${how(e)} (${secs(e.duration_ms ?? 0)})`, "",
    ...fence("engine stderr (last lines)", e.stderr_tail ?? []), ...fence("engine stdout (last lines)", e.stdout_tail ?? [])].slice(0, -1);
  return [...head, ...hostLines, "", ...assetLines, ...engineLines, ...playableLines];
}
