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
them). Every cell is `not measured` until the operator session fills it from the commands below.

| Candidate | Install | `run_project_tests` | `verify_project` | `game_screenshot` | Windows status | Licence | Last release | Scene-edit tools and allowlist |
|---|---|---|---|---|---|---|---|---|
| `beremaran/godot-agent-loop` | not available (repo removed; handoff-phase1-loop-2026-10-09.md:25) | not available | not available | not available | not available | not available | not available | not available |
| `hi-godot/godot-ai` | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |
| `gdai-mcp-plugin-godot` | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |

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
