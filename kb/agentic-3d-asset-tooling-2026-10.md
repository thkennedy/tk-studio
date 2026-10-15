---
title: Agentic 3D asset and engine tooling — a resource list (2026-10)
description: Fifteen GitHub repositories Tim filed on 2026-10-14 from an X post that turns Opus 5.5 into a 3D studio (asset generation, scene building, engine MCPs, 3D on the web); a resource list for the vertical-slice pack's asset ladder and engine wiring, not an install list; each row cross-referenced to what the 2026-09-26 research already found.
rank: 60
scope: project
---

# Agentic 3D asset and engine tooling — a resource list (2026-10)

**Provenance.** Copied by Tim from an X post on 2026-10-14 ("a full 3D pipeline, and every piece of it lives on github") into the design spec's [decision answers](../_bmad-output/planning-artifacts/design/studio-design-spec-2026-10-09/decisions-answers.md). His note: "not necessarily a list of things I want installed but a good resource for things for future use." The repository links are as posted and **unverified** here; the cross-references point at what the studio's own research verified on 2026-09-26 ([research](../_bmad-output/planning-artifacts/research/agent-studio-next-level-2026-09-26/research.md) §1 and digest 02). Consumed by the vertical-slice pack (spec [EP-33](../_bmad-output/planning-artifacts/design/studio-design-spec-2026-10-09/README.md#10-build-order)): the asset-manifest ladder and the engine MCP wiring.

## Generate 3D assets

| # | Repository | As posted | What the studio already knows |
|---|---|---|---|
| 1 | `microsoft/TRELLIS.2` | one image in, a textured 3D asset out, about 3 s on an H100 | research 2026-09-26: Linux-only; "never local 3D generation on a Windows box" — a cloud tier candidate, not a host tool |
| 2 | `Tencent-Hunyuan/Hunyuan3D-2.1` | production-ready assets with PBR textures | research: "a compile hazard" on Windows; same placement as above |
| 3 | `Stability-AI/stable-fast-3d` | one photo to a clean UV-unwrapped mesh, built for speed | not previously surveyed; same Windows caution applies until proven on the box |
| 4 | `meshy-dev/meshy-mcp-server` | text or image to 3D, then remesh, retexture, rig, animate from an agent | research: Meshy has an official 24-tool MCP and a documented Unity/UE-compatible humanoid rig; the ladder's paid tier behind a per-run credit cap |

## Build scenes and worlds

| # | Repository | As posted | What the studio already knows |
|---|---|---|---|
| 5 | `ahujasid/mcp-for-blender` | prompt-driven modelling and scene edits in a live Blender | research: `ahujasid/blender-mcp` 29.4k stars with Poly Haven, Sketchfab, Rodin, Hunyuan3D, viewport screenshots and arbitrary `execute_blender_code`; executes LLM-written bpy with no guards; the box, not Blender, is the sandbox; the plan prefers headless bpy or the official connector |
| 6 | `Tencent-Hunyuan/HY-World-2.0` | text or a single image to a navigable 3D world | not previously surveyed |
| 7 | `playcanvas/supersplat` | inspect, edit, optimise and publish Gaussian splats in the browser | not previously surveyed; outside the current asset ladder (meshes) |
| 8 | `NVIDIA-Omniverse/kit-usd-agents` | edit Omniverse USD scenes in plain English; MCP servers for Kit and Isaac Sim | not previously surveyed; outside the Godot-first ruling |

## Make a game

| # | Repository | As posted | What the studio already knows |
|---|---|---|---|
| 9 | `CoplayDev/unity-mcp` | run the Unity Editor in plain English | research: 14.5k stars, v10.x, maintained by Aura; Unity also ships a first-party plugin for Claude Code (2026-09-09) |
| 10 | `hi-godot/godot-ai` | 46 tools for a live Godot editor: scenes, scripts, signals, UI, particles | **new candidate** beside `beremaran/godot-agent-loop` (richest verify loop: tests, screenshots, visual-regression baselines) and `gdai-mcp-plugin-godot`; the engine-wiring story compares all three; one MCP per run, paired with a SKILL.md that pins the Godot version |
| 11 | `flopperam/unreal-engine-mcp` | drive a live Unreal Editor: actors, world building, Blueprints | research: Unreal 5.8 has a first-party experimental MCP on loopback |

## 3D on the web

| # | Repository | As posted | What the studio already knows |
|---|---|---|---|
| 12 | `playcanvas/editor-mcp-server` | an agent builds PlayCanvas scenes and checks they run | not previously surveyed |
| 13 | `mrdoob/three.js` | the JavaScript 3D library itself | not in scope: the office is 2D (PixiJS, spec D5) |
| 14 | `pmndrs/react-three-fiber` | three.js scenes as React components | same |
| 15 | `CloudAI-X/threejs-skills` | 10 three.js skills for Claude Code | same |

## How to use this note

- Rows 1 to 5 feed the **asset-manifest ladder** (greybox, then pre-mirrored CC0, then cloud generation behind a credit cap, each gated by geometry facts and a visual gate). The Windows rule stands: generation runs in the cloud or in a Linux microVM, never natively on the host.
- Rows 9 to 11 feed the **engine MCP wiring** through the AD-18 recommender and the `game-*` detect profiles; row 10 is the new comparison for the Godot slot.
- Rows 6 to 8 and 12 to 15 are parked: outside the Godot-first ruling or outside the asset ladder's mesh scope.
- Before any row is adopted: verify the repository, licence and Windows status live, and record the result in the research ledger (the ecosystem watch job can carry these as seeds).
