---
id: TASK-62
title: Contract 0.1.17 Names the Supervisor and Hermes
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-062
milestone: The Contract Names Its Drivers and Carries Cost
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a driver author,
I want the contract to name its conformant drivers and say that any of them may execute a run,
So that the studio supervisor is a first-class consumer while the studio itself still grows no UI.

**Acceptance Criteria:**

**Given** `driver-contract.md` at 0.1.16
**When** the patch lands
**Then** the header reads 0.1.17 with a changelog clause marking it additive; §7 row 6 names the studio supervisor (status page) and Hermes (front door) as the consumers that carry UI, in place of ClaudeOS, and still states the studio grows no UI; the Audience line and every other row that names ClaudeOS as the driver are updated

**Given** the contract
**When** a driver author looks for who drives the studio
**Then** a driver roster lists the studio supervisor (executing wrapper, status page), Hermes (front door that submits jobs to the supervisor and never executes a run), and direct invocation (a conforming driver per §1)

**Given** §2
**When** read
**Then** it states that the executing wrapper for a run is whichever conformant driver executed its `wake` directive, and that `account` and `finish` are that wrapper's duty

**Given** §1 and §4
**When** read
**Then** §1 points to §2 for per-skill CLIs and to §3 for the status block, and the §4 `finish` row documents the optional `total_cost_usd` from Story 20.1

**Given** the release gate
**When** the story closes
**Then** `runner.py run` is ok over every surface, the lib suite is green, the release motion (`tools/release_archive.py`) ships the plugin at its next patch version with the gate ×3 in lockstep and a verified archive, the scoped plugin update lands it on the agent PC, and `tk activate` is clean on all four planes
<!-- SECTION:DESCRIPTION:END -->
