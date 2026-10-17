---
id: TASK-96
title: A Host-Tier Verify Leg Runs Before Any PR Opens
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-096
milestone: "The Service Owns Lifetime, Part 2: The Supervisor"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the project's own verify command run on the Windows host, in the run's worktree, after the engine completes and before the PR opens,
So that Windows-only defects stop reaching branches (holes 11, 12 and 22).

**Acceptance Criteria:**

**Given** a project's tracked `.tk-studio/config.yaml` with `verify.host: <command>` (tk-studio: the lib suite and conformance; the supervisor: `bun test`; the-universe-awaits: its verify script)
**When** an sbx-tier run's engine completes
**Then** the supervisor runs that command on the host tier in the worktree, console-hosted, under the same guards as a host-tier worker, and records its exit, duration and the last lines of output on a `host-verify` event; the command comes from the project's config, never from the plugin (AD-2)

**Given** a red host verify
**When** the PR would open
**Then** the run ends `partial` naming the failing command, the branch is still pushed, the PR opens as a draft whose body carries the host failures, and the notification names them

**Given** a project with no `verify.host`
**When** a run ends
**Then** the PR opens as before and the event says the leg was skipped with the reason

**Given** the supervisor's test suite and the runbook
**When** the story closes
**Then** green, red and absent commands are pinned on both hosts, and runbook §3.8 retires the "attended host run before each PR" rule in favour of this leg
<!-- SECTION:DESCRIPTION:END -->
