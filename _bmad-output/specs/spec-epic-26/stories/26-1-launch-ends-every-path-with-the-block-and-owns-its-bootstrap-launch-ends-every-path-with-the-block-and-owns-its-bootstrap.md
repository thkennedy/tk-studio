---
title: 'Launch Ends Every Path with the Block and Owns Its Bootstrap'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: 'c720c5444892c75a311616b5d95cff646b783ee4'
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-26/plans/26-1.md'
  - '{project-root}/plugins/tk-studio/contracts/driver-contract.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `tk-studio-launch` has three holes: a relaunch ends in prose with no AD-11 status block and points at the retired ClaudeOS queue (hole 20); bootstrap output dirties the tree so the readiness check refuses the launch's own work (hole 10); and nothing compares the engine's policy limits with the budget bands, so stories run under a `max_tokens_per_story` the bands exceed (hole 4).

**Approach:** The deterministic core (`launch.py`) ends every verb result with the AD-11 block keys, compares `.bmad-loop/policy.toml` limits read-only with `.tk-studio/budget-bands.yaml`, and refuses `start` on a mismatch unless acknowledged; the skill commits its bootstrap output before `check` and ends every path with the core's block; conformance gains a fresh and a relaunch drive; the contract goes to 0.1.21.

**Story (authoritative, epics.md §Story 26.1):** As the operator, I want `tk-studio-launch` to end every headless path with the status block, to commit its own bootstrap output, and to check the engine's budget limits against the bands before it starts, so that a driver never records a missing block for a run that succeeded, a second launch pass is never needed, and no story runs under a policy limit the bands do not cover (holes 10, 20 and 4).

**Acceptance criteria (verbatim):**

- AC1. **Given** a first launch on an epic **When** the bootstrap writes `SPEC.md`, `stories.yaml` and the first plan **Then** the launch commits them on the run branch with one named commit message before its readiness check, so the dirty-tree refusal never fires on its own output, and the rule is stated once in the skill text (the Epic 20 and 22 launches needed a second pass; the Epic 24 and 25 launches committed theirs)
- AC2. **Given** a relaunch on an epic with stories already `done` and routing already applied **When** the session ends **Then** its last output is the JSON status block exactly as on the fresh path, the watch hint names the supervisor's status page and the `status` verb and never ClaudeOS, and a conformance drive covers the relaunch case beside the fresh case
- AC3. **Given** the project's `.bmad-loop/policy.toml` limits (`max_tokens_per_story`, wall-clock, review caps) and the budget bands in `.tk-studio/budget-bands.yaml` **When** `start` or `check` runs **Then** the launch result names every limit the bands exceed (band ceiling above the policy limit) as a `budget_mismatch` entry with both numbers, `check` ends `partial` naming them, and `start` refuses to start the engine on a mismatch unless the payload carries `allow_budget_mismatch: true`; the machine-local policy file is never edited by the skill
- AC4. **Given** the lib suite and conformance **When** the story closes **Then** both are green, including the new drives, and the driver contract §2 launch row states the bootstrap commit, the relaunch block and the budget check (0.1.21, additive)

## Boundaries & Constraints

**Always:**
- Follow the plan's "Settled shape" rulings 1–5 (`plans/26-1.md`) exactly: block keys last and in order `status, intent ("tk-studio-launch"), artifacts, reason` on every `launch.py` result including the `LaunchError` refusal; mismatch entry shape `{limit, policy, band, band_field, band_value}`; `budget: {compared[], budget_mismatch[], not_compared[]}` on `check` and `start`; mismatch never enters `gaps[]`; `--allow-budget-mismatch` flag ↔ payload `allow_budget_mismatch: true`; bootstrap commit message exactly `loop(epic-<N>): SPEC, manifest and first-story plan from the launch bootstrap`.
- Exit codes unchanged: 0 answer, 2 refusal, 1 unexpected. `run_dir_abs` and `log` never reach `artifacts`.
- Policy read-only via `tomllib`; bands via `lib/miniyaml.py`; never hard-code band numbers. Missing/unparseable inputs are a named `budget` check entry, never a crash or mismatch.
- Stdlib only, atomic writes, AD-2 (no driver/supervisor/Hermes imports), no credentials.
- Extend `test_cli_check_and_start_keep_the_house_shape` and `test_cli_refusal_is_exit_2_with_ok_false`; never weaken them.

