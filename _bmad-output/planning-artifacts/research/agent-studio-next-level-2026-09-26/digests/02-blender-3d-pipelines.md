# Digest 02 — LLM agents driving Blender and 3D generation into game-ready assets (as of 2026-09-26)

Source pass: ~30 searches, ~20 fetches. Grades: [verified] primary page fetched, [reported] snippet/secondary, [unverified].

## 1. Blender agent bridges

- **ahujasid/blender-mcp → `MCPBlender/blender-mcp`, PyPI `mcp-for-blender`** [verified] — 29.4k stars; Poly Haven, Sketchfab, Poly Pizza, Hyper3D Rodin, Hunyuan3D integrations; viewport screenshots; scene inspection; arbitrary `execute_blender_code`; GLB/FBX export; clients Claude Desktop/Code, Cursor, VS Code, OpenCode. README caveats: `execute_blender_code` "potentially dangerous", "ALWAYS save your work", Poly Haven downloads block UI, Poly Pizza Cloudflare-gated; safe-mode env var + Docker option. PyPI 1.9.0 on 2026-08-30 [reported]. https://github.com/ahujasid/blender-mcp
- **Official Blender Lab MCP server + Anthropic Blender connector** [verified, Claude Academy] — Python execution, scene reads, API docs; Claude Desktop (all plans) and Claude Code, not claude.ai web; changes persist only on save; Blender 4.2+ (Academy) vs 5.1+ (ra100 plugin) discrepancy. Shipped 2026-04-28 with a €240k/yr Blender Fund donation [reported]. Blender devtalk (closed Sept 2026) [verified]: docs admit it "will execute LLM generated code in Blender without any guards"; recommend VMs. https://academy.claude.com/tutorials/using-the-blender-connector-in-claude · https://devtalk.blender.org/t/blender-mcp-server-after-claude-mcp-security-for-blender-scripting-3d-agent-notes/45131
- **Limitations** [verified, MindStudio 2026-05-06]: organic geometry weak, topology ignores edge loops, Geometry Nodes brittle across versions, rigging/weight painting "not realistic", spatial positioning imprecise; prototyping not modeling. blend-ai README [reported]: all-or-nothing selection, no sculpt strokes, node trees one node at a time, no MCP-level undo, viewport capture needs a visible viewport. https://www.mindstudio.ai/blog/claude-blender-mcp-real-world-performance · https://github.com/k0ncepts/blend-ai
- **Headless / Claude Code skill tooling:** bpy.dev (4 MCP tools, Docker, 27 BlenderBench tasks, community preview) [verified] https://bpy.dev/ ; **sandraschi/blender-mcp** spawns `blender --background`, 41 tools/150+ ops, headless GLB/GLTF/FBX/OBJ/USD export, Windows .bat/PowerShell scripts, 48 stars [verified] https://github.com/sandraschi/blender-mcp ; **ra100/blender-claude-plugin** Claude Code plugin, 8 skill domains for Blender 5.x bpy (geo nodes, shaders, rigging, glTF+anim), MCP-first on localhost:9876, v1.3.0 MIT [verified] https://github.com/ra100/blender-claude-plugin ; BlenderGPT legacy [reported]; benchmarks BlenderBench, 3DCodeBench, CodeGen-3D [reported] https://arxiv.org/html/2606.01057v1

## 2. Text/image-to-3D with agent-usable APIs

