---
id: TASK-10
title: Agent-First Knowledge Base
status: Done
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-010
milestone: Data Lands Where It Belongs
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want each project's knowledge in `kb/` with a ranked index,
So that agents retrieve project knowledge in one hop and humans read the same files.

**Acceptance Criteria:**

**Given** an onboarded project without `kb/`
**When** kb standup runs
**Then** `{project-root}/kb/` is created with an llms.txt-style `index.md` (ranked links + one-line descriptions)

**Given** kb content changes
**When** index generation reruns (manually or as a job)
**Then** `index.md` reflects current files without human reordering, and the diff is review-friendly
<!-- SECTION:DESCRIPTION:END -->
