---
id: TASK-125
title: The Scope of Work on Confluence
status: To Do
assignee: []
created_date: '2026-10-25 03:13'
labels:
  - ST-125
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want a scope-of-work page I can edit where I read everything else,
So that the deliverables, their acceptance signals, the exclusions and the dated dependencies are fixed before any run (F2 step 3; B5 items 1 and 3).

**Acceptance Criteria:**

**Given** `scoping`
**When** the planner writes `engage.py scope` from the turn's `scope.md` (the sections, in order: goal; deliverables, each with its acceptance signal; exclusions; what the studio needs from the owner, each dependency dated; milestones; proposed epics and stories in `epics.md`'s story shape)
**Then** 31.3's publish puts the page in the engagement's Confluence folder (`Engagements/ENG-NNN/Scope of Work`; provenance footer; skipped by content hash when unchanged) and `scope_page {id, url, version}` is recorded; the proposed epics and stories are not plan entities yet (nothing under `plan/` before approval, 32.6); a scope with a deliverable lacking an acceptance signal is refused by name

**Given** the owner edits the page in Confluence, or sends `revise` with a body from the Chat screen
**When** the next sync-back mirrors the page (31.4, `kb/confluence/`) or the input arrives
**Then** the revision replaces `scope.md` wholesale (the page is authoritative while `scoping`, D9; a `revise` body becomes the new page), a `revise` in `quoted` returns the state to `scoping` and voids the quote, and the planner's next turn reads the new scope; the lib suite covers the round trip (Markdown to storage format to mirrored Markdown keeps every section), the replace rule and the refusal with a fake Confluence REST
<!-- SECTION:DESCRIPTION:END -->