| Service | Agent surface | Game-quality | Price / license |
|---|---|---|---|
| Meshy | Official MCP, 24 tools (text/image-to-3d, remesh, retexture, rig, animate, uv-unwrap, convert), Pro+ key; v0.5.0 Meshy 7 + 8K [verified] https://github.com/meshy-dev/meshy-mcp-server ; `meshy-3d-agent` CLI skills [reported] | 1k–300k tris via remesh, auto UVs, 4K PBR, humanoid rig compatible w/ Unity Humanoid + UE Mannequin, 500+ FBX anims, 50+ concurrent [verified] https://github.com/meshy-dev/game-asset-pipeline | Free = CC BY 4.0 public; Pro $20, Studio $60 = private [reported] |
| Tripo | Community MCPs (ebrob, pasie15, Composio, trident-mcp) [reported] | Rig v2.5-20260210: 7 morphologies, Tripo or Mixamo bone names, GLB/FBX, ~30s [verified] https://developers.tripo3d.ai/en/models/rig | 1 credit=$0.01; t2-3D 10–20, i2-3D 20–30, retopo 10–30, rig 25, retarget 10/anim [verified]; free plan no commercial use; API v2 shuts 2026-11-01 [reported] |
| Hyper3D Rodin | Official `rodin-api-mcp` + `rodin3d-skills` [reported]; inside blender-mcp | High-poly quads Business only | Free / Creator $30 / Business $120; API Business+ [verified] https://hyper3d.ai/pricing |
| Hunyuan3D | 2.0/2.1 open weights; 2.5/3.0/3.1 hosted only [verified] https://triposr.org/blog/hunyuan3d-versions | 2.1 PBR, holeless | community license excludes EU/UK/KR, 1M MAU cap |
| TRELLIS.2 | Local only, no MCP | GLB+PBR incl. opacity; 512³ ~3s, 1536³ ~60s on H100 [verified] https://github.com/microsoft/TRELLIS.2 | MIT |
| Sparc3D | via Scenario only [reported] | watertight 1024³ | Scenario credits |
| Scenario | Generation API aggregating 20+ 3D models [reported] https://docs.scenario.com/ | | credits |
| Kaedim | human-in-loop ~24h, $150–600/mo [reported] | cleanest topology, not unattended | |
| CSM.ai / Layer.ai | advertise MCP servers [reported] | | |

Caveat across all generators: triangle soup + auto-UVs; "game-ready" = remeshed to budget, not hand topology.

## 3. Rigging / animation automation

- StraySpark showdown 2026-05-14 [verified]: Tripo cleanest UE5 retarget; Meshy 5–15cm hip pivot offsets breaking foot IK + non-standard bone names; AccuRig best free but scale/A-pose fussy; Mixamo unchanged, backend broke June 2025; Cascadeur needs pre-rigged input. https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo
- Headless-drivable: Meshy + Tripo rig/animate via REST/MCP [verified]; DeepMotion Animate 3D API (video→FBX/BVH, retarget, by request) [verified] https://www.deepmotion.com/animate-3d-api ; Move.ai dev API [reported].
- Not headless: Mixamo (browser, biped only); Cascadeur Python API needs GUI, FBX export needs Indie $8/mo [reported] https://github.com/ysk424/cascadeur-mcp ; Rigify via bpy scriptable but metarig placement is the hard part [reported].
- MotionGPT3 weights (Oct 2025) output SMPL skeletons needing retarget [reported].

## 4. Asset strategies people actually use

- CC0 libraries: Kenney All-in-1 60k+ assets OBJ/FBX/GLTF (Feb 2026) [reported]; Quaternius CC0 kits [reported]; Poly Haven via blender-mcp [verified]; Poly Pizza API Cloudflare-gated [verified].
- Sketchfab/Fab: Sketchfab APIs "for the foreseeable future"; Fab public API promised 2025; KitBash acquired Sketchfab+ArtStation 2026-08-12, no new endpoints [reported]. Fragile.
- Synty royalty-free paid per-seat [reported]. PixelLab official MCP for sprites/tilesets/walk cycles [reported] https://www.pixellab.ai/mcp . Voxel agent tooling: none found [unverified].
- **Practitioner choice (fishing game, Godot + Blender MCP, 2026-08-18)** [verified]: Rodin meshes "required too much cleanup"; switched to bpy scripting as source of truth, separate Blender and Godot sessions; "Screenshots are the referee"; render from the in-game camera; blind A/B rubric ≥8/10. https://explainx.ai/blog/r-claudeai-fishing-game-godot-blender-mcp-week-3-august-2026

