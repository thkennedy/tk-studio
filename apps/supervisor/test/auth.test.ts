// Story 22.5: sign in from the phone — the cookie session beside the bearer header.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  allowed, csrfToken, ENDPOINTS, type FetchLike, NEEDS_HTTPS_NOTE, readCookie, SESSION_COOKIE, SESSION_TTL_S, signInPage, signSession,
  signState, STATE_COOKIE, STATE_TTL_S, verifySession, verifyState,
} from "../src/auth";
import { type BunServe, createApi, serve, type SubmitBody } from "../src/api";
import {
  OAuthAllowInvalid, OAuthConfigIncomplete, oauthConfig, OAuthNeedsHttps, SessionSecretMissing, sessionSecret, SessionSecretWeak,
  TlsCertUnreadable, TlsConfigIncomplete, tlsConfig,
} from "../src/env";
import { renderPage, redactCredentials, type PageData } from "../src/page";
import { Queue, type Owner, type Probes, type WorkerKill } from "../src/queue";
import { buildWorkerEnv } from "../src/server";

const TOKEN = "tok-auth-5e2b-very-secret-value";
const SECRET = "session-secret-0123456789abcdef-0123456789abcdef";
const GOOGLE_SECRET = "google-client-secret-planted-31ab";
const GITHUB_SECRET = "github-client-secret-planted-77cd";
const GOOGLE_ALLOW = "tim@example.com";
const GITHUB_ALLOW = "thkennedy";
const ORIGIN = "https://box.tail1234.ts.net:8787";
const BASE = "http://100.100.1.2:8787";
const HOST = hostname();
const A: Owner = { pid: 940001, host: HOST, nonce: "auth-nonce-a" };
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);

/** Every cookie value an answer set during the suite: none may appear in a console line or a body. */
const cookiesSeen: string[] = [];
const SECRETS = [TOKEN, SECRET, GOOGLE_SECRET, GITHUB_SECRET];

// Every console line written while this suite runs: no secret and no cookie value among them.
const captured: string[] = [];
const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
beforeAll(() => {
  for (const k of Object.keys(originals) as (keyof typeof originals)[]) {
    console[k] = (...args: unknown[]) => { captured.push(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); };
  }
});
afterAll(() => {
  Object.assign(console, originals);
  for (const v of [...SECRETS, ...cookiesSeen]) expect(captured.filter((l) => l.includes(v))).toEqual([]);
});

interface ProviderFake {
  google?: { email?: string; email_verified?: boolean | string; tokenStatus?: number };
  github?: { login?: string; tokenStatus?: number };
}

/** A faked provider behind the injected `fetch`: records every call, never the network. */
function fakeProvider(o: ProviderFake = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url === ENDPOINTS.google.token) return o.google?.tokenStatus ? new Response("{}", { status: o.google.tokenStatus }) : ok({ access_token: "g-access" });
    if (url === ENDPOINTS.google.user) return ok({ email: o.google?.email ?? GOOGLE_ALLOW, email_verified: o.google?.email_verified ?? true });
    if (url === ENDPOINTS.github.token) return o.github?.tokenStatus ? new Response("{}", { status: o.github.tokenStatus }) : ok({ access_token: "gh-access" });
    if (url === ENDPOINTS.github.user) return ok({ login: o.github?.login ?? GITHUB_ALLOW });
    return new Response("not found", { status: 404 });
  };
  return { calls, fetcher };
}

interface FxOpts { provider?: ProviderFake; providers?: "both" | "none"; session?: boolean; origin?: string }

function fixture(o: FxOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-auth-"));
  const store = mkdtempSync(join(tmpdir(), "tk-sup-auth-store-"));
  const checkout = mkdtempSync(join(tmpdir(), "tk-sup-auth-checkout-"));
  let now = T0;
  const probes: Probes = {
    ownerAlive: (w) => w.pid === A.pid,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
    probeWorker: (pid, start): WorkerKill => ({ pid, start, outcome: "not running" }),
  };
  const queue = new Queue(join(dir, "q.db"), probes);
  const enqueue = (jobId = "studio-health") => queue.enqueue({
    jobId, root: checkout, projectId: "p", target: "skill", definition: { id: jobId, trigger: "one-shot", target: { skill: "tk-studio-activate" } },
  }).run;
  const submitted: SubmitBody[] = [];
  const cancelled: string[] = [];
  const env = {
    TK_STUDIO_HOME: store, TK_SUPERVISOR_TOKEN: TOKEN, TK_SUPERVISOR_SESSION_SECRET: SECRET,
    TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET: GOOGLE_SECRET, TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET: GITHUB_SECRET,
  };
  const provider = fakeProvider(o.provider);
  const providers = o.providers === "none" ? {} : {
    google: { clientId: "g-client", clientSecret: GOOGLE_SECRET, allow: GOOGLE_ALLOW },
    github: { clientId: "gh-client", clientSecret: GITHUB_SECRET, allow: GITHUB_ALLOW },
  };
  const handler = createApi({
    queue, token: TOKEN, env, registry: async () => ({ ok: true, projects: {} }), ledger: { user: "op", machine: "box" },
    now: () => now,
    submit: async (b) => { submitted.push(b); const { run } = queue.enqueue({ jobId: b.job, root: checkout, projectId: b.project, target: "skill", definition: { id: b.job } }); return { ok: true, run_id: run.run_id }; },
    cancel: async (id) => { cancelled.push(id); queue.end(id, "cancelled", "cancelled over the API"); return queue.get(id)!; },
    ...(o.session === false ? {} : { session: { secret: SECRET } }),
    oauth: { providers, origin: o.origin ?? ORIGIN, fetch: provider.fetcher },
  });
  const call = async (method: string, path: string, init: { body?: string; headers?: Record<string, string>; cookie?: string; bearer?: boolean } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.bearer) headers.authorization = `Bearer ${TOKEN}`;
    const res = await handler(new Request(`${BASE}${path}`, { method, body: init.body, headers }));
    for (const c of setCookies(res)) cookiesSeen.push(c.value);
    return res;
  };
  return { queue, enqueue, call, submitted, cancelled, provider, advance: (ms: number) => { now += ms; }, now: () => now };
}

