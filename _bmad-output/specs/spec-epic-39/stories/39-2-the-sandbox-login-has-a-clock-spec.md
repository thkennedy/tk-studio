---
title: 'Story 39.2: The Sandbox Login Has a Clock'
type: 'feature'
created: '2026-11-09'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'ebfaa29444ab52b70043df3e02a05ea0a3d7bb12'
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-39/plans/39-2.md'
  - '{project-root}/_bmad-output/specs/spec-epic-39/SPEC.md'
warnings: ['oversized', 'multiple-goals']
deferred: []
---

> **The serve process: yes.** `api.ts`, `sandbox.ts`, `queue.ts`, `hygiene.ts` and `cli.ts` run inside `serve` (and `drain`). The operator stops the supervisor tab before the loop builds `apps/supervisor` and restarts it through the scheduled task after the merge. `apps/studio-web` is rebuilt by the host leg's `bun run verify`.

<intent-contract>

## Intent

**Problem:** The sandbox's Claude login is the one monthly chore that blocks every sandbox run. It fails silently (hole 69's only signal is a console claim refusal), and renewing it is a terminal exchange inside the sandbox (`sbx run`, `/login`, `/exit`; TKSTUDIO-233).

**Approach:** Give the login a clock (`GET /sandbox/login`), a renewal driven from the page (`POST /sandbox/login/start` and `/code` driving `claude auth login --claudeai` in a detached tmux session inside the sandbox, under a ten-minute `sandbox-login` lease the claim gate honours), a Settings card, and a `tk-studio-owner` Jira Task three days out. The contract grows additively at 0.1.35. The plan's **Settled shape §1–§12** (`plans/39-2.md`) is the binding design for every name, code, argv and string below.

**Story (authoritative, epics.md "### Story 39.2"):** As the owner, I want to see how long the sandbox's Claude login stays valid and to renew it from the page by opening the sign-in and pasting the code, so that the one monthly chore that blocks every sandbox run is thirty seconds from any device, never a terminal, and never fails silently again.

**AC1 (verbatim).** **Given** the Max-login preflight (`server.ts` `judgeAuthStatus`/`maxLoginPreflight`: `sbx exec <sb> env -u ANTHROPIC_API_KEY claude auth status --json`, judged `claude.ai` only — ruling 3, unchanged here) and the sandbox's credential file (`/home/agent/.claude/.credentials.json`, whose `claudeAiOauth.expiresAt` and `refreshTokenExpiresAt` the sbx proxy leaves readable while it holds the tokens themselves) **When** Story 39.2 lands **Then** `GET /sandbox/login?sandbox=<name>` (cookie or bearer; the sandbox defaults to the project's placement in `TK_SUPERVISOR_CONFIG`) runs the same probe and one `sbx exec <sb> cat` of the file, and answers `{sandbox, logged_in, auth_method, subscription_type, access_expires_at, refresh_expires_at, days_left, state, checked_at}` with `state` one of `ok`, `expiring` (three days or fewer), `expired`, `unknown` (the probe or the read failed, with `reason`); it never answers a token or any field but those; a sandbox neither pinned nor running answers `unknown` with `reason: "sandbox stopped"` and starts nothing; `api.test.ts` pins each state with a fake probe and a fake file.

