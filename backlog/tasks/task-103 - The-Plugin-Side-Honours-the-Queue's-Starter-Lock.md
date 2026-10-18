---
id: TASK-103
title: "The Plugin Side Honours the Queue's Starter Lock"
status: To Do
assignee: []
created_date: '2026-10-17 20:25'
updated_date: '2026-10-18 00:51'
labels:
  - ST-103
milestone: "The Supervisor Moves In: One Repository"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want `jobrun.py submit` and `wake` to refuse a hand start on a checkout the supervisor's queue serves, unless I force it,
So that the queue is the only starter on both sides of the one repository and a hand start is a deliberate, visible act.

Added 2026-10-17, after the cut-over. Story 27.2 made the supervisor write an advisory `starter.lock` per served project in the store (`~/.tk-studio/projects/<key>/starter.lock`: `{starter, checkout, since, supervisor_pid}`, atomic, never in a checkout's tree) and record a run started by hand as `external`; the plugin's half was handed over in `apps/supervisor/_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` §27.2 and deferred as a story because the plugin lived behind a read-only mount. One repository makes it in-repo: `jobrun.py` reads the lock, the supervisor passes the override on the verbs it runs itself, and the supervisor keeps the lock fresh while it is up so the freshness rule holds through a pass that drives a run for hours. The supervisor's DW-6 closes with it. This story is the first `run-epic` the supervisor drives on this repository (`POST /jobs` with the declared `run-epic-28` job, the engine in `claude-tk-studio` on a worktree, `tools/verify_host.py` as the host verify leg, the close-out's PR), not a hand launch. Repo: tk-studio (`plugins/tk-studio/lib/jobrun.py`, `plugins/tk-studio/lib/tests/test_jobrun.py`, `plugins/tk-studio/contracts/driver-contract.md`, `apps/supervisor/src/cli.ts`, `apps/supervisor/src/sandbox.ts`, `apps/supervisor/test`, `kb/agent-pc-setup-runbook.md`, `apps/supervisor/_bmad-output/implementation-artifacts/deferred-work.md`).

**Acceptance Criteria:**

**Given** a project whose store holds `projects/<key>/starter.lock` with `"starter": "tk-studio-supervisor queue"` and a `checkout` equal to the project's root (compared as canonical absolute paths, case-folded on Windows), and the lock is live (the third criterion)
**When** `jobrun.py submit --id <job>` or `jobrun.py wake --job-id <job>` runs without `--force-starter` and without `TK_STUDIO_IGNORE_STARTER_LOCK=1`
**Then** the verb mints nothing (no run record, no `job-run` event, no directive) and answers in its own §4 shape: `submit` with `{job_id, run_id: null, accepted: false, reason}` and `wake` with `{woken: false, run_id: null, reason}`, the reason being `StarterLocked: tk-studio-supervisor's queue is the only starter on this checkout (since <since>, supervisor pid <pid>) — submit the job to the supervisor (POST /jobs or bun src/cli.ts submit)`; the MCP `tk_job` surface inherits the refusal because it calls the same verbs; every other refusal and every other verb is unchanged

**Given** the same live lock
**When** the verb runs with `--force-starter` or with `TK_STUDIO_IGNORE_STARTER_LOCK=1`
**Then** it mints as today and its answer carries `"starter_lock": "forced"`; the supervisor records the run `external` on its next tick, as Story 27.2 built

**Given** a lock file the verb judges
**When** it decides whether the lock is live
**Then** the lock is live when (a) `supervisor_pid` is a running process on this host, probed on POSIX with `os.kill(pid, 0)` (success or `PermissionError`) and on Windows with `OpenProcess` plus `GetExitCodeProcess` equal to `STILL_ACTIVE` through `ctypes` — never `os.kill(pid, 0)` on Windows, which terminates the process — or (b) `since` is less than `STARTER_LOCK_STALE_S` (900 s) before now; a lock meeting neither is stale: the verb mints as today and adds `"starter_lock": "stale"` to its answer; an unreadable or malformed lock (bad JSON, a missing `starter`, `checkout` or `supervisor_pid`, an unparsable `since`), a `starter` that is not the queue's, or a `checkout` that is not this project's root is treated as no lock and never refuses; the lib suite pins live-by-pid (the test's own pid), live-by-`since`, stale, forced by flag and by variable, malformed, another checkout, the case-folded match on win32, both verbs, and (win32 only) that probing a live pid terminates nothing

**Given** the supervisor up (`serve` under the keeper) and a pacer pass that drives a run for hours
**When** `jobrun.py` judges the served project's lock at any point of that
**Then** the lock is live: `serve` rewrites every served project's lock on a timer (every 60 s, the certificate tick's pattern in `cli.ts`, with `setInterval` and `now` injectable), so `supervisor_pid` names a process that is alive and `since` is at most a minute old while the supervisor is up, and the lock goes stale within `STARTER_LOCK_STALE_S` of the supervisor going down; the tick's and the claim's writes of Story 27.2 stay; `bun test` from `apps/supervisor` pins the timer and the file it writes

**Given** the verbs the supervisor runs itself for a claimed run (`runJobVerb` callers in `apps/supervisor/src/cli.ts`: the run's `wake` or `submit`)
**When** the supervisor executes one
**Then** `--force-starter` is on that command line and the run is never refused by its own lock; the MCP `tk_job` route the supervisor serves passes nothing (a start through it is a hand start and is refused like one); `bun test` pins both; the driver contract takes a minor bump (0.1.23) documenting under §4 the `--force-starter` flag, the `TK_STUDIO_IGNORE_STARTER_LOCK` variable, the `StarterLocked` refusal and the `starter_lock` answer field, with conformance green; runbook §3.8's "Hand starts" row says `jobrun.py` refuses under a live lock and names the override; DW-6 is closed in `apps/supervisor/_bmad-output/implementation-artifacts/deferred-work.md`
<!-- SECTION:DESCRIPTION:END -->
