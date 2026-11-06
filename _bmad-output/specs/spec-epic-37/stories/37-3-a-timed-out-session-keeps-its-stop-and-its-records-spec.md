---
title: 'A Timed-Out Session Keeps Its Stop and Its Records'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_revision: '4f8c6548ddc5d6c1ae911b5d4306610c486ef9a5'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-37/plans/37-3.md'
  - '{project-root}/_bmad-output/specs/spec-epic-37/SPEC.md'
warnings: [oversized]
deferred:
  - summary: >-
      A split story's `<key>-s2` spec matches the first half's `<key>-*.md` prefix glob once both specs exist, so a spec lookup by the first half's key is ambiguous.
    evidence: |-
      task-planning.md section 3 (both copies) mints `<key>-s2` entries (plan Settled shape 3); `plansync._stage_target` globs `<sid>-*.md` and raises "several specs match"; `closeout.findSpec` matches `${key}-` and returns undefined on two hits; the engine resolves a spec by the glob `<id>-*.md` (story 21-6). The `<key>-r<n>` remediation ids share the collision (no such spec exists on disk yet). The engine's glob is outside this repo.
    location: >-
      .bmad-loop/plugins/studio-pipeline/task-planning.md section 3; plugins/tk-studio/lib/plansync.py _stage_target; apps/supervisor/src/closeout.ts findSpec
    severity: medium
---

> **Serve process changes.** `apps/supervisor/src/worktree.ts`, `closeout.ts` and `cli.ts` run inside `serve`: the operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge (plan Settled shape 5).

<intent-contract>

## Intent

**Problem:** Story 36.3's first dev attempt hit the engine's 90-minute clock with uncommitted work: with `[scm] rollback_on_failure = false` the engine paused for a hand `git reset`, discarded the armed graceful stop (`stop-request-discarded`), the close-out opened a draft PR with no host leg for the two stories already landed, the attempt left no Stage Log row, and the cancelled run's `job-run` line carried no worker cost (holes 105, 106; retrospective C3, C6; DW-148). Two stop-rule defects remain: `own_block` runs count toward `max_runs` (DW-157) and a figure-1 run whose arming was refused relaunches at close-out (DW-161).

**Approach:** The plan's four Settled shapes (`plans/37-3.md`), which bind: (1) `worktree.ts materialise` writes `rollback_on_failure = true` into the run worktree's copied policy only, documented in `kb/bmad-base-patches.md` as an engine policy setting; (2) the paused close-out runs the host leg on a clean tree and opens the PR ready on green, a dirty paused tree skips with `verify.skipped: "paused: dirty tree"` and stays a draft; (3) `stage_from_pass` backfills unrecorded earlier sessions (the `timeout` row) and task-planning.md §3 gains the split rule; (4) the cancel's `finish` carries `--total-cost-usd`, `evaluate_stop`'s `max_runs` skips `own_block`, and a third `StopInForce.source = "arming-refused"` ends the run at the boundary. Contract: the `0.1.32 (Story 37.3, additive)` entry.

### Acceptance Criteria (verbatim, Story 37.3, `epics.md` "### Story 37.3")

AC1. **Given** a run's own worktree (never a main checkout) and `[scm] rollback_on_failure` **When** a dev session ends `timeout` with uncommitted work **Then** the policy the pin writes for a run worktree sets `rollback_on_failure = true` (the attempt's tracked changes reverted, only the files this run created removed, the studio-managed base patch documented in `kb/bmad-base-patches.md`) so the engine retries or escalates without a hand reset; the pending graceful stop survives the pause (`stop-request-discarded` never follows a timeout); the pause close-out runs the host leg for the commits already landed and opens the PR ready on green, not a draft with no leg (DW-148)

AC2. **Given** a band-L story whose plan's Files list or estimated passes exceed the dev clock (`session_timeout_min`), and the stage log of a timed-out attempt **When** the planner plans it, and when the attempt ends **Then** the planner splits it (two plans, the second a follow-on story in `stories.yaml`) or names the halt consult's split candidates in the plan's risk; the timed-out attempt writes its Stage Log row (`outcome: timeout`, its tokens and cost from the session record); the retrospective's rollup counts it

