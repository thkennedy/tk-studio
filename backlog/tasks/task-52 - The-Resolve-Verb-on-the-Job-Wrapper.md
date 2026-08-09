---
id: TASK-52
title: The Resolve Verb on the Job Wrapper
status: In Progress
assignee: []
created_date: '2026-08-09 20:03'
updated_date: '2026-08-09 20:04'
labels:
  - ST-052
milestone: The Resolved-Definition Read Surface
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a driver classifying recurring work substrate-side,
I want a read-only resolve verb on the job wrapper that serves every declared job's fully resolved definition,
So that recurring classification reads trigger and cadence from the contract surface instead of raw instance files it cannot resolve.

**Acceptance Criteria:**

**Given** a project declaring a type-extending instance that inherits trigger and cadence from its shipped type
**When** resolve is invoked without a job id
**Then** the response lists every declared job in config order with its merged definition — the inherited trigger and cadence present, source and extends named — and an entry with problems carries them named in place, never silently dropped

**Given** a single job id
**When** resolve is invoked with it
**Then** the response carries that job's resolved definition, and an unknown id is a named refusal — an answer, never a hang, never a guess

**Given** the lib unit suite, the conformance manifest, and the tk-studio-job skill
**When** the suites run
**Then** resolve's outcomes are unit-pinned (type-extension merge visible in the output, unknown id refused, an invalid definition's problems named), the manifest drives the verb headless-clean plus refusal-with-marker, the SKILL.md verb block names resolve, and both suites stay green
<!-- SECTION:DESCRIPTION:END -->
