---
id: TASK-64
title: Conformance Passes Through the Supervisor
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
labels:
  - ST-064
milestone: A Queued Job Runs to a Guarded, Measured End
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the shipped conformance suite driven through the supervisor,
So that acceptance (b) proves the new driver honours the contract (AD-19).

**Acceptance Criteria:**

**Given** `contracts/conformance/manifest.json` from the installed plugin
**When** the lifted `conformance.ts` runs it through the supervisor
**Then** every surface in the manifest is driven, the missing `evolve` and `launch` surface and verb entries are added, and the report names the driver as the studio supervisor

**Given** a drive declared `expect: harness-blocked`
**When** the suite runs without `--harness`
**Then** the drive is reported as skipped with its reason, never a thrown error; with `--harness` it runs under a denying permission profile and is judged per §8

**Given** the supervisor-driven report and `runner.py run` direct, on the same plugin version
**When** they are compared
**Then** both are ok over the same surfaces and check counts, and any divergence fails the story
<!-- SECTION:DESCRIPTION:END -->
