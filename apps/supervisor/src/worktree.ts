/**
 * worktree.ts — every run gets its own git worktree and ends in a PR (Story 27.1; supersedes 23.2).
 *
 *   prepare    after the claim, once per queue run: the run's `base_ref` (none given → the
 *              repository's default branch: `git symbolic-ref --short refs/remotes/origin/HEAD`,
 *              else `gh repo view --json defaultBranchRef`; recorded `base_ref_source: default`),
 *              refused `blocked` when it is the default branch (compared ignoring case) and GitHub says
 *              it is not protected, when it names no branch (a tag, a SHA: its PR needs one), when the
 *              branch is not on origin (no `refs/remotes/origin/<b>`: no PR base), or when it does not
 *              resolve to a commit in the checkout (the cut takes it as written);
 *              then, from the project checkout (never switched):
 *              `git worktree add --relative-paths <TK_SUPERVISOR_WORK>/worktrees/<project>/<run id>
 *                -b supervisor/run-<run id> <base_ref>` (relative gitdir paths: the host and the
 *              engine microVM see different absolute paths, operator-decisions §5), the path recorded
 *              on the run, then the engine's untracked runtime materialised by the studio's own
 *              motions: `tk install` at the pin inside the worktree (`install_base.py --directory`),
 *              `.bmad-loop/policy.toml`, `.bmad-loop/routing.current.json` and the local overlay
 *              `.tk-studio/config.local.yaml` copied from the checkout when present (never a junction
 *              or a link into it), and `tk activate` clean inside it (`drift_check.py`). Any failure
 *              is `WorktreeFailed` naming the step: the run ends `blocked`, never in the checkout.
 *   close-out  when the run's engine ended or paused (or a run with no engine ended): the commits
 *              ahead of `base_ref`; none → "no changes" (no push, no PR); else `git push origin
 *              <branch>` (never forced) and `gh pr create --base <base_ref>` (`--draft` while paused;
 *              a PR already recorded is marked ready with `gh pr ready`, never opened twice), the body
 *              (`--body-file`, a temp file) carrying the launch status block, the engine run id, the
 *              landed commits and the metered cost. The PR is left for review: the supervisor lands
 *              nothing itself. The worktree is removed after the PR (or "no changes") unless the run
 *              is paused, or a step failed (the failure is recorded, the worktree kept).
 *   sweep      `sweepEngines`: a terminal run whose close-out was skipped (a worker, driver or engine
 *              may still have been live) is closed out once all are dead (`closed_out` event); and
 *              every `running` launch run whose driver let go of it, and every
 *              `paused` run, has `launch.py status --directory <worktree> --run-id <engine>` probed;
 *              an ended engine is closed out and the run ended (`ended`, the PR URL in its detail), a
 *              paused one closed out as a draft and the run paused (`paused`, the URL on that event).
 *              Story 27.4: an engine that ended on its own (not paused, not killed) first gets the host
 *              verify leg (`hostverify.ts`, a `host-verify` event); red ends the run `partial` naming the
 *              command and opens the PR as a draft carrying the failures (an open PR: `gh pr ready --undo` and
 *              `gh pr edit`, never ready); green or skipped on an open PR: `gh pr ready` and `gh pr edit` (the body
 *              regenerated with its `## Host verify`). A `host-verify` already recorded for the completion is reused, never re-run.
 *              On the ended path the studio run is finished then (operator-decisions §2: not at
 *              launch return): `jobrun finish` with the deferred state and reason, the launch status
 *              block (the PR among its artifacts) and the metered cost. A close-out whose transition
 *              then fails is recorded (`closed_out`), never run twice: a run ended meanwhile keeps it
 *              as its close-out; otherwise the next sweep writes the transition from the record.
 *              A run whose worktree is gone with no record is closed out and ended, never probed.
 *              Story 27.2: the deferred `ended` (and a terminal run's late close-out) releases the run's
 *              sbx pin (`sbx stop`, only when no other live run records the sandbox); `paused` never does.
 *              An engine the supervisor killed (`killedEngine`) never writes its own end — its status
 *              stays in-progress — so a running/unknown status is read as ended once its recorded kill
 *              shows it gone.
 *   slice      Story 34.8: a `run-vertical-slice` run (`isSlice` of `queue.definition(run)`, decided once in the sweep and
 *              passed to `hostVerify` and the close-out). After a green assets step (a `match` fault counts green) the
 *              close-out copies the proof — the playable store's `report.json`, `contact-sheet.png` and the frames the
 *              sheet sampled — into `<served root>/.tk-studio/proof/<run_id>/`, then commits on the run branch, before
 *              the push, only `git add -- <assets.art_path> <assets.manifest> .tk-studio/proof/<run_id>/` (named
 *              paths, never `-A`; a clean index commits nothing) with the message `host leg: placed assets and proof
 *              (run <run_id>)`. A failure there is the close-out's `error` (nothing pushed, the worktree kept). The
 *              PR body then embeds the sheet (`<origin web URL>/blob/<head sha>/<path>?raw=true`) and lists the
 *              committed frames, on pass and fail alike. A non-slice run's close-out is unchanged.
 *   legs       Story 35.1: the `## Host verify` section's first line is `Legs: <k> — <leg> <verdict> <recorded_at>; …`
 *              (the run's `host-verify` events after its latest `launched`, oldest first; the close-out's first body
 *              `Legs: 1 — close-out …`). `proofCommit`, `originWebUrl`, `editPrBody`, `markPrReady` and `markPrDraft` are
 *              exported: the re-run (`hostleg.ts`) commits, rewrites the body and flips the PR through the same motions.
 *   retries    a close-out run again (its record lost) is idempotent: the commits and the push are
 *              read from the checkout once the worktree is gone (the removal counted done), and an open
 *              PR from the run branch (`gh pr list --head`) is adopted, never opened twice.
 *
 * `git` and `gh` run through argv-only spawners (`runProcess`, no shell); every `gh` call is pinned to
 * origin's repository (`GH_REPO`, parsed from `git remote get-url origin`). Credentials never reach an
 * event: a failing command's output is clipped and any URL userinfo redacted.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ghBin, pluginRoot, WorkDirMissing, workDir } from "./env";
import { canonicalPr, isWithin } from "./hygiene";
import { CONTACT_SHEET, hostVerify, isRed, isSlice, legHistory, prSection, redReason, type HostVerifyResult, type LegHistoryEntry, type PlayableJudge, type PlayableRoute, type PrProof } from "./hostverify";
import { accountedCostOf, isTerminal, RunTerminal, servedRoot, type EngineWhere, type Queue, type QueueEvent, type QueueRun, type TerminalState } from "./queue";
import { releasePin, sameStart, vmLaunchStatus, type SandboxDeps } from "./sandbox";
import { lastJsonObject, runJobVerb, runProcess, runUv, toVmPath, type RunResult, type Tier } from "./server";

type Env = Record<string, string | undefined>;
/** An argv-only spawner (never a shell). `env`: variables added to the child's environment. */
export type CommandRunner = (bin: string, args: string[], opts: { cwd: string; timeoutS: number; env?: Env }) => Promise<RunResult>;
/** A studio script through `uv run <script> <args>` in `root`. */
export type UvScriptRunner = (root: string, script: string, args: string[], timeoutS?: number) => Promise<RunResult>;

export interface WorktreeDeps {
  /** TK_SUPERVISOR_WORK, GH_BIN and the studio root are read from here (default `process.env`). */
  env?: Env;
  /** The `git`/`gh` spawner (default `runProcess`, argv only). */
  run?: CommandRunner;
  /** The studio scripts' runner (default `runUv`). */
  uv?: UvScriptRunner;
  /** The §4 jobrun verb runner the sweep finishes a launch run's studio run through (default `runJobVerb`). */
  verbs?: (root: string, args: string[], timeoutS?: number) => Promise<Record<string, any>>;
  /** Story 27.2: the `sbx` seams the pin, hold, kill and release run through (default `runProcess`). */
  sbx?: SandboxDeps;
  /** Story 34.3: the host leg's playable judge session (default `invokeSkill` on the sbx tier). */
  judge?: PlayableJudge;
  /** Story 34.3: the route reader that picks the judge's model and effort (default `resolveRoute`). */
  route?: PlayableRoute;
}

