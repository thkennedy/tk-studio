---
id: TASK-73
title: The Engine Has a Home That Never Bypasses on the Host
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-073
milestone: The Supervisor Lands a Story on The Universe Awaits
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want bmad-loop provisioned on the agent PC where its sessions are allowed to run,
So that `run-epic` can execute here within the hard rules.

**Acceptance Criteria:**

**Given** the operator's placement decision (recommended: the sbx tier; fallback: the host tier with `--permission-mode auto`)
**When** the story starts
**Then** the decision is recorded in the runbook, and neither WSL nor the host ever runs the engine's sessions with bypass

**Given** the sbx placement
**When** the engine is provisioned
**Then** bmad-loop, the .NET 8 SDK, and headless Godot run inside the microVM against the TUA checkout, and on the host Godot still runs only through `$env:GODOT`

**Given** the host placement
**When** the engine is provisioned
**Then** the throwaway branch's loop profile replaces its bypass arguments with `--permission-mode auto`, `TK_STUDIO_ROOT` comes from the environment instead of a main-PC path, and bmad-loop's native-Windows support is proven or its blocker (such as tmux) is named

**Given** any first run that creates AppData folders (a `uv tool install bmad-loop`, NuGet, Godot)
**When** it is needed
**Then** the operator runs it in their own terminal from exact commands the story provides; no Claude desktop-app session performs it

**Given** the throwaway branch
**When** `tk-studio-launch` verb `check` runs against `_bmad-output/specs/spec-epic-2`
**Then** it answers ok, with `.bmad-loop/policy.toml` present locally and untracked
<!-- SECTION:DESCRIPTION:END -->
