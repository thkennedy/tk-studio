---
id: TASK-39
title: Contract 1.7.0 and the Driver Wiring
status: Done
assignee: []
created_date: '2026-08-07 04:34'
updated_date: '2026-08-07 20:39'
labels:
  - ST-039
milestone: Research Becomes Knowledge
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a harness author,
I want the port's surfaces published in a deliberate MINOR contract bump with the connector driving them,
So that drivers consume the lifecycle through the contract alone (AD-2) and standing deferrals close.

**Acceptance Criteria:**

**Given** driver-contract.md at 1.6.0
**When** the bump lands
**Then** 1.7.0 adds §2 rows for `tk-studio-session` and `tk-studio-knowledge`, the changed `tk-studio-research` row (anchor, seed.md), the §4 run-finish capture note, the KB-injection directive (spine/seed paths named so any driver can inject them — the act stays driver-side), and folds in DW-1 (§4 submit wording) and DW-3 (§6/§8 wording)
**And** `test_driver_contract.py` pins 1.7.0 and new conformance manifest rows cover both new surfaces plus the session-discipline row

**Given** the ClaudeOS connector
**When** its pin bumps to 1.7.0
**Then** `studio-jobs-tick`/`tk_invoke` honor the injection directive, connector tests stay green, and the through-connector conformance suite passes at the new check count (connector milestone)
<!-- SECTION:DESCRIPTION:END -->
