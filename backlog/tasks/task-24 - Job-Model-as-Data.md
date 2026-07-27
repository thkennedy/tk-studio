---
id: TASK-24
title: Job Model as Data
status: To Do
assignee: []
created_date: '2026-07-27 03:35'
labels:
  - ST-024
milestone: Work Runs While Nobody Watches
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want jobs declared as data with guards and stop conditions,
So that unattended work is portable across substrates and never runs away.

**Acceptance Criteria:**

**Given** the job-definition schema in `contracts/` (id, target skill + payload, trigger one-shot|cron|loop, cadence fixed|self-paced, budget guards, stop conditions, model/effort)
**When** a job is defined
**Then** generic job types load from the plugin, per-project instances from project config `jobs[]`, and validation rejects a job missing guards or stop conditions

**Given** a job run
**When** it starts
**Then** run state persists in `~/.tk-studio/projects/<key>/runs/<run-id>/`, resumable after interruption
<!-- SECTION:DESCRIPTION:END -->
