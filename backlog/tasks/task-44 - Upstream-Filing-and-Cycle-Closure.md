---
id: TASK-44
title: Upstream Filing and Cycle Closure
status: Done
assignee: []
created_date: '2026-08-08 04:22'
updated_date: '2026-08-08 23:18'
labels:
  - ST-044
milestone: Proposal Becomes Change
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want the re-serialization defect drafted for bmad-method and the ledger rows closed with evidence in hand,
So that the root cause travels upstream and the loop's first full cycle is recorded honestly.

**Acceptance Criteria:**

**Given** ISS-001's evidence and the landed normalizer
**When** the upstream artifact is drafted
**Then** a bmad-method issue draft lands as an epic artifact — list re-serialization as the defect with a 6.10.0 `--yes`-reinstall reproduction, the LF rewrite posed as a question — and filing on the upstream tracker happens only on explicit in-session operator go-ahead (D4), never unilaterally

**Given** the implementation evidence (the normalizer, and PROP-003's `3ee9117` + `test_utf8_guard.py`)
**When** the operator closes the cycle
**Then** ISS-001 moves Open→Resolved and PROP-001/PROP-003 gain prose annotations naming the landed evidence — all by operator hand, statuses staying Adopted (the proposals ledger has no implemented state by design; implementation lives in planning records), the machine never editing Impact/Status (AD-12 ownership)
<!-- SECTION:DESCRIPTION:END -->