/** The `sbx` seams of a worktree run (the pin's env and the injected runner), for the pin, the release and
 * the in-VM engine probe (hole 38). */
const sbxOf = (deps: WorktreeDeps): SandboxDeps => ({ ...(deps.env ? { env: deps.env } : {}), ...(deps.sbx ?? {}) });

/** Story 27.2: the deferred `ended` releases the run's pin (`sbx stop`, when no other run records its sandbox). */
const release = (queue: Queue, runId: string, deps: WorktreeDeps) => releasePin(queue, runId, sbxOf(deps));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Command output for an event: URL userinfo redacted, clipped. */
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);

export const runner = (deps: WorktreeDeps): CommandRunner =>
  deps.run ?? ((bin, args, opts) => runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...(deps.env ?? process.env), ...(opts.env ?? {}) } }));
export const uvRunner = (deps: WorktreeDeps): UvScriptRunner => deps.uv ?? runUv;
export const studioScript = (deps: WorktreeDeps, ...rel: string[]) => join(pluginRoot(deps.env ?? process.env), ...rel);

/** A prepare step that failed: the run ends `blocked` naming it (`worktree <step>: <detail>`). */
export class WorktreeFailed extends Error {
  constructor(readonly step: string, detail: string) { super(`worktree ${step}: ${detail}`); this.name = "WorktreeFailed"; }
}

/** A `base_ref` as a branch name: `refs/heads/`, `refs/remotes/origin/` and `origin/` stripped (the
 * default-branch comparison, the protection check and the PR's `--base`). */
export const baseBranch = (ref: string): string =>
  ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, "").replace(/^origin\//, "");

/** `<work>/worktrees/<project id>/<queue run id>`. */
export function worktreePath(work: string, projectId: string, runId: string): string {
  return join(resolve(work), "worktrees", projectId, runId);
}

/** The run's branch: `supervisor/run-<queue run id>`. */
export const runBranch = (runId: string): string => `supervisor/run-${runId}`;

/** The `git worktree add` argv (relative gitdir paths always, operator-decisions §5). */
export function worktreeAddArgv(path: string, branch: string, baseRef: string): string[] {
  return ["worktree", "add", "--relative-paths", path, "-b", branch, baseRef];
}

async function git(deps: WorktreeDeps, cwd: string, args: string[], timeoutS = 120): Promise<RunResult> {
  return runner(deps)("git", args, { cwd, timeoutS });
}

/** `[HOST/]OWNER/REPO` of a GitHub remote URL (https, `ssh://`, or scp-like `git@host:owner/repo`;
 * a `.git` suffix and any userinfo dropped; `github.com` answered as `OWNER/REPO`), else undefined
 * (a local path, an ssh host alias with no domain, anything else). */
export function originRepo(url: string): string | undefined {
  const u = url.trim();
  const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u)
    ?? /^(?:[^@/:]+@)?([^/:]+):(?!\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u);
  if (!m) return undefined;
  const host = m[1]!.toLowerCase() === "ssh.github.com" ? "github.com" : m[1]!.toLowerCase();
  if (!host.includes(".")) return undefined;
  return host === "github.com" ? `${m[2]}/${m[3]}` : `${host}/${m[2]}/${m[3]}`;
}

/** The repository every `gh` call is pinned to (`GH_REPO`): origin's, from `git remote get-url origin`
 * in `cwd` — never gh's own default-remote choice (an `upstream` remote beside `origin`). Undefined when
 * it cannot be read or parsed: gh's default then. */
async function originGhRepo(deps: WorktreeDeps, cwd: string): Promise<string | undefined> {
  try {
    const r = await git(deps, cwd, ["remote", "get-url", "origin"], 30);
    return r.exit === 0 ? originRepo(r.stdout) : undefined;
  } catch { return undefined; }
}

/** `gh <args>` in `cwd`, pinned to origin's repository (`GH_REPO`); argv only. Story 27.5: exported for the merge pass. */
export async function gh(deps: WorktreeDeps, cwd: string, args: string[], timeoutS = 120): Promise<RunResult> {
  const repo = await originGhRepo(deps, cwd);
  return runner(deps)(ghBin(deps.env ?? process.env), args, { cwd, timeoutS, ...(repo ? { env: { GH_REPO: repo } } : {}) });
}

