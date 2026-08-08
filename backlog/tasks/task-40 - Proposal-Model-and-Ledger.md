---
id: TASK-40
title: Proposal Model and Ledger
status: Done
assignee: []
created_date: '2026-08-07 23:49'
updated_date: '2026-08-08 01:09'
labels:
  - ST-040
milestone: Observation Becomes Proposal
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a developer,
I want a proposal core that clusters observation events into stable-id rows with the issues-ledger discipline,
So that observed toil accumulates into an evidenced, updatable record instead of stranding unconsumed in the measurement ledger.

**Acceptance Criteria:**

**Given** `lib/evolve.py` (stdlib-only) and merged `measurements/*.jsonl` containing observation events
**When** a draft run executes
**Then** observation-shaped events cluster into candidate proposals and `proposals/ledger.md` gains or updates stable `PROP-NNN` rows (ids assigned in order, never reused; rows update in place, never deleted; Impact, Status `Draft|Under-review|Adopted|Declined`, Evidence naming events, Candidate change, Affected surfaces, Key, Opened/Updated columns per the ledger header) while defect-shaped events stay consolidate's
**And** reruns are idempotent — stamps derive from evidence-event dates, never the wall clock — and a hand-edited Candidate-change cell is never overwritten (per-column ownership, consolidate-twin)

**Given** an unparseable proposals ledger
**When** a draft run executes
**Then** it refuses to rewrite what it cannot update in place (named block)
<!-- SECTION:DESCRIPTION:END -->
