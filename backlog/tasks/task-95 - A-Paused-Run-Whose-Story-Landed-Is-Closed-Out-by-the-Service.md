---
id: TASK-95
title: A Paused Run Whose Story Landed Is Closed Out by the Service
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-095
milestone: "The Service Owns Lifetime, Part 2: The Supervisor"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the supervisor to close out a run that paused after its story's work was committed, once a verdict exists,
So that the attended recipe of 2026-10-14 (verdict, harvest commit, meter, archive, relaunch) is the service's job (hole 9).

**Acceptance Criteria:**

**Given** a run that paused at the commit gate or on an escalation with the story's spec at `status: done` and a `reconcile_verdict` other than `escalate` recorded
**When** the supervisor's tick sees it
**Then** it commits the engine's staged harvest on the run branch with a named message, harvests the story's meter observation to the host ledger (Story 26.4's `meter.py harvest`), archives the run (`bmad-loop archive`, through `sbx exec`), relaunches the epic through `tk-studio-launch` (which skips done stories) under the same queue run with a `close-out` event, and never re-implements the story

**Given** the same run with no verdict, or `escalate`
**When** the tick sees it
**Then** it stays paused, one notification names the story and the reason, and the run's page row says "awaiting a ruling"

**Given** a story that halted before any commit
**When** the tick sees it
**Then** nothing is closed out; the run stays paused for the resume path (`bmad-loop resolve`), which the supervisor exposes as `POST /runs/{id}/resume` with an optional restore patch

**Given** the supervisor's test suite
**When** it runs
**Then** all three cases are pinned with a fake engine, on both hosts
<!-- SECTION:DESCRIPTION:END -->
