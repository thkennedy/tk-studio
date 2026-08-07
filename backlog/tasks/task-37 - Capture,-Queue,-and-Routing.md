---
id: TASK-37
title: Capture, Queue, and Routing
status: In Progress
assignee: []
created_date: '2026-08-07 04:34'
updated_date: '2026-08-07 06:29'
labels:
  - ST-037
milestone: Research Becomes Knowledge
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want run-finish delta capture into a per-project queue with a rendered routing doc,
So that corrections accumulate durably off-VCS and a human can see what wants promotion.

**Acceptance Criteria:**

**Given** a run finishing with deltas in its handoff
**When** the capture hook runs (riding the executing wrapper's finish)
**Then** deltas append to `~/.tk-studio/projects/<key>/knowledge/reconciliation-queue.jsonl`, deduped on `(run_id, anchor, verdict, reality, tier)` — per-user store only, never project VCS (AD-3; the planning brief's `note` field was renamed `reality` when ST-9.1 closed the delta shape, and `tier` joined the key at the ST-9.4 review — a spine-tier escalation is a distinct routing event; `knowledge.schema.json` is authoritative)

**Given** a populated queue
**When** the routing renderer runs
**Then** a routing doc renders beside the queue — pure renderer, applies nothing

**Given** a sandbox project
**When** the e2e drive runs (the run the source never had)
**Then** a run emits deltas → the queue materializes → the routing doc renders, asserted end to end
<!-- SECTION:DESCRIPTION:END -->
