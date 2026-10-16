# Epic 27: what tk-studio must change (the hand-over)

The engine mounts tk-studio read-only, so this run cannot change it (operator-decisions §4). Each story writes the tk-studio side here, with the proposed text. The attended session applies it in tk-studio as a follow-up PR on the day the supervisor PR opens. Every item is `unverifiable-here`, never a blocker.

## Story 27.1

### Re-plan of tk-studio Story 23.3 (the live acceptance on the-universe-awaits)

Story 23.3 was planned against Story 23.2, which cut a branch in the project checkout. Story 27.1 supersedes 23.2: every supervisor run now works in its own git worktree and ends as a pull request. Proposed replacement for 23.3's acceptance, in tk-studio's canonical plan:

> **Story 23.3: live acceptance on the-universe-awaits, against supervisor Story 27.1.** **Given** the supervisor on the agent PC with `TK_SUPERVISOR_WORK=C:\agent-work`, the engine sandbox mounting `C:\agent-work\worktrees` read-write as `/c/agent-work/worktrees`, and `main` protected on GitHub, **When** a `run-epic` job for the-universe-awaits is submitted with no `base_ref`, **Then** the run resolves `base_ref` to `main` (`base_ref_source: default`), cuts `C:\agent-work\worktrees\the-universe-awaits\<run id>` on `supervisor/run-<run id>` with a relative gitdir, materialises it (`tk install` at the pin, policy and routing copied, `tk activate` clean), launches the engine with `--project` the worktree, writes `launched`, and when the engine ends pushes the branch and opens one PR against `main` whose body carries the launch status block, the engine run id, the landed commits and the metered cost; the `ended` event carries the PR URL; the worktree is removed; the checkout at `C:\GitHub\the-universe-awaits` never changes branch. A pause leaves the run `paused` with a draft PR and the worktree kept.

Checks only the Windows host can run, for the attended session: the win32 worktree path and long-path behaviour; real `gh` against GitHub branch protection (`gh api repos/{owner}/{repo}/branches/main` answering `protected`); the sbx mount showing the worktree inside the microVM, and git working there through the relative gitdir.

### Runbook `kb/agent-pc-setup-runbook.md` §3.8: the worktree rows

Proposed rows for the supervisor section:

| Item | Value |
|---|---|
| `TK_SUPERVISOR_WORK` | Required for every run (no longer only for editor-in-the-loop snapshots). `C:\agent-work`. Worktrees land in `C:\agent-work\worktrees\<project>\<queue run id>`, snapshots in `C:\agent-work\snapshots\…`. |
| Engine sandbox mount | `C:\agent-work\worktrees` read-write, as `/c/agent-work/worktrees` (only that subfolder; snapshots stay host-only). |
| git | 2.48 or later on the host and in the microVM (`git worktree add --relative-paths`). |
| `gh` | Logged in on the host for the supervisor's user (the protection check and each run's PR). `GH_BIN` overrides the binary. |
| Default branches | Protected on GitHub for every project the supervisor runs against with no `base_ref`; an unprotected default branch is refused `blocked`. |
| Clean-up | `git worktree remove` and `git worktree prune` run on the host. A worktree kept by a failed close-out or a paused run is listed by `git worktree list` in the checkout. |

## Story 27.2

### `jobrun.py submit|wake` honours the supervisor's `starter.lock`

The supervisor now writes, on every tick and every claim, a starter lock for each project it serves, in the per-user store (AD-3: working data never in a VCS), never in the checkout's tree:

