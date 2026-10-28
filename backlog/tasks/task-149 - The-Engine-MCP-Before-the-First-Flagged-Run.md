---
id: TASK-149
title: The Engine MCP Before the First Flagged Run
status: To Do
assignee: []
created_date: '2026-10-27 23:26'
labels:
  - ST-149
milestone: Loop Hygiene 2, the Slice Path Hardened
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want the per-run engine MCP (34.5) to take per-run ports, record its start before it lets go of its children, kill them on a failed note, warn when a project's `engine.mcp.start` carries no `--exclude-domains`, and prove that the sandbox reaches the forwarder,
So that the first editor-in-the-loop run on The Universe Awaits starts clean and verify-only (the retrospective's B6, B7, AI-5; the follow-up review DW-83 owed 34.5).

**Acceptance Criteria:**

**Given** a flagged run's pin
**When** the MCP starts
**Then** the forwarder and the server take free per-run ports (`port: 0` resolved, `{port}` substituted into `engine.mcp.start`; `env.ts:117-124`, `enginemcp.ts:410`), two flagged runs on one box no longer serialise into `start-failed`, the start is recorded in the queue before the three children are `unref`'d (`enginemcp.ts:447-449`), a failed `queue.note` kills them and ends the pin with the reason, and the release stops them and the event says so

**Given** a project's tracked config
**When** `tk-studio-launch check` or the pin reads an `engine.mcp.start` without `--exclude-domains` (or the server's equivalent filter)
**Then** an advisory names the verify-only rule (`kb/engine-mcp-godot.md`) and the run proceeds; the contract (0.1.30, additive) names the per-run ports and the advisory

**Given** TUA on the box
**When** the operator runs one flagged run at the engine's request through the consult log
**Then** the sandbox's call reaches `127.0.0.1:<port>/mcp` through the forwarder behind the per-run bearer (the reachability proof the 34.5 spec left open) and `kb/engine-mcp-godot.md` records it; the supervisor suites cover the ports, the record-before-unref and the kill with fakes
<!-- SECTION:DESCRIPTION:END -->
