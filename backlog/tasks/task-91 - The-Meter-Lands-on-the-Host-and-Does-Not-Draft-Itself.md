---
id: TASK-91
title: The Meter Lands on the Host and Does Not Draft Itself
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-091
milestone: "The Service Owns Lifetime, Part 1: The Studio Side"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want every landed story's meter observation to reach the host ledger even when the engine runs in a microVM, and the evolve drafter to leave measurements alone,
So that recreating a sandbox never loses the cost record again (hole 23) and proposals are minted from toil, not from meter rows (PROP-067).

**Acceptance Criteria:**

**Given** the `post_commit` meter hook inside a sandbox
**When** it prices a landed story
**Then** it also writes the full observation envelope to `<run_dir>/transcripts/<story>/observation.json` on the mounted checkout beside `metered.json`, so the record survives the sandbox

**Given** `meter.py harvest --run-dir <dir>` run on the host
**When** it finds observation files not yet harvested
**Then** it appends each to the host ledger through `observe.record_observation` exactly once (a harvested marker beside the file), reports the story keys and dollars, and the seven re-recorded Epic 25 observations of 2026-10-15 are not duplicated (the marker is seeded for them)

**Given** `evolve.py draft`
**When** it clusters observations
**Then** observations whose description starts with `meter:` are excluded from clustering and counted in the result as `measurements_skipped`; PROP-067's cluster is not re-created on a rerun, and the lib suite pins the exclusion

**Given** runbook §3.8
**When** the story closes
**Then** the sandbox recreate step says to run the harvest and to export the sandbox's own ledger (`~/.tk-studio/measurements/*.jsonl` inside the microVM) to the host before `sbx rm`, with the exact commands
<!-- SECTION:DESCRIPTION:END -->
