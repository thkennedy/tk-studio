---
id: TASK-42
title: Contract 0.1.9, Conformance, and the Job Type
status: Done
assignee: []
created_date: '2026-08-07 23:49'
updated_date: '2026-08-08 03:17'
labels:
  - ST-042
milestone: Observation Becomes Proposal
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a harness author,
I want the evolve surface published as an additive bump with conformance coverage and a shipped recurring job type,
So that drivers reach the whole loop through the contract and recurring drafting stays one operator declaration away.

**Acceptance Criteria:**

**Given** driver-contract.md at 0.1.8
**When** the bump lands
**Then** 0.1.9 adds the `tk-studio-evolve` §2 row (blocked: directory missing; measurements outside the studio repo (AD-3); unparseable proposals ledger), `test_driver_contract.py` pins 0.1.9, a conformance manifest row drives the surface including the unparseable-ledger refusal drive, and the taxonomy is untouched (D2)
**And** the shipped `evolve-proposals` job type lands in `jobs/` undeclared — instance declaration stays an operator call (D3) — carrying explicit `trigger` + `cadence` (the 2026-08-07 type-resolution observation)

**Given** the ClaudeOS connector pinned to the 0.1 line
**When** the through-connector suite spot-checks the new surface
**Then** the check passes with no connector change (additive patch, same line)
<!-- SECTION:DESCRIPTION:END -->
