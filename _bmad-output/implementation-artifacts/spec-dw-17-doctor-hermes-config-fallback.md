---
title: 'DW-17: doctor hermes-logins falls back to a line scan when miniyaml refuses Hermes config.yaml'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
deviation_score: 0
reconcile_verdict: not-required
baseline_revision: '98a78b4e861316e419f0adf590fce3c3b5a9cef9'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `tk-studio doctor`'s hermes-logins check (`check_hermes`) ends `warn: config.yaml unreadable` on real Hermes configs, because miniyaml refuses Hermes's flow mapping `{}` (`unsupported YAML construct`), so `auth.adopt_external_logins` is never read (DW-17).

**Approach:** When `miniyaml.loads` raises `MiniYamlError`, `check_hermes` falls back to a targeted line scan for `adopt_external_logins:` directly under the top-level block-style `auth:` and classifies the raw value with the existing true/false/quoted rules. miniyaml stays unchanged.

## Boundaries & Constraints

**Always:** stdlib only. Reuse the existing classification (YAML_TRUE / YAML_FALSE / quoted-is-a-string / null-is-absent) — one classification path for both the parsed and scanned value. Keep the existing `_hermes_value_quoted` behaviour for the parsed path. `OSError` / `UnicodeDecodeError` still end `unreadable`. A config where the full parse fails AND the scan finds no `adopt_external_logins` under a block-style `auth:` still ends `warn ... unreadable ... not checked` (absence cannot be proven from an unparsed file — e.g. `auth: {adopt_external_logins: true}`).

**Block If:** the fix appears to require changing `miniyaml.py` (either copy).

**Never:** edit `tools/installer/cli/tk_studio_cli/miniyaml.py` or `plugins/tk-studio/lib/miniyaml.py`; edit the deferred-work ledger; touch other doctor checks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real Hermes shape, off | config with `{}` values elsewhere, `auth:\n  adopt_external_logins: false` | `pass`, detail "is off in" | No error expected |
| Real Hermes shape, on | same, value `true` (or `yes`/`On`) | `warn`, detail "is on in", fix names `hermes gateway restart` | — |
| Quoted in fallback | same, value `"false"` | `warn`, "not clearly off", names the string | — |
| Trailing comment | value `false  # set by hand` | `pass` | comment stripped (` #` rule) |
| Null / empty | value `null`, `~`, or nothing | `pass`, "absent (off)" | — |
| Key not found / not block auth | `providers: [a, b]` or `auth: {}` | `warn`, "unreadable", names the path | unchanged behaviour |

</intent-contract>

## Code Map

- `tools/installer/cli/tk_studio_cli/doctor.py:1139-1185` -- `check_hermes`: the `except (miniyaml.MiniYamlError, OSError, UnicodeDecodeError)` at :1158 returns the unreadable warn; split so only `MiniYamlError` attempts the scan. Classification at :1163-1185 (value/quoted/word → True/YAML_TRUE warn, False/YAML_FALSE pass, None pass, else "not clearly off" warn).
- `tools/installer/cli/tk_studio_cli/doctor.py:1188-1206` -- `_hermes_value_quoted`: existing line scanner of the top-level `auth:` block (first child indent, skips blank/comment lines). Reuse point: factor its walk into a helper returning the raw text after `adopt_external_logins:` (or None when not found), and have both `_hermes_value_quoted` and the fallback use it.
- `tools/installer/cli/tk_studio_cli/doctor.py:77-79` -- `YAML_TRUE` / `YAML_FALSE`.
- `tools/installer/cli/tk_studio_cli/miniyaml.py:86-113` -- read-only evidence: `_parse_scalar` maps `null`/`~`/"" → None, `true`/`false` → bools, refuses `{`/`[`; trailing comment needs whitespace before `#` (:78). Fallback must mirror these for the one scalar.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py:1659-1754` -- `class Hermes(DoctorCase)`; `self.hermes(text)` writes `$LOCALAPPDATA/hermes/config.yaml`; `test_unreadable_warns_naming_the_path` (`providers: [a, b]`) must stay green.
- `plugins/tk-studio/lib/tests/fixtures/` -- existing fixture dirs (`planner-note/`, ...); new fixture dir goes here.

## Tasks & Acceptance

**Execution:**
- `tools/installer/cli/tk_studio_cli/doctor.py` -- on `MiniYamlError`, scan for the raw `adopt_external_logins` scalar under block `auth:`; if found, derive `value` (plain: strip ` #` comment, map null/~/""→None, `true`/`false`→bool, else the string; quoted: strip the quotes, mark quoted) and fall through to the existing classification; if not found, return the existing unreadable warn. Refactor `_hermes_value_quoted` onto the shared scan helper. -- resolves DW-17 without touching miniyaml.
- `plugins/tk-studio/lib/tests/fixtures/hermes-config/config.yaml` -- new fixture shaped like a real Hermes config.yaml: several top-level sections, at least two `{}` flow values (e.g. `providers: {}`, `mcp_servers: {}`), comments, and an `auth:` block with sibling keys and `adopt_external_logins: false`. -- the DW-17 fixture.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py` -- in `class Hermes`, add tests covering every I/O-matrix row using the fixture (substituting the value for on/quoted/comment/null rows) and assert miniyaml really refuses the fixture (so the test exercises the fallback). -- proves the fix.

**Acceptance Criteria:**
- Given the fixture with `{}` values and `adopt_external_logins: false`, when `doctor` runs on Windows with `LOCALAPPDATA/hermes/config.yaml` = fixture, then hermes-logins is `pass` with "is off in" (not "unreadable").
- Given the same fixture with the value `true`, when doctor runs, then hermes-logins is `warn` with "is on in" and a fix naming `hermes gateway restart`.
- Given `miniyaml.py` in both locations, when the change lands, then `git diff --stat` shows neither file changed.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- layers: blind-hunter, edge-case-hunter (no story plan, so no S-band skip)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` fallback read an empty `adopt_external_logins:` as absent (off) even when a deeper-indented continuation scalar or nested block followed (PyYAML reads true/dict). Now unproven → "unreadable" warn; tests added.
  - `[medium]` `[patch]` fallback took the first of duplicate keys / auth blocks, but PyYAML keeps the last. More than one match is now unproven → "unreadable" warn; tests added.
