---
id: TASK-70
title: A Read-Only Status Page
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-070
milestone: Reachable from the Phone
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want a small server-rendered page over the queue and `~/.tk-studio`,
So that I can see what the box is doing at a glance while the studio plugin still grows no UI.

**Acceptance Criteria:**

**Given** the status page
**When** it is requested
**Then** it is served on the same bind and behind the same auth as the API, with no client-side framework, and it reads well at phone width

**Given** the page
**When** it renders
**Then** it shows the queue (jobs, and runs with state, reason, and cost), the latest status blocks, run workspaces (`run.json`, `handoff.json`), the tail of this machine's ledger file, and the registry's projects

**Given** any page route
**When** it is exercised in the test suite
**Then** it is a GET that writes nothing to the queue or to `~/.tk-studio`, and it renders no credential-shaped value (NFR5)
<!-- SECTION:DESCRIPTION:END -->
