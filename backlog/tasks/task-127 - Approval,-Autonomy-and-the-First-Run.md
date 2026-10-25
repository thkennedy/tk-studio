---
id: TASK-127
title: Approval, Autonomy and the First Run
status: Done
assignee: []
created_date: '2026-10-25 03:13'
updated_date: '2026-10-25 15:36'
labels:
  - ST-127
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want one verb to approve with the autonomy I choose at that moment,
So that approval alone creates the plan, publishes it and starts the work (F2 step 5; B5 item 5).

**Acceptance Criteria:**

**Given** `quoted`
**When** `POST /engagements/{id}/input {verb: approve, autonomy: ask | steady | full, base_ref?}` arrives (the bearer or a cookie with `X-CSRF-Token`; nothing else approves: no chat line, no planner proposal, no timer)
**Then** the supervisor runs on the host in the served root: the scope's proposed epics and stories appended to `epics.md` as `## Epic N` sections carrying `engagement: ENG-NNN`, `plansync normalize` (the EP- and ST- entities, the index, the backlog mirrors), `plansync sync` (the promote to Jira with the design pages' links), the engagement's `run-epic-N` job declared under `.tk-studio/jobs/` and in `.tk-studio/config.yaml`'s `jobs` (the placement from the project's default worker placement), one commit on a branch `engagement/ENG-NNN` opened as a PR (main is protected: the plan change is reviewed like any change; the run cuts from `base_ref` when given, else from main once the PR merges, the supervisor queuing it on the merge as the plan pull-back watches today); `autonomy` and `approved_at` are recorded, the state moves `quoted → approved`, and `approved → in-progress` on the first run's `launched` event; `ask` = a graceful stop after every story and a `question` to the owner before the next, `steady` = one story per run, resubmitted by the supervisor on each merge, `full` = the epic end to end

**Given** `in-progress`
**When** runs end
**Then** `spend.runs_usd` sums the engagement's runs' `job-run` costs and the board draws the band against it; at the cap the supervisor stops the live run with a graceful stop, marks the engagement `partial`, blocks its issue (the inbox) with the figures, and waits for `go` (`{cap}` raises it by the owner's figure, back to `in-progress`) or `cancel`; `bun test` covers the approve path with a fake adapter (what is written, the PR, the job, the three autonomy levels, the cap) and every refusal
<!-- SECTION:DESCRIPTION:END -->
