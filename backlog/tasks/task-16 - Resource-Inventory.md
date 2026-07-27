---
id: TASK-16
title: Resource Inventory
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-016
milestone: The Studio Knows Your Project
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want an inventory of everything installable and everything I've authored,
So that recommendations draw from the full resource universe, not just what's installed.

**Acceptance Criteria:**

**Given** a machine + project
**When** `tk-studio-detect` inventories
**Then** it enumerates installed BMad modules/skills (from `_bmad/_config` manifests), known-but-uninstalled official modules (from the installer registry), and user-authored resources (project `.claude/skills`, `_bmad/custom/`, project agents)
**And** the output is a structured, data-only artifact (JSON) with provenance per resource
<!-- SECTION:DESCRIPTION:END -->
