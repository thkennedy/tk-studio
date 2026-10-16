---
title: 'The Supervisor Holds the Engine and Nothing Else Starts One'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
baseline_commit: '959e8957df2e0235ffb6b38e7fd23e654efee0f7'
baseline_revision: '959e8957df2e0235ffb6b38e7fd23e654efee0f7'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-27/plans/27-2.md'
  - '{project-root}/_bmad-output/specs/spec-epic-27/operator-decisions.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A sbx run that `recover` ends as orphaned never releases its sandbox pin.
    evidence: |-
      No `releasePin` call is on the restart rule's orphan end (src/queue.ts ORPHANED_REASON end); orphaned runs are not closed out (27-1 consult 1 known gap, owned by 27-5). AC1 says the pin is released when the run ends. Class (a): a defect in behaviour AC1 names. Releasing safely needs the orphan close-out 27-5 owns, because the engine may still be live.
    location: >-
      src/queue.ts recover (orphan end); src/sandbox.ts releasePin
    severity: medium
  - summary: >-
      Map `ExternalRunRefused` to `409 ExternalRun` in `postCancel`; today an external-run cancel answers 500 InternalError.
    evidence: |-
      Consult 2 ruling (2026-10-16): `postCancel` maps only `RunTerminal` to 409 and rethrows the rest (src/api.ts:223-228), so the outer catch answers 500 (src/api.ts:389-390). src/api.ts was outside 27-2's Files. README.md:51 marks the 500 as interim. Owner: the first later story whose Files include src/api.ts (27-3 or 27-5). Class (b): an API contract surface left unpinned.
    location: >-
      src/api.ts:223-228
    severity: low
---

<intent-contract>

## Intent

**Problem:** An sbx run's `claude -p` worker runs `launch.py start`, which starts `bmad-loop run` detached inside the microVM. Once the worker's `sbx exec` returns, nothing holds the VM, so the engine dies when the sandbox stops (hole 7). Studio runs started outside the queue (`jobrun.py` by hand, MCP `tk_job`) are invisible to the pacer (DW-6, DW-3).

**Approach:** As the operator, I want the supervisor itself to start, hold, pin and release every engine sandbox, and the queue to be the only way a run starts, so that an engine never dies with a host-side shell and the pacer never overlaps a run it cannot see.

**Acceptance Criteria (authoritative, transcribed verbatim from epics.md Story 27.2):**

- **AC1:** **Given** an sbx-tier run **When** the worker starts **Then** the supervisor runs `sbx run -d --name <sandbox>` to pin the sandbox, holds its own `sbx exec` for the engine's lifetime from the console session (never a Claude desktop-app session), records the in-VM engine pid and the sandbox name on the run, and releases the pin (`sbx stop`) when the run ends and no other run holds the sandbox
- **AC2:** **Given** a cancel or a tripped guard on an sbx run **When** it fires **Then** the engine's process group inside the microVM is killed by name of the recorded pid through `sbx exec` (argv only, no shell), the kill is recorded, and a kill that leaves the pid alive after its wait holds the run as DW-3 specifies
- **AC3:** **Given** `jobrun.py submit|wake` run by hand or through the MCP `tk_job` surface on a project the supervisor serves **When** it would start a run **Then** the supervisor's lock file for the checkout names the queue as the only starter, the hand-started run is recorded as `external` on the next tick with its studio run id, and the pacer counts it as live until it ends (DW-6 closed)
- **AC4:** **Given** the supervisor's test suite **When** it runs **Then** the pin, hold, release, kill-by-pid and external-run detection are pinned with a fake `sbx`, on both hosts

## Boundaries & Constraints

**Always:**
- Operator decisions and the 27-1 reconcile replan are settled; do not consult on them:
  - The pin is released **only at the deferred `ended`** (after the 27.1 close-out), never at launch return. A `paused` run keeps its pin with its worktree and lock (operator-decisions §2).
  - Release runs `sbx stop <sb>` only when no other `queued`/`running`/`paused` or external run records the same sandbox.
  - The engine is probed and killed at the worktree's VM path (`toVmPath(worktree)`). A hand-started run is detected in the checkout (registered root), never in a worktree.
  - The hold is the attended pattern of operator-decisions §6: one `sbx exec` held open for the engine's life keeps the microVM up. It is the supervisor's own child, spawned argv-only via `runProcess` (on win32 not detached, so it stays in the console session).
