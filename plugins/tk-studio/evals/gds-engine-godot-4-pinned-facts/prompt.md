---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
---

I am working in a Godot 4 C# game project on the studio's Windows agent PC.
Use the `gds-engine-godot-4` skill to answer. The project's two pin files are
below, inline. You may write them to a scratch folder (for example
`./pinned-facts-project/project.godot` and `./pinned-facts-project/global.json`)
and run the skill's `engine_pin.py check --directory` on that folder, as the
skill says to.

`project.godot`:

```ini
config_version=5

[application]

config/name="Pinned Facts"
config/features=PackedStringArray("4.7", "C#", "Forward Plus")
```

`global.json`:

```json
{
  "sdk": {"version": "8.0.100"},
  "msbuild-sdks": {"Godot.NET.Sdk": "4.7.2"}
}
```

Answer three questions, one line each:

1. Which engine version does `project.godot`'s `config/features` pin?
2. Which `Godot.NET.Sdk` version does `global.json` pin, and which .NET SDK?
3. On this box's host, how do I run the engine headless (the exact command
   shape)?
