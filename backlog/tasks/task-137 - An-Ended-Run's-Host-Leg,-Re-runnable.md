---
id: TASK-137
title: "An Ended Run's Host Leg, Re-runnable"
status: Done
assignee: []
created_date: '2026-10-26 16:40'
updated_date: '2026-10-27 03:46'
labels:
  - ST-137
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want to re-run a run's host leg on its pushed branch through the supervisor after fixing what made it red,
So that a roster miss or an environment fault never needs the hand recipe (hole 52).

**Acceptance Criteria:**

**Given** an ended run with a pushed branch and a PR (`partial` with `host_verify: red`, or any ended run)
**When** `POST /runs/{id}/verify` arrives (the bearer only) or the cli verb `verify <run id>` runs
**Then** the supervisor cuts a fresh worktree from the branch's tip, runs the project's `verify.host` there exactly as the close-out does, records a new `host-verify` event with the result, removes the worktree, and on green marks a draft PR ready and ends the run's `host_verify` state `green` (the run's terminal state is unchanged; the plan pull-back sees the PR as before); a live run, an external run or a run with no branch is a 409 by name; a leg already running for the run is 409 `VerifyRunning`; contract 0.1.28 names the route

**Given** the verb
**When** it is tested
**Then** `bun test` covers the worktree, the recorded event, the draft-to-ready flip and every refusal with fakes; the README's route table and the runbook's "when a host leg is red" steps name it
<!-- SECTION:DESCRIPTION:END -->
