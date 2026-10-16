# Replan queue

## 21-3 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): one-shot jobs start via jobrun `submit`, recurring ones via `wake` (the lifted CLI does both); idempotent minting covers both verbs. Timeout recovery adopts only a run started within 2s before the caller began: keep that rule when the queue owns minting.
- Status: closed — applied to the unstarted 21-3 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-4 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): a host-tier bypass request is refused before any run exists (HostBypassRefused, exit 2, reported `blocked`); read this story's "the run ends blocked" as the submission refused `blocked` with no run minted. The worker prompt is the argument after `-p` (no stdin, no shell retry: an injection risk); keep it.
- Status: closed — applied to the unstarted 21-4 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-6 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): resume and orphan handling must respect the lifted CLI's rule that only a run started within 2s before the caller began is adopted after a wake/submit timeout; one-shot runs are minted by `submit`.
- Status: closed — applied to the unstarted 21-6 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-4 — scope: stories — from 21-2-conformance-passes-through-the-supervisor — 2026-09-28

- What changed: the worker command's `deny_profile` seam (see the 21-2 spec's Reconcile section)
- Suggested adjustment: Replan (21-2 reconcile, 2026-09-28): the lifted worker command takes a `deny_profile` input: an absolute path, validated by `validateDenyProfile` (a relative or unreadable profile is `DenyProfileRefused`) and forwarded as `--settings <path>`. The host tier passes the operator's deny-list settings through it unchanged and never widens them.
- Status: closed — applied to the unstarted 21-4 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-4 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: runs are queued (SQLite) and may be driven later by `drain`/the tick; per-run caller options live on the queue run (`runs.permission_mode`); the verb timeout is uncapped; the summary `run_id` is the queue id.
- What no longer holds: "the tier comes from the submission or the supervisor's own per-job config"
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): store the submitted tier on the queue run like `runs.permission_mode` (nullable column, event, explicit ?? stored ?? config ?? host). Re-check it at drive time with the same validator. A caller's host bypass is refused before enqueue, and a stored option that fails its re-check after the claim ends the queue run `blocked`. `finish` (with `total_cost_usd`) gets `studio_run_id`, never the queue id. Build on the exported `startRun`/`finishRun`/`guardsFor`.
- Status: closed — applied to the unstarted 21-4 entry's invoke_dev_with by the 21-3 gate (2026-09-28)

## 21-5 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: the tick runs the restart rule once at start and wakes through the queue-backed `runJob`; a core job runs inside `wake`/`submit` under a supervisor timeout of the job's uncapped guard + 120 s, and `--timeout-cap-s` caps only the skill invocation; DW-3 (a worker outliving a killed supervisor) names 21-5 for the tree kill.
- What no longer holds: "the worker's whole process tree is killed and the run finishes `partial` with the guard named in `reason`" (a core job's guard is today the verb timeout, not a named guard) and "never while a run of it is `queued` or `running`" (the pacer must read the queue)
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): the pacer reads `queued`/`running` from the queue db (`TK_SUPERVISOR_DB`), keeps the tick's start-of-tick recovery, and keeps the counts (`StartError` refused, lock wait/already-running skipped). The wall-clock guard replaces the `wake`/`submit` verb timeout (guard + 120 s) and the capped skill invocation with a named guard that kills the process tree (closes DW-1; with 21-6, DW-3). Record `stop.on_status` in the queue's `events` table. `finishArgsFor`/`knowledgeOf` in tick.ts are unused.
- Status: closed — applied to the unstarted 21-5 entry's invoke_dev_with by the 21-3 gate (2026-09-28)