const failed = (r: RunResult) => `exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;

/** The repository's default branch, from the checkout: `origin/HEAD` first (`origin/` stripped),
 * then `gh repo view --json defaultBranchRef`. Throws naming both failures. */
export async function defaultBranch(checkout: string, deps: WorktreeDeps = {}): Promise<string> {
  const why: string[] = [];
  try {
    const r = await git(deps, checkout, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    const name = r.stdout.trim().replace(/^origin\//, "");
    if (r.exit === 0 && name) return name;
    why.push(`git symbolic-ref ${failed(r)}`);
  } catch (e) { why.push(`git symbolic-ref: ${clip(message(e))}`); }
  try {
    const r = await gh(deps, checkout, ["repo", "view", "--json", "defaultBranchRef"]);
    const name = (lastJsonObject(r.stdout) as Record<string, any> | null)?.defaultBranchRef?.name;
    if (r.exit === 0 && typeof name === "string" && name) return name;
    why.push(`gh repo view ${failed(r)}`);
  } catch (e) { why.push(`gh repo view: ${clip(message(e))}`); }
  throw new Error(`the default branch could not be resolved (${why.join("; ")})`);
}

/** Is `branch` protected on GitHub? `gh api repos/{owner}/{repo}/branches/<branch>` (its `protected`). */
export async function branchProtected(checkout: string, branch: string, deps: WorktreeDeps = {}): Promise<boolean> {
  const r = await gh(deps, checkout, ["api", `repos/{owner}/{repo}/branches/${branch}`]);
  const out = lastJsonObject(r.stdout) as Record<string, unknown> | null;
  if (r.exit !== 0 || !out || typeof out.protected !== "boolean") throw new Error(`gh api ${failed(r)}`);
  return out.protected;
}

/** Does the full ref `ref` exist in the checkout (`git show-ref --verify`)? Unreadable: no. */
async function hasRef(checkout: string, ref: string, deps: WorktreeDeps): Promise<boolean> {
  try { return (await git(deps, checkout, ["show-ref", "--verify", "--quiet", ref], 30)).exit === 0; }
  catch { return false; }
}

/** Does `branch` name a branch in the checkout: `refs/heads/<branch>` or `refs/remotes/origin/<branch>`? */
export async function namesBranch(checkout: string, branch: string, deps: WorktreeDeps = {}): Promise<boolean> {
  if (!branch) return false;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) if (await hasRef(checkout, ref, deps)) return true;
  return false;
}

/** Is `branch` the repository's default branch? Compared ignoring case: on Windows loose refs match
 * case-insensitively, so `MAIN` cuts from `main` and must meet its protection check. */
export const isDefaultBranch = (branch: string, theDefault: string): boolean => branch.toLowerCase() === theDefault.toLowerCase();

/** The untracked runtime copied from the checkout into a worktree, each only when present. */
export const COPIED_RUNTIME = [".bmad-loop/policy.toml", ".bmad-loop/routing.current.json", ".tk-studio/config.local.yaml"] as const;

/** What `materialise` did about the base: `tk install` ran because the fresh worktree reported drift, or
 * was skipped because the worktree was already at the pin (hole 42). */
export type MaterialiseInstall = "ran" | "skipped: drift-clean";

/** Hole 75: the drift-check plane materialise reports but never judges. The `sandbox-login` plane
 * (Story 33.2) describes the project's sandbox, which the pin owns (33.3) and which is stopped whenever
 * no run holds it (the verify verb of 33.8 never pins), so it can never decide whether a fresh
 * worktree's runtime is at the pin; the first real `POST /runs/{id}/verify` failed on it. */
// Hole 93: the tracking plane reads the served checkout's untracked sync-back state, which a fresh
// worktree never has, and the engine never reaches Jira: materialise reports it and never judges it.
export const MATERIALISE_IGNORED_PLANES: ReadonlySet<string> = new Set(["sandbox-login", "tracking"]);

/** Whether the drift check's answer means the worktree's runtime is at the pin: `clean`, or every
 * judged plane `ok` with only an ignored plane not. No answer (no JSON, no planes) is never clean. */
export function worktreeClean(out: Record<string, any> | null | undefined): boolean {
  if (!out) return false;
  if (out.result === "clean") return true;
  const planes = Array.isArray(out.planes) ? out.planes : null;
  if (!planes || planes.length === 0) return false;
  return planes.every((p) => MATERIALISE_IGNORED_PLANES.has(String(p?.plane)) || p?.status === "ok");
}

/** What a materialise refusal names: every judged plane that is not `ok`, or the bare result. */
export function driftingPlanes(out: Record<string, any> | null | undefined): string {
  const planes: any[] = Array.isArray(out?.planes) ? out!.planes : [];
  const bad = planes.filter((p) => !MATERIALISE_IGNORED_PLANES.has(String(p?.plane)) && p?.status !== "ok")
    .map((p) => `${String(p?.plane)}: ${String(p?.status)}`);
  return bad.length ? bad.join(", ") : `result '${String(out?.result)}'`;
}

/** The engine's untracked runtime in a fresh worktree, by the studio's own motions: the drift check
 * first, `tk install` at the pin inside it only when that check reports drift (hole 42: a fresh worktree
 * of a project whose committed base is at the pin is already clean, and the install would only re-render
 * committed config into a dirty tree the launch refuses), the policy/routing/overlay files copied from the
 * checkout (when present), and `tk activate` clean inside it on the planes materialise judges (hole 75:
 * the `sandbox-login` plane is reported, never judged). Throws `WorktreeFailed` naming the step. */
export async function materialise(checkout: string, worktree: string, deps: WorktreeDeps = {}): Promise<{ copied: string[]; install: MaterialiseInstall }> {
  const uv = uvRunner(deps);
  const driftCheck = async (): Promise<{ out: Record<string, any> | null; res: RunResult }> => {
    let res: RunResult;
    try { res = await uv(worktree, studioScript(deps, "skills", "tk-studio-activate", "scripts", "drift_check.py"), ["--directory", worktree], 300); }
    catch (e) { throw new WorktreeFailed("activate drift", clip(message(e))); }
    return { out: lastJsonObject(res.stdout) as Record<string, any> | null, res };
  };
  let install: MaterialiseInstall = "skipped: drift-clean";
  if (!worktreeClean((await driftCheck()).out)) {
    let res: RunResult;
    try { res = await uv(worktree, studioScript(deps, "skills", "tk-studio-install", "scripts", "install_base.py"), ["--directory", worktree], 1800); }
    catch (e) { throw new WorktreeFailed("install", clip(message(e))); }
    const installed = lastJsonObject(res.stdout) as Record<string, any> | null;
    if (res.exit !== 0 || !installed || installed.ok === false) {
      throw new WorktreeFailed("install", installed ? `${installed.step ?? "install_base"}: ${clip(String(installed.error ?? JSON.stringify(installed.problems ?? "failed")))}` : failed(res));
    }
    install = "ran";
  }
  const copied: string[] = [];
  try {
    for (const rel of COPIED_RUNTIME) {
      const from = join(checkout, rel);
      if (!existsSync(from)) continue;
      const to = join(worktree, rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to); // a copy, never a junction or a link into the checkout
      copied.push(rel);
    }
  } catch (e) { throw new WorktreeFailed("copy", clip(message(e))); }
  const { out: drift, res: last } = await driftCheck();
  if (!worktreeClean(drift)) throw new WorktreeFailed("activate drift", drift ? driftingPlanes(drift) : failed(last));
  return { copied, install };
}

/** Once per queue run, after the claim and before the minting verb: the run's worktree, cut and
 * materialised (see the header). A run that already has one (adopted, resumed) keeps it. Answers
 * the root the run serves — Story 28.5 (DW-25): `<worktree>/<prefix>` for a project below its git
 * top-level, the worktree itself at the top; throws `WorktreeFailed` naming the step (never a fallback
 * to the checkout). The project is materialised at its served root. */
export async function prepareWorktree(
  queue: Queue, run: QueueRun, projectId: string, checkout: string, opts: WorktreeDeps & { tier?: Tier } = {},
): Promise<string> {
  if (run.worktree) {
    if (!existsSync(run.worktree)) throw new WorktreeFailed("add", `the run's recorded worktree '${run.worktree}' is gone`);
    // Cut but never materialised (a crash between the cut and the end of materialise): materialised now.
    const served = servedRoot(run)!;
    if (!queue.events(run.run_id).some((e) => e.kind === "materialised")) {
      const done = await materialise(checkout, served, opts);
      queue.note(run.run_id, "materialised", { path: run.worktree, copied: done.copied, install: done.install, again: true });
    }
    return served;
  }
  const env = opts.env ?? process.env;
  const work = workDir(env);
  if (!work) throw new WorktreeFailed("work folder", new WorkDirMissing("worktree").message);
  if (isWithin(checkout, work)) throw new WorktreeFailed("work folder", "TK_SUPERVISOR_WORK is the project root or lies inside it: the worktree would nest in the checkout");
  const path = worktreePath(work, projectId, run.run_id);
  const served = servedRoot({ worktree: path, prefix: run.prefix })!;
  const branch = runBranch(run.run_id);

  let baseRef = run.base_ref ?? undefined, source: "default" | undefined, theDefault: string;
  try { theDefault = await defaultBranch(checkout, opts); }
  catch (e) { throw new WorktreeFailed(baseRef ? "protection" : "base_ref", message(e)); }
  if (!baseRef) {
    baseRef = theDefault;
    source = "default";
    queue.recordBaseRef(run.run_id, baseRef, source);
  }
  const branchOfBase = baseBranch(baseRef);
  // The default branch in any spelling or case (its protection read under its own name), checked first.
  if (isDefaultBranch(branchOfBase, theDefault)) {
    let ok: boolean;
    try { ok = await branchProtected(checkout, theDefault, opts); }
    catch (e) { throw new WorktreeFailed("protection", `could not read the protection of '${theDefault}': ${message(e)}`); }
    if (!ok) throw new WorktreeFailed("protection", `base_ref '${baseRef}' is the repository's default branch and is not protected on GitHub — refused`);
  }
  // A PR targets a branch: a tag or a commit SHA is refused now, never after the whole run.
  if (!(await namesBranch(checkout, branchOfBase, opts))) {
    throw new WorktreeFailed("base_ref", `base_ref '${baseRef}' names no branch (neither refs/heads/${branchOfBase} nor refs/remotes/origin/${branchOfBase}): a PR needs a branch to target`);
  }
  // Its PR needs a base on GitHub: a branch only in the checkout would fail `gh pr create` after the whole run.
  if (!(await hasRef(checkout, `refs/remotes/origin/${branchOfBase}`, opts))) {
    throw new WorktreeFailed("base_ref", `base_ref '${baseRef}' is not on origin (no refs/remotes/origin/${branchOfBase}): its PR would have no base branch on GitHub`);
  }
  // The cut takes `base_ref` as written: it must resolve to a commit (a bare `rel` with only `origin/rel` does not).
  let resolves = false;
  try { resolves = (await git(opts, checkout, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], 30)).exit === 0; }
  catch { /* unreadable: not verified */ }
  if (!resolves) {
    throw new WorktreeFailed("base_ref", `base_ref '${baseRef}' does not resolve to a commit in the checkout: the worktree cannot be cut from it (origin/${branchOfBase} would)`);
  }
  if (opts.tier === "sbx") {
    for (const p of new Set([path, served])) {
      try { toVmPath(p); }
      catch (e) { throw new WorktreeFailed("vm path", `the worktree '${p}' has no path visible in the microVM: ${message(e)}`); }
    }
  }
  let res: RunResult;
  try {
    mkdirSync(dirname(path), { recursive: true });
    res = await git(opts, checkout, worktreeAddArgv(path, branch, baseRef));
  } catch (e) { throw new WorktreeFailed("add", clip(message(e))); }
  if (res.exit !== 0) throw new WorktreeFailed("add", `git worktree add ${failed(res)}`);
  queue.recordWorktree(run.run_id, path, { branch, base_ref: baseRef, ...(source ? { base_ref_source: source } : {}) });
  const done = await materialise(checkout, served, opts);
  queue.note(run.run_id, "materialised", { path, copied: done.copied, install: done.install }); // the marker a re-drive checks
  return served;
}

