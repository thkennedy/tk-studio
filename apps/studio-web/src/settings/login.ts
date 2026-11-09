// The Sandbox login card's rules (Story 39.2, CAP-6): pure functions vitest drives in `environment: "node"`. No DOM:
// `fetch` and the date formatter are injected. The composition is `LoginCard.tsx`.
// The card reads `GET /sandbox/login` (the login's clock; a cookie answer carries `X-CSRF-Token`) and `GET /status`
// (`live`: a run holding the sandbox gates Renew), and sends the two-step renewal: `POST /sandbox/login/start` (the
// sign-in URL), then `POST /sandbox/login/code` (the code claude.ai shows). The URL and the code live in the
// component's state only: never `localStorage`, never a console line.
import { csrfOf, namedError, type FetchLike } from "../inbox/model";

// ------------------------------------------------------------ the answers (mirrored from apps/supervisor, 0.1.35)

export type LoginState = "ok" | "expiring" | "expired" | "unknown";
export interface LoginReading {
  ok: true; sandbox: string; logged_in: boolean | null; auth_method: string | null; subscription_type: string | null;
  access_expires_at: string | null; refresh_expires_at: string | null; days_left: number | null; state: LoginState;
  checked_at: string; reason?: string;
}
export interface LoginStart { login_id: string; url: string; started_at: string; expires_at: string }
/** A refusal: the supervisor's `{ok: false, error, …}` and the status it came with. */
export interface Refusal { status: number; error: string; body: Record<string, unknown>; url: string }

/** Absolute: the page carries `<base href="/app/">`. */
export const LOGIN_URL = "/sandbox/login";
export const START_URL = "/sandbox/login/start";
export const CODE_URL = "/sandbox/login/code";
export const STATUS_URL = "/status";
/** The card polls the status every minute while it is open (and once more after a renewal). */
export const POLL_MS = 60_000;

export const CHECKING = "Checking the login…";
export const CODE_LABEL = "Paste the code claude.ai shows after you approve";
export const OPEN_SIGN_IN = "Open sign-in";

export type Fmt = (iso: string) => string;
export const defaultFmt: Fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STATES: readonly string[] = ["ok", "expiring", "expired", "unknown"];
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The reading's named fields only (no other key is ever kept). */
function readingOf(b: unknown): LoginReading | null {
  if (!isObj(b) || b.ok !== true || typeof b.sandbox !== "string" || typeof b.state !== "string" || !STATES.includes(b.state)) return null;
  return {
    ok: true, sandbox: b.sandbox, logged_in: typeof b.logged_in === "boolean" ? b.logged_in : null, auth_method: str(b.auth_method),
    subscription_type: str(b.subscription_type), access_expires_at: str(b.access_expires_at), refresh_expires_at: str(b.refresh_expires_at),
    days_left: typeof b.days_left === "number" ? b.days_left : null, state: b.state as LoginState, checked_at: str(b.checked_at) ?? "",
    ...(typeof b.reason === "string" ? { reason: b.reason } : {}),
  };
}

const failed = (url: string, e: unknown) => `${url}: ${e instanceof Error ? e.message : String(e)}`;
const JSON_HEADERS = { accept: "application/json" } as const;

export type ReadResult = { ok: true; reading: LoginReading; csrf: string | null } | { ok: false; error: string; csrf: string | null };

