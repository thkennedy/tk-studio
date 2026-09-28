# tk-studio-supervisor
Durable driver for tk-studio on the agent PC: queue, guards, worker tiers, tailnet API. A driver-contract consumer outside the plugin (AD-2).

Today it queues studio jobs durably, wakes one, runs it headless, and finishes it from the command line. It drives the studio only through the published contract: `registry.py show`, the `jobrun.py` verbs, `claude -p "/tk-studio:<skill> <payload>"`, and the launch core's `status` (§1 pure-data allowance).

## Operator commands

```bash
bun install
bun src/cli.ts run studio-health --directory <this repo>          # skill job: submit → claude -p → finish
bun src/cli.ts run maintenance-conformance --directory <this repo> # core job: wake runs it, status reports it
bun src/cli.ts submit studio-health --directory <this repo>       # validate + queue only (idempotent)
bun src/cli.ts run studio-health --directory <root> --tier sbx --sandbox claude-<project>   # the worker inside the sbx microVM
bun src/cli.ts recover                                            # the restart rule over the queue
bun src/cli.ts drain                                              # recover, then drive every unowned queued run
bun test
bunx tsc --noEmit
```

Conformance through the supervisor (driver contract §8). The manifest is read from the installed plugin. Drives the §2 payload can express go through `server.ts` over stdio as `tk_invoke` calls (identical payloads share one run). Fixture CLIs and non-payload verbs (research `seed|spine`, launch `pipeline.py resolve|apply`) run direct via uv under the §1 pure-data allowance:

```bash
bun src/conformance.ts --json                                           # every manifest surface through the supervisor
bun src/conformance.ts --json --compare-direct                          # also runs runner.py run --no-emit direct and compares
bun src/conformance.ts --json --harness --surface tk-studio-detect      # spend-bearing harness drive, judged per §8
```

- Each surface gets the runner's checks: `registered`, `status-block`, `unrunnable-core`, `auth-preflight`, then one check per manifest drive.
- The report's `driver` is `tk-studio-supervisor`. `harness_pass` is `{declared, state}`, the same as the runner's.
- Without `--harness`, an `expect: harness-blocked` drive is one ok check naming the skip. With `--harness`, it runs through the worker path in `auto` mode under the drive's deny-only settings profile (`--settings`), bounded by the drive's `timeout` or 180 s. A profile carrying anything but `permissions.deny` is refused with `DenyProfileRefused` before any process starts.
- `--compare-direct` forwards `--harness` only when it is given, and cannot be combined with `--surface`. The report gains `comparison: {ok, divergences[]}`.
- Exit 0 when every check passes and the comparison (if run) is equal. Exit 1 on a failure or a divergence. Exit 2 when the suite or the direct runner cannot run.

`run` prints one JSON summary. It exits 0 when the run completes. It exits 1 on any other run outcome, including the outcomes that end before a studio run exists: a missing Max login (`state: blocked`, nothing queued), a wake/submit answered without waking (`not-woken`), a lock wait (`queued`), and a run already `running` under another live owner. Once a run exists, a later failure (a refused `finish` or `status`) is reported with its run id; a refused `finish` reports the run's actual state from `status`. If a wake/submit times out, the CLI looks for a run of the job that was not in the `status` snapshot it took just before; it never adopts a run it did not start. A run it finds still `queued` or `running` is ended through a contract verb: a skill run with `finish --state blocked`, a core run with `cancel`. The CLI then reports that run with its id and exits 1. It exits 2 when the invocation or setup is refused before a studio run exists: a bad flag or a flag missing its value (a host bypass request, an unknown `--permission-mode`), a missing `TK_STUDIO_ROOT`, an incompatible contract, `QueueDbMissing` or `QueueDbPlacementRefused`, an unregistered project or a `--directory` that is not the registered root, an unreadable config, a job that `resolve` refuses, or a wake/submit the verb refuses outright, answers without a `run_id`, or times out with no new run found.

