---
id: TASK-141
title: Engine Knowledge, Pinned per Project
status: To Do
assignee: []
created_date: '2026-10-27 04:08'
labels:
  - ST-141
milestone: The Vertical-Slice Pack
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the dev session,
I want the engine's version, its quirks and its rules in my context when the project is a game,
So that I never hand-edit a serialised scene, never guess an API that changed, and run the engine the way this box runs it (the research's recurring finding: engine knowledge injection beats model priors).

**Acceptance Criteria:**

**Given** the `game-godot` detect profile
**When** `tk-studio-onboard` proposes a working set for a project it detects as Godot
**Then** the proposal carries, with its evidence, the plugin-shipped engine skill `gds-engine-godot-4` (read-only knowledge: the pinned version read from `project.godot`'s `config/features` and `global.json`'s SDK, the headless flags, the C# and GoDotTest conventions, the rule that `.tscn` and `.tres` files are written only the way the editor writes them, the import-cache rule, the `$env:GODOT` rule on the box) and records it in `working_set.<role>` only on confirmation; a project whose pinned version falls outside the skill's supported range gets a warning, never a silent mismatch; `recommend.py`'s tests cover the suggestion and the version check

**Given** a run on a game project
**When** the launch materialises the worktree
**Then** the engine skill reaches the dev session the way the studio's other skills do (the skills mount), and `engine.verify_commands` (33.5) carries the project's engine gate when the sandbox can run it and names the host leg (34.1) when it cannot; the roster row, the README row and the kb row exist; a `claude plugin eval` case checks the skill answers the three pinned facts

**Given** GDS's own engine catalogue (`gds-game-architecture/engine-mcps.yaml`, upstream-owned, AD-1)
**When** the skill is written
**Then** it cites the catalogue and never forks it
<!-- SECTION:DESCRIPTION:END -->
