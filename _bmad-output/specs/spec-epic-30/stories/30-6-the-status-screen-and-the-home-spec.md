---
title: 'The Status Screen and the Home'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '307bb3bb28e0a5e5672820e669bf962c9f1c0e53'
deviation_score: 1
reconcile_verdict: not-required
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-30/plans/30-6.md'
  - '{project-root}/_bmad-output/implementation-artifacts/replan-queue.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The web is not the home: a signed-in `GET /` still answers the read-only page, the web remembers no screen, and it has no Status screen. AC2's queue counts, ledger tail and supervisor version are on no web-read surface (the replan-queue item "operator — from 30-5-the-board-screen — 2026-10-19", ruled (b) by the operator in commit 307bb3b).

**Approach:** A signed-in `GET /` answers the built web's `index.html`, and the read-only page moves to a content-negotiated `GET /status`. Per ruling (b), the office snapshot gains `supervisor {version, counts}` and a ledger tail additively in 0.1.25. A new Status screen renders from the one store, and a remembered screen key switches Office, Board and Status. The contract §1, the runbook §4, the READMEs and the page tests follow the new address.

Acceptance criteria, verbatim from `epics.md` "### Story 30.6":
- AC1: **Given** the web built and the account signed in **When** `GET /` is requested with a session **Then** the supervisor answers the web's `index.html` (the Office screen opens by default; the last screen is remembered per browser) and the read-only page moves to `GET /status`, linked from the web's Status screen and answered without JavaScript as today; with no session, `GET /` is the sign-in page; the bearer API and every `/jobs`, `/runs`, `/agents`, `/office` and `/board` route are unchanged
- AC2: **Given** the Status screen **When** it renders **Then** it shows the queue's counts and live runs, the agents, the office section, the ledger's last events and the supervisor's version, each from the surfaces the web already reads (no new surface), and refreshes from the store rather than polling
- AC3: **Given** the move of the home **When** the story closes **Then** the contract's §1 names `GET /status` as the read-only page's address and `GET /board` among the web surfaces (0.1.25, additive), the runbook §4 and the supervisor README say the web is the home and how to build it, and the status page's tests and the conformance suite's status drive follow the new address

Operator ruling (b), verbatim from `replan-queue.md`: "extend GET /office's snapshot additively in 0.1.25 with supervisor {version, counts} and a ledger tail (the last events of the host ledger the supervisor already reads), plus the contract section 1 row and note; the web's Status screen reads them from the one stream it already holds. /status is content-negotiated (HTML gives the page, anything else today's JSON) so the bearer API, set-supervisor-env.ps1 and the runbook's curl stay unchanged. SPEC Open Question 3: no conformance drive requests the page, so the supervisor's page tests are the drives that follow /status."

## Boundaries & Constraints

