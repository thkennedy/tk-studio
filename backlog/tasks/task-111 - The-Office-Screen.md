---
id: TASK-111
title: The Office Screen
status: Done
assignee: []
created_date: '2026-10-19 17:32'
updated_date: '2026-10-19 21:24'
labels:
  - ST-111
milestone: "Studio Web v0: Office, Board, Status"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the office floor to show each project's agents as characters whose pose follows their semantic state, with a HUD for the run and the story in flight,
So that a glance at the screen says what the studio is doing (§6.3, §7.3).

**Acceptance Criteria:**

**Given** the registry's agents for the selected project (`GET /agents?project=<id>`) and the store of Story 30.3
**When** the Office screen renders
**Then** each agent is one character at a desk on the PixiJS floor, named by its role, whose pose is one of the eight office states of §7.3 (`offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`), each state a distinct, looping frame set from the sheet; a state change swaps the frame set within one frame without a flicker; `waiting-for-human` and `blocked` add a React DOM bubble over the character naming what it waits for (the projection's reason)

**Given** a project with a live run
**When** the HUD renders
**Then** it shows the project, the run id and state, the story in flight with its progress (`office.progress`: done, failed and total stories, the current story's phase), the engine run id and the time since the last event; with no live run it shows the last ended run's end state and PR link; a project switcher lists the registry's projects and remembers the choice per browser

**Given** the screen
**When** it is tested
**Then** vitest covers the state-to-frames mapping for all eight states, the bubble rule, the HUD's fields from a fixture store, and the project switcher; the canvas is driven through the renderer's exported scene functions so the tests need no WebGL
<!-- SECTION:DESCRIPTION:END -->
