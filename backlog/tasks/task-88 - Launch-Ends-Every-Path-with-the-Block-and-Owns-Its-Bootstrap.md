---
id: TASK-88
title: Launch Ends Every Path with the Block and Owns Its Bootstrap
status: To Do
assignee: []
created_date: '2026-10-15 19:21'
labels:
  - ST-088
milestone: "The Service Owns Lifetime, Part 1: The Studio Side"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want `tk-studio-launch` to end every headless path with the status block, to commit its own bootstrap output, and to check the engine's budget limits against the bands before it starts,
So that a driver never records a missing block for a run that succeeded, a second launch pass is never needed, and no story runs under a policy limit the bands do not cover (holes 10, 20 and 4).

**Acceptance Criteria:**

**Given** a first launch on an epic
**When** the bootstrap writes `SPEC.md`, `stories.yaml` and the first plan
**Then** the launch commits them on the run branch with one named commit message before its readiness check, so the dirty-tree refusal never fires on its own output, and the rule is stated once in the skill text (the Epic 20 and 22 launches needed a second pass; the Epic 24 and 25 launches committed theirs)

**Given** a relaunch on an epic with stories already `done` and routing already applied
**When** the session ends
**Then** its last output is the JSON status block exactly as on the fresh path, the watch hint names the supervisor's status page and the `status` verb and never ClaudeOS, and a conformance drive covers the relaunch case beside the fresh case

**Given** the project's `.bmad-loop/policy.toml` limits (`max_tokens_per_story`, wall-clock, review caps) and the budget bands in `.tk-studio/budget-bands.yaml`
**When** `start` or `check` runs
**Then** the launch result names every limit the bands exceed (band ceiling above the policy limit) as a `budget_mismatch` entry with both numbers, `check` ends `partial` naming them, and `start` refuses to start the engine on a mismatch unless the payload carries `allow_budget_mismatch: true`; the machine-local policy file is never edited by the skill

**Given** the lib suite and conformance
**When** the story closes
**Then** both are green, including the new drives, and the driver contract §2 launch row states the bootstrap commit, the relaunch block and the budget check (0.1.21, additive)
<!-- SECTION:DESCRIPTION:END -->
