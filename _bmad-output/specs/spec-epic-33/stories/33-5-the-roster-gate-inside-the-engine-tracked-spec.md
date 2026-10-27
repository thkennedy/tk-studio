---
title: 'The Roster Gate Inside the Engine, Tracked'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '2ff15d392e6e1212471e7f35835550f80137353d'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/plans/33-5.md'
warnings: [oversized]
deferred:
  - summary: >-
      launch.py check writes .bmad-loop/policy.toml even when git does not ignore it, so a served project whose policy is tracked gets a dirty tree that the engine's preflight then blocks.
    evidence: |-
      reconcile_verify_commands has no pipeline.unignored_writes guard (pipeline.py:415 reports this hazard for apply). tk-studio ignores the file (.gitignore:8), but a served project that opts in through engine.verify_commands with a tracked policy would be dirtied. Meets deferral (a): it is a defect in the reconciliation the criteria name. Refusing or reporting it is a design choice the plan does not settle.
    location: >-
      plugins/tk-studio/lib/launch.py (reconcile_verify_commands)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The roster gate (`tests.test_release_roster`) runs inside the engine only because the operator hand-edited the gitignored overlay `.bmad-loop/policy.toml` on the agent PC (hole 62, twice: 31.5, 32.2). Any other box, or a rewritten overlay, loses it, so a story adding a skill without its roster row passes the engine and fails the host leg.

**Approach:** Move the command into a tracked source (`plugins/tk-studio/pipeline/verify-commands.toml`, or the project's `.tk-studio/config.yaml` `engine.verify_commands`), and have `launch.py check` (run by every launch and by `start`) reconcile the overlay's `[verify] commands` from it: add what is missing, keep the operator's extras, report what it did.

Story 33.5 acceptance criteria (transcribed verbatim from epics.md):

- **AC1 — Given** the engine policy the launch materialises into every run worktree (`.bmad-loop/policy.toml`, a gitignored operator overlay today) **When** the launch's readiness check runs **Then** the `[verify] commands` list is reconciled from a tracked source (`plugins/tk-studio/pipeline/verify-commands.toml`, or the project's `.tk-studio/config.yaml` `engine.verify_commands`): a missing command is added, an operator's extra commands are kept, and the reconciliation is reported in the check's result; the tracked list carries `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` for tk-studio; a project without the list is unchanged; conformance covers the reconciliation and the lib suite covers the merge rules
- **AC2 — Given** a story that adds a skill without its roster row **When** the engine's verify runs after a clean review **Then** the command fails, bmad-loop routes the failure to a dev fix session, and the host leg never sees the roster miss; the runbook's hole-62 row points at the tracked source

## Boundaries & Constraints

**Always:** plans/33-5.md §Settled shape 1-6 governs the sources, merge rule, write, refusals and reporting (verbatim below in Design Notes). Stdlib only, argv only (NFR9). The write is atomic and verified by re-reading with `tomllib`; on any mismatch the original bytes are restored and a gap is reported. The `[limits]` table stays read-only (its test stays). The managed routing block stays last. Every contract change is additive under the existing 0.1.28 entry (no version bump). Only tracked sources are read (never `config.local.yaml` or the user tier).

**Block If:** the reconciliation would need `apps/supervisor` to change (e.g. `materialise` must call it); bmad-loop's `[verify] commands` run with a cwd other than the project root (checked 2026-10-27: `verify.verify_commands_outcome(policy, paths.project)` / `self.workspace.root` — the root; not triggered); the Files list must grow beyond the plan's.