**Block If:**
- The bands file gains a wall-clock field mid-story (compare it only if present at story start; it is not: leave wall-clock under `not_compared`).

**Never:**
- Edit `.bmad-loop/policy.toml`, `customize.toml`, the mounted `/home/agent/.claude/skills/tk-studio` copy, `epics.md`, canonical plan files, `stories.yaml`.
- Push, tag, release, or bump gate versions. Add a harness (spend-bearing) relaunch drive: AC2's skill-layer last line is proven by the core drives plus skill text.
- Name ClaudeOS anywhere in `launch.py` or the launch `SKILL.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| check clean | no gaps, bands ≤ policy | `ok: true`, block `complete` | — |
| check mismatch | L weighted_tokens 5,000,000 > max_tokens_per_story 2,000,000 | `budget.budget_mismatch` entry with both numbers; block `partial`, reason names it; `ok` per gaps only | exit 0 |
| check gaps | missing spec folder | block `blocked` naming gaps | exit 0 (answer) as today |
| start mismatch | mismatch, no flag | refusal, engine not spawned, block `blocked` | exit 2 |
| start acknowledged | mismatch + `--allow-budget-mismatch` | engine spawned, block `complete`, artifacts `[run_dir, spec_folder]` | exit 0 |
| not compared | `session_timeout_min`, `max_tokens_per_session` | listed in `not_compared` with reason `no band field` | never a mismatch |
| inputs missing/bad | policy.toml or bands absent/unparseable | named `budget` check entry | no crash |
| refusal | any `LaunchError` | `{ok:false, error, status:"blocked", intent, artifacts:[], reason}` | exit 2 |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-26/plans/26-1.md`, investigated at `3257b74`) is the investigation; verified anchors:

- `plugins/tk-studio/lib/launch.py` (404 lines) -- `check` l.183, `start` l.250 (refusal l.255, result l.274), `main` l.341 (LaunchError → exit 2 l.393); docstring l.4–5 names ClaudeOS → reword to the §1 driver roster (supervisor, Hermes, direct invocation).
- `.bmad-loop/policy.toml` (gitignored, machine-local) -- `[limits]`: `max_review_cycles = 3` l.8, `session_timeout_min = 90` l.11, `max_tokens_per_story = 2000000` l.19, `max_tokens_per_session = 4000000` l.22. Read only.
- `.tk-studio/budget-bands.yaml` (tracked) -- `bands.{S,M,L}.{usd_estimate, weighted_tokens, review_cycles_max}`; L = 5,000,000 / 2.
- `plugins/tk-studio/lib/miniyaml.py` -- YAML reader to reuse (as `pipeline.py` does).
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` (100 lines) -- ClaudeOS at l.8–9, l.63; Status block section l.81–91; bootstrap commit goes between step 4 and step 5's re-check.
- `plugins/tk-studio/lib/tests/test_launch.py` -- `_project` l.27, `_FakeSubstrate` l.44, CLI shape tests l.243, l.353.
- `plugins/tk-studio/contracts/conformance/runner.py` -- `status-block` judge for `cli_drives` (~l.360–391, Story 25.5); share it with surface drives.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- `tk-studio-launch` entry (4 drives); fixture precedent `unparseable-proposals-ledger` (~l.323).
- `plugins/tk-studio/contracts/driver-contract.md` -- version l.5 (0.1.20), §2 launch row ~l.132, §8 expect values.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/launch.py` -- block keys on every result; budget comparison (`weighted_tokens` max band vs `max_tokens_per_story`, `review_cycles_max` max band vs `max_review_cycles`, others `not_compared`); `--allow-budget-mismatch`; `start` refusal on mismatch; docstring drivers -- AC2, AC3.
- `plugins/tk-studio/lib/tests/test_launch.py` -- block keys/order per verb and outcome; mismatch refuses start, passes with flag; check `partial`; not-compared; missing/unparseable inputs named; policy file byte-identical after check and start -- AC2, AC3.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- bootstrap-commit rule stated once (exact message, only bootstrap files, current branch, after step 4 before step 5's check, none on relaunch, never push); every path's final line is the last core block; relaunch path explicit; `allow_budget_mismatch` payload; watch hint = supervisor status page + `launch.py status` + `bmad-loop tui`; ClaudeOS removed -- AC1, AC2, AC3.
- `plugins/tk-studio/contracts/conformance/runner.py` -- `expect: "status-block"` for surface drives, optional declared `status` (absent: any schema-valid status, exit 0 or 2) -- AC2.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- fresh drive (`check` on `spec-none`, status `blocked`) and relaunch drive (`check` on the new fixture, status undeclared) -- AC2.
- `plugins/tk-studio/contracts/conformance/fixtures/launch-relaunch/` (new) -- `SPEC.md`, two-entry `stories.yaml`, one `stories/<id>-*.md` `status: done`, `.bmad-loop/routing.current.json` -- AC2.
- `plugins/tk-studio/lib/tests/test_conformance.py` -- surface `status-block` judge with and without declared status -- AC2, AC4.
- `plugins/tk-studio/contracts/driver-contract.md` -- 0.1.21 with additive changelog clause; §2 launch row (bootstrap commit, relaunch block, budget check, `allow_budget_mismatch`); §8 status-block on surface drives -- AC4.

**Acceptance Criteria:**
- Given the repo on this box, when `uv run launch.py check --directory <repo root> --epic 26` runs from `plugins/tk-studio/lib`, then the last four keys are `status, intent, artifacts, reason` and the result names the `max_tokens_per_story` mismatch (2000000 vs L 5000000).
- Given `.bmad-loop/policy.toml`, when check and the tests run, then its sha256 is unchanged.
- Given the new drives, when conformance runs, then both launch drives appear in the report and pass.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` Relaunch drive (status undeclared) could pass without reaching the fixture (blind + edge-case hunters, merged) — the status-block judge now honours a declared `marker`; the relaunch drive declares `task manifest`, which appears only once the spec folder resolves; test_conformance covers present/missing.
  - `[low]` `[patch]` "never edited by the launch" over-claimed: the launch's routing step writes its managed block into policy.toml — refusal text, contract §2 row and SKILL.md now scope the claim to `[limits]` and the launch core.
  - `[low]` `[patch]` `max_followup_reviews` (a review cap AC3 names) was neither compared nor listed — now `not_compared` with reason `no band field`.
  - `[low]` `[patch]` Bootstrap commit did not confirm the run branch or handle git failure — SKILL step 5 now ends `blocked` naming the branch or the git error, staging only existing bootstrap paths.
- rejected (one line each): relaunch drive path is relative/in-tree — follows the `unparseable-proposals-ledger` precedent and check is read-only; no block on argparse/no-verb exit 2 — bad invocation never reaches a verb, outside plan ruling 1's verb list; bootstrap commit has no test — AC1 is skill text by design (Design Notes); `budget` check entry `ok:false` on mismatch — it is a report line, top-level `ok`/`gaps` unaffected as ruled; absent policy limit not compared — already named `absent from policy`; leftover uncommitted bootstrap on relaunch — the existing dirty-tree gap names it, as before.

### 2026-10-15 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 3, low 1)
- defer: 0
- reject: 4 (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` `start` refusal dropped the structured `budget` object (blind + edge-case hunters, merged): AC3 and the §2 row say `start` names each mismatch as a `budget_mismatch` entry. `LaunchError` now has an optional `extra`, and `main` merges it before the block. A post-readiness `start` refusal carries `budget` when a mismatch exists (consult: accept-deviation score 2). Tests pin the keys `["ok","error","budget"]+BLOCK_KEYS`, and the §2 refusal cell states the condition.
  - `[medium]` `[patch]` The relaunch drive's marker `task manifest` did not prove the fixture resolved: `check` emits that entry even when `stories.yaml` is missing, so the earlier pass's triage note was wrong (blind + edge-case hunters, merged). The marker is now `2 entries`, which shows only on the fixture's counted two-entry manifest and is absent on an empty dir. test_conformance pins both cases, and the §8 prose is updated.
  - `[medium]` `[patch]` SKILL step 5 refused unless HEAD was literally `loop/epic-<N>`. That check came after steps 3–4 had already written files, nothing created that branch, and SPEC.md:103 makes the run branch the checkout's current branch. A differently named run branch would strand the bootstrap output, which is the second pass AC1 forbids. The name check is removed: the commit lands on the checkout's current branch, and the git-error refusal stays. The §2 row parenthetical matches.
  - `[low]` `[patch]` `compare_budget` silently skipped a band whose compared field was not a number, so a smaller band was compared and a mismatch could be hidden. That limit is now `not_compared` with the reason `band <B> <field> not a number`, never compared and never a mismatch. Test added; the §2 row states it.
- rejected (one line each):
  - SKILL.md text has no unit test: AC1 is skill-text by design (Design Notes), and the Verification `grep -c ClaudeOS` command proves AC2's never-ClaudeOS.
  - An absent policy limit is not compared against the engine default: it is named `absent from policy` in `not_compared`. AC3's Given is the project's own limits, and hard-coding bmad-loop's defaults would couple the plugin to the substrate.
  - The relaunch fixture's `done` story and routing file are never read by `check`: AC2's relaunch proof is the core drives plus skill text, with no harness drive (Never list).
  - The relaunch drive ends `blocked` on this box: its status is undeclared by design (plan Settled shape 5), and the marker now proves the fixture resolved.

### 2026-10-15 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 10 (high 0, medium 0, low 10)
- addressed_findings:
  - `[medium]` `[patch]` Step 5's bootstrap commit could take in unrelated files the operator had already staged, because a plain `git commit` commits the whole index (blind and edge-case hunters, merged). That breaks the §2 row's "only those files". SKILL.md step 5 now names the paths in both commands, `git add -- <paths>` then `git commit -m '<message>' -- <paths>`. A pathspec commit records only those paths. The rule is still stated once.
  - `[low]` `[patch]` A policy limit that was present but not a number was listed in `not_compared` as `absent from policy`. Such a limit now gets the reason `not a number in policy`, and `absent from policy` is kept for a missing key. Neither is coerced or ever a mismatch. A test covers both, and the §2 Budget check sentence states the rule.
  - `[low]` `[patch]` AC3 requires every exceeded limit to be named, but no test had two mismatches. The new test `test_every_exceeded_limit_is_named_at_once` covers `budget_mismatch[]` with both entries, `check` ending `partial` with both numbers named, and `start` refusing at exit 2 and naming both. It found no defect.
  - `[low]` `[patch]` The contract's `Story / rulings` header row did not list the 0.1.21 story, although earlier bumps added theirs (ST-083, ST-085). `Story 26.1 (Epic 26)` is appended. The version and the `0.1.21 (Epic 26)` clause are untouched.
- rejected (one line each):
  - Relaunch drive exercises `check`, not a relaunch, and its fixture is in-tree/relative: AC2's relaunch proof is the core drives plus skill text, with no harness drive (Never list). The drive passes in the gate's conformance run with the `2 entries` marker. Same ruling as both earlier passes.
  - Fixture `routing.current.json` names `1-1`, and the fixture has no policy managed block: `check` reads neither file, so they are inert data.
  - Step 4's `bmad-loop validate` runs before the bootstrap commit: `task-planning.md:108` already says to ignore the dirty-tree line during planning.
  - "Any canonical plan files the transcription wrote" is open-ended: a file that is missed is named by the existing dirty-tree gap. It never fails silently.
  - SKILL.md text has no unit test: AC1 is skill text by design (Design Notes). The Verification `grep -c ClaudeOS` covers never-ClaudeOS.
  - "Largest band" wording against a per-field max with a first-band tie: the mismatch names a band that really carries the value, and both numbers AC3 asks for are correct. On non-monotonic bands the max is the stricter comparison.
  - No block on argparse errors, the unreachable fall-through `return 2`, or unexpected exceptions: a bad invocation never reaches a verb, which is outside plan ruling 1's verb list, and exit 1 stays "unexpected". Same ruling as pass 1.
  - `with_block` would drop a verb's own top-level `status`: no verb result has one. The run's status is nested under `run` (`launch.py:484-486`).
  - Absent `[limits]` or an absent limit is not compared against bmad-loop's defaults: same ruling as the follow-up pass. Coupling to substrate defaults is out of scope, and the limit is named in `not_compared`.
  - Leftover bootstrap files from an interrupted earlier launch are not committed by the next one: same ruling as pass 1. The earlier launch already ended `blocked`, and the dirty-tree gap names the file.

## Design Notes

AC1 is skill-text behaviour (an LLM-executed step); it is proven by the SKILL.md text stating the rule once, by Epic 24/25 precedent, and by this repo's own `c720c54` bootstrap commit using the exact message. The policy is gitignored, so "never edited" is proven by a checksum before/after, not only `git diff`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`, two new launch drives listed.
- `cd plugins/tk-studio/lib && uv run launch.py check --directory /c/GitHub/tk-studio --epic 26` -- expected: block keys last; `max_tokens_per_story` mismatch; status `partial` (or `blocked` if gaps).
- `sha256sum .bmad-loop/policy.toml` before and after -- expected: identical.
- `grep -c ClaudeOS plugins/tk-studio/lib/launch.py plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- expected: 0 each.

## Deviation Summary

### pass 1 (2026-10-15)

- planned: touch only the eight files named in Tasks & Acceptance / actual: also edited `plugins/tk-studio/lib/tests/test_driver_contract.py` (version pin 0.1.20 → 0.1.21, the 0.1.20 clause test bounded at the 0.1.21 clause, new `test_0_1_21_header_and_launch_row`) / why: existing tests pin the header version, so the required 0.1.21 bump failed them / may affect: 26-3, 26-5 (they append to the 0.1.21 clause; the test finds it by `0.1.21 (Epic 26)`)
- planned: fixture `launch-relaunch/` holds `SPEC.md`, `stories.yaml`, `stories/<id>-*.md`, `.bmad-loop/routing.current.json` at its root / actual: SPEC, manifest and story file sit under `launch-relaunch/_bmad-output/specs/spec-epic-1/`; the drive runs `check --directory contracts/conformance/fixtures/launch-relaunch --epic 1` / why: mirrors a real project layout so `--epic` resolves the default spec folder / may affect: none

DRIFT: test_driver_contract.py edited outside the plan's Files — the AC4-required 0.1.21 bump broke its version pin — affects: 26-3, 26-5
DRIFT: launch-relaunch fixture nests its spec under _bmad-output/specs/spec-epic-1/ — lets `--epic` resolve the default spec folder like a real project — affects: none
- Consult ruling (pass 1): deviation 1 is accepted at score 2. The clause anchor `0.1.21 (Epic 26)` is pinned by a test; 26-3 and 26-5 must append after it and never reword it or re-bump. Deviation 2 is accepted as local (score 1): the fixture nests SPEC.md, stories.yaml and the done story under `_bmad-output/specs/spec-epic-1/` so the `--epic 1` default resolves the spec folder. This departs from the root layout in plan Settled shape 5.

### pass 2 (2026-10-15, review patches)

- planned: patch 1 touches manifest, runner, test_conformance / actual: also two sentences in `driver-contract.md` §8 describing the optional `marker` on status-block drives / why: §8 specifies this judge / may affect: none — within the plan's Files (driver-contract.md §8 is listed), so not a deviation from the plan; score unchanged.
- planned: wording-only fix in the row and refusal / actual: the §2 row also names the routing step's managed block as the launch's only write to policy.toml / why: states the true exception / may affect: none (score 0).

### pass 3 (2026-10-15, follow-up review patches)

- planned: every post-readiness `start` refusal carries `budget` (the session's instruction) / actual: carries it only when the comparison found a mismatch / why: `test_cli_refusal_is_exit_2_with_ok_false` pins a gaps refusal's keys exactly, and the spec says extend, never weaken / may affect: 26-3, 26-5, Epic 27 (any reader of the launch refusal treats `budget` as present iff a mismatch was found). Consult: accept-deviation score 2.
- planned: patch 2 touches the manifest only / actual: also `test_conformance.py` (it pinned the old marker value) and the §8 prose naming the marker / why: both state the marker / may affect: none. Within the plan's Files.

DRIFT: `start` refusal JSON gains a conditional `budget` key (present iff a mismatch was found) — the pinned exact-keys refusal test forbids it on a plain gaps refusal — affects: 26-3, 26-5, Epic 27

### pass 4 (2026-10-15, follow-up review 2 patches)

- planned: four patches in SKILL.md, launch.py, test_launch.py and driver-contract.md / actual: the same four files, with no behaviour beyond the patches / why: n/a / may affect: none (score 0 for this pass; the story's cumulative `deviation_score` stays 2).

## Consult Log

- 2026-10-15T19:38:14Z — trigger: deviation-gt-0 + file-outside-files — question: accept test_driver_contract.py edit (0.1.21 pin) and nested launch-relaunch fixture layout? — ruling: accept-deviation score 2 — do: keep both as implemented; record score 2 (anchor `0.1.21 (Epic 26)` pinned by test, 26-3/26-5 append after it, never reword/re-bump); note fixture nesting as local score-1 departure from Settled shape 5 — rule candidate: When a plan bumps the driver-contract header version, its Files list must include plugins/tk-studio/lib/tests/test_driver_contract.py and name the exact clause anchor text later stories append after.
- 2026-10-15T19:53:25Z — trigger: deviation-gt-0 — question: accept a `budget` key on a post-readiness `start` refusal present only when a mismatch exists (A), require it on every post-readiness refusal and change the pinned exact-keys test (B), or revert to the plain refusal (C)? — ruling: accept-deviation score 2 — do: keep option A as written; leave `test_cli_refusal_is_exit_2_with_ok_false` unchanged; record score 2, may affect 26-3, 26-5, Epic 27 — rule candidate: When a story adds structured data to an existing refusal shape that a test pins by exact keys, add it as a key present only when that data is non-empty and state the condition in the contract cell. This is the default, scored 2, and needs no consult.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This is the second follow-up review of the 26-1 diff from `c720c54`. It is band L, so both layers ran. The story's change is unchanged:
- `launch.py` ends every result with the AD-11 block.
- It compares the policy `[limits]` read-only with the budget bands. `check` ends `partial` on a mismatch, and `start` refuses one unless `allow_budget_mismatch` is given.
- The skill commits its own bootstrap output.
- Conformance has a fresh drive and a relaunch drive.
- The contract is at 0.1.21.

This pass applied four patches:
- The bootstrap commit is now a pathspec commit, so nothing else that is staged can enter it.
- A policy limit that is not a number is named `not a number in policy` instead of `absent from policy`.
- A test covers two simultaneous mismatches.
- The contract's `Story / rulings` row lists Story 26.1.

**Files changed (this pass):**
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md`: step 5 uses `git add -- <paths>` then `git commit -m '<message>' -- <paths>`.
- `plugins/tk-studio/lib/launch.py`: `compare_budget` tells an absent policy limit from a non-numeric one.
- `plugins/tk-studio/lib/tests/test_launch.py`: `test_a_non_numeric_or_absent_policy_limit_is_not_compared_never_a_crash` and `test_every_exceeded_limit_is_named_at_once`.
- `plugins/tk-studio/contracts/driver-contract.md`: the §2 Budget check clause for absent or non-numeric policy limits, and `Story 26.1 (Epic 26)` in the `Story / rulings` row. The version and the 0.1.21 clause are untouched.

**Review:** blind-hunter and edge-case-hunter both ran (band L). 4 patches were applied (medium 1, low 3), 0 deferred and 10 rejected. Follow-up review recommended: true. The patched counts are high 0, medium 1 and low 3, so the score is 3×1 + 1×3 = 6, which is at least 5. No consult trigger fired: there was no high finding, the deviation is 0 and every file is inside the plan's Files.

**Verification:**
- `uv run python -m unittest discover tests`: 1167 tests, OK (1 skipped).
- `runner.py run`: exit 0, `ok: true`, `failures: []`. `status-block-fresh` and `status-block-relaunch` pass.
- `launch.py check --directory <root> --epic 26`: the last keys are `status, intent, artifacts, reason`. It names `budget_mismatch: max_tokens_per_story 2000000 < band L weighted_tokens 5000000`, and it is `blocked` here because of the live run and the dirty tree.
- The `.bmad-loop/policy.toml` sha256 `e61a2283df15196f13eed6eeff6a8b3f82f2e246d368d23a855f1ad9b34b7644` is unchanged.
- `grep -c ClaudeOS` returns 0 for `launch.py` and for SKILL.md.

**Residual risks:**
- AC1 (the bootstrap commit) is still enforced by skill text only, so it is unverifiable here. The next real first launch proves it: the operator runs `/tk-studio-launch` on a fresh epic and checks for the single `loop(epic-<N>): SPEC, manifest and first-story plan from the launch bootstrap` commit, which must contain only the bootstrap paths.
- Operator action: this machine's policy `max_tokens_per_story` (2,000,000) is below band L (5,000,000). Every `start` refuses until the operator raises `[limits] max_tokens_per_story` in `.bmad-loop/policy.toml` or passes `allow_budget_mismatch: true`.
- `budget` on a refusal is conditional: it is present only when a mismatch was found. 26-3, 26-5 and Epic 27 must append to the `0.1.21 (Epic 26)` clause without rewording it or bumping the version again.

DRIFT: test_driver_contract.py edited outside the plan's Files — the AC4-required 0.1.21 bump broke its version pin — affects: 26-3, 26-5
DRIFT: launch-relaunch fixture nests its spec under _bmad-output/specs/spec-epic-1/ — lets `--epic` resolve the default spec folder like a real project — affects: none
DRIFT: `start` refusal JSON gains a conditional `budget` key (present iff a mismatch was found) — the pinned exact-keys refusal test forbids it on a plain gaps refusal — affects: 26-3, 26-5, Epic 27

## Reconcile

### 2026-10-15 — adjust-stories

- Score: 2
- Reasoning: The 0.1.21 bump now sits in the header under the test-pinned anchor `0.1.21 (Epic 26)`, and `test_driver_contract.py` pins it. 26-3 and 26-5 each document their change as "0.1.21, additive". Their ACs still hold, but each dev session has to append inside that clause and extend `test_driver_contract.py`, and that file is not in their plans' Files yet. A note in invoke_dev_with covers both. The conditional `budget` key on the `start` refusal is additive and stated in the §2 row. Epic 27's stories read the launch status block (27.1's PR body, 27.3's relaunch), and the block's keys and order are unchanged, so no Epic 27 sentence breaks. The nested fixture layout is local.
- Affected: 26-3-routing-legs-carry-an-advisor-and-an-effort — "it documents the `advisor` field and the pairing rule (0.1.21, additive)": 0.1.21 is already the header, so the session appends to the `0.1.21 (Epic 26)` clause instead of bumping.
- Affected: 26-5-the-adapter-takes-a-status-pull-back-from-a-driver — "the verb is documented as additive (0.1.21)": same seam.
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 26-2-the-planner-settles-schema-shape-and-the-spec-file-name
