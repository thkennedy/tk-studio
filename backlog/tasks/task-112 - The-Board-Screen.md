---
id: TASK-112
title: The Board Screen
status: Done
assignee: []
created_date: '2026-10-19 17:32'
updated_date: '2026-10-19 22:46'
labels:
  - ST-112
milestone: "Studio Web v0: Office, Board, Status"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want a board of epics as projects with their stories as phases, the findings draining and the spend against the band, with a Needs-you / Working / Done column,
So that the plan, the runs and the money are read on one screen (§6.3)

**Acceptance Criteria:**

**Given** the plan directory of a served project (`_bmad-output/planning-artifacts/plan/`, the index and the entities) and the queue's runs and PRs
**When** a consumer reads `GET /board?project=<id>` (a new supervisor surface, AD-2, named in the contract's §1 web surfaces at 0.1.25)
**Then** the answer lists the epics with their stories and canonical statuses, each story's latest run (state, PR, host-verify outcome) when one exists, the open deferred-work entries that name the story (the findings), and per epic the metered spend from the ledger's `job-run` events against the epic's band when `.tk-studio/budget-bands.yaml` names one; the answer is cached per plan-directory mtime and rebuilt on change; a project with no plan directory answers an empty board with the reason

**Given** the board
**When** the Board screen renders
**Then** epics are rows of phased bars whose segments are their stories coloured by status, the findings count drains as entries close, the spend bar sits against the band, and three columns triage every live run: Needs-you (paused, awaiting a ruling, a red host leg), Working (running), Done (ended today); each item links to the run's PR and names the ruling it waits for when there is one

**Given** the screen
**When** it is tested
**Then** `bun test` covers the board surface from a fixture plan directory and queue (statuses, findings, spend, the cache), and vitest covers the rows, the columns and the links from a fixture answer
<!-- SECTION:DESCRIPTION:END -->
