/**
 * closeout.ts — a paused run whose story landed is closed out by the service (Story 27.3).
 *
 *   the pass   `closeOutPaused`, after every `sweepEngines` (recover, drain, run): each `paused` launch run
 *              (worktree and engine recorded) has the story its engine paused on read from its latest
 *              `paused` event (`engine.paused_story_key`, carried by `engineStatus`), and that story's spec
 *              found in the worktree (`_bmad-output/implementation-artifacts/spec-<key>.md`, else the single
 *              match of `_bmad-output/specs/<any>/stories/<key>-*.md`; only the frontmatter `status` and
 *              `reconcile_verdict` are read). Six outcomes:
 *                - Story 33.6, checked first among the stories that did not land: a stale render view (hole 65) —
 *                  paused at stage `escalation` on `CRITICAL escalation from dev session`, the reason quoting a
 *                  renderer message (`corrupt existing generation`, `generation contains unexpected or missing
 *                  files`, `failed to verify`, `generation output hash mismatch`) or `render_skill.py` and naming
 *                  exactly one snapshot folder `_bmad/render/<skill>/<slug>/<generation>` (any prefix, any
 *                  separator) that resolves under `<served root>/_bmad/render/`, the story's spec `status:
 *                  blocked` and untracked (`git -C <served root> ls-files --error-unmatch` exits 1), and the host
 *                  sees the folder complete (`manifest.json`'s `outputs` non-empty, each a non-empty regular file;
 *                  no hashes compared). Once per story (no `auto-resume` with `attempt: 1` for its key, under any
 *                  engine run id): under the lease the folder is renamed aside (`<generation>.stale-<pid>-<ms>`),
 *                  the draft removed (a failure renames the folder back), the aside folder removed best effort, the run resumed
 *                  (`PausedDeps.resume`, default `resumePaused`; a `ResumeRefused` is recorded, never thrown), one
 *                  `auto-resume {reason: "stale-render-view", snapshot, story_key, engine_run_id, attempt: 1,
 *                  resumed, notify}` (`error` on a refusal) and one notifier line; a removal that fails records
 *                  nothing and the next pass retries. A second such pause of the story: one `auto-resume
 *                  {…, attempt: 2, resumed: false, first_at}` and one line per pause, nothing removed or resumed,
 *                  then the 31.5 block below as before;
 *                - landed (spec `status: done`, paused at the commit gate or on an escalation) with a closable
 *                  verdict (any non-empty `reconcile_verdict` other than `escalate`): closed out — the harvest
 *                  commit, the meter harvest, the archive, the relaunch (below);
 *                - landed with no verdict, or `escalate`: left `paused` for a human — one `awaiting-ruling`
 *                  event and one notification per (story key, engine run id); the page says "awaiting a
 *                  ruling"; Story 31.5: for a project with a `planning.jira` binding (`planning.jira.project_key`
 *                  in the run root's `.tk-studio/config.yaml`) the pass also runs `uv run <plugin>/lib/track.py
 *                  block --directory <root> --story <key> --reason <the landing's reason> --resolves "a ruling in
 *                  the spec (<spec path>)" --source run` on the host, once per (story key, engine run id): its
 *                  answer (`ok`, or a by-name `blocked`) is one `track-block` event `{story_key, engine_run_id, ok,
 *                  status, reason, issues}`; a transient failure (the runner throws, no JSON answer, or the
 *                  core's `retry: true` — a 429, a 5xx or the site unreachable, `partial` with `ok: false`)
 *                  records nothing and the next pass calls it again. No binding: no call, nothing recorded.
 *                  bmad-loop fires no escalation hook, so this pass is the block's one caller (DRIFT, contract
 *                  0.1.26);
 *                - a story that did not land whose spec's frontmatter `status` is exactly `blocked` (a dev
 *                  session's `blocked` end, Story 31.5): for a bound project the same `track.py block` call and
 *                  `track-block` record, once per (story key, engine run id) since the latest `paused`, the
 *                  `--reason` the spec's last `Blocking condition:` line (clipped; "dev session ended blocked"
 *                  when absent or `none`); no `awaiting-ruling` event, no notification, the run left `paused`;
 *                - a story that did not land, paused at stage `escalation`, whose spec is found and is neither
 *                  `done` nor `blocked` (an engine-raised escalation awaiting a ruling, Story 31.5): the same
 *                  block, call and record, once per (story key, engine run id) since the latest `paused`, the
 *                  `--reason` the `paused` event's engine `paused_reason` (clipped; "story escalated: awaiting a
 *                  ruling" when empty); no `awaiting-ruling` event, no notification, the run left `paused` for
 *                  `POST /runs/{id}/resume`;
 *                - anything else (no story key, no spec, a spec not done at another paused stage): nothing is
 *                  done — the run stays `paused` for `POST /runs/{id}/resume` (`resumePaused`).
 *              The pass takes the run as the sweep does (`Queue.takeForCloseOut`, released after), so `serve`
 *              and a tick never close the same run out twice.
 *   close-out  in the run's kept worktree, on its `supervisor/run-<id>` branch, in this order, each step
 *              idempotent; a failed step leaves the run `paused` with one `close-out-failed` event per
 *              (step, error), never undoes a done step, and the next pass retries:
 *                1. commit   `git add -A` (never the engine's `.bmad-loop/runs` or `.bmad-loop/archive`, nor the
 *                            runtime `materialise` copied in, `COPIED_RUNTIME`), `git commit -m
 *                            "supervisor: close-out harvest for <key> (run <queue run id>, engine <engine run id>)"`
 *                            (argv only; a clean index, `git diff --cached --quiet` exit 0, is `nothing to commit`;
 *                            never `reset --soft`, a squash or a force-push);
 *                2. meter    `uv run <plugin>/lib/meter.py harvest --run-dir <worktree>/.bmad-loop/runs/<engine id>`
 *                            on the host (`{ok:false}` or a non-zero exit fails it; `harvested.json` markers
 *                            make it idempotent; a run dir already archived counts it done);
 *                3. archive  `bmad-loop archive --project <worktree> <engine id>` (never `--force`): on sbx
 *                            `sbx exec <sb> <VM HOME>/.local/bin/bmad-loop archive --project <VM worktree> <id>`,
 *                            HOME from `sbx exec <sb> printenv HOME`; a run dir already gone counts done;
 *                4. relaunch the epic rebuilt (`deps.relaunch`: `rebuildStarted`, a fresh session id), the run
 *                            moved `paused` → `running` with a `close-out` event `{story_key, verdict, commit,
 *                            meter, archive}` (`Queue.resumeFromPause`), then driven through `finishRun` with
 *                            the pinning recorder and `mirror` (the new `launched`). Nothing story-specific is
 *                            passed: `tk-studio-launch` skips done stories itself. The pin is never released here.
 *   resume     `resumePaused` (`POST /runs/{id}/resume`): a paused run whose story did not land —
 *              `bmad-loop resolve --project <worktree> --no-interactive --resume [--restore-patch <path>] <engine
 *              id>` (on sbx through `sbx exec`, the VM paths) spawned as the supervisor's own child (the engine's
 *              hold for the resume's life); the run `paused` → `running` with `engine-resume`; the engine pid
 *              re-read from `engine.pid` (`Queue.recordEnginePid`). When the child exits, the run is handed back
 *              to the engine-end sweep with a fresh `launched` event (the same engine id).
 *
 * Every command is argv only — never a shell.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import { notifier, sbxBin } from "./env";
import { canonicalPr, isWithin, notify, NOTICE_MAX_BYTES, sendText, TRUNCATED_MARKER, type EndNotice } from "./hygiene";
import { selfOwner, servedRoot, type Owner, type Queue, type QueueEvent, type QueueRun } from "./queue";
import { HOLD_TIMEOUT_S, parseEnginePid, sameStart, type HoldChild } from "./sandbox";
import { lastJsonObject, runProcess, toVmPath, type RunResult } from "./server";
import { COPIED_RUNTIME, meteredCost, runner, studioScript, uvRunner, type WorktreeDeps } from "./worktree";

type Env = Record<string, string | undefined>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Command output for an event: URL userinfo redacted, clipped. */
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
const failed = (r: RunResult) => `exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;

// ------------------------------------------------------------ the paused story and its spec

/** The paused stages AC1 closes out: the commit gate (a `pre_commit` veto escalates) or an escalation. */
export const CLOSABLE_STAGES = ["escalation", "pre_commit", "pre_commit_gate"] as const;

/** The story a paused run's engine paused on, from its latest `paused` event (`engine` detail). */
export function pausedStory(events: readonly QueueEvent[]): { story_key?: string; stage?: string; reason?: string } {
  const engine = (events.findLast((e) => e.kind === "paused")?.detail?.engine ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const key = str(engine.paused_story_key), stage = str(engine.paused_stage), reason = str(engine.paused_reason);
  return { ...(key ? { story_key: key } : {}), ...(stage ? { stage } : {}), ...(reason ? { reason } : {}) };
}

/** A markdown file's leading `---` frontmatter, parsed as YAML (`js-yaml`: comments, quotes, null/`~`, block
 * scalars as YAML reads them). `{}`: no frontmatter, unterminated, unparseable, or not a mapping. */
export function frontmatter(text: string): Record<string, unknown> {
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return {};
  try {
    const doc = loadYaml(lines.slice(1, end).join("\n"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  } catch { return {}; }
}

/** A frontmatter value as a trimmed non-empty string; anything else (null, `~`, empty, a number, a list) is missing. */
const fmString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isEscalate = (v: string | undefined): boolean => v?.toLowerCase() === "escalate";

/** A story's spec in the worktree (`reconcile.md` §1): `_bmad-output/implementation-artifacts/spec-<key>.md`,
 * else the single match of `_bmad-output/specs/<any>/stories/<key>-*.md`. Undefined: none, or several. */
export function findSpec(worktree: string, key: string): string | undefined {
  if (!key || /[\\/]/.test(key) || key.includes("..")) return undefined;
  const direct = join(worktree, "_bmad-output", "implementation-artifacts", `spec-${key}.md`);
  if (existsSync(direct)) return direct;
  const specs = join(worktree, "_bmad-output", "specs");
  const hits: string[] = [];
  let folders: string[] = [];
  try { folders = readdirSync(specs); } catch { return undefined; }
  for (const f of folders) {
    let names: string[] = [];
    try { names = readdirSync(join(specs, f, "stories")); } catch { continue; }
    for (const n of names) if (n.startsWith(`${key}-`) && n.endsWith(".md")) hits.push(join(specs, f, "stories", n));
  }
  return hits.length === 1 ? hits[0] : undefined;
}

/** What the pass does with a paused run (see the header). */
export type Landing =
  | { outcome: "close-out"; story_key: string; verdict: string; spec: string; stage: string }
  | { outcome: "awaiting-ruling"; story_key: string; reason: string; spec: string; stage: string }
  | { outcome: "not-landed"; why: string; story_key?: string };

/** A closable verdict: any non-empty string `reconcile_verdict` other than `escalate` (any case, trimmed).
 * Null, `~`, empty, or not a string: no verdict. */
export const closableVerdict = (v: unknown): boolean => { const s = fmString(v); return !!s && !isEscalate(s); };

/** The spec's frontmatter of the story a paused run stopped on; undefined when there is no key or no spec. */
function storySpec(run: Pick<QueueRun, "worktree" | "prefix">, events: readonly QueueEvent[]): { key?: string; stage?: string; spec?: string; fm?: Record<string, unknown> } {
  const { story_key: key, stage } = pausedStory(events);
  if (!key || !run.worktree) return { ...(key ? { key } : {}), ...(stage ? { stage } : {}) };
  const spec = findSpec(servedRoot(run)!, key); // Story 28.5: the project's specs, at its served root
  if (!spec) return { key, ...(stage ? { stage } : {}) };
  let fm: Record<string, unknown> = {};
  try { fm = frontmatter(readFileSync(spec, "utf-8")); } catch { /* unreadable: no frontmatter */ }
  return { key, ...(stage ? { stage } : {}), spec, fm };
}

/** The pass's ruling on one paused run (reads only). */
export function landing(run: Pick<QueueRun, "worktree" | "prefix">, events: readonly QueueEvent[]): Landing {
  const { key, stage, spec, fm } = storySpec(run, events);
  if (!key) return { outcome: "not-landed", why: "no paused story key" };
  if (!spec || !fm) return { outcome: "not-landed", story_key: key, why: `no spec found for story ${key}` };
  const status = fmString(fm.status);
  if (status !== "done") return { outcome: "not-landed", story_key: key, why: `story ${key}'s spec is '${status ?? "no status"}', not done` };
  if (!stage || !(CLOSABLE_STAGES as readonly string[]).includes(stage)) {
    return { outcome: "not-landed", story_key: key, why: `paused at stage '${stage ?? "unknown"}': not the commit gate or an escalation` };
  }
  const verdict = fmString(fm.reconcile_verdict);
  if (closableVerdict(verdict)) return { outcome: "close-out", story_key: key, verdict: verdict!, spec, stage };
  return { outcome: "awaiting-ruling", story_key: key, spec, stage, reason: isEscalate(verdict) ? "reconcile_verdict: escalate" : "no reconcile_verdict recorded" };
}