## 21-6 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: 21-3's restart rule: `Queue.recover({end, find})`; owner = hostname + pid + nonce + start time (Linux /proc, win32 PowerShell); `verb_started` + stored snapshot; restart adoption = the earliest studio run absent from the snapshot and minted at/after `verb_started` (an ambiguous or unreadable lookup ends `partial` `orphaned: supervisor restart; studio run lookup failed: …`); recovery runs on `run`/tick start/`recover`/`drain`, not `submit`; post-claim start errors and `not-woken` end the queue run `blocked`; DW-3 deferred here.
- What no longer holds: the stories.yaml replan note "only a run started within 2s before the caller began is adopted" (consult 10:52:44Z: superseded by the snapshot rule); AC1's "superseding Story 21.3's orphan rule" now supersedes the `verb_started` rule above
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): replace the 2-second sentence with this. A run is adopted after a wake/submit failure or a restart only if it is absent from the pre-verb snapshot (stored at `verb_started`) and minted at or after `verb_started`; the earliest wins, and an ambiguous lookup fails. Resume extends `Queue.recover({end, find})` and its nonce owner identity. The queue run id and `studio_run_id` stay separate. DW-3 is yours: a worker that outlives a killed supervisor must hold the checkout lock, or be killed, before `recover` releases it.
- Status: closed — applied to the unstarted 21-6 entry's invoke_dev_with by the 21-3 gate (2026-09-28), replacing the superseded 2s sentence

## 22-1 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: the queue owns the run id (`q-<job>-<ts>-<hex>`), and the studio's id is `studio_run_id`; `submit`/`drain`/`not-woken` answers carry the queue id; the queue's terminal states include `cancelled`.
- What no longer holds: "it is queued through Story 21.3's validation and the response carries the run id" (read: the queue run id; `GET /runs/{id}` and cancel take it)
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): API run ids are queue run ids. Answers also carry `studio_run_id`. Cancel ends the queue run `cancelled` through a `Queue.end` transition with its event, and the studio run through `jobrun cancel` or launch `stop`. Epic 22 has no manifest yet; apply this when it is transcribed.
- Status: closed — applied to the unstarted 22-1 entry's invoke_dev_with by the attended session when Epic 22 was transcribed (2026-09-28)

## 21-5 — scope: stories — from 21-4-the-worker-runs-on-the-right-tier-and-reports-its-cost — 2026-09-28

