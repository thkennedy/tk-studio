---
id: TASK-13
title: Normalize Pass and Id Authority
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-013
milestone: Plan Locally, Canonically
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a developer running stock BMad planning flows,
I want the adapter to canonicalize what those flows produce,
So that untouched upstream skills still yield one canonical local representation with collision-free ids.

**Acceptance Criteria:**

**Given** BMad-native planning artifacts freshly written by stock skills (epics, story files, sprint status)
**When** the `tk-studio-plan-sync` normalize pass runs
**Then** canonical frontmatter is stamped/repaired on those artifacts in place (artifacts edited, BMad code untouched — AD-4), preserving all upstream content

**Given** entities without ids
**When** normalization mints them
**Then** ids come only from the committed per-project counter (`EP-/ST-/TA-NNN`), and the counter advances atomically

**Given** a merge that lands a duplicate id
**When** sync next runs
**Then** it blocks with both file paths named until renumbered — never auto-picks a survivor
<!-- SECTION:DESCRIPTION:END -->
