---
id: TASK-15
title: Backlog.md Projection
status: Done
assignee:
  - tim
created_date: '2026-07-27 03:35'
updated_date: '2026-07-27 03:49'
labels:
  - ST-015
milestone: Plan Locally, Canonically
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want canonical entities projected into a Backlog.md kanban,
So that I get a board and CLI over planning data without those files becoming a second source of truth.

**Acceptance Criteria:**

**Given** a project bound to `backlog-md`
**When** promote runs
**Then** canonical entities project into a Backlog.md-compatible `backlog/` folder (epic → milestone + label; story/task → tasks), recording per-entity `external.backlog-md` state (key, synced_at, content_hash)
**And** the build first verifies Backlog.md's handling of unknown frontmatter keys, falling back to native-keys+id-label projection if unsupported (spine Deferred item)

**Given** a human edit on the kanban (status drag, assignee)
**When** pull-back runs
**Then** only status-class fields update canonical files, with echo suppression (unchanged-vs-snapshot ignored) and both-changed conflicts surfaced for a human

**Given** a canonical status Backlog.md cannot represent (e.g. `review`)
**When** a promote+pull-back round trip occurs with no external change
**Then** the canonical status is unchanged (round-trip stability, AD-5)
<!-- SECTION:DESCRIPTION:END -->
