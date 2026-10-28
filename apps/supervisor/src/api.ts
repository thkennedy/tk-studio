/**
 * The supervisor's HTTP API (Story 22.1) — the operator away from the box
 * submits, watches and cancels runs over the tailnet.
 *
 *   bun src/cli.ts serve
 *
 * Binds only TK_SUPERVISOR_BIND (an IPv4 literal inside 100.64.0.0/10, never
 * 0.0.0.0) on TK_SUPERVISOR_PORT (default 8787); every route — an unknown
 * path too — answers 401 unless `Authorization: Bearer <TK_SUPERVISOR_TOKEN>`
 * (compared in constant time). The token and the header never appear in a
 * log line, an answer or an event.
 *
 *   POST /jobs               {project, job, base_ref?, tier?, model?, effort?, editor_in_the_loop?}
 *                            → the CLI's own submit path (`submitProject` → `submitJob` → `enqueue`);
 *                            a flagged run with no TK_SUPERVISOR_WORK is 400 WorkDirMissing (Story 22.3)
 *   GET  /jobs               the submitted jobs
 *   GET  /runs/{id}          the queue run and its events (kinds and details as stored); Story 32.7 (0.1.27 additive):
 *                            `cost_usd` — the ledger `job-run` `total_cost_usd` of its `studio_run_id`, else null
 *   POST /runs/{id}/cancel   ends the run `cancelled` (`cancelRun`); 409 once terminal; 409 ExternalRun on an
 *                            external run (Story 27.2: started outside the queue, never cancelled here)
 *   POST /runs/{id}/resume   {restore_patch?} (Story 27.3, bearer only): a paused run whose story did not land is
 *                            resumed (`resumeRun`: `bmad-loop resolve … --resume`); 200 {ok, run_id, state, engine_run_id},
 *                            400 SchemaError | MalformedJson, 404 RunNotFound, 409 RunNotPaused | ExternalRun | StoryLanded,
 *                            500 ResumeFailed
 *   POST /runs/{id}/verify   {} (Story 33.8, `hostleg.ts`, bearer only): an ended run's host leg re-run — a fresh worktree
 *                            cut on its run branch at the pushed tip, `verify.host` run there as the close-out does (Story
 *                            35.1: a whole leg — a slice run's placed art and proof committed and pushed, an open PR's body
 *                            regenerated with the latest leg and its `Legs:` history, a draft marked ready on green, a
 *                            ready PR back to a draft on red), a new `host-verify` event (`rerun`), the worktree removed;
 *                            the run's state unchanged. 202 {ok, run_id, state, verify: "started", head}, 400 SchemaError |
 *                            MalformedJson, 404 RunNotFound, 409 ExternalRun | RunNotEnded | NoBranch | VerifyRunning,
 *                            500 VerifyFailed
 *   GET  /status             counts per state, the live runs, the held checkout locks (JSON); Story 30.6: content-negotiated —
 *                            an `Accept` naming `text/html` answers the read-only status page (`page.ts`), any other
 *                            `Accept` (none, the wildcard, `application/json`) this JSON unchanged; both `vary: Accept`
 *   GET  /events?since=<seq> events with seq > since: JSON, or SSE with
 *                            `Accept: text/event-stream`
 *   GET  /agents[?project=<id>]  the agent registry (Story 29.2, `registry.ts`): {ok, rebuilt_at, agents}, one row per
 *                            (project, role); an unknown project answers `agents: []`. A read only: never rebuilds
 *   GET  /office             the office projection (Story 29.3, `office.ts`): {ok, at, agents, runs, last_run, problems,
 *                            id} — each registry agent's graced state and its `reason` (0.1.25), the live runs with
 *                            story and epic progress, `last_run` the last ended run keyed by project (0.1.25); Story
 *                            30.6 (0.1.25, additive): `supervisor {version, counts}` (package.json's version, the
 *                            `/status` counts) and `ledger {path, lines}` | `{path, note}` (the page's ledger tail,
 *                            redacted), here, in the JSON `/office/events` and in the stream's `event:snapshot` only
 *   GET  /board?project=<id> the board (Story 30.5, `board.ts`, contract 0.1.25): {ok, project, built_at, plan, epics,
 *                            triage} — the served project's plan epics and stories with their statuses, each story's
 *                            latest run and open findings, per epic the metered spend against its band, and the
 *                            Needs-you / Working / Done triage of its runs; 400 ProjectRequired, 404 UnknownProject
 *   GET  /inbox?project=<id> the inbox (Story 31.5, contract 0.1.26 additive): {ok, project, generated_at, items} — the
 *                            served project's `_bmad-output/tracking/inbox.json` (the sync-back's) items exactly as
 *                            written; a missing file is `items: []` with `generated_at: null`, never a 404; 400
 *                            ProjectRequired, 404 UnknownProject (an unregistered project). Readable by the cookie too.
 *                            Story 31.6 (0.1.26 additive): `&issue=<KEY>` is the Issue screen's read (`inbox.ts`
 *                            `issueRead`): {ok, project, generated_at, items (the matching item only), issue {key, entity,
 *                            title, status, run, cost_usd, comments[]}}; 400 BadIssue, 404 UnknownIssue, 500 IssueReadFailed. On a cookie
 *                            session every `GET /inbox` answer carries the session's CSRF token in `X-CSRF-Token`
 *   POST /inbox/{key}/reply  {project, body? | done?: true} (Story 31.6, `inbox.ts` `postReply`): the owner's reply, or
 *                            Done (`Done.`), posted on the host by `track.py reply` with the owner seat's host-only token
 *                            (the body in a temp file, never on the command line); 200 {ok, project, issue, commented,
 *                            transitioned, status}, 400 SchemaError | MalformedJson | BadIssue, 403 CsrfRefused (a cookie
 *                            session without `X-CSRF-Token`), 404 UnknownProject, 409 OwnerSeatMissing {missing} (no
 *                            spawn) | ReplyRefused {reason, commented}, 503 ReplyRetry {reason, commented}, 500 ReplyFailed. No queue event
 *   GET  /office/events      with `Accept: text/event-stream`: `event:snapshot` first (or, for a valid `Last-Event-ID`,
 *                            the buffered deltas after it), then `office.agent` / `office.progress` / `office.run`
 *                            deltas (`id:<boot>-<seq>`), a `: heartbeat` comment every 10 s; without it the JSON snapshot.
 *                            Story 32.1 (0.1.27 additive): the snapshot's `engagements[]` and `office.engagement` deltas
 *   POST /engagements        {project, request} (Story 32.1, `engagement.ts`, contract 0.1.27 additive): mints `ENG-NNN`
 *                            from the plan counter's `engagement` series and writes `_bmad-output/engagements/<id>/
 *                            engagement.yaml` in the served root in state `intake`; one `engagement` service event
 *                            {id, project, state, from: null, source} (no queue run); 200 {ok, engagement}; 400
 *                            SchemaError | MalformedJson, 403 CsrfRefused (a cookie session without `X-CSRF-Token`), 404
 *                            UnknownProject, 500 EngagementRootMissing (no root, or a root not on disk: nothing created) |
 *                            EngagementCounterInvalid. Story 32.8: `follows?: "ENG-NNN"` (a change after delivery: a new
 *                            engagement with its own quote) — not an engagement id 400 SchemaError; no such record in the
 *                            same served project 404 UnknownEngagement {engagement}; unreadable (not JSON, not a record) 500
 *                            EngagementRecordInvalid {project, engagement, detail}; not `delivered` 409
 *                            FollowsNotDelivered {engagement, state}; the new record carries `follows`, the previous one
 *                            is never touched
 *   GET  /engagements?project=<id>  {ok, project, engagements, problems}: the project's records newest first; 400
 *                            ProjectRequired, 404 UnknownProject
 *   GET  /engagements/{id}   {ok, project, engagement, chat {route, path, last_seq}} ([?project=<id>] skips the registry
 *                            scan); 400 BadEngagement, 404 UnknownEngagement, 409 AmbiguousEngagement {engagement,
 *                            projects[]} (no `?project=` and more than one holder), 500 EngagementRecordInvalid
 *   POST /engagements/{id}/input  {verb, …} (`answer`, `go`, `revise`, `question`, `approve`, `cancel`, each typed): one
 *                            row of `TRANSITIONS`, logged in `inputs[]` with its source (`bearer` | `cookie`), then the
 *                            `engagement` service event {id, project, state, from, verb, source}; 200 {ok, engagement,
 *                            from, to}; 400 SchemaError | MalformedJson | BadEngagement, 403 CsrfRefused (a cookie session
 *                            without `X-CSRF-Token`), 404 UnknownEngagement, 409 IllegalInput {state, verb, detail?} |
 *                            EngagementClosed {state, verb} | AmbiguousEngagement {engagement, projects[]}, 500
 *                            EngagementRecordInvalid
 *   GET  /                   Story 30.6: the home — the built web's `index.html` (as `GET /app`, `no-store`); with no
 *                            built web the read-only status page (Story 22.2, `page.ts`: server-rendered HTML, no
 *                            script, credential-shaped values redacted) with its "not built" note, never a 503
 *   GET  /app[/…]            the studio web (Story 30.2, `web.ts`): the built web's file (its content type), or
 *                            `index.html` for a path with no file (the single-page fallback); a traversal (`..`,
 *                            an absolute path, `\`, `:`, NUL, a bad escape) 404 NotFound; no built web 503
 *                            WebNotBuilt {command}. Every answer `cache-control: no-store`
 *
 * Story 22.5 (`auth.ts`), Story 29.1 (`account.ts`): a browser signs in at `POST /auth/token`,
 * `POST /auth/account` (the owner's one account, created once) or `POST /auth/signin` (its username and
 * password, rate-limited with a lockout), all answered before any auth, and gets a signed session cookie.
 * The bearer header still authorises everything. Without it, a valid cookie authorises the GET routes, and
 * `POST /runs/{id}/cancel`, (Story 31.6) `POST /inbox/{key}/reply` and (Story 32.1) `POST /engagements` and
 * `POST /engagements/{id}/input` with the page's CSRF token (else 403 CsrfRefused); never `POST /jobs`.
 * `GET /` with no auth is the 401 HTML sign-in page (account creation while no account exists); so is a
 * `GET /app[/…]` (Story 30.2) and an HTML `GET /status` (Story 30.6; a non-HTML one stays 401 JSON), their forms
 * carrying the requested path and query as `next`, where a successful
 * form sign-in returns (`303`; a `next` that is not a same-origin path returns to `/`). Everything else
 * stays 401 JSON.
 *
 * Run ids are queue run ids; answers carry `studio_run_id` too. The API never
 * drives or claims a run (drain and the pacer do).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_RELATIVE_PATH, AccountExists, AccountInvalid, accountPath, AccountRecordInvalid, createAccount, lockState, readAccount,
  SIGNIN_DELAY_MS, verifyPassword,
} from "./account";
import {
  csrfToken, readCookie, safeEqual, sessionSubAccepted, SESSION_COOKIE, SESSION_TTL_S, setCookie, signInPage, type SignInMode, signSession, USERNAME_RE, verifySession,
} from "./auth";
import { boardFor, ledgerPath, type BoardAnswer } from "./board";
import { appendChatLineHeld, ChatBusy, chatSince, checkChatBody, dropChatLineHeld, mintChatTurn, prepareChatTurn, recordIsJsonText, withChatLockAsync, type ChatDeps, type ChatLine } from "./chat";
import { afterEngagementInput, CancelRaced, cancelRun, chatDeps, ExternalRunRefused, resumeRun, StartError, submitProject, type AgentsOption } from "./cli";
import { ResumeRefused, type ResumeAnswer } from "./closeout";
import { rerunHostLeg, VerifyRefused, type HostLegStarted } from "./hostleg";
import { apiBind, apiPort, apiToken, checkTlsFiles, notifier, oauthLeftovers, sessionSecret, tlsConfig } from "./env";
import {
  applyInput, chatPointer, checkCreateBody, checkInputBody, ENGAGEMENT_ID_RE, EngagementCounterInvalid, engagementPath, EngagementRecordInvalid,
  listEngagements, mintEngagementId, newEngagement, readEngagement, TERMINAL_STATES, writeEngagement, type Engagement,
} from "./engagement";
import { underBunTest } from "./hygiene";
import { checkReplyBody, issueRead, postReply, registryRoot, runCost, type IssueReadResult, type ReplyAnswer, type ReplyBody } from "./inbox";
import { OfficeHub, readInbox, type InboxFile, type OfficeEvent } from "./office";
import { gatherPage, holderOf, readLedgerTail, redactLedgerLine, renderPage } from "./page";
import { readLogTail, readPacer } from "./log";
import { readAgents, type RebuildResult } from "./registry";
import { contentType, resolveWebPath, WEB_BUILD_COMMAND, webRoot, type WebOptions } from "./web";
import { registryShow } from "./server";
import { isTerminal, Queue, RunTerminal, type QueueEvent, type QueueRun } from "./queue";

type Env = Record<string, string | undefined>;

export class ApiBindRefused extends Error {
  constructor(addr: string, why: string) {
    super(`ApiBindRefused: TK_SUPERVISOR_BIND '${addr}' ${why} — the API binds only a Tailscale address (inside 100.64.0.0/10)`);
    this.name = "ApiBindRefused";
  }
}

/** The bind address checked: an IPv4 literal inside 100.64.0.0/10 (never 0.0.0.0, localhost, or a LAN address). */
export function checkBind(addr: string): string {
  const a = addr.trim();
  if (a === "0.0.0.0") throw new ApiBindRefused(a, "is every interface");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  const octets = m ? m.slice(1).map(Number) : [];
  if (!m || m.slice(1).some((o) => o.length > 1 && o.startsWith("0")) || octets.some((o) => o > 255)) {
    throw new ApiBindRefused(a, "is not an IPv4 literal");
  }
  if (octets[0] !== 100 || octets[1] < 64 || octets[1] > 127) throw new ApiBindRefused(a, "lies outside 100.64.0.0/10");
  return a;
}