// ------------------------------------------------------------ the close-out

/** The metered cost of an engine run (`.bmad-loop/runs/<id>/run.json` `total_cost_usd`), else undefined. */
export function meteredCost(worktree: string, engineRunId: string | null | undefined): number | undefined {
  if (!engineRunId) return undefined;
  try {
    const run = JSON.parse(readFileSync(join(worktree, ".bmad-loop", "runs", engineRunId, "run.json"), "utf-8"));
    return typeof run?.total_cost_usd === "number" && Number.isFinite(run.total_cost_usd) ? run.total_cost_usd : undefined;
  } catch { return undefined; }
}

/** Story 35.1: an existing PR body's `## Metered cost` section text (up to the next `## ` heading, trimmed), else
 * undefined (no such section, or an empty one). A re-run whose metered cost cannot be read carries it back unchanged. */
export function meteredCostSection(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const m = /^## Metered cost[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body);
  const text = m?.[1]?.trim();
  return text ? text : undefined;
}

/** The PR body, in order: the launch status block (fenced JSON), `Engine run: <id>`, the landed
 * commits (`git log --oneline <base_ref>..HEAD`), the metered cost (or "not metered"), and the host
 * verify leg's `## Host verify` section when it was run or skipped (Story 27.4). Story 35.1: `legs` (the run's
 * host legs, the latest last) gives the section its `Legs:` history line — the close-out's and the re-run's body
 * through this one renderer; `costText` (a re-run's carried-back `## Metered cost` text) replaces the rendered cost. */
export function prBody(input: { statusBlock?: unknown; engineRunId?: string | null; commits: string[]; costUsd?: number; costText?: string; runId: string; verify?: HostVerifyResult; proof?: PrProof; legs?: readonly LegHistoryEntry[] }): string {
  return [
    `Opened by the supervisor for queue run \`${input.runId}\`.`,
    "",
    "## Launch status block",
    "",
    "```json",
    input.statusBlock === undefined ? "null" : JSON.stringify(input.statusBlock, null, 2),
    "```",
    "",
    `Engine run: ${input.engineRunId ?? "none"}`,
    "",
    "## Landed commits",
    "",
    ...(input.commits.length ? input.commits.map((c) => `- ${c}`) : ["(none)"]),
    "",
    "## Metered cost",
    "",
    input.costText ?? (input.costUsd === undefined ? "not metered" : `$${input.costUsd.toFixed(4)} (total_cost_usd)`),
    ...(input.verify ? ["", ...prSection(input.verify, input.proof, input.legs)] : []),
  ].join("\n");
}

/** What a close-out did: the PR (or "no changes"), and anything that failed (the worktree then kept). */
export interface CloseOut {
  pr?: string; no_changes?: true; commits: string[]; draft?: boolean; pushed?: string;
  error?: string; worktree: "removed" | "kept" | string;
  /** Hole 34: after a "no changes" end the local run branch (at base_ref, never pushed) goes with the worktree. */
  branch?: "deleted" | string;
  /** Story 27.4: the host verify leg's outcome, when the close-out was given one. */
  host_verify?: "green" | "red" | "skipped";
  /** Story 34.8: the host-side commit of a slice run (its sha, or "nothing to commit"). */
  host_commit?: string;
}

/** Story 34.8: the proof folder of a run, served-root relative. */
export const proofRel = (runId: string) => `.tk-studio/proof/${runId}`;
/** Story 34.8: the host-side commit's message. */
export const hostCommitMessage = (runId: string) => `host leg: placed assets and proof (run ${runId})`;

/** Story 34.8: copy the proof into the served root and commit the named paths on the run branch (see the header).
 * Answers the committed frame paths, the sha (or "nothing to commit") and whether the sheet landed; throws a
 * message on any failure. Story 35.1: exported, the re-run's slice commit (`hostleg.ts`) goes through it too. */
export async function proofCommit(
  run: Pick<QueueRun, "run_id" | "worktree" | "prefix">, verify: HostVerifyResult, deps: WorktreeDeps,
): Promise<{ sha: string; frames: string[]; sheet?: string; head?: string }> {
  if (verify.skipped || !verify.assets) throw new Error("no assets step recorded");
  const served = servedRoot(run as QueueRun)!;
  const branch = runBranch(run.run_id);
  const at = await git(deps, served, ["rev-parse", "--abbrev-ref", "HEAD"], 30);
  if (at.exit !== 0) throw new Error(`git rev-parse --abbrev-ref HEAD ${failed(at)}`);
  if (at.stdout.trim() !== branch) throw new Error(`the worktree is on '${clip(at.stdout.trim() || "?")}', not the run branch '${branch}'`);
  const rel = proofRel(run.run_id);
  const dir = join(served, ...rel.split("/"));
  const p = verify.playable;
  const frames: string[] = [];
  let sheet: string | undefined;
  if (p?.store && existsSync(join(p.store, "report.json"))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(p.store, "report.json"), join(dir, "report.json"));
    if (p.contact_sheet && existsSync(p.contact_sheet)) {
      copyFileSync(p.contact_sheet, join(dir, CONTACT_SHEET));
      sheet = `${rel}/${CONTACT_SHEET}`;
    }
    for (const name of p.sampled ?? []) {
      if (/[\\/]/.test(name) || name.includes("..")) continue;
      const from = join(p.store, "frames", name);
      if (!existsSync(from)) continue;
      mkdirSync(join(dir, "frames"), { recursive: true });
      cpSync(from, join(dir, "frames", name));
      frames.push(`${rel}/frames/${name}`);
    }
  } else {
    // The store gone (a retried or late close-out after it was pruned): the proof already in the served root is
    // kept, never deleted unstaged, and its sheet and frames still embedded.
    if (existsSync(join(dir, CONTACT_SHEET))) sheet = `${rel}/${CONTACT_SHEET}`;
    if (existsSync(join(dir, "frames"))) {
      for (const name of readdirSync(join(dir, "frames")).sort()) frames.push(`${rel}/frames/${name}`);
    }
  }
  const paths = [verify.assets.art_path, verify.assets.manifest, rel]
    .filter((x): x is string => typeof x === "string" && x !== "" && existsSync(join(served, x)));
  if (paths.length) {
    const add = await git(deps, served, ["add", "--", ...paths]);
    if (add.exit !== 0) throw new Error(`git add -- ${paths.join(" ")} ${failed(add)}`);
  }
  // A clean index is `nothing to commit` by exit code (never git's localized wording).
  // Both scoped to the named paths: anything else already staged never lands in the host commit.
  let committed = false;
  if (paths.length) {
    const diff = await git(deps, served, ["diff", "--cached", "--quiet", "--", ...paths], 60);
    if (diff.exit !== 0 && diff.exit !== 1) throw new Error(`git diff --cached --quiet ${failed(diff)}`);
    committed = diff.exit === 1;
  }
  if (committed) {
    const c = await git(deps, served, ["commit", "-m", hostCommitMessage(run.run_id), "--", ...paths]);
    if (c.exit !== 0) throw new Error(`git commit ${failed(c)}`);
  }
  // The head either way: a retried close-out (the proof already committed) still embeds the sheet at it.
  const head = await git(deps, served, ["rev-parse", "HEAD"], 30);
  const tip = head.exit === 0 ? head.stdout.trim() : undefined;
  const sha = committed ? tip ?? "committed" : "nothing to commit";
  return { sha, frames, ...(sheet ? { sheet } : {}), ...(tip ? { head: tip } : {}) };
}

