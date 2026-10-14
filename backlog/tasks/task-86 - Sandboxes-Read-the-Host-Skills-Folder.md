---
id: TASK-86
title: Sandboxes Read the Host Skills Folder
status: To Do
assignee: []
created_date: '2026-10-14 19:41'
labels:
  - ST-086
milestone: One Installer Writes the Studio
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want every engine sandbox to consume the host's `~/.claude/skills` through Docker's read-only skills mount instead of installing the plugin per sandbox,
So that one install serves the host and every microVM and the drift check covers both.

**Acceptance Criteria:**

**Given** `tools/sbx-engine/provision-engine.sh`
**When** it provisions a sandbox
**Then** it no longer installs the plugin at user scope inside the microVM; it verifies the mounted skills folder is present and read-only and that `tk-studio@skills-dir` loads inside the sandbox, and fails loudly naming the mount when it is absent

**Given** runbook §3.8 and §3.5
**When** the story lands
**Then** `sbx create` is documented with the skills mount set read-only, the per-sandbox plugin install is removed from the provisioning list, and the "sandbox store" drift case (the mounted folder differing from the host's) is named with its fix

**Given** one existing sandbox on the box
**When** the operator recreates it with the mount (exact commands provided; from PowerShell, with the daemon running)
**Then** `tk activate` inside it is clean on four planes, a headless drive of one skill from inside it substitutes `${CLAUDE_PLUGIN_ROOT}` to the mounted path, and the per-sandbox syscall cost of the skills folder is measured once and recorded in the kb (the red team's "prove it on the box" item)
<!-- SECTION:DESCRIPTION:END -->