/** The submission body, validated. */
export interface SubmitBody {
  project: string; job: string; base_ref?: string; tier?: string; model?: string; effort?: string;
  /** Story 22.3: an editor-in-the-loop run (a Godot project is snapshot before it starts). */
  editor_in_the_loop?: boolean;
}

export interface ApiDeps {
  queue: Queue;
  token: string;
  /** The one submit path (default: `submitProject` on this queue). */
  submit?: (body: SubmitBody) => Promise<Record<string, unknown>>;
  /** The cancel ruling (default: `cancelRun` on this queue). */
  cancel?: (runId: string) => Promise<QueueRun>;
  /** Story 27.3: the resume (default: `resumeRun` on this queue). */
  resume?: (runId: string, body: ResumeBody) => Promise<ResumeAnswer>;
  /** Story 33.8: the host-leg re-run (default: `rerunHostLeg` on this queue, `by: "api"`); its `done` is not awaited. */
  verify?: (runId: string) => Promise<HostLegStarted>;
  /** SSE: how often new events are polled for (ms, default 1000). */
  pollMs?: number;
  /** SSE: a keepalive comment after this long without an event (ms, default 15000). */
  keepaliveMs?: number;
  /** The clock (default `Date.now`). */
  now?: () => number;
  /** The status page: the environment it reads the store root (`TK_STUDIO_HOME`), the ledger
   * identity and the `TK_SUPERVISOR_*TOKEN*`/`*SECRET*` values to redact from (default `process.env`). */
  env?: Env;
  /** The status page: the registry's projects (default `registryShow`, the published read path). */
  registry?: () => Promise<Record<string, any>>;
  /** The status page: this machine's ledger identity (default: getpass order, the hostname). */
  ledger?: { user: string; machine: string };
  /** Story 22.5: the session cookie's signing secret. Unset: no cookie session (every sign-in refused). */
  session?: { secret: string };
  /** Story 22.5: the public origin (`https://<TLS_NAME>:<port>`). Without an `https` origin every browser
   * sign-in refuses (a `Secure` cookie never sticks over http). */
  origin?: string;
  /** Story 29.1: the account record's path (default `accountPath(env)`), the mismatch delay (default
   * SIGNIN_DELAY_MS) and the sleep it waits through (tests inject one that records and returns at once). */
  account?: { path?: string; delayMs?: number; sleep?: (ms: number) => Promise<void> };
  /** Story 29.2: the default cancel's agent-registry rebuild — injected deps (tests), `false` (none), or unset
   * (production; skipped under `bun test`). The rebuild is detached from the answer; `onAgentsRebuild` receives it. */
  agents?: AgentsOption;
  onAgentsRebuild?: (rebuild: Promise<RebuildResult | null>) => void;
  /** Story 29.3: the office hub (default one per api, on this queue, `now`, `pollMs` and `graceMs`). */
  office?: OfficeHub;
  /** Story 29.3: the office stream's heartbeat comment interval (ms, default 10000). */
  heartbeatMs?: number;
  /** Story 29.3: the office hub's demotion grace (ms, default 20000). */
  graceMs?: number;
  /** Story 30.5: the board builder (default `boardFor` on this queue, `now`, `env`, `ledger`, `registry` and the office
   * hub's live runs); null for a project the registry does not serve. */
  board?: (project: string) => Promise<BoardAnswer | null>;
  /** Story 31.5: the inbox reader (default: the registry's root for `project`, then `readInbox`); null for a project
   * the registry does not serve. */
  inbox?: (project: string) => Promise<InboxFile | null>;
  /** Story 31.6: the issue read (default `issueRead` on the registry, the board builder and this queue). */
  issueRead?: (project: string, key: string) => Promise<IssueReadResult>;
  /** Story 31.6: the owner's reply (default `postReply`: `track.py reply` on the host, `env`). */
  reply?: (key: string, body: ReplyBody) => Promise<ReplyAnswer>;
  /** Story 30.2: the studio web's root (default: the installed slot from `current.json`, else the checkout's
   * `apps/studio-web/dist`). */
  web?: WebOptions;
  /** Story 32.2: the chat route's turn — the `engagement-chat` definition for a served root and its checkout (default
   * `chatDeps()`: `validate`'s resolve and `resolveCheckout`). */
  chat?: ChatDeps;
  /** Story 32.3: run after an applied `answer` or `go` (Story 32.4: or `revise`; Story 32.6: or `approve`, and `go`
   * from `partial`) on `POST /engagements/{id}/input`, fire-and-forget (its errors swallowed; default
   * `afterEngagementInput`: the questions pass, the scope pass, then the approve and engagement-run passes, for that
   * served root and engagement). */
  afterEngagementInput?: (root: string, id: string) => Promise<unknown> | unknown;
}

/** Story 27.3: the resume body — a restore patch relative to the run's worktree, optional. */
export interface ResumeBody { restore_patch?: string }

/** The resume body schema: a JSON object with only `restore_patch`, a non-empty string. */
export function checkResumeBody(body: unknown): { ok: true; body: ResumeBody } | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, detail: "the body must be a JSON object" };
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== "restore_patch") return { ok: false, detail: `unknown field '${k}' (allowed: restore_patch)` };
  if ("restore_patch" in b && (typeof b.restore_patch !== "string" || !b.restore_patch.trim())) {
    return { ok: false, detail: "field 'restore_patch' must be a non-empty string" };
  }
  return { ok: true, body: b as ResumeBody };
}

