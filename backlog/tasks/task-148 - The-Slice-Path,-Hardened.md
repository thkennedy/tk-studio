---
id: TASK-148
title: The Slice Path, Hardened
status: To Do
assignee: []
created_date: '2026-10-27 23:26'
labels:
  - ST-148
milestone: Loop Hygiene 2, the Slice Path Hardened
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want the slice's host leg to fail for the right reasons and keep its proof: a wall-clock margin between the leg's guard and the tools' own, `match` judged by its status block, no `.candidates/` or ignored file staged, the contact sheet sampled from the report's frames, the proof committed whenever a report exists, the drives' bounds under the runner's cap, the Windows tree-kill tested where it runs, the judge's infrastructure failures `inconclusive` and its rubric ids in one place,
So that a slice run's red means the game or the asset, never the box (DW-94: the retrospective's B1 to B4, B8, B12, B13; DW-88, DW-89; AI-2).

**Acceptance Criteria:**

**Given** the slice host leg
**When** a tool overruns or fails
**Then** the leg's guard is the tool's own `--wall` plus a margin (`hostverify.ts:547-549, :445`; `assets.py:172`), so the tool's kill writes its report and the leg reads `wall-clock` from it; a crashed, `not-run` or write-back-failed `match` is `fault` from the status block's `reason`, `writeback` and `not-run` fields, red (`hostverify.ts:449`; `assets.py:1917-1923`); `proofCommit` runs `git check-ignore` and stages the art path without `.candidates/` (`worktree.ts:461-465`); the proof folder is committed whenever `report.json` exists, a `skipped: no manifest` assets step included (`worktree.ts:547`)

**Given** `playable.py sheet` and the conformance drives
**When** they run
**Then** `sheet --report` samples from the report's `frames[]`, the judge's citable set, never every movie frame (`playable.py:756-757`); `e2e_vertical_slice.py` and `e2e_engine_gate.py` assert their bounds under `runner.py`'s cap or raise it through the manifest's `timeout` (DW-70 closed with them); the nt `taskkill /T /F` path of `kill_tree` is tested on nt (`test_playable.py:666`, `test_assets.py:865`)

**Given** the judge
**When** the pin, `sbx exec` or the status block fails
**Then** `playable.verdict: inconclusive` names the infrastructure reason and the run ends `partial` without a rubric fail (`hostverify.ts:426, :619-630`); the rubric ids live in the core's list, read by the supervisor and pinned to the skill's text by a test (`hostverify.ts:478`, `playable_judge.py:51-60`, `skills/tk-studio-playable-judge/SKILL.md:38-42`); the contract (0.1.30, additive) names `inconclusive`; DW-88, DW-89 and DW-94 close by this PR
<!-- SECTION:DESCRIPTION:END -->
