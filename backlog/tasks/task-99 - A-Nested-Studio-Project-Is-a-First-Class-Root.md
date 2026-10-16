---
id: TASK-99
title: A Nested Studio Project Is a First-Class Root
status: To Do
assignee: []
created_date: '2026-10-16 20:11'
labels:
  - ST-099
milestone: "The Supervisor Moves In: One Repository"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a developer,
I want the plugin to resolve a project root nested inside another studio project,
So that `apps/supervisor` keeps its own config, base, planning artifacts, engine workspace and hooks after the move, as AD-21 says.

**Acceptance Criteria:**

**Given** a working directory inside `apps/supervisor`
**When** any surface resolves the project root (activation and the drift check, `config.py resolve`, `plansync`, `jobrun`, `meter`, `observe`, the registry, the launch skill)
**Then** the nearest ancestor holding `.tk-studio/config.yaml` wins (the nested root), never the outer one; `TK_STUDIO_ROOT` keeps meaning the outer repository root, the plugin's home; activation reports both and names the project nested

**Given** the supervisor's tracked `.tk-studio/config.yaml` carrying `project_id: supervisor`
**When** the registry entry's `root` is amended to the nested root (`registry.py amend`)
**Then** `registry.py show`, activation and the launch skill agree on the root; the store paths stay per project (`~/.tk-studio/projects/supervisor/`), the nested project's plan counter and `plansync` never mint into the outer project's counter, and nothing of the outer project's store is read or written from the nested root

**Given** `apps/supervisor/.claude/settings.json` and `apps/supervisor/.bmad-loop/plugins/studio-pipeline/`
**When** a Claude session or the engine starts in the nested root
**Then** `$CLAUDE_PROJECT_DIR` is the nested root, the hooks resolve their scripts relative to it, and the pipeline plugin copy names the spine and the driver contract by a path relative to the nested root (`../../_bmad-output/...`, `../../plugins/tk-studio/contracts/...`) so `$TK_STUDIO_ROOT` is no longer required inside the microVM; the two copies of `task-planning.md`, `consult.md`, `gate.md` and `reconcile.md` differ only in those paths and the project's name, and a lib test pins that

**Given** the lib suite and conformance
**When** they run
**Then** nested-root resolution is pinned for every surface above with a fixture holding an outer and a nested project, the drift check reports a nested root distinctly, and the driver contract states the nearest-root rule in a minor bump
<!-- SECTION:DESCRIPTION:END -->
