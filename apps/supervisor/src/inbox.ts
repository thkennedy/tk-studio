/**
 * The Issue screen's read and the owner's reply (Story 31.6, design spec §6.9 items 2 to 4, contract 0.1.26
 * additive). `api.ts` serves both; no HTTP here.
 *
 *   the issue read   `GET /inbox?project=<id>&issue=<KEY>`: 31.5's inbox answer narrowed to the matching item, plus
 *                    `issue {key, entity, title, status, run, cost_usd, comments[]}`:
 *                    - `entity` the plan entity (`<root>/_bmad-output/planning-artifacts/plan/{EP,ST,TA}-NNN.md`)
 *                      whose frontmatter `external.jira.key` is KEY, else null;
 *                    - `title` the item's, else the entity's, else null;
 *                    - `status` the entity's `external.jira.status`, else the item's `state`, else null;
 *                    - `run` the story's latest run as `GET /board` composes it (`{run_id, state, pr, host_verify,
 *                      ended_at}`), else null;
 *                    - `cost_usd` that run's ledger `job-run` `total_cost_usd` (`payload.run_id` = the queue run's
 *                      `studio_run_id`, the last line winning), else null (unmetered, or no run);
 *                    - `comments[]` the sync-back's `<root>/_bmad-output/tracking/<KEY>/comments.jsonl`: the last line
 *                      per `id` (an edit appends one), in `created` order, each `{id, author, update_author?, body,
 *                      created, updated}`.
 *                    A key not matching ISSUE_KEY_RE is BadIssue; one with no item, no entity and no comment log is
 *                    UnknownIssue; a registry or board read that fails is IssueReadFailed. A read: nothing is written.
 *   the reply        `POST /inbox/{key}/reply` `{project, body? | done?: true}`: the owner seat's three variables
 *                    checked on the supervisor's environment (after the User-environment fill, hole 60), then
 *                    `uv run <plugin>/lib/track.py reply --directory <registry root> --issue <KEY> --body-file <tmp>`
 *                    on the host — the body in a temp file (removed afterwards), never on the command line; the
 *                    owner's variables reach this one host child and never a worker or the sandbox (they sit outside
 *                    SBX_ENV_PASSTHROUGH_PREFIXES, and `buildWorkerEnv` strips every `TK_STUDIO_ATLASSIAN_OWNER_*`).
 *                    No queue event is written: the item leaves the inbox on the next
 *                    sync-back, which derives `Block Resolved` as `resolved`. Every `detail`/`reason` the reply
 *                    answers passes `redactReply`; replies to one `(project, key)` run one at a time.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BoardAnswer, ledgerPath } from "./board";
import { frontmatter } from "./closeout";
import { pluginRoot } from "./env";
import { readInbox, type InboxFile } from "./office";
import { redactCredentials } from "./page";
import { PLAN_REL } from "./planstatus";
import { lastJsonObject, runProcess, userEnvFromRegistry, type RunResult } from "./server";

type Env = Record<string, string | undefined>;

/** A Jira issue key (`TKS-12`). */
export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
/** The sync-back's tracking memory, relative to a project root. */
export const TRACKING_REL = join("_bmad-output", "tracking");
/** The owner seat (host-only) and the gateway's cloud id the reply needs, in the order a refusal names them. */
export const OWNER_SEAT_VARS = ["TK_STUDIO_ATLASSIAN_OWNER_EMAIL", "TK_STUDIO_ATLASSIAN_OWNER_TOKEN", "TK_ATLASSIAN_CLOUD_ID"] as const;
/** The reply body's ceiling (UTF-8 bytes). */
export const REPLY_MAX_BYTES = 32 * 1024;
/** What Done writes. */
export const DONE_BODY = "Done.";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ------------------------------------------------------------ the registry root (shared with `GET /inbox`)

/** The registry's projects (`registry.py show`: `{projects: {<id>: {root, …}}}`). */
export type RegistryShow = () => Promise<Record<string, any>>;

/** A served project's registry entry: `{root}` (null when the entry names none), or null when the registry does not
 * serve `project`. */
export async function registryRoot(project: string, registry: RegistryShow): Promise<{ root: string | null } | null> {
  const shown = await registry();
  const projects = shown?.projects && typeof shown.projects === "object" ? shown.projects as Record<string, any> : undefined;
  const entry = projects && Object.hasOwn(projects, project) ? projects[project] : undefined;
  if (!entry || typeof entry !== "object") return null;
  return { root: typeof entry.root === "string" && entry.root ? entry.root : null };
}

// ------------------------------------------------------------ the issue read (Settled shape 1)

