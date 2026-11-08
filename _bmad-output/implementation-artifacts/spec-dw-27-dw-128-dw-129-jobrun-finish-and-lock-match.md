---
title: 'DW-27, DW-128, DW-129 — jobrun finish exactly-once, single-writer finish, darwin checkout fold'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_revision: '57b3046f193c40cb4b1b6e8e6a93ef56e41b414a'
deviation_score: 0
reconcile_verdict: not-required
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['multiple-goals']
deferred: []
---

<intent-contract>

## Intent

**Problem:** (DW-128) In `plugins/tk-studio/lib/jobrun.py` `_finalize_run`, a raising `_land_summary` (summary.json write) skips `_emit_job_event`, leaving a terminal run with no `job-run` event. Since DW-5 a repeat finish is a no-op, so nothing ever repairs it (AD-12 exactly-once). (DW-129) Two concurrent `finish` calls on one run can both emit. The owner ruled (TKSTUDIO-222 A) to accept this and document it, with no locking. (DW-27) `_same_checkout` folds case on win32 only, but the supervisor's `foldCase` (`apps/supervisor/src/queue.ts:128-130`) folds on win32 and darwin. A mixed-case macOS root therefore never matches a live starter lock.

**Approach:** Guard the emit so it always runs exactly once, even when the summary write raises. The summary error still propagates and is not swallowed. Document single-writer `finish` in the docstring and in contract §4. Fold darwin by lowercasing, as `foldCase` does. Pin each change with tests and a contract note.

## Boundaries & Constraints

**Always:** stdlib-only Python; one `job-run` event per terminal transition; `_land_summary`'s exception still surfaces to the caller after the event is emitted (`try/finally`); the win32 fold stays `ntpath.normcase`; darwin uses `.lower()` on both spellings (no separator rewrite); the contract stays at version `0.1.34` (in-epic DW convention, tests assert no `0.1.35`); every text-mode open names `encoding="utf-8"`.

**Block If:** making the gate green requires changing `joblib.update_run`, adding a lock, or bumping the contract version.

