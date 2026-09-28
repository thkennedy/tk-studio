---
id: TASK-68
title: A Killed Run Resumes or Ends Partial, Never Lost
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-068
milestone: A Queued Job Runs to a Guarded, Measured End
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want a run interrupted by a supervisor crash or a silent worker exit to resume from its transcript or end `partial` with the reason named,
So that acceptance (c) holds: no run is ever silently lost.

**Acceptance Criteria:**

**Given** the supervisor is killed mid-run
**When** it restarts
**Then** every run it owned is found in the queue; each resumes with `--resume <session-id>` on the same tier and branch when its session transcript exists and its guards leave budget, and otherwise finishes `partial` naming the guard or `supervisor restart` (superseding Story 21.3's orphan rule for runs that can resume)

**Given** a worker that exits without a status block (runbook §8: silent REPL exit)
**When** the exit is detected
**Then** the same resume-or-partial rule applies, capped at one resume per run by default, and a second failure ends `partial`

**Given** a resume whose transcript the CLI has garbage-collected
**When** the nightly backup holds a copy
**Then** the transcript is restored from the backup before resuming; with no copy, the run ends `partial` naming the missing transcript

**Given** the repo's test suite
**When** it kills the supervisor at three points (after `wake`, mid-invoke, before `finish`)
**Then** each case ends resumed or `partial` with its events recorded, and the suite is green
<!-- SECTION:DESCRIPTION:END -->
