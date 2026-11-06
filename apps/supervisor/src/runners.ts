/**
 * Story 36.7 (DW-85): the runner seams and the engine stop, in a leaf so `sweep.ts` and `closeout.ts` reach them without
 * `worktree.ts` or each other. `WorktreeDeps` is a type (erased). Re-exported from `worktree.ts` and `sweep.ts`.
 */
import { join } from "node:path";
import { ghBin, pluginRoot, sbxBin, studioRoot } from "./env";
import { servedRoot, type EngineWhere, type QueueRun } from "./queue";
import { runProcess, runUv, toVmPath, type RunResult, type WorkerCommand } from "./server";
import type { CommandRunner, UvScriptRunner, WorktreeDeps } from "./worktree";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Command output for an event: URL userinfo redacted, clipped. */
const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);

export const runner = (deps: WorktreeDeps): CommandRunner =>
  deps.run ?? ((bin, args, opts) => runProcess(bin, args, { cwd: opts.cwd, timeoutS: opts.timeoutS, env: { ...(deps.env ?? process.env), ...(opts.env ?? {}) } }));
export const uvRunner = (deps: WorktreeDeps): UvScriptRunner => deps.uv ?? runUv;
export const studioScript = (deps: WorktreeDeps, ...rel: string[]) => join(pluginRoot(deps.env ?? process.env), ...rel);

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
export async function originGhRepo(deps: WorktreeDeps, cwd: string): Promise<string | undefined> {
  try {
    const r = await runner(deps)("git", ["remote", "get-url", "origin"], { cwd, timeoutS: 30 });
    return r.exit === 0 ? originRepo(r.stdout) : undefined;
  } catch { return undefined; }
}

/** `gh <args>` in `cwd`, pinned to origin's repository (`GH_REPO`); argv only. Story 27.5: exported for the merge pass. */
export async function gh(deps: WorktreeDeps, cwd: string, args: string[], timeoutS = 120): Promise<RunResult> {
  const repo = await originGhRepo(deps, cwd);
  return runner(deps)(ghBin(deps.env ?? process.env), args, { cwd, timeoutS, ...(repo ? { env: { GH_REPO: repo } } : {}) });
}

/** Story 37.6 (AC1, DW-162): the one argv of `launch.py stop` for the engine at `root`, on the tier `where` names, with
 * `--directory` always present: on sbx `sbx exec <sb> uv run <vm studio>/plugins/tk-studio/lib/launch.py stop --directory
 * <vm root> --run-id <eid> [--graceful]` (the POSIX tail joined after `toVmPath`, never a `path.join`: bcfa691), else
 * `uv run <pluginRoot>/lib/launch.py stop --directory <root> --run-id <eid> [--graceful]` on the host. Executed by
 * `stopEngineAt` and `cli.ts launchStopGraceful`, rendered as text by `closeout.ts gracefulStopCommand`. Throws
 * `StudioRootMissing`/`VmPathUnderivable` when a path cannot be derived; with `placeholders` (the text form only) the
 * studio root reads `<studio-root>` and an underivable VM root stays as recorded instead. */
export function engineStopArgv(root: string, eid: string, where: EngineWhere, opts: { graceful?: boolean; env?: Record<string, string | undefined>; placeholders?: boolean } = {}): WorkerCommand {
  const env = opts.env ?? process.env, graceful = opts.graceful ? ["--graceful"] : [];
  const attempt = (f: () => string, otherwise: string) => { if (!opts.placeholders) return f(); try { return f(); } catch { return otherwise; } };
  const tail = (script: string, dir: string) => ["run", script, "stop", "--directory", dir, "--run-id", eid, ...graceful];
  if (where.tier === "sbx" && where.sandbox) {
    const studio = attempt(() => toVmPath(studioRoot(env)).replace(/\/+$/, ""), "<studio-root>");
    return { bin: sbxBin(env), argv: ["exec", where.sandbox, "uv", ...tail(`${studio}/plugins/tk-studio/lib/launch.py`, attempt(() => toVmPath(root), root))] };
  }
  return { bin: "uv", argv: tail(join(attempt(() => pluginRoot(env), join("<studio-root>", "plugins", "tk-studio")), "lib", "launch.py"), root) };
}

/** Story 37.6: the builder's command run on its tier (`deps.sbx.run`, else `runProcess`, on sbx; the host's `uvRunner`,
 * cwd `root`), 120 s. Throws when the argv cannot be built or the process cannot be spawned. */
export async function runEngineStop(root: string, eid: string, where: EngineWhere, deps: WorktreeDeps = {}, opts: { graceful?: boolean } = {}): Promise<RunResult> {
  const cmd = engineStopArgv(root, eid, where, { graceful: opts.graceful, env: deps.env ?? process.env });
  if (where.tier === "sbx" && where.sandbox) return (deps.sbx?.run ?? ((b, a, o) => runProcess(b, a, { timeoutS: o.timeoutS })))(cmd.bin, cmd.argv, { timeoutS: 120 });
  return uvRunner(deps)(root, cmd.argv[1]!, cmd.argv.slice(2), 120);
}

/** Story 36.3 (DW-120): `launch.py stop` for the engine at `root`, on the tier it runs on (`runEngineStop`: the builder's
 * argv), `--graceful` on request: `stopped`, else the failure. Never throws. */
export async function stopEngineAt(root: string, eid: string, where: EngineWhere, deps: WorktreeDeps = {}, opts: { graceful?: boolean } = {}): Promise<string> {
  let r: RunResult;
  try { r = await runEngineStop(root, eid, where, deps, opts); }
  catch (e) { return `stop failed: ${clip(message(e))}`; }
  return r.exit === 0 ? "stopped" : `stop failed: exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;
}

/** Story 36.3: a run's engine stopped on the run's tier (`stopEngineAt` at its served root). Never throws. */
export async function stopEngine(run: Pick<QueueRun, "worktree" | "prefix" | "engine_run_id" | "tier" | "sandbox">, deps: WorktreeDeps = {}, opts: { graceful?: boolean } = {}): Promise<string> {
  const served = servedRoot(run), eid = run.engine_run_id;
  if (!served || !eid) return "not stopped: no engine recorded";
  return stopEngineAt(served, eid, { tier: run.tier, sandbox: run.sandbox }, deps, opts);
}
