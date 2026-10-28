---
id: TASK-152
title: The `run-sweep` Job Type
status: To Do
assignee: []
created_date: '2026-10-27 23:26'
labels:
  - ST-152
milestone: Loop Hygiene 2, the Slice Path Hardened
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want a shipped job type that runs a deferred-work sweep through the supervisor: the triage in the sandbox (`bmad-loop-sweep` in a sweep session, `BMAD_LOOP_MODE=1`), each bundle executed as a run with a worktree, a host leg and a PR, and the ledger's entries closed by the merge,
So that DW-46 to DW-65 and the retrospective's deferred findings (DW-85 to DW-87 and whatever this epic leaves) have a path to main that keeps every rule a story run keeps (the planning finding: no job starts a sweep today, `[sweep] auto = "never"`).

**Acceptance Criteria:**

**Given** `plugins/tk-studio/jobs/run-sweep.json` (one-shot, guards, `stop.on_status`, effort, in `run-epic.json`'s shape) and a project instance naming it
**When** `POST /jobs {project, job}` queues it
**Then** the supervisor pins the sandbox and starts the engine's sweep session detached (the triage pass: `bmad-loop-sweep` reads `deferred-work.md` and returns the partition; `max_bundles` and the attempt caps from `.bmad-loop/policy.toml`), records the triage result in the run workspace and a `sweep-triage` event (the taxonomy extended additively), and the launch's status block names the bundles, the blocked entries and the human decisions

**Given** a validated triage
**When** the bundles execute
**Then** each bundle is one engine dev pass in the run's worktree followed by the host leg and the close-out's PR (one PR per bundle, or one per sweep with the bundles listed: the planner decides and the contract names it), the `blocked` and `human decision` entries are listed in the PR body and the inbox line, a merged PR flips its entries to `resolved … by #N` through the plan pull-back, and the sweep ends `complete | partial | blocked` with the status block and a `job-run` ledger line

**Given** tk-studio
**When** the operator queues `run-sweep` once on the sandbox tier at the engine's request through the consult log
**Then** one real sweep runs over the open ledger (its first targets: DW-46 to DW-65 and the consolidation entries DW-85 to DW-87; `max_bundles` bounds it), its PRs are merged on green by the operator, the ledger reads the closures; conformance drives the surface with a fake engine; the contract (0.1.30, additive) names the job type; the cost lands in the ledger
<!-- SECTION:DESCRIPTION:END -->
