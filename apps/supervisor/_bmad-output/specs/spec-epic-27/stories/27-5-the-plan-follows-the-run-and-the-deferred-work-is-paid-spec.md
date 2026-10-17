---
title: 'The Plan Follows the Run, and the Deferred Work Is Paid'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '9b7e241488b5ecfbe96406a4afd2c3d5b2ef84f6'
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-27/plans/27-5.md'
  - '{project-root}/_bmad-output/specs/spec-epic-27/operator-decisions.md'
warnings: [oversized, multiple-goals]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The plan index under-reports what is built (hole 18), and the supervisor's ledger still holds the queue's honesty debts: cost lost across resumes (DW-15), cancel races (DW-12, DW-13), kept locks the pacer ignores (DW-11), a slow win32 worker record (DW-19), a certificate that never renews (DW-21), a refused `finish` that overwrites the worker's reason (DW-23), plus the replan's orphan close-out with pin release (27.1 known gap, DW-25) and a resume in flight across a restart (DW-29).

**Approach:** The supervisor calls the owning project's `plansync.py status` (Story 26.5, at `$TK_STUDIO_ROOT`, operator-decisions §1) when a run's PR opens (`review`) and merges (`done`), and pays each ledger entry in the shapes settled in `plans/27-5.md` § "Settled shape" (authoritative for this story; transcribed below).

### Acceptance criteria (verbatim, epics.md Story 27.5)

1. **AC1:** **Given** a run that opens a PR **When** the `ended` event is written **Then** the supervisor calls the planning adapter's status verb (Story 26.5) on the project that owns the plan (the registry names it; a transcribed epic names its owner) for every story the run's spec marked done, setting `review`; the next tick that sees the PR merged sets `done`; both are recorded on the run's events, and a refused call never changes the run's state
2. **AC2:** **Given** a run resumed after a restart **When** it finishes **Then** `run.json`'s `total_cost_usd` is the sum across every iteration (per-iteration cost recorded as `accounted` events; DW-15)
3. **AC3:** **Given** a cancel racing a claim or a late studio-run record **When** both happen **Then** the cancel ends the studio run it finds on a re-read inside the end transaction, or the next recovery ends it, and no run is left unended (DW-12, DW-13); an ended run that keeps its lock counts as live for the pacer (DW-11)
4. **AC4:** **Given** the worker record on win32 **When** it is written **Then** the pid lands before the start time, and the start time is read natively (`GetProcessTimes` through `bun:ffi` or an equivalent that takes under 50 ms), so a supervisor killed inside the window still leaves a usable record (DW-19)
5. **AC5:** **Given** the TLS certificate and a refused `finish` **When** the certificate is within 14 days of expiry, or a skill run finished itself **Then** the keeper renews the certificate and restarts `serve` once, outside a live run, with an event (DW-21); and a refused `finish` on an already-terminal studio run leaves the run's reason as the worker's own status-block reason, never the refusal text (DW-23)
6. **AC6:** **Given** the supervisor's test suite **When** the story closes **Then** every case above is pinned on both hosts, the deferred-work entries are closed with their evidence, and the runbook §4 names the new events and the certificate rule

## Boundaries & Constraints

**Always:**
- Files boundary = the plan's 20 files (listed under Tasks). Any other file is a deviation to record; growth past 20 files → HALT for `bmad-correct-course`.
- Replan rulings (binding): key the pull-back on `ended.detail.pr`, else the latest `closed_out.detail.pr` (late PR); skip `external` runs; read every spec marked done on the run branch (spans relaunches). Orphan close-out goes through `closeOut`, reads "launched" as a `launched` event after the latest `close-out`/`engine-resume` (as `recover`/`awaitingEngine` do), confirms a resumed engine dead first (DW-29), and calls `releasePin` once the engine is confirmed dead (DW-25). DW-13's late studio-run record is handled on the queue run itself (re-read in the end transaction); external detection keeps skipping a checkout with a live queue run. Sum cost per `accounted` event across relaunched and resumed iterations; never count `launched` events as iterations. A refused deferred `finish` (DW-23) keeps the worker's reason.
- Subprocesses argv-only, no shell; `plansync.py` spawned via `uvRunner(deps)` + `studioScript(deps,"lib","plansync.py")`; plan-status recorded via `queue.note` (no state change).
- Runbook §4 rows (in the hand-over file) list 27.1's event kinds (`launched`, `paused`, `materialised`, `closing-out`, `closed_out`, `lock-released`), 27.3's (`close-out`, `close-out-failed`, `awaiting-ruling`, `engine-resume`, `hold`), this story's new events and the certificate rule.
- Win32-only checks are `unverifiable-here` (operator-decisions §5): pin with `skipIf` + pure-format tests on Linux.

**Block If:**
- Owner resolution needs a field the registry schema or driver contract lacks (beyond the settled `epics.md` `source` reading).
- `plansync.py status` at `$TK_STUDIO_ROOT` lacks the argv `--directory --id --status [--note] [--caller]`.
- Closing DW-12 needs an owner-liveness probe inside the SQLite transaction.

