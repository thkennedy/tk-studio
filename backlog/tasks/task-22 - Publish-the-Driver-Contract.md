---
id: TASK-22
title: Publish the Driver Contract
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-07-28 03:46'
labels:
  - ST-022
milestone: One Front Door, Any Mode
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a harness author (ClaudeOS connector, future),
I want a versioned contract covering everything needed to drive the studio,
So that connector work can start cold without reading studio internals.

**Acceptance Criteria:**

**Given** `contracts/` in the plugin
**When** the driver contract v1 is published
**Then** it contains: per-skill headless invocation surface (payload in, artifacts out), the JSON status schema, job/scheduler verbs (submit, status, cancel, wake), the model/effort override API, and drift-check invocation — each with schema + example
**And** the contract carries its own semver and a change policy (breaking change ⇒ major bump)

**Given** the A7 integration dossier requirements
**When** the contract is reviewed against them
**Then** every dossier item the connector must consume is covered or explicitly deferred with a named seam
<!-- SECTION:DESCRIPTION:END -->
