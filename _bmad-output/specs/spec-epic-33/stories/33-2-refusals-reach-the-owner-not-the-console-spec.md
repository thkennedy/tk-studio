---
title: 'Refusals Reach the Owner, Not the Console'
type: 'feature'
created: '2026-10-26'
status: done
baseline_revision: 'b7db620223c18692e21d2de07abcc93bd8633bf6'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/SPEC.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** A queued run the drain cannot claim says why only on the supervisor's console. An expired sandbox Max login or a failed pin leaves the run silently queued for hours (holes 68, 69).

**Approach:** Record each claim refusal on the run as one deduplicated `claim-refused` queue event, and notify the owner once per new reason. Surface the latest reason on `GET /runs/{id}`, the `/status` live list and the office's `problems[]` (contract 0.1.28, additive), and record `claim-refusal-cleared` when the reason clears. Have `tk-studio doctor` and the activate drift check warn before the sandbox's Max login expires.

## Acceptance Criteria (transcribed verbatim from epics.md, Story 33.2)

- **AC1:** **Given** a queued run the drain cannot claim (the Max-login preflight refuses, the pin fails, the placement is refused, the checkout lock is held by a live holder) **When** the drain passes over it **Then** the run stays `queued` and gains one queue event `claim-refused {reason, pass_at}` per distinct reason (a repeated reason updates `pass_at` on the same event, never a flood), the notifier sends one line per new reason with the run id and what resolves it, `GET /runs/{id}`, `GET /status`'s live list and the office's `problems[]` carry the latest reason (contract 0.1.28, additive), and the claim proceeds on the next pass once the reason clears, recorded as `claim-refusal-cleared`
- **AC2:** **Given** the engine sandbox's Max login (the global `anthropic` sbx secret, renewed from inside the sandbox with `/login`) **When** `tk-studio doctor` or the activate drift check runs **Then** they read `refreshTokenExpiresAt` from the sandbox's `~/.claude/.credentials.json` through `sbx exec` (never the tokens) and warn from 7 days before expiry, naming the renewal steps (`sbx run --name <sandbox>` → `/login` → `/exit`); an expired login is a failed check; `bun test` and the lib suite cover the events, the notifier line, the doctor reading and the warning window with fakes

## Boundaries & Constraints

**Always:** Studio Python is stdlib-only and runs via `uv run` (NFR9). A token never reaches an event, a log line, a notifier line or a file (NFR5); the credentials read extracts only `refreshTokenExpiresAt`. The contract change is additive on 0.1.28 and lands with conformance green (AD-19). No `sbx exec` on a stopped sandbox, and no sbx command before `sbx daemon status` passes (runbook :452, :1362).

**Block If:** the activate drift check's plane, its statuses or the "five-plane" contract text must change without an operator ruling. This one fired at planning; see Auto Run Result.

**Never:** push, tag, open a PR or bump a package version. Fork an upstream BMad skill. Kill processes by name.

</intent-contract>

## Code Map

Investigation 2026-10-26 (two read-only subagents). Paths are under `apps/supervisor/` unless they say otherwise.

