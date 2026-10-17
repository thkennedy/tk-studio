---
title: 'A Killed Run Resumes or Ends Partial, Never Lost'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred: []
deviation_score: 2
reconcile_verdict: adjust-stories
baseline_commit: 92208cf7acc4e5ba6546aca234fef01992e9c546
baseline_revision: 92208cf7acc4e5ba6546aca234fef01992e9c546
---

<intent-contract>

## Intent

**Problem:** A supervisor killed mid-run leaves a `running` queue run that the next `recover` ends `partial` (`orphaned: supervisor restart`), releasing the checkout lock while the detached worker may still be running (DW-3, DW-7), and writing no `stop`/`studio_outcome` (DW-8). A worker that exits with no status block ends `blocked` (`MISSING_STATUS_BLOCK`). Nothing is ever resumed.

**Approach:** Record the worker's pre-minted session id, its process group/pid and start time, and the wake answer on the queue run before the worker works. On restart (`Queue.recover`, extended with a resume op) or after a silent exit (`finishRun`), resume a skill run with `claude -p --resume <session-id>` on the stored tier, once per run by default, when its transcript exists (restored from the nightly backup if the CLI removed it) and 21-5's guards leave budget; otherwise end it `partial` with the reason named.

User story (epics.md, Story 21.6): As the operator, I want a run interrupted by a supervisor crash or a silent worker exit to resume from its transcript or end `partial` with the reason named, so that acceptance (c) holds: no run is ever silently lost.

## Boundaries & Constraints

