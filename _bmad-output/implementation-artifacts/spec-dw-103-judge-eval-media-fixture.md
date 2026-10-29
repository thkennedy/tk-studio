---
title: 'DW-103: the playable-judge eval case carries its media fixture into the working directory'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: '75697973d0b4ab794110c71e3e552b5395999590'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
deviation_score: 0
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/prompt.md` passes `{media: "media"}` relative to "this case's folder", but `claude plugin eval` runs the session in a temp working directory (`/tmp/claude-eval-*/`) holding no fixture, so the skill reports the media folder absent and every run ends `blocked` — the case measures the harness, not the skill (DW-103, operator run q-maintenance-evals-20261029T121940Z-40fe02).

**Approach:** The prompt names the fixture absolutely, under `${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media`, has the session copy that folder into a folder under its own working directory first, and then judges the copy (payload `directory` = that working-directory folder, `media` = `media`). The grader's read-scope criterion admits that one copy step. A unit test pins the prompt's fixture path and the fixture's completeness.

## Boundaries & Constraints

**Always:** The judged media is the working-directory copy; `answer.json` and `judge.json` land in the copy. The fixture path resolves through `${CLAUDE_PLUGIN_ROOT}` (the plugin's path convention, `skills/tk-studio-evals/SKILL.md:56`). Grader criteria 1, 2 and 4 keep their meaning. Stdlib-only tests.

**Block If:** The fix requires changing `lib/evals.py`'s `claude plugin eval` argv, the driver contract, or the eval harness itself.

**Never:** Write into the plugin tree (no `answer.json`/`judge.json` under `${CLAUDE_PLUGIN_ROOT}`); change the fixture's frames or `report.json`; edit the deferred-work ledger; re-run `maintenance-evals` or touch the acceptance record (operator steps).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Harness run | cwd `/tmp/claude-eval-*/`, empty | session copies the fixture to `./<case folder>/media`, prepares, judges, `judge.json` written in the copy, status block `complete` | none |
| Re-run in a dirty cwd | a prior copy already present | the copy is replaced fresh (no stale `answer.json`/`judge.json` survives) | none |

</intent-contract>

## Code Map

- `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/prompt.md` -- the case prompt (frontmatter `allowed_tools` already includes Bash, Write); lines 6-13 carry the broken relative payload.
- `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/graders/criteria.md` -- criterion 3 + the closing "Fail the response if ... read any file outside `media/`" line must admit the fixture copy step.
- `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/media/` -- read-only fixture: `report.json`, `frames/tick-000000.png`, `frames/tick-000030.png`.
- `plugins/tk-studio/skills/tk-studio-playable-judge/SKILL.md` -- read-only; the skill writes `answer.json` and (via core) `judge.json` under `<directory>/<media>`, hence the copy.
- `plugins/tk-studio/lib/tests/test_evals.py` -- add the regression test here (module already holds `CASES`; plugin root = `Path(__file__).resolve().parents[2]`).
- `plugins/tk-studio/lib/evals.py` -- read-only; runs `claude plugin eval ... --allow-tools Bash Write` per case.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/prompt.md` -- rewrite the body: first copy `"${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media"` into a fresh folder under the working directory (remove any prior copy first; never write under the plugin root), then run the skill with that folder as `directory` and `media` as `media`; keep the remaining judge steps and the final `judge.json` print -- the case must carry its fixture.
- `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/graders/criteria.md` -- amend criterion 3 and the fail line so the one copy of the fixture folder from the plugin root is allowed, while reading/listing/grepping anything else outside the copied `media/` still fails; add that nothing may be written under the plugin's `evals/` folder -- grader must not fail the fix itself.
- `plugins/tk-studio/lib/tests/test_evals.py` -- add a test: the prompt names `${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media`, no longer says the media is "already there" in the case folder, and the fixture's `report.json` parses and every `frames[]` entry exists on disk under `media/` -- regression pin for DW-103.

**Acceptance Criteria:**
- Given the case prompt, when it is read, then it names the absolute fixture path under `${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media`, instructs copying it into the working directory before judging, and judges the copy (never the plugin tree).
- Given the grader, when a run copies the fixture then judges it, then criterion 3 does not fail it on the copy step.
- Given the lib suite and conformance, when the verify gate runs, then both are green including the new test.
- Re-running `maintenance-evals` and re-reading the acceptance row: `unverifiable-here` (operator: run the `maintenance-evals` job on the sandbox tier, then re-read the Story 35.5 acceptance record row for `tk-studio-playable-judge-verdict`).

## Spec Change Log

## Review Triage Log

skipped-layer: edge-case-hunter — S-band story

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 0
- reject: 1 (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` graders/criteria.md fail clause's exception ("the one copy of the fixture folder") read as reading the copy, so a grader could fail a correct run for the `cp -R` source read — reworded criterion 3 and the fail clause: the single `cp -R` of the fixture folder is the one permitted access outside the copied `media/`.
  - `[low]` `[patch]` prompt.md gave no instruction when the copy fails (e.g. `CLAUDE_PLUGIN_ROOT` unset), inviting a fixture search outside `media/` — added: on a failed copy, end `blocked` with the status block naming it, never search.
  - `[low]` `[patch]` test_evals.py harness-run test scanned only `media/` for written `answer.json`/`judge.json`; the invariant is the whole case folder — now `self.CASE.rglob`.
- rejected: grader does not *require* the `rm -rf` fresh copy — beyond the AC (the grader must only not fail the copy step); the harness's temp cwd is fresh per run, and the prompt + `test_a_rerun_replaces_the_prior_copy_before_copying` pin the ordering.

### 2026-10-29 — Review pass (follow-up)
skipped-layer: edge-case-hunter — S-band story
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 0, low 2)
- defer: 0
- reject: 3 (high 0, medium 0, low 3)
- addressed_findings:
  - `[low]` `[patch]` graders/criteria.md criterion 3 and the fail clause only failed writes under the plugin's `evals/` folder, narrower than the prompt's "Never write under `${CLAUDE_PLUGIN_ROOT}`" and the spec's Never rule — widened both to any write under `${CLAUDE_PLUGIN_ROOT}` (the plugin tree, `evals/` included).
  - `[low]` `[patch]` no test pinned AC 1's "judges the copy (never the plugin tree)" — added `test_the_judging_targets_the_working_directory_copy` (payload `directory` is the working-directory copy, `cp -R` precedes `prepare --media <directory>/media`, no `--media ${CLAUDE_PLUGIN_ROOT}`).
- rejected: (1) `${CLAUDE_PLUGIN_ROOT}` may be unset in the eval session — the judged skill's own core already runs through `${CLAUDE_PLUGIN_ROOT}` (`skills/tk-studio-playable-judge/SKILL.md:27,58`), so the fix adds no new dependency; already carried as residual risk. (2) `test_the_harness_run_writes_only_into_the_working_directory_copy` is static, not a live run — naming only; the live run is the operator's `unverifiable-here` step. (3) `rm -rf ./tk-studio-playable-judge-verdict` collides with the case folder name if the cwd were the plugin's `evals/` — the harness always uses a fresh temp cwd, and the I/O matrix pins `./<case folder>/media`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-10-29)

DEVIATIONS: none (implementer pass 1, and the matrix-audit relaunch that added two `JudgeCaseFixtureTests`)
DEVIATION SCORE: 0

### pass 2 — follow-up review (2026-10-29)

DEVIATIONS: none (implementer patch pass: graders/criteria.md write scope, one new `JudgeCaseFixtureTests` method)
DEVIATION SCORE: 0

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T200840Z-2846e6` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Follow-up review of DW-103 (spec arrived `done`, `followup_review_recommended: true`). The `tk-studio-playable-judge-verdict` eval case copies `${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media` into `./tk-studio-playable-judge-verdict/media` in the harness working directory and judges the copy. This pass tightened the grader's write scope to the whole plugin tree and pinned that the judging targets the copy.

**Files changed (this pass):**
- `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/graders/criteria.md` — criterion 3 and the fail clause now fail any write under `${CLAUDE_PLUGIN_ROOT}`, not only under `evals/`.
- `plugins/tk-studio/lib/tests/test_evals.py` — `test_the_judging_targets_the_working_directory_copy` (5th `JudgeCaseFixtureTests` method).

**Review:** blind-hunter only (S-band); 2 patches applied (low 2), 0 deferred, 3 rejected. Follow-up review: patched high 0, medium 0, low 2 → score 3×0 + 1×2 = 2 → `followup_review_recommended: false`.

**Verification:** from `plugins/tk-studio/lib`, `uv run python -m unittest discover tests` → 2598 tests OK (4 skipped); `uv run python ../contracts/conformance/runner.py run` → exit 0, `ok: true`.

**Unverifiable here (operator):** re-run the `maintenance-evals` job on the sandbox tier (case `tk-studio-playable-judge-verdict`), then re-read the Story 35.5 acceptance record row for `tk-studio-playable-judge-verdict`.

**Residual risk:** the fix is prompt-driven; tests pin the prompt text and fixture, not a live harness run. It relies on the harness exporting `CLAUDE_PLUGIN_ROOT` to Bash, as the judge skill's core already does. `_bmad-output/implementation-artifacts/deferred-work.md` carries the orchestrator's uncommitted DW-103 status change; per the invocation it was left untouched and uncommitted, so the working copy is clean except for that orchestrator-owned file.

## Reconcile

- 2026-10-29 — score 0; reconcile not required.
- Spec resolution: unit key `dw-judge-eval-media-fixture` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261029-200950-8dfd state.json), `spec-dw-103-judge-eval-media-fixture.md`.
- Part B note: this unit is a sweep DW bundle (DW-103), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `prompt.md:8-16` (absolute `${CLAUDE_PLUGIN_ROOT}` fixture path, `cp -R` into `./tk-studio-playable-judge-verdict/media`) pinned by `JudgeCaseFixtureTests` (5 methods, incl. `test_the_judging_targets_the_working_directory_copy`); AC2 `graders/criteria.md:26-40` exempts the single `cp -R`; AC3 this session's rerun of `tests.test_evals`: 32 OK (full suite + conformance per Auto Run Result); AC4 unverifiable-here (operator: re-run `maintenance-evals` on the sandbox tier, re-read the Story 35.5 acceptance row for `tk-studio-playable-judge-verdict`).
- Gate: Part A not-required; Part B not applicable (sweep DW bundle, no stories.yaml entry); ACs spot-checked as met, AC4 unverifiable-here.
