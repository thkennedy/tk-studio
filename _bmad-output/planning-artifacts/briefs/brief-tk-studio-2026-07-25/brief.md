---
title: "Product Brief: tk-studio"
status: draft
created: 2026-07-25
updated: 2026-07-25
---

# Product Brief: tk-studio

_Name settled 2026-07-25; skills and agents carry the `tk-studio-*` prefix. Seed: the concept seed of 2026-07-25 (not retained in this repository). Companion depth: [addendum.md](addendum.md)._

## Executive Summary

tk-studio is a generalized orchestration layer on top of **pure BMad Method**, combining five things: one **role-aware** orchestrated entry point that coordinates agents, skills, and workflows; a shared BMad base that keeps every team member on the same version in lockstep via git; a principled data taxonomy where a datum's **category decides its location, and location decides its version control**; a per-project engine that detects what a project is and recommends the right resource set — including resources the user authors themselves; and an operations model where every capability runs attended or unattended — headless-drivable, loopable, and schedulable. Its multi-agent deliberation mechanism — the **council** — survives as the orchestrator's signature interaction: convene the council.

It is the deliberate generalization of **the legacy council**, a game-company council system that proved the core concepts (domain detection, deterministic vendored distribution, tiered memory, orchestrated multi-agent routing) but entangled them with one studio's personas, Perforce streams, and Unreal Engine content. tk-studio extracts the engine from that vehicle. The long-term proof of success: the legacy council itself re-bases as a thin game-company overlay on tk-studio.

