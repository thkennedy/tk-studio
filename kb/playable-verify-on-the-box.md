---
title: Playable verify on the box — how Godot produces frames unattended (Story 34.2's measurement)
description: The operator session's measurement for Story 34.2 (2026-10-27) on TIM-PC-2 with The Universe Awaits and Godot 4.7.2 Mono — three capture paths tried (headless, Movie Maker, windowed), their timings and what the frames contain; Movie Maker (--write-movie PNG at a fixed FPS) is the path the playable-verify leg builds on, with its preconditions.
rank: 62
---

# Playable verify on the box (Story 34.2's measurement, 2026-10-27)

Epic 34's Story 34.2 asks for one proven way to run the game on the agent PC for a bounded number of
ticks and come back with frames. The engine cannot run Godot (it lives in a Linux sandbox; Godot lives
on the Windows host), so the measurement is the operator session's step, made before the story ran so
the engine's harness and `playable.py` build on facts. Everything below ran on TIM-PC-2 in the
logged-in (RDP) session, from a scratch **clone** of TUA (`C:\agent-work\scratch\tua-playable`, never
the served checkout), with `$env:GODOT`'s folder on PATH. Script: the session's
`playable_measure.sh`; raw outputs under `C:\agent-work\scratch\playable\`.

## The box

- Godot `4.7.2.stable.mono.official.ed1daf0bf` (`C:\Program Files\WinGet\Packages\GodotEngine.GodotEngine.Mono_…\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe`; the runbook's `$env:GODOT`, also `godot` on PATH through WinGet's links).
- Renderer the engine picked: **Vulkan 1.4, Forward+, NVIDIA GeForce RTX 4070 Ti** (from the engine's own banner), so the RDP session has a real GPU, not a software fallback.
- `dotnet build game/TUA.Game.csproj -c Debug`: 6 s, 0 errors (the Mono runner tests the last built assembly; build first, as TUA's `scripts/engine-gate.sh` does).
- `godot --headless --path game --import --quit`: 8 s (the import cache; needed once per worktree).

## The three paths

| Path | Command (after the build and the import) | Result | Time |
|---|---|---|---|
| A. headless | `godot --headless --path game --quit-after 90` | exit 0, the app booted (`TUA.Game shell ready`), **no frames** (the dummy rendering server draws nothing) | 2 s |
| B. Movie Maker | `godot --path game --write-movie C:/agent-work/scratch/playable/moviemaker/f.png --fixed-fps 30 --quit-after 90` | exit 0, **90 PNG frames, 1920×1080**, `f00000000.png` to `f00000089.png`, 13,672 bytes each (a still scene); the engine reports "90 frames at 30 FPS (movie length 00:00:03:00), recorded in 00:00:07 (42% of real-time speed)", CPU render 0.08 ms/frame, GPU 0.04 ms/frame, PNG encoding 43 ms/frame | 9 s |
| C. windowed | `godot --path game --quit-after 90` | exit 0, a window on the session's display for the run; no frames unless something captures the desktop | 5 s |

What a frame holds: the game's shell with its debug line (`content: 1 packages · lint: 0 hard, 31 warn`)
on the clear colour; TUA's `Main.tscn` draws nothing else without a scenario, which is the point of the
harness 34.2 builds (a scenario that loads a scene, drives inputs and names the moments to look for).

## The ruling 34.3 builds on

**Movie Maker (path B) is the capture path.** Reasons, each measured above:

- The engine writes the frames itself: no desktop capture, no window focus, no dependence on what else is on the screen.
- `--fixed-fps 30` makes time deterministic: every `_process` and `_physics_process` sees the same delta on every run, so a seeded scenario replays tick for tick, and `--quit-after <ticks>` bounds the run by frames, not by the clock.
- The cost is bounded and known: about 100 ms per 1080p frame all-in (encoding dominates), so a 90-tick scenario is a ten-second step on the host leg; a longer scenario should capture at a lower `--fixed-fps` or sample frames (the harness keeps every k-th frame and deletes the rest).
- A `--headless` run stays the right tool for the engine gate (import, tests), never for frames.

Preconditions the launch's readiness check (`tk-studio-launch check`) warns on, in this order: `$env:GODOT`
set and the file present; a display session on the host (Movie Maker needs a window, so the box must be
logged in; the RDP session counts, a locked console does not); the project's `.godot` import cache (the
host leg runs the import first); the Mono assembly built. A run without the display falls back to
`skipped (no display)`, never to a silent black frame.

## For the harness (34.2) and the leg (34.3)

- The frames land where Movie Maker is pointed: the run workspace (`~/.tk-studio/runs/<run>/playable/frames/`), one PNG per tick at the fixed FPS; `report.json` beside them names the ticks the scenario marked, so the judge can open the frame of each named moment by its index.
- `--quit-after` is the scenario's tick count plus the harness's warm-up ticks; the harness's own invariants decide the exit code (Movie Maker's exit is always 0 when the engine quits cleanly).
- Input injection per tick goes through `Input.ParseInputEvent` from the autoload at the start of `_process`, keyed by the scenario's tick index; the seed goes to `GD.Seed` and to the game's own RNG through whatever hook TUA exposes.
- Re-measure here before trusting a new Godot version: the WinGet upgrade of Godot changes the path under `$env:GODOT`.

## Re-running the measurement

```bash
bash "<scratchpad>/playable_measure.sh"      # clone or reset C:\agent-work\scratch\tua-playable, build, import, A, B, C
```

The script lives with the session's scratch files; the commands in the table are the whole recipe.
