---
id: TASK-75
title: Acceptance from the Phone, Measured
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
updated_date: '2026-10-16 09:52'
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

**Given** the supervisor on the agent PC with `TK_SUPERVISOR_WORK=C:\agent-work`, the engine sandbox mounting `C:\agent-work\worktrees` read-write as `/c/agent-work/worktrees`, TUA `main` protected on GitHub (the commit recorded) and the declared job `run-epic-2`
**When** the operator sends `curl -X POST …/jobs` from the phone over Tailscale naming the project and the job, with no `base_ref`
**Then** the run resolves `base_ref` to `main` (`base_ref_source: default`), cuts `C:\agent-work\worktrees\the-universe-awaits\<run id>` on `supervisor/run-<run id>` with a relative gitdir, materialises it (`tk install` at the pin, policy and routing copied, `tk activate` clean), launches the engine with `--project` the worktree and writes `launched`; the run appears in `GET /jobs` and on the status page, the engine runs story `2-1-keyed-month-thread-scheduler`, a graceful cancel after that story's commit stops it, the branch is pushed and one PR opens against `main` whose body carries the launch status block, the engine run id, the landed commits and the metered cost; the `ended` event carries the PR URL, the worktree is removed, and the checkout at `C:\GitHub\the-universe-awaits` never changes branch (re-planned 2026-10-16 against supervisor Story 27.1, which supersedes 23.2; a pause leaves the run `paused` with a draft PR and the worktree kept) — acceptance (a)

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
