### DW-1: On POSIX a process timeout kills only the direct child, not the process tree, so a timed-out worker or `uv run jobrun.py` grandchild keeps running.
origin: spec-deferred 2ec671e458b6
source_spec: `21-1-the-lift-drives-the-studio-at-the-current-contract-the-lift-drives-the-studio-at-the-current-contract.md`
location: src/server.ts:159-164
severity: medium
reason: src/server.ts killTree: only win32 uses `taskkill /T`; elsewhere `child.kill("SIGKILL")` hits the direct child, which is spawned without `detached`, so there is no process-group kill. The timeout error still says "process tree killed". Lifted as-is from ClaudeOS (Windows-first). On the agent PC (Windows) the tree kill works; a Linux/sbx tier would leave a worker running after `finish --state partial`. Deferral class (c): safety rule at risk.
status: closed — fixed in story 21-5, 2026-09-28: `runProcess` spawns with `detached: true` on POSIX only (win32 unchanged, `taskkill /F /T`, no `detached` so the worker keeps its console) and `killTree` kills the process group (`process.kill(-pid, "SIGKILL")`, falling back to `child.kill`). test/guards.test.ts proves a grandchild dies with its parent (it fails against the old `killTree`). On sbx the in-VM `timeout -k 10 <guard>` ends the VM worker.

### DW-2: Follow-up review still recommended for 21-1-the-lift-drives-the-studio-at-the-current-contract after the damping cap was spent
origin: review-budget-followup
source_spec: `21-1-the-lift-drives-the-studio-at-the-current-contract-the-lift-drives-the-studio-at-the-current-contract.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260928-091135-2ce0; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-3: A worker (`claude -p`, or a `uv run jobrun.py` child) that outlives a killed supervisor keeps editing its checkout after `recover` releases the checkout lock, so a later `drain`/`run` can drive a seco
origin: spec-deferred 2ca941058183
source_spec: `21-3-jobs-survive-restarts-in-a-durable-queue-jobs-survive-restarts-in-a-durable-queue.md`
location: src/queue.ts recover; src/server.ts:178
severity: high
reason: Both review layers (follow-up review, 2026-09-28). Workers are spawned without `detached` and are tree-killed only on timeout (src/server.ts:178 `runProcess`). `defaultOwnerAlive` probes only the supervisor's own pid (src/queue.ts), so `recover` ends the run `partial` `orphaned: supervisor restart` and deletes the lock while the worker is still running (up to its guard's max_wall_clock_seconds). The intent's holder list (spec Always rule) and the "Restart, running orphan" matrix row release the lock on a dead owner, so the code matches the intent; the gap is against AC3 "one engine per checkout". Deferral class (a): a defect in behaviour AC3 names. Consult 2026-09-28T11:29:57Z ruled defer: 21-6 owns the killed-supervisor orphan rule (resume supersedes 21.3's rule), and 21-5 owns the whole-process-tree kill (DW-1). An operator caution is in README.md under the `drain` command.
status: open — 21-5 made the tree kill real (DW-1 closed): a worker that times out now dies with its whole process tree. What 21-6 still needs: a worker is killed on its own timeout, and on POSIX when the supervisor receives SIGINT/SIGTERM/SIGHUP (the supervisor SIGKILLs its live children's process groups, then re-raises), but never when the supervisor dies uncatchably (SIGKILL, a crash, a power loss), nor by the supervisor on win32 (a console Ctrl-C reaches the console-hosted worker itself), and `recover` still judges liveness by the supervisor pid alone. 21-6 must either record the worker's pid/process group on the queue run and kill (or wait on) it before `recover` releases the lock, or resume the run instead; `Queue.recover` ownership is unchanged by 21-5.

### DW-4: Follow-up review still recommended for 21-3-jobs-survive-restarts-in-a-durable-queue after the damping cap was spent
origin: review-budget-followup
source_spec: `21-3-jobs-survive-restarts-in-a-durable-queue-jobs-survive-restarts-in-a-durable-queue.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260928-103657-b8ac; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-5: The supervisor's end-to-end suites never run on Windows, its production host
origin: attended host verification 2026-09-28 (planning session)
source_spec: `21-4-the-worker-runs-on-the-right-tier-and-reports-its-cost`
location: test/command-line.test.ts:303 (`canRunE2E` excludes win32); test/queue.test.ts:642 (Linux /proc start time)
severity: high
reason: The loop verifies only inside the Linux engine sandbox (259 pass there). On the Windows host, `bun test` passes 216 and skips 43 of 259: all six CLI end-to-end suites (studio-health, the core job, durable queue, tick recovery, restart recovery and drain, worker tiers) and the Linux-only process-start probe. The supervisor runs console-hosted on Windows (plan §3 Phase 1 item 7; runbook §4), so its queue, recovery, process-tree kill and worker spawning are unverified where they will run. Two Windows-only defects were found and fixed in the same pass: canonicalPath lowercased returned paths on win32 (the lock identity now comes from `checkoutKey`), and a Linux-simulation assertion could not hold on a win32 host. Owner: Story 22.3 (start at logon on Windows), which needs the e2e suites enabled and green on the Windows host; Stories 21-5 and 21-6 (guards, kill tree, resume) should also prove their Windows paths.
status: open


