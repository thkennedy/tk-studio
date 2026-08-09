---
id: TASK-48
title: Release-Discipline Guard
status: Done
assignee: []
created_date: '2026-08-09 05:23'
updated_date: '2026-08-09 06:35'
labels:
  - ST-048
milestone: The Drift Check Tells the Truth
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a maintainer shipping studio surfaces,
I want the repo to go loud the moment the skill roster outruns the version gate,
So that a shipped-but-undelivered surface like the EP-012 three-skill gap cannot recur silently.

**Acceptance Criteria:**

**Given** a committed released-roster record riding the lockstep release motion (version + skill list, third file of the gate)
**When** the lib unit suite runs after `skills/` changes without a version-gate pull
**Then** the suite goes red naming the roster delta — red exactly in the EP-012 gap shape (roster grew, version unchanged), green again when the release motion bumps the gate and roster together

**Given** the drift check's plugin plane
**When** the repo roster disagrees with the released roster at an unchanged version gate
**Then** the plane reports drift with guidance naming the release motion (the lockstep bump), riding the existing planes/fixes shape

**Given** the release commit for this epic
**When** the suites run
**Then** lib unit and conformance suites stay green, and the drift check on a healthy machine still reports all four planes clean
<!-- SECTION:DESCRIPTION:END -->