- rejected: the detail does not say a line scan decided the result, and the `_hermes_value_quoted` docstring "already validated" holds for its only caller (the parsed path). This is cosmetic, and the intent does not ask for it.

### 2026-10-29 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (no story plan, so no S-band skip)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` a top-level `auth` key that is not exactly block `auth:` (flow `auth: {...}`, `"auth":`, `'auth':`, `auth :`) was ignored. So block `false` plus a later flow `auth: {adopt_external_logins: true}` PASSed, though PyYAML keeps the last key. Any such spelling is now unproven → "unreadable" warn; `test_other_top_level_auth_spelling_is_unproven`.
  - `[medium]` `[patch]` the continuation guard only ran after an empty value. `false` plus a deeper `    true` PASSed, though PyYAML folds the two into the truthy string 'false true'. A deeper line after any match is now unproven; `test_deeper_line_after_a_value_is_unproven`.
  - `[medium]` `[patch]` an empty value followed by a same-indent indentless sequence (`- true`) PASSed as absent (off), though PyYAML reads `[True]`. Now unproven; `test_empty_value_then_indentless_sequence_is_unproven`.
  - `[low]` `[patch]` duplicates spelled differently (`adopt_external_logins :`, a quoted key) were not counted, so plain `false` plus a later `true` in another spelling PASSed. Keys are now normalised before comparing; `test_differently_spelled_duplicate_key_is_unproven`.
  - `[low]` `[patch]` (found by this session while integrating) on the parsed path, `auth :` parses in miniyaml but the scan is unproven there. `_hermes_value_quoted` returned False, so a quoted `"false"` PASSed. An unproven raw scalar now counts as quoted → "not clearly off" warn; `test_unproven_raw_scalar_on_parsed_path_is_not_clearly_off`.
- rejected: `test_empty_value_before_a_sibling_stays_absent` repeats the `""` subTest of `test_null_or_empty_is_absent_off`. It is a harmless overlap whose comment documents the sibling boundary, so the note is cosmetic.

### 2026-10-29 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (no story plan, so no S-band skip)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[low]` `[patch]` a top-level explicit key or node property (`? auth`, `!!str auth:`, `&a auth:`, an alias key `*k :`, or an escaped quoted key `"au\x74h":`) slipped past the "other auth spelling" guard, so block `false` plus such a later auth (PyYAML keeps it, true) PASSed. Any top-level line starting with `?`/`!`/`&`/`*`, or a double-quoted key with a backslash, is now unproven; `test_top_level_explicit_key_or_node_property_is_unproven`.
  - `[low]` `[patch]` the same gap for the child key's duplicate check: `&a`/`!!str`/`? ` spellings or an escaped quoted `adopt_external_logins` after `false` PASSed. Such a child line at the child indent is now unproven; `test_child_explicit_key_property_or_escape_is_unproven`.
  - `[low]` `[patch]` on the parsed path, an unproven raw scalar (e.g. under `auth :`) was reported as "the quoted string 'yes'" ("not clearly off"), though the value is plain and PyYAML reads it as true. `_hermes_value_quoted` now distinguishes quoted (True), plain (False) and unproven (None): an unproven YAML_TRUE word warns "is on in", an unproven false word never PASSes, and only a really quoted value is called "the quoted string"; `test_unproven_plain_string_on_parsed_path_is_not_called_quoted`.
