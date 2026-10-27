---
type: llm
weight: 1
---

The response states all three pinned facts:

1. The engine version is `4.7`, read from `project.godot`'s `config/features`.
2. `Godot.NET.Sdk` is `4.7.2`, read from `global.json`, and the .NET SDK
   (`sdk.version`) is `8.0.100`.
3. On the host the engine runs as `& $env:GODOT ...` (for example
   `& $env:GODOT --headless --path <dir> --quit`): `GODOT` is the absolute
   path to the console exe, and a bare `godot` is never used on the host (it
   exists only in a sandbox provisioned `WITH_GODOT`).

Fail the response if any of the three is missing or wrong, or if it tells the
operator to run a bare `godot` on the host.