/** Is the paused run's story landed (its spec `status: done`)? A resume never re-drives it. */
export function storyLanded(run: Pick<QueueRun, "worktree" | "prefix">, events: readonly QueueEvent[]): string | undefined {
  const { key, fm } = storySpec(run, events);
  return key && fmString(fm?.status) === "done" ? key : undefined;
}

// ------------------------------------------------------------ argv (argv only, no shell)

/** The harvest commit's named message. */
export const harvestMessage = (storyKey: string, runId: string, engineRunId: string): string =>
  `supervisor: close-out harvest for ${storyKey} (run ${runId}, engine ${engineRunId})`;

/** `sbx exec <sb> printenv HOME` (the VM home the bmad-loop binary lives under). */
export const homeArgv = (sb: string): string[] => ["exec", sb, "printenv", "HOME"];
/** The VM's bmad-loop (a non-login `sbx exec` does not carry `~/.local/bin` on PATH). */
export const vmBmadLoop = (home: string): string => `${home.replace(/\/+$/, "")}/.local/bin/bmad-loop`;
/** `bmad-loop archive --project <project> <engine id>` (never `--force`). */
export const archiveArgs = (project: string, engineRunId: string): string[] => ["archive", "--project", project, engineRunId];
/** `bmad-loop resolve --project <project> --no-interactive --resume [--restore-patch <path>] <engine id>`. */
export const resolveArgs = (project: string, engineRunId: string, restorePatch?: string): string[] =>
  ["resolve", "--project", project, "--no-interactive", "--resume", ...(restorePatch ? ["--restore-patch", restorePatch] : []), engineRunId];