/** `https://<host>/<owner>/<repo>` of origin (a GitHub remote), else undefined. */
export async function originWebUrl(deps: WorktreeDeps, cwd: string): Promise<string | undefined> {
  const repo = await originGhRepo(deps, cwd);
  if (!repo) return undefined;
  return repo.split("/").length === 2 ? `https://github.com/${repo}` : `https://${repo}`;
}

/** A PR body through a temp file (a long run's body passes the win32 command-line limit as an argument). */
export async function withBodyFile<T>(body: string, use: (bodyFile: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-pr-body-"));
  try {
    const bodyFile = join(dir, "body.md");
    writeFileSync(bodyFile, body, "utf-8");
    return await use(bodyFile);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a temp file left behind */ } }
}

/** Story 35.1 (lifted from `closeOut`): `gh pr edit <pr> --body-file <tmp>` with `body`. Answers undefined on success,
 * else the failure (`gh pr edit exit <n>: …` or `gh pr edit: …`, clipped); never throws. */
export async function editPrBody(deps: WorktreeDeps, cwd: string, pr: string, body: string): Promise<string | undefined> {
  try {
    const r = await withBodyFile(body, (f) => gh(deps, cwd, ["pr", "edit", pr, "--body-file", f]));
    return r.exit === 0 ? undefined : `gh pr edit ${failed(r)}`;
  } catch (e) { return `gh pr edit: ${clip(message(e))}`; }
}

/** Story 35.1 (lifted from `closeOut`): the green flip, `gh pr ready <pr>`. Answers undefined on success, else the
 * failure; never throws. */
export async function markPrReady(deps: WorktreeDeps, cwd: string, pr: string): Promise<string | undefined> {
  try {
    const r = await gh(deps, cwd, ["pr", "ready", pr]);
    return r.exit === 0 ? undefined : `gh pr ready ${failed(r)}`;
  } catch (e) { return `gh pr ready: ${clip(message(e))}`; }
}

/** Story 35.1 (lifted from `closeOut`): the red flip, `gh pr ready <pr> --undo` (back to a draft; a no-op on a draft).
 * Answers undefined on success, else the failure; never throws. */
export async function markPrDraft(deps: WorktreeDeps, cwd: string, pr: string): Promise<string | undefined> {
  try {
    const u = await gh(deps, cwd, ["pr", "ready", pr, "--undo"]);
    return u.exit === 0 ? undefined : `gh pr ready --undo ${failed(u)}`;
  } catch (e) { return `gh pr ready --undo: ${clip(message(e))}`; }
}

/** The close-out of a run's worktree (see the header). Never throws: a failure is `error`. */
export async function closeOut(
  run: Pick<QueueRun, "run_id" | "job_id" | "root" | "worktree" | "base_ref" | "prefix">,
  input: { paused: boolean; statusBlock?: unknown; engineRunId?: string | null; costUsd?: number; existingPr?: string; verify?: HostVerifyResult; slice?: boolean; legs?: readonly LegHistoryEntry[] },
  deps: WorktreeDeps = {},
): Promise<CloseOut> {
  const wt = run.worktree!, base = run.base_ref ?? "", branch = runBranch(run.run_id);
  // The worktree already gone (an earlier close-out removed it, then its record was lost): the commits
  // read and the branch pushed by name from the checkout, the removal already done.
  const gone = !existsSync(wt);
  const at = gone ? run.root : wt;
  const out: CloseOut = { commits: [], worktree: "kept" };
  // Story 27.4: a red host verify opens the PR as a draft carrying the failures (never marked ready).
  const red = isRed(input.verify);
  if (input.verify) out.host_verify = input.verify.skipped ? "skipped" : input.verify.green ? "green" : "red";
  // Hole 34: a "no changes" end leaves the run branch at base_ref and never pushed; it is deleted with
  // the worktree (a branch that carried commits is on origin by then and stays, as the resume paths and
  // a lost-record close-out read it by name).
  let branchGone = false;
  const dropBranch = async (): Promise<CloseOut> => {
    if (!out.no_changes || branchGone) return out;
    try {
      const r = await git(deps, run.root, ["branch", "-D", branch]);
      out.branch = r.exit === 0 ? "deleted" : `kept: git branch -D ${failed(r)}`;
    } catch (e) { out.branch = `kept: git branch -D: ${clip(message(e))}`; }
    return out;
  };
  const finish = async (): Promise<CloseOut> => {
    if (input.paused) { out.worktree = "kept"; return out; } // a paused run keeps it for the resume
    if (out.error) { out.worktree = "kept"; return out; }
    if (gone) {
      try { await git(deps, run.root, ["worktree", "prune"]); } catch { /* its record only: the directory is gone */ }
      out.worktree = "removed";
      return dropBranch();
    }
    try {
      // Hole 34: the engine leaves untracked runtime behind (its runs and caches, a nested project's
      // state), and `git worktree remove` refuses a worktree holding modified or untracked files, so the
      // folder stayed behind on the first real run. The run is over: what it landed is on origin.
      const r = await git(deps, run.root, ["worktree", "remove", "--force", wt]);
      out.worktree = r.exit === 0 ? "removed" : `kept: git worktree remove ${failed(r)}`;
    } catch (e) { out.worktree = `kept: git worktree remove: ${clip(message(e))}`; }
    return out.worktree === "removed" ? dropBranch() : out;
  };
  if (gone) {
    // The branch went with an earlier "no changes" close-out whose record was lost (hole 34): nothing landed.
    try {
      const r = await git(deps, run.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
      if (r.exit !== 0) { branchGone = true; out.no_changes = true; return finish(); }
    } catch { /* probed again by the git log below */ }
  }
  // Story 34.8: a slice run's host-side commit (after a green assets step), before the commits are read and pushed.
  let proof: PrProof | undefined;
  const v = input.verify;
  if (input.slice && !gone && !input.paused && v && !v.skipped && v.assets?.verdict === "green") {
    try {
      const done = await proofCommit(run, v, deps);
      out.host_commit = done.sha;
      const prefix = run.prefix ?? "";
      const web = done.head && done.sheet ? await originWebUrl(deps, at) : undefined;
      proof = { frames: done.frames.map((f) => `${prefix}${f}`), ...(web ? { sheetUrl: `${web}/blob/${done.head}/${prefix}${done.sheet}?raw=true` } : {}) };
    } catch (e) { out.error = `host commit: ${clip(message(e))}`; return finish(); }
  }
  try {
    const r = await git(deps, at, ["log", "--oneline", `${base}..${gone ? branch : "HEAD"}`]);
    if (r.exit !== 0) { out.error = `git log ${failed(r)}`; return finish(); }
    out.commits = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (e) { out.error = `git log: ${clip(message(e))}`; return finish(); }
  if (!out.commits.length && !input.existingPr) { out.no_changes = true; return finish(); }
  if (out.commits.length) {
    try {
      const r = await git(deps, at, ["push", "origin", branch], 300); // never forced
      if (r.exit !== 0) { out.error = `git push ${failed(r)}`; return finish(); }
      out.pushed = branch;
    } catch (e) { out.error = `git push: ${clip(message(e))}`; return finish(); }
  }
  try {
    // An open PR from the run branch that no record names (a close-out that opened it, then crashed or
    // failed to record it): adopted as the run's PR, never opened twice.
    let existingPr = input.existingPr;
    if (!existingPr) {
      const r = await gh(deps, at, ["pr", "list", "--head", branch, "--state", "open", "--json", "url"]);
      if (r.exit !== 0) { out.error = `gh pr list ${failed(r)}`; return finish(); }
      existingPr = openPrUrl(r.stdout);
    }
    // The metered cost read where the engine wrote it: the served root (`<worktree>/<prefix>`, Story 28.5).
    const body = () => prBody({ statusBlock: input.statusBlock, engineRunId: input.engineRunId, commits: out.commits, costUsd: input.costUsd ?? (gone ? undefined : meteredCost(servedRoot(run)!, input.engineRunId)), runId: run.run_id, ...(input.verify ? { verify: input.verify } : {}), ...(proof ? { proof } : {}), ...(input.legs?.length ? { legs: input.legs } : {}) });
    // `gh pr edit <pr> --body-file` with the regenerated body (`editPrBody`); a failure pushed to `errors`.
    const editBody = async (pr: string, errors: string[]) => {
      const e = await editPrBody(deps, at, pr, body());
      if (e) errors.push(e);
    };
    if (existingPr) {
      out.pr = existingPr;
      if (red) {
        // A red verify on a PR already open (a paused run's draft, or an adopted one an earlier close-out may
        // have marked ready before it crashed): converted back to a draft (`gh pr ready --undo`, a no-op on a
        // draft), never marked ready, its body regenerated. A failure of either is recorded, never thrown.
        const errors: string[] = [];
        const u = await markPrDraft(deps, at, existingPr);
        if (u) errors.push(u);
        else out.draft = true;
        await editBody(existingPr, errors);
        if (errors.length) out.error = errors.join("; ");
      } else if (!input.paused) {
        if (!input.verify) {
          const r = await markPrReady(deps, at, existingPr);
          if (r) out.error = r;
        } else {
          // A green or skipped verify on a PR already open (a resumed or relaunched run's draft, or an adopted
          // one): marked ready as today, and its body regenerated so it carries the `## Host verify` section.
          // A failure of either is recorded, never thrown.
          const errors: string[] = [];
          const r = await markPrReady(deps, at, existingPr);
          if (r) errors.push(r);
          await editBody(existingPr, errors);
          if (errors.length) out.error = errors.join("; ");
        }
      } else out.draft = true;
    } else {
      const draft = input.paused || red;
      const r = await withBodyFile(body(), (bodyFile) => gh(deps, at, [
        "pr", "create", "--base", baseBranch(base), "--head", branch, "--title", `supervisor: ${run.job_id} (${run.run_id})`, "--body-file", bodyFile,
        ...(draft ? ["--draft"] : []),
      ]));
      const url = r.stdout.split(/\s+/).map((t) => canonicalPr(t)).find(Boolean);
      if (r.exit !== 0 || !url) out.error = `gh pr create ${failed(r)}`;
      else { out.pr = url; if (draft) out.draft = true; }
    }
  } catch (e) { out.error = `gh pr: ${clip(message(e))}`; }
  return finish();
}

/** The first open PR's canonical URL in `gh pr list --json url` output (a JSON array), else undefined. */
export function openPrUrl(stdout: string): string | undefined {
  try {
    const list = JSON.parse(stdout.trim() || "[]");
    if (!Array.isArray(list)) return undefined;
    for (const item of list) { const pr = canonicalPr(item?.url); if (pr) return pr; }
  } catch { /* unparseable: none */ }
  return undefined;
}

/** What a launched run's close-out carries, from its `launched` event (AC3): the launch status block,
 * the engine run id and the metered cost — the engine's `run.json`, read before the worktree is
 * removed, else the launch worker's. A run with no `launched` event: its engine id only.
 * Story 27.5 (DW-15): plus the metered cost of every engine run an earlier close-out archived (its `accounted`
 * events, `source: "engine"`), so a relaunched run's cost is the sum across its engines. */
export function launchedCloseOutInput(
  events: readonly QueueEvent[], run: Pick<QueueRun, "worktree" | "engine_run_id" | "prefix">,
): { statusBlock?: unknown; engineRunId: string | null; costUsd?: number } {
  const launched = (events.findLast((e) => e.kind === "launched")?.detail ?? {}) as Record<string, any>;
  const engineRunId: string | null = run.engine_run_id ?? (typeof launched.engine_run_id === "string" ? launched.engine_run_id : null);
  const metered = run.worktree && existsSync(run.worktree) ? meteredCost(servedRoot(run)!, engineRunId) : undefined;
  const latest = metered ?? (typeof launched.worker_cost_usd === "number" ? launched.worker_cost_usd : undefined);
  // The current engine's own recorded cost is left out only when its metered cost was read here: an engine archived
  // (its cost recorded) whose relaunch failed still names the run's engine, with no run.json left to read.
  const archived = accountedCostOf(events, "engine", metered !== undefined ? engineRunId : null);
  const cost = archived === undefined ? latest : archived + (latest ?? 0);
  return { ...(launched.status_block !== undefined ? { statusBlock: launched.status_block } : {}), engineRunId, ...(cost !== undefined ? { costUsd: cost } : {}) };
}

/** The PR a run's earlier close-out opened (on its `paused` event, or on a `closed_out` record), if any:
 * marked ready, never opened again. */
export function priorPr(events: readonly QueueEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== "paused" && e.kind !== "closed_out") continue;
    const pr = canonicalPr(e.detail?.pr);
    if (pr) return pr;
  }
  return undefined;
}

