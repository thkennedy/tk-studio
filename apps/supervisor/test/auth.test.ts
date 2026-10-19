// Story 22.5: sign in from the phone — the cookie session beside the bearer header (Story 29.1: the providers are gone).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  csrfToken, INTENDED_USAGE, NEEDS_HTTPS_NOTE, readCookie, SESSION_COOKIE, SESSION_TTL_S, signInPage, signSession, verifySession,
} from "../src/auth";
import { type BunServe, createApi, serve, type SubmitBody } from "../src/api";
import {
  SessionSecretMissing, sessionSecret, SessionSecretWeak, TlsCertUnreadable, TlsConfigIncomplete, tlsConfig,
} from "../src/env";
import { renderPage, redactCredentials, type PageData } from "../src/page";
import { Queue, type Owner, type Probes, type WorkerKill } from "../src/queue";
import { buildWorkerEnv } from "../src/server";

const TOKEN = "tok-auth-5e2b-very-secret-value";
const SECRET = "session-secret-0123456789abcdef-0123456789abcdef";
/** Leftover provider client secrets (Story 29.1: the variables are ignored, still stripped and redacted). */
const GOOGLE_SECRET = "google-client-secret-planted-31ab";
const GITHUB_SECRET = "github-client-secret-planted-77cd";
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

interface FxOpts { session?: boolean; origin?: string }

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
  const handler = createApi({
    queue, token: TOKEN, env, registry: async () => ({ ok: true, projects: {} }), ledger: { user: "op", machine: "box" },
    now: () => now,
    submit: async (b) => { submitted.push(b); const { run } = queue.enqueue({ jobId: b.job, root: checkout, projectId: b.project, target: "skill", definition: { id: b.job } }); return { ok: true, run_id: run.run_id }; },
    cancel: async (id) => { cancelled.push(id); queue.end(id, "cancelled", "cancelled over the API"); return queue.get(id)!; },
    ...(o.session === false ? {} : { session: { secret: SECRET } }),
    origin: o.origin ?? ORIGIN,
    account: { sleep: async () => {} },
  });
  const call = async (method: string, path: string, init: { body?: string; headers?: Record<string, string>; cookie?: string; bearer?: boolean } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.bearer) headers.authorization = `Bearer ${TOKEN}`;
    const res = await handler(new Request(`${BASE}${path}`, { method, body: init.body, headers }));
    for (const c of setCookies(res)) cookiesSeen.push(c.value);
    return res;
  };
  return { queue, enqueue, call, submitted, cancelled, advance: (ms: number) => { now += ms; }, now: () => now };
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

async function expectRefused(res: Response) {
  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toStartWith("text/html");
  expect(res.headers.getSetCookie()).toEqual([]);
  const body = await res.text();
  expect(body).toContain("Sign-in refused.");
  expect(body).toMatch(/action="\/auth\/(account|token)"/);
  for (const v of SECRETS) expect(body).not.toContain(v);
}

describe("the session cookie and the CSRF token (unit)", () => {
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
    const c1 = signSession(SECRET, "token", T0), c2 = signSession(SECRET, "account:x", T0);
    expect(csrfToken(SECRET, c1)).not.toBe(c1);
    expect(c1).not.toContain(csrfToken(SECRET, c1));
    expect(csrfToken(SECRET, c1)).toBe(csrfToken(SECRET, c1));
    expect(csrfToken(SECRET, c1)).not.toBe(csrfToken(SECRET, c2));
  });

  test("readCookie picks the named cookie out of the header", () => {
    const req = new Request(BASE, { headers: { cookie: `a=1; ${SESSION_COOKIE}=v.s; tk_oauth_state=x` } });
    expect(readCookie(req, SESSION_COOKIE)).toBe("v.s");
    expect(readCookie(req, "nope")).toBeNull();
  });

  test("the sign-in page: create mode offers the creation and token forms; signin mode the account and token forms; no script, no provider", () => {
    const create = signInPage({ mode: "create" });
    expect(create).toContain('<form method="post" action="/auth/account">');
    expect(create).toContain('autocomplete="new-password"');
    expect(create).toContain('minlength="12"');
    expect(create).toContain('pattern="[A-Za-z0-9._-]{3,64}"');
    expect(create).not.toContain('action="/auth/signin"');
    expect(create).toContain('<form method="post" action="/auth/token">');
    const page = signInPage({ mode: "signin" });
    expect(page).toContain('<form method="post" action="/auth/signin">');
    expect(page).toContain('autocomplete="current-password"');
    expect(page).toContain('<form method="post" action="/auth/token">');
    expect(page).toContain('name="token"');
    expect(page).not.toContain('action="/auth/account"');
    for (const p of [create, page]) {
      expect(p).toContain(INTENDED_USAGE);
      expect(p.toLowerCase()).not.toContain("<script");
      expect(p).not.toContain("/auth/google");
      expect(p).not.toContain("/auth/github");
    }
    expect(page).not.toContain("Sign-in refused.");
    expect(signInPage({ mode: "signin", refused: true })).toContain("Sign-in refused.");
    expect(page).not.toContain(NEEDS_HTTPS_NOTE);
    expect(signInPage({ mode: "signin", needsHttps: true })).toContain(`<p class="note">${NEEDS_HTTPS_NOTE}</p>`);
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
      expect(body).toContain('action="/auth/account"'); // no account yet: the creation page (Story 29.1)
      expect(body).not.toContain("/auth/google");
      expect(body).not.toContain("/auth/github");
      expect(body).not.toContain("Sign-in refused.");
      expect(body).not.toContain("secret-job-name");
      expect(body).not.toContain('id="runs"');
      expect(body.toLowerCase()).not.toContain("<script");
    }
  });

  test("a validly signed cookie with a deleted provider's sub (google:/github:) is no session; token and account: subs still read", async () => {
    const fx = fixture();
    for (const sub of ["github:owner", "google:owner"]) {
      const c = `${SESSION_COOKIE}=${signSession(SECRET, sub, T0)}`;
      const status = await fx.call("GET", "/status", { cookie: c });
      expect(status.status).toBe(401);
      expect(await status.json()).toEqual({ ok: false, error: "Unauthorized" });
      const page = await fx.call("GET", "/", { cookie: c });
      expect(page.status).toBe(401);
      expect(page.headers.get("content-type")).toStartWith("text/html");
      const body = await page.text();
      expect(body).toMatch(/action="\/auth\/(account|token)"/);
      expect(body).not.toContain('id="runs"');
    }
    for (const sub of ["token", "account:owner"]) {
      const res = await fx.call("GET", "/status", { cookie: `${SESSION_COOKIE}=${signSession(SECRET, sub, T0)}` });
      expect(res.status).toBe(200);
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
    for (const fx of [fixture({ origin: BASE }), fixture({ origin: "" })]) {
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
    await expectRefused(await fx.call("POST", "/auth/account", form({ username: "owner", password: "a-long-password-1" })));
    await expectRefused(await fx.call("POST", "/auth/signin", form({ username: "owner", password: "a-long-password-1" })));
  });
});

