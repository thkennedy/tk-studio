---
title: 'Jobs Survive Restarts in a Durable Queue'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
baseline_revision: '797e2311bf9c23569257bf1d7ef07ee52e9b69f4'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-21/salvage-findings.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A worker (`claude -p`, or a `uv run jobrun.py` child) that outlives a killed supervisor keeps editing its checkout after `recover` releases the checkout lock, so a later `drain`/`run` can drive a second run on that checkout.
    evidence: |-
      Both review layers (follow-up review, 2026-09-28). Workers are spawned without `detached` and are tree-killed only on timeout (src/server.ts:178 `runProcess`). `defaultOwnerAlive` probes only the supervisor's own pid (src/queue.ts), so `recover` ends the run `partial` `orphaned: supervisor restart` and deletes the lock while the worker is still running (up to its guard's max_wall_clock_seconds). The intent's holder list (spec Always rule) and the "Restart, running orphan" matrix row release the lock on a dead owner, so the code matches the intent; the gap is against AC3 "one engine per checkout". Deferral class (a): a defect in behaviour AC3 names. Consult 2026-09-28T11:29:57Z ruled defer: 21-6 owns the killed-supervisor orphan rule (resume supersedes 21.3's rule), and 21-5 owns the whole-process-tree kill (DW-1). An operator caution is in README.md under the `drain` command.
    location: >-
      src/queue.ts recover; src/server.ts:178
    severity: high
reconcile_verdict: 'adjust-stories'
---

<intent-contract>

## Intent

**Problem:** The supervisor keeps no state of its own. Every `run` mints a studio run straight through `jobrun.py submit|wake`, so two racing requests mint two runs, two runs can work one checkout at once, and a supervisor that dies between `wake` and `finish` strands its run `queued`/`running` forever (salvage: tick has no atomic wake, strands runs).

**Approach:** Add a SQLite queue (`bun:sqlite`, no new dependency) that owns minting: a submission is validated, then persisted in `jobs`/`runs`/`events`, and each run takes a per-checkout lock before it drives `jobrun` submit/wake. Every state change and its `events` row commit in one transaction. On every start, the supervisor recovers orphaned runs.

**User story (verbatim, epics.md Story 21.3):** As the operator, I want submitted jobs and their runs held in SQLite with one lock per checkout, so that nothing is lost or run twice when the supervisor stops, crashes, or two requests race.

## Boundaries & Constraints

**Always:**
- The queue database path comes from the environment only: `TK_SUPERVISOR_DB`. When it is unset, fail with a named error (`QueueDbMissing`). Refuse with `QueueDbPlacementRefused` a path that lies inside the store (`TK_STUDIO_HOME`, else `~/.tk-studio`), inside `TK_STUDIO_ROOT`, or inside any git checkout (an ancestor directory holds `.git`). All three checks run before the file is created.
- A submission is validated before anything is queued: registry `show` + `resolve` as today. The `resolve` verb is the plugin's one validator of `job.schema.json` (`lib/job.py`, AD-2). A refusal or `problems[]` is the schema error, and it is returned verbatim with nothing written to the queue.
- One transaction per transition. A run's state change and its `events` row commit together (`BEGIN IMMEDIATE`). `complete|partial|blocked|cancelled` are terminal and immutable.
- Idempotent minting covers both verbs (`submit` for one-shot, `wake` for recurring). While a run of the same job on the same checkout is `queued` or `running`, a new request mints nothing and receives that run's id.
- One engine per checkout. A run takes the checkout lock before any `jobrun` verb that can mint or execute. A lock held by a live holder leaves the run `queued`, with the holder named in its `reason` and in the answer. Holders are a `running` run whose owner process is alive, or a detached bmad-loop engine the supervisor launched, recorded when a `tk-studio-launch` run's status block names `.bmad-loop/runs/<id>` and held while the launch core's `status --directory` lists that id in `live[]`.
- Keep the 21-1 wake/submit failure recovery: adopt only a studio run absent from the pre-verb `status` snapshot, and end it if it is non-terminal. The queue records the adopted studio run id.
- Drive the studio only through the contract (AD-2): `jobrun.py` verbs, `registry.py show`, `claude -p`, and the launch core's `status` under the §1 pure-data allowance.

**Block If:**
- A studio-side change (plugin, contract, `jobrun.py`) would be needed to meet an AC → HALT naming it.
- A file outside the Files list is needed beyond a test fixture → consult (`file-outside-files`).

**Never:**
- A second validator of job definitions in the supervisor. A queue file under a repo, `~/.tk-studio` or `TK_STUDIO_ROOT`. A machine path in a tracked file. A runtime dependency beyond `js-yaml` (use `bun:sqlite`).
- Guards, the pacer's timing rules, `account`, resume from transcript, tiers, cost changes, the HTTP API, a long-lived daemon (Stories 21.4–21.6, Epic 22). No `git push`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Submit valid | `submit studio-health --directory <root>` | one `jobs` row (resolved definition), one `runs` row `queued`, an `events` row; JSON answer `{ok, run_id, state: queued, minted: true}` | — |
| Submit invalid | declared job fails `resolve` (e.g. no guards) | refused with the `resolve` error/problems verbatim; exit 2; queue tables unchanged | — |
| DB placement | `TK_SUPERVISOR_DB` unset / under store / under a git checkout | `QueueDbMissing` / `QueueDbPlacementRefused`, exit 2, no file created | — |
| Racing mint | two processes enqueue the same job at once | exactly one `runs` row; both answers carry that run id; one answer says `minted: true`, the other `false` | SQLITE_BUSY absorbed by `busy_timeout` |
| Lock held | run A `running` (owner alive) on checkout C; run B for C is claimed | B stays `queued`, `reason` and answer name A (run id, job, pid); an `events` row | exit 1, B re-claimable later |
| Engine holder | a finished `tk-studio-launch` run named `.bmad-loop/runs/E`; E is in the launch core's `live[]` | a new run on C waits `queued` naming engine E; once E is no longer live, the lock is free | a failed `status` probe counts as live (fail closed) and is named |
| Restart, running orphan | run `running`, owner pid dead, studio run minted | run → `partial`, reason `orphaned: supervisor restart`; the studio run is ended too (skill `finish --state partial` with that reason, core `cancel`); lock released; events | a failed studio call is recorded in the event; the queue run still ends |
| Restart, never started | run `queued`, or `running` with a dead owner and no studio run minted | re-queued (`queued`, owner cleared, lock released), event `requeued: supervisor restart` | — |
| `run` drives | `run <job> --directory <root>` | enqueue (or adopt the queued run) → claim lock → the existing 21-1 flow → the queue run's terminal state mirrors the summary; summary `run_id` = queue run id, plus `studio_run_id` | a run already `running` under another live owner: answer its id and state, drive nothing, exit 1 |

</intent-contract>

## Code Map

