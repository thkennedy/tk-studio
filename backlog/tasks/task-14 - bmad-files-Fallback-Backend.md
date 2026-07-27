---
id: TASK-14
title: bmad-files Fallback Backend
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-014
milestone: Plan Locally, Canonically
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a developer on a project with no extra tooling,
I want the canonical files alone to be a fully working backend,
So that planning works offline in any repo with zero additional installs.

**Acceptance Criteria:**

**Given** a project bound to `bmad-files`
**When** planning flows and `tk-studio-plan-sync` run
**Then** normalize + validate + index generation happen with no projection, and the sync verb reports cleanly (no-op projection is first-class, not an error)

**Given** the same planning skill flow
**When** run against `bmad-files` and later against another binding
**Then** skill behavior is unchanged (binding decides projection only) — the brief's adapter success criterion
<!-- SECTION:DESCRIPTION:END -->