- Pin (`sbx run -d --name <sb>`) runs in `invokeSkill`'s sbx path **before** the login preflight.
- The engine pid source is `<worktree>/.bmad-loop/runs/<engine id>/engine.pid` (`"<pid> <start>"`), read-only. Fallback: `sbx exec <sb> pgrep -f "bmad-loop run"` matched to the engine run id. If neither names exactly one pid: record `engine pid: unknown`, start no hold, kill nothing, leave 27.1's probe path unchanged. Never guess a pid.
- Kill: `sbx exec <sb> kill -TERM -- -<pid>`, a bounded wait, then `kill -KILL -- -<pid>`; liveness probe `sbx exec <sb> cat /proc/<pid>/stat`, start time compared with `engine.pid`. The kill and its outcome are recorded as an event. A pid still alive after the wait is a new `WorkerKill` outcome that `workerMayRun` refuses, so the run and its lock are `held` (DW-3).
- Kill-by-pid runs in `cancelQueueRun` after `stopEngine` when the engine is still live, and on each existing trip branch (`wallClockGuard`, sbx 124/137, host timer).
- `recoverQueue` respawns the hold for every launched or paused sbx run whose recorded engine pid is still live (start time matched).
- The starter lock file follows the SPEC design note exactly: `<studioHome>/projects/<project key>/starter.lock` (`TK_STUDIO_HOME` or `~/.tk-studio`; key as `projectKey` reads it), JSON `{"starter": "tk-studio-supervisor queue", "checkout": "<checkoutKey(root)>", "since": "<ISO>", "supervisor_pid": <pid>}`, written atomically on every tick and claim for a served project, never in the checkout's tree.
- External detection (each tick): a non-terminal studio run of a served job that no queue run names (`studio_run_id`) is recorded as a queue run with an `external` event carrying its studio run id. It is live in `pacing()`, `runs_one_live` and `shouldWake`, and ends when the studio run is terminal. A new `RunState` follows 27.1's `widenStateCheck` rebuild pattern.
- Every `sbx` call is argv only. New deps are injected like `HygieneDeps`/`WorktreeDeps`.

**Block If:**
- The Files list must grow past the plan's 11 files. HALT `blocked` and record it for `bmad-correct-course`.
- A new guard bounding the engine's own life past the worker would be needed: do not invent it; record a DRIFT instead (plan Risks).
- The story is silent on a choice that observably changes behaviour and no operator decision or plan bullet settles it.

**Never:**
- `bash`, `sh`, `-c` or `-lc` in any `sbx` argv. A pattern kill (`pkill -f`). A guessed pid.
- `sbx stop` at launch return, on `paused`, or while another live run records the sandbox.
- Changes to the studio plugin, `jobrun.py`, the driver contract, `epics.md`, `stories.yaml`, `.bmad-loop/*.toml`, or anything under `supervision/`.
- The lock file in the checkout tree. A machine path in a tracked file. A credential in an event or log.
- Real `sbx`, `gh` or network in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pin | sbx-tier worker starts | `sbx run -d --name <sb>` before the preflight's `sbx exec` | pin fails → run `blocked` naming the pin |
| Hold + record | launch returns, `engine.pid` = `6509 125610.0` | hold `sbx exec <sb> tail --pid=6509 -f /dev/null` spawned; pid, start, sandbox recorded on the run | — |
| Pid unknown | `engine.pid` absent, pgrep 0 or 2 hits | `engine pid: unknown` recorded, no hold | 27.1 path unchanged |
| Release | deferred `ended`, no other run on sandbox | `sbx stop <sb>` called once | — |
| Release, second holder | another running/paused/external run records `<sb>` | no `sbx stop` | — |
| Paused | engine paused | pin, worktree and lock kept, no `sbx stop` | — |
| Kill dies | cancel or trip, pid live | TERM `-pid`, wait, KILL if needed; kill event with outcome | — |
| Kill stays alive | `/proc/<pid>/stat` still matches after wait | run and lock `held` (DW-3) | — |
| Restart | supervisor restarts, launched run, pid live | `recoverQueue` respawns the hold | pid dead/mismatch → no hold |
| Lock file | tick/claim on served project | `starter.lock` JSON written atomically in the store | — |
| External | studio run non-terminal, no queue run names it | queue run + `external` event with studio run id; `pacing`/`shouldWake` see it live | — |
| External ends | that studio run becomes terminal | external queue run ended; not live | — |

</intent-contract>

## Code Map

The plan's Code Map (`plans/27-2.md`) is the investigation; its anchors match HEAD `959e895` (spot-checked). Key points:

- `src/server.ts` -- `buildSbxCommand` :519 (only worker argv builder), `invokeSkill` :1028 (wrap :1057, preflight :1059, `beforeSpawn`/`onSpawn`/`runClaude` :1073-1075): pin goes before :1059. `runProcess` :270 (argv-only; POSIX detached, win32 not). `killTree` :169. `toVmPath` :407. `maxLoginPreflight` :767 and `src/transcript.ts:200-243` are the inline `sbx exec` argv builders to mirror. `sbxBin()` in `src/env.ts`.
- `src/cli.ts` -- `launchedEngine` :896, `mirror` :912 → `queue.markLaunched` (`src/queue.ts:1300`): hold + pid record go here. `cancelQueueRun` :636 (`stopEngine`, `recordedWorker`, `holdLock`, close-out, `queue.end`). `wallClockGuard` :163; trip branches in `finishRun` :1547 (sbx 124/137, host timer). `recoverQueue` :475 (hold respawn; `sweepEngines` at :484/:544/:829 — external detection beside it). `studioRunFinder`/`studioRunOrder` (~:395-405) list studio runs via the contract.
- `src/queue.ts` -- `ADDED_RUN_COLUMNS` :635, `widenStateCheck` :655 (rebuild pattern for a new state), `pacing()` :799, `runs_one_live` index (~:580/:643), `recordedWorker` :868, `killRecordedWorker` :393, `workerMayRun` :417, `WorkerKill.outcome` (~:551), `RecoverReport.held`, `markLaunched` :1300, `handToEngine`, `noteWorkerKill`, `locks`/`claim`/`checkoutKey` :119. `runs.sandbox`/`tier` columns already exist.
- `src/worktree.ts` -- `engineStatus` :476, `sweepEngines` :512, `closeOut` :328: release the pin where the deferred `ended` is written, never on `paused`.
- `src/tick.ts` -- `shouldWake` :136 (no-overlap :147-150), `tickJob` (~:200-214).
- `src/page.ts:160-181` -- store layout (`studioHome(env)`, `projects/<key>/runs/<id>/run.json`, `projectKey(run)`) for the lock file path and external detection.
- `src/server.ts:886-941` -- the `tk_job` MCP handler (a hand starter, unchanged).
- `test/fakes.ts` -- `fakeBin` :33, `fakeGh` :113 (JSONL argv log + answers file — copy for `fakeSbx`), `fakeStudioRoot` :75, `gitRepo` :179.
- `test/command-line.test.ts:420-437` -- e2e inline fake sbx exits 97/98 on unknown verbs; must answer `run -d`, `stop`, `kill`, probes (or use `fakeSbx`).
- Pins to mirror: `test/tier.test.ts:55,186-260`, `test/guards.test.ts:326-351,655-725`, hold cases in `test/resume.test.ts`.

