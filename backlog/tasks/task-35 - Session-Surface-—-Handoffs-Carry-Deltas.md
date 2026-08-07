---
id: TASK-35
title: Session Surface — Handoffs Carry Deltas
status: In Progress
assignee: []
created_date: '2026-08-07 04:34'
updated_date: '2026-08-07 05:00'
labels:
  - ST-035
milestone: Research Becomes Knowledge
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a driver author,
I want the session/handoff surface contract-visible with structured deltas,
So that any harness can invoke handoff/resume and corrections survive session boundaries.

**Acceptance Criteria:**

**Given** the `tk-studio-session` skill (new §2 row at 9.6; surface built here)
**When** a handoff is written
**Then** `handoff.json` accepts an optional `deltas[]` (story 9.1 shape), stays within the 16 KB budget (deltas are pointers; list length capped), and one handoff per run overwrites per boundary

**Given** a headless invocation of the session surface
**When** it runs
**Then** it completes with the JSON status block and a conformance manifest row drives it (including a refusal drive: dangling-delta rejection)
<!-- SECTION:DESCRIPTION:END -->