**Never:** fake `plansync.py` in production code; add a registry field; change the driver contract or plugin; merge PRs; run the 27.4 verify leg on an orphan; touch DW-31/DW-32; push, tag or touch remotes; edit `epics.md`, `SPEC.md`, `stories.yaml`, `.bmad-loop/routing.toml|policy.toml`, or anything under `supervision/`; touch `bun.lock`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Review pull-back | terminal worktree run, `ended.detail.pr` set, run branch has a spec `status: done` | one `plan-status {phase:review, ok:true, id, previous_status}` per story; `plansync status --status review --caller tk-studio-supervisor --note "run <id> PR <url>"` | none |
| Late PR | PR only on `closed_out` | same as above, PR from latest `closed_out` | — |
| Owner transcribed | run project's `epics.md` frontmatter `status: transcribed`, `source: "org/repo …"` | owner = registry entry `repo` | absent / no `plan/` dir → one `skipped` event per phase with reason, nothing called |
| ST lookup | 0 or >1 `ST-*.md` with `source: epics.md#story-N.M` | `skipped` event, reason `no plan entity…` / `several plan entities…` | — |
| Refused verb | exit 2 `{ok:false,error}` or `{blocked:true}` | `plan-status ok:false` with error/reason; run state unchanged; never retried for that phase | — |
| Merge | `review` recorded, no `done` | `gh pr view` `MERGED` → `done` calls; `CLOSED` → one `{phase:done, skipped, reason:"pr closed unmerged"}`; `OPEN`/gh failure → nothing, retry next tick | — |
| External run | `external` | no calls | — |
| No repeat | two ticks | review/done each called once | — |
| Resume cost | iteration costs a, b across restart | `finish --total-cost-usd a+b`; `accounted` events carry `cost_usd` | — |
| Engine relaunch cost | close-out relaunch archives engine run | `accounted {cost_usd, engine_run_id, source:"engine"}` before archive; final cost = sum + latest metered | — |
| Cancel late studio run | `setStudioRun` lands after cancel's read | `Queue.end` re-read returns new id; ender ends it after commit; `studio-run-ended {studio_run_id, late:true}` | recovery ends a leftover `cancelled` run's non-terminal studio run |
| Cancel vs claim | different live owner at end | run lock kept for that driver | — |
| Pacer | terminal run still holding a `run` lock | counted live | — |
| Worker record | pid then start | pid + `worker` event commit first; start time second update | kill in window → pid usable |
| Orphan close-out | `recover` orphans a worktree run, engine dead | `closeOut` (no verify), `closed_out`, `releasePin` | engine alive → wait; latest move `engine-resume` with live engine → not orphaned (`respawnHolds`) |
| Cert | ≤14 days, nothing `running`/`external`, no request in 24 h | `cert-renew-requested` in `service_events`, exit 75; keeper renews + immediate restart; next start `cert-renewed`/`cert-renew-failed` | live run → wait |
| Refused finish | studio run already terminal | queue reason = status-block reason; `finish-refused {error, actual_state}` event | — |

</intent-contract>

## Code Map

The full, line-anchored investigation is `plans/27-5.md` § "Code Map" (anchors at `c8b2b45`; `src/` and `test/` are unchanged at HEAD `9b7e241`). Key seams:

- `src/worktree.ts` -- `uvRunner`/`studioScript` (:97-98), `runBranch` (:116), private `gh` (:150-154, export it), `meteredCost` (:306), `closeOut` (:349), `closeOutDetail` sets `pr` (:525-533), `launchedCloseOutInput` (:474-482), `ended`/`closed_out` writes (:626-703).
- `src/closeout.ts` -- `frontmatter` (:81), `findSpec` (:98-112), `meterStep` pattern (:242-253), `archiveStep` (:255), `launchedSinceMove` (:284).
- `src/cli.ts` -- `recoverQueue` finally (:573-587), `drainQueue` (:648-650), `runJob` (:967-969), `cancelQueueRun` (:742-847), `studioRunEnder` (:386-401), `queueRecorder.worker` (:1235-1244), `finishRun` (:1746-1952; refusal :1933-1952), `serve` (:1966-1977).
- `src/queue.ts` -- `processStartTime` (:179-192), `pacing` (:823), `recordAccounted` (:1290), `setWorker` (:1279), `end`/`writeEnd` (:1708-1741), `note` (:1787), `recover` (:1830-1981), `awaitingEngine` (:1462), close-out lease seams (:1479-1513), `engineAliveAfterKill` (:923), `releaseKeptLocks` query (:2004-2008), events table (:596).
- `src/sandbox.ts` -- `releasePin` (:114), `respawnHolds` (:265), `studioRunDir` (:390).
- `src/env.ts` -- `tlsConfig`/`checkTlsFiles` (:202-212). `src/api.ts` TLS bind (:483-499).
- `start.ps1` -- `tailscale cert` (:106-136), keeper (:142-176).
- `$TK_STUDIO_ROOT/plugins/tk-studio/lib/plansync.py:863-871` -- `status` verb (verified present).
- Tests to change: `test/command-line.test.ts:610` (now expects status-block reason), `test/hygiene.test.ts:677` (cert call count).

## Tasks & Acceptance

