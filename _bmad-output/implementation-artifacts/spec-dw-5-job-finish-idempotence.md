---
title: 'DW-5: a repeat job finish in the same terminal state is a no-op'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
deviation_score: 0
reconcile_verdict: not-required
baseline_revision: 'cc9c84d986420f63ceaf92d48aa3bebe2853e414'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      A _land_summary failure inside _finalize_run raises before _emit_job_event, leaving a terminal run with no job-run event; with DW-5 a same-state retry no longer repairs it.
    evidence: |-
      update_run persists the terminal state before _finalize_run; _finalize_run guards only capture, and _land_summary (write_workspace_json) can raise before the emit. Before DW-5 a repeat finish re-ran _finalize_run. The intent mandates the no-op, so the fix belongs in _finalize_run ordering or a finalized marker (deferral class b, AD-12 exactly-once).
    location: >-
      plugins/tk-studio/lib/jobrun.py:375
    severity: low
  - summary: >-
      Two concurrent finish calls on the same non-terminal run can both pass the pre-read and both emit a job-run event.
    evidence: |-
      The read_run check in finish and the write in update_run are separate, unlocked steps, and update_run accepts a same-state terminal rewrite (job.py:586). This race predates DW-5 (which only closes the sequential repeat); closing it needs a check inside update_run or a lock, which the DW-5 spec forbids changing (deferral class b, AD-12).
    location: >-
      plugins/tk-studio/lib/jobrun.py:701
    severity: low
---

<intent-contract>

## Intent

**Problem:** `jobrun.finish` on a run already terminal in the requested state rewrites run.json (`updated`, `reason`, `status_block`, `total_cost_usd`, `playable_verify_cost_usd`) and calls `_finalize_run` again, which emits a second `job-run` event — breaking the AD-12 one-event-per-terminal-transition invariant. `job.update_run` refuses only a *different* terminal state (job.py:586).

**Approach:** In `finish`, after argument validation, read the run first; when it is already terminal and its state equals the requested state, return the current record's result shape without writing run.json, capturing, landing summary.json, or emitting.

## Boundaries & Constraints

**Always:** Cost validation still refuses bad input before anything else (existing tests). Stdlib-only; result shape stays `{"run_id", "state", "reason"}` (plus `capture` only when a transition actually finalized). First finish behaviour is unchanged.

**Block If:** none anticipated.

**Never:** Do not change `job.update_run` semantics (other callers rely on it). Do not edit the deferred-work ledger, `driver-contract.md`, or schemas — no contract surface changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First finish | queued/running run, `finish(..., "complete")` | run.json terminal, one job-run event, result has `capture` | none |
| Repeat same state | run already `complete`, `finish(..., "complete", total_cost_usd=9.9, status_block=...)` | run.json bytes unchanged; ledger unchanged; returns `{run_id, state: complete, reason}` with no `capture` | none |
| Repeat same state with reason | run `partial` (reason A), `finish(..., "partial", reason="B")` | run.json unchanged (reason stays A); no new event | none |
| Different terminal state | run `complete`, `finish(..., "partial", reason=...)` | unchanged: `update_run` refuses (terminal immutable) | raises as today |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/jobrun.py:681-711` -- `finish`: validates cost, builds `changes`, calls `joblib.update_run`, then `_finalize_run` when terminal. Insert the read-and-short-circuit after `key = joblib.project_key(...)`.
- `plugins/tk-studio/lib/jobrun.py:375-389` -- `_finalize_run`: capture + `_land_summary` + `_emit_job_event` (the emission to avoid on repeat). Read-only.
- `plugins/tk-studio/lib/job.py:564-600` -- `read_run` (raises `JobError` on missing run — keep that error path), `update_run` (job.py:586 refuses different terminal state), `TERMINAL_STATES` (job.py:80). Read-only.
- `plugins/tk-studio/lib/tests/test_jobrun.py:215-300` -- finish tests; helpers `_queued_skill_run`, `_job_run_events`, `_ledger_events`, `_declare`, `_skill_defn`. Add the new tests next to `test_finish_completes_skill_run_and_emits_once`.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jobrun.py` -- in `finish`, read the run via `joblib.read_run(key, run_id)` before `update_run`; if `record["state"] in joblib.TERMINAL_STATES and record["state"] == state`, return `{"run_id", "state", "reason": record.get("reason")}` without writing or finalizing. Update the docstring to state the repeat is a no-op (AD-12). -- closes DW-5.
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- add tests: (1) second same-state finish leaves run.json bytes and ledger (all events) unchanged and returns no `capture`; (2) repeat `partial` with a different reason keeps the original reason; (3) a different terminal state on a finished run still raises. -- proves the I/O matrix.

