---
id: TASK-55
title: Staging Derives from the Response Alone
status: To Do
assignee: []
created_date: '2026-08-10 06:06'
labels:
  - ST-055
milestone: The Sync Result Names Every Written File
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator staging a planning commit from a sync response,
I want the result JSON to name every file the run wrote — counter included,
So that commit staging derives from the response alone and the hand-staged counter gotcha retires.

**Acceptance Criteria:**

**Given** a sync run that mints ids
**When** the result returns
**Then** normalize carries a `counter` object naming the committed counter's path with `written` true, and a `written[]` list naming the counter, every created or repaired entity file, and every stamped story file — and under `--dry-run` the same lists name what the run would write while nothing lands

**Given** a rerun on unchanged data
**When** normalize runs again
**Then** `counter.written` is false and `written[]` is empty — the no-op stays byte-identical and reports nothing written

**Given** the sync verb under a bound backend
**When** projection and index write files
**Then** the sync-level `written[]` aggregates normalize's writes, every projection write the adapters name — jira promote entries gain a `path` so canonical snapshot rewrites are named too — and the index when it changed, deduplicated in write order

**Given** the lib suite and the contract
**When** they run
**Then** the new fields are unit-pinned, §2's plan-sync row states the result names every written file, the version history names 0.1.13 as an additive bump with the pin test and contracts README moving in the same commit, and the full suite is green
<!-- SECTION:DESCRIPTION:END -->