**Execution:**
- `src/planstatus.ts` (new) -- owner resolution, done-spec enumeration via `git diff --name-only <base_ref>...supervisor/run-<id>` + `git show`, ST lookup, `plansync status` calls, review pass, merge pass -- AC1.
- `src/winproc.ts` (new) -- `bun:ffi` kernel32 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`+`GetProcessTimes`+`CloseHandle`; pure FILETIME→`yyyy-MM-ddTHH:mm:ss.fffffffZ` formatter -- AC4.
- `src/cert.ts` (new) -- `X509Certificate` `notAfter` check, renew request (exit 75), `cert-renewed`/`cert-renew-failed` on start -- AC5.
- `src/queue.ts` -- `accounted.cost_usd` + sum; pacing kept-lock live; `end` re-read of studio run/owner; cancelled-run recovery list; `setWorker` pid-first split; win32 `processStartTime` via `winproc` (PowerShell fallback); `recover` `engine-resume` rule; `service_events` table -- AC2-5, DW-29.
- `src/cli.ts` -- `finishRun` cost seed + `noteAccounted` cost; cancel's late studio-run end; `queueRecorder.worker` order; refused-finish reason + `finish-refused`; the three passes (pull-back, merge, orphan close-out + `releasePin`) after `closeOutPaused` at all three `finally` sites; `serve` cert check -- AC1-5.
- `src/worktree.ts` -- export `gh`; close-out engine cost sum -- AC1, AC2.
- `src/closeout.ts` -- record archived engine's metered cost before `archiveStep` -- AC2.
- `start.ps1` -- shared bounded `tailscale cert` function; keeper on exit 75 renews and restarts at once -- AC5.
- `test/planstatus.test.ts` (new), `test/queue.test.ts`, `test/command-line.test.ts`, `test/resume.test.ts`, `test/api.test.ts`, `test/closeout.test.ts`, `test/worktree.test.ts`, `test/hygiene.test.ts`, `test/fakes.ts` -- pin every I/O-matrix row as the plan's Files list assigns them (fake `plansync.py` under temp `TK_STUDIO_ROOT`; `fakeGh` answers `pr view`; fixed-FILETIME format test) -- AC6.
- `README.md` -- pull-back/merge pass, new events, pacer rule, orphan close-out, certificate rule (replacing the long-uptime restart advice) -- AC6.
- `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` -- `## Story 27.5` with runbook §4 rows (all event kinds above + cert rule); note registering tk-studio on the host -- AC6.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- close DW-11, 12, 13, 15, 19, 21, 23, 25, 29 with evidence (win32 halves left to the attended session) -- AC6.

**Acceptance Criteria:** AC1–AC6 above, each proven by a named test or command; win32-only halves recorded `unverifiable-here`.

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 1, medium 3, low 5)
- defer: 0
- reject: 3: (medium 1, low 2)
- addressed_findings:
  - `[high]` `[patch]` DW-29: `resumedEngineAlive` probed the paused engine's stale pid when no resumed `engine-pid` followed the latest `engine-resume`, so `recover` could orphan and close out a run whose resumed engine runs. Now held fail-closed (consult 2); test for both windows.
  - `[medium]` `[patch]` Plan passes took no lease; overlapping recover/drain/run could call plansync twice per phase. `plan-lease` claim in one IMMEDIATE transaction; overlap test.
  - `[medium]` `[patch]` A transient `registry.py show` failure was recorded as a permanent "not in the registry" skip. Errors now retry next tick; tested.
  - `[medium]` `[patch]` The close-out's final cost dropped an archived engine's recorded cost when the relaunch failed and `engine_run_id` still named it. Exclusion only when its metered cost was read; tested.
  - `[low]` `[patch]` A non-absent `git show` failure at the run branch fell back to the wrong owner. `atBranch` tells absent from error; error skips the tick; tested.
  - `[low]` `[patch]` The external-run test never reached the `external` guard (no worktree). The fixture now carries a worktree, PR and done spec.
  - `[low]` `[patch]` A cancelled leftover whose ender fails was re-listed every recover with no event. One `studio-run-end-failed` event, then not re-listed; tested.
  - `[low]` `[patch]` `watchCertificate` untested and a failed queue open silently disabled it. Tested via seams (exit 75 once, timer cleared, queue closed); a failed open logs one line.
  - `[low]` `[patch]` README and runbook §4 rows did not match the code's event shapes (consult 1 DO). Aligned, with `plan-lease`, `studio-run-end-failed` and `worker` rows.
- rejected:
  - No cutoff for runs ended before deploy (first tick re-pulls old PRs; old orphans closed out) — the merge pass restores `done` on the next tick, and closing out every orphan is the story's own replan rule.
  - `queue.note` failing for a later story after an earlier one committed — a failed SQLite append is exceptional plumbing, not a criterion's behaviour.
  - Pacer ignores another job's kept lock on the same checkout — `pacing` is per job; other jobs' running runs are not counted either, so this is consistent with DW-11's rule.

