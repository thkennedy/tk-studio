---
id: TASK-93
title: Every Run Gets Its Own Worktree and Ends in a PR
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-093
milestone: "The Service Owns Lifetime, Part 2: The Supervisor"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want each run to work in a git worktree of the project cut from its base, and to end as a pull request against that base,
So that two loops never share a working tree, a run never switches the branch under a running service, and all agent work arrives PR-only (hole 16; supersedes Story 23.2).

**Acceptance Criteria:**

**Given** a submission with `base_ref`
**When** the run is claimed
**Then** the supervisor creates `git worktree add <TK_SUPERVISOR_WORK>/worktrees/<project>/<run_id> -b supervisor/run-<run_id> <base_ref>` from the project checkout, refuses a `base_ref` that is the repository's default branch when that branch is not protected on GitHub (`blocked`, naming it), and records the worktree path on the queue run; the checkout itself is never switched

**Given** the untracked runtime the engine needs in a worktree (`_bmad/` at the pin, `.bmad-loop/policy.toml` and `routing.current.json`, the project's local config overlay)
**When** the worktree is prepared
**Then** the supervisor materialises them by the studio's own motions (`tk install` at the pin inside the worktree; the policy and routing files copied from the checkout; never a junction into the checkout), `tk activate` is clean inside the worktree, and the engine's `--project` is the worktree

**Given** a run that launched an engine
**When** the engine completes, pauses, or is stopped
**Then** the supervisor pushes the run branch and opens a PR against `base_ref` whose body carries the launch status block, the engine run id, the landed commits and the metered cost, records the PR URL on the `ended` event, opens no PR when no commit landed ("no changes" recorded), never force-pushes and never merges; the worktree is removed after the PR opens unless the run is paused (a paused run keeps it for the resume)

**Given** the supervisor's test suite on the Windows host and the Linux engine
**When** it runs
**Then** worktree creation, the unprotected-base refusal, the runtime materialisation and the PR body are pinned against a fake `gh` and a real throwaway repository, and the live acceptance on the-universe-awaits (Story 23.3) is re-planned against this story
<!-- SECTION:DESCRIPTION:END -->
