---
id: TASK-18
title: Recommend, Confirm, Record
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-018
milestone: The Studio Knows Your Project
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator with a role,
I want a role × project working set proposed with evidence and recorded only on my confirmation,
So that activation is deterministic afterward and an engineer and an artist get different sets on the same repo.

**Acceptance Criteria:**

**Given** inventory + detection results and the operator's role (per-user store)
**When** `tk-studio-onboard` proposes a working set
**Then** every proposed resource carries its evidence, and dry-run mode shows the full plan without writing

**Given** explicit confirmation
**When** the set is recorded
**Then** it lands in tracked project config under `working_set.<role>` (role-keyed map — AD-17), and re-running onboarding is idempotent

**Given** a second role confirming later on the same project
**When** their set is recorded
**Then** the first role's entry is untouched
<!-- SECTION:DESCRIPTION:END -->
