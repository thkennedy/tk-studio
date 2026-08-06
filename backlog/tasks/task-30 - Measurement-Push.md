---
id: TASK-30
title: Measurement Push
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-08-06 19:26'
labels:
  - ST-030
milestone: The Studio Measures and Fixes Itself
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a teammate,
I want my local ledger pushed as a PR into the shared repo,
So that individual installs report through plain git governance with review as the membrane.

**Acceptance Criteria:**

**Given** a local ledger with unpushed events
**When** `tk-studio-measure-push` runs
**Then** it creates a feature branch, commits the ledger to `measurements/<user>-<machine>.jsonl`, and opens a PR — never pushing to main, never merging itself
**And** a sanitization re-check runs pre-commit; a credential-shaped finding blocks the push

**Given** repeated pushes from the same machine
**When** the skill runs again
**Then** it appends/updates that machine's file only (per-user-per-machine, never a shared file) and handles an open prior PR gracefully
<!-- SECTION:DESCRIPTION:END -->