**Never:** add locking or a check inside `update_run` (DW-129 ruling A); edit the deferred-work ledger; touch `apps/supervisor`; add a contract header clause (the DW-52/53 precedent adds only a body note, and a header clause after DW-51 would break the DW-51 test's `— additive) |` tail).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Summary write fails | `joblib.write_workspace_json` raises `OSError` during `finish(... "complete")` | run.json terminal, exactly one `job-run` event in the ledger | the `OSError` propagates from `finish` |
| Summary ok | normal finish | one event, summary.json landed (unchanged) | none |
| darwin mixed case | lock checkout = root uppercased, `platform="darwin"` | `starter_lock_state` → `"live"` | none |
| linux mixed case | same lock, `platform="linux"` | `(None, None)` (unchanged) | none |
| win32 mixed case | same lock, `platform="win32"` | `"live"` (unchanged) | none |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/jobrun.py:392-406` -- `_finalize_run`: the capture try, then `_land_summary` at :404, then `_emit_job_event` at :405. Wrap :404 in `try:` with the emit in `finally:`, and update the docstring to say the event is emitted even when the summary write raises.
- `plugins/tk-studio/lib/jobrun.py:379-389` -- `_land_summary` → `joblib.write_workspace_json` (patch target for the failure test).
- `plugins/tk-studio/lib/jobrun.py:190-202` -- `_same_checkout`: docstring "case-folded on win32"; :200 `if (platform or sys.platform) == "win32": ntpath.normcase`. Add a darwin branch (`a.lower(), b.lower()`) and update the docstring to "win32 and darwin, as the supervisor's foldCase".
- `plugins/tk-studio/lib/jobrun.py:724-745` -- `finish` docstring: add a sentence that `finish` is single-writer and a concurrent finish on one run is not supported (DW-129, TKSTUDIO-222 A). The read_run pre-check and update_run are not atomic, so two racing calls can both emit.
- `plugins/tk-studio/lib/tests/test_jobrun.py:228-275` -- the DW-5 finish tests (`_declare`, `_skill_defn`, `_job_run_events` helpers). Add the DW-128 test beside them.
- `plugins/tk-studio/lib/tests/test_jobrun.py:982-993` -- `test_win32_case_folded_checkout_matches_linux_does_not` (`_lock`, `DEAD_PID`, `_since`). Add a platform-parameterised test (subTest over win32/darwin → live, linux → none).
- `plugins/tk-studio/contracts/driver-contract.md:845` -- §4 `finish` row, which ends `One \`job-run\` event per terminal transition (AD-12) |`. Append the single-writer sentence before the closing `|`.
- `plugins/tk-studio/contracts/driver-contract.md:967-968` -- the starter lock "Matching lock" bullet `(case-folded on Windows)` → `(case-folded on Windows and macOS, as the supervisor's \`foldCase\`)`.
- `plugins/tk-studio/contracts/driver-contract.md` -- the body note `**0.1.34 (DW-52, DW-53, additive).**` paragraph ends just before `## 8. Conformance`. Insert a new paragraph `**0.1.34 (DW-27, DW-128, DW-129, clarification).**` after it. Avoid the bold sub-headings `**The result:**`, `**The retry:**`, `**The \`go\` rule:**` and `**The serve process:**`, because the DW-52/53 test slices its note up to `## 8. Conformance`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py:3770-3800` -- the pattern for a DW note test. Add one for the new note.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jobrun.py` -- try/finally emit in `_finalize_run`; darwin fold in `_same_checkout`; docstrings for `_finalize_run`, `_same_checkout` and `finish` (single-writer).
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- `test_finish_summary_write_failure_still_emits_one_event` (patch `jobrun.joblib.write_workspace_json` to raise `OSError`; assert raises, run.json terminal, exactly 1 `job-run` event) and `test_checkout_case_fold_by_platform` (subTest win32/darwin/linux).
- `plugins/tk-studio/contracts/driver-contract.md` -- §4 finish-row sentence, starter-lock fold wording, and the body note naming DW-27, DW-128 and DW-129, TKSTUDIO-222, "single-writer", "a concurrent finish on one run is not supported", "no lock", and macOS folding to match `foldCase`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- `test_0_1_34_dw_27_dw_128_dw_129_finish_single_writer_and_darwin_fold`: asserts header `**0.1.34**` with no `**0.1.35**`, the finish-row sentence, the starter-lock wording, and the note appearing once, after the DW-52/53 note, with its phrases.

**Acceptance Criteria:**
- Given `write_workspace_json` raises during a terminal `finish`, when finish is called, then the error propagates and the ledger holds exactly one `job-run` event for the run.
- Given a starter lock whose checkout is the root in another case, when `starter_lock_state` is evaluated with `platform` in {win32, darwin}, then it reports a lock, and with `linux` it reports `(None, None)`.
- Given the contract, when §4 is read, then the `finish` row states it is single-writer with concurrent finish unsupported, and the starter lock matching folds on Windows and macOS.
- Given the change, when the VERIFY GATE runs, then the full lib suite and conformance (`ok: true`) are green.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- layers: blind-hunter (3 findings), edge-case-hunter (0 findings; band M: 4 files)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 3 (high 0, medium 0, low 3)
  - rejected: a failed summary write leaves summary.json permanently absent (DW-5 no-op retry). The intent mandates only the exactly-once event, which pre-change was lost too; the error still surfaces to the caller.
  - rejected: when the emit raises inside `finally`, the summary error is masked. `_emit_job_event` wraps `ledger.emit` in `except Exception: pass`, so the emit does not raise.
  - rejected: labelling the darwin fold "clarification". The change policy has three kinds and this has no shape change: the fold aligns the plugin with the supervisor's existing `foldCase`. The submit/wake refusal path is platform-generic and already pinned for win32 (`test_win32_case_folded_checkout_matches_linux_does_not`).
- addressed_findings:
  - none

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && timeout -k 5 900 uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && timeout -k 5 900 uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`

## Deviation Summary

### pass 1 (2026-11-08)

DEVIATIONS: none
DEVIATION SCORE: 0

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T202640Z-af3d56` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:**
- DW-128: `_finalize_run` now emits the `job-run` event in a `finally`, so a raising summary write still leaves exactly one event, and the error still propagates.
- DW-129: per owner ruling TKSTUDIO-222 A, `finish` is documented as single-writer in its docstring and in contract §4. No lock was added.
- DW-27: `_same_checkout` now case-folds on darwin as well as win32, matching the supervisor's `foldCase`. The contract's starter-lock wording and a 0.1.34 clarification note are updated; the version is unchanged.

**Files changed:**
- `plugins/tk-studio/lib/jobrun.py` -- try/finally emit, darwin fold, and docstrings (finalize, checkout, single-writer finish).
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- `test_finish_summary_write_failure_still_emits_one_event`, `test_checkout_case_fold_by_platform`.
- `plugins/tk-studio/contracts/driver-contract.md` -- §4 finish-row single-writer sentence, starter-lock macOS fold, and the `0.1.34 (DW-27, DW-128, DW-129, clarification)` note.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the test pinning that note, the finish row and the fold wording.

**Review findings:** 0 patches applied, 0 deferred, 3 rejected (all low, from blind-hunter; edge-case-hunter returned none).

**Follow-up review recommendation:** false (patched: high 0, medium 0, low 0; score 0).

**Verification:**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): Ran 3041 tests, OK (skipped=4).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- The new tests ran and passed (verbose run). Matrix audit: every row is covered, and the summary-ok row by the existing DW-5 finish tests.

**Residual risks:**
- The darwin fold is exercised only via the simulated-platform path (spelling compare); it has not been run on a real macOS host.
- The concurrent-finish double emit remains possible by owner ruling (DW-129 A).
- After a summary-write failure, summary.json is not repaired by a retry (DW-5 no-op).


## Reconcile

- 2026-11-08 — score 0; reconcile not required.
- Spec resolution: unit key `dw-jobrun-finish-and-lock-match` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261108-202816-6452 state.json), `spec-dw-27-dw-128-dw-129-jobrun-finish-and-lock-match.md`.
- Part B note: this unit is a sweep DW bundle (DW-27, DW-128, DW-129), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `test_finish_summary_write_failure_still_emits_one_event` (test_jobrun.py:279); AC2 `test_checkout_case_fold_by_platform` (:1009, win32/darwin live, linux none); AC3 driver-contract.md:845 (finish row single-writer sentence), :969 (macOS fold as `foldCase`), :3022 note, pinned by `test_0_1_34_dw_27_dw_128_dw_129_finish_single_writer_and_darwin_fold` (test_driver_contract.py:3803); AC4 per the Auto Run Result (3041 OK, conformance `ok: true`), plus this session's rerun of `tests.test_jobrun` and `tests.test_driver_contract` (208 OK).
Gate: Part A not-required (score 0); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met