- `src/cli.ts:898` `drainQueue`: loops over `queue.drainable` (`src/queue.ts:2134`) and calls `runJob`. The catch at `:917-931` ends a `StartError.refused` run `blocked` and releases the pin. Pass hooks run in the `finally` block at `:936-949`, with `sweepEnds` last.
- `src/cli.ts:1217` `runJob` runs `resolveBeforeStart` (`:1250`, placement: `TierRefused`/`HostBypassRefused`/`SbxSandboxMissing`/`VmPathUnderivable` via `resolveWorkerOptions` `:361`), then `maxLoginPreflight` (`:1251`; it returns `blocked` but the run stays queued, with no event), then `validate`, then `queue.claim` (`:1275`; lock → `waited:"lock"`), then the worktree and `drive`.
- `src/server.ts:753` `MAX_LOGIN_MISSING`, `:805` `judgeAuthStatus`, `:819` `maxLoginPreflight`. The pin runs after the claim, in `invokeSkill` at `:1115-1119` (`pinSandbox`, `src/sandbox.ts:127`; the `queueRecorder.pin` note is at `cli.ts:1577-1582`).
- `src/queue.ts:1189` `claim`: on a held lock it sets `runs.reason = "waiting: …"` and appends a `lock-wait` event on every pass (it floods). `:610` holds the events schema; append is `:1050` `event` and `:2126` `note`; read is `:876` `events`. Nothing updates an event in place. `now` is the module constant at `:778`.
- Notifier: `src/hygiene.ts:253` `notify` with `EndNotice` (`:150`) and `noticeText` (`:188`). The dedup model is `src/closeout.ts:487` `awaitRuling` with `rulingRecorded` (`:387`). `approve.ts:1004` `defaultNotify` is the guarded, injectable wrapper.
- Surfaces:
  - `src/api.ts:1211-1221` `GET /runs/{id}`, a model for an additive field (`cost_usd`, 0.1.27).
  - `api.ts:712-718` `status()`: the `live` list is raw `QueueRun` rows.
  - `src/office.ts:593` `projectCore` builds `problems: string[]`; `:586` `reasonFor`; `:808` `OfficeHub`.
- Contract: `plugins/tk-studio/contracts/driver-contract.md:218-232` holds the 0.1.28 entry (33.1), and `:767-785` §6 is the five-plane drift check. `plugins/tk-studio/lib/tests/test_driver_contract.py` pins "five-plane" (`:724`, `:767`, `:1788`). `plugins/tk-studio/contracts/conformance/manifest.json:10-12` (activate) and `:452-462` (`cli-doctor-json`, which runs with no sbx on PATH).
- Doctor: `tools/installer/cli/tk_studio_cli/doctor.py`.
  - `:35` statuses, `:69` `_check`, `:86` `_run`.
  - `:256-274` `check_sbx` (the new check goes right after it and is gated on it).
  - `:1056` `run_doctor`; the docstring's process list is at `:5-16`.
  - The sandbox name comes from `TK_SUPERVISOR_CONFIG` `jobs.*.sandbox` (`apps/supervisor/src/config.ts:1-35`; `tk_studio_cli.miniyaml`).
- Drift check: `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py:625-631` is the plane tuple and `:641-651` aggregates. It has no subprocess seam and no `warn` status.
- Tests that pin today's behaviour or shapes:
  - `test/command-line.test.ts:1323` (placement → blocked) and `test/sandbox.test.ts:128` (pin fail → blocked).
  - Exact event lists: `test/api.test.ts:299`, `test/command-line.test.ts:934/1461/1654`, `test/queue.test.ts:160/1323`.
  - `problems == []` in `test/office.test.ts` (6 places).
  - `test/page.test.ts:181/195` (`/status` keys).
  - `lib/tests/test_installer_doctor.py:37` `ALLOWED`, `:223-224`, `:254`, `:445`.
  - `lib/tests/test_drift_check.py:667` (the five planes).
  - `fakeSbx` (`test/fakes.ts:262`) has no `auth status` or credentials branch.

## Design Notes

These are the consult's rulings for the resume (2026-10-26T19:28Z). The operator settles C only.

