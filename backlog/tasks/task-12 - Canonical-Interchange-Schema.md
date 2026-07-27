---
id: TASK-12
title: Canonical Interchange Schema
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-012
milestone: Plan Locally, Canonically
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a developer using planning skills,
I want the canonical epic/story/task shape published as a versioned schema,
So that every backend adapter and migration maps to one authoritative contract.

**Acceptance Criteria:**

**Given** the interchange schema (`shape_version: 1`) in `contracts/`
**When** an entity file is validated against it
**Then** required keys (id, type, title, status enum, created/updated) and optional keys (parent, depends_on, priority, assignee, labels, external map) are enforced, with the status enum closed (draft|ready|in-progress|blocked|review|done|dropped)

**Given** a validation library shipped with the plugin
**When** any adapter or skill checks an entity
**Then** it uses this library (stdlib-only Python, `uv run`) — no adapter ships its own parser
<!-- SECTION:DESCRIPTION:END -->
