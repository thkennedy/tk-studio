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

`run` prints one JSON summary. It exits 0 when the run completes. It exits 1 on any other run outcome, including the two that end before a run id exists: a missing Max login (`state: blocked`) and a wake/submit answered without waking (`not-woken`). Once a run exists, a later failure (a refused `finish` or `status`, a timed-out wake) is reported with its run id. It exits 2 when the invocation or setup is refused before a run exists: a bad flag (a host bypass request, an unknown `--permission-mode`), a missing `TK_STUDIO_ROOT`, an incompatible contract, an unregistered project or a `--directory` that is not the registered root, an unreadable config, a job that `resolve` refuses, or a wake/submit the verb refuses outright or that fails with no run found.

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

`conformance.ts` and `tick.ts` were lifted as-is apart from the coupling strip. Stories 21.2, 21.3 and 21.5 fix them.
