---
id: TASK-94
title: The Supervisor Holds the Engine and Nothing Else Starts One
status: To Do
assignee: []
created_date: '2026-10-15 19:21'
labels:
  - ST-094
milestone: "The Service Owns Lifetime, Part 2: The Supervisor"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the supervisor itself to start, hold, pin and release every engine sandbox, and the queue to be the only way a run starts,
So that an engine never dies with a host-side shell (hole 7) and the pacer never overlaps a run it cannot see (DW-6, DW-3).

**Acceptance Criteria:**

**Given** an sbx-tier run
**When** the worker starts
**Then** the supervisor runs `sbx run -d --name <sandbox>` to pin the sandbox, holds its own `sbx exec` for the engine's lifetime from the console session (never a Claude desktop-app session), records the in-VM engine pid and the sandbox name on the run, and releases the pin (`sbx stop`) when the run ends and no other run holds the sandbox

**Given** a cancel or a tripped guard on an sbx run
**When** it fires
**Then** the engine's process group inside the microVM is killed by name of the recorded pid through `sbx exec` (argv only, no shell), the kill is recorded, and a kill that leaves the pid alive after its wait holds the run as DW-3 specifies

**Given** `jobrun.py submit|wake` run by hand or through the MCP `tk_job` surface on a project the supervisor serves
**When** it would start a run
**Then** the supervisor's lock file for the checkout names the queue as the only starter, the hand-started run is recorded as `external` on the next tick with its studio run id, and the pacer counts it as live until it ends (DW-6 closed)

**Given** the supervisor's test suite
**When** it runs
**Then** the pin, hold, release, kill-by-pid and external-run detection are pinned with a fake `sbx`, on both hosts
<!-- SECTION:DESCRIPTION:END -->
