---
id: TASK-5
title: tk report — Human Defect Reports
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-005
milestone: Install Once, Stay in Lockstep
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want a one-verb way to record "the skill did the wrong thing,"
So that human-observed defects enter the same measurement stream as telemetry.

**Acceptance Criteria:**

**Given** an operator invoking `tk-studio-report` with a free-text description
**When** the skill runs
**Then** a `report` event lands in the local ledger carrying description, suspected surface, and context (project, skill, session mode)
**And** the flow works identically attended (prompted elaboration) and headless (payload-supplied), per AD-11
<!-- SECTION:DESCRIPTION:END -->