### 2026-10-16 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 1, medium 2, low 2)
- defer: 0
- reject: 9: (medium 3, low 6)
- note: both layers ran (band L); the 214 KB diff (baseline `9b7e241`..working tree, this spec excluded) was handed to each layer as a scratch file rather than inline.
- addressed_findings:
  - `[high]` `[patch]` `certCheck` waited on any `running`/`external` run with no deadline, so a stuck run (multi-day engine, DW-29/DW-3 hold) let the certificate expire. Consult 4: within 3 days of expiry it renews anyway, `overrode: [run ids]` on `cert-renew-requested`; tests at days_left 2 and 10; README, cert.ts header, runbook §4.
  - `[medium]` `[patch]` DW-23's keep-the-worker's-reason applied to every `finish` failure (timeout, spawn failure, run still running). Now only when the studio run's actual state is terminal; otherwise `finish failed: …` and no `finish-refused`; test for `running` and `unknown`.
  - `[medium]` `[patch]` A plan-pass retry that never clears (deleted run branch: `invalid object name`) appended a `plan-lease` claim and release every tick forever, and a transient `git diff` failure was a permanent skip. `git diff` failures now retry; after `PLAN_RETRY_LIMIT` (24) released leases the phase settles as one `gave up after <n> attempts: …` skip; tests.
  - `[low]` `[patch]` A run that merely edited a spec already `done` set that story back to `review`. A story now counts only when its spec is not already `done` at the merge-base (`git merge-base <base_ref> supervisor/run-<id>`, so an already-merged PR still counts); tests.
  - `[low]` `[patch]` The cancel released the sbx pin although `endReread` reported a claim inside the window (lock kept for the claiming driver). `releasePin` skipped when `claimed`; test.
- rejected:
  - Partial record / crash between `plansync` calls leaves later stories unrecorded — a failed SQLite append or a kill inside one pass is exceptional; per-story completion would cost a diff per reviewed run per tick.
  - No cutoff for runs ended before deploy — review then merge run in order in the same tick, so a merged PR's story is back at `done` that tick; a closed PR leaving `review` is the I/O matrix's own CLOSED row.
  - Merge pass calls `gh pr view` every tick for runs whose review resolved nothing — efficiency only, bounded by the PR's life.
  - Fail-closed resume hold has no time limit — consult 2's ruling; operator cancel ends it (DW-3 precedent); its effect on the certificate is fixed above.
  - README/DW-29 "`respawnHolds` re-holds" unbacked — `respawnHolds` (src/sandbox.ts:268-269) matches any `launched` event, which a resumed run carries.
  - `cancelledLeftovers` calls the ender for every historic cancelled run — once per run, each then recorded and never re-listed.
  - `costSoFar` double-counts across a relaunch's new studio run — `rebuildStarted` reuses `run.studio_run_id`, so the sum is that studio run's own total.
  - `serve` exit 75 never exits the process — `main(...).then((code) => process.exit(code))` (src/cli.ts:2195).
  - Pid reuse between `setWorker` and `setWorkerStart` after a kill — negligible window; AC4 asks that the pid be usable, which it is.

### 2026-10-16 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 0
- reject: 1: (low 1)
- note: both layers ran (band L) over baseline `9b7e241`..working tree (263 KB, this spec included), handed to each layer as a scratch file.
- addressed_findings:
  - `[medium]` `[patch]` The merge pass could settle `done` while another process was still inside the review pass (one story of two recorded), so the later story never got `done` (AC1 "for every story"). A recording pass now releases its lease with `settled: true`; `claimPlanPhase('done')` is refused while the `review` lease is held by a live owner; the done work re-reads the review events inside its lease. Test: a review in progress under another live owner → nothing recorded or called; once settled, `done` for every reviewed story.
  - `[medium]` `[patch]` A transient `plansync.py status` failure (the runner threw or timed out, or a non-zero exit with no JSON) was recorded as a final `ok:false`. It is now `transient`: with nothing recorded yet in the pass it is a retry under the lease (the 24-lease give-up applies); after a recorded story it is recorded `ok:false`. Refusals and `{blocked:true}` stay final (I/O matrix "Refused verb"). Three tests.
  - `[medium]` `[patch]` A cancelled leftover whose ender failed once was never retried, against AC3 ("or the next recovery ends it, and no run is left unended"). This replaces the first pass's "one `studio-run-end-failed` event, then not re-listed" patch: each failed recovery records `studio-run-end-failed {…, attempt}` and the run stays listed until it is ended or the `STUDIO_END_RETRY_LIMIT` (24) failure records `gave_up: true` (consult 6). Tests: retried then ended; gives up at the limit.
  - `[low]` `[patch]` README's Close-out bullet still said a run `recover` ends as orphaned is not closed out. It now points to the orphan close-out (no host verify leg, `closed_out` `orphaned: true`, pin released).
  - `[low]` `[patch]` The runbook §4 intro claimed the table names every Epic 27 event kind. It now says which stories' kinds it lists (27.1, 27.3, 27.5) plus the supervisor-scope events.
  - `[low]` `[patch]` Nothing asserted that `recoverQueue` runs the cancelled-leftover recovery and the plan passes (AC1 "the next tick", AC3 "the next recovery"). A `recoverQueue` wiring test in `test/command-line.test.ts` asserts `studio-run-ended {by:"recover"}` and `plan-status` review then done on a merged PR.
