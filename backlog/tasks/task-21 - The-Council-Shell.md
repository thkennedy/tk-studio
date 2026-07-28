---
id: TASK-21
title: The Council Shell
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-07-28 03:46'
labels:
  - ST-021
milestone: One Front Door, Any Mode
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator in an attended session,
I want a distinctive persona shell with "convene the council" as its signature interaction,
So that attended sessions feel like a studio while the core stays stateless.

**Acceptance Criteria:**

**Given** an attended orchestrator session
**When** the shell loads
**Then** persona voice and the convene interaction (multi-perspective deliberation over installed agents) come from data assets — no identity state, no sanctum/rebirth machinery (AD-9)

**Given** the same request attended and headless
**When** both run
**Then** routing decisions and produced artifacts are identical; only presentation differs, proven by a comparison test
<!-- SECTION:DESCRIPTION:END -->
