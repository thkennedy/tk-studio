---
id: TASK-74
title: Every Run Gets Its Own Branch and Ends in a PR
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-074
milestone: The Supervisor Lands a Story on The Universe Awaits
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the supervisor to cut a branch per run and open a PR against the run's base when the work ends,
So that all agent work arrives PR-only.

**Acceptance Criteria:**

**Given** a submission with `base_ref`
**When** the run starts
**Then** the supervisor creates `supervisor/run-<run_id>` from `base_ref` in the project checkout, refusing a dirty tree (never cleaning one)

**Given** a `base_ref` that is the repository's default branch
**When** that branch is not protected on GitHub
**Then** the run is refused `blocked` naming the unprotected branch (the "main protected on every repo the agent touches" rule)

**Given** a run that launched an engine (`run-epic`)
**When** the launch session ends
**Then** the supervisor follows the engine run through `tk-studio-launch` verb `status` until it completes, pauses, or is stopped, then pushes the run branch and opens a PR against `base_ref` whose body carries the launch status block, the engine run id, the commits, and the cost

**Given** a run that produced no commits
**When** it ends
**Then** no PR is opened and the run records "no changes"

**Given** any run
**When** it touches git
**Then** it never force-pushes and never merges
<!-- SECTION:DESCRIPTION:END -->
