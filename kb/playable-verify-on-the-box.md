---
title: Playable verify on the box — how Godot produces frames unattended (Story 34.2's measurement)
description: Story 34.2's record on TIM-PC-2 with The Universe Awaits and Godot 4.7.2 Mono — the PlayableHarness copy-in, the playable.py command per rendering path, the operator session's measurement of the three paths (headless, Movie Maker, windowed; 2026-10-27, before the harness), the ruling (Movie Maker is the path 34.3 uses) and the tk-studio-launch check row that warns when its precondition is missing.
rank: 62
scope: project
---

# Playable verify on the box (Story 34.2)

Epic 34's Story 34.2 asks for one proven way to run the game on the agent PC for a bounded number of
ticks under a seeded, scripted scenario and come back with frames and a pass or fail. The tool is
`plugins/tk-studio/lib/playable.py run` (the runner 34.3's `playable-verify` leg drives) and the
`PlayableHarness` C# autoload it starts, shipped as a template at
`plugins/tk-studio/lib/godot/PlayableHarness.cs` with a minimal scenario beside it
(`godot/scenario.example.json`). The engine cannot run Godot (it lives in a Linux sandbox; Godot lives
on the Windows host), so every measurement here is the operator session's step on the host.

## The box

- Godot `4.7.2.stable.mono.official.ed1daf0bf` (`C:\Program Files\WinGet\Packages\GodotEngine.GodotEngine.Mono_…\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe`; the runbook's `$env:GODOT`, also `godot` on PATH through WinGet's links).
- Renderer the engine picked: **Vulkan 1.4, Forward+, NVIDIA GeForce RTX 4070 Ti** (from the engine's own banner), so the RDP session has a real GPU, not a software fallback.
- `dotnet build game/TUA.Game.csproj -c Debug`: 6 s, 0 errors (the Mono runner runs the last built assembly; build first, as TUA's `scripts/engine-gate.sh` does).
- `godot --headless --path game --import --quit`: 8 s (the import cache; needed once per worktree).

## The harness copy-in for TUA

The copy-in lands in TUA through a TUA run PR or the operator's step on the box, never through
tk-studio's engine. In a TUA working copy (a scratch clone, never the served checkout):

1. Copy `plugins/tk-studio/lib/godot/PlayableHarness.cs` to `game/src/Debug/PlayableHarness.cs`.
2. Register the autoload in `game/project.godot`:

   ```ini
   [autoload]
   PlayableHarness="*res://src/Debug/PlayableHarness.cs"
   ```

   `playable.py` refuses (exit 2, `blocked`) a project whose `project.godot` registers no
   `PlayableHarness` autoload, before anything starts.

3. Write TUA's scenario (schema 1; start from `godot/scenario.example.json`, and name only InputMap
   actions and node paths TUA has), for example at `game/playable/scenario.json`.
4. Check the precondition: the project's physics ticks per second
   (`physics/common/physics_ticks_per_second` in `project.godot`; absent means Godot's default 60) is
   **60**, the runner's `--fixed-fps`. The harness counts one tick per physics step while `--fixed-fps 60`
   fixes the drawn frames; at another rate ticks and frames diverge (`capture_every`, the moments and the
   movie frame a tick names stop lining up).
5. Build and import once: `dotnet build game/TUA.Game.csproj -c Debug`, then
   `& $env:GODOT --headless --path game --import --quit`.

The harness is inert unless the run passes `--playable-scenario=`, so the game plays normally with it
registered. Its first run on the box is also its compile check (the lib suite cannot compile C#); a
compile error there (for example the `Logger` override's signature on 4.7.2) is fixed in the template.

## Measurement commands per path

From the tk-studio checkout on the host, with `GODOT` set (PowerShell; `<tua>` the TUA working copy,
`<out>` a scratch folder per mode, never inside the project: `playable.py` refuses an `--out` inside the
folder holding `project.godot`):

```powershell
uv run plugins/tk-studio/lib/playable.py run --directory <tua> --scenario <tua>/game/playable/scenario.json --seed 1 --ticks 90 --out <out>/display  --mode display
uv run plugins/tk-studio/lib/playable.py run --directory <tua> --scenario <tua>/game/playable/scenario.json --seed 1 --ticks 90 --out <out>/movie    --mode movie
uv run plugins/tk-studio/lib/playable.py run --directory <tua> --scenario <tua>/game/playable/scenario.json --seed 1 --ticks 90 --out <out>/headless --mode headless
```

Each ends in a status block and writes `<out>/<mode>/report.json`, `log.txt` and `frames/` (an earlier
run's `report.json` and `frames/*.png` are removed first; in display and movie modes a pass that names no
frame, or a frame file that is not there, is a `frames` fail; a wall-clock overrun kills the engine's
process tree, the console wrapper's child included). Read back:
the frame files and their sizes (`frames/`), whether a frame shows the scene (open one), `report.json`'s
`frame_time_ms`, `ticks_run` and `run.duration_ms` (ms per tick = `duration_ms / ticks_run`, boot
included), and whether `log.txt` kept the engine's lines (if it lost any, add Godot's `--log-file` and
note it here). The argv per mode is `--windowed --fixed-fps 60` (display), `--write-movie
<out>/frames/movie.png --fixed-fps 60` (movie) and `--headless --fixed-fps 60` (headless), then `--` and
the harness's user args.

## Measurements

The operator session's measurement, 2026-10-27, before the harness existed: TIM-PC-2, the logged-in
(RDP) session, a scratch **clone** of TUA (`C:\agent-work\scratch\tua-playable`), `$env:GODOT`'s folder
on PATH, 90 frames per path, after the build and the import (script: the session's
`playable_measure.sh`; raw outputs under `C:\agent-work\scratch\playable\`). The commands were bare
Godot, not `playable.py`:

| Path | Frames produced | Non-blank pixel evidence | ms per tick | Wall time | Notes |
|---|---|---|---|---|---|
| headless (`godot --headless --path game --quit-after 90`) | none | none: the dummy rendering server draws nothing | about 22 (2 s / 90, boot included) | 2 s | exit 0, the app booted (`TUA.Game shell ready`) |
| movie (`godot --path game --write-movie C:/agent-work/scratch/playable/moviemaker/f.png --fixed-fps 30 --quit-after 90`) | 90 PNG, 1920×1080, `f00000000.png` to `f00000089.png` | each 13,672 bytes (a still scene): the game's shell with its debug line (`content: 1 packages · lint: 0 hard, 31 warn`) on the clear colour | about 100 all-in (9 s / 90); the engine: CPU render 0.08 ms/frame, GPU 0.04 ms/frame, PNG encoding 43 ms/frame | 9 s | exit 0; "90 frames at 30 FPS (movie length 00:00:03:00), recorded in 00:00:07 (42% of real-time speed)" |
| display (`godot --path game --quit-after 90`) | none without a capture | none recorded: a window on the session's display for the run | about 56 (5 s / 90, boot included) | 5 s | exit 0; frames need something to capture the viewport (the harness's capture, not yet measured) |

TUA's `Main.tscn` draws nothing beyond the shell without a scenario, which is the point of the
harness's scenario (a scene to load, inputs to drive, moments to look for).

With the harness and `playable.py` (the three commands above), measured by the operator session on
2026-10-27 08:35Z (TIM-PC-2, the RDP session; the scratch clone with the harness copied in, the autoload
registered and the scenario at `game/playable/scenario.json`: `scene: res://Main.tscn`, `node_exists
/root/Shell`, `no_error_log`, `frame_time_under 33.3 ms from tick 10`, `capture_every 30`, a moment at tick
60; `--seed 1 --ticks 90`; outputs under `C:\agent-work\scratch\playable-harness\<mode>`):

| Path | Verdict | Ticks run | Frames | Frame time, harness (mean / max ms) | `run.duration_ms` | Notes |
|---|---|---|---|---|---|---|
| headless | `pass` | 90 | none, by design (`frames: []`) | 3.48 / 3.52 | 1,440 (16 ms per tick, boot included) | `log_errors: 0`; the harness quit the engine at tick 90 |
| movie | `pass` | 90 | 3 named (`frames/movie00000000.png`, `…30`, `…60`; the moment "after moving right" resolves to tick 60's frame) among the 92 PNGs Movie Maker wrote (plus `movie.wav`), 1920×1080, 13,672 bytes each (the shell scene) | 1.71 / 6.75 | 6,942 (77 ms per tick all-in: PNG encoding dominates) | `log_errors: 0`; exit 0 |
| display | `fail` at tick 10: `the frame time stays under the budget` (66.4 ms over 33.3) | 11 | 2 (`frames/000000.png`, `frames/000010.png`) | 60.4 / 66.4 | 2,406 | the windowed run on the RDP session presents at about 15 Hz, so a display scenario needs a frame budget of 70 ms or more, or no frame-time invariant; exit 1 |

What the compile check taught: the template did not build in TUA's project at first. TUA builds with
`<Nullable>enable</Nullable>` and `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` and enforces its
style analyzers in the build (IDE1006 naming, IDE0055 formatting: 677 errors), so the game ran with a
stale assembly, the autoload failed (`script … does not inherit from 'Node'`) and every mode hit the 120 s
wall clock. The template now starts with `// <auto-generated />` (a host project's analyzers treat it as
foreign code) and `#nullable disable`, after which it built clean and the rows above were measured.
TUA's `app.boot` logs a WARN for each `--playable-*` user arg it does not know (harmless; a TUA nit).


## Ruling

**34.3 uses movie: the engine writes every frame itself at a fixed FPS, with no desktop capture and no
window focus, and it is the only path the measurement saw produce frames unattended.**
Confirmed with the harness on 2026-10-27: movie passed 90 ticks in 6.9 s with every frame on disk and the
moment's frame named; headless has no frames; display works but the RDP session's presentation rate breaks a
33 ms budget.

- `--fixed-fps` makes time deterministic: every `_process` and `_physics_process` sees the same delta on every run, so a seeded scenario replays tick for tick as far as the seed reaches: the harness seeds `GD.Seed` and its own input RNG only, so `System.Random` and `RandomNumberGenerator` instances the game creates stay unseeded (the game's own RNG needs a hook the project exposes; TUA's hook is out of Story 34.2).
- The cost is bounded and known: about 100 ms per 1080p frame all-in (encoding dominates), so a 90-tick scenario is a ten-second step on the host leg and the 120 s default wall clock covers about a thousand ticks.
- In movie mode Movie Maker writes `movie00000000.png…` for every drawn frame into `<out>/frames/`; the harness does not capture itself and names, in `report.json` `frames[]`, the movie frame of every `capture_every`-th tick and of each moment (the offset between a tick and its movie frame is the first harness run's check).
- A `--headless` run stays the right tool for the engine gate (import, tests), never for frames.
- `playable.py`'s default `--mode` and `launch.py`'s `PLAYABLE_PATH` are both `movie` (a test pins them equal).
- Re-measure here before trusting a new Godot version: the WinGet upgrade of Godot changes the path under `$env:GODOT`.

## The launch-check row

`tk-studio-launch check` reports an advisory `playable path` row right after `engine sandbox` (`ok`
always, never a gap; it starts no engine):

- `not a game project (no verify.engine)` — the project's tracked `.tk-studio/config.yaml` declares no `verify.engine`.
- `warning: no $env:GODOT (unset or not an absolute file); playable runs refuse` — `playable.py` refuses the same way.
- `warning: no display session; the movie path needs the logged-in desktop` — Movie Maker needs a window, so the box must be logged in (the RDP session counts; a locked console does not). On Windows the check opens the input desktop; elsewhere it reads `DISPLAY` / `WAYLAND_DISPLAY`. A probe that errors reads `warning: display session unknown (<error>)`.
- `ready (movie)` — both preconditions hold.

The other preconditions the host leg owns rather than the check: the project's `.godot` import cache
(import first) and the built Mono assembly.