export interface IssueComment { id: string; author: string | null; update_author?: string | null; body: string; created: string | null; updated: string | null }
export interface IssueRun { run_id: string; state: string; pr: string | null; host_verify: string | null; ended_at: string | null }
export interface IssueView {
  key: string; entity: string | null; title: string | null; status: string | null; run: IssueRun | null; cost_usd: number | null;
  comments: IssueComment[];
}
export interface IssueAnswer { ok: true; project: string; generated_at: string | null; items: Record<string, unknown>[]; issue: IssueView }
export type IssueReadResult =
  | { ok: true; answer: IssueAnswer }
  | { ok: false; error: "UnknownProject" | "BadIssue" | "UnknownIssue" }
  | { ok: false; error: "IssueReadFailed"; detail: string };

export interface IssueReadDeps {
  registry: RegistryShow;
  /** The board builder `GET /board` uses (the story's latest run), null for a project it does not serve. */
  board: (project: string) => Promise<BoardAnswer | null>;
  /** A queue run's `studio_run_id` (the ledger's `payload.run_id`), null when unknown. */
  studioRunId: (runId: string) => string | null;
  /** The store root and the ledger identity's variables (default `process.env`). */
  env?: Env;
  ledger?: { user: string; machine: string };
}

const ENTITY_RE = /^(EP|ST|TA)-\d{3,}\.md$/;

/** The plan entity whose `external.jira.key` is `key`: its id, title and Jira status; null with none. */
export function entityForKey(root: string, key: string): { id: string; title: string | null; status: string | null } | null {
  const dir = join(root, PLAN_REL);
  let names: string[];
  try { names = readdirSync(dir).filter((n) => ENTITY_RE.test(n)).sort(); } catch { return null; }
  for (const n of names) {
    let fm: Record<string, unknown>;
    try { fm = frontmatter(readFileSync(join(dir, n), "utf-8")); } catch { continue; }
    const jira = isObject(fm.external) && isObject(fm.external.jira) ? fm.external.jira : null;
    if (!jira || str(jira.key) !== key) continue;
    return { id: str(fm.id) ?? n.slice(0, -3), title: str(fm.title), status: str(jira.status) };
  }
  return null;
}

/** A Jira stamp (`…+0000`) or an ISO one, as epoch ms; NaN when unparsable. */
const stampMs = (s: string | null): number => (s ? Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN);

/** The comment log of `key` (see the header); null when the file is absent. */
export function readComments(root: string, key: string): IssueComment[] | null {
  const path = join(root, TRACKING_REL, key, "comments.jsonl");
  let text: string;
  try { text = readFileSync(path, "utf-8"); } catch { return existsSync(path) ? [] : null; }
  const last = new Map<string, { order: number; c: IssueComment }>();
  let order = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: unknown;
    try { o = JSON.parse(line); } catch { continue; }
    if (!isObject(o) || o.id === undefined || o.id === null) continue;
    const id = String(o.id);
    const c: IssueComment = {
      id, author: str(o.author), body: typeof o.body === "string" ? o.body : "",
      created: str(o.created), updated: str(o.updated) ?? str(o.created),
    };
    if ("update_author" in o) c.update_author = str(o.update_author);
    const first = last.get(id)?.order ?? order++;
    last.set(id, { order: first, c });
  }
  return [...last.values()].sort((a, b) => {
    const ta = stampMs(a.c.created), tb = stampMs(b.c.created);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return a.order - b.order;
  }).map((x) => x.c);
}

/** The ledger's `job-run` `total_cost_usd` for `studioRunId`, the last line winning; null when absent or unmetered. */
export function runCost(ledgerFile: string, studioRunId: string): number | null {
  let text: string;
  try { if (!statSync(ledgerFile).isFile()) return null; text = readFileSync(ledgerFile, "utf-8"); } catch { return null; }
  let cost: number | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || !line.includes(studioRunId)) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.event !== "job-run" || !isObject(o.payload) || o.payload.run_id !== studioRunId) continue;
    const c = o.payload.total_cost_usd;
    cost = typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
  }
  return cost;
}

/** The issue read (see the header). Never throws: a registry, board or file read that fails is IssueReadFailed. */
export async function issueRead(project: string, key: string, deps: IssueReadDeps): Promise<IssueReadResult> {
  if (!ISSUE_KEY_RE.test(key)) return { ok: false, error: "BadIssue" };
  try { return await issueReadUnguarded(project, key, deps); }
  catch (e) { return { ok: false, error: "IssueReadFailed", detail: (e instanceof Error ? e.message : String(e)).trim().slice(0, 500) }; }
}

