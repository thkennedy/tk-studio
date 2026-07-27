---
title: Backlog.md 1.48.0 — verified behavior (projection contract facts)
description: CLI-verified facts behind the backlog-md projection design — unknown frontmatter keys are dropped, so canonical ids ride as labels.
rank: 30
---

# Backlog.md 1.48.0 — verified behavior

Probed 2026-07-27 against the pinned version (`npx backlog.md@1.48.0`),
resolving the spine's deferred item "Backlog.md projection fidelity".
Grounds `plugins/tk-studio/lib/backlogmd.py` (ST-3.4).

## The ruling fact

**`task edit` drops unknown frontmatter keys.** A hand-added
`canonical_id:` (or any non-native key) is gone after any CLI edit. The
projection therefore uses the spine's fallback: **native keys only, the
canonical id as the first label**. Mapping canonical ↔ task lives on the
canonical side (`external.backlog-md.key`), never in the projected file.

## Native shapes (captured from the CLI)

- Task: `backlog/tasks/task-N - Title-with-dashes.md`; frontmatter
  `id: TASK-N`, `title`, `status`, `assignee: []` (flow list — outside the
  miniyaml subset; pull-back parses status-class lines by regex),
  `created_date: 'yyyy-mm-dd hh:mm'` (quoted), `labels`, `milestone` (by
  title, plain string), `dependencies`, `ordinal`. Body uses
  `## Description` with `<!-- SECTION:DESCRIPTION:BEGIN/END -->` markers.
- Milestone: `backlog/milestones/m-N - slug.md` (`id: m-N`, quoted title);
  numbering starts at m-0. Tasks reference milestones by **title**.
- `config.yml`: `project_name`, `default_status: "To Do"`,
  `statuses: ["To Do", "In Progress", "Done"]`, `task_prefix: "task"`.
- `cleanup` moves done tasks to `backlog/completed/` — pull-back searches
  `tasks/`, `completed/`, and `archive/tasks/`.

## Status mapping (coarse, round-trip-stable via snapshot)

draft/ready → To Do; in-progress/blocked/review → In Progress; done → Done;
dropped → not projected. Pull-back nearest-canonical: To Do → ready,
In Progress → in-progress, Done → done — applied only when the backend value
differs from the last-promote snapshot (echo suppression, AD-5), so finer
canonical statuses (e.g. `review`) survive unchanged round trips.
