# Digest 01 — "AI game studio in a box": frameworks, engine bridges, commercial, evidence (2026-09-26)

Grades: [V] verified by fetching the primary page/API; [R] reported via snippet/secondary; [U] unverified. Star/commit data from the GitHub API on 2026-09-26.

## 1. Open-source studio orchestrations and skill packs

- **Donchitos/Claude-Code-Game-Studios (CCGS)** — 25,456★, 3,624 forks, MIT, created 2026-02-12, pushed 2026-09-24. 49 subagents / 74 skills / 12 hooks / 13 rules; Godot 4, Unity, UE5. Three-tier hierarchy (Directors → Leads → 30+ specialists), "vertical delegation, horizontal consultation, conflict resolution escalating to shared parents." Artifacts: GDD with rigor levels, ADRs, sprint plans, QA evidence (screenshots, logs). `project.yaml` config; `production/session-state/active.md` checkpoint ("The file is the memory, not the conversation"). **Deliberately human-in-the-loop**: "Question → Options → Decision → Draft → Approval," agents must ask before Write/Edit. Stories close only after the running game is launched and observed. Clone/template + `/start`, not a marketplace plugin. [V] https://github.com/Donchitos/Claude-Code-Game-Studios
- **htdt/godogen** — 7,007★, MIT, created 2026-02-06, pushed 2026-09-26. **Most autonomous**: prompt → playable Godot 4 (C#), Bevy, or Babylon.js game + 15–20s proof video; hosted by Claude Code or Codex (`./publish.sh --engine godot --agent claude`). Two skills: orchestrator + task executor in isolated `context: fork` windows. Headless scripts build scene graphs in memory and serialize `.tscn`. Hand-written GDScript spec + API docs from Godot XML + a "quirks database," lazy-loaded from 850 classes. Separate Gemini Flash visual-QA agent sees screenshots only, never code. Assets via Gemini/xAI images and Tripo3D rigged models. Cost per game "$1–3" LLM, "$5–8 all-in." HN critique (~March 2026): outputs "lifeless," "no actual gameplay mechanics," no GUT tests, animation the main gap. [V] https://github.com/htdt/godogen · https://news.ycombinator.com/item?id=47400868
- **bmad-code-org/bmad-module-game-dev-studio (GDS)** — 241★, MIT, pushed 2026-09-25, **v0.7.2 (2026-08-31)**. Five agents; Unity/Unreal/Godot/Roblox/Phaser; artifacts research, GDD, narrative, DESIGN.md/EXPERIENCE.md, architecture, epics/sprints; "Quick Flow vs Full Production." Positioned as a "senior game dev colleague" working *with* Claude Code, not an autonomous builder. v0.7.0 moved Python to `uv run`, added Roblox. GLaDOS QA agent [R]. [V] https://github.com/bmad-code-org/bmad-module-game-dev-studio
- **striderZA/OpenCodeGameStudios** — 88★, MIT, pushed 2026-08-11. CCGS fork on OpenCode + Pi; 52 agents, 77 skills, 6 engines (+SFML, Raylib, Bevy). Adds "pre-workflow exploration" (2–4 throwaway prototypes), design-first pipeline, phase gates PASS/CONCERNS/FAIL, 158 self-tests. [V] https://github.com/striderZA/OpenCodeGameStudios
- **leigest519/OpenGame (CUHK MMLab)** — 2,957★, Apache-2.0, created 2026-04-20. GameCoder-27B (CPT → SFT → execution-grounded RL) + Template Skill (canvas/Phaser/three.js) + Debug Skill. **OpenGame-Bench** scores Build Health / Visual Usability / Intent Alignment via headless browser + VLM judge over 150 prompts. [V] https://github.com/leigest519/OpenGame · https://arxiv.org/abs/2604.18394
- Also: **IvanMurzak/ai-game-dev-plugin** (marketplace plugin wrapping `unreal-mcp-cli`/`unity-mcp-cli`/`godot-cli` to create project, install engine plugin, open editor) [V]; pamirtuna/gamestudio-subagents (262★, stale since 2025-08) [V]; IdoCohen560/claude-unity-game-studio (Unity-only CCGS derivative) [V]; HermeticOrmus/claude-code-game-development (64★) [V]; wanghaisheng/OpenAgenticGame-Studios (15★) [V]; **shubhraj5575/ai-game-studio** (0★; deterministic no-LLM "agents", but a good QA pattern: headless bots across seeds, "~15 invariants every 15 ticks," failures → regression pins) [V].

## 2. Engine bridges (MCP / CLI)

| Engine | Bridge | Status | Capabilities |
|---|---|---|---|
| Unity | CoplayDev/unity-mcp — 14,509★, MIT, v10.x, pushed 2026-09-22 [V] | maintained; Coplay acquired by Ramen 2026-03-16, "sponsored and maintained by Aura" [V/R] | 47 tools: scenes/GameObjects, scripts, assets, run tests, profile, build |
| Unity | IvanMurzak/Unity-MCP — 4,343★, Apache-2.0, pushed 2026-09-26 [V] | maintained | "full develop and test loop," CLI |
| Unity | **Unity-Technologies/unity-agent-plugin** — 357★, v0.1.6-beta, Unity Companion License, announced 2026-09-09 [V] | shipping for Claude Code + Codex; Editor control via Unity CLI + experimental Pipeline package (Unity 6) | ~29–31 skills; `/plugin install unity@unity-agent-plugin` |
| Godot | Coding-Solo/godot-mcp — 5,844★, MIT, pushed 2026-04-16 [V] | slowing | launch editor, run project, capture debug output (no screenshots) |
| Godot | **beremaran/godot-agent-loop** v3.0.0 (2026-08-04), MIT, 6★ [V] | small but richest loop | `run_project_tests`, `verify_project`, `game_screenshot`, logs, scene tree, visual-regression baselines/masks/diffs, deterministic input scenarios, `editor_transaction`; 16 core + 40 catalog tools |
| Godot | slangwald/godot-mcp (4.6) [V]; 3ddelano/gdai-mcp-plugin-godot (101★, pushed 2026-09-11) [V] | small | editor TCP:9500 + game TCP:9501; viewport PNG, mouse sim, runtime tree |
| Unreal | **UE 5.8 first-party "Unreal MCP"** (experimental) [V] | in-engine | `http://127.0.0.1:8000/mcp`; spawn actors, lighting, materials, Slate inspection, automation tests; loopback only, no auth; Blueprint editing undocumented |
| Unreal | chongdashu/unreal-mcp — 2,087★, no license, last push 2025-04-22 [V] | stale | Blueprint graph via C++ plugin + Python |
| Bevy | natepiano/bevy_brp — 71★, pushed 2026-09-26 [V] | maintained | Bevy Remote Protocol |
| Roblox | built-in Studio MCP server [V] | production; Claude Code quick-connect | read/edit/run Luau, text-to-mesh, start/stop play, console, viewport screenshots, input sim |
| Phaser | Phaser Game Agent MCP (2026-07-08) [V] | hosted, $0.01/min | cloud sandbox builds full game incl. art + music, publishes URL |

Unreal caveat (Ludus AI 2026-09-13): Blueprints are binary `.uasset`; without a bridge Claude is "blind on half your project." [V] https://ludusengine.com/blog/claude-code-for-unreal-engine

## 3. Commercial / hosted

- **Unity AI** open beta 2026-05-01 (Unity 6): Assistant Ask/Agent/Plan, Generators, AI Gateway for Claude/Codex/Gemini, official Unity MCP; $10/mo per 1,000 credits Personal; forum complaints on credit burn and stability. [V] https://discussions.unity.com/t/unity-ai-s-open-beta-now-live-for-unity-6/1718560
- **Bezi** GA Unity agent workspace; 2026-09-10 "Agent mode in Play Mode"; model picker incl. Claude Fable 5.1; Unreal early access. [V] https://www.bezi.com/ $20–180/mo [R].
- **Aura (ex-Coplay)** launched 2026-05-14; one subscription for Unity + Unreal. [R]
- **Roblox** 2026-04-15 "Studio is going agentic": Planning Mode task manifest; Playtesting Agent (beta) uses the player character as QA; "44% of top 1,000 creators" use Assistant/MCP. [V] https://about.roblox.com/newsroom/2026/04/roblox-studio-going-agentic
- **Rosebud AI** browser games; Steam export / code ownership claims conflict between sources [V/R]. **Ludo.ai** asset/concept generator, not a builder [R].
- **Google Project Genie** (2026-01-29) Genie 3 world model, 60s sessions, video download only; not a game pipeline [V]. **Microsoft Muse/WHAMM** research demo; Xbox Gaming Copilot is coaching, not generation [R].

## 4. Concrete evidence of results

- **Dodo Payments (2026-02-27)** 8 vanilla HTML/JS games in one weekend via oh-my-opencode orchestration; humans needed for "game *feel*." [V] https://dodopayments.com/engineering/ai-agents-build-8-games
- **vivecuervo7 (2026-03-04)** Godot card-game UI without opening the editor: Claude edits `.tscn`/`.gd`; step-based GDScript test runner with screenshot analysis; **`.cmd-queue`/`.cmd-result` file protocol drives the running game; grid overlay gives a shared coordinate system**; 33 files across 6 projects with 5 parallel background agents. [V] https://vivecuervo7.github.io/dev-blog/p/claude-code-godot/
- **Codex CLI prototyping (2026-05-10)** three-doc loop (`DESIGN-DOCUMENT.md`, `PROGRESS.md`, `AGENTS.md`); Playwright for browser games; `godot --headless --import` + gdlint; "correctness often means 'looks right on screen'"; subagent `max_depth = 1`. Failures: physics feel, 3D spatial reasoning, netcode, audio-anim sync. [V] https://codex.danielvaughan.com/2026/05/10/codex-cli-game-prototyping-godot-phaser-browser-games-agent-skills/
- **GameXpert-Bench (2026-08-22)** agents "more reliable at producing playable foundations … than at discovering defects, verifying runtime behavior, and preserving functionality across changes." [V] https://arxiv.org/abs/2608.21833
- HN practitioners: Opus 4.5/4.6 write fine GDScript given CLAUDE.md + plan mode + scaffold; residual Godot 3-vs-4 confusion. [V] https://news.ycombinator.com/item?id=47407325
- Negative: RTS in Godot abandoned after ~8h over loss of control (2025-06) [V]; roguelike: context loss the bottleneck, UI/graphics weakest [V].

## 5. Recurring architecture patterns in the ones that work

1. **Roles are marketing; phases + isolation do the work.** 49-agent hierarchies are human-gated; the autonomous one is orchestrator → forked executors; explicit gates PASS/CONCERNS/FAIL.
2. **Files as memory** (`project.yaml`, `session-state/active.md`, `PROGRESS.md`, Roblox task manifest), never the conversation.
3. **Engine knowledge injection**: lazy-loaded API docs + quirks DB + version pinning beats model priors; Unity's official plugin exists to stop "outdated tutorials."
4. **Never hand-edit serialized scenes**: build node graphs headlessly and serialize, or go through an MCP that owns editor state.
5. **Verify from the running game, not the compile**: screenshot-only VLM judge, visual-regression baselines, deterministic bots + invariants, Playwright, UE automation tests, Roblox player-character QA. GameXpert-Bench says this is where agents are weakest — budget for it.
6. **Art is placeholder-by-default**; animation remains the gap.
7. **Game feel is the human's job** — every successful write-up says so.

## Top 10 worth stealing

1. Orchestrator + `context: fork` executors — https://github.com/htdt/godogen
2. Screenshot-only visual-QA judge that never sees code — https://news.ycombinator.com/item?id=47400868
3. `.cmd-queue`/`.cmd-result` + grid overlay to drive a running game — https://vivecuervo7.github.io/dev-blog/p/claude-code-godot/
4. `run_project_tests`/`verify_project`/visual-regression as MCP tools — https://github.com/beremaran/godot-agent-loop
5. BH/VU/IA rubric via headless browser + VLM — https://arxiv.org/abs/2604.18394
6. Question → Options → Decision → Draft → Approval gate + `session-state/active.md` — https://github.com/Donchitos/Claude-Code-Game-Studios/blob/main/CLAUDE.md
7. Pre-workflow exploration (2–4 throwaway prototypes) — https://github.com/striderZA/OpenCodeGameStudios
8. Deterministic multi-seed bots with tick invariants → regression pins — https://github.com/shubhraj5575/ai-game-studio
9. Install Unity's first-party skills + CLI instead of writing your own — https://github.com/Unity-Technologies/unity-agent-plugin
10. Three-doc loop with subagent `max_depth = 1` — https://codex.danielvaughan.com/2026/05/10/codex-cli-game-prototyping-godot-phaser-browser-games-agent-skills/

Caveats: two Medium pages 403'd; Reddit-specific evidence not surfaced; cases come from blogs, HN, arXiv, GitHub API.
