---
title: "Guards and the Pacer Are the Wrapper's Job"
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred:
  - summary: >-
      A running orphan that `recover` ends `partial` never records a `stopped` event, even when its job's `stop.on_status` lists `partial`.
    evidence: |-
      Queue.recover (orphan branch, the `orphaned` event) writes no stop and has no job definition in hand; the studio run is ended `partial` via ops.end, so the studio's evaluate_stop refuses every later wake, but the pacer keeps minting queue runs that end `blocked` not-woken each hint interval. AC4 "the stop condition is recorded in events" does not hold for restart-ended runs. Deferral class (a). Fixing it reshapes `Queue.recover`, which this story may not do; 21-6 owns the killed-supervisor orphan rule (DW-3).
    location: >-
      src/queue.ts Queue.recover (orphan branch); src/cli.ts studioOps
    severity: low
baseline_commit: 981df26fd3b4db12232dd41030e1a8cefd0fff4f
baseline_revision: 981df26fd3b4db12232dd41030e1a8cefd0fff4f
deviation_score: 2
reconcile_verdict: adjust-stories
---

<intent-contract>

## Intent

**Problem:** The studio's guards are data (`guards`, `stop`, `cadence.hint_seconds`) that the executing wrapper must enforce (contract §4; `jobrun.py account` "the executing wrapper MUST call each iteration and MUST obey"). The supervisor enforces wall-clock only through stand-ins (the `wake`/`submit` verb timeout `jobGuardS + 120`, and the capped skill invocation), its POSIX kill reaches only the direct child (DW-1), it never calls `account`, and the tick paces from the studio's `status` instead of the queue.

**Approach:** A named wall-clock guard with a real process-tree kill on the host (POSIX process group; win32 `taskkill /T` unchanged) and inside the sbx VM (argv-only); `account` after each worker iteration with turns/tokens from the worker's transcript; a pacer driven by the queue db (`TK_SUPERVISOR_DB`); and a `stop.on_status` stop recorded in the queue's `events` table.

User story (epics.md, Story 21.5): As the operator, I want wall-clock, turn, and token guards enforced by the supervisor, and recurring jobs paced without overlap, so that no unattended run outlives its budget and no job piles up behind itself.

## Boundaries & Constraints

