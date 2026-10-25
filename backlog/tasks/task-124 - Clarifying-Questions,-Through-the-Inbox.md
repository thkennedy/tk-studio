---
id: TASK-124
title: Clarifying Questions, Through the Inbox
status: To Do
assignee: []
created_date: '2026-10-25 03:13'
labels:
  - ST-124
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want at most three multiple-choice questions with defaults, in my inbox,
So that scoping waits on me loudly and never silently, and an absent owner leaves stated assumptions, not a stall (F2 step 2; B5 item 2).

**Acceptance Criteria:**

**Given** an engagement in `intake` whose planner turn finds gaps a default cannot cover
**When** the planner writes `engage.py questions` (at most three, each `{id, text, options[] with exactly one default, impact}`; a fourth is refused by name)
**Then** `questions[]` fills, the state moves `intake → awaiting-answers` by a `question` input the supervisor applies on the planner's behalf from the written file (the one exception to "the owner sends every input", recorded with source `planner` and the run id), one Jira issue per engagement (`ENG-NNN: questions`, issue type Task, in the project's Jira project) is created or updated through the planning adapter and moved to `Blocked - Awaiting User` with the questions as a comment that @mentions the owner (31.5's `track.py block` path, extended with `--engagement`), the sync-back's inbox lists it (the item carries `engagement: ENG-NNN`), and the office shows the "!" bubble on the planner's desk

**Given** the owner's reply on the issue (31.6's Issue screen, Jira itself) or the Chat screen's answer cards
**When** the sync-back pulls the comment, or `POST /engagements/{id}/input {verb: answer, answers: {<id>: <option>}}` arrives
**Then** the answers land in `questions[].answer` (a comment is parsed as `<id>: <option>` lines, a free-text answer is kept verbatim for the planner to judge), the issue moves to `Block Resolved` and on to `Done` (no validation leg for a question: the planner's next turn judges the answer), and the state moves `awaiting-answers → scoping` once every question has an answer; `go` with questions open converts each unanswered question into its default as a stated assumption in `assumptions[]` (named on the scope page) and moves on; nothing moves on a timer; the lib suite and `bun test` cover the cap, the issue and the inbox item, the two answer paths and the assumptions with fake Atlassian REST
<!-- SECTION:DESCRIPTION:END -->
