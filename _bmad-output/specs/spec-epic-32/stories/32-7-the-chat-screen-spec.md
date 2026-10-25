---
title: 'The Chat Screen'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'e325035ae470150344208409cbdd3e481fed4d21'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-7.md'
  - '{project-root}/_bmad-output/specs/spec-epic-32/SPEC.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every engagement surface exists on the supervisor (32.1–32.6) but the studio web has none of it, so an engagement is only reachable from a terminal. Story 32.7 (CAP-14, ST-128): as the owner, I want the engagement conversation in the web, so that intake, questions, scope, quote and approval happen from the desktop or the iPad without a terminal (§6.3 Chat; F2).

**Approach:** Add a sixth screen, Chat, to `apps/studio-web` (pure rules in `chat/model.ts`, tested in vitest's node environment; a chat EventSource with the office stream's watchdog; the composition in `ChatScreen.tsx`), teach the office store `engagements[]` and the `office.engagement` delta for the nav count, and add the one additive server read `GET /runs/{id}` `cost_usd` (contract 0.1.27 clause + pin) for the cost on hover.

### Acceptance criteria (verbatim, epics.md "### Story 32.7: The Chat Screen")

- **AC1:** **Given** `GET /engagements`, `GET /chat/{id}` and the typed inputs **When** the Chat screen renders **Then** it lists the project's engagements by state with the open one's transcript (owner and planner lines, the planner's run cost on hover), a message box (`POST /chat/{id}`), the state as a stepper (`intake … delivered`, the side exits marked), the questions as cards with their options and defaults (an answer sends `answer`), the scope page's link and a **Revise** box (sends `revise`), the quote as the band (50/85/95 as share and dollars, the cap, the autonomy levels) and an **Approve** control with the autonomy choice (sends `approve`), **Go** and **Cancel** where the table allows them, and a planner `proposals[]` entry as a button sending exactly that input; a **New engagement** form (`POST /engagements`); the nav gains Chat, and an engagement in `awaiting-answers` or `quoted` puts a count on it; the web sends the CSRF token as the inbox reply does; the stream keeps the transcript live and the watchdog on `visibilitychange` reconnects it on the iPad
- **AC2:** **Given** the screen **When** it is tested **Then** vitest covers the stepper, the cards, the quote, each action and the refusals' rendering with a fixture; the studio-web gate stays green

## Boundaries & Constraints

**Always:**
- Every engagement/chat read and post carries `?project=<id>` (a repeated id is 409 AmbiguousEngagement). The CSRF token is `fetchInbox(project).csrf` (the `GET /inbox?project=` `X-CSRF-Token`), re-read when the project changes; posts use `credentials: "same-origin"` and `x-csrf-token` exactly as `issue/model.ts postReply`; with no token every send is disabled (`canAct`).
- Fetches and posts never throw; refusals render by their error name (409 `IllegalInput` renders `{state, verb}`; 503 `ChatBusy` reads as retryable; 500 `ChatJobUnresolved`/`ChatQueueFailed` say no line was kept).
- `ACTIONS: Record<state, verb[]>` mirrors `TRANSITIONS`' verb cells only (Settled shape 3); a button outside its cell is never rendered; a proposal whose verb is outside the cell renders disabled naming the state; a proposal button sends exactly `{verb, ...payload}`.
- Settled shapes 1–7 in Design Notes are binding.
- Supervisor change is only `GET /runs/{id}` gaining `cost_usd: number | null`, via `inbox.ts runCost` + `ledgerPath`; contract text is one `0.1.27 (Story 32.7) adds to this same entry …` clause after 32.6's, no `**0.1.28**`, plus a 32.7 pin; every earlier pin kept.
- Stay within the plan's 19 Files.

**Block If:**
- The screen needs any server change beyond `GET /runs/{id}` `cost_usd` (a PR link, a CSRF header on another route, a field on the chat line) — HALT naming it.
- A `TRANSITIONS` row or the engagement record shape must change — HALT.
- The Files list must grow beyond the plan's list — HALT blocked.

**Never:** add a field to the chat line; parse service events in the web; show a PR link; add a web verb for resuming `paused`; push, tag, release or bump versions; DOM test infra (vitest stays `environment: "node"`); refactor outside Files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Actions per state | each of the 11 states | exactly the Settled-shape-3 cells; terminal → none | — |
| Proposal outside cell | proposal `approve` while `scoping` | button disabled, names `scoping` | — |
| Answer card | question with a `default: true` option | default pre-selected; send posts `{verb: answer, answers: {<id>: <label>}}` | 409 IllegalInput → `{state, verb}` text |
| Approve | autonomy `steady`, base_ref blank / `main` | `{verb: approve, autonomy: steady}` / `+ base_ref: "main"` | invalid autonomy never sent |
| Go in partial | cap `12.5` / blank / `-1` | `{verb: go, cap: 12.5}`; blank/non-positive disabled | — |
| Chat post | message, 503 ChatBusy | retryable notice, text kept | named error |
| No CSRF | inbox answers no token | every send disabled | — |
| Cost hover | planner line with run_id; `cost_usd` null | fetched once per run_id, cached; `not metered` | fetch failure → no cost, no throw |
| Nav count | office rows: 1 awaiting-answers, 1 quoted (two projects), 1 scoping; delta `state: null` | count 2; removed row drops | no rows → no count |
| Stream | 15 s silence / visibilitychange visible | reopen with `Last-Event-ID` = last seq, backoff 1–30 s | duplicate seq ignored |
| Stepper | `paused` after `in-progress` | main path with the side exit marked against `in-progress` | no `inputs[]` hint → closest main step |

</intent-contract>

## Code Map

The plan `plans/32-7.md` §Code Map is the investigation (verified this session against source); its anchors are not repeated here. Key reuse:
- `apps/studio-web/src/inbox/model.ts` -- `FetchLike`, `namedError`, `csrfOf`, `fetchInbox` (never throws): copy this pattern.
- `apps/studio-web/src/issue/model.ts` -- `rememberedIssue`/`rememberIssue`, `postReply`, `ActionGate`/`canAct`, `costText`.
- `apps/studio-web/src/office/model.ts` -- `NONE`, `safeHref` (scope page URL), `StorageLike`, `fetchAgents`/`projectsFrom`.
- `apps/studio-web/src/live/stream.ts` -- watchdog pattern (`WATCHDOG_MS`, visibility reopen, capped backoff, injectable ctor/timers, `Last-Event-ID`); `DELTA_KINDS` lacks `office.engagement`.
- `apps/studio-web/src/live/store.ts:82,95` -- `OfficeView` / `OfficeDeltaKind` to extend (`engagements?` optional in the type).
- `apps/supervisor/src/engagement.ts:27-44,108,199-240` -- states, verbs, autonomy, `VERB_FIELDS`, `TRANSITIONS` (read-only).
- `apps/supervisor/src/chat.ts:39` -- `ChatLine` (read-only).
- `apps/supervisor/src/api.ts:1193-1201` -- `GET /runs/{id}` to gain `cost_usd`; `inbox.ts:146 runCost`, `issueReadUnguarded` :186-190 as the model; cookie may already read `/runs/{id}` (api.ts :1049-1050), so no auth change.
- `plugins/tk-studio/contracts/driver-contract.md:5` -- 0.1.27 entry; `plugins/tk-studio/lib/tests/test_driver_contract.py` 32.x pins :964-1388, add 32.7 before `test_section_8_names_the_cli_drives`.

## Tasks & Acceptance

**Execution:**
- `apps/studio-web/src/chat/model.ts` -- new: mirrored types; never-throwing fetch/post (`fetchEngagements`, `fetchEngagement`, `fetchChat`, `postEngagement`, `postInput`, `postChat`, `fetchRunCost`); `ACTIONS`; stepper; question cards; quote view; proposal button; nav count; remembered engagement; refusal text; payload builders.
- `apps/studio-web/src/chat/fixture.ts` -- new: engagements in each state, questions, quote, chat lines with proposals.
- `apps/studio-web/src/chat/model.test.ts` -- new: AC2 (stepper, cards, quote, each action's payload + post via fake `FetchLike` with CSRF header, refusals) and the I/O matrix.
- `apps/studio-web/src/chat/stream.ts` + `stream.test.ts` -- new: chat EventSource (`event: chat`, resume, watchdog, visibility, backoff) and its tests.
- `apps/studio-web/src/chat/ChatScreen.tsx` -- new: list by state, transcript with lazy hover cost, message box, stepper, cards, scope link + Revise, quote + Approve, Go/Cancel, proposals, New engagement form, refetch on focus/visibility.
- `apps/studio-web/src/screen.ts` + `screen.test.ts` -- add `"chat"`.
- `apps/studio-web/src/App.tsx` -- Chat screen and its nav count.
- `apps/studio-web/src/live/store.ts` + `store.test.ts`, `live/stream.ts` + `stream.test.ts` -- `engagements[]`, `office.engagement` delta keyed by project+id, `state: null` removes.
- `apps/studio-web/README.md`, `apps/supervisor/README.md` -- document the screen / `cost_usd`.
- `apps/supervisor/src/api.ts` + `test/api.test.ts` -- `GET /runs/{id}` `cost_usd` (metered value; null with no studio run id or no metered line).
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the 32.7 clause and pin.

**Acceptance Criteria:**
- Given the fixture, when `model.test.ts` runs, then it pins `ACTIONS` cell-for-cell, the stepper's side-exit marking, the cards' defaults and `answer` payload, the quote's 50/85/95 share+usd, cap and autonomy levels, every verb's payload and post (CSRF header, `?project=`), and each refusal's text.
- Given `GET /runs/{id}` for a run with a metered studio run, when called, then the answer carries `cost_usd` equal to the ledger `total_cost_usd`, else `null`.
- Given the project gate, when run, then all Verification commands pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- diff handed to both layers as the file /tmp/sw327.diff (208 KB, 19 files) rather than inlined
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 2, low 5)
- defer: 0
- reject: 4 (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Approve could send `steady` while the select showed another offered level: `autonomyChoice` clamps to `quote.basis.autonomy`, `approveInput` refuses an unoffered level
  - `[medium]` `[patch]` a null/failed run cost was cached for good: only a metered cost is cached; null/failure re-read on next hover/focus, one in flight per run_id
  - `[low]` `[patch]` `create()` had no stale-project guard: captures the project and returns if it changed
  - `[low]` `[patch]` owner lines with a run_id fetched/showed cost: gated on `author === "planner"`
  - `[low]` `[patch]` read errors never cleared on success: per-read error slots cleared on the next success
  - `[low]` `[patch]` CSRF read only on project change: re-read on wake (focus/visibility), late answers for another project ignored
  - `[low]` `[patch]` silence/visibility reopen flickered "reconnecting": status changes only on error/backoff
- rejected (one line each): an `approve` proposal button: CAP-5 says the owner's send applies a proposal and AC1 requires "a button sending exactly that input" (a cookie+CSRF approve); cookie read of `GET /runs/{id}`: already permitted (api.ts:1050 `^/runs/[^/]+$` in cookieRoute); synchronous ledger read per `GET /runs/{id}`: the plan's named reuse (`inbox.ts runCost`, as `issueReadUnguarded`); 15 s reconnect churn in a quiet chat: the plan-specified watchdog, server heartbeats are SSE comments by design (status flicker patched above; the GET churn is a residual risk)

### 2026-10-25 — Review pass (follow-up)
- diff (`git diff e325035 -- . ':(exclude)_bmad-output'`, 214 KB, 19 files) handed to both layers as the file /tmp/diff-32-7-followup.patch rather than inlined
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 3, low 3)
- defer: 0
- reject: 2 (high 0, medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` after a project switch the old project's list stayed up (and a click opened `{newProject, oldId}`): the `[project]` effect clears `list`, `problems` and the list read error
  - `[medium]` `[patch]` a failed CSRF re-read on wake nulled a good token, disabling every send: a failed read keeps the held token; project change still clears it
  - `[medium]` `[patch]` the open record and the list ignored `office.engagement` deltas (stale stepper/controls, nav count disagreeing with the list): App passes `live.view?.engagements` to ChatScreen; a change of the project's `id:state` key bumps the list read, a change of the open row's state bumps the record read
  - `[low]` `[patch]` a record without `request`/`project` would throw in render: `engagementOf` requires both strings; model.test.ts case added
  - `[low]` `[patch]` a failed transcript read left its error over a live, replayed transcript: a stream line clears the `chat` read error
  - `[low]` `[patch]` an in-flight record GET could overwrite a post's newer record: an `applied` counter drops reads started before the latest applied post
- rejected (one line each): proposal buttons on older planner lines stay live: Boundaries pin cell-only gating ("a proposal whose verb is outside the cell renders disabled"), the button sends exactly the input shown and the server's transition table is the authority; no render-level tests for ChatScreen: the intent's Approach pins pure rules in `chat/model.ts` tested in vitest's node environment, and refusal rendering is covered there (`refusalText`)

### 2026-10-25 — Review pass (follow-up 2)
- diff (`git diff e325035 -- . ':(exclude)_bmad-output'`, 217 KB, 19 files) handed to both layers as the file /tmp/tk-32-7-pass3.diff rather than inlined
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 4 (high 0, medium 1, low 3)
- addressed_findings:
  - `[low]` `[patch]` a verb-less 409 `EngagementClosed` (the `POST /chat/{id}` shape, api.ts:591/607) rendered "nothing cannot be sent": `refusalText` now reads "nothing more can be sent" without a verb (text with a verb unchanged); model.test.ts asserts both verb-less cases
- rejected (one line each): proposal payloads skip the screen controls' checks (a `go {}` in partial, an unoffered autonomy) and older lines' proposals stay live: AC1 pins "a button sending exactly that input", Boundaries pin cell-only gating, the server's 400/409 is the authority and renders by name (rejected before for older lines); the stepper ticks a skipped `awaiting-answers` and `cancelled` without a matching line falls back to `intake`: Settled shape 4 defines the main path and the side-exit anchor only, the fallback is the accepted pass-1 DRIFT; the transcript is not re-read on wake and a posted line waits for the stream: the stream's self-reopen (silence/visibility/backoff) resumes by `?since=<last seq>`, replaying every missed line, which is AC1's "the stream keeps the transcript live"; no cookie-session test for `GET /runs/{id}` `cost_usd`: already permitted by `cookieRoute` (api.ts:1050), rejected in pass 1, plumbing

## Design Notes

Settled shapes (from plans/32-7.md, recorded here since SPEC.md was not appended):
1. **CAP-14 cost on hover** (optional entry): `GET /runs/{id}` gains `cost_usd: number | null` = ledger `job-run` `total_cost_usd` for the run's `studio_run_id`; null with no studio run id or no metered line. Web fetches lazily once per planner line's `run_id` on first hover/focus, cached per run; null shows `not metered`.
2. **Project and CSRF**: `?project=<id>` on every engagement read/post; token from `GET /inbox?project=<id>`, re-read on project change; no token → sends disabled.
3. **ACTIONS**: `go` in intake, awaiting-answers, scoping, partial (`{cap}` in partial); `revise` in scoping, quoted, approved, in-progress, paused, partial; `approve` in quoted; `answer` in awaiting-answers; `cancel` and `question` in every open state; nothing in delivered/failed/cancelled.
4. **Stepper**: main `intake → awaiting-answers → scoping → quoted → approved → in-progress → delivered`; side exits `paused`, `partial`, `failed`, `cancelled` marked against the step they left = newest `inputs[]` line's `from` when its `to` is the side exit, else the closest main step.
5. **Nav count**: office `engagements[]` rows (snapshot + deltas) with state `awaiting-answers` or `quoted`, across projects; null/zero shows no count, as the Inbox.
6. **Remembered engagement**: `tk-studio.web.chat` = `{project, id}`.
7. **Approval copy**: Approve sends `{verb: approve, autonomy, base_ref?}` (base_ref only when non-blank); `approved` reads "approved; the run starts when the plan PR merges"; no PR link; `partial` shows `runs_usd` against `quote.cap` with **Go** taking a positive `{cap}`; `paused` says "reply `continue` on the engagement's Jira issue".

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green (only the 3 released-roster guards may be red, unverifiable-here)
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/studio-web && PATH=~/.bun/bin:$PATH bun run verify` -- expected: green
- `cd apps/supervisor && bun test test/api.test.ts && bun test` (TK_STUDIO_ROOT set, TK_ATLASSIAN_* unset) -- expected: 0 fail
- `cd apps/supervisor && bun node_modules/typescript/bin/tsc --noEmit` -- expected: clean
- `grep -n "0.1.27 (Story 32.7)" plugins/tk-studio/contracts/driver-contract.md` hits; `grep -c "\*\*0.1.28\*\*" plugins/tk-studio/contracts/driver-contract.md` is 0
- `git status --porcelain` -- expected: only the Files above (plus this spec)

**Manual checks:**
- Visual run on the desktop and iPad (attended, unverifiable-here).

## Deviation Summary

### pass 1 (2026-10-25)

- planned: watchdog reopen resumes with `Last-Event-ID` = last seq / actual: a fresh EventSource cannot set that header, so self-reopens use `?since=<last seq>` (the route reads it equivalently); browser-native reconnects still send `Last-Event-ID` / why: browser API limit / may affect: none
- planned: one `0.1.27 (Story 32.7)` clause / actual: also appended "Story 32.7" to the contract's "Story / rulings" row as 32.1–32.6 did, pinned / why: precedent / may affect: 32-8 (its pin should expect "Story 32.7" in the row)
- planned: stepper side exit marked against the newest `inputs[]` line's `from` when its `to` is the exit, else the closest main step / actual: newest line with `to` = exit and `from` ≠ exit; a side-exit `from` (e.g. `partial → cancelled`) is traced back the same way; no line → `in-progress` for paused/partial/failed, `intake` for cancelled / why: a `question` in `paused` logs `paused → paused`; "closest" was undefined / may affect: none
- note (not a deviation): an Ask control sends `question`, which ACTIONS allows in every open state.

DEVIATION SCORE: 1

DRIFT: chat stream self-reopen resumes by `?since=` not `Last-Event-ID` — EventSource cannot set headers — affects: none
DRIFT: "Story 32.7" added to the contract's Story/rulings row — follows 32.1–32.6 precedent — affects: 32-8
DRIFT: stepper side-exit anchor skips self-loops and traces chained exits; fallback steps defined — "closest main step" undefined and `question` logs self-loops — affects: none

Completion notes (consult DO): the chat reopen resumes by `?since=` and the browser's own retry by `Last-Event-ID`; the "Story / rulings" row now ends "Story 32.6, Story 32.7 (Epic 32)"; the stepper skips self-loops and follows side-exit chains.

Verify (pass 1): lib suite 1974 OK (2 skipped); conformance ok: true; studio-web `bun run verify` red in the worktree on `bun install --frozen-lockfile` (sandbox EPERM on symlinks, as epics 30–31), green in a /tmp copy (build OK, vitest 12 files / 173 tests); supervisor api.test 91 pass, full bun test 1353 pass 0 fail 5 skip; tsc clean; 0.1.27 (Story 32.7) grep hits, **0.1.28** count 0; git status names only the plan Files + this spec.

### pass 2 (2026-10-25, review patches)

- planned: Settled shape 1 / I/O row "fetched once per run_id, cached" / actual: only a metered cost is cached; null shows `not metered` and is re-read on the next hover/focus; a failure shows nothing and is retried; one fetch in flight per run_id; the 32.7 contract clause, its pin and the studio-web README reworded to match / why: review finding (a ledger line landing after the first hover never showed) / may affect: none
- the three pass-1 deviations unchanged.

DEVIATION SCORE: 1

DRIFT: run cost cached only when metered; null/failure re-read on next hover (32.7 clause, pin, README reworded) — caching null for good hid late ledger lines (review finding, consult accepted score 1) — affects: none

## Consult Log

- 2026-10-25T16:02:43Z — trigger: deviation-gt-0 — question: accept the three score-1 deviations (since-resume, Story/rulings row, stepper self-loop rule)? — ruling: accept-deviation score 1 — do: keep all three as implemented; record the since/Last-Event-ID resume, the rulings row "Story 32.6, Story 32.7 (Epic 32)", and the stepper self-loop/chain rule in completion notes — rule candidate: planner: write side-exit prior step as "newest line with to = exit and from ≠ exit, traced back through side exits"; specify ?since= resume alongside Last-Event-ID for client-opened SSE
- 2026-10-25T16:15:34Z — trigger: deviation-gt-0 (review pass 1 patch) — question: accept the run-cost cache rule change (cache only metered; null/failure re-read) and the reworded 32.7 clause/pin? — ruling: accept-deviation score 1 — do: keep the patch; record it as a deviation from the I/O row and Settled shape 1; leave `GET /runs/{id}` `cost_usd` and earlier pins unchanged — rule candidate: "cached" for a lazily read nullable value means only a non-null result is cached; null and failed reads re-read on the next trigger, one read in flight per key (observe record: "ok": true)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (effort medium, advisor off); knowledge spine absent

**Summary (follow-up review pass 2):** The story 32.7 Chat screen (sixth studio-web screen; chat SSE with watchdog; stepper, cards, quote band, Approve/Go/Cancel/Revise, proposals, New engagement; `GET /runs/{id}` `cost_usd` with the 0.1.27 clause and pin) was reviewed a third time over the full diff from `e325035ae470150344208409cbdd3e481fed4d21` (Blind Hunter + Edge Case Hunter, band L). One low patch fixed the refusal text of a verb-less `EngagementClosed`.

**Files changed in this pass:**
- `apps/studio-web/src/chat/model.ts`: `refusalText` `EngagementClosed` reads "nothing more can be sent" when the refusal names no verb
- `apps/studio-web/src/chat/model.test.ts`: the verb-less `EngagementClosed` cases (with a state, and with neither)

**Review:** 1 patch applied (low 1), 0 deferred, 4 rejected (see Review Triage Log). Follow-up review recommended: false (patched high 0, medium 0, low 1; score 3×0+1 = 1 < 5).

**Verification:**
- studio-web: `bun run verify` fails at the frozen install in the worktree (sandbox EPERM on symlinks, as before); run directly: vitest 12 files / 177 tests passed (chat files 2 / 39 re-run by this session), `tsc --noEmit -p .` clean, `vite build` OK (dist/ ignored)
- lib suite `uv run python -m unittest discover tests`: 1974 OK (2 skipped); conformance `runner.py run`: `ok: true`
- supervisor and contract: untouched in this pass (pass-1 results stand)
- `git status --porcelain`: only the two plan Files above plus this spec

**unverifiable-here (operator):** run `cd apps/studio-web && bun run verify` on the host (or `uv run python tools/verify_host.py`); re-run `cd apps/supervisor && bun test` once /tmp inodes are freed; check the screen visually on the desktop and the iPad.

**Residual risks:** `ACTIONS` mirrors `TRANSITIONS` by hand (the server's 409 is the backstop). Proposal buttons send their payload unchecked by the screen's own control rules (by AC1; the server refuses by name). A quiet chat stream reopens every 15 s (heartbeats are SSE comments). The stepper ticks main steps an engagement skipped. ChatScreen's composition logic has no render-level tests. The host's /tmp/$HOME filesystem is almost out of inodes (~1,140 free).

DRIFT: chat stream self-reopen resumes by `?since=` not `Last-Event-ID` — EventSource cannot set headers — affects: none
DRIFT: "Story 32.7" added to the contract's Story/rulings row — follows 32.1–32.6 precedent — affects: 32-8
DRIFT: stepper side-exit anchor skips self-loops and traces chained exits; fallback steps defined — "closest main step" undefined and `question` logs self-loops — affects: none
DRIFT: run cost cached only when metered; null/failure re-read on next hover (32.7 clause, pin, README reworded) — caching null for good hid late ledger lines — affects: none

## Reconcile

- 2026-10-25 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 32-8-delivery-the-closeout-report-and-change-requests
