---
title: 'DW-20: wire consult_scope into the consult prompt'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: 'ef5ba8b0383235350d9fe41c46aa00187fd471ed'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `pipeline.py:392` writes the launch consult `scope` sentence to `.bmad-loop/routing.current.json` as `consult_scope`, but nothing reads it: `_bmad/custom/bmad-build-auto.toml` remembers only `consult_triggers` (l.56) and the STUDIO CONSULT fact (l.74) builds the consult prompt from the `Advisor:` line, `consult.md`, and the question. So the "schema shape is a planner matter" rule never reaches the consult (DW-20).

**Approach:** In the build-auto customization, remember `consult_scope` at STUDIO ACTIVATION 4/4 and insert it into the consult prompt between `consult.md` and the question, as a labelled scope line. Pin it with a test that renders the skill through the stock renderer and asserts the rendered prompt instruction carries the scope.

## Boundaries & Constraints

**Always:** stdlib-only test run by `unittest discover`; the edit is additive text in the two named toml strings; `consult.md` stays byte-identical (its nested copy is pinned by `test_nest_pipeline.py`); a missing or empty `consult_scope` must be stated as "omit the scope line", not an error.

**Block If:** the stock renderer cannot render the customization in a temp project root without network or non-stdlib deps (then HALT rather than inventing a different surface).

**Never:** edit `consult.md`, `pipeline.py`, `tk-studio-launch/customize.toml`, the deferred-work ledger, or `apps/supervisor/_bmad/custom/bmad-build-auto.toml` (an adapted fork for a separate project; out of this bundle); never write the test's render into the real repo's `_bmad/render/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| scope present | routing.current.json has non-empty `consult_scope` | consult prompt = Advisor line, consult.md, `Consult scope (routing.current.json consult_scope): <value>`, question | none |
| scope absent | key missing or `""` | the scope line is omitted; prompt otherwise unchanged | no HALT |

</intent-contract>

## Code Map

- `_bmad/custom/bmad-build-auto.toml:56` -- ACTIVATION 4/4 "Consult policy" line: remembers `consult_triggers` and `session.advisor`; add `consult_scope` (missing = empty).
- `_bmad/custom/bmad-build-auto.toml:74` -- STUDIO CONSULT persistent fact; sentence "Its prompt is the `Advisor:` line … then the full text of `…/consult.md` followed by the question." is the prompt recipe to extend.
- `plugins/tk-studio/lib/pipeline.py:391-392` -- writer of `consult_triggers` / `consult_scope` (read-only).
- `plugins/tk-studio/skills/tk-studio-launch/customize.toml` `[pipeline.consult] scope` -- source of the sentence, ends with "Schema shape for an artifact a later story or an operator produces is a planner matter…" (read-only).
- `_bmad/scripts/render_skill.py:326` `render(project_root, skill_dir) -> Path` -- stock renderer; returns the rendered `workflow.md`. Imports `config_utils` from its own dir (add `_bmad/scripts` to `sys.path`). Needs `<root>/_bmad/config.toml` (required) and reads `<root>/_bmad/custom/bmad-build-auto.toml`; writes under `<root>/_bmad/render/` (gitignored).
- `.claude/skills/bmad-build-auto/` -- tracked skill dir to render.
- `plugins/tk-studio/lib/tests/test_pipeline.py:1-30` -- test-module style to mirror (docstring stating what must hold, `REPO_ROOT` via `Path(__file__).resolve().parents[…]`).

## Tasks & Acceptance

**Execution:**
- `_bmad/custom/bmad-build-auto.toml` -- (1) l.56: remember `consult_scope` too (missing = empty). (2) l.74: change the prompt recipe to: the `Advisor:` line, then the full text of consult.md, then one line `Consult scope (routing.current.json consult_scope): <consult_scope>` (omitted when empty), followed by the question. -- the consult sees the planner-matter rule.
- `plugins/tk-studio/lib/tests/test_consult_scope_wiring.py` (new) -- in a `tempfile` project root, copy `_bmad/config.toml` and `_bmad/custom/bmad-build-auto.toml`, call `render_skill.render(tmp, REPO_ROOT/.claude/skills/bmad-build-auto)`, read the returned workflow.md, and assert: the Consult policy line names `consult_scope`; the STUDIO CONSULT paragraph names `consult_scope` after `consult.md` and before "the question"; and (chain) `pipeline.current_payload(pipeline.resolve(None))["consult_scope"]` contains "planner matter". -- DW-20's requested test, on the rendered surface.

**Acceptance Criteria:**
- Given the shipped customization, when bmad-build-auto is rendered, then the rendered workflow.md tells the session to remember `consult_scope` and to put it into the consult prompt between consult.md and the question.
- Given the shipped launch consult scope, when pipeline writes the routing payload, then `consult_scope` carries the schema-shape-is-a-planner-matter sentence the consult prompt now forwards.
- Given the change, when the verify gate runs, then the lib suite is green and conformance reports `ok: true`.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- layers: blind-hunter (6 findings), edge-case-hunter (0 findings); both ran (no story plan, so the S-band skip did not apply)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 6: (high 0, medium 0, low 6)
  - multi-line/non-string `consult_scope`: the source is a single TOML string (`tk-studio-launch/customize.toml` `[pipeline.consult] scope`); not AC-named
  - "diff does not re-render": `_bmad/render/` is gitignored (`.gitignore:9`) and every session renders at activation (content-addressed), so no committed render goes stale
  - `resolve(None)` "depends on live state": `pipeline.py:263-273` with no project root uses only the shipped resource defaults
  - key path in routing.current.json unasserted: `test_pipeline.py:278` already asserts `consult_scope` top-level in the written file
  - import-order shadowing: `_bmad/scripts/` has no `pipeline.py`
  - "omit" phrase check too loose: wording-level plumbing, not a contract (DEFERRAL DISCIPLINE)
- addressed_findings:
  - none

## Design Notes

The toml route is chosen over editing consult.md: consult.md is mirrored into `apps/supervisor` under a line-pinned render (`test_nest_pipeline.py:36`), and the session already assembles the consult prompt, so the scope belongs where `consult_triggers` is already read. If `pipeline.resolve(None)` does not resolve shipped defaults without a project root, the chain assertion reads the scope via whatever pipeline function returns the shipped consult policy (Grep `consult_policy` in pipeline.py).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_consult_scope_wiring -v` -- expected: all pass
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-10-29)

