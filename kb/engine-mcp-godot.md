---
title: The engine MCP for Godot — one server per project, chosen on the box (Story 34.5's spike record)
description: Story 34.5's comparison of the Godot MCP candidates against Godot 4.7.2 Mono on TIM-PC-2 (install, run_project_tests, verify_project, game_screenshot, Windows status, licence, last release, scene-edit tools and allowlist), the measurement commands the operator session ran, the ruling (hi-godot/godot-ai, its engine.mcp line, its launch shape and its verify-only allowlist), and the seeds the operator files for the research ledger.
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
joins the table as an operator-added, read-only row (the consult answer of 2026-10-27).

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

The operator session's answer, 2026-10-27, in the story's consult log: **the pick is `hi-godot/godot-ai`**
(v4.3.1, MIT). The `game-godot` profile names it (`"suggests_mcp": ["godot-ai"]`), `recommend.py propose`
shows it as a `kind: mcp` entry, and only `recommend.py record --mcp godot-ai`, on confirmation, writes the
project's `.mcp.json` entry. `gdai-mcp-plugin-godot` is a closed product with no licence file and no
release on GitHub; `beremaran/godot-agent-loop` is gone; `tugcantopaloglu/godot-mcp` stays the open
alternative should the pick fail.

- **Transport.** Streamable HTTP on loopback, endpoint `/mcp` (so `engine.mcp.path` keeps its default).
  Every request needs `Authorization: Bearer <capability>`: without it the server answers `401
  TRANSPORT_AUTH_REQUIRED`. The supervisor supplies the capability at launch, per run, in the server's
  environment: `GODOT_AI_HTTP_CAPABILITY` (a urlsafe token, 32 to 128 characters) and `GODOT_AI_WS_TOKEN`
  (64 hex), both or neither, with `GODOT_AI_DISABLE_TELEMETRY=1` (telemetry is on by default).
- **The launch shape, in this order.** Start the server (the `engine.mcp.start` line below, cwd the
  project, the launch capabilities in its env); then the editor on the project (`$GODOT --editor --path
  <the folder of project.godot>`), whose add-on (enabled in `project.godot`) adopts the running server:
  without the editor the server answers but every editor tool reports `EDITOR_NOT_READY`. The forwarder
  puts the capability on each request it passes upstream. Stop: the editor, then the server (a
  supervisor-managed server is simply killed; nothing listens afterwards).
- **TUA's line** (its `.tk-studio/config.yaml`; `path` defaults to `/mcp`). Story 35.4: block style (the
  lib's YAML subset refuses flow collections, so `launch.py check` reads a flow-style line as a warning)
  and `port: 0`, the per-run port: the supervisor puts a free `127.0.0.1` port in for `{port}` and a
  second one for `{ws_port}` at each flagged run's pin. A fixed `port: 8000` (with `--port 8000` or
  `--port {port}`) stays valid and means one flagged run at a time:

  ```yaml
  engine:
    mcp:
      name: godot-ai
      start: "uvx --from godot-ai==4.3.1 godot-ai --transport streamable-http --port {port} --ws-port {ws_port} --exclude-domains scene,node,script,filesystem,resource,animation,material,particle,camera,audio,tilemap,tileset,gridmap,navigation,csg,ui,theme,signal,autoload,input_map,api,client,custom,batch"
      port: 0
  ```

  The edit itself is the operator's (a TUA PR or their own step on the box); the loop never writes TUA.
  Optional `filter` names the server's allowlist flag when it is not `--exclude-domains`; a start line
  without it starts anyway, with an `advisory` on `engine-mcp-start` and a warning on the launch check's
  `engine mcp` row.

  The add-on under `game/addons/godot_ai/` and its `[editor_plugins]` line in `project.godot` are a TUA
  PR of the operator's once this story lands.
- **The verify-only rule, enforced by the server's own allowlist.** `--exclude-domains` (on the server and
  on the attach bridge) with the 22 editing domains and `batch` excluded leaves the read-and-run set of 14
  tools: `editor_state`, `scene_get_hierarchy`, `node_get_properties`, `project_run`, `project_manage`
  (stop), `game_manage` (runtime inspection and input), `test_run`, `test_manage`, `logs_read`,
  `editor_screenshot`, `editor_reload_plugin`, `editor_manage`, `session_activate`, `session_manage`. No
  scene, node, script, resource or filesystem tool reaches the dev session. `editor` stays in: excluding
  it also removes `logs_read` and `editor_screenshot` (measured 10 tools). The `gds-engine-godot-4`
  skill's rule stands beside it.
- **What it does not replace.** `test_run` covers GDScript suites under `res://tests/` only (TUA's C#
  suites answer `No test suites found`), so the engine gate (`verify.engine`, Story 34.1) stays the test
  runner; `project_run` plus `logs_read source=game` is the verify, and `editor_screenshot source=game` the
  frame.
- **The snapshot folder** stays `<TK_SUPERVISOR_WORK>\snapshots\<project id>\<run id>` (operator-decisions
  §3 of spec-epic-22), which the AC's `C:\agent-work\backups\…` wording yields to.

## Reachability proof (Story 35.4)

pending: asked through 35-4's consult log
(`_bmad-output/specs/spec-epic-35/stories/35-4-the-engine-mcp-before-the-first-flagged-run-spec.md`,
`## Consult Log`). The operator applies TUA's block-style `engine.mcp` above, submits one flagged run and,
from the sandbox, posts `editor_state` to `$TK_ENGINE_MCP_URL` with `Authorization: Bearer
$TK_ENGINE_MCP_BEARER`: a 200 through the forwarder on `TK_SUPERVISOR_BIND:<forwarder_port>`, which reaches
`127.0.0.1:<port>/mcp`, and a 401 without the bearer. Both answers and the ports from `engine-mcp-start` are
recorded here.

- **The add-on's WebSocket port: measured on the box only.** Nothing documents how the godot-ai add-on in
  the editor finds a server whose `--ws-port` is not the default 9500 (the launch shape says only that it
  adopts the running server), and the supervisor invents no env var for it. The fakes' two-run start is
  the suite's bar; whether two concurrent real flagged runs each reach their own editor (the add-on
  following `{ws_port}`) is measured on the box only, and recorded here with the proof. The fallback for
  the proof step: if the editor never adopts the server started with `--ws-port {ws_port}` (every editor
  tool still `EDITOR_NOT_READY` past ~25 s), put a literal `--ws-port 9500` in `engine.mcp.start` instead,
  which means one flagged run at a time, and record here which of the two happened.

## Seeds

The operator's ruling (3b): this section stays the operator's to write. The operator files the seeds with
`research.py seed` against the next ecosystem-watch run (none ran on 2026-10-27), one anchor per claim of
the table above; the loop writes none. Their form is the `knowledge.py` seed format (`tier: seed`,
`status: provisional`, `authority: mission-scoped-supersedes-canonical`, one `[SEED-<run-id>-A<n>]` anchor
per claim: one per candidate's licence, last release, Windows status and verify-tool coverage, and one for
the ruling), filed in the research ledger the ecosystem-watch job writes
(`plugins/tk-studio/jobs/research-ecosystem.json`) with `uv run plugins/tk-studio/lib/research.py seed
--run-id <run-id> --file <seed.md>`.