async function issueReadUnguarded(project: string, key: string, deps: IssueReadDeps): Promise<IssueReadResult> {
  const served = await registryRoot(project, deps.registry);
  if (!served) return { ok: false, error: "UnknownProject" };
  const file: InboxFile = readInbox(served.root);
  const items = file.items.filter((i) => i.issue === key);
  const item = items[0];
  const entity = served.root ? entityForKey(served.root, key) : null;
  const comments = served.root ? readComments(served.root, key) : null;
  if (!item && !entity && comments === null) return { ok: false, error: "UnknownIssue" };

  let run: IssueRun | null = null;
  if (entity) {
    const board = await deps.board(project);
    for (const ep of board?.epics ?? []) {
      const story = ep.stories.find((s) => s.id === entity.id);
      if (story?.run) { run = { ...story.run }; break; }
    }
  }
  let cost: number | null = null;
  if (run) {
    const studio = deps.studioRunId(run.run_id);
    if (studio) cost = runCost(ledgerPath(deps.env ?? process.env, deps.ledger), studio);
  }
  return {
    ok: true,
    answer: {
      ok: true, project, generated_at: file.generated_at, items: item ? [item] : [],
      issue: {
        key, entity: entity?.id ?? null, title: str(item?.title) ?? entity?.title ?? null,
        status: entity?.status ?? str(item?.state) ?? null, run, cost_usd: cost, comments: comments ?? [],
      },
    },
  };
}

// ------------------------------------------------------------ the reply (Settled shape 2)

export interface ReplyBody { project: string; body?: string; done?: true }

/** The reply body: a JSON object `{project, body?, done?}` with exactly one of a non-empty `body` (at most
 * REPLY_MAX_BYTES UTF-8) or `done: true`. */
export function checkReplyBody(raw: unknown): { ok: true; body: ReplyBody } | { ok: false; detail: string } {
  if (!isObject(raw)) return { ok: false, detail: "the body must be a JSON object" };
  for (const k of Object.keys(raw)) {
    if (!["project", "body", "done"].includes(k)) return { ok: false, detail: `unknown field '${k}' (allowed: project, body, done)` };
  }
  if (typeof raw.project !== "string" || !raw.project.trim()) return { ok: false, detail: "field 'project' must be a non-empty string" };
  const hasBody = "body" in raw, hasDone = "done" in raw;
  if (hasBody === hasDone) return { ok: false, detail: "give exactly one of 'body' and 'done: true'" };
  if (hasDone) {
    if (raw.done !== true) return { ok: false, detail: "field 'done' must be true" };
    return { ok: true, body: { project: raw.project.trim(), done: true } };
  }
  if (typeof raw.body !== "string" || !raw.body.trim()) return { ok: false, detail: "field 'body' must be a non-empty string" };
  if (Buffer.byteLength(raw.body, "utf-8") > REPLY_MAX_BYTES) {
    return { ok: false, detail: `field 'body' exceeds ${REPLY_MAX_BYTES} bytes (UTF-8)` };
  }
  return { ok: true, body: { project: raw.project.trim(), body: raw.body } };
}

/** The verb's runner: `uv run <script> <args>` in `root` with exactly `env` (tests inject one). */
export type ReplyRunner = (root: string, script: string, args: string[], env: Env, timeoutS: number) => Promise<RunResult>;

const runUvWith: ReplyRunner = (root, script, args, env, timeoutS) =>
  runProcess("uv", ["run", script, ...args], { cwd: root, timeoutS, env: { ...env, PYTHONIOENCODING: "utf-8" } });

export interface ReplyDeps {
  registry: RegistryShow;
  /** The supervisor's environment (default `process.env`). */
  env?: Env;
  /** Hole 60: the User environment (default `userEnvFromRegistry`; `{}` off win32 and under `bun test`). */
  userEnv?: () => Record<string, string>;
  run?: ReplyRunner;
  /** The temp directory the body file is written under (default the OS's). */
  tmp?: string;
}

export interface ReplyAnswer { status: number; body: Record<string, unknown> }

/** The reply's environment: the supervisor's, with each of OWNER_SEAT_VARS it lacks filled from the User
 * environment (a `setx` reaches a running supervisor). */
export function replyEnv(env: Env, userEnv: Record<string, string>): Env {
  const out = { ...env };
  for (const k of OWNER_SEAT_VARS) if (!out[k]?.trim() && userEnv[k]?.trim()) out[k] = userEnv[k];
  return out;
}

const clip = (s: string, n = 500) => s.trim().slice(0, n);

/** `track.py reply` argv (argv only, no shell; the body is in the file). */
export const replyArgs = (root: string, key: string, bodyFile: string): string[] =>
  ["reply", "--directory", root, "--issue", key, "--body-file", bodyFile];

