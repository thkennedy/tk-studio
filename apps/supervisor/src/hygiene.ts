/**
 * hygiene.ts — the agent PC's run hygiene, built into the supervisor (Story 22.3).
 *
 *   snapshot   a run flagged editor-in-the-loop (`editor_in_the_loop: true` / `--editor-in-the-loop`)
 *              on a Godot project (`project.godot` in the root or a first-level folder) is copied,
 *              once per queue run, after the claim and before `wake`/`submit`:
 *              `robocopy <root> <TK_SUPERVISOR_WORK>/snapshots/<project id>/<queue run id> /E /R:3 /W:5`
 *              (never `/MIR`; bounded retries, so a locked file never holds the run for an hour;
 *              exit 0–7 is success, runbook §6). A work folder that is the project root or lies
 *              inside it is refused before robocopy (the copy would nest into itself). The path is
 *              a `snapshot` event on the run; a flagged non-Godot run takes none and a
 *              `snapshot-skipped` event says why.
 *   notify     every terminal run (complete, partial, blocked, cancelled, orphaned) sends one
 *              notification — ntfy (a POST to the topic URL) or Telegram (Bot API `sendMessage`),
 *              chosen by TK_SUPERVISOR_NOTIFY — naming the run, its state, its reason and its PR
 *              (a GitHub pull-request URL among the status block's `artifacts[]`) when there is one.
 *   transcript every terminal host run's session transcript is copied to TK_SUPERVISOR_TRANSCRIPT_BACKUP
 *              in the nightly layout (`<backup>/<slug>/<sid>.jsonl` + `<sid>/subagents/`), so the
 *              Story 21.6 restore finds it; an sbx transcript is VM-resident (skipped, recorded).
 *
 * The end hygiene is a bounded sweep (`sweepEnds`): each terminal run whose end no process has
 * claimed is leased atomically (`Queue.claimEnd`), outside any queue transaction, then notified
 * and copied, and the lease finalised (`Queue.finishEnd`) once both outcomes are recorded. A lease
 * left by a process that died before finalising, or whose outcome event could not be written, goes stale after END_LEASE_STALE_MS and a later sweep re-claims it. A send or
 * copy failure is an event; it never fails the run or changes its state.
 * Runs already terminal when the queue file gained the marker are never notified.
 *
 * Credentials (the Telegram bot token and its Bot API URL, the ntfy topic URL) never reach an
 * event, an error or a log.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, posix, win32 } from "node:path";
import { notifier, underBunTest, WorkDirMissing, workDir, type Notifier } from "./env";
import { canonicalPr } from "./planseams";
import type { Queue, QueueRun } from "./queue";
import { runProcess, type RunResult } from "./server";
import { isSweep, sweepNotice, sweepSummary } from "./sweep";
import { claudeConfigDir, locateTranscript, subagentTranscripts, transcriptBackupRoot } from "./transcript";

type Env = Record<string, string | undefined>;

/** The events the end hygiene writes after a run's ending event (from/to = its terminal state). */
export const END_HYGIENE_EVENTS = [
  "notified", "notify-failed", "notify-skipped", "transcript-copied", "transcript-copy-failed", "transcript-copy-skipped",
] as const;
type Runner = (bin: string, args: string[], timeoutS: number) => Promise<RunResult>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const defaultRunner: Runner = (bin, args, timeoutS) => runProcess(bin, args, { timeoutS });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ------------------------------------------------------------ the editor-in-the-loop snapshot

/** Where a Godot project's `project.godot` lies: the root, else the first first-level folder
 * (sorted) holding one; null when neither does. */
export function isGodot(root: string): string | null {
  if (existsSync(join(root, "project.godot"))) return join(root, "project.godot");
  let dirs: string[];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch { return null; }
  for (const d of dirs) if (existsSync(join(root, d, "project.godot"))) return join(root, d, "project.godot");
  return null;
}

/** `<work>/snapshots/<project id>/<queue run id>` (operator-decisions §3). */
export function snapshotTarget(work: string, projectId: string, runId: string): string {
  return join(work, "snapshots", projectId, runId);
}

