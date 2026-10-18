---
title: "The Owner's Account Replaces the Providers"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_revision: 'b75eb2a3ce4e8479111f43c2cdcd7905b8451a69'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-29/plans/29-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-29/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The supervisor's phone sign-in (Story 22.5) depends on Google and GitHub as external identity providers. D7 and D8 (design spec §8, §9) rule one owner account (username and password), no external provider and no API-key tier.

**Approach:** Replace the provider sign-in with an account created on the first visit and a rate-limited username/password sign-in with a lockout. Delete the provider code and variables outright. Make the README and runbook describe the account and its reset. The bearer header, the token form and the session cookie are unchanged.

### Acceptance criteria (verbatim, epics.md Story 29.1, ST-104)

AC1. **Given** a supervisor with no account yet **When** a browser opens `GET /` with no session **Then** the sign-in page offers account creation instead of sign-in: a username (3 to 64 characters, letters, digits, `-`, `_`, `.`) and a password (12 characters or more, checked for length only); `POST /auth/account` creates the account once (a second creation is 409 `AccountExists`), hashes the password with `Bun.password` (argon2id, the default cost), stores the record (`username`, the hash, `created_at`) in the per-user store under the supervisor's own folder (`<TK_STUDIO_HOME or ~/.tk-studio>/supervisor/account.json`, never in a checkout, never in the queue file; AD-3), answers with the session cookie, and records a `service_events` row `account-created {username}`; the page then states the intended usage in one paragraph: the studio is operated by the person whose Claude subscription is signed in on this box, from their own seat, with no token intermediated and no API-key tier (spec §8), and `apps/supervisor/README.md` carries the same paragraph

AC2. **Given** the account exists **When** `POST /auth/signin` receives the username and password **Then** a match (constant-time, `Bun.password.verify`) answers the session cookie Story 22.5 defined (unchanged shape and lifetime); a mismatch answers 401 `SignInRefused` after a fixed delay, and five failures within fifteen minutes lock the account for fifteen minutes (423 `AccountLocked`, the lockout and every refusal recorded as `service_events` rows naming the username and never the password); the bearer header still authorises everything, and `POST /auth/token` (the token sign-in) stays for the operator's own browser; `bun test` pins creation, sign-in, the lockout window and that no answer, event or log line carries a password or a hash

AC3. **Given** the Google and GitHub providers **When** the story closes **Then** the routes `GET /auth/{google,github}` and their callbacks, the `TK_SUPERVISOR_OAUTH_*` variables, `OAuthNeedsHttps` and the provider code in `apps/supervisor/src/auth.ts` are deleted (not disabled); a set `TK_SUPERVISOR_OAUTH_*` variable is ignored with one start-time warning naming it; the README's environment table and runbook §4.5 drop the OAuth walk-through and describe the account; `bun test` pins that the removed routes answer 404 and that the worker environment still strips every `TK_SUPERVISOR_*` secret (DW-17)

AC4. **Given** the operator locked out or the password lost **When** they need back in **Then** the documented reset is deleting `account.json` from the console (the next visit creates the account again) and the bearer token keeps working throughout; the runbook §4.5 names it

## Boundaries & Constraints

**Always:**
- SPEC assumptions, which are planner calls and not deviations:
  - The mismatch delay is `SIGNIN_DELAY_MS = 500`, injectable.
  - The lockout window is derived from `service_events` rows (`signin-refused`, `account-locked`) over the last 15 minutes. `account.json` stays exactly `{username, hash, created_at}`.
  - A form body answers HTML (the page at the named status; success is `303 → /` with the cookie). A JSON body answers `{ok:false, error:<Name>}`, or `{ok:true, username}` with the cookie.
  - An account session's cookie `sub` is `account:<username>`.
- The sign-in page stays server-rendered HTML with no script.
- A cookie still never authorises `POST /jobs`.
- `account.json` is read per request, so the reset works without a restart.
- Writes are atomic: a temp file, then `renameSync`.
- No answer, event, log line, page or worker environment carries a password, a hash, the session secret or the bearer token.
- An unknown username costs one argon2 verify, against a module-level dummy hash.
- The start-time warning names the variable, never its value.

