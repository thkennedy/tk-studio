---
id: TASK-82
title: The Installer Writes the Skills-Dir Plugin
status: To Do
assignee: []
created_date: '2026-10-14 19:41'
labels:
  - ST-082
milestone: One Installer Writes the Studio
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a user of any machine with Claude Code signed in,
I want the plugin written to `~/.claude/skills/tk-studio/` from the verified release zip, with every marketplace copy removed,
So that Claude Code loads the studio in place with no clone, no cache copy and nothing shadowing it.

**Acceptance Criteria:**

**Given** `tk-studio install` or `update` and a roster
**When** the plugin leg runs
**Then** it downloads the plugin zip by the roster's tag, verifies the SHA-256 before extracting, writes the folder atomically (new folder beside, rename over; the previous folder kept until the next successful start), and the result names the version written; a digest mismatch refuses by name and leaves the existing folder untouched

**Given** the developer's own checkout
**When** `tk-studio install --link <checkout>` runs
**Then** the folder is a junction (Windows) or symlink to `<checkout>/plugins/tk-studio`, so edits are live, and `doctor` reports "link mode" with the target

**Given** a marketplace copy of `tk-studio` at user or project scope
**When** the plugin leg runs
**Then** it uninstalls the user-scope copy (`claude plugin uninstall`) and removes the `tk-studio` marketplace from the user's known marketplaces, reports every project-scope `enabledPlugins` or `extraKnownMarketplaces` entry it finds without editing another project's tracked files, and this repository drops its own committed `extraKnownMarketplaces` and `enabledPlugins` entries in the same story

**Given** the written folder
**When** `claude plugin list` and `claude plugin validate` run and a probe skill is invoked headless
**Then** the plugin loads as `tk-studio@skills-dir`, validation passes, and `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` substitute as forward-slash paths (the 2026-10-09 probe, now a test the story runs on the box); `claude plugin eval` is tried against the folder and the outcome recorded in the kb (the open question closes either way)
<!-- SECTION:DESCRIPTION:END -->
