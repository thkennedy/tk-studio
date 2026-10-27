---
title: The engine MCP for Godot — one server per project, chosen on the box (Story 34.5's spike record)
description: Story 34.5's comparison of the three Godot MCP candidates against Godot 4.7.2 Mono on TIM-PC-2 (install, run_project_tests, verify_project, game_screenshot, Windows status, licence, last release, scene-edit tools and allowlist), the exact measurement commands the operator session runs, the pending ruling, and the seeds for the research ledger. Every cell is "not measured" until the operator answers in the story's consult log.
rank: 64
scope: project
---

# The engine MCP for Godot (Story 34.5)

Epic 34's Story 34.5 picks one engine MCP server per project, so a dev session on a game project can run
the project's tests, verify it and take a frame from the engine without a human. The pick reaches a
project only through `recommend.py`: the `game-godot` detect profile names it in `suggests_mcp`, `propose`
shows it as a `kind: mcp` entry, and only `recommend.py record --mcp <name>`, on confirmation, writes the
project's `.mcp.json` entry. Detection never writes it.

The engine cannot install or run an MCP server or Godot (it lives in a Linux sandbox; both live on the
Windows host), so every measurement here is the operator session's step on the box, asked for through the
story's consult log (`_bmad-output/specs/spec-epic-34/stories/34-5-one-engine-mcp-per-run-started-by-the-pin-spec.md`).

The Godot MCP servers are catalogued upstream by GDS in
`.claude/skills/gds-game-architecture/engine-mcps.yaml` (the `godot:` block, upstream-owned, AD-1). This
record cites the catalogue by path and copies none of its entries; none of the three candidates below is
one of its entries.

## The box

- TIM-PC-2, Godot `4.7.2.stable.mono` (the runbook's `$env:GODOT`, the console exe; see
  `kb/playable-verify-on-the-box.md`).
- The reference project: The Universe Awaits, in a scratch **clone** (never the served checkout).

## Candidates

Source: `kb/agentic-3d-asset-tooling-2026-10.md` row 10 (the three candidates and the research's reading of
them). Filled by the operator session's trial on 2026-10-27 12:45Z to 12:55Z (TIM-PC-2, the RDP session, the TUA scratch clone; raw notes `C:\agent-work\scratch\mcp-trial\godot-ai-measurements.md`).

| Candidate | Install | `run_project_tests` | `verify_project` | `game_screenshot` | Windows status | Licence | Last release | Scene-edit tools and allowlist |
|---|---|---|---|---|---|---|---|---|
| `beremaran/godot-agent-loop` | not available (repo removed; handoff-phase1-loop-2026-10-09.md:25) | not available | not available | not available | not available | not available | not available | not available |
| `hi-godot/godot-ai` | works: release zip `godot-ai-v4-plugin.zip` (v4.3.1, 2.3 MB; sha256 of the full zip verified) extracted to `game/addons/godot_ai/`, `[editor_plugins] enabled=PackedStringArray("res://addons/godot_ai/plugin.cfg")` in `project.godot`, the editor started on the project; the add-on starts the PyPI server `godot-ai==4.3.1` through `uvx` (73 wheels, under a second from uv's cache) and connects over WebSocket within 25 s | `test_run`: GDScript `test_*.gd` under `res://tests/` only; on TUA (C# GoDotTest) it answers `No test suites found in res://tests/` in 155 ms, so the engine gate (34.1) stays the test runner | no such tool; `project_run` (mode main, `autosave=false`) had the game live in 4.8 s with `game_status.status: live`; `editor_state` 46 to 155 ms; `logs_read source=game` returns the game's lines (`TUA.Game shell ready`) with a run id; `project_manage op=stop` 265 ms | `editor_screenshot source=game max_resolution=640`: a 640×360 PNG of the running game (the shell scene) in 250 ms, `frames_drawn: 9`; `viewport_2d` gives the editor's 2D viewport (2×2 for TUA's Control scene), `viewport` the 3D one, `cinematic` a Camera3D render | works on Windows 11 without WSL (Godot 4.7.2 Mono, uv 0.12.19; the server launches with CREATE_NO_WINDOW); the attach bridge reports server version 4.1.3 for the 4.3.1 package | MIT (LICENSE in the add-on and the repository) | v4.3.1, 2026-10-24 (3,235 stars, pushed 2026-10-26) | 47 tools: 4 core (`editor_state`, `scene_get_hierarchy`, `node_get_properties`, `session_activate`), 15 verbs (`batch_execute`, `node_create`, `node_set_property`, `node_find`, `scene_open`, `scene_save`, `script_create`, `script_patch`, `script_attach`, `project_run`, `test_run`, `logs_read`, `editor_screenshot`, `editor_reload_plugin`, `animation_create`) and 28 `<domain>_manage` rollups (scene, node, script, project, editor, session, test, animation, material, audio, particle, camera, signal, input_map, game, autoload, filesystem, theme, ui, resource, api, client, tilemap, tileset, gridmap, navigation, csg, custom); the allowlist is `--exclude-domains <csv>` on the server and on the attach bridge: with the 22 editing domains and `batch` excluded the server lists the read-and-run set of 14 (`editor_state`, `scene_get_hierarchy`, `node_get_properties`, `project_run`, `project_manage`, `game_manage`, `test_run`, `test_manage`, `logs_read`, `editor_screenshot`, `editor_reload_plugin`, `editor_manage`, `session_activate`, `session_manage`; `editor` must stay in: excluding it removes `logs_read` and `editor_screenshot` too, measured 10). HTTP on loopback with a bearer: `/mcp` answers 401 `TRANSPORT_AUTH_REQUIRED` without it; the bearer is the `http` token of `%LOCALAPPDATA%\godot-ai\capabilities\http-<port>.json`, or the one the supervisor supplies at launch through `GODOT_AI_HTTP_CAPABILITY` + `GODOT_AI_WS_TOKEN` (proven: `initialize` 200, `tools/list` and `editor_state` over plain HTTP); the editor started afterwards adopts the running server (`MCP \| adopted external server`) |
| `gdai-mcp-plugin-godot` | not installed: a closed product distributed from gdaimcp.com; the GitHub repository (`3ddelano/gdai-mcp-plugin-godot`, 102 stars, pushed 2026-09-11) holds a demo project and `latest_version.txt` (0.3.3), no add-on source, no releases | not measured (not installed) | not measured (not installed) | not measured (not installed; the README advertises editor and game screenshots) | not measured | no licence file in the repository | none on GitHub (version file 0.3.3) | per its README: scene, node, script and resource creation, the debugger and logs, and screenshots; no allowlist documented |
| `tugcantopaloglu/godot-mcp` (operator-added, read-only; not one of the story's three) | not installed (read-only comparison): a TypeScript server, 157 tools, GDScript and C#/.NET, "tested with Godot 4.7" | not measured | not measured | not measured | not measured | MIT | v3.1.0 (504 stars, pushed 2026-10-09) | per its README: full engine control including scene and script edits; allowlist not documented; the live open alternative if godot-ai fails |

Evidence on the removed candidate: the operator session's read-only comparison (2026-10-27,
`_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md`, the 07:2xZ and 11:0xZ updates'
"Epic 34 state" lines) found `beremaran/godot-agent-loop` gone from GitHub. That session's read-only
shortlist also named `tugcantopaloglu/godot-mcp`; it is not one of the story's three candidates, and it
joins the table only if the operator adds it in the consult answer.

What the forwarder needs from the pick: an HTTP transport on loopback (`127.0.0.1:<port>`). A pick that
speaks stdio only has no place behind the supervisor's forwarder in this version (the story's Block If).