### DW-6: Studio runs started outside the queue are invisible to the pacer, so a tick can overlap them and the hint does not count from their end
origin: spec-review 21-5 follow-up (consult)
source_spec: `21-5-guards-and-the-pacer-are-the-wrappers-job-guards-and-the-pacer-are-the-wrappers-job.md`
location: src/tick.ts tickJob / src/queue.ts pacing; src/server.ts tk_job
severity: medium
reason: The pacer reads only the queue database (Story 21.5, AC3). Studio runs started outside the queue (the MCP `tk_job` `wake`/`submit`, or `jobrun.py` by hand) never appear there, so a tick can wake a second run of the job while one of those is live, and `hint_seconds` does not count from its end. Suggested fix: route MCP `tk_job wake`/`submit` through the queue, or have the pacer see external studio runs. Documented in README.md under "Guards and the pacer".
affects: none
status: open

### DW-7: DW-3's signal clause is narrower than stated
origin: spec-review 21-5 follow-up (consult)
source_spec: `21-5-guards-and-the-pacer-are-the-wrappers-job-guards-and-the-pacer-are-the-wrappers-job.md`
location: src/server.ts signalsToHandle / readProcStatus / trackGroup
severity: medium
reason: DW-3's status says the supervisor SIGKILLs its live children's process groups on SIGINT/SIGTERM/SIGHUP. After the 21-5 follow-up review, SIGINT/SIGTERM are handled on POSIX (unless inherited ignored), but SIGHUP is handled only on Linux and only when it was not inherited ignored. So the supervisor never kills its children on SIGHUP when started under `nohup`, or on non-Linux POSIX, and a worker outlives a hung-up supervisor there. 21-6's recorded-pid kill before `recover` releases the checkout lock must cover this case too. DW-3 itself is left unedited (the orchestrator owns it).
affects: 21-6
status: open

### DW-8: A running orphan that `recover` ends `partial` never records a `stopped` event, even when its job's `stop.on_status` lists `partial`.
origin: spec-deferred b4235bfc5ce7
source_spec: `21-5-guards-and-the-pacer-are-the-wrappers-job-guards-and-the-pacer-are-the-wrappers-job.md`
location: src/queue.ts Queue.recover (orphan branch); src/cli.ts studioOps
severity: low
reason: Queue.recover (orphan branch, the `orphaned` event) writes no stop and has no job definition in hand; the studio run is ended `partial` via ops.end, so the studio's evaluate_stop refuses every later wake, but the pacer keeps minting queue runs that end `blocked` not-woken each hint interval. AC4 "the stop condition is recorded in events" does not hold for restart-ended runs. Deferral class (a). Fixing it reshapes `Queue.recover`, which this story may not do; 21-6 owns the killed-supervisor orphan rule (DW-3).
status: open