// ------------------------------------------------------------ deps

export interface PausedDeps extends WorktreeDeps {
  /** The notifier's environment and HTTP client (default `env` above and the global `fetch`). */
  hygiene?: { env?: Env; fetch?: Fetch };
  /** The relaunch, in two stages: rebuild (may throw: a failed `relaunch` step, the run still paused),
   * then the drive it answers, run after the `close-out` move (`cli.ts` `relauncher`). */
  relaunch?: (queue: Queue, run: QueueRun) => Promise<() => Promise<unknown>>;
  /** This process (default `selfOwner()`). */
  self?: Owner;
  /** Story 33.6: the auto-resume's resume (default `resumePaused` under this process; throws `ResumeRefused`). */
  resume?: (queue: Queue, runId: string) => Promise<unknown>;
}

const envOf = (deps: WorktreeDeps): Env => deps.env ?? process.env;

/** An argv-only `sbx` call (the injected `sbx.run`, else `runProcess`). */
function sbxCall(deps: WorktreeDeps, args: string[], timeoutS: number): Promise<RunResult> {
  const bin = sbxBin(envOf(deps));
  return deps.sbx?.run ? deps.sbx.run(bin, args, { timeoutS }) : runProcess(bin, args, { timeoutS });
}

/** The VM home (`printenv HOME`), or throws naming the failure. */
async function vmHome(deps: WorktreeDeps, sb: string): Promise<string> {
  let r: RunResult;
  try { r = await sbxCall(deps, homeArgv(sb), 60); }
  catch (e) { throw new Error(`sbx exec ${sb} printenv HOME: ${clip(message(e))}`); }
  const home = r.stdout.trim();
  if (r.exit !== 0 || !home.startsWith("/")) throw new Error(`sbx exec ${sb} printenv HOME ${failed(r)}`);
  return home;
}

const sbxRun = (run: QueueRun): string | undefined => (run.tier === "sbx" && run.sandbox ? run.sandbox : undefined);

// ------------------------------------------------------------ the steps

type Step = { ok: true; value: unknown } | { ok: false; error: string };

/** The engine's runtime state (`.bmad-loop/runs`, `.bmad-loop/archive`) and the supervisor's own materialised
 * copies (`COPIED_RUNTIME`: policy, routing, the machine-local overlay), never staged by the harvest commit
 * (pathspec magic, argv only). Wildcarded (the last character bracketed): a literal pathspec naming a
 * gitignored path fails `git add` (exit 1). */
const ENGINE_STATE = [
  ":(exclude,glob).bmad-loop/run[s]/**", ":(exclude,glob).bmad-loop/archiv[e]/**",
  ...COPIED_RUNTIME.map((rel) => `:(exclude,glob)${rel.slice(0, -1)}[${rel.slice(-1)}]`),
];

/** A literal path as a `glob` pathspec fragment: its glob metacharacters (`*`, `?`, `[`, `]`, `\`) backslash-escaped. */
// Bracket classes, never backslash escapes: git on Windows reads a backslash in a pathspec as a
// path separator, so `apps/s\[u\]p/...` excluded nothing there and the engine state was committed
// (found by the win32 host gate, 2026-10-17; probed on the box: `[[]`, `[]]`, `[*]`, `[?]` match
// one literal character on both hosts). A literal backslash (never in a win32 path) is `[\\]`.
const globLiteral = (path: string): string =>
  path.replace(/[*?[\]\\]/g, (c) => (c === "\\" ? "[\\\\]" : `[${c}]`));

/** The engine-state excludes for a project at `prefix` below the worktree top (`""`: the top). The prefix is
 * the project's literal path, so a project folder named with a glob metacharacter still excludes only itself. */
export const engineState = (prefix?: string | null): string[] =>
  prefix ? ENGINE_STATE.map((p) => p.replace(":(exclude,glob)", () => `:(exclude,glob)${globLiteral(prefix)}`)) : ENGINE_STATE;

async function commitStep(run: QueueRun, key: string, deps: WorktreeDeps): Promise<Step> {
  const wt = run.worktree!, exec = runner(deps);
  const branch = `supervisor/run-${run.run_id}`;
  try {
    // Only ever on the run branch: a worktree checked out elsewhere (or detached) is never committed into.
    const at = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: wt, timeoutS: 30 });
    if (at.exit !== 0) return { ok: false, error: `git rev-parse --abbrev-ref HEAD ${failed(at)}` };
    const head = at.stdout.trim();
    if (head !== branch) return { ok: false, error: `the worktree is on '${clip(head || "?")}', not the run branch '${branch}'` };
    // Everything but the engine's runtime state (its run and archive dirs), whatever the project ignores.
    // Story 28.5: the engine state lies under the served root (`<prefix>`), so its excludes carry the prefix.
    const add = await exec("git", ["add", "-A", "--", ".", ...engineState(run.prefix)], { cwd: wt, timeoutS: 120 });
    if (add.exit !== 0) return { ok: false, error: `git add -A (excluding .bmad-loop/runs, .bmad-loop/archive, the copied runtime) ${failed(add)}` };
    // A clean index is `nothing to commit` by exit code (never git's localized wording).
    const diff = await exec("git", ["diff", "--cached", "--quiet"], { cwd: wt, timeoutS: 60 });
    if (diff.exit === 0) return { ok: true, value: "nothing to commit" };
    if (diff.exit !== 1) return { ok: false, error: `git diff --cached --quiet ${failed(diff)}` };
    const c = await exec("git", ["commit", "-m", harvestMessage(key, run.run_id, run.engine_run_id!)], { cwd: wt, timeoutS: 120 });
    if (c.exit !== 0) return { ok: false, error: `git commit ${failed(c)}` };
    const sha = await exec("git", ["rev-parse", "HEAD"], { cwd: wt, timeoutS: 30 });
    return { ok: true, value: sha.exit === 0 ? sha.stdout.trim() : "committed" };
  } catch (e) { return { ok: false, error: `git: ${clip(message(e))}` }; }
}

/** The engine run's dir under the root the run serves (Story 28.5: `<worktree>/<prefix>`). */
const runDirOf = (run: QueueRun) => join(servedRoot(run)!, ".bmad-loop", "runs", run.engine_run_id!);

async function meterStep(run: QueueRun, deps: WorktreeDeps): Promise<Step> {
  const dir = runDirOf(run);
  if (!existsSync(dir)) return { ok: true, value: "run dir already archived (harvested before the archive)" };
  let r: RunResult;
  try { r = await uvRunner(deps)(servedRoot(run)!, studioScript(deps, "lib", "meter.py"), ["harvest", "--run-dir", dir], 300); }
  catch (e) { return { ok: false, error: `meter.py harvest: ${clip(message(e))}` }; }
  const out = lastJsonObject(r.stdout) as Record<string, unknown> | null;
  if (r.exit !== 0 || !out || out.ok === false) {
    return { ok: false, error: `meter.py harvest ${out?.error ? clip(String(out.error)) : failed(r)}` };
  }
  return { ok: true, value: out };
}