/** `text` with every credential value of `env` replaced by `[redacted]`: the owner seat's (OWNER_SEAT_VARS) and
 * each non-empty `*TOKEN*` / `*SECRET*` / `*PASSWORD*` variable's, then the supervisor's own shapes
 * (`redactCredentials`). The child's output never carries the owner's token back to the HTTP caller. */
export function redactReply(text: string, env: Env): string {
  const names = (k: string) => (OWNER_SEAT_VARS as readonly string[]).includes(k) || /TOKEN|SECRET|PASSWORD/i.test(k);
  const exact = Object.entries(env).filter(([k]) => names(k)).map(([, v]) => v?.trim() ?? "")
    .filter((v) => v.length > 0).sort((a, b) => b.length - a.length);
  let out = text;
  for (const v of exact) out = out.split(v).join("[redacted]");
  return redactCredentials(out, env, "");
}

/** In-flight replies per `(project, issue key)`: a second reply to the same issue waits for the first to settle,
 * then runs as itself — so the verb's own check (`owner_reply_in_place`) sees the first's comment and skips a
 * duplicate (two tabs pressing Done). The entry is dropped once its chain drains. */
const replyChains = new Map<string, Promise<unknown>>();

/** The reply (see the header): never throws. Replies to one issue run one at a time. */
export async function postReply(key: string, body: ReplyBody, deps: ReplyDeps): Promise<ReplyAnswer> {
  if (!ISSUE_KEY_RE.test(key)) return { status: 400, body: { ok: false, error: "BadIssue", issue: key } };
  const slot = JSON.stringify([body.project, key]);
  const run = () => postReplyNow(key, body, deps);
  const mine = (replyChains.get(slot) ?? Promise.resolve()).then(run, run);
  const tail = mine.catch(() => undefined);
  replyChains.set(slot, tail);
  try { return await mine; } finally { if (replyChains.get(slot) === tail) replyChains.delete(slot); }
}

async function postReplyNow(key: string, body: ReplyBody, deps: ReplyDeps): Promise<ReplyAnswer> {
  let secrets: Env = deps.env ?? process.env;
  // redacted before the clip, so a value cut at the edge cannot slip through half-matched
  const scrub = (v: unknown) => (typeof v === "string" ? clip(redactReply(v, secrets)) : v);
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ReplyAnswer => {
    const out: Record<string, unknown> = { ...extra };
    if ("detail" in out) out.detail = scrub(out.detail);
    if ("reason" in out) out.reason = scrub(out.reason);
    return { status, body: { ok: false, error, ...out } };
  };
  let served: { root: string | null } | null;
  try { served = await registryRoot(body.project, deps.registry); } catch (e) { return fail(500, "ReplyFailed", { detail: String(e) }); }
  if (!served || !served.root) return fail(404, "UnknownProject", { project: body.project });
  const env = replyEnv(deps.env ?? process.env, (deps.userEnv ?? userEnvFromRegistry)());
  secrets = env;
  const missing = OWNER_SEAT_VARS.filter((k) => !env[k]?.trim());
  if (missing.length) {
    return fail(409, "OwnerSeatMissing", {
      missing, detail: `the owner seat is not configured on the host: ${missing.join(", ")} — set them (setx) for the supervisor; the reply is never posted with another identity`,
    });
  }
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(deps.tmp ?? tmpdir(), "tk-sup-reply-"));
    const file = join(dir, "body.txt");
    writeFileSync(file, body.done ? DONE_BODY : body.body!, { encoding: "utf-8", mode: 0o600 });
    let r: RunResult;
    try {
      r = await (deps.run ?? runUvWith)(served.root, join(pluginRoot(env), "lib", "track.py"), replyArgs(served.root, key, file), env, 120);
    } catch (e) {
      return fail(500, "ReplyFailed", { detail: e instanceof Error ? e.message : String(e) });
    }
    const out = lastJsonObject(r.stdout) as Record<string, any> | null;
    if (!out || typeof out.status !== "string") {
      return fail(500, "ReplyFailed", { detail: `track.py reply emitted no JSON (exit ${r.exit}): ${r.stderr}` });
    }
    const reason = typeof out.reason === "string" ? out.reason : null;
    if (out.retry === true) return fail(503, "ReplyRetry", { reason, commented: out.commented === true });
    if (out.status === "blocked") return fail(409, "ReplyRefused", { reason, commented: out.commented === true });
    if (out.ok !== true) return fail(500, "ReplyFailed", { reason, status: out.status });
    return {
      status: 200,
      body: { ok: true, project: body.project, issue: key, commented: out.commented === true, transitioned: out.transitioned === true, status: out.status },
    };
  } catch (e) {
    return fail(500, "ReplyFailed", { detail: e instanceof Error ? e.message : String(e) });
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
}
