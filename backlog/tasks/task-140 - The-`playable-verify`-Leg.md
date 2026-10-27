---
id: TASK-140
title: The `playable-verify` Leg
status: Done
assignee: []
created_date: '2026-10-27 04:08'
updated_date: '2026-10-27 10:53'
labels:
  - ST-140
milestone: The Vertical-Slice Pack
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want a routed leg that runs the scenario on the host after the engine gate, has a model judge the frames by a screenshot-only rubric, and writes the verdict where the owner reads it,
So that "it builds" and "it plays" are two different greens (the research's own finding: nobody one-shots game feel; verify from the runtime).

**Acceptance Criteria:**

**Given** a project config that declares `playable: {scenario: <file>, seed: <n>, ticks: <t>}` (additive)
**When** the host leg's engine gate is green
**Then** the host leg runs 34.2's `playable.py run` in the worktree, writes the media under the run workspace (`~/.tk-studio/runs/<run>/playable/`) and the worktree's ignored `.bmad-loop/runs/<engine>/playable/`, then drives the judge: a `claude -p` session on the project's sandbox tier (`sbx exec`, the plugin's `tk-studio-playable-judge` skill, routed by `[pipeline.legs] playable-verify` with its own `model` and `effort` through `pipeline.py`'s tables) that reads only `report.json` and the frames (never the code or the spec), answers the rubric (the scene loaded; the player is visible and framed; no missing-texture magenta and no error overlay; the HUD reads; the scenario's named moments appear in the frames they name) with `verdict: pass | fail` and `findings[]` each naming a frame and a rubric line, and ends in a status block; the `host-verify` event carries `playable: pass | fail | skipped` and the findings

**Given** a `fail`
**When** the close-out continues
**Then** the run ends `partial` with `host_verify: red (playable)`, the PR body carries the findings and the frames' paths, the inbox gets the line, and 33.8's `verify` re-runs the leg after a fix; `pass` lets the PR go ready; a project without `playable` is `skipped` and unchanged

**Given** the suites
**When** they run
**Then** `bun test` covers the ordering, the event, the PR body and both verdicts with fakes; the lib suite covers the rubric parsing and the judge's refusals (no frames, a malformed report); conformance adds the skill's roster row and an e2e over a fake judge; contract 0.1.29 names the leg; the leg's cost lands in the ledger's `job-run` as its own line
<!-- SECTION:DESCRIPTION:END -->