/** Story 27.4: the `host-verify` recorded for the latest engine completion (after the latest `launched`): a
 * close-out that crashed, or whose transition and record both failed, perhaps after removing the worktree. */
function recordedVerify(events: readonly QueueEvent[]): HostVerifyResult | undefined {
  const at = events.findLastIndex((e) => e.kind === "host-verify");
  const d = at > events.findLastIndex((e) => e.kind === "launched") ? events[at]!.detail : undefined;
  return d && typeof d === "object" ? d as unknown as HostVerifyResult : undefined;
}

/** The state transition a sweep's close-out recorded but could not write (`closed_out` with `pending`):
 * `paused` (the `paused` event's detail) or `ended` (the end and its detail). */
export type PendingTransition =
  | { phase: "paused"; detail: Record<string, unknown> }
  | { phase: "ended"; state: TerminalState; reason: string | null; detail: Record<string, unknown>; stop?: any };

/** A non-terminal run's close-out that already ran but whose transition was not written (the latest
 * `closed_out` with `pending`, after any `paused`): completed from the record, never closed out again. */
export function pendingCloseOut(events: readonly QueueEvent[]): PendingTransition | undefined {
  const last = events.findLast((e) => e.kind === "closed_out" || e.kind === "paused");
  const pending = last?.kind === "closed_out" ? (last.detail as Record<string, any> | null)?.pending : undefined;
  return pending && (pending.phase === "paused" || pending.phase === "ended") ? pending as PendingTransition : undefined;
}

/** Write a close-out's state transition: `paused` (`markPaused`) or the engine's end (`endEngine`). */
function applyTransition(queue: Queue, runId: string, t: PendingTransition): void {
  if (t.phase === "paused") queue.markPaused(runId, t.detail);
  else queue.endEngine(runId, t.state, t.reason, { detail: t.detail, ...(t.stop ? { stop: t.stop } : {}) });
}

/** The close-out as an event's detail: `pr` (the URL) or `no_changes`, and the `closeout` record. */
export function closeOutDetail(c: CloseOut): Record<string, unknown> {
  return {
    ...(c.pr ? { pr: c.pr } : {}), ...(c.no_changes ? { no_changes: true } : {}),
    closeout: {
      result: c.no_changes ? "no changes" : c.pr ? (c.draft ? "draft PR" : "PR") : "failed",
      commits: c.commits, ...(c.pushed ? { pushed: c.pushed } : {}), ...(c.error ? { error: c.error } : {}), worktree: c.worktree,
      ...(c.branch ? { branch: c.branch } : {}),
      ...(c.host_verify ? { host_verify: c.host_verify } : {}),
      ...(c.host_commit ? { host_commit: c.host_commit } : {}),
    },
  };
}

// ------------------------------------------------------------ the engine-end sweep

/** The engine statuses that end its life (launch.py TERMINAL_STATUSES). */
export const ENGINE_ENDED = ["finished", "stopped", "interrupted", "crashed"] as const;

/** A resumed run's end state from its engine's own terminal status (Story 27.3 consult ruling): `finished`
 * is `complete`; Story 33.7 (hole 59): a graceful `stopped` after the story it was driving landed
 * (`storyDone`, `storyLandedBeforeStop`) is `complete` too, as a first engine's graceful stop is; any other
 * end (`stopped` before its story landed, `interrupted`, `crashed`, a killed or gone engine) is `partial`
 * (as `finishStateFor` takes a status it does not know). */
export function engineEndState(status: unknown, storyDone = false): TerminalState {
  if (status === "finished") return "complete";
  return status === "stopped" && storyDone ? "complete" : "partial";
}

