---
id: TASK-26
title: First Maintenance Job — Scheduled Conformance
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-026
milestone: Work Runs While Nobody Watches
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want the conformance suite runnable as a recurring maintenance job,
So that dual-mode parity is re-proven continuously without me remembering to run it.

**Acceptance Criteria:**

**Given** the conformance suite (5.4) and the job model (6.1)
**When** the shipped `maintenance-conformance` job type is instantiated on a project
**Then** it runs the suite on its declared cadence within budget, emits results as measurement events, and produces a run summary in the run workspace
<!-- SECTION:DESCRIPTION:END -->
