---
title: 'Sign In from the Phone'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_revision: '6e4a6935f014af8b1a5ac5ba658aef291ed2c692'
review_loop_iteration: 0
deviation_score: 2
reconcile_verdict: adjust-stories
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-22/operator-decisions.md'
warnings: [oversized]
deferred:
  - summary: >-
      The Tailscale certificate is renewed only when start.ps1 starts, and serve never reloads it, so on a box up longer than the 90-day certificate life https fails with an expired certificate.
    evidence: |-
      Review pass 1 (blind hunter): `tailscale cert` runs once in start.ps1's main script before the keeper; Bun.serve reads cert and key once at bind. No periodic renewal or serve restart exists. AC4 requires https with the machine's Tailscale certificate (deferral class a). The README now tells the operator to restart start.ps1 on long uptimes.
    location: >-
      start.ps1 (tailscale cert block); src/api.ts serve
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The status page (Story 22.2) sits behind the bearer header, and a phone's browser cannot send one. The operator therefore cannot watch or cancel runs from the phone (DW-20, decided 2026-10-06, operator-decisions §7).

**Approach:** Add a cookie session beside the bearer header, never instead of it. The page offers a sign-in page with three ways in: a token form, Google, and GitHub. Allow-listed identities get a signed `HttpOnly; Secure; SameSite=Lax` session cookie. When the Tailscale certificate is configured, `Bun.serve` serves `https` on the unchanged tailnet bind.

**User story (epics.md, Story 22.5):** As the operator on the phone, I want the status page to sign me in with the token, with Google, or with GitHub, and keep me signed in with a cookie, so that I can watch and cancel runs from a phone browser, which cannot send the bearer header (DW-20).

**Acceptance criteria (verbatim, authoritative):**

- **AC1.** **Given** a browser request to the page with neither a bearer header nor a valid session cookie, **When** it is answered, **Then** it gets a sign-in page on the same bind: a form that takes the API token, and "Continue with Google" and "Continue with GitHub". Nothing else of the page is served, and the API's JSON routes still answer 401 as in Story 22.1.
- **AC2.** **Given** the correct token on the form, or an OAuth callback whose verified identity is on the allow list named in the environment (one Google account, one GitHub login, never a wildcard), **When** sign-in completes, **Then** an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie is set, signed with a session secret from the environment and carrying an expiry. An identity off the allow list, a bad token, or a failed OAuth state check is refused with no cookie and no detail.
- **AC3.** **Given** a signed-in browser, **When** it opens `GET /` and the API's GET routes, **Then** they answer as the bearer header would. `POST /runs/{id}/cancel` from a cookie session also needs the CSRF token the page embeds, and a cookie never authorises `POST /jobs`.
- **AC4.** **Given** Google's rule that a redirect URI is `https` on anything but localhost, **When** the supervisor serves the sign-in, **Then** it serves `https` on the tailnet address with the machine's Tailscale certificate for its MagicDNS name (`tailscale cert`). The bind rule of Story 22.1 is unchanged. The hand-over names the operator's two steps: enable HTTPS certificates once in the Tailscale admin console, and register the Google and GitHub OAuth apps with that callback URL, with their client ids and secrets set under the `TK_SUPERVISOR_OAUTH_*` names the story fixes.
- **AC5.** **Given** the OAuth client secrets, the session secret and every cookie value, **When** anything logs, renders, notifies or spawns a worker, **Then** none of them appears (NFR5) and `buildWorkerEnv` drops them. The test suite pins the form path, both OAuth callbacks against a faked provider, the allow-list refusal, the state-check refusal, cookie expiry and the CSRF refusal.

## Boundaries & Constraints

**Always:**
- The bearer header stays the API's auth for every route, exactly as in 22.1. The cookie is an addition for the browser only.
- The bind rule is unchanged: `checkBind`, and the same `TK_SUPERVISOR_BIND`/`PORT`.
- Secrets are compared in constant time (hash, then `timingSafeEqual`, the `authorized` pattern).
- Every new variable comes from the environment (AD-15).
- Refusals carry no detail: the same sign-in page, with no `Set-Cookie`.
- The OAuth provider endpoints are injectable, so the tests use a faked provider and never the network.