async function archiveStep(run: QueueRun, deps: WorktreeDeps): Promise<Step> {
  if (!existsSync(runDirOf(run))) return { ok: true, value: "already archived" };
  const sb = sbxRun(run), id = run.engine_run_id!, served = servedRoot(run)!;
  try {
    let r: RunResult;
    if (sb) {
      const home = await vmHome(deps, sb);
      r = await sbxCall(deps, ["exec", sb, vmBmadLoop(home), ...archiveArgs(toVmPath(served), id)], 300);
    } else r = await runner(deps)("bmad-loop", archiveArgs(served, id), { cwd: served, timeoutS: 300 });
    return r.exit === 0 ? { ok: true, value: "archived" } : { ok: false, error: `bmad-loop archive ${failed(r)}` };
  } catch (e) { return { ok: false, error: `bmad-loop archive: ${clip(message(e))}` }; }
}

// ------------------------------------------------------------ the pass

/** One `close-out-failed` event per (step, error): a retry failing the same way records nothing new. Never throws
 * (a busy queue, or a run already ended: the next pass tries again). */
function noteFailed(queue: Queue, run: QueueRun, key: string, step: string, error: string): void {
  try {
    const seen = queue.events(run.run_id).some((e) => e.kind === "close-out-failed" && e.detail?.step === step && e.detail?.error === error);
    if (!seen) queue.note(run.run_id, "close-out-failed", { story_key: key, engine_run_id: run.engine_run_id, step, error });
  } catch { /* not recorded */ }
}

/** A relaunch drive that returned with the run still `running` and no new `launched`: never handed to an engine. */
export const NOT_HANDED = "the relaunch returned without handing the run to an engine (no `launched` after the `close-out`)";

/** Has the engine been handed the run since its latest move out of `paused` — a `launched` event after the
 * latest `close-out`/`engine-resume` (the restart rule's reading, `LAUNCHED_SQL`)? */
export function launchedSinceMove(events: readonly QueueEvent[]): boolean {
  const move = events.findLastIndex((e) => e.kind === "close-out" || e.kind === "engine-resume");
  return move >= 0 && events.slice(move + 1).some((e) => e.kind === "launched");
}

/** Back to `paused` after a relaunch or a resume that failed before its engine was handed the run (the latest
 * `paused` detail kept: its draft PR and the engine's paused story; the checkout lock put back as the paused
 * run held it, `Queue.returnToPause`). Answers whether it moved the run. */
function backToPaused(queue: Queue, runId: string, why: Record<string, string>): boolean {
  try {
    const cur = queue.get(runId);
    if (cur?.state !== "running") return false;
    const prev = (queue.events(runId).findLast((e) => e.kind === "paused")?.detail ?? {}) as Record<string, unknown>;
    const { lock_restored: _, relaunch_failed: _r, resume_failed: _s, ...kept } = prev;
    queue.returnToPause(runId, { ...kept, ...why });
    return true;
  } catch { return false; /* the queue is busy: `recover` handles a dead driver's run */ }
}

/** Story 27.5 (DW-15): the engine run about to be archived has its metered cost (`meteredCost`, its `run.json`)
 * recorded as an `accounted` event `{cost_usd, engine_run_id, source: "engine"}` — once per engine run, and only
 * while its run dir is still there — so the final close-out sums every engine iteration. Never throws. */
function noteEngineCost(queue: Queue, run: QueueRun): void {
  try {
    const cost = meteredCost(servedRoot(run)!, run.engine_run_id);
    if (cost === undefined) return;
    const seen = queue.events(run.run_id).some((e) => e.kind === "accounted" && e.detail?.source === "engine" && e.detail?.engine_run_id === run.engine_run_id);
    if (!seen) queue.note(run.run_id, "accounted", { cost_usd: cost, engine_run_id: run.engine_run_id, source: "engine" });
  } catch { /* not recorded: the final close-out reads the latest engine only */ }
}

async function closeOutLanded(queue: Queue, run: QueueRun, l: Extract<Landing, { outcome: "close-out" }>, deps: PausedDeps): Promise<boolean> {
  const key = l.story_key;
  const commit = await commitStep(run, key, deps);
  if (!commit.ok) { noteFailed(queue, run, key, "commit", commit.error); return false; }
  const meter = await meterStep(run, deps);
  if (!meter.ok) { noteFailed(queue, run, key, "meter", meter.error); return false; }
  noteEngineCost(queue, run);
  const archive = await archiveStep(run, deps);
  if (!archive.ok) { noteFailed(queue, run, key, "archive", archive.error); return false; }
  if (!deps.relaunch) { noteFailed(queue, run, key, "relaunch", "no relaunch driver"); return false; }
  let drive: () => Promise<unknown>;
  try { drive = await deps.relaunch(queue, run); }
  catch (e) { noteFailed(queue, run, key, "relaunch", clip(message(e))); return false; }
  try {
    queue.resumeFromPause(run.run_id, "close-out", {
      story_key: key, verdict: l.verdict, commit: commit.value, meter: meter.value, archive: archive.value,
    }, deps.self ?? selfOwner());
  } catch (e) { noteFailed(queue, run, key, "relaunch", clip(message(e))); return false; }
  let why: string | undefined;
  try { await drive(); }
  catch (e) { why = clip(message(e)); }
  try {
    // A drive that resolved having ended the run (`mirror`'s `endDriven`) or handed it to an engine is done.
    const cur = queue.get(run.run_id) ?? run;
    const handed = launchedSinceMove(queue.events(run.run_id));
    if (why === undefined && (cur.state !== "running" || handed)) return cur.state !== "paused";
    // The new engine already has the run (its `launched` after the `close-out`): it stays `running` for the
    // engine-end sweep; only a drive that failed (or returned) before that handoff goes back to `paused`.
    why ??= NOT_HANDED;
    noteFailed(queue, cur, key, "relaunch", why);
    if (!handed) backToPaused(queue, run.run_id, { relaunch_failed: why });
    return queue.get(run.run_id)?.state !== "paused";
  } catch { return false; /* the next pass reads the queue again */ }
}

/** AC2: one `awaiting-ruling` (story key, engine run id) recorded since the run's latest `paused` event — so a
 * fresh pause after a resume gets its own record and notification. */
export function rulingRecorded(events: readonly QueueEvent[], storyKey: string, engineRunId: string | null): boolean {
  const pause = events.findLastIndex((e) => e.kind === "paused");
  return events.slice(pause + 1).some((e) => e.kind === "awaiting-ruling" && e.detail?.story_key === storyKey && e.detail?.engine_run_id === engineRunId);
}

/** Story 31.5: a project root's `planning.jira` binding — a non-empty `planning.jira.project_key` in its tracked
 * `.tk-studio/config.yaml` (read only; any read or parse failure is "not bound"). */
