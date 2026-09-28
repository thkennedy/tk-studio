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

## Consult Log

- 2026-09-28T20:40:55Z — trigger: deviation-gt-0 — question: accept the 12 pass-1 deviations (resume driving in cli.ts, silent exits → partial with MISSING_STATUS_BLOCK, the "held" rule, wall-clock/sbx accounting fallbacks, RecoverReport/events shape)? — ruling: accept-deviation score 2 — do: (1) accept all 12 DRIFTs, diff and gate unchanged; (2) add to narrowed DW-3's "What remains" that a `held` run keeps its lock until its recorded pid dies, and where `processStartTime` returns null (not linux/win32) a reused pid can hold the run indefinitely, shown only in `held[]`; (3) record the ruling in Deviation Summary — rule candidate: When a story's Design Notes or plan Risks name a DRIFT in advance with a score, taking it with that score and stated affects needs no consult, provided the named-failure token survives in the reason.
- 2026-09-28T20:45:30Z — trigger: high-severity-finding (review pass 1) — question: (H1) an sbx restart kills only the host `sbx exec`, so a resume starts a second worker beside the live VM worker — hold until the in-VM deadline (a), `pkill -f <uuid>` in the VM (b), `sbx stop` (c), or record the in-VM pid (d)? (H2) `Queue.claim` releases a dead-owner running holder's lock without checking its recorded worker — fix here or defer? — ruling: accept-deviation score 2 — do: (1) H1 reading (a): hold an sbx run until recorded spawn + guard seconds passed to that spawn + 10 s grace, keyed on that deadline and not on host pid liveness, with the guard seconds recorded on the worker record; after it, end `partial` naming `max_wall_clock_seconds`; reject (b)(c)(d); (2) apply the claim fix: a dead-owner running holder is live while its recorded worker may still run (pid alive with matching or unreadable start, or sbx deadline not passed); unit tests for both in test/resume.test.ts; (3) DRIFT "an sbx run interrupted mid-invoke is held until its in-VM deadline, then ends partial naming the wall-clock guard, never resumed on restart; claim treats a dead-owner holder with a possibly live worker as live" score 2 affects 22-x; narrow DW-3 to match — rule candidate: Any code path that frees a checkout lock must first pass the same "recorded worker may still run" predicate; for sbx that predicate is the in-VM deadline (spawn + guard + kill grace), never host pid liveness.
- 2026-09-28T21:00:05Z — trigger: deviation-gt-0 (review-patch pass 2) — question: accept the six pass-2 deviations (account after takeover, WorkerKill/Probes shape, sbx no-worker end, worker-record failure blocked, deadline from the worker event, after-wake kill on the 2nd auth call)? — ruling: accept-deviation score 2 — do: (1) accept all six, diff and gate unchanged; (2) add the combined DRIFT line (affects 22-x) to the Deviation Summary; (3) mark the pass-1 "sbx accounts 0/0" DRIFT superseded without deleting it — rule candidate: A deviation that only carries out a review-sent patch, keeps every spec-named reason token and states its affects needs no consult: DRIFT score 2 if it changes a report/event/type shape, otherwise 1.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** A killed run now resumes or ends `partial` with the cause named; it is never lost.
- **Recording:** before the worker spawns, the supervisor records a pre-minted session id (`--session-id <uuid>`), the wake answer, and then the worker's pid/process group, its start time and its guard seconds, all on the queue run.
- **AC1:** on restart, `Queue.recover` kills a dead owner's recorded worker, but only when pid + start time match (or its POSIX group is still alive). It then takes the run over in one transaction (lock kept, `resumed` event), and the caller drives `claude -p --resume <sid>` on the stored tier through 21-5's guards. Otherwise the run ends `partial` with a reason starting `orphaned: supervisor restart; <cause>`. Every restart end goes through `end`'s `stop`/`studio_outcome` path (DW-8). A run whose worker may still be alive is held, and `claim` waits on it too (DW-3, DW-7). An sbx run is held until its in-VM deadline, then ends `partial` naming the wall-clock guard.
- **AC2:** a silent exit resumes once in-process. A second failure ends `partial`, and the reason keeps `MISSING_STATUS_BLOCK`.
- **AC3:** a missing host transcript is restored from `TK_SUPERVISOR_TRANSCRIPT_BACKUP` (runbook §6). If there is no copy, the run ends `partial` naming `transcript missing: <sid>`.
- **AC4:** end-to-end tests kill the supervisor after `wake` (and after `submit` before recording), mid-invoke, and before `finish`. Each case ends resumed or `partial`, with its events asserted.

**Files changed:**
- `src/queue.ts`: new run columns and events; the resume takeover, the held rule and the recorded-worker kill/predicate shared by `recover` and `claim`; restart ends carry the stop.
- `src/cli.ts`: records the session, worker and wake answer; the resume eligibility check and driver; the AC2 silent-exit resume; `account` only after the takeover and only for new message ids; `drain` counts resumed runs in its exit status.
- `src/server.ts`: `--session-id`/`--resume`, the continuation prompt, the `beforeSpawn`/`onSpawn` hooks, and a failed worker record killing the child.
- `src/transcript.ts`: new-message counts, the backup restore, and the sbx existence check (argv only).
- `test/resume.test.ts` (new): every I/O matrix row, the kill/hold/claim rules, and concurrent recoverers.
- `test/command-line.test.ts`: a fake worker that honours the new flags, and the AC4 kill points end to end.
- `test/queue.test.ts`: the column migration, the takeover keeping the lock, and the orphan stop.
- `test/guards.test.ts`: assertions only (missing block → resume or `partial`).
- `README.md`: the restart/resume rule, the backup variable, the one-resume cap, the sbx hold, and `claim` waiting.
- `_bmad-output/implementation-artifacts/deferred-work.md`: DW-7 and DW-8 closed, DW-3 narrowed to what remains.

