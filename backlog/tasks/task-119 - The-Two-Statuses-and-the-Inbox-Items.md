---
id: TASK-119
title: The Two Statuses and the Inbox Items
status: Done
assignee: []
created_date: '2026-10-20 00:35'
updated_date: '2026-10-24 23:48'
labels:
  - ST-119
milestone: Tracking on Atlassian and the Inbox
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want every issue that cannot progress to sit in `Blocked - Awaiting User` with its reason, and an inbox derived from that,
So that one list says what needs me (§6.9 items 1 and 2, §7.4).

**Acceptance Criteria:**

**Given** a story the loop cannot progress (a dev session's `blocked` end, a `paused` run awaiting a ruling, an engagement question)
**When** the loop reports it
**Then** the issue (and each dependent story, by the plan's links) moves to `Blocked - Awaiting User` with a comment that @mentions the owner and names the reason and what resolves it (a `tk-studio-track block` verb the supervisor's paused-run pass and the engine's escalation hook call)

**Given** the sync-back
**When** it reads the mentions
**Then** it derives `inbox_item {issue, priority, blocked_since, reason_comment, state: open | resolved | validating}` for every issue in that status, sorted by priority then time, into `_bmad-output/tracking/inbox.json`; the supervisor serves it at `GET /inbox` (a supervisor surface the web consumes, contract 0.1.26 additive) and the office shows a persistent "!" bubble on the desk whose work is blocked, cleared when the status changes, never when a message arrives
<!-- SECTION:DESCRIPTION:END -->
