---
id: TASK-78
title: Paired Runs on The Universe Awaits
status: To Do
assignee: []
created_date: '2026-09-28 02:40'
labels:
  - ST-078
milestone: Opus 5.5 Earns Its Legs, Measured
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the same stories run under both routes from the same base,
So that cost and speed are compared on identical work in the project the baseline came from.

**Acceptance Criteria:**

**Given** the engine home on this box (Story 23.1) and two throwaway branches cut from one recorded TUA `main` commit, `throwaway/route-v2` and `throwaway/route-o55`
**When** stories `2-1-keyed-month-thread-scheduler` and `2-2` (in `spec-epic-2` order) run on each branch, with the shipped defaults on `route-v2` and Opus 5.5 on every leg on `route-o55`, through runtime overrides or a branch-local `routing.toml` (never on `main`)
**Then** each story on each arm has a Story 24.1 record

**Given** the four records
**When** the arms are compared per story
**Then** the kb trial record states, per story and in total, the dollars (split by leg), wall-clock, attempt-1 landing, review findings raised, and weekly plan-usage points; it notes that n = 2 is directional, not significant; and neither branch merges anywhere
<!-- SECTION:DESCRIPTION:END -->