- `src/cli.ts` -- `runJob` :85, `startRun` :104 (preflight :112, registry :120, `resolve` :126-133 is the validation point, snapshot :139-146, submit/wake :150-158), `recoverAfterTimeout` :176 (keep its rule), `finishRun` :224, `main` :295 (only `run` today; flag loop :298). `RunSummary` :32. Split `startRun` so validation happens before enqueue, and the lock is claimed before the snapshot and the verb.
- `src/tick.ts` -- `tickJob` :181 wakes through the connector at :204 with no queue (the salvage defect "no atomic wake"). Route its wake → invoke → finish through the queue-backed `runJob`, keeping `shouldWake`/`--dry-run`/`--timeout-cap-s` as the guard cap. The pacing rules stay (21.5).
- `src/server.ts` -- `runJobVerb` :223, `runUv` :211 (use for the launch core `lib/launch.py status --directory <root>`), `readProjectConfig` :491. Unchanged apart from any needed export.
- `src/env.ts` -- environment resolution (AD-15); add the queue path reader here or in `queue.ts`.
- `$TK_STUDIO_ROOT/plugins/tk-studio/lib/jobrun.py` (read-only) -- `submit` :307 (one-shot: mints and, for a core, executes inside), `wake` :432 (recurring; refuses one-shot), `status` :356, `cancel` :408 (queued/running → `partial` `cancelled`), `finish` :516. Studio run ids are `<job-id>-<UTC compact>`; the queue's ids must not collide with that shape (e.g. `q-<job>-<ts>-<rand>`).
- `$TK_STUDIO_ROOT/plugins/tk-studio/lib/launch.py` (read-only) -- `status --directory [--run-id]` :293 → `{ok, runs, live[]}`; live = bmad-loop status not in `finished|stopped|interrupted|crashed`. The `tk-studio-launch` status block's `artifacts[]` names `.bmad-loop/runs/<run-id>` (SKILL.md :63, :86).
- `$TK_STUDIO_ROOT/plugins/tk-studio/contracts/job.schema.json` -- the definition schema, custom format. `lib/job.py` is "the one validator (no other surface parses definitions)", served through `resolve`.
- `test/command-line.test.ts` -- `e2eFixture` :172 (real jobrun against a temp store + project, faked `CLAUDE_BIN`). Its env must gain a temp `TK_SUPERVISOR_DB` outside any repo. The e2e describes skip on win32 or without `TK_STUDIO_ROOT`.
- `bun:sqlite` (SQLite 3.53 bundled with Bun 1.4.2): WAL, `PRAGMA busy_timeout`, `db.transaction(fn).immediate()`.

## Tasks & Acceptance

