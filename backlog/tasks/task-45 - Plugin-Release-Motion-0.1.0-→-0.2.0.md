---
id: TASK-45
title: Plugin Release Motion 0.1.0 → 0.2.0
status: To Do
assignee: []
created_date: '2026-08-09 03:16'
labels:
  - ST-045
milestone: Release What Shipped
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a teammate installing the studio plugin,
I want the marketplace catalog and plugin version bumped in lockstep so the delivered plugin carries every shipped surface,
So that a fresh or updated install actually has the evolve, knowledge, and session skills the repo says it ships.

**Acceptance Criteria:**

**Given** `plugins/tk-studio/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` both at 0.1.0
**When** the release lands
**Then** both move to 0.2.0 in the same commit (lockstep — AD-13's plugin plane compares exactly these two) and the released roster includes `tk-studio-evolve`, `tk-studio-knowledge`, and `tk-studio-session`

**Given** the bumped catalog on main
**When** the installed plugin updates (`/plugin marketplace update` — the AD-13 guided fix, operator-side)
**Then** the installed cache is 0.2.0 with the full 17-skill roster and a fresh activation drift check reports the plugin plane clean at 0.2.0, harness-loadable

**Given** the release commit
**When** the suites run
**Then** the lib unit suite and the conformance suite stay green — no contract change rides the release (the version gate is delivery metadata, not a surface change)
<!-- SECTION:DESCRIPTION:END -->
