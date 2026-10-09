# Digest — The studio office scene: a gamified front end for the studio (recovered 2026-10-09)

**Provenance.** This is the research Tim commissioned in late August 2026 on a game-like studio interface: 2D characters and an office environment that make interacting with the studio pleasant, show who is working on what, and show the progress of each task, story and epic. It was written into the synthesis artifact *ClaudeOS Studio Expansion* (https://claude.ai/artifact/UiMjVMWAGMVyrxEgceFLdB, settled 2026-09-01), Thread 1 "The experience", and was never filed in a repository. Recovered verbatim in substance on 2026-10-09 from that artifact; the source links at the end are the artifact's "Key sources" list and must be re-verified before use (the 2026-10 refresh does that).

**What changed since it was written.** The artifact assumed ClaudeOS as the controller and renderer. ClaudeOS was audited on 2026-09-26 (research `agent-studio-next-level-2026-09-26`, digest 07) and is being retired; the independent supervisor (`thkennedy/tk-studio-supervisor`, Epics 21–22) now owns the queue, the tailnet API and an SSE event stream (`GET /events`), and Hermes is the planned conversational front door (Phase 2). Tim's ruling of 2026-10-09: **this gamified front end is the surface he will use most, and it wraps the Hermes agent functionality.** The design below therefore re-homes from ClaudeOS to a studio front end that consumes the supervisor's API, the bmad-loop journals and Hermes.

## 1. The office scene already exists three times

The strongest de-risking: **Pixel Agents** (MIT, covered by Fast Company), **AgentRoom**, and **claude-office** all render Claude Code sessions as animated pixel-art office workers, fed by Claude Code **hooks** first and JSONL transcript-tailing as fallback. Steal the event model. Deeper prior art: Stanford Smallville (Generative Agents) and a16z's AI Town.

One rule emerges from all of them: **the server is authoritative and emits semantic states; the game layer is a dumb renderer of `{agentId, state, detail}`.**

## 2. Recommended stack (as of 2026-09-01)

- **PixiJS v8 + `@pixi/react`** for the scene (about 450 KB): per-sprite hit-testing so clicking an agent opens its chat, native sprite-sheet parsing, nearest-neighbour scaling for pixel art. React DOM owns all text UI: chat panel, HUD, hiring modal.
- Phaser is overkill. **CSS `steps()` sprites are a legitimate one-day v0.**
- **Assets:** LPC Universal Character Generator (free; walk and idle cycles; ship its CREDITS.csv) + LimeZu Modern Office tiles ($2.50; keep paid PNGs out of public git). AI sprite generation only for accent characters such as the orchestrator.

## 3. The Game Dev Tycoon grammar maps one-to-one onto bmad-loop's vocabulary

| GDT pattern | Studio meaning | Data source |
|---|---|---|
| Point bubbles fly into the project bar | Tool calls, commits and review findings fly into story progress | `journal.jsonl` + hook events |
| Phased project progress bar | Epic = project, stories = phases, review findings = bugs to drain | `sprint-status.yaml` + `state.json` tasks |
| Tired / vacation icon over a worker | Blocked or escalating badge; a persistent "!" bubble means "needs you" | `paused_reason`, ATTENTION, heartbeats |
| Hiring screen (budget slider, stat cards) | Spawn an agent: role + model tier = salary; the card is a persona | persona YAML + policy adapters |
| Stats as overlays on the office | Existing dashboards become modals; the office is the home screen | — |

Server side, the office feed is a second SSE stream of semantic agent states. Client side, **hold each visual state at least 1–2 s** so event bursts do not strobe, and lerp everything continuous.

## 4. Who provides the team (decision 1 of 2026-09-01, still standing)

- **tk-studio owns resource selection and routing**: which agents and skills form the team and what model and effort each runs at (`working_set.<role>`, recorded through the studio's own confirm flow; `orchestrate.py resolve` returns the versioned JSON).
- **The front end owns the presentation overlay**: persona bindings (avatar or sprite, display name, orchestrator persona id) keyed to tk-studio resource names, plus a cached copy of the last resolve for rendering. Re-resolve on load; surface drift instead of hiding it (`tk_drift_check`).
- **Hermes profiles own live state** (memory, sessions); policy overrides own execution config at spawn. Both are projected, never edited directly.
- Hermes is generalised by extraction, not rebuilt: profiles (`$HERMES_HOME/profiles/<name>/`) give isolated memory and sessions per agent; the Pantheon persona YAML is a complete agent-config schema (model, prompt, skills, tools, avatar) with ten seeded personas and commissioned art; `CoreMode` (dormant, listening, thinking, talking, working) already drives state-to-animation.

## 5. Roadmap stage C as written (2026-09-01)

"The studio office scene: PixiJS v8 office view as a new route; SSE agent-state stream (semantic events from journal and hooks); the GDT grammar: desks, point bubbles into story bars, '!' bubbles for escalations, a hiring modal over the personas. CSS-sprite v0 first if you want it in a day. Depends on A (the event source) and B (a chattable orchestrator per project)." In today's terms A is the supervisor's `/events` plus the bmad-loop journals, and B is Hermes with one profile per project.

## 6. What the 2026-10 refresh must settle

1. The three precedents today: activity, licence, event model, whether any reads a generic event feed rather than Claude Code hooks; new entrants since September.
2. Renderer: PixiJS v8 vs Phaser vs Godot-web (the studio already ships Godot) vs CSS sprites, judged on phone-width use, bundle size and a one-person maintenance budget.
3. The semantic state vocabulary, derived from the supervisor's queue events and bmad-loop's journal kinds, and how the supervisor would expose it (a `/events` projection or a second SSE route).
4. How the front end wraps Hermes: the gateway's HTTP/WebSocket chat surface on Windows, per-project profiles, and the Telegram bot as the same conversation from the phone.
5. Hosting and auth on the tailnet: served by the supervisor behind the 22.5 session cookie, or a separate app behind the same cookie.
6. Assets and licences for a private repo that may go public.

## Key sources named by the artifact (re-verify)

Pixel Agents · AgentRoom · claude-office · Fast Company on Pixel Agents · AI Town and its architecture · the Generative Agents paper · `@pixi/react` · LPC character generator · LimeZu Modern Office · bmad-loop v0.9.1 · Claude Code headless, Remote Control, cross-session messaging, self-hosted environments · GHA runner auth design · Buildkite agent lifecycle · Jenkins JEP-222 · Tailscale ACLs · ttyd.