export function jiraBound(root: string): boolean {
  try {
    const doc = loadYaml(readFileSync(join(root, ".tk-studio", "config.yaml"), "utf-8")) as Record<string, any> | null;
    const key = doc?.planning?.jira?.project_key;
    return (typeof key === "string" && key.trim() !== "") || typeof key === "number";
  } catch { return false; }
}

/** Story 31.5: one `track-block` (story key, engine run id) recorded since the run's latest `paused` event. */
export function trackRecorded(events: readonly QueueEvent[], storyKey: string, engineRunId: string | null): boolean {
  const pause = events.findLastIndex((e) => e.kind === "paused");
  return events.slice(pause + 1).some((e) => e.kind === "track-block" && e.detail?.story_key === storyKey && e.detail?.engine_run_id === engineRunId);
}

/** Story 31.7: the latest `track-block` event's detail recorded since the run's latest `paused` event (the block the
 * current pause owes), else undefined — the resolution pass finds a resolved issue's paused run by it (reads only). */
export function trackBlockSincePause(events: readonly QueueEvent[]): Record<string, unknown> | undefined {
  const pause = events.findLastIndex((e) => e.kind === "paused");
  return events.slice(pause + 1).findLast((e) => e.kind === "track-block")?.detail ?? undefined;
}

/** Story 31.5: what a block names — the story key, its spec (a path) and the reason. The awaiting-ruling path
 * and a dev session's `blocked` end share it. */
export interface BlockInput { story_key: string; spec: string; reason: string }

/** The `--reason` of a dev session's `blocked` end when its spec names none. */
export const DEV_BLOCKED_REASON = "dev session ended blocked";

/** The spec's last `Blocking condition:` line, clipped; undefined when absent, empty or `none`. */
export function blockingCondition(text: string): string | undefined {
  const hits = [...text.matchAll(/^[ \t>*-]*Blocking condition:[ \t]*(.*)$/gim)];
  const value = clip(hits.at(-1)?.[1] ?? "");
  return value && value.toLowerCase().replace(/[.\s]+$/, "") !== "none" ? value : undefined;
}

/** Story 31.5: the block owed by a paused run whose story did not land and whose spec's frontmatter `status` is
 * exactly `blocked` (a dev session's `blocked` end); undefined otherwise (reads only). */
export function devBlocked(run: Pick<QueueRun, "worktree" | "prefix">, events: readonly QueueEvent[]): BlockInput | undefined {
  const { key, spec, fm } = storySpec(run, events);
  if (!key || !spec || fm?.status !== "blocked") return undefined;
  let text = "";
  try { text = readFileSync(spec, "utf-8"); } catch { /* unreadable: the fallback reason */ }
  return { story_key: key, spec, reason: blockingCondition(text) ?? DEV_BLOCKED_REASON };
}

/** The `--reason` of an engine-raised escalation whose paused event names none. */
export const ESCALATION_BLOCKED_REASON = "story escalated: awaiting a ruling";

/** Story 31.5: the block owed by a run paused at stage `escalation` whose story did not land and whose spec is
 * neither `done` nor `blocked` (an engine-raised escalation awaiting a ruling): the latest `paused` event's engine
 * `paused_reason`, else `ESCALATION_BLOCKED_REASON`; undefined otherwise (reads only). A spec `blocked` is
 * `devBlocked`'s. */
export function escalationBlocked(run: Pick<QueueRun, "worktree" | "prefix">, events: readonly QueueEvent[]): BlockInput | undefined {
  const { key, stage, spec, fm } = storySpec(run, events);
  if (!key || !spec || stage !== "escalation") return undefined;
  const status = fmString(fm?.status);
  if (status === "done" || status === "blocked") return undefined;
  return { story_key: key, spec, reason: clip(pausedStory(events).reason ?? "") || ESCALATION_BLOCKED_REASON };
}

/** `track.py block` argv (argv only, no shell). */
export const trackArgs = (root: string, storyKey: string, reason: string, specPath: string): string[] =>
  ["block", "--directory", root, "--story", storyKey, "--reason", reason, "--resolves", `a ruling in the spec (${specPath})`, "--source", "run"];

/** Is a block still owed for this pause (a bound project, none recorded)? */
const trackOwed = (run: QueueRun, events: readonly QueueEvent[], storyKey: string): boolean =>
  jiraBound(run.root) && !trackRecorded(events, storyKey, run.engine_run_id);

/** Story 31.5: the block (see the header). Answers whether it recorded a `track-block`: only on `ok`, or a by-name
 * `blocked`; a `retry: true` answer (a temporary failure) is retried on the next pass. Never throws. */
async function trackBlock(queue: Queue, run: QueueRun, l: BlockInput, deps: PausedDeps): Promise<boolean> {
  try {
    if (!trackOwed(run, queue.events(run.run_id), l.story_key)) return false;
    const served = servedRoot(run);
    const spec = served ? relative(served, l.spec).split("\\").join("/") : l.spec;
    let r: RunResult;
    try { r = await uvRunner(deps)(run.root, studioScript(deps, "lib", "track.py"), trackArgs(run.root, l.story_key, l.reason, spec), 120); }
    catch { return false; /* transient: the next pass calls it again */ }
    const out = lastJsonObject(r.stdout) as Record<string, any> | null;
    if (!out || typeof out.status !== "string" || out.retry === true || (out.ok !== true && out.status !== "blocked")) return false; // transient
    const issues = Array.isArray(out.issues)
      ? out.issues.map((i: Record<string, unknown>) => ({ issue: i?.issue ?? null, role: i?.role ?? null, transitioned: i?.transitioned === true, commented: i?.commented === true }))
      : [];
    queue.note(run.run_id, "track-block", {
      story_key: l.story_key, engine_run_id: run.engine_run_id, ok: out.ok === true, status: out.status,
      reason: typeof out.reason === "string" ? clip(out.reason, 500) : null, issues,
    });
    return true;
  } catch { return false; }
}

/** AC2: one `awaiting-ruling` event, and one notification, per pause of (story key, engine run id); Story 31.5: then
 * the owed block, if any (its own record). Answers whether the ruling was newly recorded. */
async function awaitRuling(queue: Queue, run: QueueRun, l: Extract<Landing, { outcome: "awaiting-ruling" }>, deps: PausedDeps): Promise<boolean> {
  if (rulingRecorded(queue.events(run.run_id), l.story_key, run.engine_run_id)) { await trackBlock(queue, run, l, deps); return false; }
  const env = deps.hygiene?.env ?? envOf(deps);
  let outcome: Record<string, unknown>;
  try {
    const selected = notifier(env);
    if (selected.kind === "none") outcome = { ok: false, skipped: "no notifier configured (TK_SUPERVISOR_NOTIFY is unset)" };
    else {
      const pr = canonicalPr(queue.events(run.run_id).findLast((e) => e.kind === "paused")?.detail?.pr);
      const notice: EndNotice = {
        run_id: run.run_id, job_id: run.job_id, project_id: run.project_id, studio_run_id: run.studio_run_id, state: "paused",
        reason: `awaiting a ruling: story ${l.story_key} — ${l.reason}`, ...(pr ? { pr } : {}),
      };
      outcome = await notify(selected, notice, deps.hygiene?.fetch ?? fetch);
    }
  } catch (e) { outcome = { ok: false, error: clip(message(e)) }; }
  queue.note(run.run_id, "awaiting-ruling", { story_key: l.story_key, engine_run_id: run.engine_run_id, reason: l.reason, notify: outcome });
  await trackBlock(queue, run, l, deps);
  return true;
}

