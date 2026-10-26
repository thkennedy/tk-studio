---
id: TASK-129
title: Delivery, the Closeout Report and Change Requests
status: Done
assignee: []
created_date: '2026-10-25 03:13'
updated_date: '2026-10-26 16:29'
labels:
  - ST-129
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want delivery to say done, not done and why, with the cost per story,
So that the engagement closes on evidence and a change after delivery is a new engagement with its own quote (F2 steps 7 to 9; B5 items 7 to 9).

**Acceptance Criteria:**

**Given** `in-progress` and the engagement's last run ending (`complete`, `partial`, `failed`, `cancelled`)
**When** the supervisor's engagement pass runs (at the `finally` sites, as the resolution pass does)
**Then** it writes `_bmad-output/engagements/<id>/closeout.md`: each deliverable's acceptance signal checked against the landed stories' specs and PRs (done / not done / why), the PRs, a per-story cost table from the meter's records and the runs' `job-run` events, the planning spend, the quote against the actual, and every side exit with its reason; publishes it as `Engagements/ENG-NNN/Closeout` beside the scope; sets `closeout` and the state `delivered` (every deliverable done) or leaves `partial` / `failed` with the report; moves the engagement's Jira issue to `Done`; the notifier sends one line with the link

**Given** a live engagement
**When** `question` (the owner asks; the planner's next turn answers; no state change), `revise` (back to `scoping` with the quote voided; a run in flight finishes its story through a graceful stop) or `go` (past a cap or past open questions) arrives
**Then** it applies as 32.1's table says; after `delivered` a change is a new engagement (`POST /engagements {project, request, follows: ENG-NNN}`) with its own quote; `bun test` covers the closeout's composition and the three mid-run inputs with fakes; the lib suite covers the report's rendering and `engage.py closeout`; the contract's §2 names `tk-studio-engage` and its verbs (`reply`, `questions`, `scope`, `quote`, `closeout`; 0.1.27 additive) and §7.1 the state table; `kb/engagement-loop.md` describes the loop as built, for the attended first engagement and for EP-33
<!-- SECTION:DESCRIPTION:END -->