## Tasks & Acceptance

**Execution (the plan's 11 files; anything else is a deviation):**
- `src/sandbox.ts` (new) -- pin, hold (`sbx exec <sb> tail --pid=<pid> -f /dev/null`), release (with the other-holder check), kill-by-pid with wait and `/proc` probe, the `engine.pid` read with the pgrep fallback, and the starter lock file writer. Injected deps.
- `src/server.ts` -- pin before the login preflight in `invokeSkill`'s sbx path.
- `src/queue.ts` -- engine pid/start/hold record; the `external` state/event and its liveness in `pacing()`/`runs_one_live`; a kill outcome that holds (DW-3).
- `src/cli.ts` -- hold after `markLaunched`; kill-by-pid in `cancelQueueRun` and trip branches; hold respawn in `recoverQueue`; external detection and lock-file write per tick/claim.
- `src/worktree.ts` -- release the pin at the deferred `ended`, never for `paused`.
- `src/tick.ts` -- an external run counted live by `shouldWake`.
- `test/sandbox.test.ts` (new) -- every I/O-matrix row; argv carries no shell; lock file content and location.
- `test/fakes.ts` -- `fakeSbx` (argv log + scripted answers for `run -d`, `exec`, `stop`, `kill`, `/proc` probes).
- `test/command-line.test.ts` -- e2e fake sbx answers the new verbs.
- `README.md` -- "Queue, lock and restart rules", "Worktrees and PRs", "Worker tiers", "Guards and the pacer" (DW-6 note), the cancel row, "Environment".
- `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` -- a `## Story 27.2` section proposing `jobrun.py` honouring `starter.lock`, plus runbook §3.8 pin/hold rows.

**Acceptance Criteria:**
- Given the I/O matrix, when `bun test test/sandbox.test.ts` runs, then every row is proven by a named test against `fakeSbx`, and the whole suite is green (Linux here; win32 `unverifiable-here`).

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 5, low 3)
- defer: 2 (high 0, medium 1, low 1)
- reject: 3 (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` P1: a pin leaked when the last holder never pinned (A `pin-kept`, B cancelled before its claim); `releasePin` now releases an outstanding pin per sandbox. Tests at test/sandbox.test.ts:267,286,301.
  - `[medium]` `[patch]` P2: external runs recorded no tier/sandbox, so the external-holder check never matched; `recordExternal` now records the job's placement. The test now uses a produced external run.
  - `[medium]` `[patch]` P3: on the trip path, the DW-3 hold after `engine alive after kill` lapsed at the in-VM deadline; the lock, close-out and release paths now re-probe the recorded pid and stay held while it is alive (`engine-gone` when it is seen gone). Trip and cancel tests.
  - `[medium]` `[patch]` P4: an external run whose studio run vanished stayed live forever; it now ends `partial`, the reason naming it.
  - `[medium]` `[patch]` P5: a cancel of an `external` run called the wrong verb and dropped it from the pacer; it is now refused (`ExternalRunRefused`). The 500 mapping is deferred (consult 2).
  - `[low]` `[patch]` P6: README promised `engine_kill` in cancel `effects`; corrected (an `engine-kill` event).
  - `[low]` `[patch]` P7: the hand-over's `jobrun.py` refusal had no staleness rule; one was added (supervisor_pid alive or `since` < 900 s).
  - `[low]` `[patch]` P8: no test proved the `recoverQueue`/claim wiring of external detection, hold respawn and the starter lock; tests added, each red when its call is deleted.
- deferred: (1) orphan-end pin release, class (a), AC1, owner 27-5; (2) 409 mapping for `ExternalRunRefused`, class (b), consult 2.
- rejected:
  - the cancel kills right after `stop --graceful`: AC2 requires the kill on a cancel, and the kill sends TERM first, with a bounded wait before KILL;
  - a turn/token guard kills the engine: AC2 says "a tripped guard", and turn/token is one; the hold on a dead pid exits at once;
  - the hold is orphaned when the short-lived tick exits: on POSIX the hold is its own detached group and outlives the tick, `respawnHolds` re-establishes it each tick, and the win32 console hold is `unverifiable-here` (operator-decisions §5).

### 2026-10-16 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 4, low 0)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` P9: a pin outstanding on a sandbox leaked when the last holder ended through `endExternal` (`detectExternal`), the drain's queued→blocked refusal, or a `driveResumes` blocked end. Each now calls `releasePin`. Tests: the external last holder; the undrivable resume.
  - `[medium]` `[patch]` P10: any `status` refusal (also for job-definition problems, jobrun.py:361) ended a live external run as vanished. `detectExternal` now lists `status --job-id` without `--run-id`. A refusal changes nothing; the run ends `partial` only when the list no longer carries it. Tests updated and added.
  - `[medium]` `[patch]` P11: a kill whose first probe was unreadable (`start time unreadable`, nothing signalled) was never probed again, so the DW-3 hold lapsed at the in-VM deadline. `engineAliveAfterKill` now re-probes this outcome like `engine alive after kill`. Test added.
  - `[medium]` `[patch]` P12: `killEngine` judged by the leader only, so when the leader died on TERM, group members that ignored TERM survived. It now always sends `kill -KILL -- -<pid>` to the group after TERM. Test added; the old "no KILL" assertion changed.
- rejected:
  - `probeEngine`'s "not found" stderr reads as gone: an `sbx exec` failure naming "not found" is the sandbox missing, and the engine cannot outlive its sandbox;
  - the hold lives only as long as the CLI pass: already rejected in the first pass (POSIX hold detached; `respawnHolds` skips while a recorded hold still runs; win32 `unverifiable-here`, operator-decisions §5);
  - a stale external studio run blocks its job: AC3 counts it live until it ends, and ending a studio run is the studio's verb (the cancel refusal is P5);
  - the wiring test is skipped without `TK_STUDIO_ROOT`: an accepted DRIFT (pass 3, consult 2), and it ran here;
  - holds pile up when the hold's host start time is unreadable: the start time is read on both hosts (Linux `/proc`, win32 `Get-Process`), and a null start comes only from a failed read;
  - the external-end pin leak was reported twice (Blind Hunter, Edge Case Hunter): deduplicated into P9.

### 2026-10-16 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 3, low 1)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` P13: a guard-tripped launch run whose engine ignored TERM and died on KILL waited forever. A KILLed engine's bmad-loop status stays `in-progress`, so `sweepEngines` skipped it and the run, lock and pin were held. `sweepEngines` now treats the run as ended when `killedEngine` (src/worktree.ts) finds a start-matched `killed`/`not running`/`engine-gone` record after the `engineAliveAfterKill` re-probe. The 27.1 close-out, the deferred `finish` with the trip's state and reason, and the pin release then run. Tests: "Trip killed: …", the `unknown`-status pair (consult 4), and the alive-after-kill waits.
  - `[medium]` `[patch]` P14: the engine's tmux agent session (`bmad-loop-<engine id>`) is outside its process group and survived a group KILL, still editing the worktree during close-out. After a KILL reaches a leader that outlived TERM, `killEngine` now sends argv-only `sbx exec <sb> tmux kill-session -t =bmad-loop-<id>`, best effort and recorded in the kill's detail. Nothing is sent without an engine id. Tests: the four "Agent session" cases.
  - `[medium]` `[patch]` P15: an external run whose studio record was unreadable was read as vanished, because `list_runs` drops error entries under a job filter, and it ended `partial` under a live studio run. `detectExternal` now leaves it unchanged while `<studioHome>/projects/<key>/runs/<id>/` exists (`studioRunDir`). Test: "External not listed but its record still in the store…".
  - `[low]` `[patch]` P16: the hand-over's starter-lock staleness text assumed one long-lived supervisor process. It now states the per-pass writers, that a dead `supervisor_pid` is normal, and that rule (b)'s window must exceed the longest pass. The 900 s figure is removed and the window is left to the tk-studio side.
- rejected:
  - an ownerless `queued` run hides a hand start (Blind Hunter and Edge Case Hunter, deduplicated), and jobs with no `jobs` row are never checked: both are the accepted pass-1 deviation "external only for queue-known jobs with no live queue run" (consult 1, affects 27-5), so they are not re-consulted;
  - an external run whose `status` is refused for good never ends: it needs the operator to remove or rename the job definition while a run is going, and restoring the definition clears it;
  - a group whose leader is already gone is never signalled: a group kill on a pid whose start time cannot be checked risks a reused pid, and the agents run in tmux outside the group;
  - another run pins the sandbox between the holder check and `sbx stop`: the window is milliseconds, between a cancel from the API and a drain claim;
  - the second tmux-session report was a duplicate, merged into P14.

## Design Notes

- The hold's argv form (`tail --pid=<pid> -f /dev/null`) keeps the microVM attached exactly as long as the engine pid lives, with no shell.
- The lock file is advisory until tk-studio honours it; AC3 is met by the file plus external detection. The `jobrun.py` side is handed over and `unverifiable-here`.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: success (EPERM on the `/c` mount is environmental; record it, never touch `bun.lock`)
- `bun test` -- expected: all green
- `bun test test/sandbox.test.ts` -- expected: all green
- `bunx tsc --noEmit` -- expected: no errors
- `grep -nE '"(bash|sh|-c|-lc)"' src/sandbox.ts` -- expected: no hits in any `sbx exec` argv

## Deviation Summary

### pass 1 (2026-10-16, implementer)

- planned: pin always runs in `invokeSkill`'s sbx path / actual: pin runs only when the caller passes `InvokeOptions.pin`, which the queue recorder in `finishRun` always does / why: pinning through the `spawner` breaks call-order checks in `test/tier.test.ts` (not among the 11 files) / may affect: 27-3
- planned: `pgrep -f "bmad-loop run"` / actual: `pgrep -a -f "bmad-loop run"`, matched on `--run-id <id>` (or `--project <vm path>` when no id) / why: without `-a` lines cannot be matched to the engine run id / may affect: none
- planned: pid source `.bmad-loop/runs/<engine id>/engine.pid` / actual: on a trip before launch returned (no engine id), the worktree's single `engine.pid` / why: trip branches otherwise have no pid; the worktree belongs to one run / may affect: none
- planned: hold through `runProcess`, unbounded / actual: `HOLD_TIMEOUT_S` ≈ 24.8 days (timer maximum) / why: `runProcess` requires a timeout / may affect: none
- planned: respawn the hold for every launched/paused sbx run with a live pid / actual: also skipped when a recorded hold (host pid + start) still runs / why: `recoverQueue` runs every tick; holds would pile up / may affect: none
- planned: release only at the deferred `ended` / actual: also at the end of a non-launch sbx run that pinned (`mirror`, a cancel that closed out, `endAfterDriveFailure`) / why: AC1 releases when the run ends; those runs have no deferred end / may affect: 27-3
- planned: kill-by-pid on each trip branch / actual: one call after all trip handling in `finishRun`, sbx launch runs only; a survivor sets `hold_lock` / why: one place covers every branch / may affect: none
- planned: external detection beside `sweepEngines`, lock write per tick and claim / actual: both in `recoverQueue` (per tick), lock write also on every claim in `runJob`; not in `drain` / why: smallest set meeting "per tick" / may affect: none
- planned: any non-terminal unnamed studio run becomes external / actual: only for jobs with a `jobs` row and no live queue run on that checkout; an external end does not clear a recorded stop / why: avoids the one-live index conflict and a false hit between `wake` and `setStudioRun` / may affect: 27-5
- planned: deps injected like `HygieneDeps` / actual: a new `sbx?: SandboxDeps` field on `WorktreeDeps` / why: one carrier for cli and sweep / may affect: none
- planned: lock key as `projectKey` reads it / actual: same logic copied into `sandbox.ts` as `projectKeyOf` / why: `page.ts` not among the 11 files / may affect: none
- planned: "Restart" row tested through `recoverQueue` / actual: tested through `respawnHolds` (what `recoverQueue` calls) / why: `recoverQueue` needs `TK_STUDIO_ROOT` and the contract pin / may affect: none
- planned: hand-over proposes `jobrun.py` honouring `starter.lock` / actual: also proposes a `--force-starter` flag and a contract minor bump / why: hand starts need an override / may affect: none

DRIFT: pin gated on `InvokeOptions.pin` (queue recorder always passes it) — `test/tier.test.ts` call order is outside Files — affects: 27-3
DRIFT: pgrep fallback uses `-a` and matches `--run-id`/`--project` — needed to match the engine run id — affects: none
DRIFT: pre-launch trip reads the worktree's single `engine.pid` — trip branches have no engine id yet — affects: none
DRIFT: hold bounded at ~24.8 days — `runProcess` requires a timeout — affects: none
DRIFT: respawn skipped while a recorded hold still runs — recover runs per tick — affects: none
DRIFT: pin also released at the end of a non-launch sbx run — those runs have no deferred end — affects: 27-3
DRIFT: one kill-by-pid call after all trip handling — covers every branch — affects: none
DRIFT: external detection and lock write in `recoverQueue` and claim only — the per-tick path — affects: none
DRIFT: external only for queue-known jobs with no live queue run; external end keeps a recorded stop — index conflict, wake/setStudioRun race — affects: 27-5
DRIFT: `SandboxDeps` carried on `WorktreeDeps` — one carrier — affects: none
DRIFT: `projectKeyOf` duplicates `page.ts` `projectKey` logic — `page.ts` outside Files — affects: none
DRIFT: restart row pinned via `respawnHolds` — recoverQueue needs the studio root — affects: none
DRIFT: hand-over also proposes `--force-starter` and a contract bump — override for hand starts — affects: none

Consult 1 note: any new sbx-path caller of `invokeSkill`, including 27-3's close-out relaunch, must pass `InvokeOptions.pin` through the queue recorder.

### pass 2 (2026-10-16, implementer, applying consult 1)

- planned: add the terminal-state guard at the top of `releasePin` and leave the rest unchanged / actual: also removed the now-unreachable `if (run.state === "paused") return "none";` (its §2 note kept as a comment on the guard) / why: after the guard the state narrows to terminal, and tsc rejects the comparison (TS2367); paused still returns "none" via the guard / may affect: none

DRIFT: dead paused check removed from `releasePin` — made unreachable by consult 1's terminal guard (tsc TS2367); part of applying consult 1, not a new question — affects: none

### pass 3 (2026-10-16, implementer, review patches P1–P8)

- planned: refuse a cancel of an `external` run with a clear reason / actual: `cancelRun` throws `ExternalRunRefused`, which the HTTP API maps to `500 InternalError` with the reason in `detail` (not a 4xx) / why: the mapping lives in `src/api.ts`, outside Files; the README states the answer / may affect: 27-3 (or whoever next touches `api.ts`: map it to 409)
- planned: P3 re-probe in `recordedWorker`, `closeOutBlocker`, `releaseKeptLocks` / actual: also in `claim`'s engine-lock branch and in `releasePin` (an ended run whose engine is alive counts as a holder), plus an `engine-gone` event / why: an engine-kind lock skips `recordedWorker`; the per-sandbox release could otherwise stop the sandbox under that engine / may affect: none
- planned: vanished external run ends consistently with the external-end code / actual: ends `partial` through `endExternal`, reason `external: studio run <id> vanished: …` / why: outcome unknown; the restart rule ends such runs `partial` / may affect: 27-5
- planned: claim lock-write test via `fakeStudioRoot` / actual: in the e2e `run` test (skips without uv and TK_STUDIO_ROOT); the `recoverQueue` wiring test skips without TK_STUDIO_ROOT (both ran here) / why: `runJob` validates through the real studio verbs before it claims / may affect: none

DRIFT: external-run cancel refusal answers HTTP 500 (`ExternalRunRefused`) not 4xx — `src/api.ts` mapping outside Files — affects: 27-3
DRIFT: engine-alive re-probe also in claim's engine-lock branch and `releasePin`, new `engine-gone` event — engine-kind locks skip `recordedWorker` — affects: none
DRIFT: vanished external studio run ends `partial` — outcome unknown, matches the restart rule — affects: 27-5
DRIFT: wiring tests are gated on TK_STUDIO_ROOT/uv (ran here) — runJob needs the real studio verbs — affects: none

### pass 4 (2026-10-16, implementer, follow-up review patches P9–P12)

- planned: tests for P9's external end and (drain refusal or resume end) / actual: external end and `driveResumes` end tested; drain refusal not / why: the plan allowed (b) or (c); (c) is pinned at test/sandbox.test.ts:319-328. The drain refusal is reachable through the e2e fixture at test/command-line.test.ts:1607-1630, so this is left for later, not blocked / may affect: none
- planned: P10 ends the run only on positive absence / actual: an `ok:true` answer with no `runs` array also changes nothing / why: a malformed answer is not proof the run is gone / may affect: none
- planned: thread the sandbox deps like the other call sites / actual: `detectExternal` gained an optional 4th `sandbox` parameter and `driveResumes` an optional 6th; `runJob`'s two `driveResumes` calls pass `runJobVerb, invokeSkill, sbxDeps(opts.worktree)` explicitly (values unchanged) / why: so those ends can release the pin / may affect: none
- planned: make P11's hold apply on the cancel and trip paths / actual: comments only, no code change / why: both decide the hold through `workerMayRun`, which already counts `start time unreadable` as may-run / may affect: none

DRIFT: P9 drain-refusal end untested — the plan allowed either end; reachable via the e2e fixture, left for later — affects: none
DRIFT: P10 also leaves the run unchanged on an `ok:true` answer with no `runs` — a malformed answer is not absence — affects: none
DRIFT: `detectExternal`/`driveResumes` gained optional trailing `sandbox` parameters — the pin release needs the sbx seam — affects: none
DRIFT: P11 needed no cancel/trip code change — `workerMayRun` already holds on `start time unreadable` — affects: none

### pass 5 (2026-10-16, implementer, follow-up review patches P13–P16)

- planned: `sbx exec <sb> tmux kill-session -t bmad-loop-<id>` / actual: `-t =bmad-loop-<id>` / why: bmad-loop's own tmux backend uses the exact-match `=` form, and a bare name can prefix-match another run's session / may affect: none
- planned: P13 treats a killed engine as ended when its status reports running/in-progress / actual: also when the status probe fails (`unknown`), with the same start-matched kill evidence after the `engineAliveAfterKill` re-probe / why: with the kill evidence in hand, a failing probe would otherwise leave the run waiting forever / may affect: none
- planned: the tmux kill uses the run's engine run id / actual: `killRunEngine` and the recorder take an optional engine run id, used when the queue run has none yet; `finishRun` passes the id named in the launch status block / why: at a trip at launch return the queue run has no engine id until `markLaunched` / may affect: none

DRIFT: tmux session kill uses the exact-match `-t =bmad-loop-<id>` — a bare name can prefix-match another run's session — affects: none
DRIFT: a killed engine also counts as ended when its status probe fails (`unknown`) — otherwise the run waits forever — affects: none
DRIFT: `killRunEngine`/recorder take an optional engine run id from the launch status block — the queue run has no engine id before `markLaunched` — affects: none

## Consult Log

- 2026-10-16T04:02:51Z — trigger: deviation-gt-0 — question: accept the 13 pass-1 deviations (seams: pin gated on InvokeOptions.pin; release at non-launch run end; external limited to queue-known jobs)? — ruling: accept-deviation score 2 — do: accept all; add a terminal-state guard at the top of `releasePin` (src/sandbox.ts:104-107) returning "none" unless terminal, pinned by one test/sandbox.test.ts case (non-terminal non-paused pinned run not released); record that new sbx-path `invokeSkill` callers (incl. 27-3) must pass `InvokeOptions.pin` — rule candidate: A pin release must be guarded on the run's terminal state inside the releasing function, and every sbx-tier invokeSkill caller must thread InvokeOptions.pin from the queue recorder.
- 2026-10-16T04:29:20Z — trigger: deviation-gt-0 — question: accept pass-3 deviations, notably the external-cancel refusal answering HTTP 500 because src/api.ts is outside Files? — ruling: accept-deviation score 1 — do: keep `ExternalRunRefused`, no skip answer; record a deferred item "map `ExternalRunRefused` to `409 ExternalRun` in `postCancel` (src/api.ts:223-228)" for the first later story with src/api.ts in Files (27-3 or 27-5), and mark README.md:51's 500 answer as interim; leave src/api.ts untouched — rule candidate: A new refusal error a story adds to a cli.ts verb behind an HTTP route must list src/api.ts in the plan's Files, or be recorded up front as a deferred 4xx-mapping item.
- 2026-10-16T04:47:28Z — trigger: deviation-gt-0 — question: accept the four pass-4 deviations (drain-refusal end untested; malformed status answer changes nothing; optional sandbox params; P11 needed no cancel/trip code)? — ruling: accept-deviation score 1 — do: accept all four as reported and add no drain-refusal test; record #1's why as "the plan allowed (b) or (c); (c) is pinned at test/sandbox.test.ts:319-328. The drain refusal is reachable through the e2e fixture at test/command-line.test.ts:1607-1630, so this is left for later, not blocked" — rule candidate: If a planned test item says "X or Y", covering either one is not a deviation; a deviation calling a path "unreachable by existing fakes" must cite the test files searched, including the gated e2e fixtures in test/command-line.test.ts. (observation recorded)
- 2026-10-16T05:11:47Z — trigger: deviation-gt-0 — question: accept the three pass-5 deviations (exact-match tmux target; P13 also ends on an `unknown` status with start-matched kill evidence; optional engine run id for the tmux kill)? Does #2 close out a live engine? — ruling: accept-deviation score 1 — do: accept deviations 1, 2 and 3 as reported, each scored 1, and record them in the spec's deviation log; make sure a test covers deviation 2 both ways (`unknown` + a start-matched `killed`/`not running` kill is closed out; `unknown` + `engine alive after kill` is held); change no code — rule candidate: A deviation that widens when a run counts as ended scores 1 if it adds no new liveness evidence: it must still pass `engineAliveAfterKill` first and must still need a start-matched `killed`, `not running` or `engine-gone` record. A tmux session kill always uses the exact-match `=name` form. (observation recorded; both tests added at test/sandbox.test.ts:722,752)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** a second follow-up review pass on the done story. The spec arrived `done`, and step-01 routes that to a fresh review. Story 27-2 makes the supervisor own the sbx engine's life:
- it pins the sandbox before the login preflight;
- it holds `sbx exec <sb> tail --pid=<pid> -f /dev/null` for the engine's life and respawns it in `recoverQueue`;
- it records the in-VM engine pid and start time with the sandbox;
- it kills the engine's process group by that recorded pid on a cancel or a trip, holding the run while the engine survives (DW-3);
- it releases the pin when the last holder ends;
- it writes `starter.lock` in the studio store on every tick and claim;
- it records hand-started studio runs as `external`, live for the pacer until they end.

This pass fixed four defects:
- **P13:** a guard-tripped launch run whose engine died on KILL waited forever, because its bmad-loop status stays `in-progress`. The sweep now ends it from the start-matched kill evidence.
- **P14:** the engine's tmux agent session survived a group KILL. It is now ended with `sbx exec <sb> tmux kill-session -t =bmad-loop-<id>`.
- **P15:** an external run whose studio record was unreadable was ended as vanished. It is now kept while the record's directory exists.
- **P16:** the starter-lock hand-over now describes the supervisor's per-pass writers accurately.

**Files changed in this pass** (all within the plan's 11):
- `src/worktree.ts`: `killedEngine`; `sweepEngines` ends a run whose engine was killed (a `running` or `unknown` status, re-probed and start-matched).
- `src/sandbox.ts`: `agentSessionArgv` and the tmux session kill in `killEngine`; an optional engine run id on `killRunEngine`; `studioRunDir`.
- `src/cli.ts`: `studioRunRecorded` guards the vanished end in `detectExternal`; the recorder and `finishRun` pass the launch block's engine run id to the kill.
- `test/fakes.ts`: `fakeSbx` answers `tmux kill-session` and keeps a `sessions` list.
- `test/sandbox.test.ts`: tests for the killed-engine sweep (`in-progress` and `unknown`, both ways), the four agent-session cases, and the record-still-in-store external case. The vanished test gets a temporary `TK_STUDIO_HOME`.
- `README.md`: the Engine kill and External bullets.
- `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md`: the starter-lock staleness text, and the Kill and Hand starts rows.
- The whole story's files are the plan's 11, with `src/sandbox.ts` and `test/sandbox.test.ts` new (see commits 6342ca1 and fadb696).

**Review (this pass):** both layers ran (band L). The diff was handed to the reviewers as a scratchpad file because it is 189 KB.
- 4 patches applied: high 0, medium 3, low 1.
- 0 deferred.
- 6 rejected, one of them a duplicate merged into P14.
- **Follow-up review recommended: true.** The score is 3×3 + 1×1 = 10, which is 5 or more. No finding was high.

**Consult:** one, trigger `deviation-gt-0`, ruling accept-deviation score 1. Its test requirement was met at test/sandbox.test.ts:722,752; see the Consult Log. `deviation_score` stays 2, the story's maximum across passes.

**Verification** (this session re-ran the gate after the patches; the implementer re-ran it after the consult's tests):
- `bun test`: 722 pass, 4 skip, 0 fail. This session's run, before the two consult tests were added, was 720 pass, 4 skip, 0 fail.
- `bun test test/sandbox.test.ts`: 51 pass before the consult tests.
- `bunx tsc --noEmit`: clean.
- `grep -nE '"(bash|sh|-c|-lc)"' src/sandbox.ts`: no hits.
- `bun install --frozen-lockfile`: EPERM linking js-yaml and typescript on the `/c` mount. This is the environment; `bun.lock` is untouched.

**unverifiable-here** (for the operator, unchanged): the real `sbx run -d`/`exec`/`stop`/`kill` and `tmux kill-session` against Docker Sandboxes; the win32 console hold (operator-decisions §5, §6); the win32 `bun test` run; and the tk-studio-side `jobrun.py` honouring `starter.lock`, including the choice of its staleness window.

**Residual risks:**
- A hand start on a job whose queue run is ownerless `queued`, or that has no `jobs` row, is not detected. This is the accepted pass-1 deviation, affects 27-5.
- An external run whose `status` is refused for good stays live until the job definition is restored.
- The drain-refusal pin release (P9 b) still has no direct test.
- The earlier deferrals stand: the orphan-end pin (owned by 27-5) and the 409 for `ExternalRunRefused`.
- The deferred-work ledger was not touched by this pass.

DRIFT: pin gated on `InvokeOptions.pin` (queue recorder always passes it) — `test/tier.test.ts` call order is outside Files — affects: 27-3
DRIFT: pgrep fallback uses `-a` and matches `--run-id`/`--project` — needed to match the engine run id — affects: none
DRIFT: pre-launch trip reads the worktree's single `engine.pid` — trip branches have no engine id yet — affects: none
DRIFT: hold bounded at ~24.8 days — `runProcess` requires a timeout — affects: none
DRIFT: respawn skipped while a recorded hold still runs — recover runs per tick — affects: none
DRIFT: pin also released at the end of a non-launch sbx run — those runs have no deferred end — affects: 27-3
DRIFT: one kill-by-pid call after all trip handling — covers every branch — affects: none
DRIFT: external detection and lock write in `recoverQueue` and claim only — the per-tick path — affects: none
DRIFT: external only for queue-known jobs with no live queue run; external end keeps a recorded stop — index conflict, wake/setStudioRun race — affects: 27-5
DRIFT: `SandboxDeps` carried on `WorktreeDeps` — one carrier — affects: none
DRIFT: `projectKeyOf` duplicates `page.ts` `projectKey` logic — `page.ts` outside Files — affects: none
DRIFT: restart row pinned via `respawnHolds` — recoverQueue needs the studio root — affects: none
DRIFT: hand-over also proposes `--force-starter` and a contract bump — override for hand starts — affects: none
DRIFT: dead paused check removed from `releasePin` — made unreachable by consult 1's terminal guard (tsc TS2367); part of applying consult 1, not a new question — affects: none
DRIFT: external-run cancel refusal answers HTTP 500 (`ExternalRunRefused`) not 4xx — `src/api.ts` mapping outside Files — affects: 27-3
DRIFT: engine-alive re-probe also in claim's engine-lock branch and `releasePin`, new `engine-gone` event — engine-kind locks skip `recordedWorker` — affects: none
DRIFT: vanished external studio run ends `partial` — outcome unknown, matches the restart rule — affects: 27-5
DRIFT: wiring tests are gated on TK_STUDIO_ROOT/uv (ran here) — runJob needs the real studio verbs — affects: none
DRIFT: P9 drain-refusal end untested — the plan allowed either end; reachable via the e2e fixture, left for later — affects: none
DRIFT: P10 also leaves the run unchanged on an `ok:true` answer with no `runs` — a malformed answer is not absence — affects: none
DRIFT: `detectExternal`/`driveResumes` gained optional trailing `sandbox` parameters — the pin release needs the sbx seam — affects: none
DRIFT: P11 needed no cancel/trip code change — `workerMayRun` already holds on `start time unreadable` — affects: none
DRIFT: tmux session kill uses the exact-match `-t =bmad-loop-<id>` — a bare name can prefix-match another run's session — affects: none
DRIFT: a killed engine also counts as ended when its status probe fails (`unknown`) — otherwise the run waits forever — affects: none
DRIFT: `killRunEngine`/recorder take an optional engine run id from the launch status block — the queue run has no engine id before `markLaunched` — affects: none

## Reconcile

### 2026-10-16 — adjust-stories

- Score: 2
- Reasoning: Three DRIFT lines name 27-3. These are: the pin is gated on `InvokeOptions.pin`; the pin is released at a non-launch sbx run's end; and `ExternalRunRefused` answers 500 until a story with `src/api.ts` in its Files maps it. 27-3 relaunches under the same queue run on sbx, and its new resume route puts `src/api.ts` in its Files. Two DRIFT lines and one deferral name 27-5: external detection is limited to queue-known jobs with no live queue run; a vanished external run ends `partial`; and the orphan end does not release its pin, which 27-5's orphan close-out owns. Each of these is absorbable as an `invoke_dev_with` note, and no later Given/When/Then has to change. The 500 is a supervisor README surface marked interim, not a studio contract or schema.
- Affected: 27-3-a-paused-run-whose-story-landed-is-closed-out-by-the-service — "relaunches the epic through `tk-studio-launch` … under the same queue run with a `close-out` event" (an sbx relaunch pins only when `InvokeOptions.pin` is passed, and the non-launch end releases the pin)
- Affected: 27-5-the-plan-follows-the-run-and-the-deferred-work-is-paid — "the cancel ends the studio run it finds on a re-read inside the end transaction, or the next recovery ends it, and no run is left unended" (external detection skips a checkout with a live queue run; an orphan end keeps its pin)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 27-3-a-paused-run-whose-story-landed-is-closed-out-by-the-service
