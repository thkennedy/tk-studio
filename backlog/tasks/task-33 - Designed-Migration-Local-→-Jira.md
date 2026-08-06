---
id: TASK-33
title: Designed Migration Local → Jira
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-08-06 19:51'
labels:
  - ST-033
milestone: Plan Where the Team Plans
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want rebinding a project to Jira to be a verified migration, not a copy,
So that nothing is lost and the local backend remains until I clear it.

**Acceptance Criteria:**

**Given** a project bound locally with canonical planning data
**When** `tk-studio-migrate` runs toward Jira
**Then** it executes export (canonical shape) → transform → import → verification (entity counts, id map, content hashes, spot round-trip) with a closed inventory taken first

**Given** verification passes
**When** cutover happens
**Then** the binding flips copy-then-verify-then-flag (flag last); the local backend stays read-only until the operator explicitly clears it (no-delete-before-clearance)

**Given** any verification mismatch
**When** detected
**Then** migration halts `blocked` with the discrepancy listed; no partial state reads as migrated (AD-16)
<!-- SECTION:DESCRIPTION:END -->