- **A (sandbox name):** read the distinct `jobs.*.sandbox` values from `TK_SUPERVISOR_CONFIG`. Add no new variable and no hard-coded default. If the variable is unset or names no sandbox, the B outcome applies.
- **B (doctor):** the check is `skipped` when no sandbox is configured, sbx is absent, the daemon is down or the sandbox is stopped, and its detail names which. It checks `sbx daemon status` and `sbx ls` before `sbx exec`. It is `warn` from 7 days before expiry and `fail` once expired, and the fix names `sbx run --name <sandbox>` → `/login` → `/exit`.
- **D (score 2, a seam 33.3 relies on):** the story overrides the pinned tests. A pin failure and the placement refusals (`TierRefused`, `SbxSandboxMissing`) leave the run `queued` and record `claim-refused`. Move the pin before the claim and re-pin `command-line.test.ts:1323` and `sandbox.test.ts:128`. A broken registry entry, a `resolve` refusal or `problems[]` still end the run `blocked`.
- **E:** update `pass_at` in place on the same `claim-refused` row. The latest reason reaches seq-polling consumers through `GET /runs/{id}`, the live list and `problems[]`.
- **C (operator ruling 2026-10-26, session 11, binding):** the activate drift check gains a sixth plane named **`sandbox-login`** (the engine sandbox's Max login), appended after the five published planes under the contract's 0.1.28 entry ("five-plane" becomes "six-plane" there; additive: a consumer that knows five ignores the sixth, and the plane list stays fixed at six). It reuses the existing statuses, never a new one: `ok` (`case: ok`) when the sandbox reports logged in and more than 7 days remain before `refreshTokenExpiresAt`; `drift` (`case: expiring`) when 7 days or fewer remain — the warning — with the detail naming the expiry instant and the renewal steps (`sbx run --name <sandbox>` → `/login` → `/exit`); `error` (`case: expired`) once the instant has passed or the sandbox reports logged out — the failed check; `missing` (`case: no-sandbox`) when no sandbox is configured, sbx is absent, the daemon is down or the sandbox is stopped (the B rule: the detail names which; a box with no engine is never in error for this plane). The plane reads only `refreshTokenExpiresAt` and `loggedIn` through `sbx exec`, never a token, and the sandbox name comes from ruling A. The SPEC's 0.1.28 assumption (`SPEC.md:93`) is amended by this ruling: the drift check changes additively (one plane, no new status); record it in the contract's 0.1.28 entry with the §7 plane table.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- layers: blind-hunter, edge-case-hunter (both ran; M-band story, 23 files). The diff went to the reviewers by path (`/tmp/rev-33-2/diff.patch`, 2143 lines) because it was too large to inline.
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 2, low 4)
- defer: 0
- reject: 1 (the pre-existing `lock-wait` event still appends on every pass: it predates the story, the office's row 3 and the tests read it, and AC1's dedup rule covers `claim-refused`, which is now deduped)
- addressed_findings:
  - `[high]` `[patch]` `claim-refused` deduped on the exact reason text, and pin stderr and holder detail vary per pass, so the flood came back → stable cause `key` (consult `apply`); a repeat updates reason, resolves and pass_at in place; tested
  - `[medium]` `[patch]` the lock-held-by-a-live-holder and `SbxSandboxMissing` refusal paths had no test → added end-to-end tests (one event, one notifier line, cleared on the next claim)
  - `[medium]` `[patch]` the sandbox-login plane could take 2+2N × 30 s, past the conformance runner's 60 s → a shared 20 s `Deadline`; per the follow-up consult, readings taken before a spent budget are kept (worst-of), so expired still fails
  - `[low]` `[patch]` the no-sandbox `missing` → aggregate `result: drift` (exit 1) effect was undocumented → stated in contract §6, the 0.1.28 note and SKILL.md
  - `[low]` `[patch]` the lock-wait drain summary lacked `claim_refused` → added (additive; `waited` kept)
  - `[low]` `[patch]` `config_sandboxes` missed flow-style job entries that js-yaml accepts → now parsed; tested; copies byte-identical
  - `[low]` `[patch]` README Draining, Pin and hold and sbx text, and the `resolveBeforeStart` comment, still said `blocked` → corrected; claim-refusal events, notifier and `problems[]` documented

### 2026-10-26 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (both ran; 23 files). The diff since `b7db620223c18692e21d2de07abcc93bd8633bf6`, with `_bmad-output/` excluded, went to the reviewers by path (`/tmp/rev-33-2-fu/diff.patch`, 2835 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 1, low 5). Of these, 5 came from the review and 1 from verification.
- defer: 0
- reject: 7
  - the drive's `prePinned` reads `eff.tier` after the claim. `recordRunOptions` has one caller (`cli.ts`, `runJob`), so nothing changes the stored options between the gate and the claim.
  - no end-to-end test of a single pin across the gate and the drive. That is a plumbing assertion that AC1/AC2 do not name.
  - every box without an engine sandbox reads `missing` → `result: drift`. Operator ruling C sets this, and the contract documents it.
  - (both layers) the expiry read needs `python3` inside the sandbox. This is speculative: the sbx claude-code template ships Python 3, and the consult already accepted that an unreadable expiry reads `expiring` (pass 1).
  - the refusal text is not scrubbed on the notifier and the surfaces. The end notices (`noticeText`) carry the same run reason unscrubbed, and no token source reaches a pin, lock or login reason.
  - lock waits count as refusals and notify. AC1 names "the checkout lock is held by a live holder" as a refusal.
  - the pin's `sbx run -d` runs without a prior `sbx daemon status`. `pinSandbox` is the pre-existing pin, moved unchanged, and a failure is recorded as a `claim-refused`.
