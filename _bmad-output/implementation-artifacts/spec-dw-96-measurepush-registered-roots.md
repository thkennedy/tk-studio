---
title: 'DW-96: measurepush push harvests Stage Log rows from every registered project root'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: '70882830d942ed72b576e32d1e677b133b990cce'
deviation_score: 1
review_loop_iteration: 0
followup_review_recommended: false
reconcile_verdict: not-required
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `measurepush.py push` calls `harvest_stages(directory)` with only its `--directory` (the studio repo, `plugins/tk-studio/lib/measurepush.py:301`), so completed `## Stage Log` rows in other registered project roots never become `stage` events (DW-96, from Story 35.8 AC3).

**Approach:** `harvest_stages` harvests the given directory exactly as today, then every root in the registry (`registry.list_projects()`), skipping missing or unreadable roots without failing. Each event is tagged with its root's `project_id`; rows from non-studio roots get a project-qualified `row_key` (`<project_id>:<sha12>`) so equal story ids cannot collide; the studio repo's keys stay the bare sha12 so a re-push adds nothing. The result reports per-project counts.

## Boundaries & Constraints

**Always:** Stdlib-only; the harvest never stops the push (existing `try` in `push` stays). The studio directory's row keys and payloads are byte-identical to today's. A registry root that resolves to the studio directory is harvested once, as the studio repo (unqualified keys). Each distinct resolved root is harvested at most once per push. Existing result keys `emitted`, `already`, `row_keys`, `dry_run` keep their meaning as totals across all roots. `harvest_stages(directory, dry_run=False)` keeps its signature (a test monkeypatches it).

**Block If:** none anticipated.

**Never:** Write to the registry; change `plansync.stage_row_key`; change the push motion (branch/commit/PR); fail the push or the harvest because a registry root is missing, not a directory, or unreadable, or the registry itself is unreadable.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two registered fake roots | registry has roots A, B each with a spec carrying completed Stage Log rows, same story id in both | first push: one `stage` event per completed row of each root, `project` = its project_id, `row_key` = `<project_id>:<sha12>`; `projects` counts per id | none |
| Re-push | same state, second push | `emitted` 0 everywhere; `already` equals first push's `emitted`, per project too | none |
| Missing root | registry entry root path deleted | root listed under `skipped_roots` with a reason; other roots harvested | no exception |
| Registry unreadable | projects.yaml corrupt | studio directory still harvested; `registry_error` recorded | no exception |
| Studio root registered | registry entry root == `--directory` | harvested once with unqualified keys | none |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/measurepush.py:262-287` -- `harvest_stages`: the single-root harvest to generalise; `_ledger_stage_keys` (211) gives the dedupe set from `payload.row_key`; `stage_payload` (225) builds the payload from `entry["key"]` — pass the (possibly qualified) key through.
- `plugins/tk-studio/lib/measurepush.py:300-304` -- call site in `push`; unchanged except it now carries the wider result.
- `plugins/tk-studio/lib/registry.py:67-82` -- `load_registry()` / `list_projects()` read API (`project_id -> {root, ...}`); raises `RegistryError` on an unreadable file; absent file = empty map. Read-only use.
- `plugins/tk-studio/lib/plansync.py:3239` -- `stage_rows(root)` -> `{story, path, key, row}`; `stage_row_key` (2267) stays untouched.
- `plugins/tk-studio/lib/tests/test_measurepush.py:335-404` -- existing 35-8 harvest tests (`TK_STUDIO_HOME` points the store, hence the registry, at a temp dir); `test_push_emits_one_stage_event_per_completed_row_then_none` is the template for the new test.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json:111-128` and `plugins/tk-studio/contracts/driver-contract.md:1702-1706` -- `stage` event emitter/`row_key` notes; update to name the registry harvest and the qualified key form (additive, notes only).
- `plugins/tk-studio/lib/measurepush.py:1-33` -- module docstring "Discipline" paragraph names the harvest scope; update.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/measurepush.py` -- generalise `harvest_stages` per Approach; add result fields `projects: {<project_id>: {"emitted", "already"}}`, `skipped_roots: [{"project_id", "root", "reason"}]`, and `registry_error` (only when the registry read failed). The studio directory's label in `projects` is its config `project_id` when resolvable, else the matching registry id, else the directory name. Update the docstring. -- closes DW-96.
- `plugins/tk-studio/lib/tests/test_measurepush.py` -- add tests: two fake registered roots (same story id in both) emit project-tagged, project-qualified events and a second push emits none (per-project counts asserted); a missing registered root is skipped and the push still reports; a registered root equal to the studio repo keeps unqualified keys and is harvested once. Register roots by writing a valid `projects.yaml` under the test store or via `registry.register(root, "onboard", project_id=...)`.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json`, `plugins/tk-studio/contracts/driver-contract.md` -- notes: harvest covers the `--directory` repo plus every registry root; `row_key` is the bare sha12 for the studio repo and `<project_id>:<sha12>` for other roots. -- AD-19 contract in step with code.

