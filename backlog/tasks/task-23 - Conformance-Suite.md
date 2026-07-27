---
id: TASK-23
title: Conformance Suite
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-023
milestone: One Front Door, Any Mode
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want every studio surface proven headless-clean by a shipped suite,
So that dual-mode parity is a tested guarantee, not a habit.

**Acceptance Criteria:**

**Given** `contracts/conformance/` in the plugin
**When** the suite runs against every shipped studio skill
**Then** each is driven headless (direct invocation), asserting: valid JSON status block, no interactive prompt, auth preflight before any external call, and `blocked` (not a hang) on ambiguity
**And** failures emit `headless-failure` events naming the surface and assertion

**Given** a new studio skill added later
**When** it registers in the plugin
**Then** the suite discovers it automatically (manifest-driven) — unregistered surfaces fail the suite
<!-- SECTION:DESCRIPTION:END -->