## Measurement commands

On the host, in PowerShell, from the scratch clone of TUA (`<tua>`), with `GODOT` set. For each candidate
still on GitHub:

1. **Last release and licence.** `gh release list --repo <owner>/<repo> --limit 1` and
   `gh repo view <owner>/<repo> --json licenseInfo,pushedAt,isArchived`. For `gdai-mcp-plugin-godot`, its
   distribution page (the research names no repository): record where it is published and its licence.
2. **Install.** Follow the candidate's own install steps into the clone (an editor addon under
   `<tua>/game/addons/`, or a server package). Record every step, its time and any error.
3. **Start, loopback only.** Start the server the way `engine.mcp.start` would (one command line, cwd the
   clone, `GODOT` in the env), bound to `127.0.0.1:<port>`. Record the command line, the port, the
   transport (HTTP or stdio) and the endpoint path (e.g. `/mcp`).
4. **Tools.** List its tools (`claude mcp add --transport http probe http://127.0.0.1:<port><path>` in a
   scratch folder, then `/mcp` in a session there, or the server's own listing). Record whether it has a
   tool allowlist, and which tools edit scenes, nodes, resources or scripts.
5. **The three verify calls.** Through that session: run the project's tests (`run_project_tests` or its
   equivalent; compare with `scripts/engine-gate.sh`'s `Passed: N | Failed: N`), verify the project
   (`verify_project` or its equivalent), take a frame (`game_screenshot` or its equivalent; record the
   file, its size, and whether it shows the scene).
6. **Windows status.** Whether steps 2 to 5 ran on Windows 11 without WSL, and anything that needed a
   workaround.
7. **Stop.** Stop the server; confirm nothing listens on the port afterwards
   (`Get-NetTCPConnection -LocalPort <port>`).

Answer in the spec's `## Consult Log` with the filled table, the pick, its `engine.mcp: {name, start,
port}` line (and its endpoint path), and the allowlist setting for the verify-only rule.

## Ruling

Pending: the operator session's answer in the story's consult log. Until it exists, the `game-godot`
profile carries no `suggests_mcp`, and no project's `.mcp.json` names an engine MCP.

The rule the pick must keep (verify-only, in this version): the dev session may run the project's tests,
verify the project and take a frame; it never calls the server's scene-editing tools. Where the server
has a tool allowlist, `engine.mcp.start` restricts it to the verify tools; where it has none, the
`gds-engine-godot-4` skill's rule is the enforcement (a residual risk this record names once the pick is
known).

## Seeds

Pending: the seeds are written from the operator's measurements, never before. Their form is the
`knowledge.py` seed format (`tier: seed`, `status: provisional`, `authority:
mission-scoped-supersedes-canonical`, one `[SEED-<run-id>-A<n>]` anchor per claim: one per candidate's
licence, last release, Windows status and verify-tool coverage, and one for the ruling). The operator files
them in the research ledger the ecosystem-watch job writes (`plugins/tk-studio/jobs/research-ecosystem.json`)
with `uv run plugins/tk-studio/lib/research.py seed --run-id <run-id> --file <seed.md>`.
