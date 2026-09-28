---
id: TASK-69
title: The API Answers on the Tailnet Only
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-069
milestone: Reachable from the Phone
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator away from the box,
I want the supervisor's HTTP API on the tailnet address behind a bearer token,
So that I can submit, watch, and cancel runs from the phone, iPad, or main PC.

**Acceptance Criteria:**

**Given** the supervisor starts
**When** it binds
**Then** it binds only the Tailscale address named in its environment and refuses to start on `0.0.0.0`, on an address outside `100.64.0.0/10`, or without a bearer token in its environment

**Given** a request without the correct token
**When** it arrives
**Then** it gets 401 and the token never appears in any log

**Given** `POST /jobs` naming a registered project and a declared job, with optional `base_ref`, `tier`, `model`, and `effort`
**When** it is valid
**Then** it is queued through Story 21.3's validation and the response carries the run id; an invalid body gets 400 with the schema error

**Given** `GET /jobs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /status`, and `GET /events?since=`
**When** each is called
**Then** each answers from the queue; cancel ends the run `cancelled`, stopping a launched engine gracefully (`tk-studio-launch` verb `stop`, `graceful`); `/events` serves both SSE and plain polling

**Given** the API test suite
**When** it runs
**Then** auth refusal, malformed JSON, unknown project, unknown job, and a double cancel are pinned and green
<!-- SECTION:DESCRIPTION:END -->
