/**
 * Story 36.7 (DW-86): the one home of the supervisor's "a file at a git ref" read (`git show <ref>:<path>`). Argv only.
 *
 *   showAtBase  a run's base ref: `LC_ALL=C` so git's "does not exist" is matched in English, over stderr and stdout
 *               (`hostverify.ts`, `enginemcp.ts`). Each caller keeps its own clip of the failure text.
 *   atRef       a ref read through the caller's own spawner, stderr only, its environment as given (`planstatus.ts`,
 *               `delivery.ts`).
 */
import { runProcess, type RunResult } from "./server";

type Env = Record<string, string | undefined>;

export type AtBase = { text: string } | { missing: true } | { error: string };
export type AtRef = { text: string } | { absent: true } | { error: string };

export interface ShowAtBaseOpts {
  /** The base environment (`LC_ALL=C` is added; default `process.env`). */
  env?: Env;
  /** The `git` spawner (default `runProcess`, argv only). */
  git?: (args: string[], opts: { cwd: string; timeoutS: number; env: Env }) => Promise<RunResult>;
  /** How the failure text is clipped for an event (default: trimmed, 300 characters). */
  clip?: (s: string) => string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const redact = (s: string) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, 300);

/** A file at a run's base ref: its text; `missing` when git says the path is not there; `error` on any other failure. */
export async function showAtBase(root: string, ref: string, path: string, opts: ShowAtBaseOpts = {}): Promise<AtBase> {
  const env = { ...(opts.env ?? process.env), LC_ALL: "C" }, clip = opts.clip ?? redact;
  const args = ["show", `${ref}:${path}`];
  let res: RunResult;
  try {
    res = opts.git ? await opts.git(args, { cwd: root, timeoutS: 60, env }) : await runProcess("git", args, { cwd: root, timeoutS: 60, env });
  } catch (e) { return { error: `git show: ${clip(message(e))}` }; }
  if (res.exit === 0) return { text: res.stdout };
  const err = `${res.stderr}${res.stdout}`;
  if (/does not exist|exists on disk, but not in/i.test(err)) return { missing: true };
  return { error: `git show exited ${res.exit}: ${clip(err)}` };
}

/** A file at `ref` (`git show <ref>:<path>` in the checkout `root`): its text; `absent` when git says the path does
 * not exist at that ref; `error` on any other failure (the read is retried next tick). */
export async function atRef(root: string, ref: string, path: string, git: (args: string[]) => Promise<RunResult> = (args) => runProcess("git", args, { cwd: root, timeoutS: 60 })): Promise<AtRef> {
  let r: RunResult;
  try { r = await git(["show", `${ref}:${path}`]); }
  catch (e) { return { error: `git show: ${redact(message(e))}` }; }
  if (r.exit === 0) return { text: r.stdout };
  if (/does not exist in|exists on disk, but not in/i.test(r.stderr)) return { absent: true };
  return { error: `git show exit ${r.exit}: ${redact(r.stderr || r.stdout)}` };
}