**Never:** edit `.bmad-loop/policy.toml` of this checkout, `epics.md`, `SPEC.md`, `stories.yaml`, `routing.toml`; fork bmad-loop; weaken `test_policy_file_is_byte_identical_after_check_and_start`; point a writing conformance drive at a tracked fixture; bump the contract version; push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add, no `[verify]` | policy with `[limits]` + routing block; tracked list of 1 | `[verify]\ncommands = [..]\n\n` placed before the routing fence; `[limits]` and the block byte-identical; row `added 1 from <src>; kept 0 operator commands`; `policy: written` | none |
| Add beside operator extra | `[verify] commands = ["x"]` | `["x", <tracked>]`, `kept: ["x"]` | none |
| Already present | tracked command already listed | `unchanged (N tracked, M operator)`, byte-identical | none |
| Multi-line array | `commands = [\n "x",\n]` | replaced by one line | none |
| CRLF policy | CRLF newlines | CRLF kept | none |
| Config overrides | config key present + plugin file | config list is the source; empty config list writes nothing | none |
| No source | neither exists | `skipped (no tracked list)`, `source: null`, byte-identical | advisory, ok |
| No policy | no `.bmad-loop/policy.toml` | `skipped (no .bmad-loop/policy.toml; bmad-loop init creates it)`, no file created | advisory, ok |
| Bad source / policy | unparsable, non-list, non-string item, unlocatable `commands` (dotted key, inline table) | `policy: refused`, row ok=false naming the file and "fix it by hand", policy byte-identical | gap → `blocked` |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/launch.py` -- docstring :1-60 (reword the `check` line: its one write is the `[verify] commands` reconciliation; `[limits]` still read-only); `POLICY_REL` :94; `compare_budget` :252 (tomllib read + unparsable precedent); `check` :428 — insert the reconciliation right after `compare_budget` (:444-446), before the spec-folder/bmad-loop early returns; add the `verify_commands` key to every return incl. the `project` early return (:441); `check_block` :340 unchanged (failure is a gap → blocked); `start` :501 calls `check`, so it reconciles before the spawn. `miniyaml` already imported (`miniyaml.load(root/".tk-studio/config.yaml")` parses `engine: {verify_commands: [..]}`).
- `plugins/tk-studio/lib/pipeline.py` -- READ ONLY. `BEGIN`/`END`/`LEGACY_BEGIN_RE` :108-112 fence the managed routing block at the end of `policy.toml`; `_write` :344 is the write precedent. Import the constants or copy the fence regex; never move the block.
- `apps/supervisor/src/worktree.ts:207` `COPIED_RUNTIME` copies policy.toml into run worktrees; `closeout.ts:229-234` excludes it from harvest. READ ONLY seam.
- bmad-loop (upstream, installed) `verify.py:1578` `run_verify_commands(policy, cwd)` runs `[verify] commands` shell=True with cwd = project root; `engine.py:2646` routes failures to a dev fix session — AC2's routing is upstream behaviour.
- `plugins/tk-studio/lib/tests/test_launch.py` -- `_project` :31, `_budget_files` :69, `_FakeSubstrate` :94, `LaunchTestCase` :164; `test_policy_file_is_byte_identical_after_check_and_start` :725 (no tracked list; must stay green unchanged). Add merge-rule tests beside it.
- `plugins/tk-studio/lib/tests/test_release_roster.py` -- the command itself; already fails on a skill without its roster row (AC2 "the command fails").
- `plugins/tk-studio/contracts/conformance/manifest.json` -- `surfaces["tk-studio-launch"]` :94; drives run in an empty `{sandbox}`; `e2e_knowledge.py` drive at :217 (`expect: "ok"`) is the precedent for a self-fixturing drive printing `{ok, steps[]}`.
- `plugins/tk-studio/lib/tests/test_conformance.py:306-318` -- runs `launch.check` on an empty dir (stays unchanged); edit this file only if a drive count/shape test pins launch drives.
- `plugins/tk-studio/contracts/driver-contract.md` -- §2 launch row (~:481) and the 0.1.28 entry: add the `verify_commands` result key and the reconciliation, additively.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- step 2 (:49-54) reads `gaps[]`/`budget`; add one sentence on `verify_commands`.
- `kb/agent-pc-setup-runbook.md:1358` -- hole-62 row: point at `plugins/tk-studio/pipeline/verify-commands.toml` and the check's reconciliation; drop "recreate the line if the overlay is ever rewritten"; one clause that it takes effect on a box once the plugin release carrying it is installed (until then the hand line stays the gate).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/pipeline/verify-commands.toml` -- new: header comment (what it is, hole 62, read by `launch.py check`), then `commands = ["uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster"]` -- the tracked tk-studio list
- `plugins/tk-studio/lib/launch.py` -- add source resolution, merge, placement/write with tomllib re-verify and restore, refusals, the `verify commands` row and `verify_commands` result key on every `check` result; reword docstring -- AC1
- `plugins/tk-studio/lib/tests/test_launch.py` -- add the plan's Verify test list (each I/O row above, plus `start` reconciles before spawn: the fake substrate sees the reconciled file) -- lib suite covers merge rules
- `plugins/tk-studio/contracts/conformance/e2e_verify_commands.py` -- new drive: in `{sandbox}`, policy with one operator extra + `.tk-studio/config.yaml` `engine.verify_commands`; run `lib/launch.py check`; assert added + kept + row; re-run → `unchanged` and byte-identical; a project with no list leaves its policy byte-identical; print `{ok, steps[]}` -- conformance covers reconciliation
- `plugins/tk-studio/contracts/conformance/manifest.json` -- one `tk-studio-launch` drive, `expect: "ok"`
- `plugins/tk-studio/lib/tests/test_conformance.py` -- only if a count/shape test pins launch drives
- `plugins/tk-studio/contracts/driver-contract.md` -- §2 launch row + 0.1.28 entry, additive
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- step 2 sentence: `verify_commands` reports the reconciliation; a failure there is a gap the session never closes by hand
- `kb/agent-pc-setup-runbook.md` -- hole-62 row -- AC2

