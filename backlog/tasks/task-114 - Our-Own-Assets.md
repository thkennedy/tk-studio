---
id: TASK-114
title: Our Own Assets
status: To Do
assignee: []
created_date: '2026-10-19 17:32'
labels:
  - ST-114
milestone: "Studio Web v0: Office, Board, Status"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the studio's developer,
I want the floor, the desks and the characters drawn as our own sprite sheet with a documented pipeline,
So that the office looks like ours and the repository owns every pixel it ships (D6).

**Acceptance Criteria:**

**Given** the art tools on the PC (Adobe Creative Cloud or a tool with agentic or MCP support, the operator's choice named in the record)
**When** the pipeline is built
**Then** `apps/studio-web/assets/` holds the source files and `tools/sprites/` a script that exports the committed sheet `apps/studio-web/public/sprites/office.png` plus its JSON atlas (frame names `<role>.<state>.<n>`, 16 by 16 or 32 by 32 tiles, nearest-friendly, no anti-aliased edges), the export is reproducible (the same source gives the same bytes, checked by a test), and the sheet carries the floor, one desk, and every role of the registry in every office state of §7.3 with at least two frames per looping state

**Given** the sheet
**When** the Office screen uses it
**Then** the placeholder sheet of Story 30.1 is deleted, the renderer's frame sets come from the atlas by name, and a missing frame for a (role, state) falls back to the role's `idle` frames with a console warning naming the gap; `kb/studio-web-assets.md` records the tool, the pipeline, the format and the credits (none owed: our own work)
<!-- SECTION:DESCRIPTION:END -->
