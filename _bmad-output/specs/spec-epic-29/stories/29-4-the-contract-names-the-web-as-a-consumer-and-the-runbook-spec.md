---
title: 'The Contract Names the Web as a Consumer and the Runbook Follows'
type: 'chore'
created: '2026-10-18'
status: 'done'
baseline_revision: '6dce189c3d7d6ec43daf4bf04fecf9a6b13d9e0a'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-29/plans/29-4.md'
  - '{project-root}/_bmad-output/specs/spec-epic-29/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Stories 29.1–29.3 added supervisor surfaces the studio web of EP-30 consumes (the account, the registry, the office projection). The driver contract names neither them nor the web as a consumer, and the runbook (§4.2, §4.5, §7) and the supervisor README must match the code. AD-2: the plugin publishes the contract; the supervisor owns these surfaces.

**Approach:** Docs and tests only. An additive contract bump to **0.1.24** names the studio web among the consumers in §1 and documents the surfaces as the supervisor's, never the plugin's. The runbook and README are brought into line. No code change; `tk-studio doctor` unchanged.

User story (verbatim): As a driver author, I want the driver contract to name the studio web as a consumer and the supervisor's new surfaces as supervisor surfaces, So that AD-2 holds: the plugin publishes the contract, the supervisor owns the account, the registry and the projection (spec §6.1).

**AC1 (verbatim):** **Given** `plugins/tk-studio/contracts/driver-contract.md` **When** the story closes **Then** a minor bump (the next after Story 28.6's) names the studio web among the consumers in §1 and documents, as supervisor surfaces consumed by the web and never plugin surfaces, the account (`POST /auth/account`, `POST /auth/signin`), the registry (`GET /agents`) and the projection (`GET /office`, `GET /office/events`, the three `office.*` event kinds and the eight states); nothing in the plugin's own surfaces changes; conformance is green and the lib suite is green

**AC2 (verbatim):** **Given** the operator's runbook and the supervisor's README **When** the story closes **Then** runbook §4.5 (the smoke test) signs in with the account and keeps the token path for `curl`; §4.2's table drops the OAuth rows and names nothing new that is a secret (the account record is the store's); §7's smoke table gains the `/agents` and `/office` answers; the README's API table and environment table match the code; `tk-studio doctor` is unchanged

## Boundaries & Constraints

