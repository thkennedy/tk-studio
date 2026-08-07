---
id: TASK-36
title: Research Anchors and Seeds
status: To Do
assignee: []
created_date: '2026-08-07 04:34'
labels:
  - ST-036
milestone: Research Becomes Knowledge
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator running chartered research,
I want findings to cite anchors and runs to carry seeds inheriting the project spine,
So that research output joins the knowledge lifecycle instead of stranding in the run workspace.

**Acceptance Criteria:**

**Given** `lib/research.py` findings
**When** a finding is recorded
**Then** the finding shape gains an optional `anchor` citation, and run workspaces gain `seed.md` (with `inherits:` spine anchors) — blocked conditions unchanged

**Given** a project without a spine
**When** a research run executes
**Then** the run proceeds (aid, not gate) and the missing spine is reported, with the spine authored as a chartered research-run flavor at project scope (`knowledge/spine.md` in the per-user store — D2)
<!-- SECTION:DESCRIPTION:END -->
