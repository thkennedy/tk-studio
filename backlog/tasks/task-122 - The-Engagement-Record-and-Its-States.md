---
id: TASK-122
title: The Engagement Record and Its States
status: Done
assignee: []
created_date: '2026-10-25 03:13'
updated_date: '2026-10-25 05:05'
labels:
  - ST-122
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want an engagement created from a request and moved only by typed inputs,
So that hiring the studio has one record whose state I can read and trust (§7.1; F2 steps 1 and 8).

**Acceptance Criteria:**

**Given** a registered project and a request in plain language
**When** `POST /engagements {project, request}` arrives (the bearer, or a session cookie with `X-CSRF-Token`, else 403 CsrfRefused)
**Then** the supervisor writes `_bmad-output/engagements/<id>/engagement.yaml` in the served project's root (the id `ENG-NNN` from the plan counter's new `engagement` series; `shape_version: 1`; the §7.1 fields `id, project, state, request, questions[], assumptions[], scope_page, quote, autonomy, approved_at, closeout`, plus `created`, `updated`, `spend {planning_usd, runs_usd}` and `inputs[]`, the typed-input log) in state `intake`, appends a queue event `engagement {id, project, state, from: null}`, and answers 200 `{ok, engagement}`; `GET /engagements?project=<id>` lists the project's engagements newest first and `GET /engagements/{id}` reads one with its chat pointer (32.2); a cookie session reads both; an unregistered project is 404 UnknownProject; contract 0.1.27 (additive) names the routes

**Given** the states `intake → awaiting-answers → scoping → quoted → approved → in-progress → delivered` with the side exits `paused`, `failed`, `partial`, `cancelled`
**When** `POST /engagements/{id}/input {verb, …}` arrives with one of `answer`, `go`, `revise`, `question`, `approve`, `cancel` (each with its typed payload, checked by schema)
**Then** exactly the transitions of one exported table in `apps/supervisor/src/engagement.ts` apply (the table is written into the contract's §7.1 row and tested row by row); any other body is 400 SchemaError, a verb illegal in the current state is 409 IllegalInput `{state, verb}`, a terminal state 409 EngagementClosed; nothing else moves `state`: not a chat message, not the planner, not a timer (leaving planning is an explicit exit, F2 step 5); every applied input is appended to `inputs[]` with its time and its source (`bearer` | `cookie` | `planner` for 32.3's one exception) and emits an `engagement` event carrying `from`; `bun test` covers every row of the table and every refusal

**Given** the office and the board
**When** an engagement exists
**Then** `GET /office` and the stream's snapshot carry `engagements[] {id, project, state, title (the request's first line, 80 characters), needs_you}` (contract 0.1.27, additive) and the hub emits `office.engagement {id, state, from}` deltas on each change; `GET /board`'s Needs-you column lists the project's engagements in `awaiting-answers` and `quoted` as items `{engagement, state, title}`; the office projection's and the board's tests cover the rows
<!-- SECTION:DESCRIPTION:END -->
