---
id: TASK-133
title: "The Host Leg Runs the Supervisor's Suites"
status: Done
assignee: []
created_date: '2026-10-26 16:40'
updated_date: '2026-10-27 00:22'
labels:
  - ST-133
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want `tools/verify_host.py` to run the supervisor's test suites when `apps/supervisor` changed,
So that a Windows-only failure is caught by the gate and not by a hand recipe, and the suites stop leaking temp folders (holes 63, 64, 51, 56).

**Acceptance Criteria:**

**Given** a run whose diff touches `apps/supervisor`
**When** the host leg runs
**Then** `verify_host.py` adds a `supervisor` gate after `conformance`: each `test/*.test.ts` file but the e2e command-line suite in its own `bun test` under a per-file timeout (420 s), with every `TK_SUPERVISOR_*` variable stripped from its environment and `TMPDIR`/`TEMP` pointing at a per-run folder under the run's worktree that the gate removes afterwards, then `bunx tsc --noEmit -p apps/supervisor`; the gate's lines name each file's pass/fail counts and the slowest file; an unchanged `apps/supervisor` skips it like the studio-web gate; the recipe the handoff carried (hole 51/56) retires

**Given** the suites
**When** they create temp directories and queues
**Then** a shared helper `apps/supervisor/test/tmp.ts` owns `mkdtemp`, the queues opened inside it and the removal in `afterAll` (queues closed first, hole 63), every suite uses it, and a run of the whole gate leaves no `tk-sup-*` folder behind; `tk-studio doctor` warns when the user's Temp holds more than 500 `tk-sup-*` folders and names the cleanup; the runbook's hole-64 row is updated
<!-- SECTION:DESCRIPTION:END -->
