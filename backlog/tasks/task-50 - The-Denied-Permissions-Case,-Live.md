---
id: TASK-50
title: The Denied-Permissions Case, Live
status: To Do
assignee: []
created_date: '2026-08-09 10:07'
labels:
  - ST-050
milestone: Denied Permissions Refuse Loudly
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator running the conformance suite,
I want the detect surface — the PROP-005 observation's subject — driven live under a denying permission profile when I opt in,
So that the refusal discipline is proven against the real harness, not only documented.

**Acceptance Criteria:**

**Given** the harness pass invoked opted-in on a machine with the claude CLI available
**When** detect is driven through the harness under the denying profile
**Then** the run ends within the bound with a `blocked` status block naming the denied core, the check result rides the existing surfaces/failures report shape, and a failure emits a `headless-failure` event naming surface and assertion

**Given** the default suite invocation with no opt-in
**When** it runs
**Then** no harness drive executes and the report names the harness pass as skipped by flag — loud, never silent

**Given** a machine without the claude CLI
**When** the harness pass is requested
**Then** it ends blocked naming the missing CLI — never a hang, never a crash

**Given** this story's landing
**When** the opted-in pass runs once for real
**Then** the live run is recorded green as the story's closing evidence
<!-- SECTION:DESCRIPTION:END -->
