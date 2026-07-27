---
id: TASK-20
title: Role-Aware Orchestrator Core
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-020
milestone: One Front Door, Any Mode
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want one entry point that resolves who I am, what this project needs, and routes,
So that a direction-giver and a developer each get the right workflows from the same door.

**Acceptance Criteria:**

**Given** a per-user store with a role and a project with a confirmed working set
**When** `tk-studio-orchestrator` activates
**Then** it resolves role → `working_set.<role>` → routes to resources by name-based handoff (stock BMad skills included), statelessly
**And** with role `direction-giver` it offers delegation/synthesis framing; with `developer` it offers execution workflows

**Given** a missing role or unconfirmed working set
**When** activation occurs
**Then** the orchestrator routes into onboarding (attended) or halts `blocked` naming the gap (headless) — it never invents a working set
<!-- SECTION:DESCRIPTION:END -->
