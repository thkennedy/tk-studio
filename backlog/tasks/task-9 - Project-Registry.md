---
id: TASK-9
title: Project Registry
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-009
milestone: Data Lands Where It Belongs
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want every known project registered in one canonical map,
So that cross-project queries have a single authoritative read path.

**Acceptance Criteria:**

**Given** the registry schema published in `contracts/` (map keyed by project_id: root path, bindings, VCS, working-set ref, vault-link state)
**When** onboarding registers a project
**Then** the entry is written atomically to `~/.tk-studio/registry/projects.yaml` by the single-writer path (onboard/activate only)

**Given** a project whose basename collides with an existing project_id
**When** registration runs
**Then** it fails with a demand for an explicit `project_id` — never a silent second identity

**Given** any other surface (orchestrator, jobs, measurement)
**When** it needs project data
**Then** it reads the registry and never writes it
<!-- SECTION:DESCRIPTION:END -->
