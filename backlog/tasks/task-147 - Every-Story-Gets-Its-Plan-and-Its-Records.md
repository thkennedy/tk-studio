---
id: TASK-147
title: Every Story Gets Its Plan and Its Records
status: To Do
assignee: []
created_date: '2026-10-27 23:26'
labels:
  - ST-147
milestone: Loop Hygiene 2, the Slice Path Hardened
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want the launch bootstrap to write a plan for every story of the epic and refuse a story whose SPEC open questions have no design note, and a resumed run that lands more than one story to write a gate file and a cost line per story,
So that no dev session starts with nothing to build from and no story lands unrecorded (holes 81 and 89; DW-79, DW-83; the retrospective's C4, C5, AI-9).

**Acceptance Criteria:**

**Given** an epic launched with `bootstrap: true`
**When** the bootstrap runs at the planner tier
**Then** `plans/<story>.md` exists for every story in `stories.yaml` in list order (a Code Map and the band each), and a story whose SPEC open questions (`CAP-N`) have no design note is refused with the questions listed (the status block `blocked`, the reason naming the CAPs) before any dev session; the launch's advisory row names the stories still without a plan

**Given** a paused run resumed after an operator answer
**When** the resumed run lands commits for more than one story (the 34.5 shape)
**Then** the gate writes a result file per story and each spec gets its `## Reconcile`, the close-out writes one `job-run` ledger line per story (the cost split by the engine's per-story turns, or one line naming both with the cost) and the PR body lists both; or the supervisor refuses a resume that would cross a story boundary with the reason and the graceful stop re-armed — the planner picks one and the contract names it (0.1.30, additive)

**Given** the lib suite, the supervisor suites and conformance
**When** they run
**Then** the plan-per-story rule, the refusal and the per-story records are covered with fakes; the runbook's rule "never amend after a resume" stays and its row points at this story; DW-79 and DW-83 close by this PR
<!-- SECTION:DESCRIPTION:END -->