`run` prints `run_id` (the queue run id, `q-<job>-<UTC compact>-<rand>`) and `studio_run_id` (the studio's run id, once minted).

## Queue, lock and restart rules

The queue is a SQLite file (`bun:sqlite`) at `TK_SUPERVISOR_DB`. It holds `jobs` (the resolved definition per job and checkout), `runs`, `events` and `locks`. Unset, every command fails with `QueueDbMissing`. A path inside the studio store (`TK_STUDIO_HOME` when set, and `~/.tk-studio` always), inside `TK_STUDIO_ROOT`, or inside any git checkout is refused with `QueueDbPlacementRefused` before the file is created. On Windows and macOS the comparison ignores case. Both exit 2.

- **Validate, then queue.** `submit` and `run` validate through registry `show` and `resolve`, the plugin's one validator of `job.schema.json`. A refusal or `problems[]` comes back verbatim (`problems` in the answer), exit 2, and nothing is queued. `submit` answers `{ok, run_id, state, minted}`.
- **Atomic transitions.** Every state change and its `events` row commit in one `BEGIN IMMEDIATE` transaction. `complete|partial|blocked|cancelled` are terminal and immutable.
- **Idempotent minting.** While a run of the same job on the same checkout is `queued` or `running`, a new `submit`, `run` or tick mints nothing and gets that run's id (`minted: false`). `run` adopts a submitted run.
- **Owners.** An owner is host + pid + a random per-process nonce, plus the process start time where the platform exposes it (Linux `/proc/<pid>/stat`; Windows the creation time from a bounded `powershell -NoProfile -NonInteractive` call, absent when the read fails). "Mine" compares the nonce, never the pid, so a restarted supervisor that reuses a dead owner's pid still recovers its runs. Another owner is alive when it is on this host, its pid answers `kill(pid, 0)`, and its recorded start time (when present) matches. An owner on another host counts as alive and is named.
- **One engine per checkout.** A run takes the checkout lock before the `jobrun` verb that mints or executes. A live holder leaves the run `queued` with the holder named in its `reason` and in the answer (`holder`), exit 1. A holder is a `running` run whose owner process is alive, or a detached bmad-loop engine: when a `tk-studio-launch` run's status block names `.bmad-loop/runs/<id>`, the lock passes to that engine and is held while `launch.py status --directory` lists the id in `live[]`. A failed probe counts as live and is named. A claim that finds a stale lock (its run no longer `running` under a live owner) held by a `tk-studio-launch` run probes the launch core first. A live engine, or an unverified one when the probe fails, takes the lock over, and the claimer waits naming it. A `tk-studio-launch` run that reached the minting verb but ends without naming `.bmad-loop/runs/<id>` (a timeout, a missing status block, a `blocked` launch) probes the launch core before its lock is released, by the launch-orphan rule under **Restart**. Every owner and engine probe runs outside the queue's transactions. A run already `running` under another live owner is answered with its id and state, and nothing is driven (exit 1).
- **Mirroring.** The queue run ends in the studio run's terminal state. A studio run still non-terminal when `run` returns (for example a one-shot scheduled `at` a later time) ends the queue run `blocked`, naming the studio run. It is never left `queued`. A start failure after the lock was claimed ends the queue run `blocked` with the error, and the answer names its `run_id`.
- **Started.** Just before `submit`/`wake`, the queue records `verb_started` in one transaction with its event. The record holds the pre-verb snapshot of the job's studio run ids, and the target and definition the run is actually driven with. Recovery uses that target and definition.
- **Restart.** `run`, `recover`, `drain` and the tick recover on start (the tick once over the whole queue, before any per-job gating and not under `--dry-run`; its runs then skip the per-run recovery). Each requires `TK_STUDIO_ROOT` and the contract pin first; without them it exits 2 and recovers nothing. A `queued` or `running` run whose owner process no longer exists is handled like this:
  - A studio run is recorded: the queue run ends `partial` with reason `orphaned: supervisor restart`. The studio run is ended too if it is non-terminal: a skill run with `finish --state partial`, a core run with `cancel`. A failed studio call is recorded in the event, and the queue run still ends.
  - `verb_started` is set but no studio run is recorded: the job's studio runs absent from the stored snapshot are looked up. The earliest one minted at or after `verb_started` is adopted (a later one may belong to someone else), recorded, and ended as above. None found: the run is re-queued. A candidate whose mint time cannot be read makes the pick ambiguous, which counts as a failed lookup. The lookup failed: the run ends `partial` naming the failed lookup. A run that may have executed is never re-queued.
  - Neither is set, or the run is `queued`: it is re-queued (`requeued: supervisor restart`): owner cleared, lock released.
  - Ending an orphaned `tk-studio-launch` run first probes `launch.py status --directory`. A non-empty `live[]` hands the lock to that engine. A failed probe hands it to an unverified engine, which a claim re-probes: a non-empty `live[]` or a failed probe still counts as live.
  - Every transition lands in `events`.
- **Draining.** `drain` recovers, then drives every `queued` run that no live process owns, oldest first, by the job id and checkout the queue stored (re-validated through `resolve`). It drives exactly the listed run and never mints one. A run that is no longer an ownerless `queued` run by the time it is driven is reported `skipped`. A refusal ends the run `blocked`, with the refusal verbatim in its reason and an `events` row, and the answer carries `problems`. A refusal is a verb's `ok:false` answer (registry `show`, `resolve`), `problems[]`, a registry root that is not the checkout, an unreadable project config, or a missing checkout directory. A transport failure before the lock is claimed (during re-validation: a timeout, `uv` failing to spawn, output with no JSON), a lock wait, or a stop before validation (no Max login) leaves the run `queued`. A start failure after the claim ends the run `blocked`, as under **Mirroring**, and the answer's `state` says so. A run entry also carries `state`, the run's actual queue state, when its `summary` has no run id or a different state: a stop before validation answers `summary: {state: "blocked"}` (with the drained run's id) and `state: "queued"`. A run recorded with a permission mode (below) is driven under it. It prints `{ok, recovered, runs[]}` and exits 0 when every driven run completed, 1 otherwise, 2 when the queue is unusable.

