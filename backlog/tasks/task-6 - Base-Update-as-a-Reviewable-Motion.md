---
id: TASK-6
title: Base Update as a Reviewable Motion
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-006
milestone: Install Once, Stay in Lockstep
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want a base update to be one skill run that produces an integration PR,
So that the team adopts upstream changes in lockstep with a reviewable diff and no fork.

**Acceptance Criteria:**

**Given** a new upstream BMad release
**When** the `tk-studio-base-update` skill runs with the target version
**Then** it bumps `bmad.lock` (core and/or per-module pins), reruns the upstream installer at the new pin in this repo, and opens a feature-branch PR containing lockfile + resulting install diff
**And** the PR body summarizes upstream changes and flags any install warnings; nothing merges automatically

**Given** the installer fails at the new pin
**When** the skill runs
**Then** the working tree is left restorable (branch isolation), the failure is emitted as `install-outcome: failure`, and the status block reports `blocked` with the reason
<!-- SECTION:DESCRIPTION:END -->
