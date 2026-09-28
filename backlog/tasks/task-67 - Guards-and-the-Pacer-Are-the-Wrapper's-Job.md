---
id: TASK-67
title: "Guards and the Pacer Are the Wrapper's Job"
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-067
milestone: A Queued Job Runs to a Guarded, Measured End
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want wall-clock, turn, and token guards enforced by the supervisor, and recurring jobs paced without overlap,
So that no unattended run outlives its budget and no job piles up behind itself.

**Acceptance Criteria:**

**Given** a run past its `max_wall_clock_seconds`
**When** the guard trips
**Then** the worker's whole process tree is killed and the run finishes `partial` with the guard named in `reason`

**Given** a job with `max_turns` or `max_tokens`
**When** the worker completes an iteration
**Then** `account` is called with the turns and tokens read from the worker's transcript, and a tripped guard ends the run `partial` naming it

**Given** a self-paced job with `hint_seconds`
**When** the pacer ticks
**Then** the job is woken only after the hint has elapsed since its last run ended, and never while a run of it is `queued` or `running`

**Given** a job whose `stop.on_status` matches a run's terminal status
**When** that run ends
**Then** the job stops recurring and the stop condition is recorded in `events`
<!-- SECTION:DESCRIPTION:END -->
