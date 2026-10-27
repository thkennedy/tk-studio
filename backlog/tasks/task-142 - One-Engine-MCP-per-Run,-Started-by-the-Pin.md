---
id: TASK-142
title: One Engine MCP per Run, Started by the Pin
status: To Do
assignee: []
created_date: '2026-10-27 04:08'
labels:
  - ST-142
milestone: The Vertical-Slice Pack
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want the engine's MCP server chosen once per project, written into `.mcp.json` only on confirmation, and started on the host for a run that asks for the editor,
So that a dev session can run the project's tests, verify it and take a frame from the engine without a human, and nothing more.

**Acceptance Criteria:**

**Given** the three candidates (`beremaran/godot-agent-loop`, `hi-godot/godot-ai`, `gdai-mcp-plugin-godot`)
**When** the story's spike compares them on the box against Godot 4.7.2 Mono (install, `run_project_tests`, `verify_project`, `game_screenshot`, Windows status, licence, last release; the installs and the runs are the operator session's step, asked for through the consult log)
**Then** `kb/engine-mcp-godot.md` records the table and the pick with evidence, the research ledger gets the seeds, and the `game-godot` profile's recommendation names the pick (through 34.4's proposal) with the `.mcp.json` entry written only by `recommend.py record --mcp` on confirmation, never by detection

**Given** a run whose job sets `editor_in_the_loop: true`
**When** the supervisor pins the sandbox
**Then** it snapshots the project with `robocopy` to `C:\agent-work\backups\<project>\<run>` (the brief's Phase 1 item 7), starts the engine MCP on the host bound to the tailnet address with a per-run bearer, passes its URL and the bearer to the sandbox by name (`-e`, never a file), and stops it at release; a run without the flag starts nothing; `bun test` covers the start, the stop, the snapshot and the refusals (no `.mcp.json`, no engine)

**Given** the verify-only rule
**When** the MCP is wired
**Then** its scene-editing tools are not exposed to the dev session in this version (the engine skill says so and the server's allowlist enforces it where the server has one); the runbook names the port and the rule
<!-- SECTION:DESCRIPTION:END -->
