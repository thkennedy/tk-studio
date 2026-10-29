---
title: 'DW-34: pin the office sprite atlas line endings in .gitattributes'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
deviation_score: 0
reconcile_verdict: not-required
baseline_revision: '4dd137c4588fe14e4a14de3c1dd2fcf8450be501'
---

<intent-contract>

## Intent

**Problem:** `apps/studio-web/public/sprites/office.json` is compared byte-for-byte with the exporter's LF output (`plugins/tk-studio/lib/tests/test_sprites_export.py:93`, `tools/sprites/export.py --check` at `:369`), but `.gitattributes` does not pin it, so a Windows checkout with `core.autocrlf=true` rewrites it to CRLF and both checks fail. `office.png` is likewise compared byte-for-byte and is only protected by git's binary autodetection.

**Approach:** Add a commented block to `.gitattributes` (naming Story 30.7) pinning `office.json` to `text eol=lf` and `office.png` to `binary`, in the file's existing comment-plus-rule style.

## Boundaries & Constraints

**Always:** Match the existing `.gitattributes` style (a `#` comment explaining why, then the rule). Exact paths, no broad globs. The committed blob bytes of `office.json` / `office.png` stay unchanged (index already holds LF / non-text).

**Block If:** Applying the attributes would change the committed blob of either file (renormalization diff appears).

**Never:** Edit the deferred-work ledger. Touch the sprite sources, the exporter, or the test. Broaden the pin to other files.

</intent-contract>

## Code Map

- `.gitattributes` -- lines 1-3 measurements `eol=lf` pin (AD-12), lines 5-7 installer pin (Story 25.4); the new block goes after them.
- `apps/studio-web/public/sprites/office.json` -- READ-ONLY; `git ls-files --eol` shows `i/lf w/lf attr/` today.
- `apps/studio-web/public/sprites/office.png` -- READ-ONLY; `i/-text w/-text attr/` today.
- `plugins/tk-studio/lib/tests/test_sprites_export.py:88-94` -- byte-for-byte reproducibility test (the guarded behaviour).
- `tools/sprites/export.py:368-372` -- `--check` byte comparison (the guarded behaviour).

## Tasks & Acceptance

**Execution:**
- `.gitattributes` -- append a block: comment naming Story 30.7 and the byte-for-byte check, then `apps/studio-web/public/sprites/office.json text eol=lf` and `apps/studio-web/public/sprites/office.png binary` -- so checkout never rewrites the committed export bytes.

**Acceptance Criteria:**
- Given the updated `.gitattributes`, when `git check-attr text eol -- apps/studio-web/public/sprites/office.json` runs, then it reports `text: set` and `eol: lf`.
- Given the updated `.gitattributes`, when `git check-attr binary diff text -- apps/studio-web/public/sprites/office.png` runs, then it reports `binary: set` and `text: unset`.
- Given the updated `.gitattributes`, when `git add --renormalize apps/studio-web/public/sprites/ && git status --short apps/studio-web/public/sprites/` runs, then no sprite file is listed as changed.
- Given the change, when the VERIFY GATE runs, then `test_sprites_export` passes inside the full lib suite and conformance reports `ok: true`.

## Spec Change Log

## Review Triage Log

skipped-layer: edge-case-hunter — S-band story

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - none
- reject reason: "existing CRLF checkouts are not repaired until re-checkout" — operational note, not a defect in the diff; carried as a residual risk in the Auto Run Result.

## Verification

**Commands:**
- `git check-attr text eol binary -- apps/studio-web/public/sprites/office.json apps/studio-web/public/sprites/office.png` -- expected: json `text: set`, `eol: lf`; png `binary: set`, `text: unset`.
- `git ls-files --eol apps/studio-web/public/sprites/` -- expected: json `i/lf w/lf attr/text eol=lf`; png `i/-text w/-text attr/-text`.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.

## Deviation Summary

### pass 1 (2026-10-29)

DEVIATIONS: none
DEVIATION SCORE: 0

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T200840Z-2846e6` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Resolves DW-34. `.gitattributes` now pins `apps/studio-web/public/sprites/office.json` to `text eol=lf` and `office.png` to `binary`, with a comment naming Story 30.7, so a Windows `core.autocrlf=true` checkout no longer rewrites the bytes that the reproducibility test and `export.py --check` compare.

**Files changed:**
- `.gitattributes` -- new commented block that pins the office sprite atlas (two exact-path rules).

**Review findings:** blind-hunter only (S-band). 0 patches, 0 deferred, 1 rejected (low).

**Follow-up review:** false. Patched: high 0, medium 0, low 0; score 0.

**Verification:**
- `git check-attr`: json `text: set`, `eol: lf`; png `binary: set`, `text: unset`.
- `git ls-files --eol`: json `i/lf w/lf attr/text eol=lf`; png `i/-text w/-text attr/-text`.
- `git add --renormalize apps/studio-web/public/sprites/`: no sprite file changed (Block If not triggered).
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 2576 tests, OK (skipped=4).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.

**Residual risks:** a Windows clone that already has a CRLF `office.json` on disk keeps it until git next writes the file. The operator fixes it with `git checkout -- apps/studio-web/public/sprites/office.json` (or `git add --renormalize . && git checkout -- .`).

## Reconcile

- 2026-10-29 — score 0; reconcile not required.
- Spec resolution: unit key `dw-office-json-eol-pin` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261029-200950-8dfd state.json), `spec-dw-34-office-json-eol-pin.md`.
- Part B note: this unit is a sweep DW bundle (DW-34), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `git check-attr` json `text: set`, `eol: lf`; AC2 png `binary: set`, `text: unset`; AC3 `git ls-files --eol` json `i/lf w/lf attr/text eol=lf`, png `i/-text w/-text attr/-text` (index already matches, no renormalization diff); AC4 relies on the dev session's recorded lib suite (2576 OK) and conformance `ok: true`, not rerun here.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle, no stories.yaml entry); ACs spot-checked as met.