AC3. **Given** a cancelled run, a run ending on the supervisor's own block (`own_block`), and a figure-1 run whose stop arming was refused **When** the queue ends it **Then** the `job-run` ledger line carries the worker's cost (the `accounted` event's figure) for a cancelled run (C6), a run carrying `own_block` is not counted toward `stop.max_runs` in `evaluate_stop` (DW-157), and a figure-1 run whose arming was refused never relaunches at close-out: it ends the run at the boundary with a line (DW-161); the supervisor suites and `test_jobrun` cover each; the contract names the rules (0.1.32, additive)

## Boundaries & Constraints

**Always:**
- The plan's Settled shapes 1-4 and SPEC design notes CAP-7/8/9 bind; the plan's Files list is the boundary (any other file is a deviation, reported).
- The rollback's removal set is the engine's rule (`verify.py safe_rollback`), documented, never re-implemented or filtered studio-side; only `materialise` writes it, so a main checkout keeps `false`. The edit of the copied policy is atomic (tmp then rename, the destination cleared first or tmp-to-file: the `e2e_windows_semantics` class (c)), and verified with `Bun.TOML.parse`.
- The kept stop follows from the rollback (a timeout retries/defers, never pauses, so the boundary honours the pending stop); prove it by pinning the policy value plus the contract statement of the engine's rule; the engine is never edited.
- Cancel cost: `--total-cost-usd` = `launchedCloseOutInput(...).costUsd` so the ledger line and the PR body agree; omitted when no figure exists.
- `arming-refused`: only a figure-1 run (`stop.after_stories: 1` rhythm) with a `stop-armed ok: false` for this engine run; it routes through `noteStoryBoundary`/`endAtBoundary` with the line `story boundary: <key> landed; the one-story stop arming was refused (<detail>)`. Keep the `isRunEpic` predicate call in one place (37.4 replaces it).
- The two task-planning.md copies stay a render of each other (`test_nest_pipeline.py` allows the line-18 diff only).
- Contract: header stays `**0.1.33**`; add the clause `0.1.32 (Story 37.3, additive): …` right after the `0.1.32 (Story 37.2, additive)` clause and before `0.1.33 (DW-170, additive)` (DW-170's test pins its clause as the header's last); `, Story 37.3` after `, Story 37.2` in the Stories row; a `**0.1.32 (Story 37.3, additive).**` paragraph after 37.2's and before the `**0.1.33 (DW-170, hole 111, additive).**` paragraph, superseding 36.3's "the PR stays a draft" by statement. Test `test_0_1_32_story_37_3_a_timed_out_session_keeps_its_stop_and_its_records` modelled on 37.2's; no new version guard.
- Ledger: DW-148, DW-157, DW-161 read `status: resolved 2026-11-06 by Story 37.3` (never `by this story's PR`); a hand-filed entry takes its id from `plansync.py deferred mint`. Runbook hole-106 row gains `; fixed (Story 37.3, DW-148): …`.
- Stdlib-only Python via `uv run`; `encoding="utf-8"` on every text open/subprocess; every `bun test` names `--timeout 30000` (AGENTS.md); joined-path assertions normalise their subject.

**Block If:** (consult per the plan's Risks; HALT on `escalate`)
- The engine's removal set must be narrowed beyond its own rule → consult `bad_spec`.
- A tracked story spec reverted by the reset loses the timed-out row even with the backfill → consult `bad_spec`.
- The paused leg must judge a dirty tree (stash/WIP on a story run) → consult `deviation-gt-0`.
- The cancel cost must be the worker `accounted` figure alone where the PR body reads the metered figure → consult `bad_spec`.
- The Files list must grow materially past the band → consult `halt`; never split the story.

**Never:** raise `session_timeout_min`; edit the installed engine; upgrade old worktrees; touch `epics.md`, `stories.yaml`, plans, `.bmad-loop/routing.toml|policy.toml` (the checkout's), anything under `supervision/`; push, tag, open a PR, run the release motion or bump gate x3 versions; replace `isRunEpic` (37.4's).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Run worktree materialised | checkout policy `rollback_on_failure = false` | worktree copy reads `true` (TOML-parsed), every other byte equal; checkout's copy untouched | policy absent → no write; parse failure → original restored, refused by name |
| Paused, clean tree | engine `paused`, HEAD = landed commits, leg green | `host-verify` runs; PR opened/flipped ready | red/inconclusive → draft |
| Paused, dirty tree | uncommitted changes in worktree | leg skipped, `verify.skipped: "paused: dirty tree"`, PR draft | — |
| Timeout then retry | pass 1 `status: timeout` (no row), pass 2 post_session | both rows; pass 1 `outcome: timeout`, tokens from `state.json` `usage`, cost via `_session_usd` when no transcript | no figure → `—` |
| Rollup | stage log with a `timeout` dev row | counted in `by_stage["dev"]` | — |
| Planner, oversize | plan Files/passes over `session_timeout_min` | §3 rule: two plans + `<key>-s2` entry (`Split: …`), or split candidates under Risks | — |
| Cancel | queue run with worker/engine `accounted` | `finish --state partial --reason <cancelled> --total-cost-usd <x>` | no figure → flag omitted |
| `max_runs` | N runs, one with `own_block` | own-block run not counted | — |
| Refused arming, figure 1 | run-epic def `after_stories: 1`, `stop-armed ok:false` | no relaunch; run ends at boundary with the line | `ok: true` or non-figure-1 → unchanged behaviour |

</intent-contract>

## Code Map

The plan's `## Code Map` (`plans/37-3.md`, including "Anchors after 37.2" and "The Windows-semantics drive (37.2) now scans this story's code") is the investigation and is binding; read it in full. Re-grep by symbol. Re-verified at `4f8c6548` (2026-11-06):

- `plugins/tk-studio/contracts/driver-contract.md` -- header line 5 at **0.1.33**; 37.1's paragraph :2413, 37.2's :2444, DW-170's `**0.1.33 (DW-170, hole 111, additive).**` :2479, `## 8. Conformance` :2495.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 37.2's test ends ~:3210 (Stories regex `Story 37\.1, Story 37\.2(, Story 37\.\d+)* \(Epic 37\)`); DW-170's test :3212 pins `0.1.33 (DW-170, additive)` once, after 37.1's clause, ending `— additive) |`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-148 :1237, DW-157 :1309, DW-161 :1341 (all `status: open`).
- `apps/supervisor/src/worktree.ts` (`COPIED_RUNTIME`, `materialise`, `sweepEngines`, `closeOut`, `launchedCloseOutInput`), `closeout.ts` (`closeOutLanded`, `StopInForce`, `gracefulStopInForce`, `noteStoryBoundary`, `endAtBoundary`, `armStop`, `isRunEpic`), `cli.ts` (`studioRunEnder`, `cancelQueueRun`), `jobrun.py evaluate_stop`, `plansync.py stage_from_pass`, `meter._session_usd`, `report.py rollup`, `task-planning.md` §3 ("do not split it here"), `kb/bmad-base-patches.md`, runbook hole-106 row -- per the plan.
- bun: `~/.bun/bin/bun` 1.4.3 is present here (not on PATH): run with `PATH="$HOME/.bun/bin:$PATH"`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/worktree.ts` -- policy override in `materialise` after the copy; paused leg on a clean tree + ready-on-green in `sweepEngines`/`closeOut`; dirty skip -- AC1.
- `apps/supervisor/src/closeout.ts` -- `arming-refused` source, boundary end and line in `closeOutLanded` -- AC3 (DW-161).
- `apps/supervisor/src/cli.ts` -- cancel's `--total-cost-usd` -- AC3 (C6).
- `plugins/tk-studio/lib/jobrun.py` -- `max_runs` count skips `own_block` -- AC3 (DW-157).
- `plugins/tk-studio/lib/plansync.py` -- `stage_from_pass` backfill of unrecorded earlier sessions -- AC2.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md` + `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md` -- §3 split rule, identical -- AC2.
- `kb/bmad-base-patches.md` -- `## run-worktree-rollback (2026-11-06)` section ("a policy setting the engine already implements, not a registered patch") -- AC1.
- `plugins/tk-studio/contracts/driver-contract.md` -- clause, Stories row, paragraph as in Always -- AC3.
- `kb/agent-pc-setup-runbook.md`, `deferred-work.md` -- hole-106 fixed; DW-148/157/161 resolved.
- Tests: `worktree.test.ts` (materialise byte-equality cases now differ by the one line; paused-path assertions flip; add paused-green-ready, paused-dirty-draft), `closeout.test.ts` (DW-161 case, `ok: true` control), `api.test.ts` (cancel finish args gain `--total-cost-usd`), `test_jobrun.py` (`max_runs` with an own-block run), `test_stage_log.py` (timeout pass + retry pass, both rows, `_session_usd` backfill; rollup counts a `timeout` row), `test_planner_rules.py` (split-rule phrases; old sentence gone), `test_driver_contract.py` (the 37.3 test).

**Acceptance Criteria:** AC1-AC3 above, each proven by the tests listed plus the gate.

## Spec Change Log

## Design Notes

The contract placement keeps all 0.1.32 Epic 37 clauses contiguous and DW-170's clause last, as the 37.2/DW-170 merge (`ed716d24`) did; adding to the 0.1.32 entry under a 0.1.33 header is the story's "(0.1.32, additive)" read literally, not a bump.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` (with bun on PATH; includes `e2e_windows_semantics`)
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger` -- expected: OK
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bun test --timeout 30000` -- expected: 0 fail; `bunx tsc --noEmit` clean

## Deviation Summary

### pass 1 (2026-11-06, implementer)

- planned: the materialise byte-equality tests change by "the one line" / actual: fixtures' policies have no `[scm]` table, so the edit appends `\n[scm]\nrollback_on_failure = true\n`; a policy with the key gets a one-line value change (new test) / why: fixture shape / may affect: none
- planned: paused-path assertions :358, :755, :865 flip / actual: :755 and :865 flip; :358 keeps `--draft` and `verbs == []` (its pause leg is skipped, host tier, not green), with an added assertion that the leg ran and `Legs: 1` → `Legs: 2` / why: ready only on a leg that ran green / may affect: none
- planned: `verify.skipped: "paused: dirty tree"` / actual: `{skipped: true, reason: "paused: dirty tree"}`, the existing skipped-leg shape / why: the skipped-leg type / may affect: none
- planned: only the paused-leg changes in `sweepEngines`/`closeOut` / actual: `recordedVerify` also ignores a `host-verify` recorded before the latest `paused` event / why: the pause's leg must not vouch for the engine's later end / may affect: none
- planned: update the `test_planner_rules.py` pin of the :84 sentence / actual: no such pin existed; a new test pins the split-rule phrases and the old sentence's absence / why: nothing to update / may affect: none
- planned: new `test_stage_log.py` cases only / actual: the existing Fix-8 test now expects a backfilled `("gate", "2")` row / why: it pinned the absence of a row the backfill now writes / may affect: none
- planned: cancel cost = `launchedCloseOutInput(...).costUsd` / actual: same, with `workerOnly` for a sweep / why: a sweep's priced engine has its own ledger line (double count) / may affect: none
- planned: full `bun test --timeout 30000` 0 fail / actual: 2 fails in `test/guards.test.ts` (untouched file; sandbox argv order under this shell's `TK_ATLASSIAN_AGENT_*`); the orchestrator reproduced the same 2 fails on the baseline `4f8c6548` in a temporary worktree — pre-existing, environmental / may affect: none

DEVIATION SCORE: 1

DRIFT: materialise fixtures gain an appended `[scm]` table, not a one-line change — the fixture policies carry no `[scm]` table — affects: none
DRIFT: the :358 paused fixture stays a draft (its leg skipped by the host tier) — ready only on a leg that ran green — affects: none
DRIFT: the dirty skip uses the skipped-leg shape `{skipped: true, reason: "paused: dirty tree"}` — the existing type — affects: none
DRIFT: `recordedVerify` ignores a leg recorded before the latest pause — a pause's leg must not vouch for the engine's end — affects: none
DRIFT: a new planner-rules test instead of an updated pin — no pin existed — affects: none
DRIFT: Fix-8 stage-log test now expects the backfilled gate row — the backfill writes it — affects: none
DRIFT: a sweep's cancel cost is worker-only — its engine has its own ledger line — affects: none
DRIFT: `guards.test.ts` 2 fails in this shell — pre-existing on the baseline, environmental — affects: none

### pass 2 (2026-11-06, review patches)

- planned: patch 3 changes only the paused existing-PR branch / actual: every paused, non-green close-out that finds an open PR calls `gh pr ready --undo` then `gh pr edit` (a no-op undo on a draft); the P1 adopted-PR test now expects `list, ready --undo, edit` / why: the close-out cannot tell whether the open PR was made ready at an earlier pause / may affect: none (consult: sweeps never reach this branch, `paused = … && !sweep`)
- planned: contract additions for patches 5 and 6 only / actual: the 37.3 paragraph also states the undo rule, the cancel-cost fallback to the worker `accounted` figure and the single `cancelCostUsd` rule, all pinned / why: contract-visible behaviour of the same paragraph / may affect: none
- note: `deferred mint` wrote `.tk-studio/plan-counter.yaml` and the ledger marker for DW-176 (gate note: expected, not a Files deviation)

DEVIATION SCORE: 1

DRIFT: a paused non-green close-out with an open PR undoes ready and regenerates the body — the close-out cannot tell an earlier green pause made it ready — affects: none
DRIFT: the 37.3 contract paragraph also states the undo rule and the cancel-cost fallback — contract-visible behaviour — affects: none
DRIFT: `treeClean` ignores uncommitted changes under `<prefix>_bmad-output/` (the engine's `_protected_relpaths` rule), and a paused slice run's leg runs without the assets step (the 03:12Z ruling); the contract's 37.3 paragraph states both and describes the policy edit accurately — without the first the paused leg would almost never run (AC1); the second keeps the paused tree clean — affects: none (follow-up review pass, consult 03:35Z accept score 1)
DRIFT: the planner prose routes a `<key>-s2` entry to `plans/<N>-<M>-s2.md` in §1 relaunch, §2 Audit, §2 Next story and §3 (both copies) — the §3 split rule named the second plan only there, so the follow-on would read or overwrite the first half's plan — affects: none (follow-up review pass, consult 03:35Z accept score 1)

### pass 3 (2026-11-06, follow-up review 2 patches)

- planned: a backfilled session uses only its own transcript and journal span / actual: same, and it also skips the run dir's shared `transcripts/<task_key>/<task_id>/subagents` copy when sessions share the task id (`_subagent_transcripts` accepts `copy_dir=None`) / why: that copy is keyed by task id, so it holds the retry's helper transcripts, which would be counted twice (P1's defect class) / may affect: none
- planned: `materialise` writes the table into a worktree with no policy / actual: same; `withRunWorktreeRollback("")` now returns `[scm]\nrollback_on_failure = true\n` with no leading blank line (non-empty input byte-identical) / why: a missing policy is written as exactly that table / may affect: none

DEVIATION SCORE: 1

DRIFT: a backfilled session skips the task-keyed shared subagent copy when sessions share the task id — it would count the retry's helpers twice — affects: none (consult 03:56Z accept score 1)
DRIFT: `withRunWorktreeRollback("")` drops the leading blank line — a missing policy is written as the bare `[scm]` table — affects: none (consult 03:56Z accept score 1)

## Consult Log

- 2026-11-06T02:33Z — trigger: deviation-gt-0 — question: accept the implementer's eight score-1 deviations (dirty-skip shape, recordedVerify pause boundary, sweep workerOnly cancel cost, gate-row backfill, fixture adjustments, baseline guards.test fault)? — ruling: accept-deviation score 1 — do: keep all eight as implemented; leave the skipped-leg shape, the recordedVerify boundary, workerOnly and the backfilled gate row; carry guards.test.ts 2/58 as a baseline fault (fails on 4f8c6548), not fixed here — rule candidate: in plan text write a skipped leg as `host-verify {skipped: true, reason: "<text>"}`, never `verify.skipped: "<text>"`; a pinned test asserting a missing row a Settled shape now writes may be flipped as a score-1 change
- 2026-11-06T03:04Z — trigger: deviation-gt-0 — question: accept the pass-2 undo-on-every-non-green-pause and the extra contract statements? — ruling: accept-deviation score 1 — do: keep the patch (markPrDraft then editBody, draft only once the undo answers); correct the note: sweeps never reach the branch (`paused = … && !sweep`, worktree.ts:1188) and take the 36.3 killed branch; keep the P1 call list and the 0.1.32 pins — rule candidate: any close-out branch that can leave an existing PR not vouched for by a green leg calls markPrDraft and sets `draft` only once the undo answers
- 2026-11-06T03:12Z — trigger: high-severity-finding (follow-up review, two readings) — question: a clean paused slice run's leg runs greybox/match into the paused worktree while the proof commit is skipped (worktree.ts:771, :1212-1215): code leg only, commit the proof on a pause, or skip the leg? — ruling: apply — do: on a paused slice run call `hostVerify` with no slice option (code leg only; green flips the PR ready, red/inconclusive/skipped keep the draft and undo path); keep `!input.paused` in the proof-commit guard so the slice proof stays with the final close-out; add a worktree test (clean paused slice run: no assets verb, tree still clean, PR ready on green) and log a score-1 deviation — rule candidate: a close-out leg on a tree the engine will resume never writes into that worktree; any step that does (slice assets/proof) runs only at the engine's final close-out
- 2026-11-06T03:35Z — trigger: deviation-gt-0 — question: accept the follow-up pass's two score-1 deviations (treeClean ignores `<prefix>_bmad-output/**` and a paused slice run's leg is the code leg only, with the contract text; the `-s2` plan routed at every planner lookup)? — ruling: accept-deviation score 1 — do: accept D1 and D2 as written; log both in the Deviation Summary; keep the worktree.test.ts `_bmad-output` clean/dirty case and the test_planner_rules.py pins as the proof — rule candidate: read an undefined tree-state word ("clean", "dirty") the way the engine does (`_protected_relpaths`); apply a new derived artifact path (`-s2`) at every place the same prose looks the artifact up

- 2026-11-06T03:56Z — trigger: deviation-gt-0 — question: accept follow-up pass 2's two score-1 deviations (the backfill skips the task-keyed shared subagent copy when sessions share the task id; `withRunWorktreeRollback("")` drops the leading blank line)? — ruling: accept-deviation score 1 — do: accept D1 and D2 as they stand, both score 1, no revert or relaunch; log each in the deviation list in the planned/actual/why/may-affect form — rule candidate: in plansync backfill, any run-dir artifact keyed by task id (transcript copies, subagent copies, journal spans) must be split per session (by session id or by ordinal) before it is counted, or skipped when sessions share the task id; a fix that does this is a score-1 deviation that needs no consult

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-02T21:12:24Z | 2026-11-02T21:26:53Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-05T23:38:45Z | 2026-11-05T23:39:45Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-06T02:08:30Z | 2026-11-06T03:05:15Z | 786dd586-1f82-4aaf-b152-21fad1306fb6 | claude-opus-5-5 | medium | 28284532 | 159299 | 13.9836 | completed |
| review | 1 | 2026-11-06T03:05:16Z | 2026-11-06T03:36:28Z | 9cdbf38f-de05-4760-9d95-d77e7e05cb3b | claude-opus-5-5 | medium | 12847686 | 104608 | 8.4080 | completed |
| review | 2 | 2026-11-06T03:36:28Z | 2026-11-06T04:04:13Z | dace38a0-74ac-494a-9800-6e49f4f888de | claude-opus-5-5 | medium | 7950496 | 82136 | 6.0554 | completed |
| gate | 1 | 2026-11-06T04:04:14Z | 2026-11-06T04:07:20Z | 2242f957-47db-48ec-a8ef-e2eaae9aaf15 | claude-opus-5-5 | medium | 2051736 | 15587 | 1.4335 | completed |
| host-leg | 1 | 2026-11-06T04:08:22Z | 2026-11-06T05:05:19Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-11-06T05:05:19Z | 2026-11-06T05:05:26Z | — | — | — | — | — | — | PR |
| merge | — | 2026-11-06T05:07:12Z | 2026-11-06T05:07:12Z | — | — | — | — | — | — | merged |

## Review Triage Log

### 2026-11-06 — Review pass

Both layers ran (band L): blind-hunter 11 findings, edge-case-hunter 4 (3 duplicated blind-hunter's).

- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 3, low 5)
- defer: 0
- reject: 3
- addressed_findings:
  - `[medium]` `[patch]` a cancelled run with no `launched` figure carried no cost: `cancelCostUsd` falls back to the worker's `accounted` figure (api test 0.75)
  - `[medium]` `[patch]` the recover/late cancel enders (`endCancelledLeftovers`, `recordMinted`, the cancelled-meanwhile end) carried no cost: all now use `cancelCostUsd` (api tests)
  - `[medium]` `[patch]` a PR made ready at a green pause stayed ready at a later non-green pause: `markPrDraft` + body edit, `draft` only once the undo answers (worktree tests: dirty, red, failed undo, sweep-level two-pause case)
  - `[low]` `[patch]` the give-up end of an arming-refused run read "under a graceful stop": `boundaryThrew` takes the stop, `boundaryEndOf` (closeout test)
  - `[low]` `[patch]` the `story-boundary` event claimed `graceful_stop: "kept"` for a refused arming: now `"arming-refused"`; contract states it, test pins it
  - `[low]` `[patch]` the contract promised a backfilled row for every earlier session: it now states the skip of a session with no id or start stamp
  - `[low]` `[patch]` assertion gaps on contract-named behaviour: green pause on an open draft (`gh pr ready`, `gh pr edit`), a sweep cancel's worker-only cost, the backfill's transcript branch figures
  - `[low]` `[patch]` DW-148 closed with its issue-block remainder unbuilt: the remainder filed as DW-176 (`status: open`, minted through `plansync.py deferred mint`), DW-148 names it
- rejected (one line each):
  - contract version "should be 0.1.34": the story's AC3 names "(0.1.32, additive)" and DW-170's pinned test keeps its 0.1.33 clause last; the Design Notes record the placement
  - the split rule's units, "append" and "the halt consult's split candidates": the rule transcribes AC2's own wording, which is the intent authority
  - possible missing imports in `cli.ts`: `bunx tsc --noEmit` is clean

### 2026-11-06 — Review pass (follow-up)

Both layers ran (band L): blind-hunter 5 findings, edge-case-hunter 1; no duplicates.

- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 3, low 3)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` `treeClean` counted the engine's protected BMAD artifact folders as dirt, so an escalation pause (its spec / stage buffer uncommitted under `_bmad-output/`) would skip the leg and never open the PR ready on green — `treeClean` now excludes `<prefix>_bmad-output/**` (bracket pathspec, prefix through `globLiteral`); test: a `_bmad-output`-only change reads clean and the PR opens ready, a code file reads dirty
  - `[medium]` `[patch]` a clean paused slice run's leg ran `greybox`/`match` into a worktree the engine resumes while the proof commit is skipped on a pause — per the consult ruling the paused slice leg is the code leg only (`slice && !paused`), the proof stays with the final close-out; test: no assets verb, tree still clean, PR ready on green; contract sentence added
  - `[medium]` `[patch]` a split `<key>-s2` entry had no route to `plans/<N>-<M>-s2.md` (§2 "Next story" would refresh and overwrite the first half's plan) — both task-planning.md copies now route the `-s2` entry to its own plan in §1, §2 Audit, §2 Next story and §3; pinned in `test_planner_rules.py`
  - `[low]` `[patch]` the contract-named cancel-cost ends `mirror`'s cancelled-meanwhile end and the cancel's late re-read were unasserted — two api.test.ts cases (both already wired; `cli.ts` unchanged)
  - `[low]` `[patch]` a paused close-out on an existing PR with an inconclusive leg or `killed: true` (the final `else` branch) was unasserted — worktree.test.ts case: `gh pr ready --undo`, body regenerated, `draft: true`
  - `[low]` `[patch]` `kb/bmad-base-patches.md` and the contract called the policy edit "one line" though a policy without `[scm]` gets the table appended — both reworded; the 37.3 contract test pins the new phrase and the absence of "one line edited"

### 2026-11-06 — Review pass (follow-up 2)

Both layers ran (band L): blind-hunter 9 findings, edge-case-hunter 3 (all 3 duplicated blind-hunter's: the policy gate, the paused leg's working tree, the `-s2` glob). Each layer read the diff from a file (`git diff 4f8c6548`, the spec, plan counter and run journal excluded; the contract's 60 KB header line condensed to its one inserted span), not inline.

- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 1 (medium 1)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` `_backfill_rows` gave a backfilled session a same-task retry's transcript (the meter fallback, newest first) and the task's last journal span, so a timed-out row whose own transcript is gone took the retry's tokens, cost and times — now the session's own transcript only (`_session_transcript`: its recorded path, its same-named copy, or a meter path whose stem is its session id) and its own journal pair by ordinal (`_journal_spans`), else its transcript span; the shared subagent copy is skipped when sessions share the task id; two test_stage_log.py cases (both red on the committed code)
  - `[low]` `[patch]` `materialise` applied the rollback only when it copied a policy, so a checkout with no `.bmad-loop/policy.toml` left the run worktree on the engine default `rollback_on_failure = false` — the override now always runs: it edits the worktree's policy, or writes the bare `[scm]` table when there is none (a refused write removes a new file, restores an old one); worktree.test.ts no-policy case; one contract sentence
- deferred (DEFERRAL DISCIPLINE (a), a defect in behaviour AC2 names):
  - the split's `<key>-s2` story spec matches the first half's `<key>-*.md` prefix glob (`plansync._stage_target` raises "several specs match", `closeout.findSpec` returns undefined, and the engine resolves a spec by `<id>-*.md`) once both specs exist — the id shape is the plan's Settled shape 3 and the existing `<key>-r<n>` remediation ids share the collision; the engine's glob is outside this repo, so a studio-side fix is partial
- rejected (one line each):
  - contract label `0.1.32` "should be 0.1.34": AC3 names "(0.1.32, additive)"; the Design Notes record the placement (rejected in pass 1 too)
  - editing the copied policy "dirties a tracked policy": `COPIED_RUNTIME` is excluded from `treeClean` and `wipCommit` staging (`ENGINE_STATE`), the engine's `safe_rollback` always restores `policy.toml`, and the copy already overwrote it before this story
  - the paused leg "tests the working tree, not the landed commits" (both layers): the completed-run leg (27.4) runs on the same worktree the same way, and reading `_bmad-output/**` as clean was accepted in the 03:35Z consult
  - "a deferred final attempt never gets its `timeout` row": the engine fires `post_session` for every session (engine.py :3657-3663), so the attempt's own hook writes the row; the backfill only restores a lost one
  - "the backfill reaches beyond timeouts / duplicates `—` rows": backfilling every unrecorded session by id is Settled shape 3; sessions with no id are skipped, and the engine's sessions in one run always carry the id their rows record
  - DW-157/DW-161 lack a `resolution:` line: the orchestrator owns the ledger's status and resolution; this session never edits its entries

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-37-20261106T020707Z-6da367` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Second follow-up review pass on the done story (pass 2's recommendation). The story's behaviour stands as committed in `b03d18db` and `91180638`. This pass patched two findings. A backfilled Stage Log row now uses only its own session's transcript and journal span, so a timed-out attempt's row never takes a same-task retry's tokens, cost or times. The run worktree's policy now always reads `[scm] rollback_on_failure = true`, including when the checkout has no policy. One finding was deferred to the spec's `deferred` list: the `<key>-s2` spec glob collision, which the `<key>-r<n>` ids share and the engine's own glob also hits. The deferred-work ledger was not touched.

**Files changed (this pass):**
- `plugins/tk-studio/lib/plansync.py`: `_journal_spans` pairs each session with its journal span by ordinal, `_session_transcript` finds only the session's own transcript, and `_backfill_rows` uses both. The shared subagent copy is skipped when sessions share a task id. `_subagent_transcripts` accepts `copy_dir=None`.
- `plugins/tk-studio/lib/tests/test_stage_log.py`: two cases for a retry in the same task, one checking the transcript and one the journal pair.
- `apps/supervisor/src/worktree.ts`: `materialise` always runs `runWorktreeRollback`, which writes the bare `[scm]` table when there is no policy. A refused write removes a new file and restores an old one. `withRunWorktreeRollback("")` returns the table alone.
- `apps/supervisor/test/worktree.test.ts`: a case for a checkout with no policy, plus the empty-input edit shape.
- `plugins/tk-studio/contracts/driver-contract.md`: one sentence in the 37.3 paragraph covering a policy that was not copied or is missing. The header stays `0.1.33`.

**Review findings:** 2 patched (medium 1, low 1), 1 deferred (medium), 6 rejected.

**Follow-up review recommendation:** false. Patched high 0, medium 1, low 1; score 3 × 1 + 1 × 1 = 4.

**Verification:**
- `uv run python -m unittest discover tests` (lib): 2888 tests, OK (skipped=4)
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, 0 failures (bun on PATH)
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger`: 95 tests, OK
- `bun test --timeout 30000` (apps/supervisor): 1938 pass, 2 fail. Both failures are the `test/guards.test.ts` sbx argv cases, the baseline environmental fault accepted in the 02:33Z consult (they also fail on `4f8c6548`).
- `bunx tsc --noEmit`: clean

**Residual risks:**
- `worktree.ts` runs inside `serve`. The operator stops the supervisor tab before `apps/supervisor` is built, and restarts it through the scheduled task after the merge (unverifiable-here).
- The Windows host leg is unverifiable here. The operator runs `uv run tools/verify_host.py` on the host before the merge.
- Deferred: the `<key>-s2` spec glob collision (see frontmatter `deferred`). The engine's `<id>-*.md` glob is outside this repo.
- In a project that commits `.bmad-loop/policy.toml`, the edit leaves the file modified in the run worktree. The copy already did that before this story. `treeClean` and `wipCommit` exclude it, and the engine's rollback restores it.
- The 2 environmental failures in `guards.test.ts` are pre-existing and not fixed here.

DRIFT: a backfilled session skips the task-keyed shared subagent copy when sessions share the task id — it would count the retry's helpers twice — affects: none
DRIFT: `withRunWorktreeRollback("")` drops the leading blank line — a missing policy is written as the bare `[scm]` table — affects: none

## Reconcile

- 2026-11-06 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 37-4-the-status-edges-and-the-rhythm-for-every-job
