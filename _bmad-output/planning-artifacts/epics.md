---
stepsCompleted: [1]
inputDocuments:
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/brief.md
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/addendum.md
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/o1-decision-2026-07-26.md
  - _bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
note: No PRD exists by design (A8 process goes brief -> O1 -> architecture -> epics); FRs/NFRs are extracted from the brief + O1 ruling, with the architecture spine (20 ADs, binding) as the technical input. No UX document — agent/CLI product, no UI of its own (brief: dashboards stay ClaudeOS).
---

# tk-studio - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for tk-studio, decomposing the requirements from the product brief (PRD-equivalent), the O1 distribution ruling, and the architecture spine into implementable stories.

## Requirements Inventory

### Functional Requirements

**Lockstep**

FR1: The studio layer installs as a Claude Code plugin from this repo's git marketplace, auto-prompted on folder trust (`extraKnownMarketplaces`).
FR2: A committed `bmad.lock` pins the BMad core version, the module set with per-module version pins, and install flags.
FR3: `tk install` (plugin skill) runs the upstream BMad installer at the pin, non-interactively, with the project's module set — zero forks.
FR4: Activation runs a three-way health/drift check (installed `_bmad` vs pin; installed plugin vs marketplace; store/junction health) — report-only, guided fix, never silent, never auto-mutates.
FR5: A base-update skill bumps the pin, runs the upstream installer, and opens an integration PR (reviewable upstream diff).

**Taxonomy**

FR6: A per-user store at `~/.tk-studio/` holds user config (incl. role), the project registry, per-project working state (runs/scratch), and the local measurement ledger — never on any VCS.
FR7: Project knowledge lives at `{project-root}/kb/` as agent-first markdown with a generated llms.txt-style `index.md`.
FR8: Project config lives at `.tk-studio/config.yaml` (tracked) + `.tk-studio/config.local.yaml` (ignored/P4IGNORE), resolved runtime > project local > project tracked > user > studio default.
FR9: The project registry is a versioned-schema map keyed by `project_id`, single-writer (onboard/activate), atomic, and is the canonical cross-project read path.
FR10: Onboarding creates — and activation verifies — the Obsidian vault window: `<vault>/projects/<name>/` holding per-category links (`kb`, `backlog`).

**Planning adapter**

FR11: The adapter normalizes BMad-native planning artifacts with the canonical frontmatter shape (`shape_version: 1`: id, type, title, status enum, parent, depends_on, priority, external map, AC checklist); normalized artifacts are the single canonical local representation.
FR12: The adapter is the sole id authority: `EP-/ST-/TA-NNN` minted from a committed per-project counter; duplicate ids block sync until renumbered.
FR13: The `backlog-md` backend (v1 default local binding) projects canonical entities into a Backlog.md-compatible `backlog/` folder with promote + status-class pull-back, echo suppression, and round-trip-stable status mapping.
FR14: The `bmad-files` fallback backend is first-class: canonical files stand alone with index generation and no projection.
FR15: The `jira` backend promotes to Jira (Atlassian Cloud) via the official Atlassian MCP and pulls status back; headless auth is API-token with an enabled-toggle preflight.
FR16: Backend migration is a designed operation — export (canonical shape) → transform → import → verification (counts, id map, content hashes, spot round-trip) — under the ported tk safety rules (closed inventory, no-delete-before-clearance, copy-verify-flag).

**Recommendation**

FR17: Inventory enumerates installed modules, known-but-uninstalled official modules, and user-authored resources (project skills/agents, `_bmad/custom/`).
FR18: Detection scores project type/technologies with weighted markers and a confidence floor — read-only, never silently guesses.
FR19: Recommendation proposes a role × project working set with evidence; explicit user confirmation records it in the project config `working_set` map keyed by role.
FR20: The evolve loop observes and logs (emitting `observation` measurement events) — no automated proposal drafting in v1.

**Operations**

