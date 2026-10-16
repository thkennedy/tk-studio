---
id: TASK-98
title: The Rehearsal Is a Script With a Report
status: To Do
assignee: []
created_date: '2026-10-16 20:11'
labels:
  - ST-098
milestone: "The Supervisor Moves In: One Repository"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the migration rehearsed by a script on throwaway clones that ends in a report,
So that the real cut-over is a replay of a passed rehearsal and never an improvisation.

**Acceptance Criteria:**

**Given** a fresh `git clone --no-local` of the supervisor repository and a fresh clone of tk-studio, both in a scratch folder the script creates
**When** `tools/restructure/rehearse.py` runs (stdlib Python; `git` and `uvx git-filter-repo` through subprocess argv, never a shell)
**Then** it rewrites the supervisor clone's history under `apps/supervisor/` with `git filter-repo --to-subdirectory-filter apps/supervisor`, asserts there are no tags and no signed commits to lose and no `node_modules` path anywhere in the rewritten history, fetches the rewrite into the tk-studio clone on branch `restructure/supervisor-into-monorepo`, merges it with `--allow-unrelated-histories`, and asserts the merge produced no conflict (every path is new)

**Given** the merged clone
**When** the checks run
**Then** the report records each with its exit code, duration and last output lines: `tk activate` clean from the nested root `apps/supervisor` (the plugin's own entry point); `bmad-loop` finds its run workspace from the nested root; the supervisor's `bun test` passes from `apps/supervisor`; tk-studio's `tools/verify_host.py` passes from the repository root; the four loop hooks of `apps/supervisor/.claude/settings.json` fire with `$CLAUDE_PROJECT_DIR` equal to the nested root; the size of the clone after the merge (the design spec's open question)

**Given** a check the script's host cannot run (a Windows-only check inside the Linux engine; a Claude session's hook firing where no session can start)
**When** the report is written
**Then** the check is listed under `unverifiable-here` with the exact command for the agent PC, never as a pass, and the script's exit status does not count it as failed

**Given** the report `_bmad-output/implementation-artifacts/restructure-rehearsal-<date>.md`
**When** the script ends
**Then** it follows the order of ADR §5 steps 1 to 5, ends with a one-line verdict (`rehearsal passed` or the first failed step), the script exits non-zero when any step or check failed, it never touches `C:\GitHub\tk-studio`, the live supervisor checkout or any remote, and the lib suite pins it against a fake pair of small repositories (a fake `git-filter-repo` only where the real one is unavailable)
<!-- SECTION:DESCRIPTION:END -->
