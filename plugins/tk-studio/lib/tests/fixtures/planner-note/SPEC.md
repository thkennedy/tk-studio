---
title: 'Fixture: a planner-noted SPEC (Story 26.2 settled-shape rule)'
status: fixture
---

# Fixture epic

A minimal SPEC as `bmad-spec` would leave it, plus the section the planner
appends during task planning (`.bmad-loop/plugins/studio-pipeline/task-planning.md` §3).

## Design notes (settled shape, planner, 2026-10-15)

- 27-1 — the queue run's worktree path: optional entry, absent until the supervisor claims the run — per _bmad-output/planning-artifacts/epics.md §Story 27.1: Every Run Gets Its Own Worktree and Ends in a PR
- 27-1 — the PR URL on the run's `ended` event: deferred entry, written by Story 27.1 when the PR opens and read only once it exists — per _bmad-output/planning-artifacts/epics.md §Story 27.1: Every Run Gets Its Own Worktree and Ends in a PR
- CAP-2 — the engine launcher: per-platform map, `linux: tools/sbx-engine/launch-epic.sh` (inside the engine sandbox), `windows: the supervisor's start.ps1` — per kb/agent-pc-setup-runbook.md §3.8 The bmad-loop engine lives in Docker Sandboxes
- 25-1 — the supervisor release tag the operator cuts: named placeholder rule, `supervisor--v<version>` until the operator tags — per _bmad-output/planning-artifacts/epics.md §Story 25.1: The Roster and the Release Motion for Every App