**Always:**
- Every guard trip ends the run `partial` with `reason` naming the guard that actually tripped and its value, e.g. `guard: max_wall_clock_seconds (600s)`, `guard: max_turns (40)`. A trip of the tick's `--timeout-cap-s` names the cap, not the job guard.
- POSIX spawns use `detached: true` and the kill is `process.kill(-pid, "SIGKILL")` (falling back to `child.kill`). win32 never gets `detached` (21-4 AC1 console hosting) and keeps `taskkill /F /T /PID`.
- The sbx worker's in-VM guard is argv only: GNU `timeout -k <s> <guardS>` placed before `env` in the `sbx exec <sb> …` argv. The prompt stays one argv item. No shell, no pattern kill.
- `account` is called through the verb runner (`jobrun.py account --directory <root> --run-id <studio run id> --turns N --tokens N`) after `invoke` returns and before `finish`, only when `defn.guards` has `max_turns` or `max_tokens`. `within_budget: false` → finish `partial` naming `exceeded` (all names). A failed `account` or an unlocatable transcript is named in the finish reason (`guard: account failed — <cause>`, state `partial`), never swallowed.
- Host transcript: `<CLAUDE_CONFIG_DIR ?? ~/.claude>/projects/*/<session_id>.jsonl`, exactly one match, plus every `*.jsonl` directly in its sibling `<session_id>/subagents/` directory (the worker's subagents; a missing directory counts zero, an unreadable subagent file is a named `TranscriptError`), merged by `message.id` so no message counts twice. Turns = distinct assistant `message.id`s; tokens = sum over distinct assistant messages of `usage.input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Pure parser, fixture-tested.
- sbx turns/tokens come from the JSON result's `num_turns`/`usage` (same token sum), because the transcript lives inside the microVM (recorded DRIFT).
- A core run's backstop trip (verb timeout) keeps 21-1 AC5b: the studio run is `cancel`led, never `finish`ed; the queue run ends `partial` with the guard named in its reason and events.
- The pacer reads `queued`/`running` and last-end from the queue db; keeps the tick's start-of-tick `recoverQueue`, `runJob(…, { guardCapS, skipRecover: true })`, discovery through `tk_job resolve`, and its counts (`StartError` refused, lock wait/already-running skipped). `shouldWake` stays pure with injectable `nowMs`.
- The stop event: kind `stopped`, `from_state` = `to_state` = the run's terminal state, detail `{condition: "on_status", state, job_id}`, written when the queue run ends in a state listed in `defn.stop.on_status`. The pacer skips a job whose latest terminal queue run carries that event, before minting, and logs the condition.
- Close DW-1 in `deferred-work.md`; note what DW-3 still needs from 21-6. Delete `finishArgsFor`, `knowledgeOf`, `FinishArgs` from `tick.ts`.

**Block If:**
- Ending the in-VM sbx worker needs a shell, an interpolated prompt or a pattern kill.
- AC1 cannot hold for core runs without calling `finish` on a core run.
- The change needs a file outside the Files list below, or more than 10 files.

**Never:** change `jobrun.py` or anything in the plugin (AD-2); add `--max-turns` or any worker flag standing in for a guard (AD-14); touch `Queue.recover` ownership (DW-3 stays with 21-6); add a dependency; put a machine path in a tracked file (AD-15); kill by name pattern in code or tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wall-clock trip, host POSIX | worker spawns a grandchild, exceeds guard | parent and grandchild gone; run `partial`, reason `guard: max_wall_clock_seconds (Ns)` | timeout text still matches `/timed out/i` |
| Cap trip | `--timeout-cap-s` < job guard, cap trips | run `partial`, reason names the cap and its value | — |
| Wall-clock trip, sbx | sbx worker exceeds guard | host `sbx exec` tree killed; in-VM `timeout` ends the VM worker | — |
| Core backstop trip | `wake` exceeds `jobGuardS + 120` | studio run `cancel`led; queue run `partial` naming the guard | never `finish` on core |
| Budget ok | `max_turns: 40`, transcript 3 turns | `account --turns 3 --tokens T` called; finish per status block | — |
| Budget exceeded | `account` answers `within_budget: false, exceeded: [max_tokens]` | finish `partial`, reason `guard: max_tokens (N)` | status block still recorded |
| No turn/token guard | guards has only `max_wall_clock_seconds` | `account` not called | — |
| Transcript missing / ambiguous | 0 or >1 `<session_id>.jsonl` | finish `partial`, reason `guard: account failed — transcript …` | named, not guessed |
| Pacer, hint not elapsed | last queue run ended 10 s ago, hint 60 | skip, not woken | — |
| Pacer, live run | a run of (job, checkout) `running`, or `queued` under a live owner | skip | — |
| Pacer, ownerless queued run | the only live run is an ownerless `queued` run (lock wait, requeue, submit) | `runJob` adopts and drives that run (idempotent mint, nothing new minted); hint not re-applied | stop skip still first |
| Pacer, no runs | no queue runs | wake | — |
| Stop on status | `on_status: [partial]`, run ends `partial` | `stopped` event in `events`; next tick skips the job | — |

</intent-contract>

## Code Map

- `src/server.ts:165` `killTree` -- POSIX `child.kill("SIGKILL")` hits the direct child only (DW-1). Fix with process group; win32 unchanged.
- `src/server.ts:173` `runProcess` -- the one spawn helper (used by `runUv` :211, `runJobVerb` :223, the default `Spawner`: preflights and `invokeSkill`). Timeout message `timed out after Ns (process tree killed)` is matched by `/timed out/i` in `cli.ts:649,740`; keep it or change all matchers together.
- `src/server.ts:379` `buildSbxCommand` -- `["exec", sb, "env", "-u", "ANTHROPIC_API_KEY", "-C", vmRoot, "claude", …]`; add in-VM `timeout -k <s> <guardS>` before `env` (needs the guard seconds passed in).
- `src/server.ts:397` `Spawner`, `:399` `runClaude`, `:549` `parseWorkerResult` (keeps only `result`/`is_error`/`total_cost_usd`; surface `session_id`, `num_turns`, `usage`), `:843` `invokeSkill` (returns the invoke result; carry the new fields).
- `src/cli.ts:267` `guardsFor` -- `jobGuardS` (default 600) and `guardS = min(job, cap)`; needs to report which one bounds (job guard vs cap) for the reason.
- `src/cli.ts:597` `startRun` -- `timeoutS = jobGuardS + 120` (:616) for `wake`/`submit`; make it the named guard's backstop.
- `src/cli.ts:645` `recoverAfterTimeout` -- skill run → `finish blocked`, core → `cancel`; the timeout reason text (:669) must name the guard on the queue run.
- `src/cli.ts:696` `finishRun` -- invoke under `guardS`; timeout catch at :738-741 maps to `partial` `guard: max_wall_clock_seconds (<guardS>s)`. The `account` call goes after invoke, before `finish`. Tier from the queue run (`runs.tier`, `runs.sandbox`) / `Started`.
- `src/cli.ts:532` `mirror` -- ends the queue run via `queue.endDriven`; hook for the AC4 stop event (definition in hand).
- `src/cli.ts:348` `recoverQueue`, `:369` `drainQueue` -- unchanged.
- `src/tick.ts:116` `shouldWake(defn, runs: StatusRun[], nowMs)` -- rewrite over queue runs; `:139` `knowledgeOf`, `:153` `finishArgsFor` -- delete; `:196` `tickJob` -- replace the `tk_job status` call (:200) with a queue read; `:241` `main` -- keep `queueDbPath()` check, start-of-tick recovery, resolve discovery. Header comment (:28) describes the stand-ins; update.
- `src/queue.ts:404` `runs()`, `:408` `events(runId?)`, `:437` private `event(...)`, `:707` `endDriven` -- add a public transactional stop-event writer and a per-(job, checkout) runs / last-end read (`ended` event `at`, or `updated` on a terminal run).
- `$TK_STUDIO_ROOT/plugins/tk-studio/lib/jobrun.py:470` `account` (read-only) -- accumulates `turns`/`tokens`, answers `{within_budget, exceeded[], counters}`; also reports `max_wall_clock_seconds`; refuses a non-resumable run, so call before `finish`. CLI flags `--turns`, `--tokens` (:567).
- `$TK_STUDIO_ROOT/plugins/tk-studio/contracts/job.schema.json` -- `stop.on_status` enum `[partial, blocked]`; queue `TERMINAL_STATES` (`src/queue.ts:45`) matches.
- Tests: `test/command-line.test.ts` (injected `verbRunner`/`invoke`, finishRun timeout path, e2e with `TK_STUDIO_ROOT`), `test/queue.test.ts`, `test/tier.test.ts` (sbx argv). No test imports `src/tick.ts` yet.

## Tasks & Acceptance

**Execution:**
- `src/server.ts` -- POSIX process-group spawn and kill in `runProcess`/`killTree` (win32 unchanged); `parseWorkerResult`/`invokeSkill` surface `session_id`, `num_turns`, `usage`; `buildSbxCommand` takes the guard seconds and prefixes the in-VM `timeout -k`.
- `src/transcript.ts` (new) -- pure parser (turns, tokens from JSONL text) and locator (`CLAUDE_CONFIG_DIR ?? homedir/.claude`, `projects/*/<session_id>.jsonl`, exactly one), plus the sbx usage-to-counts helper.
- `src/queue.ts` -- public `recordStop(runId, detail)` (transactional, terminal runs only) and a per-(job, checkout) read returning live runs, last end time and whether the latest terminal run is stopped.
- `src/cli.ts` -- named wall-clock guard (value + which bound) used by `startRun`'s backstop, `recoverAfterTimeout` and `finishRun`'s invoke timeout; `account` after invoke; stop event in `mirror` when state ∈ `stop.on_status`.
- `src/tick.ts` -- pacer over the queue (live skip, hint since last end, stopped skip before minting); delete the dead helpers; header update.
- `test/guards.test.ts` (new) -- tree kill (POSIX child spawning a grandchild; must fail on today's `killTree`), guard reasons (job guard vs cap), `account` called with transcript counts, `within_budget: false` → `partial` naming the guard, missing transcript named, no call without turn/token guards, transcript parser fixtures (dedupe by `message.id`), sbx argv carrying the in-VM guard, core backstop → `cancel` + queue `partial` naming the guard.
- `test/tick.test.ts` (new) -- `shouldWake` over queue runs (hint elapsed / not, live run skip, no runs wake) and the stopped-job skip.
- `test/queue.test.ts` -- stop-event round-trip and the last-end read.
- `README.md` -- guards and pacer sections, replacing "Story 21.5 fixes its pacing".
- `_bmad-output/implementation-artifacts/deferred-work.md` -- close DW-1; note DW-3's remainder for 21-6.

**Acceptance Criteria (epics.md Story 21.5, verbatim):**
- AC1: Given a run past its `max_wall_clock_seconds`, when the guard trips, then the worker's whole process tree is killed and the run finishes `partial` with the guard named in `reason`.
- AC2: Given a job with `max_turns` or `max_tokens`, when the worker completes an iteration, then `account` is called with the turns and tokens read from the worker's transcript, and a tripped guard ends the run `partial` naming it.
- AC3: Given a self-paced job with `hint_seconds`, when the pacer ticks, then the job is woken only after the hint has elapsed since its last run ended, and never while a run of it is `queued` or `running`.
- AC4: Given a job whose `stop.on_status` matches a run's terminal status, when that run ends, then the job stops recurring and the stop condition is recorded in `events`.

## Spec Change Log

- 2026-09-28T19:32:30Z — trigger: review finding (both layers) "a lock-waited `queued` run is never driven by later ticks" — amended: the intent matrix row "Pacer, live run" now covers `running` and live-owned `queued` runs, plus a new row "Pacer, ownerless queued run", per the consult's DO line (Reading B of AC3) — avoids: an unattended recurring job stalled behind its own ownerless queued run until a manual `drain` — KEEP: the stopped-job skip first; hint gating from the latest `ended` event; no second run ever minted.
- 2026-09-28T19:51:55Z — trigger: follow-up review finding (both layers) "subagent transcripts (`<session_id>/subagents/*.jsonl`) are never counted, so `max_tokens`/`max_turns` under-count a fan-out skill" — amended: the Always "Host transcript" line now includes the sibling `subagents/*.jsonl`, merged by `message.id`, per the consult's DO line (Reading 2 of AC2) — avoids: a budget guard that never trips for a skill whose spend is mostly in subagents — KEEP: the parent `<session_id>.jsonl` still matches exactly once; the counting rule (distinct assistant `message.id`s, four usage fields); sbx stays on the JSON result's `num_turns`/`usage` (main thread only, a residual risk).

## Review Triage Log

### 2026-09-28 — Review pass
- both layers ran (band L): blind-hunter, edge-case-hunter
- intent_gap: 0 (one would-be intent gap, AC3's queued reading, was resolved by consult: Reading B, see Consult Log and Spec Change Log)
- bad_spec: 0
- patch: 8 (high 0, medium 5, low 3)
- defer: 0
- reject: 2 (medium 0, low 2) — a backstop summary forced `partial` though the studio might have raced to another state (the `partial` is only set when our own end verb succeeded, so the studio state is the one we set); no win32 `taskkill` test (untestable on this Linux sandbox; recorded as unverifiable-here)
- addressed_findings:
  - `[medium]` `[patch]` pacer skipped ownerless `queued` runs forever (both layers) — `shouldWake` skips `running`/live-owned `queued`, and drives an ownerless `queued` run through idempotent `runJob` (consult Reading B); `pacing()` gains `adoptable`
  - `[medium]` `[patch]` a later not-woken/refused/orphan run cleared a recorded stop (both layers) — the stop persists until a later run the studio actually ran ends; `ended` detail carries `studio_outcome`
  - `[medium]` `[patch]` an account failure replaced an AD-11 `MISSING_STATUS_BLOCK` / `MAX_LOGIN_MISSING` reason and state (both layers) — reasons appended; an account failure never turns `blocked` into `partial`
  - `[medium]` `[patch]` sbx in-VM `timeout` firing first (exit 124/137, no block) ended `blocked` instead of `partial` naming the guard (edge-case-hunter) — treated as the wall-clock trip
  - `[medium]` `[patch]` detached POSIX groups outlived a SIGINT/SIGTERM/SIGHUP to the supervisor (blind-hunter) — `runProcess` kills its tracked groups on those signals, then re-raises
  - `[low]` `[patch]` `stopped` written outside `ended`'s transaction (both layers) — written inside it via `end`/`endDriven`'s `stop` option
  - `[low]` `[patch]` backstop reason printed `(720)` without `s`; `hasTurnTokenGuard` accepted null — fixed
  - `[low]` `[patch]` no test of `tickJob` through `Queue.pacing` or of `guards_tripped` on a host skill trip's `ended` event — added

### 2026-09-28 — Review pass (follow-up)
- both layers ran (band L): blind-hunter, edge-case-hunter
- intent_gap: 0 (one would-be intent gap — AC3 "a run of it" vs studio runs woken over MCP `tk_job` — resolved by consult: Reading 1, queue-driven runs; routed to defer)
- bad_spec: 0
- patch: 7 (high 1, medium 4, low 2)
- defer: 2 (medium 1, low 1) — the pacer cannot see studio runs started outside the queue (class (a), AC3; recorded as DW-6 in deferred-work.md per the consult's DO line, so not repeated in frontmatter); a `recover`-ended orphan records no `stopped` event (class (a), AC4; frontmatter `deferred`, owned with DW-3 by 21-6)
- reject: 1 (low 1) — a descendant that calls setsid leaves the worker's process group (edge-case-hunter): speculative, no evidence the worker detaches descendants, and the process-group kill is the mechanism the intent pins
- addressed_findings:
  - `[high]` `[patch]` subagent transcripts (`<session_id>/subagents/*.jsonl`) were never counted, so `max_tokens`/`max_turns` under-counted a fan-out skill (both layers) — counted and merged by `message.id` (consult: Reading 2 of AC2; spec Always amended)
  - `[medium]` `[patch]` removing the SIGHUP/SIGINT listener reset an inherited "ignored" disposition, so a `nohup`ed supervisor died on hang-up (blind-hunter) — `signalsToHandle` reads `/proc/self/status` SigIgn once and never handles an inherited-ignored signal; SIGHUP is unhandled where SigIgn is unreadable
  - `[medium]` `[patch]` any sbx exit 137 (e.g. OOM) became a wall-clock trip, losing the AD-11 `MISSING_STATUS_BLOCK` (both layers) — 124/137 count as the trip only when host elapsed ≥ guardS
  - `[medium]` `[patch]` a core backstop trip recorded `studio_outcome: partial` (and a possible false stop) while the studio run was `cancelled` (both layers) — `RunSummary.studio_state`; `mirror` matches `studio_state ?? state`
  - `[medium]` `[patch]` a recorded stop was never re-checked against the current `stop.on_status`, so an edited job stayed stopped (both layers) — `shouldWake` honours the stop only while `on_status` still lists its state
  - `[low]` `[patch]` a backstop trip on an already-terminal studio run lost the guard name (edge-case-hunter) — reason names the guard
  - `[low]` `[patch]` README claimed a host kill ends the sbx worker (blind-hunter) — README states the in-VM `timeout` window and the pacer's blindness to non-queue runs

### 2026-09-28 — Review pass (follow-up 2)
- both layers ran (band L): blind-hunter, edge-case-hunter
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 1, low 0)
- defer: 0
- reject: 3 (medium 1, low 2):
  - DW-3's status text claims SIGINT/SIGTERM/SIGHUP (blind-hunter). It is real, but DW-7 already records the correction, and this run may not rewrite existing ledger entries (the orchestrator owns them).
  - A core backstop's `stopped` event records `partial` when `stop.on_status` lists `cancelled` (edge-case-hunter). This cannot happen: the `job.schema.json` `on_status` enum is `[partial, blocked]`, and `mirror` records no stop for a `cancelled` studio state.
  - `Queue.pacing` does 1 + 2N indexed queries over a (job, checkout)'s whole run history each tick (blind-hunter). This is efficiency, not a named behaviour. The lookups are indexed on `events(run_id)`, and none of deferral classes (a)–(c) applies.
- addressed_findings:
  - `[medium]` `[patch]` Both layers: the sbx 124/137 "in-VM `timeout` fired" rule measured elapsed time from before `invoke`, so it included the auth preflight and the first drift check. An early OOM or SIGKILL in the last preflight seconds of the budget became `partial` naming the guard, instead of the AD-11 `MISSING_STATUS_BLOCK`. Fixed: `invokeSkill` returns `worker_elapsed_s`, timed around `runClaude` only, and `finishRun` uses it, falling back to the injected clock. Three tests were added in `test/guards.test.ts`, and README.md:103 was clarified.

## Design Notes

- "Iteration" = one `claude -p` invocation (a skill run is one invoke today), so `account` runs once per invoke, before `finish`.
- Anticipated DRIFTs (record if taken): in-VM GNU `timeout` in the sbx argv (score 2, affects 21-6); sbx turns/tokens from the JSON result's `usage`/`num_turns`, not the in-VM transcript (score 1, affects none).
- The pacer skips a stopped job instead of letting the studio's `evaluate_stop` refuse it, so no queue run is minted only to end `not-woken`. `run`/`submit` by hand still go through the studio's own refusal.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: no changes
- `bun test` (with `TK_STUDIO_ROOT` set) -- expected: all green
- `bunx tsc --noEmit` -- expected: clean
- `git grep -n -E "(/c/|[A-Z]:\\\\|/home/|/Users/)" -- src test package.json README.md` -- expected: nothing
- `git diff --stat 981df26fd3b4db12232dd41030e1a8cefd0fff4f -- package.json bun.lock` -- expected: empty
- `grep -n "finishArgsFor\|knowledgeOf" src` -- expected: nothing
- the tree-kill test fails against the baseline `killTree` (show by reasoning or a stash run bounded with `timeout -k 5`)

**Manual checks (unverifiable-here, operator):**
- Agent PC (win32): run a skill job with a short `max_wall_clock_seconds`; `Get-Process claude` shows no process from that run, and the worker still had a console session (21-4 AC1).
- First sbx guard trip: `sbx exec claude-<project> ps -eo pid,args` shows no `claude -p` from that run.

## Deviation Summary

### pass 1 (2026-09-28, implementer)

- planned: only the 10 listed files (Block If: halt past 10 or on any unlisted file) / actual: also edited `test/tier.test.ts` (sbx argv assertions and index slices) and `test/command-line.test.ts` (fake sbx accepts the `timeout -k` prefix; fake worker writes a transcript and prints `session_id`/`num_turns`/`usage`; fixture sets `CLAUDE_CONFIG_DIR`) — 12 files / why: the in-VM guard breaks the existing sbx argv assertions, and `studio-health` has `max_turns: 20`, so every e2e run now calls `account` and needs a transcript / may affect: none
- planned: `guardsFor` reports which bound applies / actual: `guardsFor` unchanged; new `wallClockGuard(jobGuardS, guardS)`; `Started`/`TimeoutContext` gain optional `jobGuardS` / why: keeps the pinned `guardsFor` shape / may affect: none
- planned: "Every guard trip ends the run partial" / actual: a skill run caught by the `wake`/`submit` backstop is still finished `blocked` (reason names the guard); only core runs end `partial` / why: Code Map describes skill → `finish blocked`, an existing test pins it, and no worker ran yet / may affect: none
- planned: `account` after `invoke` returns / actual: skipped when `invoke` answers `ran: false` (preflight blocked) / why: no iteration ran, no transcript / may affect: none
- planned: stop event when the queue run ends in a state in `on_status` / actual: written only when the studio reached that terminal state, not when a not-woken run is ended `blocked` / why: a not-woken queue run is not a studio run ending that way; recording it would stop the job permanently / may affect: none
- planned: data shapes as in the spec / actual: `RunSummary` gains `guards_tripped` and `account`; the queue `ended` event detail gains `guards_tripped`; `runProcess` and `mirror` exported / why: guard naming in events; testability / may affect: none
- planned: anticipated DRIFT (in-VM guard) / actual: taken — GNU `timeout -k 10 <guardS>` before `env` in the sbx argv / why: the argv-only way to end the VM worker / may affect: 21-6
- planned: anticipated DRIFT (sbx counts) / actual: taken — sbx turns/tokens from the JSON result's `num_turns`/`usage` / why: the transcript lives inside the microVM / may affect: none

DEVIATION SCORE: 2

DRIFT: two unlisted test files edited (`test/tier.test.ts`, `test/command-line.test.ts`), 12 files — the in-VM guard and the `account` call change what existing tests pin — affects: none
DRIFT: `wallClockGuard` added beside an unchanged `guardsFor`; `Started`/`TimeoutContext` gain `jobGuardS` — keeps the pinned `guardsFor` shape — affects: none
DRIFT: a skill run caught by the wake/submit backstop is finished `blocked` naming the guard, not `partial` — no worker ran; existing pinned behaviour — affects: none
DRIFT: `account` skipped when invoke reports `ran: false` — no iteration ran — affects: none
DRIFT: stop event only when the studio run reached the matching state, not for a not-woken `blocked` — avoids a permanent false stop — affects: none
DRIFT: `RunSummary.guards_tripped`/`account`, `ended` event `guards_tripped`, `runProcess`/`mirror` exported — guard naming and testability — affects: none
DRIFT: in-VM GNU `timeout -k 10 <guardS>` before `env` in the sbx argv — argv-only end of the VM worker — affects: 21-6
DRIFT: sbx turns/tokens from the JSON result's `num_turns`/`usage` — transcript lives inside the microVM — affects: none

### pass 2 (2026-09-28, implementer, applying the consult's DO lines)

- planned: change only the `--state` passed to `finish` in `recoverAfterTimeout` / actual: also widened `src/cli.ts:730` from `trip && target === "core" && endedOk` to `trip && endedOk`, so a skill run's summary carries `state: "partial"`, `guards_tripped` and the `(studio run <state>)` suffix / why: the ruling requires the queue run to end `partial` naming the guard / may affect: none (no test pinned the old text)

DEVIATION SCORE: 1 (implements the consult's DO line 2; same question, not re-consulted)

DRIFT: skill-run wake/submit backstop now `finish`es `partial` naming the guard (consult ruling), and its summary carries `guards_tripped` — AC1 and the Always rule — affects: none

### pass 3 (2026-09-28, implementer, review patches)

- planned: public `Queue.recordStop(runId, detail)` / actual: removed; the `stopped` event is written via an optional `stop` argument to `Queue.end`/`endDriven`, in `ended`'s transaction / why: review patch (no crash window) / may affect: 21-6
- planned: `pacing` = live runs, last end, latest terminal run's stop / actual: adds `adoptable`; `live` = running + live-owned queued; `stopped` = the stop in force across runs; optional `self` owner / why: consult Reading B and stop persistence / may affect: 21-6
- planned: `ended` detail carries `guards_tripped` / actual: also `studio_outcome: {run_id, state}` when the studio's own run reached a terminal state / why: tells stop-clearing runs from not-woken/refused/orphan runs / may affect: 21-6
- planned: account failure → `guard: account failed — <cause>`, `partial` / actual: `<original reason>; guard: …`; an already-`blocked` run stays `blocked` / why: review patch, never drop a named failure (AD-11) / may affect: none
- planned: no process-wide signal handling / actual: `runProcess` installs SIGINT/SIGTERM/SIGHUP handlers on POSIX while tracked children live, SIGKILLs only those groups, re-raises / why: review patch / may affect: 21-6
- planned: `tickJob` private / actual: exported with injectable `TickDeps` / why: testability / may affect: none

DEVIATION SCORE: 2 (consult: accept-deviation score 2)

DRIFT: `stopped` written through `Queue.end`/`endDriven`'s `stop` option in `ended`'s transaction; `recordStop` removed — no crash window between end and stop — affects: 21-6
DRIFT: `Queue.pacing()` returns `live` (running + live-owned queued), `adoptable`, and the stop in force — consult Reading B of AC3 and stop persistence — affects: 21-6
DRIFT: queue `ended` event detail carries `studio_outcome` — a not-woken/refused/orphan run never clears a stop — affects: 21-6
DRIFT: account failure appends `guard: account failed — <cause>` to the original reason; a `blocked` run stays `blocked` — never drop an AD-11 named failure — affects: none
DRIFT: `runProcess` kills its tracked POSIX process groups on SIGINT/SIGTERM/SIGHUP and re-raises — detached groups otherwise outlive a signalled supervisor — affects: 21-6
DRIFT: `tickJob` exported with injectable `TickDeps` — testability — affects: none

### pass 4 (2026-09-28, implementer, follow-up review patches)

- planned: host transcript = the parent `<session_id>.jsonl` / actual: plus `<session_id>/subagents/*.jsonl`, merged by `message.id` / why: consult (Reading 2 of AC2) / may affect: none
- planned: no clock seam in `finishRun` / actual: optional 4th parameter `clockMs` (default `performance.now()`) / why: the sbx elapsed check needs an injectable clock / may affect: none
- planned: `studio_outcome.state` = the summary state / actual: `studio_state ?? state`, recorded only when that state is terminal / why: a core backstop's studio run is `cancelled`, not `partial` / may affect: 21-6
- planned: group kill on SIGINT/SIGTERM/SIGHUP (pass 3) / actual: never for a signal inherited ignored; SIGHUP only where `/proc/self/status` SigIgn is readable (Linux); `signalsToHandle`/`readProcStatus` exported / why: removing a listener resets an ignored signal to its default action / may affect: 21-6
- planned: README three lines / actual: README also documents the subagent counts, the sbx elapsed rule, `studio_state` and the stop re-check / why: keep the section accurate / may affect: none
- planned: DW-3's status is accurate / actual: DW-3's signal clause is now broader than the code; it may not be edited, so DW-7 was appended as its correction (and DW-6 for the pacer's blind spot) / why: operator instruction, the orchestrator owns existing entries / may affect: 21-6

DEVIATION SCORE: 2 (consult: accept-deviation score 2)

DRIFT: host counts include `<session_id>/subagents/*.jsonl` — AC2's "worker's transcript" covers the session tree (consult) — affects: none
DRIFT: `finishRun` gains an optional `clockMs` parameter — the sbx 124/137 trip needs host elapsed ≥ guardS — affects: none
DRIFT: supervisor-signal group kill narrowed: SIGINT/SIGTERM on POSIX; SIGHUP only on Linux and only when not inherited ignored (`signalsToHandle`/`readProcStatus` exported); this qualifies the pass-3 signal DRIFT and DW-3's status text — affects: 21-6
DRIFT: `studio_outcome` and the on_status stop match use `studio_state ?? state`, recorded only when that state is terminal — affects: 21-6
DRIFT: README documents the pass-4 behaviour beyond the three requested lines — accuracy — affects: none

### pass 5 (2026-09-28, implementer, follow-up review 2 patch)
- `invokeSkill` returns `worker_elapsed_s` (the worker's own run time, from the `runClaude` spawn) on a `ran: true` result. `finishRun`'s sbx 124/137 rule reads it, falling back to the injected clock. This is an additive result field, and only the review patch needed it.
- Files: `src/server.ts`, `src/cli.ts`, `test/guards.test.ts`, `README.md` (all in the plan's Files).
- DEVIATION SCORE (pass 5): 0. The frontmatter `deviation_score` stays 2, from pass 4.

## Consult Log

- 2026-09-28T19:26:37Z — trigger: deviation-gt-0 + file-outside-files — question: accept 12 files (two unlisted test files), skill backstop `blocked` vs `partial`, and the remaining pass-1 deviations? — ruling: accept-deviation score 2 — do: (1) keep the edits to `test/tier.test.ts`/`test/command-line.test.ts`, only existing assertions and fixtures, no machine path, record as DRIFT, do not HALT oversize; (2) reject deviation 2: the skill-run wake/submit backstop `finish`es `partial` (not `blocked`) with the guard-named reason, update the 21-1 test pinning `blocked`; core stays `cancel`; (3) accept the other deviations; the in-VM GNU timeout stays a score-2 DRIFT affecting 21-6 — rule candidate: The plan's Files list must include every existing test file its Code Map names as pinning changed behaviour; editing only the assertions of an existing test file the Code Map names does not count toward file-outside-files/oversize.
- 2026-09-28T19:32:30Z — trigger: halt (would-be intent gap) — question: AC3 "never while a run of it is queued": skip any queued run (A), or drive an ownerless queued run through idempotent `runJob` (B)? — ruling: apply — do: take Reading B (skip `running` and live-owned `queued`; an ownerless `queued` only run → wake so `runJob` adopts and drives it, no hint re-gate; stopped skip first); add a tick test "ownerless queued run → driven, nothing new minted"; change the matrix row "Pacer, live run → skip" to cover only running and live-owned queued runs — rule candidate: The pacer's "never while queued/running" means never mint or wake a second run; it drives an ownerless queued run through idempotent runJob, as drain does.
- 2026-09-28T19:41:26Z — trigger: deviation-gt-0 — question: accept the six pass-3 review-patch deviations (recordStop folded into end, pacing shape, studio_outcome, account-failure appending, signal group kill, exported tickJob)? — ruling: accept-deviation score 2 — do: keep all six; record DRIFT lines, 1/2/3/5 affects 21-6, 4/6 affects none; keep one test per seam (verified present: test/queue.test.ts:1048,1063,1089,1101; test/guards.test.ts:382,389); do not touch `Queue.recover` — rule candidate: A review patch reshaping a spec-named queue/process-lifecycle API is a score-2 DRIFT naming the next story, no consult needed, if Queue.recover and contracts are untouched.

- 2026-09-28T19:51:24Z — trigger: high-severity-finding (follow-up review) — question: does AC2's "the worker's transcript" cover only the parent `<session_id>.jsonl` (Reading 1) or also `<session_id>/subagents/*.jsonl` (Reading 2)? — ruling: apply — do: take Reading 2 in `src/transcript.ts`: the parent `<session_id>.jsonl` still matches exactly once, plus every `*.jsonl` directly in the sibling `<session_id>/subagents/`, merged into one map keyed by `message.id` (no double counts), a missing dir counts zero and an unreadable subagent file throws a named `TranscriptError`; add fixture tests (parent + two subagent files summed, no subagents dir, a message id in two files counted once); leave sbx on `resultCounts`; amend the spec's Always transcript line, record a score-1 DRIFT "host counts include `<session_id>/subagents/*.jsonl` — affects: none" and a residual risk "sbx `num_turns`/`usage` cover the main thread only" — rule candidate: A guard's counters cover the worker's whole session tree (parent transcript plus `<session_id>/subagents/*.jsonl`, de-duplicated by `message.id`); a source that sees only the main thread is a recorded residual risk, not a spec contradiction needing a consult.
- 2026-09-28T19:51:24Z — trigger: halt (would-be intent gap, follow-up review) — question: AC3 "never while a run of it is queued or running": only queue-driven runs (Reading 1), or any studio run including MCP `tk_job wake`/`submit` runs (Reading 2)? — ruling: apply — do: take Reading 1 and leave `src/tick.ts`/`test/tick.test.ts` as they are (no `tk_job status` read); add a README "Pacer" line saying studio runs started outside the queue (MCP `tk_job wake`/`submit`, `jobrun.py` by hand) are invisible to the pacer, so a tick may wake a second run while one is live and the hint does not count from its end; open a `deferred-work.md` entry for this residual risk ("route MCP `tk_job wake`/`submit` through the queue, or have the pacer see external studio runs"), `affects: none`; no DRIFT line — rule candidate: When a binding replan names the pacer's data source, the pacer sees only runs in that source; runs started through another path are a documented residual risk with a deferred-work entry, not a halt.
- 2026-09-28T20:00:01Z — trigger: deviation-gt-0 (follow-up review, pass 4) — question: accept the pass-4 review-patch deviations (subagent counts, `finishRun` `clockMs`, `studio_outcome` from `studio_state ?? state` only when terminal, conditional SIGHUP handling + exported `signalsToHandle`/`readProcStatus`, extra README lines, DW-3's now-imprecise signal clause that may not be edited)? — ruling: accept-deviation score 2 — do: keep all seven patches; record 1, 2, 5 as affects: none and 3, 4, 6 in a new "pass 4" Deviation Summary with DEVIATION SCORE: 2; add DRIFT "supervisor-signal group kill narrowed: SIGINT/SIGTERM on POSIX; SIGHUP only on Linux and only when not inherited ignored (`signalsToHandle`/`readProcStatus` exported); this qualifies the pass-3 signal DRIFT and DW-3's status text — affects: 21-6" and DRIFT "`studio_outcome` and the on_status stop match use `studio_state ?? state`, recorded only when that state is terminal — affects: 21-6"; leave DW-3 unedited and append DW-7 "DW-3's signal clause is narrower than stated" (no child kill on SIGHUP when inherited ignored (nohup) or on non-Linux POSIX; 21-6's recorded-pid kill before `recover` releases the lock must cover it), affects: 21-6, status: open — rule candidate: A review patch that narrows or conditions a guarantee already recorded in a DRIFT line or DW status naming the next story is a score-2 DRIFT naming that story, plus an appended DW-n correction when the original DW entry may not be edited; no consult needed.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review of the committed story (4bcd148, bbc7526), and the story still holds:
- **AC1:** a named wall-clock guard with a process-group kill, plus the in-VM `timeout` on sbx.
- **AC2:** `account` runs after each iteration, with counts from the transcript and its subagent transcripts.
- **AC3:** the pacer is driven by the queue.
- **AC4:** the `stopped` event is recorded.

This pass fixed one review finding, found by both layers. On sbx, the rule "exit 124/137 once the guard's time has passed is the wall-clock trip" measured time from before `invoke`, so the auth preflight and the first drift check counted toward the guard. `invokeSkill` now reports `worker_elapsed_s`, timed from the worker's spawn, and `finishRun` uses it. An early OOM or SIGKILL now stays the AD-11 `blocked` `MISSING_STATUS_BLOCK` failure.

**Files changed (this pass):**
- `src/server.ts`: `invokeSkill` times `runClaude` only and returns `worker_elapsed_s`.
- `src/cli.ts`: `finishRun`'s sbx 124/137 rule uses `worker_elapsed_s`, falling back to the injected clock; the comment is updated.
- `test/guards.test.ts`: three tests. Worker time short of the guard with the overall clock past it → `blocked`. Worker time at the guard → `partial` naming it. `invokeSkill` leaves the preflight's time out of `worker_elapsed_s`.
- `README.md`: "on the host" now reads as the worker's own time, from its spawn.

**Review findings:** both layers ran (band L).
- Patches applied: 1 (medium).
- Deferred: 0.
- Rejected: 3.
  - DW-3's too-broad signal text. DW-7 already corrects it, and this run may not edit ledger entries.
  - A `cancelled` stop, which the `on_status` schema rules out.
  - The pacer's per-tick history scan. Its lookups are indexed, and it is efficiency only.
- Consults: 0.
- Follow-up review recommended: **false**. No high finding was patched, and the score is 3×1 + 0 = 3, below 5.

**Verification** (re-run by this session after the patch):
- `bun install --frozen-lockfile`: no changes.
- `bun test` (with `TK_STUDIO_ROOT` set): 339 pass, 0 fail, across 8 files.
- `bunx tsc --noEmit`: clean.
- The machine-path `git grep` over `src`, `test`, `package.json` and `README.md`: nothing.
- `git diff --stat 981df26fd3b4db12232dd41030e1a8cefd0fff4f -- package.json bun.lock`: empty.
- `grep -n "finishArgsFor\|knowledgeOf" src`: nothing.
- The implementer reported that the new `blocked` test fails without the fix.

**unverifiable-here** (operator, agent PC):
- win32: run a skill job with a short `max_wall_clock_seconds`. `Get-Process claude` should show no process left from that run, and the worker should still have had a console session (21-4 AC1).
- First sbx guard trip: afterwards, `sbx exec claude-<project> ps -eo pid,args` should show no `claude -p` from that run.

**Residual risks:**
- On sbx, `num_turns`/`usage` cover only the main thread, not subagents.
- A host kill on sbx ends only `sbx exec`. The VM worker lives on until its in-VM `timeout`.
- The pacer cannot see studio runs started outside the queue (DW-6).
- The supervisor does not kill workers on SIGHUP under `nohup` or on non-Linux POSIX (DW-7, for 21-6). DW-3's own status text still overstates the signal coverage, and DW-7 is its correction.
- A `recover`-ended orphan records no stop (DW-8).
- `Queue.pacing` scans a job's whole run history each tick, so its cost grows with the history.
- The win32 paths are not exercised here (DW-5).

DRIFT: two unlisted test files edited (`test/tier.test.ts`, `test/command-line.test.ts`), 12 files — the in-VM guard and the `account` call change what existing tests pin (consult accepted) — affects: none
DRIFT: `wallClockGuard` added beside an unchanged `guardsFor`; `Started`/`TimeoutContext` gain `jobGuardS` — keeps the pinned `guardsFor` shape — affects: none
DRIFT: skill-run wake/submit backstop `finish`es `partial` naming the guard (consult ruling), summary carries `guards_tripped` — AC1 and the Always rule — affects: none
DRIFT: `account` skipped when invoke reports `ran: false` — no iteration ran — affects: none
DRIFT: `RunSummary.guards_tripped`/`account`, `ended` event `guards_tripped`, `runProcess`/`mirror` exported — guard naming and testability — affects: none
DRIFT: in-VM GNU `timeout -k 10 <guardS>` before `env` in the sbx argv — argv-only end of the VM worker — affects: 21-6
DRIFT: sbx turns/tokens from the JSON result's `num_turns`/`usage` — transcript lives inside the microVM — affects: none
DRIFT: `stopped` written through `Queue.end`/`endDriven`'s `stop` option in `ended`'s transaction; `recordStop` removed — no crash window — affects: 21-6
DRIFT: `Queue.pacing()` returns `live` (running + live-owned queued), `adoptable`, and the stop in force — consult Reading B of AC3 and stop persistence — affects: 21-6
DRIFT: queue `ended` event detail carries `studio_outcome` — a not-woken/refused/orphan run never clears a stop — affects: 21-6
DRIFT: account failure appends `guard: account failed — <cause>` to the original reason; a `blocked` run stays `blocked` — never drop an AD-11 named failure — affects: none
DRIFT: `runProcess` kills its tracked POSIX process groups on SIGINT/SIGTERM/SIGHUP and re-raises — detached groups otherwise outlive a signalled supervisor — affects: 21-6
DRIFT: `tickJob` exported with injectable `TickDeps` — testability — affects: none
DRIFT: host counts include `<session_id>/subagents/*.jsonl` — AC2's "worker's transcript" covers the session tree (consult) — affects: none
DRIFT: `finishRun` gains an optional `clockMs` parameter — the sbx 124/137 trip needs host elapsed ≥ guardS — affects: none
DRIFT: supervisor-signal group kill narrowed: SIGINT/SIGTERM on POSIX; SIGHUP only on Linux and only when not inherited ignored (`signalsToHandle`/`readProcStatus` exported); this qualifies the pass-3 signal DRIFT and DW-3's status text — affects: 21-6
DRIFT: `studio_outcome` and the on_status stop match use `studio_state ?? state`, recorded only when that state is terminal — affects: 21-6
DRIFT: README documents the pass-4 behaviour beyond the three requested lines — accuracy — affects: none

## Reconcile

### 2026-09-28 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT is either `affects: none` or names 21-6, and the 21-6 ones touch the seams 21-6's resume/orphan work builds on: the sbx argv now carries an in-VM `timeout -k 10 <guardS>`; `Queue.end`/`endDriven` take a `stop` option (no `recordStop`); `Queue.pacing()` reads `live`/`adoptable`/the stop in force; the `ended` detail carries `studio_outcome` (`studio_state ?? state`); and `runProcess` group-kills on SIGINT/SIGTERM (SIGHUP only on Linux, not when inherited ignored). None of this changes a 21-6 Given/When/Then: "finishes `partial` naming the guard or `supervisor restart`" and "when its guards leave budget" still hold, and 21-5's `account` counters and named guards are what 21-6 reads. A note in 21-6's `invoke_dev_with` absorbs it, and DW-3/DW-7/DW-8 already name 21-6. Epic 22 (the API's cancel and `/events`, the pacer at logon) relies on nothing that changed.
- Affected: 21-6-a-killed-run-resumes-or-ends-partial-never-lost — "each resumes with `--resume <session-id>` on the same tier … when … its guards leave budget, and otherwise finishes `partial` naming the guard or `supervisor restart`" (the resume must re-apply 21-5's guards: the in-VM sbx `timeout`, `account`, and the `stop`/`studio_outcome` on the `ended` event, which `Queue.recover`'s orphan branch writes neither of today (DW-8))
- Invariant: none (AD-2, AD-10, AD-11, AD-14, AD-15 and contract §4's "guard named in `reason`" hold; no plugin or schema change)
- Gate: Part A adjust-stories; Part B story accepted, planned 21-6-a-killed-run-resumes-or-ends-partial-never-lost
