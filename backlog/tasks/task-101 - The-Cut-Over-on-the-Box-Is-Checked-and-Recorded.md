---
id: TASK-101
title: The Cut-Over on the Box Is Checked and Recorded
status: To Do
assignee: []
created_date: '2026-10-16 20:11'
labels:
  - ST-101
milestone: "The Supervisor Moves In: One Repository"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the service cut-over checked by the tooling and the record complete,
So that the old repository can be archived with nothing left pointing at it.

**Acceptance Criteria:**

**Given** the Startup shortcut retargeted to `C:\GitHub\tk-studio\apps\supervisor\start.ps1` by Tim and `bun install --frozen-lockfile` run in `apps/supervisor`
**When** `tk-studio doctor` runs on the agent PC
**Then** it reports the supervisor's root as the nested root, the registry root in agreement, folder trust for the nested root (trust has no inheritance; runbook §4.1), and the Startup shortcut's target (read from the `.lnk`), each `ok` or named; the checks are pinned with fakes in the lib suite and run for real on the box by the attended session

**Given** the supervisor started from the console from its new root
**When** the smoke test runs (`curl /status` from another device; one queued job to a guarded end)
**Then** both pass and the results are recorded in the PR; `TK_STUDIO_ROOT`, `TK_SUPERVISOR_*` and `set-supervisor-env.ps1` are unchanged

**Given** the record
**When** the story closes
**Then** runbook §3.8 and §4 describe the one-repository layout and sandbox; the handoff names the cut-over date and the archive; the spine's AD-21 carries a "done" note with the date; the observation ledger has every hole found during rehearsal; and `thkennedy/tk-studio-supervisor` is archived by Tim (`gh repo archive`), never deleted
<!-- SECTION:DESCRIPTION:END -->
