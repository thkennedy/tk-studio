// Story 29.1: the owner's account replaces the providers — creation, sign-in, the lockout, the removed routes, the reset.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AccountExists, AccountRecordInvalid, accountPath, createAccount, LOCKOUT_FAILURES, LOCKOUT_MS, LOCKOUT_WINDOW_MS, readAccount, SIGNIN_DELAY_MS,
} from "../src/account";
import { type BunServe, createApi, serve } from "../src/api";
import { INTENDED_USAGE, NEEDS_HTTPS_NOTE, SESSION_COOKIE, verifySession } from "../src/auth";
import * as envModule from "../src/env";
import { Queue, type Probes, type WorkerKill } from "../src/queue";
import { buildWorkerEnv } from "../src/server";
import { tempDir, track } from "./tmp";

const TOKEN = "tok-account-91c4-very-secret-value";
const SECRET = "session-secret-account-0123456789abcdef-0123";
const USER = "tim.k_owner-1";
const PASSWORD = "correct-horse-battery-29";
const WRONG = "wrong-password-xyz-29";
const ORIGIN = "https://box.tail1234.ts.net:8787";
const BASE = "http://100.100.1.2:8787";
const T0 = Date.UTC(2026, 9, 18, 9, 0, 0);
const README = join(import.meta.dir, "..", "README.md");

/** Every cookie value and every hash seen during the suite: none may appear in a console line. */
const cookiesSeen: string[] = [];
const hashesSeen: string[] = [];
const SECRETS = [TOKEN, SECRET, PASSWORD, WRONG];

// The console-capture guard (the auth suite's pattern): no secret, password, hash or cookie value in any line.
const captured: string[] = [];
const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
beforeAll(() => {
  for (const k of Object.keys(originals) as (keyof typeof originals)[]) {
    console[k] = (...args: unknown[]) => { captured.push(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); };
  }
});
afterAll(() => {
  Object.assign(console, originals);
  expect(hashesSeen.length).toBeGreaterThan(0);
  for (const v of [...SECRETS, ...hashesSeen, ...cookiesSeen]) expect(captured.filter((l) => l.includes(v))).toEqual([]);
});

interface FxOpts { session?: boolean; origin?: string }

function fixture(o: FxOpts = {}) {
  const dir = tempDir("tk-sup-acct-");
  const store = tempDir("tk-sup-acct-store-");
  const checkout = tempDir("tk-sup-acct-checkout-");
  let now = T0;
  const probes: Probes = {
    ownerAlive: () => false,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
    probeWorker: (pid, start): WorkerKill => ({ pid, start, outcome: "not running" }),
  };
  const queue = track(new Queue(join(dir, "q.db"), probes));
  const env = { TK_STUDIO_HOME: store, TK_SUPERVISOR_TOKEN: TOKEN, TK_SUPERVISOR_SESSION_SECRET: SECRET };
  const sleeps: number[] = [];
  const submitted: unknown[] = [];
  const handler = createApi({
    queue, token: TOKEN, env, registry: async () => ({ ok: true, projects: {} }), ledger: { user: "op", machine: "box" },
    now: () => now,
    submit: async (b) => { submitted.push(b); return { ok: true, run_id: "x" }; },
    ...(o.session === false ? {} : { session: { secret: SECRET } }),
    origin: o.origin ?? ORIGIN,
    account: { sleep: async (ms) => { sleeps.push(ms); } },
  });
  const call = async (method: string, path: string, init: { body?: string; headers?: Record<string, string>; cookie?: string; bearer?: boolean } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.bearer) headers.authorization = `Bearer ${TOKEN}`;
    const res = await handler(new Request(`${BASE}${path}`, { method, body: init.body, headers }));
    for (const c of setCookies(res)) cookiesSeen.push(c.value);
    return res;
  };
  const file = join(store, "supervisor", "account.json");
  const record = () => {
    const r = JSON.parse(readFileSync(file, "utf-8"));
    hashesSeen.push(r.hash);
    return r as { username: string; hash: string; created_at: string };
  };
  return { queue, call, env, dir, store, checkout, file, record, sleeps, submitted, advance: (ms: number) => { now += ms; }, now: () => now };
}
type Fx = ReturnType<typeof fixture>;

