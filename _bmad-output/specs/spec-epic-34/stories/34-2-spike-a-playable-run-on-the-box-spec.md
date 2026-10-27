---
title: 'Spike, a Playable Run on the Box'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: 'f516be8c0be5d5534057780f9ced874baf676555'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-2.md'
  - '{project-root}/_bmad-output/specs/spec-epic-34/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** 34.3's `playable-verify` leg needs one proven way to run the game on the agent PC for a bounded number of ticks under a seeded, scripted input scenario and come back with frames and a pass or fail, built on facts measured on this box rather than on the research's claims (Story 34.2, ST-139).

**Approach:** Ship `plugins/tk-studio/lib/playable.py run` (stdlib host-side runner that starts `$GODOT` with a `PlayableHarness` C# autoload), the harness as a template under `plugins/tk-studio/lib/godot/`, an advisory `playable path` row in `tk-studio-launch check`, the contract's 0.1.29 sentence, and `kb/playable-verify-on-the-box.md` whose measurements and ruling the operator fills on the host through the consult log.

### Acceptance criteria (transcribed verbatim from epics.md, Story 34.2)

- **AC1** — **Given** TUA on the box (Godot 4.7.2 Mono, the logged-in session's display) **When** `plugins/tk-studio/lib/playable.py run --directory <project> --scenario <file> --seed <n> --ticks <t> --out <dir>` runs on the host **Then** it starts the game with a `PlayableHarness` autoload (C#, shipped by the plugin as a template the project copies in; TUA carries it under `game/src/Debug`) that reads the scenario (JSON: named inputs per tick; invariants per tick such as "the player node exists", "no error line in the log", "the frame time stays under the budget"), drives the inputs deterministically from the seed, captures a frame from the active camera every k ticks, and quits 0 when every invariant held or 1 naming the first that failed; the run writes `<out>/report.json`, `<out>/frames/*.png` and `<out>/log.txt`, is bounded by a wall clock that kills an overrun, and ends in a status block (AD-11)
- **AC2** — **Given** the three rendering paths (the session's display, windowed; Movie Maker frames through `--write-movie`; `--headless`, which renders nothing) **When** the spike measures them on the box (the operator session runs the measurements on the host at the engine's request through the consult log, with the harness and `playable.py` the engine wrote) **Then** `kb/playable-verify-on-the-box.md` records which path produced frames, the time per tick and the pixel evidence, and names the one 34.3 uses (the story's ruling, in its consult log); `tk-studio-launch check` warns when that path's precondition is missing (no display session, no `$env:GODOT`)
- **AC3** — **Given** the lib suite **When** it runs **Then** `playable.py` is covered with a fake engine binary (the argv, the scenario parsing, the invariant verdicts, the wall clock); the harness depends on nothing in the studio, so a project can run it alone

## Boundaries & Constraints

**Always:**
- Engine binary is `--godot <path>` else `GODOT` from env (stripped); must be an absolute path to an existing file; never a bare `godot`. Unset / non-absolute / missing / not-a-file is a refusal (`status: blocked`, exit 2) naming it, worded like doctor's `engine` row (`tools/installer/cli/tk_studio_cli/doctor.py` `check_engine` :1076).
- Stdlib only (NFR9); `main()` calls `sys.stdout.reconfigure(encoding="utf-8")` (`test_utf8_guard`). Atomic writes (tmp + `os.replace`). Every headless surface ends in the AD-11 status block, never a question.
- Plan Settled shapes 1–5 (scenario schema, `report.json` schema, user args, launch-row wording, kb sections) bind exactly as written in `plans/34-2.md` §Settled shape.
- `playable path` row is advisory: `ok: True` always, never in `gaps`, placed right after `engine sandbox`.
- Contract change is additive inside 0.1.29: no version bump, no pin changes.
- `PlayableHarness.cs` depends on nothing in the studio and is inert without `--playable-scenario=`.

**Block If:**
- The Files list (plan §Files) would grow past its 11 entries (band L rule).
- An operator measurement answers and shows no path produces frames, or the ruled path is `movie` and Movie Maker cannot meet `capture_every` without changing Settled shape 2.

**Never:**
- Run Godot (or any engine binary) on this host; invent measurements, pixel evidence or a ruling.
- Touch `apps/` (supervisor), `.claude/`, `_bmad/`, TUA, `epics.md`, `stories.yaml`, SPEC.md, or anything under `supervision/`.
- Hand-edit `kb/index.md` (regenerate with `kb.py index`).
- Push, tag, release, bump versions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Harness pass | engine writes `report.json` verdict pass, exit 0 | exit 0, `status: complete`, report merged with `run` + `log_errors` | — |
| Harness fail | report verdict fail naming invariant+tick, exit 1 | exit 1, `status: partial`, `reason` names invariant and tick | — |
| No report | engine exits without writing report | exit 1, `partial`, `failed.invariant: "harness"`, detail `no report.json (exit <n>)` | runner writes report itself |
| Wall clock | engine overruns `--wall-clock` | process killed, exit 1, `failed.invariant: "wall-clock"`, `"<s>s exceeded"`, `run.timed_out: true` | kill then wait |
| Mismatch | pass+exit≠0, or exit 0+fail | exit 1, `partial`, reason names the mismatch | — |
| Error lines | `log.txt` has `ERROR:`/`SCRIPT ERROR:` under a pass with a `no_error_log` invariant | `log_errors[]` (first 20), verdict fail | — |
| Engine refusal | `GODOT` unset / relative / missing | exit 2, `blocked`, reason names `GODOT` | nothing started |
| Project refusal | no `project.godot`, or two `*/project.godot` | exit 2, `blocked`, reason names what was found | nothing started |
| Bad scenario / args | unknown `kind`, missing field, ticks ≤ 0, negative seed | exit 2, `blocked`, reason names the field | nothing started |

</intent-contract>

## Code Map

The plan's Code Map (`plans/34-2.md` §Code Map) is the investigation; it is authoritative for shapes and line anchors. Anchors verified on this baseline:

- `plugins/tk-studio/lib/playable.py` (new) -- runner. Verb `run`. argv `[GODOT, "--path", <godot dir>, <mode flags>, "--", "--playable-scenario=<abs>", "--playable-seed=<n>", "--playable-ticks=<t>", "--playable-out=<abs out>"]`; `--mode display|movie|headless` (default `PLAYABLE_PATH = "display"` until the ruling): display `--windowed --fixed-fps 60`, movie `--write-movie <out>/frames/movie.png --fixed-fps 60`, headless `--headless --fixed-fps 60`. Project dir: `--directory` has `project.godot` or exactly one `<dir>/*/project.godot`. Module-level injectable `run_engine(argv, *, cwd, log_path, timeout_s) -> (exit|None, timed_out, duration_ms)` streaming stdout+stderr to `<out>/log.txt`, `stdin=DEVNULL`. `--wall-clock` default 120. Status block keys last: `status`, `intent: "playable"`, `artifacts` (out-relative), `reason`. Exit 0/1/2. Keep user-arg names and report keys as module constants the template test greps for.
- `plugins/tk-studio/lib/launch.py` -- precedents: `run_cli` :141 (timeout, DEVNULL, utf-8 `errors="replace"`), `tracked_verify_commands` :358 (reads tracked `.tk-studio/config.yaml` via `miniyaml`), `_write_atomic` :475, `with_block` :569 (key order), `engine_sandbox_row` :615, `checks.append(engine_sandbox_row())` :717 (register the new row right after), module docstring guarantee bullets ~:50-55. Add `PLAYABLE_PATH`, injectable `display_session()` (Windows `ctypes.windll.user32.OpenInputDesktop` non-null then `CloseDesktop`; POSIX `DISPLAY`/`WAYLAND_DISPLAY`; exceptions → `warning: display session unknown (<error>)`), `playable_path_row(root, env=None)` with Settled shape 4 wording. No new imports beyond stdlib + `miniyaml`.
- `plugins/tk-studio/lib/godot/PlayableHarness.cs` (new) -- Godot 4 C# `public partial class PlayableHarness : Node`; behaviour per plan (inert check via `OS.GetCmdlineUserArgs()`, seeded RNG + `GD.Seed`, `_PhysicsProcess` tick inputs via `Input.ParseInputEvent(new InputEventAction{...})`, invariants `node_exists`/`frame_time_under`/`no_error_log` (custom `Logger` via `OS.AddLogger`), frames every `capture_every` to `<out>/frames/<tick:D6>.png` except movie mode, writes report, `GetTree().Quit(0|1)`). Header comment names the copy-in (`<project>/src/Debug/PlayableHarness.cs`, autoload `PlayableHarness="*res://src/Debug/PlayableHarness.cs"`).
- `plugins/tk-studio/lib/godot/scenario.example.json` (new) -- minimal valid scenario parsed by the test through `playable.py`'s validator.
- `plugins/tk-studio/lib/tests/test_launch.py` -- follow `_engine_row` helper pattern (~:1005-1030).
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- `test_0_1_29_story_34_1_engine_gate` :1956; add the 34.2 test beside it.
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 0.1.29 history cell, line 6 Story / rulings, `**0.1.29 (Story 34.1, additive).**` paragraph (~:405-430).
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- advisory-rows sentence (~:58).
- `kb/acceptance-record-34-1-engine-gate-on-tua.md`, `kb/studio-web-renderer-spike.md` -- frontmatter/section models for the new kb page.
- `plugins/tk-studio/lib/kb.py index` -- regenerates `kb/index.md`; heading derives from folder name, so run over a copy of `kb/` inside a folder named `tk-studio` and copy `index.md` back (34-1 precedent, recorded as DRIFT).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/playable.py` -- create the runner per Code Map and Settled shapes 1–3 -- AC1, AC3.
- `plugins/tk-studio/lib/godot/PlayableHarness.cs` -- create the template -- AC1, AC3 (studio-independent).
- `plugins/tk-studio/lib/godot/scenario.example.json` -- create a minimal valid scenario -- documented shape cannot drift.
- `plugins/tk-studio/lib/tests/test_playable.py` -- cover every I/O-matrix row with an injected `run_engine` that writes report/frames into `--playable-out` read from argv; argv per mode; real wall-clock test calling `run_engine` with `[sys.executable, "-c", "import time; time.sleep(30)"]`, `timeout_s=1` (killed, `timed_out`, duration < 10 s); status-block key order; out-relative artifacts; example scenario validates; template text names user args, report keys and the inertness check; `PLAYABLE_PATH` equal in `playable.py` and `launch.py` -- AC3.
- `plugins/tk-studio/lib/launch.py` -- add `PLAYABLE_PATH`, `display_session`, `playable_path_row`, register in `check`, docstring bullet -- AC2 (launch warning).
- `plugins/tk-studio/lib/tests/test_launch.py` -- row after `engine sandbox`, `ok` true, never a gap; cases: no `verify.engine`, `GODOT` unset, display missing (inject `display_session`), display raises, ready -- AC2.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- name `playable path` in the advisory-rows sentence; "report it; never start the engine" -- AC2.
- `plugins/tk-studio/contracts/driver-contract.md` -- one sentence for the `playable path` row in the 0.1.29 paragraph (naming `playable.py` as "the runner 34.3 drives"), Story 34.2 clause in line 5, Story 34.2 in line 6; no bump -- AD-19.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- `test_0_1_29_story_34_2_playable_path_row` -- pins the sentence and the Story / rulings entry.
- `kb/playable-verify-on-the-box.md` -- frontmatter `title`, `description`, `rank`, `scope: project`; sections: harness copy-in for TUA, exact measurement commands per `--mode`, `## Measurements` table (path, frames produced, non-blank pixel evidence, ms per tick, wall time, notes) with rows `not measured` until the operator answers, `## Ruling` (pending operator measurement; default `display`), the launch-check row -- AC2.
- `kb/index.md` -- regenerate via `kb.py index` (folder-name workaround).

**Acceptance Criteria:**
- Given the lib suite, when `uv run python -m unittest discover tests` runs from `plugins/tk-studio/lib`, then it is green including `tests.test_playable`, `tests.test_launch`, `tests.test_driver_contract`, `tests.test_utf8_guard`, `tests.test_installer_bootstrap`.
- Given a tmp directory without `project.godot`, when `uv run playable.py run --directory <tmp> --scenario godot/scenario.example.json --seed 1 --ticks 10 --out <tmp2>` runs (with `GODOT` pointing at an existing absolute file), then it exits 2 with the status block last and `status: blocked`.
- Given conformance, when `uv run python ../contracts/conformance/runner.py run` runs, then `ok: true` (the new row does not change the launch drives' verdicts).
- Given TUA on the box, when the operator runs the kb record's commands per mode, then `## Measurements` and `## Ruling` are filled — `unverifiable-here` in this run (engine never runs on the host).

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11 (high 0, medium 4, low 7)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` harness `_LogError` counted Godot warnings as errors → warnings skipped; `_LogMessage` limited to `ERROR:`/`SCRIPT ERROR:` lines (runner regex)
  - `[medium]` `[patch]` deferred scene change let `node_exists` fail at tick 0 → ticks start once the scenario scene is current; missing scene or 600-frame timeout fails invariant `scene`
  - `[medium]` `[patch]` a harness pass with no frames was accepted → `display`/`movie` pass with empty or missing `frames[]` fails invariant `frames` (`headless` exempt)
  - `[medium]` `[patch]` wall-clock kill ended only the console wrapper → `kill_tree()` (Windows `taskkill /T /F`, POSIX new session + `killpg`), grandchild test
  - `[low]` `[patch]` random press shortened a scripted hold → skipped when already held
  - `[low]` `[patch]` host log override ignored `no_error_log.from_tick` → applies only for `from_tick` 0
  - `[low]` `[patch]` stale `<out>/frames/*.png` survived → cleared before start
  - `[low]` `[patch]` `--out` inside the Godot project accepted → refused (exit 2)
  - `[low]` `[patch]` physics-rate precondition undocumented → `.cs` header and kb copy-in step
  - `[low]` `[patch]` `ticks_run` reported 1 when no tick ran → 0
  - `[low]` `[patch]` seed/ticks/scenario ints beyond harness parse types → refused naming the field

### 2026-10-27 — Review pass
- review content: `git diff f516be8c0be5d5534057780f9ced874baf676555` excluding this spec file (2244 lines), passed to both layers by path (`/tmp/review-34-2/diff.patch`) rather than inlined; both layers ran (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 11 (high 0, medium 2, low 9)
- defer: 0
- reject: 3
- rejected: harness never checks frames are non-blank at run time and a run without a display does not end `skipped` — Settled shape 2 has only `pass`/`fail`, and AC2 puts the display precondition on the advisory launch row; the movie tick-to-frame offset — a known on-box measurement question, already recorded as a residual risk and 34.3 dependency; "no evidence: harness never compiled, paths not measured" — AC1's on-box run and AC2's harness re-measurement are `unverifiable-here` (operator action), already recorded
- addressed_findings:
  - `[medium]` `[patch]` last tick's invariants never re-checked (game nodes log after the autoload's `_PhysicsProcess`) → `FinalCheck()` runs one more physics frame after the last tick, failing at tick `ticks-1`
  - `[medium]` `[patch]` movie capture on the final/failing tick named a frame `Quit` prevented from being drawn → `Quit` deferred until after `RenderingServer.FramePostDraw` (bounded by `DrawWaitFrames = 30`); headless quits at once
  - `[low]` `[patch]` display capture read the previous frame and silently skipped tick 0 → captures queued and taken after the next draw; report written after the last draw in display mode
  - `[low]` `[patch]` `physics_ticks_per_second = 60` only documented → harness fails invariant `scenario` at tick 0 on any other rate
  - `[low]` `[patch]` "a seed replays tick for tick" overclaimed → `.cs` header and kb say the seed reaches `GD.Seed` and the harness's input RNG only; the game's own RNG needs a project hook
  - `[low]` `[patch]` `--wall-clock inf`/`nan`/huge accepted (unbounded run; Windows `OverflowError` without a status block) → refused unless finite and `<= MAX_WALL_CLOCK_S` (86400) (both layers, deduplicated)
  - `[low]` `[patch]` scenario `schema: true` / `1.0` accepted → must be the int 1
  - `[low]` `[patch]` `NaN`/`Infinity`/overflowing floats accepted by Python but rejected by the harness → refused before the engine starts
  - `[low]` `[patch]` merged `report.json` write `OSError` was a traceback → `partial`, exit 1, status block, reason `report.json not written: <error>`
  - `[low]` `[patch]` unconfirmed Windows `taskkill /T` reported nothing → `kill_tree` returns confirmation; wall-clock detail gains ` (process tree kill not confirmed)` (no new report key)
  - `[low]` `[patch]` contract `playable path` sentence omitted `warning: display session unknown (<error>)` → added, and pinned in `test_0_1_29_story_34_2_playable_path_row`

### 2026-10-27 — Review pass
- review content: `git diff f516be8c0be5d5534057780f9ced874baf676555` excluding this spec file (2645 lines), passed to both layers by path (`/tmp/review-34-2/diff.patch`); both layers ran (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 2, low 3)
- defer: 0
- reject: 1
- rejected: `frame_time_under` "measures only `_process`" — the plan's Code Map pins `Performance.Monitor.TimeProcess`, which Godot documents as the time to complete one frame; no defect established
- addressed_findings:
  - `[medium]` `[patch]` runner started a project with no `PlayableHarness` autoload (game plays to the 120 s wall clock; misleading `wall-clock` fail, movie mode floods PNGs) → `require_harness_autoload` refuses (exit 2) before anything starts; unreadable `project.godot` also refused
  - `[medium]` `[patch]` host scan failed a correct pass on Godot shutdown `ERROR:` lines printed after the verdict (both layers) → harness prints `PLAYABLE: harness detached` (stderr) before `OS.RemoveLogger`; the override counts only pre-marker lines (whole log without the marker); `log_errors[]` still lists every line
  - `[low]` `[patch]` harness counted `SHADER ERROR:` lines the runner regex missed → `ERROR_LINE` and harness `_LogMessage` share all three prefixes
  - `[low]` `[patch]` a `WriteReport` exception skipped `Quit` (hang to the wall clock) → `TryWriteReport` always reaches `Quit`, exit 1
  - `[low]` `[patch]` standalone run with missing/relative `--playable-out` wrote into the project tree → harness quits 1 before creating anything

## Design Notes

- AC1's "Given TUA on the box" and AC2's measurement are host proofs: the engine never runs Godot on the host (epic narrative). The house rule makes an operator-action criterion `unverifiable-here` with the exact command recorded; the plan's fallback ("end with the kb `## Measurements` rows marked `not measured` and AC2 `unverifiable-here`, and mark the 34.3 dependency on the ruling") applies. A consult-log request for the three measurements is appended before the terminal report.
- `movie` mode: Movie Maker writes `movie.png` → `movie00000000.png…` per frame; the harness skips its own capture in movie mode. Cadence vs `capture_every` is a measurement question (Block If above).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_playable tests.test_launch tests.test_driver_contract tests.test_utf8_guard tests.test_installer_bootstrap -v` -- expected: OK
- `git diff --stat -- .claude _bmad apps` -- expected: empty

## Deviation Summary

### pass 1 (2026-10-27, implementer)

- planned: `PLAYABLE_PATH = "display"` until the ruling; kb page created new with `## Measurements` rows `not measured` and `## Ruling` pending / actual: `PLAYABLE_PATH = "movie"` in `playable.py` and `launch.py`; the baseline page (commit 515fe869a5d28c5d4526cb4d03e7fb8de7c430ab, the operator's measurement on TIM-PC-2) restructured into the spec's sections keeping every measured row and its Movie Maker ruling; only the harness-based `playable.py` runs marked `not measured` / why: the measurement and ruling already existed in the baseline; the plan says to change the default when the ruling picks another path / may affect: 34-3-the-playable-verify-leg (builds on `movie`; launch row reads "the movie path")
- planned: implementer appends the consult-log measurement request / actual: not appended by the implementer (spec is orchestrator-owned); the orchestrator appends it / why: session ownership rule / may affect: 34-3-the-playable-verify-leg
- planned: no pin changes in `test_driver_contract.py` beyond the new test / actual: 34.1 test assertion `"Story 33.2 (Epic 33), Story 34.1 (Epic 34)"` re-pinned to `"Story 33.2 (Epic 33), Story 34.1"` (row now reads `Story 34.1, Story 34.2 (Epic 34)`) / why: plan's re-pin rule / may affect: none
- planned: harness frames every `capture_every` ticks / actual: also captures at each moment's tick and at the failing tick; refuses InputMap actions the project lacks (`failed.invariant: "scenario"`) / why: `moments[].frame` non-null for off-cadence moments (34.3's rubric reads it) / may affect: 34-3-the-playable-verify-leg (`frames[]` may include extra ticks)
- planned: I/O matrix only / actual: stale `<out>/report.json` deleted before start; unreadable report or non pass/fail verdict is a `harness` fail; spawn `OSError` is a refusal (exit 2) / why: an old report never counts as this run's verdict; every path ends in a status block / may affect: none

DRIFT: `PLAYABLE_PATH` default `movie`, kb page restructured not created — the operator's measurement and Movie Maker ruling already existed in the baseline (515fe86) — affects: 34-3-the-playable-verify-leg
DRIFT: consult-log measurement request written by the orchestrator, not the implementer — spec ownership — affects: none
DRIFT: 34.1 Story / rulings pin in `test_driver_contract.py` re-pinned — the row gained Story 34.2 — affects: none
DRIFT: harness also captures at moment ticks and the failing tick; refuses unknown InputMap actions — moments need frames — affects: 34-3-the-playable-verify-leg
DRIFT: stale report removed before start; unreadable report and spawn OSError handled — no stale verdicts, status block on every path — affects: none

### pass 2 (2026-10-27, review patches)

- planned: filter warnings in `_LogError` / actual: also `_LogMessage` limited to `ERROR:`/`SCRIPT ERROR:` lines (plain `printerr` no longer fails `no_error_log`) / why: match the runner's `ERROR_LINE` / may affect: none
- planned: findings 2, 3 as written / actual: scripted `pressed:false` clears a pending release; release tick capped at int max; missing scene (`ResourceLoader.Exists` false) fails `scene` immediately / why: robustness beside the int32 bounds / may affect: none
- planned: int32 bounds on tick, from_tick, hold_ticks, capture_every / actual: also `random_inputs.every` / why: harness reads it with `GetInt32` / may affect: none
- pass-2 DEVIATION SCORE: 1 (consult: accept score 1); story `deviation_score` stays 2 (pass 1)

DRIFT: harness `_LogMessage` records only `ERROR:`/`SCRIPT ERROR:` lines — one definition of "error line" for harness and runner — affects: none
DRIFT: scripted release clears pending release, release tick capped, missing scene fails at once, `random_inputs.every` int32-bounded — robustness beside the review patches — affects: none

### pass 3 (2026-10-27, follow-up review patches)

- planned: final invariant pass, no new frame sample / actual: `FinalCheck` samples `TimeProcess` into `frame_time_ms` (a full run's mean averages `ticks + 1` samples) / why: a `frame_time_under` failure there must show in `max` / may affect: none (shape `{max, mean}` unchanged)
- planned: deferred quit after the next draw / actual: bounded by `DrawWaitFrames = 30`; on timeout with display captures pending the harness fails invariant `frames` ("<n> capture(s) not drawn within 30 frames") at the last pending tick (consult DO) / why: anything that could hang is bounded; a pass claims only frames on disk / may affect: none
- planned: report-write `OSError` → `partial` with the block / actual: `artifacts` omits `report.json` (lists `log.txt`, `frames/`), `ok: false` / why: the merged report is not on disk / may affect: none
- planned: thread tree-kill confirmation through `run_engine` / actual: module flag `LAST_TREE_KILL_CONFIRMED` + `judge(..., tree_kill_confirmed=True)` keyword; `run_engine` signature unchanged / why: keeps the injectable signature the plan pins / may affect: none
- planned: `--wall-clock` refusal naming the flag / actual: wording `--wall-clock <v> must be a finite number of seconds > 0 and <= 86400` / why: patch 6 / may affect: none
- planned: one display-mode fake-engine test (consult DO) / actual: also an optional `mode` keyword (default `"movie"`) on test helper `FakeEngine` / why: the fake hard-coded `movie` / may affect: none (consult: score 0)
- pass-3 DEVIATION SCORE: 1 (consult: accept score 1; the `FakeEngine` keyword score 0); story `deviation_score` stays 2 (pass 1)

DRIFT: harness re-checks invariants one physics frame after the last tick and samples its frame time — errors logged by game nodes in the final tick must count — affects: none
DRIFT: harness quit deferred until after the next draw, bounded by `DrawWaitFrames = 30`, a dropped display capture fails `frames` — the last frame must be written before quit; a pass claims only frames on disk — affects: 34-3-the-playable-verify-leg (display frames are taken after the draw, so a frame at tick t shows tick t's state)
DRIFT: report-write failure lists only `log.txt` and `frames/` in `artifacts`; tree-kill confirmation carried by a module flag and a `judge` keyword — `report.json` is not on disk; the pinned `run_engine` signature stays — affects: none

### pass 4 (2026-10-27, review patches)

- planned: change only the existing runner entry points / actual: public `scan_log_split()` (returns whole-log first-20 and pre-marker error lines; `scan_log()` keeps its signature) and optional `judge(..., guard_errors=)` keyword / why: the verdict needs the pre-marker lines while `log_errors` keeps every line as evidence / may affect: none
- planned: none / actual: `require_harness_autoload` refuses (exit 2) an unreadable `project.godot`, with a test (consult DO) / why: an unreadable file must not crash the runner / may affect: none
- planned: plan Code Map "an error line under a harness pass with a `no_error_log` invariant is a fail" / actual: only error lines before the harness end marker count for the override / why: AC1's invariants are per tick; shutdown lines belong to no tick / may affect: 34-3-the-playable-verify-leg
- kb: one body sentence (copy-in step 2) says `playable.py` refuses a project without the autoload; frontmatter unchanged, so `kb/index.md` unchanged
- pass-4 DEVIATION SCORE: 1 (consult: accept score 1); story `deviation_score` stays 2 (pass 1)

DRIFT: host no_error_log override counts only ERROR_LINE lines before `PLAYABLE: harness detached` (no marker = whole log); log_errors[] still lists every error line, so a pass can carry a non-empty log_errors — Godot's shutdown error lines belong to no tick and failed correct runs — affects: 34-3-the-playable-verify-leg (its judge reads `verdict`, never `log_errors` emptiness)
DRIFT: runner refuses (exit 2) a project with no `PlayableHarness` autoload or an unreadable `project.godot`; `ERROR_LINE` also matches `SHADER ERROR:` — a missing harness ran to the wall clock; one error-line definition for harness and runner — affects: none

## Consult Log

- 2026-10-27T07:34Z — trigger: deviation-gt-0 — question: accept `PLAYABLE_PATH = "movie"` and the restructured kb page given the operator's baseline measurement+ruling (515fe86), or revert to `display`/pending, or halt for a restated ruling? — ruling: accept-deviation score 2 — do: keep `movie` in playable.py and launch.py and the restructured kb page; cite `515fe86:kb/playable-verify-on-the-box.md` "The ruling 34.3 builds on" as the operator ruling behind the default (plan :24); request the three harness-based `playable.py` runs from the operator; finish `done` with AC1's on-box run and AC2's harness re-measurement `unverifiable-here`, mark the 34.3 dependency (builds on `movie`; movie-frame offset checked on first harness run); do not HALT — rule candidate: when an operator measurement or ruling for the story's open decision is already in the baseline, the planner cites it by commit:file:line and plans the default from it; the pending skeleton is only for truly missing measurements
- 2026-10-27T07:34Z — RULING (the story's ruling, AC2): 34.3 uses `movie` (Movie Maker, `--write-movie` PNG at a fixed FPS), per the operator's measurement on TIM-PC-2, `515fe869a5d28c5d4526cb4d03e7fb8de7c430ab:kb/playable-verify-on-the-box.md` §"The ruling 34.3 builds on": the engine writes the frames itself (90 × 1920×1080 PNGs, ~100 ms/frame), headless draws nothing, windowed yields no frames without desktop capture. Precondition: `GODOT` absolute file + a logged-in display session.
- 2026-10-27T07:34Z — REQUEST to the operator session (host measurement, harness-based): on TIM-PC-2, copy `plugins/tk-studio/lib/godot/PlayableHarness.cs` into a scratch TUA clone at `game/src/Debug/`, register the autoload, build, import, then run `uv run plugins/tk-studio/lib/playable.py run --directory <tua clone> --scenario <scenario> --seed 1 --ticks 90 --out <out> --mode <movie|display|headless>` once per mode (exact commands in `kb/playable-verify-on-the-box.md` "Measurement commands per path"); fill the `not measured` rows of `## Measurements` (frames, non-blank pixel evidence, ms per tick, wall time) and confirm or amend the ruling; first run is also the C# compile check.
- 2026-10-27T07:50Z — trigger: deviation-gt-0 (review-patch pass) — question: accept the implementer's extras beyond the asked patches (`_LogMessage` prefix filter, release/scene robustness, `random_inputs.every` bound)? — ruling: accept-deviation score 1 — do: keep (a)(b)(c), no schema change; add tests for a plain `printerr` line not failing `no_error_log` and a missing scene giving invariant `scene` — rule candidate: in the epic-34 customization, "error line" in any playable invariant means only a line matching the runner's `ERROR_LINE` regex, shared by the harness logger; plain stderr and warnings never count

- 2026-10-27T08:04Z — trigger: deviation-gt-0 (follow-up review-patch pass 2) — question: accept the implementer's extras beyond the 11 follow-up patches ((a) FinalCheck samples TimeProcess, (b) DrawWaitFrames=30 quit fallback dropping pending display captures, (c) report-write OSError omits report.json from artifacts, (d) LAST_TREE_KILL_CONFIRMED flag + judge keyword, (e) --wall-clock refusal wording)? — ruling: accept-deviation score 1 — do: keep (a)(c)(d)(e); keep (b) but in the draw-wait timeout branch, when mode is display and captures are pending and no failure is set, fail invariant `frames` ("<n> capture(s) not drawn within 30 frames") at the last pending tick so the run quits 1; add one fake-engine test (harness pass, exit 0, last capture missing → exit 1, `partial`, `frames`) — rule candidate: any harness fallback that skips a promised artifact (frame, capture, report) fails a named invariant, never quits 0; a pass claims only artifacts on disk
- 2026-10-27T08:08Z — trigger: deviation-gt-0 (pass 3, consult DO lines) — question: accept the optional `mode` keyword (default `"movie"`) added to the test helper `FakeEngine` so the consult-directed display-mode test can be written? — ruling: accept-deviation score 0 — do: keep the keyword and `test_a_display_pass_whose_last_capture_was_dropped_fails_frames` as written; record pass-3 DEVIATION SCORE 0; leave story `deviation_score` at 2 — rule candidate: a test-helper parameter in a Files-listed test file, defaulting to the old behaviour and existing only to write a story- or consult-asked test, is score 0 and needs no consult

- 2026-10-27T08:22Z — trigger: deviation-gt-0 (pass 4, review patches) — question: accept the implementer's extras beyond the 5 review patches ((a) public `scan_log_split()` + optional `judge(guard_errors=)` keyword, (b) exit-2 refusal on an unreadable `project.godot`), and does the end-marker exclusion (patch 2) need a DRIFT? — ruling: accept-deviation score 1 — do: keep (a) and (b); make sure tests cover an error line after the marker on a pass (pass, still in `log_errors`), the same line with no marker (fail), and an unreadable `project.godot` (exit 2), adding any missing; record one DRIFT for patch 2 (host `no_error_log` override counts only `ERROR_LINE` lines before `PLAYABLE: harness detached`, whole log without a marker; `log_errors[]` still lists every error line, so a pass can carry a non-empty `log_errors` — affects: 34.3 judge); do not change `report.json` keys or verdict values — rule candidate: in the epic-34 customization, an "error line" for `no_error_log` is a line matching the runner's `ERROR_LINE` that appears before the harness's `PLAYABLE: harness detached` marker (the whole log if there is no marker); `log_errors[]` is evidence only and never by itself decides the verdict (observation recorded)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift ok; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass (pass 4) on the `done` story, with `review_loop_iteration` at 0. Both layers reviewed the full change since baseline `f516be8`. Five patches were applied and one finding was rejected. No report key, verdict value or user arg changed (Settled shape 2 and 3), and the contract stays at 0.1.29.
- **Autoload check (medium):** `playable.py run` refuses (exit 2, `blocked`) a project whose `project.godot` has no `[autoload] PlayableHarness` entry, or can't be read, before anything starts.
- **Shutdown error lines (medium):** the harness prints `PLAYABLE: harness detached` to stderr just before it detaches its logger. The host `no_error_log` override counts only error lines before that marker, or the whole log when there is no marker. `log_errors[]` still lists every line.
- **Low patches:**
  - `SHADER ERROR:` now counts as an error line in both the runner and the harness.
  - A failed `report.json` write in the harness still quits, with exit 1.
  - The harness quits 1 when `--playable-out` is missing or relative.

**Files changed (this pass).**
- `plugins/tk-studio/lib/playable.py`: `HARNESS_AUTOLOAD`/`HARNESS_AUTOLOAD_LINE`, `require_harness_autoload`, `HARNESS_DETACHED`, `scan_log_split`, `judge(guard_errors=)`, the `ERROR_LINE` shader prefix, and the docstrings.
- `plugins/tk-studio/lib/godot/PlayableHarness.cs`: `DetachedMarker` printed in `Quit()`, `TryWriteReport`, the `--playable-out` guard in `_Ready`, `SHADER ERROR:` in `_LogMessage`, and the comments.
- `plugins/tk-studio/lib/tests/test_playable.py`: 9 new tests (autoload refusals, CRLF/BOM autoload, unreadable `project.godot`, end marker before/after/absent, the shader line, template pins), the autoload in the fixture `project.godot`, and `FakeEngine` `marker`/`after_marker` options.
- `kb/playable-verify-on-the-box.md`: one sentence in copy-in step 2. The frontmatter is unchanged, so `kb/index.md` is unchanged.

**Review.**
- **Patches:** 5 applied (high 0, medium 2, low 3).
- **Deferred:** 0.
- **Rejected:** 1. The `TimeProcess` frame-time claim: the plan pins that monitor, and Godot documents it as frame time.
- **Follow-up review recommended: true.** The patched findings were medium 2 and low 3, which scores 3×2 + 1×3 = 9, and 9 is 5 or more.
- **Consults:** 1, on `deviation-gt-0`. It accepted score 1, added the unreadable-`project.godot` test and recorded the end-marker DRIFT.

**Verification.**
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: `Ran 2143 tests`, OK (skipped=2).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, failures `[]`.
- `uv run python -m unittest tests.test_playable tests.test_launch tests.test_driver_contract tests.test_utf8_guard tests.test_installer_bootstrap`: `Ran 210 tests`, OK.
- `playable.py run --directory <tmp without project.godot> --scenario godot/scenario.example.json --seed 1 --ticks 10 --out <tmp>`, with `GODOT` set to an existing absolute file: exit 2, `status: blocked`, and the status block is last.
- `git diff --stat -- .claude _bmad apps`: empty.

**unverifiable-here (operator, agent PC).** These are unchanged from the earlier passes:
1. Copy `plugins/tk-studio/lib/godot/PlayableHarness.cs` to `<tua clone>/game/src/Debug/PlayableHarness.cs`.
2. Register `[autoload] PlayableHarness="*res://src/Debug/PlayableHarness.cs"`, and confirm `physics_ticks_per_second = 60`. `playable.py` now refuses a project without that autoload.
3. Build with `dotnet build game/TUA.Game.csproj -c Debug`, and import with `& $env:GODOT --headless --path game --import --quit`.
4. Run `uv run plugins/tk-studio/lib/playable.py run --directory <tua clone> --scenario <scenario> --seed 1 --ticks 90 --out <out outside game/> --mode movie`.
5. Repeat step 4 with `--mode display`, then with `--mode headless`.
6. Fill `## Measurements` and confirm `## Ruling` in `kb/playable-verify-on-the-box.md`. The first run is also the C# compile check.

**Residual risks.**
- **Never compiled:** the C# template has still not been compiled. New this pass: `GD.PrintErr` ordering against engine error lines in the merged log stream. Godot's own stderr is unbuffered, but on Windows the console exe may buffer differently.
- **Earlier risks, unchanged:** the `FramePostDraw`/deferred `Quit` API, the 30-frame draw-wait bound in display mode, the Windows `taskkill /T` path, and the movie tick-to-frame offset.

DRIFT: host no_error_log override counts only ERROR_LINE lines before `PLAYABLE: harness detached` (no marker = whole log); log_errors[] still lists every error line, so a pass can carry a non-empty log_errors — Godot's shutdown error lines belong to no tick and failed correct runs — affects: 34-3-the-playable-verify-leg (its judge reads `verdict`, never `log_errors` emptiness)
DRIFT: runner refuses (exit 2) a project with no `PlayableHarness` autoload or an unreadable `project.godot`; `ERROR_LINE` also matches `SHADER ERROR:` — a missing harness ran to the wall clock; one error-line definition for harness and runner — affects: none

## Reconcile

### 2026-10-27 — adjust-stories

- Score: 2
- Reasoning: Four DRIFTs name 34-3: the ruled path is `movie` (cited from the operator's baseline measurement 515fe86, not re-measured with the harness); `frames[]` also carries moment and failing-tick frames; display frames are taken after the draw; the host `no_error_log` override counts only error lines before `PLAYABLE: harness detached`, so a `pass` can carry a non-empty `log_errors[]`. None changes a 34.3 Given/When/Then: 34.3 calls `playable.py run` and reads `report.json` and the frames, all as Settled shapes 2 and 3 define them. Its dev session needs these facts in `invoke_dev_with` (the judge must read `verdict`, not `log_errors` emptiness; movie mode needs the logged-in desktop). Contract stays additive at 0.1.29; no AD or ruling contradicted.
- Affected: 34-3-the-playable-verify-leg — "the host leg runs 34.2's `playable.py run` in the worktree … drives the judge … that reads only `report.json` and the frames" (holds; needs the path, refusal and `log_errors` facts as notes)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 34-3-the-playable-verify-leg
