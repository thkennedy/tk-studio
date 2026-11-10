import { afterEach, describe, expect, it } from "vitest";
import {
  canSendCode, cardLine, CHECKING, CODE_URL, fetchHolders, fetchLogin, flowReducer, initialFlow, LOGIN_URL, POLL_MS, postCode, postStart, renewGate,
  resultLine, START_URL, type Flow, type LoginReading, type Refusal,
} from "./login";

const fmt = (iso: string) => `<${iso}>`;
const NOW = Date.parse("2026-11-09T12:00:00Z");
const reading = (o: Partial<LoginReading> = {}): LoginReading => ({
  ok: true, sandbox: "claude-tk-studio", logged_in: true, auth_method: "claude.ai", subscription_type: "max",
  access_expires_at: null, refresh_expires_at: "2026-11-24T10:00:43.000Z", days_left: 14, state: "ok", checked_at: "2026-11-09T12:00:00.000Z", ...o,
});
const refusal = (status: number, error: string, body: Record<string, unknown> = {}, url = CODE_URL): { ok: false; refusal: Refusal } =>
  ({ ok: false, refusal: { status, error, body: { ok: false, error, ...body }, url } });
const URL1 = "https://claude.com/cai/oauth/authorize?code_challenge=c1&state=s1";
const URL2 = "https://claude.com/cai/oauth/authorize?code_challenge=c2&state=s2";
const CODE = "abc-123#s1";

type Call = { url: string; init?: RequestInit };
function fakeFetch(answers: Record<string, { status: number; body: unknown; csrf?: string }>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answers[url];
    if (!a) throw new Error("offline");
    return { ok: a.status === 200, status: a.status, json: async () => a.body, headers: { get: (n: string) => (n === "x-csrf-token" ? a.csrf ?? null : null) } };
  };
  return { fn, calls };
}

// The URL and the code are never stored: any storage write during these tests fails them.
const writes: string[] = [];
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null, setItem: (k: string) => { writes.push(k); }, removeItem: (k: string) => { writes.push(k); },
};
afterEach(() => expect(writes).toEqual([]));

describe("the card's lines (AC3)", () => {
  it("checking, ok, expiring (amber), expired (red), unknown in words, the read failed", () => {
    expect(cardLine(null, null, fmt)).toEqual({ text: CHECKING, tone: "plain" });
    expect(CHECKING).toBe("Checking the login…");
    expect(cardLine(reading(), null, fmt)).toEqual({ text: "Login valid for 14 days (until <2026-11-24T10:00:43.000Z>)", tone: "plain" });
    expect(cardLine(reading({ days_left: 1 }), null, fmt).text).toBe("Login valid for 1 day (until <2026-11-24T10:00:43.000Z>)");
    expect(cardLine(reading({ state: "expiring", days_left: 3 }), null, fmt)).toEqual({ text: "Renew soon: 3 days left", tone: "amber" });
    expect(cardLine(reading({ state: "expiring", days_left: 1 }), null, fmt).text).toBe("Renew soon: 1 day left");
    expect(cardLine(reading({ state: "expiring", days_left: 0 }), null, fmt).text).toBe("Renew soon: less than a day left");
    expect(cardLine(reading({ state: "expired", days_left: 0 }), null, fmt)).toEqual({ text: "Expired: every run on the sandbox waits for a renewal", tone: "red" });
    expect(cardLine(reading({ state: "unknown", reason: "sandbox stopped", refresh_expires_at: null }), null, fmt).text).toBe("The sandbox is stopped: the login is read while it runs");
    expect(cardLine(reading({ state: "unknown", reason: "sandbox stopped" }), null, fmt).text)
      .toBe("The sandbox is stopped: the login is read while it runs (last read <2026-11-09T12:00:00.000Z>: valid until <2026-11-24T10:00:43.000Z>)");
    expect(cardLine(reading({ state: "unknown", reason: "the login probe failed: exit 1" }), null, fmt).text).toBe("Login not read: the login probe failed: exit 1");
    expect(cardLine(null, "/sandbox/login answered 400 SandboxRequired", fmt).text).toBe("Login not read: /sandbox/login answered 400 SandboxRequired");
  });

  it("a later read's failure replaces a stale reading kept from an earlier poll", () => {
    expect(cardLine(reading(), "/sandbox/login answered 500 InternalError", fmt)).toEqual({ text: "Login not read: /sandbox/login answered 500 InternalError", tone: "plain" });
  });
});