- rejected:
  - Merge-commit PR merged, and the local `base_ref` advanced, before the review pass runs → empty `merge-base...branch` diff, "no story marked done" — the review pass runs in the same `finally` that writes `ended`, seconds after the PR opens, so the window is only the one-time pull-back of pre-deploy runs (accepted in the first follow-up) and long registry-retry chains; no cut commit is recorded to diff from, and recording one would widen the worktree event schema. Already listed as a residual risk.

## Design Notes

Settled shapes are the plan's "Settled shape" section, verbatim authority (owner, story id, done specs, `plan-status` event shape, when, cost per iteration, cancel re-read, pacer, orphan close-out, worker record order, certificate, refused finish). Do not re-derive them.

Follow-up pass (consult 5): "Stories the run marked done" reads `status: done` at the run branch **and not already `done` at the merge-base** (`git merge-base <base_ref> supervisor/run-<id>`), following AC1's wording "marked done".

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: success, or EPERM on the `/c` mount recorded as environmental (never touch `bun.lock`).
- `bun test` -- expected: all green.
- `bunx tsc --noEmit` -- expected: clean.
- `bun test test/planstatus.test.ts test/queue.test.ts test/api.test.ts test/closeout.test.ts test/worktree.test.ts` -- expected: green.
- `grep -nE 'shell: *true|"(bash|sh|cmd|-c|-lc|/c)"' src/planstatus.ts src/cert.ts src/winproc.ts` -- expected: no hits.

## Deviation Summary

### pass 1 (2026-10-16, implementer)

- planned: `Queue.end` takes the studio run id and owner the cancel acted on / actual: new `Queue.endReread(runId, state, reason, opts, acted)` returns `{run, late_studio_run_id?, claimed?}`; `Queue.end` unchanged / why: avoids changing `end`'s return type for every caller / may affect: none
- planned: `plan-status`/`studio-run-ended` shapes as settled / actual: `studio-run-ended` also carries `by` (`cancel`|`recover`), `detail`, `state`; cancel's `ended` detail adds `late_studio_run_id`, `claimed_during_cancel`; orphan's `closed_out` adds `orphaned: true` / why: tell the cases apart in events / may affect: none
- planned: `accounted` events gain `cost_usd` / actual: a job with no turn/token guard now writes a cost-only `accounted {turns:0, tokens:0, message_ids:[], cost_usd}` / why: otherwise that iteration's cost is lost across a restart / may affect: none
- planned: pid first, start time second / actual: the `worker` event no longer carries `start` (column only); `test/resume.test.ts` assertion updated / why: the event commits before the start is read / may affect: none
- planned: review, merge, then orphan close-out after `closeOutPaused` / actual: orphan close-out first, then review, then merge / why: a PR opened by the orphan close-out is picked up in the same tick / may affect: none
- planned: merge pass makes "the done calls" / actual: done calls reuse the stories the review events resolved; a run with no done story or a failed `git diff` records a skipped review event / why: post-merge branch diff can be empty; skip stops per-tick retries / may affect: none
- planned: `serve` checks the cert "on each tick" / actual: at start and hourly (`CERT_CHECK_MS`); `Queue.serviceEvent` gained optional `at` / why: `serve` has no tick; injectable clock / may affect: none
- planned: cancelled-leftover recovery with the passes / actual: `endCancelledLeftovers` in `recoverQueue` main body after `driveResumes` / why: recovery, not a close-out pass / may affect: none
- planned: tests as named / actual: cert tests in `test/queue.test.ts`; end-to-end orphan tests in `test/command-line.test.ts` updated to expect `closing-out`/`closed_out` after `orphaned` / why: no cert test file in the plan; orphan close-out now runs after every orphan end / may affect: none
- planned: no other interface changes / actual: `RunSummary.finish_refused`; `RunRecorder.accounted` optional `costUsd` + `costSoFar()`; `RunOptions.plan` registry injection / why: carry cost/refusal data; testability / may affect: none

DEVIATION SCORE: 1

DRIFT: Queue.endReread added beside unchanged Queue.end — avoid changing end's return type for all callers — affects: none
DRIFT: studio-run-ended/ended/closed_out carry extra fields (by, detail, state, late_studio_run_id, claimed_during_cancel, orphaned) — distinguish late/claimed/orphan cases — affects: none
DRIFT: guard-less jobs now write a cost-only accounted event — keep their iteration cost across restart — affects: none
DRIFT: worker event no longer carries start — the event commits before the start is read — affects: none
DRIFT: pass order is orphan close-out, review, merge — same-tick pickup of an orphan's PR — affects: none
DRIFT: merge pass reuses review-resolved stories; empty/failed diff records a skipped review — post-merge diff may be empty — affects: none
DRIFT: serve cert check at start + hourly timer, serviceEvent takes optional at — serve has no tick — affects: none
DRIFT: endCancelledLeftovers runs in recoverQueue's body, not finally — it is recovery — affects: none
DRIFT: cert tests in test/queue.test.ts; command-line orphan tests updated for closing-out/closed_out — no cert test file in plan; orphan close-out after every orphan — affects: none
DRIFT: RunSummary.finish_refused, RunRecorder.accounted costUsd + costSoFar, RunOptions.plan added — carry data; testability — affects: none