/** The `Set-Cookie` headers of an answer: name, value and the attribute string. */
function setCookies(res: Response): { name: string; value: string; attrs: string; raw: string }[] {
  return res.headers.getSetCookie().map((raw) => {
    const [pair, ...attrs] = raw.split(";");
    const eq = pair.indexOf("=");
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs: attrs.map((a) => a.trim()).join("; "), raw };
  });
}

const form = (fields: Record<string, string>) => ({ body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });

/** Sign in with the token form; answers the session cookie value. */
async function tokenSession(fx: ReturnType<typeof fixture>): Promise<string> {
  const res = await fx.call("POST", "/auth/token", form({ token: TOKEN }));
  expect(res.status).toBe(303);
  return setCookies(res).find((c) => c.name === SESSION_COOKIE)!.value;
}

/** Start an OAuth sign-in; answers the state and the state cookie value. */
async function oauthStart(fx: ReturnType<typeof fixture>, p: "google" | "github") {
  const res = await fx.call("GET", `/auth/${p}`);
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location")!);
  return { res, loc, state: loc.searchParams.get("state")!, cookie: setCookies(res).find((c) => c.name === STATE_COOKIE)! };
}

async function expectRefused(res: Response) {
  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toStartWith("text/html");
  expect(res.headers.getSetCookie()).toEqual([]);
  const body = await res.text();
  expect(body).toContain("Sign-in refused.");
  expect(body).toContain('action="/auth/token"');
  for (const v of SECRETS) expect(body).not.toContain(v);
}

describe("the session cookie, the CSRF token and the state cookie (unit)", () => {
  test("a signed session verifies until its exp; a bad signature, a tampered payload or exp ≤ now is no session", () => {
    const c = signSession(SECRET, "token", T0);
    expect(verifySession(SECRET, c, T0)).toEqual({ sub: "token", exp: T0 / 1000 + SESSION_TTL_S });
    expect(verifySession(SECRET, c, T0 + (SESSION_TTL_S - 1) * 1000)).not.toBeNull();
    expect(verifySession(SECRET, c, T0 + SESSION_TTL_S * 1000)).toBeNull(); // exp == now
    expect(verifySession("another-secret", c, T0)).toBeNull();
    const [body, sig] = c.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "token", exp: T0 / 1000 + 10 * SESSION_TTL_S })).toString("base64url");
    expect(verifySession(SECRET, `${forged}.${sig}`, T0)).toBeNull();
    expect(verifySession(SECRET, `${body}.${sig}x`, T0)).toBeNull();
    for (const bad of [null, "", "garbage", `${body}.`, `.${sig}`]) expect(verifySession(SECRET, bad, T0)).toBeNull();
  });

  test("the CSRF token is derived from the cookie, never equal to it, and differs per session", () => {
    const c1 = signSession(SECRET, "token", T0), c2 = signSession(SECRET, "github:x", T0);
    expect(csrfToken(SECRET, c1)).not.toBe(c1);
    expect(c1).not.toContain(csrfToken(SECRET, c1));
    expect(csrfToken(SECRET, c1)).toBe(csrfToken(SECRET, c1));
    expect(csrfToken(SECRET, c1)).not.toBe(csrfToken(SECRET, c2));
  });

  test("the state cookie: 600 s, bound to its provider", () => {
    const s = signState(SECRET, "google", "st-1", T0);
    expect(verifyState(SECRET, "google", s, T0)).toBe("st-1");
    expect(verifyState(SECRET, "github", s, T0)).toBeNull();
    expect(verifyState(SECRET, "google", s, T0 + STATE_TTL_S * 1000)).toBeNull();
    expect(verifyState(SECRET, "google", signSession(SECRET, "token", T0), T0)).toBeNull(); // a session is not a state
  });

  test("the allow match: case-insensitive equality, nothing else", () => {
    expect(allowed("Tim@Example.com", GOOGLE_ALLOW)).toBe(true);
    for (const id of ["tim@example.co", "xtim@example.com", "", "*"]) expect(allowed(id, GOOGLE_ALLOW)).toBe(false);
  });

  test("readCookie picks the named cookie out of the header", () => {
    const req = new Request(BASE, { headers: { cookie: `a=1; ${SESSION_COOKIE}=v.s; tk_oauth_state=x` } });
    expect(readCookie(req, SESSION_COOKIE)).toBe("v.s");
    expect(readCookie(req, "nope")).toBeNull();
  });

  test("the sign-in page: the token form and both links, no script", () => {
    const page = signInPage();
    expect(page).toContain('<form method="post" action="/auth/token">');
    expect(page).toContain('name="token"');
    expect(page).toContain('<a href="/auth/google">Continue with Google</a>');
    expect(page).toContain('<a href="/auth/github">Continue with GitHub</a>');
    expect(page.toLowerCase()).not.toContain("<script");
    expect(page).not.toContain("Sign-in refused.");
    expect(signInPage({ refused: true })).toContain("Sign-in refused.");
    expect(page).not.toContain(NEEDS_HTTPS_NOTE);
    expect(signInPage({ needsHttps: true })).toContain(`<p class="note">${NEEDS_HTTPS_NOTE}</p>`);
  });
});