const SUBMIT_FIELDS = ["project", "job", "base_ref", "tier", "model", "effort", "editor_in_the_loop"] as const;
/** The boolean fields; every other field is a non-empty string. */
const BOOLEAN_FIELDS = ["editor_in_the_loop"] as const;
const REQUIRED_FIELDS = ["project", "job"] as const;

/** The refusal names the submit path raises (each a 400 naming it; nothing queued). */
export const NAMED_REFUSALS = ["HostBypassRefused", "TierRefused", "SbxSandboxMissing", "SupervisorConfigInvalid", "VmPathUnderivable", "WorkDirMissing"] as const;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json(status, { ok: false, error, ...extra });

/** Story 30.6: the supervisor's version — `apps/supervisor/package.json`'s `version`, read once. */
let versionRead: string | undefined;
export function supervisorVersion(): string {
  if (versionRead === undefined) {
    try {
      const v = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"))?.version;
      versionRead = typeof v === "string" && v ? v : "unknown";
    } catch { versionRead = "unknown"; }
  }
  return versionRead;
}

/** Counts per state over every queue run (`GET /status` and the office snapshot's `supervisor.counts` alike). */
function stateCounts(runs: QueueRun[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of runs) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return counts;
}

/** Story 30.6: whether a request's `Accept` names `text/html` (a browser navigation). */
const wantsHtml = (req: Request) => (req.headers.get("accept") ?? "").toLowerCase().includes("text/html");

/** The body schema: a JSON object with `project` and `job`, and only the known fields, each a
 * non-empty string — `editor_in_the_loop` a boolean. */
export function checkSubmitBody(body: unknown): { ok: true; body: SubmitBody } | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, detail: "the body must be a JSON object" };
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) {
    if (!(SUBMIT_FIELDS as readonly string[]).includes(k)) return { ok: false, detail: `unknown field '${k}' (allowed: ${SUBMIT_FIELDS.join(", ")})` };
  }
  for (const k of REQUIRED_FIELDS) if (!(k in b)) return { ok: false, detail: `missing field '${k}'` };
  for (const k of SUBMIT_FIELDS) {
    if (!(k in b)) continue;
    if ((BOOLEAN_FIELDS as readonly string[]).includes(k)) {
      if (typeof b[k] !== "boolean") return { ok: false, detail: `field '${k}' must be a boolean` };
    } else if (typeof b[k] !== "string" || !(b[k] as string).trim()) return { ok: false, detail: `field '${k}' must be a non-empty string` };
  }
  return { ok: true, body: b as unknown as SubmitBody };
}

/** A submit error → its name: a named refusal's prefix, else a refusal, else a failure. */
function submitError(e: unknown): { status: number; error: string; detail: string; problems?: string[] } {
  const detail = e instanceof Error ? e.message : String(e);
  const named = NAMED_REFUSALS.find((n) => detail.startsWith(`${n}:`));
  const problems = e instanceof StartError && e.problems ? { problems: e.problems } : {};
  if (named) return { status: 400, error: named, detail, ...problems };
  if (e instanceof StartError && e.refused) return { status: 400, error: "SubmitRefused", detail, ...problems };
  // Not a refusal of the body: the studio or the queue could not answer (transport, setup).
  const prefix = /^([A-Z][A-Za-z]+):/.exec(detail)?.[1];
  return { status: 500, error: prefix ?? "SubmitFailed", detail, ...problems };
}

/** A path segment decoded; a malformed escape (e.g. `%E0%A4`) names no run: null. */
function decodeId(segment: string): string | null {
  try { return decodeURIComponent(segment); } catch { return null; }
}

/** What a cancel did, from its `ended` detail (or a raced cancel's collected detail): the
 * engine stop, the studio lookup and end, the worker, the lock. */
function cancelEffects(detail: Record<string, unknown> | null): Record<string, unknown> {
  const keys = ["engine", "engine_stop", "lookup", "studio", "worker", "lock"];
  return Object.fromEntries(Object.entries(detail ?? {}).filter(([k]) => keys.includes(k)));
}

