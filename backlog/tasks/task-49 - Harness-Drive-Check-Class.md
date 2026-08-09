---
id: TASK-49
title: Harness-Drive Check Class
status: In Progress
assignee: []
created_date: '2026-08-09 10:07'
updated_date: '2026-08-09 10:08'
labels:
  - ST-049
milestone: Denied Permissions Refuse Loudly
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a maintainer of the conformance suite,
I want a check class that drives a surface through the real harness under a permission profile denying its deterministic core,
So that the layer where PROP-005's failure actually happened — the skill instruction layer above the core — is the layer the suite proves.

**Acceptance Criteria:**

**Given** a harness run transcript ending in a valid terminal status block with `status: blocked` whose reason names the unrunnable core
**When** the harness-drive assertion evaluates it
**Then** the check passes — and a transcript that asks a question, ends without the block, or exceeds the wall-clock bound fails with the gap named in the check detail

**Given** the lib unit suite
**When** it runs
**Then** the assertion logic is pinned against fake transcripts for each outcome class (blocked-with-block passes; question-without-block, missing block, and timeout each fail) with no live harness invocation and no spend, and the suite stays green
<!-- SECTION:DESCRIPTION:END -->