// ------------------------------------------------------------ Story 33.6: a stale render view (hole 65)

/** The `auto-resume` queue event, and its `reason`. */
export const AUTO_RESUME = "auto-resume";
export const STALE_RENDER_VIEW = "stale-render-view";
/** The prefix bmad-loop gives a dev session's CRITICAL escalation (`escalation.decide_dev`). */
export const DEV_ESCALATION = "CRITICAL escalation from dev session";
/** `render_skill.py` `_verify_existing`'s messages a stale view of an existing generation produces. */
export const RENDER_HALT_MESSAGES = [
  "corrupt existing generation", "generation contains unexpected or missing files", "failed to verify", "generation output hash mismatch",
] as const;
const NO_NOTIFIER = { ok: false, skipped: "no notifier configured (TK_SUPERVISOR_NOTIFY is unset)" };

/** `_bmad/render/<skill>/<slug>/<generation>`, any separator (a path running on to a file is cut to the folder), `_bmad`
 * at the start, after a separator or after any other character outside `[A-Za-z0-9_.-]`. */
const SNAPSHOT_RE = /(?<![A-Za-z0-9_.-])_bmad[\\/]+render[\\/]+([A-Za-z0-9._-]+)[\\/]+([A-Za-z0-9._-]+)[\\/]+([A-Za-z0-9._-]+)/g;

/** The distinct snapshot folders a reason names (`<skill>/<slug>/<generation>`); undefined when one names a `.` or
 * `..` segment. */
export function snapshotFolders(reason: string): string[] | undefined {
  const out = new Set<string>();
  for (const m of reason.matchAll(SNAPSHOT_RE)) {
    // A path ending a sentence (`…/<generation>.`) is the folder: the generation's trailing dots are dropped.
    const segs = [m[1]!, m[2]!, m[3]!.replace(/\.+$/, "")];
    if (segs.some((s) => s === "" || s === "." || s === "..")) return undefined;
    out.add(segs.join("/"));
  }
  return [...out];
}

/** A recognised stale-render halt: the story, its snapshot (relative to the served root, `/` separators) and the
 * two paths the auto-resume removes. */
export interface StaleRender { story_key: string; snapshot: string; dir: string; spec: string }

/** Story 33.6: is the paused run's latest pause a stale render view (see the header)? Reads only (one argv-only
 * `git ls-files`). The folder check (`snapshotComplete`) is separate. */
export async function staleRenderView(run: Pick<QueueRun, "worktree" | "prefix">, events: readonly QueueEvent[], deps: WorktreeDeps = {}): Promise<StaleRender | undefined> {
  const { story_key: key, stage, reason } = pausedStory(events);
  if (!key || stage !== "escalation" || !reason?.includes(DEV_ESCALATION)) return undefined;
  if (!RENDER_HALT_MESSAGES.some((m) => reason.includes(m)) && !reason.includes("render_skill.py")) return undefined;
  const folders = snapshotFolders(reason);
  if (!folders || folders.length !== 1 || !run.worktree) return undefined;
  const served = servedRoot(run)!;
  const base = resolve(served, "_bmad", "render"), dir = resolve(base, ...folders[0]!.split("/"));
  if (!isWithin(base, dir) || dir === base) return undefined;
  const { spec, fm } = storySpec(run, events);
  if (!spec || fm?.status !== "blocked") return undefined;
  const rel = relative(served, spec).split("\\").join("/");
  try {
    const r = await runner(deps)("git", ["-C", served, "ls-files", "--error-unmatch", "--", rel], { cwd: served, timeoutS: 30 });
    if (r.exit !== 1) return undefined; // 0 tracked; 128, a timeout or anything else: unknown — never removed
  } catch { return undefined; }
  return { story_key: key, snapshot: relative(served, dir).split("\\").join("/"), dir, spec };
}

/** Story 33.6: the host sees the snapshot complete — `manifest.json` parses to an object whose `outputs` is a
 * non-empty object, and each of its keys is a relative path inside `dir` naming a non-empty regular file. No hash
 * is compared. */
export function snapshotComplete(dir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
    const outputs = manifest?.outputs;
    if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return false;
    const names = Object.keys(outputs);
    if (names.length === 0) return false;
    for (const name of names) {
      const path = resolve(dir, name);
      if (!name || isAbsolute(name) || !isWithin(dir, path) || path === resolve(dir)) return false;
      const st = lstatSync(path);
      if (!st.isFile() || st.size <= 0) return false;
    }
    return true;
  } catch { return false; }
}

/** One notifier line: flattened, clipped to `NOTICE_MAX_BYTES` (as `claimRefusedLine`). */
function oneLine(text: string): string {
  const flat = text.replace(/\s*\r?\n\s*/g, " ");
  if (Buffer.byteLength(flat, "utf-8") <= NOTICE_MAX_BYTES) return flat;
  const budget = NOTICE_MAX_BYTES - Buffer.byteLength(TRUNCATED_MARKER, "utf-8");
  let out = "", used = 0;
  for (const ch of flat) {
    const n = Buffer.byteLength(ch, "utf-8");
    if (used + n > budget) break;
    out += ch; used += n;
  }
  return `${out}${TRUNCATED_MARKER}`;
}

/** Story 33.6's lines (attempt 1 resumed, attempt 1 refused, attempt 2). */
export const autoResumedLine = (runId: string, key: string, snapshot: string): string =>
  oneLine(`supervisor: run ${runId} auto-resumed: story ${key} halted on a stale render view of ${snapshot} (attempt 1)`);
export const autoResumeRefusedLine = (runId: string, key: string, snapshot: string, error: string): string =>
  oneLine(`supervisor: run ${runId} stays paused: auto-resume of story ${key} after a stale render view of ${snapshot} refused: ${error}`);
export const secondHaltLine = (runId: string, key: string, snapshot: string, firstAt: string): string =>
  oneLine(`supervisor: run ${runId} stays paused for the operator: story ${key} halted on a stale render view of ${snapshot} again after the auto-resume at ${firstAt}`);

/** The story's attempt — an `auto-resume` with its key and `attempt: 1`, under any engine run id. */
export const autoResumeAttempt = (events: readonly QueueEvent[], key: string): QueueEvent | undefined =>
  events.find((e) => e.kind === AUTO_RESUME && e.detail?.story_key === key && e.detail?.attempt === 1);

/** An `attempt: 2` record for the story since the run's latest `paused` event. */
export function secondHaltRecorded(events: readonly QueueEvent[], key: string): boolean {
  const pause = events.findLastIndex((e) => e.kind === "paused");
  return events.slice(pause + 1).some((e) => e.kind === AUTO_RESUME && e.detail?.story_key === key && e.detail?.attempt === 2);
}

