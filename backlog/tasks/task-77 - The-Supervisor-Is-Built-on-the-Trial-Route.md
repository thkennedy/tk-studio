---
id: TASK-77
title: The Supervisor Is Built on the Trial Route
status: To Do
assignee: []
created_date: '2026-09-28 02:40'
labels:
  - ST-077
milestone: Opus 5.5 Earns Its Legs, Measured
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the Phase 1 build itself to run on the Opus 5.5 route and to be measured story by story,
So that the trial collects real data without spending anything beyond the planned work.

**Acceptance Criteria:**

**Given** Epics 20–22 run through the launch pipeline
**When** each story lands
**Then** it ran on the trial route (tk-studio's `routing.toml`, and the same table in the supervisor repo), and its Story 24.1 record exists

**Given** the landed stories
**When** they are compared with the v2 table by story kind (core code ≈ $4.4, feature ≈ $8.6 all-in)
**Then** a kb trial record lists each story's dollars, wall-clock, attempts and kind, with the caveat that these are different stories and a different language (TypeScript and Python against the C#/Godot baseline)
<!-- SECTION:DESCRIPTION:END -->
