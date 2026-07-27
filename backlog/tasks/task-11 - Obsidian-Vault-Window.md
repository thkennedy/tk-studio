---
id: TASK-11
title: Obsidian Vault Window
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-011
milestone: Data Lands Where It Belongs
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want each project's kb and backlog visible in my vault under one folder,
So that I get one human window over all projects without the vault becoming a database.

**Acceptance Criteria:**

**Given** a user config with `obsidian_vault` set
**When** onboarding links a project
**Then** `<vault>/projects/<name>/` exists containing links: `kb` → `{project-root}/kb/`, `backlog` → the bound planning folder — directory junctions on Windows (no admin), symlinks elsewhere

**Given** a broken or missing link
**When** activation runs
**Then** the vault-link state is reported (and recorded in the registry entry) with a guided fix — never auto-recreated silently

**Given** no vault is configured
**When** onboarding runs
**Then** linking is skipped cleanly and everything else proceeds (vault is a view, never a dependency)
<!-- SECTION:DESCRIPTION:END -->
