---
id: TASK-79
title: The Verdict Sets the Defaults
status: To Do
assignee: []
created_date: '2026-09-28 02:40'
labels:
  - ST-079
milestone: Opus 5.5 Earns Its Legs, Measured
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the trial's evidence turned into a routing decision per leg,
So that the shipped defaults reflect what was measured, and nothing changes silently.

**Acceptance Criteria:**

**Given** the Story 24.2 and 24.3 records
**When** the verdict is drafted
**Then** each leg gets keep-Opus-5.5, revert, or needs-more-data, with the evidence cited; an `observation` per leg lands in the ledger, and `tk-studio-evolve` mints the proposal, which only the operator adopts

**Given** an adopted proposal
**When** it is applied
**Then** `[pipeline.legs]` in the `tk-studio-launch` `customize.toml` and the kb table change to the adopted route with the trial's numbers, and the release motion ships it with the lib suite and conformance green; the project-tier trial table is then removed from tk-studio's `routing.toml`

**Given** budget left after the paired runs
**When** the verdict keeps Opus 5.5 on the session leg
**Then** one effort probe (session at `low` against `medium`, on one story) is run and recorded before the effort default is set
<!-- SECTION:DESCRIPTION:END -->