/** `GET /sandbox/login` with the session cookie. Never throws: a non-200 names the supervisor's `error`. */
export async function fetchLogin(fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<ReadResult> {
  try {
    const res = await fetchFn(LOGIN_URL, { credentials: "same-origin", headers: JSON_HEADERS });
    const csrf = csrfOf(res);
    if (!res.ok) return { ok: false, error: `${LOGIN_URL} answered ${res.status}${await namedError(res)}`, csrf };
    const reading = readingOf(await res.json());
    return reading ? { ok: true, reading, csrf } : { ok: false, error: `${LOGIN_URL}: no login in the answer`, csrf };
  } catch (e) {
    return { ok: false, error: failed(LOGIN_URL, e), csrf: null };
  }
}

export interface LiveRun { run_id: string; sandbox: string | null; state: string }
/** `GET /status`'s `live` runs (the Renew gate's source). Never throws: a failed read is no holder known. */
export async function fetchHolders(fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<LiveRun[]> {
  try {
    const res = await fetchFn(STATUS_URL, { credentials: "same-origin", headers: JSON_HEADERS });
    if (!res.ok) return [];
    const body = await res.json();
    if (!isObj(body) || !Array.isArray(body.live)) return [];
    return (body.live as unknown[]).filter(isObj).filter((r) => typeof r.run_id === "string" && typeof r.state === "string")
      .map((r) => ({ run_id: r.run_id as string, sandbox: str(r.sandbox), state: r.state as string }));
  } catch {
    return [];
  }
}

async function post<T>(url: string, body: unknown, csrf: string | null, fetchFn: FetchLike, pick: (b: unknown) => T | null):
  Promise<{ ok: true; value: T } | { ok: false; refusal: Refusal }> {
  try {
    const res = await fetchFn(url, {
      method: "POST", credentials: "same-origin",
      headers: { ...JSON_HEADERS, "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: JSON.stringify(body),
    });
    let answer: unknown = null;
    try { answer = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const b = isObj(answer) ? answer : {};
      return { ok: false, refusal: { status: res.status, error: typeof b.error === "string" ? b.error : "", body: b, url } };
    }
    const value = pick(answer);
    return value ? { ok: true, value } : { ok: false, refusal: { status: res.status, error: "", body: {}, url } };
  } catch (e) {
    return { ok: false, refusal: { status: 0, error: failed(url, e), body: {}, url } };
  }
}

/** `POST /sandbox/login/start {sandbox}` with the CSRF header. Never throws. */
export const postStart = (sandbox: string, csrf: string | null, fetchFn: FetchLike = (u, i) => fetch(u, i)) =>
  post<LoginStart>(START_URL, { sandbox }, csrf, fetchFn, (b) =>
    isObj(b) && b.ok === true && typeof b.login_id === "string" && typeof b.url === "string" && typeof b.expires_at === "string"
      ? { login_id: b.login_id, url: b.url, started_at: str(b.started_at) ?? "", expires_at: b.expires_at } : null);

/** `POST /sandbox/login/code {login_id, code}` with the CSRF header (the code trimmed). Never throws. */
export const postCode = (loginId: string, code: string, csrf: string | null, fetchFn: FetchLike = (u, i) => fetch(u, i)) =>
  post<LoginReading>(CODE_URL, { login_id: loginId, code: code.trim() }, csrf, fetchFn, readingOf);

// ------------------------------------------------------------ the lines

export type Tone = "plain" | "amber" | "red";

/** The card's status line for a reading (null: still reading), or the read's failure (which wins over a stale reading
 * kept from an earlier poll). */
export function cardLine(reading: LoginReading | null, readError: string | null, fmt: Fmt = defaultFmt): { text: string; tone: Tone } {
  if (readError !== null) return { text: `Login not read: ${readError}`, tone: "plain" };
  if (reading === null) return { text: CHECKING, tone: "plain" };
  const n = reading.days_left ?? 0;
  switch (reading.state) {
    case "ok":
      return { text: `Login valid for ${n === 1 ? "1 day" : `${n} days`}${reading.refresh_expires_at ? ` (until ${fmt(reading.refresh_expires_at)})` : ""}`, tone: "plain" };
    case "expiring":
      return { text: n >= 2 ? `Renew soon: ${n} days left` : n === 1 ? "Renew soon: 1 day left" : "Renew soon: less than a day left", tone: "amber" };
    case "expired":
      return { text: "Expired: every run on the sandbox waits for a renewal", tone: "red" };
    default:
      if (reading.reason === "sandbox stopped") {
        const last = reading.refresh_expires_at ? ` (last read ${fmt(reading.checked_at)}: valid until ${fmt(reading.refresh_expires_at)})` : "";
        return { text: `The sandbox is stopped: the login is read while it runs${last}`, tone: "plain" };
      }
      return { text: `Login not read: ${reading.reason ?? "unknown"}`, tone: "plain" };
  }
}

const HOLDING = ["running", "paused", "external"];

export interface GateInput {
  csrf: string | null; reading: LoginReading | null; holders: readonly LiveRun[];
  /** A `LoginInProgress` the start answered (its `expires_at`), else null. */
  inProgress: { expires_at: string } | null;
  /** This card's own started login (`Flow.start`), else null: Renew stays shut while it is open. */
  open: { expires_at: string } | null;
  busy: boolean; now: number;
  /** The last read's failure (`cardLine`'s `Login not read: …`), else null. */
  readError?: string | null;
}

/** Renew: enabled, or disabled with its reason shown. */
export function renewGate(g: GateInput, fmt: Fmt = defaultFmt): { enabled: true } | { enabled: false; reason: string } {
  if (!g.csrf) return { enabled: false, reason: "Waiting for the page's session" };
  const sb = g.reading?.sandbox;
  const holder = sb ? g.holders.find((r) => r.sandbox === sb && HOLDING.includes(r.state)) : undefined;
  if (holder) return { enabled: false, reason: `A run holds the sandbox (run ${holder.run_id}, ${holder.state}): Renew opens when it ends` };
  // This card's own sign-in, still open: a second start would only answer LoginInProgress.
  if (g.open && Date.parse(g.open.expires_at) > g.now) return { enabled: false, reason: `A sign-in is open: paste its code, or wait until ${fmt(g.open.expires_at)}` };
  if (g.inProgress && Date.parse(g.inProgress.expires_at) > g.now) return { enabled: false, reason: `A renewal is in progress elsewhere until ${fmt(g.inProgress.expires_at)}` };
  if (g.reading?.state === "unknown" && g.reading.reason === "sandbox stopped") return { enabled: false, reason: "The sandbox is stopped: Renew opens when it runs" };
  if (g.busy) return { enabled: false, reason: "Working…" };
  if (!g.reading) return { enabled: false, reason: g.readError ? `Login not read: ${g.readError}` : CHECKING };
  return { enabled: true };
}

/** Send is enabled only with a non-blank code and nothing in flight. */
export const canSendCode = (code: string, busy: boolean): boolean => code.trim() !== "" && !busy;

const lastLine = (b: Record<string, unknown>) => (typeof b.last_line === "string" ? b.last_line : "");

/** The result line of a start or code answer: the renewal, or the refusal in words. */
export function resultLine(a: { ok: true; reading: LoginReading } | { ok: false; refusal: Refusal }, fmt: Fmt = defaultFmt): string {
  if (a.ok) return a.reading.refresh_expires_at ? `Renewed: valid until ${fmt(a.reading.refresh_expires_at)}` : "Renewed";
  const { error, body, status, url } = a.refusal;
  switch (error) {
    case "LoginWhileLive": return `A run holds the sandbox (run ${String(body.run_id ?? "?")}): renew when it ends`;
    case "LoginInProgress": return `A renewal is already in progress${typeof body.expires_at === "string" ? ` (until ${fmt(body.expires_at)})` : ""}`;
    case "SandboxStopped": return "The sandbox is stopped: renew when it runs";
    case "LoginStartFailed": return `The sign-in did not start: ${lastLine(body)}`;
    case "CodeRefused":
      if (typeof body.url === "string") return `claude.ai did not accept that code: ${lastLine(body)}. Open the new sign-in and paste its code`;
      return body.tries_left === 0 ? "claude.ai did not accept the code twice: press Renew to start again" : "That code is incomplete: paste the whole code and send again";
    case "LoginExpired": return "The ten minutes ran out: press Renew to start again";
    case "LoginFailed": return `The renewal failed: ${lastLine(body)}`;
    case "UnknownLogin":
    case "LoginClosed": return "That renewal is over: press Renew to start again";
    case "CsrfRefused": return "The page's session expired: reload the page";
    default: return status === 0 ? error : `${url} answered ${status}${error ? ` ${error}` : ""}`;
  }
}

// ------------------------------------------------------------ the two-step flow

export interface Flow {
  /** The started login (its sign-in URL swaps on a refused code's respawn), else null. */
  start: LoginStart | null;
  code: string;
  busy: boolean;
  result: string | null;
  inProgress: { expires_at: string } | null;
  /** Set by a 200 code answer: the card reads the status once more. */
  renewed: boolean;
}
export const initialFlow: Flow = { start: null, code: "", busy: false, result: null, inProgress: null, renewed: false };

export type FlowEvent =
  | { type: "send" }
  | { type: "started"; answer: { ok: true; value: LoginStart } | { ok: false; refusal: Refusal } }
  | { type: "typed"; code: string }
  | { type: "coded"; answer: { ok: true; value: LoginReading } | { ok: false; refusal: Refusal } };

/** The code answers after which the login is over (its lease closed or past its deadline): the second refused code,
 * the ten minutes out, no outcome within the bound, the sandbox stopped under the lease, an unknown or a closed login.
 * A 200 closes it too. */
const CLOSING = ["LoginExpired", "LoginFailed", "SandboxStopped", "UnknownLogin", "LoginClosed"];
const closesLogin = (error: string, body: Record<string, unknown>): boolean =>
  (error === "CodeRefused" && body.tries_left === 0) || CLOSING.includes(error);

/** The flow's reducer (no storage, no side effect). */
export function flowReducer(f: Flow, e: FlowEvent, fmt: Fmt = defaultFmt): Flow {
  switch (e.type) {
    case "send":
      return { ...f, busy: true, result: null, renewed: false };
    case "typed":
      return { ...f, code: e.code };
    case "started":
      if (e.answer.ok) return { ...f, busy: false, start: e.answer.value, code: "", result: null, inProgress: null };
      return {
        // A LoginInProgress keeps this card's open login (its link and code field); any other refusal ends it.
        ...f, busy: false, start: e.answer.refusal.error === "LoginInProgress" ? f.start : null, result: resultLine(e.answer, fmt),
        inProgress: e.answer.refusal.error === "LoginInProgress" && typeof e.answer.refusal.body.expires_at === "string" ? { expires_at: e.answer.refusal.body.expires_at } : f.inProgress,
      };
    case "coded": {
      if (e.answer.ok) return { ...f, busy: false, start: null, code: "", result: resultLine({ ok: true, reading: e.answer.value }, fmt), renewed: true };
      const { error, body } = e.answer.refusal;
      const result = resultLine(e.answer, fmt);
      // Only the answers that close the login end it; a network failure or any other refusal keeps the link and the
      // field so the owner can send again.
      if (closesLogin(error, body)) return { ...f, busy: false, start: null, code: "", result };
      if (error === "CodeRefused" && typeof body.url === "string" && f.start) return { ...f, busy: false, code: "", result, start: { ...f.start, url: body.url } };
      return { ...f, busy: false, result };
    }
  }
}