/** robocopy's retry bounds: its defaults (1,000,000 retries, 30 s apart) would hold a run on one
 * locked file (the open Godot editor, OneDrive, an indexer) until SNAPSHOT_TIMEOUT_S. */
export const SNAPSHOT_RETRIES = ["/R:3", "/W:5"] as const;

/** The snapshot's argv: `robocopy <root> <target> /E /R:3 /W:5` — never `/MIR`. */
export function snapshotArgv(root: string, target: string): string[] {
  return [root, target, "/E", ...SNAPSHOT_RETRIES];
}

/** Whether `child` is `parent` or lies inside it (both resolved; case-insensitive on win32). */
export function isWithin(parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
  const path = platform === "win32" ? win32 : posix;
  const fold = (s: string) => (platform === "win32" ? path.resolve(s).toLowerCase() : path.resolve(s));
  const rel = path.relative(fold(parent), fold(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** robocopy's exit codes 0–7 are success (runbook §6); 8 and above are failures. */
export const robocopyOk = (exit: number | null): boolean => exit !== null && exit >= 0 && exit <= 7;

/** The robocopy timeout: a large project copies in minutes, never hours. */
export const SNAPSHOT_TIMEOUT_S = 3600;

/** One `robocopy /E` of `root` into `target`: ok with its exit code, or the failure named. A target
 * that is `root` or lies inside it is refused before robocopy runs (it would copy into itself). */
export async function snapshot(root: string, target: string, run: Runner = defaultRunner): Promise<{ ok: true; exit: number } | { ok: false; detail: string }> {
  if (isWithin(root, target)) return { ok: false, detail: "TK_SUPERVISOR_WORK is the project root or lies inside it: the snapshot would copy into itself" };
  let res: RunResult;
  try { res = await run("robocopy", snapshotArgv(root, target), SNAPSHOT_TIMEOUT_S); }
  catch (e) { return { ok: false, detail: `robocopy did not run: ${message(e).slice(0, 300)}` }; }
  if (!robocopyOk(res.exit)) return { ok: false, detail: `robocopy exited ${res.exit}` };
  return { ok: true, exit: res.exit! };
}

/** A snapshot that could not be taken: the flagged run ends `blocked` naming it before `wake`. */
export class SnapshotFailed extends Error {
  constructor(detail: string) { super(`snapshot failed: ${detail}`); this.name = "SnapshotFailed"; }
}

/** Once per queue run, after the claim and before the minting verb: a flagged run on a Godot
 * project is snapshot (`snapshot` event, `{path}`); a flagged non-Godot run records why it took
 * none (`snapshot-skipped`). A run that already has either event (adopted, resumed) takes none.
 * A failed snapshot throws `SnapshotFailed`. */
export async function snapshotOnce(
  queue: Queue, run: QueueRun, projectId: string, root: string, deps: { env?: Env; run?: Runner } = {},
): Promise<void> {
  if (!run.editor_in_the_loop) return;
  if (queue.events(run.run_id).some((e) => e.kind === "snapshot" || e.kind === "snapshot-skipped")) return;
  const godot = isGodot(root);
  if (!godot) {
    queue.note(run.run_id, "snapshot-skipped", { why: "not a Godot project: no project.godot in the root or a first-level folder" });
    return;
  }
  const work = workDir(deps.env ?? process.env);
  if (!work) throw new SnapshotFailed(new WorkDirMissing().message);
  const target = snapshotTarget(work, projectId, run.run_id);
  const done = await snapshot(root, target, deps.run);
  if (!done.ok) throw new SnapshotFailed(done.detail);
  queue.note(run.run_id, "snapshot", { path: target, project_godot: godot, exit: done.exit });
}

// ------------------------------------------------------------ the notification

export { canonicalPr, underBunTest };

/** The first GitHub pull-request URL among a status block's `artifacts[]`, canonical, else undefined. */
export function prUrl(block: unknown): string | undefined {
  const artifacts = block && typeof block === "object" ? (block as Record<string, unknown>).artifacts : undefined;
  if (!Array.isArray(artifacts)) return undefined;
  for (const a of artifacts) { const pr = canonicalPr(a); if (pr) return pr; }
  return undefined;
}

/** What a notification names. */
export interface EndNotice {
  run_id: string; job_id: string; project_id: string | null; studio_run_id: string | null;
  state: string; reason: string | null; pr?: string;
  /** Story 35.7: a sweep run's line content (`<landed>/<n> bundles; blocked: …; decisions: …`), from its ending event. */
  sweep?: string;
}

/** The notice of a terminal queue run: the PR from its ending event's detail (`mirror` records it). */
export function endNotice(queue: Queue, run: QueueRun): EndNotice {
  const events = queue.events(run.run_id);
  const ending = events.findLast((e) => e.kind === "ended" || e.kind === "orphaned");
  const pr = canonicalPr(ending?.detail?.pr);
  // A sweep's line from its ending event, else from its latest `closed_out` (a terminal run's late close-out), else
  // read live: a run made terminal before its close-out (a cancel) still has its worktree. Any failure omits the line.
  const notice = (d: Record<string, unknown> | null | undefined) => (d?.sweep as Record<string, unknown> | undefined)?.notice;
  let sweep = notice(ending?.detail) ?? notice(events.findLast((e) => e.kind === "closed_out" && notice(e.detail) !== undefined)?.detail);
  if (sweep === undefined) { try { if (isSweep(queue.definition(run))) sweep = sweepNotice(sweepSummary(queue, run)); } catch { /* no line */ } }
  return {
    run_id: run.run_id, job_id: run.job_id, project_id: run.project_id, studio_run_id: run.studio_run_id,
    state: run.state, reason: run.reason, ...(pr ? { pr } : {}), ...(typeof sweep === "string" && sweep ? { sweep } : {}),
  };
}

/** The notification text's cap, in UTF-8 bytes: under both Telegram `sendMessage`'s 4096-character
 * limit and ntfy's 4096-byte message limit (beyond which ntfy turns the body into an attachment). */
export const NOTICE_MAX_BYTES = 3800;
/** The marker a truncated reason ends with. */
export const TRUNCATED_MARKER = "… [reason truncated]";

const utf8Bytes = (s: string) => Buffer.byteLength(s, "utf-8");

/** The longest prefix of `s` (whole code points) within `budget` UTF-8 bytes. */
function clipBytes(s: string, budget: number): string {
  if (budget <= 0) return "";
  let out = "", used = 0;
  for (const ch of s) {
    const b = utf8Bytes(ch);
    if (used + b > budget) break;
    out += ch; used += b;
  }
  return out;
}

/** The notification text: the run, its state, its reason, and its PR when there is one — within
 * NOTICE_MAX_BYTES. Only the reason is ever cut (ending with TRUNCATED_MARKER); the run id, the
 * state and the PR are kept whole. Story 35.7: a sweep run adds one `sweep: …` line before the PR — omitted only
 * when the reason line as composed (after any clipping) already carries `sweep: <notice>` verbatim. */
export function noticeText(n: EndNotice): string {
  const head = `supervisor: run ${n.run_id} ended ${n.state}`;
  const job = `job: ${n.job_id}${n.project_id ? ` (project ${n.project_id})` : ""}${n.studio_run_id ? `, studio run ${n.studio_run_id}` : ""}`;
  const reason = n.reason ?? "none";
  const prLine = n.pr ? [`PR: ${n.pr}`] : [];
  const build = (tail: string[]): { text: string; reasonLine: string } => {
    const compose = (jobLine: string, r: string) => [head, ...(jobLine ? [jobLine] : []), `reason: ${r}`, ...tail].join("\n");
    const full = compose(job, reason);
    if (utf8Bytes(full) <= NOTICE_MAX_BYTES) return { text: full, reasonLine: reason };
    // The reason is cut first; the job line only when it alone overflows (ids are short in practice).
    const jobLine = utf8Bytes(compose(job, TRUNCATED_MARKER)) <= NOTICE_MAX_BYTES ? job : clipBytes(job, 300);
    const budget = NOTICE_MAX_BYTES - utf8Bytes(compose(jobLine, TRUNCATED_MARKER));
    const cut = `${clipBytes(reason, budget)}${TRUNCATED_MARKER}`;
    return { text: compose(jobLine, cut), reasonLine: cut };
  };
  if (!n.sweep) return build(prLine).text;
  const bare = build(prLine);
  if (bare.reasonLine.includes(`sweep: ${n.sweep}`)) return bare.text;
  return build([`sweep: ${clipBytes(n.sweep, 600)}`, ...prLine]).text;
}

const SEND_TIMEOUT_MS = 15_000;

/** The strings a notifier's failure must never carry (NFR5): the Telegram token and its Bot API
 * URL; the ntfy topic URL (the topic is its secret), whole and without its query, plus any
 * userinfo or `auth` query value in it. Longest first, so a URL is redacted before its parts. */
export function notifierSecrets(n: Exclude<Notifier, { kind: "none" }>): string[] {
  const out = new Set<string>();
  if (n.kind === "telegram") {
    out.add(`https://api.telegram.org/bot${n.token}/sendMessage`);
    out.add(`https://api.telegram.org/bot${n.token}`);
    out.add(n.token);
  } else {
    out.add(n.url);
    try {
      const u = new URL(n.url);
      out.add(u.href);
      out.add(`${u.origin}${u.pathname}`);
      out.add(`${u.host}${u.pathname}`);
      // A bare `%` (e.g. `a%zz`) is left as-is by the URL parser and throws in decodeURIComponent:
      // each part decodes in its own try, so the secrets after it are still added.
      for (const part of [u.username, u.password]) {
        if (!part) continue;
        out.add(part);
        try { out.add(decodeURIComponent(part)); } catch { /* not percent-encoded: the raw part is redacted */ }
      }
      if (u.username || u.password) out.add(`${u.username}${u.password ? `:${u.password}` : ""}@`);
      const auth = u.searchParams.get("auth");
      if (auth) { out.add(auth); out.add(encodeURIComponent(auth)); }
      const topic = u.pathname.split("/").filter(Boolean).at(-1);
      if (topic && topic.length >= 4) out.add(topic);
    } catch { /* not a URL: the whole value is still redacted */ }
  }
  return [...out].filter((x) => x.length > 0).sort((a, b) => b.length - a.length);
}

/** `s` with every notifier secret replaced by `[redacted]`. */
export function scrubNotifier(n: Exclude<Notifier, { kind: "none" }>, s: string): string {
  return notifierSecrets(n).reduce((acc, x) => acc.split(x).join("[redacted]"), s);
}

export const REFUSED_UNDER_TEST = "refused: a real notifier send under bun test (hole 31) — tests inject a fake fetch";

/** One send through the selected notifier. A failure is answered, never thrown, and never carries
 * the Telegram token, its Bot API URL, or the ntfy topic URL (or its credentials). */
export async function notify(
  n: Exclude<Notifier, { kind: "none" }>, notice: EndNotice, fetchFn: Fetch = fetch,
): Promise<{ ok: true; via: string } | { ok: false; via: string; error: string }> {
  return sendText(n, noticeText(notice), fetchFn);
}

/** One composed text through the selected notifier (`notify`'s send; Story 33.2's claim-refusal line too). */
export async function sendText(
  n: Exclude<Notifier, { kind: "none" }>, text: string, fetchFn: Fetch = fetch,
): Promise<{ ok: true; via: string } | { ok: false; via: string; error: string }> {
  if ((fetchFn as unknown) === globalThis.fetch && underBunTest()) return { ok: false, via: n.kind, error: REFUSED_UNDER_TEST };
  try {
    const res = n.kind === "ntfy"
      ? await fetchFn(n.url, { method: "POST", body: text, headers: { "content-type": "text/plain; charset=utf-8" }, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) })
      : await fetchFn(`https://api.telegram.org/bot${n.token}/sendMessage`, {
        method: "POST", body: JSON.stringify({ chat_id: n.chat, text }), headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    if (!res.ok) return { ok: false, via: n.kind, error: `HTTP ${res.status}` };
    return { ok: true, via: n.kind };
  } catch (e) {
    // Scrub before the cut: a cut could split a secret and leave a prefix of it unmatched.
    return { ok: false, via: n.kind, error: scrubNotifier(n, message(e)).slice(0, 300) };
  }
}

// ------------------------------------------------------------ Story 33.2: a claim the drain could not make

/** The one notifier line of a new claim refusal: the run id, the reason and what resolves it (within
 * NOTICE_MAX_BYTES; only the reason is ever cut). */
export function claimRefusedLine(runId: string, reason: string, resolves: string): string {
  const compose = (r: string) => `supervisor: run ${runId} stays queued, claim refused: ${r} — resolve: ${resolves}`;
  const flat = reason.replace(/\s*\r?\n\s*/g, " ");
  if (utf8Bytes(compose(flat)) <= NOTICE_MAX_BYTES) return compose(flat);
  return compose(`${clipBytes(flat, NOTICE_MAX_BYTES - utf8Bytes(compose(TRUNCATED_MARKER)))}${TRUNCATED_MARKER}`);
}

/** Story 33.2: record that a drain pass could not claim queued run `runId` (`Queue.refuseClaim`: one `claim-refused`
 * per distinct stable `key` — `pin-failed:<sandbox>`, `lock:<holder run_id>`, `max-login`,
 * `placement:<TierRefused|SbxSandboxMissing>` — a repeat updating `pass_at`, `reason` and `resolves` in place) and,
 * for a key new to the run's open episode only, send one notifier line naming the run and what resolves it; the
 * send's outcome lands on the event as `notify`. Never throws: answers whether the refusal was new. */
export async function recordClaimRefusal(
  queue: Queue, runId: string, key: string, reason: string, resolves: string, deps: HygieneDeps = {},
): Promise<boolean> {
  let fresh: { fresh: boolean; seq: number } | null;
  try { fresh = queue.refuseClaim(runId, key, reason, resolves); } catch { return false; }
  if (!fresh?.fresh) return false;
  let outcome: Record<string, unknown>;
  try {
    const selected = notifier(deps.env ?? process.env);
    outcome = selected.kind === "none"
      ? { ok: false, skipped: "no notifier configured (TK_SUPERVISOR_NOTIFY is unset)" }
      : await sendText(selected, claimRefusedLine(runId, reason, resolves), deps.fetch ?? fetch);
  } catch (e) { outcome = { ok: false, error: message(e).slice(0, 300) }; }
  try { queue.patchEventDetail(fresh.seq, { notify: outcome }); } catch { /* the event stands without it */ }
  return true;
}

// ------------------------------------------------------------ the per-run transcript copy

/** Copy a host session transcript into the backup root in the nightly layout:
 * `<backup>/<slug>/<sid>.jsonl`, with `<sid>/subagents/` when present. Answers the copied path. */
export function copyTranscript(sessionId: string, backupRoot: string, configDir: string = claudeConfigDir()): { path: string; subagents: number } {
  const source = locateTranscript(sessionId, configDir);
  const slug = basename(dirname(source));
  const to = join(backupRoot, slug);
  mkdirSync(to, { recursive: true });
  const path = join(to, `${sessionId}.jsonl`);
  copyFileSync(source, path);
  const subs = subagentTranscripts(source, sessionId);
  const from = join(dirname(source), sessionId, "subagents");
  if (existsSync(from)) cpSync(from, join(to, sessionId, "subagents"), { recursive: true });
  return { path, subagents: subs.length };
}

// ------------------------------------------------------------ the end sweep

export interface HygieneDeps {
  /** The environment the notifier, the backup root and the claude config dir are read from (default `process.env`). */
  env?: Env;
  /** The notifier's HTTP client (default the global `fetch`). */
  fetch?: Fetch;
}

const NOTIFY_OUTCOMES = new Set(["notified", "notify-failed", "notify-skipped"]);
const COPY_OUTCOMES = new Set(["transcript-copied", "transcript-copy-failed", "transcript-copy-skipped"]);

/** A run's end hygiene: the notification, then the transcript copy — each recorded as an
 * event on the run, never thrown, never changing its state. A stage whose outcome is already
 * recorded (a re-claimed stale lease: its claimant died after that stage) is not repeated.
 * Answers whether every outcome is recorded: false when one could not be (e.g. SQLITE_BUSY), so
 * the caller leaves the lease to go stale and be re-claimed rather than finalise it. */
export async function endHygiene(queue: Queue, run: QueueRun, deps: HygieneDeps = {}): Promise<boolean> {
  const env = deps.env ?? process.env;
  let recordedAll = true;
  const note = (kind: string, detail: Record<string, unknown>) => {
    try { queue.note(run.run_id, kind, detail); } catch { recordedAll = false; } // the run is gone, or the file is busy
  };
  try {
    const recorded = new Set(queue.events(run.run_id).map((e) => e.kind));
    if (![...NOTIFY_OUTCOMES].some((k) => recorded.has(k))) await notifyEnd(queue, run, env, note, deps.fetch);
    if (![...COPY_OUTCOMES].some((k) => recorded.has(k))) copyEnd(run, env, note);
  } catch { return false; }
  return recordedAll;
}

type Note = (kind: string, detail: Record<string, unknown>) => void;

async function notifyEnd(queue: Queue, run: QueueRun, env: Env, note: Note, fetchFn?: Fetch): Promise<void> {
  let selected: Notifier | undefined;
  try { selected = notifier(env); }
  catch (e) { note("notify-failed", { error: message(e) }); } // a named error: it names the variable, never a value
  if (selected?.kind === "none") note("notify-skipped", { why: "no notifier configured (TK_SUPERVISOR_NOTIFY is unset)" });
  else if (selected) {
    const notice = endNotice(queue, run);
    const sent = await notify(selected, notice, fetchFn);
    if (sent.ok) note("notified", { via: sent.via, state: notice.state, ...(notice.pr ? { pr: notice.pr } : {}) });
    else note("notify-failed", { via: sent.via, error: sent.error });
  }
}

function copyEnd(run: QueueRun, env: Env, note: Note): void {
  if (run.tier === "sbx") { note("transcript-copy-skipped", { why: "sbx: the session transcript is VM-resident; the host backup never covers it" }); return; }
  if (!run.session_id) { note("transcript-copy-skipped", { why: "no session recorded" }); return; }
  const backup = transcriptBackupRoot(env);
  if (!backup) { note("transcript-copy-failed", { session_id: run.session_id, error: "TK_SUPERVISOR_TRANSCRIPT_BACKUP is unset" }); return; }
  try {
    const copied = copyTranscript(run.session_id, backup, claudeConfigDir(env));
    note("transcript-copied", { session_id: run.session_id, path: copied.path, subagents: copied.subagents });
  } catch (e) {
    note("transcript-copy-failed", { session_id: run.session_id, error: message(e).slice(0, 300) });
  }
}

/** The bounded end sweep: every terminal run whose end is unclaimed, or whose lease is stale
 * (its claimant died between the claim and the send), is leased (`Queue.claimEnd`, atomic — one
 * live process per end), its hygiene run, and the lease finalised (`Queue.finishEnd`) once the
 * outcomes are recorded; a lease whose outcome could not be recorded is left to go stale and be
 * re-claimed (the stages already recorded are skipped then). `only` restricts it to those run ids (a cancel sweeps just its own run).
 * Called after each end in a driving process, after a cancel, and by `recover`/`drain`. Never throws. */
export async function sweepEnds(queue: Queue, deps: HygieneDeps = {}, only?: readonly string[]): Promise<string[]> {
  const handled: string[] = [];
  let ends: QueueRun[];
  try { ends = queue.unclaimedEnds(); } catch { return handled; }
  if (only) { const ids = new Set(only); ends = ends.filter((r) => ids.has(r.run_id)); }
  for (const r of ends) {
    try {
      const lease = queue.claimEnd(r.run_id);
      if (!lease) continue;
      if (!(await endHygiene(queue, queue.get(r.run_id) ?? r, deps))) continue; // the lease goes stale: re-claimed later
      queue.finishEnd(r.run_id, lease);
      handled.push(r.run_id);
    } catch { /* an unfinished lease goes stale: a later sweep re-claims it */ }
  }
  return handled;
}