**Block If:**
- The fixed variable names or the fixed design below cannot satisfy an AC without changing the bearer behaviour of 22.1 for `curl` clients.

**Never:**
- A wildcard, list or pattern in an allow list.
- A cookie authorising `POST /jobs`, or any non-GET route except cancel with CSRF.
- Changing the bind.
- `tailscale serve`.
- Client-side script on the page.
- Logging, rendering or notifying a secret or a cookie value.
- Touching the tk-studio plugin. The runbook §4.5 follows in tk-studio, not here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| unauth page | `GET /`, no bearer, no or invalid or expired cookie | 401 `text/html` sign-in page: token form (`POST /auth/token`), links "Continue with Google" (`/auth/google`) and "Continue with GitHub" (`/auth/github`). No queue, store or registry data. |
| unauth JSON | `GET /status` (any API route), no bearer, no cookie | 401 `{ok:false,error:"Unauthorized"}`, unchanged |
| token form ok | `POST /auth/token`, form `token=<TK_SUPERVISOR_TOKEN>` | 303 → `/`, `Set-Cookie: tk_session=…; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` |
| token form bad | wrong or empty token | 401 sign-in page, a generic "Sign-in refused.", no `Set-Cookie` |
| OAuth start | `GET /auth/google` or `/auth/github` with the provider configured | 302 to the provider's authorize URL with `state`, plus a short-lived (600 s) signed `tk_oauth_state` cookie (`HttpOnly; Secure; SameSite=Lax`) |
| OAuth ok | callback with `code` and a `state` matching the state cookie; the provider's verified identity equals the allow entry | 303 → `/` with the session cookie |
| OAuth off-list or unverified | Google `email_verified` false, or the email or login ≠ the allow entry (case-insensitive) | refused like a bad token, with no session cookie |
| OAuth state fail | `state` missing, or ≠ the cookie, or the cookie missing or expired | refused, and the provider is never called |
| provider unconfigured | `/auth/<p>` when that provider's variables are unset | refused (the sign-in page, no detail) |
| cookie reads | a valid cookie on `GET /`, `/jobs`, `/runs/{id}`, `/status`, `/events` (JSON and SSE) | the same answer as with the bearer |
| cookie cancel | `POST /runs/{id}/cancel` with the cookie, plus form field `csrf` or header `X-CSRF-Token` equal to the page's token | the cancel answer as with the bearer. A missing or wrong CSRF token is 403 `{ok:false,error:"CsrfRefused"}` and nothing is cancelled. |
| cookie jobs | `POST /jobs` with only the cookie | 401 Unauthorized, nothing queued |
| expired cookie | `exp` ≤ now, or a bad signature | treated as no cookie |

</intent-contract>

## Code Map

There is no plan file for 22-5. This investigation was done on 2026-10-07 at the baseline revision.

- `src/api.ts`
  - `createApi` :142. `authorized` :154 is the constant-time bearer check to reuse for the token form. `redact` :161.
  - `page()` :275 calls `gatherPage`/`renderPage`.
  - The router :280-315: `authorized` runs first at :281. Split it here: auth routes, then bearer, then cookie by route.
  - `postCancel` :194. `serve()` :319 calls `Bun.serve({hostname: bind, port, …})`; add `tls: {cert, key}` here.
  - `ApiDeps` :64 is the injection seam. Add `session`/`oauth` deps (secret, clock, provider fetch).
- `src/env.ts`
  - The API getters `apiBind`/`apiPort`/`apiToken` are at :91-112, with the named-error pattern `ApiTokenMissing` :83.
  - The notifier getter with `NotifierConfigMissing` is at :138-160. Model the OAuth and TLS getters on it.
  - The header comment block :58-66 is where the variables are documented.
- `src/page.ts`
  - `gatherPage` :157, `renderPage` :369 (escaped, no script).
  - `redactCredentials` :295: its exact-value list matches only `/^TK_SUPERVISOR_.*TOKEN/` at :296. Widen it to `TOKEN|SECRET`.
  - `credentialKey` :265 already covers `secret`/`cookie` keys.
  - The page gains a cancel `<form method="post" action="/runs/<id>/cancel">` with a hidden `csrf` input for each live (non-terminal) run, only when rendered for a cookie session.
