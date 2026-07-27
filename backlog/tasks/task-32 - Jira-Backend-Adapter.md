---
id: TASK-32
title: Jira Backend Adapter
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-032
milestone: Plan Where the Team Plans
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a teammate on Atlassian Cloud,
I want promote and status pull-back against Jira through the official MCP,
So that the same planning flows work when the team's tracker is the backend.

**Acceptance Criteria:**

**Given** a project bound to `jira` (site, project key in binding config)
**When** promote runs
**Then** canonical entities create/update Jira issues per the default mapping (epic→Epic, story→Story, task→Sub-task — confirmed against the org's issue-type scheme at setup), recording `external.jira` state
**And** pull-back updates status-class fields only, with echo suppression and conflict surfacing identical to the local projection (AD-5)

**Given** a headless run
**When** the adapter authenticates
**Then** it uses API-token auth with a preflight that verifies the token works and the org toggle is enabled — an auth failure is a named `blocked` status, never a silent 401
<!-- SECTION:DESCRIPTION:END -->