- addressed_findings:
  - `[medium]` `[patch]` `pinBeforeClaim` deduped `pin-failed` on the exact error text, and the clipped sbx stderr varies per pass, so each drain pass could add another `pin-failed` event. Fixed: a repeat on the same sandbox now updates the last `pin-failed` event's `error` in place (`patchEventDetail`), and the README and doc comment were updated. Tested: two passes with different text give one event carrying the latest error.
  - `[low]` `[patch]` `claimGate` pinned before the queued run recorded its resolved `sandbox`, so a legacy row with no stored sandbox missed `pinOutstanding` and `releasePin`. That meant a `pinned` event on every refused pass and no release on cancel. Fixed: the run's tier and sandbox are recorded before the pin when they differ. Tested.
  - `[low]` `[patch]` `parse_expiry` let `nan`, `inf` and `1e20` through, and `_iso` then raised, crashing the doctor check and the drift plane. Fixed: the value must be finite, positive and convertible, else None. Tested. Both copies are byte-identical.
  - `[low]` `[patch]` the §6 output schema still said `result: "clean"|"drift"`, while the code and the new text give `error` (exit 2). Fixed: it now reads `"clean"|"drift"|"error"`.
  - `[low]` `[patch]` the README's drain output and exit sentences sat at the end of the Claim refusals bullet. Moved back to **Draining**.
  - `[low]` `[patch]` (found in verification) `refuseClaim` and `clearClaimRefusals` stamped the event's `at` and its `pass_at` from two `now()` calls, which made `queue.test.ts:1807` flaky. Fixed: one timestamp for both. `queue.test.ts` passed 5 runs out of 5.