- `src/server.ts:535` `buildWorkerEnv`: the drop list. Add `TK_SUPERVISOR_SESSION_SECRET`, `TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET` and `TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET`.
- `src/hygiene.ts:237`: notifier redaction, which covers only the notifier's own secrets. Notification text is built from run state, which never holds the new secrets. Touch it only if a test shows a leak.
- `src/cli.ts:1602` `serve`: prints `{ok, listening}`. The URL becomes `https://…` when TLS is on. Named start errors print `message(e)`, which never holds a value.
- `start.ps1:71-77` `$Names` (the exported variables) and `:90` (the required list).
- `README.md:40` `## HTTP API`, `:165` `## Environment` table.
- `test/api.test.ts`: `fixture()` ~:59, the console-capture token guard :44-57, and `OPERATOR_HYGIENE_VARS` :21. `test/page.test.ts`: the redaction tests. `test/fakes.ts`.

## Tasks & Acceptance

**Execution:**
- `src/env.ts`: add the getters and named errors for:
  - `TK_SUPERVISOR_SESSION_SECRET` (required by `serve`: `SessionSecretMissing`).
  - `TK_SUPERVISOR_TLS_CERT`/`TK_SUPERVISOR_TLS_KEY`/`TK_SUPERVISOR_TLS_NAME`. All three set or none; a partial set is `TlsConfigIncomplete`.
  - `TK_SUPERVISOR_OAUTH_{GOOGLE,GITHUB}_{CLIENT_ID,CLIENT_SECRET,ALLOW}`. For each provider, all three set or none. A partial set is `OAuthConfigIncomplete`. An `ALLOW` containing `*`, `,` or whitespace is `OAuthAllowInvalid`. A configured provider with no TLS is `OAuthNeedsHttps`.
  - No error message ever holds a value.
- `src/auth.ts` (new):
  - Session cookie sign and verify: HMAC-SHA256 over a base64url payload `{sub, exp}`, with a 7-day TTL.
  - The CSRF token: an HMAC of the session cookie's signature under a distinct label, never equal to the cookie value.
  - The OAuth state cookie, with a 600 s TTL.
  - The Google flow: the code exchange, then userinfo; requires `email_verified`.
  - The GitHub flow: the code exchange, then `/user` `login`.
  - The provider endpoints are injected through a `fetch` dep.
  - The sign-in page HTML.
  - Constant-time comparisons throughout.
- `src/api.ts`: route `/auth/token` (POST), `/auth/google`, `/auth/github` and their `/callback`s (GET) before auth. A valid bearer authorises everything as before. Otherwise a valid cookie authorises the GET routes and cancel with CSRF (403 `CsrfRefused` without it). `GET /` with no auth is the 401 sign-in page. Everything else is 401 JSON. `serve()` reads the new config, passes `tls` to `Bun.serve` when it is set, and returns an `https://<TLS_NAME>:<port>` URL.
- `src/page.ts`: widen the exact-value redaction to `TK_SUPERVISOR_*(TOKEN|SECRET)*`. Add the cancel forms with an embedded `csrf` when a CSRF token is passed in.
- `src/server.ts`: add the three secrets to the `buildWorkerEnv` drop list and its doc comment.
- `start.ps1`:
  - Add the new names to `$Names`, and `TK_SUPERVISOR_SESSION_SECRET` to the required list.
  - When the three TLS variables are set, run `tailscale cert --cert-file $env:TK_SUPERVISOR_TLS_CERT --key-file $env:TK_SUPERVISOR_TLS_KEY $env:TK_SUPERVISOR_TLS_NAME`, bounded, with a failure as a warning, before the keeper starts. This renews the 90-day certificate.
  - Print names only.
