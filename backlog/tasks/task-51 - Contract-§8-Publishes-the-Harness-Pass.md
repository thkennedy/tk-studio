---
id: TASK-51
title: Contract §8 Publishes the Harness Pass
status: In Progress
assignee: []
created_date: '2026-08-09 10:07'
updated_date: '2026-08-09 10:22'
labels:
  - ST-051
milestone: Denied Permissions Refuse Loudly
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a driver author consuming the contract,
I want §8 to describe the harness-drive check class and its opt-in spend posture,
So that a conforming driver knows the suite can reach through it and what a passing refusal looks like.

**Acceptance Criteria:**

**Given** the contract after 14.1 and 14.2 land
**When** §8 is read
**Then** it describes the harness-drive check class, the opt-in posture, and the denied-permissions case; the version history names 0.1.11 as an additive bump; the §2 surface table is untouched

**Given** the lib suite
**When** it runs
**Then** the contract pin test asserts 0.1.11 and the contracts README row moves in the same commit — version, pin test, and README in lockstep

**Given** the suites at the epic's close
**When** lib unit and conformance run and the drift check runs on a healthy machine
**Then** both suites are green and all four planes report clean
<!-- SECTION:DESCRIPTION:END -->
