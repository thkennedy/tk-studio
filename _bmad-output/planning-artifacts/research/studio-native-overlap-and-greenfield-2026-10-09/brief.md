# Brief — Native overlap, the plugin question, Jev, and a greenfield studio (2026-10-09)

Run mode: native (web fan-out through subagents), opened on Tim's request of 2026-10-09 (second session), plan-and-proceed because Tim is away: "I'd like this researched as well"; "I'm curious if anything else we've been doing is already out there made for us"; "if we were to write this entire thing from scratch right now with no constraints or dependencies and using what we've learned from what we've built so far, how should we go about it? What tech out there already exists and what doesn't?"

## Decisions being served

**C. Should tk-studio remain a Claude Code plugin?** Tim: "the logic surrounding some of the drawbacks are because tk-studio currently is a claude plugin. What real benefit does that give me in light of everything I'm wanting to do now? Would it simplify things if it were not a plugin?" Shape: **select** (plugin as today; installer-delivered skills plus a CLI; a hybrid). Output: option O5 in `briefs/adr-repository-structure-2026-10-09.md`, scored against the frame, before Tim signs.

**D. What has the ecosystem already built that the studio built itself?** Official (Anthropic, Claude Code) and unofficial (open source, products), including Jev auto-model routing, the advisor, loops, agent view, routines, and whatever else maps onto the studio's surfaces. Shape: **explore**, producing an overlap map: for each studio capability, the native or third-party equivalent, its maturity, whether it works under a Max subscription, and the verdict adopt / wrap / keep ours / drop.

**E. The greenfield design.** If the studio were written from scratch today with no constraints or dependencies, using what the studio has learned, how should it be built; which primitives exist and which do not. Shape: **explore**, producing a proposal brief (`briefs/greenfield-studio-2026-10-09.md`) that the front-end brief and any restructure consume.

## Constraints that are true (granted to the briefs that need them; none is evidence)

One maintainer; Windows-first (Bun, uv, Python 3.12 stdlib, Git Bash and PowerShell); Claude Code is the harness and the Max subscription pays (API-key billing is not the plan); unattended agents run only in Docker Sandboxes microVMs; the studio's own surfaces today: activation drift check, pinned BMad base install, onboarding and registry, role orchestrator, planning adapter (bmad-files, backlog-md, jira), knowledge and research jobs, job model with a published driver contract and a conformance suite, measurement ledger and evolve loop, model and effort routing per leg with a consult leg on objective triggers, a review gate with deviation scoring, a per-story meter from transcripts, an unattended loop engine (bmad-loop) in sandboxes, a durable supervisor (queue, lock per checkout, pacer, crash recovery, HTTPS status page with phone sign-in, notifications), and the planned office front end and contract-studio engagement loop.

## Dimensions (breadth-first, one assistant each)

| # | Dimension | Type / pack dimensions |
|---|---|---|
| C1 | Plugin or not: what a Claude Code plugin uniquely provides versus skills plus a CLI delivered by an installer; how comparable tools distribute; what each path costs | technical 1, 3, 4 (select) |
| C2 | Jev: what it is, the routers built on it, how they route per turn, cost and credential model, accuracy evidence, risks, and how a studio would use typed decisions for routing, escalation, budget bands and tool-call guards | technical 1, 2, 4, 5 |
| C3 | Official overlap map: Claude Code and Anthropic features that now cover studio surfaces, with dates, maturity, and subscription availability | competitive 1, 2 + technical 4 |
| C4 | Unofficial overlap map: open-source and product tooling that now covers studio surfaces, with health and licence | competitive 1, 4, 5 |
| C5 | Greenfield architecture: build-versus-adopt per capability on today's primitives; what does not exist; lock-in and maturity risks | technical 1, 2, 5 |
| C6 | Lessons from what we built (internal evidence only): what the handoffs, retros, ledgers and deferred-work notes say worked, hurt, or was rebuilt; design constraints for C5 | internal, no web |

## Knobs in force

Preset **deep** (Tim's standing preference): 6 assistants, 12 sources per round, up to 3 rounds per dimension, stopping on coverage or novelty exhaustion; stop-and-write valve on context budget. Validation **normal** plus a **red team** on the plugin-or-not verdict and on the greenfield "adopt native X" recommendations. Surfaces: harness web search and fetch, `gh api`, local Claude Code binary (`claude --help`, `claude --version`) for feature presence. Fan-out as subagents; digests to disk, summaries back (lean return contract).

## Research firewall

Web assistants receive only their brief and the constraints block above. C6 reads repository files and nothing from the web.

## Output

`research.md`, `digests/`, `.memlog.md`; then O5 in the repository-structure ADR and `briefs/greenfield-studio-2026-10-09.md`.
