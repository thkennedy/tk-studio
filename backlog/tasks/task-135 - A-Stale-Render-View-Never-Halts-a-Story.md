---
id: TASK-135
title: A Stale Render View Never Halts a Story
status: To Do
assignee: []
created_date: '2026-10-26 16:40'
labels:
  - ST-135
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want the supervisor to recognise the one halt that is the sandbox's stale view of a freshly rendered skill snapshot and resume by itself,
So that a story does not wait on an operator for a file that is already there (hole 65).

**Acceptance Criteria:**

**Given** a run paused on a CRITICAL escalation whose reason says the skill render failed and names the snapshot folder under `_bmad/render/`
**When** the paused-run pass runs and the host sees that folder complete (every file the manifest names is present and non-empty)
**Then** the pass removes the snapshot folder and the dev session's untracked `blocked` spec draft, resumes the run once (`POST /runs/{id}/resume`'s path), records `auto-resume {reason: stale-render-view, snapshot, attempt: 1}` and notifies one line; a second such pause on the same story is left for the operator with the reason naming the first attempt; the upstream skills are untouched (no fork)

**Given** the pass
**When** it is tested
**Then** `bun test` covers the recognition (the reason text, the folder check), the single-attempt rule and the untouched other pauses with fixtures; the runbook's hole-65 row names the behaviour
<!-- SECTION:DESCRIPTION:END -->
