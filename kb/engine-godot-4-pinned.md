---
title: Engine knowledge pinned per project — the gds-engine-godot-4 skill (Story 34.4)
description: Story 34.4's record. The plugin-shipped read-only skill gds-engine-godot-4 and its core lib/engine_pin.py — how a Godot project's version is read (project.godot config/features, global.json Godot.NET.Sdk and sdk.version) and checked against the skill's pin.json range, how onboarding proposes the skill with evidence and warnings, the box's $env:GODOT rule, and where the engine gate goes (engine.verify_commands only in a WITH_GODOT sandbox, otherwise verify.engine on the host leg).
rank: 63
scope: project
---

# Engine knowledge, pinned per project (Story 34.4)

A dev session on a Godot game works from model priors unless the engine's
facts are in its context. The studio ships those facts as a skill inside
the tk-studio plugin, `plugins/tk-studio/skills/gds-engine-godot-4/`. It is
read-only knowledge: it never writes the project.

## How the skill reaches a session

The whole plugin folder is the skills mount (`tk-studio@skills-dir`,
mounted read-only into the engine sandbox), so the skill reaches every dev
session as `tk-studio:gds-engine-godot-4` once a plugin release carrying it
is installed. No working set gates the mount. The roster
(`plugins/tk-studio/.claude-plugin/released-roster.json`) lists it, and the
activate drift check enforces the roster.

The skill keeps GDS's `gds-` naming because the engine MCP catalogue stays
upstream: it cites `.claude/skills/gds-game-architecture/engine-mcps.yaml`
(AD-1) and copies none of its entries.

## The pinned version

```bash
uv run plugins/tk-studio/lib/engine_pin.py check --directory <project>
```

- `features_version`: the first `major.minor` element of `project.godot`
  `[application]` `config/features=PackedStringArray(...)`.
- `godot_net_sdk`: `global.json` `msbuild-sdks."Godot.NET.Sdk"`;
  `dotnet_sdk`: `global.json` `sdk.version` (reported, never range-checked).
- `pinned`: `godot_net_sdk` when it parses as a dotted version, else
  `features_version` when that parses.
- `supported`: the skill's `pin.json`,
  `{"engine": "godot", "supported": {"min": "4.7", "below": "4.8"}, "tested": "4.7.2"}`.
  Widening the range is a data edit, made only after the skill's knowledge
  has been checked against the new minor.

Warnings, never a silent mismatch: a pin outside `[min, below)`, a
major.minor disagreement between `config/features` and `Godot.NET.Sdk`,
a `Godot.NET.Sdk` value that is not a version, `pinned version unreadable`.
Refusals (`blocked`, exit 2): `no project.godot`, `unknown skill`,
`malformed global.json`.

## Onboarding

On a `confident` `game-godot` detection, `recommend.py propose` adds the
skill (`kind: skill`, `status: installed`) with `detection:` and
`engine-pin:` evidence. Any warning lands on the entry's `warnings[]` and
in the proposal's `notes` prefixed `gds-engine-godot-4: `; the skill is
still proposed, and the operator sees the warning before confirming.
`record` lands it in `working_set.<role>` only when confirmed.

## The box rule

On the host, call the engine as `& $env:GODOT ...`: `GODOT` is the absolute
path to the console exe (`Godot_v4.7.2-stable_mono_win64_console.exe`,
[runbook](agent-pc-setup-runbook.md) §2). A bare `godot` does not resolve on
the host. It exists only in a sandbox provisioned `WITH_GODOT` (the Linux
Godot, runbook §3).

## Where the engine gate goes

Put the project's engine gate (headless import, then the GoDotTest suite)
in `engine.verify_commands` only when the engine sandbox was provisioned
`WITH_GODOT`. Otherwise put it in `verify.engine` in the tracked
`.tk-studio/config.yaml`, and the host leg (Story 34.1) runs it. The launch
check's `verify commands` row names the placement:

- `engine gate: sandbox and host leg (engine.verify_commands, verify.engine)`:
  a stripped `engine.verify_commands` entry equals `verify.engine` (the host
  leg runs `verify.engine` whenever it is set, so the command runs in both
  places);
- `engine gate: host leg (verify.engine, Story 34.1)`: `verify.engine` set,
  not in the sandbox list;
- `engine gate: sandbox list only (engine.verify_commands; not identified
  without verify.engine)`: no `verify.engine`, a working set carries
  `gds-engine-godot-4`, and `engine.verify_commands` has an entry;
- `warning: engine gate: none (...)`: no `verify.engine` and an empty or
  absent `engine.verify_commands`, but a working set carries
  `gds-engine-godot-4`.

Over a non-empty `engine.verify_commands` the clause also reads each running
engine sandbox (Story 36.6): `WITH_GODOT` provisioning writes
`~/.tk-studio/provisioned` in the sandbox, read over `sbx exec`, giving
`sandbox <sb>: provisioned WITH_GODOT <ver>`. A sandbox with no marker but a
`godot` executable (provisioned earlier) is not warned; one with neither reads
`warning: sandbox <sb> has no WITH_GODOT record; an engine.verify_commands gate
there refuses`. A sandbox not running, or `sbx` absent or down, says nothing.

The clause never turns the row red.

## The eval case

`plugins/tk-studio/evals/gds-engine-godot-4-pinned-facts/` (scaffolded with
`claude plugin eval init --bare`) checks the three pinned facts: `4.7` from
`config/features`, `Godot.NET.Sdk` `4.7.2` (and the .NET SDK) from
`global.json`, and `& $env:GODOT` on the host. The case lets the model write
the two inline files to a scratch folder and run `engine_pin.py check`
there, as the skill says to; Bash and Write are gated tools, so run it on
the box with
`claude plugin eval plugins/tk-studio --trust-plugin --allow-tools Bash Write`.