**Acceptance Criteria:**
- Given two registered fake roots each holding completed Stage Log rows under the same story id, when `measurepush.push` runs, then each row lands as one `stage` event carrying its root's `project` and a project-qualified `row_key`, and `stage_events.projects` reports per-project `emitted` counts.
- Given that first push, when `push` runs again, then `stage_events.emitted` is 0 and each project's `already` equals its first-push `emitted`.
- Given the existing 35-8 tests, when the suite runs, then they pass unchanged (studio keys unchanged).

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 4: (high 0, medium 2, low 2)
- addressed_findings:
  - `[medium]` `[patch]` emit failure mid-root discarded partial counts and mislabelled the root as unreadable — read vs emit split; partial tallies merged; `emit failed: …` reason recorded; test added
  - `[low]` `[patch]` no test for an unreadable registered root — test added (stage_rows raising for one root; others still harvested)
  - `[low]` `[patch]` driver-contract did not state shapes of `projects`/`skipped_roots`/`registry_error` — shapes added
  - `[low]` `[patch]` over-long rewrapped line in driver-contract — rewrapped
- rejected (one-line reasons):
  - dedupe key depends on `--directory`: `push` refuses any directory that is not the studio repo (`_is_studio_repo` preflight), so a registered project root is never the `--directory`, and pre-DW-96 pushes only ever harvested the studio repo — no bare keys from other roots exist.
  - studio `projects` label vs events' `project` mismatch: consult ruling (spec Always rule — studio payloads byte-identical).
  - `projects` label collision between studio config id and a different registry root: registry.py refuses a key matching an existing entry with a different root; misconfiguration, not reachable via the single writer.
  - registry entry with no `root` → `Path("None")`: `registry.validate_registry` rejects entries missing `root` or not mappings, which surfaces as `registry_error`.
- skipped-layer: none (both blind-hunter and edge-case-hunter ran; no S-band plan)

### 2026-10-29 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 1, medium 0, low 1)
- defer: 0
- reject: 8: (high 0, medium 2, low 6)
- addressed_findings:
  - `[high]` `[patch]` a registered checkout of the studio repo (live registry: `tk-studio` at its main clone) was harvested with `tk-studio:`-qualified keys, so a push from any other studio checkout (a worktree) re-emitted every studio row as a duplicate `stage` event — consult ruled option A: a registry root passing `_is_studio_repo` is harvested with bare sha12 keys (`project` = registry id); test `test_a_registered_second_studio_checkout_emits_bare_keys_once` added (fails without the fix); contract/taxonomy `row_key` notes updated
  - `[low]` `[patch]` driver-contract omitted the `skipped_roots` reasons (`missing`, `not a directory`, read error, `emit failed: …` with partial counts kept in `projects`) — clause added
- rejected (one-line reasons):
  - studio `--directory` harvest unguarded: pre-existing (35-8) behaviour; the spec's never-fatal rule names registry roots, and the existing `try` in `push` still keeps the push alive.
  - `projects` label collision between the studio label and a registry id with another root: misconfiguration; already rejected in the first pass, nothing new.
  - studio `projects` label vs events' `project` mismatch: settled by the first-pass consult (studio payloads byte-identical).
  - rollup merges equal story keys across projects: `report.py rollup_story/rollup_epic(root, …)` read one root's Stage Log documents, not ledger `stage` events (report.py:237, 284).
  - assertion gaps (studio label fallback order; `skipped_roots.root` / `not a directory`; studio keys after a registry failure): diagnostic plumbing, rejected under DEFERRAL DISCIPLINE.
  - `Path.exists()`/`is_dir()` raising `PermissionError` under an inaccessible parent: does not raise on the pinned interpreter (3.14.4; verified it returns False → reported `missing`).
- skipped-layer: none (both blind-hunter and edge-case-hunter ran; no S-band plan)

### 2026-10-29 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 9: (high 0, medium 3, low 6)
- addressed_findings:
  - none