FR21: Every studio surface runs attended and headless with identical behavior and ends headless runs with the BMad-style JSON status block.
FR22: Jobs are declarative data (trigger, cadence, budget guards, stop conditions, model/effort, target skill); execution delegates to the bound substrate — harness-native primitives by default.
FR23: v1 ships at least one research job type (evolve input engine) and one maintenance job type (the conformance run qualifies), each runnable one-shot and recurring.
FR24: Every shipped resource declares conservative model/effort defaults; precedence runtime > project config > resource default.
FR25: Long work splits at declared boundaries with compact handoff artifacts and resumes from run workspaces under `~/.tk-studio/projects/<key>/runs/`.
FR26: A conformance suite ships in the plugin (`contracts/conformance/`) driving every surface headless and asserting the status contract, no-prompt behavior, and auth preflight.

**Measurement**

FR27: Studio surfaces emit taxonomy events (`install-outcome`, `drift-detection`, `activation-failure`, `headless-failure`, `onboarding-funnel`, `observation`, `report`) to the per-user-per-machine JSONL ledger — atomic, sanitized at emission, exactly one emitter per event type.
FR28: `tk report` captures human-authored defect reports as `report` events.
FR29: A measurement-push skill turns the local ledger into a feature branch + PR into the shared repo's `measurements/`.
FR30: A consolidation skill examines accumulated measurement PRs and creates `issues/ledger.md` entries (`ISS-NNN`, tk discipline) leading to specific fixes.

**Orchestration**

FR31: The orchestrated entry point resolves role (per-user store) before working set (project config) and routes/convenes/synthesizes accordingly; v1 ships direction-giver and developer roles.
FR32: The council persona shell loads only in attended sessions over the stateless core; headless bypasses it with identical routing and artifacts.
FR33: The plugin publishes the versioned driver contract: per-skill headless invocation, status schema, job/scheduler verbs, model/effort override API, drift-check invocation.

### NonFunctional Requirements

NFR1: Zero BMad forks — tk-studio layers on pure BMad; upstream owns resolution (S3).
NFR2: Headless parity — no behavioral divergence between attended and headless runs of any surface (success criterion 6).
NFR3: All studio data is plain files (markdown/YAML/JSONL), git-diffable, written atomically; concurrent human edits (Obsidian) must not corrupt state.
NFR4: Windows-first v1 (directory junctions, no admin rights); macOS/Linux via OS-resolved paths and symlinks.
NFR5: Credentials never land in tracked files, kb, planning artifacts, or measurement events; emission sanitization strips credential-shaped content.
NFR6: Never-silent mutation: drift/health checks report and guide; recommendations require explicit confirmation; migrations require clearance.
NFR7: Onboarding a brownfield project reaches a confirmed, recorded resource set in a single session, with the funnel instrumented (time-to-ready, failed steps, retries).
NFR8: Contracts are versioned (`shape_version`, event taxonomy, registry schema, driver contract); ids are stable and never reused.
NFR9: Studio scripts are stdlib-only Python run via `uv run`.
NFR10: The studio is fully usable with or without ClaudeOS attached; the connector is out of scope, the contract in scope.

### Additional Requirements

