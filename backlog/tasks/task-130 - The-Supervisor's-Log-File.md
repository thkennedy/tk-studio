---
id: TASK-130
title: "The Supervisor's Log File"
status: Done
assignee: []
created_date: '2026-10-26 16:40'
updated_date: '2026-10-26 21:28'
labels:
  - ST-130
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the supervisor to write what its console shows into a file on disk,
So that a tab that dies leaves its cause behind and a session can read the last pass without the screen (hole 66).

**Acceptance Criteria:**

**Given** `start.ps1` and the three bun processes it runs (`serve`, `tick`, `drain`)
**When** the supervisor runs
**Then** every line the console shows is also appended to `<TK_SUPERVISOR_WORK>\supervisor\logs\supervisor-<YYYY-MM-DD>.log` (one file per UTC day, the last 14 kept, each line stamped `<ISO time> [serve|tick|drain|keeper|pacer]`), with explicit `started`, `stopped (<why>)` and `uncaught: <error>` lines from the script and from each process's exit; a line never carries a value of a `TK_SUPERVISOR_*` variable or any token (the page's redaction applies); `GET /status` gains `log {path, last_lines[]}` (the last 20 lines, redacted; contract 0.1.28, additive) and the HTML status page shows them

**Given** the log
**When** `tk-studio doctor` runs
**Then** it reports the newest log's last `stopped` or `uncaught` line and its age when the API does not answer, and "no log" when the folder is absent; `bun test` covers the line shape, the rotation and the redaction with a fake clock; the runbook's hole-66 row names the file
<!-- SECTION:DESCRIPTION:END -->
