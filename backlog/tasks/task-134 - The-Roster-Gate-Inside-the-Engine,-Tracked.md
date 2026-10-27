---
id: TASK-134
title: The Roster Gate Inside the Engine, Tracked
status: Done
assignee: []
created_date: '2026-10-26 16:40'
updated_date: '2026-10-27 01:00'
labels:
  - ST-134
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want the deterministic verify command that runs the lib roster gate inside the engine to live in the repository,
So that a story adding a skill fails in the engine on every box, not only where an operator edited the policy overlay by hand (hole 62).

**Acceptance Criteria:**

**Given** the engine policy the launch materialises into every run worktree (`.bmad-loop/policy.toml`, a gitignored operator overlay today)
**When** the launch's readiness check runs
**Then** the `[verify] commands` list is reconciled from a tracked source (`plugins/tk-studio/pipeline/verify-commands.toml`, or the project's `.tk-studio/config.yaml` `engine.verify_commands`): a missing command is added, an operator's extra commands are kept, and the reconciliation is reported in the check's result; the tracked list carries `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` for tk-studio; a project without the list is unchanged; conformance covers the reconciliation and the lib suite covers the merge rules

**Given** a story that adds a skill without its roster row
**When** the engine's verify runs after a clean review
**Then** the command fails, bmad-loop routes the failure to a dev fix session, and the host leg never sees the roster miss; the runbook's hole-62 row points at the tracked source
<!-- SECTION:DESCRIPTION:END -->
