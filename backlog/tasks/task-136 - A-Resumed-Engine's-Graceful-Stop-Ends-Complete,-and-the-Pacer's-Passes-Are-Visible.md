---
id: TASK-136
title: "A Resumed Engine's Graceful Stop Ends Complete, and the Pacer's Passes Are Visible"
status: To Do
assignee: []
created_date: '2026-10-26 16:40'
labels:
  - ST-136
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want a run whose resumed or relaunched engine stops gracefully after its story to end `complete`, and the pacer's slow passes to be visible,
So that `partial` means something went wrong and a 30-minute tick is seen when it happens (hole 59; the 2026-10-26 tick).

**Acceptance Criteria:**

**Given** a run whose engine was resumed (`POST /runs/{id}/resume`) or relaunched by the paused-run pass and then ends `stopped` after a `story-done` for the story it was driving
**When** the engine-end sweep runs
**Then** the run ends `complete` exactly as a first engine's graceful stop does (`reason: null`, the PR not a draft), and `partial` is reserved for an engine that stopped before its story landed; `bun test` covers both paths on resumed and relaunched engines

**Given** the pacer (`start.ps1`: tick, drain, sleep)
**When** each pass runs
**Then** its duration and exit code are logged (33.1's file) and the last ones are served in `GET /status` as `pacer {last_tick_ms, last_drain_ms, last_pass_at}` (contract 0.1.28, additive), a pass longer than 10 minutes is logged as a warning naming the pass and the run it was driving, and the status page shows the pacer line; the runbook's supervisor table gains the pacer's shape
<!-- SECTION:DESCRIPTION:END -->
