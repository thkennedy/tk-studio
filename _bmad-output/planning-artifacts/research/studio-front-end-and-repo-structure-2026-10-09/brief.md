# Brief — Studio front end and repository structure (2026-10-09)

Run mode: native (web fan-out through subagents), approved at the plan gate on 2026-10-09 by Tim.

## Decisions being served

**A. Repository structure.** One repository with per-app releases, or several, for a studio made of three apps that ship on different cadences: the Claude Code plugin (`plugins/tk-studio`, released as a pinned zip with the tag prefix `tk-studio--vX.Y.Z` by `tools/release_archive.py`), the Bun/TypeScript supervisor service (today the separate repository `thkennedy/tk-studio-supervisor`, built by an unattended bmad-loop engine in its own checkout and run from that checkout as a console-hosted service), and the planned web front end. Shape: **select**. Output: an ADR Tim signs.

Operator's concern, verbatim: "if I were setting things up for the first time if the first step was to clone three repos I don't think I would go any further. Multi-app repos are not uncommon. I only conceded the separate supervisor repo because I thought it would end up being the main studio front door. Now I'm reconsidering restructuring everything and having a single repo - tk-studio. We can have separate releases for the individual apps right? I'm curious how other solutions like this structure their repos and apps. Before moving any further I want this put to bed in writing." Also: "I'm not opposed to rewriting the entire project if it will offer clear benefits to me or any potential users."

**B. The front end.** Refresh of the gamified studio front end recovered from the 2026-09-01 synthesis (`research/studio-office-ui-2026-09-01/`): a 2D office scene with characters, who works on what, progress per task, story and epic, wrapping the Hermes agent chat. Tim's stated preference: **Next.js first**, since his website already runs on it, unless it causes a major increase in cost or resources. Shape: explore, with a select sub-decision for the renderer. Output: the front-end brief.

Tim's product vision, verbatim: "My eventual goal is to 'hire' and interface with the studio as I would a contract development studio and ask them to do things from a product owner perspective. A studio like that would have their own devs and when I ask a studio to do something they would look at the request, then come back with clarifying questions, then together we would nail down any outstanding details and then they would come back with a proposed scope of work and rough timeline. They'd be clear about what they could and couldn't do and also what they'd need from me. Then we'd haggle over price and then finalize the contract. I [want] tk-studio to eventually feel like the same kind of experience where I can go from napkin idea to prototype or vertical slice and then full development and eventually see a finished product."

## Requirements frame for decision A (agreed 2026-10-09)

Hard gates:
1. A newcomer clones **one** repository and is running.
2. The plugin keeps its pinned zip release and the `tk-studio--vX.Y.Z` tag prefix.
3. The supervisor keeps protected-main PR flow and its unattended loop builds.
4. Independent versions and GitHub Releases per app.
5. The driver contract stays provable from outside the plugin: a package boundary, not necessarily a repository boundary.
6. **One installer / setup / updater tool** abstracts everything else: cloning, compatible release sets, updates.

Weighted preferences, in order: newcomer clarity; release tooling that works on Windows with Bun and uv; blast radius of a bad merge; history preservation; CI simplicity; sandbox mount simplicity for the engines.

## Dimensions (breadth-first, one assistant each)

| # | Dimension | Type / pack dimensions |
|---|---|---|
| A1 | How comparable projects structure plugin + service + UI | technical 1, 3, 5 |
| A2 | Per-app release tooling in one repository; history-preserving migration; marketplace layout constraints | technical 2, 4 |
| A3 | One installer / updater: patterns and tooling that abstract multi-component setup and compatible release sets | technical 2, 4 |
| B1 | The three precedents today (Pixel Agents, AgentRoom, claude-office) and new entrants since 2026-09 | competitive 1, 4, 5 |
| B2 | Renderer choice inside a Next.js-first front end: PixiJS v8, Phaser, Godot web, CSS sprites, Rive | technical 1, 4, 5 (select) |
| B3 | Integration: semantic agent-state vocabulary and SSE projection; wrapping Hermes chat on Windows; hosting behind the supervisor's bind and session cookie | technical 2, 3 |
| B4 | Pixel-art assets and licences for a private repository that may go public | technical 2 |
| B5 | The contract-studio engagement loop in agent products: intake, clarifying questions, scope and estimate, approval, delivery | competitive 1, 3 + user-voice |

## Knobs in force

Preset **deep** (Tim: "Go deeper", time and tokens no issue): 8 assistants (wide work), 12 sources per round, up to 3 rounds per dimension, stopping on coverage or novelty exhaustion. Validation **normal** (spot-check load-bearing claims at landing) plus a **red-team skeptic on the repository verdict**. Surfaces: harness web search and fetch, GitHub's API through `gh` for repository metrics. Fan-out as subagents (no workflow orchestration). Estimate: 60 to 90 minutes.

## Research firewall

Assistants receive only their brief. Project facts granted to specific briefs: the description of the three apps (A1, A2, A3); the supervisor's queue event kinds and bmad-loop journal kinds (B3); the constraints phone-width, one-person maintenance, Next.js preference (B2). None of these is evidence.

## Output

`research.md` (decision-first, benefits and drawbacks per approach, source appendix, staleness map), `digests/`, `.memlog.md`. Then `briefs/adr-repository-structure-2026-10-09.md` for Tim's signature, then the front-end brief.
