---
id: TASK-123
title: The Planner Leg Behind the Chat Route
status: Done
assignee: []
created_date: '2026-10-25 03:13'
updated_date: '2026-10-25 07:06'
labels:
  - ST-123
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want to talk to the studio about an engagement from the web,
So that the same brain the loop uses answers with the project's plan, kb and Confluence pages as its memory (§6.4, D2; F2 step 1).

**Acceptance Criteria:**

**Given** an engagement that is not terminal
**When** `POST /chat/{engagement} {message}` arrives (the bearer or a cookie with `X-CSRF-Token`; the body at most 32 KiB UTF-8)
**Then** the message is appended to `_bmad-output/engagements/<id>/chat.jsonl` as `{seq, at, author: owner, body}` and the supervisor queues one run of the shipped job `engagement-chat` (one-shot; host tier; the planner leg's model and effort from the project's routing, passed at enqueue as `validate-resolution`'s are; payload `{engagement, seq}`; `guards.max_turns` 80, `max_wall_clock_seconds` 1800): a `claude -p` session on the host in the served project's root with the plugin, driven by the new contract surface `tk-studio-engage` (`lib/engage.py`), which reads the record, the chat so far, the plan under `_bmad-output/planning-artifacts/`, `kb/` and `kb/confluence/` and writes the reply with `engage.py reply` as `{seq, at, author: planner, body, run_id, proposals[]}`; the run's `job-run` event carries the cost like any run and the record's `spend.planning_usd` sums it (scoping is metered; the quote says so, 32.5); the answer is 200 `{ok, engagement, seq, run_id}`; a message sent while a chat run is live is queued behind it on the checkout lock, never refused; a terminal engagement is 409 EngagementClosed

**Given** the chat
**When** `GET /chat/{engagement}?since=<seq>` is read (JSON, or `Accept: text/event-stream` with the office stream's id, replay and heartbeat conventions)
**Then** the lines after `seq` are returned and the planner's reply reaches an open stream without a reload; a `proposals[]` entry is `{verb, payload, label}` (an input the planner suggests, which the web renders as a button and the owner sends through 32.1: the planner itself has no bearer and no CSRF token and moves nothing); the chat session's environment is a worker's (`buildWorkerEnv`: every `TK_SUPERVISOR_*` secret and the owner seat stripped); `bun test` covers the append, the queueing behind a live run, the stream and the refusals with a fake planner; the lib suite covers `engage.py reply` (the memory it assembles, the reply line, the proposal shape) with a fixture project
<!-- SECTION:DESCRIPTION:END -->
