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

Filled by the operator session on the box (2026-10-27):

| Item | Value |
|---|---|
| Date, box | 2026-10-27, 05:58Z to 07:14Z, TIM-PC-2 (session 11's operator session; supervisor on `main` e74826f after PRs #201, #202 and #203) |
| `tk-studio doctor --json` `engine` row (status, detail) | `pass`: `C:\Program Files\WinGet\Packages\GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe; 4.7.2.stable.mono.official.ed1daf0bf` (the checkout's cli at 83b30fa) |
| TUA PR adding `verify.engine` (URL, merge commit) | https://github.com/thkennedy/the-universe-awaits/pull/5 (`5900915`); and PR 6 (`371cede`), `scripts/engine-gate.sh` calling the engine through `GODOT` (hole 78), cherry-picked onto the run branch as `840caf1` because the verb runs the branch tip's scripts |
| Run re-verified (run id, `head`) | `q-run-epic-2-20261017T224219Z-39ae5a`, `head` `840caf1` (the fifth attempt; the first four taught holes 75, 77 and 78, each in the ledger) |
| How (`POST /runs/<id>/verify` or `bun src/cli.ts verify <id>`) | `POST /runs/<id>/verify` with the bearer: `202 {ok, state: partial, verify: started, head}`; once also `bun src/cli.ts verify <id>` from `apps/supervisor` (the same leg, the same result) |
| `host-verify` `green`; `engine.verdict`; `engine.exit`; `engine.duration_ms` | `green: false`; the host step green (`exit 0`, 29,698 ms: the solution built, 1,058 Core tests passed, the content lint `0 hard, 31 warn`, `verify: OK`); `engine.verdict: red`; `engine.exit: 1`; `engine.duration_ms: 20550` |
| `engine.godot_dir` | `C:\Program Files\WinGet\Packages\GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe\Godot_v4.7.2-stable_mono_win64` |
| `engine.stdout_tail` (the import and the GoDotTest lines) | the game assembly built, the headless import ran, then the GoDotTest suite: `Test results: Passed: 125 \| Failed: 12 \| Skipped: 0`; every failure `KeyNotFoundException: The given key 'dalia.toy.cold_storage' was not present in the dictionary` in `TUA.Game.Phone.Conversation.Refresh()` under `ConversationTest.WithToyRoots`, after one `app.reload hard=1 warn=31` from the content watcher |
| `rerun.pr_ready` | not reached (the leg is red by the engine step); `rerun: {by: api, head: 840caf1, worktree: removed, pr: TUA #4}` |

## What the proof found

- **The mechanism is proven.** For the first time a run's host leg ran a game project's engine gate on the Windows host: after a green `verify.host` the leg ran `bash scripts/engine-gate.sh` in the worktree with the `GODOT` folder first on PATH, the engine built, imported and ran the GoDotTest suite through the console exe, and the verdict, the exit, the duration and both tails landed on the `host-verify` event as `engine`. Before this day TUA's host leg had never been green at all (hole 77).
- **The verdict is red by the game's own tests, not by the leg.** 12 of 137 engine tests fail on this box, by hand exactly as under the leg (`scripts/engine-gate.sh` with `GODOT` set, with or without the toy world regenerated: `Passed: 125 | Failed: 12`): `Phone.ConversationTest` cases under `WithToyRoots` throw `KeyNotFoundException 'dalia.toy.cold_storage'` in `Conversation.Refresh()` after the content watcher's reload reported `hard=1`. That is a TUA finding for its owner (a reload race or a content fixture the tests assume), outside this story.
- **What the first four attempts taught, each fixed the same day:** hole 75 (the verb's materialise failed on the stopped sandbox's login plane, PR #202), hole 77 (the capture's append-mode files made every bash `verify.host` red, PR #203), hole 78 (a bare `godot` resolves to WinGet's GUI build and hangs headless; TUA PR 6). The runbook carries the rows.
