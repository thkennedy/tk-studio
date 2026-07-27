---
id: TASK-7
title: Per-User Store Standup
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-007
milestone: Data Lands Where It Belongs
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want my working data, role, and machine identity in one off-VCS store,
So that scratch and identity never hit shared version control and teammates never collide.

**Acceptance Criteria:**

**Given** a machine without `~/.tk-studio/`
**When** any studio surface first needs the store
**Then** the store skeleton (`config.yaml`, `registry/`, `projects/`, `measurements/`) is created at the OS-resolved path (`%USERPROFILE%\.tk-studio\` on Windows)
**And** `config.yaml` records user_name, role (default: developer), machine_id, and optional obsidian_vault

**Given** an existing store
**When** standup runs again
**Then** it is idempotent — nothing is overwritten or lost
<!-- SECTION:DESCRIPTION:END -->