**Acceptance Criteria:**
- Given a project with a tracked list and a policy lacking the command, when `launch.py check` runs, then the command is appended after operator extras, the `verify commands` row and `verify_commands` key report it, and a second check reports `unchanged` with a byte-identical file.
- Given a project without a tracked list, when `check` and `start` run, then `policy.toml` is byte-identical (existing test :725 green).
- Given tk-studio's own tree, when `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` runs, then it passes (the tracked command works); AC2's engine leg is `unverifiable-here` (see Verification).

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 1, medium 0, low 5)
- defer: 1 (high 0, medium 1, low 0)
- reject: 5 (high 0, medium 2, low 3)
- addressed_findings:
  - `[high]` `[patch]` launch.py `[verify]` header regex missed CRLF (`$` before `\r`), so a CRLF policy with an existing `[verify]` was refused; the regex now ends `\r?$`, and a CRLF existing-table test covers three cases (consult: apply)
  - `[low]` `[patch]` added a test that a mismatched tomllib re-read restores the original bytes and is a gap
  - `[low]` `[patch]` added a test that `engine.verify_commands` in `config.local.yaml` is ignored
  - `[low]` `[patch]` verify-commands.toml header now says it is tk-studio's own list, read only at `<root>/plugins/tk-studio/pipeline/`
  - `[low]` `[patch]` SKILL.md step 2 now separates the row's detail text from the `verify_commands.policy` values
  - `[low]` `[patch]` the driver-contract §2 launch row's failures column names the verify-commands refusal (additive, 0.1.28)
- rejected: writes under a live engine (the intent puts the reconciliation in every readiness check, and the run worktree holds its own copy); add-only, so a renamed tracked command lingers as an operator extra (the AC keeps extras); comments inside a multi-line array are lost (plan §4 settles this); no version bump (the epic rules out a bump under 0.1.28; releasing is outside the loop); the row/result duplication is plumbing

### 2026-10-27 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 8 (high 0, medium 3, low 5)
- addressed_findings:
  - none
- rejected: a retired tracked command lingers as an operator extra (AC1 keeps extras; already rejected in pass 1); a tracked policy is dirtied by the write (already deferred as DW-62 in the frontmatter; not re-filed); `check` writes under a live engine (already rejected in pass 1: the intent puts the reconciliation in every readiness check); a non-mapping `engine` value falls back to the plugin file (plan §1: the config source exists only when the `engine.verify_commands` key is present); SKILL.md "never closes by hand" vs the row's "fix it by hand" (the row addresses the operator, and SKILL.md tells the session to end `blocked` verbatim); no version field bumped (the epic rules out a bump under 0.1.28); a `[verify.<sub>]`-only policy and a nested multi-line array in `[verify]` are refused (bmad-loop's `[verify]` has neither shape, and the refusal fails safe: a named gap, policy byte-identical)

## Design Notes

