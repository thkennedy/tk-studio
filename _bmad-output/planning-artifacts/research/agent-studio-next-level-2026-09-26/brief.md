---
research_type: technical + competitive
research_topic: Agentic game-studio systems and an unattended gamedev agent PC driven from a web UI
decision: How tk-studio should evolve to let the operator describe a game prototype in a web interface and have a dedicated agent machine build a playable vertical slice unattended (code + engine + Blender/3D assets), without engineering everything from scratch.
date: 2026-09-26
author: Tim
requested_by: operator (attended session, /tk-studio:tk-studio-orchestrator)
mode: Run (web fan-out, 4 research subagents + 1 local-repo map)
---

# Brief

## Decision being served

The operator likes BMad and the current tk-studio layer (pinned base, lockstep, planning adapter, jobs, evolve loop) but sees two shifts: (1) other people ship "whole studio as agents + Blender" packs that one-shot vertical slices, and (2) Anthropic keeps landing orchestration primitives natively in Claude Code. Decide what to build on, what to adopt, and what tk-studio's next epic should be.

## Questions

1. Who is doing "agent studio -> playable vertical slice" today, on what harness, with what results, and what is worth stealing?
2. How are agents driving Blender / 3D generation into game-ready assets unattended, and what is the reliable fallback ladder?
3. Which official Claude Code primitives (Sept 2026) cover: remote web control, unattended long runs, scheduling, computer use, plugins/eval, Windows?
4. How do people run an always-on agent box from a web UI safely, and what breaks?
5. What does tk-studio already have (jobs, launch pipeline, session, gds module, ADs) that constrains or accelerates this?

## Research firewall

Project context shaped the questions; it is not evidence. Every claim in `research.md` traces to a digest file under `digests/` with a URL.

## Digests

- `digests/01-agent-game-studios.md` — frameworks, engine MCPs, commercial prompt-to-game, evidence of results
- `digests/02-blender-3d-pipelines.md` — Blender MCP, text-to-3D APIs, rigging, asset strategies, machine setup
- `digests/03-claude-code-official-primitives.md` — official capabilities and gaps
- `digests/04-agent-box-and-web-ui.md` — self-hosted UIs, isolation, GUI automation, orchestration, failure reports
- `digests/05-tk-studio-current-surface.md` — local map (jobs, launch, session, gds, ADs, conformance)

Second pass (2026-09-26, after the operator ruled Godot / Max plan / independent supervisor and expanded ruling 1 into the hub question):

- `digests/06-hermes-local-install.md` — the operator's Hermes install: version, run state, configured surfaces, framework capabilities, usage
- `digests/07-claudeos-audit.md` — ClaudeOS size, health, parallel implementations, contract coupling, replaceability
- `digests/08-hermes-agent-hub-research.md` — Hermes Agent upstream: architecture, learning loop, orchestration fitness, interfaces, Windows, security, model/billing
