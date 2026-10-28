---
id: TASK-151
title: The Closeout Carries the Proof
status: To Do
assignee: []
created_date: '2026-10-27 23:26'
labels:
  - ST-151
milestone: Loop Hygiene 2, the Slice Path Hardened
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want the engagement's closeout page to carry each slice's sampled frames and `report.json` beside the contact sheet and the verdicts, each story reading its own leg's sheet, and the closeout's smaller edges closed,
So that the page I read is the whole proof (DW-77, DW-92; the retrospective's B15).

**Acceptance Criteria:**

**Given** a slice run's closeout
**When** `delivery.ts composeCloseout` composes and `engage.py closeout` publishes
**Then** the closeout input carries each slice's `report.json` and its sampled frames (paths under the run workspace), the page attaches the sheet and the frames and embeds the report's verdict table, and each story reads its own leg's sheet, not the run's last (`delivery.ts:240-245`); the contract (0.1.30, additive) names the closeout input's media shape and the engagement conformance drive is extended

**Given** the edges
**When** a run hits them
**Then** `playable` declared without `verify.engine` reads `skipped: no verify.engine`, not `engine gate not green` (`hostverify.ts:420-421`); `recommend.py` reads a `.mcp.json` with a BOM (`utf-8-sig`, `:528`, as `engine_pin.py:134` does); a moment at tick ≥ `--ticks` is captured on the last tick (`playable.py:302-314`); `enginemcp.ts` starts the server in the folder whose config it read (`run.prefix`, `:398-426`); the `scoping` revise path sets `game: true` (`engage.py:1190-1196`); each with a test

**Given** the lib and supervisor suites and conformance
**When** they run
**Then** the closeout's media and the five edges are covered; DW-77 and DW-92 close by this PR; the design spec's feature-ledger Phase 3 row is untouched (the TUA acceptance stays the operator's, AI-1)
<!-- SECTION:DESCRIPTION:END -->
