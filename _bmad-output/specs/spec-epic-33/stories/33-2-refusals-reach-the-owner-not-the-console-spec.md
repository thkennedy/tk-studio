---
title: 'Refusals Reach the Owner, Not the Console'
type: 'feature'
created: '2026-10-26'
status: 'draft'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 0
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

## Deviation Summary

No implementation ran, so no deviations.

## Consult Log

- 2026-10-26T19:28:45Z — trigger: halt — question: step-02 intent gap on AC2 and AC1. (A) Where the doctor and drift check learn the sandbox name. (B) No sandbox, sbx, daemon or running sandbox: skipped or failed? (C) The drift check's statuses (`ok|drift|missing|error`) for the 7-day warning and for expired, and a sixth plane against the pinned "five-plane" contract. (D) Pin failure and placement refusal end the run `blocked` today, against the AC's "stays queued". (E) Updating `pass_at` in place on an append-only event store — ruling: escalate — do: HALT blocked (intent gap) on C only; record A, B, D and E for the resume (see Design Notes) — rule candidate: When a story asks the activate drift check for a new reading, its SPEC must name the plane, the status for each outcome and the 0.1.28 assumption entry before planning; otherwise the planner records it as a design note, never an open question. (observe record ok=true)

## Auto Run Result

Status: blocked
Blocking condition: intent gap: consult ruled `escalate`. AC2 requires the activate drift check to warn from 7 days before the sandbox Max login expires and to fail once it has expired. But the drift check's only plane statuses are `ok|drift|missing|error` (`plugins/tk-studio/contracts/driver-contract.md:767-779`), its plane list is fixed at five in the published contract, and SPEC's 0.1.28 assumption (`SPEC.md:93`) names no drift-check change. Questions for the operator:
1. What is the new plane's name?
2. Which status and `case` cover no sandbox, expiring within 7 days, and expired?
3. Does "five-plane" become "six-plane" under the 0.1.28 entry?
Rulings A, B, D and E (Design Notes) stand for the resume.

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** The run halted at planning (step 02). No plan file existed for 33-2, so the session investigated (Code Map above). It found the story silent on how the drift check represents the expiry warning. The consult ruled it a contract decision for the operator. No code was changed. The only file written is this spec.

**Verification.** None ran; no implementation took place.

**Resume.** After the operator rules on C, record the ruling in Design Notes, set `status: draft`, and re-dispatch. Step 01 routes a `draft` spec straight to step 02.