Consult 1 ruled accept-deviation score 1 for all 10 pass-1 entries (see Consult Log); README and runbook §4 rows to be aligned with the code's event shapes.


### pass 2 (2026-10-16, review patches)

- planned: P1–P9 touch only the code and tests they name / actual: an existing 27.3 test in `test/closeout.test.ts` ("after an `engine-resume` … `recover` handles it") now records a resumed `engine-pid` whose engine probes gone / why: consult 2's fail-closed rule holds a resume with no recorded engine pid / may affect: none
- planned: plan lease modelled on `claimEnd`/`finishEnd` / actual: appended `plan-lease {phase, owner}` events taken in one IMMEDIATE transaction (`Queue.claimPlanPhase`/`releasePlanPhase`); the merge pass takes it only after `gh` reports MERGED/CLOSED / why: a terminal run row is immutable (as `takeEndedCloseOut`); no lease churn while a PR stays open / may affect: none
- planned: P8 tests serve's wiring / actual: `watchCertificate` tested with injected seams; `main`'s `serve` exit-code pass-through untested / why: that path binds a socket / may affect: none

DEVIATION SCORE: 1 (consult 3: accept-deviation score 1)

DRIFT: a 27.3 closeout test gains a resumed engine-pid precondition (assertions unchanged) — consult 2's DW-29 fail-closed hold — affects: none
DRIFT: plan-pass lease is appended plan-lease events, not a run column; merge takes it only on MERGED/CLOSED — terminal run rows are immutable — affects: none
DRIFT: serve's exit-75 pass-through in main is untested (watchCertificate tested via seams) — the path binds a socket — affects: none

### pass 3 (2026-10-16, follow-up review patches)

- planned: done specs = `status: done` at the run branch / actual: and not already `done` at the merge-base / why: an edited, already-done spec was set back to review (AC1 "marked done") / may affect: 27-5
- planned: transient plan-pass failures retry next tick, unbounded; a `git diff` failure is a skip / actual: `git diff` failure retries; after 24 released leases one `gave up after <n> attempts` skip / why: a deleted run branch appended lease events every tick forever / may affect: 27-5
- planned: renewal only outside a live run / actual: within 3 days of expiry renews anyway, `overrode` recorded / why: consult 4's apply ruling / may affect: 27-5
- planned: docs per patch list / actual: README and runbook §4 also describe the merge-base rule and the retry causes / why: AC6, docs match code / may affect: none

DEVIATION SCORE: 1 (consult 5: accept-deviation score 1)

DRIFT: done specs counted only when not already done at the merge-base — an edited done spec was reset to review (AC1 "marked done") — affects: 27-5
DRIFT: git diff failure retried; plan-pass retries capped at 24 leases then one give-up skip — a deleted run branch grew the event stream every tick — affects: 27-5
DRIFT: certificate renews during a live run within 3 days of expiry, recording overrode — consult 4's ruling so a stuck run cannot let it expire — affects: 27-5
DRIFT: README and runbook §4 document the merge-base rule and retry causes — docs match code (AC6) — affects: none

### pass 4 (2026-10-16, second follow-up review patches)

- planned: plan lease taken and kept by the recording pass / actual: a recording pass releases its lease with `plan-lease {phase, owner: null, released, settled: true}` (not counted toward `PLAN_RETRY_LIMIT`); `claimPlanPhase('done')` refused while the `review` lease is held by a live owner / why: the merge pass settled `done` on a partial review (AC1) / may affect: none
- planned: a cancelled leftover's failed ender recorded once, never retried (pass-2 patch) / actual: `studio-run-end-failed` gains `attempt` and `gave_up`; retried each recovery until ended or `STUDIO_END_RETRY_LIMIT` (24) / why: AC3 "the next recovery ends it, and no run is left unended" / may affect: none
- planned: any `plansync.py status` failure is a final `ok:false` / actual: a transient failure (runner threw, timeout, no JSON) with nothing recorded in the pass is a retry under the lease; refusals and blocked stay final / why: the I/O matrix makes only refusals final / may affect: none

DEVIATION SCORE: 1 (consult 6: accept-deviation score 1)

DRIFT: plan-lease gains settled: true on a recording pass's release, and done is refused while review's lease is live — merge settled done on a partial review (AC1) — affects: none
DRIFT: studio-run-end-failed gains attempt/gave_up and retries up to 24 recoveries — a single failure left the studio run unended (AC3) — affects: none
DRIFT: transient plansync status failure with nothing recorded retries under the lease — only refusals are final in the I/O matrix — affects: none

## Consult Log