- rejected:
  - the parsed path trusts a bool without the scan's ambiguity guards. A probe shows miniyaml itself refuses every such shape (duplicate keys, quoted keys, continuations, indentless sequences), and those all go to the fallback; the one spelling miniyaml accepts (`auth :`) reads the same as PyYAML.
  - the fallback's "unreadable" detail quotes the miniyaml error rather than the scan's reason. It is cosmetic: the detail is accurate (not parsed, not checked) and the fix says to check by hand.
  - a fallback config with no `adopt_external_logins` at all still warns "unreadable" instead of passing as absent. The intent's **Always** clause pins this: absence cannot be proven from an unparsed file.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_installer_doctor` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `git diff --stat -- tools/installer/cli/tk_studio_cli/miniyaml.py plugins/tk-studio/lib/miniyaml.py` -- expected: empty

## Deviation Summary

### pass 1 (2026-10-29)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 2 (2026-10-29, review patches)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 3 (2026-10-29, follow-up review patches)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 4 (2026-10-29, follow-up review 2 patches)

DEVIATIONS: none
DEVIATION SCORE: 0

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T200840Z-2846e6` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** second follow-up review of DW-17 (doctor's hermes-logins check falls back to a line scan for `auth.adopt_external_logins` when miniyaml refuses Hermes's config.yaml). This pass closed the remaining YAML spellings that let the scan PASS while PyYAML could hand Hermes a truthy value: explicit keys (`?`), tags (`!`), anchors (`&`), alias keys (`*`) and escaped double-quoted keys, at both the top level and the auth child level, now count as unproven, which keeps the "unreadable" warn. On the parsed path, an unproven raw scalar is no longer called "the quoted string": an unproven `yes`/`true`/`On` warns "is on in", an unproven false word never PASSes, and other unproven strings warn "not clearly off" with their plain repr. miniyaml is unchanged in both copies.

**Files changed (this pass):**
- `tools/installer/cli/tk_studio_cli/doctor.py`: `_hermes_raw_value` treats top-level `?!&*`-led lines, escaped quoted keys, and child `?!&`-led or escaped keys as unproven. `_hermes_value_quoted` returns True (quoted), False (plain) or None (unproven), and `check_hermes` classifies the three accordingly.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py`: 3 new `Hermes` tests, one per patched finding.

**Review findings:** 3 patches applied (low 3), 0 deferred, 3 rejected.

**Follow-up review:** not recommended (`false`). Patched: high 0, medium 0, low 3. Score 3×0 + 3 = 3 < 5.

**Verification:** run by this session after the implementer's report. `uv run python -m unittest tests.test_installer_doctor`: 142 tests OK. `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 2576 tests OK, 4 skipped. `runner.py run`: `ok: true`. `git diff --stat` on both miniyaml.py copies: empty. The implementer ran every new test against the previous code first: 8 subtest/test failures for the first three tests, then 2 more for the alias-key and escaped-key cases added afterwards. A probe script re-run here confirms that the reviewer-reported `? auth`, `!!str auth:` and `&a` child shapes now return unproven (they used to return `'false'`).

**Residual risks:** the scan is still a heuristic over a file miniyaml cannot parse. Every shape found so far resolves conservatively to a warn, never a PASS, but multi-document streams and flow-style auth content beyond `{...}` on the key line have not been exercised. The fixture is shaped like a Hermes config, not copied from a real one, so it is still worth running `tk-studio doctor --json` on TIM-PC-2. A `uv run` in `tools/installer/cli` fails, because it cannot symlink a venv on this box; the partial `.venv` it created this session was removed.

The orchestrator's uncommitted change to `_bmad-output/implementation-artifacts/deferred-work.md` (DW-17 status/resolution) was present before this run. It was left as is and not committed, because the invocation reserves the ledger to the orchestrator. It is the only file left dirty.

## Reconcile

- 2026-10-29 — score 0; reconcile not required.
- Spec resolution: unit key `dw-doctor-hermes-config-fallback` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261029-200950-8dfd state.json), `spec-dw-17-doctor-hermes-config-fallback.md`.
- Part B note: this unit is a sweep DW bundle (DW-17), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `Hermes…test_off_passes` (fixture with `{}` values; `test_miniyaml_refuses_the_fixture` proves the fallback runs); AC2 `test_on_warns_naming_the_fix` ("is on in", `hermes gateway restart`); AC3 `git diff --stat 98a78b4 HEAD` on both miniyaml.py copies is empty. This session's rerun of `tests.test_installer_doctor`: 142 OK. Unverifiable here: `tk-studio doctor --json` against a real Hermes config on TIM-PC-2.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle, no stories.yaml entry); ACs spot-checked as met.