- planned: the test copies only `_bmad/config.toml` and `_bmad/custom/bmad-build-auto.toml` into the temp root / actual: it also copies whichever other central config layers exist (`config.user.toml`, `custom/config.toml`, `custom/config.user.toml`) / why: rendering needs `communication_language`, only in tracked `_bmad/config.user.toml`; with `config.toml` alone the render fails "missing config value" / may affect: none
- planned: find the Consult policy line in the rendered output / actual: lines are stripped before matching / why: the renderer indents activation text / may affect: none

DEVIATION SCORE: 1

DRIFT: test copies all present central config layers into the temp root, not only config.toml — render requires communication_language from config.user.toml — affects: none
DRIFT: rendered lines are stripped before matching the Consult policy line — renderer indents activation text — affects: none

## Consult Log

- 2026-10-29T19:37:46Z — trigger: deviation-gt-0 — question: accept the test copying all present central config layers (and stripping rendered lines) instead of config.toml only? — ruling: accept-deviation score 1 — do: Keep the layered copy loop and the line strip in test_consult_scope_wiring.py as written. / Leave the two DRIFT lines in the spec as the record; change no spec, renderer or config file. — rule candidate: A test that renders a skill through render_skill.render into a temp root must copy every central config layer that exists (the four load_central_config merges), not config.toml alone, and should match rendered lines after strip().

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T174706Z-da84bd` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** DW-20 resolved. The build-auto customization now remembers `consult_scope` from `routing.current.json` and puts it into the consult prompt as one line, `Consult scope (routing.current.json consult_scope): <consult_scope>`, between consult.md and the question. The line is omitted when the scope is empty. The schema-shape-is-a-planner-matter rule now reaches the consult.

**Files changed:**
- `_bmad/custom/bmad-build-auto.toml` -- ACTIVATION 4/4 remembers `consult_scope`; the STUDIO CONSULT prompt recipe carries the scope line.
- `plugins/tk-studio/lib/tests/test_consult_scope_wiring.py` (new) -- renders bmad-build-auto through the stock renderer in a temp root and asserts both instructions; asserts that the shipped `consult_scope` carries "planner matter".

**Review:** patches 0, deferred 0, rejected 6 (all low). Follow-up review: false (patched high 0 / medium 0 / low 0; score 0).

**Verification:** `uv run python -m unittest tests.test_consult_scope_wiring -v`: 3 OK. `uv run python -m unittest discover tests`: 2558 OK (4 skipped). `uv run python ../contracts/conformance/runner.py run`: `ok: true`.

DRIFT: test copies all present central config layers into the temp root, not only config.toml — render requires communication_language from config.user.toml — affects: none
DRIFT: rendered lines are stripped before matching the Consult policy line — renderer indents activation text — affects: none

**Residual risks:** `apps/supervisor/_bmad/custom/bmad-build-auto.toml` (an adapted fork for the supervisor project) still lacks this wiring. It was out of this bundle by intent. The test matches on two wording anchors (`Consult policy:` and "Its prompt is the `Advisor:` line"), so rewording either one fails the test loudly.

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Spec resolution: unit key `dw-consult-scope-wiring` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261029-174827-148a state.json), `spec-dw-20-consult-scope-wiring.md`.
- Part B note: this unit is a sweep DW bundle (DW-20), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `test_consult_policy_line_remembers_consult_scope`, `test_consult_prompt_places_scope_between_consult_md_and_question`; AC2 `test_routing_payload_carries_planner_matter_scope`; AC3 per the Auto Run Result (2558 OK, conformance `ok: true`), and this session's rerun of `tests.test_consult_scope_wiring` (3 OK). Residual: `apps/supervisor/_bmad/custom/bmad-build-auto.toml` fork still lacks the wiring (out of bundle by intent).
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met