- path: `<TK_STUDIO_HOME or ~/.tk-studio>/projects/<project key>/starter.lock`, the key the store already uses (`project_id`, else the checkout's basename, safe-named);
- content: `{"starter": "tk-studio-supervisor queue", "checkout": "<the checkout's canonical path, case-folded on Windows>", "since": "<ISO time>", "supervisor_pid": <pid>}`, rewritten atomically (a temp file renamed over it).

Until tk-studio reads it, the file is advisory: the supervisor records a run started by hand as `external` on its next tick and paces around it (DW-6). Proposed tk-studio change, in `plugins/tk-studio/lib/jobrun.py`:

> **`submit` and `wake` refuse a run the supervisor's queue should start.** Before minting, when `<store>/projects/<project key>/starter.lock` exists, names `"starter": "tk-studio-supervisor queue"` and its `checkout` is this project's root (compared canonically, case-insensitively on Windows), the verb answers `{"ok": false, "error": "StarterLocked: tk-studio-supervisor's queue is the only starter on this checkout (since <since>, supervisor pid <pid>) — submit the job to the supervisor (POST /jobs or `bun src/cli.ts submit`)"}` and mints nothing. A `--force-starter` flag (or `TK_STUDIO_IGNORE_STARTER_LOCK=1`) lets the operator start one by hand anyway; the supervisor then records it `external`. The supervisor's own `wake`/`submit` pass the flag (or the variable) once this lands, so a contract minor bump names it (driver contract §4). The MCP `tk_job` surface inherits the refusal because it calls the same verbs.
>
> **A stale lock never refuses.** The lock counts only while (a) its `supervisor_pid` is a live process on this host (`os.kill(pid, 0)` succeeds or raises `PermissionError`; on Windows, `OpenProcess` on the pid succeeds and the process has not exited), or (b) its `since` is recent: less than `STARTER_LOCK_STALE_S` before now (a window the tk-studio side chooses; it must exceed the longest supervisor pass, see below). A lock meeting neither is stale: the verb ignores it, mints as today, and adds `"starter_lock": "stale"` to its answer so the hand start is visible. An unreadable or malformed lock file (bad JSON, a missing `starter`, `checkout` or `supervisor_pid`, an unparsable `since`) is treated as stale, never as a refusal. Rule (b) covers a pid the verb cannot probe, and it carries the lock in practice: the supervisor is not one long-lived process. `start.ps1` runs pacer passes one after another — `bun src/tick.ts`, then `bun src/cli.ts drain`, then a sleep — each pass a separate process that exits when it is done. Each pass rewrites every served project's lock once (its `recover`) and then only the lock of a project it claims a run on; `since` is kept only while the same process rewrites the file, so it restarts with every writing pass, and `supervisor_pid` names the last pass that wrote the file, which has usually already exited. A dead `supervisor_pid` is therefore the normal case, not a sign of a crashed supervisor, and rule (a) rarely holds. A pass that drives a run keeps the pacer until that run ends — a drain (or a tick) driving a host-tier run can stretch it to hours — and no other pass rewrites any lock meanwhile, so a window shorter than the longest pass lets the lock go stale while the supervisor is busy: the rule fails open exactly then. Rule (b)'s window must exceed the longest supervisor pass; its value (or another freshness signal) is the tk-studio side's choice, `unverifiable-here`. Known limit: if a crashed supervisor's pid is reused by another process, its lock counts until that process exits. `--force-starter` is the override for that case.

Driver-contract note for that bump: the supervisor today passes nothing (it relies on detection); the flag is additive and its absence keeps today's behaviour.

### Runbook `kb/agent-pc-setup-runbook.md` §3.8: the pin and hold rows

Proposed rows for the supervisor section:

| Item | Value |
|---|---|
| Sandbox pin | An sbx run starts with `sbx run -d --name <sandbox>` from the supervisor before its login probe; a failed pin ends the run `blocked` naming it. The supervisor is never started from a Claude desktop-app session: it runs in the console (`start.ps1`), and so does every `sbx` call it makes. |
| Engine hold | Once a launch returns, the supervisor holds `sbx exec <sandbox> tail --pid=<engine pid> -f /dev/null` open for the engine's life (the engine pid read from `<worktree>\.bmad-loop\runs\<id>\engine.pid`). This replaces `tools/sbx-engine/launch-epic.sh`'s hand-held `sbx exec … bash -lc '…'`; do not run that script beside a supervisor run on the same sandbox. A supervisor restart respawns the hold (`recover`, every tick). |
| Release | `sbx stop <sandbox>` once the run's engine ended and its close-out ran, only when no other queued/running/paused/external queue run (and no ended run whose engine is still alive after its kill) records the same sandbox. The last run on the sandbox to end stops it while a pin on it is outstanding, even a run that never pinned. A paused run keeps its pin. |
| Kill | A cancel or a tripped guard kills the engine's process group inside the VM by its recorded pid (`sbx exec <sandbox> kill -TERM -- -<pid>`, then `-KILL` to the group, even when its leader went on TERM); an engine still alive afterwards, or one whose first probe could not be read (nothing signalled), keeps the run's lock and pin (DW-3) until a later probe shows its pid gone. When the KILL reached a leader still alive after TERM and the engine run id is known, its agent session is killed too (`sbx exec <sandbox> tmux kill-session -t =bmad-loop-<engine id>`, best effort). Check by hand with `sbx exec <sandbox> cat /proc/<pid>/stat`. |
| Hand starts | `jobrun.py submit|wake` and the MCP `tk_job` surface on a supervised project are recorded `external` on the next tick and paced around until `jobrun status --job-id` lists the studio run terminal, or no longer lists it and its run directory is gone from the store (a `status` refusal, e.g. a job file with problems, keeps it live); prefer `POST /jobs`. |

Checks only the Windows host can run, for the attended session (operator-decisions §5): the real `sbx run -d`/`exec`/`stop` against Docker Sandboxes (including whether `sbx run -d --name` on an already-running sandbox exits 0), the hold from the console session, the kill through `sbx exec`, and the win32 `bun test` run.

## Story 27.3

### Runbook `kb/agent-pc-setup-runbook.md`: replace "When a run pauses"

The supervisor now moves a paused run on itself (the attended recipe of 2026-10-14 retires for supervised runs; hole 9). Proposed replacement for the "When a run pauses" block:

> **When a run pauses** (a supervisor run: the queue run is `paused`, its worktree, lock, pin and draft PR kept). After every engine-end sweep (each tick) the supervisor reads the story the engine paused on (`launch.py status` → `run.paused_story_key`) and its spec in the run's worktree:
>
> - **The story landed** (its spec says `status: done`, paused at the commit gate or on an escalation) **and a verdict is recorded** (`reconcile_verdict` other than `escalate`): nothing to do by hand. The supervisor commits the engine's staged harvest on the run branch (`supervisor: close-out harvest for <story> (run <queue run>, engine <engine run>)`), harvests the story's meter observation to the host ledger (`meter.py harvest`), archives the engine run (`bmad-loop archive`, through `sbx exec`), and launches the epic again under the same queue run (a `close-out` event); the launch skips `done` stories. A failed step is a `close-out-failed` event on the run, retried next tick.
> - **The story landed with no verdict, or `escalate`** (the reconcile gate): an attended step. The supervisor sends one notification and the status page's run card says "awaiting a ruling". Run `.bmad-loop/plugins/studio-pipeline/reconcile.md` in the run's worktree (`<TK_SUPERVISOR_WORK>\worktrees\<project>\<queue run id>`), record the verdict on the spec (and carry any `adjust-stories` notes into the unstarted entries' `invoke_dev_with`); the next tick closes it out as above.
> - **The story did no work** (a missing fact, a render halt): fix the cause in the run's worktree, then `POST /runs/<queue run id>/resume` (bearer only; body `{"restore_patch": "<path relative to the worktree>"}` optional). The supervisor runs `bmad-loop resolve --no-interactive --resume [--restore-patch …]` through `sbx exec` as its own child (the hold) and the run goes `running` (`engine-resume`). A story whose spec is `done` is refused `409 StoryLanded`: the close-out above handles it.
>
> A run started outside the supervisor still follows the old recipe (commit the harvest by hand, `bmad-loop archive <run>`, launch again; or `resume-run.sh`).

### `tools/sbx-engine/resume-run.sh`: header

Proposed header lines replacing "Use it only when … 3. launch the epic again. It skips `done` stories.":

```
# A supervisor run never uses this script: the supervisor resumes a paused run
# whose story did no work through `POST /runs/{id}/resume` (the same
# `bmad-loop resolve --no-interactive --resume`, held by the supervisor), and
# closes out one whose story landed by itself (harvest commit, meter harvest,
# `bmad-loop archive`, relaunch). Use this only for an engine run started by
# hand, when the paused story had no landed work (a missing fact, a render
# halt): a re-drive restarts that story from its baseline.
```

Checks only the Windows host can run, for the attended session (operator-decisions §5): the real `sbx exec <sb> <VM HOME>/.local/bin/bmad-loop archive|resolve` against Docker Sandboxes, the real `meter.py harvest` into the host ledger on win32, `sbx run -d --name` on the already-pinned sandbox at the relaunch (the fake answers 0), and the win32 `bun test` run.

## Story 27.4

### Runbook `kb/agent-pc-setup-runbook.md` §3.8: the host verify row (retires the attended host run before each PR)

The supervisor now runs each project's own verify on the Windows host, in the run's worktree, when an sbx-tier run's engine completes and before its PR opens (holes 11, 12 and 22). The attended "run the suite on the host before each PR" step retires for supervised runs. Proposed replacement for step 5 ("When the run completes, open a PR from `loop/epic-<N>` into `main`."):

> 5. **When the run completes** (a supervisor run): the supervisor runs the project's `verify.host` (its tracked `.tk-studio/config.yaml`, read at the run's base, never from the plugin) on the host in the run's worktree, console-hosted, under the job's wall-clock guard, and records a `host-verify` event (exit, duration, the last lines of output). Green, or no `verify.host` (the event says skipped and why): the PR opens ready as before. Red: the run ends `partial` naming the command and its last lines, the branch is still pushed, and the PR opens as a draft whose `## Host verify` section carries the failures; the notification names them. No attended host run before the PR is needed: fix the failures named on the draft PR instead. A run started outside the supervisor (the hand `launch-epic.sh` path) still needs the host suite run by hand before its PR from `loop/epic-<N>` into `main`.

### Proposed `verify.host` keys (tracked `.tk-studio/config.yaml`)

The value is one command line, split on whitespace with `"…"`/`'…'` grouping and never run through a shell, so no `&&`, pipes, redirection or `cd`. A command whose first token is quoted (a path with spaces) must be wrapped whole in YAML quotes, e.g. `host: '"C:\Program Files\x\bun.exe" test'`: unwrapped, the YAML does not parse and the leg is skipped `config unreadable: …` (the PR then opens ready).

- **the-universe-awaits:**

  ```yaml
  verify:
    host: bash scripts/verify.sh
  ```

- **tk-studio:** the runbook's host gate is two commands in two directories (the lib suite, `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`, and conformance, `cd plugins/tk-studio && uv run contracts/conformance/runner.py run`), which needs a shell as one line (Block-If of Story 27.4: no shell was added). Proposed: a single entry-point script, `tools/verify_host.py`, that runs both in turn with `subprocess.run([...], cwd=...)` (argv only) and exits non-zero when either fails, printing each failure's tail last; then:

  ```yaml
  verify:
    host: uv run python tools/verify_host.py
  ```

The supervisor's own key (`verify.host: bun test`) is set in this repo by Story 27.4.

Checks only the Windows host can run, for the attended session (operator-decisions §5): the console-hosted leg against a real sbx run on the agent PC (the command on win32, `windowsHide`, the tree kill on a tripped guard), and the win32 `bun test` run of `test/hostverify.test.ts` and the Story 27.4 sweep pins. Also on the host, for each project's key:

- **Which `bash` resolves.** With no shell, a bare `bash` (the-universe-awaits' `bash scripts/verify.sh`) is resolved through PATH; on a Windows host with WSL, `C:\Windows\System32\bash.exe` (the WSL launcher) can come before Git Bash, and the script would then run inside Linux and miss the Windows-only defects the leg exists to catch. The operator confirms which `bash` the supervisor's PATH resolves first (`where bash`), or names Git Bash's `bash.exe` explicitly in the key.
- **No `.cmd`/`.bat` shims.** `npm`, `npx`, `pnpm` and the like are `.cmd`/`.bat` shims on Windows and cannot be started without a shell: the key names a real executable (`bun`, `node`, `uv`).

## Story 27.5

### Runbook `kb/agent-pc-setup-runbook.md` §4: the supervisor's events and the certificate rule

Proposed rows for §4 (the supervisor started at logon), naming the event kinds Stories 27.1, 27.3 and 27.5 added or changed on a queue run's `events` (`GET /runs/{id}`, the status page) — 27.2's and 27.4's are not listed here — and the supervisor-scope events:

| Event | When |
|---|---|
| `launched` | (27.1) `tk-studio-launch` returned with an engine started: the run stays `running`, its driver lets go, the checkout lock goes to the engine; carries the status block, the engine run id, the end the close-out writes. |
| `paused` | (27.1) The engine paused: the run is `paused` (not terminal), keeps its worktree, lock and pin; the draft PR's URL rides the event. |
| `materialised` | (27.1) The run's worktree was cut and its untracked runtime materialised (`tk install`, the copied policy/routing/overlay, `tk activate` clean). |
| `closing-out` | (27.1) A late close-out of a terminal run took its lease (a later one with no owner lets it go). |
| `closed_out` | (27.1) A close-out recorded on a run already ended (a late close-out, a raced transition); 27.5: `{pr \| no_changes, closeout, orphaned: true}` for the orphan close-out. |
| `lock-released` | (27.1) A kept lock was freed: an engine lock at a removed worktree, a lock kept for a live driver, a worker that may no longer run. |
| `close-out` | (27.3) The paused-run pass moved a landed run `paused` → `running` to relaunch its epic (`{story_key, verdict, commit, meter, archive}`). |
| `close-out-failed` | (27.3) A close-out step failed (`{story_key, engine_run_id, step, error}`), once per (step, error); the run stays `paused`. |
| `awaiting-ruling` | (27.3) A landed story with no verdict or `escalate`: once per pause, with its notification. |
| `engine-resume` | (27.3) `POST /runs/{id}/resume` moved the run `paused` → `running` (`bmad-loop resolve … --resume`). |
| `hold` | (27.2/27.3) The supervisor's own `sbx exec … tail --pid` (or the resume's child) holding the engine's sandbox open. |
| `plan-status` | (27.5) The plan pull-back: one per story per phase, `{phase: review\|done, pr, owner, directory, story_key, id, ok, previous_status?, error?, blocked?, skipped?, reason?}`. `review` when the PR opens, `done` when it merges, a skip naming why (owner not registered, no plan dir, no plan entity, `pr closed unmerged`, or `gave up after <n> attempts: <reason>` once a transient failure outlasts 24 released leases, e.g. a deleted run branch). Never changes the run's state. |
| `studio-run-ended` | (27.5) A studio run a cancel's end found on its re-read (a driver's late record), or a cancelled run's studio run the next `recover` ended (or found already terminal): `{studio_run_id, late: true, by: cancel\|recover, detail, state}`. The cancel's `ended` detail names `late_studio_run_id`, and `claimed_during_cancel: {pid, host}` when a driver claimed the run inside the window (its lock kept for that driver). |
| `studio-run-end-failed` | (27.5) The recovery's ender failed for a cancelled run's studio run: `{studio_run_id, by: recover, detail, attempt}`, one per failed attempt; the next `recover` tries again, and the attempt reaching 24 also carries `gave_up: true`, after which that run is never tried again. |
| `plan-lease` | (27.5) The plan pull-back's per-phase lease: `{phase, owner}` before the verb is called; `{phase, owner: null, released}` when a transient failure (a failed registry lookup, a failed `git diff` or `git merge-base`, a run-branch or merge-base read that failed for any reason but "does not exist", a `plansync.py status` that timed out, failed to start or answered no JSON before anything was recorded) recorded nothing; `{phase, owner: null, released, settled: true}` once the pass recorded (the phase no longer in progress; `done` is not taken while the run's `review` lease is held by a live process). |
| `finish-refused` | (27.5) `finish` was refused (the studio run already terminal, e.g. a skill that finished its own run): `{error, actual_state}`; the run's reason stays the worker's own. |
| `accounted` | (21.6) The iteration's counts; 27.5: `cost_usd` (the iteration's worker cost; a job with no turn/token guard gets a cost-only `{turns: 0, tokens: 0, message_ids: [], cost_usd}`), and `{cost_usd, engine_run_id, source: "engine"}` for an engine run archived by the paused-run pass. `run.json`'s `total_cost_usd` is the sum across every iteration. |
| `worker` | (21.6) The spawned worker; 27.5: `{pid, guard_s}` only, committed before its start time, which lands after it on the run's `worker_start` column. |
| `cert-renew-requested`, `cert-renewed`, `cert-renew-failed` | (27.5) Supervisor-scope (no run), in the queue's `service_events` table: the certificate rule below. |