/** One line through the notifier; its outcome for the event (`awaitRuling`'s `none` skip). Never throws. */
async function sendLine(deps: PausedDeps, text: string): Promise<Record<string, unknown>> {
  try {
    const selected = notifier(deps.hygiene?.env ?? envOf(deps));
    return selected.kind === "none" ? { ...NO_NOTIFIER } : await sendText(selected, text, deps.hygiene?.fetch ?? fetch);
  } catch (e) { return { ok: false, error: clip(message(e)) }; }
}

/** Attempt 1 (under the lease): remove the snapshot and the draft, resume, record, notify. Never throws. The folder
 * is first renamed aside atomically (the renderer writes the original path, so a leftover is harmless), then the
 * draft removed; a failure of either leaves both as they were (the folder renamed back), records nothing, and the
 * next pass tries again. */
async function autoResume(queue: Queue, run: QueueRun, s: StaleRender, deps: PausedDeps, self: Owner): Promise<void> {
  const aside = `${s.dir}.stale-${process.pid}-${Date.now()}`;
  try { renameSync(s.dir, aside); } catch { return; /* nothing changed: the next pass tries again */ }
  try { rmSync(s.spec); } catch {
    try { renameSync(aside, s.dir); } catch { /* best effort */ }
    return;
  }
  try { rmSync(aside, { recursive: true, force: true }); } catch { /* a leftover is harmless */ }
  const resume = deps.resume ?? ((q: Queue, id: string) => resumePaused(q, id, {}, { ...deps, self }));
  let error: string | undefined;
  try { await resume(queue, run.run_id); }
  catch (e) { error = e instanceof ResumeRefused ? clip(e.message) : `ResumeFailed: ${clip(message(e))}`; }
  const notify = await sendLine(deps, error === undefined
    ? autoResumedLine(run.run_id, s.story_key, s.snapshot)
    : autoResumeRefusedLine(run.run_id, s.story_key, s.snapshot, error));
  try {
    queue.note(run.run_id, AUTO_RESUME, {
      reason: STALE_RENDER_VIEW, snapshot: s.snapshot, story_key: s.story_key, engine_run_id: run.engine_run_id, attempt: 1,
      resumed: error === undefined, ...(error !== undefined ? { error } : {}), notify,
    });
  } catch { /* not recorded */ }
}

/** Attempt 2 (under the lease): one record and one line for this pause; nothing removed or resumed. Never throws. */
async function noteSecondHalt(queue: Queue, run: QueueRun, s: StaleRender, first: QueueEvent, deps: PausedDeps): Promise<void> {
  const notify = await sendLine(deps, secondHaltLine(run.run_id, s.story_key, s.snapshot, first.at));
  try {
    queue.note(run.run_id, AUTO_RESUME, {
      reason: STALE_RENDER_VIEW, snapshot: s.snapshot, story_key: s.story_key, engine_run_id: run.engine_run_id, attempt: 2,
      resumed: false, first_at: first.at, notify,
    });
  } catch { /* not recorded: the next pass records it */ }
}

/** The paused-run pass (see the header). Answers the runs it closed out (relaunched, out of `paused`) and the runs it
 * newly recorded awaiting a ruling. Never throws. */
export async function closeOutPaused(queue: Queue, deps: PausedDeps = {}): Promise<{ closed: string[]; awaiting: string[] }> {
  const out = { closed: [] as string[], awaiting: [] as string[] };
  const self = deps.self ?? selfOwner();
  let runs: QueueRun[];
  try { runs = queue.runs().filter((r) => r.state === "paused" && r.worktree && r.engine_run_id); } catch { return out; }
  for (const r of runs) {
    let taken = false;
    try {
      if (!existsSync(servedRoot(r)!)) continue;
      const l = landing(r, queue.events(r.run_id));
      if (l.outcome === "not-landed") {
        // Story 33.6: a stale render view is auto-resumed once per story; a second one is recorded for the
        // operator, then falls through to the block below unchanged.
        const s = await staleRenderView(r, queue.events(r.run_id), deps);
        if (s && snapshotComplete(s.dir)) {
          const seen = autoResumeAttempt(queue.events(r.run_id), s.story_key);
          if (!seen || !secondHaltRecorded(queue.events(r.run_id), s.story_key)) {
            const run = queue.takeForCloseOut(r.run_id, self);
            if (!run || run.state !== "paused") continue;
            taken = true;
            // Re-read under the lease: a concurrent pass (serve and the sweep) may have recorded the attempt
            // between the read above and the take; a recorded attempt 1 makes this the attempt-2 path.
            const events = queue.events(r.run_id), first = autoResumeAttempt(events, s.story_key);
            if (!first) { await autoResume(queue, run, s, deps, self); continue; }
            if (!secondHaltRecorded(events, s.story_key) && snapshotComplete(s.dir)) await noteSecondHalt(queue, run, s, first, deps);
          }
        }
        // Story 31.5: a dev session's `blocked` end, or an engine-raised escalation (paused at stage `escalation`,
        // the spec neither done nor blocked), owes the block (no ruling record, no notification); any other story
        // that did not land is left paused for the resume (AC3).
        const b = devBlocked(r, queue.events(r.run_id)) ?? escalationBlocked(r, queue.events(r.run_id));
        if (!b || !trackOwed(r, queue.events(r.run_id), b.story_key)) continue;
        const run = taken ? queue.get(r.run_id) : queue.takeForCloseOut(r.run_id, self);
        if (!run || run.state !== "paused") continue;
        taken = true;
        await trackBlock(queue, run, b, deps);
        continue;
      }
      if (l.outcome === "awaiting-ruling" && rulingRecorded(queue.events(r.run_id), l.story_key, r.engine_run_id)
        && !trackOwed(r, queue.events(r.run_id), l.story_key)) continue;
      const run = queue.takeForCloseOut(r.run_id, self);
      if (!run || run.state !== "paused") continue;
      taken = true;
      if (l.outcome === "awaiting-ruling") { if (await awaitRuling(queue, run, l, deps)) out.awaiting.push(run.run_id); }
      else if (await closeOutLanded(queue, run, l, { ...deps, self })) out.closed.push(run.run_id);
    } catch { /* the next pass tries again */ }
    finally {
      // Let go of the lease on a run still paused (a relaunched run belongs to its drive, or the engine).
      if (taken && queue.get(r.run_id)?.state === "paused") { try { queue.releaseCloseOut(r.run_id, self); } catch { /* re-taken once its owner is dead */ } }
    }
  }
  return out;
}

// ------------------------------------------------------------ the resume (POST /runs/{id}/resume)

export type ResumeRefusal = "RunNotFound" | "RunNotPaused" | "ExternalRun" | "StoryLanded" | "SchemaError" | "ResumeFailed";

/** A resume refused (the API maps `code` to its answer). */
export class ResumeRefused extends Error {
  constructor(readonly code: ResumeRefusal, detail: string) { super(`${code}: ${detail}`); this.name = "ResumeRefused"; }
}

export interface ResumeDeps extends WorktreeDeps {
  /** Spawns the long-lived `bmad-loop resolve` child (default `runProcess`, not awaited). */
  spawn?: (bin: string, args: string[], opts: { cwd: string }) => HoldChild;
  /** The engine.pid re-read: how many polls (default 20) and the wait between them (ms, default 250). */
  pidPolls?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  self?: Owner;
}

export interface ResumeAnswer { ok: true; run_id: string; state: "running"; engine_run_id: string }

