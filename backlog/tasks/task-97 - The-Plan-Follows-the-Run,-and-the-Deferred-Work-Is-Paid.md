---
id: TASK-97
title: The Plan Follows the Run, and the Deferred Work Is Paid
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-097
milestone: "The Service Owns Lifetime, Part 2: The Supervisor"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the canonical plan to reflect a run's landing, and the supervisor's own deferred work closed,
So that the plan index stops under-reporting what is built (hole 18) and the queue is honest about cost, cancels, time and certificates (DW-11, DW-12, DW-13, DW-15, DW-19, DW-21, DW-23).

**Acceptance Criteria:**

**Given** a run that opens a PR
**When** the `ended` event is written
**Then** the supervisor calls the planning adapter's status verb (Story 26.5) on the project that owns the plan (the registry names it; a transcribed epic names its owner) for every story the run's spec marked done, setting `review`; the next tick that sees the PR merged sets `done`; both are recorded on the run's events, and a refused call never changes the run's state

**Given** a run resumed after a restart
**When** it finishes
**Then** `run.json`'s `total_cost_usd` is the sum across every iteration (per-iteration cost recorded as `accounted` events; DW-15)

**Given** a cancel racing a claim or a late studio-run record
**When** both happen
**Then** the cancel ends the studio run it finds on a re-read inside the end transaction, or the next recovery ends it, and no run is left unended (DW-12, DW-13); an ended run that keeps its lock counts as live for the pacer (DW-11)

**Given** the worker record on win32
**When** it is written
**Then** the pid lands before the start time, and the start time is read natively (`GetProcessTimes` through `bun:ffi` or an equivalent that takes under 50 ms), so a supervisor killed inside the window still leaves a usable record (DW-19)

**Given** the TLS certificate and a refused `finish`
**When** the certificate is within 14 days of expiry, or a skill run finished itself
**Then** the keeper renews the certificate and restarts `serve` once, outside a live run, with an event (DW-21); and a refused `finish` on an already-terminal studio run leaves the run's reason as the worker's own status-block reason, never the refusal text (DW-23)

**Given** the supervisor's test suite
**When** the story closes
**Then** every case above is pinned on both hosts, the deferred-work entries are closed with their evidence, and the runbook §4 names the new events and the certificate rule
<!-- SECTION:DESCRIPTION:END -->