Plan §Settled shape (governs, summarised exactly):
1. Sources: (a) `.tk-studio/config.yaml` `engine.verify_commands` when the key is present (list of non-empty strings; empty list = nothing tracked); else (b) `<root>/plugins/tk-studio/pipeline/verify-commands.toml` `commands`; else (c) `skipped (no tracked list)`, no write.
2. Merge: `desired` = policy's `verify.commands` in order (missing = `[]`) + each tracked command it lacks, in tracked order; exact-string compare; extras never reordered/removed; no duplicates. Nothing added → `unchanged`, byte-identical.
3. Placement: `[verify]` with `commands` → replace the value up to its closing `]` (bracket scan honouring TOML strings; multi-line → one line); `[verify]` without `commands` → insert line after header; no `[verify]` → insert `[verify]\ncommands = [...]\n\n` before the routing fence (BEGIN or legacy), else at end. Items via `json.dumps`. Keep the newline convention. Re-read with tomllib: `verify.commands == desired` and every other top-level table unchanged, else restore and gap.
4. Refusals (named gaps, `policy: refused`, detail names the file + "fix it by hand"): unparsable/non-string source; unparsable policy or non-list-of-strings `verify.commands`; unlocatable `commands` (dotted key, inline table). No policy → `skipped (no .bmad-loop/policy.toml; bmad-loop init creates it)`, advisory.
5. Reporting: row `{"check": "verify commands", "ok", "detail"}` (e.g. `added 1 from plugins/tk-studio/pipeline/verify-commands.toml; kept 0 operator commands`, `unchanged (1 tracked, 0 operator)`, `skipped (no tracked list)`); key `verify_commands {source, tracked[], added[], kept[], policy}`, `source` = project-relative file, `.tk-studio/config.yaml engine.verify_commands`, or `null`; `kept[]` = operator commands not in tracked; `policy` = `written | unchanged | skipped (…) | refused`. Present on every `check` result, including early returns.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`, `e2e_verify_commands.py` among the passes
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: pass

**Manual checks (if no CLI):**
- unverifiable-here (AC2 engine leg + installed plugin): on the agent PC after the plugin release carrying this story is installed, run `uv run <plugin>/lib/launch.py check --directory <run worktree> --spec <folder>`; expect `verify commands: unchanged (1 tracked, 0 operator)`. A story adding a skill without its roster row fails the engine's verify and is routed to a dev fix session; the host leg is never reached red for the roster.

## Deviation Summary

### pass 1 (2026-10-27, implementer)

- planned: an empty config list (`engine.verify_commands`) means nothing is tracked / actual: `miniyaml` cannot parse `[]`, so the key with no value (`verify_commands:` → null) is read as the empty list; a literal `verify_commands: []` makes the config unparseable and is refused as a gap / why: the stdlib YAML subset has no empty-list syntax / may affect: none
- planned: `policy` is `written | unchanged | skipped (…) | refused` / actual: the not-a-directory early return reports `policy: "skipped (no project directory)"` and adds no row / why: the key must be on every return, and that return runs before any reconciliation / may affect: none
- planned: one added sentence in SKILL.md step 2 / actual: also reworded the step-2 parenthetical that said the routing block is the launch's only policy write / why: that line became false / may affect: none
- planned: the driver-contract 0.1.28 entry / actual: a Story 33.5 paragraph after the 33.3 one, plus the §2 launch row; the header's version-history summary line is not extended (33.3 precedent) / why: follows the latest precedent / may affect: none

DEVIATION SCORE: 1

DRIFT: an empty `engine.verify_commands` is written as the bare key (`verify_commands:`), since miniyaml cannot parse `[]`, which is refused as unparsable — stdlib YAML subset has no empty-list syntax — affects: none
DRIFT: the not-a-directory early return reports `policy: skipped (no project directory)` — the key must be on every return — affects: none
DRIFT: SKILL.md step 2's "only launch write" parenthetical reworded beside the added sentence — it became false — affects: none
DRIFT: contract 0.1.28 gets a Story 33.5 paragraph; the header summary line is not extended — 33.3 precedent — affects: none

## Consult Log

- 2026-10-27T00:33Z — trigger: deviation-gt-0 — question: accept the implementer's four score-1 deviations (empty config list as bare key, skipped (no project directory), SKILL.md reword, 0.1.28 paragraph)? — ruling: accept-deviation score 1 — do: Keep all four deviations as implemented. Record them in the story's deviation log as score 1, citing miniyaml's flow-collection limit (miniyaml.py:111-113) for deviation 1. Proceed to review/close-out on the green verify gate. — rule candidate: A plan that specifies a `.tk-studio/config.yaml` value must write it in the miniyaml subset (block lists, no `[]`/`{}`; an empty list is a present key with no value), and an implementer who follows that rule is not deviating.
- 2026-10-27T00:36Z — trigger: high-severity-finding — question: CRLF policy with an existing [verify] header is refused (launch.py:436 regex lacks \r? before $); patch or bad_spec? — ruling: apply — do: Change the header regex at launch.py:436 to end `\r?$`, leave launch.py:453/455 as is; add CRLF tests beside test_verify_keeps_crlf with an existing [verify] table (with commands, without commands, with an extra key such as timeout_min = 5), each asserting all newlines are CRLF, `[verify]\r\ncommands = [` present, and the extra survives; keep the score (local fix, not bad_spec). — rule candidate: In the dev customization, every re.M pattern ending in $ over raw file text ends with \r?$, with a CRLF test for each branch that edits an existing table.

### pass 2 (2026-10-27, review patches)

DEVIATIONS: none — DEVIATION SCORE: 0

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version) | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Run:** a follow-up review pass over the done story (pass 1 recommended one: a high-severity patch). Both layers ran (band L) on the code diff since the baseline `2ff15d392e6e1212471e7f35835550f80137353d` (kb/ and plugins/, 872 lines). No code changed in this pass.

**Summary:** unchanged from pass 1 (commit `7414868`). `launch.py check`, which every launch runs and `start` calls before the spawn, reconciles `.bmad-loop/policy.toml` `[verify] commands` from a tracked source: `.tk-studio/config.yaml` `engine.verify_commands`, else `plugins/tk-studio/pipeline/verify-commands.toml`. It appends missing tracked commands after the operator's, keeps extras, writes atomically with a tomllib re-verify and restore, refuses bad inputs as named gaps, and reports through a `verify commands` row and a `verify_commands` result key.

**Files changed (this pass):**
- `_bmad-output/specs/spec-epic-33/stories/33-5-the-roster-gate-inside-the-engine-tracked-spec.md`: the follow-up triage entry and this result
- `_bmad-output/implementation-artifacts/deferred-work.md`: committed as the orchestrator left it (its DW-62 entry), with no edits

**Review findings:** 0 patches applied, 0 deferred, 8 rejected (medium 3, low 5). One of the 8 duplicates the existing deferral (DW-62, an unignored policy dirties the tree), so it was not filed again.

**Follow-up review recommendation:** false. Nothing was patched in this pass (high 0, medium 0, low 0; score 3×0 + 1×0 = 0).

**Verification:**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 2078 tests OK (2 skipped)
- `uv run python ../contracts/conformance/runner.py run`: `ok: true` (20 surfaces, 137 checks); `e2e_verify_commands.py` is a `tk-studio-launch` drive, `expect: ok`; run on its own in a temp sandbox: `ok: true`, 4 steps
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster`: OK
- AC2's engine leg stays `unverifiable-here`. The operator runs, on the agent PC after the plugin release carrying this story is installed, `uv run <plugin>/lib/launch.py check --directory <run worktree> --spec <folder>`, and expects `verify commands: unchanged (1 tracked, 0 operator)`.

**Residual risks:** the supervisor runs the installed plugin's launch.py, so the hand-edited overlay line stays the gate until the release is installed. The deferred unignored-policy case (DW-62). The add-only rule leaves a retired tracked command in the overlay as an operator extra until someone removes it by hand.

DRIFT: an empty `engine.verify_commands` is written as the bare key (`verify_commands:`), since miniyaml cannot parse `[]` and refuses it as unparsable — stdlib YAML subset has no empty-list syntax — affects: none
DRIFT: the not-a-directory early return reports `policy: skipped (no project directory)` — the key must be on every return — affects: none
DRIFT: SKILL.md step 2's "only launch write" parenthetical reworded beside the added sentence — it became false — affects: none
DRIFT: contract 0.1.28 gets a Story 33.5 paragraph; the header summary line is not extended — 33.3 precedent — affects: none

## Reconcile

- 2026-10-27 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 33-6-a-stale-render-view-never-halts-a-story
