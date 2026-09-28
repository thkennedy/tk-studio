# tk-studio-supervisor
Durable driver for tk-studio on the agent PC: queue, guards, worker tiers, tailnet API. A driver-contract consumer outside the plugin (AD-2).

Today it wakes one studio job, runs it headless, and finishes it from the command line. It drives the studio only through the published contract: `registry.py show`, the `jobrun.py` verbs, and `claude -p "/tk-studio:<skill> <payload>"`.

## Operator commands

```bash
bun install
bun src/cli.ts run studio-health --directory <this repo>          # skill job: submit → claude -p → finish
bun src/cli.ts run maintenance-conformance --directory <this repo> # core job: wake runs it, status reports it
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

`run` prints one JSON summary. It exits 0 when the run completes. It exits 1 on any other run outcome, including the two that end before a run id exists: a missing Max login (`state: blocked`) and a wake/submit answered without waking (`not-woken`). Once a run exists, a later failure (a refused `finish` or `status`) is reported with its run id; a refused `finish` reports the run's actual state from `status`. If a wake/submit times out, the CLI looks for a run of the job that was not in the `status` snapshot it took just before; it never adopts a run it did not start. A run it finds still `queued` or `running` is ended through a contract verb: a skill run with `finish --state blocked`, a core run with `cancel`. The CLI then reports that run with its id and exits 1. It exits 2 when the invocation or setup is refused before a run exists: a bad flag or a flag missing its value (a host bypass request, an unknown `--permission-mode`), a missing `TK_STUDIO_ROOT`, an incompatible contract, an unregistered project or a `--directory` that is not the registered root, an unreadable config, a job that `resolve` refuses, or a wake/submit the verb refuses outright, answers without a `run_id`, or times out with no new run found.

How it runs a worker:
- The permission mode defaults to `auto`. A `bypassPermissions` request is refused with `HostBypassRefused` before any process starts. No flag is passed that overrides `permissions.deny` in `~/.claude/settings.json`.
- Auth comes only from the Max login, checked with `claude auth status --json`. The worker's environment never carries `ANTHROPIC_API_KEY`.
- The worker runs with `--output-format json`. The status block is read from the result text, and `total_cost_usd` is passed on to `finish`.
- `finish` emits the `job-run` ledger event. The supervisor never emits it.

## Environment

| Variable | Meaning |
|---|---|
| `TK_STUDIO_ROOT` | tk-studio repo root (required; unset fails with `StudioRootMissing`). The plugin root is `$TK_STUDIO_ROOT/plugins/tk-studio`. |
| `TK_STUDIO_HOME` | Per-user store override. Passed through to every child process and never hard-coded. |
| `CLAUDE_BIN` | Worker binary (default `claude`). |

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

`tick.ts` was lifted as-is apart from the coupling strip. Stories 21.3 and 21.5 fix it.
