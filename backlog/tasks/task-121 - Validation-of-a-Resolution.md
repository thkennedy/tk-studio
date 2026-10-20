---
id: TASK-121
title: Validation of a Resolution
status: To Do
assignee: []
created_date: '2026-10-20 00:35'
labels:
  - ST-121
milestone: Tracking on Atlassian and the Inbox
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want an agent to validate a resolved block before the story continues,
So that a reply that did not resolve the block comes back to the inbox with a follow-up, not a silent failure (§6.9 item 4 and 5).

**Acceptance Criteria:**

**Given** an issue in `Block Resolved`
**When** the sync-back sees it
**Then** the supervisor queues a `validate-resolution` job for the project (host tier, the planner leg's model): the session reads the reason and the reply, and either tests the thing it had to be able to do (a command, a path, a sign-in) or judges whether the answer is enough; a pass moves the issue back to `To Do` or `In Progress` (the loop re-arms the story: the supervisor's paused run resumes with the ruling written into the spec, or the job's next tick re-runs it), a fail moves it to `Blocked - Awaiting User` with a follow-up comment that lands in the inbox again

**Given** the engagement's questions and approvals and the loop's `escalate` rulings
**When** they arise
**Then** each is an issue with comments in the same project, so the owner has one inbox for everything; the supervisor's `awaiting-ruling` writes the block instead of a Telegram note alone, and a reply that carries a ruling is written into the spec by the validation session; the lib suite and `bun test` cover the queueing, the two outcomes and the ruling write with fakes
<!-- SECTION:DESCRIPTION:END -->
