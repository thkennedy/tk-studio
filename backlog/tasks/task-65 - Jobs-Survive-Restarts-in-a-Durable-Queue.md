---
id: TASK-65
title: Jobs Survive Restarts in a Durable Queue
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-065
milestone: A Queued Job Runs to a Guarded, Measured End
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want submitted jobs and their runs held in SQLite with one lock per checkout,
So that nothing is lost or run twice when the supervisor stops, crashes, or two requests race.

**Acceptance Criteria:**

**Given** a job submission
**When** it is accepted
**Then** it is validated against the plugin's `job.schema.json` (an invalid submission is refused with the schema error and nothing is queued) and persisted in `jobs`, `runs`, and `events` tables in a database outside every repo and outside `~/.tk-studio` (which the studio owns), at a path from the supervisor's environment, with atomic state transitions

**Given** two wakes for the same job racing
**When** both reach the queue
**Then** exactly one run is minted in one transaction (idempotent `wake`) and the other caller receives the existing run id

**Given** a run holding a project checkout, including a detached bmad-loop engine the supervisor launched
**When** a second run targets the same checkout
**Then** the second run waits in `queued` with the lock holder named — one engine per checkout

**Given** a supervisor restart
**When** it finds runs left `queued` or `running` by a process that no longer exists
**Then** each is ended `partial` with reason `orphaned: supervisor restart` or re-queued if it never started — never left in `queued` forever — and every transition lands in `events`
<!-- SECTION:DESCRIPTION:END -->
