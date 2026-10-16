---
id: SPEC-epic-27
companions:
  - ../../planning-artifacts/epics.md
  - ../../implementation-artifacts/deferred-work.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 27: The Service Owns Lifetime, Part 2: The Supervisor

## Why

This epic fixes a pain and meets a mandate. Today an engine dies with the host-side shell that started it (hole 7). Loops can share a working tree, and a run can switch the branch under the running service (hole 16). A run that paused after its story landed needs an attended recipe to close out (hole 9). Windows-only defects reach branches (holes 11, 12, 22), and the plan index under-reports what is built (hole 18). The ledger also assigns DW-3, 6, 11, 12, 13, 15, 19, 21 and 23 to the supervisor. Epic 27 is the supervisor's half of design spec §6.2 item 1: the supervisor becomes the only thing that starts work and the owner of every engine's life. It supersedes Story 23.2. Requirements trace: PROP-025, 036, 038, 040, 041, 053, 055, 064, 065 (adopted 2026-10-15); loop holes 7, 9, 11, 12, 16, 18, 22.

## Capabilities

- **CAP-1**
  - **intent:** Each run works in its own git worktree cut from its base and ends as a pull request against that base. (Story 27.1)
  - **success:**
    - On claim, the supervisor runs `git worktree add <TK_SUPERVISOR_WORK>/worktrees/<project>/<run_id> -b supervisor/run-<run_id> <base_ref>` from the project checkout and records the worktree path on the queue run. The checkout is never switched.
    - A `base_ref` that is the repository's default branch is refused (`blocked`, naming it) when that branch is not protected on GitHub.
    - The engine's untracked runtime is materialised by the studio's own motions. That means `tk install` at the pin inside the worktree, plus `.bmad-loop/policy.toml`, `routing.current.json` and the project's local config overlay copied from the checkout. It never uses a junction into the checkout. `tk activate` is clean inside the worktree, and the engine's `--project` is the worktree.
    - When the engine completes, pauses or is stopped, the supervisor pushes the run branch. It opens a PR against `base_ref` whose body carries the launch status block, the engine run id, the landed commits and the metered cost, and it records the PR URL on the `ended` event.
    - No landed commit means no PR, and "no changes" is recorded. The supervisor never force-pushes and never merges.
    - The worktree is removed after the PR opens, unless the run is paused. A paused run keeps it for the resume.
    - The suite pins worktree creation, the unprotected-base refusal, runtime materialisation and the PR body against a fake `gh` and a real throwaway repository. The live acceptance on the-universe-awaits (Story 23.3) is re-planned against this story.
- **CAP-2**
  - **intent:** The supervisor itself starts, holds, pins and releases every engine sandbox, and the queue is the only way a run starts. (Story 27.2)
  - **success:**
    - An sbx-tier worker runs `sbx run -d --name <sandbox>` to pin the sandbox. It holds its own `sbx exec` for the engine's lifetime from the console session, and records the in-VM engine pid and the sandbox name on the run.
    - When the run ends and no other run holds the sandbox, the supervisor releases the pin with `sbx stop`.
    - A cancel or tripped guard kills the engine's process group inside the microVM through `sbx exec`, by the recorded pid, with argv only and no shell. The kill is recorded. If the pid is still alive after the wait, the run is held as DW-3 specifies.
    - On a served project, `jobrun.py submit|wake` run by hand or through MCP `tk_job` meets a checkout lock file that names the queue as the only starter. The hand-started run is recorded as `external` on the next tick with its studio run id, and the pacer counts it as live until it ends (DW-6 closed).
    - The suite pins pin, hold, release, kill-by-pid and external-run detection with a fake `sbx`, on both hosts.
- **CAP-3**
  - **intent:** The service closes out a run that paused after its story's work was committed, once a verdict exists. (Story 27.3)
  - **success:**
    - Take a run paused at the commit gate or on an escalation, with the story spec at `status: done` and a `reconcile_verdict` other than `escalate`. The tick commits the engine's staged harvest on the run branch with a named message. It harvests the story's meter observation to the host ledger (`meter.py harvest`, Story 26.4) and archives the run with `bmad-loop archive` through `sbx exec`. It then relaunches the epic through `tk-studio-launch`, which skips done stories, under the same queue run with a `close-out` event. It never re-implements the story.
    - With no verdict, or with `escalate`, the run stays paused. One notification names the story and the reason, and the run's page row says "awaiting a ruling".
    - A story that halted before any commit is not closed out. The run stays paused for the resume path (`bmad-loop resolve`), exposed as `POST /runs/{id}/resume` with an optional restore patch.
    - All three cases are pinned with a fake engine, on both hosts.
- **CAP-4**
  - **intent:** The project's own verify command runs on the Windows host, in the run's worktree, after the engine completes and before the PR opens. (Story 27.4)
  - **success:**
    - The command is `verify.host` in the project's tracked `.tk-studio/config.yaml`. For tk-studio it is the lib suite and conformance, for the supervisor `bun test`, and for the-universe-awaits its verify script.
    - After an sbx-tier engine completes, the supervisor runs the command on the host tier in the worktree. It is console-hosted, under the same guards as a host-tier worker. Exit, duration and the last output lines are recorded on a `host-verify` event.
    - On a red host verify, the run ends `partial` naming the failing command. The branch is still pushed, the PR opens as a draft whose body carries the host failures, and the notification names them.
    - Without `verify.host`, the PR opens as before, and the event says the leg was skipped with the reason.
    - Green, red and absent commands are pinned on both hosts. Runbook §3.8 retires the "attended host run before each PR" rule in favour of this leg.
