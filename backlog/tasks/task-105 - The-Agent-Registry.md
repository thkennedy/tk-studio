---
id: TASK-105
title: The Agent Registry
status: To Do
assignee: []
created_date: '2026-10-17 21:14'
labels:
  - ST-105
milestone: One Account, the Registry, the Projection
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a consumer of the studio (the web, a driver, the operator),
I want the supervisor to serve the registry of agents it can run per project,
So that every surface names the same agents by the same ids (§7.2).

**Acceptance Criteria:**

**Given** the registry's served projects (the host registry's roots) and the routing legs of each (`pipeline.py resolve --directory <root>` with the shipped defaults when no story is live; the run's `routing.current.json` while one is)
**When** `recover` runs (every tick) and whenever a run is claimed or ends
**Then** the supervisor rebuilds an `agents` table in the queue file: one row per `(project, role)` for the roles `orchestrator`, `session`, `implementer`, `reviewer`, `consult`, `advisor`, `planner` (the legs of contract §5 mapped once, in one table in `apps/supervisor/src/registry.ts`), with `agent_id` `<project-id>/<role>`, `model`, `effort` and `advisor` from the resolved route, `persona` from a bindings file (`apps/supervisor/personas.json`, shipped: a display name per role; the sprites are EP-30's), `live_state` (Story 29.3; `offline` until then), `current_run` and `current_story` when the role has a live leg, and `jira_account` empty (EP-31's); the table is derived only: the plugin and onboarding are not changed, the registry is never edited by hand, and a project the host registry drops disappears on the next rebuild

**Given** a consumer
**When** it reads `GET /agents` (bearer or session cookie) or `GET /agents?project=<id>`
**Then** the answer lists the rows above with the time of the rebuild; an unknown project answers an empty list; the read-only status page gains an "Agents" section listing them per project; `bun test` pins the mapping from a resolved route, the rebuild on tick, claim and end, and the two routes; `apps/supervisor/README.md` documents the table and the routes
<!-- SECTION:DESCRIPTION:END -->