- `README.md`:
  - Document the sign-in routes, the cookie and CSRF rules, and the new variables in the Environment table.
  - Add a "Hand-over" paragraph with the operator's two steps: (1) enable HTTPS certificates once in the Tailscale admin console; (2) register the Google OAuth app and the GitHub OAuth app with the callback URLs `https://<TLS_NAME>:<port>/auth/google/callback` and `…/auth/github/callback`, and set `TK_SUPERVISOR_OAUTH_*`. Also set `TK_SUPERVISOR_SESSION_SECRET` (random, at least 32 bytes) and the TLS variables.
  - Update the smoke line for https.
- `test/auth.test.ts` (new), plus `test/api.test.ts`/`test/page.test.ts` additions. Pin:
  - every I/O row;
  - the form path;
  - the Google and GitHub callbacks against a faked provider;
  - the allow-list refusal and the state-check refusal;
  - cookie expiry (an injected clock);
  - the CSRF refusal;
  - that a cookie cannot `POST /jobs`;
  - the cookie flags;
  - the named start errors;
  - the `buildWorkerEnv` drops;
  - that no secret or cookie value appears in a console line, a rendered page, or an answer body.

**Acceptance Criteria:** AC1–AC5 above, each proven by the tests named in its row. The parts of AC4 that need the tailnet, the certificate and the registered apps are `unverifiable-here`. The operator's check is to open `https://<TLS_NAME>:8787/` on the phone and sign in each way.

## Spec Change Log

## Review Triage Log

### 2026-10-07 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 1 (medium 1)
- reject: 2 (low 2)
- addressed_findings:
  - `[medium]` `[patch]` serve threw an unnamed Bun error on a missing/unreadable cert or key, so the API was down undiagnosed: added the named start error `TlsCertUnreadable` (names the variable, never the path), checked before any bind
  - `[medium]` `[patch]` the session secret's 32-byte minimum was documented but not enforced: added `SessionSecretWeak`
  - `[medium]` `[patch]` the TLS branch of `serve` (AC4) was untested: added the injectable `serve(env, bunServe)` seam, with tests for tls, the unchanged bind, the https url and the OAuth origin
  - `[low]` `[patch]` over http the token form set a Secure cookie the browser drops (a silent loop): the form now refuses without https, the sign-in page notes it, and the README says so (hand-over too)
  - `[low]` `[patch]` revocation was undocumented: README says there is no sign-out, the 7-day life, and that rotating the secret revokes every session
