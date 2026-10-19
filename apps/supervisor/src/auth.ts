/**
 * The phone sign-in (Story 22.5, DW-20; Story 29.1): a cookie session beside the bearer header, never instead of it.
 *
 *   POST /auth/token     form `token=<TK_SUPERVISOR_TOKEN>` → the session cookie (the operator's own browser)
 *   POST /auth/account   the owner's one account, created on the first visit (`account.ts`) → the session cookie
 *   POST /auth/signin    the account's username and password, rate-limited with a lockout → the session cookie
 *
 * The session cookie `tk_session` is `<base64url {sub, exp}>.<HMAC-SHA256>` under
 * TK_SUPERVISOR_SESSION_SECRET, 7 days, `HttpOnly; Secure; SameSite=Lax; Path=/`. The CSRF token the
 * page embeds is an HMAC of the cookie's signature under a distinct label (never the cookie value).
 * Every comparison is constant time (both sides hashed, then `timingSafeEqual`). No external identity
 * provider exists (D7, D8).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tk_session";
/** The session's lifetime: 7 days. */
export const SESSION_TTL_S = 7 * 24 * 3600;
/** Story 29.1: a username is 3 to 64 letters, digits, `-`, `_` or `.`. */
export const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
/** Story 29.1: a password is at least this many characters (its length is the only check). */
export const PASSWORD_MIN = 12;

/** Story 29.1 (spec §8): the intended usage, stated on the sign-in page and verbatim in the README. */
export const INTENDED_USAGE = "The studio is operated by the person whose Claude subscription is signed in on this box, from their own seat: no token is intermediated and there is no API-key tier.";

const hash = (s: string) => createHash("sha256").update(s).digest();
const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");

/** Constant time: both sides hashed to one length before `timingSafeEqual` (the `authorized` pattern). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(hash(a), hash(b));
}

function sign(secret: string, label: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(secret, `${label}.${body}`)}`;
}

/** The payload when the signature holds and `exp` is still ahead of `nowMs`; else null. */
function verify(secret: string, label: string, value: string | null, nowMs: number): Record<string, unknown> | null {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value ?? "");
  if (!m) return null;
  if (!safeEqual(m[2], hmac(secret, `${label}.${m[1]}`))) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(m[1], "base64url").toString("utf-8")); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const exp = (p as Record<string, unknown>).exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= nowMs / 1000) return null;
  return p as Record<string, unknown>;
}

/** A session cookie value for `sub`, expiring SESSION_TTL_S from `nowMs`. */
export function signSession(secret: string, sub: string, nowMs: number): string {
  return sign(secret, "session", { sub, exp: Math.floor(nowMs / 1000) + SESSION_TTL_S });
}

/** The session, or null (bad signature, expired, malformed). */
export function verifySession(secret: string, value: string | null, nowMs: number): { sub: string; exp: number } | null {
  const p = verify(secret, "session", value, nowMs);
  return p && typeof p.sub === "string" ? { sub: p.sub, exp: p.exp as number } : null;
}

/** Whether a verified session's `sub` is one this code mints: `"token"` (the API token sign-in)
 * or `"account:<name>"` (the owner's account). Anything else, such as a `google:`/`github:` sub
 * minted by the deleted OAuth providers, is no session. */
export function sessionSubAccepted(sub: string): boolean {
  return sub === "token" || sub.startsWith("account:");
}

/** The CSRF token for a session cookie: an HMAC of its signature under a distinct label. */
export function csrfToken(secret: string, cookieValue: string): string {
  return hmac(secret, `csrf.${cookieValue.slice(cookieValue.lastIndexOf(".") + 1)}`);
}

/** A `Set-Cookie` value with the fixed flags. */
export function setCookie(name: string, value: string, maxAgeS: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeS}`;
}

/** One cookie's value from the request's `Cookie` header, or null. */
export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;padding:1rem;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e4;background:#141414;max-width:28rem}
:root{color-scheme:dark}
h1{font-size:1.25rem;margin:.25rem 0 1rem}
form{background:#1e1e1e;border:1px solid #333;border-radius:6px;padding:.75rem;margin:.75rem 0}
label{display:block;margin-bottom:.35rem}input[type=password],input[type=text]{width:100%;padding:.5rem;font-size:1rem}
button{display:block;width:100%;margin-top:.6rem;padding:.6rem;font-size:1rem;text-align:center;border:1px solid #555;border-radius:6px;background:#2a2a2a;color:#e4e4e4}
.note{color:#e0a458}
`;

/** The static line a sign-in page served without https carries: the `Secure` cookie never sticks over http. */
export const NEEDS_HTTPS_NOTE = "Browser sign-in needs https: set TK_SUPERVISOR_TLS_CERT, TK_SUPERVISOR_TLS_KEY and TK_SUPERVISOR_TLS_NAME.";

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The line a refused account form adds, naming the field, never its value. */
const INVALID_NOTE: Record<"username" | "password", string> = {
  username: "The username must be 3 to 64 characters: letters, digits, -, _ or .",
  password: `The password must be at least ${PASSWORD_MIN} characters.`,
};

export type SignInMode = "create" | "signin";

/** The sign-in page. No script; nothing of the status page. `create` (no account yet) offers the account creation
 * form (`POST /auth/account`) and no account sign-in form; `signin` offers the account form (`POST /auth/signin`).
 * Both keep the token form (`POST /auth/token`, the operator's own browser) and carry INTENDED_USAGE. A refusal adds only the generic "Sign-in refused."; a refused
 * account field adds the line naming that field; a server without https adds the static NEEDS_HTTPS_NOTE. Story 30.2: with
 * `next` (the requested path and query) each form carries it, escaped, in a hidden `next` field. */
export function signInPage(opts: { mode: SignInMode; refused?: boolean; needsHttps?: boolean; invalid?: "username" | "password"; next?: string }): string {
  const next = opts.next ? `<input type="hidden" name="next" value="${esc(opts.next)}">` : "";
  const fields = (action: string, pwAutocomplete: string, button: string) =>
    `<form method="post" action="${action}">${next}<label for="username">Username</label><input type="text" id="username" name="username" autocomplete="username" pattern="[A-Za-z0-9._-]{3,64}" required>`
    + `<label for="password">Password</label><input type="password" id="password" name="password" autocomplete="${pwAutocomplete}" minlength="${PASSWORD_MIN}" required>`
    + `<button type="submit">${esc(button)}</button></form>`;
  const token = `<form method="post" action="/auth/token">${next}<label for="token">API token</label><input type="password" id="token" name="token" autocomplete="current-password" required><button type="submit">Sign in with the token</button></form>`;
  const forms = opts.mode === "create"
    ? `<p>No account yet: create the owner's account.</p>\n${fields("/auth/account", "new-password", "Create account")}\n${token}`
    : `${fields("/auth/signin", "current-password", "Sign in")}\n${token}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>tk-studio supervisor: sign in</title><style>${CSS}</style></head>
<body><h1>tk-studio supervisor</h1>${opts.refused ? `<p class="note">Sign-in refused.</p>` : ""}${opts.invalid ? `<p class="note">${esc(INVALID_NOTE[opts.invalid])}</p>` : ""}${opts.needsHttps ? `<p class="note">${NEEDS_HTTPS_NOTE}</p>` : ""}
${forms}
<p class="usage">${esc(INTENDED_USAGE)}</p>
</body></html>`;
}
