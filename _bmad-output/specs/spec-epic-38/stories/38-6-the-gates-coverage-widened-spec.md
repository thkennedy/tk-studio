---
title: "The Gate's Coverage Widened"
type: 'chore'
created: '2026-11-09'
status: 'done'
baseline_revision: '0dbe7aa64ea9abff0a1281f87c469a5a5ddd70e4'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-38/plans/38-6.md'
  - '{project-root}/AGENTS.md'
warnings: [oversized]
deferred: []
---

# Story 38.6: The Gate's Coverage Widened

Serve note (Settled shape 12): `apps/supervisor/src/sandbox.ts` runs inside `serve` (the submit store check). The operator stops the supervisor tab before `apps/supervisor` is built and restarts it through the scheduled task after the merge.

<intent-contract>

## Intent

**Problem:** The gate has named blind spots (AI-7; the Epic 37 retrospective's B9, B10, A5, C7; DW-167, DW-172, DW-173, DW-183): both Windows-class drives skip `plugins/tk-studio/skills/*/scripts` and `.bmad-loop/plugins`, a nested verify command is a bare `bun test`, `command-line.test.ts` runs under no gate, the `_budget` guard finds bun drives by a string literal, `guards.test.ts` is env-dependent, CAP-5's per-file timeout is pinned only by argv, the planner is never told the host figure, and `parseSkillsList` was written for a format `sbx skills ls` does not print.

**Approach:** Make each an enforced, tested rule, exactly as plans/38-6.md's Settled shape 1-11 states, and extend the contract's 0.1.34 entry (additive) naming the e2e step.

**User story (verbatim):** As the loop, I want the Windows-class drives to scan every folder of host-run Python, every bare `bun test` to carry the host figure, the suites no gate runs to run under one, the gate's tooling probes pinned by behaviour, the planner told the host figure, the supervisor's env-dependent cases pinned, and the skills listing's parser pinned to the real format, So that the gate's known blind spots are closed, not named (AI-7; the retrospective's B9, B10, A5, C7; DW-167, DW-172, DW-173, DW-183).

### Acceptance Criteria (verbatim from epics.md, Story 38.6)

**AC1.** **Given** `e2e_windows_semantics.py:631-633` and `e2e_text_encoding`'s scan roots (neither scans `plugins/tk-studio/skills/*/scripts` nor `.bmad-loop/plugins`; the `apps/*/scripts` step at `e2e_text_encoding.py:259-263` is vacuous) and `apps/supervisor/.tk-studio/config.yaml:58` (`host: bun test`, no `--timeout`) **When** the gate runs **Then** both drives scan `plugins/tk-studio/skills/*/scripts` and `.bmad-loop/plugins` (`drift_check.py`, `install_base.py`, `reconcile_gate.py`, `meter_hook.py` among the sites) and the vacuous step goes, each drive's fixture adding a site under the new roots; the nested project's verify command names `--timeout` from `_budget.HOST_TEST_TIMEOUT_MS` and a drive step rejects a bare `bun test` in any `.tk-studio/config.yaml` verify command (`win-ok` exempting a proven one); the drives are green on `main` after the fixes

**AC2.** **Given** `command-line.test.ts` (no gate runs it: `verify_host.py:16, :64`; DW-167), the `api.test.ts` store test that skips without `TK_STUDIO_ROOT` (EP-36 B8), the `_budget` guard found by the literal `shutil.which("bun")` (`test_playable_judge.py:287`), `guards.test.ts`'s two env-dependent cases (DW-173) and CAP-5's argv-only pin (`test_verify_host.py:161`) **When** the host leg runs **Then** the e2e suite runs under the leg in its own step with `TK_STUDIO_ROOT` set and the bun timeout (or its exclusion is a named skip line with the reason, never silent), the store test runs under the leg (`TK_STUDIO_ROOT` is set there since 37.6: the skip's cause found and removed, or the skip named), the `_budget` guard is pinned by behaviour (a fake `bun` on PATH), `guards.test.ts` pins the env as `tier.test.ts` does (saved in `beforeAll`, restored after; never skipped by name), and a behavioural slow-second-file test proves the per-file timeout holds past the first file (two fixture files, the second over the figure, the run red on it)

**AC3.** **Given** the planner's test guidance (DW-172; `task-planning.md`'s test rules) and `parseSkillsList`/`skillInStore` (`sandbox.ts:342-359`; DW-183: the real listing is `SKILL STORE` then the store entries `synced` and `tk-studio`) **When** a plan is written, and when the pin checks the store **Then** the guidance names `_budget.HOST_TEST_TIMEOUT_MS` (30 000 ms a test on the host) and the derived suite bound, pinned by the guidance's test; `parseSkillsList` is pinned to the 2026-11-06 capture (the header skipped, each first token a store entry), the listing check becomes a plugin-folder check (`tk-studio` present) with the `skills/` walk as the skill check, one fixture from the capture; DW-167, DW-172, DW-173 and DW-183 close by this PR; the contract names the e2e step (0.1.34, additive)

## Boundaries & Constraints

**Always:** plans/38-6.md's `## Settled shape` 1-11 is the design (word-for-word for the guidance paragraph, shape 9); its `## Files` (20 files) is the boundary. Stdlib-only Python via `uv run`; every text-mode open/subprocess names `encoding="utf-8"`; every `bun test` names `--timeout`. The guidance mirror is regenerated by `tools/restructure/nest_pipeline.py`, never hand-edited. Ledger closures read `status: resolved 2026-11-09 by Story 38.6`. Contract: append to 0.1.34 (no version bump); Stories row `…, Story 38.5, Story 38.6 (Epic 38)` (keep any sweep entries already there).

**Block If:** the Files list must grow past the plan's 20 files; the parser re-pin breaks a caller beyond `api.test.ts:1146`, `drain.test.ts:97/:165`, `command-line.test.ts` fake-sbx paths; a drive scan turns up a real site that needs a product decision rather than a mechanical encoding/Windows fix.

**Never:** never restore the `shutil.which("bun")` literal; never skip `guards.test.ts` cases by name; never scan the nested `apps/supervisor/.bmad-loop` copy; never shrink `SUPERVISOR_E2E_TIMEOUT` or another suite's bound; no push/tag/PR/release; no edits to epics.md, stories.yaml, plan files or supervision/.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| verify cmd bare | `host: bun test` in any `.tk-studio/config.yaml` | `config verify commands` step red, detail `<rel>:<line>` + host figure | — |
| verify cmd low | `--timeout 5000` | hit | — |
| verify cmd exempt | `--timeout 30000`; trailing `# win-ok: <reason>`; comment line; `bun run verify`; under `node_modules` | not a hit | — |
| absent scope | no `skills/*/scripts` or no `.bmad-loop/plugins` / no checkout | step `{ok: true, not_run}` | lib absence stays red |
| e2e present | `test/command-line.test.ts` exists, gate runs | `== supervisor: test/command-line.test.ts N pass, M fail[, S skip] in Ns[ rc=N| (timed out after 1800s)]`; red fails gate with tail | timeout → `(timed out after 1800s)` |
| e2e absent | file missing | `== supervisor: test/command-line.test.ts skip: e2e suite absent` | — |
| slow second file | a.test.ts fast, b.test.ts sleeps 1500 ms, figure patched 500 | a green no `rc=`; b `0 pass, 1 fail … rc=1`; gate rc 1; control bare `bun test ./test/b.test.ts` exits 0 | skipped without bun |
| listing capture | `SKILL STORE` header + `synced`, `tk-studio` lines | `parseSkillsList` → `["synced","tk-studio"]` | — |
| store decide | walk finds skill | `in_store: true` | listing never answers `true` alone |
| store decide | listing answered without `tk-studio` | `false`, `via: "sbx skills ls"`, text names "the listing names no tk-studio plugin folder" | — |
| store decide | readable folder, walk lacks skill | `false`, `via: "store folder"` | — |
| store decide | listing names `tk-studio`, no readable folder | `"unknown"`, why `the listing names the tk-studio plugin folder, not skills; no store folder at <shown>` | neither source → `unknown` as today |

</intent-contract>

## Code Map

The full investigation is plans/38-6.md `## Code Map` (read it; anchors there are `17a6f3f2`'s, superseded by its "Refreshed at the 38-5 gate" block and by these re-greps at HEAD `0dbe7aa6`):

- `plugins/tk-studio/contracts/conformance/e2e_windows_semantics.py` -- `_scan_step` :466 (single root → `roots: list[Path]`, as `e2e_text_encoding._scan_step` :224), `run` :629 (scopes at :631-633), `_bun_test_list`/`_has_timeout_flag`/`bounds_hits`, `WIN_OK`. New scopes + `config verify commands` step after `bounds`.
- `plugins/tk-studio/contracts/conformance/e2e_text_encoding.py` -- `run` :247; vacuous `apps/*/scripts` :258-263 (delete); docstring :6-10, :40-42.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- both drives' notes (~:25-37).
- `apps/supervisor/.tk-studio/config.yaml:58` -- `host: bun test` (the one hit); comment example :55 is a comment line.
- `tools/verify_host.py` -- docstring e2e clause ~:16, `SUPERVISOR_E2E` :78, `SUPERVISOR_TEST_TIMEOUT_MS` :82, `supervisor_files` :149, `supervisor_env` :152, `run_supervisor_gate` :273 (per-file loop, 37.6 named skip lines, tsc step), 38.1 `== durations:` line. DW-195: `TK_VERIFY_BESIDE_LEG` / `test/preload.ts` already handled by the leg env; the e2e step uses the same env.
- `plugins/tk-studio/lib/tests/test_verify_host.py` -- CAP-5 pin ~:161, order test, per-file timeout test, exact line-list test; `_budget` load by path ~:171.
- `plugins/tk-studio/lib/tests/test_conformance.py` -- `TextEncodingDriveTestCase` ~:974, `WindowsSemanticsDriveTestCase` ~:1121 (`SCOPES`, real-tree step list).
- `plugins/tk-studio/lib/tests/test_playable_judge.py` -- `DriveBoundsTests` ~:245, literal at :287; fake-bun precedent `test_assets.py:907`.
- `apps/supervisor/test/api.test.ts` -- `canRunE2E` ~:1067, real-submit describe; precedent save/restore `launchStopGraceful` describe.
- `apps/supervisor/test/guards.test.ts` -- cases ~:326-350; copy `tier.test.ts:28-43`.
- `apps/supervisor/src/sandbox.ts` -- `parseSkillsList` :344, `skillInStore` :356; callers `cli.ts` skillMissing / submit refusal.
- `apps/supervisor/test/sandbox.test.ts` -- ~:1876-1916 re-pins.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md` -- after `**Contract tests (the Stories row).**` (~:135); mirror via nest_pipeline.
- `plugins/tk-studio/lib/tests/test_planner_rules.py` -- add after 38.5's test.
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 header clause, line 6 Stories row; new `**0.1.34 (Story 38.6, additive).**` paragraph immediately before `## 8. Conformance` (:3051; after the DW-184/DW-195 paragraph); §8 scope sentence extended. `test_driver_contract.py` -- new test after 38.5's `test_0_1_34_story_38_5_…`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-167 :1420, DW-172 :1462, DW-173 :1470, DW-183 :1554 (status lines under each).
- `kb/agent-pc-setup-runbook.md` ~:1673 "still run by hand" clause; `apps/supervisor/README.md` ~:19 bare `bun test`.

## Tasks & Acceptance

**Execution:** (each per plans/38-6.md Code Map + Settled shape)
- `plugins/tk-studio/contracts/conformance/e2e_windows_semantics.py` -- multi-root `_scan_step`, two scopes, `config verify commands` step, docstring -- AC1
- `plugins/tk-studio/contracts/conformance/e2e_text_encoding.py` -- two scopes, delete `apps/*/scripts`, docstring -- AC1
- `plugins/tk-studio/contracts/conformance/manifest.json` -- notes -- AC1
- `apps/supervisor/.tk-studio/config.yaml` -- `host: bun test --timeout 30000` + comment naming `_budget.HOST_TEST_TIMEOUT_MS` -- AC1
- `plugins/tk-studio/lib/tests/test_conformance.py` -- fixtures per new root, step lists, verify-command step test (flagged/exempt table) -- AC1
- `tools/verify_host.py` -- e2e step (`SUPERVISOR_E2E_TIMEOUT = 1800`, shared line helper, absent skip line), docstring/comment -- AC2
- `plugins/tk-studio/lib/tests/test_verify_host.py` -- CAP-5 pin over all spawns, order/timeouts/line-list pins, e2e red/absent/timed-out, `TestSlowSecondFile` -- AC2
- `plugins/tk-studio/lib/tests/test_playable_judge.py` -- AST discovery, fake-bun behavioural test -- AC2
- `apps/supervisor/test/api.test.ts` -- skip only on `!hasUv`; default/restore `TK_STUDIO_ROOT` in describe -- AC2
- `apps/supervisor/test/guards.test.ts` -- env pin from tier.test.ts -- AC2
- `apps/supervisor/src/sandbox.ts`, `apps/supervisor/test/sandbox.test.ts` -- parser + decision order (shape 10), capture fixture -- AC3
- `.bmad-loop/plugins/studio-pipeline/task-planning.md` + rendered mirror; `plugins/tk-studio/lib/tests/test_planner_rules.py` -- shape 9 paragraph, pinned with figures derived from `_budget` -- AC3
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- shape 11 -- AC3
- `_bmad-output/implementation-artifacts/deferred-work.md`, `kb/agent-pc-setup-runbook.md`, `apps/supervisor/README.md` -- closures and doc lines -- AC2/AC3

**Acceptance Criteria:** AC1-AC3 above; each proven by a test or command output. Bun-dependent proofs (TS suites, `TestSlowSecondFile`, fake-bun test, e2e step on the host leg) are `unverifiable-here` when bun is absent, with the exact commands from Verification recorded.

## Spec Change Log

## Review Triage Log

### 2026-11-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 1, medium 1, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` blind-hunter: the re-pinned `skillInStore` refuses `drain.test.ts:217`'s sbx-tier test (its :165 fake listing names no `tk-studio`) before the engine-mcp step; consult ruled accept score 1: the fake now prints the capture shape (`SKILL STORE` / `synced` / `tk-studio`) → `in_store: "unknown"`, not refused (22nd file).
  - `[medium]` `[patch]` blind-hunter + edge-case-hunter (deduplicated): `verify_command_hits` searched the whole line for `--timeout`, so a flag only in a trailing comment or a chained bare second `bun test` passed; now the trailing comment is stripped and each `bun test` segment (split on `&&`, `||`, `;`, `|`) needs its own flag ≥ the host figure; both cases added to the flagged table.
  - `[low]` `[patch]` blind-hunter: the supervisor gate's closing line counted `len(files)` while the e2e step's counts joined the totals; the e2e file now counts when it ran (`3 files`), and an absent e2e is pinned to add nothing.

### 2026-11-09 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 3
- addressed_findings:
  - `[medium]` `[patch]` edge-case-hunter: `verify_command_hits` flagged a line whose only `bun test` sits in a trailing YAML comment (`runs` empty after the comment is stripped, `runs and all(...)` false), a false red on a compliant config; now `not runs or all(...)`, with case `k` (`host: uv run x  # was bun test`) added to the exempt table.
  - `[low]` `[patch]` blind-hunter: with no checkout, the skills scope in both drives labelled hits from `plugin_root.parents[1]` (two folders above the plugin; `IndexError` for a plugin one level below the root) while lib labels from `plugin_root`; both now use `checkout or plugin_root`, pinned by `test_with_no_checkout_a_skills_hit_is_labelled_from_the_plugin_root` in each drive's test class.
  - `[low]` `[patch]` blind-hunter: the contract's config-walk pruning rule (`.git`, `.venv`, dot-folders but `.tk-studio`; else the plugin root) was pinned only for `node_modules`; the verify-command test now plants bare configs under `node_modules`, `.git`, `.venv` and `.cache` (none reported), and `test_with_no_checkout_the_config_walk_is_the_plugin_root` pins the fallback.
- rejected (one line each):
  - blind-hunter: "`_budget.HEADROOM_S` (45 s)" reads as the constant's value — the paragraph is shape 9's mandated word-for-word text; the parenthetical follows "the host figure plus", and `test_planner_rules.py` pins the sum.
  - edge-case-hunter: a block/folded YAML scalar carrying `--timeout` on the next line is flagged — no `.tk-studio/config.yaml` uses one; `win-ok` exempts a proven case.
  - edge-case-hunter: the e2e step's 1800 s is not checked against the 7200 s `host_verify_seconds` guard — `SUPERVISOR_E2E_TIMEOUT = 1800` is the plan's settled number (Never: shrink it); already a recorded residual risk, measured by 38.1's durations line.

### 2026-11-09 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` blind-hunter + edge-case-hunter (deduplicated: same claim, a bare `bun test` sharing a segment with a flagged run passes on that run's flag; same action): `verify_command_hits` split only on `&&`, `||`, `;`, `|` and searched the whole segment for `--timeout`, so a one-line YAML flow sequence (`["bun test --timeout 30000 a", "bun test b"]`) or a cmd single `&` hid a bare run; each `bun test` run is now judged on its own span (its match to the next match or the segment's end) and `&` is a separator; flagged cases `l`, `m`, `n` and exempt case `o` added.
  - `[low]` `[patch]` blind-hunter: §8's scope sentence credited the 0.1.34 roots to `e2e_windows_semantics.py` alone, against the 0.1.34 paragraph and the manifest note; it now says both drives scan the skills' scripts and `.bmad-loop/plugins` and the Windows-semantics drive reads every config verify command; `test_driver_contract.py`'s pin follows and also names the encoding drive's clause.
- rejected (one line each):
  - blind-hunter: the e2e step's 1800 s may push the host leg past its worker guard (DW-174): `SUPERVISOR_E2E_TIMEOUT = 1800` is the plan's settled number, rejected on the same ground in the previous pass, already a recorded residual risk (38.1 measures it).
  - blind-hunter: the drain fixture no longer reaches `in_store: true` and has no `LOCALAPPDATA` pin: the describe pins `LOCALAPPDATA` to an empty temp folder, and `in_store: "unknown"` (not refused) is the consult-ruled outcome of pass 2.
  - blind-hunter: `VERIFY_BUN_TEST` is case-sensitive (`BUN.EXE test`): no config writes the command name in upper case; a speculative shape.
  - blind-hunter + edge-case-hunter: a block/folded scalar with `--timeout` on the next line is a false red: rejected in the previous pass on the same ground (no config uses one; `win-ok` exempts a proven case).
  - edge-case-hunter: a non-command value mentioning `bun test` fails the drive: the contract pins a line-by-line read with no YAML parse (stdlib-only); `win-ok` is the named exemption.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/e2e_windows_semantics.py && uv run python ../contracts/conformance/e2e_text_encoding.py` -- expected: ok, new steps listed
- `uv run python tools/restructure/nest_pipeline.py --out apps/supervisor/.bmad-loop/plugins/studio-pipeline` then `git diff --stat` shows only task-planning.md in the mirror
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger` -- expected: OK
- Host/bun (unverifiable-here without bun): `cd apps/supervisor && bun test --timeout 30000 test/sandbox.test.ts test/api.test.ts test/guards.test.ts test/tier.test.ts test/drain.test.ts test/hostverify.test.ts`; `TK_ATLASSIAN_SITE=https://x.atlassian.net bun test --timeout 30000 test/guards.test.ts`; `bunx tsc --noEmit`; on the box `uv run tools/verify_host.py` shows `== supervisor: test/command-line.test.ts N pass, 0 fail …` and no skip line for `POST /jobs through the real submit path`.

## Deviation Summary

### pass 1 (2026-11-09, implementer)

- planned: the 20 files in plans/38-6.md `## Files`, the shape-9 paragraph "moving neither" of `test_nest_pipeline.py`'s pins / actual: also changed `plugins/tk-studio/lib/tests/test_nest_pipeline.py`, `EXPECTED_DIFF["task-planning.md"]` `{18}` → `{18, 137}` (21 files) / why: the word-for-word paragraph's backticked `plugins/tk-studio/contracts/…` path takes nest_pipeline's `../../` rewrite, so the mirror differs at :137 / may affect: none
- planned: shape 10 refusal text only for "listing without `tk-studio`" / actual: listing names `tk-studio` + readable folder lacking the skill → `via: "store folder"` text `; read from the store folder: the listing names the tk-studio plugin folder, not skills` / why: no wording given for this case / may affect: none
- planned: plan puts the contract paragraph after 38.5's / actual: before `## 8. Conformance`, after the DW-184/DW-195 paragraph, as the spec Code Map says / why: spec overrides plan / may affect: none

DEVIATION SCORE (implementer): 2

DRIFT: test_nest_pipeline.py EXPECTED_DIFF gains task-planning.md:137 (21st file) — the word-for-word guidance paragraph's contracts path takes the render's ../../ rewrite — affects: none
DRIFT: store-folder refusal text names the tk-studio plugin folder when the listing named it — shape 10 gave no wording for that case — affects: none
DRIFT: 38.6 contract paragraph placed before §8 after the DW-184/DW-195 paragraph — sweep paragraphs landed after 38.5's since planning — affects: none

Consult ruling (see Consult Log): all three deviations accepted at score 1; deviation_score set to 1.

### pass 3 (2026-11-09, follow-up review patches)

- none: the three patches touch only `e2e_windows_semantics.py`, `e2e_text_encoding.py` and `test_conformance.py`, all in the plan's Files.

### pass 4 (2026-11-09, follow-up review 2 patches)

- none: the two patches touch only `e2e_windows_semantics.py`, `test_conformance.py`, `driver-contract.md` and `test_driver_contract.py`, all in the plan's Files; no contract version bump (a wording fix inside the existing 0.1.34 entry).

## Consult Log

- 2026-11-09T04:26Z — trigger: file-outside-files / deviation-gt-0 / halt (oversize, 21st file) — question: accept test_nest_pipeline.py EXPECTED_DIFF {18,137} as a 21st file vs reword shape 9 vs escalate; score the two side deviations — ruling: accept-deviation score 1 — do: keep the one-line test_nest_pipeline.py change and shape 9 word for word; accept the sandbox.ts case-3 refusal suffix and the contract paragraph's placement before §8 at score 1; record all three, do not reword, split or halt — rule candidate: In plans for .bmad-loop/plugins/studio-pipeline/*.md, any new text that backticks a plugins/tk-studio/contracts/ or _bmad-output/planning-artifacts/architecture/ path must list its rendered line in test_nest_pipeline.py EXPECTED_DIFF and count test_nest_pipeline.py in the Files list.
- 2026-11-09T04:35Z — trigger: high-severity-finding / file-outside-files — question: the re-pinned skillInStore refuses drain.test.ts:217's sbx-tier test via the :165 fake listing; patch the fake (22nd file) vs change sandbox.ts vs escalate — ruling: accept-deviation score 1 — do: patch only the drain.test.ts:165 fake to print the capture shape (SKILL STORE / synced / tk-studio), leave LOCALAPPDATA, tier and expectation; record drain.test.ts as the 22nd file (plan Code Map :158 wrong: :221 enqueues tier sbx); never touch sandbox.ts semantics; run the plan's bun line on the host leg — rule candidate: The planner adds every test file the plan names as an expected re-pin caller to its Files list and checks each pin's tier against its enqueue call, not its describe title.

### pass 2 (2026-11-09, review patches)

- planned: the plan's Files (plus test_nest_pipeline.py, ruled) / actual: also changed `apps/supervisor/test/drain.test.ts` (the :165 fake's `skills ls` output, the capture shape) / why: the plan's Code Map (:158) called it host-tier, but the :217 test enqueues `tier: "sbx"`; consult ruled score 1 / may affect: none
- planned: update the existing closing-line pins / actual: also one assertion in the absent-e2e test pinning `2 files` / why: proves the absent half of the low patch / may affect: none

DRIFT: drain.test.ts:165 fake prints the sbx listing capture shape (22nd file) — the re-pinned skillInStore otherwise refuses the sbx-tier engine-mcp test — affects: none

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-07T20:38:28Z | 2026-11-07T21:02:55Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-08T16:55:31Z | 2026-11-08T16:57:15Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-09T04:08:16Z | 2026-11-09T04:43:44Z | 463eda9f-9182-4f05-86f7-c4ea710589a5 | claude-opus-5-5 | medium | 22548672 | 139837 | 11.3997 | completed |
| review | 1 | 2026-11-09T04:43:44Z | 2026-11-09T04:55:37Z | fefd3863-595c-4fc4-85e1-f59ba78e115b | claude-opus-5-5 | medium | 3848829 | 48028 | 3.9822 | completed |
| review | 2 | 2026-11-09T04:55:37Z | 2026-11-09T05:10:02Z | ef11a6d6-5df7-480d-815d-601369a5a78e | claude-opus-5-5 | medium | 3305646 | 48413 | 3.4182 | completed |
| gate | 1 | 2026-11-09T05:10:03Z | 2026-11-09T05:17:05Z | 1bc81298-6e13-47c5-8cd6-c0b2518b0084 | claude-opus-5-5 | medium | 4605628 | 32809 | 2.7753 | completed |
| host-leg | 1 | 2026-11-09T05:17:58Z | 2026-11-09T06:20:43Z | — | — | — | — | — | — | red |
| close-out | 1 | 2026-11-09T06:20:43Z | 2026-11-09T06:20:53Z | — | — | — | — | — | — | draft PR |
| re-run | 1 | 2026-11-09T06:45:53Z | 2026-11-09T08:07:54Z | — | — | — | — | — | — | red |
| re-run | 2 | 2026-11-09T08:21:55Z | 2026-11-09T09:43:06Z | — | — | — | — | — | — | green |
| merge | — | 2026-11-09T09:44:10Z | 2026-11-09T09:44:10Z | — | — | — | — | — | — | merged |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261109T040548Z-8b5200` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review of the committed Story 38.6; the previous pass had recommended one. The review covered every change from `0dbe7aa64ea9abff0a1281f87c469a5a5ddd70e4` to HEAD, excluding the loop's spec artifacts. Two layers ran, blind-hunter and edge-case-hunter (band L). Nine findings came back (counting the blind-hunter's three scanner sub-cases separately). Two pairs were deduplicated: the flow-sequence and single-`&` cases share one claim and one fix, and the block-scalar case was reported by both layers. That leaves seven: two patched, five rejected. No existing deferred-work ledger entry was touched. The story's implementation (AC1-AC3, as recorded in the dev pass) is otherwise unchanged.

**Files changed in this pass (4):**
- `plugins/tk-studio/contracts/conformance/e2e_windows_semantics.py`: `verify_command_hits` judges each `bun test` run on its own span, and a cmd single `&` now separates runs.
- `plugins/tk-studio/lib/tests/test_conformance.py`: flagged cases `l` (flow sequence), `m` (`&` with a bare second run) and `n` (`&` with a borrowed flag); exempt case `o` (both flow-sequence runs flagged).
- `plugins/tk-studio/contracts/driver-contract.md`: §8's scope sentence names both drives' 0.1.34 roots. No version bump.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the §8 pin follows the new wording and names the encoding drive's clause.

**Review.** Patches applied: 2 (high 0, medium 1, low 1). Deferred: 0. Rejected: 5. Follow-up review recommended: **false** (score 3×1 + 1×1 = 4).

**Verification.**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): `Ran 3072 tests`, `OK (skipped=5)`.
- `uv run python ../contracts/conformance/runner.py run`: `ok: True`, `failures: []`.
- Both drives, run directly on the real tree: ok. Steps: `[plugins/tk-studio/lib, apps/supervisor/src, apps/supervisor/test, _bmad/scripts, tools, plugins/tk-studio/skills/*/scripts, .bmad-loop/plugins, bounds, config verify commands]` (9 configs, every bun test verify command carries `--timeout`) and `[lib, tools/installer, plugins/tk-studio/skills/*/scripts, .bmad-loop/plugins]`.
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger`: OK.
- The `nest_pipeline.py` re-render was not re-run: this pass touches no `.bmad-loop/plugins` file.

**Unverifiable here (bun absent; the operator runs these, unchanged from the dev pass):**
- `cd apps/supervisor && bun test --timeout 30000 test/sandbox.test.ts test/api.test.ts test/guards.test.ts test/tier.test.ts test/drain.test.ts test/hostverify.test.ts`
- `cd apps/supervisor && TK_ATLASSIAN_SITE=https://x.atlassian.net bun test --timeout 30000 test/guards.test.ts`
- `cd apps/supervisor && bunx tsc --noEmit`
- On the box: `uv run tools/verify_host.py` shows `== supervisor: test/command-line.test.ts N pass, 0 fail …` and no `skip:` line for `POST /jobs through the real submit path`.

**Residual risks.**
- The TS changes from the dev pass have still not been type-checked or run here.
- The e2e step's 1800 s, added to the per-file bounds, has not been measured against the 7200 s `host_verify_seconds` guard on the box. If a slow run pushes a leg into `inconclusive (guard)`, the fix is a design number, and that ruling is the operator's (38.1's durations line measures it).
- The verify-command scan reads the file line by line. A command split across a YAML block scalar, or a non-command value that mentions `bun test`, is flagged; `win-ok` is the exemption. Inside a flow sequence, a bare run followed on the same line by a non-bun item carrying `--timeout` would still borrow that flag. No config has that shape.
- Serve note: stop the supervisor tab before `apps/supervisor` is built, and restart it through the scheduled task after the merge.

## Reconcile

- 2026-11-09 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 38-7-the-records-reconciled-and-the-policys-bands (plan refreshed in place: owner decisions TKSTUDIO-234/235/236 and the CAP-14 (b)/(c) record absorbed into its invoke_dev_with, the eleven PR-less 38.x closures and a detached re-run leg Block If added; operator note in the replan queue; stage start/stop ok)