After killing the supervisor mid-run: `bun src/cli.ts drain` (it recovers, then drives the queue).
Before that `drain`, check that no worker of the killed run (`claude -p`, or a `uv run … jobrun.py` child) still runs in that checkout: recovery releases the checkout lock once the supervisor's own process is gone, so `drain` could otherwise drive a second run beside a surviving worker.

How it runs a worker:
- The permission mode defaults to `auto`. An explicit `--permission-mode <mode>` on `run` or `submit` is recorded on the queue run it mints or adopts while that run is `queued` (`runs.permission_mode`), so a run left `queued` (a lock wait) and later driven by `drain` or the tick keeps that mode. A `bypassPermissions` request on the host tier is refused with `HostBypassRefused` before any process starts. No flag is passed that overrides `permissions.deny` in `~/.claude/settings.json`.
- Auth comes only from the Max login, checked with `claude auth status --json`. The worker's environment never carries `ANTHROPIC_API_KEY`.
- The worker runs with `--output-format json`. The status block is read from the result text, and `total_cost_usd` is passed on to `finish` with the studio's run id.
- Model and effort: `--model`/`--effort` on `run` or `submit` override the resolved job's `routing` for that run; otherwise `routing.model`/`routing.effort` are forwarded verbatim (flags and payload, contract §5). With neither, no `--model`/`--effort` is passed. The supervisor never chooses a model.
- `finish` emits the `job-run` ledger event. The supervisor never emits it.

## Worker tiers

Each run picks a tier: `host` (the default) or `sbx`. The tier comes from the submission or the supervisor's own per-job config, never from the plugin (AD-2).

- **host**: `claude -p <prompt> --output-format json --permission-mode auto|acceptEdits|…`, spawned directly by the supervisor under the Max login. Bypass is refused (`HostBypassRefused`).
- **sbx**: the same argv inside a Docker Sandboxes microVM: `sbx exec <sandbox> env -u ANTHROPIC_API_KEY -C <vm-root> claude -p <prompt> …`. It is argv only with no shell, so the prompt stays one argv item. The login probe runs through the same wrapper (`sbx exec <sandbox> env -u ANTHROPIC_API_KEY claude auth status --json`). `<vm-root>` is derived from the registry root the way sbx mounts it: a drive path `<D>:\GitHub\<p>` becomes `/<d>/GitHub/<p>`, and a POSIX path is unchanged. The skill's payload `directory` is that VM path. Bypass is permitted, but only when requested; the default is still `auto`. A deny profile must lie inside the project root, and it is forwarded as its VM path. A profile outside the root is refused with `DenyProfileRefused`. The VM worker is always `claude`, since `CLAUDE_BIN` is host-only.

Every option resolves in this order: the flag, then the value stored on the queue run, then the per-job config, then the default (`host`, `auto`). A config entry's `permission_mode` applies only when the run's tier is that entry's own tier (no `tier` means host). Model and effort have no config layer. `submit` and `run` resolve them before any process starts and before anything is queued. Each of these refusals exits 2 with nothing queued:
- `HostBypassRefused`, with `state: blocked`
- `TierRefused`, for an unknown `--tier`
- `SbxSandboxMissing`, when the sbx tier has no `--sandbox`
- `VmPathUnderivable`, when the sbx tier runs on a root with no microVM path (e.g. a UNC share)
- `SupervisorConfigInvalid`

The queue run records the resolved `tier` and `sandbox`, and the submission's `model` and `effort` (nullable `runs` columns). A change on a `queued` run writes one `run-options` event. An existing queue file gains the new columns when it is opened. `drain` and the tick drive the run with the stored values, re-checked after the claim. An invalid stored value ends the run `blocked`, naming it.

Per-job config (`TK_SUPERVISOR_CONFIG`, YAML; placeholders shown):

