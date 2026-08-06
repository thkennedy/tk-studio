---
id: TASK-29
title: Session Discipline
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-08-06 18:43'
labels:
  - ST-029
milestone: Work Runs While Nobody Watches
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want long work to split at boundaries with compact handoffs and resumable workspaces,
So that a fresh session continues without replaying history or blowing budgets.

**Acceptance Criteria:**

**Given** a multi-session workflow reaching a declared boundary (epic/story/phase) or its token budget
**When** the boundary triggers
**Then** a compact handoff artifact is written to the run workspace and the session is directed to end and resume fresh

**Given** a fresh session pointed at a run workspace
**When** it resumes
**Then** work continues from the handoff + workspace state alone (success criterion 8), verified by an integration test on a seeded workspace
<!-- SECTION:DESCRIPTION:END -->
