---
id: TASK-63
title: The Lift Drives the Studio at the Current Contract
status: To Do
assignee: []
created_date: '2026-09-27 23:44'
updated_date: '2026-09-28 08:56'
labels:
  - ST-063
milestone: A Queued Job Runs to a Guarded, Measured End
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the ClaudeOS driver code lifted into the supervisor repo and brought current,
So that one job can be woken, invoked headless, and finished from the command line on the agent PC.

**Acceptance Criteria:**

**Given** the four source files at the tag
**When** they are lifted
**Then** the repo carries them with their provenance (tag, path, commit) in its README, `js-yaml` as the only runtime dependency beyond Bun, no ClaudeOS registration, watchdog, or driver-name residue, and no machine path in any tracked file (AD-15): the studio root, store, and plugin root resolve from the environment

**Given** the worker invocation
**When** the lifted code builds the `claude -p` command line
**Then** the host default permission mode is `auto`, a bypass request on the host is refused with a named error before any process starts, the `permissions.deny` list in `~/.claude/settings.json` applies untouched, and the worker's environment never carries `ANTHROPIC_API_KEY` (ruling 3: the Max login pays)

**Given** the auth preflight
**When** the Max login is absent or expired
**Then** the run ends `blocked` naming the missing login — never a silent 401, and never passed on the strength of `claude --version` alone

**Given** a job id for a registered project
**When** it is submitted
**Then** the project is read through the contract's registry read path and the job through the `resolve` verb (0.1.12), never from raw `.tk-studio/jobs/*.json` files

**Given** the shipped `maintenance-conformance` job on tk-studio
**When** it runs `wake` → invoke → `finish` from the CLI
**Then** the status block is captured from the worker's JSON output, `finish` records it, and a `job-run` event lands in the agent PC's ledger

**Given** the repo's test suite
**When** `bun test` runs
**Then** command-line building, status-block extraction (the last balanced JSON object with string `status` and `intent`), and the missing-block case (a named conformance failure, AD-11) are pinned and green
<!-- SECTION:DESCRIPTION:END -->
