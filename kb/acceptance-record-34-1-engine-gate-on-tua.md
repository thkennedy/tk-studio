---
title: "Acceptance record: Story 34.1, the engine gate on the host leg, proved on The Universe Awaits"
description: "Story 34.1's TUA proof: the operator's steps on the agent PC (TUA's verify.engine through a TUA PR, the supervisor restarted after GODOT is set, an ended TUA run re-verified through POST /runs/{id}/verify, the host-verify event's engine read back, the doctor's engine row) and the Evidence section the operator fills; unverifiable in the engine's sandbox."
rank: 100
scope: project
---

# Acceptance record: Story 34.1, the engine gate on the host leg, proved on The Universe Awaits

The record AC3 asks for: an ended TUA run re-verified through `POST /runs/{id}/verify`, with the headless import and the GoDotTest suite green on the host. The engine that built Story 34.1 runs in a Linux sandbox that has no `godot` and never runs on the host, so the proof is `unverifiable-here`: the steps below are the operator's, on the agent PC, and the operator fills `## Evidence`.

What landed (tk-studio, contract 0.1.29): the project's tracked `.tk-studio/config.yaml` may declare `verify.engine` beside `verify.host`; the supervisor's host leg (`apps/supervisor/src/hostverify.ts`) runs it after a green `verify.host`, in the run's worktree, with the folder of `GODOT` first on PATH, and records `engine {verdict, reason?, command?, argv?, cwd?, exit?, duration_ms?, signal?, guard?, error?, stdout_tail?, stderr_tail?, godot_dir}` on the `host-verify` event. An engine red is a red leg: the run ends `partial` with `host_verify: red` and the reason ``host verify red (engine): …``, and the PR stays a draft. `tk-studio doctor` reports an `engine` row. In the sandbox the leg is covered by `bun test test/hostverify.test.ts` (a fake `godot` driven to both verdicts) and the conformance drive `e2e_engine_gate.py`.

## Operator steps (on the agent PC)

1. **The engine on the box.** `GODOT` is the User environment variable naming the Godot 4.7.2 Mono console exe (runbook §2, not winget's `godot_console` link). Check it: `& $env:GODOT --version` prints the 4.7.2 version line, and `tk-studio doctor --json` shows the `engine` row `pass` with `<path>; <version line>`.
2. **Restart the supervisor after `GODOT` is set.** The supervisor reads `GODOT` from its own environment when it starts; one started before the variable was set has no `GODOT` (run the Startup shortcut, or sign out and in). The leg puts the folder of `GODOT` first on PATH so a binary in that folder resolves by name, but the console exe is not named `godot`: TUA's `scripts/engine-gate.sh` calls the engine through `$GODOT`, which the worker env passes through.
3. **TUA declares the gate.** Through a TUA PR (TUA's `main` changes only through its own PRs), TUA's `.tk-studio/config.yaml` gains `engine` beside `host` under `verify`:

   ```yaml
   verify:
     host: bash scripts/verify.sh
     engine: bash scripts/engine-gate.sh
   ```

   Merge it, so the key is on the `base_ref` an ended run reads (the leg reads the config at the run's base, never the worktree). Keep the `host` value TUA already has: only `engine` is new.
4. **Re-verify an ended TUA run.** Pick an ended TUA run whose branch `supervisor/run-<id>` is on origin and whose `base_ref` carries the key, then either:
   - `POST /runs/<id>/verify` with the bearer (`202 {ok, run_id, state, verify: "started", head}`), then read the new `host-verify` on `GET /runs/<id>/events`; or
   - from `apps/supervisor`: `bun src/cli.ts verify <id>` (prints `{ok, run_id, state, head, green, …}`; exit 0 green).
5. **Read the event back.** The newest `host-verify` event's `engine.verdict` is `green`, `engine.command` is `bash scripts/engine-gate.sh`, `engine.godot_dir` is the folder of `GODOT`, and `engine.stdout_tail` carries the headless import's lines and the GoDotTest suite's summary. The top-level `green` is `true`, and the re-run's `rerun.pr_ready` says what happened to the PR.
6. **Optional, the red path.** On a scratch TUA branch that breaks a scene or a GoDotTest test, a run's host leg ends `partial` with ``host verify red (engine): `bash scripts/engine-gate.sh` exited …``, and the PR body's `## Host verify` section shows `Engine gate: red` with the tails.

## Evidence

To be filled by the operator on the box:

| Item | Value |
|---|---|
| Date, box | |
| `tk-studio doctor --json` `engine` row (status, detail) | |
| TUA PR adding `verify.engine` (URL, merge commit) | |
| Run re-verified (run id, `head`) | |
| How (`POST /runs/<id>/verify` or `bun src/cli.ts verify <id>`) | |
| `host-verify` `green`; `engine.verdict`; `engine.exit`; `engine.duration_ms` | |
| `engine.godot_dir` | |
| `engine.stdout_tail` (the import and the GoDotTest lines) | |
| `rerun.pr_ready` | |
