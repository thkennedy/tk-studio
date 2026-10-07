/**
 * The phone sign-in (Story 22.5, DW-20): a cookie session beside the bearer header, never instead of it.
 *
 *   POST /auth/token                 form `token=<TK_SUPERVISOR_TOKEN>` → the session cookie
 *   GET  /auth/{google,github}       → the provider's authorize URL, with a signed state cookie (600 s)
 *   GET  /auth/{google,github}/callback  state checked first, then the code exchanged and the verified
 *                                    identity matched against the one allow-listed entry
 *
 * The session cookie `tk_session` is `<base64url {sub, exp}>.<HMAC-SHA256>` under
 * TK_SUPERVISOR_SESSION_SECRET, 7 days, `HttpOnly; Secure; SameSite=Lax; Path=/`. The CSRF token the
 * page embeds is an HMAC of the cookie's signature under a distinct label (never the cookie value).
 * Every comparison is constant time (both sides hashed, then `timingSafeEqual`). The provider endpoints
 * are reached through an injected `fetch`, so tests fake the provider and never touch the network.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthProviderConfig } from "./env";

export const SESSION_COOKIE = "tk_session";
export const STATE_COOKIE = "tk_oauth_state";
/** The session's lifetime: 7 days. */
export const SESSION_TTL_S = 7 * 24 * 3600;
/** The OAuth state cookie's lifetime. */
export const STATE_TTL_S = 600;

export type ProviderName = "google" | "github";
export const PROVIDERS: readonly ProviderName[] = ["google", "github"];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The provider endpoints (reached through the injected `fetch`). */
export const ENDPOINTS: Record<ProviderName, { authorize: string; token: string; user: string }> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    user: "https://openidconnect.googleapis.com/v1/userinfo",
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    user: "https://api.github.com/user",
  },
};

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

/** The CSRF token for a session cookie: an HMAC of its signature under a distinct label. */
export function csrfToken(secret: string, cookieValue: string): string {
  return hmac(secret, `csrf.${cookieValue.slice(cookieValue.lastIndexOf(".") + 1)}`);
}

/** A fresh OAuth `state`. */
export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function signState(secret: string, provider: ProviderName, state: string, nowMs: number): string {
  return sign(secret, `oauth-state.${provider}`, { state, exp: Math.floor(nowMs / 1000) + STATE_TTL_S });
}

/** The state the cookie carries for `provider`, or null (missing, bad signature, expired). */
export function verifyState(secret: string, provider: ProviderName, value: string | null, nowMs: number): string | null {
  const p = verify(secret, `oauth-state.${provider}`, value, nowMs);
  return p && typeof p.state === "string" && p.state ? p.state : null;
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

/** The provider's authorize URL for this sign-in. */
export function authorizeUrl(provider: ProviderName, cfg: OAuthProviderConfig, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, state });
  if (provider === "google") { q.set("response_type", "code"); q.set("scope", "openid email"); }
  return `${ENDPOINTS[provider].authorize}?${q.toString()}`;
}

/** The provider's verified identity for `code` — Google: the email, only when `email_verified`;
 * GitHub: the `/user` login — or null. Any provider failure is null (never a detail). */
export async function oauthIdentity(provider: ProviderName, cfg: OAuthProviderConfig, code: string, redirectUri: string, fetcher: FetchLike): Promise<string | null> {
  try {
    const ep = ENDPOINTS[provider];
    const form = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri });
    if (provider === "google") form.set("grant_type", "authorization_code");
    const tokenRes = await fetcher(ep.token, {
      method: "POST", body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    });
    if (!tokenRes.ok) return null;
    const tok = await tokenRes.json() as Record<string, unknown>;
    const access = typeof tok.access_token === "string" && tok.access_token ? tok.access_token : null;
    if (!access) return null;
    const userRes = await fetcher(ep.user, {
      headers: { authorization: `Bearer ${access}`, accept: "application/json", "user-agent": "tk-studio-supervisor" },
    });
    if (!userRes.ok) return null;
    const user = await userRes.json() as Record<string, unknown>;
    if (provider === "google") {
      const verified = user.email_verified === true || user.email_verified === "true";
      return verified && typeof user.email === "string" && user.email ? user.email : null;
    }
    return typeof user.login === "string" && user.login ? user.login : null;
  } catch {
    return null;
  }
}

/** The identity equals the one allow entry (case-insensitive, constant time). */
export function allowed(identity: string, allow: string): boolean {
  return safeEqual(identity.trim().toLowerCase(), allow.trim().toLowerCase());
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;padding:1rem;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1b1b;background:#f6f6f4;max-width:28rem}
h1{font-size:1.25rem;margin:.25rem 0 1rem}
form,.links{background:#fff;border:1px solid #ddd;border-radius:6px;padding:.75rem;margin:.75rem 0}
label{display:block;margin-bottom:.35rem}input[type=password]{width:100%;padding:.5rem;font-size:1rem}
button,.links a{display:block;width:100%;margin-top:.6rem;padding:.6rem;font-size:1rem;text-align:center;border:1px solid #888;border-radius:6px;background:#eee;color:#1b1b1b;text-decoration:none}
.note{color:#8a4b00}
`;

/** The static line a sign-in page served without https carries: the `Secure` cookie never sticks over http. */
export const NEEDS_HTTPS_NOTE = "Browser sign-in needs https: set TK_SUPERVISOR_TLS_CERT, TK_SUPERVISOR_TLS_KEY and TK_SUPERVISOR_TLS_NAME.";

/** The sign-in page: the token form and the two provider links. No script; nothing of the status page.
 * A refusal adds only the generic "Sign-in refused."; a server without https adds the static NEEDS_HTTPS_NOTE. */
export function signInPage(opts: { refused?: boolean; needsHttps?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>tk-studio supervisor: sign in</title><style>${CSS}</style></head>
<body><h1>tk-studio supervisor</h1>${opts.refused ? `<p class="note">Sign-in refused.</p>` : ""}${opts.needsHttps ? `<p class="note">${NEEDS_HTTPS_NOTE}</p>` : ""}
<form method="post" action="/auth/token"><label for="token">API token</label><input type="password" id="token" name="token" autocomplete="current-password" required><button type="submit">Sign in</button></form>
<div class="links"><a href="/auth/google">Continue with Google</a><a href="/auth/github">Continue with GitHub</a></div>
</body></html>`;
}
