---
id: TASK-19
title: Evolve — Observe and Log
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-07-27 06:30'
labels:
  - ST-019
milestone: The Studio Knows Your Project
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want repeated manual toil and retrospective signals logged as observations,
So that the future evolve loop has real data without v1 building proposal automation.

**Acceptance Criteria:**

**Given** an observation source (retrospective output, repeated-manual-work note, research-job finding)
**When** an observation is recorded
**Then** an `observation` event lands in the measurement ledger with source, project, and a structured description
**And** no automated proposal or skill drafting is triggered (v1 boundary, AD-8)
<!-- SECTION:DESCRIPTION:END -->