describe("unauthenticated (AC1)", () => {
  test("GET / with no bearer and no, an invalid or an expired cookie: the 401 sign-in page, nothing of the page", async () => {
    const fx = fixture();
    fx.enqueue("secret-job-name");
    const expired = signSession(SECRET, "token", T0 - SESSION_TTL_S * 1000);
    const forged = signSession("not-the-secret", "token", T0);
    for (const cookie of [undefined, `${SESSION_COOKIE}=garbage`, `${SESSION_COOKIE}=${expired}`, `${SESSION_COOKIE}=${forged}`]) {
      const res = await fx.call("GET", "/", { cookie });
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toStartWith("text/html");
      expect(res.headers.getSetCookie()).toEqual([]);
      const body = await res.text();
      expect(body).toContain('action="/auth/token"');
      expect(body).toContain('href="/auth/google"');
      expect(body).toContain('href="/auth/github"');
      expect(body).not.toContain("Sign-in refused.");
      expect(body).not.toContain("secret-job-name");
      expect(body).not.toContain('id="runs"');
      expect(body.toLowerCase()).not.toContain("<script");
    }
  });

  test("every API route with no bearer and no cookie: 401 JSON, unchanged", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    for (const [method, path] of [["GET", "/status"], ["GET", "/jobs"], ["POST", "/jobs"], ["GET", `/runs/${run.run_id}`],
      ["POST", `/runs/${run.run_id}/cancel`], ["GET", "/events?since=0"], ["GET", "/nope"], ["POST", "/"]] as const) {
      const res = await fx.call(method, path, method === "POST" ? { body: "{}" } : {});
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
    }
    expect(fx.cancelled).toEqual([]);
  });

  test("the bearer header still authorises everything, as in 22.1 (the page without cancel forms)", async () => {
    const fx = fixture();
    fx.enqueue();
    const res = await fx.call("GET", "/", { bearer: true });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('name="csrf"');
    expect((await fx.call("POST", "/jobs", { bearer: true, body: JSON.stringify({ project: "p", job: "j" }) })).status).toBe(200);
    expect(fx.submitted).toHaveLength(1);
  });
});

