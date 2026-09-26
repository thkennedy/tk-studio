---
research_type: technical + competitive
research_topic: Agentic game-studio systems and an unattended gamedev agent PC driven from a web UI
decision: What tk-studio builds on, what it adopts, and what its next epic is, to let the operator describe a prototype in a web interface and have a dedicated agent machine build a playable vertical slice unattended.
date: 2026-09-26
author: Tim
status: findings landed; rulings 2-4 made 2026-09-26; ruling 1 guidance in §7, operator decision pending
sources: digests/01..05 (every claim traces to a digest row with a URL)
---

# Research: bringing tk-studio to "describe it, let the agent box cook"

## 0. Answer in one paragraph

Nobody is one-shotting *good* vertical slices; the autonomous systems one-shot *playable greybox* slices with generated placeholder art for about $5–8 a game, and every honest write-up says game feel and runtime verification are still human work. The winning shape is not "49 agents"; it is orchestrator → isolated executors, files as memory, API-first engine control through MCP/CLI, screenshots used only to verify, and a strict asset fallback ladder. Anthropic now ships most of the substrate you would otherwise build: headless CLI budget flags, Remote Control, Channels, Desktop Dispatch on Windows, Docker Sandboxes on Windows 11, the Agent SDK, plugin eval, and an official Blender connector, while Unity ships its own Claude Code plugin and MCP. tk-studio already has the piece none of the studio packs have: jobs as data with required guards, run workspaces, status blocks, session handoff, a measured execution pipeline, and a conformance gate. The next level is therefore: treat the agent PC as the external durable harness AD-10 already anticipates, adopt the engine and Blender bridges rather than writing them, and spend tk-studio's own effort on the two things the field is weakest at, a **playable-verify leg** and an **asset-manifest ladder with QA gates**, exposed through a `run-vertical-slice` job. The web front end must live outside the plugin as a driver-contract consumer unless you amend the charter, which currently says the studio grows no UI.

## 1. How people are doing it (digest 01, 02)

**Two camps, one lesson.**
- *Human-gated hierarchies.* Donchitos/Claude-Code-Game-Studios (25.5k★, MIT, 49 subagents/74 skills) is the popular one, and it is deliberately not autonomous: "Question → Options → Decision → Draft → Approval," agents must ask before writing, stories close only after the running game is launched and observed. Its durable idea is `session-state/active.md`: "the file is the memory, not the conversation." [01 §1]
- *Autonomous pipelines.* htdt/godogen (7k★, MIT) is the real "prompt → playable Godot/Bevy/Babylon game + proof video" system, hosted by Claude Code or Codex. It is only two skills: an orchestrator and a task executor running in `context: fork` windows, a headless scene-graph serializer (never hand-edit `.tscn`), a lazy-loaded Godot API + quirks database, a **screenshot-only visual-QA judge that never sees code**, and Tripo3D for rigged meshes. Cost per game $1–3 LLM, $5–8 all-in. HN verdict: "lifeless," "no actual gameplay mechanics," animation the main gap. [01 §1]
- BMad's own GDS module (v0.7.2, 2026-08-31, 241★) sits in the "senior colleague" camp: design artifacts and sprint discipline, not an autonomous builder. That is what tk-studio installs today from the pin. [01 §1, 05 §2]

**What recurs in the ones that work** [01 §5]: roles are marketing, phases and isolation do the work; files as memory; engine knowledge injection (API docs + quirks DB + version pin) beats model priors; never hand-edit serialized scenes; verify from the running game, not the compile; art placeholder-by-default; game feel is the human's job. GameXpert-Bench (2026-08-22) quantifies the weak link: agents are "more reliable at producing playable foundations than at discovering defects, verifying runtime behavior, and preserving functionality across changes." [01 §4]