- 2026-10-16T08:29:10Z — trigger: deviation-gt-0 — question: accept the implementer's 10 pass-1 deviations (endReread beside end, additive event fields, cost-only accounted, worker event without start, pass order, merge reuse, hourly cert check, leftovers in recover body, test placement, new interface members) at score 1? — ruling: accept-deviation score 1 — do: Record all 10 deviations at score 1 in the spec's Deviation Summary, citing this ruling. Do not reshape any code. / Change the README and the runbook §4 rows so the event shapes match the code: studio-run-ended {by, detail, state}, the cancel's ended.late_studio_run_id and claimed_during_cancel, closed_out.orphaned, the cost-only accounted, a worker event with no start, and the cert check at start plus hourly. — rule candidate: In plans, a settled shape names a supervisor queue event's detail fields and a Queue method's signature as the minimum required, so new fields and a sibling method beside the named one are score 1 without a consult, unless the field or method appears in $TK_STUDIO_ROOT/plugins/tk-studio/contracts/.
- 2026-10-16T08:33:59Z — trigger: high-severity-finding — question: resumedEngineAlive probes a stale engine_pid when no resumed pid follows the latest engine-resume, so recover can orphan (and close out) a run whose resumed engine runs; patch fail-closed, probe via launch core, or defer? — ruling: apply — do: In resumedEngineAlive (src/queue.ts:1835), when the latest move is engine-resume, find the engine-pid event with resumed: true and a numeric pid written after that move; if none, return true so the run is held and not orphaned, with that reason in the held entry's detail; only probe run.engine_pid when that event exists. / Add a test in test/closeout.test.ts next to the DW-29 case covering engine-resume with no engine-pid after it, and engine-pid {resumed: true, engine_pid: "unknown"}: recover holds, never orphans, no push/PR/worktree removal. / Do not take option (b) or (c). — rule candidate: Any liveness probe that guards a destructive close-out must check the pid was recorded after the move it guards; with no such pid it holds the run (fail closed) and never falls back to an older pid.
- 2026-10-16T08:45:57Z — trigger: deviation-gt-0 — question: accept pass-2 deviations (27.3 test gains a resumed engine-pid precondition, plan lease as plan-lease events, serve exit-code wiring untested) at score 1? — ruling: accept-deviation score 1 — do: Record deviations 1–3 at score 1 in the Deviation Summary citing consult 3; item 1 follows from consult 2 and does not weaken 27.3. / Do not reshape any code; keep the DW-29 hold test as is beside the edited 27.3 test. / Note the serve exit-code path as unverifiable-here under AC6. — rule candidate: When a consult ruling tightens a guard, an earlier story's test may gain the setup the new precondition needs without a consult, provided every assertion stays unchanged (score 1).