- deferred: cert renewal only at start.ps1 start (class a: AC4 https over time)
- rejected: the cancel form leaves the phone on the JSON answer (the spec's I/O row pins "the cancel answer as with the bearer"); per-request re-check of `sub` against the current allow list (not in the criteria; rotating the secret revokes, now documented)
- note: the reviewers read the diff from `/tmp/22-5-review.diff` (code files, baseline..working tree, the spec excluded) rather than inline, to keep the prompts small

### 2026-10-07 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 0
- reject: 5 (medium 1, low 4)
- addressed_findings:
  - `[low]` `[patch]` README.md:44 still said every route needs the bearer header, and the `GET /` row said "behind the same bearer check": both now name the pre-auth `/auth/*` routes, the 401 sign-in page on `GET /`, and the cookie's GET and cancel-with-CSRF reach (never `POST /jobs`)
  - `[low]` `[patch]` the README revocation note left out token rotation and provider removal: it now says neither ends a signed-in session (a token-form session is not re-checked against the current token), and to rotate the session secret as well after a token leak
  - `[low]` `[patch]` the start.ps1 changes (session secret required, the new exported names, the single bounded `tailscale cert` step skipped under `-ServeOnly`) were unasserted: added a text-assertion `describe("start.ps1 sign-in (Story 22.5 AC4)")` block, 4 tests, in test/hygiene.test.ts beside the 22.3 start.ps1 block
- rejected: cert renewal only at start and no expiry check at serve (duplicate of this spec's existing deferral); GitHub allow by login, not numeric id (AC2 fixes "one GitHub login"); cancel leaves the phone on JSON (already rejected: the I/O row pins "the cancel answer as with the bearer"); no test of secrets in notifications (the notifier never receives the session or OAuth secrets: its message is built from run fields, and AC5's pin list does not name it); a cookie SSE stream outliving the cookie's expiry (the expired-cookie row is judged per request, as the bearer stream is)
- note: the reviewers read the diff from `/tmp/rev-22-5/diff.patch` (code files, baseline..working tree, `_bmad-output/` excluded), as in the first pass


## Design Notes

- **TLS in `Bun.serve`**, not `tailscale serve`, because it keeps 22.1's bind and process unchanged (operator-decisions §7 leaves the choice to the story). With no TLS variables set, `serve` stays `http` exactly as 22.1/22.3 built it. OAuth then refuses to start (`OAuthNeedsHttps`), and the `Secure` cookie will not stick over http. So the phone sign-in needs the certificate, and existing `curl http://` smokes keep working until the operator enables it.
- **`TK_SUPERVISOR_SESSION_SECRET` is required**, because the story says the secret comes from the environment. The upgrade therefore needs it set before the next logon: it is in the hand-over and in the `start.ps1` required list. This changes 22.3's as-built `start.ps1` and the runbook (22-4): record it as a DRIFT.
- **GET / unauthenticated is 401 with the HTML sign-in page.** It keeps 22.1's "every route 401 without auth" status while serving the form.
- **A refused sign-in sets no cookie at all.** The OAuth state cookie expires on its own.
- **Variable names fixed by this story:** `TK_SUPERVISOR_SESSION_SECRET`, `TK_SUPERVISOR_TLS_{CERT,KEY,NAME}`, `TK_SUPERVISOR_OAUTH_GOOGLE_{CLIENT_ID,CLIENT_SECRET,ALLOW}`, `TK_SUPERVISOR_OAUTH_GITHUB_{CLIENT_ID,CLIENT_SECRET,ALLOW}`.
- **Band:** L (about 9 files). Both review layers run.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: no change
- `bun test` -- expected: all green
- `bunx tsc --noEmit` -- expected: no errors

## Deviation Summary

### pass 1 (implementer, 2026-10-07)

- planned: `test/page.test.ts` additions only / actual: rewrote the existing test "no token or a wrong one: 401" (asserted a 401 JSON body on `GET /`) to assert the 401 HTML sign-in page / why: AC1 makes unauthenticated `GET /` the sign-in page; the old assertion contradicted the spec / may affect: none
- planned: `test/api.test.ts` additions / actual: changed the existing serve-refusal test's `ok` env to include `TK_SUPERVISOR_SESSION_SECRET`, and added the new variables to `OPERATOR_HYGIENE_VARS` / why: the session secret is now required at start / may affect: none
- planned: `ApiDeps` gains session/oauth deps (secret, clock, provider fetch) / actual: `session: {secret}` and `oauth: {providers, origin, fetch}`; the clock reuses the existing `now`; `origin` (the public https origin for callback URLs) added, not named in the spec / why: redirect URIs need the `TLS_NAME` origin inside the handler / may affect: none
- planned: no rule for wrong methods on auth routes, or for `createApi` without a session secret / actual: wrong methods on `/auth/*` → 405 with `Allow`; no session secret → every sign-in refused and cookies ignored / why: needed for the injectable handler; consistent with the existing 405 pattern / may affect: none
- planned: `renderPage(data)` gains cancel forms "when a CSRF token is passed in" / actual: optional second parameter `renderPage(data, { csrf })` / why: the spec doesn't fix the signature / may affect: none
- planned: `tailscale cert` "bounded" / actual: bounded at 120 s, run only by the main script, not by the `-ServeOnly` keeper / why: the spec gives no bound; running it once avoids a renewal per keeper restart / may affect: 22-4 runbook §4.5 (tk-studio)
- planned: `bun install --frozen-lockfile` → no change / actual: in-repo it fails `EPERM` linking typescript/js-yaml (sandbox mount); `bun.lock` unchanged; the same lockfile installs frozen with exit 0 in a scratch dir (this session) / why: sandbox file-permission, not a code change / may affect: none
- planned (spec Design Notes): `TK_SUPERVISOR_SESSION_SECRET` required / actual: required by `serve` (`SessionSecretMissing`) and by `start.ps1`'s required list / why: the story says the session secret comes from the environment / may affect: 22-4 (runbook)

Implementer DEVIATION SCORE: 2 (consult 1: implementer reported 1)

Verify (this session): `bun install --frozen-lockfile` EPERM in-repo (sandbox mount), exit 0 on the same lockfile in a scratch dir, `bun.lock` unchanged; `bun test` 591 pass, 3 skip, 0 fail; `bunx tsc --noEmit` exit 0. Matrix audit: every I/O row is covered by a passing test in `test/auth.test.ts` (none skipped).

DRIFT: page test of unauthenticated `GET /` now asserts the 401 sign-in page — AC1 replaces 22.2's 401 JSON on `/` — affects: none
DRIFT: serve-refusal test env and `OPERATOR_HYGIENE_VARS` gain the new variables — the session secret is required at start — affects: none
DRIFT: `ApiDeps` adds `session` and `oauth: {providers, origin, fetch}` — the callback URLs need the public origin in the handler — affects: none
DRIFT: `/auth/*` wrong methods are 405; no session secret refuses every sign-in — the handler needs a defined answer — affects: none
DRIFT: `renderPage(data, { csrf })` optional second parameter — the spec fixed no signature — affects: none
DRIFT: `start.ps1` runs `tailscale cert` once (main script, 120 s bound), not in the keeper — avoids a renewal per keeper restart — affects: 22-4
DRIFT: `bun install --frozen-lockfile` EPERM in-repo — sandbox mount permission; lockfile verified frozen in a scratch dir — affects: none
DRIFT: `TK_SUPERVISOR_SESSION_SECRET` is required by `serve` and `start.ps1` — the story's session secret comes from the environment; 22.3's as-built start now needs it — affects: 22-4

### pass 2 (review patches, 2026-10-07)

Patches: the token form refuses without https and the page notes it; `SessionSecretWeak` (under 32 bytes); `TlsCertUnreadable` checked before binding; README on revocation and cert-renewal placement; the injectable `serve(env, bunServe)` seam to test the TLS branch. Then a README hand-over sentence on the http refusal (score 0).

- planned: "no https" from the server's TLS / actual: decided from `deps.oauth.origin`, so a `createApi` with no `oauth` dep counts as no https and the token form refuses / why: the origin is the handler's only https signal; no existing fixture signs in by form / may affect: none
- planned: the TLS file check before binding / actual: after the OAuth config checks, before the queue opens and any bind / why: keeps the named-error order meaningful / may affect: none
- planned: test "missing or unreadable" files / actual: a missing file and a directory are tested; permission-denied is `unverifiable-here` (the sandbox runs as root) / why: a mode-000 file is readable by root / may affect: none

Implementer DEVIATION SCORE: 1; consult 2 ruled 2 for pass 2 (overall stays 2).

Verify (this session): `bun test` 595 pass, 3 skip, 0 fail; `bunx tsc --noEmit` exit 0; `bun install --frozen-lockfile` still EPERM in-repo (sandbox mount), `bun.lock`/`package.json` unchanged against baseline.

DRIFT: `serve` refuses to start with `SessionSecretWeak` (secret under 32 bytes) and `TlsCertUnreadable` (cert/key file missing or unreadable, checked after the OAuth config checks and before the queue opens and any bind) — review patches for a credential-strength gap and an unnamed start failure — affects: 22-4
DRIFT: the token form refuses without an https origin, and the sign-in page notes that browser sign-in needs https — a Secure cookie never sticks over http — affects: 22-4
DRIFT: "no https" is read from `deps.oauth.origin` — the handler's only https signal — affects: none
DRIFT: permission-denied cert file untested, `unverifiable-here (sandbox runs as root)` — environment limit — affects: none

### pass 3 (follow-up review patches, 2026-10-07)

Implementer score 0: README wording and new tests only, with no change to `src/` or `start.ps1`. The new start.ps1 assertions are in `test/hygiene.test.ts`, beside 22.3's existing start.ps1 text block. That file was outside this story's earlier change set, but there is no story plan and so no Files boundary. In-repo `bun install --frozen-lockfile` still hits EPERM, while `bun.lock` and `package.json` are unchanged and the scratch-dir frozen install exits 0. Consult 1 already ruled this an environment exception, so there is no new consult. `deviation_score` stays 2.

## Consult Log

- 2026-10-07T01:14Z — trigger: deviation-gt-0 — question: accept the pass-1 deviations (session secret required at start; tailscale cert in the main script only; local test/shape changes; in-repo frozen-install EPERM) and at what score? — ruling: accept-deviation score 2 — do: set deviation_score 2; accept the in-repo EPERM as environment-only (rerun once before closing, record if it persists, never change the lockfile); the hand-over and the 22-4 note name both facts (SESSION_SECRET required at start; tailscale cert once in the main script with a 120 s bound, not in the keeper) — rule candidate: A DRIFT whose affects names 22-4 (or any runbook/kb story outside stories.yaml) scores at least 2; an in-repo frozen-install EPERM with an unchanged lockfile, verified frozen in a scratch dir, is an environment exception, not a red gate.
- 2026-10-07T01:25Z — trigger: deviation-gt-0 — question: accept the pass-2 review-patch deviations (no-https from oauth.origin; TLS check order; untested permission-denied) and do the new start errors and http token refusal raise the score above 2? — ruling: accept-deviation score 2 — do: add pass 2 with DRIFT lines (new start errors and http refusal affect 22-4; the rest none); keep deviation_score 2; make the README hand-over name both start errors and the http refusal — rule candidate: A new named start error or a new refusal on a sign-in/operator path is a DRIFT affecting the runbook story and scores 2; a check untestable because the sandbox runs as root is unverifiable-here, not a deviation.


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass on the committed Story 22.5. Story 22.5 lets the operator sign in to the status page from a phone browser with the token form, Google or GitHub. Sign-in sets an HMAC-signed `tk_session` cookie (`HttpOnly; Secure; SameSite=Lax`, 7 days). The cookie authorises the GET routes, and `POST /runs/{id}/cancel` only with the page's CSRF token; it never authorises `POST /jobs`. The bearer header is unchanged. `Bun.serve` serves `https` with the Tailscale certificate on the unchanged bind. This pass fixed the README's auth and revocation text and pinned the `start.ps1` sign-in changes with tests. It made no behaviour change.

**Files changed (this pass).**
- `README.md`: the auth paragraph and the `GET /` row now describe the pre-auth `/auth/*` routes, the sign-in page, and what the cookie can reach. The revocation note now covers rotating the token and removing a provider.
- `test/hygiene.test.ts`: adds `describe("start.ps1 sign-in (Story 22.5 AC4)")`, 4 text-assertion tests. They pin the required session secret, the new exported names, and the single `tailscale cert` step in the main script (120 s bound, warnings only, skipped under `-ServeOnly`).
- Story files from the first run, unchanged in this pass: `src/auth.ts`, `src/api.ts`, `src/env.ts`, `src/page.ts`, `src/server.ts`, `start.ps1`, `test/auth.test.ts`, `test/api.test.ts`, `test/page.test.ts`.

**Review (follow-up pass).**
- Both layers ran: the blind hunter and the edge case hunter.
- 3 patches applied (low 3). Nothing new deferred; the cert-renewal deferral stands. 5 findings rejected; the reasons are in the Review Triage Log.
- Follow-up review recommended: false. Patched counts: high 0, medium 0, low 3. Score 3×0 + 1×3 = 3, which is below 5.

**Verification.**
- `bun test`: 599 pass, 3 skip, 0 fail (602 tests, 13 files).
- `bunx tsc --noEmit`: exit 0.
- Gate step 1: in-repo `bun install --frozen-lockfile` still fails with EPERM (it cannot link js-yaml or typescript on the sandbox mount). `bun.lock` and `package.json` are unchanged against HEAD, and the same lockfile installs frozen with exit 0 in a scratch dir. Consult 1 ruled this an environment exception.

**unverifiable-here** (the operator runs these; unchanged from the first run):
- Enable HTTPS certificates once in the Tailscale admin console.
- Register the Google and GitHub OAuth apps with the callbacks `https://<TLS_NAME>:8787/auth/{google,github}/callback`.
- Set `TK_SUPERVISOR_SESSION_SECRET` (at least 32 bytes), `TK_SUPERVISOR_TLS_{CERT,KEY,NAME}` and `TK_SUPERVISOR_OAUTH_{GOOGLE,GITHUB}_{CLIENT_ID,CLIENT_SECRET,ALLOW}` in the User environment.
- Start `start.ps1` from the console, then open `https://<TLS_NAME>:8787/` on the phone and sign in each way. Cancel a run from the page.
- `pwsh` parsing of `start.ps1`.
- A permission-denied certificate file (the sandbox runs as root).
- Real `Bun.serve` TLS and the real provider endpoints.

**Residual risks.**
- The certificate is renewed only when `start.ps1` starts (deferred).
- After a cancel from the page, the phone shows the JSON answer.
- There is no sign-out. Only the session expiry or rotating the session secret ends a session; changing the token, an allow entry or a provider does not.
- GitHub sign-in matches the login, which can be renamed, as AC2 fixes.
- Upgrading needs `TK_SUPERVISOR_SESSION_SECRET` set.

DRIFT: `ApiDeps` adds `session` and `oauth: {providers, origin, fetch}` — the callback URLs need the public origin in the handler — affects: none
DRIFT: page test of unauthenticated `GET /` now asserts the 401 sign-in page — AC1 replaces 22.2's 401 JSON on `/` — affects: none
DRIFT: serve-refusal test env and `OPERATOR_HYGIENE_VARS` gain the new variables — the session secret is required at start — affects: none
DRIFT: `/auth/*` wrong methods are 405; no session secret refuses every sign-in — the handler needs a defined answer — affects: none
DRIFT: `renderPage(data, { csrf })` optional second parameter — the spec fixed no signature — affects: none
DRIFT: `start.ps1` runs `tailscale cert` once (main script, 120 s bound), not in the keeper — avoids a renewal per keeper restart — affects: 22-4
DRIFT: `bun install --frozen-lockfile` EPERM in-repo — sandbox mount permission; lockfile verified frozen in a scratch dir — affects: none
DRIFT: `TK_SUPERVISOR_SESSION_SECRET` is required by `serve` and `start.ps1` — the story's session secret comes from the environment; 22.3's as-built start now needs it — affects: 22-4
DRIFT: `serve` refuses to start with `SessionSecretWeak` and `TlsCertUnreadable` — review patches for a credential-strength gap and an unnamed start failure — affects: 22-4
DRIFT: the token form refuses without an https origin, and the sign-in page notes it — a Secure cookie never sticks over http — affects: 22-4
DRIFT: "no https" is read from `deps.oauth.origin` — the handler's only https signal — affects: none
DRIFT: permission-denied cert file untested, unverifiable-here (sandbox runs as root) — environment limit — affects: none

## Reconcile

### 2026-10-07 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT that names later work names 22-4, the runbook story built in tk-studio kb (no entry in this manifest). The epic narrative already has runbook §4.5 follow 22.5 there. 22-4's criteria still hold, because they ask for the supervisor as built. What changed is that as-built set: a required `TK_SUPERVISOR_SESSION_SECRET`, the TLS and OAuth variables, `tailscale cert` run once in `start.ps1`'s main script, the new named start errors, the token form refusing over http, and an https smoke once TLS is on. Every other DRIFT says `affects: none`. The bind and the bearer behaviour are unchanged, credentials come only from the environment (AD-3, AD-15), and operator-decisions §7 is kept (HTTPS terminates in `Bun.serve`, which the decision left to the story). No AD, driver contract or ruling is contradicted.
- Affected: 22-4 (runbook) — "it names … the environment variables (bind address, token, database path, notification target), `start.ps1`, … and the smoke test from another device; … §8 gains a row for each supervisor failure mode met while building it" (still holds; the variables, start order, failure modes and smoke it must describe changed)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted; epic complete: no next story (22-4 is built in tk-studio kb; its two replan-queue entries stay open)
