---
id: TASK-4
title: Activation Health and Drift Check
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-004
milestone: Install Once, Stay in Lockstep
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want activation to prove both planes are current — read-only and loud,
So that version skew is caught at the front door instead of debugged as ghosts.

**Acceptance Criteria:**

**Given** an installed BMad base and studio plugin
**When** the `tk-studio-activate` check runs
**Then** it compares installed `_bmad` manifest versions against `bmad.lock` and the installed plugin version against `marketplace.json`
**And** reports drift with the exact guided fix (`tk install` / `/plugin marketplace update`) without mutating anything
**And** emits `drift-detection` (on drift) or a clean-pass event, plus `onboarding-funnel` timings when run in guided onboarding mode

**Given** a machine where a check step itself fails (unreadable manifest, missing store)
**When** the check runs
**Then** the failure is reported as `activation-failure` with the failing step named, and the skill still ends with a valid JSON status block
<!-- SECTION:DESCRIPTION:END -->
