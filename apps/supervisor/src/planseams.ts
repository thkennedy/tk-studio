/**
 * Story 36.7 (DW-85): the small seams the sweep and the plan passes share, in a leaf so `sweep.ts` never imports
 * `planstatus.ts` or `board.ts`. Every name is re-exported at its old home (`planstatus.ts`, `board.ts`, `hygiene.ts`),
 * except DW-87's `message`, `clip`, `failed` and `planEvents`: the plan passes' shared helpers, private to `planstatus.ts`
 * until moved here so `stagepass.ts` imports them without a module cycle, and not re-exported.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import type { QueueEvent } from "./queue";
import type { RunResult } from "./server";

/** Story 31.5: a project root's `planning.jira` binding — a non-empty `planning.jira.project_key` in its tracked
 * `.tk-studio/config.yaml` (read only; any read or parse failure is "not bound"). Story 38.4: moved here from
 * `closeout.ts` (re-exported there) so `sweep.ts` reads it without a module cycle. */
export function jiraBound(root: string): boolean {
  try {
    const doc = loadYaml(readFileSync(join(root, ".tk-studio", "config.yaml"), "utf-8")) as Record<string, any> | null;
    const key = doc?.planning?.jira?.project_key;
    return (typeof key === "string" && key.trim() !== "") || typeof key === "number";
  } catch { return false; }
}

/** The deferred-work ledger, relative to a project root. */
export const DEFERRED_REL = join("_bmad-output", "implementation-artifacts", "deferred-work.md");

/** Story 27.5: the released plan leases a phase may carry before its next retry gives up (a skipped `plan-status`). */
export const PLAN_RETRY_LIMIT = 24;

/** A GitHub pull-request URL (owner ≤39, repo ≤100 characters, GitHub's own limits); a trailing
 * path, query or fragment is matched but not kept. */
const GITHUB_PR = /^(https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/\d{1,12})(?:[/?#]\S*)?$/;

/** The canonical `https://github.com/<owner>/<repo>/pull/<n>` of a pull-request URL (any trailing
 * suffix dropped, so the notice's PR line is bounded), else undefined. */
export function canonicalPr(s: unknown): string | undefined {
  return typeof s === "string" ? GITHUB_PR.exec(s.trim())?.[1] : undefined;
}

/** The run's PR: `ended.detail.pr`, else the latest `closed_out.detail.pr` (a late close-out). */
export function runPr(events: readonly QueueEvent[]): string | undefined {
  const ended = canonicalPr(events.findLast((e) => e.kind === "ended")?.detail?.pr);
  if (ended) return ended;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== "closed_out") continue;
    const pr = canonicalPr(e.detail?.pr);
    if (pr) return pr;
  }
  return undefined;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const clip = (s: string, n = 300) => s.replace(/\/\/[^/@\s]+@/g, "//[redacted]@").trim().slice(0, n);
export const failed = (r: RunResult) => `exit ${r.exit}: ${clip(r.stderr || r.stdout)}`;

export const planEvents = (events: readonly QueueEvent[], phase: string) =>
  events.filter((e) => e.kind === "plan-status" && e.detail?.phase === phase);