- No starter template: greenfield Claude Code plugin repo (this repo) — Epic 1 Story 1 stands up the marketplace + plugin skeleton in place (AD-1); the working `_bmad/` install (all 7 official modules, v6.10.0) already exists for developing the studio itself.
- The 20 architecture ADs are binding constraints on every story; the Capability → Architecture Map in the spine assigns each capability its governing ADs.
- `contracts/` in the plugin is the single home for schemas (status, job, interchange shape, event taxonomy, registry) and the conformance suite (AD-19).
- Per-VCS expression of conventions (git default, Perforce first-class) for anything that assumes branching/commit discipline (AD-18).
- Session/token discipline generalizes the ClaudeOS handoff protocol; the Research→Knowledge Lifecycle port is explicitly deferred (spine Deferred).
- Headless auth preflight is mandatory (silent-401 is the known #1 headless failure).
- tk harvest sources for implementation: `vendor_bmad.py` verify discipline (drift check), issues-ledger format, JSONL reconciliation-queue pattern, detect/onboard scripts, three-tier store design (local gitignored copy `legacy-council/`; never commit or push it).

### UX Design Requirements

None — tk-studio has no UI of its own (attended interaction happens in agent sessions; dashboards stay ClaudeOS per the brief). Human-facing views ride Obsidian and Backlog.md's own kanban.

### FR Coverage Map

FR1: Epic 1 — plugin + marketplace delivery
FR2: Epic 1 — bmad.lock pin
FR3: Epic 1 — tk install at the pin
FR4: Epic 1 — three-way drift/health check
FR5: Epic 1 — base-update integration PR
FR6: Epic 2 — per-user store
FR7: Epic 2 — kb/ + index
FR8: Epic 2 — project config + resolution
FR9: Epic 2 — project registry
FR10: Epic 2 — vault window links
FR11: Epic 3 — canonical shape + normalization
FR12: Epic 3 — id authority
FR13: Epic 3 — backlog-md projection
FR14: Epic 3 — bmad-files fallback
FR15: Epic 8 — Jira backend
FR16: Epic 8 — designed migration
FR17: Epic 4 — resource inventory
FR18: Epic 4 — project detection
FR19: Epic 4 — role × project recommendation + confirm
FR20: Epic 4 — evolve observe-and-log
FR21: Epic 5 — dual-mode invariant (ACs on every epic's stories; suite in Epic 5)
FR22: Epic 6 — job model + substrate binding
FR23: Epic 6 — research + maintenance job types
FR24: Epic 6 — model/effort routing plumbing (defaults are per-resource ACs from Epic 1 on)
FR25: Epic 6 — session discipline (handoffs, run workspaces)
FR26: Epic 5 — conformance suite
FR27: Epic 1 — measurement emission foundation (taxonomy, ledger)
FR28: Epic 1 — tk report verb
FR29: Epic 7 — measurement-push
FR30: Epic 7 — consolidation → issues ledger
FR31: Epic 5 — role-aware entry point
FR32: Epic 5 — council persona shell
FR33: Epic 5 — driver contract publication

## Epic List

### Epic 1: Install Once, Stay in Lockstep
An operator clones the repo, trusts the folder, and gets the studio plugin plus a pinned BMad base with one guided flow; every activation proves the fleet is drift-free, base updates are one reviewable motion, and every install/drift event is measured from day one.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR27, FR28

### Epic 2: Data Lands Where It Belongs
Onboarding a project stands up the full Taxonomy: per-user store, tracked project config, registry entry, agent-first `kb/` with index, and the Obsidian vault window — so no scratch hits repos, no knowledge strands per-machine, and every project is visible from one place.
**FRs covered:** FR6, FR7, FR8, FR9, FR10

### Epic 3: Plan Locally, Canonically
Stock BMad planning flows keep working untouched while the adapter canonicalizes their artifacts, owns ids, and projects them into a Backlog.md kanban — one canonical local representation under both local backends, sync-safe against human edits.
**FRs covered:** FR11, FR12, FR13, FR14

### Epic 4: The Studio Knows Your Project
The studio inventories what exists (including user-authored resources), detects what a project is with evidence, and proposes a role × project working set the operator explicitly confirms — recorded so activation is deterministic afterward, with observed toil logged for the evolve loop.
**FRs covered:** FR17, FR18, FR19, FR20

### Epic 5: One Front Door, Any Mode
The operator enters through a role-aware orchestrator (with the council persona shell in attended sessions), and every studio surface proves identical attended/headless behavior via the shipped conformance suite and the published driver contract any harness can consume.
**FRs covered:** FR21, FR26, FR31, FR32, FR33

### Epic 6: Work Runs While Nobody Watches
Recurring and one-shot jobs are declared as data and executed on harness-native substrates with budget guards and stop conditions — including the first research and maintenance job types — with model/effort routing and session discipline keeping unattended work cheap and resumable.
**FRs covered:** FR22, FR23, FR24, FR25

### Epic 7: The Studio Measures and Fixes Itself
Accumulated telemetry and human reports flow through the PR membrane into consolidated issues that lead to specific fixes — the O1 measurement loop closed end to end.
**FRs covered:** FR29, FR30

### Epic 8: Plan Where the Team Plans
A project rebinds from local planning to Jira through the designed migration with verification, and the same planning flows keep working — promote and status pull-back against Atlassian Cloud, headless-safe.
**FRs covered:** FR15, FR16
