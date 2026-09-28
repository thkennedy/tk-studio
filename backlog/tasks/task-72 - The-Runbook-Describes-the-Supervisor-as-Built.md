---
id: TASK-72
title: The Runbook Describes the Supervisor as Built
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-072
milestone: Reachable from the Phone
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator provisioning the next agent box,
I want runbook §4 to describe the supervisor as built instead of as a placeholder,
So that the next box is set up from facts.

**Acceptance Criteria:**

**Given** `kb/agent-pc-setup-runbook.md` §4
**When** the story lands
**Then** it names the repo, the clone path under `C:\GitHub`, the environment variables (bind address, token, database path, notification target), `start.ps1`, the Startup shortcut, the retirement of the sbx sign-in task, and the smoke test from another device; §7 gains a smoke row and §8 gains a row for each supervisor failure mode met while building it

**Given** the story's docs-only scope
**When** it lands
**Then** no code, schema, or contract file changes, and the kb index regenerates only if frontmatter moved
<!-- SECTION:DESCRIPTION:END -->
