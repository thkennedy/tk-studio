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
 *   GET  /runs/{id}          the queue run and its events (kinds and details as stored)
 *   POST /runs/{id}/cancel   ends the run `cancelled` (`cancelRun`); 409 once terminal; 409 ExternalRun on an
 *                            external run (Story 27.2: started outside the queue, never cancelled here)
 *   POST /runs/{id}/resume   {restore_patch?} (Story 27.3, bearer only): a paused run whose story did not land is
 *                            resumed (`resumeRun`: `bmad-loop resolve … --resume`); 200 {ok, run_id, state, engine_run_id},
 *                            400 SchemaError | MalformedJson, 404 RunNotFound, 409 RunNotPaused | ExternalRun | StoryLanded,
 *                            500 ResumeFailed
 *   GET  /status             counts per state, the live runs, the held checkout locks
 *   GET  /events?since=<seq> events with seq > since: JSON, or SSE with
 *                            `Accept: text/event-stream`
 *   GET  /agents[?project=<id>]  the agent registry (Story 29.2, `registry.ts`): {ok, rebuilt_at, agents}, one row per
 *                            (project, role); an unknown project answers `agents: []`. A read only: never rebuilds
 *   GET  /office             the office projection (Story 29.3, `office.ts`): {ok, at, agents, runs, problems, id} —
 *                            each registry agent's graced state, the live runs with story and epic progress
 *   GET  /office/events      with `Accept: text/event-stream`: `event:snapshot` first (or, for a valid `Last-Event-ID`,
 *                            the buffered deltas after it), then `office.agent` / `office.progress` / `office.run`
 *                            deltas (`id:<boot>-<seq>`), a `: heartbeat` comment every 10 s; without it the JSON snapshot
 *   GET  /                   the read-only status page (Story 22.2, `page.ts`): server-rendered
 *                            HTML, no script, credential-shaped values redacted; a note when the web is not built
 *   GET  /app[/…]            the studio web (Story 30.2, `web.ts`): the built web's file (its content type), or
 *                            `index.html` for a path with no file (the single-page fallback); a traversal (`..`,
 *                            an absolute path, `\`, `:`, NUL, a bad escape) 404 NotFound; no built web 503
 *                            WebNotBuilt {command}. Every answer `cache-control: no-store`
 *
 * Story 22.5 (`auth.ts`), Story 29.1 (`account.ts`): a browser signs in at `POST /auth/token`,
 * `POST /auth/account` (the owner's one account, created once) or `POST /auth/signin` (its username and
 * password, rate-limited with a lockout), all answered before any auth, and gets a signed session cookie.
 * The bearer header still authorises everything. Without it, a valid cookie authorises the GET routes, and
 * `POST /runs/{id}/cancel` with the page's CSRF token (else 403 CsrfRefused); never `POST /jobs`.
 * `GET /` with no auth is the 401 HTML sign-in page (account creation while no account exists); so is a
 * `GET /app[/…]` (Story 30.2), its forms carrying the requested path and query as `next`, where a successful
 * form sign-in returns (`303`; a `next` that is not a same-origin path returns to `/`). Everything else
 * stays 401 JSON.
 *
 * Run ids are queue run ids; answers carry `studio_run_id` too. The API never
 * drives or claims a run (drain and the pacer do).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  ACCOUNT_RELATIVE_PATH, AccountExists, AccountInvalid, accountPath, AccountRecordInvalid, createAccount, lockState, readAccount,
  SIGNIN_DELAY_MS, verifyPassword,
} from "./account";
import {
  csrfToken, readCookie, safeEqual, sessionSubAccepted, SESSION_COOKIE, SESSION_TTL_S, setCookie, signInPage, type SignInMode, signSession, USERNAME_RE, verifySession,
} from "./auth";
import { CancelRaced, cancelRun, ExternalRunRefused, resumeRun, StartError, submitProject, type AgentsOption } from "./cli";
import { ResumeRefused, type ResumeAnswer } from "./closeout";
import { apiBind, apiPort, apiToken, checkTlsFiles, notifier, oauthLeftovers, sessionSecret, tlsConfig } from "./env";
import { OfficeHub, type OfficeEvent } from "./office";
import { gatherPage, holderOf, renderPage } from "./page";
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
  /** Story 30.2: the studio web's root (default: the installed slot from `current.json`, else the checkout's
   * `apps/studio-web/dist`). */
  web?: WebOptions;
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
  const pollMs = deps.pollMs ?? 1000, keepaliveMs = deps.keepaliveMs ?? 15000;
  const clock = deps.now ?? Date.now;
  const office = deps.office ?? new OfficeHub({ queue, now: clock, pollMs, ...(deps.graceMs !== undefined ? { graceMs: deps.graceMs } : {}) });
  const heartbeatMs = deps.heartbeatMs ?? 10_000;

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

  function status(): Response {
    const runs = queue.runs();
    const counts: Record<string, number> = {};
    for (const r of runs) counts[r.state] = (counts[r.state] ?? 0) + 1;
    const live = runs.filter((r) => !isTerminal(r.state));
    const locks = queue.locks().map((l) => ({ checkout: l.checkout, root: l.root, acquired: l.acquired, holder: holderOf(l) }));
    return json(200, { ok: true, counts, live, locks });
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
    if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) return json(200, { ok: true, ...office.snapshot() });
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
          const snap = office.snapshot();
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
    const data = await gatherPage({ queue, token: deps.token, env: deps.env, registry: deps.registry ?? (() => registryShow()), ledger: deps.ledger, office, web: deps.web ?? {} });
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

  /** What a valid cookie session may do: the GET routes, and cancel with CSRF. Anything else 401. */
  async function cookieRoute(req: Request, url: URL, path: string, method: string, cookie: string): Promise<Response> {
    const csrf = csrfToken(secret!, cookie);
    const readRoute = path === "/" || path === "/jobs" || path === "/status" || path === "/events" || path === "/agents"
      || path === "/office" || path === "/office/events" || /^\/runs\/[^/]+$/.test(path)
      || path === "/app" || path.startsWith("/app/");
    if (method === "GET" && readRoute) return await route(req, url, path, method, csrf);
    if (method === "POST" && /^\/runs\/[^/]+\/cancel$/.test(path)) {
      const given = await csrfGiven(req);
      if (!given || !safeEqual(given, csrf)) return fail(403, "CsrfRefused");
      return await route(req, url, path, method);
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
      if (method === "GET" && (path === "/app" || path.startsWith("/app/"))) return signIn(false, 401, undefined, `${url.pathname}${url.search}`);
      return path === "/" && method === "GET" ? signIn() : fail(401, "Unauthorized");
    } catch (e) {
      return fail(500, "InternalError", { detail: redact(e instanceof Error ? e.message : String(e)) });
    }
  };

  /** The API's routes (once authorised: the bearer, or a cookie session's allowed subset). */
  async function route(req: Request, url: URL, path: string, method: string, csrf?: string): Promise<Response> {
    {
      // 405: the allowed methods in the `Allow` header (RFC 9110) and the body alike.
      const allow = (m: string) => json(405, { ok: false, error: "MethodNotAllowed", allow: m }, { allow: m });
      if (path === "/") return method === "GET" ? await page(csrf) : allow("GET");
      if (path === "/app" || path.startsWith("/app/")) return method === "GET" ? await web(path) : allow("GET");
      if (path === "/jobs") {
        if (method === "POST") return await postJobs(req);
        if (method === "GET") return json(200, { ok: true, jobs: queue.jobs() });
        return allow("GET, POST");
      }
      if (path === "/status") return method === "GET" ? status() : allow("GET");
      if (path === "/events") return method === "GET" ? events(req, url) : allow("GET");
      if (path === "/agents") {
        if (method !== "GET") return allow("GET");
        // Story 29.2: the table as the last rebuild left it — a read, never a rebuild.
        const { rebuilt_at, agents } = readAgents(queue, url.searchParams.get("project") ?? undefined);
        return json(200, { ok: true, rebuilt_at, agents });
      }
      // Story 29.3: the graced office view (a read: nothing is written to the queue).
      if (path === "/office") return method === "GET" ? json(200, { ok: true, ...office.snapshot() }) : allow("GET");
      if (path === "/office/events") return method === "GET" ? officeEvents(req) : allow("GET");
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
      const runMatch = /^\/runs\/([^/]+)$/.exec(path);
      if (runMatch) {
        if (method !== "GET") return allow("GET");
        const runId = decodeId(runMatch[1]);
        if (runId === null) return fail(404, "RunNotFound", { run_id: runMatch[1] });
        const run = queue.get(runId);
        if (!run) return fail(404, "RunNotFound", { run_id: runId });
        return json(200, { ok: true, run_id: run.run_id, studio_run_id: run.studio_run_id, state: run.state, run, events: queue.events(runId) });
      }
      return fail(404, "NotFound", { path });
    }
  }
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