**Engine control is API-first and increasingly first-party** [01 §2, 04 §4]:
- Unity: official Unity MCP (2026-05-11, Unity 6+), Unity CLI + Pipeline (2026-08-13, connects to a running Editor, eval → command → screenshot → verify), and the **Unity plugin for Claude Code (2026-09-09, ~29 skills incl. `/unity-cli`)**. Community: CoplayDev/unity-mcp 14.5k★ v10.x (maintained by Aura after the Ramen acquisition), IvanMurzak/Unity-MCP 4.3k★.
- Godot: Coding-Solo/godot-mcp 5.8k★ (slowing, no screenshots); **beremaran/godot-agent-loop v3.0.0** is small but has the richest verify loop (`run_project_tests`, `verify_project`, `game_screenshot`, visual-regression baselines, deterministic input scenarios); gdai-mcp-plugin-godot has editor + game TCP bridges with viewport PNG and input sim. GDS's own catalogue defaults to GoPeak.
- Unreal 5.8 has a first-party experimental MCP on loopback; Blueprints are binary so Claude is "blind on half your project" without it. Roblox Studio's MCP is production and includes a Playtesting Agent. Stacking engine MCPs makes agents pick the wrong one on about half of ambiguous prompts; pair one MCP with one SKILL.md per run. [02 §5]

**Blender and assets** [02]:
- Anthropic shipped an official Blender connector and Blender Lab MCP server on 2026-04-28 (Claude Desktop + Claude Code, not the web); ahujasid/blender-mcp is 29.4k★ with Poly Haven, Sketchfab, Rodin, Hunyuan3D, viewport screenshots and arbitrary `execute_blender_code`. Both execute LLM-written bpy with no guards; Blender devs say sandboxing is the OS's job. Windows-friendly headless variants exist (sandraschi/blender-mcp spawns `blender --background`; ra100/blender-claude-plugin is a Claude Code plugin with 8 bpy skill domains).
- Practitioners converged on **bpy scripting as source of truth** and separate Blender and engine sessions; generated meshes (Rodin) "required too much cleanup." Text-to-3D is triangle soup with auto-UVs; "game-ready" means remeshed to budget. Meshy has an official 24-tool MCP (remesh, retexture, rig, animate) and a documented Unity/UE-compatible humanoid rig; Tripo's rig v2.5 is the cleanest UE5 retarget; Mixamo is browser-only and broke in mid-2025; Cascadeur needs a GUI.
- Reliable unattended order: procedural greybox → pre-mirrored CC0 kits (Kenney 60k+, Quaternius, Poly Haven) → cloud generation with per-run credit caps. Never local 3D generation on a Windows box (TRELLIS.2 is Linux-only, Hunyuan3D 2.1 is a compile hazard). EEVEE headless is Linux-only; use Workbench/Cycles for QA renders on Windows. QA pattern: blender-eyes fixed ortho views + a `facts` JSON (dimensions, face counts, loose verts, scale) plus a vision rubric from the in-game camera.

## 2. What Anthropic provides natively, September 2026 (digest 03, 04)