const defaultSpawn = (env: Env) => (bin: string, args: string[], opts: { cwd: string }): HoldChild => {
  let pid: number | undefined;
  const done = runProcess(bin, args, { cwd: opts.cwd, timeoutS: HOLD_TIMEOUT_S, env, onSpawn: (p) => { pid = p; } })
    .catch((e): RunResult => ({ exit: -1, stdout: "", stderr: message(e) }));
  return { get pid() { return pid; }, done };
};

/** The resolve child's outcome for the `launched` it writes: its exit code, and a clipped stderr tail on a
 * failure (unknown when the child answered no result). */
function resolveOutcome(r: unknown): { exit: number | null; error?: string } {
  const res = r && typeof r === "object" ? (r as Partial<RunResult>) : undefined;
  const exit = typeof res?.exit === "number" ? res.exit : null;
  if (exit === 0) return { exit };
  const tail = String(res?.stderr || res?.stdout || "").trim().slice(-300);
  return { exit, ...(tail ? { error: clip(tail) } : exit === null ? { error: "no exit status reported" } : {}) };
}

/** The resolve child exited: the run is handed back to the engine-end sweep with a fresh `launched` (the same
 * engine id, `resumed: true`, the child's `resolve` outcome). A write that fails is tried once more; still
 * failing, the run — running, never handed over — goes back to `paused` with the reason recorded. */
function handBack(queue: Queue, runId: string, engineRunId: string, result: unknown): void {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cur = queue.get(runId);
      if (!cur || cur.state !== "running") return; // ended, or paused, meanwhile
      if (launchedSinceMove(queue.events(runId))) return;
      const launched = (queue.events(runId).findLast((e) => e.kind === "launched")?.detail ?? {}) as Record<string, any>;
      const detail: { status_block?: unknown; end: Record<string, unknown> } & Record<string, unknown> = {
        ...(launched.status_block !== undefined ? { status_block: launched.status_block } : {}),
        end: (launched.end && typeof launched.end === "object" ? launched.end : {}) as Record<string, unknown>, resumed: true,
        resolve: resolveOutcome(result),
      };
      queue.markLaunched(runId, engineRunId, detail);
      return;
    } catch (e) { lastError = clip(message(e)); }
  }
  backToPaused(queue, runId, { resume_failed: `the resumed run could not be handed to the engine-end sweep: ${lastError}` });
}

/** `POST /runs/{id}/resume` (see the header). Throws `ResumeRefused`. */
export async function resumePaused(queue: Queue, runId: string, opts: { restorePatch?: string } = {}, deps: ResumeDeps = {}): Promise<ResumeAnswer> {
  const run = queue.get(runId);
  if (!run) throw new ResumeRefused("RunNotFound", `queue run '${runId}' not found`);
  if (run.state === "external") throw new ResumeRefused("ExternalRun", `queue run '${runId}' is external — started outside the queue, never resumed here`);
  if (run.state !== "paused") throw new ResumeRefused("RunNotPaused", `queue run '${runId}' is ${run.state}, not paused`);
  if (!run.worktree || !run.engine_run_id || !existsSync(run.worktree)) {
    throw new ResumeRefused("RunNotPaused", `queue run '${runId}' has no worktree or engine to resume`);
  }
  const events = queue.events(runId);
  const landed = storyLanded(run, events);
  if (landed) throw new ResumeRefused("StoryLanded", `story ${landed} landed (its spec is done): the paused-run pass closes it out, a resume never re-drives it`);
  const wt = servedRoot(run)!, id = run.engine_run_id, sb = sbxRun(run); // Story 28.5: the served root
  let patch: string | undefined;
  if (opts.restorePatch !== undefined) {
    if (typeof opts.restorePatch !== "string" || !opts.restorePatch.trim()) throw new ResumeRefused("SchemaError", "'restore_patch' must be a non-empty string");
    const abs = resolve(wt, opts.restorePatch);
    if (!isWithin(wt, abs) || abs === resolve(wt)) throw new ResumeRefused("SchemaError", `'restore_patch' must name a file inside the run's worktree`);
    try { patch = sb ? toVmPath(abs) : abs; } catch (e) { throw new ResumeRefused("SchemaError", message(e)); }
  }
  let bin: string, args: string[];
  try {
    if (sb) {
      const home = await vmHome(deps, sb);
      bin = sbxBin(envOf(deps));
      args = ["exec", sb, vmBmadLoop(home), ...resolveArgs(toVmPath(wt), id, patch)];
    } else { bin = "bmad-loop"; args = resolveArgs(wt, id, patch); }
  } catch (e) { throw new ResumeRefused("ResumeFailed", clip(message(e))); }
  // The engine.pid as the pause left it (else the pid recorded on the run): the resume's rewrite differs from it.
  const pidFile = join(runDirOf(run), "engine.pid");
  const readPid = () => { try { return parseEnginePid(readFileSync(pidFile, "utf-8")); } catch { return null; } };
  const before = readPid() ?? { pid: run.engine_pid, start: run.engine_start };
  try {
    queue.resumeFromPause(runId, "engine-resume", { engine_run_id: id, argv: args, ...(patch ? { restore_patch: patch } : {}) }, deps.self ?? selfOwner());
  } catch (e) { throw new ResumeRefused("RunNotPaused", clip(message(e))); }
  let child: HoldChild;
  try { child = (deps.spawn ?? defaultSpawn(envOf(deps)))(bin, args, { cwd: wt }); }
  catch (e) {
    backToPaused(queue, runId, { resume_failed: `resume spawn failed: ${clip(message(e))}` });
    throw new ResumeRefused("ResumeFailed", `bmad-loop resolve could not be spawned: ${clip(message(e))}`);
  }
  try { if (child.pid) queue.note(runId, "hold", { ...(sb ? { sandbox: sb } : {}), argv: [bin, ...args], pid: child.pid, resume: true }); }
  catch { /* the hold is still this process's child: its exit still hands the run back below */ }
  // When the resolve child exits the resumed engine has ended or paused again: the engine-end sweep takes it
  // (a fresh `launched` after the `engine-resume`, the same engine id, `resumed: true`): its end state is the
  // engine's own terminal status (`engineEndState`), never the launch's recorded end carried here.
  void child.done.then((r) => handBack(queue, runId, id, r), (e) => handBack(queue, runId, id, { exit: null, stderr: message(e) }));
  // bmad-loop rewrites engine.pid at the resume's start: re-read until it names another process.
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  let found: { pid: number; start: string } | null = null;
  for (let i = 0, n = deps.pidPolls ?? 20; i < n; i++) {
    const p = readPid();
    if (p && (p.pid !== before.pid || !sameStart(p.start, before.start))) { found = p; break; }
    if (i < n - 1) await sleep(deps.pollMs ?? 250);
  }
  try {
    if (found) queue.recordEnginePid(runId, { ...found, source: "engine.pid" }, { ...(sb ? { sandbox: sb } : {}), resumed: true });
    else queue.recordEnginePid(runId, null, { ...(sb ? { sandbox: sb } : {}), why: "engine.pid was not rewritten by the resume", resumed: true });
  } catch { /* ended meanwhile */ }
  return { ok: true, run_id: runId, state: "running", engine_run_id: id };
}
