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
 *   POST /runs/{id}/cancel   ends the run `cancelled` (`cancelRun`); 409 once terminal
 *   GET  /status             counts per state, the live runs, the held checkout locks
 *   GET  /events?since=<seq> events with seq > since: JSON, or SSE with
 *                            `Accept: text/event-stream`
 *   GET  /                   the read-only status page (Story 22.2, `page.ts`): server-rendered
 *                            HTML, no script, credential-shaped values redacted
 *
 * Story 22.5 (`auth.ts`): a browser signs in at `POST /auth/token`, `GET /auth/{google,github}` and
 * their `/callback`s (answered before any auth) and gets a signed session cookie. The bearer header
 * still authorises everything. Without it, a valid cookie authorises the GET routes, and
 * `POST /runs/{id}/cancel` with the page's CSRF token (else 403 CsrfRefused); never `POST /jobs`.
 * `GET /` with no auth is the 401 HTML sign-in page; everything else stays 401 JSON.
 *
 * Run ids are queue run ids; answers carry `studio_run_id` too. The API never
 * drives or claims a run (drain and the pacer do).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  allowed, authorizeUrl, csrfToken, type FetchLike, newState, oauthIdentity, PROVIDERS, type ProviderName, readCookie,
  safeEqual, SESSION_COOKIE, SESSION_TTL_S, setCookie, signInPage, signSession, signState, STATE_COOKIE, STATE_TTL_S,
  verifySession, verifyState,
} from "./auth";
import { CancelRaced, cancelRun, StartError, submitProject } from "./cli";
import { apiBind, apiPort, apiToken, checkTlsFiles, notifier, type OAuthConfig, oauthConfig, sessionSecret, tlsConfig } from "./env";
import { gatherPage, holderOf, renderPage } from "./page";
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
  /** Story 22.5: the configured OAuth providers, the public origin their callbacks live on
   * (`https://<TLS_NAME>:<port>`), and the provider `fetch` (default the global one). Without an
   * `https` origin the token form refuses (a `Secure` cookie never sticks over http). */
  oauth?: { providers: OAuthConfig; origin: string; fetch?: FetchLike };
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
  const cancel = deps.cancel ?? ((id: string) => cancelRun(queue, id));
  const pollMs = deps.pollMs ?? 1000, keepaliveMs = deps.keepaliveMs ?? 15000;
  const clock = deps.now ?? Date.now;

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
    const lock = run ? queue.lock(run.root) : null;
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
      throw e;
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

  /** The status page: reads only (queue, store, registry), rendered to HTML. A cookie session's page
   * carries its CSRF token in each live run's cancel form. */
  async function page(csrf?: string): Promise<Response> {
    const data = await gatherPage({ queue, token: deps.token, env: deps.env, registry: deps.registry ?? (() => registryShow()), ledger: deps.ledger });
    return new Response(renderPage(data, csrf ? { csrf } : {}), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  // ---------------------------------------------------------- the sign-in (Story 22.5)

  const html = (status: number, body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });
  /** Served over https? Without it the browser drops the `Secure` cookie, so the token form refuses
   * and the sign-in page says browser sign-in needs https. */
  const https = /^https:\/\//i.test(deps.oauth?.origin ?? "");
  /** The sign-in page; a refusal is the same page with a generic line, never a cookie or a detail. */
  const signIn = (refused = false) => html(401, signInPage({ refused, needsHttps: !https }));
  const redirect = (status: number, location: string, cookie: string) =>
    new Response(null, { status, headers: { location, "set-cookie": cookie, "cache-control": "no-store" } });
  const secret = deps.session?.secret;
  const nowMs = () => clock();
  const sessionCookie = (sub: string) => setCookie(SESSION_COOKIE, signSession(secret!, sub, nowMs()), SESSION_TTL_S);
  const oauthFetch: FetchLike = deps.oauth?.fetch ?? ((input, init) => fetch(input, init));
  const callbackUri = (p: ProviderName) => `${deps.oauth!.origin.replace(/\/+$/, "")}/auth/${p}/callback`;

  /** `POST /auth/token`: the API token from the form, compared as the bearer header is. Refused
   * like a bad token without https (the cookie would be dropped). */
  async function tokenSignIn(req: Request): Promise<Response> {
    let given = "";
    try { given = new URLSearchParams(await req.text()).get("token") ?? ""; } catch { /* refused below */ }
    if (!secret || !https || !given || !bearerMatches(`Bearer ${given}`)) return signIn(true);
    return redirect(303, "/", sessionCookie("token"));
  }

  /** `GET /auth/<p>`: to the provider, with the signed state cookie. */
  function oauthStart(p: ProviderName): Response {
    const cfg = deps.oauth?.providers[p];
    if (!secret || !cfg) return signIn(true);
    const state = newState();
    return redirect(302, authorizeUrl(p, cfg, callbackUri(p), state), setCookie(STATE_COOKIE, signState(secret, p, state, nowMs()), STATE_TTL_S));
  }

  /** `GET /auth/<p>/callback`: the state checked first (the provider never called on a failure), then
   * the verified identity matched against the one allow entry. */
  async function oauthCallback(p: ProviderName, req: Request, url: URL): Promise<Response> {
    const cfg = deps.oauth?.providers[p];
    if (!secret || !cfg) return signIn(true);
    const expectedState = verifyState(secret, p, readCookie(req, STATE_COOKIE), nowMs());
    const state = url.searchParams.get("state") ?? "";
    if (!expectedState || !state || !safeEqual(state, expectedState)) return signIn(true);
    const code = url.searchParams.get("code") ?? "";
    if (!code) return signIn(true);
    const identity = await oauthIdentity(p, cfg, code, callbackUri(p), oauthFetch);
    if (!identity || !allowed(identity, cfg.allow)) return signIn(true);
    return redirect(303, "/", sessionCookie(`${p}:${identity.toLowerCase()}`));
  }

  /** The auth routes, answered before any auth; null for any other path. */
  async function authRoute(req: Request, url: URL, path: string, method: string): Promise<Response | null> {
    const allow = (m: string) => json(405, { ok: false, error: "MethodNotAllowed", allow: m }, { allow: m });
    if (path === "/auth/token") return method === "POST" ? await tokenSignIn(req) : allow("POST");
    for (const p of PROVIDERS) {
      if (path === `/auth/${p}`) return method === "GET" ? oauthStart(p) : allow("GET");
      if (path === `/auth/${p}/callback`) return method === "GET" ? await oauthCallback(p, req, url) : allow("GET");
    }
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
    const readRoute = path === "/" || path === "/jobs" || path === "/status" || path === "/events" || /^\/runs\/[^/]+$/.test(path);
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
      if (secret && cookie && verifySession(secret, cookie, nowMs())) return await cookieRoute(req, url, path, method, cookie);
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
      if (path === "/jobs") {
        if (method === "POST") return await postJobs(req);
        if (method === "GET") return json(200, { ok: true, jobs: queue.jobs() });
        return allow("GET, POST");
      }
      if (path === "/status") return method === "GET" ? status() : allow("GET");
      if (path === "/events") return method === "GET" ? events(req, url) : allow("GET");
      const cancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(path);
      if (cancelMatch) {
        if (method !== "POST") return allow("POST");
        const runId = decodeId(cancelMatch[1]);
        return runId === null ? fail(404, "RunNotFound", { run_id: cancelMatch[1] }) : await postCancel(runId);
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

/** Start the API: bind, port, token, session secret, TLS (its files readable) and OAuth validated first
 * (a named refusal, never bound), then the queue opened. With the TLS variables set it serves https on
 * the same bind (Story 22.5: the Tailscale certificate for the MagicDNS name); without them http, as in 22.1. */
export function serve(env: Env = process.env, bunServe: BunServe = (o) => Bun.serve(o)): { url: string; stop: () => void } {
  const bind = checkBind(apiBind(env));
  const port = apiPort(env);
  const token = apiToken(env);
  const secret = sessionSecret(env);
  const tls = tlsConfig(env);
  const providers = oauthConfig(env);
  if (tls) checkTlsFiles(tls);
  notifier(env); // Story 22.3: a misconfigured notifier is a named start error (cancels notify from here)
  const queue = Queue.open(env);
  const origin = tls ? `https://${tls.name}:${port}` : `http://${bind}:${port}`;
  const server = bunServe({
    hostname: bind, port, idleTimeout: 0,
    ...(tls ? { tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) } } : {}),
    fetch: createApi({ queue, token, env, session: { secret }, oauth: { providers, origin } }),
  });
  return { url: tls ? `https://${tls.name}:${server.port}` : `http://${bind}:${server.port}`, stop: () => { server.stop(true); queue.close(); } };
}