**Always:**
- `GET /status` whose `Accept` contains `text/html` answers the page (`page(csrf)`). Any other `Accept` (none, `*/*`, `application/json`) answers today's JSON `{ok, counts, live, locks}` byte for byte, for a bearer and a cookie alike. Both answers carry `vary: Accept`.
- A signed-in `GET /` (cookie or bearer) with the web built answers `index.html` as `GET /app` does (`cache-control: no-store`). With the web not built it answers the read-only page as today, with its "not built" note, never a 503. With no session it is the sign-in page, unchanged.
- With no session, an HTML `GET /status` answers the sign-in page with `next=/status`. A non-HTML one stays 401 JSON.
- The snapshot (`GET /office`, the JSON `GET /office/events` and the stream's `event:snapshot`) gains top-level `supervisor: {version, counts}` and `ledger`, and nothing else:
  - `version` is `apps/supervisor/package.json` `version`.
  - `counts` is per-state over all queue runs, the same as `/status` `counts`.
  - `ledger` is `{path, lines}` or `{path, note}` from the same tail as the page (`LEDGER_LINES`, the same path and notes), with every line passed through `redactCredentials` (NFR5).
- Deltas, kinds, ids and every existing snapshot field are unchanged.
- The store keeps `supervisor` and `ledger` from each snapshot. Deltas keep them as they are. `lastEventAt` semantics are unchanged: these fields are not an event.
- Status screen: live runs = `view.runs` filtered `state !== null && LIVE_RUN_STATES.has(state)`. It shows the counts, live runs, agents, office section (runs' epic/stories, agents' state/reason, `problems`, `last_run`), ledger lines or note, and version. It re-renders on store change with no timer. Its link to the page is a plain `<a href="/status">` (absolute, because of `<base href="/app/">`).
- Remembered screen: key `tk-studio.web.screen`, values `office` | `board` | `status`. Absent, unknown or a throwing storage gives `office`. Storage is injectable, modelled on `rememberedProject`/`rememberProject` (`office/model.ts`).
- One OfficeScreen mount at a time: never a second Pixi Application, `Assets.load(` or `new EventSource(`.
- The contract appends a `0.1.25 (Story 30.6)` clause to header line 5 after the 30.5 clause, adds a §1 row for the read-only page at `GET /status` (and the web at `GET /`), and adds a 30.6 note sentence naming the snapshot's `supervisor` and `ledger`. No version bump. The 30.4 and 30.5 clauses are not reworded.
- Stay within the Files list in Code Map (the plan's seventeen plus the four the ruling names).

**Block If:**
- The Files list must grow beyond the twenty-one in Code Map.
- `/status` JSON without `text/html` would change in any byte.
- Making the gate pass needs a version bump, or rewording the 30.4 or 30.5 clause.

**Never:**
- A new route, a new delta kind, or a field on a delta.
- Polling or `setInterval` in `src/status`.
- Editing `epics.md`, `stories.yaml`, SPEC.md or anything under `supervision/`.
- Push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| home, built | cookie or bearer `GET /`, `dist/index.html` present | 200 `index.html`, no-store | — |
| home, not built | cookie `GET /`, no web | 200 the read-only page with the "not built" note | never 503 |
| home, no session | `GET /` with no auth | the sign-in page, as today | — |
| status HTML | cookie `GET /status`, `Accept: text/html` | 200 the page (with CSRF cancel forms), `vary: Accept` | — |
| status JSON | bearer or cookie `GET /status`, `Accept` none/`*/*`/`application/json` | today's JSON byte for byte, `vary: Accept` | — |
| status, no session | `GET /status` with no auth | HTML → sign-in page with `next=/status`; otherwise 401 JSON | — |
| snapshot extras | `GET /office` | has `supervisor.version` = package version, `supervisor.counts` = `/status` counts, `ledger.lines` the redacted tail | missing ledger → `{path, note: "<path> not found"}` |
| ledger secret | ledger line holding the API token | the line carries `[redacted]`, never the token | — |
| store keeps extras | snapshot with extras, then a delta | `supervisor`/`ledger` unchanged by the delta; a later snapshot replaces them | snapshot without them → absent/null in view |
| remembered screen | storage `status` / `bogus` / absent / throws | `status` / `office` / `office` / `office` | swallow storage errors on write |
| live-run filter | store runs with `state: null` and terminal states | excluded from the Status screen's live runs | — |

</intent-contract>

## Code Map

The investigation is `plans/30-6.md` "Code Map" (load it; its line anchors stand). Additions for ruling (b):
- `apps/supervisor/src/api.ts` -- the office hub `office` at :236. The snapshot is served at :387 (JSON `/office/events`), :420-421 (SSE `event:snapshot`) and :679 (`GET /office`). Wrap all three in one local `officeSnapshot()` that adds `supervisor` and `ledger`, and leave `office.ts` untouched. `status()` :275-282 holds the counts rule. `route()`'s `/` is :655 and `/status` :662. The no-session branch is :643-644.
- `apps/supervisor/src/page.ts` -- `LEDGER_LINES` :46, `tailLines` :151, the ledger read :258-262 (`deps.ledger ?? {user: ledgerUser(env), machine: hostname()}`), `redactCredentials(text, env, token)` :329. Export one helper (for example `readLedgerTail(env, who)`) that both `gatherPage` and api.ts use, so the page and the snapshot read the same tail.
- `apps/supervisor/package.json` -- `"version": "0.1.2"` (read only; import or read it once).
- `apps/supervisor/test/office.test.ts` -- the `GET /office` / stream tests. Add the snapshot-extras cases. Adjust any exact-key assertion only to accept the two new keys.
- `apps/studio-web/src/live/store.ts` -- `OfficeView` :64-70, `applySnapshot` :247-260, `sameContent` :221 (leave its four fields). Mirror the types `SupervisorInfo {version, counts}` and `LedgerTail`, and add optional `supervisor` and `ledger` to the view, set from the snapshot.
- `apps/studio-web/src/live/store.test.ts` -- the extras kept across deltas and replaced by a snapshot. `lastEventAt` is unchanged by an extras-only snapshot change.
- `apps/studio-web/src/App.tsx` -- `Screen` and `SCREENS` :16-17, the screen state :22 and the nav :33-39.
- Conformance's "status drive" (SPEC Open Question 3, settled by the ruling): no conformance drive requests the page, so the supervisor page tests are the drives that follow `/status`. The conformance runner must still answer `ok: true`.

**Files (21):** the plan's seventeen (`apps/supervisor/src/api.ts`, `apps/supervisor/src/web.ts`, `apps/supervisor/test/{web,page,auth,account}.test.ts`, `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md`, `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py`, `apps/studio-web/src/screen.ts`, `apps/studio-web/src/screen.test.ts`, `apps/studio-web/src/status/model.ts`, `apps/studio-web/src/status/model.test.ts`, `apps/studio-web/src/status/StatusScreen.tsx`, `apps/studio-web/src/App.tsx`, `apps/studio-web/README.md`), plus the four the ruling names: `apps/supervisor/src/page.ts`, `apps/supervisor/test/office.test.ts`, `apps/studio-web/src/live/store.ts`, `apps/studio-web/src/live/store.test.ts`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/page.ts` -- export the ledger-tail helper and use it in `gatherPage` -- one tail for the page and the snapshot.
- `apps/supervisor/src/api.ts` -- route `/` and content-negotiate `/status` per Always. The no-session HTML `/status` goes to sign-in with `next`. Add `officeSnapshot()` with `supervisor` and `ledger` (redacted). Append `GET /status` (page or JSON) and the new `/` to the header route comment -- AC1, AC2.
- `apps/supervisor/src/web.ts` -- only if needed, a helper serving `index.html` for `/` (`resolveWebPath(root, "/app")`) -- AC1.
- `apps/supervisor/test/web.test.ts`, `page.test.ts`, `auth.test.ts`, `account.test.ts`, `office.test.ts` -- invert web.test :163-173. Move the page reads to `GET /status` with `Accept: text/html`. Cover every supervisor matrix row. Change auth and account tests only where they fail -- AC1, AC2, AC3 (the drives follow the address).
- `apps/studio-web/src/live/store.ts` + `store.test.ts` -- the extras in the view -- AC2.
- `apps/studio-web/src/screen.ts` + `screen.test.ts` -- `SCREEN_KEY`, `rememberedScreen(storage?)`, `rememberScreen(screen, storage?)` -- AC1.
- `apps/studio-web/src/status/model.ts` + `model.test.ts` -- a pure `statusView(view)` with the counts, live runs (filtered), agents, office section, ledger, version, and `STATUS_PAGE_URL = "/status"` -- AC2. The tests use a fixture including `state: null` rows.
- `apps/studio-web/src/status/StatusScreen.tsx` -- renders `statusView` from the store via `useSyncExternalStore`, with the link `<a href="/status">` -- AC1, AC2.
- `apps/studio-web/src/App.tsx` -- the Status screen joins the nav. The screen comes from `rememberedScreen()` (Office default) and is saved on switch. Update the header comment -- AC1.
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the header clause, the §1 row and the note per Always. Add `test_0_1_25_names_the_status_page`, which pins the 30.6 phrases (`GET /status`, `supervisor`, `ledger`, the web at `GET /`) and that the version stays 0.1.25 -- AC3.
- `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md` §4 (and the phone section :1133-1155), `apps/studio-web/README.md` -- the web is the home, how to build it (`WEB_BUILD_COMMAND`), `/status` page vs JSON, the Status screen -- AC3.

**Acceptance Criteria:**
- Given a cookie session and a built web, when `GET /` is requested, then 200 `index.html`; and when `GET /status` is requested with `Accept: text/html`, then the page renders without JavaScript (supervisor tests).
- Given a bearer, when `GET /status`, `/jobs`, `/runs`, `/agents`, `/office` and `/board` are requested as today, then each answer is unchanged except for the snapshot's two additive keys, and the `/status` JSON is unchanged byte for byte (page.test :171-177 still green).
- Given a store fed a snapshot with extras, when the Status screen's model is computed, then it holds the counts, version, ledger lines, filtered live runs, agents and office section (vitest), and `src/status` holds no `setInterval(`.
- Given the contract, when `test_driver_contract.py` runs, then the 30.6 phrases are pinned, the 30.4 and 30.5 tests stay green, and the version is still 0.1.25.

## Spec Change Log

## Review Triage Log

### 2026-10-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 1, low 2)
- defer: 0
- reject: 2 (low 2): the extras stay stale while deltas flow, which is the accepted limit of ruling (b)'s snapshot-only shape (Design Notes; no new delta per Never); `wantsHtml` ignores q-values, which matches the Always rule "`Accept` contains `text/html`"
- addressed_findings:
  - `[high]` `[patch]` Snapshot ledger lines were redacted by text only, while the page redacts by key (NFR5). Added the exported `redactLedgerLine` in page.ts, used in `officeSnapshot()`, with an office.test case for `{"secret":["hunter2"],…}` (consult ruling: patch)
  - `[medium]` `[patch]` The contract §1 `GET /office` row did not name the snapshot's `supervisor` and `ledger`. A 0.1.25 (Story 30.6) clause was added to the row
  - `[low]` `[patch]` The no-session `/status` answers (the sign-in page and the 401 JSON) lacked `vary: Accept`. Added, and asserted in web.test
  - `[low]` `[patch]` The 30.6 header clause was circular ("answers the web at `GET /`"). It was reworded to "answers the built web's `index.html`, falling back to the read-only page", and the contract test pins the new phrase

### 2026-10-19 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1 (low 1)
- defer: 0
- reject: 4 (low 4): (1) the extras go stale while deltas flow, raised by the blind hunter and both edge-case findings (including replay on a reconnect inside the buffer). This is the accepted shape of ruling (b): snapshot-only, with no new delta per Never. The web README and the Design Notes record it. (2) `supervisorVersion()` may return "unknown" outside a checkout. The release zip ships `apps/supervisor` whole (`tools/release_archive.py:86`), the same layout `registry.ts` `PERSONAS_PATH` relies on. (3) Nothing tests that App.tsx is wired to the remembered screen. The helpers are unit-tested in `screen.test.ts`, the wiring is plumbing, and the attended check (the remembered screen across reloads) covers it.
- addressed_findings:
  - `[low]` `[patch]` The ledger tail was redacted by two code paths: `renderPage` still redacted inline, although the pass-1 consult ruling required it to use `redactLedgerLine`. `renderPage` now maps each line through `redactLedgerLine` and escapes it (`page.ts:489`). A page.test case asserts that the page's ledger line is exactly `redactLedgerLine`'s output and that the planted token is absent.

## Design Notes

- **Freshness of the extras.** They ride the snapshot only (ruling (b); no new delta, per the Never list). On a quiet office the stream's 15 s watchdog reopens and gets a fresh snapshot (`live/store.ts:11`, `live/stream.ts:8`), so the counts, ledger and version refresh then. While deltas flow, the counts can lag until the next snapshot. The live runs shown come from the store and are always current. This is an accepted limit of the ruling's shape, not a defect.
- **Wrap, not hub.** The extras are added in api.ts, around `office.snapshot()`, so `OfficeHub`'s diffing never sees them and `office.ts` stays out of Files.
- Example snapshot extras: `{"supervisor":{"version":"0.1.2","counts":{"done":4,"running":1}},"ledger":{"path":"measurements/agent-box.jsonl","lines":["{…}"]}}`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `rm -rf /tmp/v306 && mkdir -p /tmp/v306 && git ls-files -co --exclude-standard apps/studio-web apps/supervisor | tar -cT - | tar -xC /tmp/v306 && cd /tmp/v306/apps/supervisor && bun install --frozen-lockfile && bun test test/web.test.ts test/page.test.ts test/auth.test.ts test/account.test.ts test/office.test.ts && bun run typecheck` -- expected: green (the sandbox refuses symlinks in the worktree, so the copy is the record)
- `cd /tmp/v306/apps/supervisor && bun test` -- expected: only the 8 known location-caused failures (plan 30-6 Verify). Any new failure is red.
- `cd /tmp/v306/apps/studio-web && bun install --frozen-lockfile && bun run build && bun run test` -- expected: green
- `grep -rn "Assets.load(" apps/studio-web/src | grep -v test` -- expected: one hit (scene.ts). `grep -rn "new EventSource(" apps/studio-web/src | grep -v test` -- expected: one hit (stream.ts). `grep -rn "setInterval(" apps/studio-web/src/status` -- expected: none.
- `uv run python tools/verify_host.py` -- expected: pass (binding host leg; if the sandbox cannot run it, record it as unverifiable-here, with this command)

**Manual checks (unverifiable-here):** the attended landing on `/` from the desktop and the iPad, the remembered screen across reloads, and `/status` in a browser with JavaScript off.

## Deviation Summary

None. No code was planned or touched: the story halted at activation, before step-01 planning.


### pass 1 (2026-10-19)

- planned: the plan's Code Map says the Status screen's agents come from `view.agents` plus `GET /agents` / actual: agents come from the store's `view.agents` only (state, reason, current run and story); `src/status` makes no fetch / why: the snapshot already carries every registry agent once, and a second read in `src/status` would add a refresh path outside the store, against AC2's "refreshes from the store" / may affect: none
- DEVIATION SCORE: 1 (accepted by consult, score 1)

DRIFT: Status screen agents from the store's `view.agents` only, not plus `GET /agents` — the snapshot already lists every registry agent and AC2 requires refreshing from the store — affects: none

### pass 2 — follow-up review (2026-10-19)

- No deviation. The one patch stays inside Files (`apps/supervisor/src/page.ts`, `apps/supervisor/test/page.test.ts`). DEVIATION SCORE for this pass: 0, and the story's score stays 1.

## Consult Log

- 2026-10-19T22:49:16Z — trigger: halt — question: may the session pick 30.6 AC2 option (a)/(b)/(c) itself while the replan-queue item "operator — from 30-5-the-board-screen" is still `Status: open`, or must it HALT blocked? — ruling: apply — do: HALT `blocked` with the condition "operator ruling on 30.6 AC2 (queue counts, ledger tail, version on no web-read surface) is open in the replan queue, section 'operator — from 30-5-the-board-screen — 2026-10-19'; choose (a), (b) or (c) per plans/30-6.md Block If"; do not pick (a), (b) or (c), and do not edit epics.md AC2, the contract §1 or the `/status` JSON; resume only after a `ruling:` commit records the choice — rule candidate: When a plan's Block If points to a replan-queue item still marked `Status: open` and no `ruling:` commit names it, the session halts `blocked` at once without a consult. (observe.py record: ok)
- 2026-10-19T22:52:36Z — trigger: halt — question: spec is `ready-for-dev` after the post-ruling re-dispatch but has no intent contract, tasks or Verification; route to step-03 (A), re-plan as draft via step-02 (B), or HALT (C)? — ruling: apply — do: take (B): set `status: draft`, EARLY EXIT to step-02, plan from epics.md Story 30.6, plans/30-6.md and the 307bb3b AC2 option (b) ruling; keep Deviation Summary and Consult Log append-only; let step-02's gate set `ready-for-dev` — rule candidate: Under folder+id dispatch, a story spec marked `ready-for-dev` or `in-progress` with no intent contract, Tasks & Acceptance or Verification section is routed as `draft` without a consult. (observe.py record: ok)
- 2026-10-19T23:16:19Z — trigger: deviation-gt-0 — question: accept the implementer's deviation (Status screen agents from `view.agents` only, no `GET /agents` read) or reject it? — ruling: accept-deviation score 1 — do: keep agents from the store's `view.agents` with no fetch in `src/status`; record in the dev record that the plan's "plus `/agents`" was dropped and why — rule candidate: When a story AC says a screen "refreshes from the store", the planner's Code Map sources every field of that screen from the store's view, never a direct REST read beside it. (observe.py record: ok)
- 2026-10-19T23:25:41Z — trigger: high-severity-finding — question: triage of the snapshot ledger lines redacted by text only (the page redacts by key via redactValue), patch or defer? — ruling: apply — do: patch, high: export `redactLedgerLine(line, env, token)` from page.ts (JSON.parse → redactValue with redactCredentials → compact stringify → redactCredentials; text fallback), used by the page render and `officeSnapshot()`; add an office.test.ts case `{"secret":["hunter2"],"note":"<api token>"}` asserting neither value appears and `[redacted]` does — rule candidate: Any supervisor surface that sends host-file content the read-only page also renders uses the page's exported redaction helper, never text-only `redactCredentials`; a mismatch is a high-severity patch in the story that adds it. (observe.py record: ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was a follow-up review of the done story 30-6 (the web is the home, `/status` content-negotiated, the snapshot's `supervisor {version, counts}` and the redacted `ledger` tail, the Status screen, the remembered screen). Both layers ran, because the plan's band is L. The pass applied one low patch: the read-only page and the office snapshot now redact ledger lines through the one exported `redactLedgerLine`.

**Files changed (this pass):**
- `apps/supervisor/src/page.ts` -- `renderPage`'s ledger section maps each line through `redactLedgerLine`; the doc comment names both callers.
- `apps/supervisor/test/page.test.ts` -- a test that the page's ledger line equals `redactLedgerLine`'s output (NFR5).

**Review:** 1 patch applied (low 1), 0 deferred, 4 rejected (see the Review Triage Log). Follow-up review recommended: false. Only one low finding was patched: score 3×0 + 1×1 = 1, below 5.

**Verification:**
- `uv run python -m unittest discover tests`: 1417 OK (2 skipped). `runner.py run`: `ok: true`.
- In the /tmp/v306 copy: `bun test` on web, page, auth, account and office: 184 pass, 0 fail. `bun run typecheck` is clean.
- `grep -rn "setInterval(" apps/studio-web/src/status`: no hits.
- unverifiable-here (unchanged from pass 1):
  - The binding host leg, `uv run python tools/verify_host.py`.
  - The attended checks: landing on `/` from the desktop and the iPad, the remembered screen across reloads, and `/status` with JavaScript off.

**Residual risks:** The Status screen's queue counts and ledger tail refresh only when a snapshot arrives (ruling (b)). While deltas flow, or after a reconnect replayed from the buffer, they can lag behind the live-run list. /tmp inodes stood at 94% use.

## Reconcile

- 2026-10-19 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 30-7-our-own-assets (Block If: the art tool, SPEC Open Question 1 — operator ruling in the replan queue)
