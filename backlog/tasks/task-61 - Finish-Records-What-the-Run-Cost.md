---
id: TASK-61
title: Finish Records What the Run Cost
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-061
milestone: The Contract Names Its Drivers and Carries Cost
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator measuring unattended runs,
I want `finish` to accept the run's cost and the `job-run` event to carry it,
So that every terminal run lands in the ledger with the dollars it spent.

**Acceptance Criteria:**

**Given** a run finished through `jobrun.py finish` with a cost figure
**When** the terminal transition is recorded
**Then** the `job-run` event payload carries `total_cost_usd` as a non-negative number, the run's `run.json` records the same figure, and there is still exactly one emitter and one event per terminal transition (AD-12)

**Given** a `finish` without a cost figure, as every driver sends today
**When** it runs
**Then** the behavior and the event are identical to 0.1.16: the field is absent, never zero-filled

**Given** a cost argument that is negative, non-numeric, or not finite
**When** `finish` runs
**Then** it refuses with a named error and records and emits nothing — never a guessed value (AD-3)

**Given** `contracts/events/taxonomy.v1.json`
**When** the story lands
**Then** `job-run.payload.total_cost_usd` is declared optional with a note naming its source (the worker's `--output-format json` result), and the lib suite pins the present, absent, and refused cases with the full suite green
<!-- SECTION:DESCRIPTION:END -->