Why now: BMad expects per-project, per-developer installs — a model that drifts the moment more than one person, machine, or repo is involved. Upstream confirms the gap: as of v6.10.0 (July 2026) there is no lockfile or shared-install mechanism, and the closest community proposal (global install + link, issue #1728) has sat without maintainer response since February. Tim's 2026-07-25 direction settled the strategic questions (new and generalized; pure BMad base with minimal-to-zero upstream forks; lockstep via git; category-driven data placement; planning data in the team's tool of choice; user-authored resources as a first-class path). What remains is the short, well-defined decision list below, which this brief carries into the next workflow steps.

## The Problem

Four compounding pains hit anyone running BMad today beyond a single solo repo:

1. **Version drift.** Per-project `bmad install` means every repo and every developer can sit on a different BMad version with a different module set. Skills behave differently across projects; team members debug ghosts that are really version skew. There is no upstream mechanism to pin a team to one base (v6.4.0's channel pinning covers external modules per-project — not the core version, not the team).
2. **Data anarchy.** Agent working state, curated project knowledge, shared studio content, and planning artifacts (epics, stories, sprint state) all land wherever each skill happens to write. Personal scratch gets committed; team knowledge gets stranded on one machine; planning artifacts live as loose files when the team actually plans in Jira or Linear. legacy-council designed a fix (three-tier memory) but never shipped it — the code is stranded on an unmerged branch.
3. **Resource blindness.** BMad now spans many modules (bmm, gds, cis, tea, wds, external modules) plus whatever the user authors. Nothing inspects a project and says "here is the working set you need" — every project onboarding is manual archaeology, and capability gaps surface only as repeated manual toil that nobody converts into a skill.
4. **Ad-hoc automation.** The demand for unattended operation is proven — ClaudeOS already runs missions on a hand-rolled runner and a daily Dream cron — but every such system is bespoke: one-off tick loops, no shared job model, and no portable way to schedule long-running work (documentation passes, architecture audits, quality evaluations, research) or to keep agents current with a fast-moving ecosystem.

The cost of the status quo: onboarding a new project or teammate is slow and error-prone, work products scatter, and the system never gets smarter about itself.

## The Solution — Four Pillars

The pillars are named — **Lockstep, Taxonomy, Recommendation, Operations** — not numbered, so nothing collides with Perforce's "P4" abbreviation.

**Lockstep — shared BMad base via git.** The team runs one pinned BMad version, updated for everyone in one motion through git. Unmanaged per-developer installs are ruled out. A drift check at activation ("installed BMad ≠ pin → prompt") gives the guarantee teeth. The distribution mechanism — now covering both the BMad base *and* the studio layer itself, decided together and **first** (see O1) — is the single most contested open decision, with a full option analysis in the addendum.

**Taxonomy — category → location → VCS.** Four categories, each with a fixed home:

| Category | Scope | VCS | Location |
|---|---|---|---|
| Working data (session state, scratch, per-user memory, user role) | Per-user, per-machine | No | Per-user store, e.g. `~/.tk-studio/` |
| Project knowledge base (architecture, conventions, decisions) | Per-project, team-shared | Yes — project repo | Single root: `{project-root}/kb/` |
| Studio data (skills, agents, workflows, orchestrator) | Cross-project, team-shared | Yes — tk-studio repo | Delivered via the Lockstep mechanism |
| Planning data (epics, stories, tasks, sprint state) | Per-project, team-shared | Local backend default; external tool per binding | Per-project **binding** decides |

Which VCS is itself **per-project configuration**, not an assumption: the taxonomy binds team-shared categories to *the project's* VCS, named in project config — git is the default, but Perforce is first-class (its task-stream workflow mirrors git's feature-branch, commit-often discipline with different mechanics), and the Recommendation pillar suggests tooling for the configured VCS, chiefly MCP servers. The tk-studio repo itself, and base distribution, stay git regardless.

Planning data is the genuinely new subsystem, built **local-first** per Tim's 2026-07-25 rulings: the default local task-tracking backend is **Backlog.md** (markdown tasks in repo, CLI + MCP, basic web kanban — chosen for the interface and its plain-file storage), configured **per project** so each project can bind a different backend as more platforms gain adapters (Jira parity is the first target). The project **knowledge base is agent-first, humans second**: plain markdown under a single `kb/` root with an llms.txt-style index — no wiki server. Both are surfaced to humans through **Obsidian**: each project's data root is linked into the user's vault (location user-chosen), and tk-studio's config records the vault path, giving the studio and the operator one window over all projects. Every skill reads and writes through an adapter; switching backends is a designed export/transform/import migration with verification, not a manual copy — and research confirmed no interchange standard exists, so the adapter's canonical epic/story/task shape (frontmatter schema) is ours to define. Official Jira (Atlassian MCP, GA February 2026, Cloud-only — fine, the team is on Atlassian Cloud) and Linear MCP servers are mature; the pragmatic migration pattern is one-way promote with status pulled back, not bidirectional sync.

**Recommendation — per-project resource detection and working-set proposal.** An inventory + recommendation engine generalizing the legacy council's proven domain-profile registry: **inventory** what exists (installed modules, known-but-uninstalled modules, user-authored resources); **detect** the project's type and technologies (weighted markers, confidence floor, read-only, never silently guess); **recommend** a working set with evidence and explicit user confirmation, recorded in project config so activation is deterministic afterward — and the recommendation is **two-dimensional: role × project**, so an engineer and an artist on the same repo get different working sets; **evolve** by observing retrospectives and repeated manual work, proposing new resources — "you keep doing X by hand; want me to draft a skill for it?"

**Operations — attended ≙ headless, loops, scheduled jobs, disciplined execution.** Five commitments (detail in addendum A6):

- **Dual-mode invariant.** Every studio surface works identically in an attended session and headless (machine-readable status contract), so an external harness — the ClaudeOS/Hermes mission runner is the reference — can drive any of it. BMad skills already carry `-H` headless modes and JSON status blocks; the studio preserves this, ships both modes on every *new* surface, and verifies against the runner. Largely inherited; must be protected, not built.
- **Loops as first-class.** Recurring studio operations run as formal loops — declared interval or model-self-paced, with stop conditions and budget guards — formalizing the mission-runner tick pattern the ecosystem is converging on.
- **Scheduled jobs**, one-shot and recurring, for long-running unattended work: full documentation passes, architecture investigation, quality evaluation (performance/structure improvement suggestions), and **research jobs** that keep the studio current — agentic-development trends and practices, domain subject matter, and tool discovery (MCP servers, documentation, best practices, testing). Research jobs are the formalized input engine for the Recommendation pillar's evolve loop — the Dream-prescription pattern generalized. This is new subsystem #3; its precedent is ClaudeOS (mission runner + Dream cron), not legacy-council.
- **Model and effort routing.** Every agent and skill declares a conservative default Claude model and reasoning-effort level; the executing entity — the user or the orchestrator — can override both at runtime. Precedence: runtime override > project config > resource default.
- **Session and token discipline.** Long work splits at declared boundaries with compact handoff artifacts; runs persist in-progress state in resumable run workspaces so a fresh session continues without replaying history; token budgets are visible to the orchestrator when it routes work. Generalizes the ClaudeOS handoff protocol; the legacy council precedent is verified built — the "Research→Knowledge Lifecycle" (research spine before work, anchored deltas, custodian promotion gate) — and sits on the harvest PORT list (addendum A6).

**Role-aware orchestration** (settled 2026-07-25 with the tk-studio rename): the studio's entry point resolves *who you are* before *what you need*. Each user's job role lives in their per-user working data; the direction-giver role (Tim, today) turns high-level intent into delegation and synthesis, while execution roles — engineer, artist, designer, PR — get role-specific workflows. Roles are first-class in the architecture from day one; **v1 ships two roles** (direction-giver, developer), with the remaining roles arriving alongside the team as the multi-user test bed.

## The Layer Stack

Tight ClaudeOS integration was implicit in earlier drafts; it is now an explicit, cleanly separated stack:

1. **BMad** — the agent, skill, and tooling base.
2. **tk-studio** — the smart coordinator that expands BMad (this product).
3. **ClaudeOS MCP connector** — the interface between the studio and ClaudeOS, shipped by ClaudeOS as its own plugin.
4. **ClaudeOS** — the project-level surface: multi-project interactions and the UI where development actually happens.

tk-studio depends downward only (on BMad) and publishes upward a **driver contract** — headless invocation surface, status schema, job/scheduler model, model/effort override API — that layer 3 consumes. **The studio must be fully usable with or without ClaudeOS attached** (Tim's 2026-07-25 ruling); ClaudeOS is one harness among possible harnesses, the reference one, never a dependency. The connector is ClaudeOS-side work built as a later step; because that work will not start soon, every ClaudeOS-specific decision made here is consolidated in **addendum A7's integration dossier** so the connector effort can start cold.

## What Makes This Different

- **Builds on pure BMad instead of forking it.** Upstream owns resolution and evolution; tk-studio layers orchestration, distribution discipline, and data governance on top. Settled direction S3 pushes every design choice toward zero-fork.
- **Harvested, not speculated.** Nearly every piece has a working legacy-council precedent — deterministic vendor tooling with a verify phase, the read-only detector, the tiered-memory contract, the Research→Knowledge Lifecycle, promotion gating. The one exception is the planning-data adapter, which is honestly new and therefore the highest-risk subsystem.
- **Personal-first, team-ready.** It must earn its keep for one operator (Tim) before any team adopts it; the Lockstep and Taxonomy pillars are designed so scaling from one user to a team changes configuration, not architecture — and the role model means teammates arrive as configuration too.
- **Honest about the moat.** There is no technical moat. The advantage is execution speed, proven prior art, and being early to a gap upstream has not filled. Research (2026-07-25) found no direct competitor building lockstep + taxonomy + recommendation on BMad. The real risk is **upstream collision**: BMad's roadmap lists "Centralized Skills," "team workspaces," and "Jira/Linear integration" as stated intent — all undated and unstarted. Design consequence: build the Lockstep pillar thin (pin + drift check) so an upstream ship strands minimal code; the Recommendation pillar has no upstream analogue and is the safest differentiator.

## Who This Serves

- **Primary — Tim as solo operator:** every ClaudeOS-orbit project onboarded through detection → recommendation → deterministic activation, with data landing where it belongs by default.
- **Secondary — small teams adopting BMad:** teams of roughly 2–10 people — engineers, artists, designers, PR — each getting role-appropriate workflows from one shared base and one planning backend, without appointing a BMad librarian. Confirmed at review: Tim's own team is the first multi-user test bed.
- **Tertiary — the future legacy-council overlay:** the game-company layer (personas, Perforce skills, UE content) re-based on tk-studio, validating the generalization.

## Success Criteria

Confirmed at brief review (2026-07-25):

1. **Onboarding:** a brownfield project goes from zero to a confirmed, recorded resource set in a single session, with evidence shown for every recommendation.
2. **Lockstep:** BMad version drift is detected at activation and correctable with one command; zero unmanaged installs in the fleet.
3. **Taxonomy:** no category-misplaced data after a full project cycle (no scratch in repos, no team knowledge outside VCS, no planning artifacts outside the bound backend).
4. **Adapter:** the same planning skill flow works unchanged against the local backend and at least one external backend, and a local→backend migration round-trips with verification.
5. **Generalization proof:** the legacy council's game-specific content can be expressed as an overlay without patching tk-studio core.
6. **Dual-mode:** every studio skill completes headless under the ClaudeOS/Hermes mission runner with a machine-readable status, with no behavioral divergence from the attended run.
7. **Unattended evolution:** a recurring scheduled research job runs end-to-end without supervision and produces at least one Recommendation-pillar proposal the user accepts.
8. **Session discipline:** a multi-session workflow resumes from its run workspace and handoff artifact alone — no history replay — and stays within its declared token budget.

## Scope

**In for v1:** the Lockstep mechanism — whichever O1 selects, and O1 is decided *first* so everything downstream is built with the distribution method in mind; the Taxonomy with working-data store, the `kb/` knowledge-base convention (agent-first markdown + llms.txt-style index), and the planning adapter **local-first** — Backlog.md as the default per-project local backend, Obsidian vault linking for human visibility, with the first external backend (team is on Atlassian Cloud) following once local is stable via the designed migration; the Recommendation inventory/detect/recommend loop (evolve may land as observe-and-log first); a lean role-aware orchestrated entry point with **two roles** (direction-giver, developer); the dual-mode invariant from day one; a first scheduler cut — one-shot + recurring jobs covering at least one research-job type and one maintenance-job type, runnable as formal loops; model/effort defaults on every shipped resource with runtime override plumbing; and session-discipline conventions (boundary handoffs, resumable run workspaces).

**Explicitly out:** game-company specialization (the 11 legacy-council personas, Perforce stream skills, UE/Jenkins content, changelog/newsletter skills — all future tk-overlay material); any BMad fork beyond what O1 forces; multi-backend planning support beyond the first external backend; execution roles beyond developer (artist/designer/PR/custom roles arrive with the team); cross-project shared knowledge unless O4 pulls it in; a bespoke job-execution engine beyond what the chosen O8 substrate provides; the ClaudeOS MCP connector itself (ClaudeOS-side deliverable, built as a later step — tk-studio ships only the driver contract it consumes).

**Deliberately later — design leaves room, v1 does not build:** distribution hardening as the tool moves toward eventual public distribution — configuration surface, permissions model, security review. Added as things evolve, per Tim's 2026-07-25 ruling.

## The Decision List

Open questions from the seed plus brief-review additions. Rulings applied 2026-07-25: O6 merged into O1; O5 punted to architecture; O7 settled.

| # | Decision | Options | Notes | Venue |
|---|---|---|---|---|
| O1 | **Distribution mechanism — for the BMad base AND the studio layer, decided together** | M1 vendor-in-git / M2 lockfile+wrapper / M3 plugin / M2+M3 composite — with a **simplicity bias**: npx flows or plain release archives are acceptable if they satisfy lockstep + drift check | Broadened per Tim's ruling: this is central, decided FIRST so everything is built with the distribution method in mind; absorbs O6; S3 (pure BMad) pushes toward M2; measure M1's real per-release cost vs an M2 prototype | forge-idea / party-mode — next step |
| O2 | Planning adapter integration style | wrap skills / customize.toml overrides / bidirectional sync layer | Sync layer keeps BMad purest; research finding: one-way promote + status pull-back is the proven pattern, true bidirectional sync barely exists in the wild | architecture |
| O3 | First external backend(s) | Jira+Confluence (team is Atlassian Cloud — MCP-compatible) / Linear | Local backend (Backlog.md) ships first regardless; landscape research in addendum A2 | architecture |
| O4 | Cross-project shared knowledge in v1? | in / out (per-project KB only) | legacy-council "canonical" tier + promotion gate is the precedent; the Obsidian vault window (A2) partially serves the read side already | architecture |
| O5 | Orchestrator persona model | rebirth/sanctum identity system / lean stateless orchestrator / **lean orchestrator wrapped in a separate interaction persona shell** | Punted per Tim: attended sessions want a distinctive persona to interact with, but that may be extractable as a shell over a stateless core — "convene the council" is the shell's signature move | architecture |
| O6 | ~~Studio delivery surface~~ | — | **Merged into O1** (2026-07-25): delivering the studio layer is part of the joint distribution decision | — |
| O7 | ~~Name~~ | — | **Settled** (2026-07-25): **tk-studio**, with `tk-studio-*` agent/skill prefixes and the role-based structure adopted (two roles in v1); "council" survives as the interaction mechanism | — |
| O8 | Loop/scheduler substrate | harness-native primitives (loop skills, cron/scheduled agents) / generalize the ClaudeOS mission runner / hybrid | Mission runner is proven but bespoke; harness loops are where the ecosystem is heading; also decides where job definitions live; the ClaudeOS MCP connector is a candidate driver under any option | architecture |

## Vision

In two to three years, tk-studio is the invisible operating layer under every project Tim's team touches: a new repo is detected, equipped, and planned within an hour of cloning; each teammate — engineer, artist, designer, PR — opens the studio and gets workflows shaped to their role; the team never discusses BMad versions because there is nothing to discuss; planning artifacts flow between the repo and the team's tracker without anyone exporting anything; and the studio routinely proposes — and drafts — its own new capabilities from observed toil and from scheduled research that runs while nobody is watching. legacy-council runs as one overlay among several, and the overlay pattern is how any domain-specific team (game studio, data org, agency) folds tk-studio into their workflow.