describe("the Renew gate's reasons (AC3)", () => {
  const base = { csrf: "t", reading: reading(), holders: [], inProgress: null, open: null, busy: false, now: NOW };
  it("enabled; disabled with each reason in order", () => {
    expect(renewGate(base, fmt)).toEqual({ enabled: true });
    expect(renewGate({ ...base, csrf: null }, fmt)).toEqual({ enabled: false, reason: "Waiting for the page's session" });
    expect(renewGate({ ...base, holders: [{ run_id: "q-1", sandbox: "claude-tk-studio", state: "running" }] }, fmt))
      .toEqual({ enabled: false, reason: "A run holds the sandbox (run q-1, running): Renew opens when it ends" });
    expect(renewGate({ ...base, holders: [{ run_id: "q-2", sandbox: "claude-tk-studio", state: "queued" }, { run_id: "q-3", sandbox: "other", state: "running" }] }, fmt)).toEqual({ enabled: true });
    expect(renewGate({ ...base, inProgress: { expires_at: "2026-11-09T12:05:00.000Z" } }, fmt))
      .toEqual({ enabled: false, reason: "A renewal is in progress elsewhere until <2026-11-09T12:05:00.000Z>" });
    expect(renewGate({ ...base, inProgress: { expires_at: "2026-11-09T11:59:00.000Z" } }, fmt)).toEqual({ enabled: true });
    expect(renewGate({ ...base, reading: reading({ state: "unknown", reason: "sandbox stopped" }) }, fmt))
      .toEqual({ enabled: false, reason: "The sandbox is stopped: Renew opens when it runs" });
    expect(renewGate({ ...base, busy: true }, fmt)).toEqual({ enabled: false, reason: "Working…" });
  });

  it("this card's own started login shuts Renew until its expiry, the reason in words; past it Renew opens again", () => {
    expect(renewGate({ ...base, open: { expires_at: "2026-11-09T12:10:00.000Z" } }, fmt))
      .toEqual({ enabled: false, reason: "A sign-in is open: paste its code, or wait until <2026-11-09T12:10:00.000Z>" });
    expect(renewGate({ ...base, open: { expires_at: "2026-11-09T11:59:00.000Z" } }, fmt)).toEqual({ enabled: true });
  });

  it("no reading and a read failure: the failure is the reason (not the checking line); no failure: still checking", () => {
    expect(renewGate({ ...base, reading: null, readError: "/sandbox/login answered 400 SandboxRequired" }, fmt))
      .toEqual({ enabled: false, reason: "Login not read: /sandbox/login answered 400 SandboxRequired" });
    expect(renewGate({ ...base, reading: null, readError: null }, fmt)).toEqual({ enabled: false, reason: CHECKING });
  });
});

describe("the reads and the two POSTs", () => {
  it("GET /sandbox/login with the cookie, its CSRF token kept; a refusal named; GET /status's live runs", async () => {
    const f = fakeFetch({ [LOGIN_URL]: { status: 200, body: { ...reading(), extra: "dropped" }, csrf: "tok" }, "/status": { status: 200, body: { ok: true, live: [{ run_id: "q-1", sandbox: "claude-tk-studio", state: "paused" }] } } });
    const r = await fetchLogin(f.fn);
    expect(r).toEqual({ ok: true, reading: reading(), csrf: "tok" });
    expect(f.calls[0]!.init).toMatchObject({ credentials: "same-origin" });
    expect(await fetchHolders(f.fn)).toEqual([{ run_id: "q-1", sandbox: "claude-tk-studio", state: "paused" }]);
    const bad = fakeFetch({ [LOGIN_URL]: { status: 400, body: { ok: false, error: "SandboxRequired" } } });
    expect(await fetchLogin(bad.fn)).toEqual({ ok: false, error: "/sandbox/login answered 400 SandboxRequired", csrf: null });
    expect(await fetchHolders(bad.fn)).toEqual([]);
  });

  it("both POSTs carry X-CSRF-Token, same-origin credentials and their exact bodies", async () => {
    const f = fakeFetch({
      [START_URL]: { status: 200, body: { ok: true, login_id: "0123456789ab", url: URL1, started_at: "a", expires_at: "b" } },
      [CODE_URL]: { status: 200, body: reading({ days_left: 30 }) },
    });
    expect(await postStart("claude-tk-studio", "tok", f.fn)).toEqual({ ok: true, value: { login_id: "0123456789ab", url: URL1, started_at: "a", expires_at: "b" } });
    expect(await postCode("0123456789ab", `  ${CODE} `, "tok", f.fn)).toEqual({ ok: true, value: reading({ days_left: 30 }) });
    for (const c of f.calls) {
      expect(c.init).toMatchObject({ method: "POST", credentials: "same-origin" });
      expect((c.init!.headers as Record<string, string>)["x-csrf-token"]).toBe("tok");
    }
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ sandbox: "claude-tk-studio" });
    expect(JSON.parse(String(f.calls[1]!.init!.body))).toEqual({ login_id: "0123456789ab", code: CODE });
    const off = fakeFetch({});
    expect(await postStart("x", "tok", off.fn)).toEqual({ ok: false, refusal: { status: 0, error: "/sandbox/login/start: offline", body: {}, url: START_URL } });
  });
});