/** Story 33.7: did the engine land the story it was driving before it stopped? Reads the engine journal
 * `<journalDir>/journal.jsonl` (upstream bmad-loop, read only; unparsable lines skipped). The segment is the
 * entries after the latest `run-start` or `run-resume` (the whole file when there is none); true when the
 * segment's latest `story-start`/`story-done` entry is a `story-done` with a non-empty `story_key`. A missing
 * or unreadable journal answers false. Never throws. */
export function storyLandedBeforeStop(journalDir: string): boolean {
  let text: string;
  try { text = readFileSync(join(journalDir, "journal.jsonl"), "utf8"); } catch { return false; }
  const entries: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && !Array.isArray(e)) entries.push(e as Record<string, unknown>);
    } catch { /* an unparsable line is skipped */ }
  }
  const start = entries.findLastIndex((e) => e.kind === "run-start" || e.kind === "run-resume");
  const last = entries.slice(start + 1).findLast((e) => e.kind === "story-start" || e.kind === "story-done");
  return last?.kind === "story-done" && typeof last.story_key === "string" && last.story_key.trim() !== "";
}

export type EnginePhase = { phase: "ended" | "paused" | "running" | "unknown"; detail: Record<string, unknown> };

/** `launch.py status --directory <worktree> --run-id <id>`: ended (a terminal `run.status`), paused
 * (`paused_stage`/`paused_reason` on a live run, with `paused_story_key` when the engine names it), running,
 * or unknown (the probe failed). */
export async function engineStatus(worktree: string, engineRunId: string, deps: WorktreeDeps = {}, where?: EngineWhere): Promise<EnginePhase> {
  let res: RunResult;
  // Hole 38: an sbx run's engine lives in its sandbox, where bmad-loop is; the host has none by design.
  const sandbox = where?.tier === "sbx" && where.sandbox ? where.sandbox : null;
  try {
    res = sandbox
      ? await vmLaunchStatus(sandbox, worktree, engineRunId, sbxOf(deps))
      : await uvRunner(deps)(worktree, studioScript(deps, "lib", "launch.py"), ["status", "--directory", worktree, "--run-id", engineRunId], 120);
  } catch (e) { return { phase: "unknown", detail: { error: clip(message(e)) } }; }
  const out = lastJsonObject(res.stdout) as Record<string, any> | null;
  const run = out?.ok === true && out.run && typeof out.run === "object" ? out.run as Record<string, unknown> : null;
  if (!run) return { phase: "unknown", detail: { error: out?.error ? clip(String(out.error)) : failed(res) } };
  const status = String(run.status ?? "");
  const detail = { run_id: engineRunId, status, ...(run.paused_stage ? { paused_stage: run.paused_stage } : {}), ...(run.paused_reason ? { paused_reason: run.paused_reason } : {}),
    // Story 27.3: the story the engine paused on (launch.py `run.paused_story_key`), for the paused-run pass.
    ...(run.paused_story_key ? { paused_story_key: run.paused_story_key } : {}) };
  if ((ENGINE_ENDED as readonly string[]).includes(status)) return { phase: "ended", detail };
  if (run.paused_stage || run.paused_reason) return { phase: "paused", detail };
  return { phase: "running", detail };
}

/** The deferred `finish` of a launch run's studio run, at its engine's end: the deferred state and
 * reason, the launch status block (the PR URL added to its artifacts) and the metered cost. Story 34.3: the
 * playable-verify judge's cost (`playableCost`) goes as its own `--playable-verify-cost-usd` and is added into
 * `--total-cost-usd` when the engine's cost is metered; an unmetered engine cost leaves `--total-cost-usd` absent
 * (never zero-filled with the judge's alone). Never throws. */
async function finishStudio(
  run: QueueRun, state: string, reason: string | null, block: unknown, pr: string | undefined, engineCost: number | undefined, deps: WorktreeDeps,
  playableCost?: number,
): Promise<{ ok: boolean; detail: string }> {
  const cost = playableCost === undefined || engineCost === undefined ? engineCost : engineCost + playableCost;
  if (!run.studio_run_id) return { ok: false, detail: "no studio run recorded" };
  const b = block && typeof block === "object" ? { ...(block as Record<string, unknown>) } : undefined;
  if (b && pr) b.artifacts = [...(Array.isArray(b.artifacts) ? b.artifacts : []), pr];
  try {
    const out = await (deps.verbs ?? runJobVerb)(run.root, [
      "finish", "--directory", run.root, "--run-id", run.studio_run_id, "--state", state, ...(reason ? ["--reason", reason] : []),
      ...(b ? ["--status-block", JSON.stringify(b)] : []), ...(cost !== undefined ? ["--total-cost-usd", String(cost)] : []),
      ...(playableCost !== undefined ? ["--playable-verify-cost-usd", String(playableCost)] : []),
    ]);
    if (out.ok === false) return { ok: false, detail: `finish refused: ${clip(String(out.error ?? "refused"))}` };
    return { ok: true, detail: `studio run ${run.studio_run_id} finished ${typeof out.state === "string" ? out.state : state}` };
  } catch (e) { return { ok: false, detail: `finish failed: ${clip(message(e))}` }; }
}

/** Story 27.2: the engine the supervisor killed, by the run's recorded pid (start time matched): its last
 * `engine-kill` answered `killed` or `not running`, or an `engine-gone` recorded after a kill that left it
 * alive (`Queue.engineAliveAfterKill`, re-probed here first). An engine killed on TERM-ignore never writes a
 * terminal state, so its status would answer in-progress forever. Undefined: no such kill — or one still
 * alive or unreadable — and the engine's own status decides. Never throws. */
async function killedEngine(queue: Queue, r: QueueRun): Promise<Record<string, unknown> | undefined> {
  try {
    if (await queue.engineAliveAfterKill(r)) return undefined;
    const ev = queue.events(r.run_id).findLast((e) => e.kind === "engine-kill" || e.kind === "engine-gone");
    const d = (ev?.detail ?? {}) as Record<string, any>;
    const w = (ev?.kind === "engine-kill" ? d.worker : d) as Record<string, any> | undefined;
    if (!ev || !w || r.engine_pid == null || w.pid !== r.engine_pid || !sameStart(w.start, r.engine_start)) return undefined;
    if (ev.kind === "engine-kill" && w.outcome !== "killed" && w.outcome !== "not running") return undefined;
    return { pid: w.pid, start: w.start, by: ev.kind, ...(ev.kind === "engine-kill" ? { outcome: w.outcome } : { probe: d.probe }) };
  } catch { return undefined; }
}

/** The engine-end sweep (see the header). Idempotent: a run is taken atomically before its
 * close-out (`Queue.takeForCloseOut`), a paused run is not closed out again while still paused, and a
 * PR recorded on its `paused` event is marked ready, never opened twice. Answers the run ids it
 * closed out. Never throws. */