**Review findings:** both layers ran (band L).
- Patches applied: 9 (high 2, medium 6, low 1).
- Deferred: 0.
- Rejected: 7.
- Consults: 3 (pass-1 deviations; the sbx/`claim` highs; pass-2 deviations), all `accept-deviation score 2`.
- Follow-up review recommended: **true**. Two high findings were patched (score 3×6 + 1×1 = 19).

**Verification** (re-run by this session after the patches):
- `bun install --frozen-lockfile`: no changes.
- `bun test` (with `TK_STUDIO_ROOT` set): 403 pass, 0 fail, across 9 files.
- `bunx tsc --noEmit`: clean.
- Machine-path `git grep` over `src`, `test`, `package.json` and `README.md`: nothing.
- `git diff --stat 92208cf… -- package.json bun.lock`: empty.
- Matrix test audit: every row is covered in `test/resume.test.ts` and passed.

**unverifiable-here** (operator, agent PC):
- The installed CLI was checked only through `claude --help` (`--session-id`, `-r/--resume`). A live `claude -p --session-id <uuid>` followed by `claude -p --resume <uuid>` confirming the same id was not run here (it needs the Max login). Run once: `claude -p "hi" --session-id <uuid> --output-format json`, then `claude -p "continue" --resume <uuid> --output-format json`; both results should show `session_id` = `<uuid>`.
- win32: kill the console-hosted supervisor mid-run and restart it. The run should resume (`--resume` on the worker's command line) or end `partial`, and `Get-Process claude` should show nothing left from the old worker.
- Delete a finished session's `.jsonl` under `%USERPROFILE%\.claude\projects`, then force a resume. The file should be restored from `<DEST>\claude-projects`.

**Residual risks:**
- The few milliseconds between the spawn and the worker record.
- A `uv run jobrun.py` verb in flight when the supervisor dies is never recorded, so it is never killed.
- A held run waits until its pid dies. On platforms without readable start times, a reused pid can hold it indefinitely (DW-3).
- sbx microVM start lag beyond the 10 s grace.
- An sbx run killed mid-invoke never resumes on restart.
- The tick's log does not report resumed or held runs (`src/tick.ts` untouched).
- The win32 paths are not exercised here (DW-5).

DRIFT: resume driving lives in cli.ts (`recoverWithResume`/`driveResumes`); `Queue.recover` only takes over — keep recover short, no double drive — affects: 22-x
DRIFT: every silent exit (incl. early sbx 124/137, host 124) ends `partial` with `MISSING_STATUS_BLOCK; <cause>` instead of `blocked` — AC2 resume-or-partial rule — affects: none
DRIFT: `RecoverReport.resumed[]`/`held[]`/`ended[].state`, `StudioEnder` `state?`, `ResumeDecision` type — report takeovers and held runs — affects: 22-x
DRIFT: "held" rule — an unmatchable live worker or failed kill keeps the run and lock — never release a lock under a live worker — affects: none
DRIFT: remaining wall clock falls back to time since first worker spawn (else `verb_started`) — jobrun reports no `wall_clock_seconds` for skill runs — affects: none
DRIFT: sbx transcript check resolves VM `$HOME` via `sbx exec <sb> printenv HOME` first — no shell, unknown VM config dir — affects: none
DRIFT: sbx restart resume accounts 0/0 for the interrupted iteration — superseded (sbx never resumes on restart) — affects: none
DRIFT: new events `accounted`/`woke`/`session`/`worker` and extra named causes — no double counting across the before-finish kill — affects: none
DRIFT: restart resume uses the job's own guard, not the tick's `--timeout-cap-s` — the cap is not stored — affects: none
DRIFT: `total_cost_usd` summed across original and resumed iterations — each result reports its own cost — affects: none
DRIFT: existing assertions in `test/command-line.test.ts`/`test/queue.test.ts` updated — consequences of the above — affects: none
DRIFT: AC4 after-wake/before-finish kills via a fake `uv` wrapper killing its parent — no other supervisor child at those points — affects: none
DRIFT: an sbx run interrupted mid-invoke is held until its in-VM deadline, then ends partial naming the wall-clock guard, never resumed on restart; claim treats a dead-owner holder with a possibly live worker as live — consult 2 ruling — affects: 22-x
DRIFT: restart `account` runs only after the takeover win; a trip there ends through `mirror` as `ended`; `WorkerKill`/`Probes` shapes grow; sbx with no worker recorded ends `partial`; a failed worker record ends `blocked`; sbx deadline counts from the `worker` event — review patches — affects: 22-x
DRIFT: after-wake e2e kill fires on the second auth call via a counter file — the first is runJob's login check — affects: none
