---
id: TASK-76
title: Every Landed Story Carries Its Price and Its Time
status: To Do
assignee: []
created_date: '2026-09-28 02:40'
updated_date: '2026-09-28 09:39'
labels:
  - ST-076
milestone: Opus 5.5 Earns Its Legs, Measured
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator comparing model routes,
I want each landed loop story priced per model from its transcripts and timed from its run,
So that routes are judged on dollars and wall-clock time, not on token counters.

**Acceptance Criteria:**

**Given** a bmad-loop run on the sbx engine
**When** a story reaches its boundary
**Then** the session transcripts and subagent transcripts for that story are copied out of the microVM into the run's directory in the mounted checkout (gitignored), so they reach the host and its nightly backup

**Given** a story's transcripts and a committed price table (model id → input, output, cache-write 5-minute, cache-write 1-hour and cache-read $ per MTok, with the table's date and source; the figures are the sourced table in `kb/execution-pipeline-model-routing.md`, ruled 2026-09-28)
**When** the meter prices the story
**Then** it reports dollars per model and per leg (session, implementer, reviewers, consult, seam, review, triage, supervise), the story's wall-clock from first dispatch to landed commit, its attempt count, and the route in force (from `routing.current.json`); a model missing from the price table is a named refusal, never a guessed price

**Given** a priced story
**When** the meter records it
**Then** one `observation` event per story lands in this machine's ledger, carrying the story key, route, dollars, wall-clock and attempts, and the lib suite pins the pricing arithmetic, the missing-price refusal, and a mixed-model story
<!-- SECTION:DESCRIPTION:END -->
