---
id: TASK-25
title: Harness-Native Execution
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-08-06 18:43'
labels:
  - ST-025
milestone: Work Runs While Nobody Watches
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want `tk-studio-job` to run any declared job on the harness's own primitives,
So that scheduling rides the ecosystem instead of a bespoke runner.

**Acceptance Criteria:**

**Given** a declared job and the harness-native binding
**When** the job verbs run (submit / status / cancel)
**Then** one-shot jobs execute immediately or at their time; recurring jobs bind to harness scheduling (cron/loop/self-paced wakeup) with declared cadence
**And** budget guards and stop conditions terminate the run with a `partial` status and reason when hit

**Given** the session-scoped nature of local harness schedules
**When** a job is declared durable-recurring
**Then** the definition records the durability requirement and the binding surfaces the constraint (cloud routine or external harness needed) instead of silently losing the schedule
<!-- SECTION:DESCRIPTION:END -->
