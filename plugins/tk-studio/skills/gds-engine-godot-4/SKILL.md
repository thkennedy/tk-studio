---
name: gds-engine-godot-4
description: Read-only engine knowledge for Godot 4 C# projects tested with GoDotTest (Story 34.4) — the project's pinned engine version (project.godot config/features and global.json's Godot.NET.Sdk, checked against this skill's supported range), the headless flags, the C# and GoDotTest conventions, the rule that .tscn/.tres files are written only the way the editor writes them, the import-cache rule, the box's `$env:GODOT` rule and where the engine gate runs. Use when working in a Godot 4 project, or the user asks "which Godot version is this project on", "how do I run Godot headless here", or "can I edit this .tscn".
---

# gds-engine-godot-4

Read-only engine knowledge. This skill changes nothing in the project: it
states the pinned version and the rules a dev session follows in a Godot 4
C# project, so the session works from the project's facts instead of model
priors (an API that changed between minors, a hand-edited scene, a bare
`godot` that does not exist on the box).

## The pinned facts (run the core first)

Run the deterministic core before answering anything version-dependent, and
answer from its output, never from memory:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/lib/engine_pin.py" check --directory "<project root>"
```

It reads, and reports:

- `features_version`: the engine version from `project.godot`'s
  `[application]` `config/features=PackedStringArray("4.7", ...)` (the
  first `major.minor` element);
- `godot_net_sdk`: `global.json`'s `msbuild-sdks."Godot.NET.Sdk"` (for
  example `4.7.2`), and `dotnet_sdk`: `global.json`'s `sdk.version` (the
  .NET SDK, reported, never range-checked);
- `pinned`: `godot_net_sdk` when it parses as a dotted version, else
  `features_version` when that parses;
- `supported` and `in_range`: this skill's range from its `pin.json`
  (`4.7` up to, not including, `4.8`; tested on `4.7.2`);
- `warnings[]`: a pin outside the range, `config/features` and
  `Godot.NET.Sdk` disagreeing on major.minor, a `Godot.NET.Sdk` value that
  is not a version, or `pinned version unreadable`.

A warning is never silent: name it to the operator before relying on any
version-specific rule below. Outside the range, this knowledge may be wrong
for the project's engine; say so and prefer the engine's own docs for that
minor. A `blocked` result (`no project.godot`, `unknown skill`,
`malformed global.json`) ends the run `blocked` with that reason.

## The headless flags

- `--headless`: no window, no GPU device; every unattended engine call
  carries it.
- `--path <dir>`: the project folder (the one holding `project.godot`).
- `--import`: (re)import the project's assets, then quit; the headless
  import is the first half of the engine gate. `--editor --quit` is the
  older equivalent some gate scripts use.
- `--quit`: exit after the first iteration (a smoke boot:
  `--headless --path <dir> --quit`).
- `--build-solutions`: build the C# solution before running.
- `--version`: print the engine version and exit (the box check).

## C# and GoDotTest conventions

- The game is a Godot .NET (mono) project: the `.csproj` uses the
  `Godot.NET.Sdk` the `global.json` pins; never change that SDK version
  without the engine binary changing with it.
- Nodes are `partial` classes deriving from a Godot type; exported members
  carry `[Export]`; signals are `[Signal]` delegates named `...EventHandler`.
  Call engine APIs from the main thread.
- Tests are GoDotTest suites: classes deriving from `TestClass`, with the
  `[Test]` (and `[Setup]`/`[Cleanup]`) attributes, run inside the engine by
  the project's test entry point (the scene or flag the project's gate
  passes), not by `dotnet test`. The GoDotTest run is the second half of the
  engine gate and its summary line (`Test results: Passed: N | Failed: N`)
  is the evidence.

## Scenes and resources: `.tscn` and `.tres`

`.tscn` and `.tres` files are written only the way the editor writes them.
Never hand-edit the serialised text (ids, `uid://` references, sub-resource
ordering and `load_steps` are the editor's bookkeeping). Change a scene
through the editor, through the engine MCP the project uses, or through code
that instances and configures nodes at runtime.

## The import cache

`.godot/` is generated: never commit it and never hand-edit it (the
`.import` sidecars beside assets are the project's, and are committed).
After an asset change, re-import headless (`--headless --path <dir>
--import`) before running the game or the tests.

## The box rule: `$env:GODOT`

- On the host (the Windows agent PC), call the engine as
  `& $env:GODOT ...`: `GODOT` is the absolute path to the console exe
  (`Godot_v4.7.2-stable_mono_win64_console.exe`). A bare `godot` does not
  resolve there (and WinGet's GUI build hangs headless). Check it with
  `& $env:GODOT --version`.
- A bare `godot` exists only in a sandbox provisioned `WITH_GODOT` (the
  Linux Godot, runbook §3), where `godot` is on PATH and `$GODOT` is set.
  Project gate scripts call `${GODOT:-godot}` so both work.

## Where the engine gate runs

The engine gate (headless import, then the GoDotTest suite) goes in
`engine.verify_commands` (the in-sandbox list, Story 33.5) only when the
engine sandbox was provisioned `WITH_GODOT`; otherwise it goes in
`verify.engine` in `.tk-studio/config.yaml`, and the host leg (Story 34.1)
runs it on the host after a green `verify.host`. The two keys are never
merged; the host leg runs `verify.engine` whenever it is set, so a command
in both keys runs in both places. The launch check's `verify commands` row
names the placement (`engine gate: sandbox and host leg
(engine.verify_commands, verify.engine)`, `engine gate: host leg
(verify.engine, Story 34.1)`, or `engine gate: sandbox list only
(engine.verify_commands; not identified without verify.engine)` when only
the sandbox list is set) and warns when a project carrying this skill sets
neither.

## The engine MCP catalogue (cited, never forked)

The Godot MCP servers are catalogued upstream by GDS in
`.claude/skills/gds-game-architecture/engine-mcps.yaml` (the `godot:` block,
upstream-owned, AD-1). Read the catalogue there; this skill copies none of
its entries, and choosing one per project is the catalogue's and the
architecture workflow's job.

## Behavior (headless)

1. Run `engine_pin.py check` (above) on the payload's `directory`.
2. Answer the question from its output and the rules above, naming every
   warning.
3. End with the status block:

   ```json
   {"status": "complete", "intent": "gds-engine-godot-4", "artifacts": [], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Read-only: never write project files, scenes, resources or config.
- Never prompt or ask: everything arrives in the payload (`directory`);
  a missing `directory` is a `blocked` status (AD-11).
- All plugin paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
