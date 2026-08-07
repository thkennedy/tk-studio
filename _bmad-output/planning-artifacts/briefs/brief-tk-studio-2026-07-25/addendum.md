---
title: "tk-studio Brief — Addendum"
status: draft
created: 2026-07-25
updated: 2026-07-25
---

# tk-studio Brief — Addendum

Depth preserved from the [concept seed](../../../council/tk-council-concept-seed-2026-07-25.md) for downstream consumers (forge-idea on O1, `bmad-architecture`, module-builder). Not required reading for the brief itself.

## A1. Distribution mechanism — full option analysis (feeds O1)

> **O1 RULED (2026-07-26):** composite mechanism (studio-as-plugin + thin lockfile pin for the BMad base), measurement subsystem first-class, the M1-vs-M2 pre-measurement experiment dropped. Full ruling: [o1-decision-2026-07-26.md](o1-decision-2026-07-26.md). The analysis below stands as background record.

**O1 broadened (Tim's ruling, 2026-07-25):** the mechanism must distribute BOTH the BMad base and the tk-studio layer + tooling, decided together and FIRST — before architecture — so everything is built with the distribution method in mind (absorbs former O6). **Simplicity bias:** nothing complicated is required; npx flows or plain release archives are acceptable if they deliver lockstep + the drift check.

| Mechanism | How lockstep works | Pros | Cons |
|---|---|---|---|
| **M1 Vendor-in-git** | BMad copied into the shared repo by a deterministic vendor tool; team pulls | Proven by tk-council G2 (`vendor_bmad.py`: rules-not-patches, 8-check verify) | You own upstream patches (the plugin-hosting resolver fork); bundle bloat; re-vendor per release |
| **M2 Lockfile + installer wrapper** | Committed lockfile pins BMad version + module set; `tk install` runs the upstream installer at the pin and layers council content; bump lockfile → everyone re-runs | PURE BMad, zero forks (closest to the stated vision); the package-manager model everyone already understands; upstream owns resolution | Requires the wrapper to be excellent (idempotent, drift-detecting, cross-platform); per-project install step still exists, just managed |
| **M3 Plugin marketplace** | Council (and optionally BMad) delivered as a Claude Code plugin from a git marketplace; update = git pull + version bump | Machine-wide single install; clean update UX; tk-proven | If BMad rides inside: inherits M1's fork. If council-only: must pair with M1 or M2 for the BMad base anyway |

**Composite note:** M3 composes with M2 — council-as-plugin for the orchestration layer + lockfile-wrapper for the BMad base may be the "builds on top of pure BMad" sweet spot. A drift check on activation ("installed BMad ≠ lockfile pin → prompt") gives the lockstep guarantee teeth either way.

**Seed's evaluation plan:** measure M1's real per-release cost (run the tk-council 6.9→6.10 vendor cycle) against an M2 prototype before deciding. As of 2026-07-25 this experiment is live: BMad v6.10.0 shipped July 3, so that vendor cycle can now be measured for real.

**M3 mechanics (verified 2026-07-25):** Claude Code plugin marketplaces are git-hosted `marketplace.json` catalogs; the plugin `version` field (or an exact commit `sha` pin) controls when users see updates. A repo's `.claude/settings.json` can auto-prompt teammates to install a marketplace on folder trust (`extraKnownMarketplaces`, with `strictKnownMarketplaces` for lockdown). Updates are pull-based (bump + `/plugin marketplace update`), not push — so the activation drift check (composite note above) is required regardless of mechanism.

## A2. Planning-data adapter requirements (feeds O2/O3, architecture)

New subsystem #1 — no tk-council precedent. **Build order (Tim's ruling, 2026-07-25): local-first.** The default in-repo backends ship and stabilize before any external backend, making local development easy; migration local → online is designed to be straightforward.

**Local backend rulings (Tim, 2026-07-25, post-research):**
- **Task tracking: Backlog.md** is the v1 default local backend — chosen for its plain-markdown-in-repo storage plus the basic web kanban interface. The backend is **per-project config** (the binding), so each project can select a different platform as more adapters land; Jira parity via adapter is the first external target. Known gap to bridge in the adapter: Backlog.md has no native epic entity — the canonical frontmatter schema carries epic identity, mapped onto Backlog.md milestones/labels.
- **Knowledge base: agent-first, humans second.** Plain markdown in-repo under a **single root folder** (`kb/` or `knowledge-base/`), llms.txt-style index — no wiki server. Optimized for agent retrieval; human readability is a byproduct.
- **Obsidian as the human window:** each project's data root is linked into the user's Obsidian vault (vault location is the user's choice; on Windows use **directory junctions**, not symlinks — junctions need no admin rights). tk-studio config records the vault path. Recommended shape: one link per project — `<vault>/projects/<name>/` → the project's studio data root (containing `kb/` and the Backlog.md folder) — so both knowledge and tasks appear in the vault with a single link to manage.
- **Vault is a view, not the database** `[RECOMMENDATION — adopted in brief pending objection]`: the studio's canonical path for cross-project queries ("status of all projects") is its own **project registry** in working data (the studio must already track known projects + bindings for Lockstep and Recommendation), reading each project's backend directly. Reasons: broken/absent links, projects deliberately outside the vault, multi-machine setups, teammates who don't run Obsidian, and sync-plugin churn. The vault remains the human aggregation window — and a free ClaudeOS synergy: the ClaudeOS aggregator already scans Obsidian vaults, so every project's kb and tasks surface in the ClaudeOS memory graph at zero cost.
- Minor caveat: vault visibility means humans can edit task/kb files in Obsidian; files are the source of truth so this is fine, but concurrent human+agent edits are possible — adapter writes should be atomic and diff-friendly. The team's Jira is Atlassian Cloud, so the official (Cloud-only) Atlassian MCP is viable for the first external backend.

**Tracker/KB landscape research digest (2026-07-25 — full report: [planning-backend-research-2026-07-25.md](planning-backend-research-2026-07-25.md)):**
- **Task tracking:** markdown-tasks-in-repo is the convergent agent-native convention (Spec Kit ~100k stars normalized it). Best-in-class options: **Backlog.md** (MIT, ~6.3k stars — plain `.md` tasks in repo, CLI + MCP + kanban web UI, milestones and dependencies, but no epic entity and no Jira/Linear sync) and **beads** (MIT, ~25.7k stars — richest hierarchy/dependency graph, but storage pivoted to an embedded Dolt binary blob, which hurts git-diffability and therefore Lockstep review). claude-task-master overlaps BMad's own PRD→story pipeline (redundant here); Focalboard is unmaintained and Taiga has ownership churn — both ruled out; Plane (AGPL, native MCP) is the best self-hosted Jira-like if ever needed.
- **Knowledge base:** markdown docs-in-repo + a thin index (llms.txt-style) is the agent-native pattern; Obsidian is a viewer over the same files; Outline is the best served-wiki upgrade path; markdown→Confluence publishing is a solved problem (`kovetskiy/mark`, md2cf).
- **Migration reality check:** no canonical epic/story/task interchange standard exists anywhere — the adapter's canonical shape is genuinely novel and must be self-defined (frontmatter schema recommended). Bidirectional file↔Jira sync barely exists in the wild; the pragmatic pattern is **one-way promote** (local → Jira/Linear via official MCPs + native importers) with status pulled back, not true bidirectional sync — a material input to O2.
- **Recommendation (research agent's, endorsed):** v1 default backend = BMad-style markdown + thin index with the canonical shape as frontmatter schema — honestly the best answer; Backlog.md as an optional structured local backend (beads deferred over binary storage); migration via one-way promote through Atlassian/Linear MCP rather than sync. Seven verification flags are listed in the full report.

Requirements as captured:

- A per-project **binding** in tracked config (exactly one per project): which backend, which project/space ids. Every skill that reads/writes planning artifacts goes through the adapter, never directly to files or APIs.
- The in-repo VCS fallback is a **first-class backend**, not a degraded mode — BMad's native file outputs become "the fallback adapter."
- **Migration is a designed operation:** switching backends mid-project (files → Jira, Jira → Linear) is an export/transform/import flow with a verification pass, not a manual copy. The adapter contract must therefore define a **canonical interchange shape** for epic/story/task.
- BMad skills touching planning data (`create-epics-and-stories`, `sprint-planning`, `sprint-status`, `dev-story`, `create-story`, …) read/write through the adapter. Open integration styles (O2):
  1. **Wrap** — name-based handoff with pre/post sync around stock skills.
  2. **Customize** — `customize.toml` overrides on each skill.
  3. **Sync layer** — bidirectional backend ↔ fallback-file sync; skills stay untouched. Keeps BMad purest.

## A3. Harvest map from tk-council

**PORT (concept proven, generalize):**
- Domain-profile registry → resource inventory/recommendation engine (Recommendation pillar); keep data-only JSON profiles, read-only detector, dry-run onboarding, explicit confirm.
- Three-tier memory contract + per-user store design (`target-state-architecture.md` §3–6; `lib/tk_store.py` on the unmerged branch) → Taxonomy working data + project KB. The migration-safety rules — closed inventory, no-delete-before-clearance, copy-verify-flag cutover — port verbatim.
- Vendor tooling discipline (deterministic rules, verify phase, sentinel-anchored patches, timestamp-free manifests) → whichever Lockstep mechanism wins; even M2's wrapper wants the verify/drift-check half.
- Thin `agents/` wrapper pattern (subagent → Skill delegation) if plugin delivery is chosen.
- Governance: promotion membrane, gate reviews, issue ledger — adapt to solo/team scale.
- **Research→Knowledge Lifecycle** (multi-session anti-drift — VERIFIED BUILT, 2026-07-25 inventory): `tk-investigate` produces a mission-start research spine plus per-mini-goal seeds with anchored, evidence-graded findings; working segments never edit the doc directly — they emit anchored deltas in handoffs into a JSONL reconciliation queue that the custodian persona (Reina) promotes through a gate. Port as the Operations pillar's session-discipline backbone. Caveat: half the machinery lives in the ClaudeOS mission runner today (see A7 dossier).

**ADAPT:** orchestrator (Alya) routing/synthesis/convene capabilities — minus game-company personas. External-roster handoff (name-based coupling to stock BMad skills) becomes the DEFAULT coupling model everywhere.

**LEAVE (tk-specific, future overlay):** the 11 personas and their lore; Perforce stream skills (`tk-stream-*`); changelog/newsletter skills; UE/Jenkins specialist content; canonical/ue garden.

## A4. Relationship to tk-council (context)

- tk-studio (working title "tk-council" in earlier documents) is **not** an import or restructuring of tk-council; it is a new, generalized personal system harvesting tk-council's proven concepts.
- The tk-council packaging debate (eval doc `eval-tk-council-packaging-2026-07-25.md` §4) is **superseded** by this direction; that eval's inventory and debts sections still stand for the tk-council repo itself.
- Long-term, tk-council re-bases as a thin game-company overlay on tk-studio.
- Inventory (2026-07-25) headline: plugin v0.7.1, 1,543 files — 17 tk-* skills (11 persona + 6 workflow), 71 bmad-* + 33 gds-* vendored skills, 11 agent wrappers, 5 domain profiles + detect/onboard scripts. It also **reconfirmed the eval's urgent flag**: `shared-memory/` contains a token leak — scrub before any harvest or publication. Per-user store code remains stranded on the unmerged branch (`lib/` holds stale bytecode only).
- Operational note: no live tk-council checkout exists on this machine — the inventory's source of record is `D:\ClaudeOS\tk-council.rar` (repo `main` @ d26a67f); the real working copy lives on another machine (Perforce workspace). Plan harvest work accordingly.

## A5. Landscape research digest (2026-07-25)

Web research run during the brief session; grounds the "Why now" and moat claims.

- **BMad upstream state:** latest release v6.10.0 (2026-07-03); v7 exists only as a deprecation horizon — no date or feature list. Installer is per-project (`npx bmad-method install` → `_bmad/`). v6.4.0 added channel/pin resolution for *external modules* only — no team lockfile, no core-version lockstep, no shared install. Closest motion: [issue #1728](https://github.com/bmad-code-org/BMAD-METHOD/issues/1728) (global install + link, open since 2026-02-21, no maintainer response).
- **Upstream roadmap overlap:** "Universal Skills Architecture," "Centralized Skills (install once, use everywhere)," and later "Skill Marketplace," "Workflow Customization incl. Jira/Linear integration," "Enterprise team workspaces" — all undated. tk-studio overlaps upstream's stated *intent*, not shipped or near-term work. Mitigation: keep Lockstep thin; the Recommendation pillar has no upstream analogue.
- **Planning-backend maturity:** Atlassian's official remote MCP server GA 2026-02-04 (Jira/Confluence/Bitbucket; Cloud-only — no Data Center); Linear's official hosted MCP server live since May 2025, full read/write. The O3 candidates are both officially supported.
- **Comparables:** dominant team pattern is committing `.claude/skills/` or a private plugin marketplace into the repo (informal git-lockstep); no product found doing BMad-specific team versioning, taxonomy, or recommendation.
- Key sources: [BMad releases](https://github.com/bmad-code-org/BMAD-METHOD/releases) · [roadmap](https://docs.bmad-method.org/roadmap/) · [install docs](https://docs.bmad-method.org/how-to/install-bmad/) · [plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) · [Atlassian MCP](https://github.com/atlassian/atlassian-mcp-server) · [Linear MCP](https://linear.app/changelog/2025-05-01-mcp)

## A6. Autonomous operations — Operations pillar detail (feeds O8, architecture)

Added by Tim during brief review, 2026-07-25. New subsystem #3; precedent is ClaudeOS itself (mission runner + Dream cron), not tk-council.

**Dual-mode invariant — evidence it is mostly inherited:**
- BMad skills already ship headless modes: `-H` flags on product-brief, prfaq, agent-builder, workflow-builder, module-builder (per the help catalog), and skill contracts define headless behavior (no prompts; halt `blocked` on ambiguity; end with a JSON status block listing status/intent/artifact paths).
- Requirement therefore splits three ways: **preserve** (never break upstream headless contracts when layering council content), **extend** (every new council surface — orchestrator, adapter, scheduler — ships attended + headless from day one, JSON status contract included), **verify** (a conformance check drives each surface via the ClaudeOS/Hermes mission runner as the reference external harness).
- Known operational risk to design for: headless `claude -p` does not use interactive OAuth — it needs `ANTHROPIC_API_KEY` or `claude setup-token`, and silent 401s are ClaudeOS's #1 historical headless failure mode. Headless conformance must include an auth preflight.

**Loops — what "formal" adds over the mission-runner tick:**
- Declared cadence: fixed interval or model-self-paced (the runner picks its own next wake based on what it is waiting on).
- Stop conditions and budget guards as part of the loop definition, not runner code.
- Notification-driven wakeups (react when tracked work completes) instead of blind polling.
- Harness-native primitives available today: recurring prompt/slash-command loops, self-paced wakeup scheduling, cron-scheduled local tasks, and cloud-scheduled agents (routines). The ClaudeOS mission runner is a hand-rolled equivalent (tick + missions.json) — proven demand, bespoke implementation, with known sharp edges (e.g. the dirty-tree silent-skip gotcha).

**Scheduled jobs — target job families (Tim's list):**
- *Maintenance:* full code documentation passes; architecture investigation; quality evaluation (suggested improvements for performance, structure, etc.).
- *Research/evolution:* latest trends and practices in agentic development; project subject-matter research; tool discovery for a domain — MCP servers, documentation, best practices, testing approaches.
- Both **one-shot and recurring**; research-family output feeds the Recommendation pillar's evolve loop (Dream-prescription pattern: scan → score → prescribe → user accepts → recorded).

**Model & effort routing (added 2nd review round):**
- Every agent and skill declares a **conservative default**: the cheapest Claude model + reasoning-effort level that reliably does its job. Escalation is deliberate, never accidental.
- Runtime override by the executing entity — usually Tim or the orchestrator. Precedence: runtime override > project config > resource default.
- Mechanics notes for architecture: the harness already supports per-invocation model and effort overrides on subagent calls; BMad's customize layer (`customize.toml`) is the natural home for defaults; the orchestrator wants a routing table mapping task class → model/effort. Defaults should be plan-headroom-aware (flat-rate headroom changes the calculus vs PAYG).

**Session & token discipline (added 2nd review round):**
- Formalizes the local handoff protocol as a council requirement: at epic/story/phase boundaries, write a compact handoff artifact, end the session, resume fresh.
- Runs persist in-progress state in **resumable run workspaces** (bmm precedent: memlog + run folders — this brief's own workspace is an instance of the pattern).
- tk-council precedent — **VERIFIED (2026-07-25 inventory): the process EXISTS and was built**, as the "Research→Knowledge Lifecycle": `tk-investigate` generates a research spine at mission start (plus per-mini-goal seeds, anchored evidence-graded findings); working segments emit anchored deltas via handoffs → JSONL reconciliation queue → promotion gate owned by **Reina (custodian — not tech-writer; Sora is tech-writer, Yui is planner/decompose-gate)**. Wired into the ClaudeOS runner (`mission-spine-pass.ts`, `mission-mg-start-pass.ts`, `knowledge-schema.ts`, `mission-reconciliation-queue.ts`). Now on A3's PORT list; full detail in [tk-council-inventory-2026-07-25.md](tk-council-inventory-2026-07-25.md).
- Token awareness: the orchestrator sees budget and spend when routing; scheduled jobs (Operations) declare token budgets; session splits are triggered by boundaries *and* budget, not context exhaustion.

**O8 framing (substrate decision, architecture venue):**
1. Build on harness-native loop/schedule primitives — least code, rides ecosystem momentum, but couples the council to one harness.
2. Generalize the ClaudeOS mission runner — proven, Tim-owned, harness-agnostic, but bespoke code to maintain.
3. Hybrid — council defines a job model (data), execution delegates to whatever substrate the machine has (mirrors the Taxonomy adapter philosophy: binding decides, contract stays canonical).
Related question O8 also settles: where job definitions live in the Taxonomy (likely project config for per-project jobs, council data for generic job types, working data for run state).

## A7. VCS configurability and the layer stack (2nd brief-review round)

**Per-project VCS (Tim's ruling, 2026-07-25 — settled, not open):**
- VCS is strictly tied to project configuration. Git is the default; **Perforce is first-class** even though Tim doesn't use it personally right now.
- Perforce note: the tk-council development process uses **task streams** mirroring git's feature-branch + commit-often approach — same discipline, different mechanics. Council conventions that assume git semantics (branch-per-goal, frequent commits, review-before-merge) must be expressible per-VCS, not hardcoded.
- The Recommendation engine suggests tooling for the configured VCS — chiefly MCP servers.
- The tk-studio repo itself and base distribution remain git regardless of project VCS.
- Naming guard (resolved 2026-07-25): pillar ids dropped in favor of named pillars — **Lockstep, Taxonomy, Recommendation, Operations** — after "P4" was misread as Perforce during review. Write "Perforce" in full everywhere regardless.
- Product naming (settled 2026-07-25): **tk-studio**, with `tk-studio-*` as the agent/skill prefix; "council" survives as the interaction mechanism (convene the council — see O5 persona shell). All references to "tk-council" in earlier-dated documents (the seed, the tk-council eval) are the working title of this same product.

**Layer stack (Tim's ruling, 2026-07-25 — confirmed):**
- Four layers: **BMad** (agent/skill/tooling base) → **tk-studio** (smart coordinator expanding BMad) → **ClaudeOS MCP connector** (studio ↔ ClaudeOS interface) → **ClaudeOS** (project-level surface: multi-project interactions + development UI).
- The connector is **ClaudeOS-side work**, shipped as a ClaudeOS plugin, **built as a later step** — kept separate from tk-studio development. tk-studio publishes the driver contract it consumes and **must be fully usable with or without ClaudeOS**.
- Implication for O8: the ClaudeOS MCP is a candidate driver under any substrate choice; mission-runner conformance (success criterion 6) runs through the connector once it exists — direct headless invocation until then.
- Implication for scope: connector out of tk-studio v1; contract in.

**ClaudeOS integration dossier** — every ClaudeOS-specific decision made during this brief, consolidated here because the connector work will not start soon and context must survive the gap:

1. **Ownership:** connector = ClaudeOS plugin, in the ClaudeOS repo, not tk-studio's. tk-studio never imports ClaudeOS anything.
2. **Driver contract the connector will consume** (tk-studio's deliverable, defined at architecture): headless invocation surface for every studio skill; JSON status schema (BMad-style status blocks); the job/scheduler model (submit, tick/wake, status, cancel); the model/effort override API; drift-check invocation.
3. **Reference-harness role:** the ClaudeOS/Hermes mission runner is the conformance target for success criterion 6 (headless parity). Until the connector exists, conformance tests drive skills via direct headless invocation.
4. **Known ClaudeOS mechanics the connector must bridge** (state as of 2026-07-25): mission runner tick + missions.json; daily Dream cron pattern; the handoff protocol (boundary handoff → fresh session); headless auth preflight requirement (`claude -p` needs `ANTHROPIC_API_KEY`/`setup-token` — silent-401 is the #1 historical failure); mission-runner sharp edges must stay behind the connector (e.g. dirty-tree silent-skip), not leak into council design. Additionally: the tk-council Research→Knowledge Lifecycle is currently **split across** the tk-council skill (`tk-investigate`) and ClaudeOS runner passes (`mission-spine-pass.ts`, `mission-mg-start-pass.ts`, `knowledge-schema.ts`, `mission-reconciliation-queue.ts`) — generalizing it means moving the runner-side halves council-side behind the driver contract, with ClaudeOS as first driver.
5. **O8 linkage:** if O8 chooses "generalize the mission runner" or "hybrid," the generalized runner code likely *originates* from ClaudeOS but must land council-side (harness-agnostic) with ClaudeOS as first driver.
6. **ClaudeOS remains the multi-project UI** — the council does not grow a UI of its own; attended interaction happens in sessions (see O5 persona shell), dashboards stay ClaudeOS.

## A8. Proposed process (seed §5, updated at review)

1. `bmad-product-brief` (this run) — output: the brief with the decision list. ✔ (three review rounds folded in 2026-07-25)
2. `bmad-forge-idea` or party-mode debate on O1 — **broadened**: the joint distribution mechanism for BMad base + council layer, decided before anything is built. Measure M1's real per-release cost vs an M2 prototype; simplicity bias applies.
3. `bmad-architecture` — target state: repo layout, config schema, adapter contract, store paths, driver contract, O2/O3/O4/O5/O8 rulings.
4. `bmad-module-builder` / epics-and-stories → Mission Control, greenfield repo.

Research inputs — both landed 2026-07-25 in this workspace: [tk-council-inventory-2026-07-25.md](tk-council-inventory-2026-07-25.md) (full plugin inventory; anti-drift process verdict: EXISTS, built) and [planning-backend-research-2026-07-25.md](planning-backend-research-2026-07-25.md) (tracker/KB landscape; v1 = markdown + frontmatter schema, one-way promote for migration).