Proposed text for the certificate, replacing "restart `start.ps1` on long uptimes":

> **The TLS certificate renews itself.** `serve` checks the Tailscale certificate's `notAfter` at start and hourly. Within 14 days of expiry, while no run is `running` or `external` and no renewal was requested in the last 24 hours, it records `cert-renew-requested` and exits 75; the keeper in `start.ps1` runs the same bounded `tailscale cert` (120 s) and restarts `serve` at once. The next `serve` records `cert-renewed` (a later `notAfter`) or `cert-renew-failed`. A live run postpones the renewal to a later check; within 3 days of expiry it renews even during a live run, naming the runs it overrode. Nothing needs restarting by hand.

Also for §4: the orphan close-out (a run the restart rule ended orphaned is closed out once its engine is confirmed dead, its pin released; a run whose `engine-resume` recorded no resumed engine pid yet, or `engine_pid: "unknown"`, is held, never orphaned), the pacer counting an ended run that keeps its lock, and the worker record landing pid first (the win32 start time read natively through `GetProcessTimes`).

### Register tk-studio on the host

The plan pull-back resolves the supervisor's own runs to tk-studio (this repo's `epics.md` is `status: transcribed`, `source: "thkennedy/tk-studio …"`). Until tk-studio is in the host registry, every supervisor run records `plan-status` `{skipped: true, reason: "owner tk-studio not in the registry"}`. Proposed runbook step: `tk register` (`registry.py`) tk-studio's checkout on the agent PC (`C:\GitHub\tk-studio`, project id `tk-studio`), so its `_bmad-output/planning-artifacts/plan/ST-*.md` entities (ST-093..ST-097 for Epic 27) take `review` and `done` from the supervisor.

Checks only the Windows host can run, for the attended session (operator-decisions §5): the real `plansync.py status` into tk-studio's plan once registered; the win32 `bun test` run and the `GetProcessTimes` read under 50 ms (`test/queue.test.ts`, skipped off win32); the `tailscale cert` renewal and `serve` restart on exit 75, as a dry run on the agent PC.