**AC2 (verbatim).** **Given** the hand login exchange (runbook hole-69 row), tmux inside the sandbox and the host-verify-leg lease **When** the owner presses Renew **Then** `POST /sandbox/login/start {sandbox}` (cookie + CSRF, or bearer) is refused by name while the sandbox is pinned by a run (`LoginWhileLive`, naming the run; the card says so and when it ends) or while a login is in progress (`LoginInProgress`); otherwise it notes a `sandbox-login` lease (`{owner, by: "owner", login_id}`; the claim gate treats it as it treats the host-verify-leg lease: no sbx worker is claimed on that sandbox until it closes, and a lease older than ten minutes is closed `expired` by the next drain pass), starts `claude auth login` in a detached tmux session named for the login (`sbx exec <sb> tmux new-session -d -s tk-login-<id> …`), reads the pane (`tmux capture-pane -p`) until the `https://claude.ai/oauth/authorize?…` URL appears (a bounded wait; a timeout kills the session and answers `LoginStartFailed` with the pane's last line) and answers `{login_id, url, started_at, expires_at}`; the URL carries only the PKCE challenge and the state and is never written to an event; `POST /sandbox/login/code {login_id, code}` hands the code to the waiting login through tmux's buffer (`load-buffer -` from stdin, then `paste-buffer` and Enter; the code never travels on an argument), waits for the login to end, kills the tmux session, closes the lease, records the service event `sandbox-login {login_id, result, by: owner, started_at, ended_at}` (no URL, no code), re-runs the status probe and answers it; a refused code answers `CodeRefused` with the pane's last line and keeps the login open for one more try; a code after the ten minutes answers `LoginExpired`; `sandbox.test.ts` covers the start, the code hand-off, the refusals and the lease with the fake sbx of Story 36.5's tests, and the contract names the three routes, the lease and the event (0.1.35, additive). Nothing about the Max-login preflight's rule changes.

**AC3 (verbatim).** **Given** the Settings screen (`apps/studio-web/src/settings/*`, new; 39.1's route table renders a named placeholder at `/app/settings`) **When** `/app/settings` is opened **Then** it shows the Sandbox login card first: "Checking the login…" while reading; "Login valid for N days (until <date and time, local>)" when `ok`; amber "Renew soon: N days left" when `expiring`; red "Expired: every run on the sandbox waits for a renewal" when `expired`; the reason in words when `unknown`; a Renew button that, pressed, shows the "Open sign-in" link (a new tab), the code field labelled "Paste the code claude.ai shows after you approve", a Send button and the result line ("Renewed: valid until <date>", or the refusal in words); the button is disabled with its reason while a run holds the sandbox or a login is in progress elsewhere; the card polls the status every minute while open and once more after a renewal; `src/settings/login.test.ts` pins the states, the disabled reasons and the two-step flow; `apps/studio-web/README.md` records the card.

**AC4 (verbatim).** **Given** the notice path (`hygiene.ts`; `track.py`'s Jira form; the owner's rule that anything he must do is a Task assigned to him) **When** the tick's pass finds the login `expiring` or `expired` and no open Task of its own for that `refresh_expires_at` **Then** it mints one `tk-studio-owner` Task ("Renew the sandbox's Claude login before <date>") carrying the card's absolute URL (39.1's rule) and the two steps, assigned to the owner and `Blocked - Awaiting User`, keyed by the expiry so it is minted once per login and moved to `Done` by the pass that sees the renewal; hole 69's console-only block keeps its line but is no longer the first signal; the runbook's hole-69 row reads fixed with the card's route; TKSTUDIO-233's renewal is recorded as the last manual one.

## Boundaries & Constraints

**Always:**
- Every sbx call is argv only (never `sh -c`, `bash`, `-lc`); the code reaches tmux only via `sbx exec -i <sb> tmux load-buffer -b <S> -` stdin (`SandboxDeps.run` gains optional `input`).
- Credentials: no token, email, org, sign-in URL or code in any event, refusal, `last_line`, log or console line. The URL appears only in start's 200. GET answers exactly the named keys (+ `ok`, + `reason` on `unknown`). The probe's object is never spread. The credential file's stdout is parsed in memory; only the two expiries survive.
- `judgeAuthStatus` and the preflight argv are reused verbatim; the Max-login preflight rule is unchanged; `plugins/tk-studio/lib/sandbox_login.py` is untouched.
- The lease is service events of kind `sandbox-login` (shape 5), taken atomically inside `Queue` (`.immediate()`); login state lives in the lease + tmux session name, never only in serve's memory (`drain` is its own process).
- New routes sit in `api.ts` beside the existing ones; both cookie allow-lists widened; cookie GET carries `X-CSRF-Token` (the `/inbox` precedent).
- Contract additive at 0.1.35 (shape 12): header clause appended after 39.1's, `, Story 39.2` in the rulings row, the `**0.1.35 (Story 39.2, additive).**` paragraph after 39.1's and before `## 8. Conformance`, and 39.2's clause appended to the §1 `tk-studio-track` row after 39.1's. No version pin flips.
- Windows host (AGENTS.md): every `bun test` names `--timeout 30000`; no `join(` inside an sbx argv; any Python `open` names `encoding="utf-8"`; tests inject `pollMs` ~20 and short `urlWaitMs`/`codeWaitMs`.
- Python is stdlib-only, run via `uv run`; `track.py`'s new form ends in its JSON status block (AD-11); writes atomic.

**Block If:**
- The Files list (Code Map) must grow beyond the 23 files named → `halt` consult; never split the story.
- A 39.1 contract pin breaks on the appended clause/paragraph in a way not fixable by re-bounding it at 39.2's clause or title (re-bounding is local, score 1, recorded).
- A design choice is needed that Settled shape §1–§12 and this spec do not settle.

**Never:**
- Start a sandbox from any supervisor command (`SandboxStopped` instead); fall back to `send-keys -l <code>` or any argv carrying the code; store a credential; change the preflight's claude.ai-only rule.
- Store the URL or code in `localStorage`/console on the web.
- Edit `sandbox_login.py`, `epics.md`, the canonical plan files, `stories.yaml`, `.bmad-loop/routing.toml`/`policy.toml`, or anything under `supervision/`; push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read ok | running; probe claude.ai; refresh > 3 d | 200 `state: ok`, `days_left` floor | — |
| Read expiring / expired | refresh ≤ 3 d / ≤ now, or `loggedIn` false | `expiring` / `expired` | — |
| Read unknown | probe fails/unparseable; method ≠ claude.ai; cat fails / no `refreshTokenExpiresAt` | 200 `unknown` + shape-2 `reason` | no stdout echoed |
| Sandbox stopped | not listed running | `unknown`, `reason: "sandbox stopped"`, last check's values or nulls; no exec | — |
| Which sandbox | none/several configured; unconfigured; bad name | 400 `SandboxRequired {candidates}`; 404 `UnknownSandbox`; 400 `SchemaError` | — |
| Start | lease free, no live run, running | lease opened, tmux started, 200 `{login_id,url,started_at,expires_at}` | timeout/dead pane → kill, close `failed`, 500 `LoginStartFailed` |
| Start refused | run holding / live lease / stopped | 409 `LoginWhileLive` / `LoginInProgress` / `SandboxStopped` | writes nothing |
| Code ok | pane dead, status 0 | kill, close `renewed`, re-read, 200 GET body | — |
| Code refused | dead ≠0 (respawn, new URL) or `Invalid code.` | 409 `CodeRefused {tries_left:1[,url]}`; second → close `refused`, `tries_left:0` | — |
| Code bad shape | not `code#state` | 400 `SchemaError` (no try spent) | — |
| Code late / unknown / closed | past deadline; no lease; closed | 409 `LoginExpired` (close `expired`, kill) / 404 `UnknownLogin` / 409 `LoginClosed` | bound → 500 `LoginFailed` |
| Claim on leased sandbox | live lease on `options.sandbox` | `claim-refused` key `sandbox-login:<sb>` before any pin call; run stays queued | — |
| Drain stale lease | open lease past deadline | tmux killed (if running), closed `expired` `closed_by: "drain"` before claims | best effort |
| Task pass | `expiring`/`expired`, no Task for R | one Task minted via `track.py block --source owner …`; next pass no re-mint; `ok` after → `close` to Done | `task_error` recorded, never throws |

</intent-contract>

## Code Map

The plan's **Code Map** (`plans/39-2.md` §Code Map, re-checked at 39.1's landing in its §Refresh) is the investigation: read it, and anchor by symbol. Confirmed at `ebfaa294`:

- `apps/supervisor/src/server.ts:839 judgeAuthStatus`, `:852 maxLoginPreflight` -- the probe argv and judgement to reuse verbatim.
- `apps/supervisor/src/sandbox.ts` -- `call`/`SandboxDeps.run` (add `input`), `sandboxRunning:237`, `sandboxHolders:174`, `releasePin:186`, `pinWithRestart:289`, `RESTART_BLOCKING_STATES`, `agentSessionArgv` (the `=`-exact tmux target), header paragraph.
- `apps/supervisor/src/queue.ts` -- `serviceEvent`/`serviceEvents`, `takeVerifyLeg` (the `.immediate()` take precedent), `ownerDetail`/`selfOwner`.
- `apps/supervisor/src/cli.ts:1472 claimGate`, `recordedRefusal`; `:963 drainQueue` (expiry before its `for`, `sandboxLoginQuietly` in its `finally` after `sweepEnds`, skipped under `bun test` without injected deps as `resolveQuietly`).
- `apps/supervisor/src/api.ts` -- `ApiDeps`, `json`/`fail`, `cookieRoute` GET + POST allow-lists, `csrfGiven`, `route` (beside `/inbox`), the `/inbox` CSRF-header precedent.
- `apps/supervisor/src/hygiene.ts` -- `recordClaimRefusal` and the notifier; new `sandboxLoginPass`. Callers of `track.py`: `sweep.ts postDecisions` (`uvRunner`, `studioScript`, `lastJsonObject`); `planseams.ts jiraBound`; `server.ts registryShow`; `env.ts:119 supervisorOrigin`.
- `apps/supervisor/src/config.ts` -- `loadSupervisorConfig`, `jobs."<project>/<job>".sandbox`; new `configuredSandboxes` lives in `sandbox.ts`.
- `apps/supervisor/test/fakes.ts:293 fakeSbx` -- extend per plan §Files (`exec -i` stdin to `sbx-stdin.jsonl`, auth object answer, credential `cat`, a tmux `login` script keyed by session); `sandbox.test.ts` `afterAll` argv guard; `api.test.ts routed()` fixture.
- `plugins/tk-studio/lib/track.py` -- `_agent_seat`, `_block_issue`, `comment_body`, `unblock_comment`, `find_engagement_issue`, `close_engagement` loop, `main` (`block`/`close` flags; `--source sweep` dispatch is the `--source owner` template; `close --engagement` becomes code-checked), `supervisor_origin:362`, `with_route`/`strip_route`. Mint pattern: `sweepdecisions.py _create_issue`.
- `apps/studio-web/src/inbox/model.ts` (`FetchLike`, `csrfOf`, `fetchInbox`), `src/issue/model.ts` (`canAct`, `postReply`) -- the card's fetch/gate precedents. `src/screen.ts:34 PLACEHOLDER.settings` and `src/screen.test.ts:138` (the pin that flips), `src/App.tsx` (renders the settings placeholder).
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 header, line 6 rulings row, `:3129` 39.1 paragraph, `:3172 ## 8. Conformance`, §1 `tk-studio-track` row; `lib/tests/test_driver_contract.py` `test_0_1_35_story_39_1_…` shape.
- `kb/agent-pc-setup-runbook.md` -- hole-69 row (shape 11 text).

**Files (the boundary, 23):** `apps/supervisor/src/{sandbox,queue,cli,api,hygiene}.ts`; `apps/supervisor/test/{fakes.ts,sandbox.test.ts,api.test.ts,hygiene.test.ts}`; `apps/supervisor/README.md`; `plugins/tk-studio/lib/track.py`; `plugins/tk-studio/lib/tests/test_track.py`; `plugins/tk-studio/contracts/driver-contract.md`; `plugins/tk-studio/lib/tests/test_driver_contract.py`; `apps/studio-web/src/settings/{login.ts,login.test.ts,LoginCard.tsx,SettingsScreen.tsx}` (new); `apps/studio-web/src/{App.tsx,screen.ts,screen.test.ts}`; `apps/studio-web/README.md`; `kb/agent-pc-setup-runbook.md`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/sandbox.ts` -- constants, `configuredSandboxes`, `readSandboxLogin`/`judgeLogin` (shape 2 precedence table), `signInUrl`, `paneLastLine`, tmux argv builders, `startSandboxLogin`, `sendSandboxLoginCode`, `expireSandboxLogins` (shape 4); `run`'s `input`; lease honoured in `pinWithRestart` and `releasePin` (shape 6); header paragraph -- the read and the exchange.
- `apps/supervisor/src/queue.ts` -- `takeSandboxLogin`, `closeSandboxLogin`, `openSandboxLogin`, `sandboxLogin`, `staleSandboxLogins` (shape 5) -- the lease.
- `apps/supervisor/src/cli.ts` -- `claimGate` lease refusal first on sbx; `drainQueue` expiry before its loop; `sandboxLoginQuietly` in `finally` -- the lease's readers and the Task pass's caller.
- `apps/supervisor/src/api.ts` -- the three routes and refusals (shape 3), `ApiDeps.sandboxLogin`, allow-lists, CSRF header, header comment.
- `apps/supervisor/src/hygiene.ts` -- `sandboxLoginPass` + `sandbox-login-check` event (shape 7).
- `plugins/tk-studio/lib/track.py` -- `--source owner --task sandbox-login` on `block`/`close` (shapes 8, 9), refusals, docstring.
- `apps/studio-web/src/settings/*`, `screen.ts`, `App.tsx` -- the card (shape 10), `SettingsScreen` mounted at `/app/settings` with the card first then "Model and effort: Not built yet: Story 39.8"; flip `screen.test.ts:138`'s pin to 39.8's placeholder (or drop it) and name the flip in the Deviation Summary.
- Tests: `fakes.ts`, `sandbox.test.ts`, `api.test.ts`, `hygiene.test.ts`, `test_track.py`, `login.test.ts`, `screen.test.ts`, `test_driver_contract.py` (`test_0_1_35_story_39_2_the_sandbox_login_has_a_clock`) -- every I/O matrix row plus the credential-absence assertions (fake `accessToken`, probe `email`, URL, code absent from answers but their own, events, notifier and console lines).
- Docs: contract (shape 12), runbook hole-69 row (shape 11), `apps/supervisor/README.md` (three route rows, one pass bullet), `apps/studio-web/README.md` (`## The Settings screen: the sandbox login card (Story 39.2)`).

**Acceptance Criteria:**
- Given AC1–AC4 above, when the verify commands run, then each criterion is shown by a named test or a command output, and the operator-only checks are recorded `unverifiable-here` with their exact commands.
- Given any answer, event, notifier or console line produced in the tests, when searched, then no fake token, email, sign-in URL (outside start's 200) or code appears.

## Design Notes

Plan Settled shape §1–§12 is binding (names, HTTP codes, argv, regexes, strings, the Task's summary/description, the card's lines). Notable: the authorize URL pattern also matches `claude.com/cai/oauth/authorize` (the installed binary's base); with no origin, `--url` is omitted and the Task carries the route path only (39.1's no-origin rule); `_block_issue`'s trailing `Open: <origin>/app/inbox/<KEY>` line is kept, and tests pin the comment with the `TK_SUPERVISOR_*` env keys explicit.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` (incl. `e2e_windows_semantics`, `e2e_text_encoding`).
- `uv run --no-project python plugins/tk-studio/lib/track.py block --directory . --source owner --task sandbox-login --sandbox claude-tk-studio --expires 2026-11-24T10:00:43Z --url https://example.invalid/app/settings --dry-run` -- expected: refusal or dry-run JSON, no Jira call.
- `cd apps/supervisor && bun test --timeout 30000` and `bunx tsc --noEmit -p .` -- expected: all pass.
- `cd apps/studio-web && bun run verify` (or its steps: `tsc --noEmit`, `vite build`, `vitest run` if `bun install` EPERMs) -- expected: green.

**Manual checks (unverifiable here; operator after merge + serve restart):**
- `GET /sandbox/login` with the bearer answers `state: ok`, `refresh_expires_at` 2026-11-24T10:00:43.000Z or later.
- A live renewal from `/app/settings` (Renew → Open sign-in → approve → paste → "Renewed: valid until …"); one `sandbox-login` open and one `renewed` close, neither with URL or code; `sbx exec -i` delivered stdin.
- TKSTUDIO-233 relabelled `tk-studio-sandbox-login`, retitled `Renew the sandbox's Claude login before 2026-11-24 10:00Z`, and its description given the line `Key: sandbox-login claude-tk-studio 2026-11-24T10:00:43.000Z` (the find is scoped to the sandbox by that line since review pass 1).

## Spec Change Log

## Review Triage Log

### 2026-11-09 — Review pass
- layers: blind-hunter, edge-case-hunter (band L: both ran; the 3154-line diff was handed to each by file path, `/tmp/rev39-2/diff.patch`, not inlined)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 3, low 3)
- defer: 0
- reject: 4 (a logged-out sandbox with no credential file mints no Task: AC4 keys the Task on `refresh_expires_at`, shape 7 requires a known R; the card has no sandbox picker for several configured sandboxes: one placement today, the 400 is shown in words, no criterion names a picker; Bun's idle timeout cuts the 30–60 s POSTs: `api.ts serve` sets `idleTimeout: 0`; a pin kept for a lease is not released when the lease closes: shape 6's rule, the next release clears it)
- addressed_findings:
  - `[medium]` `[patch]` owner-Task find/close leaked across sandboxes (summary carries no sandbox): the find now also requires the description's `Key: sandbox-login <SB> ` line; tests for two sandboxes (both layers).
  - `[medium]` `[patch]` lease vs claim race across serve/drain: `takeSandboxLogin` refuses atomically while a run is `running|paused|external` (`LoginWhileLive`); `claimGate` re-reads the lease after the pin; and, per consult 2, `queue.claim` reads the lease in its own transaction (run stays `queued`, `sandbox-login:<sb>` refusal) (both layers).
  - `[medium]` `[patch]` the card dropped a still-open login on a second Renew or a network error: Renew disabled while the card's login is open ("A sign-in is open: …"), only closing answers clear it (both layers).
  - `[low]` `[patch]` `drainQueue`-level test for the stale-lease expiry before claims (AC2).
  - `[low]` `[patch]` `OwnerTaskTests` moved above `test_track.py`'s `unittest.main()` guard.
  - `[low]` `[patch]` `apps/supervisor/README.md` event shape gains `task_skipped?`; per consult 2 the web README names the new Renew reason and its route row reads 39.8.

### 2026-11-09 — Review pass (follow-up review, iteration 0)
- layers: blind-hunter, edge-case-hunter (band L: both ran; the 3512-line diff `ebfaa294..working tree`, two over-long contract table lines cut to their changed span, handed to each by file path `/tmp/rv392/review.diff`)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 2, low 2)
- defer: 0
- reject: 7 (a probe that exits non-zero reads `unknown`, not `expired`, even when the file says lapsed: AC1 names `unknown` for a failed probe and shape 2's precedence table puts the probe first; the AC4 pass mints nothing on `unknown`: AC4 triggers on `expiring|expired` only; a started sign-in cannot be resumed after a reload or cancelled: the ten-minute lease bounds it, AC3 forbids keeping the URL in storage, and no criterion names a cancel route; the card has no sandbox picker for several configured sandboxes: rejected in pass 1, one placement today, the 400 is shown in words; `releasePin` keeping the pin while a lease is open leaves the sandbox up until a later release: plan shape §6 (`plans/39-2.md:338`) settles the keep, and an idle running sandbox is the normal state; `LoginCard`'s polling and re-read have no component test: AC3 names what `login.test.ts` pins (the states, the disabled reasons, the two-step flow), and the polling code was read and is correct; `renewGate`'s CHECKING reason with a failed first read: folded into patch 4)
- addressed_findings:
  - `[medium]` `[patch]` `sendSandboxLoginCode` checked the lease deadline only on entry, so the code wait (60 s) and the respawn URL wait (30 s) could run past the ten-minute lease (the drain closed it beneath the exchange, the claim gate let runs in, and a late `renewed` wrote no event). Both waits are now bounded by `lease.deadline`; reaching it kills the session, closes the lease `expired` and answers `409 LoginExpired`; a pane that ended with status 0 first still answers `renewed`. Three tests in `sandbox.test.ts` (both layers).
  - `[medium]` `[patch]` the code route exec'd into the sandbox without checking it runs (the spec's Never: start no sandbox, `SandboxStopped` instead). It now runs `sbx ls` first: a stopped sandbox closes the lease `failed` and answers `409 SandboxStopped {sandbox, login_id}`, with no exec. The check runs after the in-flight mark, so two racing sends cannot both pass. Test added (edge-case-hunter). Per consult 3, the contract's code-route list, `api.ts`'s route comment, the supervisor README and the web `CLOSING` set now name it, and `login.test.ts` pins it.
  - `[low]` `[patch]` the docs said the sign-in URL is answered by the start route only, though plan shape §4 and the contract also answer it in a first refusal's `409 CodeRefused {…, url}`. Corrected in the `sandbox.ts` header and start doc comment, the supervisor README start row, the `api.ts` route comment, and `driver-contract.md:3199` (its `test_driver_contract.py` pin follows) (blind-hunter).
  - `[low]` `[patch]` the card hid a failed poll after one good read (stale "Login valid for N days…"). `cardLine` now shows `Login not read: <error>` whenever the latest read failed, and `renewGate` gives that failure, not "Checking the login…", as the disabled reason when there is no reading. `LoginCard` passes `readError`. Two tests in `login.test.ts` (blind-hunter).

### 2026-11-09 — Review pass (follow-up review 2, iteration 0)
- layers: blind-hunter, edge-case-hunter (band L: both ran; the 3614-line diff `ebfaa294..working tree`, four over-long contract table lines cut to their word-level changed spans, handed to each by file path `/tmp/review-39-2-p2/review.diff`)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 6 (the card has no sandbox picker for several configured sandboxes: rejected in passes 1 and 2, one placement today, the 400 is shown in words; a running sandbox whose read is `unknown` mints no Task even when the last check's R is near: AC4 triggers when the pass "finds the login `expiring` or `expired`", as ruled in follow-up review 1; the owner-Task find needs a plain-string `description`, which REST v3 answers as ADF: `jirabackend.py` stays on `/rest/api/2` (:41-45, :69), where descriptions are plain text; the drain's expiry can close a lease `expired` in the last poll second while the code route sees the pane end 0 and answers `200`: the answer is the real credential-file reading, the next hourly read records `ok` and AC4's pass closes the Task, so only the lease's audit result differs in a sub-second window; a failed `GET /status` leaves Renew enabled while a run may hold the sandbox: the card cannot know the holder, and `takeSandboxLogin` refuses atomically with `LoginWhileLive`, which the card shows in words, as AC3's "the refusal in words")
- addressed_findings:
  - `[medium]` `[patch]` a code arriving after the lease deadline ran `expire()` before the `sandboxRunning` check, and `expire()` exec'd `tmux kill-session`, which starts a stopped sandbox (hole 68; the spec's Never). `expire()` now kills only on a sandbox listed running (best effort, as `expireSandboxLogins`), for the late and the in-wait expiries; the answer stays `409 LoginExpired`, the lease `expired`. The late test now expects the `ls` before the kill; a new test pins a late code on a stopped sandbox: only `ls`, no exec, closed `expired` (both layers).
  - `[low]` `[patch]` the web README's closing-answers list and `login.test.ts`'s test title omitted `SandboxStopped`, which `CLOSING` (consult 3) includes, so the README said a `SandboxStopped` answer keeps the link. Both now name it, and the test's `closing` array covers it (blind-hunter).

## Deviation Summary

- `apps/studio-web/src/screen.test.ts`'s placeholder pin flipped: `PLACEHOLDER.settings` reads `Not built yet: Story 39.8` (was `… Story 39.2`); `/app/settings` now mounts `SettingsScreen`, which shows it as `Model and effort: Not built yet: Story 39.8`.
- `readSandboxLogin(queue, sb, deps, nowMs)` takes the queue first (the plan's `readSandboxLogin(sb, deps, nowMs)`): the stopped read answers the last `sandbox-login-check`'s values.
- `track.py block|close --source owner --dry-run` makes no Atlassian call at all (after the refusals), so the Verification command never reaches Jira.
- `sandboxLoginPass` retries a failed or skipped Task call after an hour (`LOGIN_TASK_RETRY_MS`), never every drain pass; a failed close records `task_error` on the `ok` check.
- `track.py` also refuses `--task`, `--sandbox`, `--expires` or `--url` given without `--source owner` (exit 2, no call).

### pass 1 (2026-11-09, implementer DEVIATIONS block)

- planned: `screen.test.ts:138` pins `PLACEHOLDER.settings = "Not built yet: Story 39.2"` / actual: the pin reads `Not built yet: Story 39.8`, shown by SettingsScreen as "Model and effort: …" / why: the spec names this flip / may affect: 39-8-settings
- planned: `readSandboxLogin(sb, deps, nowMs)` / actual: `readSandboxLogin(queue, sb, deps, nowMs)` / why: the stopped read answers the last `sandbox-login-check` event's values, which live in the queue / may affect: none
- planned: owner dry run "creates and moves nothing and names what it would do" / actual: it also makes no Atlassian read at all, after the refusals / why: the Verification command must make no Jira call (the first version made one real read-only `GET /search/jql` against the live Jira while being verified; nothing was created, moved or commented) / may affect: none
- planned: shape 7 lists no retry throttle and no field for a close failure / actual: `LOGIN_TASK_RETRY_MS` (1 h) for a failed or skipped mint or close; a failed close records `task_error` on the `ok` check / why: without it a stopped sandbox or an unbound project writes a check event every drain pass / may affect: none
- planned: not specified / actual: `track.py` refuses `--task`, `--sandbox`, `--expires` or `--url` without `--source owner` (exit 2, no call) / why: the sweep's flag-refusal pattern / may affect: none

DEVIATION SCORE: 1

DRIFT: screen.test.ts settings placeholder pin flipped to "Not built yet: Story 39.8" — /app/settings now mounts SettingsScreen, 39.8 fills the rest — affects: 39-8-settings
DRIFT: readSandboxLogin takes the queue as its first argument — the stopped read answers the last sandbox-login-check values from the queue — affects: none
DRIFT: track.py --source owner --dry-run makes no Atlassian read — the Verification command must never reach Jira — affects: none
DRIFT: sandboxLoginPass retries a failed/skipped Task call after 1 h (LOGIN_TASK_RETRY_MS); a failed close records task_error — avoids a check event every drain pass — affects: none
DRIFT: track.py refuses --task/--sandbox/--expires/--url without --source owner — the sweep's flag-refusal pattern — affects: none

### pass 2 (2026-11-09, review patches, implementer DEVIATIONS block; consult 2 accepted, score 2)

- planned: plan §8/§9, the owner Task found by label then exact summary / actual: label, then this sandbox's description line `Key: sandbox-login <SB> `, then the exact summary; JQL fields `summary,status,description` / why: review patch, Tasks leaked across sandboxes / may affect: none (operator: TKSTUDIO-233's description needs the Key line)
- planned: plan §5, `takeSandboxLogin` refuses only on a live lease / actual: also refuses (`held` → `LoginWhileLive`) while a run on the sandbox is `running|paused|external`, inside the same transaction / why: the start-versus-claim race / may affect: none
- planned: plan §6, the claim gate reads the lease once, before any pin / actual: also right before it lets the claim proceed / why: the race / may affect: none
- planned: plan §10, Renew's disabled reasons; any non-recoverable code answer ends the login / actual: new reason "A sign-in is open: paste its code, or wait until <time>"; only six closing answers end the login; `LoginInProgress` on start keeps the open login / why: the lost-login defect / may affect: none

DEVIATION SCORE: 2

### pass 3 (2026-11-09, consult 2's DO lines, implementer DEVIATIONS block; recorded under consult 2's ruling, same question, no new consult)

- planned: pin "a lease taken after the gate but before `claim`" / actual: the test drives `claimGate` → `takeSandboxLogin` → `Queue.claim` in sequence, not through `runJob` / why: `runJob`'s real `validate`/`resolveCheckout` cannot be hooked without a full sbx drive / may affect: none (`runJob`'s `sandbox-login` branch is type-checked, not executed by a test)
- planned: report not-claimed as `runJob` already does / actual: an undrained run returns the usual not-claimed summary without a `waited` field / why: the new `why` stays internal (no contract surface) / may affect: none
- planned: no run-row change beyond refusing / actual: a lease-refused claim sets the run's `reason` and clears its owner, as a lock wait does / why: otherwise a directly started run stays owned and drain skips it after the lease closes / may affect: none

DEVIATION SCORE: 1

DRIFT: owner-Task find keyed by the description's `Key: sandbox-login <SB> ` line as well as the summary — without it close/block leaked across sandboxes — affects: none (operator step for TKSTUDIO-233)
DRIFT: takeSandboxLogin refuses atomically while a run is running|paused|external; claimGate re-reads the lease after the pin; queue.claim reads it in its own transaction — AC2's absolute claim exclusion across serve and drain — affects: none
DRIFT: the card's Renew is disabled while its own login is open, and only closing answers clear it — a second press or a network error lost a live login — affects: none

### pass 4 (2026-11-09, follow-up review patches, implementer DEVIATIONS block; consult 3 accepted, score 2)

- planned: plan shape §3/§4's code-route refusal table (`plans/39-2.md:264-274`) has no `SandboxStopped` and checks `LoginExpired` only on arrival / actual: the code route answers `409 SandboxStopped {sandbox, login_id}` (nothing exec'd, the lease closed `failed`) when the sandbox stopped under the lease, and `409 LoginExpired` also when the ten minutes run out while the outcome or a respawn's URL is awaited / why: the spec's Never ("start no sandbox, `SandboxStopped` instead") and AC2's ten-minute lease / may affect: the contract's 0.1.35 Story 39.2 paragraph, `api.ts`'s route comment, the supervisor README and the web card's `CLOSING` (all updated in this pass)

DEVIATION SCORE: 2

DRIFT: the code route answers 409 SandboxStopped {sandbox, login_id} (lease closed failed, nothing exec'd) and an in-wait 409 LoginExpired (waits bounded by the lease deadline) — the spec's Never on starting a sandbox and AC2's ten-minute lease; contract 0.1.35 paragraph, api.ts comment, README and web CLOSING updated with it (consult 3) — affects: none

### pass 5 (2026-11-09, follow-up review 2 patches, implementer DEVIATIONS block)

- planned: run `bun`/`bunx` as written / actual: `$HOME/.bun/bin` prefixed to PATH / why: bun is not on the default PATH in this environment / may affect: none (environment only; not a story deviation)

DEVIATION SCORE: 0

## Consult Log

- 2026-11-09T21:06Z — trigger: deviation-gt-0 — question: accept or reject the implementer's five pass-1 deviations (score 1)? — ruling: accept-deviation score 2 — do: Accept all five deviations as built; revert nothing. / Carry item 1 into Story 39-8's context as a seam: `/app/settings` mounts `src/settings/SettingsScreen.tsx`, and `PLACEHOLDER.settings` is pinned as "Not built yet: Story 39.8" in `screen.test.ts`; 39-8 replaces that line with its own model. / Leave the contract paragraph as written (its field list already names `task_error?` and `task_skipped?`). — rule candidate: When a plan's prose and its pinned Verification command disagree, the Verification command governs, and a change that only adds use of a field already listed in the contract's event field set scores 1, not 2.
- 2026-11-09T21:36Z — trigger: deviation-gt-0 (review pass 1 patches) — question: accept the three patch deviations (owner-Task find keyed by the description's Key line; atomic take refusal + post-pin lease re-check; the open-login Renew reason)? must the web README gap and the residual gate-to-claim window be closed before done? — ruling: accept-deviation score 2 — do: Accept all three patches (item 1 score 2, item 2 score 2, item 3 score 1); note that Verify step 3 now also needs `Key: sandbox-login <SB> <R ISO>` in TKSTUDIO-233's description. / Close the claim window before done: in `queue.claim`'s transaction, after the state checks, return not-claimed when `run.sandbox` has a live lease (`openSandboxLogin(run.sandbox, now)`), the run stays `queued`, the reason names the `sandbox-login:<sb>` lease; keep any new `why` internal; pin it in `sandbox.test.ts`; do not record the window as a residual risk. / Patch the web README before done: the Renew bullet (`apps/studio-web/README.md:221-224`) names "A sign-in is open: paste its code, or wait until <time>" and that only closing answers clear it; fix the stale route row at `:196` (`Not built yet: Story 39.2` → 39.8). — rule candidate: A gate that an AC states as absolute ("no X until Y closes") must be enforced inside the same transaction that commits X, not only in a pre-check before awaited work; a README that lists a UI's states or reasons is updated in the same patch that adds one.
- 2026-11-09T22:15Z — trigger: deviation-gt-0 (follow-up review patches) — question: accept the code route's new `409 SandboxStopped {sandbox, login_id}` and in-wait `LoginExpired` (lease-deadline-bounded waits), and must the 0.1.35 contract paragraph, api.ts comment and README name them? — ruling: accept-deviation score 2 — do: Keep both code patches; in the same story at 0.1.35 add `409 SandboxStopped {sandbox, login_id}` (nothing exec'd, lease closed `failed`) to driver-contract.md's code-route refusal list and widen its `LoginExpired` to the ten minutes running out while the outcome or a respawn's URL is awaited (the README :71 wording). / In api.ts's route doc comment add `SandboxStopped {sandbox, login_id}` and the in-wait `LoginExpired` to the code route and replace "the sign-in URL is answered here only" with here and in a first refusal's CodeRefused url; add `SandboxStopped` to `CLOSING` in apps/studio-web/src/settings/login.ts:217, then rerun conformance. — rule candidate: When a review fix adds a new refusal to a route, the same patch must update the plan's refusal table, the driver-contract paragraph, the api.ts route comment, the README row and the web client's refusal handling, and the deviation is scored at least 2.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-39-20261109T203308Z-c7d1a4` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review of the done story (step-01 `done` → step-04, `review_loop_iteration` 0), over the whole diff since `ebfaa29444ab52b70043df3e02a05ea0a3d7bb12`. What the story built stands as recorded in the earlier passes:
- the login's clock, `GET /sandbox/login`;
- the page-driven renewal, `POST /sandbox/login/start` and `/code`, under a ten-minute `sandbox-login` lease that the claim gate honours;
- the Settings card;
- the `tk-studio-owner` Task pass;
- contract 0.1.35, additive.

This pass closed one remaining path to an exec into a stopped sandbox (a late code) and corrected one doc list. The serve process is touched (`sandbox.ts`): stop the supervisor tab before the build, and restart it after the merge.

**Files changed in this pass.** All four are in the plan's Files list.
- `apps/supervisor/src/sandbox.ts`: `sendSandboxLoginCode`'s `expire()` kills the tmux session only on a sandbox listed running. It still closes the lease `expired` and answers `409 LoginExpired`. The doc comment says so.
- `apps/supervisor/test/sandbox.test.ts`: the late-code case now expects `ls` before the kill. A new test covers a late code on a stopped sandbox: only `ls`, no exec, lease closed `expired`, `LoginExpired`.
- `apps/studio-web/README.md`: the Renew bullet's list of closing code answers now names `SandboxStopped`.
- `apps/studio-web/src/settings/login.test.ts`: the closing-answers test title and its `closing` array now name `SandboxStopped`.

**Review findings.** Two layers ran: blind-hunter and edge-case-hunter.
- Patches applied: 2 (high 0, medium 1, low 1).
- Deferred: 0.
- Rejected: 6, with reasons in the Review Triage Log.
- No consult was needed: implementer deviation score 0.
- No ledger entry was touched.

**Follow-up review recommendation:** false. Patched: high 0, medium 1, low 1. Score 3×1 + 1 = 4 (< 5).

**Verification.** This session re-ran every command on the final tree, after the implementer's runs:
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: OK, 3133 tests (skipped=5).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `cd apps/supervisor && bun test --timeout 30000`: 2287 tests, 2202 pass, 85 skip, 0 fail.
- `bunx tsc --noEmit -p .`: exit 0.
- `apps/studio-web`:
  - `bunx tsc --noEmit`: exit 0.
  - `bunx vitest run`: 215/215 in 13 files.
  - `vite build`: OK (implementer's run).
  - `bun run verify` still fails at `bun install` with EPERM when linking. This is environmental, as in 39.1. `package.json` and `bun.lock` are unchanged.
- `track.py block --source owner … --dry-run`, run with the Atlassian tokens unset: dry-run JSON (`partial`, "nothing written and no call made"), exit 0.

**Unverifiable here.** These are pass 1's three operator checks, unchanged:
- the bearer `GET /sandbox/login` reading `ok`;
- a live renewal from `/app/settings`, which is the only proof that `sbx exec -i` forwards stdin;
- TKSTUDIO-233's relabel, retitle and `Key:` line.

**Residual risks.**
- From the earlier passes:
  - the one real read-only Jira GET in pass 1;
  - the untested `runJob` `sandbox-login` claim branch;
  - no sandbox picker;
  - no cancel or resume of a sign-in after a page reload;
  - a first read that fails leaves Renew disabled until a read succeeds.
- New in this pass:
  - A sign-in that succeeds in the last poll second, while the drain expires the lease, records the lease `expired` and writes no `renewed` event. The answer and the next hourly read are correct.
  - A failed `GET /status` leaves Renew enabled. The server's atomic `LoginWhileLive` answers the press.

DRIFT: screen.test.ts settings placeholder pin flipped to "Not built yet: Story 39.8" — /app/settings now mounts SettingsScreen, 39.8 fills the rest — affects: 39-8-settings
DRIFT: readSandboxLogin takes the queue as its first argument — the stopped read answers the last sandbox-login-check values from the queue — affects: none
DRIFT: track.py --source owner --dry-run makes no Atlassian read — the Verification command must never reach Jira — affects: none
DRIFT: sandboxLoginPass retries a failed/skipped Task call after 1 h (LOGIN_TASK_RETRY_MS); a failed close records task_error — avoids a check event every drain pass — affects: none
DRIFT: track.py refuses --task/--sandbox/--expires/--url without --source owner — the sweep's flag-refusal pattern — affects: none
DRIFT: owner-Task find keyed by the description's `Key: sandbox-login <SB> ` line as well as the summary — without it close/block leaked across sandboxes — affects: none (operator step for TKSTUDIO-233)
DRIFT: takeSandboxLogin refuses atomically while a run is running|paused|external; claimGate re-reads the lease after the pin; queue.claim reads it in its own transaction — AC2's absolute claim exclusion across serve and drain — affects: none
DRIFT: the card's Renew is disabled while its own login is open, and only closing answers clear it — a second press or a network error lost a live login — affects: none
DRIFT: the code route answers 409 SandboxStopped {sandbox, login_id} (lease closed failed, nothing exec'd) and an in-wait 409 LoginExpired (waits bounded by the lease deadline) — the spec's Never on starting a sandbox and AC2's ten-minute lease; contract 0.1.35 paragraph, api.ts comment, README and web CLOSING updated with it (consult 3) — affects: none

## Reconcile

### 2026-11-09 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT but one is local to 39.2's own seams (the login read, the lease and its three readers, `track.py --source owner`, the card) or its 0.1.35 paragraph, and the new `409 SandboxStopped` and in-wait `LoginExpired` were added additively in the same story by consult 3. No later story's acceptance criteria rely on them. The one affecting DRIFT is the web seam 39.8 builds on: `/app/settings` mounts `src/settings/SettingsScreen.tsx` (the login card, then `Model and effort: {PLACEHOLDER.settings}`), and `PLACEHOLDER.settings` is pinned as "Not built yet: Story 39.8" in `screen.test.ts:139`. Consult 1 ruled this a seam to carry into 39-8's context, and a note in its `invoke_dev_with` absorbs it.
- Affected: 39-8-model-and-effort-in-the-owners-hands — plans/39-8.md:300 "`SettingsScreen.tsx` (modify; 39.2 creates it, under whatever name 39.2 gives its screen): mounts `RoutingCard` below the login card" (the name is now fixed, and the placeholder line and its pin must go)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 39-3-the-studio-chat

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-09T17:24:14Z | 2026-11-09T17:48:18Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-09T19:11:25Z | 2026-11-09T19:12:21Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-09T20:35:05Z | 2026-11-09T21:55:04Z | e36b008e-a24f-4918-846b-7a19b934e5ab | claude-opus-5-5 | medium | 46821643 | 269704 | 22.0292 | completed |
| review | 1 | 2026-11-09T21:55:05Z | 2026-11-09T22:31:23Z | ef7063e8-cb4a-4267-812e-f517d6ce422a | claude-opus-5-5 | medium | 9053170 | 82832 | 6.6483 | completed |
| review | 2 | 2026-11-09T22:31:23Z | 2026-11-09T22:51:24Z | 23ebf148-ce25-4c16-8d18-088ef490a7ef | claude-opus-5-5 | medium | 6889256 | 60517 | 5.3721 | completed |
| gate | 1 | 2026-11-09T22:51:25Z | 2026-11-09T22:54:23Z | a633f83f-e24a-4fb5-b6e0-0d849229e6db | claude-opus-5-5 | medium | 3717020 | 18133 | 2.1021 | completed |

