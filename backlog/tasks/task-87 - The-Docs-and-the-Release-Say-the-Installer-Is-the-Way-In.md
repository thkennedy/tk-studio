---
id: TASK-87
title: The Docs and the Release Say the Installer Is the Way In
status: To Do
assignee: []
created_date: '2026-10-14 19:41'
labels:
  - ST-087
milestone: One Installer Writes the Studio
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a reader of the repository,
I want the README, the install runbooks and the kb to describe the installer as the only install path and the marketplace as the developer catalog,
So that nobody follows the retired path.

**Acceptance Criteria:**

**Given** `README.md`, `kb/offline-install-runbook.md`, `kb/agent-pc-setup-runbook.md` §3.4 and `kb/claude-plugin-archive-install-envelope.md`
**When** the story lands
**Then** the README's install section is the one-line bootstrap plus `tk-studio install`; the offline runbook describes the skills-dir write from a downloaded zip; §3.4 drops `claude plugin marketplace add` for users and keeps it, pinned to a tag, under a "developers who clone" note; the envelope document is marked historical with a pointer here; the kb index regenerates; the skills-dir form carries a "deprecation watch" line naming where to look

**Given** the release gate
**When** the story closes
**Then** the plugin ships at 0.3.0 (a minor bump: the distribution changed) through the generalised motion with the roster, `released-roster.json` and `plugin.json` in lockstep (gate ×4), the lib suite and conformance are green, and `tk activate` is clean on all four planes on TIM-PC-2 with the plugin loaded from the skills-dir folder
<!-- SECTION:DESCRIPTION:END -->