/** The injectable request handler (tests run it without the tailnet). */
export function createApi(deps: ApiDeps): (req: Request) => Promise<Response> {
  const { queue } = deps;
  const expected = createHash("sha256").update(`Bearer ${deps.token}`).digest();
  const submit = deps.submit ?? ((b: SubmitBody) => submitProject(b.project, b.job, {
    queue, tier: b.tier, model: b.model, effort: b.effort, baseRef: b.base_ref, ...(b.editor_in_the_loop === true ? { editorInTheLoop: true } : {}),
  }));
  // Story 29.2: the cancel's agent-registry rebuild is started, not awaited: the answer never waits on it (Story 22.3).
  const cancel = deps.cancel ?? ((id: string) => cancelRun(queue, id, { agents: deps.agents, detachRebuild: (p) => { deps.onAgentsRebuild?.(p); } }));
  const resume = deps.resume ?? ((id: string, b: ResumeBody) => resumeRun(queue, id, b.restore_patch));
  const verify = deps.verify ?? ((id: string) => rerunHostLeg(queue, id, { by: "api" }));
  const pollMs = deps.pollMs ?? 1000, keepaliveMs = deps.keepaliveMs ?? 15000;
  const clock = deps.now ?? Date.now;
  // Story 32.1: the served roots the registry last named (project id → root), refreshed on every registry read here;
  // the office hub reads its engagement records from them. Until one registry read has succeeded (`rootsKnown`) the hub
  // gets no map (`undefined`): the office then falls back to the runs' roots and names no "no served root" problem.
  const knownRoots: Record<string, string> = {};
  let rootsKnown = false;
  let rootsTriedAt: number | null = null;
  let rootsFirst: Promise<void> | null = null; // the first office read's registry read, while it is pending
  const remember = (shown: Record<string, any> | null | undefined) => {
    const projects = shown?.projects && typeof shown.projects === "object" ? shown.projects as Record<string, any> : null;
    if (!projects) return;
    for (const k of Object.keys(knownRoots)) delete knownRoots[k];
    for (const [id, entry] of Object.entries(projects)) {
      if (entry && typeof entry === "object" && typeof entry.root === "string" && entry.root) knownRoots[id] = entry.root;
    }
    rootsKnown = true;
  };
  const registry = async () => {
    const shown = await (deps.registry ?? (() => registryShow()))();
    remember(shown);
    return shown;
  };
  /** Before an office read: the first one awaits a registry read (so the first snapshot already shows the
   * engagements), and so does every office read that arrives while that read is pending (one shared promise); later
   * ones re-read it in the background at most once a minute. Never on an unauthorised request, and never under
   * `bun test` without an injected registry (no `registry.py show` child there). */
  const rootsReady = async (): Promise<void> => {
    if (!deps.registry && underBunTest()) return;
    if (rootsTriedAt === null) {
      rootsTriedAt = clock();
      rootsFirst = registry().then(() => {}, () => { /* the map is kept as it was */ }).finally(() => { rootsFirst = null; });
    }
    if (rootsFirst) return await rootsFirst;
    if (clock() - rootsTriedAt <= 60_000) return;
    rootsTriedAt = clock();
    registry().catch(() => { /* the map is kept as it was */ });
  };
  /** The hub's tick (an open office stream re-projects every second): when the last registry read is older than a
   * minute, start one in the background. Fire-and-forget: never awaited, never throwing. Only once an authorised office
   * read has primed the map (`rootsTriedAt`), so an unauthorised request still never reads the registry. */
  const refreshRootsDetached = (): void => {
    try {
      if (rootsTriedAt === null) return;
      if (!deps.registry && underBunTest()) return;
      if (clock() - rootsTriedAt <= 60_000) return;
      rootsTriedAt = clock();
      registry().catch(() => { /* the map is kept as it was */ });
    } catch { /* never from the tick */ }
  };
  const office = deps.office ?? new OfficeHub({
    queue, now: clock, pollMs, roots: () => { refreshRootsDetached(); return rootsKnown ? { ...knownRoots } : undefined; }, ...(deps.graceMs !== undefined ? { graceMs: deps.graceMs } : {}),
  });
  const heartbeatMs = deps.heartbeatMs ?? 10_000;
  const board = deps.board ?? ((project: string) => boardFor(project, {
    queue, now: clock, env: deps.env, ledger: deps.ledger, registry,
    liveRuns: () => office.snapshot().runs,
  }));
  const inbox = deps.inbox ?? (async (project: string): Promise<InboxFile | null> => {
    const served = await registryRoot(project, registry);
    return served ? readInbox(served.root) : null;
  });
  const readIssue = deps.issueRead ?? ((project: string, key: string) => issueRead(project, key, {
    registry, board, studioRunId: (id) => queue.get(id)?.studio_run_id ?? null, env: deps.env, ledger: deps.ledger,
  }));
  const reply = deps.reply ?? ((key: string, body: ReplyBody) => postReply(key, body, { registry, env: deps.env }));
  const chat = deps.chat ?? chatDeps();
  const afterInput = deps.afterEngagementInput ?? ((root: string, id: string) => afterEngagementInput(queue, root, id));

  /** Constant time: both sides hashed to one length before `timingSafeEqual`. The scheme
   * matches case-insensitively (RFC 7235); the token is compared as sent. */
  const bearerMatches = (header: string) => timingSafeEqual(createHash("sha256").update(header).digest(), expected);
  const authorized = (req: Request) => {
    const raw = req.headers.get("authorization") ?? "";
    return bearerMatches(/^bearer /i.test(raw) ? `Bearer ${raw.slice(7)}` : raw);
  };
  /** Never echo the token, even inside an error message. */
  const redact = (s: string) => s.split(deps.token).join("[redacted]");

  async function postJobs(req: Request): Promise<Response> {
    let raw: unknown;
    try { raw = JSON.parse(await req.text()); }
    catch (e) { return fail(400, "MalformedJson", { detail: `the body is not JSON: ${e instanceof Error ? e.message : String(e)}` }); }
    const checked = checkSubmitBody(raw);
    if (!checked.ok) return fail(400, "SchemaError", { detail: checked.detail });
    let answer: Record<string, unknown>;
    try { answer = await submit(checked.body); }
    catch (e) {
      const { status, error, ...rest } = submitError(e);
      return fail(status, error, { ...rest, detail: redact(rest.detail) });
    }
    const runId = String(answer.run_id);
    const run = queue.get(runId);
    const lock = run ? queue.lock(run) : null; // Story 28.5: the lock the run waits on (its git checkout)
    const holder = lock && lock.run_id !== runId ? { holder: holderOf(lock) } : {};
    return json(200, {
      ...answer, run_id: runId, studio_run_id: run?.studio_run_id ?? null, state: run?.state ?? answer.state,
      ...(run?.base_ref ? { base_ref: run.base_ref } : {}), ...holder,
    });
  }

  /** `GET /inbox` (Story 31.5), or with `issue` the Issue screen's read (Story 31.6). */
  async function inboxRead(project: string, issue: string | null): Promise<Response> {
    if (issue === null) {
      const file = await inbox(project);
      return file ? json(200, { ok: true, project, generated_at: file.generated_at, items: file.items }) : fail(404, "UnknownProject", { project });
    }
    const key = issue.trim();
    const read = await readIssue(project, key);
    if (read.ok) return json(200, read.answer);
    if (read.error === "BadIssue") return fail(400, "BadIssue", { issue: key, detail: "an issue key is like TKS-12" });
    if (read.error === "UnknownProject") return fail(404, "UnknownProject", { project });
    if (read.error === "IssueReadFailed") return fail(500, "IssueReadFailed", { project, issue: key, detail: redact(read.detail) });
    return fail(404, "UnknownIssue", { project, issue: key });
  }

  /** `POST /inbox/{key}/reply` (Story 31.6): the body checked, then the reply (never a queue event). */
  async function postReplyRoute(req: Request, key: string): Promise<Response> {
    let raw: unknown;
    try { raw = JSON.parse(await req.text()); }
    catch (e) { return fail(400, "MalformedJson", { detail: `the body is not JSON: ${e instanceof Error ? e.message : String(e)}` }); }
    const checked = checkReplyBody(raw);
    if (!checked.ok) return fail(400, "SchemaError", { detail: checked.detail });
    const answer = await reply(key, checked.body);
    return json(answer.status, answer.body);
  }

  // ---------------------------------------------------------- the engagements (Story 32.1)

  /** A project's served root: the root, or the refusal (404 UnknownProject, 500 EngagementRootMissing). With `create`
   * (`POST /engagements`) a root that is not on disk is refused too, never recreated as a phantom project root (a read
   * there finds no file). */
  async function servedRootOf(project: string, create = false): Promise<{ root: string } | Response> {
    const served = await registryRoot(project, registry);
    if (!served) return fail(404, "UnknownProject", { project });
    if (!served.root) return fail(500, "EngagementRootMissing", { project, detail: "the registry entry names no root" });
    if (create && !existsSync(served.root)) return fail(500, "EngagementRootMissing", { project, detail: "the registry root does not exist" });
    return { root: served.root };
  }

  /** The record `id`: under `?project=` when given; else the one registry project whose served root holds its file.
   * With no `?project=`, a hit is a project whose record file exists (parsed or not): more than one hit is 409
   * AmbiguousEngagement `{engagement, projects[]}` before any record is read (ids repeat across served roots); one hit
   * reads as below (a malformed record 500 EngagementRecordInvalid); none is 404 UnknownEngagement. */
  async function locateEngagement(id: string, project: string | null): Promise<{ project: string; root: string; record: Engagement } | Response> {
    let candidates: [string, string][];
    if (project) {
      const served = await servedRootOf(project);
      if (served instanceof Response) return served;
      candidates = [[project, served.root]];
    } else {
      const shown = await registry();
      const projects = shown?.projects && typeof shown.projects === "object" ? shown.projects as Record<string, any> : {};
      candidates = Object.entries(projects)
        .filter(([, e]) => e && typeof e === "object" && typeof e.root === "string" && e.root)
        .map(([p, e]) => [p, e.root as string] as [string, string])
        .filter(([, root]) => existsSync(engagementPath(root, id)));
      if (candidates.length > 1) {
        return fail(409, "AmbiguousEngagement", { engagement: id, projects: candidates.map(([p]) => p) });
      }
    }
    for (const [p, root] of candidates) {
      let record: Engagement | null;
      try { record = readEngagement(root, id); } catch (e) {
        if (e instanceof EngagementRecordInvalid) return fail(500, "EngagementRecordInvalid", { project: p, engagement: id, detail: e.message });
        throw e;
      }
      if (record) return { project: p, root, record };
    }
    return fail(404, "UnknownEngagement", { ...(project ? { project } : {}), engagement: id });
  }

  /** `POST /engagements`: the body checked, the id minted (the counter saved first), the record written, then the
   * `engagement` service event (the record is the truth, the event the signal). */
  async function postEngagement(req: Request, via: "bearer" | "cookie"): Promise<Response> {
    let raw: unknown;
    try { raw = JSON.parse(await req.text()); }
    catch (e) { return fail(400, "MalformedJson", { detail: `the body is not JSON: ${e instanceof Error ? e.message : String(e)}` }); }
    const checked = checkCreateBody(raw);
    if (!checked.ok) return fail(400, "SchemaError", { detail: checked.detail });
    const { project, request, follows } = checked.body;
    const served = await servedRootOf(project, true);
    if (served instanceof Response) return served;
    if (follows !== undefined) {
      // Story 32.8: a change after delivery — the followed record read only, never written
      let previous: Engagement | null;
      try { previous = readEngagement(served.root, follows); } catch (e) {
        if (e instanceof EngagementRecordInvalid) return fail(500, "EngagementRecordInvalid", { project, engagement: follows, detail: e.message });
        throw e;
      }
      if (!previous) return fail(404, "UnknownEngagement", { engagement: follows });
      if (previous.state !== "delivered") return fail(409, "FollowsNotDelivered", { engagement: follows, state: previous.state });
    }
    const at = new Date(clock()).toISOString();
    let record: Engagement;
    try {
      record = newEngagement(mintEngagementId(served.root), project, request, at, follows);
      writeEngagement(served.root, record);
    } catch (e) {
      if (e instanceof EngagementCounterInvalid) return fail(500, "EngagementCounterInvalid", { project, detail: e.message });
      throw e;
    }
    queue.serviceEvent("engagement", { id: record.id, project, state: record.state, from: null, source: via }, at);
    return json(200, { ok: true, engagement: record });
  }

  /** `GET /engagements?project=<id>`: the project's records, newest first. */
  async function listEngagementsRoute(url: URL): Promise<Response> {
    const project = url.searchParams.get("project")?.trim();
    if (!project) return fail(400, "ProjectRequired", { detail: "the engagements need ?project=<id>" });
    const served = await servedRootOf(project);
    if (served instanceof Response) return served;
    const problems: string[] = [];
    const engagements = listEngagements(served.root, problems);
    return json(200, { ok: true, project, engagements, problems });
  }

  /** `GET /engagements/{id}`: the record and its chat pointer. */
  async function readEngagementRoute(url: URL, id: string): Promise<Response> {
    const found = await locateEngagement(id, url.searchParams.get("project")?.trim() || null);
    if (found instanceof Response) return found;
    return json(200, { ok: true, project: found.project, engagement: found.record, chat: chatPointer(found.root, id) });
  }

  /** `POST /engagements/{id}/input`: the typed input checked, one table row applied, the record written, then the
   * `engagement` service event carrying `from`. */
  async function postInputRoute(req: Request, url: URL, id: string, via: "bearer" | "cookie"): Promise<Response> {
    let raw: unknown;
    try { raw = JSON.parse(await req.text()); }
    catch (e) { return fail(400, "MalformedJson", { detail: `the body is not JSON: ${e instanceof Error ? e.message : String(e)}` }); }
    const checked = checkInputBody(raw);
    if (!checked.ok) return fail(400, "SchemaError", { detail: checked.detail });
    const located = await locateEngagement(id, url.searchParams.get("project")?.trim() || null);
    if (located instanceof Response) return located;
    // The read, the apply and the write run with no await between them (two concurrent inputs never both apply to
    // one stale record): the record is read again here, synchronously, after the await above.
    let current: Engagement | null;
    try { current = readEngagement(located.root, id); } catch (e) {
      if (e instanceof EngagementRecordInvalid) return fail(500, "EngagementRecordInvalid", { project: located.project, engagement: id, detail: e.message });
      throw e;
    }
    if (!current) return fail(404, "UnknownEngagement", { ...(url.searchParams.get("project")?.trim() ? { project: located.project } : {}), engagement: id });
    const found = { ...located, record: current };
    const at = new Date(clock()).toISOString();
    const applied = applyInput(found.record, { verb: checked.body.verb, payload: checked.body.payload, source: via, at });
    if (!applied.ok) {
      const { error, state, verb, detail } = applied;
      const extra = { engagement: id, state, verb, ...(detail ? { detail } : {}) };
      return fail(error === "SchemaError" ? 400 : 409, error, extra);
    }
    writeEngagement(found.root, applied.record);
    queue.serviceEvent("engagement", { id, project: found.project, state: applied.to, from: applied.from, verb: checked.body.verb, source: via }, at);
    // Story 32.3: an applied answer or go runs the questions pass (the issue closed once the state moves on); Story
    // 32.4: an applied revise runs the scope pass (its body becomes the scope and the page); Story 32.6: an applied
    // approve runs the approve pass (the plan written, published and its first run queued), and a go from partial
    // (the cap raised) the engagement-run pass that resubmits; never awaited, never failing the input
    const verb = checked.body.verb;
    if (verb === "answer" || verb === "go" || verb === "revise" || verb === "approve") {
      try { Promise.resolve(afterInput(found.root, id)).catch(() => { /* the next run end */ }); } catch { /* the next run end */ }
    }
    return json(200, { ok: true, engagement: applied.record, from: applied.from, to: applied.to });
  }

  // ---------------------------------------------------------- the chat (Story 32.2)

  /** `POST /chat/{engagement}`: the body checked, the engagement located (not terminal), the turn's job resolved, then
   * — under the chat lock, with no await between — the record re-read, the owner's line appended, one `engagement-chat`
   * run minted (`stack`: behind a live one, never refused) and the `chat-queued` service event; a failed mint removes
   * the line again (500 ChatQueueFailed). */
  async function postChatRoute(req: Request, url: URL, id: string): Promise<Response> {
    let raw: unknown;
    try { raw = JSON.parse(await req.text()); }
    catch (e) { return fail(400, "MalformedJson", { detail: `the body is not JSON: ${e instanceof Error ? e.message : String(e)}` }); }
    const checked = checkChatBody(raw);
    if (!checked.ok) return fail(400, "SchemaError", { detail: checked.detail });
    const scoped = url.searchParams.get("project")?.trim() || null;
    const located = await locateEngagement(id, scoped);
    if (located instanceof Response) return located;
    if (TERMINAL_STATES.has(located.record.state)) return fail(409, "EngagementClosed", { engagement: id, state: located.record.state });
    let prepared: Awaited<ReturnType<typeof prepareChatTurn>>;
    try { prepared = await prepareChatTurn(chat, located.root); }
    catch (e) { return fail(500, "ChatJobUnresolved", { project: located.project, engagement: id, detail: redact(e instanceof Error ? e.message : String(e)) }); }
    // Under chat.lock (its wait an async sleep: a held lock never stalls the server), synchronously: the record
    // re-read, the owner's line appended, the run minted — or, the mint failing, the line removed again (no owner line
    // survives without a run; a retry never duplicates it).
    let turned: Response | { seq: number; run_id: string };
    try {
      turned = await withChatLockAsync(located.root, id, (): Response | { seq: number; run_id: string } => {
        let current: Engagement | null;
        try { current = readEngagement(located.root, id); } catch (e) {
          if (e instanceof EngagementRecordInvalid) return fail(500, "EngagementRecordInvalid", { project: located.project, engagement: id, detail: e.message });
          throw e;
        }
        if (!current) return fail(404, "UnknownEngagement", { ...(scoped ? { project: located.project } : {}), engagement: id });
        if (TERMINAL_STATES.has(current.state)) return fail(409, "EngagementClosed", { engagement: id, state: current.state });
        // Settled shape 1: a record still in 32.1's block YAML is rewritten as JSON text before the turn is minted
        // (engage.py reads it with `json`; block YAML is EngagementRecordUnreadable there).
        if (!recordIsJsonText(located.root, id)) writeEngagement(located.root, current);
        const at = new Date(clock()).toISOString();
        const line = appendChatLineHeld(located.root, id, { at, author: "owner", body: checked.message });
        try {
          const minted = mintChatTurn(queue, prepared, { engagement: id, project: located.project, root: located.root, seq: line.seq });
          return { seq: line.seq, run_id: minted.run_id };
        } catch (e) {
          let detail = redact(e instanceof Error ? e.message : String(e));
          try { dropChatLineHeld(located.root, id, line.seq); }
          catch (d) { detail += `; the owner line seq ${line.seq} could not be removed: ${redact(d instanceof Error ? d.message : String(d))}`; }
          return fail(500, "ChatQueueFailed", { project: located.project, engagement: id, detail });
        }
      });
    } catch (e) {
      if (e instanceof ChatBusy) return fail(503, "ChatBusy", { engagement: id, detail: e.message });
      throw e;
    }
    if (turned instanceof Response) return turned;
    return json(200, { ok: true, engagement: id, seq: turned.seq, run_id: turned.run_id });
  }

  /** `GET /chat/{engagement}?since=<seq>`: the lines after `since` (JSON), or with `text/event-stream` the chat stream. */
  async function readChatRoute(req: Request, url: URL, id: string): Promise<Response> {
    const stream = (req.headers.get("accept") ?? "").includes("text/event-stream");
    const lastId = req.headers.get("last-event-id");
    // As `/events`: a numeric `Last-Event-ID` (an EventSource reconnect) wins over `?since=` on the stream.
    const raw = stream && lastId !== null && /^\d+$/.test(lastId.trim()) ? lastId : url.searchParams.get("since")?.trim() || "0";
    if (!/^\d+$/.test(raw.trim())) return fail(400, "SchemaError", { detail: `'since' must be a chat seq (a non-negative integer), got '${raw}'` });
    const since = Number(raw.trim());
    const located = await locateEngagement(id, url.searchParams.get("project")?.trim() || null);
    if (located instanceof Response) return located;
    if (!stream) {
      const lines = chatSince(located.root, id, since);
      // `last_seq`: the file's last line's seq (0 while absent), as GET /engagements/{id} chat.last_seq — never `since`.
      return json(200, { ok: true, project: located.project, engagement: id, since, last_seq: chatPointer(located.root, id).last_seq, lines });
    }
    return chatSse(req, located.root, id, since);
  }

  /** The chat stream (a third handler, beside `sse()` and `officeSse()`, never factored with them): frames `id: <seq>`,
   * `event: chat`, data = the line, first the lines after `since` (the replay), then each new line as the poll finds it;
   * a `: heartbeat` comment every `heartbeatMs` on its own timer; the client's close clears both timers. Reads only. */
  function chatSse(req: Request, root: string, id: string, since: number): Response {
    const enc = new TextEncoder();
    let last = since, closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
    const frame = (l: ChatLine) => `id: ${l.seq}\nevent: chat\ndata: ${JSON.stringify(l)}\n\n`;
    const cleanup = () => {
      closed = true;
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const stop = () => {
          if (closed) return;
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        };
        const send = (text: string) => {
          if (closed) return;
          try { controller.enqueue(enc.encode(text)); } catch { stop(); }
        };
        req.signal?.addEventListener("abort", stop);
        if (req.signal?.aborted) { stop(); return; }
        const tick = () => {
          if (closed) return;
          try {
            const lines = chatSince(root, id, last);
            if (lines.length) {
              send(lines.map(frame).join(""));
              last = Math.max(last, ...lines.map((l) => l.seq));
            }
          } catch { stop(); return; }
          timer = setTimeout(tick, pollMs);
        };
        send("retry: 5000\n\n");
        tick();
        heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
      },
      cancel() { cleanup(); },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  }

  function status(): Response {
    const runs = queue.runs();
    const counts = stateCounts(runs);
    // Story 33.2 (0.1.28, additive): each live run carries its latest open claim refusal (`claimRefusalView`).
    const live = runs.filter((r) => !isTerminal(r.state)).map((r) => ({ ...r, claim_refused: claimRefusalView(queue, r.run_id) }));
    const locks = queue.locks().map((l) => ({ checkout: l.checkout, root: l.root, acquired: l.acquired, holder: holderOf(l) }));
    // Story 33.1 (0.1.28, additive): the supervisor log's last lines, each redacted (`readLogTail`).
    // Story 33.7 (0.1.28, additive): the pacer's last passes (`readPacer`), always present.
    const env = deps.env ?? process.env;
    return json(200, { ok: true, counts, live, locks, log: readLogTail(env, clock), pacer: readPacer(env) }, { vary: "Accept" });
  }

  /** Story 30.6 (0.1.25, additive): the office snapshot with `supervisor {version, counts}` and the ledger tail —
   * wrapped here, around the hub's snapshot, so the hub's diffing never sees them (they ride no delta). Every
   * ledger line passes `redactLedgerLine` (NFR5: the page's key-based redaction, then `redactCredentials`). */
  function officeSnapshot() {
    const env = deps.env ?? process.env;
    const tail = readLedgerTail(env, deps.ledger);
    const ledger = "lines" in tail ? { path: tail.path, lines: tail.lines.map((l) => redactLedgerLine(l, env, deps.token)) } : tail;
    return { ...office.snapshot(), supervisor: { version: supervisorVersion(), counts: stateCounts(queue.runs()) }, ledger };
  }

  async function postCancel(runId: string): Promise<Response> {
    const run = queue.get(runId);
    if (!run) return fail(404, "RunNotFound", { run_id: runId });
    if (isTerminal(run.state)) return fail(409, "RunTerminal", { run_id: runId, state: run.state });
    try {
      const ended = await cancel(runId);
      const events = queue.events(runId);
      const end = events.findLast((e) => e.kind === "ended");
      // A worker its driver recorded during the cancel, killed once the run ended: its `worker-kill` event.
      const late = end && events.findLast((e) => e.kind === "worker-kill" && e.seq > end.seq);
      const worker = late ? late.detail?.worker : undefined;
      return json(200, { ok: true, run_id: ended.run_id, studio_run_id: ended.studio_run_id, state: ended.state,
        effects: { ...cancelEffects(end?.detail ?? null), ...(worker ? { worker } : {}) }, run: ended, events });
    } catch (e) {
      // Ended by its driver during the cancel: the same 409, naming what the cancel had already done.
      if (e instanceof RunTerminal) {
        return fail(409, "RunTerminal", { run_id: runId, state: queue.get(runId)?.state ?? null,
          ...(e instanceof CancelRaced ? { effects: cancelEffects(e.effects) } : {}) });
      }
      // DW-26: a run started outside the queue is never cancelled here.
      if (e instanceof ExternalRunRefused) return fail(409, "ExternalRun", { run_id: runId, detail: e.message });
      throw e;
    }
  }

  /** Story 27.3: `POST /runs/{id}/resume` (bearer only). */
  async function postResume(req: Request, runId: string): Promise<Response> {
    const text = await req.text();
    let raw: unknown = {};
    if (text.trim()) {
      try { raw = JSON.parse(text); }
      catch (e) { return fail(400, "MalformedJson", { detail: `the body is not JSON: ${e instanceof Error ? e.message : String(e)}` }); }
    }
    const checked = checkResumeBody(raw);
    if (!checked.ok) return fail(400, "SchemaError", { detail: checked.detail });
    try {
      return json(200, await resume(runId, checked.body));
    } catch (e) {
      if (!(e instanceof ResumeRefused)) throw e;
      const status = e.code === "RunNotFound" ? 404 : e.code === "SchemaError" ? 400 : e.code === "ResumeFailed" ? 500 : 409;
      return fail(status, e.code, { run_id: runId, detail: redact(e.message) });
    }
  }

  /** Story 33.8: `POST /runs/{id}/verify` (bearer only). The refusals, the lease and the cut answer here; the leg runs on. */
  async function postVerify(req: Request, runId: string): Promise<Response> {
    const text = await req.text();
    let raw: unknown = {};
    if (text.trim()) {
      try { raw = JSON.parse(text); }
      catch (e) { return fail(400, "MalformedJson", { detail: `the body is not JSON: ${e instanceof Error ? e.message : String(e)}` }); }
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length) {
      return fail(400, "SchemaError", { detail: "the body must be empty or {}" });
    }
    try {
      const started = await verify(runId);
      started.done.catch(() => { /* the leg's result (or its failure) is the run's `host-verify` event */ });
      return json(202, { ok: true, run_id: started.run_id, state: started.state, verify: "started", head: started.head });
    } catch (e) {
      if (!(e instanceof VerifyRefused)) throw e;
      const status = e.code === "RunNotFound" ? 404 : e.code === "SchemaError" ? 400 : e.code === "VerifyFailed" ? 500 : 409;
      return fail(status, e.code, { run_id: runId, detail: redact(e.message) });
    }
  }

  function events(req: Request, url: URL): Response {
    const stream = (req.headers.get("accept") ?? "").includes("text/event-stream");
    const lastId = req.headers.get("last-event-id");
    // SSE: a valid `Last-Event-ID` (an EventSource reconnect) wins over `?since=`. Only the
    // stream reads it: a JSON poll uses `since`, else 0.
    const raw = stream && lastId !== null && /^\d+$/.test(lastId.trim()) ? lastId
      : url.searchParams.get("since")?.trim() || "0";
    if (!/^\d+$/.test(raw.trim())) return fail(400, "SchemaError", { detail: `'since' must be an event seq (a non-negative integer), got '${raw}'` });
    const since = Number(raw.trim());
    if (!stream) {
      const evs = queue.events(undefined, since);
      return json(200, { ok: true, since, last_seq: evs.at(-1)?.seq ?? since, events: evs });
    }
    return sse(req, since);
  }

  /** `id:<seq>` + `data:<event json>` per event, then each new event as it lands (polled). */
  function sse(req: Request, since: number): Response {
    const enc = new TextEncoder();
    let last = since, closed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const frame = (e: QueueEvent) => `id:${e.seq}\ndata:${JSON.stringify(e)}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let quietSince = clock();
        const stop = () => {
          if (closed) return;
          closed = true;
          if (timer) clearTimeout(timer);
          try { controller.close(); } catch { /* already closed */ }
        };
        req.signal?.addEventListener("abort", stop);
        const tick = () => {
          if (closed) return;
          try {
            const evs = queue.events(undefined, last);
            if (evs.length) {
              controller.enqueue(enc.encode(evs.map(frame).join("")));
              last = evs.at(-1)!.seq;
              quietSince = clock();
            } else if (clock() - quietSince >= keepaliveMs) {
              controller.enqueue(enc.encode(":keepalive\n\n"));
              quietSince = clock();
            }
          } catch { stop(); return; }
          timer = setTimeout(tick, pollMs);
        };
        controller.enqueue(enc.encode("retry:5000\n\n"));
        tick();
      },
      cancel() {
        closed = true;
        if (timer) clearTimeout(timer);
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  }

  /** Story 29.3: `GET /office/events` — the JSON snapshot, or with `text/event-stream` the office stream. */
  function officeEvents(req: Request): Response {
    if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) return json(200, { ok: true, ...officeSnapshot() });
    return officeSse(req);
  }

  /** The office stream (beside `sse()`, never factored with it): `event:snapshot` first — or, for a `Last-Event-ID`
   * of this hub's boot still inside its buffer, the deltas after it — then each delta as the hub's poll finds it,
   * and a `: heartbeat` comment every `heartbeatMs` on its own timer. The client's close unsubscribes and clears
   * both timers (the hub stops polling with its last subscriber). Reads only. */
  function officeSse(req: Request): Response {
    const enc = new TextEncoder();
    let closed = false, heartbeat: ReturnType<typeof setInterval> | undefined, unsubscribe: (() => void) | undefined;
    const frame = (e: OfficeEvent) => `id:${e.id}\nevent:${e.kind}\ndata:${JSON.stringify(e.data)}\n\n`;
    const cleanup = () => {
      closed = true;
      if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
      if (unsubscribe) { unsubscribe(); unsubscribe = undefined; }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => {
          if (closed) return;
          try { controller.enqueue(enc.encode(text)); } catch { stop(); }
        };
        const stop = () => {
          if (closed) return;
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        };
        req.signal?.addEventListener("abort", stop);
        if (req.signal?.aborted) { stop(); return; }
        const replay = office.since(req.headers.get("last-event-id"));
        if (replay) send(replay.map(frame).join(""));
        else {
          const snap = officeSnapshot();
          send(`id:${snap.id}\nevent:snapshot\ndata:${JSON.stringify(snap)}\n\n`);
        }
        unsubscribe = office.subscribe((evs) => send(evs.map(frame).join("")));
        heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  }

  /** The status page: reads only (queue, store, registry), rendered to HTML. A cookie session's page
   * carries its CSRF token in each live run's cancel form. */
  async function page(csrf?: string): Promise<Response> {
    const data = await gatherPage({ queue, token: deps.token, env: deps.env, registry: deps.registry ?? (() => registryShow()), ledger: deps.ledger, office, web: deps.web ?? {}, now: clock });
    return new Response(renderPage(data, csrf ? { csrf } : {}), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  /** Story 30.2: `GET /app[/…]` — the built web's file, or `index.html` (the single-page fallback); a refused path
   * 404 NotFound (never the fallback); no built web 503 WebNotBuilt naming the build command. Every answer
   * `cache-control: no-store`. */
  async function web(path: string): Promise<Response> {
    const noStore = { "cache-control": "no-store" };
    const root = webRoot(deps.web ?? {});
    if (root === null) return json(503, { ok: false, error: "WebNotBuilt", command: WEB_BUILD_COMMAND }, noStore);
    const resolved = resolveWebPath(root, path);
    if ("refused" in resolved) return json(404, { ok: false, error: "NotFound", path }, noStore);
    const file = "file" in resolved ? resolved.file : resolved.fallback;
    return new Response(Bun.file(file), { status: 200, headers: { "content-type": contentType(file), ...noStore } });
  }

  // ---------------------------------------------------------- the sign-in (Story 22.5)

  const html = (status: number, body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });
  /** Served over https? Without it the browser drops the `Secure` cookie, so the token form refuses
   * and the sign-in page says browser sign-in needs https. */
  const https = /^https:\/\//i.test(deps.origin ?? "");
  const pageEnv = deps.env ?? process.env;
  const acctPath = deps.account?.path ?? accountPath(pageEnv);
  const delayMs = deps.account?.delayMs ?? SIGNIN_DELAY_MS;
  const sleep = deps.account?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** Story 29.1: `create` while no account exists, else `signin` — read per request (the reset is a file deletion). */
  const mode = (): SignInMode => readAccount(pageEnv, acctPath) === null ? "create" : "signin";
  /** The sign-in page; a refusal is the same page with a generic line, never a cookie or a detail. A malformed
   * `account.json` answers the sign-in page at 500 with one generic line naming AccountRecordInvalid (never the
   * file's content); the token form stays. */
  const signIn = (refused = false, status = 401, invalid?: "username" | "password", next?: string) => {
    let m: SignInMode;
    try { m = mode(); } catch (e) {
      if (e instanceof AccountRecordInvalid) return recordInvalidPage(next);
      throw e;
    }
    return html(status, signInPage({ mode: m, refused, needsHttps: !https, ...(invalid ? { invalid } : {}), ...(next ? { next } : {}) }));
  };
  const recordInvalidPage = (next?: string) => html(500, signInPage({ mode: "signin", needsHttps: !https, ...(next ? { next } : {}) }).replace(
    "<h1>tk-studio supervisor</h1>",
    `<h1>tk-studio supervisor</h1><p class="note">AccountRecordInvalid: the account record (${ACCOUNT_RELATIVE_PATH} in the studio store) is not readable; delete it from the console to create the account again.</p>`,
  ));
  /** The named refusal of a malformed `account.json` on an account route: JSON 500, or the page at 500. */
  const recordInvalid = (isJson: boolean, next?: string) =>
    isJson ? fail(500, "AccountRecordInvalid", { path: ACCOUNT_RELATIVE_PATH }) : recordInvalidPage(next);
  /** Sign-in attempts run one at a time (per `createApi`): the lock check, the verify, the delay, the row and the
   * lockout check of one attempt finish before the next starts, so parallel guesses cannot pass the lockout. */
  let signInChain: Promise<unknown> = Promise.resolve();
  const serialised = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = signInChain.then(fn, fn);
    signInChain = run.catch(() => undefined);
    return run;
  };
  const redirect = (status: number, location: string, cookie: string) =>
    new Response(null, { status, headers: { location, "set-cookie": cookie, "cache-control": "no-store" } });
  const secret = deps.session?.secret;
  const nowMs = () => clock();
  const sessionCookie = (sub: string) => setCookie(SESSION_COOKIE, signSession(secret!, sub, nowMs()), SESSION_TTL_S);

  /** Story 30.2: where a successful form sign-in returns — `next` when it is a same-origin path (starts with `/`,
   * not `//` or `/\`, no `\`, printable ASCII only — no control character, C0 or C1, and nothing a `Location`
   * header cannot carry — no scheme), else `/`: never an open redirect. */
  const safeNext = (next: unknown): string => {
    if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
    if (next.includes("\\") || /[^\x20-\x7e]/.test(next) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(next)) return "/";
    return next;
  };

  /** `POST /auth/token`: the API token from the form, compared as the bearer header is. Refused
   * like a bad token without https (the cookie would be dropped). */
  async function tokenSignIn(req: Request): Promise<Response> {
    let given = "", next = "";
    try {
      const f = new URLSearchParams(await req.text());
      given = f.get("token") ?? "";
      next = f.get("next") ?? "";
    } catch { /* refused below */ }
    const keep = safeNext(next) === "/" ? undefined : next;
    if (!secret || !https || !given || !bearerMatches(`Bearer ${given}`)) return signIn(true, 401, undefined, keep);
    return redirect(303, safeNext(next), sessionCookie("token"));
  }

  /** Story 29.1: an account route's body — a JSON body (`application/json`) answers JSON, any other body is a
   * browser form and answers HTML. Never logged. */
  async function accountBody(req: Request): Promise<{ json: boolean; username: unknown; password: unknown; next?: string } | Response> {
    const isJson = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
    const text = await req.text();
    if (!isJson) {
      const f = new URLSearchParams(text);
      const next = safeNext(f.get("next"));
      return { json: false, username: f.get("username") ?? "", password: f.get("password") ?? "", ...(next !== "/" ? { next } : {}) };
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return fail(400, "MalformedJson", { detail: "the body is not JSON" }); }
    const b = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return { json: true, username: b.username, password: b.password };
  }

  /** A refusal of an account route: JSON `{ok:false, error}` (plus extras), or the sign-in page at the status. */
  const accountRefusal = (isJson: boolean, status: number, error: string, extra: { field?: "username" | "password" } = {}, next?: string) =>
    isJson ? fail(status, error, extra) : signIn(!extra.field, status, extra.field, next);
  /** A success: JSON `{ok:true, username}` with the cookie, or `303 → next` (a safe `next`, else `/`) with it, as
   * the token form does. */
  const accountSession = (isJson: boolean, username: string, next?: string) => {
    const cookie = sessionCookie(`account:${username}`);
    return isJson ? json(200, { ok: true, username }, { "set-cookie": cookie, "cache-control": "no-store" }) : redirect(303, safeNext(next), cookie);
  };

  /** `POST /auth/account`: the owner's account, created once. Refused like the token form without the session
   * secret or https; 400 AccountInvalid naming the field; 409 AccountExists; then `account-created {username}`. */
  async function createAccountRoute(req: Request): Promise<Response> {
    const body = await accountBody(req);
    if (body instanceof Response) return body;
    const next = body.next;
    if (!secret || !https) return accountRefusal(body.json, 401, "SignInRefused", {}, next);
    try {
      readAccount(pageEnv, acctPath); // a malformed record is named (500), never answered as AccountExists
      const at = new Date(nowMs()).toISOString();
      const record = await createAccount(pageEnv, body.username, body.password, at, acctPath);
      queue.serviceEvent("account-created", { username: record.username }, at);
      return accountSession(body.json, record.username, next);
    } catch (e) {
      if (e instanceof AccountInvalid) return accountRefusal(body.json, 400, "AccountInvalid", { field: e.field }, next);
      if (e instanceof AccountExists) return accountRefusal(body.json, 409, "AccountExists", {}, next);
      if (e instanceof AccountRecordInvalid) return recordInvalid(body.json, next);
      throw e;
    }
  }

  /** `POST /auth/signin`: locked → 423 AccountLocked; a mismatch (or an unknown username) waits the fixed delay,
   * records `signin-refused {username, reason}`, and the fifth inside the window locks (423); else 401
   * SignInRefused. A match answers the session cookie. No row, answer or log carries the password or the hash.
   * Attempts are serialised; a username that fails the pattern is recorded truncated to 64 characters; a
   * malformed `account.json` is 500 AccountRecordInvalid. */
  async function signInRoute(req: Request): Promise<Response> {
    const body = await accountBody(req);
    if (body instanceof Response) return body;
    const next = body.next;
    if (!secret || !https) return accountRefusal(body.json, 401, "SignInRefused", {}, next);
    const given = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const valid = USERNAME_RE.test(given);
    const username = valid ? given : given.slice(0, 64);
    const at = () => new Date(nowMs()).toISOString();
    return await serialised(async () => {
      let record;
      try { record = readAccount(pageEnv, acctPath); } catch (e) {
        if (e instanceof AccountRecordInvalid) return recordInvalid(body.json, next);
        throw e;
      }
      if (lockState(queue, username, nowMs()).locked) {
        queue.serviceEvent("signin-refused", { username, reason: "locked" }, at());
        return accountRefusal(body.json, 423, "AccountLocked", {}, next);
      }
      const known = valid && record !== null && safeEqual(given, record.username);
      if (await verifyPassword(valid ? record : null, given, password)) return accountSession(body.json, record!.username, next);
      await sleep(delayMs);
      queue.serviceEvent("signin-refused", { username, reason: known ? "mismatch" : "unknown-username" }, at());
      if (lockState(queue, username, nowMs()).locked) return accountRefusal(body.json, 423, "AccountLocked", {}, next);
      return accountRefusal(body.json, 401, "SignInRefused", {}, next);
    });
  }

  /** The auth routes, answered before any auth; null for any other path. */
  async function authRoute(req: Request, url: URL, path: string, method: string): Promise<Response | null> {
    const allow = (m: string) => json(405, { ok: false, error: "MethodNotAllowed", allow: m }, { allow: m });
    if (path === "/auth/token") return method === "POST" ? await tokenSignIn(req) : allow("POST");
    if (path === "/auth/account") return method === "POST" ? await createAccountRoute(req) : allow("POST");
    if (path === "/auth/signin") return method === "POST" ? await signInRoute(req) : allow("POST");
    return null;
  }

  /** A cookie session's CSRF token from the `X-CSRF-Token` header or the form field `csrf`. */
  async function csrfGiven(req: Request): Promise<string> {
    const header = req.headers.get("x-csrf-token");
    if (header) return header;
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return "";
    try { return new URLSearchParams(await req.text()).get("csrf") ?? ""; } catch { return ""; }
  }

  /** What a valid cookie session may do: the GET routes, and cancel, the reply, (Story 32.1) the engagement's create
   * and typed inputs and (Story 32.2) the chat's message with CSRF. Anything else 401. */
  async function cookieRoute(req: Request, url: URL, path: string, method: string, cookie: string): Promise<Response> {
    const csrf = csrfToken(secret!, cookie);
    const readRoute = path === "/" || path === "/jobs" || path === "/status" || path === "/events" || path === "/agents"
      || path === "/board" || path === "/inbox" || path === "/office" || path === "/office/events" || /^\/runs\/[^/]+$/.test(path)
      || path === "/engagements" || /^\/engagements\/[^/]+$/.test(path) || /^\/chat\/[^/]+$/.test(path)
      || path === "/app" || path.startsWith("/app/");
    if (method === "GET" && readRoute) return await route(req, url, path, method, csrf, "cookie");
    if (method === "POST" && (/^\/runs\/[^/]+\/cancel$/.test(path) || /^\/inbox\/[^/]+\/reply$/.test(path)
      || path === "/engagements" || /^\/engagements\/[^/]+\/input$/.test(path) || /^\/chat\/[^/]+$/.test(path))) {
      const given = await csrfGiven(req);
      if (!given || !safeEqual(given, csrf)) return fail(403, "CsrfRefused");
      return await route(req, url, path, method, undefined, "cookie");
    }
    return fail(401, "Unauthorized");
  }

  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method.toUpperCase();
      const auth = await authRoute(req, url, path, method);
      if (auth) return auth;
      if (authorized(req)) return await route(req, url, path, method);
      const cookie = readCookie(req, SESSION_COOKIE);
      const session = secret && cookie ? verifySession(secret, cookie, nowMs()) : null;
      if (session && sessionSubAccepted(session.sub)) return await cookieRoute(req, url, path, method, cookie!);
      // Story 30.6: with no session, `/status` still varies on Accept — the sign-in page (HTML) or the 401 JSON.
      if (method === "GET" && path === "/status") {
        const answer = wantsHtml(req) ? signIn(false, 401, undefined, `${url.pathname}${url.search}`) : fail(401, "Unauthorized");
        answer.headers.set("vary", "Accept");
        return answer;
      }
      if (method === "GET" && (path === "/app" || path.startsWith("/app/"))) {
        return signIn(false, 401, undefined, `${url.pathname}${url.search}`);
      }
      return path === "/" && method === "GET" ? signIn() : fail(401, "Unauthorized");
    } catch (e) {
      return fail(500, "InternalError", { detail: redact(e instanceof Error ? e.message : String(e)) });
    }
  };

  /** The API's routes (once authorised: the bearer, or a cookie session's allowed subset). `via`: which of the two
   * authorised the request (Story 32.1: an engagement input's `source`). */
  async function route(req: Request, url: URL, path: string, method: string, csrf?: string, via: "bearer" | "cookie" = "bearer"): Promise<Response> {
    {
      // 405: the allowed methods in the `Allow` header (RFC 9110) and the body alike.
      const allow = (m: string) => json(405, { ok: false, error: "MethodNotAllowed", allow: m }, { allow: m });
      // Story 30.6: the home is the built web's index.html (as `GET /app`); no built web, the read-only page (never a 503).
      if (path === "/") return method !== "GET" ? allow("GET") : webRoot(deps.web ?? {}) !== null ? await web("/app") : await page(csrf);
      if (path === "/app" || path.startsWith("/app/")) return method === "GET" ? await web(path) : allow("GET");
      if (path === "/jobs") {
        if (method === "POST") return await postJobs(req);
        if (method === "GET") return json(200, { ok: true, jobs: queue.jobs() });
        return allow("GET, POST");
      }
      // Story 30.6: content-negotiated — HTML the read-only page, anything else today's JSON; both vary on Accept.
      if (path === "/status") {
        if (method !== "GET") return allow("GET");
        if (!wantsHtml(req)) return status();
        const answer = await page(csrf);
        answer.headers.set("vary", "Accept");
        return answer;
      }
      if (path === "/events") return method === "GET" ? events(req, url) : allow("GET");
      if (path === "/agents") {
        if (method !== "GET") return allow("GET");
        // Story 29.2: the table as the last rebuild left it — a read, never a rebuild.
        const { rebuilt_at, agents } = readAgents(queue, url.searchParams.get("project") ?? undefined);
        return json(200, { ok: true, rebuilt_at, agents });
      }
      if (path === "/board") {
        if (method !== "GET") return allow("GET");
        // Story 30.5: a read composed per request (the plan, findings and spend parts cached on their files).
        const project = url.searchParams.get("project")?.trim();
        if (!project) return fail(400, "ProjectRequired", { detail: "the board needs ?project=<id>" });
        const answer = await board(project);
        return answer ? json(200, answer) : fail(404, "UnknownProject", { project });
      }
      if (path === "/inbox") {
        if (method !== "GET") return allow("GET");
        // Story 31.5: the sync-back's inbox file as written (a read; a missing file is an empty list, never a 404).
        const project = url.searchParams.get("project")?.trim();
        // Story 31.6: a cookie session's answer — every one, the 400 ProjectRequired too — carries its CSRF token (the
        // web's reply needs it); a bearer's none.
        const answer = project
          ? await inboxRead(project, url.searchParams.get("issue"))
          : fail(400, "ProjectRequired", { detail: "the inbox needs ?project=<id>" });
        if (csrf) answer.headers.set("x-csrf-token", csrf);
        return answer;
      }
      const replyMatch = /^\/inbox\/([^/]+)\/reply$/.exec(path);
      if (replyMatch) {
        if (method !== "POST") return allow("POST");
        const key = decodeId(replyMatch[1]);
        return key === null ? fail(400, "BadIssue", { issue: replyMatch[1] }) : await postReplyRoute(req, key);
      }
      // Story 32.1: the engagement record and its typed inputs (contract 0.1.27 additive).
      if (path === "/engagements") {
        if (method === "POST") return await postEngagement(req, via);
        if (method === "GET") return await listEngagementsRoute(url);
        return allow("GET, POST");
      }
      const inputMatch = /^\/engagements\/([^/]+)\/input$/.exec(path);
      if (inputMatch) {
        if (method !== "POST") return allow("POST");
        const id = decodeId(inputMatch[1]);
        return id === null || !ENGAGEMENT_ID_RE.test(id) ? fail(400, "BadEngagement", { engagement: id ?? inputMatch[1] }) : await postInputRoute(req, url, id, via);
      }
      const engMatch = /^\/engagements\/([^/]+)$/.exec(path);
      if (engMatch) {
        if (method !== "GET") return allow("GET");
        const id = decodeId(engMatch[1]);
        return id === null || !ENGAGEMENT_ID_RE.test(id) ? fail(400, "BadEngagement", { engagement: id ?? engMatch[1] }) : await readEngagementRoute(url, id);
      }
      // Story 32.2: the engagement's chat (contract 0.1.27 additive).
      const chatMatch = /^\/chat\/([^/]+)$/.exec(path);
      if (chatMatch) {
        if (method !== "GET" && method !== "POST") return allow("GET, POST");
        const id = decodeId(chatMatch[1]);
        if (id === null || !ENGAGEMENT_ID_RE.test(id)) return fail(400, "BadEngagement", { engagement: id ?? chatMatch[1] });
        return method === "POST" ? await postChatRoute(req, url, id) : await readChatRoute(req, url, id);
      }
      // Story 29.3: the graced office view (a read: nothing is written to the queue).
      if (path === "/office") {
        if (method !== "GET") return allow("GET");
        await rootsReady(); // Story 32.1: the served roots the engagements are read from
        return json(200, { ok: true, ...officeSnapshot() });
      }
      if (path === "/office/events") {
        if (method !== "GET") return allow("GET");
        await rootsReady();
        return officeEvents(req);
      }
      const cancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(path);
      if (cancelMatch) {
        if (method !== "POST") return allow("POST");
        const runId = decodeId(cancelMatch[1]);
        return runId === null ? fail(404, "RunNotFound", { run_id: cancelMatch[1] }) : await postCancel(runId);
      }
      const resumeMatch = /^\/runs\/([^/]+)\/resume$/.exec(path);
      if (resumeMatch) {
        if (method !== "POST") return allow("POST");
        const runId = decodeId(resumeMatch[1]);
        return runId === null ? fail(404, "RunNotFound", { run_id: resumeMatch[1] }) : await postResume(req, runId);
      }
      const verifyMatch = /^\/runs\/([^/]+)\/verify$/.exec(path);
      if (verifyMatch) {
        if (method !== "POST") return allow("POST");
        const runId = decodeId(verifyMatch[1]);
        return runId === null ? fail(404, "RunNotFound", { run_id: verifyMatch[1] }) : await postVerify(req, runId);
      }
      const runMatch = /^\/runs\/([^/]+)$/.exec(path);
      if (runMatch) {
        if (method !== "GET") return allow("GET");
        const runId = decodeId(runMatch[1]);
        if (runId === null) return fail(404, "RunNotFound", { run_id: runMatch[1] });
        const run = queue.get(runId);
        if (!run) return fail(404, "RunNotFound", { run_id: runId });
        // Story 32.7 (0.1.27 additive): the run's metered cost — the ledger `job-run` `total_cost_usd` of its studio run
        // (`inbox.ts` `runCost`), null with no studio run id or no metered line.
        const cost_usd = run.studio_run_id ? runCost(ledgerPath(deps.env ?? process.env, deps.ledger), run.studio_run_id) : null;
        // Story 33.2 (0.1.28 additive): the latest reason a drain pass could not claim the queued run, else null.
        const claim_refused = claimRefusalView(queue, runId);
        return json(200, { ok: true, run_id: run.run_id, studio_run_id: run.studio_run_id, state: run.state, cost_usd, claim_refused, run, events: queue.events(runId) });
      }
      return fail(404, "NotFound", { path });
    }
  }
}