**Execution:**
- `src/queue.ts` (new) -- the path reader and its placement refusals; the schema (`jobs`, `runs`, `events`, `locks`); `enqueue` (idempotent mint), `claim` (lock or wait naming the holder), `setStudioRun`, `markVerbStarted` (the pre-verb snapshot), `end` (terminal + lock release, or hand the lock to a launched engine), `recover` (the orphan rule, including the `verb_started` lookup and the launch-orphan engine handover), `drainable` (ownerless or dead-owner queued runs, oldest first), and event listing. Owner identity per Design Notes. Every transition runs in one immediate transaction with its event. Holder liveness (pid probe, engine probe) is injectable.
- `src/cli.ts` -- `submit <job-id> --directory <root>` (validate + enqueue, JSON answer); `recover` (run the orphan rule, JSON answer); `drain` (recover, then drive every drainable run, JSON answer); `run` goes through the queue (recover on start → validate → enqueue/adopt → claim → the existing flow → mirror the terminal state into the queue). Summary `run_id` = queue run id, plus `studio_run_id`. Exit rules as in 21-1: a lock wait or an already-running answer exits 1.
- `src/tick.ts` -- the wake path goes through the queue-backed `runJob`; queue unusable → exit 2; a no-studio-run outcome counts `refused`.
- `test/queue.test.ts` (new) -- pin every matrix row. The race uses at least two concurrent OS processes (`Bun.spawn` of a small enqueue script) on one db file. It also covers: terminal immutability; one `events` row per transition; placement refusals; lock wait and release; engine holder live/not-live/probe-failure; every restart branch in Design Notes (including `verb_started` found / not found / lookup failed, a same-pid restart with a new nonce, a reused pid with a different start time, and the launch-orphan engine handover), with the studio calls asserted through an injected verb runner; `drainable` ordering.
- `test/command-line.test.ts` -- the e2e fixture sets `TK_SUPERVISOR_DB`; add e2e: `submit` invalid job → exit 2 with the problems and empty tables; `submit` twice → same run id; `run` records queue transitions ending in the studio outcome, and `studio_run_id` in the summary; `recover` and `drain` CLI verbs (a submitted run is driven by `drain`); recovery on `run` start; the engine path end to end at the CLI level: a `tk-studio-launch` status block naming `.bmad-loop/runs/<id>` hands the lock to the engine (`launchedEngine`, the mirror, and `launchStatusProbe`'s `live[]` parse and fail-closed branch pinned with injected probes).
- `README.md` -- `TK_SUPERVISOR_DB` in the env table, the `submit`/`recover` commands, and the queue, lock and restart rules; `tick.ts` line updated.

**Acceptance Criteria (verbatim from epics.md Story 21.3):**
- AC1: Given a job submission, when it is accepted, then it is validated against the plugin's `job.schema.json` (an invalid submission is refused with the schema error and nothing is queued) and persisted in `jobs`, `runs`, and `events` tables in a database outside every repo and outside `~/.tk-studio` (which the studio owns), at a path from the supervisor's environment, with atomic state transitions.
- AC2: Given two wakes for the same job racing, when both reach the queue, then exactly one run is minted in one transaction (idempotent `wake`) and the other caller receives the existing run id.
- AC3: Given a run holding a project checkout, including a detached bmad-loop engine the supervisor launched, when a second run targets the same checkout, then the second run waits in `queued` with the lock holder named — one engine per checkout.
- AC4: Given a supervisor restart, when it finds runs left `queued` or `running` by a process that no longer exists, then each is ended `partial` with reason `orphaned: supervisor restart` or re-queued if it never started — never left in `queued` forever — and every transition lands in `events`.

## Spec Change Log

### 2026-09-28 — loopback 1 (review pass 1, bad_spec)
- Triggering findings:
  - (both layers) A studio run minted by `submit`/`wake` before the queue recorded it made recovery re-queue a started run, which could run it twice (AC4). The cause was the Design Note defining "started" as `studio_run_id` set.
  - (both) Pid-only owner identity: a same-pid restart or pid reuse strands orphans.
  - (both) A launch run orphaned before the engine handover drops the lock while the engine lives (AC3 with AC4).
  - (blind) Nothing drains ownerless queued runs.
  - (blind) The engine path and CLI recovery were untested.
  - (blind) The tick misclassified an unusable queue and no-studio-run outcomes.
- Amended: Design Notes (the "started" rule via `verb_started` + stored snapshot; owner nonce and start time; engine handover at restart; `drain`; tick classification). Tasks for `src/queue.ts`, `src/cli.ts`, `src/tick.ts` and both tests.
- Known-bad state avoided: a supervisor killed inside `submit`/`wake` re-queues a run whose studio side already executed or is live, and the next driver wakes the job again.
- KEEP (pass-1 implementation, saved at `/tmp/v213/pass1.patch`; `git apply` it as the starting point and build on it). It was green (143 tests) and consult-accepted (score 2):
  - `queue.ts` placement refusals, schema, the terminal-immutability trigger, the unique live-run index, `BEGIN IMMEDIATE` transitions with their events
  - the multi-process race test
  - the queue run id `q-<job>-<ts>-<hex>` + `studio_run_id`
  - the CLI `submit`/`recover`, and `run` through the queue with the 21-1 snapshot recovery unchanged
  - the tick through `runJob`
  - the README sections
  - every pass-1 DRIFT decision in the Deviation Summary

## Review Triage Log

### 2026-09-28 — Review pass
- layers: blind-hunter, edge-case-hunter (no story plan for 21-3, so no S band; both ran). Diff handed as a file (`/tmp/v213/diff.txt`, 1594 lines).
- intent_gap: 0
- bad_spec: 4: (high 1, medium 3)
- patch: 2: (high 0, medium 1, low 1) — folded into the loopback amendment (moot under bad_spec; re-derived)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[bad_spec]` A studio run minted before the queue recorded it was re-queued on restart as never started, so it could run twice (both layers). Fix: `verb_started` + stored snapshot, and a recovery lookup.
  - `[medium]` `[bad_spec]` A pid-only owner made a same-pid restart or pid reuse strand or re-drive orphans (both layers). Fix: nonce + start-time owner identity.
  - `[medium]` `[bad_spec]` A launch run orphaned before the engine handover released the lock while its engine lived (both layers). Fix: the launch-orphan probe hands the lock to the live engine.
  - `[medium]` `[bad_spec]` Ownerless queued runs (submitted, re-queued, waiting) had no driver (blind). Fix: `drain`.
  - `[medium]` `[patch]` No tests for the engine path at the CLI or for CLI recovery (blind). Fix: tests named in the Tasks.
  - `[low]` `[patch]` The tick counted an unusable queue as per-job errors and a pre-mint `blocked` as `woken` (blind). Fix: in the Tasks.

### 2026-09-28 — Review pass (after loopback 1)
- layers: blind-hunter, edge-case-hunter (both ran). Diff handed as a file (`/tmp/v213/diff2.txt`, 2351 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 1, medium 5, low 4)
- defer: 0
- reject: 5: (medium 3, low 2)
  - A failed studio-end call leaves the studio run open. The intent's matrix defines this ("a failed studio call is recorded in the event; the queue run still ends").
  - Nothing drives queued runs automatically, and the tick does not drain. A long-lived daemon and the pacer are on the intent's Never list; `drain` makes a run re-drivable.
  - No operator verb clears a stuck run or lock. Cancel is Epic 22 (Never list: the HTTP API). Fail-closed liveness is the intent's matrix rule.
  - A hostname change makes orphans read as live remote owners. The spec's fail-closed rule; the agent PC's hostname is fixed.
  - The unused `knowledgeOf`/`finishArgsFor`. Consult-accepted pass-1 DRIFT.
- addressed_findings:
  - `[high]` `[patch]` `drain` drove by job id, so a listed run ended by another process meanwhile made `enqueue` mint and execute a duplicate. Fix: `drain` adopts only the listed run id (`RunOptions.runId`), never mints, and reports `skipped`.
  - `[medium]` `[patch]` The restart lookup adopted the newest absent studio run, so a foreign run minted during downtime could be ended. Fix: the earliest absent run minted at/after `verb_started`; unreadable → lookup failure.
  - `[medium]` `[patch]` Recovery ran without the studio root and contract pin, ending re-queueable orphans as lookup failures. Fix: `recover`/`drain`/`run` check both first (exit 2, nothing recovered).
  - `[medium]` `[patch]` Transport failures in re-validation ended valid queued runs `blocked`. Fix: only verb refusals, `problems[]`, a root mismatch, an unreadable config or a missing checkout refuse; the rest is transient.
  - `[medium]` `[patch]` A stale lock held by a dead `tk-studio-launch` run was taken without an engine probe (AC3). Fix: `claim` probes the launch core; a live or unverified engine takes the lock.
  - `[medium]` `[patch]` No win32 process start time, so pid reuse on the agent PC kept dead owners alive. Fix: a bounded PowerShell creation-time read behind the injectable probe.
  - `[low]` `[patch]` A drained run with a deleted checkout stayed `queued` forever. Fix: it ends `blocked` naming the directory.
  - `[low]` `[patch]` Recovery used a stale stored target and definition. Fix: `markVerbStarted` records what was driven, and recovery uses it.
  - `[low]` `[patch]` Case-insensitive darwin bypassed the store placement check. Fix: case-fold on darwin.
  - `[low]` `[patch]` The tick counted an already-running answer as `woken`. Fix: `waited`/`skipped` count `skipped`.

### 2026-09-28 — Review pass (follow-up review)
- layers: blind-hunter, edge-case-hunter (no story plan for 21-3, so no S band; both ran). Diff since `797e2311bf9c23569257bf1d7ef07ee52e9b69f4` handed as a file (`/tmp/r213/diff.patch`, 2647 lines; `_bmad-output/` excluded).
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 1: (high 1)
  - A worker that outlives a killed supervisor keeps editing the checkout after `recover` releases the lock (both layers). Consult 11:29:57Z: defer to 21-6/21-5, deferral class (a) AC3; README operator caution added. Not written to `deferred-work.md`: the invocation reserves that ledger to the orchestrator; the frontmatter `deferred:` entry is the hand-off.
- reject: 2: (low 2)
  - The restart lookup's earliest-candidate pick could adopt a foreign run minted between the snapshot and the verb (edge). The pick was consult-ruled in pass 3 (11:20:09Z) and carried to 21-6; never consult twice on one question.
  - A relative `TK_SUPERVISOR_DB` resolves per cwd (edge). The intent pins the refusal set, and the path is the operator's environment.
- addressed_findings:
  - `[medium]` `[patch]` A `tk-studio-launch` run ending without its status block naming the engine released the lock with no engine check (both layers). Fix: `Queue.endDriven` applies recover's launch rule (live → engine, probe failure → unverified holder, none → release), outside any transaction; `mirror` and `runJob`'s catch use it.
  - `[medium]` `[patch]` Owner/engine probes (the win32 PowerShell start-time read) ran inside `BEGIN IMMEDIATE`, holding the write lock up to ~30 s (blind). Fix: `claim` probes first, then re-reads the rows inside the transaction and retries on change; a test fails any probe made while `db.inTransaction`.
  - `[low]` `[patch]` The "failed transaction" test never entered a transaction (blind). Fix: a temporary aborting trigger on `events` proves `end`/`setStudioRun`/`claim` leave run, lock and events unchanged.
  - `[low]` `[patch]` `drain` reported a post-claim failure without the `blocked` state the run already had, and README said transport failures leave it queued (blind). Fix: the report reads the run back; README separates pre-claim (queued) from post-claim (blocked).
  - `[low]` `[patch]` The tick counted a thrown refusal as `error` (edge). Fix: a refused `StartError` counts `refused`.

### 2026-09-28 — Review pass (second follow-up review)
- layers: blind-hunter, edge-case-hunter (no story plan for 21-3, so no S band; both ran). Diff since `797e2311bf9c23569257bf1d7ef07ee52e9b69f4` handed as a file (`/tmp/r213b/diff.patch`, 2934 lines; `_bmad-output/` excluded).
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 0
- reject: 4: (medium 2, low 2)
  - `claim` approves a second caller in the same process for a run it already owns (blind). Hypothetical: the CLI, the tick and `drain` are sequential today; a long-lived in-process consumer is Epic 22 (Never list: the HTTP API, a daemon).
  - A relative `TK_SUPERVISOR_DB` resolves per cwd (edge). Rejected in the first follow-up pass: the intent pins the refusal set, and the path is the operator's environment.
  - A dead owner with no recorded start time (darwin, or a failed win32 read) whose pid was reused reads as alive (edge). This is the Design Note's owner rule ("the recorded start time (when present)"), fail closed; win32 start time was added in pass 3.
  - A hostname change makes orphans read as live remote owners (edge). Rejected in pass 2: the spec's fail-closed rule.
- addressed_findings:
  - `[medium]` `[patch]` The tick never recovered a run it stranded: `shouldWake`'s no-overlap skip stopped the job before `runJob`, the only place that recovered (blind). Fix: the tick runs the restart rule once at start (not under `--dry-run`, exit 2 if it cannot), and per-job `runJob` skips it.
  - `[medium]` `[patch]` `--timeout-cap-s` capped the `wake`/`submit` verb timeout, so a core job (executed inside `wake` under its own guard) was killed and cancelled early (blind). Fix: the verb timeout uses the job's uncapped guard + 120 s; the cap applies only to the skill invocation.
  - `[medium]` `[patch]` A run queued by `run --permission-mode plan` (lock wait) was later driven by `drain`/the tick under the default mode (blind). Fix: `runs.permission_mode` stores the caller's mode; the effective mode is explicit ?? stored ?? default, re-checked at drive time.
  - `[low]` `[patch]` The tick header still described `--directory` as bypassing the registry, though `runJob` validates through registry `show` (blind). Fix: header and README say the root must be a registered project root.
  - `[low]` `[patch]` `drain` reported a login-preflight stop as `blocked` with `run_id: null` while the run stayed `queued` (blind). Fix: each entry reads the run back and reports its actual queue `state`; the summary's `run_id` names the drained run.
  - `[low]` `[patch]` With `TK_STUDIO_HOME` set elsewhere, a queue file inside the literal `~/.tk-studio` was accepted, against AC1 (edge). Fix: `queueDbPath` refuses both.

## Design Notes

- "Started" means the run reached the studio's minting verb. Just before calling `submit`/`wake`, the queue records `verb_started` in one transaction with an event. That record holds the time and the pre-verb snapshot of the job's studio run ids. Recovering a `running` orphan:
  - `studio_run_id` set → end `partial`, `orphaned: supervisor restart`, and end the studio run if it is non-terminal.
  - `verb_started` set but no `studio_run_id` → look up the job's studio runs absent from the stored snapshot (the 21-1 adoption rule). If one is found, record it as `studio_run_id`, then end both as above. If none is found and the lookup succeeded, re-queue. If the lookup failed, end `partial` naming the failed lookup: never re-queue a run that may have executed. A run must never run twice.
  - neither set → re-queue.
  A `queued` run with a dead owner is re-queued (owner cleared).
- Owner = hostname + pid + a random per-process nonce, plus the process start time where the platform exposes it (Linux `/proc/<pid>/stat` field 22; elsewhere absent). "Mine" compares the nonce, never the pid, so a restarted supervisor that reuses the dead owner's pid still recovers the orphan. Another owner is alive when it is on this host, `process.kill(pid, 0)` succeeds, and the recorded start time (when present) equals the live process's. An owner on another host counts as alive and is named (fail closed).
- Engine at restart: when a `running` orphan's stored definition targets `tk-studio-launch`, `recover` probes the launch core's `status --directory <checkout>` before releasing the lock. If `live[]` is non-empty, the lock passes to that engine (event names it). If the probe fails, the lock passes to an unverified engine holder. A claim re-probes it: non-empty `live[]` or a failed probe counts as live.
- Draining: `drain` runs `recover`, then drives every `queued` run that has no live owner, oldest first. It uses the job id and checkout stored in the queue and re-validates through `resolve`. A lock wait leaves the run `queued`. Its JSON answer lists each run's outcome. So a re-queued, submitted or waiting run is picked up at the next `drain`, never left forever.
- If the studio run is still non-terminal when `run` returns (for example a one-shot scheduled `at` a later time: "queued with no executable directive"), the queue run ends `blocked` with that reason and the studio run id named. It is never left `queued`.
- AC2's "racing wakes" is pinned at the queue (`enqueue`), where both CLI verbs and the tick converge.
- Live legs are `unverifiable-here`: killing the supervisor on the agent PC mid-run. Operator command: `bun src/cli.ts drain` after a restart (it recovers, then drives the queue).
- Tick: an unusable queue (`QueueDbMissing`/`QueueDbPlacementRefused`) is a tick that cannot run (exit 2, before any job). A `runJob` outcome with no studio run (blocked before minting, not-woken) counts as `refused`, not `woken`.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: success, lockfile unchanged
- `bun test` -- expected: all green (with `TK_STUDIO_ROOT` set, so the e2e describes run)
- `bunx tsc --noEmit` -- expected: no errors
- `git grep -n -E "(/c/|[A-Z]:\\\\|/home/|/Users/)" -- src test package.json README.md` -- expected: nothing
- `git diff --stat 797e2311bf9c23569257bf1d7ef07ee52e9b69f4 -- package.json` -- expected: no new dependency
- `TK_SUPERVISOR_DB=$(mktemp -d)/q.db timeout -k 5 960 bun src/cli.ts run maintenance-conformance --directory .` -- expected: core run through the queue, `state: complete`, `run_id` is a queue id, `studio_run_id` set

## Deviation Summary

### planning (2026-09-28, this session)

- planned (dispatch replan): timeout recovery "adopts only a run started within 2s before the caller began" / actual: the plan keeps the rule the code already implements: adopt only a studio run absent from the pre-verb `status` snapshot / why: 21-1 pass 5 (consult 09:46:34Z) replaced the 2s window with the snapshot rule because queued runs carry no `started`. The replan note repeats the superseded wording. Both rules mean "never adopt a run the caller did not start" / may affect: 21-6
- planned: 21-1's summary `run_id` is the studio run id / actual: `run_id` is the queue run id and `studio_run_id` is added / why: AC2 gives the second caller a run id before any studio run exists (a run waiting on the lock has none) / may affect: 21-6, Epic 22 (ST-007 answers carry the queue run id)

### pass 1 (2026-09-28, implementer)

- planned: "On every start, the supervisor recovers orphaned runs" / actual: recovery runs in `run` (and so in the tick) and in `recover`; `submit` does not recover / why: the Tasks list recovery only for `run`, and `submit` drives nothing / may affect: 21-6
- planned: 21-1's `not-woken` answer had `run_id: null` / actual: it now carries the queue run id, and the queue run ends `blocked` with reason `not-woken: …` / why: summary `run_id` is the queue id, and a queue run may never be left `queued` / may affect: 21-6, Epic 22
- planned: 21-1's exit-2 start-error answer always had `run_id: null` / actual: a start error after the lock was claimed (snapshot failure, verb refused, no new run after a failure) ends the queue run `blocked` and the answer names its `run_id` / why: the queue run exists at that point and must not stay `running` / may affect: 21-6
- planned: an orphaned run's studio run is ended with `finish --state partial` (skill) or `cancel` (core) / actual: a `status` call comes first, and a studio run that is already terminal is not ended again (the event records its state) / why: keeps 21-1's "end it only if non-terminal" rule and avoids a sure-to-fail finish on a terminal run / may affect: none
- planned: owner rules as the Design Notes state them / actual: `submit` enqueues with no owner, so a submitted run is never treated as orphaned and is adopted by a later `run`; a lock wait clears the waiting run's owner; an owner on another host counts as alive / why: the spec does not cover these cases; this keeps waiting and submitted runs re-claimable without a spurious requeue / may affect: 21-6
- planned: the lock is freed when its holder ends or the engine is no longer live / actual: `claim` also takes over a lock whose holder run is no longer `running` or whose owner is dead, and names the release in the event / why: fail-safe for a crash that left the lock row behind / may affect: none
- planned: the race uses "a small enqueue script" / actual: the script is written to a temp dir at test time, not added as a tracked fixture / why: avoids a new tracked file / may affect: none
- planned: route the tick's wake through `runJob` / actual: done, but `finishArgsFor` and `knowledgeOf` in `tick.ts` are now unused by the tick and left exported / why: removing them would be a refactor outside the story / may affect: 21-5

DEVIATION SCORE: 1 (implementer). Session score, with the planning entries: 2.

DRIFT: dispatch replan's 2s-window recovery wording kept as 21-1's snapshot-diff rule — 21-1 consult 09:46:34Z superseded the window; both mean "adopt only a run the caller started" — affects: 21-6
DRIFT: CLI summary `run_id` is the queue run id, and the studio's id moves to `studio_run_id` — AC2 hands out a run id before any studio run exists — affects: 21-6, Epic 22
DRIFT: recovery runs on `run`/tick/`recover`, not on `submit` — `submit` drives nothing — affects: 21-6
DRIFT: `not-woken` and post-claim start errors now carry the queue `run_id`, and the queue run ends `blocked` — a queue run is never left queued/running — affects: 21-6, Epic 22
DRIFT: orphan recovery reads the studio run's `status` first and ends it only if non-terminal — the 21-1 end-only-if-non-terminal rule — affects: none
DRIFT: submitted runs carry no owner; a lock wait clears the owner; an owner on another host counts as alive — owner rules the spec left open — affects: 21-6
DRIFT: `claim` takes over a stale lock (holder not running, or owner dead) and names it in the event — crash-left lock rows — affects: none
DRIFT: race-test enqueue script generated at test time, not tracked — no new tracked file — affects: none
DRIFT: `finishArgsFor`/`knowledgeOf` left exported but unused by the tick — deleting is out-of-story refactor — affects: 21-5

### pass 2 (2026-09-28, implementer: loopback 1 re-derivation from the KEEP patch)

- planned: a lookup-failed orphan ends `partial` with reason `orphaned: supervisor restart` naming the failed lookup / actual: reason `orphaned: supervisor restart; studio run lookup failed: <detail>`; the event carries `lookup: {ok:false}` / why: the Design Note says to name it; the reason is where operators look / may affect: 21-6
- planned: pass-1 probe and recover shapes / actual: `ownerAlive(owner)`, `engineLive(root, id | null)` (null = unverified engine, any `live[]`), `EngineProbe.run_ids`, `recover(ops: {end, find})` / why: nonce + start-time owners, the unverified holder and the `verb_started` lookup need them / may affect: 21-6
- planned: the pass-1 schema / actual: `runs` gains `owner_nonce`, `owner_start`, `verb_started`, `verb_snapshot`; `locks` gains `owner_nonce`, `owner_start`; no migration / why: the Design Notes need them; no pass-1 queue file was ever deployed / may affect: none
- planned: a launch-orphan handover passes the lock to "that engine" / actual: with several live engines the lock names the first `live[]` id, and a claim on an unverified holder names every live id / why: the lock row holds one engine id / may affect: none
- (amended per consult below) planned: `drain` re-validates through `resolve` and lists each outcome / actual: a run failing re-validation (a registry `show` refusal, or a `resolve` refusal or `problems[]`) ends `blocked` with the `resolve` problems verbatim. Only transient pre-validation stops (the login preflight) and lock waits leave it `queued`. Exit is 0 when every driven run completed, 1 otherwise, 2 when the queue is unusable / why: AC4 says a run is never left `queued` forever; the spec did not give exit codes / may affect: 21-6
- planned: a no-studio-run outcome counts `refused` in the tick / actual: blocked-before-minting and `not-woken` count `refused`; a lock wait or already-running answer stays `skipped`; the queue check also runs under `--dry-run` / why: those are not refusals; "exit 2 before any job" applied literally / may affect: 21-5
- planned: tests only in the named files / actual: a tick exit-2 test added in `command-line.test.ts`; tick classification not unit-tested (`tickJob` not exported); the reused-pid start-time test is Linux-only (`skipIf`); e2e restart tests seed dead-owner state by direct SQL / why: nothing is exported for the tick; `/proc` is Linux-only; the live kill leg is unverifiable-here / may affect: none

DEVIATION SCORE: 1 (implementer). Session score 2: the consult scored the pass-2 set 2, because 21-5 and 21-6 consume it.

DRIFT: lookup-failed orphan reason is `orphaned: supervisor restart; studio run lookup failed: <detail>` — names the failed lookup where operators read — affects: 21-6
DRIFT: queue probe/recover signatures reshaped (`ownerAlive`, `engineLive(root, id|null)`, `recover({end, find})`) — nonce owners, unverified engine, verb_started lookup — affects: 21-6
DRIFT: `runs`/`locks` gain owner nonce/start and `verb_started`/`verb_snapshot` columns, no migration — Design Notes need them; no queue file deployed — affects: none
DRIFT: multi-engine handover names the first live id — one engine id per lock row — affects: none
DRIFT: `drain` ends a run failing re-validation `blocked` with the `resolve` problems (amended per consult); exit 0/1/2 — AC4 never-queued-forever; spec silent on exit codes — affects: 21-6
DRIFT: tick: lock wait/already-running stay `skipped`; queue check runs under `--dry-run` — not refusals; exit-2-before-any-job literal — affects: 21-5
DRIFT: tick classification not unit-tested, reused-pid test Linux-only, e2e restarts seeded via SQL — no tick export; /proc Linux-only; live kill unverifiable-here — affects: none

### pass 2b (2026-09-28, implementer: the consult-directed `drain` fix)

- planned: `drain` ends a refused run through `queue.end(r.run_id, "blocked", …)` / actual: `queue.end(…, { from: "queued" })`, a new optional guard on `Queue.end` that refuses if the run is no longer `queued` / why: another process could claim the run between listing it and ending it; without the guard, `drain` could end a live `running` run / may affect: none

DEVIATION SCORE: 1

DRIFT: `Queue.end` gains an optional `from` state guard that `drain` uses — never end a run another process claimed in between — affects: none

### pass 2c (2026-09-28, implementer: consult-directed `from` guard test)

DEVIATIONS: none (score 0; test-only change in `test/queue.test.ts`)

### pass 3 (2026-09-28, implementer: review pass 2 patches)

- planned: Design Note — process start time on Linux, "elsewhere absent" / actual: win32 reads the creation time via bounded PowerShell (`processStartTime(pid, platform, ps)`); only other platforms or a failed read give absent / why: review finding 8 — a reused pid on the agent PC must not read as a live owner / may affect: 21-6
- planned: the recovery lookup follows the 21-1 adoption rule (newest absent run) / actual: adopts the earliest absent run minted at/after `verb_started`; an unreadable id is ambiguous → lookup failure / why: review finding 2 — a foreign run minted during downtime must not be adopted / may affect: 21-6
- planned: the spec's queue shape and `runJob` / actual: `runs.definition` column; `markVerbStarted` takes `driven: {target, definition}` and overwrites `runs.target`; `RunOptions.runId`; `RunSummary.waited`/`skipped`; injectable platform/reader args on `processStartTime`, `defaultOwnerAlive`, `queueDbPath`; new export `studioRunOrder` / why: review findings 1, 7, 8, 9, 10 / may affect: 21-6, Epic 22
- planned: every `validate` error marks the run refused (pass 2b) / actual: registry `show` counts as a refusal only when its error starts with `registry: ` (server.ts's ok:false phrasing); spawn, timeout and no-JSON errors are transient; `resolve` "served no merged definition" stays transient / why: review finding 4 without changing server.ts / may affect: none

DEVIATION SCORE: 2

DRIFT: win32 owner start time read via bounded PowerShell (amends "elsewhere absent") — pid reuse on the Windows agent PC — affects: 21-6
DRIFT: restart lookup adopts the earliest absent studio run minted at/after `verb_started` (not the newest); an unreadable id is a lookup failure — never adopt a foreign run minted during downtime — affects: 21-6
DRIFT: `runs.definition`, `markVerbStarted(driven)`, `RunOptions.runId`, `RunSummary.waited/skipped`, injectable platform seams, `studioRunOrder` — seams for the pass-2 review patches — affects: 21-6, Epic 22
DRIFT: registry refusal detected by the `registry: ` error prefix; transport failures and "no merged definition" transient — tell refusals from transport failures without touching server.ts — affects: none

### follow-up review pass (2026-09-28, implementer: review patches)

- planned: `end` releases the lock unless the status block names an engine / actual: `Queue.endDriven` probes the launch core for a `tk-studio-launch` run that reached `verb_started` without naming an engine; `end` accepts `engineRunId: null` (an unverified holder); `ended` events carry an `engine` detail / why: AC3 with the Design Note "Engine at restart" rule on the normal end path / may affect: 21-6
- planned: the probe gate / actual: `endDriven` probes only after `verb_started` / why: the driven definition is recorded there; no verb means no engine / may affect: none
- planned: the tick counts no-studio-run outcomes `refused` / actual: a `wake`/`submit` answering `ok:false` is now a refused `StartError` (exit 2 unchanged), `StartError` is exported, and the tick counts a thrown refusal `refused` (not unit-tested: `tickJob` is not exported) / why: Design Note "Tick" / may affect: 21-5
- consult-directed: README caution under the `drain` command (a surviving worker); the finding itself deferred to 21-6/21-5. The consult's DO line also asked for a `deferred-work.md` entry; not written, because the invocation reserves the ledger to the orchestrator.

DEVIATION SCORE: 2 (implementer). Consult 2026-09-28 (follow-up) accepted at 2: #1 at 2, #2 at 1, #3 at 2.

### second follow-up review pass (2026-09-28, implementer: review patches)

- planned: the queue schema as it stood / actual: nullable `runs.permission_mode` (no migration), a `permission-mode` event kind, `enqueue({permissionMode})` and `Queue.recordPermissionMode` (queued runs only); `runJob`'s effective mode = explicit ?? stored ?? default. A queue file created by 54a787f or 55f8935 lacks the column (`CREATE TABLE IF NOT EXISTS`) and must be recreated; the schema exists only on `loop/epic-21`, so nothing deployed carries the old shape / why: review patch 3 — a run queued with `plan` was driven under the default / may affect: 21-6, Epic 22
- planned: the tick recovers inside each `runJob` / actual: the tick recovers once at start (not under `--dry-run`); per-job `runJob` skips it; a real tick needs `TK_STUDIO_ROOT` and the contract pin up front or exits 2 / why: review patch 1 — the no-overlap skip kept a stranded job from `runJob` / may affect: 21-5, 21-6
- planned: `validate` returns one capped `guardS` / actual: `Validated.jobGuardS` (uncapped) sets the `wake`/`submit` timeout (guard + 120 s); the cap applies only to the skill invocation; new exports `guardsFor`, `startRun`, `finishRun` (injectable runner/invoker), `Validated`/`Started` / why: review patch 2 and its test seams / may affect: 21-4, 21-5
- planned: a drain entry is `{run_id, job_id, summary}` / actual: an entry may carry `state` (the actual queue state), and the summary's `run_id` is filled with the drained run id when it had none / why: review patch 5 / may affect: 21-6, Epic 22
- planned: none / actual: a stored permission mode is re-checked with `buildWorkerCommand` after the claim; a failure ends the run `blocked` like any post-claim start failure / why: a mode read back from the database gets the same host-bypass check as a caller's / may affect: none

DEVIATION SCORE: 2 (implementer). Consult 2026-09-28T11:57:47Z accepted the set at 2.

## Consult Log

- 2026-09-28T10:52:44Z — trigger: deviation-gt-0 — question: accept the planning + pass-1 deviation set, and does keeping 21-1's snapshot recovery rule contradict the dispatch replan's 2s window? — ruling: accept-deviation score 2 — do: Keep the snapshot rule in `recoverAfterTimeout`; do not re-implement the 2s window. Accept (a)–(i) as one set with the DRIFT lines unchanged; proceed to review. / Carry (b), (c), (d), (f) to the 21-6 planner and (b), (d) to Epic 22 ST-007 as seams: the queue owns `run_id`, the studio id is `studio_run_id`, post-claim errors end `blocked` with the queue run id. / At the next reconcile, replace the stale last sentence of the 21-3 and 21-6 `invoke_dev_with` replan (stories.yaml:62, :134) with the snapshot rule (reconcile's job; this session never edits stories.yaml). — rule candidate: a reconcile that writes a SUPERSEDED entry rewrites every unstarted `invoke_dev_with` carrying the old rule in the same commit; a later SUPERSEDED record outranks replan wording without a consult. — observe record: ok
- 2026-09-28T11:06:31Z — trigger: deviation-gt-0 (pass 2) — question: accept the pass-2 set? Does `drain` leaving a run that fails re-validation `queued` contradict AC4 "never left in queued forever"? — ruling: reject-deviation (the drain entry); the rest accepted as a score-2 set — do: In `drainQueue` (src/cli.ts:208-226), a drained run refused by re-validation (registry `show` refusal, `resolve` refusal or `problems[]`: the StartError from `validate`, src/cli.ts:333-351) is ended via `queue.end(run_id, "blocked", <reason naming the resolve problems verbatim>)` with its event, and reported ended `blocked` with `problems`. Transient pre-validation stops (the login preflight, src/cli.ts:257) still leave it `queued`. / Rewrite the pass-2 `drain` entry and its DRIFT line to say so (exit codes stay 0/1/2); add a test. Accept every other pass-2 entry as a score-2 set, carried to the 21-5 and 21-6 planners. — rule candidate: any validation or start failure found while driving an existing queue run ends that run `blocked` with the failure reason; only lock waits and transient pre-validation stops (login preflight) may leave a run `queued`. — observe record: ok
- 2026-09-28T11:08:44Z — trigger: deviation-gt-0 (pass 2b) — question: accept the optional `from` state guard on `Queue.end` that `drain` uses? — ruling: accept-deviation score 1 — do: Keep the guard (src/queue.ts:511-517) and the drain call (src/cli.ts:229) as is. / Add a test to test/queue.test.ts: a run claimed `running` makes `end(id, "blocked", r, { from: "queued" })` throw, the row stays `running`, no `ended` event is written; without `from`, `end` behaves as before. / Leave the pass 2b entry and DRIFT line as written. — rule candidate: any queue transition acting on an earlier snapshot read passes the expected state as a `from` guard checked inside the immediate transaction. — observe record: ok
- 2026-09-28T11:20:09Z — trigger: deviation-gt-0 (pass 3, review-pass-2 patches) — question: accept the pass-3 set? Does the restart lookup's earliest-at/after-`verb_started` pick contradict "the 21-1 adoption rule"? Is the `registry: ` prefix split acceptable? — ruling: accept-deviation score 2 — do: Keep the pass-3 set as written (`studioRunFinder` src/cli.ts:204-227; the prefix split in `validate` src/cli.ts:413-417; server.ts unchanged). / Carry (i) and the seam DRIFT lines to the 21-6 planner: restart adoption = absent from the snapshot AND minted at/after `verb_started`, earliest wins, an ambiguous candidate fails the lookup. / Proceed. — rule candidate: a cited earlier rule pins its stated invariant ("adopt only a run the caller started"), not that code's tie-break; tightening the selection within the invariant is a score-2 DRIFT without a consult. — observe record: ok
- 2026-09-28T11:29:57Z — trigger: high-severity-finding (follow-up review) — question: a worker (`claude -p` / `uv run jobrun.py`) outliving a killed supervisor keeps editing the checkout after `recover` releases the lock; reject, patch (worker holder), escalate, or defer? — ruling: apply (option D, defer) — do: No code change in 21-3; add a `deferred:` entry (deferral (a), AC3; owner 21-6, with 21-5 owning the tree kill, DW-1) [and a DW entry in deferred-work.md: NOT written by this session, because the invocation forbids touching the orchestrator-owned ledger; the spec `deferred:` entry is the hand-off]. / README: under the `drain` command, an operator line to check no worker of the killed run still runs in the checkout before `drain`. / File the finding `defer` in the Review Triage Log. — rule candidate: when a finding needs holder/lifecycle behaviour for a process that outlives the supervisor and a later story owns that lifecycle (21-5 tree kill, 21-6 restart/resume), file it `defer` to that story without a consult; add an operator caution only if this story ships the command that exposes the gap. — observe record: ok
- 2026-09-28T11:39:11Z — trigger: deviation-gt-0 (follow-up review patches, self-score 2) — question: accept the three patch deviations (`Queue.endDriven` + `end(engineRunId: null)` + `ended` event `engine` detail; the `verb_started` gate on the launch probe; wake/submit `ok:false` as a refused, exported `StartError`)? — ruling: accept-deviation score 2 — do: Accept #1 at 2 (21-6 seam), #2 at 1 (local), #3 at 2 (21-5 seam). / Keep drain's `queue.get(r.run_id)?.state === "queued"` guard on the refusal branch (src/cli.ts:269); a post-claim failure is reported under its actual state (src/cli.ts:277-278). / Add no new behaviour; commit the pass as it stands. — rule candidate: a deviation that only applies the story's own Design Note on another code path, or adds a field to the supervisor's own queue/events schema (not `contracts/`), is recorded at score 1–2 without a consult. — observe record: ok
- 2026-09-28T11:57:47Z — trigger: deviation-gt-0 (second follow-up review patches, self-score 2) — question: accept the five patch deviations (`runs.permission_mode` + `permission-mode` event; the tick's start-of-tick recovery with per-job `skipRecover`; the uncapped `jobGuardS` for the `wake`/`submit` timeout with the cap on the skill invocation only, plus the new exports; drain entries carrying the actual queue `state`; the stored mode re-checked by `buildWorkerCommand`)? Does any touch the host-bypass rule or the guards/pacer Never items? — ruling: accept-deviation score 2 — do: Keep all five items as written; log them as one deviation entry with DRIFT lines (1 and 4 → 21-6, Epic 22; 2 → 21-5, 21-6; 3 → 21-4, 21-5; 5 → none). / Note the schema has no migration: a queue db from 54a787f or 55f8935 lacks `permission_mode` (`CREATE TABLE IF NOT EXISTS`, src/queue.ts:283-289) and must be recreated; the schema exists only on loop/epic-21. / Proceed to the gate; do not re-raise the tick recovery or the wake timeout as a guard or pacer change. — rule candidate: a per-run option the caller sets (permission mode, guard cap) is stored on the queue run and re-validated at drive time with the same validator; a stored-run driver uses the job's uncapped guard for the minting verb and caps only the skill invocation; such changes are score-2 seams and need no consult. — observe record: ok
- 2026-09-28T11:59:45Z — trigger: halt — question: every reviewed-diff file is committed (ef9d642), but `deferred-work.md` holds the orchestrator's pre-existing, uncommitted DW-3 routing; HALT `blocked` "finalization left repository dirty", leave it for the orchestrator, or commit it unchanged? — ruling: accept-deviation score 1 — do: Leave `deferred-work.md` uncommitted and unmodified after confirming `git status --short` lists only it and `git diff --stat` shows only the 8 DW-3 lines (confirmed). / Add the residual-risk line naming the unclean working copy and this ruling; commit that spec edit, then HALT `done`. — rule candidate: the Finalize clean-tree check excludes orchestrator-owned paths (`deferred-work.md`) already dirty at session start and untouched by the session, or the orchestrator commits its ledger routing before invoking a review session. — observe record: ok

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Second follow-up review of the committed story (54a787f, 55f8935). The durable SQLite queue keeps its shape. It still lives at `TK_SUPERVISOR_DB`, is validated through `resolve`, commits one `BEGIN IMMEDIATE` transaction per transition, mints idempotently across `submit`/`wake`, holds one lock per checkout (including launched engines), runs the restart rule, and has `drain`. This pass fixed six review findings:
- The tick now runs the restart rule once at start, before any per-job gating. A run it stranded was never recovered before, because the no-overlap skip kept that job away from `runJob`. (AC4; the salvage "tick strands runs")
- `--timeout-cap-s` no longer shortens the `wake`/`submit` verb timeout, which had killed and cancelled core jobs early. The cap applies only to the skill invocation.
- A queued run keeps the permission mode it was requested with (`runs.permission_mode`), so `drain` or the tick never drives it under a broader default.
- `drain` reports each run's actual queue state. A login-preflight stop now reads `queued` with the run id, not `blocked` with `run_id: null`.
- The queue file is refused inside the literal `~/.tk-studio` even when `TK_STUDIO_HOME` points elsewhere. (AC1)
- The tick's `--directory` docs now say the root must be a registered project root.

**Files changed (this pass):**
- `src/queue.ts`: `runs.permission_mode`; `enqueue({permissionMode})`, `recordPermissionMode` and a `permission-mode` event; `queueDbPath` refuses both `TK_STUDIO_HOME` and `~/.tk-studio`.
- `src/cli.ts`: `guardsFor` and `Validated.jobGuardS` (uncapped verb timeout, capped invocation); `startRun`/`finishRun` exported with injectable seams; `runJob` records the mode and uses explicit ?? stored ?? default, re-checked after the claim; `drain` entries carry the actual queue state.
- `src/tick.ts`: start-of-tick `recoverQueue()` (not under `--dry-run`; exit 2 if it cannot run), per-job `skipRecover: true`; header and `--directory` wording.
- `test/queue.test.ts`: the literal `~/.tk-studio` refusal (including the darwin case-fold); the `permission_mode` round-trip.
- `test/command-line.test.ts`: guard-timeout tests (core `wake` and skill `submit` get the uncapped guard, invocation capped); start-of-tick recovery end to end (dry-run leaves it alone; with recovery stubbed out, the test fails); `drain` drives a `plan`-queued run under `plan`; the updated login-stop drain entry.
- `README.md`: the tick root and recovery lines, the drain report state, the store placement rule.

**Review findings (this pass):** both layers ran. Patches applied 6 (high 0, medium 3, low 3); deferred 0; rejected 4 (medium 2, low 2); intent_gap 0; bad_spec 0.

**Follow-up review recommended: true.** Patched this pass: high 0, medium 3, low 3. Score 3×3 + 3 = 12 ≥ 5.

**Verification (re-run by this session after the implementer's patches):**
- `bun install --frozen-lockfile`: no changes
- `bun test`: 192 pass / 0 fail (740 expects), 5 files; `TK_STUDIO_ROOT` set, so the end-to-end describes ran
- `bunx tsc --noEmit`: clean
- machine-path `git grep` over `src`, `test`, `package.json`, `README.md`: nothing
- `git diff --stat 797e2311bf9c23569257bf1d7ef07ee52e9b69f4 -- package.json bun.lock`: empty (no new dependency)
- the live `maintenance-conformance` run through the queue was not re-run this pass. It passed in the first follow-up pass (exit 0, `state: complete`, 116 checks / 0 failures), and this pass does not touch the core path's minting or mirroring except the verb timeout, which is now longer and never shorter.

**unverifiable-here:** killing a real supervisor or tick mid-run on the agent PC. Operator command after a restart: first check that no worker of the killed run still runs in the checkout, then run `bun src/cli.ts drain` (the next tick also recovers on start).

**Residual risks:**
- Deferred (high, first follow-up pass; now in the ledger as DW-3): a worker that outlives a killed supervisor keeps editing the checkout after recovery releases the lock (21-6, 21-5). The README caution is the guard.
- A queue file created before this pass lacks `permission_mode` and must be recreated (no migration; nothing deployed).
- A failed studio-end call during recovery leaves the studio run open (the matrix's rule).
- Nothing drains automatically; the daemon and pacer are later stories.
- An owner on another host, an owner without a readable start time, or a failed engine probe counts as live (fail closed). Only hand-editing clears it until Epic 22's cancel.
- The tick's per-job refusal classification still has no unit test (`tickJob` is not exported). Start-of-tick recovery is covered end to end.
- The working copy was not clean at HALT: `deferred-work.md` holds the orchestrator's pre-existing, uncommitted DW-3 routing (8 lines). It is left for the orchestrator's reconcile commit under the invocation's ledger-ownership rule (consult ruling 2026-09-28T11:59:45Z).

DRIFT: dispatch replan's 2s-window recovery wording kept as 21-1's snapshot-diff rule — 21-1 consult 09:46:34Z superseded the window; both mean "adopt only a run the caller started" — affects: 21-6
DRIFT: CLI summary `run_id` is the queue run id, and the studio's id moves to `studio_run_id` — AC2 hands out a run id before any studio run exists — affects: 21-6, Epic 22
DRIFT: recovery runs on `run`/tick/`recover`/`drain`, not on `submit` — `submit` drives nothing — affects: 21-6
DRIFT: `not-woken` and post-claim start errors carry the queue `run_id`, and the queue run ends `blocked` — a queue run is never left queued/running — affects: 21-6, Epic 22
DRIFT: orphan recovery reads the studio run's `status` first and ends it only if non-terminal — the 21-1 end-only-if-non-terminal rule — affects: none
DRIFT: submitted runs carry no owner; a lock wait clears the owner; an owner on another host counts as alive — owner rules the spec left open — affects: 21-6
DRIFT: `claim` takes over a stale lock (holder not running, or owner dead; a dead launch holder is engine-probed first) and names it in the event — crash-left lock rows — affects: none
DRIFT: race-test enqueue script generated at test time, not tracked — no new tracked file — affects: none
DRIFT: `finishArgsFor`/`knowledgeOf` left exported but unused by the tick — deleting is out-of-story refactor — affects: 21-5
DRIFT: lookup-failed orphan reason is `orphaned: supervisor restart; studio run lookup failed: <detail>` — names the failed lookup where operators read — affects: 21-6
DRIFT: queue probe/recover signatures reshaped (`ownerAlive`, `engineLive(root, id|null)`, `recover({end, find})`) — nonce owners, unverified engine, verb_started lookup — affects: 21-6
DRIFT: `runs`/`locks` gain owner nonce/start, `verb_started`/`verb_snapshot` and `runs.definition` columns, no migration — Design Notes and review patches need them; no queue file deployed — affects: none
DRIFT: multi-engine handover names the first live id — one engine id per lock row — affects: none
DRIFT: `drain` ends a run failing re-validation (a refusal, not a transport failure) `blocked` with the `resolve` problems; exit 0/1/2 — AC4 never-queued-forever (consult) — affects: 21-6
DRIFT: tick: lock wait/already-running count `skipped`; the queue check runs under `--dry-run` — not refusals; exit-2-before-any-job literal — affects: 21-5
DRIFT: tick classification not unit-tested, reused-pid test Linux-only, e2e restarts seeded via SQL — no tick export; /proc Linux-only; live kill unverifiable-here — affects: none
DRIFT: `Queue.end` gains an optional `from` state guard that `drain` uses — never end a run another process claimed in between — affects: none
DRIFT: win32 owner start time read via bounded PowerShell (amends "elsewhere absent") — pid reuse on the Windows agent PC — affects: 21-6
DRIFT: restart lookup adopts the earliest absent studio run minted at/after `verb_started` (not the newest); an unreadable id is a lookup failure — never adopt a foreign run minted during downtime — affects: 21-6
DRIFT: `runs.definition`, `markVerbStarted(driven)`, `RunOptions.runId`, `RunSummary.waited/skipped`, injectable platform seams, `studioRunOrder` — seams for the pass-2 review patches — affects: 21-6, Epic 22
DRIFT: registry refusal detected by the `registry: ` error prefix; transport failures and "no merged definition" transient — tell refusals from transport failures without touching server.ts — affects: none
DRIFT: `ended` events gain an `engine` detail; `Queue.end` accepts `engineRunId: null` (an unverified engine holder) through the new `Queue.endDriven` — a launch run ending without naming its engine must get the recover-style probe (AC3), and the event names the probe outcome — affects: 21-6
DRIFT: `endDriven` probes the launch core only once the run reached `verb_started` — the driven definition is recorded there, and a run that never reached the verb cannot have started an engine (recover's gate) — affects: none
DRIFT: a `wake`/`submit` answering `ok:false` is a refused `StartError` (exit 2 unchanged), and `StartError` is exported — the tick counts a start with no studio run `refused` (Design Note "Tick") and must recognise the class — affects: 21-5
DRIFT: `runs.permission_mode` (no migration; a pre-pass queue file must be recreated), a `permission-mode` event, `enqueue({permissionMode})`/`recordPermissionMode`; effective mode explicit ?? stored ?? default — a queued run must not be driven under a broader mode than requested — affects: 21-6, Epic 22
DRIFT: the tick recovers once at start (not under `--dry-run`, exit 2 if it cannot) and per-job `runJob` skips recovery — the no-overlap skip kept a stranded job from ever recovering — affects: 21-5, 21-6
DRIFT: the `wake`/`submit` verb timeout uses the job's uncapped guard + 120 s and `--timeout-cap-s` caps only the skill invocation; `guardsFor`/`startRun`/`finishRun` exported — a core job runs inside `wake` under its own guard — affects: 21-4, 21-5
DRIFT: drain report entries may carry the actual queue `state`, and the summary's `run_id` names the drained run — a login-preflight stop left the run queued but reported blocked/null — affects: 21-6, Epic 22
DRIFT: finalization leaves the orchestrator's pre-existing, uncommitted `deferred-work.md` DW-3 routing uncommitted (working copy not clean) — the invocation reserves that ledger to the orchestrator (consult 11:59:45Z) — affects: none
DRIFT: a stored permission mode is re-checked by `buildWorkerCommand` after the claim; a failure ends the run `blocked` — a mode read from the database gets the caller's host-bypass check — affects: none

## Reconcile

### 2026-09-28 — adjust-stories

- Score: 2 (planning and passes 1–3, plus both follow-up passes, were consult-accepted at 2).
- Reasoning: 21-3 was checked against 21-4, 21-5, 21-6 and Epic 22 (22.1 names "Story 21.3's validation"). Nothing contradicts an AD, the 0.1.18 contract, or a recorded ruling. The queue's run id is the supervisor's own; `jobrun` verbs still get the studio id, and run state stays in the studio's workspaces (AD-10). No later acceptance criterion has to change. Four stories were written against the pre-queue CLI, and each can take the new shape through an `invoke_dev_with` note:
  - the queue run id vs `studio_run_id`;
  - per-run options stored on the queue run and re-checked at drive time;
  - the uncapped verb timeout;
  - the tick's start-of-tick recovery and queue-backed wake;
  - the `verb_started` restart rule with nonce owners;
  - DW-3: a worker that outlives a killed supervisor, deferred to 21-6 and 21-5.
  Consult 10:52:44Z asked this reconcile to replace the stale 2-second sentence in 21-6. 21-3's own entry has started, so it stays as is.
- Affected:
  - 21-4: "the tier comes from the submission or the supervisor's own per-job config". A run may be queued and then driven later by `drain` or the tick, so the submitted tier has to be stored on the queue run, the way `runs.permission_mode` is.
  - 21-5: "the worker's whole process tree is killed and the run finishes `partial` with the guard named". A core job runs inside `wake`/`submit` under a supervisor timeout of the uncapped guard + 120 s, while `--timeout-cap-s` caps only the skill invocation. Also, DW-3's surviving worker needs the tree kill.
  - 21-5: "never while a run of it is `queued` or `running`". The pacer must read the queue's runs, since the tick already goes through the queue-backed `runJob` and recovers at start.
  - 21-6: "every run it owned is found in the queue ... (superseding Story 21.3's orphan rule for runs that can resume)". Ownership is hostname + pid + nonce + start time. Restart adoption uses `verb_started` + the snapshot (earliest absent run at or after it; an ambiguous lookup fails), not a 2 s window. DW-3 is 21-6's.
  - 22-1: "it is queued through Story 21.3's validation and the response carries the run id". That id is the queue run id (`q-<job>-<ts>-<hex>`), and the studio id is `studio_run_id`.
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 21-4-the-worker-runs-on-the-right-tier-and-reports-its-cost
