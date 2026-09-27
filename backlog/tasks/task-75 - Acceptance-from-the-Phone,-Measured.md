---
id: TASK-75
title: Acceptance from the Phone, Measured
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-075
milestone: The Supervisor Lands a Story on The Universe Awaits
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the plan's acceptance run end to end from the phone and measured,
So that Phase 1 is proven before Phase 2 starts.

**Acceptance Criteria:**

**Given** the throwaway base branch `throwaway/supervisor-p1-acceptance` cut from TUA `main` (the commit recorded) and the declared job `run-epic-2`
**When** the operator sends `curl -X POST …/jobs` from the phone over Tailscale naming the project, the job, and the base branch
**Then** the run appears in `GET /jobs` and on the status page, `claude -p` executes `tk-studio-launch`, the launch status block is captured, the engine runs story `2-1-keyed-month-thread-scheduler`, a graceful cancel after that story's commit stops it, and a PR opens against the throwaway branch — acceptance (a)

**Given** the same day's plugin version
**When** conformance runs through the supervisor (Story 21.2)
**Then** it is ok — acceptance (b)

**Given** the supervisor is killed during a run's launch session
**When** it restarts
**Then** the run resumes or ends `partial` with the guard named, never lost — acceptance (c)

**Given** the finished runs
**When** the ledger is read
**Then** `job-run` events carrying `total_cost_usd` are in `~/.tk-studio/measurements/tim-Tim-PC-2.jsonl` (the first `job-run` events on the box, which closes Phase 0), the engine's own session costs are read from the substrate's usage records, and `tk measure push` opens the membrane PR — acceptance (d)

**Given** the acceptance record
**When** the story closes
**Then** a kb record names the run ids, the PR URL, the costs, and every failure met, and TUA `main` is verified unchanged at its recorded commit
<!-- SECTION:DESCRIPTION:END -->