- What changed: runs may execute on the sbx tier as `sbx exec <sb> env -u ANTHROPIC_API_KEY -C <vm-root> claude -p …`; the worker process and its session transcript live inside the microVM.
- What no longer holds: "the worker's whole process tree is killed" and "`account` is called with the turns and tokens read from the worker's transcript" (neither is reachable from the host alone on sbx)
- Suggested adjustment: Replan (21-4 reconcile, 2026-09-28): on sbx a host tree kill stops only `sbx exec`; the guard must also end the in-VM worker (e.g. through `sbx exec <sb>`, argv only, no shell), or name the survivor. Read turns/tokens for sbx runs through the VM (or the JSON result's usage); the tier is on the queue run (`runs.tier`, `runs.sandbox`).
- Status: closed — applied to the unstarted 21-5 entry's invoke_dev_with by the 21-4 gate (2026-09-28)

## 21-6 — scope: stories — from 21-4-the-worker-runs-on-the-right-tier-and-reports-its-cost — 2026-09-28

- What changed: the queue run stores the resolved `tier`, `sandbox`, `model`, `effort`; the sbx VM root comes from `validate()`'s `registryRoot` via `Started.registryRoot` → `invokeSkill(…, {vmHostRoot})`, and falls back silently to the caller root when absent.
- What no longer holds: "each resumes with `--resume <session-id>` on the same tier and branch" (same tier needs the stored options and the registry root, not only the queue row)
- Suggested adjustment: Replan (21-4 reconcile, 2026-09-28): resume re-drives with the queue run's stored tier/sandbox/model/effort, rebuilds `Started` through `validate()` so `registryRoot` (the sbx VM root) is never the caller-root fallback, and looks for an sbx run's transcript inside the microVM.
- Status: closed — applied to the unstarted 21-6 entry's invoke_dev_with by the 21-4 gate (2026-09-28)

## 22-1 — scope: stories — from 21-4-the-worker-runs-on-the-right-tier-and-reports-its-cost — 2026-09-28

- What changed: `submit` takes `--tier`, `--sandbox`, `--model`, `--effort`, `--permission-mode`, resolves them (submission ?? `TK_SUPERVISOR_CONFIG` ?? `host`) and refuses before enqueue (`HostBypassRefused`, `TierRefused`, `SbxSandboxMissing`, `SupervisorConfigInvalid`, `VmPathUnderivable`, exit 2).
- What no longer holds: "`POST /jobs` … with optional `base_ref`, `tier`, `model`, and `effort` … queued through Story 21.3's validation" (read: through 21.4's resolution too)
- Suggested adjustment: Replan (21-4 reconcile, 2026-09-28): `POST /jobs` calls the same submit path (`submitJob` resolution, then `enqueue`); each named refusal maps to 400 with its name, and no run is queued. Keep the registry root from `validate()` on any drive. Epic 22 has no manifest yet; apply this when it is transcribed.
- Status: closed — applied to the unstarted 22-1 entry's invoke_dev_with by the attended session when Epic 22 was transcribed (2026-09-28)

## 21-6 — scope: stories — from 21-5-guards-and-the-pacer-are-the-wrappers-job — 2026-09-28

- What changed: named wall-clock guards (`wallClockGuard`, the in-VM `timeout -k 10 <guardS>` before `env` in the sbx argv); `account` after each iteration (host transcript plus `<session_id>/subagents/*.jsonl`, sbx from the result's `num_turns`/`usage`); the `stopped` event is written through `Queue.end`/`endDriven`'s `stop` option inside `ended`'s transaction; `ended` carries `studio_outcome` (`studio_state ?? state`, terminal only) and `guards_tripped`; `Queue.pacing()` returns `live`/`adoptable`/the stop in force; `runProcess` kills its POSIX process groups on SIGINT/SIGTERM (SIGHUP only on Linux, never when inherited ignored).
- What no longer holds: "each resumes … when its session transcript exists and its guards leave budget, and otherwise finishes `partial` naming the guard or `supervisor restart`" (not wrong, but "its guards" now means 21-5's named guards and `account` counters, and a restart-ended run must carry 21-5's `ended` detail)
- Suggested adjustment: Replan (21-5 reconcile, 2026-09-28): a resume drives through 21-5's guards: the remaining wall-clock budget through `wallClockGuard` (and on sbx the in-VM `timeout` in `buildSbxCommand`), `account` after the resumed iteration, and a trip ends `partial` naming the guard. Every end `recover` writes goes through `Queue.end`'s `stop` option with `studio_outcome`, so a restart-ended run matching `stop.on_status` records `stopped` (closes DW-8). DW-3's kill of the recorded worker pid/process group before `recover` releases the lock must also cover what `runProcess`'s signal handling misses (DW-7: SIGHUP under `nohup` or on non-Linux POSIX, SIGKILL, a crash). Keep `Queue.pacing()`'s `live`/`adoptable` view true for a resumed run.
- Status: closed — applied to the unstarted 21-6 entry's invoke_dev_with by the 21-5 gate (2026-09-28)

## 22-1 — scope: stories — from 21-6-a-killed-run-resumes-or-ends-partial-never-lost — 2026-09-28

- What changed: the queue's events and run states grew. New events: `accounted`, `woke`, `session`, `worker`, `recovering`, `lock-released`. `RecoverReport` has `resumed[]`, `held[]`, `released[]` and `ended[].state`. A run can be `held` (kept with its lock while its recorded worker may still run), and an ended run can keep its checkout lock until the in-VM deadline (`hold_lock`).
- What no longer holds: "each answers from the queue; cancel ends the run `cancelled`" (read: serve every event kind as stored, never a fixed list; a cancel of a run whose worker may still run must kill or wait for that worker before the lock is freed)
- Suggested adjustment: Replan (21-6 reconcile, 2026-09-28): `/events` and `/runs/{id}` pass event kinds and details through as stored. A `POST /jobs` on a checkout whose lock an ended run still keeps waits in `queued` naming that holder. Cancel goes through `Queue.end` and the recorded-worker rule (`Queue.recordedWorker`, the in-VM deadline on sbx), never a bare lock release. A silent exit ends `partial` with `MISSING_STATUS_BLOCK; <cause>`.
- Status: closed — applied to the unstarted 22-1 entry's invoke_dev_with by the attended session when Epic 22 was transcribed (2026-09-28)

## 22-2 — scope: stories — from 21-6-a-killed-run-resumes-or-ends-partial-never-lost — 2026-09-28

- What changed: runs can be resumed (one queue run, more than one worker iteration), held, or ended with a kept lock; `total_cost_usd` is summed across the original and the resumed iterations.
- What no longer holds: "it shows the queue (jobs, and runs with state, reason, and cost)" (read: also the held runs and kept locks with their holder, and the resume count)
- Suggested adjustment: Replan (21-6 reconcile, 2026-09-28): show `held` runs and ended runs that keep a lock, each with the lock holder and the deadline. Show a run's resume count and its summed cost. Reasons can be long (`orphaned: supervisor restart; guard: …`): wrap them, never cut them.
- Status: closed — applied to the unstarted 22-2 entry's invoke_dev_with by the attended session when Epic 22 was transcribed (2026-09-28)

## 22-3 — scope: stories — from 21-6-a-killed-run-resumes-or-ends-partial-never-lost — 2026-09-28

- What changed: resume driving lives in `cli.ts` (`recoverWithResume`/`driveResumes`); `Queue.recover` only takes runs over. Transcript restore reads the folder named by `TK_SUPERVISOR_TRANSCRIPT_BACKUP`. Two host checks of 21-6 were not run: kill the supervisor mid-run and restart it; delete a session's transcript and force a resume from the backup.
- What no longer holds: "starts the API and the pacer" (read: and runs the CLI's resume-driving recovery once at start, before the pacer's first tick)
- Suggested adjustment: Replan (21-6 reconcile, 2026-09-28): `start.ps1` sets `TK_SUPERVISOR_TRANSCRIPT_BACKUP` to the nightly backup's `claude-projects` folder and starts the supervisor through the path that calls `recoverWithResume`. This story owns DW-5 and DW-10: enable the e2e suites on win32 and make them green on the Windows host, including the kill-and-restart and backup-restore cases.
- Status: closed — applied to the unstarted 22-3 entry's invoke_dev_with by the attended session when Epic 22 was transcribed (2026-09-28)

## 22-2-a-read-only-status-page — scope: stories — from 22-1-the-api-answers-on-the-tailnet-only — 2026-09-28

- What changed: held checkout locks are listed by `Queue.locks()` (the exported `LockRow`). A run ended by an API cancel with no recorded worker keeps its lock for its live driver (`Queue.end`'s `driverLive`), with no deadline, until that driver frees it with a `lock-released` event. New event kinds: `worker-kill` and `lock-released`.
- What no longer holds: "show `held` runs and ended runs that keep a lock, each with the lock holder and the deadline"
- Suggested adjustment: Replan (22-1 reconcile, 2026-09-28): read kept locks through `Queue.locks()`/`LockRow` and the holder as `/status` names it; never query the locks table beside them. Show a deadline only where one exists (an sbx worker's in-VM deadline); a lock kept for a live driver shows its holder and "kept for its live driver". Render the `worker-kill` and `lock-released` kinds as stored, like any other kind.
- Status: closed — applied to the unstarted 22-2 entry's invoke_dev_with by the 22-1 gate (2026-09-28)

## 22-4 — scope: stories — from 22-3-the-supervisor-starts-itself-at-logon — 2026-09-29

- What changed: `start.ps1` runs env import (User scope, then process), a same-console `-ServeOnly` keeper that restarts `serve` with back-off (5 s doubling to 600 s, reset after 60 s up), a 30 s-bounded `sbx ls` probe (then `sbx daemon start -d` from `$HOME`), one `recover` pass, then the pacer (tick, drain, sleep `-IntervalSeconds`, default 60, 5–86400); only a missing `TK_SUPERVISOR_BIND`/`TK_SUPERVISOR_TOKEN` or no `bun` ends the script. Snapshots are `robocopy <root> <target> /E /R:3 /W:5` under `<TK_SUPERVISOR_WORK>/snapshots/<project id>/<queue run id>/`. End hygiene is a lease (at-least-once across crashes); a cancel sweeps only its own run.
- What no longer holds: nothing in 22-4's criteria; "the environment variables (bind address, token, database path, notification target)" must be read as the full as-built set (operator-decisions §1 plus `TK_SUPERVISOR_WORK`, `TK_SUPERVISOR_TRANSCRIPT_BACKUP`, `SBX_BIN`).
- Suggested adjustment: Replan (22-3 reconcile, 2026-09-29): describe `start.ps1` in its run order (env, keeper, sbx probe, recover, pacer) and `-IntervalSeconds`; `SBX_BIN` must name an executable, not a `.ps1` wrapper; tick/drain output reaches the console through `Out-Host`; snapshot argv `/E /R:3 /W:5`, and a work folder equal to or inside the project root is refused with `SnapshotFailed`; named errors `NotifierConfigMissing`, `NotifierUnknown`, `WorkDirMissing`, `SnapshotFailed` and the hygiene event kinds as §8 failure-mode rows; a notification may repeat once after a crash (lease). 22-4 has no entry in this manifest (built in tk-studio kb); apply when it is planned there.
- Status: open

## 22-4 — scope: stories — from 22-5-sign-in-from-the-phone — 2026-10-07

- What changed: `serve` now requires `TK_SUPERVISOR_SESSION_SECRET` (at least 32 bytes), and `start.ps1` lists it as required. There are new optional groups (`TK_SUPERVISOR_TLS_{CERT,KEY,NAME}` and `TK_SUPERVISOR_OAUTH_{GOOGLE,GITHUB}_{CLIENT_ID,CLIENT_SECRET,ALLOW}`), each all-or-none. `start.ps1` runs `tailscale cert` once in its main script, bounded at 120 s, with warnings only, and never under `-ServeOnly`. With TLS set, `Bun.serve` serves `https://<TLS_NAME>:<port>` on the unchanged bind. There are new named start errors: `SessionSecretMissing`, `SessionSecretWeak`, `TlsConfigIncomplete`, `TlsCertUnreadable`, `OAuthConfigIncomplete`, `OAuthAllowInvalid` and `OAuthNeedsHttps`. The token form refuses over http.
- What no longer holds: nothing in 22-4's criteria. "the environment variables (bind address, token, database path, notification target)" and "the smoke test from another device" must be read as the as-built set and the https smoke.
- Suggested adjustment: Replan (22-5 reconcile, 2026-10-07): write runbook §4.5 with the operator's two steps (enable Tailscale HTTPS certificates once; register the Google and GitHub OAuth apps with `https://<TLS_NAME>:<port>/auth/{google,github}/callback`), the variables above, and the https smoke. Add the named start errors as §8 rows. State that the certificate renews only when `start.ps1` starts (a deferral: restart it on long uptimes) and that there is no sign-out (rotate the session secret to revoke). 22-4 has no entry in this manifest; apply this when it is planned there.
- Status: open

## 27-2-the-supervisor-holds-the-engine-and-nothing-else-starts-one — scope: stories — from 27-1-every-run-gets-its-own-worktree-and-ends-in-a-pr — 2026-10-16

- What changed: a launch run's `ended` is deferred to the engine-end sweep (`sweepEngines`, src/worktree.ts) after the close-out; a `paused` run keeps its worktree and the checkout lock; the engine lock's `root` is the worktree (`handToEngine`/`engineRoot`, key `checkoutKey(root)` unchanged); `releaseEngineLock` and `keepEngine` decide when the lock is let go.
- What no longer holds: "releases the pin (`sbx stop`) when the run ends and no other run holds the sandbox"
- Suggested adjustment: Replan (27-1 reconcile, 2026-10-16): release the pin at the deferred `ended` (after the close-out), never at launch return; a `paused` run keeps its pin with its worktree and lock (operator-decisions §2). The engine is probed and killed at the worktree's VM path (`toVmPath(worktree)`); a hand-started run is detected in the checkout, never in a worktree.
- Status: closed — applied to the unstarted 27-2 entry's invoke_dev_with by the 27-1 gate (2026-10-16)

## 27-3-a-paused-run-whose-story-landed-is-closed-out-by-the-service — scope: stories — from 27-1-every-run-gets-its-own-worktree-and-ends-in-a-pr — 2026-10-16

- What changed: `paused` is a `RunState` (runs-table rebuild, counted live by `runs_one_live` and enqueue idempotency); a pause pushes the branch and opens a draft PR whose URL is on the `paused` event; cancelling a paused run reuses that draft and runs `gh pr ready`; `closeOut` adopts an open PR for the run branch (`gh pr list --head`); 27.1 added the kinds `closing-out` (a lease) and `closed_out` (a result).
- What no longer holds: "relaunches the epic through `tk-studio-launch` … under the same queue run with a `close-out` event"
- Suggested adjustment: Replan (27-1 reconcile, 2026-10-16): close out a `paused` run in its kept worktree on its `supervisor/run-<id>` branch and reuse its draft PR (never a second `gh pr create`). Name 27-3's event `close-out` distinct from 27.1's `closing-out`/`closed_out`, and leave the PR close-out lease alone. The queue state after the relaunch comes from the engine, not from `launched.detail.end`.
- Status: closed — applied to the unstarted 27-3 entry's invoke_dev_with by the 27-1 gate (2026-10-16)

## 27-4-a-host-tier-verify-leg-runs-before-any-pr-opens — scope: stories — from 27-1-every-run-gets-its-own-worktree-and-ends-in-a-pr — 2026-10-16

- What changed: the PR opens inside `closeOut` (src/worktree.ts), reached from `sweepEngines`, `mirror`, the cancel path and the drive-failure end. The run's end state and the deferred `finish` state are the ones mirrored at launch return (`launched.detail.end`, D9), not derived from the engine's outcome.
- What no longer holds: "after the engine completes and before the PR opens" (there is more than one path to the PR)
- Suggested adjustment: Replan (27-1 reconcile, 2026-10-16): run the host verify inside `closeOut` before push/PR on every path that has an engine that completed, so no path opens a PR unverified. A red verify overrides `launched.detail.end` (`partial` naming the command) for both `ended` and the deferred `jobrun finish`, and the PR opens with `--draft`. This also carries operator-decisions §2's final `finish` status (`ok` only when every story landed and the verify is green).
- Status: closed — applied to the unstarted 27-4 entry's invoke_dev_with by the 27-1 gate (2026-10-16)

## 27-5-the-plan-follows-the-run-and-the-deferred-work-is-paid — scope: stories — from 27-1-every-run-gets-its-own-worktree-and-ends-in-a-pr — 2026-10-16

- What changed: new event kinds `launched`, `paused`, `materialised`, `closing-out` (lease, plus an ownerless release detail), `closed_out` (`raced`/`pending`) and a late close-out `lock-released`; `ended` is written once, after the close-out, with `detail.pr`/`no_changes`; `recover` skips runs carrying `launched`; the deferred `finish` passes `--status-block` with the PR URL in its artifacts. Known gap (consult 1): a run `recover` ends as an orphan before `markLaunched` is not closed out and keeps its worktree.
- What no longer holds: "the next recovery ends it, and no run is left unended" (an orphan with a worktree ends but is never closed out), and "runbook §4 names the new events"
- Suggested adjustment: Replan (27-1 reconcile, 2026-10-16): key the plan pull-back on `ended.detail.pr` (a late PR is only on the appended `closed_out` event). In recovery, close out a worktree run `recover` ends as an orphan once its processes are confirmed dead, through `closeOut`. List 27.1's event kinds in runbook §4. A refused deferred `finish` (DW-23) keeps the worker's reason.
- Status: closed — applied to the unstarted 27-5 entry's invoke_dev_with by the 27-1 gate (2026-10-16)

## 27-3-a-paused-run-whose-story-landed-is-closed-out-by-the-service — scope: stories — from 27-2-the-supervisor-holds-the-engine-and-nothing-else-starts-one — 2026-10-16

- What changed: an sbx `invokeSkill` pins only when the caller passes `InvokeOptions.pin`, which the queue recorder (`finishRun`) does (consult 1). `releasePin` (src/sandbox.ts) runs only on a terminal run, and also at the end of a non-launch sbx run that pinned. The hold, the engine pid and its start time are recorded at `markLaunched`, and `respawnHolds` re-establishes the hold. A cancel of an `external` run throws `ExternalRunRefused`, which the API answers `500` (interim, DW-26).
- What no longer holds: "relaunches the epic through `tk-studio-launch` … under the same queue run with a `close-out` event" (an sbx relaunch neither pins nor holds on its own)
- Suggested adjustment: Replan (27-2 reconcile, 2026-10-16): drive the sbx relaunch through the queue recorder with `InvokeOptions.pin` (the paused run's pin is still up, so the pin is idempotent). Record the new engine's pid and hold through the `markLaunched` path. Never call `releasePin` between the harvest, the archive and the relaunch; it runs only at the final `ended`. The resume route puts `src/api.ts` in Files, so map `ExternalRunRefused` to `409 ExternalRun` in `postCancel` (DW-26), and refuse a resume of an `external` run the same way.
- Status: closed — applied to the unstarted 27-3 entry's invoke_dev_with by the 27-2 gate (2026-10-16)

## 27-5-the-plan-follows-the-run-and-the-deferred-work-is-paid — scope: stories — from 27-2-the-supervisor-holds-the-engine-and-nothing-else-starts-one — 2026-10-16

- What changed: `external` is a `RunState`, recorded by `detectExternal` (src/cli.ts, in `recoverQueue`) only for a job with a `jobs` row and no live queue run on that checkout. An external run ends through `endExternal`, and ends `partial` (`external: studio run <id> vanished: …`) when its studio run leaves the list. A run `recover` ends as an orphan does not release its sandbox pin (DW-25, 27-2 deferred item 1, class (a), AC1).
- What no longer holds: "the next recovery ends it, and no run is left unended" (an orphan end leaves its sandbox pinned; a hand start beside a live or ownerless queued run is not detected)
- Suggested adjustment: Replan (27-2 reconcile, 2026-10-16): in the orphan close-out, call `releasePin` (src/sandbox.ts; closes DW-25) once the engine is confirmed dead. Handle DW-13's late studio-run record on the queue run itself (re-read in the end transaction); external detection deliberately skips a checkout with a live queue run. Skip `external` runs in the plan pull-back, since they open no PR. If 27-3 did not map `ExternalRunRefused` to `409 ExternalRun` (DW-26), map it here.
- Status: closed — applied to the unstarted 27-5 entry's invoke_dev_with by the 27-2 gate (2026-10-16)

## 27-4-a-host-tier-verify-leg-runs-before-any-pr-opens — scope: stories — from 27-3-a-paused-run-whose-story-landed-is-closed-out-by-the-service — 2026-10-16

- What changed: a close-out relaunch (`close-out` event, new engine id under the same queue run) and a resume (`engine-resume`, then a synthetic `launched` with `resumed: true` and the same engine id) end through `sweepEngines` with the state from `engineEndState` (src/worktree.ts: `finished` → complete, else partial), except a killed engine, which keeps its `launched.end`; the relaunch reuses the draft PR opened on `paused`.
- What no longer holds: "A red verify overrides `launched.detail.end` (`partial` naming the command) for both `ended` and the deferred `jobrun finish`"
- Suggested adjustment: Replan (27-3 reconcile, 2026-10-16): a red verify overrides whichever end the sweep computed (`launched.detail.end`, or `engineEndState` for a relaunched/resumed run). Run the verify once, at the engine completion that reaches `closeOut`, never per `launched` event and never on a `paused` stop (the paused draft PR stays a draft); never read a `launched` event as "tk-studio-launch returned" (consult 1).
- Status: closed — applied to the unstarted 27-4 entry's invoke_dev_with by the 27-3 gate (2026-10-16)

## 27-5-the-plan-follows-the-run-and-the-deferred-work-is-paid — scope: stories — from 27-3-a-paused-run-whose-story-landed-is-closed-out-by-the-service — 2026-10-16

- What changed: one queue run may now span several engine iterations (close-out relaunches with new engine ids; resumes with the same id); `recover`/`awaitingEngine` read "launched" as a `launched` event after the latest `close-out`/`engine-resume`; new event kinds `close-out`, `close-out-failed`, `awaiting-ruling`, `engine-resume`, `hold`; `ExternalRunRefused` → `409 ExternalRun` is mapped (DW-26 closed by 27-3); DW-28 and DW-29 deferred.
- What no longer holds: "the next recovery ends it, and no run is left unended" as planned against "`recover` skips runs carrying `launched`"; "`total_cost_usd` is the sum across every iteration" (iterations now include relaunches and resumes)
- Suggested adjustment: Replan (27-3 reconcile, 2026-10-16): the orphan close-out uses the "launched after the latest `close-out`/`engine-resume`" reading and must confirm a resumed engine dead before closing it out (DW-29). Sum cost per `accounted` event across relaunched and resumed iterations; never count `launched` events as iterations (consult 1). The pull-back reads every story spec marked done in the worktree, which spans relaunches. List 27-3's event kinds in runbook §4. Drop the DW-26 conditional: 27-3 mapped it.
- Status: closed — applied to the unstarted 27-5 entry's invoke_dev_with by the 27-3 gate (2026-10-16), replacing the DW-26 conditional