describe("each refusal in words (AC3)", () => {
  it("the result lines", () => {
    expect(resultLine({ ok: true, reading: reading({ refresh_expires_at: "2026-12-24T10:00:43.000Z" }) }, fmt)).toBe("Renewed: valid until <2026-12-24T10:00:43.000Z>");
    expect(resultLine(refusal(409, "LoginWhileLive", { run_id: "q-7" }, START_URL), fmt)).toBe("A run holds the sandbox (run q-7): renew when it ends");
    expect(resultLine(refusal(409, "LoginInProgress", { expires_at: "E" }, START_URL), fmt)).toBe("A renewal is already in progress (until <E>)");
    expect(resultLine(refusal(409, "SandboxStopped", {}, START_URL), fmt)).toBe("The sandbox is stopped: renew when it runs");
    expect(resultLine(refusal(500, "LoginStartFailed", { last_line: "no server" }, START_URL), fmt)).toBe("The sign-in did not start: no server");
    expect(resultLine(refusal(409, "CodeRefused", { last_line: "Login failed: no", tries_left: 1, url: URL2 }), fmt))
      .toBe("claude.ai did not accept that code: Login failed: no. Open the new sign-in and paste its code");
    expect(resultLine(refusal(409, "CodeRefused", { last_line: "Invalid code.", tries_left: 1 }), fmt)).toBe("That code is incomplete: paste the whole code and send again");
    expect(resultLine(refusal(409, "CodeRefused", { tries_left: 0 }), fmt)).toBe("claude.ai did not accept the code twice: press Renew to start again");
    expect(resultLine(refusal(409, "LoginExpired"), fmt)).toBe("The ten minutes ran out: press Renew to start again");
    expect(resultLine(refusal(500, "LoginFailed", { last_line: "x" }), fmt)).toBe("The renewal failed: x");
    expect(resultLine(refusal(404, "UnknownLogin"), fmt)).toBe("That renewal is over: press Renew to start again");
    expect(resultLine(refusal(409, "LoginClosed"), fmt)).toBe("That renewal is over: press Renew to start again");
    expect(resultLine(refusal(403, "CsrfRefused"), fmt)).toBe("The page's session expired: reload the page");
    expect(resultLine(refusal(400, "SchemaError"), fmt)).toBe("/sandbox/login/code answered 400 SchemaError");
  });
});

