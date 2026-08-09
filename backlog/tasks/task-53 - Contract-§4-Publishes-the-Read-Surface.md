---
id: TASK-53
title: Contract §4 Publishes the Read Surface
status: Done
assignee: []
created_date: '2026-08-09 20:03'
updated_date: '2026-08-09 20:17'
labels:
  - ST-053
milestone: The Resolved-Definition Read Surface
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a driver author consuming the contract,
I want §4's verb table to carry resolve with its read-only resolved-definition semantics,
So that a conforming driver classifies recurring work from the contract surface and never re-implements type extension.

**Acceptance Criteria:**

**Given** the contract after 15.1 lands
**When** §4 is read
**Then** the verb table carries resolve — request, response, and read-only semantics naming type extension as studio-side, drivers never merge — the §2 tk-studio-job row names the verb, and the version history names 0.1.12 as an additive bump

**Given** the lib suite
**When** it runs
**Then** the contract pin test asserts 0.1.12 and the contracts README row moves in the same commit — version, pin test, and README in lockstep

**Given** the suites at the epic's close
**When** lib unit and conformance run and the drift check runs on a healthy machine
**Then** both suites are green and all four planes report clean
<!-- SECTION:DESCRIPTION:END -->
