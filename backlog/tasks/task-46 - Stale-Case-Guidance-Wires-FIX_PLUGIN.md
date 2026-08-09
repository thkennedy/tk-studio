---
id: TASK-46
title: Stale-Case Guidance Wires FIX_PLUGIN
status: Done
assignee: []
created_date: '2026-08-09 05:23'
updated_date: '2026-08-09 06:21'
labels:
  - ST-046
milestone: The Drift Check Tells the Truth
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator running the activation drift check,
I want the installed-but-stale case to name the update flow, not the fresh-install flow,
So that the guided fix I follow is the one SKILL.md's fix table already promises for exactly this case.

**Acceptance Criteria:**

**Given** a harness install record holding the plugin at vX while the repo plugin is vY (X ≠ Y)
**When** the drift check's loadability probe runs
**Then** the plugin plane reports drift with `fix: FIX_PLUGIN` (`/plugin marketplace update tk-studio` + reinstall/update guidance), matching SKILL.md's guided-fix table — `FIX_HARNESS` remains the fix for the not-installed and no-loadable-entry cases only

**Given** the activate script's unit suite
**When** it runs
**Then** the stale case (version-mismatch → FIX_PLUGIN) and the not-installed cases (→ FIX_HARNESS) are each covered, and the suite stays green
<!-- SECTION:DESCRIPTION:END -->
