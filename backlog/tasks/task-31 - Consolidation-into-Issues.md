---
id: TASK-31
title: Consolidation into Issues
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-08-07 04:34'
labels:
  - ST-031
milestone: The Studio Measures and Fixes Itself
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want accumulated measurement PRs consolidated into ledger issues that lead to fixes,
So that the measurement loop actually corrects the system (the O1 revision channel).

**Acceptance Criteria:**

**Given** merged measurement data in `measurements/`
**When** `tk-studio-consolidate` runs
**Then** it clusters events into candidate defects and appends `issues/ledger.md` entries (stable `ISS-NNN`, severity, status, expected-vs-actual, legacy-council row discipline — update in place, never delete)
**And** each new issue names the evidence events and, where clear, a specific fix candidate (including "revise the distribution mechanism" when evidence points there)
<!-- SECTION:DESCRIPTION:END -->