**Block If (consult first, never do):**
- An AC can only be met by persisting lockout state in `account.json`, or by a new environment variable that holds a secret.
- An AC appears to need client-side script.
- The Files list must grow beyond this spec's Code Map. The registry and the projection belong to stories 29.2 and 29.3.

**Never:**
- Touch `tools/installer/cli/tk_studio_cli/doctor.py`, the plugin, `.tk-studio/` or the driver contract. Those changes belong to Story 29.4.
- Disable rather than delete the provider code.
- Push, tag or release.
- Install bun globally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| First visit | no account, `GET /` no auth | 401 HTML; creation form (`action="/auth/account"`), no sign-in form; `INTENDED_USAGE` paragraph | — |
| Create | valid pair, https origin, secret set | 303 → `/`, `tk_session` with Story 22.5 attributes (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`); `account.json` keys `username`,`hash`(`$argon2id$`),`created_at`; one `account-created {username}` | — |
| Bad input | username 2/65 chars, space or `@`; password 11 chars | 400 `AccountInvalid` naming the field, never the value; nothing written | — |
| Re-create | account exists | 409 `AccountExists`, record bytes unchanged, no cookie | — |
| No https / no secret | creation or sign-in | refused as the token form refuses; no cookie; https note | — |
| Sign in | right pair | 303 with cookie; cookie reads `GET /status` | — |
| Mismatch / unknown user | wrong password or username | sleep(`SIGNIN_DELAY_MS`), 401 `SignInRefused`, one `signin-refused {username, reason}` row (no password, no hash) | — |
| Lockout | 5 failures within 15 min | 5th answers 423 `AccountLocked`, one `account-locked {username, until}` row; right pair while locked → 423, no cookie; 15 min later right pair signs in; window slides; failures before an expired lock do not count again | — |
| Removed routes | bearer `GET /auth/{google,github}[/callback]` | 404 `NotFound`; without auth 401 JSON | — |
| Leftover var | `TK_SUPERVISOR_OAUTH_GITHUB_ALLOW` set at `serve` | starts; one `console.warn` naming it | — |
| Reset | delete `account.json` | `GET /` offers creation again; bearer `GET /status` works throughout | — |

</intent-contract>

## Code Map

The full investigation is the plan's Code Map: `_bmad-output/specs/spec-epic-29/plans/29-1.md` § Code Map. The implementer reads it first. Anchors were re-verified on 2026-10-18 against `b75eb2a`:
- `auth.ts` is 181 lines.
- `api.ts`: the oauth deps are at 105-108, the `https` check at 347, `oauthStart`/`oauthCallback` at 368-385, the `PROVIDERS` loop at 394-396, and `serve` at 480-497.
- `env.ts`: `OAuthConfigIncomplete`/`OAuthAllowInvalid`/`OAuthNeedsHttps` at 162-181, `oauthConfig` at 228, `studioHome` at 43.
- `server.ts:537` `buildWorkerEnv`.
- `queue.ts:1957` `serviceEvent`, `:1963` `serviceEvents`.

Files (boundary):
- `apps/supervisor/src/account.ts` (new): the record, validation, hash and verify (with a dummy hash), the lockout from `service_events`. Exports `LOCKOUT_FAILURES`, `LOCKOUT_WINDOW_MS`, `LOCKOUT_MS`, `SIGNIN_DELAY_MS`, `accountPath`, `readAccount` (`AccountRecordInvalid` on a malformed file, never read as "no account"), `createAccount`, `verifyPassword`, `lockState`.
- `apps/supervisor/src/auth.ts`:
  - Delete the provider code: `STATE_*`, `ProviderName`, `PROVIDERS`, `FetchLike`, `ENDPOINTS`, `newState`, `signState`/`verifyState`, `authorizeUrl`, `oauthIdentity`, `allowed`.
  - Rewrite `signInPage({mode:"create"|"signin", ...})`.
  - Export `INTENDED_USAGE`, `USERNAME_RE`, `PASSWORD_MIN`.
- `apps/supervisor/src/api.ts`:
  - Replace `oauth` with `origin?` and `account?: {path?, delayMs?, sleep?}`.
  - Delete the provider routes.
  - Add `POST /auth/account` and `POST /auth/signin`, both answering before auth, and `405 Allow: POST` on any other method.
  - `serve`: warn once per leftover `TK_SUPERVISOR_OAUTH_*` name, before `Bun.serve`.
- `apps/supervisor/src/env.ts`: delete the OAuth classes, types and `oauthConfig`. Add `oauthLeftovers(env): string[]`. Update the header comment.
- `apps/supervisor/src/server.ts`: `buildWorkerEnv` gains the pattern strip `/^TK_SUPERVISOR_.*(?:TOKEN|SECRET|PASSWORD)/i` plus `TK_SUPERVISOR_NTFY_URL`. Update its comment. Nothing else in the file changes.
- `apps/supervisor/start.ps1`: drop the six OAuth names from `$Names`. Nothing else changes.
- `tools/agent-pc/set-supervisor-env.ps1`: replace the Google/GitHub hint block (around 153-163) with the line "first visit creates the account".
- `apps/supervisor/test/auth.test.ts`: delete the OAuth tests and adapt the fixture (`origin`, an injected `sleep`). Plan lines: 173-204, 293-383, 500-595, 612-621.
- `apps/supervisor/test/account.test.ts` (new): the cases of the I/O matrix plus the plan's Verify list. Includes the console-capture guard and the README paragraph equality.
- `apps/supervisor/README.md`:
  - Update the auth paragraph (around line 44) and the sign-in section (57-72).
  - Add `INTENDED_USAGE` verbatim.
  - Delete the env-table OAuth rows (134-135) and add one sentence on the ignored-variable warning.
- `kb/agent-pc-setup-runbook.md`: in §4.2, drop the OAuth rows (around 1002-1003). In §4.5 (1100-1131), the account paragraph replaces the OAuth walk-through, and the reset (delete `account.json`, the bearer keeps working) replaces step 2.
- `apps/supervisor/test/hygiene.test.ts` (outside the plan's Files; see Design Notes): lines 706-708 assert that `start.ps1` `$Names` contains the six OAuth names. Drop those names from that assertion only.

Read-only, left as they are:
- `test/api.test.ts:22-29` clears the OAuth vars for the suite, which is harmless and keeps a leftover from warning.
- `test/page.test.ts:338` uses the OAuth secret names as generic redaction samples.
- `plugins/tk-studio/lib/tests/test_installer_apps.py:1170`, the installer's env passthrough.
- `src/page.ts:298` `redactCredentials`.
- `IS_ERROR_AUTH_RE` in `server.ts:47`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/account.ts`: create it as the Code Map describes. It holds the AC1/AC2 record and lockout rule without HTTP.
- `apps/supervisor/src/auth.ts`: delete the provider code, then rewrite the page with its two modes, `INTENDED_USAGE` and the validators. Covers AC1 and AC3.
- `apps/supervisor/src/env.ts`: delete `OAuth*` and `oauthConfig`, and add `oauthLeftovers`. Covers AC3.
- `apps/supervisor/src/api.ts`: add the routes, the modes, the delay and the lockout; delete the providers; add the start warning. Covers AC1-AC4.
- `apps/supervisor/src/server.ts`: add the pattern strip in `buildWorkerEnv`. Covers DW-17 in AC3.
- `apps/supervisor/start.ps1` and `tools/agent-pc/set-supervisor-env.ps1`: drop the OAuth names and hints. Covers AC3.
- `apps/supervisor/test/auth.test.ts`, `apps/supervisor/test/account.test.ts` and `apps/supervisor/test/hygiene.test.ts`: delete the OAuth tests, add the matrix tests, and fix the `$Names` assertion. These pin AC1-AC4.
- `apps/supervisor/README.md` and `kb/agent-pc-setup-runbook.md`: describe the account, add the paragraph, document the reset and drop the OAuth rows. Covers AC1, AC3 and AC4.

**Acceptance Criteria:** AC1-AC4 above, verbatim. The I/O matrix rows are each pinned by a `bun test` case. In addition:
- **Given** the tree after the change, **when** grepping `apps/supervisor/src` for `OAUTH|oauthConfig|OAuthNeedsHttps|PROVIDERS|oauthIdentity|authorizeUrl`, **then** the only match is `oauthLeftovers` and its use in the warning.

## Spec Change Log

## Review Triage Log

### 2026-10-18 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 4, low 2)
- defer: 0
- reject: 1 (low 1): first-visit-wins account creation, which AC1 mandates (the first visit creates the account)
- addressed_findings:
  - `[medium]` `[patch]` Concurrent `POST /auth/account` could overwrite (`renameSync`). Placement is now exclusive with `linkSync`, EEXIST answers `AccountExists`, and a parallel test pins `[303, 409]`.
  - `[medium]` `[patch]` Parallel guesses got past the lockout. Sign-in attempts are serialised per `createApi`, and a test with 8 concurrent wrong guesses gets at most 5 401s and one lock.
  - `[medium]` `[patch]` The AC4 reset did not clear a lock for the same username. `lockState` now ignores rows before the latest `account-created` for that username, and the same-username reset is tested.
  - `[medium]` `[patch]` A malformed `account.json` crashed the page and the routes. It now answers the named refusal `AccountRecordInvalid` (500, store-relative path), and the bearer routes keep working.
  - `[low]` `[patch]` Refusal rows stored an unauthenticated username verbatim. A username that fails the pattern is now truncated to 64 characters and treated as unknown.
  - `[low]` `[patch]` The README's claim that the lockout survives a restart had no test. One now builds a second `createApi` over the same queue, which answers 423.

### 2026-10-18 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 0, low 4)
- defer: 0
- reject: 7 (low 7)
  - first-visit-wins creation and no Origin check on `POST /auth/account`: AC1 mandates that the first visit creates the account; same ruling as the first pass
  - the serialised sign-in chain, the growing `service_events`, and no maximum password length: serialisation was the first pass's lockout patch; rows are bounded to 64 characters (a recorded residual risk); AC1 checks the password for minimum length only
  - the leftover-variable warning is missed when `start.ps1` no longer imports the OAuth names: User-scope variables are inherited at logon, so only a variable set after logon misses the warning; the runbook now tells the operator to delete them; `start.ps1` is `unverifiable-here`
  - no test that an unknown username costs one argon2 verify: a SPEC constraint, not named by an AC or a contract (project rule on assertion gaps)
  - no `service_events` row for a sign-in refused for no https or no secret: no credential is evaluated; recording these would let configuration probes count toward a lockout
  - a password typed into the username field lands in the `signin-refused` row: the intent contract's matrix row "Mismatch / unknown user" pins the given username in the row
- addressed_findings:
  - `[low]` `[patch]` Validly signed cookies from the deleted providers (`sub` `google:…`/`github:…`) still authorised for up to 7 days. A cookie session now authorises only for `sub` `token` or `account:*` (`sessionSubAccepted`, auth.ts:64-69, applied at api.ts:517-518). auth.test.ts:193-211 pins this, and the two `github:` fixtures became `account:`.
  - `[low]` `[patch]` The password minimum counted UTF-16 code units, so 6 emoji passed the 12-character rule. It now counts code points (account.ts:89). account.test.ts:215-227 pins 11 emoji as refused and 12 as accepted.
  - `[low]` `[patch]` Nothing told the operator to remove the old OAuth setup. Runbook §4.5 (1120-1124) now says to delete the leftover `TK_SUPERVISOR_OAUTH_*` User variables and the Google/GitHub OAuth apps, names only. The troubleshooting row (1333) drops the deleted `OAuth*` start errors.
  - `[low]` `[patch]` The parallel-lockout test asserted only upper bounds. account.test.ts:432-445 now asserts exactly 4×401, 4×423, 5 delays, 1 `account-locked` row, 5 `mismatch` rows and 3 `locked` rows, and that the right password is refused 423 afterwards.

## Design Notes

- Baseline at `b75eb2a`, before any change: `bun test` gives 772 pass, 6 fail, 71 skip. The 6 failures are pre-existing and unrelated to this story. They are in `test/closeout.test.ts`/`sandbox.test.ts` (`fakeStudioRoot`, the `sbx stop` release cases). `tsc --noEmit` is clean. The gate is "no new failures beyond those 6", plus tsc clean.
- bun lives at `~/.bun/bin`; prepend it to `PATH`. `bun install --frozen-lockfile` has already populated `node_modules`. Run tsc as `bun node_modules/typescript/bin/tsc --noEmit`, because `bunx` rewrote nothing but is slower.
- The removed routes answer 404 through the existing unknown-path rule (`api.ts` `fail(404,"NotFound")` once authorised). No special route is needed.

## Deviation Summary

- DRIFT: `apps/supervisor/test/hygiene.test.ts:706-708` drops the six OAuth names from the asserted `$Names` list. The test pinned the variables AC3 deletes, and the file is outside the plan's § Files. Score 1, accepted by consult. Affects: none.

### pass 1 (2026-10-18, implementer)

- planned: the `create` page shows only the account-creation form / actual: it also keeps the token form (`POST /auth/token`), still with no `/auth/signin` form / why: `test/page.test.ts:143` (read-only) expects the token form on the page with no auth; the matrix excludes only a sign-in form, and AC2 keeps the token sign-in / may affect: 29-4
- planned: `verifyPassword(record, password)`; `readAccount(env)`; `createAccount(env, username, password, nowIso)` / actual: `verifyPassword(record, username, password)`; an optional trailing `path` on read and create; extra exports (`checkAccountFields`, the error classes, `SignInMode`) / why: the dummy-hash rule needs the username, and the `account.path` dep needs the path / may affect: none
- planned: the lockout counts refusals "later than the latest lock's `at`" / actual: it counts refusals whose seq is after the latest lock and skips `reason: "locked"` rows / why: the fifth failure and its lock share one timestamp, and refusals made while locked must not count again after expiry / may affect: 29-3
- planned: JSON answers only for the named refusals / actual: unparseable JSON answers `400 MalformedJson`; a JSON body with no https or no secret answers `401 SignInRefused` / why: these cases had no shape, so the API's existing pattern applies / may affect: 29-4
- planned: README changes at line 44, lines 57-72 and the env table / actual: the OAuth start errors are also cut from the serve refusal list (line 42), and a worker-strip sentence follows the table / why: those errors no longer exist / may affect: 29-4
- planned: `SECRETS` in auth.test's console guard gains the password / actual: the password and hash guard lives in `account.test.ts` / why: auth.test no longer creates an account / may affect: none
- DEVIATION SCORE: 1 (consult-accepted at score 1)
- HAND-OFF to 29-4: the account routes also answer `400 MalformedJson` and `401 SignInRefused` (a JSON body with no https or no secret), and the create page keeps the token form. Document them as they are, with no new names.
- DRIFT: the create page keeps the token form — page.test.ts:143 (read-only) pins it and AC2 keeps the token sign-in — affects: 29-4
- DRIFT: account.ts signatures differ from the plan (username passed to verify; optional path) — dummy-hash rule and the path dep — affects: none
- DRIFT: lockout window bounded by seq after the latest lock, `locked` refusals excluded — same-timestamp lock and no recount after expiry — affects: 29-3
- DRIFT: JSON `400 MalformedJson` and `401 SignInRefused` without https/secret — shapes the spec left open, following the API's pattern — affects: 29-4
- DRIFT: README serve refusal list and worker-strip sentence also updated — the OAuth errors are deleted — affects: 29-4
- DRIFT: the password/hash console guard lives in account.test.ts — auth.test creates no account — affects: none

### pass 2 (2026-10-18, review patches)

- planned: the 500 error line comes from `signInPage` / actual: `api.ts` inserts it after the `<h1>` of the signin-mode page / why: the patch scope was account.ts, api.ts and the test / may affect: none
- planned: none / actual: `createAccountRoute` reads the record first, so a malformed file answers `AccountRecordInvalid` rather than 409 / why: name a corrupt record instead of treating it as existing / may affect: none
- planned: none / actual: a username that fails `USERNAME_RE` is verified as unknown (dummy hash) / why: a truncated name never matches the owner / may affect: none
- SPEC assumption (consult): a malformed `account.json` answers 500 `AccountRecordInvalid` with the store-relative path. The story gives that case no status.
- DEVIATION SCORE: 1 (consult-accepted)
- DRIFT: the `AccountRecordInvalid` page line is inserted by api.ts — patch scope — affects: none
- DRIFT: creation reads the record first — a corrupt file is named, never "exists" — affects: none
- DRIFT: a pattern-failing username is verified as unknown — no truncated match — affects: none

### pass 3 (2026-10-18, follow-up review patches)

- planned: the cookie-sub rule in the cookie gate / actual: a new exported predicate `sessionSubAccepted` in `auth.ts`, called after an unchanged `verifySession` / why: an existing test pins what `verifySession` returns as valid, and this keeps the rule in one function / may affect: none
- DEVIATION SCORE: 1 (consult-accepted)
- DRIFT: provider-sub rejection lives in `sessionSubAccepted`, called after `verifySession` — local helper inside Files — score 1, accepted by consult — affects: none

## Verification

**Commands:**
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun test`: expected to show no failures beyond the 6 baseline ones, with `account.test.ts` green.
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun node_modules/typescript/bin/tsc --noEmit`: expected exit 0.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: expected green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run`: expected `ok: true`.

**Manual checks:**
- The PowerShell files cannot run on this host because `pwsh` is absent, so they are `unverifiable-here`. The operator runs `start.ps1` once from the console on the agent PC and watches for the variable names.

## Consult Log

- 2026-10-18T01:14:14Z — trigger: file-outside-files — question: may hygiene.test.ts:706-708 drop the OAuth names that start.ps1 loses under AC3? — ruling: accept-deviation score 1 — do: change only the asserted list in the hygiene test (keep SESSION_SECRET and the TLS names); record one DRIFT line; leave api.test.ts:22-29, page.test.ts:338 and test_installer_apps.py:1170 untouched — rule candidate: when a plan deletes a variable, route or symbol, the planner greps the tests for it and lists each pinning test under § Files
- 2026-10-18T01:29:12Z — trigger: deviation-gt-0 — question: accept pass-1 deviations (create page keeps the token form; seq-bounded lockout; JSON MalformedJson/SignInRefused; verify signature; README serve list)? — ruling: accept-deviation score 1 — do: keep all six entries; record them consult-accepted; add a 29-4 hand-off note on the extra JSON answers and the token form — rule candidate: pre-accept at score 1 a deviation that reuses an existing api.ts error name, or keeps a surface an earlier pinned test asserts when an AC preserves it
- 2026-10-18T01:40:18Z — trigger: deviation-gt-0 — question: accept the patch-pass deviations (api.ts-inserted error line; read before create; pattern-failing username treated as unknown) and AccountRecordInvalid on HTTP? — ruling: accept-deviation score 1 — do: accept (a)-(c); keep AccountRecordInvalid 500 with the store-relative path; record the 500 as a SPEC assumption — rule candidate: a named store-record refusal with no specified status answers 500 under its own name, checked before any exists/absent branch

- 2026-10-18T01:49:20Z — trigger: deviation-gt-0 — question: accept the follow-up patch's new exported `sessionSubAccepted` helper (auth.ts:64-69, called at api.ts:517-518 after an unchanged `verifySession`) at score 1? — ruling: accept-deviation score 1 — do: keep `sessionSubAccepted` and its single call; leave `verifySession` and `signSession` unchanged; record one DRIFT line — rule candidate: when a review finding narrows what an existing validator accepts and a test pins its return value, pre-accept at score 1 a separate predicate in the same Files-listed module, applied at the single call site and covered by its own test

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (all effort medium, advisor off); knowledge spine absent

**Summary:** A follow-up review pass over story 29-1, which was implemented in b47d09d: the owner's single account (created on the first visit, argon2id via `Bun.password`, `<store>/supervisor/account.json`) replaces the Google and GitHub sign-in, with a rate-limited `POST /auth/signin` and a 15-minute lockout derived from `service_events`. The provider code, routes and variables are deleted, a leftover `TK_SUPERVISOR_OAUTH_*` variable gets one start-time warning, the worker environment strips every `TK_SUPERVISOR_*` secret by pattern, and the README and runbook describe the account and its reset. This pass applied four low-severity patches:
- Cookie sessions from the deleted providers no longer authorise.
- The password minimum counts characters (code points), not UTF-16 code units.
- The runbook tells the operator to remove the old OAuth variables and apps.
- The parallel-lockout test asserts exact counts.

**Files changed (this pass):**
- `apps/supervisor/src/auth.ts`: new `sessionSubAccepted(sub)`, which accepts only `token` or `account:*`.
- `apps/supervisor/src/api.ts`: the cookie gate also requires `sessionSubAccepted`.
- `apps/supervisor/src/account.ts`: the password length counts code points.
- `apps/supervisor/test/auth.test.ts`: the `github:` fixtures became `account:`; a new test shows provider-sub cookies are refused.
- `apps/supervisor/test/account.test.ts`: a new emoji-length test; the parallel-lockout test asserts exact counts.
- `kb/agent-pc-setup-runbook.md`: §4.5 adds the removal of the leftover OAuth variables and apps; the troubleshooting row drops the deleted `OAuth*` errors.

The full story file list is in b47d09d and in the first pass's summary (git history).

**Review:**
- 4 patches applied (high 0, medium 0, low 4), 0 deferred, 7 rejected (reasons in the Review Triage Log).
- Follow-up review recommended: false. Patched high 0, medium 0, low 4; score 3×0+4 = 4 < 5.

**Verification** (run by this session after the patches):
- `bun test` (apps/supervisor): 790 pass, 6 fail, 71 skip. The 6 failures are the baseline ones (the closeout `fakeStudioRoot` setup and the five `sbx stop` release cases), with none new.
- `bun node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `uv run python -m unittest discover tests`: OK (1365 tests, 1 skipped).
- conformance `runner.py run`: `ok: true`.
- The leftover grep in src finds only `oauthLeftovers` (env.ts:203-205).

**Unverifiable here:**
- `apps/supervisor/start.ps1` and `tools/agent-pc/set-supervisor-env.ps1`: no `pwsh` on this host. The operator runs `start.ps1` once from the console on the agent PC and watches for the variable names.

**Residual risks:**
- The runbook troubleshooting row about the status page on phone browsers (around line 1331) still says the page signs in with "token form, Google, GitHub". It is left for Story 29.4 (CAP-12), as the first pass recorded.
- Every unauthenticated refusal writes one `service_events` row, bounded to 64 characters. The table is never pruned.
- A leftover `TK_SUPERVISOR_OAUTH_*` variable set after logon is not imported by `start.ps1`, so `serve` does not warn about it. The runbook now tells the operator to delete these variables.

**Deviations** (deviation_score 1, every one consult-accepted):
- DRIFT: hygiene.test.ts:706-708 drops the six OAuth names — it pinned the variables AC3 deletes — affects: none
- DRIFT: the create page keeps the token form — page.test.ts:143 pins it and AC2 keeps the token sign-in — affects: 29-4
- DRIFT: account.ts signatures differ from the plan (verify takes the username; optional path) — dummy-hash rule and the path dep — affects: none
- DRIFT: lockout bounded by seq after the latest lock and the latest account-created, `locked` refusals excluded — same-timestamp lock, no recount, reset clears the lock — affects: 29-3
- DRIFT: JSON `400 MalformedJson`, `401 SignInRefused` without https/secret, `500 AccountRecordInvalid` — shapes the spec left open — affects: 29-4
- DRIFT: README serve refusal list and worker-strip sentence also updated — the OAuth errors are deleted — affects: 29-4
- DRIFT: the password/hash console guard lives in account.test.ts — auth.test creates no account — affects: none
- DRIFT: the `AccountRecordInvalid` page line is inserted by api.ts; creation reads the record first; a pattern-failing username is verified as unknown — review patch scope — affects: none
- DRIFT: provider-sub rejection lives in `sessionSubAccepted`, called after `verifySession` — local helper inside Files — score 1, accepted by consult — affects: none

## Reconcile

- 2026-10-18 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 29-2-the-agent-registry
