---
title: 'One Verdict for Every Consumer'
type: 'bugfix'
created: '2026-10-30'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: 'd09d6c5428cf9d0346293b1435b2f6315af4603b'
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The 0.1.31 note says an inconclusive leg ends a sweep `partial` unconditionally, while `sweepEndState`'s `blocked` rules (no triage, no bundle landed) apply first.
    evidence: |-
      Edge Case Hunter; `apps/supervisor/src/sweep.ts:311-314` return `blocked` before the verdict is read. Meets deferral rule (b), a contract statement left imprecise. The consult ruled the 0.1.31 paragraph is not edited in this story; a later 36.x clause can state the precedence.
    location: >-
      plugins/tk-studio/contracts/driver-contract.md:2114
    severity: medium
  - summary: >-
      The re-run verb exits 1 on an inconclusive leg, but no contract note states it. Filed as DW-133.
    evidence: |-
      `apps/supervisor/src/cli.ts:2658, :2667`; `driver-contract.md:396` reads "1 red or skipped" and is 0.1.28 history. Meets deferral rule (b).
    location: >-
      apps/supervisor/src/cli.ts:2667
    severity: low
---

> **SERVE PROCESS CHANGE (the epic's rule).** `board.ts` and `planstatus.ts` run inside `serve`: the operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.

<intent-contract>

## Intent

**Problem:** The host leg's verdict is derived more than once and not every derivation knows `inconclusive`, so an inconclusive leg shows green on the board while the plan status writes it red (DW-100). The slice path has two regression gaps (DW-91).

**Approach:** As the loop, I want the host leg's verdict (green, red, inconclusive) derived once and read by the board, the plan status, the stage log, the rollup and the sweep, with a test feeding an inconclusive leg to each, and the slice path's regression gaps closed, so that an inconclusive leg files a run under `needs_you` on every screen, never green on one and red on another (AI-1; DW-100, DW-91).

### Acceptance Criteria (verbatim, epics.md Story 36.1)

**AC1. Given** an ended run whose latest `host-verify` event is inconclusive
**When** `board.ts hostVerifyOf` (~:262) and `planstatus.ts supervisorRows` (~:444-454) read it
**Then** both read through `hostverify.ts legVerdict` (the inline derivations at `hostverify.ts:871-872, :881` and `planstatus.ts:454` collapse to the one), the board files the run under `needs_you` with `inconclusive`, the Stage Log row and its Jira mirror (`stage-post`) read `inconclusive`, and `report.py rollup` counts it as neither green nor red

**AC2. Given** the slice path
**When** the supervisor suites run
**Then** one test drives the sweep to `closeOut` with `slice: true` on a passing playable run and asserts the sheet (`worktree.ts:917, :848, :445-448`), and the frame-name contract between `sheet`'s `frames` and `proofCommit` is pinned by one literal both read (DW-91)

**AC3. Given** the supervisor suites and conformance
**When** they run
**Then** an inconclusive leg is fed to the board, the plan status, the stage log and the sweep tests (`planstatus.test.ts` beside its green/red cases); the contract (0.1.31, additive) names the one-verdict rule; DW-100 and DW-91 close by this PR

## Boundaries & Constraints

**Always:** Every verdict *string* comes from `legVerdict`; `isRed`/`isInconclusive` stay exported for reasons and boolean guards. The story plan's Settled shape 1-5 stands. The plan's Files list is the boundary. House rules: stdlib-only Python via `uv run`, atomic writes, AD-11 status blocks, no credentials in tracked files, no driver import in the plugin (AD-2). The contract change is additive.

**Block If:** The board must carry a reason string beside `host_verify: "inconclusive"` (no design document names such a field; the reason stays in the event). The 14 `assertNotIn("**0.1.31**")` guards cannot be removed without breaking a 35.x phrase assertion. The Files list grows past the band.

**Never:** Change the production condition at `worktree.ts:678` to make a fixture pass. Touch `delivery.ts`, or the boolean guards in `cli.ts:2658` and `hostleg.ts:301-302`. Change `plansync.py`'s mirror code. Push, tag, open a PR, bump gate x3 versions or run the release motion. Edit `epics.md`, `stories.yaml`, canonical plan files, or anything under `supervision/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Board, live | Live run; inconclusive `host-verify` after latest `launched` | `host_verify: "inconclusive"`, column `needs_you` | none |
| Board, ended today | Terminal run ended on host's local day; same event | `needs_you` | none |
| Board, older ended | Terminal run ended earlier; same event | not `needs_you` (`done`) | none |
| Board, before launch | Inconclusive event precedes latest `launched` | not `needs_you` | none |
| Plan status | Leg detail `{green:false, playable:{verdict:"inconclusive",…}}` | row `outcome: "inconclusive"` (`host-leg` and `re-run`) | none |
| legHistory | Raw inconclusive event detail | entry verdict `inconclusive` | none |
| Sweep end state | Inconclusive verify | `partial`, reason `/^host verify inconclusive \(playable\)/` | none |
| Rollup | Stage rows with `outcome: "inconclusive"` | Counted in `by_stage` / `reruns`; no green or red key anywhere | none |
| Slice sweep | `sweepEngines` with slice definition, passing playable | `closeOut` commits proof: sheet and `frames/<name>` under the proof folder | none |

</intent-contract>

## Code Map

The investigation is [the story plan](../plans/36-1.md): read its **Code Map**, **Settled shape**, **Files**, **Verify** and **Risks** in full. Its anchors were confirmed at HEAD for `hostverify.ts:871`, `board.ts:258-269`, `planstatus.ts:454`, `worktree.ts:637`. Note its warning: the AC's `worktree.ts:917, :848, :445-448` are stale; current anchors are in the plan.

Reuse: `proofCommit`, `proofCommitDue`, `originWebUrl`, `launchedCloseOutInput`, `recordedVerify`, `CONTACT_SHEET` (the precedent for `FRAMES_DIR`), `hostverify.test.ts recorder` (lift to `test/helpers/slice.ts`).

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- `legHistory` via `legVerdict`; `export const FRAMES_DIR = "frames"`, read by `MEDIA` and `legProof` -- one derivation, one literal
- `apps/supervisor/src/board.ts` -- `HostVerifyOutcome` gains `inconclusive`; `hostVerifyOf` via `legVerdict`; `redSinceLaunch` becomes `needsYouSince` (red or inconclusive, same after-latest-`launched` rule) -- AC1
- `apps/supervisor/src/planstatus.ts` -- import `legVerdict`; replace :454; header comment :62 -- AC1
- `apps/supervisor/src/worktree.ts` -- `FRAMES_DIR` in `proofCommit`; verdict strings via `legVerdict` in `closeOut`/`sweepEngines` -- AC1, AC2
- `apps/supervisor/src/sweep.ts`, `apps/supervisor/src/hostleg.ts` -- verdict strings via `legVerdict` only, where any are produced; guards unchanged -- AC1
- `apps/studio-web/src/board/model.ts` -- type mirror gains `inconclusive` -- additive `GET /board` value
- `apps/supervisor/test/helpers/slice.ts` (new), `apps/supervisor/test/hostverify.test.ts` -- lift `recorder` into the helper; `legHistory` inconclusive; `FRAMES_DIR` pins -- AC2, AC3
- `apps/supervisor/test/worktree.test.ts` -- sweep-driven slice close-out on a passing playable run, asserting the sheet -- AC2
- `apps/supervisor/test/planstatus.test.ts`, `board.test.ts`, `sweep.test.ts` -- matrix rows, titled under `Story 36.1` -- AC3
- `plugins/tk-studio/lib/tests/test_stage_log.py` -- `RollupTests` inconclusive row -- AC1
- `plugins/tk-studio/lib/tests/test_playable.py` -- bare-name `frames`, `FRAMES == "frames"` -- AC2
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 0.1.31 per plan (header, rulings row, paragraph before `## 8. Conformance`, :110/:391 outcome lists; 35 pin flips, 14 guard deletions, `test_0_1_31_story_36_1_one_verdict`) -- AC3
- `plugins/tk-studio/contracts/conformance/e2e_vertical_slice.py`, `e2e_run_sweep.py`, `manifest.json` -- widen filters with `|Story 36.1`; keep budget under the manifest timeout -- AC3
- `apps/supervisor/README.md` -- :207 outcomes gain `inconclusive` -- docs
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-91 and DW-100 `status: resolved 2026-10-30 by this story's PR (36.1: …)` -- AC3

**Acceptance Criteria:** AC1-AC3 in the intent contract; the matrix covers their cases. "Its Jira mirror reads `inconclusive`" is met by the row per Settled shape 2: the contract paragraph says the comments carry no outcome.

## Spec Change Log

## Review Triage Log

### 2026-10-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 2: (high 0, medium 1, low 1)
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` DW-100 and the plan name the sweep, but `sweepEndState` did not read `legVerdict`. It now branches on `legVerdict` without a cast, and DW-100's note names the sweep's end state (consult ruling).

## Design Notes

Filing rule (Settled shape 3): AC1's "an ended run" follows the board's existing rule for red: `needs_you` when live or ended on the host's local day, and an older ended run stays `done`. `FRAMES_DIR` is one literal per language, with the cross-language contract pinned by tests on both sides (Settled shape 1).

`bun` is at `~/.bun/bin/bun` on this box, not on `PATH`: export `PATH="$HOME/.bun/bin:$PATH"`. `apps/supervisor/node_modules` is absent, so run `bun install --frozen-lockfile` there first (and in `apps/studio-web`); do not commit anything it produces. If the install cannot run, report that plainly: the supervisor proof then stays `unverifiable-here`, and that must be stated in the report, never implied green.

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- expected: green
- From `plugins/tk-studio/lib`: `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- From project root: `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: green
- From `apps/supervisor`: `bun test` -- expected: green, `Story 36.1` tests ran
- From `apps/supervisor`: `bun run typecheck` -- expected: no new errors over baseline
- From `apps/studio-web`: `bun test src/board/model.test.ts` -- expected: green

## Deviation Summary

### pass 1

- planned: `sweep.ts` and `hostleg.ts` modified, and `worktree.ts` `closeOut`/`sweepEngines` moved to `legVerdict` for verdict strings / actual: no change to any of these; `worktree.ts` got only the `FRAMES_DIR` edit / why: they produce no new verdict strings (`closeOut:637` and `hostleg:205` already use `legVerdict`), the rest are boolean guards or reason selectors / may affect: 36-2 (unresolved key, per the implementer)
- planned: 35 `**0.1.30**` pin flips / actual: those plus a 36th, the regex in `test_carries_its_own_semver_and_change_policy` :113 / why: the plan's count missed it / may affect: none
- planned: matrix row "Board, older ended: not `needs_you` (`done`)" / actual: the test asserts not in `needs_you`; contract says "an older ended run never needs you" / why: existing triage lists only runs ended on the host's local day in Done, so an older run is in no column / may affect: none
- planned: `FRAMES_DIR` beside `CONTACT_SHEET`, after `MEDIA` / actual: declared just before `MEDIA` / why: `MEDIA` is a module-level array and would read the const before initialisation / may affect: none
- planned: `recorder` lifted unchanged / actual: added `passing` and `through` options and `FRAMES_DIR` in fake report paths / why: the sweep-driven test needs a passing playable run and real git and gh / may affect: none
- planned: `bun run typecheck` / actual: `bun node_modules/typescript/bin/tsc --noEmit` / why: `EPERM` install left no `.bin` / may affect: none

DEVIATION SCORE: 1

DRIFT: `sweep.ts`, `hostleg.ts` and `worktree.ts` closeOut/sweepEngines unchanged for verdict strings — they produce none beyond those already on `legVerdict` — affects: 36-2
DRIFT: a 36th pin flip at `test_driver_contract.py:113` — the plan's count missed it — affects: none
DRIFT: older ended run asserted not in `needs_you` rather than in `done` — existing triage files it in no column — affects: none
DRIFT: `FRAMES_DIR` declared before `MEDIA` — initialisation order — affects: none
DRIFT: shared recorder gained `passing` and `through` options — the sweep-driven test needs them — affects: none
DRIFT: typecheck run through `bun node_modules/typescript/bin/tsc --noEmit` — install left no `.bin` — affects: none

### pass 1 ruling

Consult rejected the `sweep.ts` part of the first deviation; `sweepEndState` goes through `legVerdict` in pass 2. The `hostleg.ts` and `worktree.ts` part and the other five deviations are accepted at score 1. `hostleg.ts` and `worktree.ts` already take every verdict string from `legVerdict` (`hostleg.ts:205`, `worktree.ts:637`), which meets those two plan Files lines.

### pass 2

Review patches: `sweep.ts` through `legVerdict`, DW-100's note. Two contract edits (`:396` exit list, `Legs:` grammar) were tried, turned the gate red on `test_driver_contract.py:2453`, and were reverted to HEAD on the consult's ruling; versioned notes are history. DW-133 filed. No new deviations.

DRIFT: `hostleg.ts` and `worktree.ts` closeOut/sweepEngines unchanged for verdict strings — they already take every verdict string from `legVerdict`; the rest are guards and reason selectors (consult: accepted, score 1) — affects: none
DRIFT: a 36th pin flip at `test_driver_contract.py:113` — the plan's count missed it — affects: none
DRIFT: older ended run asserted not in `needs_you` rather than in `done` — existing triage files it in no column — affects: none
DRIFT: `FRAMES_DIR` declared before `MEDIA` — initialisation order — affects: none
DRIFT: shared recorder gained `passing` and `through` options — the sweep-driven test needs them — affects: none
DRIFT: typecheck run through `bun node_modules/typescript/bin/tsc --noEmit` — install left no `.bin` — affects: none

## Consult Log

- 2026-10-30T21:15:28Z — trigger: deviation-gt-0 — question: accept leaving sweepEndState on isRed/isInconclusive, and the five other score-1 deviations? — ruling: reject-deviation — do: branch sweepEndState on legVerdict without a cast, keeping reasons, strings and rule order; leave hostleg.ts and worktree.ts; accept the other five at score 1; record that hostleg.ts and worktree.ts already take verdict strings from legVerdict; do not edit the contract paragraph — rule candidate: In a plan, a Not-a-Block exemption applies only to the sites it names; a Files line naming a function "via X" must be met at that function unless the plan exempts it by name.
- 2026-10-30T21:26:19Z — trigger: verify-red — question: keep or revert the `Legs:` grammar edit in the 0.1.30 note that broke the pin at test_driver_contract.py:2453, and the :396 exit-list edit? — ruling: reject-deviation — do: restore both passages to HEAD; leave the test, the 0.1.31 paragraph and :392-393 untouched; rerun lib; record the finding answered by the 35.3 and 0.1.31 notes; file one deferred-work entry for the exit — rule candidate: A versioned change note is history: review patches never edit one unless the plan names the line, and a new fact goes in the current version's note or a deferred-work entry.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-30T20:25:52Z | 2026-10-30T20:48:43Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-30T20:48:56Z | 2026-10-30T21:26:33Z | ff9b33ff-c68e-460f-b983-d17eb24a84aa | claude-opus-5-5 | medium | 5017382 | 113055 | 7.4161 | completed |
| gate | 1 | 2026-10-30T21:26:34Z | 2026-10-30T21:29:33Z | 16cfca46-7af7-42ad-ac4c-cc45f69d699d | claude-opus-5-5 | medium | 924498 | 12773 | 1.2670 | completed |
| close-out | 1 | 2026-10-31T01:15:03Z | 2026-10-31T01:15:03Z | — | — | — | — | — | — | draft PR |
| close-out | 2 | 2026-10-31T01:17:10Z | 2026-10-31T01:17:10Z | — | — | — | — | — | — | skipped |
| close-out | 3 | 2026-10-31T01:19:36Z | 2026-10-31T01:19:36Z | — | — | — | — | — | — | PR |
| re-run | 1 | 2026-10-31T01:19:32Z | 2026-10-31T01:58:23Z | — | — | — | — | — | — | red |
| re-run | 2 | 2026-10-31T02:02:10Z | 2026-10-31T02:41:13Z | — | — | — | — | — | — | red |
| re-run | 3 | 2026-10-31T03:36:17Z | 2026-10-31T04:16:30Z | — | — | — | — | — | — | green |
| merge | — | 2026-10-31T04:17:48Z | 2026-10-31T04:17:48Z | — | — | — | — | — | — | merged |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-36-20261030T201456Z-e76900` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** `legHistory`, `board.ts hostVerifyOf`, `planstatus.ts supervisorRows` and `sweep.ts sweepEndState` all read `legVerdict`. An inconclusive run after its latest `launched` files under `needs_you` while live or ended on the host's local day. `FRAMES_DIR` is the one TypeScript literal for the proof folder, pinned against Python's `FRAMES` and `sheet()`'s bare names by tests on both sides. Contract 0.1.31 opened. DW-91 and DW-100 resolved; the operator fills in the PR number.

**Files:** source: `hostverify.ts`, `board.ts`, `planstatus.ts`, `sweep.ts`, `worktree.ts` (`FRAMES_DIR` only), `apps/studio-web/src/board/model.ts`. Tests: `test/helpers/slice.ts` (new), `board`, `planstatus`, `sweep`, `worktree`, `hostverify` suites; `test_stage_log.py`, `test_playable.py`, `test_driver_contract.py`. Contract and conformance: `driver-contract.md`, `e2e_vertical_slice.py`, `e2e_run_sweep.py`, `manifest.json`. Docs: `apps/supervisor/README.md`, `deferred-work.md` (DW-91, DW-100 resolved; DW-133 filed).

**Review:** patches 1 (medium); deferred 2 (DW-133 low; the 0.1.31 sweep-precedence wording, medium, rule (b)); rejected 4 (`Legs:` grammar, answered by the 35.3 and 0.1.31 notes; web renderer, nothing in `apps/studio-web` branches on the value; conformance drive scope, AC2 names the supervisor suites; no PR number in the ledger, the operator fills it). Follow-up review: false (patched high 0, medium 1, low 0; score 3).

**Verification:**
- `uv run python -m unittest discover tests`: 2601 tests, OK (skipped=4), after the final change.
- `runner.py run`: `ok: true`, 23 surfaces, 164 checks, after the final change.
- `tests.test_release_roster`: 86 tests OK, run before the review patches, not rerun after them.
- `bun test` in `apps/supervisor`: **not fully green**: 1662 pass, 92 skip, 4 fail, last run after the `sweep.ts` patch (only contract text and the ledger changed after that). All 4 are in `test/tier.test.ts`, which this story did not change; the implementer reported the same 4 failures before any edit. Unsetting the `TK_ATLASSIAN_*` variables took the file from 4 failures to 2, so at least two depend on the environment; the cause of the other two was not established.
- `Story 36.1` tests ran and passed: 5 across board, plan status, sweep and hostverify, 1 in worktree (counts from before the `sweep.ts` patch; the full run after it shows no new failure).
- `bun test src/board/model.test.ts` in `apps/studio-web`: 10 pass.
- Typecheck, `apps/supervisor` only: `bun node_modules/typescript/bin/tsc --noEmit` clean. `apps/studio-web` was not typechecked.

**Residual risks:**
- The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.
- Behaviour change: a run that ended today `partial` on an inconclusive leg moves from Done to Needs-you.
- The sweep-driven slice test sits in `worktree.test.ts`, which neither conformance drive runs; only the supervisor suite covers it.
- `bun install` reported `EPERM` link errors on this box, leaving `.bin` empty.

DRIFT: `hostleg.ts` and `worktree.ts` closeOut/sweepEngines unchanged for verdict strings — they already take every verdict string from `legVerdict`; the rest are guards and reason selectors (consult: accepted, score 1) — affects: none
DRIFT: a 36th pin flip at `test_driver_contract.py:113` — the plan's count missed it — affects: none
DRIFT: older ended run asserted not in `needs_you` rather than in `done` — existing triage files it in no column — affects: none
DRIFT: `FRAMES_DIR` declared before `MEDIA` — initialisation order — affects: none
DRIFT: shared recorder gained `passing` and `through` options — the sweep-driven test needs them — affects: none
DRIFT: typecheck run through `bun node_modules/typescript/bin/tsc --noEmit` — install left no `.bin` — affects: none

## Reconcile

- 2026-10-30 — score 1; reconcile not required.
Gate: Part A not-required; Part B story accepted, planned 36-2-the-sweeps-records-are-whole
