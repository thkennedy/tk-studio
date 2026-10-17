---
title: 'A Nested Studio Project Is a First-Class Root'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: 'aeac54ba62a357377ece12c5a887358d7c17157b'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-28/plans/28-2.md'
  - '{project-root}/_bmad-output/planning-artifacts/briefs/adr-repository-structure-2026-10-09.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** After the merge, `apps/supervisor` is a nested studio project inside tk-studio (AD-21), but every surface takes the project root literally from `--directory`; nothing walks up, so from inside the nested folder no surface reliably finds the nested root, and the pipeline plugin copy needs `$TK_STUDIO_ROOT` inside the microVM.

**Approach:** One nearest-root rule in `lib/config.py` (nearest ancestor-or-self holding `.tk-studio/config.yaml`; studio root = `$TK_STUDIO_ROOT`, else nearest ancestor holding `plugins/tk-studio/`), applied by every listed surface; activation reports both roots and names a nested project; a renderer produces the nested pipeline copy and a lib test pins it; the driver contract states the rule. Lands pre-merge: fixtures stand in for `apps/supervisor`.

**Acceptance criteria (verbatim, Story 28.2, epics.md — authoritative):**

AC1. **Given** a working directory inside `apps/supervisor` **When** any surface resolves the project root (activation and the drift check, `config.py resolve`, `plansync`, `jobrun`, `meter`, `observe`, the registry, the launch skill) **Then** the nearest ancestor holding `.tk-studio/config.yaml` wins (the nested root), never the outer one; `TK_STUDIO_ROOT` keeps meaning the outer repository root, the plugin's home; activation reports both and names the project nested

AC2. **Given** the supervisor's tracked `.tk-studio/config.yaml` carrying `project_id: supervisor` **When** the registry entry's `root` is amended to the nested root (`registry.py amend`) **Then** `registry.py show`, activation and the launch skill agree on the root; the store paths stay per project (`~/.tk-studio/projects/supervisor/`), the nested project's plan counter and `plansync` never mint into the outer project's counter, and nothing of the outer project's store is read or written from the nested root

AC3. **Given** `apps/supervisor/.claude/settings.json` and `apps/supervisor/.bmad-loop/plugins/studio-pipeline/` **When** a Claude session or the engine starts in the nested root **Then** `$CLAUDE_PROJECT_DIR` is the nested root, the hooks resolve their scripts relative to it, and the pipeline plugin copy names the spine and the driver contract by a path relative to the nested root (`../../_bmad-output/...`, `../../plugins/tk-studio/contracts/...`) so `$TK_STUDIO_ROOT` is no longer required inside the microVM; the two copies of `task-planning.md`, `consult.md`, `gate.md` and `reconcile.md` differ only in those paths and the project's name, and a lib test pins that

AC4. **Given** the lib suite and conformance **When** they run **Then** nested-root resolution is pinned for every surface above with a fixture holding an outer and a nested project, the drift check reports a nested root distinctly, and the driver contract states the nearest-root rule in a minor bump

## Boundaries & Constraints

