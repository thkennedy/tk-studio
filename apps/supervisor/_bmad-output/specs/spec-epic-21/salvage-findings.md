# Salvage findings — ClaudeOS driver lift (read of 2026-09-27)

What the lift must change, not just copy. Every row is a defect in the source at the tag, and the story that fixes it.

## Provenance

Tag `retired-as-driver-2026-09-26` in the ClaudeOS repo. The README records the tag, path and commit for each file.

| Source file | Lines | Lifted as |
|---|---|---|
| `connectors/tk-studio/server.ts` | 705 | library core (wake / invoke / finish, worker command line) |
| `connectors/tk-studio/client.ts` | 96 | contract client |
| `connectors/tk-studio/conformance.ts` | 453 | conformance driver |
| `scripts/studio-jobs-tick.ts` | 307 | pacer / tick |

## Coupling to strip (Story 21.1)

- `.mcp.json` stdio registration
- Mission Watchdog chaining
- `claudeos-mcp-connector` driver name

## Defects

| Where | Defect | Fix | Story |
|---|---|---|---|
| `server.ts` | Worker defaults to `--permission-mode bypassPermissions`, which is forbidden on the host | Host default `auto`; host bypass refused before spawn | 21.1, 21.4 |
| `server.ts` | Model and effort passed only inside the payload | Forward verbatim as flags per contract §5 | 21.4 |
| `server.ts` | `ANTHROPIC_API_KEY` or a working `claude --version` treated as proof of auth | Max-login preflight; key stripped from worker env | 21.1 |
| `server.ts` | Reads the registry file directly | Registry read path + `resolve` verb | 21.1 |
| `conformance.ts` | No `evolve` or `launch` entries in the surface and verb maps | Add them | 21.2 |
| `conformance.ts` | Throws TypeError on `expect: harness-blocked` drives | Skip with reason; run under `--harness` | 21.2 |
| tick | Self-paced jobs only; never calls `account` | Guards call `account` | 21.5 |
| tick | No atomic wake | Idempotent wake in one transaction | 21.3 |
| tick | Strands a run in `queued` forever if it dies between `wake` and `finish` | Restart orphan / resume rule | 21.3, 21.6 |

## Current as-is

Everything else in the source is current through plugin 0.1.17. `job.schema.json`, `jobrun.py` and the status schema have not changed since 0.1.12.