| Need | Official primitive | State | Catch |
|---|---|---|---|
| Steer a session on the agent PC from phone/web | Remote Control (`claude remote-control`) | GA, Pro/Max | a window into a *local* session; needs a live TTY and the process running; no daemon flag (issues #30447, #29116 open) |
| Chat-style dispatch into a running session | Channels (Telegram/Discord/iMessage plugins) | research preview | works with `-p`; sender allowlist; permission relay from phone |
| Phone → Desktop → Claude Code on Windows | Dispatch (Cowork) | shipping, Windows x64 | machine awake, Desktop app open |
| Unattended bounded runs | headless CLI: `--max-budget-usd`, `--max-turns`, `--permission-prompts none`, `--bare`, `--output-format json`, resume by `.jsonl` | GA | `-p` from Task Scheduler hangs without a console window-station (#96932, open 2026-09-25) |
| Custom long-running service | Agent SDK (Python/TS) | GA | no computer-use tool; needs an API key, not claude.ai credentials |
| Scheduling | `/loop` (session), Desktop scheduled tasks (local, app open), cloud Routines (no local files) | GA / preview | none is always-on-Windows by itself |
| GUI control | computer use in Claude Desktop/Code on Windows | research preview since 2026-04-03 | unproven for multi-hour Blender/Unity sessions; prompt-injection exfil demonstrated |
| Isolation on Windows | Docker Sandboxes (microVM, `winget install Docker.sbx`) | GA | **no GPU**; Bash sandbox not native Windows; guidance: container/VM or WSL2 for any bypass run |
| Packaging + quality | plugins (skills/agents/hooks/MCP), `claude plugin eval` (v2.1.269+) | GA | eval runs are metered |
| Hosted agents | Managed Agents, self-hosted sandboxes | beta | self-hosted is Linux-only |

Windows-specific unattended failure modes are real and documented: silent REPL exit after 10–30 min of dense Bash (#55424), Task Scheduler hang (#96932), the WSL `bash` stub (#37634), startup GC deleting transcripts (#62041), and the 2026-09-25 junction incident where a cleanup script deleted 48k live files in 103 s. [03 §8, 04 §5–6]

## 3. What tk-studio already has, and what constrains this (digest 05)

- **Already built and unique among the packs:** jobs as data with *required* budget guards and stop conditions (`job.schema.json`), `jobrun.py` directives, run workspaces with `run.json`/`handoff.json`, the status block every headless run must end with, `session.py handoff|resume`, the launch pipeline with measured model routing (about $8.6 per story on a C#/Godot project), 691 lib tests and an 18-surface conformance runner, and the lockstep release gate. GDS is installed from the pin with engine knowledge for Godot/Unity/Unreal/Phaser/Roblox and an engine-MCP *recommendation catalogue* that installs nothing.
- **Gaps:** zero Blender or asset pipeline; engine MCPs are never wired; no UI; the durable job driver is ClaudeOS's tick, outside this repo; launch/pipeline have no EP/ST entries.
- **Binding constraints:** AD-1 never fork BMad (GDS changes go through `_bmad/custom` or upstream); AD-2 integration only through the driver contract; AD-10 durable jobs bind to a cloud routine or *external harness*; AD-11 attended/headless parity, no prompts, `blocked` not questions; AD-18 the recommender suggests tooling "chiefly MCP servers"; AD-19 nothing is done until conformance passes. **The charter says the studio grows no UI** (driver-contract §7 row 6; epics.md:10 and :102; brief addendum:149, "ClaudeOS remains the multi-project UI").

## 4. Recommendation: build on others, own the gates

Three layers, each mostly adopted, with tk-studio's effort concentrated where the field is weakest.

**Layer A. The agent box is the external durable harness (adopt, do not build).** Follow the reference architecture in digest 04: a dedicated Windows 11 box with a low-privilege agent account that owns only its profile and a work drive; Tailscale only; a **console-hosted supervisor started at logon** (never headless Task Scheduler); code and asset-script work in Docker Sandboxes or WSL2 with bypass allowed; editor-in-the-loop work on the host in auto mode, never bypass; outbound firewall allowlist; `permissions.deny` for recursive deletes, force pushes and `git clean`; branch per run, PR-only merges, robocopy snapshot before Editor runs, nightly transcript backup. This box is exactly the "external harness" `jobrun.py` already returns a `durability_constraint` for; tk-studio's work here is a **driver binding** (the same seat ClaudeOS's tick occupies), not a new subsystem. Engines get a real GPU because none of the sandboxes pass one through.

**Layer B. The studio pack (plugin content, tk-studio's product).** Do not write 49 agents.
- Keep GDS from the pin for pre-production and design artifacts (brief → GDD → architecture → epics). Install **Unity's first-party plugin** when the project is Unity; use **godot-agent-loop** (or gdai) when Godot; one engine MCP per run, paired with a SKILL.md that pins the engine version, wired through the AD-18 recommender and the existing `game-*` detect profiles so the catalogue finally installs something.
- Adopt Blender through the **official connector or a headless bpy MCP** plus a thin bpy skill pack (ra100's or your own), never GUI automation.
- Build the two things nobody ships and that fit the ADs:
  1. **A `playable-verify` pipeline leg.** Run the game headless, take screenshots from the player camera, judge with a screenshot-only vision rubric (godogen), run deterministic multi-seed bot scenarios with tick invariants (ai-game-studio), keep visual-regression baselines (godot-agent-loop), and end with a status block. This becomes a routed leg in `customize.toml [pipeline.legs]` with its own measured model and a conformance drive. It directly attacks the GameXpert-Bench weakness.
  2. **An asset-manifest contract and fallback ladder skill.** Manifest first (name, category, tri budget, bounds, origin rule, collision, license tag); tiers greybox → CC0 mirror → Meshy/Tripo with per-run credit caps; headless Blender normalization and glTF export; a geometry `facts` gate and a visual gate; placeholder never deleted until the replacement passes both. Headless, deterministic, status-blocked, so it passes AD-11 and AD-19 as-is.
- Compose them into a **`run-vertical-slice` job type**: GDS quick-flow brief + GDD → epics → launch pipeline with the new leg → asset ladder → proof video/screenshots into the run workspace. Run-workspace files (`run.json`, `handoff.json`, `seed.md`) already give the "files as memory" pattern every successful system uses. Contract bumps are additive (0.1.16+); write `claude plugin eval` cases for the new skills.

**Layer C. The front door.** Ranked by how little you build:
1. **First-party glue, zero code:** Remote Control for live steering from phone/web, Channels (Telegram) for chat-style dispatch into the always-on session, Dispatch from the Desktop app for one-off tasks. Limits: a live TTY session per project and the Desktop app open.
2. **CloudCLI (siteboon/claudecodeui, AGPL) on the Tailscale IP** for the multi-session, file, and git view the first-party tools lack.
3. **A thin studio console as a driver-contract consumer, in its own repo.** It reads what the contract already exposes (status blocks, run workspaces, the per-machine ledger, the registry) and submits `run-vertical-slice` jobs. This is the only path that keeps the charter intact; ClaudeOS occupies that seat today, so either ClaudeOS grows the page or a small `tk-studio-console` does. Putting it *inside* the plugin requires an explicit charter amendment to §7 row 6 and epics.md.

## 5. Expectations and risks, stated plainly

- "One-shot vertical slice" in September 2026 means a playable greybox with placeholder art and lifeless feel for $5–8; the measured cost of a *reviewed* story through tk-studio's pipeline is about $8.6. Budget for verification, not for more agents.
- Game feel, physics tuning, 3D spatial reasoning, netcode and audio-animation sync are the documented failure classes; animation is the open gap in every asset pipeline.
- Windows unattended runs die in known ways (silent REPL exit, no-console hang, junction deletion). The mitigations are architectural: console-hosted supervisor, externalized state, `--resume` from `.jsonl`, deny rules, snapshots, never bypass on the host.
- Max-plan quota is shared with your interactive chat; SDK/`-p` service use needs an API key. Decide which pays for the box.
- Every Blender bridge executes arbitrary bpy; the box, not Blender, is the sandbox.

## 6. Rulings only the operator can make

1. **UI placement and the hub question:** external contract consumer (recommended; keeps §7 row 6) vs. amend the charter to let the plugin grow a console. **Expanded by the operator on 2026-09-26:** the real decision is whether to keep ClaudeOS (grown, messy) and clean it up, replace it with something aligned to Hermes Agent (operator holds a subscription; attracted to Hermes as the central orchestrator with learning), or build something tk-studio/game-dev specific. **Pending; second research pass under way (ClaudeOS audit, local Hermes install, Hermes web research).**
2. **Engine for the first slice:** ~~Godot vs. Unity~~ **Ruled 2026-09-26: Godot.**
3. **Who pays and how:** ~~Max plan vs. API key~~ **Ruled 2026-09-26: Max plan** (so the box runs Claude Code sessions under the subscription, via Remote Control / Channels / a session-hosting supervisor; the Agent SDK with an API key is out unless this is revisited).
4. **Where the durable driver lives:** ~~ClaudeOS tick vs. independent supervisor~~ **Ruled 2026-09-26: independent supervisor**, installed and served on the remote Windows 11 PC, reached over HTTP from the main PC, iPad, and phone.

## 7. Ruling 1, guidance: the hub question (digests 06, 07, 08)

The operator asked whether to keep and clean ClaudeOS, replace it with a Hermes-centred hub, or build something tk-studio-specific. The three are not one decision. ClaudeOS today bundles three jobs that should be separated, and the evidence points to a different answer for each.

### 7.1 What the evidence says

**ClaudeOS** (digest 07) is about 131k first-party lines whose backend is an 11.5k-line `vite.config.ts`. It carries four runners, two project registries, two knowledge lifecycles, two handoff systems, two model-routing systems, and four config formats. Dream has failed for 12 days; missions have been idle 86 days; the Hermes page 91 days; 19 commits sit unpushed; the UI is loopback-only. **The part that actually drives tk-studio is about 1.2k lines** (`connectors/tk-studio/{server,client}.ts` + `scripts/studio-jobs-tick.ts`), goes entirely through the published contract, consumes contract 0.1.12 against a published 0.1.15, and **was never scheduled**: the watchdog task still runs only the legacy mission-runner. No dashboard reads `~/.tk-studio`. Cleaning this up means paying down four parallel implementations to keep a driver that never ran.

**Hermes locally** (digest 06) is installed, running as a logon Scheduled Task, and idle: version 0.18.0 against upstream 0.21.5, no sessions since 2026-07-04, zero memories, zero agent-authored skills, zero cron jobs, no MCP servers, and a Discord gateway that has failed to connect about ten thousand times. Nothing in it knows tk-studio, Godot, or Blender. The framework, however, ships the surfaces a front door needs: 25+ messaging platforms with pairing auth, a fail-closed dashboard, cron, an OpenAI-compatible API with Runs/Jobs, MCP client and server, Bot Mode profiles, and a bundled skill for driving Claude Code through `claude -p`.

**Hermes as a runner** (digest 08) fails the studio's own requirements: `delegate_task` is in-process threads with no default wall-clock timeout and a **global** delegation model (contract §5 says forward model and effort verbatim, per leg); the API server rejects past 10 concurrent runs with **no durable queue**; cron sessions are memoryless; two crons dispatching to one Claude Code produce race conditions in the field. The learning loop's documented failure modes (self-grading always reports success, auto-improvement overwrites manual skill edits, learned rules omit constraints) are exactly what a deterministic story pipeline cannot tolerate. Native Windows is Tier 1 but has no PTY, so the dashboard chat tab and tmux-style interactive Claude Code need WSL2. Security posture is real (April 2026 audit with four criticals, weekly 460–1,800-PR releases, a state.db corruption campaign this month). Running the hub on Claude OAuth is contested in Nous's own tracker (#47260); the field pattern is hub on Portal or API key, `claude -p` worker on its own Max login, which matches ruling 3.

### 7.2 Recommendation: split the three jobs

1. **Driver / supervisor: extract, do not clean or adopt.** Lift the ~1.2k lines of contract-consuming code out of ClaudeOS into a small standalone repo (call it the studio supervisor) and make it the ruling-4 independent supervisor on the agent PC. Add what neither ClaudeOS nor Hermes has: a durable job queue (SQLite or files), one-engine-per-checkout locking, idempotent `wake`, budget guards enforced by the wrapper, a console-hosted process started at logon (not headless Task Scheduler, per anthropics/claude-code#96932), transcript backup, and an HTTP API bound to the Tailscale address with token auth: `POST /jobs`, `GET /runs/{id}`, `GET /status`, plus a minimal read-only status page over `~/.tk-studio` (status blocks, run workspaces, ledger). Keep it Bun/TypeScript so the code lifts as-is; a Python rewrite to match `lib/` is optional later. It stays a driver-contract consumer (AD-2), so the charter holds; the only contract change is a doc patch to §7 row 6 naming the supervisor (and Hermes) as UI consumers instead of ClaudeOS. This is the one thing to build, and it is small.

2. **Hermes: use it as the front door and dispatcher, never as the runner, with learning on a leash.** Its job is intake and presence: Telegram (simpler pairing than the Discord intents that have been failing) and the dashboard on the Tailscale address with basic auth; a natural-language conversation on the phone or iPad that shapes "I want a roguelike deckbuilder prototype" into a `run-vertical-slice` job JSON and POSTs it to the supervisor; cron nudges that read supervisor status and report; `hermes mcp serve` so Claude Code sessions can message you back. Hermes never spawns `claude -p` for pipeline work. Gate the learning loop: `skills.write_approval: true`, `memory.write_approval: true`, curator dry-run; let it learn intake conventions and your preferences, while BMad artifacts and run workspaces remain the source of truth. Run the hub model on the Nous Portal subscription you already pay for, never on Claude OAuth, so ruling 3's Max plan is spent only by the worker. Keep Hermes replaceable: because the supervisor's HTTP API is the seam, if Hermes churns or breaks, Claude Code's own Remote Control plus Channels (Telegram) plus the supervisor's status page cover the same ground with zero third-party code.

3. **ClaudeOS: retire as driver, freeze as a personal dashboard, salvage three things.** Push the 19 unpushed commits and tag the state. Remove the stale `ClaudeOS-studio-pipeline` worktree. Disable the Mission Watchdog task (it does nothing) and either fix Dream or stop its task (it has failed 12 days). Salvage into the studio: (a) the driver code, per item 1; (b) the **Godot functional verification** the mission-runner did for The Peeps, which is the natural seed for the `playable-verify` leg; (c) the `context-tripwire` and `precompact-handoff` hooks, compared against `tk-studio-session` before adopting either. Keep the usage/cost aggregator, memory graph, and Review Watcher running loopback-only if you still use them; they are unrelated to game dev and need no rescue. The 8.6k-line Hermes page becomes redundant once Hermes's own dashboard is on Tailscale.

### 7.3 Why not the other two answers

- *Clean up ClaudeOS and keep it as hub:* you would spend the effort on four parallel runners and a 11.5k-line middleware file to arrive at a loopback-only UI that still cannot be reached from an iPad, and the driver inside it never ran. Extraction is cheaper than cleanup and loses nothing that matters to the studio.
- *Hermes as the whole hub, including running jobs:* no durable queue, global model, no wall-clock guard, race conditions on dual dispatch, and a learning loop that grades itself as successful. It would violate AD-10 (guards), §5 (model passthrough) and AD-11 (no prompts) at the driver seam, and put a 700k-line, internet-facing Python service between you and a machine that holds your repos and keys.

### 7.4 Sequence

1. **Week 1, supervisor:** extract the connector and tick into their own repo; add the queue, lock, HTTP API, Tailscale bind, and logon task; run the existing `run-epic` job on a throwaway Godot project from your phone via `curl`; pass the shipped conformance suite (§8) through the new driver. Contract doc patch to §7 row 6.
2. **Week 2, front door:** update Hermes to 0.21.x (move to the `%LOCALAPPDATA%` layout while at it), switch the gateway to Telegram, bind the dashboard on Tailscale with basic auth, gate learning, write one Hermes skill that turns intent into job JSON and POSTs it, and one cron that reports run status.
3. **Week 3 onward:** the studio work from §4: `playable-verify` leg seeded from The Peeps verification, asset ladder, `run-vertical-slice` job type; ClaudeOS freeze in parallel.

## 8. Proposed motions (studio terms)

1. Record these rulings; log the recommendation-worthy findings as observations (`tk observe`) so the evolve loop mints PROP rows rather than this doc becoming the only record.
2. **Spike 0, agent box:** stand up the account, Tailscale, supervisor, Docker Sandboxes, Remote Control + Channels; run the existing `run-epic` job on a throwaway Godot project from your phone end to end; measure cost and failures into the ledger.
3. **Spike 1, `playable-verify` leg:** godot-agent-loop (or Unity CLI) as a routed pipeline leg with a status block and a conformance drive.
4. **Spike 2, asset ladder:** manifest schema + headless bpy normalization + `facts` gate; Meshy/Tripo optional behind a credit cap.
5. **Epic:** `run-vertical-slice` job type, detect-profile MCP wiring, plugin eval cases, contract 0.1.16, product-brief update, and the console decision from ruling 1.
