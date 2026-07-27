---
id: TASK-28
title: Model and Effort Routing
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-028
milestone: Work Runs While Nobody Watches
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want conservative model/effort defaults with clean override precedence,
So that escalation is deliberate and unattended work stays cheap.

**Acceptance Criteria:**

**Given** every shipped studio resource declaring defaults in its `customize.toml`
**When** the orchestrator or job runner invokes a resource
**Then** effective model/effort resolves runtime override > project config > resource default, and the chosen values are visible in run output

**Given** a job or convene spanning multiple resources
**When** routing occurs
**Then** each resource keeps its own resolved values (no silent inheritance of a more expensive setting)
<!-- SECTION:DESCRIPTION:END -->