describe("a signed-in browser (AC3)", () => {
  test("the cookie reads the page (GET /status, Accept text/html), /jobs, /runs/{id}, /status and /events (JSON and SSE) as the bearer does", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    const c = `${SESSION_COOKIE}=${await tokenSession(fx)}`;
    for (const path of ["/jobs", `/runs/${run.run_id}`, "/status", "/events?since=0"]) {
      const byCookie = await fx.call("GET", path, { cookie: c });
      const byBearer = await fx.call("GET", path, { bearer: true });
      expect(byCookie.status).toBe(200);
      expect(await byCookie.json()).toEqual(await byBearer.json());
    }
    const page = await fx.call("GET", "/status", { cookie: c, headers: { accept: "text/html" } });
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
    const body = await (await fx.call("GET", "/status", { cookie: `${SESSION_COOKIE}=${cookie}`, headers: { accept: "text/html" } })).text();
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
      { cookie: c, headers: { "x-csrf-token": csrfToken(SECRET, signSession(SECRET, "account:other", T0)) } }, // another session's token
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
    expect(await page.text()).toContain('action="/auth/account"');
  });
});

describe("configuration and secrets (AC4, AC5)", () => {
  const ok = { TK_SUPERVISOR_BIND: "100.64.0.1", TK_SUPERVISOR_TOKEN: TOKEN, TK_SUPERVISOR_SESSION_SECRET: SECRET };
  const tls = { TK_SUPERVISOR_TLS_CERT: "/c/box.crt", TK_SUPERVISOR_TLS_KEY: "/c/box.key", TK_SUPERVISOR_TLS_NAME: "box.tail1234.ts.net" };
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

  test("the getters: session secret required; TLS all or none", () => {
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
    // All valid: the next check is the queue (unset here) — still before any bind.
    expect(refusal({ ...ok, ...realTls })).toStartWith("QueueDbMissing:");
    const messages = [refusal({ ...ok, ...tls, TK_SUPERVISOR_TLS_NAME: "" }), refusal({ ...ok, TK_SUPERVISOR_SESSION_SECRET: "" })];
    for (const m of messages) for (const v of [...SECRETS, "/c/box.crt", "/c/box.key"]) expect(m).not.toContain(v);
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

  test("serve: with the TLS variables, Bun.serve gets tls {cert, key} on the unchanged bind; the url and origin are https://<TLS_NAME>:<port>", async () => {
    const seen: any[] = [];
    const fakeServe: BunServe = (o) => { seen.push(o); return { port: (o as any).port, stop: () => {} }; };
    const env = { ...ok, ...realTls, ...queueEnv(), TK_SUPERVISOR_BIND: "100.100.1.2", TK_SUPERVISOR_PORT: "8899" };
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

  test("buildWorkerEnv drops the session secret and a leftover OAuth client secret; the TLS names pass", () => {
    const env = buildWorkerEnv({ ...ok, ...tls, TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET: GOOGLE_SECRET, TK_STUDIO_HOME: "z" });
    for (const k of ["TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET", "TK_SUPERVISOR_TOKEN"]) {
      expect(k in env).toBe(false);
    }
    expect(Object.values(env)).not.toContain(SECRET);
    expect(Object.values(env)).not.toContain(GOOGLE_SECRET);
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
