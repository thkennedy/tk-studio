---
id: TASK-83
title: The Drift Check and Conformance Read the Folder and the Roster
status: To Do
assignee: []
created_date: '2026-10-14 19:41'
labels:
  - ST-083
milestone: One Installer Writes the Studio
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want `tk activate`'s plugin plane and the conformance suite's harness-loadable assertion to judge the skills-dir folder against the roster,
So that the drift check keeps telling the truth after the marketplace is gone (AD-13 as amended by AD-21).

**Acceptance Criteria:**

**Given** `drift_check.py`'s plugin plane
**When** it runs on a machine with the skills-dir plugin
**Then** it reads the folder's `plugin.json` version, compares it with the roster's `plugin` entry for the configured channel (and with the in-repo catalog only in a developer checkout), reports `ok`, `stale` (guidance: `tk-studio update`), `missing` (guidance: `tk-studio install`) or `shadowed` (a marketplace copy is installed; guidance names the uninstall), and never reads `installed_plugins.json` as the source of truth; the lib suite pins all four cases

**Given** `contracts/conformance/`
**When** the suite runs
**Then** the harness-loadable assertion reads the skills-dir folder, and the runner can install the built zip into a clean `CLAUDE_CONFIG_DIR` skills folder before driving (`--from-archive <zip>`), so the suite cannot pass against the repository tree for the wrong reason

**Given** the driver contract at 0.1.18
**When** the story lands
**Then** §6 (drift-check invocation) states the folder-and-roster rule, the header reads 0.1.19 with an additive changelog clause, the spine's AD-13 wording "installed plugin version vs `marketplace.json`" is amended to the folder and the roster, and conformance is ok over every surface
<!-- SECTION:DESCRIPTION:END -->