**Always:**
- Session id: pre-minted with `crypto.randomUUID()` and passed as `--session-id <uuid>` on the first invoke; recorded on the queue run (nullable column + event, its own transaction, like `setStudioRun`) before the spawn. A resume passes `--resume <same id>` plus a short continuation prompt as the one `-p` argv item, every other flag (permission mode, model, effort, output format, sbx wrapper) unchanged. Never `--fork-session`; never parse ids out of transcripts.
- Worker identity: the spawned pid (POSIX = its process group; win32 = the pid) and its `processStartTime` are recorded on the queue run through an `onSpawn` hook as soon as `runProcess` spawns it.
- Before `recover` resumes a run or releases its lock, the recorded worker is killed (POSIX `process.kill(-pgid, "SIGKILL")`; win32 `taskkill /F /T /PID`) only when pid plus start time still match; a mismatched or dead pid is never signalled. The outcome is in the run's event detail. This covers DW-7 (SIGHUP under `nohup`/non-Linux, SIGKILL, crash). Never kill by name pattern.
- Resume eligibility, checked in this order; the first failure ends the run `partial` naming it: skill target (a core run is never resumed and keeps 21-1 AC5b `cancel` + `partial` `supervisor restart`); session id recorded; resume count below the cap (1 by default); studio run still resumable (`status --run-id` answers `queued`/`running`; if already terminal, the queue run ends in that state); transcript exists (restore first when needed); guards leave budget (`account` with the interrupted iteration's counts, remaining wall clock = guard − `counters.wall_clock_seconds` > 0).
- Reasons: AC1 non-resumable ends start with `orphaned: supervisor restart` and name the cause (`; guard: max_turns (40)`, `; transcript missing: <sid>`, `; resume cap reached (1)`, `; no session recorded`). AC2 ends keep `MISSING_STATUS_BLOCK` in the reason plus the cause. A guard trip names the guard as 21-5 does (`guard: <name> (<value>)`).
- Takeover: a resume re-owns the run in ONE transaction (owner = self, lock re-owned and never released in between, state stays `running`, a `resumed` event carrying the resume count and the counts already accounted). `Queue.pacing()` then sees it `live`.
- The resumed invoke runs through 21-5's guards: `wallClockGuard` with the remaining seconds (on sbx, the in-VM `timeout` in `buildSbxCommand` gets the remaining seconds), `account` after the resumed iteration with only message ids not already accounted (host); sbx uses the result's `num_turns`/`usage`.
- Same tier: the queue run's stored `tier`/`sandbox`/`model`/`effort`/`permission_mode`, rebuilt through `validate()`/`resolveWorkerOptions` so `registryRoot` (sbx VM root, `invokeSkill(…, {vmHostRoot})`) never falls back to the caller root. Same branch: the same checkout root.
- Every end `recover` writes goes through `Queue.end`'s path with the `stop` option and `studio_outcome`, so a restart-ended run whose state is in `stop.on_status` records `stopped` (closes DW-8).
- Transcript restore (host): when `projects/*/<sid>.jsonl` is missing under `claudeConfigDir()`, look in the backup root named by `TK_SUPERVISOR_TRANSCRIPT_BACKUP` (runbook §6's `claude-projects` folder) for exactly one `*/<sid>.jsonl`, copy it and its `<sid>/subagents/` into the same slug directory name, then resume. Unset variable, no copy, or ambiguous copies → `partial` naming the missing transcript. sbx: existence via `sbx exec <sb> find <vm config dir>/projects -name <sid>.jsonl` (argv only); the host backup never covers the VM.
- Silent exit (AC2) is `ran: true`, no status block, and none of: auth block (`MAX_LOGIN_MISSING`), preflight `ran: false`, host wall-clock timeout, sbx 124/137 wall-clock trip. Those keep their current outcome and are never resumed.
- The adoption rule for a run with no recorded studio run stays `studioRunFinder` (absent from the `verb_started` snapshot, minted at or after it, earliest wins, ambiguous fails). The queue run id and `studio_run_id` stay separate; owner identity stays hostname + pid + nonce + start time.

**Block If:**
- The installed CLI refuses `--session-id` with `-p`, or `--resume` with `-p` answers a different session id.
- A resume needs `account`/`finish` on a studio run that is no longer resumable, or any change to `jobrun.py` or the plugin (AD-2).
- AC2's second failure would stop being a named failure (AD-11).
- The change needs a file outside the plan's Files, or more than 10 files (assertion-only edits to an existing test file named in Files do not count).

**Never:** change `jobrun.py` or the plugin; add a dependency; put a machine path in a tracked file (AD-15); kill by name pattern in code or tests; use `bypassPermissions` on the host; resume a core run; resume more than the cap; release a checkout lock while a matching recorded worker may still run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Restart, resumable | dead owner, skill run, session recorded, transcript exists, budget left | worker group killed if matching; `resumed` event; `--resume <sid>` on stored tier; finish per block | — |
| Restart, after wake | studio run minted, no session recorded | `partial` `orphaned: supervisor restart; no session recorded`, events recorded | studio run `finish partial` |
| Restart, guard spent | `account` answers `exceeded: [max_turns]` or no wall clock left | `partial` naming the guard | — |
| Restart, core run | core target | `cancel` + `partial` `supervisor restart` (unchanged) | — |
| Restart, studio already terminal | `status` answers `done` | queue run ends in that state, no resume | — |
| Worker pid reused | recorded pid alive, start time differs | never signalled; proceed | detail names the mismatch |
| Silent exit, first | `ran: true`, no block | one in-process resume | — |
| Silent exit, second | resumed worker also no block | `partial`, reason carries `MISSING_STATUS_BLOCK` and `resume cap reached (1)` | — |
| Transcript GC'd, backup copy | host `.jsonl` gone, one copy in backup | restored to `<slug>/<sid>.jsonl` (+ subagents), then resume | — |
| Transcript GC'd, no copy | env unset or no copy | `partial` naming `transcript missing: <sid>` | — |
| Stop on restart end | `stop.on_status: [partial]`, restart ends `partial` | `stopped` event in `ended`'s transaction | — |
| Auth block / preflight / timeout | as today | unchanged outcome, never resumed | — |

</intent-contract>

## Code Map

- `src/queue.ts:814` `recover(ops, self)` -- the restart rule; the `running` + `studio_run_id` branch and the adopted-studio-run branch end `partial` via `ops.end` (:857-893). Extend `StudioOps` (:310, `{end, find}`) with a resume op (e.g. `resume(run) → {resumed} | {ended, state, reason, trips?}`) or hand resumable orphans back; keep the re-queue branch (:839-855) and failed-lookup branch as they are. Keep `recover` short (take over, then drive) so `run` for another job is not held behind a resume.
- `src/queue.ts:881` `orphaned` event -- no `stop`/`studio_outcome` today (DW-8); `Queue.end` (:770) already writes `stop` in `ended`'s transaction; `pacing()` (:438) reads `ended`/`orphaned` + `studio_outcome`.
- `src/queue.ts:317` `SCHEMA`, `:351` `ADDED_RUN_COLUMNS` -- add nullable `session_id`, `worker_pid`, `worker_start`, wake answer JSON (`directive`/`routing`) via guarded `ALTER TABLE`; setters with events in their own transaction like `setStudioRun` (:716).
- `src/queue.ts:158` `processStartTime`, `:196` `defaultOwnerAlive` -- reuse for the worker pid + start time match.
- `src/queue.ts:585` `claim` -- the owner/lock transaction pattern the takeover mirrors.
- `src/cli.ts:373` `studioOps`, `:378` `recoverQueue`, `:399` `drainQueue`, `:459` `runJob` (`skipRecover`) -- entry points running `recover`.
- `src/cli.ts:590` `Started`, `:606` `validate()`, `:232` `resolveWorkerOptions`, `:218` stored layer -- rebuild the resumed run (`runId` = `studio_run_id`, `woke` = stored wake answer).
- `src/cli.ts:774` `finishRun` -- missing-block branch (:831-834) is AC2's detection; sbx 124/137 rule (:822); `account` (:853-871) via `iterationCounts` (:763).
- `src/cli.ts:124` `wallClockGuard`, `:297` `guardsFor` -- remaining budget.
- `src/cli.ts:311` `studioRunEnder` -- skill → `finish partial`, core → `cancel`.
- `src/server.ts:421` `buildWorkerCommand` -- add `sessionId`/`resume`; `:471` `buildSbxCommand` wraps unchanged with remaining guard seconds.
- `src/server.ts:252` `runProcess`, `:490` `Spawner`, `:492` `runClaude`, `:651` `parseWorkerResult`, `:951` `invokeSkill` -- `onSpawn(pid)` hook; resume options.
- `src/transcript.ts:74` `claudeConfigDir`, `:80` `locateTranscript`, `:100` `subagentTranscripts` -- existence check and backup restore.
- `$TK_STUDIO_ROOT/plugins/tk-studio/lib/jobrun.py` (read-only) -- `RESUMABLE_STATES = ("queued","running")`; `account`/`finish` refuse non-resumable runs; `status --run-id`.
- Tests: `test/queue.test.ts:415-741` (recovery, `verb_started`, owner identity); `test/command-line.test.ts:301-372` `e2eFixture` (real jobrun, fake `CLAUDE_BIN` writing a transcript under `CLAUDE_CONFIG_DIR`, fake `SBX_BIN`); `test/guards.test.ts:603-667` (sbx 124/137 and missing-block `blocked` pins AC2 changes).

## Tasks & Acceptance

**Execution:**
- `src/queue.ts` -- new columns + events; resume op in `recover` with the one-transaction takeover, resume count, recorded-worker kill before any resume or lock release; orphan ends through `end`'s `stop`/`studio_outcome` path.
- `src/cli.ts` -- record session id, worker identity, wake answer before spawn; the resume driver (eligibility order, `validate()` rebuild, remaining wall clock, `account` on new message ids only); AC2 silent-exit branch in `finishRun`.
- `src/server.ts` -- `--session-id`/`--resume` + continuation prompt in `buildWorkerCommand`; `onSpawn` through `Spawner`/`runProcess`; `invokeSkill` resume options.
- `src/transcript.ts` -- existence check, env-rooted backup restore, sbx `find` argv.
- `test/resume.test.ts` (new) -- every I/O matrix row at unit level, including kill-before-release and never-kill on start-time mismatch.
- `test/command-line.test.ts` -- fake worker honours `--session-id`/`--resume`; AC4's three kill points end to end (kill only the spawned supervisor, by pid or `kill -9 $PPID` from the fake, every child bounded by a timeout).
- `test/queue.test.ts` -- column migration of an existing file; takeover keeps the lock; orphan `stopped`/`studio_outcome`.
- `test/guards.test.ts` -- assertion-only updates of the missing-block pins AC2 changes.
- `README.md` -- restart/resume rule, `TK_SUPERVISOR_TRANSCRIPT_BACKUP` (runbook §6 answers CAP-9's backup question; never covers sbx), the one-resume cap.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- close DW-3, DW-7, DW-8 or narrow each to what remains (append status; do not rewrite the entries' original text).

**Acceptance Criteria (epics.md Story 21.6, verbatim):**
- AC1: Given the supervisor is killed mid-run, when it restarts, then every run it owned is found in the queue; each resumes with `--resume <session-id>` on the same tier and branch when its session transcript exists and its guards leave budget, and otherwise finishes `partial` naming the guard or `supervisor restart` (superseding Story 21.3's orphan rule for runs that can resume).
- AC2: Given a worker that exits without a status block (runbook §8: silent REPL exit), when the exit is detected, then the same resume-or-partial rule applies, capped at one resume per run by default, and a second failure ends `partial`.
- AC3: Given a resume whose transcript the CLI has garbage-collected, when the nightly backup holds a copy, then the transcript is restored from the backup before resuming; with no copy, the run ends `partial` naming the missing transcript.
- AC4: Given the repo's test suite, when it kills the supervisor at three points (after `wake`, mid-invoke, before `finish`), then each case ends resumed or `partial` with its events recorded, and the suite is green.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- both layers ran (band L): blind-hunter, edge-case-hunter; the diff (167 KB) was handed to both as a file path, not inline
- intent_gap: 0
- bad_spec: 0
- patch: 9 (high 2, medium 6, low 1)
- defer: 0
- reject: 7 (medium 2, low 5) — a `held` run stuck on platforms without readable start times (consult 1 ruled; DW-3 item); a completed block lost when killed before `finish` (the spec's kill-point mapping resumes it; AC4 accepts resumed); "same branch" unchecked (the intent contract pins same branch = same checkout root); resume cap not configurable (the plan makes it optional; "by default" holds); tick `--timeout-cap-s` dropped on restart (accepted pass-1 DRIFT); sbx interrupted counts 0/0 (accepted pass-1 DRIFT, now moot); tick log says "nothing orphaned" when runs resumed (cosmetic, `src/tick.ts` outside Files)
- addressed_findings:
  - `[high]` `[patch]` sbx restart killed only the host `sbx exec`, so a resume ran beside the live VM worker (both layers) — held until spawn + guard + 10 s, then `partial` naming `max_wall_clock_seconds`; never resumed on restart (consult 2, reading (a))
  - `[high]` `[patch]` `Queue.claim` released a dead-owner running holder's lock under a possibly live worker (blind-hunter) — one shared "worker may still run" predicate; the claimant waits (consult 2)
  - `[medium]` `[patch]` `killRecordedWorker` reported `killed` when the worker outlived the 5 s wait (edge-case-hunter) — `kill failed`, run held
  - `[medium]` `[patch]` group members outliving an exited leader were never killed (both layers) — POSIX `kill(-pid, 0)` probe, group SIGKILL
  - `[medium]` `[patch]` restart `account` ran before the takeover, so concurrent recoverers double counted (both layers) — account only after the takeover win, in an `accounted` event
  - `[medium]` `[patch]` a failed `onSpawn` record was swallowed and the worker ran unrecorded (edge-case-hunter) — child tree killed, `blocked` naming `worker record failed`
  - `[medium]` `[patch]` `drain`'s exit status ignored resumed runs (blind-hunter) — counted
  - `[medium]` `[patch]` AC4's "after `wake`" e2e killed before the studio run was recorded (blind-hunter) — added a kill after the studio run and wake answer are recorded, before the invoke
  - `[low]` `[patch]` a failed resume record was swallowed, so the cap could be exceeded (edge-case-hunter) — no resume; `partial` `MISSING_STATUS_BLOCK; resume not recorded`

### 2026-09-28 — Review pass (follow-up)
- both layers ran (band L): blind-hunter, edge-case-hunter; the diff (219 KB, spec excluded) was handed to both as a file path, not inline
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 2, medium 2, low 2)
- defer: 0
- reject: 5 (medium 4, low 1) — a core `cancel` recorded as `partial` (jobrun `cancel` ends the run `partial` reason `cancelled`, so the state is the studio's own); the queue run ends `partial` while `studio_outcome` names an already-terminal studio state (AC1 names `partial` for a run that does not resume; `studio_outcome` carries the studio's own state by the DW-8 design); a restart resume ignores the tick's `--timeout-cap-s` (accepted pass-1 DRIFT, consult 1); an sbx restart end names the job guard, not `worker_guard_s` (consult 2 ruling names `max_wall_clock_seconds`); `mirror` throwing aborts `driveResumes` (`mirror` catches internally and never throws)
- addressed_findings:
  - `[high]` `[patch]` a `tk-studio-launch` run could be resumed (restart or in-process AC2) beside its live detached engine (edge-case-hunter) — the launch engine is probed before any resume; live or unverified refuses naming it, and the end paths hand the lock to the engine (consult 4, reading (a))
  - `[high]` `[patch]` `resumeBudget` counted and called `account` for jobs with no `max_turns`/`max_tokens`, so an sbx silent exit with no JSON result was never resumed and named a guard (both layers) — unguarded jobs skip counts and `account`, remaining = guard − spent (consult 4)
  - `[medium]` `[patch]` a failed `account` in the in-process resume check was attempted again after the loop and named twice (blind-hunter) — `accountAttempted` stops the second attempt
  - `[medium]` `[patch]` a swallowed `recordAccounted` failure after a restart let the resumed iteration re-count the same ids (both layers) — the ids ride on the prepared `Started` and seed `finishRun`; README names the account→event kill window
  - `[low]` `[patch]` the migration test skipped `worker_guard_s` (blind-hunter) — present, INTEGER, null on a migrated row
  - `[low]` `[patch]` four `test/guards.test.ts` titles said `blocked` while asserting `partial` (blind-hunter) — retitled

### 2026-09-28 — Review pass (follow-up 2)
- both layers ran (band L): blind-hunter, edge-case-hunter; the diff (239 KB, spec excluded) was handed to both as a file path, not inline
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 2, low 1)
- defer: 0
- reject: 2 (medium 1, low 1) — `run <job>` drives its own resumed run, then mints and answers a fresh one (both layers): no criterion names `run`'s answer, pre-story `run` already recovered then minted, and the resumed run's outcome is recorded on its queue run; `recover` answers `ok: true` when a resumed run it drove ended `blocked` (blind-hunter): `recover`'s `ok` means the recovery ran, and its JSON carries each resumed run's summary
- addressed_findings:
  - `[high]` `[patch]` an sbx silent exit was resumed in-process as soon as the host `sbx exec` exited, so a host-side drop could start a second in-VM worker on the same session (blind-hunter) — a read-only in-VM `ps -eo pid=,args=` check filtered host-side for the session id runs before `resumeCheck`; found or failed → `partial` `MISSING_STATUS_BLOCK; sbx worker may still run in the VM: …`, the lock kept until the in-VM deadline and freed by `claim`/`recover` (consult 5)
  - `[medium]` `[patch]` `recover` called `ops.end` on a stale candidate, so it could finish the studio run another recoverer had just taken over and resumed (both layers) — `stillOrphan` re-checks after each await, and a `recovering` mark (owner = self) in one transaction before `ops.end`
  - `[medium]` `[patch]` `groupAlive` counted a zombie-only process group as live, so a run and its lock could be held forever under a non-reaping PID 1 (blind-hunter) — Linux `/proc` scan for a non-zombie member of the group; a failed scan keeps `alive`
  - `[low]` `[patch]` a worker exiting between the probe and the kill (ESRCH) answered `kill failed` and held the run (edge-case-hunter) — re-probe after a failed kill; gone → `not running`

## Design Notes

- Anticipated DRIFTs (record if taken): the missing-block outcome changes from `blocked` to `partial` after a resume attempt (21-1/21-5 pins; score 2, affects none); resume driving placed in the caller rather than inside `Queue.recover` (score 2, affects 22-x only if the API reuses `recover`).
- Kill-point mapping for AC4: after `wake` → no session recorded → `partial`; mid-invoke → transcript exists → resumed; before `finish` → worker printed its block, supervisor died → transcript exists → resumed, and the resumed worker's block is finished.
- Remaining window to name in the result: between spawn and the `onSpawn` record the worker is unrecorded (a few ms); say so if it remains.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: no changes
- `bun test` (with `TK_STUDIO_ROOT` set) -- expected: all green, the three kill-point tests among them
- `bunx tsc --noEmit` -- expected: clean
- `git grep -n -E "(/c/|[A-Z]:\\\\|/home/|/Users/)" -- src test package.json README.md` -- expected: nothing
- `git diff --stat 92208cf7acc4e5ba6546aca234fef01992e9c546 -- package.json bun.lock` -- expected: empty

**Manual checks (unverifiable-here, operator, agent PC):**
- win32: kill the console-hosted supervisor mid-run, restart it; the run resumes (`--resume` on the worker's command line) or ends `partial`, and `Get-Process claude` shows no process left from the old worker.
- Delete a finished session's `.jsonl` under `%USERPROFILE%\.claude\projects`, force a resume; the file is restored from `<DEST>\claude-projects` (runbook §6).

## Deviation Summary

### pass 1 (2026-09-28, implementer)

- planned: resume driven inside `Queue.recover` / actual: `recover` only takes the run over; `recoverWithResume` and `driveResumes` in cli.ts drive it / why: keep `recover` short, and stop `run` driving its own resumed run twice / may affect: 22-x (if the API reuses `recover`)
- planned: missing status block stays `blocked` until a resume is attempted / actual: every silent exit (including early sbx 124/137 and host exit 124) ends `partial` with `MISSING_STATUS_BLOCK; <cause>`, e.g. `; no session recorded` / why: AC2 applies the resume-or-partial rule to every silent exit / may affect: none
- planned: `StudioOps {end, find}` plus a resume op / actual: `RecoverReport` gains a required `resumed[]`, optional `held[]` and `ended[].state`; `StudioEnder` returns `state?`; new `ResumeDecision` type / why: report takeovers, held runs and the studio's own terminal state / may affect: 22-x (consumers of the recover JSON, tick log)
- planned: never release a lock under a matching worker / actual: new "held" rule — a live worker whose start time is unreadable or whose kill failed leaves the run and lock as they are / why: the Never clause; the spec does not cover the unmatchable case / may affect: none
- planned: remaining wall clock = guard − `counters.wall_clock_seconds` / actual: that when `account` reports it, else seconds since the first worker spawn (else `verb_started`), downtime included / why: jobrun never sets `started` on skill runs, so `account` never reports it for them / may affect: none
- planned: sbx `find <vm config dir>/projects` / actual: an extra `sbx exec <sb> printenv HOME` call, then `find $HOME/.claude/projects` / why: the VM config dir is unknown and there is no shell / may affect: none
- planned: resume `account` with the interrupted iteration's counts / actual: sbx restart accounts 0/0 / why: the interrupted sbx result never arrived and the VM transcript is not read / may affect: none
- planned: counts already accounted carried on the `resumed` event / actual: also an `accounted` event per `account` call with the message ids; events `woke`/`session`/`worker` added; extra causes `no wake answer recorded`, `resume rebuild failed`, `studio run status failed`, lock held / why: the before-`finish` kill point would otherwise double count / may affect: none
- planned: same tier and guard on resume / actual: a restart resume uses the job's own guard, not the tick's `--timeout-cap-s` (not stored) / why: the cap is not recorded on the queue run / may affect: none
- planned: (unspecified) cost / actual: `total_cost_usd` summed across the original and resumed iterations / why: each `-p` result reports its own cost / may affect: none
- planned: `test/command-line.test.ts` changes only the fake worker plus AC4 / actual: several existing assertions updated too; `queue.test.ts` also gets `resumed: []` / why: consequences of the drifts above / may affect: none
- planned: AC4 kill by pid or `kill -9 $PPID` from the fake worker / actual: after-`wake` (after `submit`, studio-health is one-shot) and before-`finish` use a fake `uv` wrapper on PATH that kills its parent / why: nothing else runs as the supervisor's child at those points / may affect: none

DEVIATION SCORE: 2

DRIFT: resume driving lives in cli.ts (`recoverWithResume`/`driveResumes`); `Queue.recover` only takes over — keep recover short, no double drive — affects: 22-x
DRIFT: every silent exit (incl. early sbx 124/137, host 124) ends `partial` with `MISSING_STATUS_BLOCK; <cause>` instead of `blocked` — AC2 resume-or-partial rule — affects: none
DRIFT: `RecoverReport.resumed[]`/`held[]`/`ended[].state`, `StudioEnder` `state?`, `ResumeDecision` type — report takeovers and held runs — affects: 22-x
DRIFT: "held" rule — an unmatchable live worker or failed kill keeps the run and lock — never release a lock under a live worker — affects: none
DRIFT: remaining wall clock falls back to time since first worker spawn (else `verb_started`) — jobrun reports no `wall_clock_seconds` for skill runs — affects: none
DRIFT: sbx transcript check resolves VM `$HOME` via `sbx exec <sb> printenv HOME` first — no shell, unknown VM config dir — affects: none
DRIFT: sbx restart resume accounts 0/0 for the interrupted iteration — its result never arrived — affects: none
DRIFT: new events `accounted`/`woke`/`session`/`worker` and extra named causes — no double counting across the before-finish kill — affects: none
DRIFT: restart resume uses the job's own guard, not the tick's `--timeout-cap-s` — the cap is not stored — affects: none
DRIFT: `total_cost_usd` summed across original and resumed iterations — each result reports its own cost — affects: none
DRIFT: existing assertions in `test/command-line.test.ts`/`test/queue.test.ts` updated — consequences of the above — affects: none
DRIFT: AC4 after-wake/before-finish kills via a fake `uv` wrapper killing its parent — no other supervisor child at those points — affects: none

consult: accepted, score 2 (items 1 and 5 are the seam for 22-x: recover only takes over, the caller drives, the RecoverReport shape)

### pass 2 (2026-09-28, implementer, review patches)

- planned: sbx restart resumes like a host run / actual: held until recorded spawn + guard seconds + 10 s, then `partial` naming `max_wall_clock_seconds`, never resumed on restart; `claim` treats a dead-owner holder whose worker may still run as live / why: consult 2 (reading a) / may affect: 22-x
- planned: restart resume accounts in the resume check / actual: `account` runs only after the takeover win (`accounted` event, reason `supervisor restart`, `remaining_s`); a trip there ends through `mirror`/`endDriven` (`ended`, not `orphaned`) and is listed in `report.ended` / why: patch 5 / may affect: 22-x
- planned: `WorkerKill` outcomes killed|not running|start time differs|start time unreadable|kill failed / actual: adds `running`, `group alive`, `group killed`, `in-VM deadline not passed|passed`, `deadline`/`host`; `Probes` gains `probeWorker`/`now` / why: patches 1-4 / may affect: 22-x
- planned: (unspecified) sbx with no worker recorded / actual: `partial` `; no worker recorded (an sbx run is never resumed on restart)`; a legacy record without guard seconds uses the job's own guard / why: never resume sbx on restart, never release early / may affect: none
- planned: (unspecified) failed worker record / actual: `blocked` naming `worker record failed: <cause>`; win32 `taskkill` gets a 30 s timeout / why: a named failure, every child bounded / may affect: none
- planned: sbx deadline from the recorded spawn / actual: from the `worker` event time; microVM start lag beyond the 10 s grace is DW-3 remaining item 5 / why: the ruling's formula / may affect: none
- planned: after-wake kill on the auth preflight / actual: on the second auth call (the first is `runJob`'s login check), via a counter file / why: kill after the studio run and wake answer are recorded / may affect: none
- superseded: the pass-1 DRIFT "sbx restart resume accounts 0/0" is moot, because sbx never resumes on restart (consult 3)

DEVIATION SCORE: 2 (consult 3: accept-deviation score 2)

DRIFT: an sbx run interrupted mid-invoke is held until its in-VM deadline, then ends partial naming the wall-clock guard, never resumed on restart; claim treats a dead-owner holder with a possibly live worker as live — consult 2 ruling — affects: 22-x
DRIFT: restart `account` runs only after the takeover win (`accounted` event, reason `supervisor restart`, `remaining_s`); a trip there ends through `mirror` as `ended` with reason `orphaned: supervisor restart; guard: …`, listed in `report.ended`; `WorkerKill` gains outcomes `running`/`group alive`/`in-VM deadline not passed|passed` plus `deadline`/`host`; `Probes` gains `probeWorker`/`now`; sbx with no worker recorded ends `partial`; a failed worker record ends `blocked`; sbx deadline counts from the `worker` event — review patches 1-6 — affects: 22-x
DRIFT: after-wake e2e kill fires on the second auth call via a counter file — the first is runJob's login check — affects: none

### pass 3 (2026-09-28, implementer, follow-up review patches)

DEVIATION SCORE: 2 (both carry out review-sent patches and change a type shape: scored by the consult 3 rule candidate, no new consult)

DRIFT: `RunRecorder` gains optional `launchEngine(root)`; `queue.ts` exports `probeLaunchEngine`/`LaunchEngine` beside public `Queue.launchEngineAt` — `finishRun` holds only the recorder and needs a fallback probe without one (consult 4 H1) — affects: none
DRIFT: resume verdicts carry optional `accountAttempted`, and `accounted` is optional on `ResumeVerdict`; `Started` gains optional `accountedIds` — the post-loop block must tell an attempted `account` from none, an unguarded job accounts nothing (consult 4 H2), and the restart's accounted ids must reach `finishRun` — affects: none

### pass 4 (2026-09-28, implementer, follow-up review 2 patches)

DEVIATION SCORE: 2 (patch 1 pre-approved by consult 5; the others carry out review-sent patches and change an event/report shape, scored by the consult 3 rule candidate, no new consult)

DRIFT: `TranscriptChecks` gains a required `sbxWorkers` dep, `RunSummary` gains `hold_lock`, `Queue.end`/`endDriven` gain `holdLock`, `RecoverReport` gains `released[]`; an sbx AC2 refusal ends the run while keeping its lock, freed by `claim`/`recover` at the in-VM deadline — consult 5 — affects: 22-x
DRIFT: `recover` writes a `recovering` event (owner = self) before `ops.end`, and a `lock-released` event when an ended run's kept lock is freed; the e2e event-list assertion in `test/command-line.test.ts` updated — the patch-2 mark and the patch-1 release — affects: 22-x (event consumers)
DRIFT: the in-VM worker check runs on every sbx silent exit with a session id, including the second, so a found worker is named instead of `resume cap reached (1)` — the ruling's "before `resumeCheck`" order — affects: none

## Consult Log

- 2026-09-28T20:40:55Z — trigger: deviation-gt-0 — question: accept the 12 pass-1 deviations (resume driving in cli.ts, silent exits → partial with MISSING_STATUS_BLOCK, the "held" rule, wall-clock/sbx accounting fallbacks, RecoverReport/events shape)? — ruling: accept-deviation score 2 — do: (1) accept all 12 DRIFTs, diff and gate unchanged; (2) add to narrowed DW-3's "What remains" that a `held` run keeps its lock until its recorded pid dies, and where `processStartTime` returns null (not linux/win32) a reused pid can hold the run indefinitely, shown only in `held[]`; (3) record the ruling in Deviation Summary — rule candidate: When a story's Design Notes or plan Risks name a DRIFT in advance with a score, taking it with that score and stated affects needs no consult, provided the named-failure token survives in the reason.
- 2026-09-28T20:45:30Z — trigger: high-severity-finding (review pass 1) — question: (H1) an sbx restart kills only the host `sbx exec`, so a resume starts a second worker beside the live VM worker — hold until the in-VM deadline (a), `pkill -f <uuid>` in the VM (b), `sbx stop` (c), or record the in-VM pid (d)? (H2) `Queue.claim` releases a dead-owner running holder's lock without checking its recorded worker — fix here or defer? — ruling: accept-deviation score 2 — do: (1) H1 reading (a): hold an sbx run until recorded spawn + guard seconds passed to that spawn + 10 s grace, keyed on that deadline and not on host pid liveness, with the guard seconds recorded on the worker record; after it, end `partial` naming `max_wall_clock_seconds`; reject (b)(c)(d); (2) apply the claim fix: a dead-owner running holder is live while its recorded worker may still run (pid alive with matching or unreadable start, or sbx deadline not passed); unit tests for both in test/resume.test.ts; (3) DRIFT "an sbx run interrupted mid-invoke is held until its in-VM deadline, then ends partial naming the wall-clock guard, never resumed on restart; claim treats a dead-owner holder with a possibly live worker as live" score 2 affects 22-x; narrow DW-3 to match — rule candidate: Any code path that frees a checkout lock must first pass the same "recorded worker may still run" predicate; for sbx that predicate is the in-VM deadline (spawn + guard + kill grace), never host pid liveness.
- 2026-09-28T21:00:05Z — trigger: deviation-gt-0 (review-patch pass 2) — question: accept the six pass-2 deviations (account after takeover, WorkerKill/Probes shape, sbx no-worker end, worker-record failure blocked, deadline from the worker event, after-wake kill on the 2nd auth call)? — ruling: accept-deviation score 2 — do: (1) accept all six, diff and gate unchanged; (2) add the combined DRIFT line (affects 22-x) to the Deviation Summary; (3) mark the pass-1 "sbx accounts 0/0" DRIFT superseded without deleting it — rule candidate: A deviation that only carries out a review-sent patch, keeps every spec-named reason token and states its affects needs no consult: DRIFT score 2 if it changes a report/event/type shape, otherwise 1.
- 2026-09-28T21:38:20Z — trigger: high-severity-finding (follow-up review pass) — question: (H1) a `tk-studio-launch` run can be resumed (restart or in-process AC2) beside its live detached engine — probe the engine before resuming (a) or never resume a launch run (b)? (H2) `resumeBudget` runs counts + `account` for jobs with no `max_turns`/`max_tokens`, so an sbx silent exit with no JSON result is refused as `guard: account failed` — skip account when unguarded? — ruling: apply — do: (1) H1 reading (a): before any resume of a LAUNCH_SKILL run, probe the launch engine outside any transaction in `restartResumer` and in `finishRun`'s AC2 branch (public wrapper over `Queue.launchEngine` or the `Probes.engineLive` dep); live or unverified refuses the resume naming it (`launch engine live: <id>` / `launch engine unverified: <detail>`) and the existing end paths hand the lock to the engine; an empty `live[]` continues the AC1/AC2 checks; reject (b); a test per layer and one README clause; (2) H2: in `resumeBudget`, when `!hasTurnTokenGuard(i.defn)` skip `i.counts()` and `account` entirely (no `accounted`, no event, no noteAccounted), remaining = `guardS − spentS`; a guarded job with unavailable counts keeps refusing with the existing cause; never account zero; (3) pin both with tests: an unguarded sbx silent exit resumes, a guarded one ends partial naming `account failed` — rule candidate: any path that resumes, re-drives or frees the lock of a `tk-studio-launch` run passes the launch-orphan engine probe first (live or unverified = no resume or release), and studio `account` is called only when `hasTurnTokenGuard(defn)` holds, on every path (observation recorded)
- 2026-09-28T21:54:53Z — trigger: high-severity-finding (follow-up review pass 3) — question: an sbx silent exit is resumed in-process as soon as the host `sbx exec` exits (src/cli.ts:1223), so a host-side sbx drop can start a second in-VM worker on the same session beside a live one — fix by exit code (a), a read-only VM process check (b), reject as out of AC2 scope (c), or escalate (d)? — ruling: apply — do: (1) for `tier === "sbx"`, after the launch-engine probe and before `resumeCheck`, run `sbx exec <sb> ps -eo pid=,args=` (argv only, no shell, no signal, an injectable dep beside `TranscriptChecks.sbx`) and filter host-side for the session id; a line carrying it, or a failed check, refuses the resume with cause `sbx worker may still run in the VM: <pid | probe failed: detail>`; reject (a), (c) and a pattern kill; (2) on that refusal end the run `partial` `MISSING_STATUS_BLOCK; <cause>` without freeing the checkout lock — it is freed only through `Queue.recordedWorker`'s in-VM deadline (spawn + guard + 10 s), as consult 2 does on restart; (3) keep consult 4's pinned test by injecting a check that finds no worker, add a found-worker test and a failed-check test, and record a DRIFT score 2 (dep/type shape), affects 22-x — rule candidate: On sbx the host `sbx exec` exit never proves the in-VM worker ended; any path that starts another worker on a recorded sbx session or frees its lock needs the in-VM deadline passed or a read-only VM process check showing no process carrying the session id (a failed check counts as live)
- 2026-09-28T22:10:36Z — trigger: verify-red (follow-up review pass 3, after the patch pass) — question: `bun test` 423 pass / 3 fail, all `test/guards.test.ts:463-497` (21-5 supervisor-signal tests); they fail identically on untouched worktrees of HEAD 7ee5dd8 and of baseline 92208cf, pass when the scenario is run by hand outside `bun test` — accept as pre-existing and finish `done` (a), HALT blocked (b), relaunch to fix 21-5's signal path (c), or escalate (d)? — ruling: escalate — do: (1) HALT `blocked` naming `verify gate red: test/guards.test.ts:463-497 signal tests (21-5 feature, src/server.ts:195-245) fail in this environment, also at baseline 92208cf; not a 21-6 regression`; (2) keep the patch pass as it is, record `bun test` 423 pass / 3 fail verbatim with the evidence under Verification, do not change src/server.ts's signal path or that test; (3) ask the operator to re-run `bun test` on a clean host — green there, the operator may mark 21-6 `done` without relaunching — rule candidate: When the verify gate is red only on tests that also fail on an untouched worktree of the story baseline and sit outside the story's plan Files scope, the session HALTs `blocked` with reason prefix `verify gate red (pre-existing at baseline <sha>)` and does not consult

## Auto Run Result

Status: done
Previously: blocked (2026-09-28T22:11Z) — verify gate red: test/guards.test.ts:463-497 signal tests (21-5 feature, src/server.ts:195-245) fail in this environment, also at baseline 92208cf; not a 21-6 regression (consult 6 ruled `escalate`: a consult cannot waive the gate). Closed by the operator resolution at the end of this file.

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review of a story already marked `done`. Both review layers ran. Four patches were applied and are left uncommitted in the working tree, as consult 6 directed ("keep the patch pass as it is"):
- An sbx silent exit now resumes only when a read-only in-VM check finds no process carrying the session id. Otherwise the run ends `partial` naming it, and the lock is kept until the in-VM deadline.
- `recover` no longer ends a studio run that another recoverer took over. It re-checks after every await and marks the run as its own before `ops.end`.
- A process group whose only members are zombies no longer counts as live.
- A worker that exits between the probe and the kill no longer answers `kill failed`.

**Files changed in this pass** (uncommitted):
- `src/queue.ts`: `stillOrphan` re-checks and the `recovering` mark; `holdLock` on end paths; `releaseKeptLocks`; `claimProbes` covers ended holders; zombie-aware `groupAlive`; re-probe after a failed kill.
- `src/cli.ts`: the `sbxWorkers` dep and `sbxVmWorkerCause`; the in-VM worker check in `finishRun`'s AC2 branch; `hold_lock` passed through `mirror`.
- `src/transcript.ts`: `sbxWorkerArgv`, `sessionWorkerPids`, `sbxSessionWorkers`.
- `test/resume.test.ts`: tests for the VM worker found / check failed / host never asks, the two recover race orderings plus a dead recoverer after its mark, the zombie group parser and predicate, and the kill races.
- `test/command-line.test.ts`: `recovering` added to the pinned event list (assertion only).
- `README.md`: one clause on the sbx in-VM worker check.
- The deferred-work ledger was not touched.

**Review findings** (this pass):
- Patches applied: 4 (high 1, medium 2, low 1).
- Deferred: 0.
- Rejected: 2.
- Consults: 2. Consult 5 (high-severity-finding) ruled `apply`; consult 6 (verify-red) ruled `escalate`.
- Follow-up review recommended: **true**. One high finding was patched; the score is 3×2 + 1×1 = 7.

**Verification** (re-run by this session after the patches):
- `bun install --frozen-lockfile`: no changes.
- `bun test` with `TK_STUDIO_ROOT` set: **423 pass, 3 fail**, 1657 expect() calls, 426 tests across 9 files. The three failures are `test/guards.test.ts` "a signal to the supervisor kills its detached children's groups, then it exits as before" > SIGTERM / SIGHUP / SIGINT, at `expect(survivors).toEqual([])` (:494). The child and grandchild are still alive and are not zombies.
- Evidence that this predates 21-6:
  - On an untouched worktree of HEAD 7ee5dd8 the same tests fail 3/3, twice.
  - On an untouched worktree of baseline 92208cf (story 21-5's commit) they fail 2/3.
  - The same scenario passes when run by hand outside `bun test`: the child and grandchild are killed and the supervisor exits 15.
  - They still fail with a cleared signal mask.
  - Environment: bun 1.4.2, PID 1 is `tini`.
  - Earlier passes recorded 413 pass / 0 fail.
- `bunx tsc --noEmit`: clean.
- Machine-path `git grep` over `src`, `test`, `package.json` and `README.md`: nothing.
- `git diff --stat 92208cf… -- package.json bun.lock`: empty.

**Operator action:** re-run `TK_STUDIO_ROOT=<studio root> bun test` on a clean host. If it is green there, 21-6 can be marked `done` and this pass's changes committed, with nothing to relaunch (consult 6).

**unverifiable-here** (operator, agent PC): unchanged from the earlier passes. These are a live `--session-id`/`--resume` id check, the win32 kill-and-restart check, and the backup restore from `<DEST>\claude-projects`.

**Residual risks:**
- An sbx silent exit with no session id skips the in-VM check.
- A launch run refused by the in-VM check keeps its lock until the deadline, then hands over to the engine at the next claim.
- `Queue.pacing()` does not treat an ended run that keeps its lock as live, so the pacer may start the next run, which then waits on the lock.
- A recoverer that dies after its `recovering` mark but before `ops.end` finishes can leave the studio run resumable, and the next `recover` may resume it.
- The residual risks from the earlier passes still stand. These are the spawn→record window, a `jobrun.py` verb in flight, the account→event window, held runs where start times cannot be read, sbx microVM start lag, the tick log not showing resumed runs, and the win32 paths (DW-5).

DRIFT: `TranscriptChecks` gains a required `sbxWorkers` dep, `RunSummary` gains `hold_lock`, `Queue.end`/`endDriven` gain `holdLock`, `RecoverReport` gains `released[]`; an sbx AC2 refusal ends the run while keeping its lock, freed by `claim`/`recover` at the in-VM deadline — consult 5 — affects: 22-x
DRIFT: `recover` writes a `recovering` event before `ops.end`, and a `lock-released` event when a kept lock is freed; the e2e event-list assertion was updated — the recover race mark and the kept-lock release — affects: 22-x (event consumers)
DRIFT: the in-VM worker check runs on every sbx silent exit with a session id, including the second, so a found worker is named instead of `resume cap reached (1)` — the ruling's check order — affects: none

## Operator Resolution

### 2026-09-28 — attended session (agent PC), after the run paused on this story

- **Cause of the red gate.** A race in story 21-5's signal path, not the environment. `runProcess` installed its SIGINT/SIGTERM/SIGHUP handlers after `spawn()` returned, and `spawn()` returns some milliseconds after the child is already running. A signal in that gap met no handler: the supervisor died by the default action and the worker's group stayed alive. Timing marks in a scratch copy showed the test's signal arriving before the supervisor had logged the spawn's return.
- **Fix.** Commit `76ded1b` (attended, outside the loop): `runProcess` arms the handlers before the spawn and tracks the group after it. `test/guards.test.ts` gains one test, where the child sends SIGTERM to the supervisor as soon as it has written its pids.
- **Evidence.** In the engine sandbox, the four signal tests on the old code failed in 15 runs of 15. On `76ded1b` they passed in 15 of 15.
- **This pass's changes** were committed as they stood in `b78a3fa`, as consult 6 directed.
- **Verify gate on `76ded1b`:**
  - Linux (engine sandbox, bun 1.4.2): `bun test` 427 pass, 0 fail, three runs; four suites in parallel, 0 fail; `bunx tsc --noEmit` clean.
  - Windows host (bun 1.4.2, a separate clone): `bun test` 365 pass, 61 skip, 0 fail; `tsc --noEmit` clean.
- **Spec file name.** The dev session wrote this file as `<id>.md`. The engine resolves `<id>-*.md`, so it read the story as pending. Renamed in `eaf9ea4`.
- **unverifiable-here, checked on the agent PC:**
  - Live `--session-id` then `--resume`: both runs report the same `session_id` (Claude Code 2.1.274, Max login). Pass.
  - The win32 kill-and-restart check and the backup restore were **not** run. They need the supervisor started on the host, which is never done from a Claude desktop-app session. They go to Story 22.3 with DW-5.
- **Not run by the engine for this story:** the studio gate (reconciled below by hand) and the `post_commit` meter (metered from the archived run).

## Reconcile

### 2026-09-28 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT is `affects: none` or names 22-x. The 22-x ones change what Epic 22 reads from the queue and how a supervisor start recovers: resume driving lives in `cli.ts` (`recoverWithResume`/`driveResumes`), the recover report and the event list grew, a run can be `held`, and an ended run can keep its checkout lock until the in-VM deadline. No Epic 22 Given/When/Then has to change. Notes in the stories' `invoke_dev_with` can absorb all of it. Reconciled by the attended session, because the run paused before the studio gate.
- Affected: 22-1-the-api-answers-on-the-tailnet-only — "each answers from the queue; cancel ends the run `cancelled`" (the event kinds and run states the API serves grew; a cancel must respect a held run and a kept lock)
- Affected: 22-2-a-read-only-status-page — "it shows the queue (jobs, and runs with state, reason, and cost)" (held runs, kept locks and the longer reasons must be shown; cost is summed across resumed iterations)
- Affected: 22-3-the-supervisor-starts-itself-at-logon — "starts the API and the pacer" (the start must run the CLI's resume-driving recovery, not `Queue.recover` alone; the two host checks this story could not run)
- Invariant: none (AD-2, AD-11, AD-14 and AD-15 hold; no plugin, schema or contract change)
- Gate: Part A adjust-stories, by hand; Part B not applicable, this is the epic's last story