**Acceptance Criteria:**
- Given a skill run finished `complete`, when `finish` is called again with `complete` (and a cost/status_block), then run.json is byte-identical and the ledger has exactly the events it had before.
- Given a finished run, when `finish` is called with a different terminal state, then it is refused as before.
- Given the change, when the VERIFY GATE runs, then the lib suite is green and conformance reports `ok: true`.

## Spec Change Log

## Review Triage Log

skipped-layer: edge-case-hunter — S-band story (2 files, 60 new lines)

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2 (high 0, medium 0, low 2)
- reject: 0
- addressed_findings:
  - none

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`

## Deviation Summary

### pass 1 (2026-10-29)

DEVIATIONS: none
DEVIATION SCORE: 0

Matrix audit: first-finish row — `test_finish_completes_skill_run_and_emits_once` (+ `test_reconcile.test_finish_captures_handoff_deltas` for `capture`); repeat-same-state — `test_finish_repeat_same_state_is_noop`; repeat-with-reason — `test_finish_repeat_partial_keeps_original_reason`; different terminal — `test_finish_different_terminal_state_still_refused`. All ran and passed.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T174706Z-da84bd` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Resolves DW-5. `jobrun.finish` now reads the run first and returns `{run_id, state, reason}` as a no-op (no run.json rewrite, no capture, no summary.json, no second job-run event) when the run is already terminal in the requested state. A different terminal state is still refused by `update_run`.

**Files changed:**
- `plugins/tk-studio/lib/jobrun.py` -- same-state terminal short-circuit in `finish` plus a docstring note.
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- three tests: the repeat is a no-op (run.json bytes and the ledger are unchanged), a repeat partial keeps the original reason, and a different terminal state is still refused.

**Review:** blind-hunter only (S-band). Patches 0, deferred 2 (both low, class b: a pre-existing `_finalize_run` summary-before-emit ordering, and an unlocked concurrent-finish race), rejected 0.

**Follow-up review:** false. Patched counts: high 0, medium 0, low 0; score 0.

**Verification:** `uv run python -m unittest discover tests` ran 2548 tests, OK (4 skipped). `uv run python ../contracts/conformance/runner.py run` returned `"ok": true`. All matrix tests ran and passed.

**Residual risk:** a repeat finish that carries a new cost or status_block now drops it silently, as the intent requires. The two deferred items above are the remaining AD-12 exactly-once gaps.

DEVIATIONS: none (deviation_score 0)

## Reconcile

- 2026-10-29 — score 0; reconcile not required.
- Spec resolution: unit key `dw-job-finish-idempotence` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run state.json), `spec-dw-5-job-finish-idempotence.md`.
- Part B note: this unit is a sweep DW bundle (DW-5), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `test_finish_repeat_same_state_is_noop` (run.json bytes + ledger unchanged), `test_finish_repeat_partial_keeps_original_reason`; AC2 `test_finish_different_terminal_state_still_refused`; AC3 per the Auto Run Result (2548 OK, conformance `ok: true`), and this session's rerun of `tests.test_jobrun` (92 OK). The two low deferrals (summary-before-emit ordering, concurrent-finish race) stay open in `deferred`.
Gate: Part A not-required (score 0); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met
