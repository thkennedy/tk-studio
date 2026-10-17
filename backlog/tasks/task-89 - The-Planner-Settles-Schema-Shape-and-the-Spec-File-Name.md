---
id: TASK-89
title: The Planner Settles Schema Shape and the Spec File Name
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-089
milestone: "The Service Owns Lifetime, Part 1: The Studio Side"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the launch planner to settle the shape of artifacts that do not exist yet before the first story is dispatched, and story spec files named short enough for Windows,
So that a dev session never halts on a question the design documents already answer (hole 19) and spec paths stay under the path limit (hole 6).

**Acceptance Criteria:**

**Given** `.bmad-loop/plugins/studio-pipeline/task-planning.md` and the SPEC the planner writes
**When** a story's acceptance criteria require a schema entry, a file or a tag for an artifact that only a later story or an operator action produces
**Then** the planner records the settled shape in the SPEC's design notes (an optional or deferred entry, a per-platform map, a named placeholder rule) citing the design document that constrains it, and never leaves it as a Block If or an open question; the consult scope text in the launch customization names schema shape as a planner matter when the design documents constrain it, and an operator ruling only when they do not

**Given** the dispatch notes `transcribe.py` writes into `stories.yaml`
**When** they name the executor spec file
**Then** the name is `stories/<id>-spec.md` (the id already carries the title slug), the engine's glob `<id>-*.md` still resolves it, a bare `<id>.md` is still read as pending (hole 1 unchanged), and the longest resulting path on this box stays under 200 characters

**Given** the lib suite
**When** the story closes
**Then** the transcription tests pin the new name, a planner-note fixture pins the settled-shape rule, and the runbook §3.8 names both
<!-- SECTION:DESCRIPTION:END -->