### 2026-10-26 — Review pass (second follow-up)
- layers: blind-hunter, edge-case-hunter (both ran; no story plan exists, so no S band; 23 files). The diff since `b7db620223c18692e21d2de07abcc93bd8633bf6`, with `_bmad-output/` and the byte-identical CLI `sandbox_login.py` excluded, went to the reviewers by path (`/tmp/review-33-2-300650/diff.patch`, 2527 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 5
  - `claimGate` records the config-derived tier/sandbox on a legacy queued run, so a later config edit does not reach it. The pre-existing `recordRunOptions(run.run_id, record)` before the claim (`cli.ts:1379`, baseline `:1264`) already does the same on every pass that reaches it. The pin refusal's `resolves` names making that sandbox's pin succeed, and that does clear it.
  - a cause already open in the episode (`max-login` refused, renewed, then refused again before any claim) is not re-notified. AC1 ends the episode at the claim (`claim-refusal-cleared`), so a same-key cause inside the open episode is not a new reason.
  - (both layers) a pass whose gate passes but which ends unclaimed with nothing recorded (a non-refused `validate` StartError) keeps the last recorded refusal on the surfaces. That is still the latest reason recorded, and the next pass that reaches the claim clears it. The proposed clear-on-gate-pass would open a new episode, and re-notify, on every lock-wait pass.
  - no-sandbox `missing` → `result: drift` on boxes without an engine. Operator ruling C sets this, and the contract documents it (rejected the same way in the previous pass).
  - no `drainQueue`-level test of the sbx pin before the claim. The AC1 pin-failure behaviour is asserted at `claimGate` (`sandbox.test.ts`), and `runJob`'s refusal wiring is shared with the drained max-login, placement and lock paths tested end to end. The single-pin plumbing was rejected in the previous pass.
- addressed_findings:
  - `[low]` `[patch]` `sandbox_login._listed` matched the sandbox name against every `sbx ls` column. A sandbox named like another row's AGENT value (`claude`) took that row's `running` status and could be `sbx exec`'d while stopped (Boundaries: no `sbx exec` on a stopped sandbox). Fixed: it now matches the first (SANDBOX) column only, and both copies are byte-identical. Tested: `SandboxLoginPlaneTests.test_the_name_matches_the_sandbox_column_only`, with the sandbox not listed and listed as stopped → `missing`/`no-sandbox`, no `sbx exec`.

## Deviation Summary

No implementation ran, so no deviations.

### pass 1 (2026-10-26, implementer)

Routing note: the dispatch found this spec at `ready-for-dev` (an uncommitted working-tree change over the operator's `draft` at b7db620), so step 01 routed it to step 03. The intent contract, Code Map and Design Notes carried the plan; the spec has no Tasks & Acceptance or Verification section, so the verify gate is the studio's.

- planned: the Code Map's files / actual: also `apps/supervisor/README.md`, `plugins/tk-studio/skills/tk-studio-activate/SKILL.md`, `lib/tests/test_installer_bootstrap.py` (`SHARED_COPIES`), and new `plugins/tk-studio/lib/sandbox_login.py` plus its byte-identical CLI copy / why: docs for the changed shapes; one shared reader for doctor and drift check / may affect: none
- planned: sandbox names via `tk_studio_cli.miniyaml` / actual: a stdlib text scan of `jobs:` → `sandbox:` (`config_sandboxes`) / why: miniyaml rejects the config's quoted `"<project>/<job>"` keys / may affect: none
- planned: move the pin before the claim / actual: drain-driven runs only, and their drive skips the second pin; `run` mode, relaunch and resume still pin in `invokeSkill` / why: no queue run exists to record on before the claim in `run` mode / may affect: 33-3
- planned: re-pin `sandbox.test.ts:128` / actual: kept as the in-drive (relaunch) pin failure that ends `blocked`; added a new before-claim test (stays queued, one `claim-refused`) / why: the relaunch path still exists / may affect: 33-3
- planned: `claim-refused {reason, pass_at}` / actual: the event also carries `resolves` and `notify`; the surfaces carry `claim_refused {reason, resolves, pass_at, since}` or `null`; the clear event is `claim-refusal-cleared {reasons, pass_at}` / why: the notifier line names what resolves it; the spec left the surface field unnamed / may affect: 33-3
- planned: the Code Map's four placement refusals / actual: only `TierRefused` and `SbxSandboxMissing` stay queued (ruling D); `HostBypassRefused` and `VmPathUnderivable` still end `blocked` / why: ruling D names those two / may affect: none
- planned: ruling C's cases / actual: an unreadable expiry, or a failed login probe with more than 7 days left, reads `expiring` (drift/warn) / why: the ruling does not cover that outcome / may affect: none
- planned: the plane table under §7 / actual: in §6, the drift-check section (§7 is the dossier) / why: §6 holds the plane tables / may affect: none
- planned: the pinned tests as listed / actual: also re-pinned `command-line.test.ts:1085` (drain summary `blocked` → `queued`) and mocked the new plane in two drift-check `main` tests / why: they pinned the old summary or would call real `sbx` / may affect: none

DEVIATION SCORE: 2

DRIFT: extra files (README, activate SKILL.md, bootstrap SHARED_COPIES, new shared `sandbox_login.py` + CLI copy) — docs and one shared login reader — affects: none
DRIFT: sandbox names read by a stdlib text scan, not miniyaml — miniyaml rejects quoted job keys — affects: none
DRIFT: pin before claim for drain-driven runs only; relaunch/resume pin in drive and still end `blocked` — no queue run to record on otherwise — affects: 33-3
DRIFT: `claim-refused` adds `resolves` and `notify`; the surfaces carry `claim_refused {reason, resolves, pass_at, since}`; the clear event is `{reasons, pass_at}` — the notifier names the fix; the field name was unpinned — affects: 33-3
DRIFT: only TierRefused/SbxSandboxMissing stay queued — ruling D names only those — affects: none
DRIFT: an unreadable expiry or a failed login probe with more than 7 days left reads `expiring` — ruling C is silent there — affects: none
DRIFT: the plane table is in §6, not §7 — §6 is the drift-check section — affects: none
DRIFT: re-pinned `command-line.test.ts:1085` and mocked the new plane in two drift-check tests — they pinned the old shape or would call real sbx — affects: none

### pass 2 (2026-10-26, implementer, the consult's DO)

- planned: add "or the login probe failed" to the §6 `expiring` row and keep SKILL.md in step / actual: `driver-contract.md:860` updated; `tk-studio-activate/SKILL.md:42` also gained "the expiry unreadable", which the contract row already had; README unchanged (it never describes `expiring`) / why: keeps SKILL.md in step with the row, as the DO asks / may affect: none

DEVIATION SCORE (pass 2): 1 (local; covered by the consult's DO, so no new consult)

DRIFT: SKILL.md's sandbox-login row also names the unreadable expiry — to match the contract row — affects: none

### pass 3 (2026-10-26, implementer, review patches)

- planned: dedup on a caller key, kept off the surfaces (consult) / actual: `claim-refused` detail is `{key, reason, resolves, pass_at, notify}`; `key` shows in `GET /runs/{id}` `events` (raw details) but not in `claim_refused`, the live list, `problems[]` or the RunSummary; a keyless event falls back to its reason / why: the consult's ruling; older rows still dedup / may affect: 33-3
- planned: `lock:<holder run_id>` / actual: `lock:unknown` when a lock-wait claim carries no holder (the type allows it, the code never does) / why: type safety / may affect: none
- planned: one total deadline for the plane / actual: shared `sandbox_login.py` `Deadline`, `BUDGET_S = 20`, used by the drift check and the doctor; the per-call timeouts are capped by the time left / why: one place, and the two copies stay byte-identical / may affect: none
- planned: update the tests that pin the aggregate text / actual: none pinned it, so the new pins went into the 0.1.28 contract test / why: keeps the new text from drifting / may affect: none
- planned: the README's Draining, Pin and hold, sbx and events text / actual: also fixed the README's "invalid stored value ends the run `blocked`" and the doctor docstring's process note / why: stale for the same reason / may affect: none
- planned: a lock test with a live holder / actual: the holder is owned by `process.ppid` / why: the drain's recovery reads this pid under another nonce as a dead supervisor / may affect: none

DEVIATION SCORE (pass 3): 1

DRIFT: `claim-refused` detail gains `key` (visible in raw `GET /runs/{id}` events, off the `claim_refused` surface) — the consult's stable dedup key — affects: 33-3
DRIFT: the sandbox-login reads share a 20 s budget (`Deadline`) in the shared module — keeps the plane under the conformance runner's 60 s — affects: none

### pass 4 (2026-10-26, implementer, the third consult's DO)

DEVIATIONS: none (the contract's 0.1.28 text now says one event per distinct cause with the stable `key`, pinned in `test_driver_contract.py`; `read_logins` keeps readings taken before a spent budget). DEVIATION SCORE (pass 4): 0. Story deviation score: 2 (the highest accepted pass).

### pass 5 (2026-10-26, implementer, follow-up review patches)

- planned: the new `pin-failed` in-place test goes beside the existing `pinBeforeClaim` tests / actual: no such tests existed, so it sits in the pin `describe` block with the `claimGate` pin tests (`sandbox.test.ts`), imports `pinBeforeClaim` and injects the varying failure text through the `SandboxDeps.run` seam / why: the fake sbx always fails with the same stderr / may affect: none
- planned: `parse_expiry` cases `nan`, `inf`, `1e20` / actual: also `-inf` / why: same guard / may affect: none

DEVIATION SCORE (pass 5): 1. The consult accepted it at score 1 (local, test-only).

DRIFT: the `pin-failed` test sits with the `claimGate` pin tests, and `parse_expiry` also has a `-inf` case — no `pinBeforeClaim` test group existed; same guard — affects: none

### pass 6 (2026-10-26, implementer, verification fix)

DEVIATIONS: none (`queue.ts`: the private `event()` takes an optional `at`, so `refuseClaim` and `clearClaimRefusals` stamp `at` and `pass_at` from one `now()`). DEVIATION SCORE (pass 6): 0. Story deviation score stays 2.

### pass 7 (2026-10-26, implementer, second follow-up review patch)

DEVIATIONS: none (`sandbox_login._listed` matches the first column only, in both byte-identical copies; one regression test in `test_drift_check.py`). DEVIATION SCORE (pass 7): 0. Story deviation score stays 2.

## Consult Log

- 2026-10-26T19:28:45Z — trigger: halt — question: step-02 intent gap on AC2 and AC1. (A) Where the doctor and drift check learn the sandbox name. (B) No sandbox, sbx, daemon or running sandbox: skipped or failed? (C) The drift check's statuses (`ok|drift|missing|error`) for the 7-day warning and for expired, and a sixth plane against the pinned "five-plane" contract. (D) Pin failure and placement refusal end the run `blocked` today, against the AC's "stays queued". (E) Updating `pass_at` in place on an append-only event store — ruling: escalate — do: HALT blocked (intent gap) on C only; record A, B, D and E for the resume (see Design Notes) — rule candidate: When a story asks the activate drift check for a new reading, its SPEC must name the plane, the status for each outcome and the 0.1.28 assumption entry before planning; otherwise the planner records it as a design note, never an open question. (observe record ok=true)

- 2026-10-26T20:00:09Z — trigger: deviation-gt-0 — question: accept the implementer's nine deviations at score 2? (the pin before the claim for drain runs only, the extra fields in the claim-refused shape, the uncovered expiring outcomes, the no-sandbox aggregate drift) — ruling: accept-deviation score 2 — do: keep the set; add 'or the login probe failed' to the expiring row of the §6 sandbox-login table in driver-contract.md; keep the README and SKILL wording in step — rule candidate: When a ruling assigns an existing drift-check status to a new plane outcome, the planner states the aggregate result that status produces (missing/drift → result: drift, exit 1) in the ruling text.
- 2026-10-26T20:10:14Z — trigger: high-severity-finding — question: claim-refused dedups on the exact reason text, which carries volatile sbx stderr and holder detail; is a stable cause key a patch? — ruling: apply — do: refuseClaim takes a stable key (pin-failed:<sandbox>, lock:<holder run_id>, max-login, placement:<TierRefused|SbxSandboxMissing>), stored in the event detail and kept off the 0.1.28 surfaces; a repeated key updates pass_at, reason and resolves in place, and only a new key appends and notifies; add a test with two passes, the same key and different volatile text; log the key in the deviation log — rule candidate: When a story deduplicates or notifies on a reason, its SPEC must name a stable dedup key (cause class plus subject) apart from the human-readable text.
- 2026-10-26T20:33:41Z — trigger: deviation-gt-0 — question: accept pass 3 (the event-detail key visible in raw GET /runs/{id} events, the 20 s Deadline read as no-sandbox)? — ruling: accept-deviation score 2 — do: restate the 0.1.28 Story 33.2 text (driver-contract.md:238-242 and :5) as one per distinct cause, keyed (max-login, pin-failed:<sandbox>, placement:<…>, lock:<holder run_id>), with a repeated key updating reason, resolves and pass_at in place and key off claim_refused, the live list and problems[], and pin it in the 0.1.28 test; in sandbox_login read_logins keep the readings taken before a spent budget, mark the timed-out and unread sandboxes no-sandbox, take the worst, and test expired-then-timeout → expired, keeping the CLI copy byte-identical; keep the rest of pass 3 — rule candidate: When a story adds a field or dedup rule to a queue event its contract entry describes, the same pass updates that entry's event-shape sentence; a shared time budget never downgrades a reading already taken.
- 2026-10-26T20:53:43Z — trigger: deviation-gt-0 — question: accept the follow-up pass 5 deviations (the `pin-failed` test sits with the `claimGate` pin tests because no `pinBeforeClaim` group existed; an extra `-inf` case for `parse_expiry`)? — ruling: accept-deviation score 1 — do: keep both tests where and as they are; record both at score 1 (local, test-only) and continue to conformance — rule candidate: When a planned test location names a test group that does not exist, the nearest describe block for the same function, and extra same-kind cases, score 0 and do not trigger deviation-gt-0. (observe record ok=true)


## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version), nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review pass. The dispatch found the spec at `done`, so step 01 sent it to step 04. HEAD was `218238fef2521ec360f78c50fb43b36e5908fbc0`. Both review layers ran on the diff since `b7db620223c18692e21d2de07abcc93bd8633bf6`. They produced 6 distinct findings: 1 was patched and 5 were rejected. The patch: `sandbox_login._listed` now matches the configured sandbox against the `sbx ls` SANDBOX (first) column only. Before, a sandbox named like another row's AGENT value could take that row's `running` status and be `sbx exec`'d while stopped.

**Files changed (this pass).**
- `plugins/tk-studio/lib/sandbox_login.py`: `_listed` matches the first column only.
- `tools/installer/cli/tk_studio_cli/sandbox_login.py`: the same edit (byte-identical copy).
- `plugins/tk-studio/lib/tests/test_drift_check.py`: adds `SandboxLoginPlaneTests.test_the_name_matches_the_sandbox_column_only`.

**Review findings.** 1 patch applied (high 0, medium 0, low 1), 0 deferred, 5 rejected (reasons in the Review Triage Log). Follow-up review recommended: false. The score is 3×0 + 1 = 1, which is under 5, and no high was patched.

**Verification.**
- `uv run python -m unittest discover tests` (from `plugins/tk-studio/lib`): 2021 tests, OK (2 skipped). The implementer ran it and this session re-ran it.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `cmp` shows the two `sandbox_login.py` copies are identical.
- `bun test` was not re-run: this pass changed no TypeScript.

**Residual risks.**
- The `sbx ls` layout (name in the first column) is taken from the tests' fakes and the sbx CLI's `SANDBOX  AGENT  STATUS` header. It is not verified on a live engine box.
- The residual risks recorded in the previous pass still stand. These include the in-sandbox `python3` expiry read, Linux-only end-to-end runs, and one owner page per lock holder.

Operator follow-up (unverifiable here): the live sandbox reading needs a real engine box. Run `uv run plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory <root>` and `tk-studio doctor` with `TK_SUPERVISOR_CONFIG` naming a running sbx sandbox.

## Reconcile

### 2026-10-26 — adjust-stories

- Score: 2
- Reasoning: Three DRIFT lines name 33-3, and 33-3 builds on the pin, the preflight order and the `claim-refused` event. For drained runs the pin now runs in `claimGate` → `pinBeforeClaim` (`apps/supervisor/src/cli.ts:1277-1318`), before the Max-login preflight and the claim. Run mode, relaunch and resume still pin in the drive (`queueRecorder.pin`, `cli.ts:1703`; `invokeSkill`, `server.ts:1115`) and end `blocked` there. The drive skips the second pin (`prePinned`). The event detail is `{key, reason, resolves, pass_at, notify}`, keyed `max-login` for a login refusal. `pin-failed` is one event per failure episode, patched in place. None of this changes 33-3's acceptance criteria: notes in its `invoke_dev_with` absorb it. Ruling D's "move the pin before the claim" landed for drained runs only, and the consult accepted that at score 2. The contract's 0.1.28 text already states the shipped shape, so no AD, contract or ruling is contradicted. The other six DRIFT lines say `affects: none` and touch nothing later stories rely on.
- Affected: 33-3-the-pin-restarts-a-logged-out-sandbox — "the pin stops and starts the sandbox once …, probes again, and only then runs the preflight" (there are now two pin sites, and the restart must sit in both or in one shared seam); "a sandbox still logged out after the restart refuses the claim through 33.2's event naming the renewal" (that applies to drained runs only, through `recordedRefusal` key `max-login`; relaunch and resume have no claim and end `blocked`)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 33-3-the-pin-restarts-a-logged-out-sandbox