function setCookies(res: Response): { name: string; value: string; attrs: string }[] {
  return res.headers.getSetCookie().map((raw) => {
    const [pair, ...attrs] = raw.split(";");
    const eq = pair.indexOf("=");
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs: attrs.map((a) => a.trim()).join("; ") };
  });
}

const form = (fields: Record<string, string>) => ({ body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
const jsonBody = (fields: Record<string, unknown>) => ({ body: JSON.stringify(fields), headers: { "content-type": "application/json" } });

async function create(fx: Fx, username = USER, password = PASSWORD): Promise<Response> {
  return fx.call("POST", "/auth/account", form({ username, password }));
}
const signin = (fx: Fx, password: string, username = USER) => fx.call("POST", "/auth/signin", jsonBody({ username, password }));

/** Every file under `root`, its bytes as latin1 text (the queue database and its WAL included). */
function treeText(root: string): string {
  let out = "";
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    out += statSync(p).isDirectory() ? treeText(p) : readFileSync(p).toString("latin1");
  }
  return out;
}

describe("account creation (AC1)", () => {
  test("no account: GET / is the 401 creation page, no account sign-in form (the token form stays), the intended-usage paragraph equal to the README's", async () => {
    const fx = fixture();
    const res = await fx.call("GET", "/");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toStartWith("text/html");
    expect(res.headers.getSetCookie()).toEqual([]);
    const body = await res.text();
    expect(body).toContain('action="/auth/account"');
    expect(body).not.toContain('action="/auth/signin"');
    expect(body).toContain('action="/auth/token"');
    expect(body).toContain(INTENDED_USAGE);
    expect(body.toLowerCase()).not.toContain("<script");
    // The README carries the same paragraph, verbatim, as its own line.
    expect(readFileSync(README, "utf-8").split(/\r?\n/)).toContain(INTENDED_USAGE);
    // Every API route without auth stays 401 JSON.
    for (const [method, path] of [["GET", "/status"], ["GET", "/jobs"], ["POST", "/jobs"], ["GET", "/events?since=0"], ["GET", "/nope"]] as const) {
      const r = await fx.call(method, path, method === "POST" ? { body: "{}" } : {});
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ ok: false, error: "Unauthorized" });
    }
  });

  test("a valid pair: 303 → / with the Story 22.5 cookie; account.json holds username, an argon2id hash, created_at; one account-created row", async () => {
    const fx = fixture();
    const res = await create(fx);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(SESSION_COOKIE);
    expect(cookies[0].attrs).toBe("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800");
    expect(verifySession(SECRET, cookies[0].value, fx.now())).toEqual({ sub: `account:${USER}`, exp: T0 / 1000 + 604800 });
    expect(fx.file).toBe(accountPath(fx.env));
    const r = fx.record();
    expect(Object.keys(r).sort()).toEqual(["created_at", "hash", "username"]);
    expect(r.username).toBe(USER);
    expect(r.hash).toStartWith("$argon2id$");
    expect(r.hash).not.toContain(PASSWORD);
    expect(r.created_at).toBe(new Date(T0).toISOString());
    expect(await Bun.password.verify(PASSWORD, r.hash)).toBe(true);
    expect(fx.queue.serviceEvents("account-created").map((e) => e.detail)).toEqual([{ username: USER }]);
    // The answer, the queue file (every table, the WAL too) and the checkout hold neither the password nor the hash.
    const body = await res.text();
    for (const v of [PASSWORD, r.hash]) {
      expect(body).not.toContain(v);
      expect(treeText(fx.dir)).not.toContain(v);
      expect(treeText(fx.checkout)).not.toContain(v);
      expect(JSON.stringify(fx.queue.serviceEvents())).not.toContain(v);
    }
    // The session reads the status like the token session does; it never authorises POST /jobs.
    const c = `${SESSION_COOKIE}=${cookies[0].value}`;
    expect((await fx.call("GET", "/status", { cookie: c })).status).toBe(200);
    const page = await fx.call("GET", "/", { cookie: c });
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain(r.hash);
    const post = await fx.call("POST", "/jobs", { cookie: c, ...jsonBody({ project: "p", job: "j" }) });
    expect(post.status).toBe(401);
    expect(fx.submitted).toEqual([]);
  });

  test("a JSON body: {ok:true, username} with the cookie", async () => {
    const fx = fixture();
    const res = await fx.call("POST", "/auth/account", jsonBody({ username: USER, password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, username: USER });
    expect(setCookies(res).map((c) => c.name)).toEqual([SESSION_COOKIE]);
    fx.record();
  });

  test("bad input: 400 AccountInvalid naming the field, never the value; nothing written; a 12-character password of any characters passes", async () => {
    const fx = fixture();
    const cases: [string, string, "username" | "password"][] = [
      ["ab", PASSWORD, "username"], ["a".repeat(65), PASSWORD, "username"], ["tim k", PASSWORD, "username"], ["tim@box", PASSWORD, "username"],
      [USER, "elevenchars", "password"],
    ];
    for (const [username, password, field] of cases) {
      const res = await fx.call("POST", "/auth/account", jsonBody({ username, password }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: "AccountInvalid", field });
      expect(JSON.stringify(body)).not.toContain(password);
      expect(res.headers.getSetCookie()).toEqual([]);
      const page = await fx.call("POST", "/auth/account", form({ username, password }));
      expect(page.status).toBe(400);
      const html = await page.text();
      expect(html).toContain('action="/auth/account"');
      expect(html).not.toContain(password);
      if (field === "username" && username.length > 2) expect(html).not.toContain(username); // "ab" occurs in the markup itself
      expect(existsSync(fx.file)).toBe(false);
    }
    expect(fx.queue.serviceEvents()).toEqual([]);
    // Length only: 12 characters of anything (spaces, symbols) pass; 64 and 3 character usernames pass.
    const odd = "  !! @@ ##  ";
    expect(odd.length).toBe(12);
    expect((await create(fx, "a".repeat(64), odd)).status).toBe(303);
    fx.record();
    const fx2 = fixture();
    expect((await create(fx2, "a.b", PASSWORD)).status).toBe(303);
    fx2.record();
  });

  test("the password length counts characters (code points), not UTF-16 units: 11 emoji are refused, 12 pass", async () => {
    const fx = fixture();
    const eleven = "\u{1F600}".repeat(11);
    expect(eleven.length).toBe(22);
    const res = await fx.call("POST", "/auth/account", jsonBody({ username: USER, password: eleven }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "AccountInvalid", field: "password" });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(existsSync(fx.file)).toBe(false);
    expect(fx.queue.serviceEvents()).toEqual([]);
    expect((await create(fx, USER, "\u{1F600}".repeat(12))).status).toBe(303);
    fx.record();
  });

  test("a second creation: 409 AccountExists, the record's bytes unchanged, no cookie", async () => {
    const fx = fixture();
    expect((await create(fx)).status).toBe(303);
    fx.record();
    const before = readFileSync(fx.file);
    for (const res of [await create(fx, "other-user", "another-password-1"), await fx.call("POST", "/auth/account", jsonBody({ username: USER, password: PASSWORD }))]) {
      expect(res.status).toBe(409);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(await (await fx.call("POST", "/auth/account", jsonBody({ username: "x-user", password: "another-password-1" }))).json()).toEqual({ ok: false, error: "AccountExists" });
    expect(readFileSync(fx.file).equals(before)).toBe(true);
    expect(fx.queue.serviceEvents("account-created")).toHaveLength(1);
  });

  test("no https origin or no session secret: creation and sign-in refused as the token form refuses, no cookie, the https note", async () => {
    for (const fx of [fixture({ origin: BASE }), fixture({ origin: "" })]) {
      const res = await create(fx);
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toEqual([]);
      const body = await res.text();
      expect(body).toContain("Sign-in refused.");
      expect(body).toContain(NEEDS_HTTPS_NOTE);
      expect(existsSync(fx.file)).toBe(false);
      const s = await signin(fx, PASSWORD);
      expect(s.status).toBe(401);
      expect(s.headers.getSetCookie()).toEqual([]);
    }
    const fx = fixture({ session: false });
    expect((await create(fx)).status).toBe(401);
    expect(existsSync(fx.file)).toBe(false);
    expect((await signin(fx, PASSWORD)).headers.getSetCookie()).toEqual([]);
  });

  test("a malformed account.json is AccountRecordInvalid (naming the store-relative path, never the content), never read as no account", () => {
    const fx = fixture();
    mkdirSync(join(fx.store, "supervisor"), { recursive: true });
    writeFileSync(fx.file, '{"username":"x","hash":"planted-content-77"}');
    let msg = "";
    try { readAccount(fx.env); } catch (e) { expect(e).toBeInstanceOf(AccountRecordInvalid); msg = (e as Error).message; }
    expect(msg).toContain("supervisor/account.json");
    expect(msg).not.toContain("planted-content-77");
    expect(readAccount({ TK_STUDIO_HOME: tempDir("tk-sup-acct-none-") })).toBeNull();
  });

  test("two parallel creations: exactly one 303 and one 409, the record is the winner's, no temp file left", async () => {
    const fx = fixture();
    const pairs: [string, string][] = [[USER, PASSWORD], ["other-user", "another-password-1"]];
    const answers = await Promise.all(pairs.map(([u, p]) => create(fx, u, p)));
    expect(answers.map((r) => r.status).sort()).toEqual([303, 409]);
    const winner = pairs[answers.findIndex((r) => r.status === 303)];
    const r = fx.record();
    expect(r.username).toBe(winner[0]);
    expect(await Bun.password.verify(winner[1], r.hash)).toBe(true);
    expect(fx.queue.serviceEvents("account-created").map((e) => e.detail)).toEqual([{ username: winner[0] }]);
    expect(readdirSync(join(fx.store, "supervisor"))).toEqual(["account.json"]);
    // The module itself: both pass the existence check before either places its file; the exclusive link refuses one.
    const store = tempDir("tk-sup-acct-race-");
    const env = { TK_STUDIO_HOME: store };
    const results = await Promise.allSettled([createAccount(env, "first-one", PASSWORD, "t"), createAccount(env, "second-one", PASSWORD, "t")]);
    expect(results.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(AccountExists);
    const won = results.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<{ username: string; hash: string }>;
    hashesSeen.push(won.value.hash);
    expect(readAccount(env)!.username).toBe(won.value.username);
    expect(readdirSync(join(store, "supervisor"))).toEqual(["account.json"]);
  });

  test("a malformed account.json: GET / and the HTML routes are the sign-in page at 500 naming AccountRecordInvalid, JSON is 500 AccountRecordInvalid with the path; the bearer works", async () => {
    const fx = fixture();
    mkdirSync(join(fx.store, "supervisor"), { recursive: true });
    writeFileSync(fx.file, '{"username":"x","hash":"planted-content-77"}');
    const page = await fx.call("GET", "/");
    expect(page.status).toBe(500);
    expect(page.headers.get("content-type")).toStartWith("text/html");
    const html = await page.text();
    expect(html).toContain("AccountRecordInvalid");
    expect(html).toContain('action="/auth/token"');
    expect(html).not.toContain("planted-content-77");
    for (const path of ["/auth/signin", "/auth/account"]) {
      const j = await fx.call("POST", path, jsonBody({ username: USER, password: PASSWORD }));
      expect(j.status).toBe(500);
      expect(await j.json()).toEqual({ ok: false, error: "AccountRecordInvalid", path: "supervisor/account.json" });
      expect(j.headers.getSetCookie()).toEqual([]);
      const f = await fx.call("POST", path, form({ username: USER, password: PASSWORD }));
      expect(f.status).toBe(500);
      const fh = await f.text();
      expect(fh).toContain("AccountRecordInvalid");
      expect(fh).not.toContain("planted-content-77");
    }
    expect(readFileSync(fx.file, "utf-8")).toContain("planted-content-77"); // never overwritten
    expect(fx.queue.serviceEvents()).toEqual([]);
    expect((await fx.call("GET", "/status", { bearer: true })).status).toBe(200);
    expect((await fx.call("POST", "/jobs", { bearer: true, ...jsonBody({ project: "p", job: "j" }) })).status).toBe(200);
  });

  test("any other method on the account routes: 405 with Allow: POST", async () => {
    const fx = fixture();
    for (const path of ["/auth/account", "/auth/signin"]) {
      const res = await fx.call("GET", path);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
});

describe("sign-in and the lockout (AC2)", () => {
  async function withAccount(): Promise<Fx> {
    const fx = fixture();
    expect((await create(fx)).status).toBe(303);
    fx.record();
    return fx;
  }

  test("the account exists: GET / is the sign-in page (account form and token form), no creation form", async () => {
    const fx = await withAccount();
    const body = await (await fx.call("GET", "/")).text();
    expect(body).toContain('action="/auth/signin"');
    expect(body).toContain('action="/auth/token"');
    expect(body).not.toContain('action="/auth/account"');
    expect(body).toContain(INTENDED_USAGE);
  });

  test("the right pair: 303 → / with the cookie (form) or {ok:true, username} (JSON); the cookie reads GET /status", async () => {
    const fx = await withAccount();
    const res = await fx.call("POST", "/auth/signin", form({ username: USER, password: PASSWORD }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const [c] = setCookies(res);
    expect(c.attrs).toBe("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800");
    expect(verifySession(SECRET, c.value, fx.now())!.sub).toBe(`account:${USER}`);
    expect((await fx.call("GET", "/status", { cookie: `${SESSION_COOKIE}=${c.value}` })).status).toBe(200);
    const j = await signin(fx, PASSWORD);
    expect(j.status).toBe(200);
    expect(await j.json()).toEqual({ ok: true, username: USER });
    expect(fx.sleeps).toEqual([]);
    expect(fx.queue.serviceEvents("signin-refused")).toEqual([]);
  });

  test("a wrong password or an unknown username: the fixed delay, 401 SignInRefused, one signin-refused row with no password and no hash", async () => {
    const fx = await withAccount();
    const hash = fx.record().hash;
    const res = await signin(fx, WRONG);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "SignInRefused" });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(fx.sleeps).toEqual([SIGNIN_DELAY_MS]);
    const unknown = await signin(fx, PASSWORD, "nobody-here");
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ ok: false, error: "SignInRefused" });
    expect(fx.sleeps).toEqual([SIGNIN_DELAY_MS, SIGNIN_DELAY_MS]);
    const rows = fx.queue.serviceEvents("signin-refused");
    expect(rows.map((r) => r.detail)).toEqual([{ username: USER, reason: "mismatch" }, { username: "nobody-here", reason: "unknown-username" }]);
    for (const r of rows) {
      expect("password" in (r.detail ?? {})).toBe(false);
      for (const v of [WRONG, PASSWORD, hash]) expect(JSON.stringify(r)).not.toContain(v);
    }
    // The HTML refusal: the page with the generic line, nothing of the password.
    const page = await fx.call("POST", "/auth/signin", form({ username: USER, password: WRONG }));
    expect(page.status).toBe(401);
    const html = await page.text();
    expect(html).toContain("Sign-in refused.");
    for (const v of [WRONG, hash]) expect(html).not.toContain(v);
  });

  test("the window: four failures then a success is not locked; five within 15 minutes lock (423, one account-locked row); the right pair while locked is 423", async () => {
    const fx = await withAccount();
    for (let i = 0; i < LOCKOUT_FAILURES - 1; i++) expect((await signin(fx, WRONG)).status).toBe(401);
    expect((await signin(fx, PASSWORD)).status).toBe(200);
    const fx2 = await withAccount();
    for (let i = 0; i < LOCKOUT_FAILURES - 1; i++) { expect((await signin(fx2, WRONG)).status).toBe(401); fx2.advance(60_000); }
    const fifth = await signin(fx2, WRONG);
    expect(fifth.status).toBe(423);
    expect(await fifth.json()).toEqual({ ok: false, error: "AccountLocked" });
    const locks = fx2.queue.serviceEvents("account-locked");
    expect(locks.map((l) => l.detail)).toEqual([{ username: USER, until: new Date(fx2.now() + LOCKOUT_MS).toISOString() }]);
    const locked = await signin(fx2, PASSWORD);
    expect(locked.status).toBe(423);
    expect(locked.headers.getSetCookie()).toEqual([]);
    const lockedForm = await fx2.call("POST", "/auth/signin", form({ username: USER, password: PASSWORD }));
    expect(lockedForm.status).toBe(423);
    expect(lockedForm.headers.getSetCookie()).toEqual([]);
    expect(fx2.queue.serviceEvents("account-locked")).toHaveLength(1);
    expect(fx2.queue.serviceEvents("signin-refused").filter((r) => r.detail?.reason === "locked")).toHaveLength(2);
    // Fifteen minutes later the right pair signs in; the failures before the expired lock never count again.
    fx2.advance(LOCKOUT_MS - 1);
    expect((await signin(fx2, PASSWORD)).status).toBe(423);
    fx2.advance(1);
    expect((await signin(fx2, PASSWORD)).status).toBe(200);
    expect((await signin(fx2, WRONG)).status).toBe(401);
    expect(fx2.queue.serviceEvents("account-locked")).toHaveLength(1);
    // The rows name the username and never the password.
    for (const r of fx2.queue.serviceEvents()) for (const v of [PASSWORD, WRONG]) expect(JSON.stringify(r)).not.toContain(v);
  });

  test("the window slides: four failures, 15 minutes, one failure is not locked", async () => {
    const fx = await withAccount();
    for (let i = 0; i < LOCKOUT_FAILURES - 1; i++) expect((await signin(fx, WRONG)).status).toBe(401);
    fx.advance(LOCKOUT_WINDOW_MS);
    expect((await signin(fx, WRONG)).status).toBe(401);
    expect(fx.queue.serviceEvents("account-locked")).toEqual([]);
  });

  test("eight parallel wrong guesses: attempts are serialised, four 401s then 423 from the fifth, five delays, one account-locked row", async () => {
    const fx = await withAccount();
    const answers = await Promise.all(Array.from({ length: 8 }, () => signin(fx, WRONG)));
    const statuses = answers.map((r) => r.status);
    // Serialised, so deterministic: guesses 1-4 verify, wait and answer 401; the fifth verifies, waits, locks and
    // answers 423; guesses 6-8 find the lock and answer 423 without verifying or waiting.
    expect(statuses.filter((s) => s === 401)).toHaveLength(LOCKOUT_FAILURES - 1);
    expect(statuses.filter((s) => s === 423)).toHaveLength(8 - (LOCKOUT_FAILURES - 1));
    expect(fx.sleeps).toEqual(Array(LOCKOUT_FAILURES).fill(SIGNIN_DELAY_MS)); // one delay per verified mismatch
    expect(fx.queue.serviceEvents("account-locked")).toHaveLength(1);
    const refused = fx.queue.serviceEvents("signin-refused");
    expect(refused.filter((r) => r.detail?.reason === "mismatch")).toHaveLength(LOCKOUT_FAILURES);
    expect(refused.filter((r) => r.detail?.reason === "locked")).toHaveLength(8 - LOCKOUT_FAILURES);
    expect((await signin(fx, PASSWORD)).status).toBe(423);
  });

  test("a 10 000-character username: recorded truncated to 64 characters as unknown-username; still the delay and 401 SignInRefused", async () => {
    const fx = await withAccount();
    const long = "x".repeat(10_000);
    const res = await signin(fx, WRONG, long);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "SignInRefused" });
    expect(fx.sleeps).toEqual([SIGNIN_DELAY_MS]);
    const rows = fx.queue.serviceEvents("signin-refused");
    expect(rows).toHaveLength(1);
    expect((rows[0].detail!.username as string).length).toBeLessThanOrEqual(64);
    expect(rows[0].detail!.reason).toBe("unknown-username");
    // A username that fails the pattern never matches the account, even with the owner's name as its prefix.
    const prefixed = await signin(fx, PASSWORD, `${USER}${" ".repeat(70)}`);
    expect(prefixed.status).toBe(401);
  });

  test("the lockout survives a restart: a second createApi over the same queue and store still answers 423", async () => {
    const fx = await withAccount();
    for (let i = 0; i < LOCKOUT_FAILURES; i++) await signin(fx, WRONG);
    expect((await signin(fx, PASSWORD)).status).toBe(423);
    const restarted = createApi({
      queue: fx.queue, token: TOKEN, env: fx.env, registry: async () => ({ ok: true, projects: {} }), ledger: { user: "op", machine: "box" },
      now: () => fx.now(), session: { secret: SECRET }, origin: ORIGIN, account: { sleep: async () => {} },
    });
    const res = await restarted(new Request(`${BASE}/auth/signin`, { method: "POST", ...jsonBody({ username: USER, password: PASSWORD }) }));
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ ok: false, error: "AccountLocked" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("the bearer header still authorises everything; POST /auth/token still signs in", async () => {
    const fx = await withAccount();
    expect((await fx.call("GET", "/status", { bearer: true })).status).toBe(200);
    expect((await fx.call("POST", "/jobs", { bearer: true, ...jsonBody({ project: "p", job: "j" }) })).status).toBe(200);
    const tok = await fx.call("POST", "/auth/token", form({ token: TOKEN }));
    expect(tok.status).toBe(303);
    expect(verifySession(SECRET, setCookies(tok)[0].value, fx.now())!.sub).toBe("token");
  });
});

describe("the providers are deleted (AC3)", () => {
  test("GET /auth/{google,github} and their callbacks: 404 NotFound with the bearer, 401 JSON without", async () => {
    const fx = fixture();
    for (const path of ["/auth/google", "/auth/github", "/auth/google/callback", "/auth/github/callback"]) {
      const bearer = await fx.call("GET", path, { bearer: true });
      expect(bearer.status).toBe(404);
      expect(await bearer.json()).toMatchObject({ ok: false, error: "NotFound" });
      const none = await fx.call("GET", path);
      expect(none.status).toBe(401);
      expect(await none.json()).toEqual({ ok: false, error: "Unauthorized" });
    }
  });

  test("the OAuth exports no longer exist", () => {
    for (const name of ["OAuthNeedsHttps", "OAuthConfigIncomplete", "OAuthAllowInvalid", "oauthConfig"]) expect(name in envModule).toBe(false);
  });

  test("buildWorkerEnv strips every TK_SUPERVISOR_* secret (DW-17); the TLS name, the store and the bind pass", () => {
    const env = buildWorkerEnv({
      TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET: "g-secret", TK_SUPERVISOR_SESSION_SECRET: SECRET, TK_SUPERVISOR_TOKEN: TOKEN,
      TK_SUPERVISOR_TELEGRAM_TOKEN: "tg-token", TK_SUPERVISOR_NTFY_URL: "https://ntfy.sh/secret-topic", TK_SUPERVISOR_FUTURE_PASSWORD: "pw",
      TK_SUPERVISOR_TLS_NAME: "box.tail1234.ts.net", TK_STUDIO_HOME: "/store", TK_SUPERVISOR_BIND: "100.64.0.1",
    });
    for (const k of ["TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET", "TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_TOKEN", "TK_SUPERVISOR_TELEGRAM_TOKEN", "TK_SUPERVISOR_NTFY_URL", "TK_SUPERVISOR_FUTURE_PASSWORD"]) {
      expect(k in env).toBe(false);
    }
    expect(env.TK_SUPERVISOR_TLS_NAME).toBe("box.tail1234.ts.net");
    expect(env.TK_STUDIO_HOME).toBe("/store");
    expect(env.TK_SUPERVISOR_BIND).toBe("100.64.0.1");
  });

  test("serve with a leftover TK_SUPERVISOR_OAUTH_GITHUB_ALLOW: starts, one warning naming the variable and not its value", () => {
    const d = tempDir("tk-sup-acct-serve-");
    mkdirSync(join(d, "store"));
    const value = "leftover-allow-value-5512";
    const seen: unknown[] = [];
    const fakeServe: BunServe = (o) => { seen.push(o); return { port: (o as any).port, stop: () => {} }; };
    const before = captured.length;
    const s = serve({
      TK_SUPERVISOR_BIND: "100.100.1.2", TK_SUPERVISOR_TOKEN: TOKEN, TK_SUPERVISOR_SESSION_SECRET: SECRET,
      TK_SUPERVISOR_DB: join(d, "q.db"), TK_STUDIO_HOME: join(d, "store"), TK_SUPERVISOR_OAUTH_GITHUB_ALLOW: value,
    }, fakeServe);
    try {
      expect(seen).toHaveLength(1);
      const lines = captured.slice(before).filter((l) => l.includes("TK_SUPERVISOR_OAUTH_"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("TK_SUPERVISOR_OAUTH_GITHUB_ALLOW");
      for (const l of captured.slice(before)) expect(l).not.toContain(value);
    } finally { s.stop(); }
    expect(envModule.oauthLeftovers({ TK_SUPERVISOR_OAUTH_GITHUB_ALLOW: value, TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID: " ", OTHER: "x" })).toEqual(["TK_SUPERVISOR_OAUTH_GITHUB_ALLOW"]);
  });
});

describe("the reset (AC4)", () => {
  test("delete account.json: GET / offers creation again, a new account is created, and the bearer worked throughout", async () => {
    const fx = fixture();
    expect((await create(fx)).status).toBe(303);
    fx.record();
    expect((await fx.call("GET", "/status", { bearer: true })).status).toBe(200);
    // Locked out first: the bearer still answers.
    for (let i = 0; i < LOCKOUT_FAILURES; i++) await signin(fx, WRONG);
    expect((await signin(fx, PASSWORD)).status).toBe(423);
    expect((await fx.call("GET", "/status", { bearer: true })).status).toBe(200);
    rmSync(fx.file);
    expect((await fx.call("GET", "/status", { bearer: true })).status).toBe(200);
    const page = await (await fx.call("GET", "/")).text();
    expect(page).toContain('action="/auth/account"');
    expect(page).not.toContain('action="/auth/signin"');
    expect((await create(fx, "new-owner", "a-fresh-password-29")).status).toBe(303);
    expect(fx.record().username).toBe("new-owner");
    expect((await signin(fx, "a-fresh-password-29", "new-owner")).status).toBe(200);
    expect((await fx.call("GET", "/status", { bearer: true })).status).toBe(200);
  });

  test("the reset clears the lockout: lock USER, delete account.json, recreate the same username, the right password signs in at once", async () => {
    const fx = fixture();
    expect((await create(fx)).status).toBe(303);
    fx.record();
    for (let i = 0; i < LOCKOUT_FAILURES; i++) await signin(fx, WRONG);
    expect((await signin(fx, PASSWORD)).status).toBe(423);
    rmSync(fx.file);
    expect((await create(fx, USER, "a-fresh-password-29")).status).toBe(303);
    expect(fx.record().username).toBe(USER);
    const res = await signin(fx, "a-fresh-password-29");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, username: USER });
    // The old refusals never count again: four new failures do not lock, the fifth does.
    for (let i = 0; i < LOCKOUT_FAILURES - 1; i++) expect((await signin(fx, WRONG)).status).toBe(401);
    expect((await signin(fx, WRONG)).status).toBe(423);
  });
});
