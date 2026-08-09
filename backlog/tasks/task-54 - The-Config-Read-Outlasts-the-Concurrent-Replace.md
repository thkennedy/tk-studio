---
id: TASK-54
title: The Config Read Outlasts the Concurrent Replace
status: Done
assignee: []
created_date: '2026-08-09 23:23'
updated_date: '2026-08-09 23:28'
labels:
  - ST-054
milestone: The Store-Standup Read Retry
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a studio surface emitting my first measurement event while sibling processes stand up the same store,
I want the store's config read to outlast a concurrent atomic replace,
So that a transient Windows sharing violation never fails an emit that would have succeeded a moment later.

**Acceptance Criteria:**

**Given** a config.yaml read that hits a transient PermissionError while a concurrent standup replaces the file
**When** read_config or ensure_store reads it
**Then** the read retries with bounded backoff and returns the parsed config once the replace settles — the transient never reaches the caller

**Given** a PermissionError that persists past the retry budget
**When** the read path exhausts its bounded attempts
**Then** the error raises to the caller unchanged — never an infinite wait, never a swallowed real denial

**Given** the lib suite
**When** it runs
**Then** the retry is unit-pinned (transient-then-success returns the parsed config; persistent raises after the bounded attempts), the test_ledger concurrency test stays untouched as the live race probe, miniyaml carries no retry, and the full suite is green
<!-- SECTION:DESCRIPTION:END -->