```yaml
jobs:
  "<project-id>/<job-id>":
    tier: sbx                        # host | sbx
    sandbox: claude-<project>        # required for sbx
    permission_mode: acceptEdits     # auto | acceptEdits | default | plan | bypassPermissions (sbx only)
```

A `sbx exec` timeout kills the host `sbx` process only. The worker inside the VM may survive it; Story 21.5 owns the tree kill.

Live checks on the agent PC (not verifiable in CI):
- **AC1, console hosting.** Run `bun src/cli.ts run studio-health --directory <root>` from the console-hosted supervisor window. While the worker runs, record the `claude -p` process's session id, for example with `Get-Process claude | Select-Object Id, SessionId, StartTime`. It must be non-zero, meaning not Session 0 and not a headless Task Scheduler spawn (runbook §8).
- **AC5, the first sbx run (runbook §3.5).** Run `bun src/cli.ts run studio-health --directory <root> --tier sbx --sandbox claude-<project> --permission-mode bypassPermissions`. It must end `complete` with bypass. Then run `sbx exec claude-<project> bash -lc 'ls -a ~ ; ls ~/.ssh ~/.aws ~/.azure ~/.config/gcloud 2>&1'` and record that the credential folders are absent.

## Environment

| Variable | Meaning |
|---|---|
| `TK_STUDIO_ROOT` | tk-studio repo root (required; unset fails with `StudioRootMissing`). The plugin root is `$TK_STUDIO_ROOT/plugins/tk-studio`. |
| `TK_STUDIO_HOME` | Per-user store override. Passed through to every child process and never hard-coded. |
| `CLAUDE_BIN` | Host worker binary (default `claude`). The sbx worker is always `claude` inside the microVM. |
| `SBX_BIN` | Docker Sandboxes CLI on the host, for sbx-tier runs (default `sbx`). |
| `TK_SUPERVISOR_CONFIG` | The supervisor's per-job config file (optional; unset means no config, and every job runs on the host tier). Never read from the plugin or a project's `.tk-studio/`. An unknown key or value is `SupervisorConfigInvalid` (exit 2). |
| `TK_SUPERVISOR_DB` | Queue database file (required by `run`, `submit`, `recover`, `drain` and the tick; unset fails with `QueueDbMissing`). Must lie outside every git checkout, the studio store and `TK_STUDIO_ROOT` (`QueueDbPlacementRefused`). |

## Provenance

These four files were lifted from `github.com/thkennedy/ClaudeOS`, tag `retired-as-driver-2026-09-26`, commit `2b9fd3e0a203028395d6d59ead7e7234ddbdf6f6`. Each source was byte-verified by git blob SHA before the lift.

| Source path | Target path | Blob SHA | Lines |
|---|---|---|---|
| `connectors/tk-studio/server.ts` | `src/server.ts` | `34db64083415131873d1c7ad11a6bd45c217be4a` | 705 |
| `connectors/tk-studio/client.ts` | `src/client.ts` | `4fd36363a99847214127ffbb308ec1bb52cd8ee8` | 96 |
| `connectors/tk-studio/conformance.ts` | `src/conformance.ts` | `089172e97d684dae00d8b060c4a6f2eb8a09db7f` | 453 |
| `scripts/studio-jobs-tick.ts` | `src/tick.ts` | `3ac453534e469eca6d046d606c97015c291308cc` | 307 |

Story 21.1 changed `server.ts`:
- permission mode defaults to `auto`, and a host bypass is refused
- Max-login preflight
- `ANTHROPIC_API_KEY` stripped from the worker env
- projects read through `registry show` and jobs through `resolve`
- `--output-format json`, with model and effort forwarded

Story 21.2 fixed `conformance.ts`: evolve and launch surfaces, harness drives skipped or run under a deny-only profile, the runner's static checks, and the `--compare-direct` comparison.

`tick.ts` was lifted as-is apart from the coupling strip. Story 21.3 routes its wake → invoke → finish through the queue-backed `runJob` (idempotent wake, the checkout lock, the restart rule); `--timeout-cap-s` caps the skill invocation's timeout only; the `wake`/`submit` verb keeps the job's own `max_wall_clock_seconds` (+120 s), since a core job runs inside `wake` under it. The tick runs the restart rule once at start, before any per-job gating (not under `--dry-run`). `--directory <root>` ticks that root instead of enumerating the registry, but the root must be a registered project root: every run is validated through registry `show` like any other. An unusable queue, or a failed start-of-tick recovery, exits 2 before any job. A lock wait or an already-running answer counts as skipped, and any other outcome with no studio run counts as refused, as does a start the verbs refuse (registry `show`, `resolve` or `wake` answering `ok:false`, or `problems[]`). Story 21.5 fixes its pacing.
