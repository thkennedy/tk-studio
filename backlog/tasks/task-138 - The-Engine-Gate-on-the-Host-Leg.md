---
id: TASK-138
title: The Engine Gate on the Host Leg
status: Done
assignee: []
created_date: '2026-10-27 04:08'
updated_date: '2026-10-27 05:57'
labels:
  - ST-138
milestone: The Vertical-Slice Pack
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want the host leg to run a game project's engine gate (the headless import, then the engine's own tests) on the Windows host where the engine lives,
So that a story that breaks the game's scenes or its engine tests goes red before its PR opens, not after (today the gate never runs in the loop).

**Acceptance Criteria:**

**Given** a project config that declares `verify.engine: <one command line>` beside `verify.host` (additive; TUA's is `bash scripts/engine-gate.sh`)
**When** the host leg runs (the close-out, or 33.8's `verify`)
**Then** after `verify.host` is green it runs `verify.engine` in the worktree with the folder of `$env:GODOT` prepended to PATH (so `godot` resolves to the console binary the box has) and the project's own flags left to the project; the `host-verify` event carries `engine: green | red | skipped (no verify.engine)` with the exit code and the log tail; `red` ends the run `partial` with `host_verify: red` exactly as a red `verify.host` does; `bun test` covers the ordering, the PATH composition, the event and both verdicts with a fake engine binary

**Given** the box
**When** `tk-studio doctor` runs
**Then** it reports an engine row: `$env:GODOT` set and the file present, the version `godot --version` prints, and "no engine" otherwise; the runbook names the row and the `verify.engine` key

**Given** tk-studio's conformance
**When** it runs
**Then** an e2e drives the host leg with a fake `godot` to both verdicts; contract 0.1.29 adds `verify.engine` and the event field (additive); the story's proof on TUA (an ended TUA run re-verified through `POST /runs/{id}/verify`, the import and the GoDotTest suite green on the host) is recorded in `kb/`
<!-- SECTION:DESCRIPTION:END -->
