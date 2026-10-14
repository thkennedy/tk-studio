---
id: TASK-84
title: The Bootstrap and the Meta-CLI
status: To Do
assignee: []
created_date: '2026-10-14 19:41'
labels:
  - ST-084
milestone: One Installer Writes the Studio
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a newcomer,
I want one command that installs a small self-updating CLI, and that CLI to install and update the three apps from the roster,
So that I never clone a repository or hand-edit an environment to run the studio.

**Acceptance Criteria:**

**Given** `tools/installer/install.ps1` and `install.sh`
**When** either runs
**Then** it installs the pinned `uv` unmanaged into the studio's tools folder (version and SHA-256 embedded in the script), verifies the meta-CLI wheel's digest, runs `uv tool install` from that wheel, puts only the studio's `bin` directory on the user PATH, turns on long paths for git, never clones, and the README publishes each script's SHA-256 with a download-verify-run alternative

**Given** the meta-CLI `tk-studio` (stdlib Python, shipped as a wheel on its own `cli--vX.Y.Z` tag)
**When** `install`, `update` or `status` runs
**Then** the supervisor leg downloads the release zip by tag, verifies it, unpacks it into `%LOCALAPPDATA%\tk-studio\supervisor\<version>\` (or the platform equivalent), runs `bun install --frozen-lockfile` with the roster's pinned Bun, writes the User environment and the Startup shortcut through the logic lifted from `tools/agent-pc/set-supervisor-env.ps1` (token and session secret generated once and kept), and points `current.json` at the slot; the studio-web leg unpacks the bundle into its own slot that the supervisor serves; `update` stops the service tab first, renames the old slot aside, verifies the new one starts, and deletes the old on the next successful start; `status` prints each component's installed and roster versions

**Given** a machine where the supervisor runs from a git checkout (the dev box)
**When** `update` or `doctor` runs
**Then** it recognises "source checkout" mode, reports instead of replacing, and names the checkout

**Given** the lib suite
**When** it runs
**Then** every verb is exercised against a fake roster, a fake release host and a fake `claude`, including the digest-mismatch, the stale-slot and the source-checkout cases, and no network call is made in tests
<!-- SECTION:DESCRIPTION:END -->
