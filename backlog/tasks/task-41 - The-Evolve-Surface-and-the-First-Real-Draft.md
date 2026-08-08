---
id: TASK-41
title: The Evolve Surface and the First Real Draft
status: Done
assignee: []
created_date: '2026-08-07 23:49'
updated_date: '2026-08-08 03:17'
labels:
  - ST-041
milestone: Observation Becomes Proposal
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want a `tk-studio-evolve` skill drafting proposals on demand with per-outcome headless postures,
So that the ledger's real accumulated observations become triageable proposals through one contract-shaped surface.

**Acceptance Criteria:**

**Given** the `tk-studio-evolve` skill (`draft` verb; payload `directory`, `dry_run?`)
**When** invoked attended or headless
**Then** behavior is identical (AD-11), the headless posture states its refusal behavior per-outcome — never a blanket exit-code rule (team agreement 5) — and every headless run ends with the JSON status block

**Given** the real merged measurement data
**When** the first draft runs
**Then** genuine PROP rows derive from the accumulated events (the planning pass §5 grounding classes expected) and the drafting run triggers nothing beyond the ledger sync — no auto-apply, no scaffolding, no follow-on writes (D1)
<!-- SECTION:DESCRIPTION:END -->
