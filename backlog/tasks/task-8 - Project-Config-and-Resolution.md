---
id: TASK-8
title: Project Config and Resolution
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-008
milestone: Data Lands Where It Belongs
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want tracked project configuration with a per-dev local overlay and one resolution order,
So that every skill resolves the same key the same way and no machine path lands on shared VCS.

**Acceptance Criteria:**

**Given** a project being onboarded
**When** config is written
**Then** `.tk-studio/config.yaml` (tracked: project_id?, vcs, planning binding, working_set, jobs) and `.tk-studio/config.local.yaml` (ignored; P4IGNORE guidance emitted for Perforce projects) exist with schema comments

**Given** a key defined at multiple scopes
**When** any surface resolves it through the shared config library
**Then** precedence is runtime override > project local > project tracked > user > studio default, verified by test fixtures

**Given** a tracked file about to be written
**When** it would contain an absolute machine path or credential
**Then** the write is refused with a classification error (AD-3)
<!-- SECTION:DESCRIPTION:END -->
