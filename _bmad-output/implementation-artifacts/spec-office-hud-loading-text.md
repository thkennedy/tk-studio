---
title: 'Office HUD: pending phase and engine run id read "Loading…" (DW-29, DW-30)'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
deviation_score: 0
reconcile_verdict: not-required
baseline_revision: '62387a268089a0381465be818eeb134b115c160c'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The office HUD shows a bare `—` for the current story's phase and the engine run id while a run that entered the live set after the snapshot has no per-story `office.progress` yet (DW-29) or no `engine_run_id` yet (DW-30, `applyRun` creates rows with `engine_run_id: null`). The owner's TKSTUDIO-213 ruling: a pending value reads "Loading…", never a symbol without human-readable meaning.

**Approach:** In `hudModel`, render a pending phase and a pending engine run id as a new exported constant `LOADING = "Loading…"` instead of `NONE`. Display text only; no store, delta or contract change.

## Boundaries & Constraints

**Always:** The text is exactly `Loading…` (U+2026 ellipsis), exported from `apps/studio-web/src/office/model.ts` and pinned by the office model tests. A known phase / engine id still renders verbatim.

**Block If:** Making the change requires altering a contract shape (driver-contract.md:151, the `office.run` delta), the live store, or the supervisor.

**Never:** Do not change `NONE` itself or its other consumers (issue, inbox, chat, board, status models, `sinceText`, the HUD `story` field) — out of this bundle's scope. Do not add an `engine_run_id` to the `office.run` delta or a per-story `office.progress` for a new run. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Known values | live run with `engine_run_id: "eng-1"` and current story row phase `dev-running` | `engine_run_id: "eng-1"`, `phase: "dev-running"` | No error expected |
| New run, no story rows | live run, `epic.current_story: "30-4"`, `stories: []`, `engine_run_id: null` | `story: "30-4"`, `phase: "Loading…"`, `engine_run_id: "Loading…"` | No error expected |
| Null seams | state-null row, `engine_run_id: null`, `current_story: null`, `stories: []` | `state: PENDING`, `engine_run_id: LOADING`, `phase: LOADING`, `story: NONE` | No error expected |

</intent-contract>

## Code Map

- `apps/studio-web/src/office/model.ts:166-167` -- `PENDING`, `NONE` constants; add `LOADING` beside them.
- `apps/studio-web/src/office/model.ts:174` -- `HudLive.engine_run_id` doc comment says "`—` until the snapshot names it"; update to `Loading…`.
- `apps/studio-web/src/office/model.ts:232,237` -- `hudModel`: `engine_run_id: run.engine_run_id ?? NONE` and `phase: story?.phase ?? NONE` → `LOADING`.
- `apps/studio-web/src/office/model.test.ts:235-244` -- "the null seams" test asserts `engine_run_id: NONE … phase: NONE`; update and add the new-run-with-current-story-but-no-rows case. Import list at :7.
- `apps/studio-web/src/office/OfficeScreen.tsx:288,293` -- renders `hud.live.phase` / `hud.live.engine_run_id` verbatim (read-only; no change needed).
- `apps/studio-web/src/live/store.ts` applyRun -- source of `engine_run_id: null` rows (read-only).

## Tasks & Acceptance

**Execution:**
- `apps/studio-web/src/office/model.ts` -- add `export const LOADING = "Loading…";`; use it for the pending `engine_run_id` and `phase` in `hudModel`; fix the `HudLive.engine_run_id` comment -- the owner's ruling.
- `apps/studio-web/src/office/model.test.ts` -- import `LOADING`; pin `LOADING === "Loading…"`; update the null-seams expectation; add a test for a new run with `current_story` set, `stories: []`, `engine_run_id: null` -- covers the matrix.

**Acceptance Criteria:**
- Given a live run whose engine run id is null or whose current story has no phase row, when `hudModel` builds the HUD, then `live.engine_run_id` / `live.phase` equal `"Loading…"`, never `"—"`.
- Given the change, when the studio-web tests and the tk-studio verify gate run, then both are green.

## Spec Change Log

## Review Triage Log

- skipped-layer: edge-case-hunter — S-band story (2 files, 23 insertions / 6 deletions; no story plan, band computed from the diff)

### 2026-11-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 3 (high 0, medium 0, low 3)
- addressed_findings:
  - none
- rejected (one line each):
  - phase reads `Loading…` when `current_story` is null — the bundle intent forbids a bare `—` for a pending value ("no symbols without human-readable meaning"); the suggested fix reinstates a bare `—`; recorded in Design Notes and the matrix's null-seams row.
  - duplicate of `inbox/model.ts:140` `LOADING_TEXT` — inbox already imports from `office/model`, so reuse means a circular import or an edit to inbox (out of scope); per-module text constants are the existing convention (`status/model.ts:9` redefines `NONE`). Not a deferral category (a)–(c).
  - `expect(LOADING).toBe("Loading…")` redundant — the intent explicitly asks to pin the pending text in the office model's tests.

## Design Notes

The phase also reads `Loading…` when `epic.current_story` is null (the null-seams row): for a live run every unknown phase is pending, and the ruling forbids a bare `—` for a pending value. The HUD `story` field is not named by the ruling and keeps `NONE`.

## Verification

**Commands:**
- `cd apps/studio-web && timeout -k 5 300 bun x vitest run src/office` -- expected: all pass.
- `cd apps/studio-web && timeout -k 5 600 bun x vitest run` -- expected: all pass.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.

## Deviation Summary

### pass 1 (2026-11-08)

DEVIATIONS: none

DEVIATION SCORE: 0

Note (verification, not a deviation): `bun x vitest` could not create `.bin` links (EPERM on install), so vitest ran as `bun node_modules/vitest/vitest.mjs run`.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T093348Z-f76978` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Office HUD now renders a pending engine run id and a pending current-story phase as `Loading…` (new exported `LOADING` in the office model) instead of a bare `—`, per the owner's TKSTUDIO-213 ruling on DW-29 and DW-30. Display text only; no store, delta or contract change.

**Files changed:**
- `apps/studio-web/src/office/model.ts` — adds `LOADING = "Loading…"`; `hudModel` uses it for a null `engine_run_id` and a missing phase; `HudLive.engine_run_id` doc updated.
- `apps/studio-web/src/office/model.test.ts` — pins `LOADING`; null-seams expectation updated; new test for a new run with a current story, no story rows and no engine id.

**Review:** blind-hunter only (S-band). Patches 0, deferred 0, rejected 3 (all low).

**Follow-up review recommendation:** false — patched high 0, medium 0, low 0; score 0.

**Verification:**
- `bun node_modules/vitest/vitest.mjs run` (apps/studio-web) — 12 files, 181 tests passed (`bun x vitest` could not be used: `.bin` link creation failed with EPERM on install).
- `bun node_modules/typescript/bin/tsc --noEmit -p .` (apps/studio-web) — clean.
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib) — 3005 tests OK (4 skipped).
- `uv run python ../contracts/conformance/runner.py run` — `ok: true`.

**Residual risks:** The HUD `story` field and other `NONE` consumers still show `—` (outside this bundle's intent). DW-29/DW-30's underlying data gap (no per-story progress / engine id for a run new to the live set) remains until a reconnect snapshot, as the owner ruled.

## Reconcile

- 2026-11-08 — score 0; reconcile not required.
- Gate: Part A not-required; Part B n/a: sweep bundle (DW-29, DW-30), not an epic story — no stories.yaml entry, no story plan, no next story; spec ACs self-reported green in Auto Run Result (vitest 181 passed, unittest OK, conformance ok: true)
