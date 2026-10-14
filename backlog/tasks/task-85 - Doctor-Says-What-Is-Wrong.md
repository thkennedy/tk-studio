---
id: TASK-85
title: Doctor Says What Is Wrong
status: To Do
assignee: []
created_date: '2026-10-14 19:41'
labels:
  - ST-085
milestone: One Installer Writes the Studio
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator provisioning the next box,
I want `tk-studio doctor` to run the runbook's smoke table and the trust checks and name every failure with its fix,
So that a fresh machine reaches a working studio from facts, not from reading section 7.

**Acceptance Criteria:**

**Given** `tk-studio doctor`
**When** it runs
**Then** it checks and reports, each with pass, fail and the fix: Claude Code version against the roster floor; the skills-dir plugin against the roster (Story 25.3's cases); the per-user store; `sbx daemon status` **only** (it never runs an sbx command that would auto-start the daemon); folder trust (`hasTrustDialogAccepted`) for every root in the registry (holes 14 and 15); long paths; the PATH launcher; the Tailscale certificate age against its 90-day life; the supervisor's slot or checkout and whether `/status` answers; and, when a Hermes home exists on the box, whether `auth.adopt_external_logins` is on (a warning that names the setting and the Claude-login risk)

**Given** `--json`
**When** it runs headless
**Then** the output is one JSON object and ends with the status block (AD-11); a conformance drive covers it

**Given** runbook §7
**When** the story lands
**Then** its smoke table says "run `tk-studio doctor`" and keeps only the rows the CLI cannot check (RDP scope, the Startup shortcut's visible tab)
<!-- SECTION:DESCRIPTION:END -->