describe("the token form (AC2)", () => {
  test("the right token: 303 → / with the session cookie, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 7 days", async () => {
    const fx = fixture();
    const res = await fx.call("POST", "/auth/token", form({ token: TOKEN }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(SESSION_COOKIE);
    expect(cookies[0].attrs).toBe("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800");
    expect(verifySession(SECRET, cookies[0].value, fx.now())).toEqual({ sub: "token", exp: T0 / 1000 + 604800 });
    const body = await res.text();
    for (const v of [...SECRETS, cookies[0].value]) expect(body).not.toContain(v);
  });

  test("a wrong, empty or missing token: the refused sign-in page, no cookie", async () => {
    const fx = fixture();
    for (const init of [form({ token: `${TOKEN}x` }), form({ token: "" }), form({}), { body: "" }, form({ token: TOKEN.slice(0, -1) })]) {
      await expectRefused(await fx.call("POST", "/auth/token", init));
    }
  });

  test("no https origin: the right token is refused like a bad one (no cookie), and the page says sign-in needs https", async () => {
    for (const fx of [fixture({ origin: BASE, providers: "none" }), fixture({ origin: "" })]) {
      const res = await fx.call("POST", "/auth/token", form({ token: TOKEN }));
      expect(res.headers.getSetCookie()).toEqual([]);
      const body = await res.clone().text();
      expect(body).toContain(NEEDS_HTTPS_NOTE);
      await expectRefused(res);
      expect(await (await fx.call("GET", "/")).text()).toContain(NEEDS_HTTPS_NOTE);
    }
    // With the https origin the note is absent.
    expect(await (await fixture().call("GET", "/")).text()).not.toContain(NEEDS_HTTPS_NOTE);
  });

  test("no session secret: every sign-in is refused", async () => {
    const fx = fixture({ session: false });
    await expectRefused(await fx.call("POST", "/auth/token", form({ token: TOKEN })));
    await expectRefused(await fx.call("GET", "/auth/google"));
  });
});

describe("OAuth (AC2)", () => {
  test("start: 302 to the provider's authorize URL with state, plus a 600 s signed state cookie", async () => {
    const fx = fixture();
    for (const p of ["google", "github"] as const) {
      const { loc, state, cookie } = await oauthStart(fx, p);
      expect(`${loc.origin}${loc.pathname}`).toBe(ENDPOINTS[p].authorize);
      expect(loc.searchParams.get("client_id")).toBe(p === "google" ? "g-client" : "gh-client");
      expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/${p}/callback`);
      expect(state.length).toBeGreaterThanOrEqual(32);
      expect(loc.toString()).not.toContain(p === "google" ? GOOGLE_SECRET : GITHUB_SECRET);
      expect(cookie.attrs).toBe("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600");
      expect(verifyState(SECRET, p, cookie.value, fx.now())).toBe(state);
    }
    expect(fx.provider.calls).toEqual([]);
  });

  test("Google callback against a faked provider: code exchanged, userinfo read, the allow-listed verified email signs in", async () => {
    const fx = fixture({ provider: { google: { email: "TIM@example.com" } } });
    const { state, cookie } = await oauthStart(fx, "google");
    const res = await fx.call("GET", `/auth/google/callback?code=c-1&state=${state}`, { cookie: `${STATE_COOKIE}=${cookie.value}` });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const session = setCookies(res).find((c) => c.name === SESSION_COOKIE)!;
    expect(session.attrs).toBe("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800");
    expect(verifySession(SECRET, session.value, fx.now())!.sub).toBe("google:tim@example.com");
    // The exchange: the code, the client secret and the redirect URI to the token endpoint; then userinfo with the access token.
    expect(fx.provider.calls.map((c) => c.url)).toEqual([ENDPOINTS.google.token, ENDPOINTS.google.user]);
    const sent = new URLSearchParams(String(fx.provider.calls[0].init!.body));
    expect(Object.fromEntries(sent)).toEqual({ client_id: "g-client", client_secret: GOOGLE_SECRET, code: "c-1", redirect_uri: `${ORIGIN}/auth/google/callback`, grant_type: "authorization_code" });
    expect((fx.provider.calls[1].init!.headers as Record<string, string>).authorization).toBe("Bearer g-access");
    // The session works.
    expect((await fx.call("GET", "/status", { cookie: `${SESSION_COOKIE}=${session.value}` })).status).toBe(200);
  });

  test("GitHub callback against a faked provider: the /user login signs in", async () => {
    const fx = fixture({ provider: { github: { login: "THKennedy" } } });
    const { state, cookie } = await oauthStart(fx, "github");
    const res = await fx.call("GET", `/auth/github/callback?code=c-2&state=${state}`, { cookie: `${STATE_COOKIE}=${cookie.value}` });
    expect(res.status).toBe(303);
    const session = setCookies(res).find((c) => c.name === SESSION_COOKIE)!;
    expect(verifySession(SECRET, session.value, fx.now())!.sub).toBe("github:thkennedy");
    expect(fx.provider.calls.map((c) => c.url)).toEqual([ENDPOINTS.github.token, ENDPOINTS.github.user]);
    expect(new URLSearchParams(String(fx.provider.calls[0].init!.body)).get("client_secret")).toBe(GITHUB_SECRET);
  });

  test("allow-list refusal: an identity off the list, or Google's email unverified — no session cookie", async () => {
    for (const provider of [
      { google: { email: "someone@example.com" } }, { google: { email: GOOGLE_ALLOW, email_verified: false } },
      { google: { email: GOOGLE_ALLOW, email_verified: "false" } }, { google: { email: `${GOOGLE_ALLOW}.evil.com` } },
      { github: { login: "thkennedy-evil" } }, { google: { tokenStatus: 400 } }, { github: { tokenStatus: 500 } },
    ] as ProviderFake[]) {
      const fx = fixture({ provider });
      const p = provider.google ? "google" : "github";
      const { state, cookie } = await oauthStart(fx, p);
      await expectRefused(await fx.call("GET", `/auth/${p}/callback?code=c&state=${state}`, { cookie: `${STATE_COOKIE}=${cookie.value}` }));
    }
  });

  test("state-check refusal: state missing, ≠ the cookie, the cookie missing, expired, forged or another provider's — the provider never called", async () => {
    const fx = fixture();
    const g = await oauthStart(fx, "google");
    const gh = await oauthStart(fx, "github");
    const cases: [string, string | undefined][] = [
      [`/auth/google/callback?code=c`, `${STATE_COOKIE}=${g.cookie.value}`],
      [`/auth/google/callback?code=c&state=${g.state}x`, `${STATE_COOKIE}=${g.cookie.value}`],
      [`/auth/google/callback?code=c&state=${g.state}`, undefined],
      [`/auth/google/callback?code=c&state=${g.state}`, `${STATE_COOKIE}=${signState("not-the-secret", "google", g.state, fx.now())}`],
      [`/auth/google/callback?code=c&state=${gh.state}`, `${STATE_COOKIE}=${gh.cookie.value}`],
    ];
    for (const [path, cookie] of cases) await expectRefused(await fx.call("GET", path, { cookie }));
    fx.advance(STATE_TTL_S * 1000);
    await expectRefused(await fx.call("GET", `/auth/google/callback?code=c&state=${g.state}`, { cookie: `${STATE_COOKIE}=${g.cookie.value}` }));
    expect(fx.provider.calls).toEqual([]);
  });

  test("a valid state but no code (e.g. the user denied): refused, the provider never called", async () => {
    const fx = fixture();
    const g = await oauthStart(fx, "google");
    await expectRefused(await fx.call("GET", `/auth/google/callback?error=access_denied&state=${g.state}`, { cookie: `${STATE_COOKIE}=${g.cookie.value}` }));
    expect(fx.provider.calls).toEqual([]);
  });

  test("a provider not configured: start and callback refused with no detail", async () => {
    const fx = fixture({ providers: "none" });
    for (const p of ["google", "github"]) {
      await expectRefused(await fx.call("GET", `/auth/${p}`));
      await expectRefused(await fx.call("GET", `/auth/${p}/callback?code=c&state=s`));
    }
    expect(fx.provider.calls).toEqual([]);
  });
});

describe("a signed-in browser (AC3)", () => {
  test("the cookie reads GET /, /jobs, /runs/{id}, /status and /events (JSON and SSE) as the bearer does", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    const c = `${SESSION_COOKIE}=${await tokenSession(fx)}`;
    for (const path of ["/jobs", `/runs/${run.run_id}`, "/status", "/events?since=0"]) {
      const byCookie = await fx.call("GET", path, { cookie: c });
      const byBearer = await fx.call("GET", path, { bearer: true });
      expect(byCookie.status).toBe(200);
      expect(await byCookie.json()).toEqual(await byBearer.json());
    }
    const page = await fx.call("GET", "/", { cookie: c });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toStartWith("text/html");
    expect(await page.text()).toContain(`id="run-${run.run_id}"`);
    const sse = await fx.call("GET", "/events", { cookie: c, headers: { accept: "text/event-stream" } });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toBe("text/event-stream");
    await sse.body!.cancel();
  });

  test("the page embeds the CSRF token in a cancel form for each live run only; never the cookie value", async () => {
    const fx = fixture();
    const live = fx.enqueue("live-one");
    const ended = fx.enqueue("ended-one");
    await fx.queue.claim(ended.run_id, A);
    fx.queue.end(ended.run_id, "complete", "done");
    const cookie = await tokenSession(fx);
    const body = await (await fx.call("GET", "/", { cookie: `${SESSION_COOKIE}=${cookie}` })).text();
    const csrf = csrfToken(SECRET, cookie);
    expect(body).toContain(`<form class="cancel" method="post" action="/runs/${encodeURIComponent(live.run_id)}/cancel"><input type="hidden" name="csrf" value="${csrf}">`);
    expect(body).not.toContain(`/runs/${encodeURIComponent(ended.run_id)}/cancel`);
    expect(body).not.toContain(cookie);
    for (const v of SECRETS) expect(body).not.toContain(v);
    expect(body.toLowerCase()).not.toContain("<script");
  });

  test("cancel with the cookie and the CSRF token (form field or header): the bearer's cancel answer", async () => {
    const fx = fixture();
    const cookie = await tokenSession(fx);
    const csrf = csrfToken(SECRET, cookie);
    const r1 = fx.enqueue("one"), r2 = fx.enqueue("two");
    const viaForm = await fx.call("POST", `/runs/${r1.run_id}/cancel`, { cookie: `${SESSION_COOKIE}=${cookie}`, ...form({ csrf }) });
    expect(viaForm.status).toBe(200);
    expect(await viaForm.json()).toMatchObject({ ok: true, run_id: r1.run_id, state: "cancelled" });
    const viaHeader = await fx.call("POST", `/runs/${r2.run_id}/cancel`, { cookie: `${SESSION_COOKIE}=${cookie}`, headers: { "x-csrf-token": csrf } });
    expect(viaHeader.status).toBe(200);
    expect(fx.cancelled).toEqual([r1.run_id, r2.run_id]);
  });

  test("CSRF refusal: a cookie cancel with a missing or wrong token is 403 CsrfRefused, nothing cancelled", async () => {
    const fx = fixture();
    const cookie = await tokenSession(fx);
    const run = fx.enqueue();
    const c = `${SESSION_COOKIE}=${cookie}`;
    for (const init of [{ cookie: c }, { cookie: c, ...form({ csrf: "" }) }, { cookie: c, ...form({ csrf: "wrong" }) },
      { cookie: c, headers: { "x-csrf-token": cookie } }, { cookie: c, ...form({ csrf: cookie }) },
      { cookie: c, headers: { "x-csrf-token": csrfToken(SECRET, signSession(SECRET, "github:other", T0)) } }, // another session's token
      { cookie: c, body: `csrf=${csrfToken(SECRET, cookie)}` }]) { // the field outside a form body
      const res = await fx.call("POST", `/runs/${run.run_id}/cancel`, init);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: "CsrfRefused" });
    }
    expect(fx.cancelled).toEqual([]);
    expect(fx.queue.get(run.run_id)!.state).toBe("queued");
  });

  test("a cookie never authorises POST /jobs, nor any other non-GET or unknown route: 401, nothing queued", async () => {
    const fx = fixture();
    const cookie = await tokenSession(fx);
    const c = `${SESSION_COOKIE}=${cookie}`;
    const csrf = csrfToken(SECRET, cookie);
    const before = fx.queue.runs().length;
    for (const [method, path] of [["POST", "/jobs"], ["DELETE", "/status"], ["POST", "/"], ["GET", "/nope"], ["PUT", "/jobs"]] as const) {
      const res = await fx.call(method, path, { cookie: c, headers: { "x-csrf-token": csrf, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify({ project: "p", job: "j" }) }) });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
    }
    expect(fx.submitted).toEqual([]);
    expect(fx.queue.runs().length).toBe(before);
  });

  test("cookie expiry (an injected clock): valid until 7 days, then the sign-in page and 401 JSON", async () => {
    const fx = fixture();
    const c = `${SESSION_COOKIE}=${await tokenSession(fx)}`;
    fx.advance((SESSION_TTL_S - 1) * 1000);
    expect((await fx.call("GET", "/status", { cookie: c })).status).toBe(200);
    fx.advance(1000);
    expect((await fx.call("GET", "/status", { cookie: c })).status).toBe(401);
    const page = await fx.call("GET", "/", { cookie: c });
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('action="/auth/token"');
  });
});

describe("configuration and secrets (AC4, AC5)", () => {
  const ok = { TK_SUPERVISOR_BIND: "100.64.0.1", TK_SUPERVISOR_TOKEN: TOKEN, TK_SUPERVISOR_SESSION_SECRET: SECRET };
  const tls = { TK_SUPERVISOR_TLS_CERT: "/c/box.crt", TK_SUPERVISOR_TLS_KEY: "/c/box.key", TK_SUPERVISOR_TLS_NAME: "box.tail1234.ts.net" };
  const google = { TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID: "g-client", TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET: GOOGLE_SECRET, TK_SUPERVISOR_OAUTH_GOOGLE_ALLOW: GOOGLE_ALLOW };
  const github = { TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_ID: "gh-client", TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET: GITHUB_SECRET, TK_SUPERVISOR_OAUTH_GITHUB_ALLOW: GITHUB_ALLOW };
  const refusal = (env: Record<string, string | undefined>) => { try { serve(env); } catch (e) { return (e as Error).message; } return "bound"; };
  /** Readable temp cert and key files (their content is never parsed: `Bun.serve` is faked or never reached). */
  const realTls = (() => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-auth-tls-"));
    writeFileSync(join(dir, "box.crt"), "CERT");
    writeFileSync(join(dir, "box.key"), "KEY");
    return { TK_SUPERVISOR_TLS_CERT: join(dir, "box.crt"), TK_SUPERVISOR_TLS_KEY: join(dir, "box.key"), TK_SUPERVISOR_TLS_NAME: "box.tail1234.ts.net" };
  })();
  /** A queue database and store outside every repo, for a `serve` that gets past validation. */
  const queueEnv = () => {
    const d = mkdtempSync(join(tmpdir(), "tk-sup-auth-serve-"));
    mkdirSync(join(d, "store"));
    return { TK_SUPERVISOR_DB: join(d, "q.db"), TK_STUDIO_HOME: join(d, "store") };
  };

  test("the getters: session secret required; TLS all or none; each provider all or none, one identity, https only", () => {
    expect(() => sessionSecret({})).toThrow(SessionSecretMissing);
    expect(() => sessionSecret({ TK_SUPERVISOR_SESSION_SECRET: " " })).toThrow(SessionSecretMissing);
    expect(sessionSecret({ TK_SUPERVISOR_SESSION_SECRET: SECRET })).toBe(SECRET);
    // At least 32 UTF-8 bytes after trimming.
    expect(() => sessionSecret({ TK_SUPERVISOR_SESSION_SECRET: "a".repeat(31) })).toThrow(SessionSecretWeak);
    expect(() => sessionSecret({ TK_SUPERVISOR_SESSION_SECRET: `  ${"a".repeat(31)}  ` })).toThrow(SessionSecretWeak);
    expect(sessionSecret({ TK_SUPERVISOR_SESSION_SECRET: "a".repeat(32) })).toBe("a".repeat(32));
    expect(sessionSecret({ TK_SUPERVISOR_SESSION_SECRET: "é".repeat(16) })).toBe("é".repeat(16)); // 32 bytes, 16 characters
    expect(() => sessionSecret({ TK_SUPERVISOR_SESSION_SECRET: "é".repeat(15) })).toThrow(SessionSecretWeak);
    expect(tlsConfig({})).toBeNull();
    expect(tlsConfig(tls)).toEqual({ cert: "/c/box.crt", key: "/c/box.key", name: "box.tail1234.ts.net" });
    expect(() => tlsConfig({ ...tls, TK_SUPERVISOR_TLS_KEY: "" })).toThrow(TlsConfigIncomplete);
    expect(() => tlsConfig({ TK_SUPERVISOR_TLS_NAME: "x" })).toThrow(TlsConfigIncomplete);
    expect(oauthConfig({})).toEqual({});
    expect(oauthConfig({ ...tls, ...google, ...github })).toEqual({
      google: { clientId: "g-client", clientSecret: GOOGLE_SECRET, allow: GOOGLE_ALLOW },
      github: { clientId: "gh-client", clientSecret: GITHUB_SECRET, allow: GITHUB_ALLOW },
    });
    expect(() => oauthConfig({ ...tls, ...google, TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET: "" })).toThrow(OAuthConfigIncomplete);
    expect(() => oauthConfig({ ...tls, TK_SUPERVISOR_OAUTH_GITHUB_ALLOW: GITHUB_ALLOW })).toThrow(OAuthConfigIncomplete);
    for (const allow of ["*", "*@example.com", "a,b", "a b", "tim@example.com, other@example.com"]) {
      expect(() => oauthConfig({ ...tls, ...google, TK_SUPERVISOR_OAUTH_GOOGLE_ALLOW: allow })).toThrow(OAuthAllowInvalid);
    }
    expect(() => oauthConfig(google)).toThrow(OAuthNeedsHttps);
    expect(() => oauthConfig(github)).toThrow(OAuthNeedsHttps);
  });

  test("the named start errors, before any bind; no message holds a value", () => {
    expect(refusal({ ...ok, TK_SUPERVISOR_SESSION_SECRET: undefined })).toStartWith("SessionSecretMissing:");
    expect(refusal({ ...ok, TK_SUPERVISOR_SESSION_SECRET: "" })).toStartWith("SessionSecretMissing:");
    const weak = "short-planted-session-secret";
    const weakMsg = refusal({ ...ok, TK_SUPERVISOR_SESSION_SECRET: weak });
    expect(weakMsg).toStartWith("SessionSecretWeak:");
    expect(weakMsg).toContain("TK_SUPERVISOR_SESSION_SECRET");
    expect(weakMsg).toContain("32 bytes");
    expect(weakMsg).not.toContain(weak);
    expect(refusal({ ...ok, ...tls, TK_SUPERVISOR_TLS_CERT: "" })).toStartWith("TlsConfigIncomplete:");
    expect(refusal({ ...ok, ...tls, ...google, TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID: "" })).toStartWith("OAuthConfigIncomplete:");
    expect(refusal({ ...ok, ...tls, ...github, TK_SUPERVISOR_OAUTH_GITHUB_ALLOW: "*" })).toStartWith("OAuthAllowInvalid:");
    expect(refusal({ ...ok, ...google })).toStartWith("OAuthNeedsHttps:");
    // All valid: the next check is the queue (unset here) — still before any bind.
    expect(refusal({ ...ok, ...realTls, ...google, ...github })).toStartWith("QueueDbMissing:");
    const messages = [
      refusal({ ...ok, ...tls, ...google, TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID: "" }), refusal({ ...ok, ...tls, ...github, TK_SUPERVISOR_OAUTH_GITHUB_ALLOW: "x,*" }),
      refusal({ ...ok, ...google, ...github }), refusal({ ...ok, ...tls, TK_SUPERVISOR_TLS_NAME: "" }), refusal({ ...ok, TK_SUPERVISOR_SESSION_SECRET: "" }),
    ];
    for (const m of messages) for (const v of [...SECRETS, "g-client", "gh-client", GOOGLE_ALLOW, GITHUB_ALLOW, "/c/box.crt", "/c/box.key"]) expect(m).not.toContain(v);
  });

  test("TlsCertUnreadable: a missing or non-file cert or key, named by its variable, never its path; checked before any bind", () => {
    const dir = realTls.TK_SUPERVISOR_TLS_CERT.replace(/[\\/][^\\/]+$/, "");
    const cases: [Record<string, string>, string][] = [
      [{ ...realTls, TK_SUPERVISOR_TLS_CERT: join(dir, "nofile-x.crt") }, "TK_SUPERVISOR_TLS_CERT"],
      [{ ...realTls, TK_SUPERVISOR_TLS_KEY: join(dir, "nofile-x.key") }, "TK_SUPERVISOR_TLS_KEY"],
      [{ ...realTls, TK_SUPERVISOR_TLS_CERT: dir }, "TK_SUPERVISOR_TLS_CERT"],
      [tls, "TK_SUPERVISOR_TLS_CERT"],
    ];
    let bound = 0;
    const fakeServe: BunServe = () => { bound++; return { port: 8787, stop: () => {} }; };
    for (const [env, variable] of cases) {
      let msg = "bound";
      try { serve({ ...ok, ...env }, fakeServe); } catch (e) { expect(e).toBeInstanceOf(TlsCertUnreadable); msg = (e as Error).message; }
      expect(msg).toStartWith("TlsCertUnreadable:");
      expect(msg).toContain(variable);
      for (const v of [env.TK_SUPERVISOR_TLS_CERT, env.TK_SUPERVISOR_TLS_KEY, dir, "nofile-x", "box.tail1234.ts.net"]) expect(msg).not.toContain(v);
    }
    expect(bound).toBe(0);
  });

  test("serve: with the TLS variables, Bun.serve gets tls {cert, key} on the unchanged bind; the url and OAuth origin are https://<TLS_NAME>:<port>", async () => {
    const seen: any[] = [];
    const fakeServe: BunServe = (o) => { seen.push(o); return { port: (o as any).port, stop: () => {} }; };
    const env = { ...ok, ...realTls, ...google, ...queueEnv(), TK_SUPERVISOR_BIND: "100.100.1.2", TK_SUPERVISOR_PORT: "8899" };
    const s = serve(env, fakeServe);
    try {
      expect(seen).toHaveLength(1);
      expect(seen[0].hostname).toBe("100.100.1.2");
      expect(seen[0].port).toBe(8899);
      expect(seen[0].tls).toBeDefined();
      expect(seen[0].tls.cert).toBeDefined();
      expect(seen[0].tls.key).toBeDefined();
      expect(await seen[0].tls.cert.text()).toBe("CERT");
      expect(await seen[0].tls.key.text()).toBe("KEY");
      expect(s.url).toBe("https://box.tail1234.ts.net:8899");
      // The handler's OAuth origin: the callback URL the provider is sent to.
      const res: Response = await seen[0].fetch(new Request("http://100.100.1.2:8899/auth/google"));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get("location")!).searchParams.get("redirect_uri")).toBe("https://box.tail1234.ts.net:8899/auth/google/callback");
      // An https origin: the token form signs in.
      const tok: Response = await seen[0].fetch(new Request("http://100.100.1.2:8899/auth/token", { method: "POST", ...form({ token: TOKEN }) }));
      expect(tok.status).toBe(303);
      for (const c of setCookies(tok)) cookiesSeen.push(c.value);
    } finally { s.stop(); }
  });

  test("serve: without TLS, no tls option and the url is http://<bind>:<port> (the token form refuses: no https)", async () => {
    const seen: any[] = [];
    const fakeServe: BunServe = (o) => { seen.push(o); return { port: (o as any).port, stop: () => {} }; };
    const s = serve({ ...ok, ...queueEnv(), TK_SUPERVISOR_BIND: "100.100.1.2", TK_SUPERVISOR_PORT: "8898" }, fakeServe);
    try {
      expect(seen).toHaveLength(1);
      expect("tls" in seen[0]).toBe(false);
      expect(seen[0].hostname).toBe("100.100.1.2");
      expect(s.url).toBe("http://100.100.1.2:8898");
      const tok: Response = await seen[0].fetch(new Request("http://100.100.1.2:8898/auth/token", { method: "POST", ...form({ token: TOKEN }) }));
      expect(tok.status).toBe(401);
      expect(tok.headers.getSetCookie()).toEqual([]);
      expect(await tok.text()).toContain(NEEDS_HTTPS_NOTE);
    } finally { s.stop(); }
  });

  test("buildWorkerEnv drops the session secret and both OAuth client secrets; the ids, allow entries and TLS names pass", () => {
    const env = buildWorkerEnv({ ...ok, ...tls, ...google, ...github, TK_STUDIO_HOME: "z" });
    for (const k of ["TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET", "TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET", "TK_SUPERVISOR_TOKEN"]) {
      expect(k in env).toBe(false);
    }
    expect(Object.values(env)).not.toContain(SECRET);
    expect(env.TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID).toBe("g-client");
    expect(env.TK_SUPERVISOR_TLS_NAME).toBe("box.tail1234.ts.net");
    expect(env.TK_STUDIO_HOME).toBe("z");
  });

  test("the page redaction covers every TK_SUPERVISOR_*SECRET* value", () => {
    const env = { TK_SUPERVISOR_SESSION_SECRET: SECRET, TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET: GOOGLE_SECRET, TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET: GITHUB_SECRET };
    const out = redactCredentials(`a ${SECRET} b ${GOOGLE_SECRET} c ${GITHUB_SECRET} d`, env, TOKEN);
    for (const v of SECRETS) expect(out).not.toContain(v);
    expect(out).toBe("a [redacted] b [redacted] c [redacted] d");
  });

  test("a run reason holding the secrets never renders on the cookie page", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    fx.queue.end(run.run_id, "partial", `oops ${SECRET} ${GOOGLE_SECRET} ${GITHUB_SECRET}`);
    const body = await (await fx.call("GET", "/", { cookie: `${SESSION_COOKIE}=${await tokenSession(fx)}` })).text();
    for (const v of SECRETS) expect(body).not.toContain(v);
  });

  test("renderPage: no cancel forms without a CSRF token", () => {
    const data: PageData = {
      generated: "now", counts: { queued: 1 }, jobs: [], runsOmitted: 0, locks: [], statusBlocks: [],
      ledger: { path: "x", note: "x not found" }, registry: { ok: false, note: "n" }, secrets: { token: TOKEN, env: {} },
      runs: [{ run: { run_id: "r1", state: "queued" } as any, resumes: 0, cost: null, events: [], eventsOmitted: 0, workspace: null, runJson: { ok: false, note: "-" }, handoff: { ok: false, note: "-" } }],
    };
    expect(renderPage(data)).not.toContain("<form");
    expect(renderPage(data, { csrf: "c-tok" })).toContain('action="/runs/r1/cancel"><input type="hidden" name="csrf" value="c-tok">');
  });
});
