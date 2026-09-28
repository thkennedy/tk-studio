### DW-1: On POSIX a process timeout kills only the direct child, not the process tree, so a timed-out worker or `uv run jobrun.py` grandchild keeps running.
origin: spec-deferred 2ec671e458b6
source_spec: `21-1-the-lift-drives-the-studio-at-the-current-contract-the-lift-drives-the-studio-at-the-current-contract.md`
location: src/server.ts:159-164
severity: medium
reason: src/server.ts killTree: only win32 uses `taskkill /T`; elsewhere `child.kill("SIGKILL")` hits the direct child, which is spawned without `detached`, so there is no process-group kill. The timeout error still says "process tree killed". Lifted as-is from ClaudeOS (Windows-first). On the agent PC (Windows) the tree kill works; a Linux/sbx tier would leave a worker running after `finish --state partial`. Deferral class (c): safety rule at risk.
status: open — routed to story 21-5 (its process-tree kill criterion owns the fix), 2026-09-28

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
status: open

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

