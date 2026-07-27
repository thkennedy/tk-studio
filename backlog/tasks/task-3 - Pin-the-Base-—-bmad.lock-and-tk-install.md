---
id: TASK-3
title: Pin the Base — bmad.lock and tk install
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-003
milestone: Install Once, Stay in Lockstep
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want `tk install` to install the BMad base at the committed pin with my project's module set,
So that every repo and teammate runs the identical base with zero forks.

**Acceptance Criteria:**

**Given** a committed `bmad.lock` pinning the BMad core version, per-module versions/channels, and install flags
**When** the operator runs the `tk-studio-install` skill in a project
**Then** the upstream installer runs non-interactively at the pinned core version with the project's configured module set
**And** an `install-outcome` event (success or failure, with step detail) is emitted

**Given** the same lockfile and module set on two machines
**When** both run the flow
**Then** both produce the same `_bmad/_config` manifest versions (deterministic install)

**Given** a headless invocation
**When** the skill runs
**Then** it completes without prompting and ends with the JSON status block
<!-- SECTION:DESCRIPTION:END -->
