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
status: open (narrowed) — story 21-6, 2026-09-28: the worker's pid (POSIX: its process group; win32: the pid) and start time are recorded on the queue run as it is spawned (`onSpawn`), and `recover` kills that worker (POSIX `kill(-pgid, SIGKILL)`, win32 `taskkill /F /T /PID`) only while pid + start time still match, before it resumes the run or releases its lock; a pid that is alive but cannot be matched (start time unreadable) or whose kill failed holds the run and its lock as they are (`held`), so no lock is released under a worker that may still run. test/resume.test.ts and the AC4 mid-invoke e2e prove the kill-before-release on Linux. What remains: (1) a `uv run … jobrun.py` verb in flight when the supervisor dies is never recorded, so it is not killed (it ends on its own; the resume/adoption rules decide from the studio's state); (2) the few milliseconds between the spawn and the worker record; (3) the win32 path (taskkill, PowerShell start time) is unverified on the agent PC (see DW-5); (4) a `held` run keeps its run and checkout lock until its recorded worker pid dies, and where `processStartTime` returns null (any platform other than linux/win32) a reused pid can hold the run indefinitely, shown only by `held[]` in the `recover` answer. Previously: open — 21-5 made the tree kill real (DW-1 closed): a worker that times out now dies with its whole process tree. What 21-6 still needs: a worker is killed on its own timeout, and on POSIX when the supervisor receives SIGINT/SIGTERM/SIGHUP (the supervisor SIGKILLs its live children's process groups, then re-raises), but never when the supervisor dies uncatchably (SIGKILL, a crash, a power loss), nor by the supervisor on win32 (a console Ctrl-C reaches the console-hosted worker itself), and `recover` still judges liveness by the supervisor pid alone. 21-6 must either record the worker's pid/process group on the queue run and kill (or wait on) it before `recover` releases the lock, or resume the run instead; `Queue.recover` ownership is unchanged by 21-5. Narrowed further — story 21-6 review patches, 2026-09-28: `claim` no longer releases the lock of a `running` holder with a dead owner while its recorded worker may still run; it waits `queued` naming it. `recover` and `claim` share one predicate (`Queue.recordedWorker`): the pid alive with a matching or unreadable start time, its POSIX process group alive after the leader exited (`recover` SIGKILLs that group), or an sbx run's in-VM deadline not passed. A kill that leaves a matching worker running after its 5 s wait answers `kill failed` (`still running after wait`) and holds the run. An sbx run is held until its recorded spawn + the guard seconds passed to that spawn (`worker_guard_s`) + the 10 s `-k` grace, then ends `partial` naming `max_wall_clock_seconds`; it is never resumed on restart. A failed worker record kills the worker and ends the run `blocked`. What remains now: items (1)-(4) of the 21-6 narrowing at the start of this status, where (4) covers a held host run only; (5) the sbx deadline counts from the host `worker` record, so a microVM start lag longer than the 10 s grace can let the in-VM worker outlive the deadline by that excess; (6) a claimant waiting on such a holder only waits: the dead holder's run is ended or resumed by the next `recover` (the tick's, `drain`'s or `run`'s).

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
status: closed — 2026-09-29, attended session on the agent PC: Story 22.3 removed the win32 exclusion, and the CLI end-to-end suites now run green on the Windows host (`TK_STUDIO_ROOT` set, bun 1.4.2): 545 pass, 16 skip, 0 fail, tsc clean. The first host run failed 29 tests; every cause was test-side and is fixed in `39596da` (fakes as real executables, win32 kill status, PATH, symlink guard, VM folder). A real process-tree kill test (`taskkill /F /T`) was added for win32. The 16 skips left are POSIX-only cases (process groups, signals, `/proc`) and the symlink cases. Previously: open


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
status: closed — story 21-6, 2026-09-28: the recorded-worker kill in `recover` does not depend on any signal reaching the supervisor, so a worker that outlived a supervisor hung up under `nohup`, killed by SIGKILL, or crashed is killed before its run resumes or its lock is released (pid + start time matched). On non-Linux POSIX, where no start time is readable, the worker is never signalled and the run is held with its lock until the pid is gone (never released under it). Previously: open

### DW-8: A running orphan that `recover` ends `partial` never records a `stopped` event, even when its job's `stop.on_status` lists `partial`.
origin: spec-deferred b4235bfc5ce7
source_spec: `21-5-guards-and-the-pacer-are-the-wrappers-job-guards-and-the-pacer-are-the-wrappers-job.md`
location: src/queue.ts Queue.recover (orphan branch); src/cli.ts studioOps
severity: low
reason: Queue.recover (orphan branch, the `orphaned` event) writes no stop and has no job definition in hand; the studio run is ended `partial` via ops.end, so the studio's evaluate_stop refuses every later wake, but the pacer keeps minting queue runs that end `blocked` not-woken each hint interval. AC4 "the stop condition is recorded in events" does not hold for restart-ended runs. Deferral class (a). Fixing it reshapes `Queue.recover`, which this story may not do; 21-6 owns the killed-supervisor orphan rule (DW-3).
status: closed — fixed in story 21-6, 2026-09-28: every end `recover` writes goes through `Queue.end`'s path (`writeEnd`): the `orphaned` event carries `studio_outcome` when the studio run reached a terminal state, and a `stopped` event is written in the same transaction when the job's `stop.on_status` lists it (test/resume.test.ts, test/queue.test.ts). Previously: open

### DW-9: Follow-up review still recommended for 21-6-a-killed-run-resumes-or-ends-partial-never-lost after two follow-up passes
origin: review-budget-followup (recorded by the attended session; the run paused before the engine's close-out)
source_spec: `21-6-a-killed-run-resumes-or-ends-partial-never-lost-a-killed-run-resumes-or-ends-partial-never-lost.md`
location: n/a
severity: low
reason: The second follow-up review patched one high finding (an sbx silent exit resumed beside a live in-VM worker) and still recommended another pass (score 7). The work was committed by bmad-loop run 20260928-191230-73a0 and closed by the attended session. This entry keeps the recommendation for a deliberate later review.
status: open

### DW-10: Two of story 21-6's host checks were not run on Windows
origin: attended host verification 2026-09-28
source_spec: `21-6-a-killed-run-resumes-or-ends-partial-never-lost-a-killed-run-resumes-or-ends-partial-never-lost.md`
location: src/cli.ts recoverWithResume / driveResumes; src/transcript.ts (restore from `TK_SUPERVISOR_TRANSCRIPT_BACKUP`)
severity: high
reason: The engine sandbox cannot run them, and the supervisor is never started from a Claude desktop-app session. Not run: (1) kill the supervisor mid-run on the Windows host and restart it: the run must resume or end `partial`, and `Get-Process claude` must show nothing left of the old worker; (2) delete a finished session's `.jsonl` under `%USERPROFILE%\.claude\projects` and force a resume: the file must come back from the nightly backup. Run and passed: a live `--session-id` then `--resume` reports the same `session_id` (Claude Code 2.1.274). The matching e2e suites are skipped on win32 (DW-5). Owner: Story 22.3, with DW-5.
status: open (narrowed) — 2026-10-09, live on the console: (1) **passed.** `studio-health` was submitted through the API, its real `claude -p` worker (pid 7804) was running, and the whole supervisor tree (start.ps1, drain, keeper, serve, worker) was killed with `taskkill /T /F`. After the operator ran `start.ps1` again, the restart rule recognised the dead owner, took the run over (`resumed`, resume 1, reason `supervisor restart`), resumed the same session with `--resume`, carried the accounted tokens across, started a new worker with the remaining guard (430 s), ended the run with the worker's own status block, sent the Telegram notification and copied the transcript; no worker process was left over. The run ended `blocked` because of DW-22, which is unrelated to the restart. (2) The transcript restore remains for Epic 23 (it needs a finished TUA run). Previously: 2026-09-29: (1) kill-and-restart passes on the Windows host in the end-to-end suite with a faked worker (after `wake`, mid-invoke, before `finish`): the run resumes with `--resume` on its session or ends `partial`. On win32 the old worker is reported `not running`, because a worker that is not detached ends with its supervisor. (2) The restore from `TK_SUPERVISOR_TRANSCRIPT_BACKUP` passes on the Windows host at unit level (test/resume.test.ts). What remains is the operator's, from the console with the real supervisor and a real worker: kill the supervisor mid-run and restart it; delete a finished session's transcript and force a resume. Previously: open

### DW-11: The pacer does not treat an ended run that keeps its lock as live
origin: spec residual risk, 21-6 follow-up review 2 (recorded by the attended session)
source_spec: `21-6-a-killed-run-resumes-or-ends-partial-never-lost-a-killed-run-resumes-or-ends-partial-never-lost.md`
location: src/queue.ts Queue.pacing; src/tick.ts tickJob
severity: low
reason: An sbx run refused a resume ends `partial` and keeps its checkout lock until the in-VM deadline (`hold_lock`). `Queue.pacing()` does not count it as live, so the pacer may mint the next run, which then waits on the lock. Nothing runs twice; the cost is a queued run that waits. Deferral class (b): behaviour outside this story's criteria.
affects: 22-3
status: open

### DW-12: A driver can still claim a run between cancelRun's re-read and the Queue.end transaction, so a cancel can end a just-claimed run without keeping its lock for the live driver.
origin: spec-deferred ce9b14f73290
source_spec: `22-1-the-api-answers-on-the-tailnet-only-the-api-answers-on-the-tailnet-only.md`
location: src/cli.ts cancelRun; src/queue.ts writeEnd
severity: medium
reason: Review pass 1 patch 2 narrowed the window but did not close it: the owner-liveness probe cannot run inside the end transaction (implementer report, consult ruling 2). The criterion it touches: cancel ends the run `cancelled` through Queue.end and the recorded-worker rule, never a bare lock release (deferral class a).
status: open

### DW-13: A driver that records its studio run after cancelRun's re-read but before Queue.end leaves that studio run unended.
origin: spec-deferred 966aa17fc77c
source_spec: `22-1-the-api-answers-on-the-tailnet-only-the-api-answers-on-the-tailnet-only.md`
location: src/cli.ts cancelRun / recordMinted
severity: medium
reason: Follow-up review pass: patch 1 made cancel end the studio run from a fresh re-read, and the driver's recordMinted end a studio run minted after the cancel. A setStudioRun that lands between that re-read and the Queue.end transaction still succeeds, so neither side ends it (implementer report, consult ruling 3). It is a sibling of the claim/end race above. The criterion it touches: cancel ends the studio run through jobrun cancel (deferral class a).
status: open

### DW-14: Follow-up review still recommended for 22-1-the-api-answers-on-the-tailnet-only after the damping cap was spent
origin: review-budget-followup
source_spec: `22-1-the-api-answers-on-the-tailnet-only-the-api-answers-on-the-tailnet-only.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260928-224136-6f1a; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-15: A run resumed after a supervisor restart loses the cost of its pre-restart iterations, so the page's cost (run.json `total_cost_usd`) under-reports it.
origin: spec-deferred cfb7ee04d5a3
source_spec: `22-2-a-read-only-status-page-a-read-only-status-page.md`
location: src/cli.ts:1375-1528 finishRun
severity: medium
reason: `finishRun` keeps the iteration sum in a local `cost` (src/cli.ts:1375, :1416) and writes it only at `finish` (:1518, :1528). A restart resumes the run in a new process (`recoverWithResume`, src/cli.ts:403) whose sum starts empty, and no queue event records per-iteration cost. The 21-6 dispatch note names "cost summed across resumed iterations" (deferral class a). Fixing it needs src/cli.ts or src/queue.ts, outside this story's Files.
status: open

### DW-16: Follow-up review still recommended for 22-2-a-read-only-status-page after the damping cap was spent
origin: review-budget-followup
source_spec: `22-2-a-read-only-status-page-a-read-only-status-page.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260928-224136-6f1a; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-17: Every worker inherits TK_SUPERVISOR_TELEGRAM_TOKEN and TK_SUPERVISOR_NTFY_URL, because buildWorkerEnv strips only ANTHROPIC_API_KEY and TK_SUPERVISOR_TOKEN.
origin: spec-deferred 6598af1afd4d
source_spec: `22-3-the-supervisor-starts-itself-at-logon-the-supervisor-starts-itself-at-logon.md`
location: src/server.ts:533
severity: high
reason: start.ps1 exports the notifier variables to the supervisor, and the workers the tick and drain spawn get buildWorkerEnv(process.env), where an agent can read them with `env`. Deferral class (c): a credential rule is at risk. The consult ruled the story's NFR5 list (logs, events, errors, API answers, start.ps1 output) does not name the worker env, and the fix file is outside the 11-file cap. Fix: add both variables to the delete list in buildWorkerEnv, with one assertion in its existing test.
status: closed — 2026-09-29, attended fix: `buildWorkerEnv` also deletes `TK_SUPERVISOR_TELEGRAM_TOKEN` and `TK_SUPERVISOR_NTFY_URL`, with one test (test/command-line.test.ts). `TK_SUPERVISOR_NOTIFY` and `TK_SUPERVISOR_TELEGRAM_CHAT` pass through: they are not credentials. Previously: open

### DW-18: Follow-up review still recommended for 22-3-the-supervisor-starts-itself-at-logon after the damping cap was spent
origin: review-budget-followup
source_spec: `22-3-the-supervisor-starts-itself-at-logon-the-supervisor-starts-itself-at-logon.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260928-224136-6f1a; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-19: On win32 the worker record waits about half a second on a PowerShell start-time read
origin: attended host verification 2026-09-29 (the Windows pass for DW-5)
source_spec: `22-3-the-supervisor-starts-itself-at-logon-the-supervisor-starts-itself-at-logon.md`
location: src/cli.ts queueRecorder.worker; src/queue.ts processStartTime / runPowerShell
severity: medium
reason: `queueRecorder.worker` reads the worker's start time before it writes the worker record. On Linux that is one `/proc` read. On win32 it is a synchronous `powershell` call of about 0.5 s (measured 0.42 s on the agent PC), and the supervisor is blocked for that long. A supervisor killed inside that window leaves a run with no `worker_pid`. The end-to-end mid-invoke kill test met this and now waits for the record. The exposure is smaller than on POSIX: a win32 worker is not detached, so it ends with its supervisor and cannot go on editing the checkout. What is lost is the record, so the restart cannot say what it did about the worker. Suggested fix: write the pid first and the start time after it, or read the creation time natively (`GetProcessTimes` through `bun:ffi`) instead of through PowerShell. The same read runs once per `selfOwner()` and per owner probe.
affects: none
status: open

### DW-20: The status page cannot be opened from a phone's browser
origin: attended review 2026-09-29 (writing runbook section 4 from the code as built)
source_spec: `22-2-a-read-only-status-page-a-read-only-status-page.md`
location: src/api.ts (the bearer check in front of every route); src/page.ts; README.md "HTTP API", `GET /`
severity: medium
reason: Story 22.2 asks for a page that "reads well at phone width", served "behind the same auth as the API". The page is behind the bearer header, and a browser's address bar cannot send one, so the operator cannot open it on the phone without a client that sets headers. The criteria are met as written, and the epic's success signal ("watch it on the status page" from the phone) is not. The fix is a product decision for the operator, not a patch: for example HTTP Basic with the token as the password, which a browser prompts for, or a login form that sets a session cookie. Either one changes how the token travels.
affects: none
status: decided 2026-10-06 — Tim chose a login form that sets an HttpOnly session cookie, with Google and GitHub sign-in as well as the token. Tracked as tk-studio Story 22.5 ("Sign in from the phone"); constraints in `_bmad-output/specs/spec-epic-22/operator-decisions.md` §7. Story 22.5 landed (`f8a26c2`, PR #5). 2026-10-08: the operator enabled Tailscale HTTPS certificates, set the TLS variables, and the sign-in page is served over `https://<TLS_NAME>:8787/`. Closed once the operator confirms a phone sign-in with the token.

### DW-21: The Tailscale certificate is renewed only when start.ps1 starts, and serve never reloads it, so on a box up longer than the 90-day certificate life https fails with an expired certificate.
origin: spec-deferred 518474edfc24
source_spec: `22-5-sign-in-from-the-phone-sign-in-from-the-phone.md`
location: start.ps1 (tailscale cert block); src/api.ts serve
severity: medium
reason: Review pass 1 (blind hunter): `tailscale cert` runs once in start.ps1's main script before the keeper; Bun.serve reads cert and key once at bind. No periodic renewal or serve restart exists. AC4 requires https with the machine's Tailscale certificate (deferral class a). The README now tells the operator to restart start.ps1 on long uptimes.
status: open

### DW-22: The host tier's `auto` permission mode denies the studio's own `uv run` scripts
origin: live DW-10 check, 2026-10-09
source_spec: `21-4-the-worker-runs-on-the-right-tier-and-reports-its-cost-the-worker-runs-on-the-right-tier-and-reports-its-cost.md`
location: the worker's `claude -p --permission-mode auto` on the host tier; the projects' `.claude/settings.json`
severity: high
reason: Two `studio-health` runs in a row (q-studio-health-20261009T045710Z-29ca5b, q-studio-health-20261009T050354Z-ea37da) ended `blocked`: every `uv run ".../tk-studio-activate/scripts/drift_check.py"` call was answered "This command requires approval" (two of two tool calls on the second run, no API error). The day before, the `research-ecosystem` run on the same tier had ten Bash calls approved, `uv run .../research.py` among them. The auto-mode classifier is a model and does not approve the studio's scripts reliably, so a host-tier skill job can never count on running them. The worker ends honestly (`blocked`, the gap named), which is the designed outcome, but the job is unusable.
affects: every host-tier skill job that runs a studio script (studio-health, research-ecosystem, evolve-proposals)
status: mitigated 2026-10-09 — on the operator's decision, `permissions.allow: ["Bash(uv run:*)"]` is added to the tracked `.claude/settings.json` of this repo and of tk-studio (the deny list unchanged), so the studio's checked-in Python runs without the classifier. Open until a studio-health run on the host tier ends `complete`.

### DW-23: A skill run that finishes itself leaves `finish failed: ... terminal states are immutable` as the queue run's reason
origin: first production run, 2026-10-07 (q-research-ecosystem-20261007T164123Z-0146a1)
source_spec: `21-1-the-lift-drives-the-studio-at-the-current-contract-the-lift-drives-the-studio-at-the-current-contract.md`
location: src/cli.ts (the end path after a skill worker exits: `finish` on an already-terminal studio run)
severity: low
reason: The `research-ecosystem` skill ended its own studio run `complete`; the supervisor's `finish` was then refused ("terminal states are immutable"), and that refusal text became the queue run's `reason` although `studio_outcome.state` is `complete` and the run is counted complete. The README says a refused `finish` reports the run's actual state, which it does; the `reason` field is noise on the page and in the notification.
affects: none
status: open