export async function sweepEngines(queue: Queue, deps: WorktreeDeps = {}): Promise<string[]> {
  const done: string[] = [];
  let runs: QueueRun[];
  try { runs = queue.awaitingEngine(); } catch { return done; }
  for (const r of runs) {
    let taken = false;
    try {
      if (isTerminal(r.state)) {
        // A terminal run whose close-out was skipped: closed out once nothing around it is live,
        // recorded as an appended `closed_out` event (the terminal row is never updated).
        if (await queue.closeOutBlocker(r)) continue;
        if (!queue.takeEndedCloseOut(r.run_id)) continue;
        taken = true; // a throw below lets go of its `closing-out` lease (`releaseCloseOut`)
        const events = queue.events(r.run_id);
        const existingPr = priorPr(events);
        // A recorded `host-verify` goes with it (a red draft never marked ready); the leg is never run here.
        const verify = recordedVerify(events);
        // Story 35.1: the body's `Legs:` history, from the recorded legs.
        const legs = verify ? legHistory(events) : [];
        const c = await closeOut(r, { paused: false, ...launchedCloseOutInput(events, r), ...(existingPr ? { existingPr } : {}), ...(verify ? { verify } : {}), ...(isSlice(queue.definition(r)) ? { slice: true } : {}), ...(legs.length ? { legs } : {}) }, deps);
        queue.note(r.run_id, "closed_out", closeOutDetail(c));
        // The worktree is gone: an engine lock this run still holds would be probed there forever.
        if (c.worktree === "removed") queue.releaseEngineLock(r.run_id, "its worktree was closed out and removed (its engine confirmed dead)");
        await release(queue, r.run_id, deps);
        done.push(r.run_id);
        continue;
      }
      const pending = pendingCloseOut(queue.events(r.run_id));
      if (pending) {
        // Its close-out already ran (the worktree may be gone): the recorded transition is written now —
        // no second push or PR, no probe of a removed worktree.
        const run = queue.takeForCloseOut(r.run_id);
        if (!run) continue;
        taken = true;
        applyTransition(queue, run.run_id, pending);
        if (pending.phase === "ended") await release(queue, run.run_id, deps);
        done.push(run.run_id);
        continue;
      }
      // Its worktree gone with no pending record (a close-out whose transition and record both failed):
      // no engine can run there, so it is closed out (from the checkout) and ended, never probed forever.
      let st: EnginePhase = existsSync(r.worktree!) ? await engineStatus(servedRoot(r)!, r.engine_run_id!, deps, { tier: r.tier, sandbox: r.sandbox })
        : { phase: "ended", detail: { run_id: r.engine_run_id, status: "unknown", gone: "its worktree is gone: no engine can run there" } };
      if (st.phase === "running" || st.phase === "unknown") {
        // An engine the supervisor killed (a tripped guard, its leader dead on KILL) never writes its end:
        // ended here, its launch's recorded end (the trip's state and guard reason) finishing the run.
        const killed = await killedEngine(queue, r);
        if (!killed) continue;
        st = { phase: "ended", detail: { ...st.detail, run_id: r.engine_run_id, killed } };
      }
      if (st.phase === "paused" && r.state === "paused") continue;
      const run = queue.takeForCloseOut(r.run_id);
      if (!run) continue;
      taken = true;
      const events = queue.events(run.run_id);
      const launched = (events.findLast((e) => e.kind === "launched")?.detail ?? {}) as Record<string, any>;
      const existingPr = priorPr(events);
      const paused = st.phase === "paused";
      // The status block and the metered cost, read before the close-out removes the worktree.
      const input = launchedCloseOutInput(events, run);
      // Story 27.4: an engine that completed on its own (not paused, not killed) gets the host verify leg,
      // run before the close-out pushes and opens the PR; one `host-verify` event, skipped or ran.
      // A `host-verify` already recorded for this engine completion is reused whatever a later kill says: the
      // leg never re-run (nor replaced by a `worktree gone` skip), no second event.
      let verify = paused ? undefined : recordedVerify(events);
      // An engine the supervisor killed runs no leg, its status ended (it handled TERM, or its worktree is
      // gone) or not (its end and reason computed as before).
      const notKilled = !st.detail.killed && !(await killedEngine(queue, run));
      // Story 34.8: a slice run, decided once here from the resolved definition, passed to the leg and the close-out.
      const slice = isSlice(queue.definition(run));
      if (!verify && !paused && notKilled) {
        const guardS = run.worker_guard_s ?? (Number(queue.definition(run)?.guards?.max_wall_clock_seconds) || 600);
        verify = await hostVerify(run, guardS, deps, slice ? { slice } : {});
        queue.note(run.run_id, "host-verify", verify as Record<string, unknown>);
      }
      // A resumed run (its `launched` written when the resolve child exited) or a relaunched one (its latest
      // `launched` after a `close-out`, from the relaunch's `mirror`): the end is the engine's own terminal
      // status, never the launch's recorded end. A killed relaunch keeps its recorded end (the trip's).
      const resumed = launched.resumed === true;
      const relaunched = !resumed && !st.detail.killed && events.findLastIndex((e) => e.kind === "close-out") >= 0
        && events.findLastIndex((e) => e.kind === "launched") > events.findLastIndex((e) => e.kind === "close-out");
      // Story 33.7 (hole 59): such an engine's graceful stop reads its journal (did the story it was driving
      // land?) before the close-out, which may remove the worktree. An engine the supervisor killed (it
      // handled TERM, so it reads `stopped`) never ends `complete` this way.
      // No served root (no worktree cut): no journal, so `partial`.
      const served = servedRoot(run);
      const storyDone = !paused && notKilled && (resumed || relaunched) && st.detail.status === "stopped" && !!run.engine_run_id
        && served !== null && storyLandedBeforeStop(join(served, ".bmad-loop", "runs", run.engine_run_id));
      // Story 35.1: the body's `Legs:` history (the close-out's first body: `Legs: 1 — close-out …`), from the recorded legs.
      const legs = verify ? legHistory(queue.events(run.run_id)) : [];
      const c = await closeOut(run, { paused, ...input, engineRunId: run.engine_run_id, ...(existingPr ? { existingPr } : {}), ...(verify ? { verify } : {}), ...(slice ? { slice } : {}), ...(legs.length ? { legs } : {}) }, deps);
      let next: PendingTransition;
      if (paused) next = { phase: "paused", detail: { engine: st.detail, ...closeOutDetail(c) } };
      else {
        const end = (launched.end ?? {}) as { state?: TerminalState; reason?: string | null; detail?: Record<string, unknown>; stop?: any };
        const engineEnd = resumed || relaunched ? String(st.detail.status ?? "unknown") : undefined;
        let state: TerminalState = engineEnd !== undefined ? engineEndState(engineEnd, storyDone) : end.state ?? "complete";
        let reason: string | null = engineEnd !== undefined ? (state === "complete" ? null : `${resumed ? "resumed" : "relaunched"} engine ended '${engineEnd}'`) : end.reason ?? null;
        // A red host verify ends the run `partial` naming the command, whatever end was computed (`ended` and `finish`).
        if (isRed(verify)) { state = "partial"; reason = redReason(verify); }
        // Story 34.3: the playable-verify judge's cost, its own ledger line (and counted in the total).
        const judgeCost = verify && !verify.skipped ? verify.playable?.judge?.cost_usd : undefined;
        const finish = await finishStudio(run, state, reason, launched.status_block, c.pr, input.costUsd, deps,
          typeof judgeCost === "number" && Number.isFinite(judgeCost) && judgeCost >= 0 ? judgeCost : undefined);
        next = { phase: "ended", state, reason, detail: { ...(end.detail ?? {}), engine: st.detail, ...closeOutDetail(c), finish }, ...(end.stop ? { stop: end.stop } : {}) };
      }
      try { applyTransition(queue, run.run_id, next); }
      catch (e) {
        // The close-out ran (pushed, a PR, the worktree perhaps removed): its result is never lost.
        if (e instanceof RunTerminal) {
          // Ended meanwhile (a cancel that lost the take, `closeout: skipped`): the close-out is this
          // terminal run's `closed_out`, so the late close-out never runs it again.
          queue.note(run.run_id, "closed_out", {
            ...closeOutDetail(c), engine: st.detail, ...(next.phase === "ended" ? { finish: next.detail.finish } : {}), raced: clip(message(e)),
          });
          if (c.worktree === "removed") queue.releaseEngineLock(run.run_id, "its worktree was closed out and removed (its engine confirmed dead)");
          if (next.phase === "ended") await release(queue, run.run_id, deps);
          done.push(run.run_id);
          continue;
        }
        // Anything else (the queue busy): the close-out recorded with its transition, which the next
        // sweep writes from the record.
        try { queue.note(run.run_id, "closed_out", { ...closeOutDetail(c), pending: next }); } catch { /* still busy: the next sweep probes again */ }
        throw e;
      }
      // The deferred `ended` releases the pin; a `paused` run keeps it (with its worktree and lock).
      if (next.phase === "ended") await release(queue, run.run_id, deps);
      done.push(run.run_id);
    } catch {
      // The next sweep probes it again: a run this sweep took is let go of first.
      if (taken) { try { queue.releaseCloseOut(r.run_id); } catch { /* the queue is busy: a dead owner is re-taken */ } }
    }
  }
  return done;
}