describe("the two-step flow (AC3)", () => {
  const started: Flow = flowReducer(flowReducer(initialFlow, { type: "send" }), { type: "started", answer: { ok: true, value: { login_id: "0123456789ab", url: URL1, started_at: "a", expires_at: "b" } } });
  it("Renew → the sign-in link and the code field; Send → the renewal, and one more read", () => {
    expect(started).toMatchObject({ busy: false, start: { url: URL1 }, code: "", result: null });
    const typed = flowReducer(started, { type: "typed", code: CODE });
    expect(canSendCode(typed.code, typed.busy)).toBe(true);
    expect(canSendCode("  ", false)).toBe(false);
    const sending = flowReducer(typed, { type: "send" });
    expect(canSendCode(sending.code, sending.busy)).toBe(false);
    const done = flowReducer(sending, { type: "coded", answer: { ok: true, value: reading({ refresh_expires_at: "R" }) } }, fmt);
    expect(done).toEqual({ start: null, code: "", busy: false, result: "Renewed: valid until <R>", inProgress: null, renewed: true });
    expect(POLL_MS).toBe(60_000);
  });

  it("a refused code swaps the link to the new sign-in; an incomplete one keeps it; a second refusal, an expiry or a closed login ends it", () => {
    const swapped = flowReducer(started, { type: "coded", answer: refusal(409, "CodeRefused", { last_line: "no", tries_left: 1, url: URL2 }) }, fmt);
    expect(swapped.start?.url).toBe(URL2);
    expect(swapped.code).toBe("");
    const kept = flowReducer({ ...started, code: "abc" }, { type: "coded", answer: refusal(409, "CodeRefused", { tries_left: 1 }) }, fmt);
    expect(kept.start?.url).toBe(URL1);
    expect(kept.code).toBe("abc");
    for (const r of [refusal(409, "CodeRefused", { tries_left: 0 }), refusal(409, "LoginExpired"), refusal(409, "LoginClosed"), refusal(500, "LoginFailed")]) {
      expect(flowReducer(started, { type: "coded", answer: r }, fmt).start).toBeNull();
    }
  });

  it("a code answered SandboxStopped (the lease closed `failed`) ends the open sign-in, its reason in words", () => {
    const stopped = flowReducer({ ...started, code: "abc" }, { type: "coded", answer: refusal(409, "SandboxStopped", { sandbox: "claude-tk-studio", login_id: "0123456789ab" }) }, fmt);
    expect(stopped.start).toBeNull();
    expect(stopped.result).toBe("The sandbox is stopped: renew when it runs");
  });

  it("a LoginInProgress start disables Renew until its expiry", () => {
    const busy = flowReducer(initialFlow, { type: "started", answer: refusal(409, "LoginInProgress", { expires_at: "2026-11-09T12:05:00.000Z" }, START_URL) }, fmt);
    expect(busy.inProgress).toEqual({ expires_at: "2026-11-09T12:05:00.000Z" });
    expect(busy.result).toBe("A renewal is already in progress (until <2026-11-09T12:05:00.000Z>)");
    expect(renewGate({ csrf: "t", reading: reading(), holders: [], inProgress: busy.inProgress, open: busy.start, busy: busy.busy, now: NOW }, fmt).enabled).toBe(false);
  });

  const OPEN = { login_id: "0123456789ab", url: URL1, started_at: "2026-11-09T12:00:00.000Z", expires_at: "2026-11-09T12:10:00.000Z" };
  const live: Flow = flowReducer(flowReducer(initialFlow, { type: "send" }), { type: "started", answer: { ok: true, value: OPEN } });

  it("after a successful start Renew is shut while the sign-in is open; a LoginInProgress start keeps the open login's link and field", () => {
    expect(renewGate({ csrf: "t", reading: reading(), holders: [], inProgress: live.inProgress, open: live.start, busy: live.busy, now: NOW }, fmt))
      .toEqual({ enabled: false, reason: "A sign-in is open: paste its code, or wait until <2026-11-09T12:10:00.000Z>" });
    const typed = flowReducer(live, { type: "typed", code: CODE });
    const again = flowReducer(flowReducer(typed, { type: "send" }), { type: "started", answer: refusal(409, "LoginInProgress", { expires_at: OPEN.expires_at }, START_URL) }, fmt);
    expect(again.start).toEqual(OPEN);
    expect(again.code).toBe(CODE);
    expect(again.busy).toBe(false);
    // any other start refusal still ends a start
    expect(flowReducer(live, { type: "started", answer: refusal(409, "SandboxStopped", {}, START_URL) }, fmt).start).toBeNull();
  });

  it("a code answer that does not close the login keeps the link and the field: a network failure, an unlisted error, a CSRF refusal", () => {
    const typed = flowReducer(live, { type: "typed", code: CODE });
    for (const r of [
      { ok: false as const, refusal: { status: 0, error: "/sandbox/login/code: offline", body: {}, url: CODE_URL } },
      refusal(502, "BadGateway"), refusal(500, ""), refusal(403, "CsrfRefused"), refusal(400, "SchemaError"), refusal(409, "LoginInProgress"),
    ]) {
      const after = flowReducer(flowReducer(typed, { type: "send" }), { type: "coded", answer: r }, fmt);
      expect(after.start).toEqual(OPEN);
      expect(after.code).toBe(CODE);
      expect(after.busy).toBe(false);
      expect(after.result).toBe(resultLine(r, fmt));
      expect(canSendCode(after.code, after.busy)).toBe(true); // the owner can send again
    }
  });

  it("only the closing code answers end the login: 200, CodeRefused with tries_left 0, LoginExpired, LoginFailed, SandboxStopped, UnknownLogin, LoginClosed", () => {
    const typed = flowReducer(live, { type: "typed", code: CODE });
    const closing = [
      { ok: true as const, value: reading() }, refusal(409, "CodeRefused", { tries_left: 0 }), refusal(409, "LoginExpired"),
      refusal(500, "LoginFailed", { last_line: "x" }), refusal(409, "SandboxStopped", { sandbox: "claude-tk-studio", login_id: "0123456789ab" }),
      refusal(404, "UnknownLogin"), refusal(409, "LoginClosed", { result: "renewed" }),
    ];
    for (const r of closing) {
      const after = flowReducer(typed, { type: "coded", answer: r }, fmt);
      expect(after.start).toBeNull();
      expect(after.code).toBe("");
      expect(renewGate({ csrf: "t", reading: reading(), holders: [], inProgress: after.inProgress, open: after.start, busy: after.busy, now: NOW }, fmt)).toEqual({ enabled: true });
    }
    // a refused code with a try left is not closing: the link stays (swapped to the new sign-in when one is given)
    expect(flowReducer(typed, { type: "coded", answer: refusal(409, "CodeRefused", { tries_left: 1 }) }, fmt).start).toEqual(OPEN);
    expect(flowReducer(typed, { type: "coded", answer: refusal(409, "CodeRefused", { tries_left: 1, url: URL2 }) }, fmt).start).toEqual({ ...OPEN, url: URL2 });
  });
});
