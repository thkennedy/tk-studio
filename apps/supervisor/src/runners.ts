/**
 * Story 36.7 (DW-85): the runner seams and the engine stop, in a leaf so `sweep.ts` and `closeout.ts` reach them without
 * `worktree.ts` or each other. `WorktreeDeps` is a type (erased). Re-exported from `worktree.ts` and `sweep.ts`.
 */
import { join } from "node:path";
import { ghBin, pluginRoot, sbxBin, studioRoot } from "./env";
import { servedRoot, type EngineWhere, type QueueRun } from "./queue";
import { runProcess, runUv, toVmPath, type RunResult } from "./server";
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

/** Story 36.3 (DW-120): `launch.py stop` for the engine at `root`, on the tier it runs on (`sbx exec` inside the sandbox,
 * else the host's `uvRunner`), `--graceful` on request: `stopped`, else the failure. Never throws. */
export async function stopEngineAt(root: string, eid: string, where: EngineWhere, deps: WorktreeDeps = {}, opts: { graceful?: boolean } = {}): Promise<string> {
  const env = deps.env ?? process.env, graceful = opts.graceful ? ["--graceful"] : [];
  let r: RunResult;
  try {
    if (where.tier === "sbx" && where.sandbox) {
      const argv = ["exec", where.sandbox, "uv", "run", `${toVmPath(studioRoot(env)).replace(/\/+$/, "")}/plugins/tk-studio/lib/launch.py`, "stop", "--directory", toVmPath(root), "--run-id", eid, ...graceful];
      r = await (deps.sbx?.run ?? ((b, a, o) => runProcess(b, a, { timeoutS: o.timeoutS })))(sbxBin(env), argv, { timeoutS: 120 });
    } else {
      r = await uvRunner(deps)(root, studioScript(deps, "lib", "launch.py"), ["stop", "--directory", root, "--run-id", eid, ...graceful], 120);
    }
  } catch (e) { return `stop failed: ${clip(message(e))}`; }
  return r.exit === 0 ? "stopped" : `stop failed: exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;
}

/** Story 36.3: a run's engine stopped on the run's tier (`stopEngineAt` at its served root). Never throws. */
export async function stopEngine(run: Pick<QueueRun, "worktree" | "prefix" | "engine_run_id" | "tier" | "sandbox">, deps: WorktreeDeps = {}, opts: { graceful?: boolean } = {}): Promise<string> {
  const served = servedRoot(run), eid = run.engine_run_id;
  if (!served || !eid) return "not stopped: no engine recorded";
  return stopEngineAt(served, eid, { tier: run.tier, sandbox: run.sandbox }, deps, opts);
}
