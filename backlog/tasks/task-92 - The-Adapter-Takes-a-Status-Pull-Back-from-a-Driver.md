---
id: TASK-92
title: The Adapter Takes a Status Pull-Back from a Driver
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-092
milestone: "The Service Owns Lifetime, Part 1: The Studio Side"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a driver author,
I want a planning-adapter verb that sets a canonical story's status-class fields from outside,
So that the supervisor can mark stories `review` when a run opens its PR and `done` when the PR merges, without writing canonical frontmatter itself (AD-4, AD-5; hole 18; Epic 27 consumes it).

**Acceptance Criteria:**

**Given** `plansync.py status --directory <root> --id ST-NNN --status <enum> [--note <text>]`
**When** it runs on a project whose canonical entity exists
**Then** it sets the entity's `status` to the given canonical enum value, stamps `updated`, records the note and the caller in the entity's `external.driver` snapshot (never touching `external.<backend>` snapshots), re-syncs the projection and the index, and names every written file in its result (AD-5: status-class only; a value outside the enum is a named refusal; an unknown id is a named refusal)

**Given** a story that a loop landed in another repository (a transcribed epic)
**When** the verb is called on the owning project with that story's canonical id
**Then** it updates the canonical file there and nothing in the other repository, and the result says which plan it wrote

**Given** the driver contract §4
**When** the story closes
**Then** the verb is documented as additive (0.1.21), the conformance manifest drives it (a headless success and a refused id), the lib suite pins the enum, the snapshot and the projection re-sync, and `plan/index.md` reflects the change after a run
<!-- SECTION:DESCRIPTION:END -->