- rejected (one-line reasons):
  - `project` attribution differs between the `--directory` harvest (config id or none) and a registered studio checkout (registry id): settled by the pass-1 consult (studio payloads byte-identical) and the pass-3 consult (option A: `project` = registry id).
  - `--directory` registered without a config `project_id` leaves studio events without `project` while the label uses the registry id: same pass-1 consult ruling.
  - a raising `_is_studio_repo` probe falls back to qualified keys and would double-emit: unreachable in `push`, because the preflight (`measurepush.py:390`) already ran the same git probe, and `_git(..., check=False)` returns rather than raises on a non-zero exit.
  - a second registry id that resolves to an already-seen root is dropped without a `skipped_roots` entry: Always rule "each distinct resolved root is harvested at most once per push".
  - registry entry with no `root`, or a relative `root`: `registry.validate_registry` rejects malformed entries (`registry_error`); a hand-edited relative root is a misconfiguration outside the single writer.
  - `projects` label collision (studio fallback label equals another root's registry id): rejected in both earlier passes; nothing new.
  - a failing `--directory` harvest also skips every registry root: pre-existing 35-8 behaviour; the never-fatal rule names registry roots and the registry, and `push`'s `try` keeps the push alive (rejected in follow-up 1).
  - assertion gaps (`not a directory`, studio label fallback chain, `registry_error` value): diagnostic plumbing, rejected under DEFERRAL DISCIPLINE (also rejected in follow-up 1).
  - a non-studio project that ships `.claude-plugin/marketplace.json` in a git tree gets bare keys: `_is_studio_repo` is the project's single definition of "the studio repo" (push preflight; pass-3 consult rule candidate); a key collision would also need an identical `story|stage|pass|started`.
- skipped-layer: none (both blind-hunter and edge-case-hunter ran; no S-band plan)

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_measurepush -v` -- expected: all pass, new tests included
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-10-29)

- planned: every event is tagged with its root's `project_id`, and the studio's `projects` label falls back to the registry id or directory name / actual: studio events' `payload.project` is still only the config `project_id` (absent when there is no config); the fallback label appears only in `projects` / why: the spec requires studio payloads to stay byte-identical, which wins over the general tagging rule / may affect: none
- planned: three tests named in Tasks / actual: added a fourth (unreadable registry), which calls `harvest_stages` directly in dry-run / why: it covers the "Registry unreadable" row of the I/O matrix / may affect: none

DRIFT: studio-repo stage payload `project` stays config-only (no registry/dirname fallback) — Always rule requires byte-identical studio payloads — affects: none
DRIFT: fourth test added for the registry-unreadable matrix row — matrix coverage — affects: none

### pass 2 (2026-10-29, review patches)

- planned: patch emit-failure handling in the registry-root loop / actual: private helper `_harvest_root` (introduced by pass 1) restructured as `_harvest_rows(rows, project, qualifier, known, dry_run, tally)`; studio call site reads `plansync.stage_rows(directory)` itself / why: read and emit failures must be told apart and partial counts must survive / may affect: none — consult ruled score 0 (not a deviation)

### pass 3 (2026-10-29, follow-up review patches)

- planned: "a registry root that resolves to the studio directory is harvested once, as the studio repo (unqualified keys)" / actual: any registry root passing `_is_studio_repo` (a different checkout of the studio, e.g. the registered main clone when pushing from a worktree) is harvested with bare sha12 keys, `project` = its registry id / why: the path-only reading double-emitted every studio row on worktree pushes; consult ruled option A / may affect: none
- planned: patch named the module and `harvest_stages` docstrings / actual: `_harvest_rows` docstring also corrected / why: it said "never the studio", false after option A / may affect: none — consult ruled score 0 (not a deviation)

DRIFT: a registered studio checkout keeps bare sha12 row_keys (not `<project_id>:<sha12>`) — the path-only reading of "the studio repo" double-emitted stage rows on worktree pushes (consult: apply, resolved drift score 1) — affects: none

## Consult Log

- 2026-10-29T21:35:59Z — trigger: deviation-gt-0 — question: accept studio payload.project staying config-only and the extra registry-unreadable test? — ruling: accept-deviation score 1 — do: keep studio payloads as-is (fallback only on the projects label); keep the fourth test; record as resolved drift score 1 and continue to review — rule candidate: When a story's Always rule says some output stays byte-identical, that rule outranks broader Intent/Approach wording for that output; tests added only to cover an I/O-matrix row are not deviations (score 0).
- 2026-10-29T21:43:08Z — trigger: deviation-gt-0 — question: accept the private helper restructure made for the emit-failure patch? — ruling: accept-deviation score 0 — do: keep the `_harvest_rows` split and the studio call site as implemented; record as not a deviation, deviation_score stays 1 — rule candidate: Restructuring a private helper that the same unreleased story introduced is not a deviation (score 0), provided every signature, key and result field the spec pins is unchanged.

- 2026-10-29T21:46:45Z — trigger: high-severity-finding — question: is "the studio repo" any studio checkout (registered main clone vs worktree --directory double-emits rows bare + `tk-studio:`-qualified)? — ruling: apply — do: patch option A — a registry root passing `_is_studio_repo` is harvested with bare keys, `project` = registry id, counts under its id, still in `seen`; --directory harvest byte-identical; add a second-studio-checkout test (shared rows not duplicated, own row emitted bare, re-push from either emits 0); update driver-contract/taxonomy row_key notes; record resolved review drift score 1 — rule candidate: "The studio repo" in a spec means any directory passing measurepush._is_studio_repo, not a single path; key-namespacing rules keyed on it apply to every checkout including git worktrees.
- 2026-10-29T21:53:15Z — trigger: deviation-gt-0 — question: accept the implementer's unrequested `_harvest_rows` docstring update (it said "never the studio", false after option A)? — ruling: accept-deviation score 0 — do: keep the docstring; record as part of the option A patch, not a deviation; deviation_score stays 1; continue to review — rule candidate: When a ruled patch changes behaviour, bringing a docstring or comment back in line with it is part of the patch (score 0), provided no code, signature, key or result field changes.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T200840Z-2846e6` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Second follow-up review of DW-96 (`measurepush.py push` harvests Stage Log rows from the `--directory` studio repo and every registry root; a registered studio checkout keeps bare sha12 row_keys, other roots `<project_id>:<sha12>`). Both layers ran on the baseline diff (`70882830d942ed72b576e32d1e677b133b990cce..c7cf773`). Every finding was rejected. Each one was already settled by an earlier consult or triage pass, was mandated by the spec, or could not be reached in `push`. No code changed in this pass.

**Files changed (this pass):**
- `_bmad-output/implementation-artifacts/spec-dw-96-measurepush-registered-roots.md`: added this pass's triage log, the result, and the status.

**Files under review (unchanged this pass):** `plugins/tk-studio/lib/measurepush.py`, `plugins/tk-studio/lib/tests/test_measurepush.py`, `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/contracts/events/taxonomy.v1.json`.

**Review:** 0 patches applied, 0 deferred, 9 rejected (high 0, medium 3, low 6; reasons in the Review Triage Log). No consults.
**Follow-up review recommended:** false. Patched high 0, medium 0, low 0; score 3×0 + 1×0 = 0.

**Verification:** `uv run python -m unittest tests.test_measurepush`: 27 tests OK. `uv run python -m unittest discover tests`: 2593 tests OK (4 skipped). `uv run python ../contracts/conformance/runner.py run`: `ok: true`.

DRIFT: a registered studio checkout keeps bare sha12 row_keys (not `<project_id>:<sha12>`) — the path-only reading of "the studio repo" double-emitted stage rows on worktree pushes (consult: apply, resolved drift score 1) — affects: none

**Residual risks:**
- `_is_studio_repo` is a marketplace-file plus git-work-tree probe. A registered non-studio plugin-marketplace repo, or a studio clone that git refuses to read (for example, dubious ownership), would get the other key form.
- Studio rows carry the config `project_id` from the `--directory` harvest but the registry id from a registered checkout. The first emitter wins, and row_key dedupe is unaffected.
- The ledger working-tree change in `deferred-work.md` (the DW-96 resolution) belongs to the orchestrator. It is left uncommitted, as the invocation instructed.

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Spec resolution: unit key `dw-measurepush-registered-roots` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261029-200950-8dfd state.json), `spec-dw-96-measurepush-registered-roots.md`.
- Part B note: this unit is a sweep DW bundle (DW-96), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `test_registered_roots_emit_project_qualified_events_then_none` (two roots, same story id, per-project counts); AC2 the same test's re-push (emitted 0, `already` per project); AC3 `test_push_emits_one_stage_event_per_completed_row_then_none` (35-8 test unchanged). This session's rerun of `tests.test_measurepush`: 27 OK.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle, no stories.yaml entry); ACs spot-checked as met.