/** Story 33.2: a queued run's latest open claim refusal as the routes serve it — `{reason, resolves, pass_at, since}`
 * (`Queue.claimRefusal`), else null (no open refusal, or the run is no longer `queued`). */
export function claimRefusalView(queue: Queue, runId: string): { reason: string; resolves: string | null; pass_at: string; since: string } | null {
  const r = queue.claimRefusal(runId);
  return r ? { reason: r.reason, resolves: r.resolves, pass_at: r.pass_at, since: r.since } : null;
}

/** The part of `Bun.serve` `serve` uses (the injection seam: tests never bind a socket). */
export type BunServe = (options: Parameters<typeof Bun.serve>[0]) => { port: number | undefined; stop: (closeActiveConnections?: boolean) => unknown };

/** Start the API: bind, port, token, session secret and TLS (its files readable) validated first (a named
 * refusal, never bound), then the queue opened. With the TLS variables set it serves https on the same bind
 * (Story 22.5: the Tailscale certificate for the MagicDNS name); without them http, as in 22.1. Story 29.1:
 * each leftover provider variable still set is ignored with one warning naming it (never its value). */
export function serve(env: Env = process.env, bunServe: BunServe = (o) => Bun.serve(o)): { url: string; stop: () => void } {
  const bind = checkBind(apiBind(env));
  const port = apiPort(env);
  const token = apiToken(env);
  const secret = sessionSecret(env);
  const tls = tlsConfig(env);
  if (tls) checkTlsFiles(tls);
  notifier(env); // Story 22.3: a misconfigured notifier is a named start error (cancels notify from here)
  const queue = Queue.open(env);
  const origin = tls ? `https://${tls.name}:${port}` : `http://${bind}:${port}`;
  for (const name of oauthLeftovers(env)) {
    console.warn(`serve: ${name} is set but ignored — the Google and GitHub sign-in is gone (Story 29.1); the first visit creates the account`);
  }
  const server = bunServe({
    hostname: bind, port, idleTimeout: 0,
    ...(tls ? { tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) } } : {}),
    fetch: createApi({ queue, token, env, session: { secret }, origin }),
  });
  return { url: tls ? `https://${tls.name}:${server.port}` : `http://${bind}:${server.port}`, stop: () => { server.stop(true); queue.close(); } };
}
