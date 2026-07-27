---
id: TASK-1
title: Install the Studio Plugin from the Repo
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-001
milestone: Install Once, Stay in Lockstep
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want cloning and trusting the tk-studio repo to auto-prompt installation of the studio plugin,
So that a new machine or teammate gets the studio layer with zero manual marketplace setup.

**Acceptance Criteria:**

**Given** a fresh clone of the tk-studio repo on a machine with Claude Code
**When** the operator trusts the folder
**Then** the marketplace defined in `.claude-plugin/marketplace.json` is auto-prompted via `extraKnownMarketplaces` in the repo's `.claude/settings.json`
**And** accepting installs the `tk-studio` plugin whose `plugin.json` version is in lockstep with `marketplace.json` (`plugins[].version`)

**Given** the plugin skeleton in `plugins/tk-studio/`
**When** the plugin is installed
**Then** `skills/`, `agents/`, `contracts/`, and `bmad.lock` locations exist per the spine's structural seed, and a placeholder skill resolves `{skill-root}` correctly machine-wide
<!-- SECTION:DESCRIPTION:END -->