- 2026-10-16T08:55:36Z — trigger: high-severity-finding — question: follow-up review: certCheck (src/cert.ts:47-48) waits on any running/external run with no deadline, so a stuck running run (multi-day engine, DW-29/DW-3 hold) lets the certificate expire; keep, count only live-owner runs, or add an expiry floor? — ruling: apply — do: In src/cert.ts, keep the live-run wait while days_left > 3 (new constant FORCE_WITHIN_DAYS = 3); at days_left <= 3 renew even with live runs, still once per 24 h, adding `overrode: [run ids]` to the `cert-renew-requested` detail. / In test/queue.test.ts add two tests (running run at days_left 2 → renew with overrode; at days_left 10 → wait); add one sentence to the README.md certificate rule, the cert.ts header and runbook §4: "within 3 days of expiry it renews even during a live run, naming the runs it overrode." — rule candidate: A service wait gated on a live run (cert renewal, restarts, maintenance) must have a deadline floor that overrides the wait and records the runs it overrode, because a running row can last indefinitely (engine lifetime, fail-closed holds).
- 2026-10-16T09:06:51Z — trigger: deviation-gt-0 — question: accept follow-up-pass deviations (done = done at the run branch and not at the merge-base; git diff failure retried and retries capped at 24 leases → one give-up skip; cert override within 3 days per consult 4; README/runbook document both) at score 1? — ruling: accept-deviation score 1 — do: Record deviations 1–4 at score 1 in the Deviation Summary, citing this consult; item 3 is consult 4's apply ruling carried out, not a new drift. / Do not reshape any code; keep the merge-base tests (test/planstatus.test.ts:323, :341), the give-up test (:289) and the override test (test/queue.test.ts:1452) as they are. / Under the plan's "Stories the run marked done" bullet, note in the spec that "at the run branch" is now read together with "and not already done at the merge-base", following AC1's wording "marked done". — rule candidate: A transient-failure retry in a supervisor pass must carry a bounded attempt count that settles as one recorded skip naming the last reason; when a plan reads a spec's state "at the run branch" to mean "the run changed it", the state at the merge-base is the comparison point; both are score 1 without a consult.
- 2026-10-16T09:28:18Z — trigger: deviation-gt-0 — question: accept second-follow-up deviations (plan-lease `settled: true` + done refused while review's lease is live; studio-run-end-failed `attempt`/`gave_up` with 24-attempt retry replacing the once-only pass-2 patch; transient plansync failure retried under the lease) at score 1? — ruling: accept-deviation score 1 — do: Record the three pass-4 items at score 1 in the Deviation Summary citing this consult; note in the Review Triage Log that the first-pass "one `studio-run-end-failed` event, then not re-listed" patch is replaced by the bounded retry; do not reshape code. / Keep refusals and `{blocked:true}` final with no retry (I/O matrix "Refused verb"); never route them through the P2 retry path. — rule candidate: A recovery or plan pass that retries a failed supervisor action must record an `attempt` count and stop with `gave_up: true` at the shared limit of 24; adding fields to this story's own new queue events is score 1 without a consult, unless the event appears in `$TK_STUDIO_ROOT/plugins/tk-studio/contracts/` or a later story in `epics.md` names it. (observation recorded 2026-10-16T09:28:22Z)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** this was the second follow-up review pass on the done story (the first follow-up recommended one). Both review layers ran over baseline `9b7e241`..working tree. Six patches were applied, with tests:
- **Plan pull-back, merge race (AC1):** the merge pass no longer settles `done` while another process is still mid-review. A recording pass releases its lease `settled: true`, `done` is refused while the `review` lease is live, and the done work re-reads the review events inside its lease.
- **Plan pull-back, transient verb failure (AC1):** a `plansync.py status` timeout, spawn failure or no-JSON answer is retried under the lease (bounded by the 24-lease give-up) while nothing is recorded yet. Refusals and `{blocked:true}` stay final.
- **Cancelled leftovers (AC3, DW-13):** a failed ender is retried on each recovery (`attempt`) until the studio run is ended or the 24th failure records `gave_up: true`. This replaces the once-only patch from the first pass.
- **Docs (AC6):** the README no longer says orphaned runs are not closed out. The runbook §4 intro names exactly which stories' event kinds it lists. Both describe the new `settled`, `attempt` and `gave_up` fields.
- **Wiring (AC1, AC3):** a `recoverQueue` test asserts the cancelled-leftover recovery and the review→done plan passes run from the tick.

The deviations are score 1 (consult 6). `deviation_score` stays 1.

**Files changed this pass:**
- `src/planstatus.ts`: `callStatus` `transient` marker, retry in `reviewRun` and the merge work, `leased` settled release, and the merge pass re-reads its reviews inside the lease; header updated.
- `src/queue.ts`: `claimPlanPhase` refuses `done` while `review` is leased live; `releasePlanPhase` takes `settled`; `STUDIO_END_RETRY_LIMIT`; `cancelledLeftovers` counts failed attempts.
- `src/cli.ts`: `endCancelledLeftovers` records `attempt` and `gave_up`.
- `test/planstatus.test.ts`: review-in-progress merge test, three transient-failure tests, and the overlap test now expects settled releases.
- `test/api.test.ts`: cancelled-leftover retry, then end; give-up at the limit.
- `test/command-line.test.ts`: `recoverQueue` wiring test.
- `test/fakes.ts`: `fakePlansync` `crash` answer.
- `README.md` and `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` (runbook §4): orphan close-out sentence, §4 intro, and the `plan-lease` and `studio-run-end-failed` rows.
- `_bmad-output/implementation-artifacts/deferred-work.md`: not touched. The orchestrator owns the ledger.

**Review:**
- 6 patches applied (high 0, medium 3, low 3).
- 0 deferred.
- 1 rejected (low): the merge-commit empty-diff window, with its reason in the Review Triage Log.
- Follow-up review recommended: **true**. Score 3×3 + 1×3 = 12, which is 5 or more.

**Consults** (this pass; logged with an observation):
- 6, `deviation-gt-0`: accept-deviation score 1.

DRIFT: plan-lease gains settled: true on a recording pass's release, and done is refused while review's lease is live — merge settled done on a partial review (AC1) — affects: none
DRIFT: studio-run-end-failed gains attempt/gave_up and retries up to 24 recoveries — a single failure left the studio run unended (AC3) — affects: none
DRIFT: transient plansync status failure with nothing recorded retries under the lease — only refusals are final in the I/O matrix — affects: none

**Verification** (re-run by this session after the patches):
- `bun test`: 855 pass, 5 skip, 0 fail (860 tests, 18 files).
- `bunx tsc --noEmit`: clean.
- The no-shell grep over `src/planstatus.ts`, `src/cert.ts` and `src/winproc.ts`: no hits.
- `bun install --frozen-lockfile`: EPERM linking js-yaml and typescript on the `/c` mount. This is environmental; `bun.lock` and the deferred-work ledger are untouched (`git diff --quiet`).

**unverifiable-here:** unchanged from the first pass:
- the win32 `GetProcessTimes` read and the win32 `bun test` run;
- the `tailscale cert` renewal and `serve` restart dry run on the agent PC (`pwsh` is absent here), and `main`'s exit-75 pass-through;
- the real `plansync.py status` into tk-studio's plan (register tk-studio on the host first);
- the runbook §4 rows applied in tk-studio.

**Residual risks:**
- A merge-commit PR merged, with the local `base_ref` advanced, before the review pass runs has an empty `merge-base...branch` diff, so the run records "no story marked done". The review pass normally runs in the same `finally` that opens the PR.
- If appending a pass's settled release fails (a busy queue), the review lease keeps naming that process, and `done` waits until it exits.
- A transient `plansync` failure after a story was already recorded in the same pass is still recorded `ok:false` (the phase is settled and cannot be retried without repeating a call).
- During a live run, the certificate override can restart `serve` (seconds of API downtime).

## Reconcile

- 2026-10-16 — score 1; reconcile not required.
- Gate: Part A not-required; Part B epic complete: no next story (27-5 accepted; AC4/AC5/AC6 win32 and host halves unverifiable-here, see plans/27-5.md Acceptance)