**Always:**
- The version is **0.1.24**: clause `0.1.24 (Story 29.4) … — additive` appended after the `0.1.22 (Story 28.2)` clause, bold version moved to `**0.1.24**`. Never write a 0.1.23 clause (main's Story 28.6 holds it; a merge inserts it). Tests must pass whether a 0.1.23 clause is present or absent.
- The new §1 subsection opens by stating these are supervisor surfaces (AD-2): the plugin publishes their description but neither implements nor serves them.
- The projection text documents the landed rules (29-3 reconcile): the eight states `offline idle thinking reading typing running waiting-for-human blocked`; kinds `office.agent`, `office.progress`, `office.run`; snapshot-first frame, `<boot>-<seq>` ids with `Last-Event-ID` replay (snapshot again when too old or another boot), 10 s heartbeat, `overlay` `done|failed|null`; (a) emission rules, (b) run-selection order, (c) row-5 `thinking` / row-10 host-verify `running` predicates, (d) progress source (denominator from first `stories-validated`; `done` from journal terminal kinds plus story specs `status: done`; the journal wins) — stated or linked to the README "office projection (Story 29.3)" bullet.
- §7 row 6 keeps the phrases `studio supervisor`, `status page`, `Hermes`, `front door`, `grows no UI`. The web is a consumer, not a driver: never add it to the Driver roster table.
- Studio house rules: stdlib-only Python, no credential in tracked files.

**Block If:**
- The branch header already reads `**0.1.23**` or later from anything other than Story 28.6 (never renumber another story's clause).
- Documenting a surface requires a code change (an undocumented response field that is also wrong): record it, never edit `apps/supervisor/src`.

**Never:**
- Edit `apps/supervisor/src`, `apps/supervisor/test`, `tools/installer/**` (incl. `doctor.py`), `plugins/tk-studio/lib/*.py`, `plugins/tk-studio/lib/tests/test_installer_doctor.py`, `plugins/tk-studio/skills/**`, or the plugin's own contract surfaces (§2 skill table, §3 status block, §4 verbs, §5 routing, §6 drift check, §8 conformance) or schemas.
- Put `OFFICE_MAP`'s `when`/`signal` columns or the helper exports (`OFFICE_RANK`, `mapRoles`, `selectRun`, `engineRunDir`, `LIVE_RUN_STATES`, `officeStates`, `officeCachedPaths`, `specsDone`, `launchedSinceMove`) in the contract.
- Name a new secret in runbook §4.2; push, tag, release, or bump the gate versions.

</intent-contract>

## Code Map

- `plugins/tk-studio/contracts/driver-contract.md` -- `:5` version header (one table cell; last clause `0.1.22 (Story 28.2)`; bold `**0.1.22**`); `:7` Audience row (drivers only; may add the web as a consumer only); `:18-42` Change policy (additive = patch bump); `:43` §1; `:71` `### Driver roster (0.1.18)` — add after it a consumers paragraph naming the studio web and `### Supervisor surfaces the web consumes (0.1.24)`, its anchor linked from the header clause as `#project-root-0122` is; `:492-505` §7 dossier row 6 (keep the pinned phrases).
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- `:67-107` `test_carries_its_own_semver_and_change_policy` pins `\*\*0\.1\.22\*\*` at `:100` (move to 0.1.24; extend the history comment `:93-99`); `:133-137` row 6 phrases; `:181-200` `test_0_1_21_header_and_launch_row` slicing pattern (`header = next(line … startswith("| **Contract version**"))`). Add a survival check `assertNotIn("**0.1.22**", header)` and `test_0_1_24_names_the_web_and_the_supervisor_surfaces` pinning the clause (`— additive`), the five routes, the three kinds, the eight states, and the supervisor-not-plugin statement. Slices must not depend on 0.1.23's presence.
- `apps/supervisor/README.md` -- `:48-69` API table, `:55-58` agents/office rows, `:102` "The office projection (Story 29.3)" bullet (source for the contract text), `:262-286` environment table. Recheck against `src/`; known code-only names: `TK_SUPERVISOR_OAUTH_` prefix (documented ignored at `:286`) and `TK_SUPERVISOR_UNDER_TEST` (test seam). If it already matches, leave it and record the evidence. Read by `test/account.test.ts:23`.
- `apps/supervisor/src/api.ts` (read-only) -- routes `:549-551` auth (`/auth/token`, `/auth/account`, `/auth/signin`), `:566-567` cookie reads, `:599-615` `/`, `/jobs`, `/status`, `/events`, `/agents`, `/office`, `/office/events`, `:616-637` `/runs/{id}/…`.
- `apps/supervisor/src/office.ts` (read-only) -- `OFFICE_STATES`, `OFFICE_MAP` vocabulary.
- `kb/agent-pc-setup-runbook.md` -- `:982-1041` §4.2 Environment (no OAuth rows already; add a line that the account record is the store's `<TK_STUDIO_HOME or ~/.tk-studio>\supervisor\account.json`, not an env var); `:1098-1162` §4.5 Smoke test (bearer `curl /status` `:1103`; account prose `:1111-1137`; after-cut-over `:1139-1162`) — the smoke signs in with the account at `https://<TLS_NAME>:8787/` (page shows Agents and Office sections), `curl` stays on the bearer token, add bearer `curl` lines for `/agents` and `/office`; `:1273-1299` §7 `| Check | Command | Pass looks like |` — add rows `GET /agents` (each served project's seven roles with routed models), `GET /office` (`{ok:true, at, agents, runs}`), `GET /office/events` (`curl -N`: `event:snapshot` then `: heartbeat` within 10 s).
- `tools/installer/cli/tk_studio_cli/doctor.py`, `plugins/tk-studio/lib/tests/test_installer_doctor.py` -- read-only; must show no diff.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- write the 0.1.24 pins first; run once against the unedited contract and show it fails -- proves the test bites.
- `plugins/tk-studio/contracts/driver-contract.md` -- header clause + bold version; §1 consumers paragraph and the new supervisor-surfaces subsection (account, registry, projection with the landed rules); optionally Audience and §7 row 6 naming the web as a consumer -- AC1.
- `kb/agent-pc-setup-runbook.md` -- §4.2 note, §4.5 account sign-in + `/agents` `/office` curls, §7 three rows -- AC2.
- `apps/supervisor/README.md` -- only on a found mismatch with `src/` -- AC2.

**Acceptance Criteria:**
- Given the edited contract, when the lib suite runs, then the 0.1.24 test passes, it failed on the pre-edit contract, and `**0.1.22**` is no longer the bold version.
- Given the edited tree, when conformance runs, then `ok: true`.
- Given `git diff --stat 6dce189c3d7d6ec43daf4bf04fecf9a6b13d9e0a -- apps/supervisor/src apps/supervisor/test tools/installer plugins/tk-studio/lib/*.py plugins/tk-studio/skills plugins/tk-studio/contracts/schemas`, then it is empty.
- Given the runbook, when `grep -n OAUTH kb/agent-pc-setup-runbook.md` runs, then matches are only "leftover, ignored/delete" guidance, never a §4.2 table row; §4.5 shows an account sign-in step and bearer `curl` for `/status`, `/agents`, `/office`; §7 has the `/agents`, `/office`, `/office/events` rows.
- Given README vs `src/`, when the routes in `api.ts` and the `TK_SUPERVISOR_*`/env names in `src/` are diffed against the API and environment tables, then every name is documented (or the known exceptions are recorded).

## Spec Change Log

## Review Triage Log

### 2026-10-18 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` edge-case-hunter: the contract's `office.run` text omitted when it fires (appearing `from: null`, changing state, leaving the live set with its queue state or `null`; `office.agent`'s `from` null on first appearance; office.ts:586-608) — stated in "The stream." and pinned in the 0.1.24 test
  - `[low]` `[patch]` edge-case-hunter: the account rows omitted the refusals (401 `SignInRefused` without TLS or the session secret, 400 `AccountInvalid`, 500 `AccountRecordInvalid`) and the sign-in's JSON success — added, README linked for the rest
  - `[low]` `[patch]` blind-hunter: "creates … once" contradicted the documented reset — the row now says deleting the record from the console resets it (runbook §4.5)
- rejected (one line each):
  - blind-hunter, 0.1.23 gap and merge conflict: ruled by plan § Settled shape (never write 28.6's clause); recorded as a residual risk
  - blind-hunter, README JIRA row out of scope: AC2 requires the environment table to match the code; consult 1 accepted it
  - blind-hunter, cookie name/lifetime/CORS missing: the plan allows summarising shapes with a link to the README; cookie shape is Story 22.5's, unchanged
  - blind-hunter, runbook content untested: docs prose, plumbing; AC2 is shown by grep and inspection (Verification)
  - edge-case-hunter, README documents only the 303 for sign-in: false, README:71 documents the JSON `{ok:true,username}` answer
  - edge-case-hunter, malformed JSON 400 `MalformedJson` not in the contract: generic API answer, covered by the README link

### 2026-10-18 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 0, low 2)
- defer: 0
- reject: 5 (high 0, medium 0, low 5)
- addressed_findings:
  - `[low]` `[patch]` edge-case-hunter: the account routes answer `400 MalformedJson` to a JSON body that is not JSON (`api.ts:479` `accountBody`), documented in neither the contract nor the README's account error list (README:71), so the README did not match the code (AC2) — added to the contract's account row (driver-contract.md:106), to README:71 (`{ok:false,error:"MalformedJson",detail}`), and pinned in the 0.1.24 test
  - `[low]` `[patch]` blind-hunter: the README's new `JIRA_API_TOKEN`/`JIRA_EMAIL` row said "the §1 auth preflight", ambiguous inside the README — now "the driver contract's §1 auth preflight" (README:272)
- rejected (one line each):
  - blind-hunter, 0.1.23 gap in the version history and no test forcing 28.6's clause in on merge: the intent contract's Always forbids writing a 0.1.23 clause (main's 28.6 holds it); recorded as a residual risk
  - blind-hunter, README JIRA row out of scope: AC2 requires the environment table to match the code (consult 2026-10-18T04:17:14Z)
  - blind-hunter, `office.progress` `epic`/`story` and the snapshot's `runs`/`problems` shapes undefined in the contract: not a defect — the contract delegates the full shapes to the README by design (Design Notes), and README:56 defines `epic:{spec_folder, done, deferred, failed, total, current_story}` and the story rows
  - blind-hunter, 0.1.24 test leaves 409/423, the store placement, the auth rule, run selection and predicates unpinned: the AC-named items (five routes, three kinds, eight states, supervisor-not-plugin) are pinned; further prose pins are plumbing
  - blind-hunter, runbook `{ok:true, at, agents, runs, …}` elides `problems`/`id`, and the `/office/events` §7 row lacks a §4.5 cross-reference: a smoke check's pass shape, accurate as elided; §4.5 has no `/office/events` curl, so no cross-reference is owed

## Design Notes

"Minor bump" in the epic is the contract's additive patch bump (pre-1.0 Change policy, as 0.1.18–0.1.22). 0.1.24 supersedes SPEC Assumption 4 ("next unused patch number"): 28.6 landed 0.1.23 on main (`52960b4`) after this branch was cut (plan § Settled shape). Response shapes may be summarized with a link to `apps/supervisor/README.md` rather than copied. The live §7 rows are operator checks on the box: `unverifiable-here`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK (baseline 1365, skipped=1, plus new cases)
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun test` -- expected: no failures beyond the 6 known baseline (closeout `fakeStudioRoot`, five `sbx stop`); `unverifiable-here` if bun is absent
- the `git diff --stat` boundary check above -- expected: empty

## Deviation Summary

### pass 1 (2026-10-18, implementer)

- planned: README changes only on a mismatch, code-only env names expected to be just the `TK_SUPERVISOR_OAUTH_` prefix and `TK_SUPERVISOR_UNDER_TEST` / actual: added an environment-table row for `JIRA_API_TOKEN` and `JIRA_EMAIL`, read by `src/server.ts`'s auth preflight but never listed / why: AC2 requires the environment table to match the code / may affect: none
- planned: the boundary check `git diff --stat … -- … plugins/tk-studio/lib/*.py …` is empty / actual: as written it lists `plugins/tk-studio/lib/tests/test_driver_contract.py` (git's pathspec `*` crosses `/`); empty as `':(glob)plugins/tk-studio/lib/*.py'` / why: pathspec semantics / may affect: none
- planned: the contract edits are the header cell, Audience, §1 and §7 row 6 / actual: also added "Story 29.4 (Epic 29)" to the "Story / rulings" row, pinned in the test / why: earlier bumps (28.2) follow the same convention / may affect: none

DEVIATION SCORE: 1

DRIFT: README environment table gains a `JIRA_API_TOKEN`/`JIRA_EMAIL` row — the code reads them and AC2 requires the table match the code — affects: none
DRIFT: the spec's boundary pathspec `plugins/tk-studio/lib/*.py` is read as `:(glob)` — git's `*` crosses `/` and matched the story's own test file — affects: none
DRIFT: the contract's "Story / rulings" row names Story 29.4 (Epic 29) — the convention of earlier bumps — affects: none

### pass 2 (2026-10-18, review patches)

- planned: extend the 0.1.24 test to pin P1's leaving-the-live-set clause / actual: also pinned the `office.agent` first-appearance phrase and the P2/P3 phrases / why: so the new contract text cannot be dropped silently / may affect: none

DEVIATION SCORE: 1

DRIFT: the 0.1.24 test pins the review-patched account and stream phrases beyond the one named — keeps the new text from being dropped silently — affects: none

### pass 3 (2026-10-18, follow-up review patches)

- planned: patch the contract's account row and README:71 with `400 MalformedJson`, and README:272's section reference / actual: as planned, plus one `400 MalformedJson` phrase pin in the existing 0.1.24 test (allowed by the patch instruction) / why: review patches / may affect: none

DEVIATION SCORE: 0

## Consult Log

- 2026-10-18T04:17:14Z — trigger: deviation-gt-0 — question: accept the implementer's three score-1 deviations (README JIRA_API_TOKEN/JIRA_EMAIL env row; :(glob) boundary pathspec; "Story 29.4 (Epic 29)" in the Story/rulings row)? — ruling: accept-deviation score 1 — do: keep the JIRA env row, the header entry and its test pin; record the boundary check as run with ':(glob)plugins/tk-studio/lib/*.py' (empty), the bare-pathspec result a pathspec quirk; do not touch apps/supervisor/src — rule candidate: In docs-recheck story plans, label expected code-only names as a guess to verify, not a cap on edits, and write every boundary-check pathspec with :(glob) so * does not match across /.
- 2026-10-18T04:24:51Z — trigger: deviation-gt-0 — question: accept the review-patch pass pinning extra phrases (office.agent first appearance, P2 refusal codes, P3 reset) in the 0.1.24 test? — ruling: accept-deviation score 1 — do: keep the extra pins; record the deviation as local (score 1); touch no other file — rule candidate: When a review patch tells the implementer to pin one new contract clause, let it also pin the other review-patched phrases in the same section in the same test, within scope with no consult.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Follow-up review pass on the done story (contract **0.1.24** names the studio web as a consumer and documents the account, registry and office projection as supervisor surfaces under AD-2; runbook §4.2/§4.5/§7 and the README follow the code). This pass patched two low doc defects: the account routes' undocumented `400 MalformedJson` (contract and README) and an ambiguous "§1 auth preflight" reference in the README. No code change; the contract version is unchanged.

**Files changed (this pass):**
- `plugins/tk-studio/contracts/driver-contract.md` — the account row (:106) names `400 MalformedJson` for a JSON body that is not JSON, distinct from `400 AccountInvalid`
- `apps/supervisor/README.md` — :71 adds the `400 {ok:false,error:"MalformedJson",detail}` answer to the account routes' JSON errors; :272 reads "the driver contract's §1 auth preflight"
- `plugins/tk-studio/lib/tests/test_driver_contract.py` — `400 MalformedJson` pinned in `test_0_1_24_names_the_web_and_the_supervisor_surfaces`

Files changed by the story overall (commit 470e6c4 plus this pass): the three above and `kb/agent-pc-setup-runbook.md`.

**Review:** blind-hunter and edge-case-hunter (band M, both layers): 6 findings → 2 patched (low 2), 0 deferred, 5 rejected (one blind-hunter finding split: its §1-reference part patched, its scope part rejected; Review Triage Log). Follow-up review recommended: false (patched high 0, medium 0, low 2; score 3×0 + 2 = 2 < 5).

**Verification (after patches, re-run by this session):**
- lib suite: `Ran 1366 tests … OK (skipped=1)`
- conformance: `ok: true`
- `bun test` (apps/supervisor): `Ran 933 tests across 21 files` — 855 pass, 72 skip, 6 fail, the known baseline (closeout `fakeStudioRoot`, five `sbx stop` in `sandbox.test.ts`)
- `git diff --stat 6dce189c3d7d6ec43daf4bf04fecf9a6b13d9e0a -- apps/supervisor/src apps/supervisor/test tools/installer ':(glob)plugins/tk-studio/lib/*.py' plugins/tk-studio/skills plugins/tk-studio/contracts/schemas`: empty
- unverifiable-here (operator, on the box): `curl -H "Authorization: Bearer $env:TK_SUPERVISOR_TOKEN" https://<TLS_NAME>:8787/agents`, `…/office`, and `curl -N -H "Accept: text/event-stream" -H "Authorization: Bearer …" https://<TLS_NAME>:8787/office/events` (expect `event:snapshot`, then `: heartbeat` within 10 s); the account sign-in at `https://<TLS_NAME>:8787/`

**Residual risks:**
- Merging main conflicts on the one-line header and `test_driver_contract.py` (version pin, the 0.1.22 assertion); main's 28.6 test asserting `**0.1.23**` is the bold version must become a survival check, and the merge must insert 28.6's 0.1.23 clause between 0.1.22 and 0.1.24 — no test forces it.
- The contract summarises the account and stream shapes and links the README; the cookie's name and lifetime (Story 22.5) are not restated.

DRIFT: README environment table gains a `JIRA_API_TOKEN`/`JIRA_EMAIL` row — the code reads them and AC2 requires the table match the code — affects: none
DRIFT: the spec's boundary pathspec `plugins/tk-studio/lib/*.py` is read as `:(glob)` — git's `*` crosses `/` and matched the story's own test file — affects: none
DRIFT: the contract's "Story / rulings" row names Story 29.4 (Epic 29) — the convention of earlier bumps — affects: none
DRIFT: the 0.1.24 test pins the review-patched account and stream phrases beyond the one named — keeps the new text from being dropped silently — affects: none

## Reconcile

- 2026-10-18 — score 1; reconcile not required.
Gate: Part A not-required; Part B epic complete: no next story (29-4 accepted)