**Always:**
- Files boundary = plan `plans/28-2.md` "Files" (20 entries). Any other file is a deviation to report; the list growing past it is a HALT (oversize, operator's `bmad-correct-course`).
- Stdlib-only Python via `uv run`; atomic writes; headless surfaces end with the AD-11 status block; nothing in the plugin imports a driver, the supervisor or Hermes; lib tests make no network call; every test isolates `TK_STUDIO_HOME` in a temp dir.
- Creation verbs (`config.py standup`, `registry.py register`'s root) take `--directory` literally and never walk up. A not-yet-onboarded folder (no config anywhere above) resolves to itself (today's behaviour).
- `TK_STUDIO_ROOT` keeps meaning the outer repository root; `studio_root` is never `PLUGIN_ROOT`.
- Drift-check JSON gains four optional top-level keys `project_root`, `studio_root` (null when unresolved), `nested`, `project_id`; the status block shape is unchanged (`status-block.schema.json` stays `additionalProperties: false`).
- Driver contract bump `0.1.21 → 0.1.22`, additive (per §Change policy an additive rule is a patch-position bump; SPEC says "minor bump"): record `DRIFT: contract bump 0.1.22 not 0.2.0 — change policy reserves 0.2.0 for breaking; the rule is additive — affects: none`.
- `meter_hook.py` walk-up is inlined (runs under `uv run --no-project`, must not import `config`).

**Block If:**
- Making the rule work changes an existing payload field's meaning (e.g. a given `--directory` that is itself a root resolving elsewhere) — breaking; never pick `0.2.0`.
- Any supervisor-side code or test (not prose) would need a relative path into `plugins/tk-studio` (ADR §3 gate 5).
- A surface can only reach the nested root by reading or writing the outer project's store or counter, or the work needs a registry-schema field.
- The Files list must grow past the plan's list.

**Never:** Create `apps/supervisor` in this repository; edit SPEC.md, epics.md, stories.yaml, canonical plan files, `.bmad-loop/routing.toml|policy.toml`, or anything under `supervision/`; push, tag, release, or bump the gate x3 versions; change `runner.py` (if forced, report a DRIFT line); refactor outside Files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nested cwd | `outer/apps/supervisor/sub/dir`, both `outer` and `outer/apps/supervisor` hold `.tk-studio/config.yaml` | project root = `outer/apps/supervisor`, `nested: true`, `project_id: supervisor` | — |
| Outer cwd | `outer/x` | root = `outer`, `nested: false` | — |
| Not onboarded | dir with no config above | root = start dir, `nested: false` | today's behaviour |
| Given root | `--directory` is itself a root | that root (unchanged meaning) | — |
| Studio root | `TK_STUDIO_ROOT` set / unset with `plugins/tk-studio/` above / neither | env value / that ancestor / `null` | — |
| Nested mint | `plansync` mint from nested cwd | nested `.tk-studio/plan-counter.yaml` advances; outer counter byte-unchanged | — |
| Store isolation | any surface from nested cwd | writes only `TK_STUDIO_HOME/projects/supervisor/`; `projects/outer/` never created/modified | — |
| Standup from inside outer | `config.py standup --directory outer/apps/new` | stands up `outer/apps/new` literally | — |

</intent-contract>

## Code Map

Full investigation with line anchors: `plans/28-2.md` §Code Map (read it — it is authoritative and verified at `aeac54b`). Key anchors (all under `plugins/tk-studio/` unless rooted):
- `lib/config.py` -- `TRACKED_NAME` `:43`, `standup_project_config` `:197`, `main` `:241`, `resolve --directory` optional `:251`; add `find_project_root`, `studio_root`, `project_info`, the moved `project_key` rule, a `root` verb (`--directory` default `.`), walk-up when `resolve --directory` is given.
- `lib/job.py:423` -- `project_key` becomes a thin alias of the config rule (avoid import cycle).
- `skills/tk-studio-activate/scripts/drift_check.py` -- `--directory` `:430`, resolve `:446`, JSON `:491-497`, `check_vault` `:392-404` (feed resolved root); roster/marketplace planes `:184/:287/:321` keep reading the project dir (nested → "not checkable from this project", `ok`); `check_bmad_base` `:83-89` unchanged.
- `lib/plansync.py` `:854-864` (walk-up; counter `:87/:119`, `Minter` `:168-191`); `lib/jobrun.py:555`; `lib/launch.py` `:531/544/548` (check `:355/:384`, bmad-loop `--project`/cwd `:445-446`, launch logs `:198-200`); `lib/registry.py` register `:176` reads tracked `project_id` when `--project-id` absent, `amend`/`show` `:255/:261` unchanged, no schema field; `lib/observe.py:58` default `--project` from `project_info(cwd)` inside a studio project; `lib/meter.py:692-703` already nested-correct — pin only.
- `.bmad-loop/plugins/studio-pipeline/meter_hook.py` `_studio_root` `:27-34` -- add inline walk-up from `BMAD_LOOP_REPO_ROOT` to nearest ancestor holding `plugins/tk-studio/lib/meter.py`.
- Nested copy lines that differ: spine path `task-planning.md:18`, `reconcile.md:46`; contracts prefix `task-planning.md:18`, `reconcile.md:47`; project name `consult.md:3`, `gate.md:5`, `reconcile.md:3`. Everything else identical.
- `contracts/driver-contract.md` -- version cell `:5`, stories `:6`; new `### Project root (0.1.22)` in §1 between Driver roster `:71` and Auth preflight `:84`; §6 pointer `:382`. `lib/tests/test_driver_contract.py` pins `0.1.21` at `:96/:181/:209/:237`, comment `:80-95`, history pattern `:163-173` (precedent commit `2a217c7`).
- Conformance: `contracts/conformance/manifest.json` (cwd = plugin root; fixture precedents `launch-relaunch/`, `plan-status/`); `lib/tests/test_conformance.py`.
- Test precedents: `test_registry.py:17-34` (TK_STUDIO_HOME isolation), `test_jobrun.py:33-64` (`standup_project_config`), `test_meter.py:531-546`, `test_planner_rules.py:23-25,125` (reads pipeline folder, `skipUnless`), `test_restructure_rehearse.py:22-25` (imports `tools/`).
- Hooks: repo `/.claude/settings.json` 4 hooks, each `uv run --no-project python "$CLAUDE_PROJECT_DIR"/.bmad-loop/bmad_loop_hook.py <Event>`.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/config.py` -- add rule helpers, `project_key` rule, `root` verb, walk-up in `resolve` -- the single nearest-root rule
- `plugins/tk-studio/lib/job.py` -- `project_key` delegates to config -- one identity rule, no cycle
- `plugins/tk-studio/lib/plansync.py`, `lib/jobrun.py`, `lib/launch.py` -- `--directory` walks up via `find_project_root` -- AC1/AC2
- `plugins/tk-studio/lib/registry.py` -- `register` reads tracked `project_id` when `--project-id` absent -- AC2 identity
- `plugins/tk-studio/lib/observe.py` -- default `--project` from `project_info(cwd)` -- AC1
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py` -- nearest root, four JSON keys, vault fed resolved root -- AC1/AC4
- `plugins/tk-studio/skills/tk-studio-activate/SKILL.md` -- report both roots, say "nested project" -- AC1
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- line ~20 "the main checkout" → "the project root (nested root for a supervisor epic)" -- AC2
- `.bmad-loop/plugins/studio-pipeline/meter_hook.py` -- inline walk-up fallback -- AC3 (no `TK_STUDIO_ROOT` needed)
- `tools/restructure/nest_pipeline.py` (new) -- pure renderer + CLI `--out <dir>` `--project-name` (default `supervisor`) rewriting only spine path → `../../_bmad-output/planning-artifacts/architecture/...`, `plugins/tk-studio/contracts/` → `../../plugins/tk-studio/contracts/`, project name in the three prose lines -- AC3 (SPEC Open Question 1, settled shape)
- `plugins/tk-studio/lib/tests/test_nest_pipeline.py` (new) -- every differing line is an allowed rewrite; rendered relative paths resolve from a fixture nested root two levels down; `skipUnless` `apps/supervisor/.bmad-loop/plugins/studio-pipeline/` exists → its four files equal the render -- AC3
- `plugins/tk-studio/lib/tests/test_nested_root.py` (new) -- outer+nested fixture (`standup_project_config(base/"outer")`, then `.../apps/supervisor` with `project_id="supervisor"`); every AC1 surface from `apps/supervisor/sub/dir`; AC2 registry amend/show/activation/launch agreement, outer counter byte-unchanged, `projects/outer/` untouched; I/O matrix rows; hooks pin: every command in repo `.claude/settings.json` resolves its script via `$CLAUDE_PROJECT_DIR` -- AC1-AC4
- `plugins/tk-studio/contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- `### Project root (0.1.22)` stating the nearest-root rule, studio-root meaning, the four optional drift-check keys; version/history/stories cells; §6 pointer; tests flipped per 26-1 pattern plus `test_0_1_22_…` -- AC4
- `contracts/conformance/manifest.json`, `contracts/conformance/fixtures/nested-root/` (outer `.tk-studio/config.yaml`, `apps/inner/.tk-studio/config.yaml` with `project_id: inner`, `apps/inner/deep/.keep`), `lib/tests/test_conformance.py` -- drive `drift_check.py --directory contracts/conformance/fixtures/nested-root/apps/inner/deep` with a `nested: true` marker -- AC4

**Acceptance Criteria:** AC1-AC4 above, each proven by `test_nested_root`, `test_nest_pipeline`, `test_driver_contract`, `test_conformance` and the conformance drive.

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- layers: blind-hunter + edge-case-hunter (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 1, medium 3, low 2)
- defer: 0
- reject: 3 (low 3)
- addressed_findings:
  - `[high]` `[patch]` per-user store `~/.tk-studio/config.yaml` made `$HOME` a project root (non-onboarded folders under home resolved to home, every home project `nested: true`, plansync could mint into the store) — `_holds_config` skips the store's `.tk-studio`; test `test_the_per_user_store_never_marks_a_project_root`; contract line (consult: apply)
  - `[medium]` `[patch]` `register` keyed by tracked project_id could silently add a second identity for an already-registered root (AD-20) — refuses with exit 2 naming the existing key; test `test_register_refuses_a_second_key_for_a_registered_root`
  - `[medium]` `[patch]` `amend --root` accepted a DIR another entry holds — refuses exit 2; test `test_amend_root_refuses_a_root_another_entry_holds`
  - `[medium]` `[patch]` AC3: `transcribe.py` `spec_pointer()` names spine and contract root-relative and the renderer skipped it — `nest_pipeline.py` renders it (two companion lines only); tests `test_transcribe_differs_only_in_the_two_companion_lines`, `test_a_drifted_transcribe_is_refused`
  - `[low]` `[patch]` contract 0.1.22 overclaimed "every `--directory` surface" walks up — names the walking surfaces, others unchanged
  - `[low]` `[patch]` contract `amend --root` wording vs `project_key` rule (tracked id else folder name) — reworded
- rejected: manifest marker on a json drive not judged by runner (recorded DRIFT; lib test enforces it); plugin/roster plane "not checkable" from a nested root (by design, AD-21 sealing per plan); `job.py runs --directory` from a nested subfolder keys literally (not an AC1 surface)

### 2026-10-16 — Review pass (follow-up)
- layers: blind-hunter + edge-case-hunter (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 0
- reject: 6: (medium 1, low 5)
- addressed_findings:
  - `[medium]` `[patch]` a nonexistent `--directory` (a typo, or a nested project not checked out) walked up to the enclosing project, so `plansync` could mint into the outer counter (AC2). Now `find_project_root` takes a missing path literally. Contract Project root clause added; test `test_a_missing_directory_is_taken_literally`.
  - `[medium]` `[patch]` `register` without `--project-id` was no longer idempotent for a root already registered under its basename while the tracked id differs (onboard re-run exited 2). Now, without `--project-id`, it re-affirms the holder's key. An explicit differing `--project-id` still exits 2. Docstring and contract register sentence updated; tests `test_register_without_id_reaffirms_the_existing_key` and `test_register_refuses_a_second_key_for_a_registered_root` (explicit id).
  - `[low]` `[patch]` `amend --root` compared the sanitised `project_key` with a possibly raw registry key, so an entry like `old dir` could never be re-pointed. Now it accepts the raw identity or its `project_key` form; test `test_amend_root_repoints_a_raw_basename_key`.
- rejected:
  - `jobrun` walks up while `job.py`/`session.py`/`reconcile.py` stay literal: documented in contract 0.1.22, those are not AC1 surfaces, and it was already rejected in pass 1.
  - Un-onboarded folder inside a project resolves to the enclosing one, and the result JSON does not echo the resolved root: this is the rule as written. Echoing the root is plumbing.
  - Spec pass-1 Deviation Summary says amend is unchanged: append-only history, explicitly superseded by pass 2.
  - drift-check `project_id` can differ from a basename registry key: AC2's agreement is on the root, and the split predates this story.
  - `register` basename key not `safe_name`d: the raw basename fallback predates this story and was deliberately kept.

### 2026-10-16 — Review pass (follow-up 2)
- layers: blind-hunter + edge-case-hunter (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 1: (low 1)
- addressed_findings:
  - `[medium]` `[patch]` The launch skill never resolved `<root>`. Only `launch.py` walks up; steps 0, 1 (`pipeline.py apply`) and 4 used the payload `directory` literally, so a working directory inside `apps/supervisor` (AC1) split the routing write from the launch target. Step 0 now defines `<root>` from `config.py root --directory <directory>` (contract 0.1.22), and `status` and `stop` resolve it the same way. Test: `test_launch_skill_resolves_root_via_the_config_root_verb`.
  - `[low]` `[patch]` `amend --root` checked only that the config file exists, so it accepted `$HOME`, whose `.tk-studio/` is the per-user store. That contradicts contract 0.1.22. It now uses `_holds_config`, keeping exit 2. Test: `test_amend_root_refuses_the_per_user_store_parent`.
  - `[low]` `[patch]` `register` without `--project-id`, keyed by the tracked id that another root holds (AC2's migration case), advised "re-run with an explicit --project-id". Following that creates a second identity (AD-20). The message now names `registry.py amend --project-id <key> --writer <writer> --root <root>`, keeping exit 2. Test: `test_register_without_id_at_a_new_root_names_the_repoint`.
  - `[low]` `[patch]` `tracked_project_id` let `UnicodeDecodeError` and `OSError` escape, so `drift_check.py` died before printing its JSON status block (AD-11). It now returns None. Test: `test_a_non_utf8_tracked_config_has_no_project_id`, which also checks that the drift check still prints its JSON.
- rejected:
  - The `nested: true` marker on the conformance drive is not judged by `runner.py`. This is the accepted pass-1 DRIFT, already rejected in pass 1, and the lib test enforces it.

## Design Notes

Settled shapes (planner, `plans/28-2.md` "Settled shape"): drift-check roots are an optional additive entry; the nested pipeline copy is a named placeholder rule, rendered by `tools/restructure/nest_pipeline.py` (outside the sealed plugin) and written into `apps/supervisor` by the merge's ADR §5 step 3 fix-ups. ADR gate 5 vs AC3: prose pointers an agent reads are not contract consumption; AC3's literal text governs. The supervisor's own `_bmad/custom/bmad-build-auto.toml` is out of reach (28.3 / merge).

## Verification

**Commands (from `plugins/tk-studio/lib`):**
- `uv run python -m unittest discover tests` -- expected: OK (pre-existing single skip allowed)
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` incl. the nested-root drive

**Story-specific:**
- From a temp `outer/apps/supervisor/sub`: `uv run python <plugin>/lib/config.py root --directory .` -- prints nested root, `nested: true`, `project_id: supervisor`, `studio_root` = `TK_STUDIO_ROOT` when set
- `uv run python tools/restructure/nest_pipeline.py --out <tmp>` -- four files whose diff vs `.bmad-loop/plugins/studio-pipeline/` touches only the allowed lines

## Deviation Summary

### pass 1 (2026-10-16, implementer)

- planned: Files boundary = the plan's 20 entries / actual: added `plugins/tk-studio/contracts/conformance/fixtures/launch-relaunch/.tk-studio/config.yaml` and `plugins/tk-studio/contracts/conformance/fixtures/plan-status/.tk-studio/config.yaml` (each `vcs: git` plus a comment) / why: with the walk-up both existing drives climbed to the checkout's own `.tk-studio/config.yaml` (launch-relaunch failed; plan-status silently targeted the real repo) / may affect: none
- planned: conformance drive "with a `nested: true` marker" / actual: `expect: json` drive with `"marker": "\"nested\": true"`; runner does not judge markers on json drives, so `test_conformance.py` runs the argv and asserts `nested`, `project_id: inner`, `project_root` / why: `runner.py` must not change / may affect: none
- planned: config.py adds `find_project_root`, `studio_root`, `project_info`, the `project_key` rule / actual: also `tracked_project_id` (registry) and `in_project` (observe) helpers / why: register keeps the raw-basename fallback; observe needs an "inside a project" test / may affect: none
- planned: AC2 "registry entry's `root` amended (`registry.py amend`)" / actual: `amend` unchanged (vault link only); the test registers the nested root fresh, runs `amend` (vault link) and `show`; no verb re-points an existing entry's root / why: plan says amend/show unchanged, no schema field / may affect: 28-3
- planned: "a minor bump" / actual: 0.1.22, additive / why: change policy reserves 0.2.0 for breaking / may affect: none
- planned: one pre-existing skip / actual: 2 skips / why: the spec's own `skipUnless` real-copy test / may affect: none

DEVIATION SCORE: 2

DRIFT: two conformance fixture configs added outside Files (launch-relaunch, plan-status) — the walk-up made both drives climb to the checkout's config — affects: none
DRIFT: nested-root marker asserted by test_conformance.py, not the runner — runner.py does not judge markers on json drives and must not change — affects: none
DRIFT: config.py gains tracked_project_id and in_project helpers — needed by registry/observe defaults — affects: none
DRIFT: registry.py amend cannot re-point an entry's root; AC2 proven by a fresh nested registration — plan kept amend unchanged — affects: 28-3
DRIFT: contract bump 0.1.22 not 0.2.0 — change policy reserves 0.2.0 for breaking; the rule is additive — affects: none

### pass 2 (2026-10-16, implementer, consult ruling `apply`)

- `registry.py amend --root DIR` added (writer-gated, same lock/atomic replace, exit 2 on missing config or project_id mismatch); AC2 now proven with the literal amend verb; driver contract §Project root (0.1.22) names it. Supersedes the pass-1 AC2 entry (no longer a deviation). DEVIATIONS: none (pass score 0). Story score falls to 1: remaining entries are local (fixture configs accepted by consult at score 1, helpers, marker assertion, 0.1.22 numbering).

### pass 3 (2026-10-16, review patches)

- planned: reword the amend --root contract line / actual: the line also records the "another entry holds DIR" refusal / why: contract must name the new exit-2 case / may affect: none
- planned: register refuses a registered root when --project-id is absent / actual: refuses whether or not --project-id is given / why: AD-20 "never a silent second identity" either way; no caller relies on it (consult: accept score 1) / may affect: none
- planned: renderer refuses on anchor drift / actual: transcribe.py anchors are replace-all like the .md rules; an extra occurrence is caught by the two-line test / why: same mechanism as existing rules / may affect: none
- pass 4 (consult DO): registry.py docstring and the contract register sentence name the root-already-registered refusal. DEVIATIONS: none.

DEVIATION SCORE (pass 3): 1

DRIFT: register refuses an already-registered root under any key, explicit --project-id included — AD-20 forbids split identities — affects: none
DRIFT: nest_pipeline.py also renders transcribe.py (two companion lines) — AC3 names the pipeline copy's spine and contract paths and spec_pointer() carries both — affects: none

### pass 5 (2026-10-16, follow-up review patches)

- The implementer reported no deviations (score 0). It touched only `config.py`, `registry.py`, `driver-contract.md` (Project root section, still 0.1.22) and `test_nested_root.py`, all in the plan's Files. The story score stays 1.

### pass 6 (2026-10-16, follow-up review 2 patches)

- planned: reuse the existing `amend --root` exit-2 refusal text / actual: same exit 2, message reworded to "no studio project config (.tk-studio/config.yaml outside the per-user store) there — onboard it first" / why: the old text is false for `$HOME`, where the file exists (consult: accept-deviation score 1) / may affect: none
- Files touched: `config.py`, `registry.py`, `skills/tk-studio-launch/SKILL.md`, `tests/test_nested_root.py`, all in the plan's Files. The driver contract is unchanged. Pass score 1; the story score stays 1.

## Consult Log

- 2026-10-16T21:49Z — trigger: file-outside-files — question: keep two fixture configs (launch-relaunch, plan-status) added outside plan Files, or halt for bmad-correct-course? — ruling: accept-deviation score 1 — do: keep both files as written, no runner.py/drive change; keep the DRIFT line and name both files in the review summary; carry on to review, not a correct-course halt — rule candidate: a story changing project-root resolution implicitly covers adding `.tk-studio/config.yaml` to existing conformance fixtures so they stay their own root; DRIFT, not halt
- 2026-10-16T21:49Z — trigger: deviation-gt-0 — question: AC2 names `registry.py amend` re-pointing root but amend cannot change root; accept a fresh-registration proof or extend amend? — ruling: apply — do: add optional writer-gated `--root DIR` to `registry.py amend` (same lock/atomic replace; exit 2 when DIR lacks `.tk-studio/config.yaml` or its tracked project_id differs; update usage :18); prove AC2 literally (register at old root, amend --root nested, show/activation/launch check agree, outer store+counter byte-unchanged; keep fresh-register test); one line in `### Project root (0.1.22)` that `amend --root` re-points an identity, schema untouched — rule candidate: when an AC names a verb as its When, exercise that verb; an additive optional flag on an unpinned lib CLI writing an existing schema field is in scope
- 2026-10-16T21:55Z — trigger: high-severity-finding — question: per-user store `~/.tk-studio/config.yaml` makes `$HOME` a project root under the nearest-root rule; patch by excluding the store, or intent gap? — ruling: apply — do: guard inside `_holds_config` (skip a dir whose `.tk-studio` resolves to `store.store_root()`), meter_hook untouched unless it reads config.yaml; lib test with TK_STUDIO_HOME above the fixture (non-onboarded resolves to itself nested false; onboarded nested false own id; no counter minted in the store); one contract line in Project root (0.1.22) — rule candidate: any walk-up for a `.tk-studio/` marker excludes `store.store_root()`, tested with TK_STUDIO_HOME above the fixture
- 2026-10-16T22:00Z — trigger: deviation-gt-0 — question: accept pass-3 deviations D1 (contract records amend-root collision refusal), D2 (register refuses a registered root regardless of --project-id), D3 (transcribe anchors replace-all, guarded by the two-line test)? — ruling: accept-deviation score 1 — do: keep all three; extend registry.py module docstring (:12-14) and the driver-contract register sentence (:104-106) with the root-already-registered refusal; record D1-D3 at score 1 — rule candidate: a refusal added to a registry/creation verb enforcing an existing AD applies regardless of optional args and updates that verb's docstring and contract line in the same pass (score 1)
- 2026-10-16T22:18Z — trigger: deviation-gt-0 — question: accept the reworded `amend --root` exit-2 refusal message (old text false for the `$HOME` store case) with the contract untouched? — ruling: accept-deviation score 1 — do: keep the reworded refusal in registry.py:262-265 as is and leave driver-contract.md `### Project root (0.1.22)` untouched; keep test_nested_root.py:544 as the only pin on this message — rule candidate: a refusal message's wording is local (score 1) unless the driver contract or a conformance fixture quotes it; plans pin the exit code and condition, not the text

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was the second follow-up review of story 28-2, over the diff since baseline `aeac54b`. It patched four edge cases. The story's shape is unchanged: one nearest-root rule in `lib/config.py`, the drift-check roots, `registry.py amend --root`, the `nest_pipeline.py` renderer, and contract 0.1.22 `### Project root`.
- **Launch skill:** `<root>` is now resolved through `config.py root`, so every launch step agrees with `launch.py` from inside a nested project (AC1).
- **`amend --root`:** it refuses the per-user store's parent.
- **`register` collision message:** in the migration case it points to `amend --root` instead of a second identity (AD-20).
- **`tracked_project_id`:** it tolerates an unreadable or non-UTF-8 config, so the drift check keeps its JSON status block (AD-11).

**Files (this pass):**
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md`: step 0 defines `<root>` from `config.py root --directory <directory>`, and `status` and `stop` resolve it the same way.
- `plugins/tk-studio/lib/registry.py`: `amend --root` checks with `_holds_config`, and the refusal is reworded. The no-id `register` collision names the `amend --root` re-point.
- `plugins/tk-studio/lib/config.py`: `tracked_project_id` also catches `OSError` and `UnicodeDecodeError`.
- `plugins/tk-studio/lib/tests/test_nested_root.py`: four new tests. The implementer reports each fails on the pre-patch code.

**Review:** blind-hunter plus edge-case-hunter, band L. 4 patches applied (medium 1, low 3), 0 deferred, 1 rejected (the runner marker, an accepted pass-1 DRIFT).
**Follow-up review recommended:** true. Patched findings: high 0, medium 1, low 3. Score 3×1 + 3 = 6, which is 5 or more.

**Verification** (from `plugins/tk-studio/lib`, re-run by this session after the patches):
- `uv run python -m unittest discover tests`: 1313 tests, OK, skipped=2 (the pre-existing skip, plus the `skipUnless` real `apps/supervisor` copy check).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, no failures.

**unverifiable-here (operator):** the same as earlier passes:
- Live hook firing in `apps/supervisor` after the merge (`uv run python tools/restructure/rehearse.py --supervisor C:\GitHub\tk-studio-supervisor`).
- Write the nested pipeline copy in the merge PR: `uv run python tools/restructure/nest_pipeline.py --out apps/supervisor/.bmad-loop/plugins/studio-pipeline`.
- Re-point the real registry entry: `uv run plugins/tk-studio/lib/registry.py amend --project-id supervisor --writer activate --root <repo>/apps/supervisor`.

**Residual risks:**
- `job.py`, `session.py`, `reconcile.py`, `detect.py`, `orchestrate.py`, `recommend.py`, `kb.py`, `inventory.py` and `pipeline.py` still take `--directory` literally (stated in the contract). The launch skill now resolves its root before calling `pipeline.py`, but other callers still have to pass a root.
- The nested-root conformance marker is enforced by the lib test, not by `runner.py`.
- A pre-existing split identity (registry key ≠ tracked `project_id`) stays possible. `amend` cannot rename a key.
- The operator still needs to append the SPEC.md design-note bullets and stop the run after 28-2, because 28-3 needs the merged tree.

DRIFT: contract bump 0.1.22 not 0.2.0 — change policy reserves 0.2.0 for breaking; the rule is additive — affects: none
DRIFT: two conformance fixture configs added outside Files (launch-relaunch, plan-status) — the walk-up made both drives climb to the checkout's config — affects: none
DRIFT: nested-root marker asserted by test_conformance.py, not the runner — runner.py does not judge markers on json drives and must not change — affects: none
DRIFT: config.py gains tracked_project_id and in_project helpers — needed by registry/observe defaults — affects: none
DRIFT: registry.py amend gains --root; register refuses a root already registered under another explicit key and re-affirms it when --project-id is absent — AC2 names amend re-pointing root; AD-20 forbids split identities — affects: 28-3
DRIFT: nest_pipeline.py also renders transcribe.py (two companion lines) — AC3 names the copy's spine and contract paths and spec_pointer() carries both — affects: none
DRIFT: amend --root refusal message reworded for the per-user store case (exit 2 unchanged, contract untouched) — the old text is false for $HOME — affects: none


## Reconcile

- 2026-10-16 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 28-3-the-merged-tree-builds-releases-and-launches-from-one-root