Most reliable unattended: procedural greybox + CC0 kits, generated assets as decoration.

## 5. End-to-end examples and QA

- SoloSrc/battle-city #95 (2026-09-21) [verified]: generator→Blender→glb→Godot; Hunyuan3D/Rodin arm dropped for budget; Blender 5.2.1 NumPy blocked glTF export on macOS; 5.2.2 headless glb OK. https://github.com/SoloSrc/battle-city/issues/95
- GameDev Academy 2026-09-17 [verified]: reference image → Blender MCP → Godot 4.6; ~62k tris; agent initially targeted wrong Godot version; over-complex collision. https://gamedevacademy.org/gpt-astra-blender-mcp-tutorial/
- mcp.directory May 2026 [verified]: stacking Godot + Unity MCPs → wrong server on ~half of ambiguous prompts; pair each MCP with a SKILL.md. https://mcp.directory/blog/godot-vs-unity-vs-blender-mcp-skills-2026 . CoplayDev/unity-mcp v10.2.0 Sept 2026 [reported]; Coding-Solo/godot-mcp runs projects + captures debug output [reported].
- Visual QA: **blender-eyes** fixed ortho views + `facts` JSON (dimensions, face counts, loose verts, non-unit scale) + pixel diffs [verified] https://github.com/GPRizzi/blender-eyes ; **Kesehet/3d-modeling-ai** edit→render→vision critique loop [verified] https://github.com/Kesehet/3d-modeling-ai

## 6. Machine setup

- Local gen: TRELLIS.2 24GB VRAM, CUDA 12.4, Linux-only tested [verified]; Hunyuan3D 2.1 10/21/29GB, Windows `custom_rasterizer` compile hazard [reported]; TripoSR ~6GB. Cloud APIs cost cents/asset.
- Headless Blender: `blender -b --python` reliable for modeling/export/Cycles; **EEVEE headless Linux-only (EGL)**; Windows EEVEE needs a display → use Workbench/Cycles or a logged-in session [reported]. Containers: BlenderKit headless-blender-container, carrender-docker [reported].
- Security: every bridge executes arbitrary bpy; VM/container + scratch checkout [verified devtalk].

## Recommended unattended asset pipeline (agent's synthesis)

1. Asset manifest first (name, category, tri budget, bounds, origin rule, collision, license tag) — the contract each stage validates.
2. Tier 0 procedural greybox via headless bpy + Kenney prototype textures; always succeeds.
3. Tier 1 CC0 lookup from pre-downloaded local mirrors (Kenney, Quaternius, Poly Haven); never runtime Poly Pizza/Sketchfab.
4. Tier 2 cloud generation (Meshy Pro or Tripo paid; Rodin only on Business) image-to-3D from an agent-generated reference, remesh to budget, GLB out; per-asset and per-run credit caps.
5. No local gen on the Windows box unless 24GB Linux GPU.
6. Normalize in headless Blender: transforms, unit scale, origin, weld, decimate, rename, glTF 2.0 +Y up, embedded textures.
7. Geometry QA gate (facts JSON): scale, origin, tri budget, loose verts, UVs, material count.
8. Visual QA gate: 4 ortho + 1 in-game-camera render (Workbench/Cycles), vision rubric ≥8/10, blind A/B on replacement.
9. Rigging only for characters via Tripo/Meshy API; verify bone count/root; keep static mesh on failure.
10. One engine MCP per run, paired with a SKILL.md pinning engine version; run scene headless; screenshot from player camera.
11. Fallback ladder generated → library → greybox, logged; placeholder kept until replacement passes both gates.
12. VM/container isolation, per-run credit ceilings, pinned Blender (≥5.2.2) and API versions (Tripo v3 before 2026-11-01).
