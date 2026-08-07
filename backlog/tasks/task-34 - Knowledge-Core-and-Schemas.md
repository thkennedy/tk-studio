---
id: TASK-34
title: Knowledge Core and Schemas
status: Done
assignee: []
created_date: '2026-08-07 04:34'
updated_date: '2026-08-07 04:40'
labels:
  - ST-034
milestone: Research Becomes Knowledge
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a developer,
I want a pure knowledge validator and published schemas for spines, seeds, deltas, and the queue,
So that every later story builds on one authoritative shape with the source's proven rejection rules.

**Acceptance Criteria:**

**Given** `lib/knowledge.py` (stdlib-only, pure — no fs, no I/O, no globals) and `knowledge.schema.json` in `contracts/`
**When** a spine or seed artifact is validated
**Then** the supersede header is enforced verbatim (`status: provisional` + `authority: mission-scoped-supersedes-canonical`), anchor ids match the grammar `SPINE-A<n>` / `SEED-<run-id>-A<n>` (append-only), and tier rules hold
**And** the A/B/C/D grade vocabulary applies, with the source-vocabulary mapping (Confirmed→A, independent-agreement→B, Deduced→C, Hypothesized→D) documented in the schema doc (D1)

**Given** a delta citing an anchor
**When** it is parsed
**Then** the closed shape `{anchor, verdict: WRONG|STALE|CONFIRMED, reality, evidence, tier: run-local|spine}` is enforced, and unanchored or dangling deltas are named rejections — never silently dropped

**Given** the source validator's unit cases (ported from the first driver's `knowledge-schema.ts`)
**When** the test suite runs
**Then** every ported case passes against `lib/knowledge.py`
<!-- SECTION:DESCRIPTION:END -->
