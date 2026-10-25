---
id: TASK-120
title: The Inbox and Issue Screens
status: Done
assignee: []
created_date: '2026-10-20 00:35'
updated_date: '2026-10-25 01:24'
labels:
  - ST-120
milestone: Tracking on Atlassian and the Inbox
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want the web's Inbox to list what needs me and its Issue view to let me reply or press Done,
So that I answer from the desktop or the iPad without opening Jira (§6.9 items 2 to 4).

**Acceptance Criteria:**

**Given** `GET /inbox` and the tracked issues
**When** the Inbox screen renders
**Then** it lists open items sorted as served, each with the project, the issue key and title, the priority, how long it has waited and the reason's first line; the web's nav gains Inbox and Issue; the count sits on the nav item

**Given** one item
**When** the Issue screen opens
**Then** it shows the issue Jira-like (status, the run and PR when the plan links one, the cost from the ledger when known, the comments in order with author and time), a reply box, and a **Done** button for a simple request; sending a reply, or Done (which writes "Done." as the owner), posts the comment through the supervisor (`POST /inbox/{key}/reply`, the owner's token, never the agent's) and moves the issue to `Block Resolved`; the item leaves the list on the next sync-back; vitest covers the list, the view and the two actions with a fixture
<!-- SECTION:DESCRIPTION:END -->