- **CAP-5**
  - **intent:** The canonical plan reflects a run's landing, and the queue is honest about cost, cancels, time and certificates. (Story 27.5)
  - **success:**
    - When a run that opens a PR writes its `ended` event, the supervisor calls the planning adapter's status verb (Story 26.5) on the project that owns the plan. The registry names that project, and a transcribed epic names its owner. Every story the run's spec marked done is set to `review`. The next tick that sees the PR merged sets `done`. Both calls are recorded on the run's events, and a refused call never changes the run's state.
    - For a run resumed after a restart, `run.json` `total_cost_usd` sums every iteration, and each iteration's cost is recorded as an `accounted` event (DW-15).
    - When a cancel races a claim or a late studio-run record, the cancel ends the studio run it finds on a re-read inside the end transaction, or the next recovery ends it. No run is left unended (DW-12, DW-13). An ended run that keeps its lock counts as live for the pacer (DW-11).
    - On win32 the worker record writes the pid before the start time. The start time is read natively (`GetProcessTimes` through `bun:ffi`, or an equivalent under 50 ms), so a supervisor killed inside the window still leaves a usable record (DW-19).
    - When the TLS certificate is within 14 days of expiry, the keeper renews it and restarts `serve` once, outside a live run, with an event (DW-21).
    - A refused `finish` on an already-terminal studio run leaves the worker's own status-block reason as the run's reason, never the refusal text (DW-23).
    - Every case is pinned on both hosts. The deferred-work entries are closed with their evidence, and runbook §4 names the new events and the certificate rule.

## Constraints

- The supervisor is the only starter of work and the owner of every engine's life. The queue is the only way a run starts.
- A run never switches the project checkout's branch. Each run works in its own worktree under `TK_SUPERVISOR_WORK`, never through a junction into the checkout.
- Agent work arrives PR-only. The supervisor never force-pushes and never merges, and it refuses a default-branch `base_ref` when that branch is unprotected on GitHub.
- Engine holds and host-verify runs are console-hosted, never started from a Claude desktop-app session.
- In-VM kills go through `sbx exec` with argv only, never a shell, and target the recorded pid's process group.
- The host verify command comes from the project's tracked `.tk-studio/config.yaml`, never from the plugin (AD-2).
- Close-out never re-implements a story. A missing verdict or `escalate` always stays with a human.
- Every behaviour is pinned in the supervisor suite on both hosts (Windows host and Linux engine), with fakes for `gh`, `sbx` and the engine.
- The operator owns two preconditions. First, the supervisor tab is stopped from the console before the loop builds the supervisor (single-checkout decision, 2026-10-06). Second, the supervisor's sandbox is recreated with the read-only skills mount, `WITH_BUN=1`, and a second read-write mount of `TK_SUPERVISOR_WORK`, so worktrees are visible inside the microVM.
- Every story lands in the supervisor repo. Only the runbook rows (§3.8 and §4) land in tk-studio, which the engine sandbox mounts read-only.

## Non-goals

- Changes to the driver contract or the studio plugin.
- Building the planning adapter's status verb (Story 26.5) or `meter.py harvest` (Story 26.4). Those belong to Epic 26 in tk-studio, and this epic consumes them.
- Merging PRs, automatically or otherwise.
- Re-implementing a landed story during close-out.
- The live acceptance on the-universe-awaits itself (Story 23.3). This epic only re-plans it.
- API auth or exposure changes beyond the new resume route.

## Success signal

- A job submitted to the queue on an sbx-tier project runs in its own worktree, with the engine held by the supervisor. It passes the host verify leg and ends as a PR against `base_ref`, with its stories set to `review` in the plan. The checkout's branch never moves, and nothing outside the queue starts an engine.

## Assumptions

- Story 23.2 is superseded by 27.1 and is not built separately.
- Per-story acceptance criteria stay authoritative in `epics.md`, adopted as a companion. The planner appends settled shapes under a design-notes section here.

## Open Questions

- Stories 26.4 (`meter.py harvest`) and 26.5 (the planning adapter's status verb) are missing from the installed tk-studio plugin: `meter.py` has no harvest, and `plansync.py` offers only normalize, sync and validate. Do 27.3 and 27.5 wait for Epic 26 to ship, or build against a faked interface?
- What exactly is "the project's local config overlay" that 27.1 materialises into the worktree: which files, and are they copied or regenerated?
- Who lands the tk-studio-side work, and when? That covers the runbook rows (§3.8 in 27.4, §4 in 27.5) and Story 23.3's re-plan. Epic 22's precedent was that 22.4 was built in tk-studio afterwards.
- Who adds `verify.host` to the `.tk-studio/config.yaml` of tk-studio and the-universe-awaits, so the leg runs there?
- The loop runs on the Linux engine, so who records the Windows-host-only checks? They are the both-hosts suites, `GetProcessTimes` timing, worktree visibility through the `TK_SUPERVISOR_WORK` mount, and console-hosted holds.

## Design notes (settled shape, planner, 2026-10-16)

- 27.1 — the project's local config overlay: optional entry — `.tk-studio/config.local.yaml`, copied from the checkout into the worktree when present, skipped when absent — per `.tk-studio/config.yaml` header (AD-3, AD-15)
