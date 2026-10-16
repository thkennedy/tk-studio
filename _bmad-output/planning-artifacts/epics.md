---
stepsCompleted: [1, 2, 3, 4]
status: complete
inputDocuments:
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/brief.md
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/addendum.md
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/o1-decision-2026-07-26.md
  - _bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/briefs/planning-pass-research-knowledge-port-2026-08-06.md
  - _bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md
  - _bmad-output/planning-artifacts/briefs/brief-studio-supervisor-2026-09-27/brief.md
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
FR16: Backend migration is a designed operation — export (canonical shape) → transform → import → verification (counts, id map, content hashes, spot round-trip) — under the ported legacy-council safety rules (closed inventory, no-delete-before-clearance, copy-verify-flag).

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
FR30: A consolidation skill examines accumulated measurement PRs and creates `issues/ledger.md` entries (`ISS-NNN`, legacy-council discipline) leading to specific fixes.

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
- legacy-council harvest sources for implementation: `vendor_bmad.py` verify discipline (drift check), issues-ledger format, JSONL reconciliation-queue pattern, detect/onboard scripts, three-tier store design (local gitignored copy `legacy-council/`; never commit or push it).

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

### Epic 9: Research Becomes Knowledge
The Research→Knowledge Lifecycle port (spine Deferred entry, planning pass 2026-08-06, D1–D5 ruled): research findings anchor to a per-project spine and per-run seeds, corrections ride handoffs as anchored deltas into a per-project reconciliation queue, and a routing doc drives human-gated promotion into `kb/` through the PR membrane — closing the missing findings→kb edge. Ships the deliberate contract 1.7.0 bump (DW-1, DW-3 fold in).
**Requirements source:** planning-pass-research-knowledge-port-2026-08-06.md (no FR row — post-v1 deferred scope)

### Epic 10: Observation Becomes Proposal
Evolve-loop automation (spine Deferred entry, planning pass 2026-08-07, D1–D5 ruled): accumulated observation events cluster into evidenced, stable-id proposals in an in-repo ledger the machine drafts and only a human adopts — completing the loop AD-8 scoped, behind the proven membrane. Ships the additive contract 0.1.9 bump.
**Requirements source:** planning-pass-evolve-loop-automation-2026-08-07.md (no FR row — post-v1 deferred scope)

## Epic 1: Install Once, Stay in Lockstep

An operator clones the repo, trusts the folder, and gets the studio plugin plus a pinned BMad base with one guided flow; every activation proves the fleet is drift-free, base updates are one reviewable motion, and every install/drift event is measured from day one. (AD-1, AD-12, AD-13; dual-mode ACs per AD-11 apply to every skill story in every epic.)

### Story 1.1: Install the Studio Plugin from the Repo

As an operator,
I want cloning and trusting the tk-studio repo to auto-prompt installation of the studio plugin,
So that a new machine or teammate gets the studio layer with zero manual marketplace setup.

**Acceptance Criteria:**

**Given** a fresh clone of the tk-studio repo on a machine with Claude Code
**When** the operator trusts the folder
**Then** the marketplace defined in `.claude-plugin/marketplace.json` is auto-prompted via `extraKnownMarketplaces` in the repo's `.claude/settings.json`
**And** accepting installs the `tk-studio` plugin whose `plugin.json` version is in lockstep with `marketplace.json` (`plugins[].version`)

**Given** the plugin skeleton in `plugins/tk-studio/`
**When** the plugin is installed
**Then** `skills/`, `agents/`, `contracts/`, and `bmad.lock` locations exist per the spine's structural seed, and a placeholder skill resolves `{skill-root}` correctly machine-wide

### Story 1.2: Measurement Foundation — Taxonomy and Ledger

As an operator,
I want every studio surface able to append sanitized events to my local measurement ledger,
So that the system instruments itself from the first install instead of speculating about defects.

**Acceptance Criteria:**

**Given** the event-taxonomy schema shipped at `contracts/` (v1: install-outcome, drift-detection, activation-failure, headless-failure, onboarding-funnel, observation, report)
**When** any studio skill emits an event through the shared ledger library
**Then** one JSON object (`{ts, event, user, machine, project?, payload}`) appends atomically to `~/.tk-studio/measurements/<user>-<machine>.jsonl`
**And** the payload matches that event type's schema, which names exactly one emitter class per type

**Given** an event payload containing credential-shaped content or a non-allowlisted absolute path
**When** it is emitted
**Then** sanitization strips or masks it at emission, before the line lands in the ledger

**Given** two concurrent emitters on one machine
**When** both write
**Then** no line is interleaved or lost (atomic append semantics)

### Story 1.3: Pin the Base — bmad.lock and tk install

As an operator,
I want `tk install` to install the BMad base at the committed pin with my project's module set,
So that every repo and teammate runs the identical base with zero forks.

**Acceptance Criteria:**

**Given** a committed `bmad.lock` pinning the BMad core version, per-module versions/channels, and install flags
**When** the operator runs the `tk-studio-install` skill in a project
**Then** the upstream installer runs non-interactively at the pinned core version with the project's configured module set
**And** an `install-outcome` event (success or failure, with step detail) is emitted

**Given** the same lockfile and module set on two machines
**When** both run the flow
**Then** both produce the same `_bmad/_config` manifest versions (deterministic install)

**Given** a headless invocation
**When** the skill runs
**Then** it completes without prompting and ends with the JSON status block

### Story 1.4: Activation Health and Drift Check

As an operator,
I want activation to prove both planes are current — read-only and loud,
So that version skew is caught at the front door instead of debugged as ghosts.

**Acceptance Criteria:**

**Given** an installed BMad base and studio plugin
**When** the `tk-studio-activate` check runs
**Then** it compares installed `_bmad` manifest versions against `bmad.lock` and the installed plugin version against `marketplace.json`
**And** reports drift with the exact guided fix (`tk install` / `/plugin marketplace update`) without mutating anything
**And** emits `drift-detection` (on drift) or a clean-pass event, plus `onboarding-funnel` timings when run in guided onboarding mode

**Given** a machine where a check step itself fails (unreadable manifest, missing store)
**When** the check runs
**Then** the failure is reported as `activation-failure` with the failing step named, and the skill still ends with a valid JSON status block

### Story 1.5: tk report — Human Defect Reports

As an operator,
I want a one-verb way to record "the skill did the wrong thing,"
So that human-observed defects enter the same measurement stream as telemetry.

**Acceptance Criteria:**

**Given** an operator invoking `tk-studio-report` with a free-text description
**When** the skill runs
**Then** a `report` event lands in the local ledger carrying description, suspected surface, and context (project, skill, session mode)
**And** the flow works identically attended (prompted elaboration) and headless (payload-supplied), per AD-11

### Story 1.6: Base Update as a Reviewable Motion

As an operator,
I want a base update to be one skill run that produces an integration PR,
So that the team adopts upstream changes in lockstep with a reviewable diff and no fork.

**Acceptance Criteria:**

**Given** a new upstream BMad release
**When** the `tk-studio-base-update` skill runs with the target version
**Then** it bumps `bmad.lock` (core and/or per-module pins), reruns the upstream installer at the new pin in this repo, and opens a feature-branch PR containing lockfile + resulting install diff
**And** the PR body summarizes upstream changes and flags any install warnings; nothing merges automatically

**Given** the installer fails at the new pin
**When** the skill runs
**Then** the working tree is left restorable (branch isolation), the failure is emitted as `install-outcome: failure`, and the status block reports `blocked` with the reason

## Epic 2: Data Lands Where It Belongs

Onboarding a project stands up the full Taxonomy: per-user store, tracked project config, registry entry, agent-first `kb/` with index, and the Obsidian vault window. (AD-3, AD-8, AD-15, AD-18, AD-20.)

### Story 2.1: Per-User Store Standup

As an operator,
I want my working data, role, and machine identity in one off-VCS store,
So that scratch and identity never hit shared version control and teammates never collide.

**Acceptance Criteria:**

**Given** a machine without `~/.tk-studio/`
**When** any studio surface first needs the store
**Then** the store skeleton (`config.yaml`, `registry/`, `projects/`, `measurements/`) is created at the OS-resolved path (`%USERPROFILE%\.tk-studio\` on Windows)
**And** `config.yaml` records user_name, role (default: developer), machine_id, and optional obsidian_vault

**Given** an existing store
**When** standup runs again
**Then** it is idempotent — nothing is overwritten or lost

### Story 2.2: Project Config and Resolution

As an operator,
I want tracked project configuration with a per-dev local overlay and one resolution order,
So that every skill resolves the same key the same way and no machine path lands on shared VCS.

**Acceptance Criteria:**

**Given** a project being onboarded
**When** config is written
**Then** `.tk-studio/config.yaml` (tracked: project_id?, vcs, planning binding, working_set, jobs) and `.tk-studio/config.local.yaml` (ignored; P4IGNORE guidance emitted for Perforce projects) exist with schema comments

**Given** a key defined at multiple scopes
**When** any surface resolves it through the shared config library
**Then** precedence is runtime override > project local > project tracked > user > studio default, verified by test fixtures

**Given** a tracked file about to be written
**When** it would contain an absolute machine path or credential
**Then** the write is refused with a classification error (AD-3)

### Story 2.3: Project Registry

As an operator,
I want every known project registered in one canonical map,
So that cross-project queries have a single authoritative read path.

**Acceptance Criteria:**

**Given** the registry schema published in `contracts/` (map keyed by project_id: root path, bindings, VCS, working-set ref, vault-link state)
**When** onboarding registers a project
**Then** the entry is written atomically to `~/.tk-studio/registry/projects.yaml` by the single-writer path (onboard/activate only)

**Given** a project whose basename collides with an existing project_id
**When** registration runs
**Then** it fails with a demand for an explicit `project_id` — never a silent second identity

**Given** any other surface (orchestrator, jobs, measurement)
**When** it needs project data
**Then** it reads the registry and never writes it

### Story 2.4: Agent-First Knowledge Base

As an operator,
I want each project's knowledge in `kb/` with a ranked index,
So that agents retrieve project knowledge in one hop and humans read the same files.

**Acceptance Criteria:**

**Given** an onboarded project without `kb/`
**When** kb standup runs
**Then** `{project-root}/kb/` is created with an llms.txt-style `index.md` (ranked links + one-line descriptions)

**Given** kb content changes
**When** index generation reruns (manually or as a job)
**Then** `index.md` reflects current files without human reordering, and the diff is review-friendly

### Story 2.5: Obsidian Vault Window

As an operator,
I want each project's kb and backlog visible in my vault under one folder,
So that I get one human window over all projects without the vault becoming a database.

**Acceptance Criteria:**

**Given** a user config with `obsidian_vault` set
**When** onboarding links a project
**Then** `<vault>/projects/<name>/` exists containing links: `kb` → `{project-root}/kb/`, `backlog` → the bound planning folder — directory junctions on Windows (no admin), symlinks elsewhere

**Given** a broken or missing link
**When** activation runs
**Then** the vault-link state is reported (and recorded in the registry entry) with a guided fix — never auto-recreated silently

**Given** no vault is configured
**When** onboarding runs
**Then** linking is skipped cleanly and everything else proceeds (vault is a view, never a dependency)

## Epic 3: Plan Locally, Canonically

Stock BMad planning flows keep working untouched while the adapter canonicalizes their artifacts, owns ids, and projects them into a Backlog.md kanban. (AD-4, AD-5, AD-6.)

### Story 3.1: Canonical Interchange Schema

As a developer using planning skills,
I want the canonical epic/story/task shape published as a versioned schema,
So that every backend adapter and migration maps to one authoritative contract.

**Acceptance Criteria:**

**Given** the interchange schema (`shape_version: 1`) in `contracts/`
**When** an entity file is validated against it
**Then** required keys (id, type, title, status enum, created/updated) and optional keys (parent, depends_on, priority, assignee, labels, external map) are enforced, with the status enum closed (draft|ready|in-progress|blocked|review|done|dropped)

**Given** a validation library shipped with the plugin
**When** any adapter or skill checks an entity
**Then** it uses this library (stdlib-only Python, `uv run`) — no adapter ships its own parser

### Story 3.2: Normalize Pass and Id Authority

As a developer running stock BMad planning flows,
I want the adapter to canonicalize what those flows produce,
So that untouched upstream skills still yield one canonical local representation with collision-free ids.

**Acceptance Criteria:**

**Given** BMad-native planning artifacts freshly written by stock skills (epics, story files, sprint status)
**When** the `tk-studio-plan-sync` normalize pass runs
**Then** canonical frontmatter is stamped/repaired on those artifacts in place (artifacts edited, BMad code untouched — AD-4), preserving all upstream content

**Given** entities without ids
**When** normalization mints them
**Then** ids come only from the committed per-project counter (`EP-/ST-/TA-NNN`), and the counter advances atomically

**Given** a merge that lands a duplicate id
**When** sync next runs
**Then** it blocks with both file paths named until renumbered — never auto-picks a survivor

### Story 3.3: bmad-files Fallback Backend

As a developer on a project with no extra tooling,
I want the canonical files alone to be a fully working backend,
So that planning works offline in any repo with zero additional installs.

**Acceptance Criteria:**

**Given** a project bound to `bmad-files`
**When** planning flows and `tk-studio-plan-sync` run
**Then** normalize + validate + index generation happen with no projection, and the sync verb reports cleanly (no-op projection is first-class, not an error)

**Given** the same planning skill flow
**When** run against `bmad-files` and later against another binding
**Then** skill behavior is unchanged (binding decides projection only) — the brief's adapter success criterion

### Story 3.4: Backlog.md Projection

As an operator,
I want canonical entities projected into a Backlog.md kanban,
So that I get a board and CLI over planning data without those files becoming a second source of truth.

**Acceptance Criteria:**

**Given** a project bound to `backlog-md`
**When** promote runs
**Then** canonical entities project into a Backlog.md-compatible `backlog/` folder (epic → milestone + label; story/task → tasks), recording per-entity `external.backlog-md` state (key, synced_at, content_hash)
**And** the build first verifies Backlog.md's handling of unknown frontmatter keys, falling back to native-keys+id-label projection if unsupported (spine Deferred item)

**Given** a human edit on the kanban (status drag, assignee)
**When** pull-back runs
**Then** only status-class fields update canonical files, with echo suppression (unchanged-vs-snapshot ignored) and both-changed conflicts surfaced for a human

**Given** a canonical status Backlog.md cannot represent (e.g. `review`)
**When** a promote+pull-back round trip occurs with no external change
**Then** the canonical status is unchanged (round-trip stability, AD-5)

## Epic 4: The Studio Knows Your Project

The studio inventories what exists, detects what a project is with evidence, and proposes a role × project working set the operator explicitly confirms. (AD-17, AD-8.)

### Story 4.1: Resource Inventory

As an operator,
I want an inventory of everything installable and everything I've authored,
So that recommendations draw from the full resource universe, not just what's installed.

**Acceptance Criteria:**

**Given** a machine + project
**When** `tk-studio-detect` inventories
**Then** it enumerates installed BMad modules/skills (from `_bmad/_config` manifests), known-but-uninstalled official modules (from the installer registry), and user-authored resources (project `.claude/skills`, `_bmad/custom/`, project agents)
**And** the output is a structured, data-only artifact (JSON) with provenance per resource

### Story 4.2: Read-Only Project Detection

As an operator onboarding a brownfield repo,
I want the studio to detect what the project is with evidence and a confidence floor,
So that recommendations are grounded and never silently guessed.

**Acceptance Criteria:**

**Given** a project root
**When** detection runs
**Then** weighted markers (files, manifests, VCS type) score candidate project types; below the confidence floor the result is "unknown — ask", never a guess (legacy-council detector discipline)
**And** detection performs zero writes and lists the evidence behind every scored marker

### Story 4.3: Recommend, Confirm, Record

As an operator with a role,
I want a role × project working set proposed with evidence and recorded only on my confirmation,
So that activation is deterministic afterward and an engineer and an artist get different sets on the same repo.

**Acceptance Criteria:**

**Given** inventory + detection results and the operator's role (per-user store)
**When** `tk-studio-onboard` proposes a working set
**Then** every proposed resource carries its evidence, and dry-run mode shows the full plan without writing

**Given** explicit confirmation
**When** the set is recorded
**Then** it lands in tracked project config under `working_set.<role>` (role-keyed map — AD-17), and re-running onboarding is idempotent

**Given** a second role confirming later on the same project
**When** their set is recorded
**Then** the first role's entry is untouched

### Story 4.4: Evolve — Observe and Log

As an operator,
I want repeated manual toil and retrospective signals logged as observations,
So that the future evolve loop has real data without v1 building proposal automation.

**Acceptance Criteria:**

**Given** an observation source (retrospective output, repeated-manual-work note, research-job finding)
**When** an observation is recorded
**Then** an `observation` event lands in the measurement ledger with source, project, and a structured description
**And** no automated proposal or skill drafting is triggered (v1 boundary, AD-8)

## Epic 5: One Front Door, Any Mode

The operator enters through a role-aware orchestrator (council shell attended), and every studio surface proves identical attended/headless behavior via the shipped conformance suite and published driver contract. (AD-2, AD-9, AD-11, AD-17, AD-19.)

### Story 5.1: Role-Aware Orchestrator Core

As an operator,
I want one entry point that resolves who I am, what this project needs, and routes,
So that a direction-giver and a developer each get the right workflows from the same door.

**Acceptance Criteria:**

**Given** a per-user store with a role and a project with a confirmed working set
**When** `tk-studio-orchestrator` activates
**Then** it resolves role → `working_set.<role>` → routes to resources by name-based handoff (stock BMad skills included), statelessly
**And** with role `direction-giver` it offers delegation/synthesis framing; with `developer` it offers execution workflows

**Given** a missing role or unconfirmed working set
**When** activation occurs
**Then** the orchestrator routes into onboarding (attended) or halts `blocked` naming the gap (headless) — it never invents a working set

### Story 5.2: The Council Shell

As an operator in an attended session,
I want a distinctive persona shell with "convene the council" as its signature interaction,
So that attended sessions feel like a studio while the core stays stateless.

**Acceptance Criteria:**

**Given** an attended orchestrator session
**When** the shell loads
**Then** persona voice and the convene interaction (multi-perspective deliberation over installed agents) come from data assets — no identity state, no sanctum/rebirth machinery (AD-9)

**Given** the same request attended and headless
**When** both run
**Then** routing decisions and produced artifacts are identical; only presentation differs, proven by a comparison test

### Story 5.3: Publish the Driver Contract

As a harness author (ClaudeOS connector, future),
I want a versioned contract covering everything needed to drive the studio,
So that connector work can start cold without reading studio internals.

**Acceptance Criteria:**

**Given** `contracts/` in the plugin
**When** the driver contract v1 is published
**Then** it contains: per-skill headless invocation surface (payload in, artifacts out), the JSON status schema, job/scheduler verbs (submit, status, cancel, wake), the model/effort override API, and drift-check invocation — each with schema + example
**And** the contract carries its own semver and a change policy (breaking change ⇒ major bump)

**Given** the A7 integration dossier requirements
**When** the contract is reviewed against them
**Then** every dossier item the connector must consume is covered or explicitly deferred with a named seam

### Story 5.4: Conformance Suite

As an operator,
I want every studio surface proven headless-clean by a shipped suite,
So that dual-mode parity is a tested guarantee, not a habit.

**Acceptance Criteria:**

**Given** `contracts/conformance/` in the plugin
**When** the suite runs against every shipped studio skill
**Then** each is driven headless (direct invocation), asserting: valid JSON status block, no interactive prompt, auth preflight before any external call, and `blocked` (not a hang) on ambiguity
**And** failures emit `headless-failure` events naming the surface and assertion

**Given** a new studio skill added later
**When** it registers in the plugin
**Then** the suite discovers it automatically (manifest-driven) — unregistered surfaces fail the suite

## Epic 6: Work Runs While Nobody Watches

Jobs are data, executed on harness-native substrates with guards, including the first research and maintenance job types, with model/effort routing and session discipline. (AD-10, AD-14; AD-11 conformance applies.)

### Story 6.1: Job Model as Data

As an operator,
I want jobs declared as data with guards and stop conditions,
So that unattended work is portable across substrates and never runs away.

**Acceptance Criteria:**

**Given** the job-definition schema in `contracts/` (id, target skill + payload, trigger one-shot|cron|loop, cadence fixed|self-paced, budget guards, stop conditions, model/effort)
**When** a job is defined
**Then** generic job types load from the plugin, per-project instances from project config `jobs[]`, and validation rejects a job missing guards or stop conditions

**Given** a job run
**When** it starts
**Then** run state persists in `~/.tk-studio/projects/<key>/runs/<run-id>/`, resumable after interruption

### Story 6.2: Harness-Native Execution

As an operator,
I want `tk-studio-job` to run any declared job on the harness's own primitives,
So that scheduling rides the ecosystem instead of a bespoke runner.

**Acceptance Criteria:**

**Given** a declared job and the harness-native binding
**When** the job verbs run (submit / status / cancel)
**Then** one-shot jobs execute immediately or at their time; recurring jobs bind to harness scheduling (cron/loop/self-paced wakeup) with declared cadence
**And** budget guards and stop conditions terminate the run with a `partial` status and reason when hit

**Given** the session-scoped nature of local harness schedules
**When** a job is declared durable-recurring
**Then** the definition records the durability requirement and the binding surfaces the constraint (cloud routine or external harness needed) instead of silently losing the schedule

### Story 6.3: First Maintenance Job — Scheduled Conformance

As an operator,
I want the conformance suite runnable as a recurring maintenance job,
So that dual-mode parity is re-proven continuously without me remembering to run it.

**Acceptance Criteria:**

**Given** the conformance suite (5.4) and the job model (6.1)
**When** the shipped `maintenance-conformance` job type is instantiated on a project
**Then** it runs the suite on its declared cadence within budget, emits results as measurement events, and produces a run summary in the run workspace

### Story 6.4: First Research Job — Ecosystem Watch

As an operator,
I want a recurring research job that surveys agentic-dev practice and tool discovery for my project's domain,
So that the studio keeps itself current and feeds the evolve loop real findings.

**Acceptance Criteria:**

**Given** the shipped `research-ecosystem` job type with a scoped charter (topics, sources, budget)
**When** it runs unattended
**Then** it produces an evidence-graded findings artifact in the run workspace and emits `observation` events for recommendation-worthy findings
**And** a full unsupervised run completing end to end with at least one actionable observation satisfies success criterion 7's pathway

### Story 6.5: Model and Effort Routing

As an operator,
I want conservative model/effort defaults with clean override precedence,
So that escalation is deliberate and unattended work stays cheap.

**Acceptance Criteria:**

**Given** every shipped studio resource declaring defaults in its `customize.toml`
**When** the orchestrator or job runner invokes a resource
**Then** effective model/effort resolves runtime override > project config > resource default, and the chosen values are visible in run output

**Given** a job or convene spanning multiple resources
**When** routing occurs
**Then** each resource keeps its own resolved values (no silent inheritance of a more expensive setting)

### Story 6.6: Session Discipline

As an operator,
I want long work to split at boundaries with compact handoffs and resumable workspaces,
So that a fresh session continues without replaying history or blowing budgets.

**Acceptance Criteria:**

**Given** a multi-session workflow reaching a declared boundary (epic/story/phase) or its token budget
**When** the boundary triggers
**Then** a compact handoff artifact is written to the run workspace and the session is directed to end and resume fresh

**Given** a fresh session pointed at a run workspace
**When** it resumes
**Then** work continues from the handoff + workspace state alone (success criterion 8), verified by an integration test on a seeded workspace

## Epic 7: The Studio Measures and Fixes Itself

Accumulated telemetry and human reports flow through the PR membrane into consolidated issues that lead to specific fixes. (AD-12.)

### Story 7.1: Measurement Push

As a teammate,
I want my local ledger pushed as a PR into the shared repo,
So that individual installs report through plain git governance with review as the membrane.

**Acceptance Criteria:**

**Given** a local ledger with unpushed events
**When** `tk-studio-measure-push` runs
**Then** it creates a feature branch, commits the ledger to `measurements/<user>-<machine>.jsonl`, and opens a PR — never pushing to main, never merging itself
**And** a sanitization re-check runs pre-commit; a credential-shaped finding blocks the push

**Given** repeated pushes from the same machine
**When** the skill runs again
**Then** it appends/updates that machine's file only (per-user-per-machine, never a shared file) and handles an open prior PR gracefully

### Story 7.2: Consolidation into Issues

As an operator,
I want accumulated measurement PRs consolidated into ledger issues that lead to fixes,
So that the measurement loop actually corrects the system (the O1 revision channel).

**Acceptance Criteria:**

**Given** merged measurement data in `measurements/`
**When** `tk-studio-consolidate` runs
**Then** it clusters events into candidate defects and appends `issues/ledger.md` entries (stable `ISS-NNN`, severity, status, expected-vs-actual, legacy-council row discipline — update in place, never delete)
**And** each new issue names the evidence events and, where clear, a specific fix candidate (including "revise the distribution mechanism" when evidence points there)

## Epic 8: Plan Where the Team Plans

A project rebinds from local planning to Jira through the designed migration with verification. (AD-5, AD-6, AD-7, AD-16.)

### Story 8.1: Jira Backend Adapter

As a teammate on Atlassian Cloud,
I want promote and status pull-back against Jira through the official MCP,
So that the same planning flows work when the team's tracker is the backend.

**Acceptance Criteria:**

**Given** a project bound to `jira` (site, project key in binding config)
**When** promote runs
**Then** canonical entities create/update Jira issues per the default mapping (epic→Epic, story→Story, task→Sub-task — confirmed against the org's issue-type scheme at setup), recording `external.jira` state
**And** pull-back updates status-class fields only, with echo suppression and conflict surfacing identical to the local projection (AD-5)

**Given** a headless run
**When** the adapter authenticates
**Then** it uses API-token auth with a preflight that verifies the token works and the org toggle is enabled — an auth failure is a named `blocked` status, never a silent 401

### Story 8.2: Designed Migration Local → Jira

As an operator,
I want rebinding a project to Jira to be a verified migration, not a copy,
So that nothing is lost and the local backend remains until I clear it.

**Acceptance Criteria:**

**Given** a project bound locally with canonical planning data
**When** `tk-studio-migrate` runs toward Jira
**Then** it executes export (canonical shape) → transform → import → verification (entity counts, id map, content hashes, spot round-trip) with a closed inventory taken first

**Given** verification passes
**When** cutover happens
**Then** the binding flips copy-then-verify-then-flag (flag last); the local backend stays read-only until the operator explicitly clears it (no-delete-before-clearance)

**Given** any verification mismatch
**When** detected
**Then** migration halts `blocked` with the discrepancy listed; no partial state reads as migrated (AD-16)

## Epic 9: Research Becomes Knowledge

The Research→Knowledge Lifecycle port per the ruled planning pass (2026-08-06): anchored provisional knowledge in the per-user store, delta capture through handoffs into a per-project reconciliation queue, and human-gated promotion into `kb/` via the PR membrane. (AD-2, AD-3, AD-8, AD-11, AD-12; rulings: D1 A/B/C/D grades + mapping, D2 per-project spine, D3 PR membrane, D4 `knowledge-promotion` event, D5 declared 2026-08-06.) The back half is design-verified but execution-unproven in the source — its definition of done includes the e2e run the source never had. Aid-not-gate: a red or absent spine/seed never blocks a run. Contract pin stays 1.6.0 until story 9.6.

### Story 9.1: Knowledge Core and Schemas

As a developer,
I want a pure knowledge validator and published schemas for spines, seeds, deltas, and the queue,
So that every later story builds on one authoritative shape with the source's proven rejection rules.

**Acceptance Criteria:**

**Given** `lib/knowledge.py` (stdlib-only, pure — no fs, no I/O, no globals) and `knowledge.schema.json` in `contracts/`
**When** a spine or seed artifact is validated
**Then** the supersede header is enforced verbatim (`status: provisional` + `authority: mission-scoped-supersedes-canonical`), anchor ids match the grammar `SPINE-A<n>` / `SEED-<run-id>-A<n>` (append-only), and tier rules hold
**And** the A/B/C/D grade vocabulary applies, with the source-vocabulary mapping (Confirmed→A, independent-agreement→B, Deduced→C, Hypothesized→D) documented in the schema doc (D1)

**Given** a delta citing an anchor
**When** it is parsed
**Then** the closed shape `{anchor, verdict: WRONG|STALE|CONFIRMED, reality, evidence, tier: run-local|spine}` is enforced, and unanchored or dangling deltas are named rejections — never silently dropped

**Given** the source validator's unit cases (ported from the first driver's `knowledge-schema.ts`)
**When** the test suite runs
**Then** every ported case passes against `lib/knowledge.py`

### Story 9.2: Session Surface — Handoffs Carry Deltas

As a driver author,
I want the session/handoff surface contract-visible with structured deltas,
So that any harness can invoke handoff/resume and corrections survive session boundaries.

**Acceptance Criteria:**

**Given** the `tk-studio-session` skill (new §2 row at 9.6; surface built here)
**When** a handoff is written
**Then** `handoff.json` accepts an optional `deltas[]` (story 9.1 shape), stays within the 16 KB budget (deltas are pointers; list length capped), and one handoff per run overwrites per boundary

**Given** a headless invocation of the session surface
**When** it runs
**Then** it completes with the JSON status block and a conformance manifest row drives it (including a refusal drive: dangling-delta rejection)

### Story 9.3: Research Anchors and Seeds

As an operator running chartered research,
I want findings to cite anchors and runs to carry seeds inheriting the project spine,
So that research output joins the knowledge lifecycle instead of stranding in the run workspace.

**Acceptance Criteria:**

**Given** `lib/research.py` findings
**When** a finding is recorded
**Then** the finding shape gains an optional `anchor` citation, and run workspaces gain `seed.md` (with `inherits:` spine anchors) — blocked conditions unchanged

**Given** a project without a spine
**When** a research run executes
**Then** the run proceeds (aid, not gate) and the missing spine is reported, with the spine authored as a chartered research-run flavor at project scope (`knowledge/spine.md` in the per-user store — D2)

### Story 9.4: Capture, Queue, and Routing

As an operator,
I want run-finish delta capture into a per-project queue with a rendered routing doc,
So that corrections accumulate durably off-VCS and a human can see what wants promotion.

**Acceptance Criteria:**

**Given** a run finishing with deltas in its handoff
**When** the capture hook runs (riding the executing wrapper's finish)
**Then** deltas append to `~/.tk-studio/projects/<key>/knowledge/reconciliation-queue.jsonl`, deduped on `(run_id, anchor, verdict, reality, tier)` — per-user store only, never project VCS (AD-3; the planning brief's `note` field was renamed `reality` when ST-9.1 closed the delta shape, and `tier` joined the key at the ST-9.4 review — a spine-tier escalation is a distinct routing event; `knowledge.schema.json` is authoritative)

**Given** a populated queue
**When** the routing renderer runs
**Then** a routing doc renders beside the queue — pure renderer, applies nothing

**Given** a sandbox project
**When** the e2e drive runs (the run the source never had)
**Then** a run emits deltas → the queue materializes → the routing doc renders, asserted end to end

### Story 9.5: Promotion Gate — PR Membrane

As an operator,
I want promotions drafted from the routing doc into `kb/` on a branch with PR review as the gate,
So that only a human writes canonical knowledge (D3), through the studio's proven membrane (AD-12).

**Acceptance Criteria:**

**Given** the `tk-studio-knowledge` skill's promote-draft verb and a rendered routing doc
**When** promotion drafting runs
**Then** drafted `kb/` changes land on a feature branch as ordinary kb files (no new frontmatter keys; `scope:` stays reserved — AD-8) and a PR opens; nothing auto-applies

**Given** a promotion attempt without a routing doc
**When** the verb runs
**Then** it refuses as a named rejection (conformance refusal drive)

**Given** a merged promotion PR
**When** the event is emitted
**Then** exactly one `knowledge-promotion` taxonomy event lands in the ledger, sole emitter the promotion skill (D4), taxonomy extended in the same 1.7.0 bump

### Story 9.6: Contract 1.7.0 and the Driver Wiring

As a harness author,
I want the port's surfaces published in a deliberate MINOR contract bump with the connector driving them,
So that drivers consume the lifecycle through the contract alone (AD-2) and standing deferrals close.

**Acceptance Criteria:**

**Given** driver-contract.md at 1.6.0
**When** the bump lands
**Then** 1.7.0 adds §2 rows for `tk-studio-session` and `tk-studio-knowledge`, the changed `tk-studio-research` row (anchor, seed.md), the §4 run-finish capture note, the KB-injection directive (spine/seed paths named so any driver can inject them — the act stays driver-side), and folds in DW-1 (§4 submit wording) and DW-3 (§6/§8 wording)
**And** `test_driver_contract.py` pins 1.7.0 and new conformance manifest rows cover both new surfaces plus the session-discipline row

**Given** the ClaudeOS connector
**When** its pin bumps to 1.7.0
**Then** `studio-jobs-tick`/`tk_invoke` honor the injection directive, connector tests stay green, and the through-connector conformance suite passes at the new check count (connector milestone)

## Epic 10: Observation Becomes Proposal

Evolve-loop automation per the ruled planning pass (2026-08-07): `lib/evolve.py` reads merged observation events and maintains `proposals/ledger.md` (stable `PROP-NNN` rows, consolidate-twin discipline), the `tk-studio-evolve` surface drafts on demand, and a shipped-but-undeclared recurring job type arrives with the additive contract 0.1.9 bump. (AD-3, AD-8, AD-11, AD-12; rulings: D1 proposal docs only, D2 in-repo ledger derive-only with no new taxonomy event, D3 on-demand verb + undeclared job type, D4 folded into D2, D5 declared 2026-08-07.) Drafting triggers nothing: proposals move to Adopted/Declined by human hand alone. At epic close the spine's Deferred entry *and* AD-8's "in v1" rule sentence gain the landed annotation. Contract pin stays 0.1.8 until story 10.3.

### Story 10.1: Proposal Model and Ledger

As a developer,
I want a proposal core that clusters observation events into stable-id rows with the issues-ledger discipline,
So that observed toil accumulates into an evidenced, updatable record instead of stranding unconsumed in the measurement ledger.

**Acceptance Criteria:**

**Given** `lib/evolve.py` (stdlib-only) and merged `measurements/*.jsonl` containing observation events
**When** a draft run executes
**Then** observation-shaped events cluster into candidate proposals and `proposals/ledger.md` gains or updates stable `PROP-NNN` rows (ids assigned in order, never reused; rows update in place, never deleted; Impact, Status `Draft|Under-review|Adopted|Declined`, Evidence naming events, Candidate change, Affected surfaces, Key, Opened/Updated columns per the ledger header) while defect-shaped events stay consolidate's
**And** reruns are idempotent — stamps derive from evidence-event dates, never the wall clock — and a hand-edited Candidate-change cell is never overwritten (per-column ownership, consolidate-twin)

**Given** an unparseable proposals ledger
**When** a draft run executes
**Then** it refuses to rewrite what it cannot update in place (named block)

### Story 10.2: The Evolve Surface and the First Real Draft

As an operator,
I want a `tk-studio-evolve` skill drafting proposals on demand with per-outcome headless postures,
So that the ledger's real accumulated observations become triageable proposals through one contract-shaped surface.

**Acceptance Criteria:**

**Given** the `tk-studio-evolve` skill (`draft` verb; payload `directory`, `dry_run?`)
**When** invoked attended or headless
**Then** behavior is identical (AD-11), the headless posture states its refusal behavior per-outcome — never a blanket exit-code rule (team agreement 5) — and every headless run ends with the JSON status block

**Given** the real merged measurement data
**When** the first draft runs
**Then** genuine PROP rows derive from the accumulated events (the planning pass §5 grounding classes expected) and the drafting run triggers nothing beyond the ledger sync — no auto-apply, no scaffolding, no follow-on writes (D1)

### Story 10.3: Contract 0.1.9, Conformance, and the Job Type

As a harness author,
I want the evolve surface published as an additive bump with conformance coverage and a shipped recurring job type,
So that drivers reach the whole loop through the contract and recurring drafting stays one operator declaration away.

**Acceptance Criteria:**

**Given** driver-contract.md at 0.1.8
**When** the bump lands
**Then** 0.1.9 adds the `tk-studio-evolve` §2 row (blocked: directory missing; measurements outside the studio repo (AD-3); unparseable proposals ledger), `test_driver_contract.py` pins 0.1.9, a conformance manifest row drives the surface including the unparseable-ledger refusal drive, and the taxonomy is untouched (D2)
**And** the shipped `evolve-proposals` job type lands in `jobs/` undeclared — instance declaration stays an operator call (D3) — carrying explicit `trigger` + `cadence` (the 2026-08-07 type-resolution observation)

**Given** the ClaudeOS connector pinned to the 0.1 line
**When** the through-connector suite spot-checks the new surface
**Then** the check passes with no connector change (additive patch, same line)

## Epic 11: Proposal Becomes Change

The adopted-proposals epic per the ruled planning pass (2026-08-08): PROP-001's churn-normalized base-update verify step plus the operator-gated upstream defect filing, and PROP-003 closing with evidence — the evolve loop's first full observe→draft→adopt→implement cycle. (AD-1, AD-11, AD-12; rulings: D1 PROP-003 closes with evidence — the sweep landed at `3ee9117` mid-Epic-9, two-layer enforced by `test_utf8_guard.py`; D2 revert churn-only files, real changes untouched; D3 empty diff ends complete with no PR at a 0.1.10 clarification; D4 draft + gated upstream filing; D5 declared 2026-08-08.) Ledger closing motions are operator hand-edits — the machine never touches Impact/Status. Contract pin stays 0.1.9 until story 11.1 rings the clarification.

### Story 11.1: Churn-Normalized Verify Step

As an operator adopting upstream releases,
I want base-update's verify step to revert the known no-op churn classes before committing the install diff,
So that the integration PR shows only the genuine upstream diff (AD-1's reviewable motion) and a reinstall at pin proves itself a no-op.

**Acceptance Criteria:**

**Given** `base_update.py`'s install step completing over an existing install
**When** the verify step examines the working tree before the install-diff commit
**Then** files whose old and new content are equal after normalizing the named churn classes — line-endings-only rewrites, and list-valued config options re-serialized as JSON strings that parse back to the old list (`_bmad/**` config yaml only) — are reverted, per-class revert counts land in the result JSON, and any file carrying a real change stays fully untouched; unknown churn is never guessed at — it shows in the diff (D2)

**Given** a same-version re-affirmation run whose install diff is empty after normalization
**When** the motion completes
**Then** it ends complete reporting the verified no-op — no branch pushed, no PR opened (D3) — and driver-contract 0.1.10 lands the clarification sentence on the §2 base-update row (doc + README + `test_driver_contract.py` pin move together, the 0.1.8 precedent)

**Given** the normalizer's equivalence function
**When** the unit suite runs
**Then** `base_update.py`'s first unit tests cover endings-only reverted, re-serialization reverted, mixed real-change untouched, and unknown-churn untouched
**And** a live same-version re-affirmation run over this repo showing a churn-free outcome is the acceptance evidence

### Story 11.2: Upstream Filing and Cycle Closure

As an operator,
I want the re-serialization defect drafted for bmad-method and the ledger rows closed with evidence in hand,
So that the root cause travels upstream and the loop's first full cycle is recorded honestly.

**Acceptance Criteria:**

**Given** ISS-001's evidence and the landed normalizer
**When** the upstream artifact is drafted
**Then** a bmad-method issue draft lands as an epic artifact — list re-serialization as the defect with a 6.10.0 `--yes`-reinstall reproduction, the LF rewrite posed as a question — and filing on the upstream tracker happens only on explicit in-session operator go-ahead (D4), never unilaterally

**Given** the implementation evidence (the normalizer, and PROP-003's `3ee9117` + `test_utf8_guard.py`)
**When** the operator closes the cycle
**Then** ISS-001 moves Open→Resolved and PROP-001/PROP-003 gain prose annotations naming the landed evidence — all by operator hand, statuses staying Adopted (the proposals ledger has no implemented state by design; implementation lives in planning records), the machine never editing Impact/Status (AD-12 ownership)

## Epic 12: Release What Shipped

The plugin delivery gap closed as a release motion (operator pick, 2026-08-08): the repo's plugin roster carries 17 skills — `tk-studio-evolve`, `tk-studio-knowledge`, `tk-studio-session` shipped in Epics 9–10 — but the delivered plugin is still v0.1.0 with 14, because the version gate (`marketplace.json` `plugins[].version`, lockstep with `plugin.json`) was never pulled after Epics 9–11. AD-13's plugin-plane check passes trivially while the installed plugin silently lacks three shipped surfaces (observation logged 2026-08-09, local ledger). One story: bump 0.1.0 → 0.2.0 in lockstep, update the installed plugin, prove the gap closed with the drift check. (AD-1 composite distribution, AD-13 drift check; FR1/FR4.) A release-discipline guard — shipped surfaces must not outrun the version gate again — stays a candidate for the evolve loop, not a story here.

### Story 12.1: Plugin Release Motion 0.1.0 → 0.2.0

As a teammate installing the studio plugin,
I want the marketplace catalog and plugin version bumped in lockstep so the delivered plugin carries every shipped surface,
So that a fresh or updated install actually has the evolve, knowledge, and session skills the repo says it ships.

**Acceptance Criteria:**

**Given** `plugins/tk-studio/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` both at 0.1.0
**When** the release lands
**Then** both move to 0.2.0 in the same commit (lockstep — AD-13's plugin plane compares exactly these two) and the released roster includes `tk-studio-evolve`, `tk-studio-knowledge`, and `tk-studio-session`

**Given** the bumped catalog on main
**When** the installed plugin updates (`/plugin marketplace update` — the AD-13 guided fix, operator-side)
**Then** the installed cache is 0.2.0 with the full 17-skill roster and a fresh activation drift check reports the plugin plane clean at 0.2.0, harness-loadable

**Given** the release commit
**When** the suites run
**Then** the lib unit suite and the conformance suite stay green — no contract change rides the release (the version gate is delivery metadata, not a surface change)

## Epic 13: The Drift Check Tells the Truth

Three adopted proposals from the EP-012 closure corpus (operator triage 2026-08-09: PROP-015/016/017 Adopted, ISS-004 Resolved) converge on one surface: the AD-13 drift check must diagnose the plugin plane truthfully and name the right fix. Two defects surfaced live during the ST-045 release motion — the installed-but-stale case returns the fresh-install guidance (`FIX_HARNESS`) while the existing `FIX_PLUGIN` constant sits unreferenced (`drift_check.py` ~138-145, PROP-016), and the loadability probe false-drifts on a dangling `installPath` after every version bump because the 2.1.201 marketplace-update path records a cache directory it never materializes while the harness happily serves all 17 skills from the directory-source marketplace (lines 146-151, PROP-017 studio-side; the possible upstream defect stays held for filing until reproduced past CLI 2.1.201 — D4 posture). The third story lands the guard EP-012 deferred to the evolve loop: shipped surfaces must not outrun the version gate again (PROP-015). Fix strings and new drift cases ride the existing `{ok, result, planes[], fixes[]}` shape — no contract shape change expected; if §6 wording is touched, contract version + pin test + README move together (the 0.1.8 precedent). (AD-13 drift check; AD-1 composite distribution; AD-12 evidence discipline.)

### Story 13.1: Stale-Case Guidance Wires FIX_PLUGIN

As an operator running the activation drift check,
I want the installed-but-stale case to name the update flow, not the fresh-install flow,
So that the guided fix I follow is the one SKILL.md's fix table already promises for exactly this case.

**Acceptance Criteria:**

**Given** a harness install record holding the plugin at vX while the repo plugin is vY (X ≠ Y)
**When** the drift check's loadability probe runs
**Then** the plugin plane reports drift with `fix: FIX_PLUGIN` (`/plugin marketplace update tk-studio` + reinstall/update guidance), matching SKILL.md's guided-fix table — `FIX_HARNESS` remains the fix for the not-installed and no-loadable-entry cases only

**Given** the activate script's unit suite
**When** it runs
**Then** the stale case (version-mismatch → FIX_PLUGIN) and the not-installed cases (→ FIX_HARNESS) are each covered, and the suite stays green

### Story 13.2: Directory-Source-Aware Loadability

As an operator whose harness serves the plugin from a directory-source marketplace,
I want a dangling `installPath` to stop reporting as drift while every skill demonstrably loads,
So that the drift check does not cry wolf after each version bump until an install-flow run happens to repopulate the cache.

**Acceptance Criteria:**

**Given** a version-matched harness entry whose `installPath` does not exist on disk
**When** the marketplace source for the plugin is a local directory that carries the plugin at that same version
**Then** the plugin plane reports ok, its detail naming directory-source serving — and a genuinely evicted cache with no such source directory still reports drift (the probe's regression test reproduces the ST-045 record shape: v0.2.0 entry, unmaterialized cache path, source dir present)

**Given** the upstream half of PROP-017 (the v2 install record updated to a path never materialized)
**When** this story lands
**Then** no upstream filing occurs — reproduction past CLI 2.1.201 and the filing itself stay operator-gated (D4 posture), the studio-side fallback standing on its own

### Story 13.3: Release-Discipline Guard

As a maintainer shipping studio surfaces,
I want the repo to go loud the moment the skill roster outruns the version gate,
So that a shipped-but-undelivered surface like the EP-012 three-skill gap cannot recur silently.

**Acceptance Criteria:**

**Given** a committed released-roster record riding the lockstep release motion (version + skill list, third file of the gate)
**When** the lib unit suite runs after `skills/` changes without a version-gate pull
**Then** the suite goes red naming the roster delta — red exactly in the EP-012 gap shape (roster grew, version unchanged), green again when the release motion bumps the gate and roster together

**Given** the drift check's plugin plane
**When** the repo roster disagrees with the released roster at an unchanged version gate
**Then** the plane reports drift with guidance naming the release motion (the lockstep bump), riding the existing planes/fixes shape

**Given** the release commit for this epic
**When** the suites run
**Then** lib unit and conformance suites stay green, and the drift check on a healthy machine still reports all four planes clean

## Epic 14: Denied Permissions Refuse Loudly

PROP-005 (Adopted 2026-08-09, operator boundary triage) names the AD-11 gap observed live 2026-08-06: driving `tk-studio-detect` headless via `claude -p` with default permissions, the core's uv/python tool calls were denied and the run ended as a question with no terminal status block. The instruction-layer half is already landed — every SKILL.md carries the canonical unrunnable-core paragraph and the suite's doc-level `unrunnable-core` assertion pins it (DW-3 fold-in, 0.1.7) — but nothing today drives a surface through the real harness under denial and proves the refusal: the shipped drives invoke the deterministic cores directly, below the layer that failed. This epic lands the enforcement half: a harness-drive check class whose assertion logic is unit-pinned against fake transcripts (14.1), the live denied-permissions case for detect — opt-in, spend-bearing, degrading loudly (14.2), and the §8 contract publication as an additive 0.1.11 bump, version + pin test + README in lockstep (14.3). Declined PROP-006 and PROP-007 both routed their surviving enforcement concern to exactly this work. (AD-11 dual-mode invariant; AD-19 conformance as a shipped artifact; AD-12 evidence discipline.)

### Story 14.1: Harness-Drive Check Class

As a maintainer of the conformance suite,
I want a check class that drives a surface through the real harness under a permission profile denying its deterministic core,
So that the layer where PROP-005's failure actually happened — the skill instruction layer above the core — is the layer the suite proves.

**Acceptance Criteria:**

**Given** a harness run transcript ending in a valid terminal status block with `status: blocked` whose reason names the unrunnable core
**When** the harness-drive assertion evaluates it
**Then** the check passes — and a transcript that asks a question, ends without the block, or exceeds the wall-clock bound fails with the gap named in the check detail

**Given** the lib unit suite
**When** it runs
**Then** the assertion logic is pinned against fake transcripts for each outcome class (blocked-with-block passes; question-without-block, missing block, and timeout each fail) with no live harness invocation and no spend, and the suite stays green

### Story 14.2: The Denied-Permissions Case, Live

As an operator running the conformance suite,
I want the detect surface — the PROP-005 observation's subject — driven live under a denying permission profile when I opt in,
So that the refusal discipline is proven against the real harness, not only documented.

**Acceptance Criteria:**

**Given** the harness pass invoked opted-in on a machine with the claude CLI available
**When** detect is driven through the harness under the denying profile
**Then** the run ends within the bound with a `blocked` status block naming the denied core, the check result rides the existing surfaces/failures report shape, and a failure emits a `headless-failure` event naming surface and assertion

**Given** the default suite invocation with no opt-in
**When** it runs
**Then** no harness drive executes and the report names the harness pass as skipped by flag — loud, never silent

**Given** a machine without the claude CLI
**When** the harness pass is requested
**Then** it ends blocked naming the missing CLI — never a hang, never a crash

**Given** this story's landing
**When** the opted-in pass runs once for real
**Then** the live run is recorded green as the story's closing evidence

### Story 14.3: Contract §8 Publishes the Harness Pass

As a driver author consuming the contract,
I want §8 to describe the harness-drive check class and its opt-in spend posture,
So that a conforming driver knows the suite can reach through it and what a passing refusal looks like.

**Acceptance Criteria:**

**Given** the contract after 14.1 and 14.2 land
**When** §8 is read
**Then** it describes the harness-drive check class, the opt-in posture, and the denied-permissions case; the version history names 0.1.11 as an additive bump; the §2 surface table is untouched

**Given** the lib suite
**When** it runs
**Then** the contract pin test asserts 0.1.11 and the contracts README row moves in the same commit — version, pin test, and README in lockstep

**Given** the suites at the epic's close
**When** lib unit and conformance run and the drift check runs on a healthy machine
**Then** both suites are green and all four planes report clean

## Epic 15: The Resolved-Definition Read Surface

PROP-008 (Adopted 2026-08-09, operator boundary triage) names the gap observed 2026-08-07: a substrate-side driver reads the raw `.tk-studio/jobs/<id>.json` instance file — per AD-2 it cannot call studio-side `lib/job.py`, the sole owner of type extension — so an instance inheriting trigger/cadence from its shipped type is skipped by recurring classification as trigger-less; the recorded workaround restates trigger/cadence in the instance file. The fork recorded at refinement was ruled at adoption: publish the resolved-definition read surface as a driver-contract verb (additive motion; type extension keeps its zero-duplication value, the raw-file read is replaced by a real contract surface), not the schema tightening. This epic lands it: a read-only `resolve` verb on the §4 job wrapper serving merged definitions from the one resolver (15.1), and the contract publication as an additive 0.1.12 bump, version + pin test + README in lockstep (15.2). (AD-2 the contract is the entire interface; AD-10 jobs are data, one validator; AD-11 dual-mode; AD-19 a surface is not done until conformance proves it.)

### Story 15.1: The Resolve Verb on the Job Wrapper

As a driver classifying recurring work substrate-side,
I want a read-only resolve verb on the job wrapper that serves every declared job's fully resolved definition,
So that recurring classification reads trigger and cadence from the contract surface instead of raw instance files it cannot resolve.

**Acceptance Criteria:**

**Given** a project declaring a type-extending instance that inherits trigger and cadence from its shipped type
**When** resolve is invoked without a job id
**Then** the response lists every declared job in config order with its merged definition — the inherited trigger and cadence present, source and extends named — and an entry with problems carries them named in place, never silently dropped

**Given** a single job id
**When** resolve is invoked with it
**Then** the response carries that job's resolved definition, and an unknown id is a named refusal — an answer, never a hang, never a guess

**Given** the lib unit suite, the conformance manifest, and the tk-studio-job skill
**When** the suites run
**Then** resolve's outcomes are unit-pinned (type-extension merge visible in the output, unknown id refused, an invalid definition's problems named), the manifest drives the verb headless-clean plus refusal-with-marker, the SKILL.md verb block names resolve, and both suites stay green

### Story 15.2: Contract §4 Publishes the Read Surface

As a driver author consuming the contract,
I want §4's verb table to carry resolve with its read-only resolved-definition semantics,
So that a conforming driver classifies recurring work from the contract surface and never re-implements type extension.

**Acceptance Criteria:**

**Given** the contract after 15.1 lands
**When** §4 is read
**Then** the verb table carries resolve — request, response, and read-only semantics naming type extension as studio-side, drivers never merge — the §2 tk-studio-job row names the verb, and the version history names 0.1.12 as an additive bump

**Given** the lib suite
**When** it runs
**Then** the contract pin test asserts 0.1.12 and the contracts README row moves in the same commit — version, pin test, and README in lockstep

**Given** the suites at the epic's close
**When** lib unit and conformance run and the drift check runs on a healthy machine
**Then** both suites are green and all four planes report clean

## Epic 16: The Store-Standup Read Retry

PROP-019 (Adopted 2026-08-09, operator boundary triage) names the flake observed 2026-08-09: under multiprocessing concurrency, `ledger.emit` → `store.ensure_store`'s `config.yaml` read (`miniyaml.load` → `Path.read_text`) hit `PermissionError` (Errno 13, sharing violation) — on Windows a concurrent racer's atomic `os.replace` onto the same path makes the destination transiently unreadable, so first-emit standup races its own siblings; twice in a row on one boundary run, then consecutive green reruns, uncorrelated with any code change. This epic lands the ruled candidate: a bounded retry-on-sharing-violation on `store.py`'s config read path — the reader is the victim, so the reader heals (16.1). `miniyaml` stays a pure parser with no timing policy, and the `test_ledger` concurrency test stays untouched as the live race probe — the fix serializes nothing and masks nothing. No contract change: the store's surface and semantics are unchanged (AD-3 one store authority; AD-11 identical dual-mode behavior; platform envelope Windows-first).

### Story 16.1: The Config Read Outlasts the Concurrent Replace

As a studio surface emitting my first measurement event while sibling processes stand up the same store,
I want the store's config read to outlast a concurrent atomic replace,
So that a transient Windows sharing violation never fails an emit that would have succeeded a moment later.

**Acceptance Criteria:**

**Given** a config.yaml read that hits a transient PermissionError while a concurrent standup replaces the file
**When** read_config or ensure_store reads it
**Then** the read retries with bounded backoff and returns the parsed config once the replace settles — the transient never reaches the caller

**Given** a PermissionError that persists past the retry budget
**When** the read path exhausts its bounded attempts
**Then** the error raises to the caller unchanged — never an infinite wait, never a swallowed real denial

**Given** the lib suite
**When** it runs
**Then** the retry is unit-pinned (transient-then-success returns the parsed config; persistent raises after the bounded attempts), the test_ledger concurrency test stays untouched as the live race probe, miniyaml carries no retry, and the full suite is green

## Epic 17: The Sync Result Names Every Written File

PROP-020 (Adopted 2026-08-10, operator boundary triage) names the staging gap observed 2026-08-09: `plansync sync` moves `.tk-studio/plan-counter.yaml` (the AD-4 committed id counter) on every mint, but the result JSON does not name it — `normalize.files[]` lists only plan entities, so the EP-015 planning commit staged from the response and missed the counter (aeba4e1, follow-up 20555fa). This epic lands the ruled candidate: the sync result names every file the run wrote, counter included, so commit staging derives from the response alone. Normalize gains a `counter` object (the committed counter's path plus whether this run persisted it) and a `written[]` list (counter, created/repaired entity files, stamped story files); sync aggregates a top-level `written[]` over normalize's writes, the projection writes the adapters name (both backends' pull-back entries already carry paths; jira promote entries gain one), and the regenerated index when it changed. An additive result-shape change published at driver-contract 0.1.13 — version, pin test, and contracts README move together. A rerun on unchanged data stays a byte-identical no-op reporting nothing written. Review chips (PR #45 adversarial pass): backlog-md promote names its canonical snapshot rewrites — the half of the sync the first cut missed — and files replaced on a projection rename land in `removed[]`; jira dry-run entries carry `path` for would-write parity; a projection-blocked sync still names normalize's landed writes; the backlog `config.yml` bootstrap is named under dry-run too.

### Story 17.1: Staging Derives from the Response Alone

As an operator staging a planning commit from a sync response,
I want the result JSON to name every file the run wrote — counter included,
So that commit staging derives from the response alone and the hand-staged counter gotcha retires.

**Acceptance Criteria:**

**Given** a sync run that mints ids
**When** the result returns
**Then** normalize carries a `counter` object naming the committed counter's path with `written` true, and a `written[]` list naming the counter, every created or repaired entity file, and every stamped story file — and under `--dry-run` the same lists name what the run would write while nothing lands

**Given** a rerun on unchanged data
**When** normalize runs again
**Then** `counter.written` is false and `written[]` is empty — the no-op stays byte-identical and reports nothing written

**Given** the sync verb under a bound backend
**When** projection and index write files
**Then** the sync-level `written[]` aggregates normalize's writes, every projection write the adapters name — jira promote entries gain a `path` so canonical snapshot rewrites are named too — and the index when it changed, deduplicated in write order

**Given** the lib suite and the contract
**When** they run
**Then** the new fields are unit-pinned, §2's plan-sync row states the result names every written file, the version history names 0.1.13 as an additive bump with the pin test and contracts README moving in the same commit, and the full suite is green

## Epic 18: The Release Ships a Pinned Archive Backstop

PROP-012 (Adopted 2026-08-10, operator boundary triage) graduates the 2026-08-08 research finding: Claude Code v2.1.224 added an archive plugin source — a zip fetched over HTTPS with optional SHA-256 pinning — mirroring at the harness's own plugin layer the pinning discipline AD-1 already trusts for external BMad modules. Forks ruled 2026-08-10: the artifact lives as a GitHub release asset under per-release tags (`claude plugin tag` mints `tk-studio--v<version>` validating gate lockstep), and the backstop is tooled into the release motion with `released-roster.json` — the gate's third file — as the backstop manifest, plus a lib-suite guard. The evaluation already pinned the envelope's shape half live at CLI 2.1.226: the validator accepts only `{"source": "archive", "url": <https>, "sha256"?: <64-hex>}` — local paths, `http://`, `file://`, and malformed or prefixed shas all rejected — while `--plugin-dir` accepts a local zip session-scoped and the seed-dir mechanism is the documented persistent offline path. The honest constraint rides the epic: this repo is private, and the archive source type fetches anonymously, so the marketplace archive entry cannot serve this plugin until public hosting exists — the seam is named, not built. What lands is the discipline that works today: every release ships a deterministic zip of the plugin tree, SHA-256 verified, published as the tag's release asset and recorded in the roster, with the sneakernet runbook (authenticated download, out-of-band verify, seed-dir or `--plugin-dir` consumption) as the offline install path. No driver-contract bump — the motion is operator-facing (EP-013 precedent); the release gate stays three files.

### Story 18.1: The Archive Envelope Is Pinned Live

As an operator deciding install paths for the studio plugin,
I want the current CLI's archive-source and offline-install envelope pinned as recorded facts with live evidence,
So that the backstop is built on what the harness actually supports rather than changelog phrasing.

**Acceptance Criteria:**

**Given** the marketplace-entry validator at the current CLI
**When** the archive-shape probe matrix runs (https+sha, https bare, http, file scheme, relative and absolute paths, short/non-hex/prefixed shas, type-for-source key)
**Then** the accepted envelope is recorded — `{"source": "archive", "url": <https>, "sha256"?: <64-hex>}` only, sha optional, every other shape a named rejection — in a kb evaluation record naming the CLI version probed

**Given** a versioned zip built from the plugin tree
**When** it is loaded via `--plugin-dir <zip>`
**Then** the full released roster is served from the archive session-scoped with no network, proven live and recorded

**Given** the seed-dir mechanism (`CLAUDE_CODE_PLUGIN_CACHE_DIR` pre-populate, `CLAUDE_CODE_PLUGIN_SEED_DIR` runtime)
**When** the flow is driven with the built zip
**Then** the persistent offline path is proven live or its gaps named in the record — never assumed from docs

**Given** the repo's private visibility
**When** the evaluation records the marketplace archive-source constraint
**Then** the record states the source type cannot fetch this repo's assets anonymously at the current CLI, names the public-hosting seam, and names every probe requiring a public HTTPS host (live fetch, checksum-mismatch refusal, version-gate interaction) as operator-gated future work rather than silently skipping it

### Story 18.2: The Release Motion Publishes the Pinned Archive

As an operator running the release motion,
I want the motion to tag, build, verify, publish, and record the archive backstop in one discipline,
So that every release ships a SHA-256-pinned offline artifact that cannot silently rot.

**Acceptance Criteria:**

**Given** a release at version X
**When** the motion runs
**Then** `claude plugin tag` mints `tk-studio--v<X>` validating plugin.json and marketplace lockstep, the release-archive tool (stdlib-only Python, gh for transport) builds the plugin-tree zip deterministically at the release commit via `git archive`, computes its SHA-256, uploads it as the tag's release asset, re-downloads the published asset, and verifies the digest matches before recording — a mismatch fails the motion loud

**Given** `released-roster.json` as the gate's third file
**When** the release records the backstop
**Then** the roster entry carries `archive: {url, sha256}` for the released version — the roster is the backstop manifest and no fourth gate file is minted

**Given** the lib suite
**When** it runs
**Then** the roster guard also pins the archive record — present for every recorded version at or beyond the discipline's 0.2.6 floor, `sha256` a 64-hex string, `url` naming the version's release tag — red on a missing or malformed record, and the full suite is green

**Given** an air-gapped or git-less machine
**When** the kb runbook is followed
**Then** it documents the sneakernet path end to end — authenticated asset download on a connected machine, out-of-band SHA-256 verification, consumption via seed-dir (persistent) or `--plugin-dir <zip>` (session) — with the marketplace archive-source entry named as the seam that activates on public hosting

**Given** the epic's changes land
**When** the release motion runs 0.2.5 → 0.2.6 through the new discipline
**Then** the first tagged release ships — tag, verified asset, roster archive record, gate ×3 in lockstep — the scoped plugin update lands the new version, and the four planes check clean

## Epic 19: Three Small Truths from the Boundary Loop

PROP-021/022/023 (all Adopted 2026-08-10, operator boundary triage) graduate together — three small motions the 2026-08-10 housekeeping loop itself surfaced, the measurement channel working end to end: a carried operator chip whose substance was recovered and verified (PROP-021 — the Epic-9 handoff byte budget measures the compact serialization at `session.py` while `_atomic_write_json` lands `indent=2` plus a newline, so a near-ceiling handoff passes the check yet exceeds 16 KB on disk and the result's `bytes` wears the smaller number), an incidental live find (PROP-022 — miniyaml's `_strip_comment` treats any mid-line quote char as opening a quoted region, so plain prose containing an apostrophe raises `unterminated quote`, and kb.py swallows the error into silent rank-100/body-line defaults — the envelope kb file was mis-indexed from landing until the probe session caught it; `dump()` is already safe, double-quoting unsafe values, so the exposure is human-authored plain values), and a probe result worth its runbook sentence (PROP-023 — a seeded session serves plugins on explicit `/plugin:skill` invocation only, never advertising them). Graduation shape ruled at adoption: one epic, a story per row, single release at the close. No driver-contract bump — the §2 session row's "16 KB budget" names no serialization and the fix makes the enforced meaning exactly the bytes landed (the wording stands), kb.py's `warnings[]` is an additive field on an internal lib result below the contract surface, and the runbook is kb. (AD-11 dual-mode; AD-12 evidence discipline; ST-9.2 no-grow ruling honored; platform envelope stdlib-only.)

### Story 19.1: The Handoff Budget Measures What Lands

As an operator relying on the 16 KB handoff ceiling,
I want the enforced budget to measure the exact bytes the workspace write lands,
So that a handoff that passes the check is the handoff on disk — never a larger artifact wearing a smaller number.

**Acceptance Criteria:**

**Given** a handoff assembled by `write_handoff`
**When** the budget check sizes it
**Then** the measured size is the byte length of the serialization `_atomic_write_json` lands — `indent=2`, `ensure_ascii=False`, trailing newline — and the result's `bytes` equals the written `handoff.json`'s on-disk size exactly, multibyte content included

**Given** the ST-9.2 ruling
**When** the fix lands
**Then** `MAX_HANDOFF_BYTES` stays 16384 and the 16-delta cap is untouched — the budget does not grow, it tells the truth

**Given** the lib suite
**When** it runs
**Then** a case pins measured == on-disk bytes for a landed handoff carrying non-ASCII content, a case pins the refusal of a handoff whose compact form fits the budget but whose written form exceeds it (the skew shape itself), and the full suite is green

### Story 19.2: Frontmatter Prose Survives Apostrophes and Indexing Fails Loud

As a kb author writing plain-prose frontmatter,
I want mid-word quote characters read as literal text and a frontmatter parse failure surfaced in the index result,
So that a description containing an apostrophe neither crashes the parse nor silently mis-indexes the file.

**Acceptance Criteria:**

**Given** an unquoted scalar containing a mid-word quote char (an apostrophe in prose, a quoted aside mid-sentence)
**When** miniyaml loads the line
**Then** the value parses with the quote chars literal — a quote opens a quoted region only where a scalar can begin (start of the value or after whitespace) — and trailing-comment stripping still honors genuinely quoted scalars that contain `#`

**Given** the parser's existing envelope
**When** the suite runs
**Then** every current miniyaml case stays green — leading-quote scalars, escaped quotes, `#` inside quotes, trailing comments — and `dump()`'s quoting of unsafe values is unchanged

**Given** a kb file whose frontmatter fails to parse
**When** `kb.py` builds the index
**Then** the result carries `warnings[]` naming the file and the parse error while the entry still lands on today's fallback — and the envelope-shaped regression is pinned: a file whose description holds an apostrophe indexes at its declared rank with its declared description, warning-free

**Given** the lib suite at the story's close
**When** it runs
**Then** both layers are unit-pinned and the full suite is green

### Story 19.3: The Runbook Names the Seed's Serve Envelope

As an operator provisioning an offline machine,
I want the runbook's persistent path to state the proven serve split,
So that offline installs are planned on what a seeded session actually does, not on hedged pre-probe wording.

**Acceptance Criteria:**

**Given** the 2026-08-10 probe results recorded in the archive-install envelope kb
**When** the runbook's seed-mechanism section is read
**Then** it states the serve split plainly — a seeded session serves plugins on explicit `/plugin:skill` invocation only (zero network), never advertises them to the session, and the management verbs still do not read the seed — sufficient for driver-contract headless drives, insufficient for attended discovery, which needs `--plugin-dir` or a real install — and cross-links the envelope record for the probe evidence

**Given** the story's docs-only scope
**When** it lands
**Then** no code, schema, or contract file changes — the kb index regenerates only if frontmatter moved

## Epic 20: The Contract Names Its Drivers and Carries Cost

Plan Phase 1 scope item 8 (planning pass 2026-09-26 §3; `briefs/brief-studio-supervisor-2026-09-27/brief.md`), reconciled to the box as built. The plan's "0.1.15 → 0.1.16" slot was consumed by the install `no_normalize` change (PR #64), and 0.1.17 went to the studio-managed base patches (BMAD-METHOD#2718, 2026-09-28), so this is the additive **0.1.18** bump. It names the studio supervisor and Hermes as driver-contract consumers in place of ClaudeOS (§7 row 6, the Audience line, and every other row that names ClaudeOS as the driver), adds a driver roster, and states in §2 that the executing wrapper may be any conformant driver. It also gives `finish` and the `job-run` event an optional `total_cost_usd`: acceptance (d) asks for that field, but today the taxonomy payload has none and `jobrun.py` records none. The two stale §1 cross-references are fixed in passing (per-skill CLIs live in §2, the status block in §3). AD-2 holds: nothing in the plugin imports a driver. The epic ships through the release motion so headless runs on the agent PC pick it up. Requirements trace: scope item 8, acceptance (d). Repo: tk-studio.

### Story 20.1: Finish Records What the Run Cost

As an operator measuring unattended runs,
I want `finish` to accept the run's cost and the `job-run` event to carry it,
So that every terminal run lands in the ledger with the dollars it spent.

**Acceptance Criteria:**

**Given** a run finished through `jobrun.py finish` with a cost figure
**When** the terminal transition is recorded
**Then** the `job-run` event payload carries `total_cost_usd` as a non-negative number, the run's `run.json` records the same figure, and there is still exactly one emitter and one event per terminal transition (AD-12)

**Given** a `finish` without a cost figure, as every driver sends today
**When** it runs
**Then** the behavior and the event are identical to 0.1.17: the field is absent, never zero-filled

**Given** a cost argument that is negative, non-numeric, or not finite
**When** `finish` runs
**Then** it refuses with a named error and records and emits nothing — never a guessed value (AD-3)

**Given** `contracts/events/taxonomy.v1.json`
**When** the story lands
**Then** `job-run.payload.total_cost_usd` is declared optional with a note naming its source (the worker's `--output-format json` result), and the lib suite pins the present, absent, and refused cases with the full suite green

### Story 20.2: Contract 0.1.18 Names the Supervisor and Hermes

As a driver author,
I want the contract to name its conformant drivers and say that any of them may execute a run,
So that the studio supervisor is a first-class consumer while the studio itself still grows no UI.

**Acceptance Criteria:**

**Given** `driver-contract.md` at 0.1.17
**When** the patch lands
**Then** the header reads 0.1.18 with a changelog clause marking it additive; §7 row 6 names the studio supervisor (status page) and Hermes (front door) as the consumers that carry UI, in place of ClaudeOS, and still states the studio grows no UI; the Audience line and every other row that names ClaudeOS as the driver are updated

**Given** the contract
**When** a driver author looks for who drives the studio
**Then** a driver roster lists the studio supervisor (executing wrapper, status page), Hermes (front door that submits jobs to the supervisor and never executes a run), and direct invocation (a conforming driver per §1)

**Given** §2
**When** read
**Then** it states that the executing wrapper for a run is whichever conformant driver executed its `wake` directive, and that `account` and `finish` are that wrapper's duty

**Given** §1 and §4
**When** read
**Then** §1 points to §2 for per-skill CLIs and to §3 for the status block, and the §4 `finish` row documents the optional `total_cost_usd` from Story 20.1

**Given** the release gate
**When** the story closes
**Then** `runner.py run` is ok over every surface, the lib suite is green, the release motion (`tools/release_archive.py`) ships the plugin at its next patch version with the gate ×3 in lockstep and a verified archive, the scoped plugin update lands it on the agent PC, and `tk activate` is clean on all four planes

## Epic 21: A Queued Job Runs to a Guarded, Measured End

The core of Phase 1, in the new supervisor repo (proposed `thkennedy/tk-studio-supervisor`; the name stays plan open item 1 until the operator confirms it). The ClaudeOS driver code at tag `retired-as-driver-2026-09-26` (`connectors/tk-studio/server.ts` 705 lines, `client.ts` 96, `conformance.ts` 453, `scripts/studio-jobs-tick.ts` 307) is lifted as a Bun/TypeScript library and CLI. It is stripped of its ClaudeOS coupling (the `.mcp.json` stdio registration, the Mission Watchdog chaining, the `claudeos-mcp-connector` driver name) and grows the durable parts it never had: a SQLite queue, a lock per checkout, wrapper-enforced guards, a pacer, the two-tier worker under the Max login, cost capture, and crash recovery.

The salvage read of 2026-09-27 found what the lift must change, not just copy. `server.ts` defaults the worker to `--permission-mode bypassPermissions`, which is forbidden on the host; it passes model and effort only inside the payload; it treats `ANTHROPIC_API_KEY` or a working `claude --version` as proof of auth; and it reads the registry file directly. `conformance.ts` has no `evolve` or `launch` entries in its surface and verb maps, and it throws a TypeError on `expect: harness-blocked` drives. The tick handles self-paced jobs only, never calls `account`, has no atomic wake, and strands a run in `queued` forever if it dies between `wake` and `finish`. Everything else it implements is current through 0.1.17: `job.schema.json`, `jobrun.py` and the status schema are unchanged since 0.1.12. The epic is operable from its own CLI; Epic 22 adds reach. Requirements trace: Source, scope items 1–4, acceptance (b) and (c). Repo: the supervisor repo.

### Story 21.1: The Lift Drives the Studio at the Current Contract

As the operator,
I want the ClaudeOS driver code lifted into the supervisor repo and brought current,
So that one job can be woken, invoked headless, and finished from the command line on the agent PC.

**Acceptance Criteria:**

**Given** the four source files at the tag
**When** they are lifted
**Then** the repo carries them with their provenance (tag, path, commit) in its README, `js-yaml` as the only runtime dependency beyond Bun, no ClaudeOS registration, watchdog, or driver-name residue, and no machine path in any tracked file (AD-15): the studio root, store, and plugin root resolve from the environment

**Given** the worker invocation
**When** the lifted code builds the `claude -p` command line
**Then** the host default permission mode is `auto`, a bypass request on the host is refused with a named error before any process starts, the `permissions.deny` list in `~/.claude/settings.json` applies untouched, and the worker's environment never carries `ANTHROPIC_API_KEY` (ruling 3: the Max login pays)

**Given** the auth preflight
**When** the Max login is absent or expired
**Then** the run ends `blocked` naming the missing login — never a silent 401, and never passed on the strength of `claude --version` alone

**Given** a job id for a registered project
**When** it is submitted
**Then** the project is read through the contract's registry read path and the job through the `resolve` verb (0.1.12), never from raw `.tk-studio/jobs/*.json` files

**Given** a declared one-shot job whose target is the read-only `tk-studio-activate` surface (the story adds it to this repo as `.tk-studio/jobs/studio-health.json`)
**When** it runs `wake` → invoke → `finish` from the CLI
**Then** the status block is captured from the worker's JSON output, `finish` records it, and a `job-run` event lands in the agent PC's ledger

**Given** the shipped core-target `maintenance-conformance` job
**When** the supervisor wakes it
**Then** `wake` runs the core itself and ends the run (no worker session, no `finish`), and the supervisor records the run's outcome from `status` — corrected 2026-09-28 after the Epic 21 launch found core-target jobs never reach `finish`

**Given** the repo's test suite
**When** `bun test` runs
**Then** command-line building, status-block extraction (the last balanced JSON object with string `status` and `intent`), and the missing-block case (a named conformance failure, AD-11) are pinned and green

### Story 21.2: Conformance Passes Through the Supervisor

As the operator,
I want the shipped conformance suite driven through the supervisor,
So that acceptance (b) proves the new driver honours the contract (AD-19).

**Acceptance Criteria:**

**Given** `contracts/conformance/manifest.json` from the installed plugin
**When** the lifted `conformance.ts` runs it through the supervisor
**Then** every surface in the manifest is driven, the missing `evolve` and `launch` surface and verb entries are added, and the report names the driver as the studio supervisor

**Given** a drive declared `expect: harness-blocked`
**When** the suite runs without `--harness`
**Then** the drive is reported as skipped with its reason, never a thrown error; with `--harness` it runs under a denying permission profile and is judged per §8

**Given** the supervisor-driven report and `runner.py run` direct, on the same plugin version
**When** they are compared
**Then** both are ok over the same surfaces and check counts, and any divergence fails the story

### Story 21.3: Jobs Survive Restarts in a Durable Queue

As the operator,
I want submitted jobs and their runs held in SQLite with one lock per checkout,
So that nothing is lost or run twice when the supervisor stops, crashes, or two requests race.

**Acceptance Criteria:**

**Given** a job submission
**When** it is accepted
**Then** it is validated against the plugin's `job.schema.json` (an invalid submission is refused with the schema error and nothing is queued) and persisted in `jobs`, `runs`, and `events` tables in a database outside every repo and outside `~/.tk-studio` (which the studio owns), at a path from the supervisor's environment, with atomic state transitions

**Given** two wakes for the same job racing
**When** both reach the queue
**Then** exactly one run is minted in one transaction (idempotent `wake`) and the other caller receives the existing run id

**Given** a run holding a project checkout, including a detached bmad-loop engine the supervisor launched
**When** a second run targets the same checkout
**Then** the second run waits in `queued` with the lock holder named — one engine per checkout

**Given** a supervisor restart
**When** it finds runs left `queued` or `running` by a process that no longer exists
**Then** each is ended `partial` with reason `orphaned: supervisor restart` or re-queued if it never started — never left in `queued` forever — and every transition lands in `events`

### Story 21.4: The Worker Runs on the Right Tier and Reports Its Cost

As the operator,
I want each run executed on the tier its job needs, with model and effort forwarded verbatim and cost captured,
So that no run bypasses permissions on the host and every finish carries what it spent.

**Acceptance Criteria:**

**Given** a run on the host tier (the default; the tier comes from the submission or the supervisor's own per-job config, never from the plugin — AD-2)
**When** the worker starts
**Then** `claude -p` runs under the Max login with `--permission-mode auto` (or `acceptEdits` when the job asks), `--output-format json`, the deny list untouched, and the process console-hosted in the logged-on session — never a headless Task Scheduler spawn (runbook §8)

**Given** a run on the sbx tier
**When** the worker starts
**Then** it runs inside a Docker Sandboxes microVM, where bypass is permitted; a bypass request on the host tier is refused before any process starts and the run ends `blocked` naming the refusal

**Given** model and effort from the resolved job or the submission
**When** the worker starts
**Then** they are forwarded verbatim as contract §5 specifies; the supervisor never chooses a model (AD-14)

**Given** the worker's JSON result
**When** the run ends
**Then** the status block is extracted, `total_cost_usd` is passed to `finish` (Epic 20), and a missing block ends the run with a named conformance failure (AD-11)

**Given** the first sbx-tier run on the agent PC
**When** it completes
**Then** the two runbook §3.5 first-run checks are recorded: bypass works inside the microVM, and `~/.ssh` and cloud-credential folders are not visible inside it

### Story 21.5: Guards and the Pacer Are the Wrapper's Job

As the operator,
I want wall-clock, turn, and token guards enforced by the supervisor, and recurring jobs paced without overlap,
So that no unattended run outlives its budget and no job piles up behind itself.

**Acceptance Criteria:**

**Given** a run past its `max_wall_clock_seconds`
**When** the guard trips
**Then** the worker's whole process tree is killed and the run finishes `partial` with the guard named in `reason`

**Given** a job with `max_turns` or `max_tokens`
**When** the worker completes an iteration
**Then** `account` is called with the turns and tokens read from the worker's transcript, and a tripped guard ends the run `partial` naming it

**Given** a self-paced job with `hint_seconds`
**When** the pacer ticks
**Then** the job is woken only after the hint has elapsed since its last run ended, and never while a run of it is `queued` or `running`

**Given** a job whose `stop.on_status` matches a run's terminal status
**When** that run ends
**Then** the job stops recurring and the stop condition is recorded in `events`

### Story 21.6: A Killed Run Resumes or Ends Partial, Never Lost

As the operator,
I want a run interrupted by a supervisor crash or a silent worker exit to resume from its transcript or end `partial` with the reason named,
So that acceptance (c) holds: no run is ever silently lost.

**Acceptance Criteria:**

**Given** the supervisor is killed mid-run
**When** it restarts
**Then** every run it owned is found in the queue; each resumes with `--resume <session-id>` on the same tier and branch when its session transcript exists and its guards leave budget, and otherwise finishes `partial` naming the guard or `supervisor restart` (superseding Story 21.3's orphan rule for runs that can resume)

**Given** a worker that exits without a status block (runbook §8: silent REPL exit)
**When** the exit is detected
**Then** the same resume-or-partial rule applies, capped at one resume per run by default, and a second failure ends `partial`

**Given** a resume whose transcript the CLI has garbage-collected
**When** the nightly backup holds a copy
**Then** the transcript is restored from the backup before resuming; with no copy, the run ends `partial` naming the missing transcript

**Given** the repo's test suite
**When** it kills the supervisor at three points (after `wake`, mid-invoke, before `finish`)
**Then** each case ends resumed or `partial` with its events recorded, and the suite is green

## Epic 22: Reachable from the Phone

Plan Phase 1 scope items 5–7 and runbook §4. The supervisor answers on the tailnet and starts itself at logon the way this box needs: console-hosted, never a headless Task Scheduler task, and never started from a Claude desktop-app session (the MSIX AppData virtualization). The HTTP API is the seam Hermes will POST to in Phase 2, and the fallback front door if Hermes churns. Requirements trace: scope items 5, 6, 7. Repos: the supervisor repo (Stories 22.1–22.3), tk-studio kb (Story 22.4). Story 22.5 was added on 2026-10-06 from DW-20, after the first four had landed: the page signs the operator in from a phone browser (supervisor repo, runbook §4.5 follows in tk-studio).

### Story 22.1: The API Answers on the Tailnet Only

As the operator away from the box,
I want the supervisor's HTTP API on the tailnet address behind a bearer token,
So that I can submit, watch, and cancel runs from the phone, iPad, or main PC.

**Acceptance Criteria:**

**Given** the supervisor starts
**When** it binds
**Then** it binds only the Tailscale address named in its environment and refuses to start on `0.0.0.0`, on an address outside `100.64.0.0/10`, or without a bearer token in its environment

**Given** a request without the correct token
**When** it arrives
**Then** it gets 401 and the token never appears in any log

**Given** `POST /jobs` naming a registered project and a declared job, with optional `base_ref`, `tier`, `model`, and `effort`
**When** it is valid
**Then** it is queued through Story 21.3's validation and the response carries the run id; an invalid body gets 400 with the schema error

**Given** `GET /jobs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /status`, and `GET /events?since=`
**When** each is called
**Then** each answers from the queue; cancel ends the run `cancelled`, stopping a launched engine gracefully (`tk-studio-launch` verb `stop`, `graceful`); `/events` serves both SSE and plain polling

**Given** the API test suite
**When** it runs
**Then** auth refusal, malformed JSON, unknown project, unknown job, and a double cancel are pinned and green

### Story 22.2: A Read-Only Status Page

As the operator,
I want a small server-rendered page over the queue and `~/.tk-studio`,
So that I can see what the box is doing at a glance while the studio plugin still grows no UI.

**Acceptance Criteria:**

**Given** the status page
**When** it is requested
**Then** it is served on the same bind and behind the same auth as the API, with no client-side framework, and it reads well at phone width

**Given** the page
**When** it renders
**Then** it shows the queue (jobs, and runs with state, reason, and cost), the latest status blocks, run workspaces (`run.json`, `handoff.json`), the tail of this machine's ledger file, and the registry's projects

**Given** any page route
**When** it is exercised in the test suite
**Then** it is a GET that writes nothing to the queue or to `~/.tk-studio`, and it renders no credential-shaped value (NFR5)

### Story 22.3: The Supervisor Starts Itself at Logon

As the operator,
I want the supervisor console-hosted at logon with the box's run hygiene built in,
So that it is always up after a reboot and never runs under the conditions that hang `claude -p`.

**Acceptance Criteria:**

**Given** `start.ps1` in the repo
**When** it runs
**Then** it reads the bind address and token from the user environment, starts the sbx daemon from `$HOME` when it is not already running (so the "Docker Sandboxes daemon" sign-in task can later be retired by the operator), and starts the API and the pacer

**Given** the logon path
**When** the story hands it over
**Then** the operator receives the exact command for the `shell:startup` shortcut (`wt.exe -w studio nt --title supervisor pwsh -NoExit -File <repo>\start.ps1`, runbook §4); nothing registers a "run whether user is logged on or not" task, and nothing starts the supervisor from a Claude desktop-app session

**Given** a run flagged as editor-in-the-loop on a Godot project
**When** it is about to start
**Then** a `robocopy /E` snapshot (never `/MIR`) of the project lands in the work folder and its path is recorded on the run

**Given** any terminal run
**When** it ends
**Then** a notification goes out (ntfy or Telegram, chosen by the environment) naming the run, its status, its reason, and its PR when there is one, and the run's session transcript is copied to the backup folder (the nightly task remains the catch-all)

**Given** a reboot of the agent PC
**When** auto-logon completes
**Then** `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:<port>/status` from another device answers

### Story 22.4: The Runbook Describes the Supervisor as Built

As an operator provisioning the next agent box,
I want runbook §4 to describe the supervisor as built instead of as a placeholder,
So that the next box is set up from facts.

**Acceptance Criteria:**

**Given** `kb/agent-pc-setup-runbook.md` §4
**When** the story lands
**Then** it names the repo, the clone path under `C:\GitHub`, the environment variables (bind address, token, database path, notification target), `start.ps1`, the Startup shortcut, the retirement of the sbx sign-in task, and the smoke test from another device; §7 gains a smoke row and §8 gains a row for each supervisor failure mode met while building it

**Given** the story's docs-only scope
**When** it lands
**Then** no code, schema, or contract file changes, and the kb index regenerates only if frontmatter moved

### Story 22.5: Sign In from the Phone

As the operator on the phone,
I want the status page to sign me in with the token, with Google, or with GitHub, and keep me signed in with a cookie,
So that I can watch and cancel runs from a phone browser, which cannot send the bearer header (DW-20).

**Acceptance Criteria:**

**Given** a browser request to the page with neither a bearer header nor a valid session cookie
**When** it is answered
**Then** it gets a sign-in page on the same bind: a form that takes the API token, and "Continue with Google" and "Continue with GitHub"; nothing else of the page is served, and the API's JSON routes still answer 401 as in Story 22.1

**Given** the correct token on the form, or an OAuth callback whose verified identity is on the allow list named in the environment (one Google account, one GitHub login, never a wildcard)
**When** sign-in completes
**Then** an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie is set, signed with a session secret from the environment and carrying an expiry; an identity off the allow list, a bad token, or a failed OAuth state check is refused with no cookie and no detail

**Given** a signed-in browser
**When** it opens `GET /` and the API's GET routes
**Then** they answer as the bearer header would; `POST /runs/{id}/cancel` from a cookie session also needs the CSRF token the page embeds, and a cookie never authorises `POST /jobs`

**Given** Google's rule that a redirect URI is `https` on anything but localhost
**When** the supervisor serves the sign-in
**Then** it serves `https` on the tailnet address with the machine's Tailscale certificate for its MagicDNS name (`tailscale cert`), the bind rule of Story 22.1 is unchanged, and the hand-over names the operator's two steps: enable HTTPS certificates once in the Tailscale admin console, and register the Google and GitHub OAuth apps with that callback URL, their client ids and secrets set under the `TK_SUPERVISOR_OAUTH_*` names the story fixes

**Given** the OAuth client secrets, the session secret and every cookie value
**When** anything logs, renders, notifies or spawns a worker
**Then** none of them appears (NFR5) and `buildWorkerEnv` drops them; the test suite pins the form path, both OAuth callbacks against a faked provider, the allow-list refusal, the state-check refusal, cookie expiry and the CSRF refusal

## Epic 23: The Supervisor Lands a Story on The Universe Awaits

Plan acceptance (a) and (d) against the standing target: the-universe-awaits on a throwaway branch, replacing the plan's `slice-zero`. Three gaps found on 2026-09-27 make this more than a `curl`:

- TUA has never had a branch or a PR; its loop commits on the checkout.
- `run-epic` is one-shot and ends when bmad-loop detaches, so a PR can only follow the engine run.
- bmad-loop is not provisioned on TIM-PC-2. On the main PC it ran in WSL with its own login, and TUA's tracked `.bmad-loop/profiles/claude.toml` launches sessions with `bypassPermissions` and a main-PC `TK_STUDIO_ROOT`.

The epic closes those gaps, then runs acceptance and measures it. TUA `main` is never touched; protecting it is the operator's call (asked 2026-09-27: not yet). Requirements trace: acceptance (a) and (d), and Phase 0's closing condition. Repos: the supervisor repo, and the-universe-awaits on the throwaway branch only.

### Story 23.1: The Engine Has a Home That Never Bypasses on the Host

As the operator,
I want bmad-loop provisioned on the agent PC where its sessions are allowed to run,
So that `run-epic` can execute here within the hard rules.

**Acceptance Criteria:**

**Given** the operator's placement decision (recommended: the sbx tier; fallback: the host tier with `--permission-mode auto`)
**When** the story starts
**Then** the decision is recorded in the runbook, and neither WSL nor the host ever runs the engine's sessions with bypass

**Given** the sbx placement
**When** the engine is provisioned
**Then** bmad-loop, the .NET 8 SDK, and headless Godot run inside the microVM against the TUA checkout, and on the host Godot still runs only through `$env:GODOT`

**Given** the host placement
**When** the engine is provisioned
**Then** the throwaway branch's loop profile replaces its bypass arguments with `--permission-mode auto`, `TK_STUDIO_ROOT` comes from the environment instead of a main-PC path, and bmad-loop's native-Windows support is proven or its blocker (such as tmux) is named

**Given** any first run that creates AppData folders (a `uv tool install bmad-loop`, NuGet, Godot)
**When** it is needed
**Then** the operator runs it in their own terminal from exact commands the story provides; no Claude desktop-app session performs it

**Given** the throwaway branch
**When** `tk-studio-launch` verb `check` runs against `_bmad-output/specs/spec-epic-2`
**Then** it answers ok, with `.bmad-loop/policy.toml` present locally and untracked

### Story 23.2: Every Run Gets Its Own Branch and Ends in a PR

As the operator,
I want the supervisor to cut a branch per run and open a PR against the run's base when the work ends,
So that all agent work arrives PR-only.

**Acceptance Criteria:**

**Given** a submission with `base_ref`
**When** the run starts
**Then** the supervisor creates `supervisor/run-<run_id>` from `base_ref` in the project checkout, refusing a dirty tree (never cleaning one)

**Given** a `base_ref` that is the repository's default branch
**When** that branch is not protected on GitHub
**Then** the run is refused `blocked` naming the unprotected branch (the "main protected on every repo the agent touches" rule)

**Given** a run that launched an engine (`run-epic`)
**When** the launch session ends
**Then** the supervisor follows the engine run through `tk-studio-launch` verb `status` until it completes, pauses, or is stopped, then pushes the run branch and opens a PR against `base_ref` whose body carries the launch status block, the engine run id, the commits, and the cost

**Given** a run that produced no commits
**When** it ends
**Then** no PR is opened and the run records "no changes"

**Given** any run
**When** it touches git
**Then** it never force-pushes and never merges

### Story 23.3: Acceptance from the Phone, Measured

As the operator,
I want the plan's acceptance run end to end from the phone and measured,
So that Phase 1 is proven before Phase 2 starts.

**Acceptance Criteria:**

**Given** the supervisor on the agent PC with `TK_SUPERVISOR_WORK=C:\agent-work`, the engine sandbox mounting `C:\agent-work\worktrees` read-write as `/c/agent-work/worktrees`, TUA `main` protected on GitHub (the commit recorded) and the declared job `run-epic-2`
**When** the operator sends `curl -X POST …/jobs` from the phone over Tailscale naming the project and the job, with no `base_ref`
**Then** the run resolves `base_ref` to `main` (`base_ref_source: default`), cuts `C:\agent-work\worktrees\the-universe-awaits\<run id>` on `supervisor/run-<run id>` with a relative gitdir, materialises it (`tk install` at the pin, policy and routing copied, `tk activate` clean), launches the engine with `--project` the worktree and writes `launched`; the run appears in `GET /jobs` and on the status page, the engine runs story `2-1-keyed-month-thread-scheduler`, a graceful cancel after that story's commit stops it, the branch is pushed and one PR opens against `main` whose body carries the launch status block, the engine run id, the landed commits and the metered cost; the `ended` event carries the PR URL, the worktree is removed, and the checkout at `C:\GitHub\the-universe-awaits` never changes branch (re-planned 2026-10-16 against supervisor Story 27.1, which supersedes 23.2; a pause leaves the run `paused` with a draft PR and the worktree kept) — acceptance (a)

**Given** the same day's plugin version
**When** conformance runs through the supervisor (Story 21.2)
**Then** it is ok — acceptance (b)

**Given** the supervisor is killed during a run's launch session
**When** it restarts
**Then** the run resumes or ends `partial` with the guard named, never lost — acceptance (c)

**Given** the finished runs
**When** the ledger is read
**Then** `job-run` events carrying `total_cost_usd` are in `~/.tk-studio/measurements/tim-Tim-PC-2.jsonl` (the first `job-run` events on the box, which closes Phase 0), the engine's own session costs are read from the substrate's usage records, and `tk measure push` opens the membrane PR — acceptance (d)

**Given** the acceptance record
**When** the story closes
**Then** a kb record names the run ids, the PR URL, the costs, and every failure met, and TUA `main` is verified unchanged at its recorded commit

## Epic 24: Opus 5.5 Earns Its Legs, Measured

The operator asked on 2026-09-28 to run Claude Opus 5.5 in as many loop legs as it suits, and to measure cost and speed. Opus 5.5 lists at $4 / $20 per million input / output tokens, with cache reads at $0.20. That is below Opus 5 ($5 / $25) and Fable 5.1 ($10 / $50), but twice Sonnet 5 ($2 / $10). So it is a price cut on the consult, seam, review, triage and planner legs. On the session, implementer, reviewer and supervise legs it only saves money if it finishes a story in fewer turns and retries.

The routing is already in: PR #73 adds `claude-opus-5-5` to the pipeline allowlist and puts tk-studio's own `.bmad-loop/routing.toml` on Opus 5.5 for every leg. This epic makes the trial measurable and turns it into a verdict. Three measurement gaps drive it:

- The v2 baseline priced weighted tokens at one model's price, which cannot price mixed-model routes.
- The engine now runs inside Docker Sandboxes, so its session transcripts live in the microVM rather than in the host backup.
- There is no wall-clock baseline on this box.

The shipped `[pipeline.legs]` defaults change only when this epic records a verdict (AD-14, AD-12 evidence discipline). Requirements trace: operator request of 2026-09-28; `kb/execution-pipeline-model-routing.md`. Repos: tk-studio, the supervisor repo, the-universe-awaits (throwaway branches only).

### Story 24.1: Every Landed Story Carries Its Price and Its Time

As the operator comparing model routes,
I want each landed loop story priced per model from its transcripts and timed from its run,
So that routes are judged on dollars and wall-clock time, not on token counters.

**Acceptance Criteria:**

**Given** a bmad-loop run on the sbx engine
**When** a story reaches its boundary
**Then** the session transcripts and subagent transcripts for that story are copied out of the microVM into the run's directory in the mounted checkout (gitignored), so they reach the host and its nightly backup

**Given** a story's transcripts and a committed price table (model id → input, output, cache-write 5-minute, cache-write 1-hour and cache-read $ per MTok, with the table's date and source; the figures are the sourced table in `kb/execution-pipeline-model-routing.md`, ruled 2026-09-28)
**When** the meter prices the story
**Then** it reports dollars per model and per leg (session, implementer, reviewers, consult, seam, review, triage, supervise), the story's wall-clock from first dispatch to landed commit, its attempt count, and the route in force (from `routing.current.json`); a model missing from the price table is a named refusal, never a guessed price

**Given** a priced story
**When** the meter records it
**Then** one `observation` event per story lands in this machine's ledger, carrying the story key, route, dollars, wall-clock and attempts, and the lib suite pins the pricing arithmetic, the missing-price refusal, and a mixed-model story

### Story 24.2: The Supervisor Is Built on the Trial Route

As the operator,
I want the Phase 1 build itself to run on the Opus 5.5 route and to be measured story by story,
So that the trial collects real data without spending anything beyond the planned work.

**Acceptance Criteria:**

**Given** Epics 20–22 run through the launch pipeline
**When** each story lands
**Then** it ran on the trial route (tk-studio's `routing.toml`, and the same table in the supervisor repo), and its Story 24.1 record exists

**Given** the landed stories
**When** they are compared with the v2 table by story kind (core code ≈ $4.4, feature ≈ $8.6 all-in)
**Then** a kb trial record lists each story's dollars, wall-clock, attempts and kind, with the caveat that these are different stories and a different language (TypeScript and Python against the C#/Godot baseline)

### Story 24.3: Paired Runs on The Universe Awaits

As the operator,
I want the same stories run under both routes from the same base,
So that cost and speed are compared on identical work in the project the baseline came from.

**Acceptance Criteria:**

**Given** the engine home on this box (Story 23.1) and two throwaway branches cut from one recorded TUA `main` commit, `throwaway/route-v2` and `throwaway/route-o55`
**When** stories `2-1-keyed-month-thread-scheduler` and `2-2` (in `spec-epic-2` order) run on each branch, with the shipped defaults on `route-v2` and Opus 5.5 on every leg on `route-o55`, through runtime overrides or a branch-local `routing.toml` (never on `main`)
**Then** each story on each arm has a Story 24.1 record

**Given** the four records
**When** the arms are compared per story
**Then** the kb trial record states, per story and in total, the dollars (split by leg), wall-clock, attempt-1 landing, review findings raised, and weekly plan-usage points; it notes that n = 2 is directional, not significant; and neither branch merges anywhere

### Story 24.4: The Verdict Sets the Defaults

As the operator,
I want the trial's evidence turned into a routing decision per leg,
So that the shipped defaults reflect what was measured, and nothing changes silently.

**Acceptance Criteria:**

**Given** the Story 24.2 and 24.3 records
**When** the verdict is drafted
**Then** each leg gets keep-Opus-5.5, revert, or needs-more-data, with the evidence cited; an `observation` per leg lands in the ledger, and `tk-studio-evolve` mints the proposal, which only the operator adopts

**Given** an adopted proposal
**When** it is applied
**Then** `[pipeline.legs]` in the `tk-studio-launch` `customize.toml` and the kb table change to the adopted route with the trial's numbers, and the release motion ships it with the lib suite and conformance green; the project-tier trial table is then removed from tk-studio's `routing.toml`

**Given** budget left after the paired runs
**When** the verdict keeps Opus 5.5 on the session leg
**Then** one effort probe (session at `low` against `medium`, on one story) is run and recorded before the effort default is set

## Epic 25: One Installer Writes the Studio

The first epic of the design spec's build order (`_bmad-output/planning-artifacts/design/studio-design-spec-2026-10-09/README.md` §10; order ruled 2026-10-14, D3). It lands what O5 (ruled 2026-10-09) and AD-21 (signed 2026-10-14) decided about distribution: a bootstrap script installs a small self-updating meta-CLI; the meta-CLI reads a committed roster of compatible versions and installs or updates the three apps; the plugin reaches every machine as an installer-written skills-dir plugin at `~/.claude/skills/tk-studio/`, which Claude Code loads in place as `tk-studio@skills-dir` with `${CLAUDE_PLUGIN_ROOT}` substituting (Tim's probe, 2026-10-09); the marketplace is no longer the user delivery path. The three rules the red team added stand: the installer uninstalls every marketplace copy of `tk-studio` (a same-named marketplace install silently shadows the folder); sandboxes read the host skills folder through Docker's read-only skills mount instead of a per-sandbox install; the skills-dir form is documented as the no-marketplace path and carries a deprecation watch. Until EP-31 moves the supervisor into this repository, the roster points at two repositories' releases; nothing in this epic depends on the move. The installer design is ADR §7 with the plugin leg replaced by the skills-dir write; `doctor` absorbs the runbook's smoke table and the two trust holes (14, 15). Requirements trace: ADR §7, §6 and §8.7; spec §4, §6.5, F1 and F7; holes 14 and 15. Repos: tk-studio (every story); the supervisor repo for its first tagged release in Story 25.1 (an operator step until EP-31).

### Story 25.1: The Roster and the Release Motion for Every App

As the maintainer,
I want one committed roster per channel naming the compatible set of app releases with checksums, and one release script that cuts any app by its prefix,
So that the installer has a single source of truth and no app ever owns the repository's "latest".

**Acceptance Criteria:**

**Given** `tools/installer/rosters/stable.json` and `latest.json`
**When** they are read
**Then** each carries `schema`, `channel`, `requires` (at least `claude-code` as a version floor), and `components`, where every component is optional per channel (an absent component means "not shipped in this channel", which the installer and `doctor` report, never an error); a present `plugin`, `supervisor`, `studio-web` or `cli` entry is `{tag, url, sha256}` with all three required, and `uv` and `bun` are `{version, sha256: {<platform target>: <hex>}}` with one digest per upstream platform asset (Windows x64 at minimum); a lib guard pins the shape, refuses a present entry with a missing or malformed digest by name, never accepts a placeholder or a fabricated value, and asserts the plugin entry agrees with `released-roster.json` and the plugin's `plugin.json` version (the existing gate ×3 becomes gate ×4); at the first cut the roster carries `plugin`, `uv` and `bun`, and `stable.json` equals `latest.json` (ruled 2026-10-14)

**Given** `tools/release_archive.py`
**When** it is run with `--app <plugin|supervisor|studio-web|cli>`
**Then** it builds the deterministic zip (or wheel, for `cli`) from that app's subtree at the `<prefix>--vX.Y.Z` tag, publishes it with `gh release create --latest=false`, re-downloads and verifies the digest, and records `{tag, url, sha256}` under the right roster component; the plugin's motion is unchanged in effect; `make_latest: false` is asserted by the lib suite against a fake `gh`

**Given** the supervisor repository, which has no tags today
**When** the story closes
**Then** the story provides the exact commands for the operator to cut `supervisor--v0.1.0` from its `main` and publish the asset (the script runs against that checkout until EP-31), the engine never cuts or pushes a tag on another repository, and the roster schema accepts a `supervisor` entry whose URL is on another repository, named in the entry's `source` field; the entry itself is added by the operator step once the asset exists, and the story does not wait for it (ruled 2026-10-14)

**Given** the lib suite and conformance
**When** the story closes
**Then** both are green, and the roster guard runs in the drift check's plugin plane (Story 25.3 wires the rest)

### Story 25.2: The Installer Writes the Skills-Dir Plugin

As a user of any machine with Claude Code signed in,
I want the plugin written to `~/.claude/skills/tk-studio/` from the verified release zip, with every marketplace copy removed,
So that Claude Code loads the studio in place with no clone, no cache copy and nothing shadowing it.

**Acceptance Criteria:**

**Given** `tk-studio install` or `update` and a roster
**When** the plugin leg runs
**Then** it downloads the plugin zip by the roster's tag, verifies the SHA-256 before extracting, writes the folder atomically (new folder beside, rename over; the previous folder kept until the next successful start), and the result names the version written; a digest mismatch refuses by name and leaves the existing folder untouched

**Given** the developer's own checkout
**When** `tk-studio install --link <checkout>` runs
**Then** the folder is a junction (Windows) or symlink to `<checkout>/plugins/tk-studio`, so edits are live, and `doctor` reports "link mode" with the target

**Given** a marketplace copy of `tk-studio` at user or project scope
**When** the plugin leg runs
**Then** it uninstalls the user-scope copy (`claude plugin uninstall`) and removes the `tk-studio` marketplace from the user's known marketplaces, reports every project-scope `enabledPlugins` or `extraKnownMarketplaces` entry it finds without editing another project's tracked files, and this repository drops its own committed `extraKnownMarketplaces` and `enabledPlugins` entries in the same story

**Given** the written folder
**When** `claude plugin list` and `claude plugin validate` run and a probe skill is invoked headless
**Then** the plugin loads as `tk-studio@skills-dir`, validation passes, and `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` substitute as forward-slash paths (the 2026-10-09 probe, now a test the story runs on the box); `claude plugin eval` is tried against the folder and the outcome recorded in the kb (the open question closes either way)

### Story 25.3: The Drift Check and Conformance Read the Folder and the Roster

As the operator,
I want `tk activate`'s plugin plane and the conformance suite's harness-loadable assertion to judge the skills-dir folder against the roster,
So that the drift check keeps telling the truth after the marketplace is gone (AD-13 as amended by AD-21).

**Acceptance Criteria:**

**Given** `drift_check.py`'s plugin plane
**When** it runs on a machine with the skills-dir plugin
**Then** it reads the folder's `plugin.json` version, compares it with the roster's `plugin` entry for the configured channel (and with the in-repo catalog only in a developer checkout), reports `ok`, `stale` (guidance: `tk-studio update`), `missing` (guidance: `tk-studio install`) or `shadowed` (a marketplace copy is installed; guidance names the uninstall), and never reads `installed_plugins.json` as the source of truth; the lib suite pins all four cases

**Given** `contracts/conformance/`
**When** the suite runs
**Then** the harness-loadable assertion reads the skills-dir folder, and the runner can install the built zip into a clean `CLAUDE_CONFIG_DIR` skills folder before driving (`--from-archive <zip>`), so the suite cannot pass against the repository tree for the wrong reason

**Given** the driver contract at 0.1.18
**When** the story lands
**Then** §6 (drift-check invocation) states the folder-and-roster rule, the header reads 0.1.19 with an additive changelog clause, the spine's AD-13 wording "installed plugin version vs `marketplace.json`" is amended to the folder and the roster, and conformance is ok over every surface

### Story 25.4: The Bootstrap and the Meta-CLI

As a newcomer,
I want one command that installs a small self-updating CLI, and that CLI to install and update the three apps from the roster,
So that I never clone a repository or hand-edit an environment to run the studio.

**Acceptance Criteria:**

**Given** `tools/installer/install.ps1` and `install.sh`
**When** either runs
**Then** it installs the pinned `uv` unmanaged into the studio's tools folder (version and SHA-256 embedded in the script), verifies the meta-CLI wheel's digest, runs `uv tool install` from that wheel, puts only the studio's `bin` directory on the user PATH, turns on long paths for git, never clones, and the README publishes each script's SHA-256 with a download-verify-run alternative

**Given** the meta-CLI `tk-studio` (stdlib Python, shipped as a wheel on its own `cli--vX.Y.Z` tag)
**When** `install`, `update` or `status` runs
**Then** the supervisor leg downloads the release zip by tag, verifies it, unpacks it into `%LOCALAPPDATA%\tk-studio\supervisor\<version>\` (or the platform equivalent), runs `bun install --frozen-lockfile` with the roster's pinned Bun, writes the User environment and the Startup shortcut through the logic lifted from `tools/agent-pc/set-supervisor-env.ps1` (token and session secret generated once and kept), and points `current.json` at the slot; the studio-web leg unpacks the bundle into its own slot that the supervisor serves; `update` stops the service tab first, renames the old slot aside, verifies the new one starts, and deletes the old on the next successful start; `status` prints each component's installed and roster versions

**Given** a machine where the supervisor runs from a git checkout (the dev box)
**When** `update` or `doctor` runs
**Then** it recognises "source checkout" mode, reports instead of replacing, and names the checkout

**Given** the lib suite
**When** it runs
**Then** every verb is exercised against a fake roster, a fake release host and a fake `claude`, including the digest-mismatch, the stale-slot and the source-checkout cases, and no network call is made in tests

### Story 25.5: Doctor Says What Is Wrong

As the operator provisioning the next box,
I want `tk-studio doctor` to run the runbook's smoke table and the trust checks and name every failure with its fix,
So that a fresh machine reaches a working studio from facts, not from reading section 7.

**Acceptance Criteria:**

**Given** `tk-studio doctor`
**When** it runs
**Then** it checks and reports, each with pass, fail and the fix: Claude Code version against the roster floor; the skills-dir plugin against the roster (Story 25.3's cases); the per-user store; `sbx daemon status` **only** (it never runs an sbx command that would auto-start the daemon); folder trust (`hasTrustDialogAccepted`) for every root in the registry (holes 14 and 15); long paths; the PATH launcher; the Tailscale certificate age against its 90-day life; the supervisor's slot or checkout and whether `/status` answers; and, when a Hermes home exists on the box, whether `auth.adopt_external_logins` is on (a warning that names the setting and the Claude-login risk)

**Given** `--json`
**When** it runs headless
**Then** the output is one JSON object and ends with the status block (AD-11); a conformance drive covers it

**Given** runbook §7
**When** the story lands
**Then** its smoke table says "run `tk-studio doctor`" and keeps only the rows the CLI cannot check (RDP scope, the Startup shortcut's visible tab)

### Story 25.6: Sandboxes Read the Host Skills Folder

As the operator,
I want every engine sandbox to consume the host's `~/.claude/skills` through Docker's read-only skills mount instead of installing the plugin per sandbox,
So that one install serves the host and every microVM and the drift check covers both.

**Acceptance Criteria:**

**Given** `tools/sbx-engine/provision-engine.sh`
**When** it provisions a sandbox
**Then** it no longer installs the plugin at user scope inside the microVM; it verifies the mounted skills folder is present and read-only and that `tk-studio@skills-dir` loads inside the sandbox, and fails loudly naming the mount when it is absent

**Given** runbook §3.8 and §3.5
**When** the story lands
**Then** `sbx create` is documented with the skills mount set read-only, the per-sandbox plugin install is removed from the provisioning list, and the "sandbox store" drift case (the mounted folder differing from the host's) is named with its fix

**Given** one existing sandbox on the box
**When** the operator recreates it with the mount (exact commands provided; from PowerShell, with the daemon running)
**Then** `tk activate` inside it is clean on four planes, a headless drive of one skill from inside it substitutes `${CLAUDE_PLUGIN_ROOT}` to the mounted path, and the per-sandbox syscall cost of the skills folder is measured once and recorded in the kb (the red team's "prove it on the box" item)

### Story 25.7: The Docs and the Release Say the Installer Is the Way In

As a reader of the repository,
I want the README, the install runbooks and the kb to describe the installer as the only install path and the marketplace as the developer catalog,
So that nobody follows the retired path.

**Acceptance Criteria:**

**Given** `README.md`, `kb/offline-install-runbook.md`, `kb/agent-pc-setup-runbook.md` §3.4 and `kb/claude-plugin-archive-install-envelope.md`
**When** the story lands
**Then** the README's install section is the one-line bootstrap plus `tk-studio install`; the offline runbook describes the skills-dir write from a downloaded zip; §3.4 drops `claude plugin marketplace add` for users and keeps it, pinned to a tag, under a "developers who clone" note; the envelope document is marked historical with a pointer here; the kb index regenerates; the skills-dir form carries a "deprecation watch" line naming where to look

**Given** the release gate
**When** the story closes
**Then** the plugin ships at 0.3.0 (a minor bump: the distribution changed) through the generalised motion with the roster, `released-roster.json` and `plugin.json` in lockstep (gate ×4), the lib suite and conformance are green, and `tk activate` is clean on all four planes on TIM-PC-2 with the plugin loaded from the skills-dir folder

## Epic 26: The Service Owns Lifetime, Part 1: The Studio Side

The second epic of the design spec's build order (`_bmad-output/planning-artifacts/design/studio-design-spec-2026-10-09/README.md` §6.2 and §10) and the first that spends the evolve loop's rulings of 2026-10-15 (`proposals/triage-2026-10-15.md`): thirteen adopted proposals name EP-26, and this epic carries the ones that live in the plugin and its pipeline. Epic 27 carries the supervisor's half, in its own repository and its own sandbox; the two are one design (the supervisor is the only thing that starts work and owns an engine's life), split by repository the way Epics 20 to 22 were. Everything here is driven by the loop in `claude-tk-studio` and gated by conformance (AD-19); every surface ends headless runs with the status block (AD-11). Rulings in force and not reopened: the 2026-09-26 and 2026-10-09 rulings, O5, AD-21 and AD-22, and the design spec's D1 to D10. Requirements trace: PROP-027, PROP-033, PROP-035, PROP-039, PROP-045, PROP-052, PROP-058, PROP-061, PROP-062, PROP-066, PROP-067 (adopted 2026-10-15), loop holes 4, 6, 10, 19, 20, 23; the advisor fit note (`briefs/advisor-tool-fit-2026-10-09.md`); spec §6.2 item 1 and §7.4 (the adapter's status pull-back, which Epic 27 consumes). Repo: tk-studio.

### Story 26.1: Launch Ends Every Path with the Block and Owns Its Bootstrap

As the operator,
I want `tk-studio-launch` to end every headless path with the status block, to commit its own bootstrap output, and to check the engine's budget limits against the bands before it starts,
So that a driver never records a missing block for a run that succeeded, a second launch pass is never needed, and no story runs under a policy limit the bands do not cover (holes 10, 20 and 4).

**Acceptance Criteria:**

**Given** a first launch on an epic
**When** the bootstrap writes `SPEC.md`, `stories.yaml` and the first plan
**Then** the launch commits them on the run branch with one named commit message before its readiness check, so the dirty-tree refusal never fires on its own output, and the rule is stated once in the skill text (the Epic 20 and 22 launches needed a second pass; the Epic 24 and 25 launches committed theirs)

**Given** a relaunch on an epic with stories already `done` and routing already applied
**When** the session ends
**Then** its last output is the JSON status block exactly as on the fresh path, the watch hint names the supervisor's status page and the `status` verb and never ClaudeOS, and a conformance drive covers the relaunch case beside the fresh case

**Given** the project's `.bmad-loop/policy.toml` limits (`max_tokens_per_story`, wall-clock, review caps) and the budget bands in `.tk-studio/budget-bands.yaml`
**When** `start` or `check` runs
**Then** the launch result names every limit the bands exceed (band ceiling above the policy limit) as a `budget_mismatch` entry with both numbers, `check` ends `partial` naming them, and `start` refuses to start the engine on a mismatch unless the payload carries `allow_budget_mismatch: true`; the machine-local policy file is never edited by the skill

**Given** the lib suite and conformance
**When** the story closes
**Then** both are green, including the new drives, and the driver contract §2 launch row states the bootstrap commit, the relaunch block and the budget check (0.1.21, additive)

### Story 26.2: The Planner Settles Schema Shape and the Spec File Name

As the operator,
I want the launch planner to settle the shape of artifacts that do not exist yet before the first story is dispatched, and story spec files named short enough for Windows,
So that a dev session never halts on a question the design documents already answer (hole 19) and spec paths stay under the path limit (hole 6).

**Acceptance Criteria:**

**Given** `.bmad-loop/plugins/studio-pipeline/task-planning.md` and the SPEC the planner writes
**When** a story's acceptance criteria require a schema entry, a file or a tag for an artifact that only a later story or an operator action produces
**Then** the planner records the settled shape in the SPEC's design notes (an optional or deferred entry, a per-platform map, a named placeholder rule) citing the design document that constrains it, and never leaves it as a Block If or an open question; the consult scope text in the launch customization names schema shape as a planner matter when the design documents constrain it, and an operator ruling only when they do not

**Given** the dispatch notes `transcribe.py` writes into `stories.yaml`
**When** they name the executor spec file
**Then** the name is `stories/<id>-spec.md` (the id already carries the title slug), the engine's glob `<id>-*.md` still resolves it, a bare `<id>.md` is still read as pending (hole 1 unchanged), and the longest resulting path on this box stays under 200 characters

**Given** the lib suite
**When** the story closes
**Then** the transcription tests pin the new name, a planner-note fixture pins the settled-shape rule, and the runbook §3.8 names both

### Story 26.3: Routing Legs Carry an Advisor and an Effort

As the operator comparing routes,
I want every pipeline leg to declare an optional advisor model and to pass its effort explicitly to every subagent it launches,
So that Epic 24.3 can run its third arm (a cheaper main model with a stronger advisor) and the meter can price it (the advisor fit note; PROP-045, PROP-052, PROP-058).

**Acceptance Criteria:**

**Given** `[pipeline.legs]` in the launch customization and a project's `.bmad-loop/routing.toml`
**When** a leg carries `advisor = "opus" | "fable" | "off"`
**Then** `pipeline.py check|resolve|apply` validate it (default `off`; the pairing rule: the advisor must rank at or above the leg's model; a violation is a named refusal), `apply` writes it into `routing.current.json`, and the session leg's `claude -p` command carries `--advisor <model>` only when the leg's advisor is not `off`

**Given** the implementer and reviewer launches the session makes
**When** the routing is in force
**Then** each launch passes `model`, `effort` and the advisor explicitly (the executor customization reads `routing.current.json`), and the dispatch note's consult triggers are stated as advisor instructions when an advisor is on ("consult the advisor on: verify-red, halt, deviation above 0, a high-severity finding, a tripwire, a file outside Files, and before declaring the story done"), with a Consult Log entry appended per advisor call so the audit trail survives

**Given** `lib/meter.py`
**When** a story's transcripts carry advisor usage
**Then** the meter prices it as its own leg `advisor` from the price table (a missing price is a named refusal, never a guess) and the observation names it beside the other legs

**Given** the driver contract §5
**When** the story closes
**Then** it documents the `advisor` field and the pairing rule (0.1.21, additive), the lib suite pins the validation, the command line and the pricing, and conformance is green; the shipped defaults stay `advisor = "off"` on every leg (AD-14: nothing changes until Epic 24.4 records a verdict)

### Story 26.4: The Meter Lands on the Host and Does Not Draft Itself

As the operator,
I want every landed story's meter observation to reach the host ledger even when the engine runs in a microVM, and the evolve drafter to leave measurements alone,
So that recreating a sandbox never loses the cost record again (hole 23) and proposals are minted from toil, not from meter rows (PROP-067).

**Acceptance Criteria:**

**Given** the `post_commit` meter hook inside a sandbox
**When** it prices a landed story
**Then** it also writes the full observation envelope to `<run_dir>/transcripts/<story>/observation.json` on the mounted checkout beside `metered.json`, so the record survives the sandbox

**Given** `meter.py harvest --run-dir <dir>` run on the host
**When** it finds observation files not yet harvested
**Then** it appends each to the host ledger through `observe.record_observation` exactly once (a harvested marker beside the file), reports the story keys and dollars, and the seven re-recorded Epic 25 observations of 2026-10-15 are not duplicated (the marker is seeded for them)

**Given** `evolve.py draft`
**When** it clusters observations
**Then** observations whose description starts with `meter:` are excluded from clustering and counted in the result as `measurements_skipped`; PROP-067's cluster is not re-created on a rerun, and the lib suite pins the exclusion

**Given** runbook §3.8
**When** the story closes
**Then** the sandbox recreate step says to run the harvest and to export the sandbox's own ledger (`~/.tk-studio/measurements/*.jsonl` inside the microVM) to the host before `sbx rm`, with the exact commands

### Story 26.5: The Adapter Takes a Status Pull-Back from a Driver

As a driver author,
I want a planning-adapter verb that sets a canonical story's status-class fields from outside,
So that the supervisor can mark stories `review` when a run opens its PR and `done` when the PR merges, without writing canonical frontmatter itself (AD-4, AD-5; hole 18; Epic 27 consumes it).

**Acceptance Criteria:**

**Given** `plansync.py status --directory <root> --id ST-NNN --status <enum> [--note <text>]`
**When** it runs on a project whose canonical entity exists
**Then** it sets the entity's `status` to the given canonical enum value, stamps `updated`, records the note and the caller in the entity's `external.driver` snapshot (never touching `external.<backend>` snapshots), re-syncs the projection and the index, and names every written file in its result (AD-5: status-class only; a value outside the enum is a named refusal; an unknown id is a named refusal)

**Given** a story that a loop landed in another repository (a transcribed epic)
**When** the verb is called on the owning project with that story's canonical id
**Then** it updates the canonical file there and nothing in the other repository, and the result says which plan it wrote

**Given** the driver contract §4
**When** the story closes
**Then** the verb is documented as additive (0.1.21), the conformance manifest drives it (a headless success and a refused id), the lib suite pins the enum, the snapshot and the projection re-sync, and `plan/index.md` reflects the change after a run

## Epic 27: The Service Owns Lifetime, Part 2: The Supervisor

The supervisor's half of the design spec's §6.2 item 1, built in `thkennedy/tk-studio-supervisor` by the loop in `claude-tk-studio-supervisor` after this epic is transcribed there (the Epic 21 and 22 pattern: change a story here first, then re-transcribe). It makes the supervisor the only thing that starts work and the owner of every engine's life: a worktree per run that the sandbox can see, the engine held and pinned by the service itself, a close-out for a run that paused after its story landed, a host-tier verify leg before any PR opens, the plan pulled back when a run lands, and the deferred work the ledger assigned to it. Two preconditions are the operator's: the supervisor tab is stopped from the console before the loop builds the supervisor itself (the single-checkout decision of 2026-10-06), and the supervisor's sandbox is recreated with the read-only skills mount, `WITH_BUN=1`, and a second read-write mount of `TK_SUPERVISOR_WORK` so worktrees are visible inside the microVM. Requirements trace: Story 23.2 (superseded here), PROP-025, PROP-036, PROP-038, PROP-040, PROP-041, PROP-053, PROP-055, PROP-064, PROP-065 (adopted 2026-10-15), loop holes 7, 9, 11, 12, 16, 18, 22; DW-3, DW-6, DW-11, DW-12, DW-13, DW-15, DW-19, DW-21, DW-23 of the supervisor's ledger; spec §6.2 item 1. Repo: the supervisor repo (every story); tk-studio only for the runbook rows.

### Story 27.1: Every Run Gets Its Own Worktree and Ends in a PR

As the operator,
I want each run to work in a git worktree of the project cut from its base, and to end as a pull request against that base,
So that two loops never share a working tree, a run never switches the branch under a running service, and all agent work arrives PR-only (hole 16; supersedes Story 23.2).

**Acceptance Criteria:**

**Given** a submission with `base_ref`
**When** the run is claimed
**Then** the supervisor creates `git worktree add <TK_SUPERVISOR_WORK>/worktrees/<project>/<run_id> -b supervisor/run-<run_id> <base_ref>` from the project checkout, refuses a `base_ref` that is the repository's default branch when that branch is not protected on GitHub (`blocked`, naming it), and records the worktree path on the queue run; the checkout itself is never switched

**Given** the untracked runtime the engine needs in a worktree (`_bmad/` at the pin, `.bmad-loop/policy.toml` and `routing.current.json`, the project's local config overlay)
**When** the worktree is prepared
**Then** the supervisor materialises them by the studio's own motions (`tk install` at the pin inside the worktree; the policy and routing files copied from the checkout; never a junction into the checkout), `tk activate` is clean inside the worktree, and the engine's `--project` is the worktree

**Given** a run that launched an engine
**When** the engine completes, pauses, or is stopped
**Then** the supervisor pushes the run branch and opens a PR against `base_ref` whose body carries the launch status block, the engine run id, the landed commits and the metered cost, records the PR URL on the `ended` event, opens no PR when no commit landed ("no changes" recorded), never force-pushes and never merges; the worktree is removed after the PR opens unless the run is paused (a paused run keeps it for the resume)

**Given** the supervisor's test suite on the Windows host and the Linux engine
**When** it runs
**Then** worktree creation, the unprotected-base refusal, the runtime materialisation and the PR body are pinned against a fake `gh` and a real throwaway repository, and the live acceptance on the-universe-awaits (Story 23.3) is re-planned against this story

### Story 27.2: The Supervisor Holds the Engine and Nothing Else Starts One

As the operator,
I want the supervisor itself to start, hold, pin and release every engine sandbox, and the queue to be the only way a run starts,
So that an engine never dies with a host-side shell (hole 7) and the pacer never overlaps a run it cannot see (DW-6, DW-3).

**Acceptance Criteria:**

**Given** an sbx-tier run
**When** the worker starts
**Then** the supervisor runs `sbx run -d --name <sandbox>` to pin the sandbox, holds its own `sbx exec` for the engine's lifetime from the console session (never a Claude desktop-app session), records the in-VM engine pid and the sandbox name on the run, and releases the pin (`sbx stop`) when the run ends and no other run holds the sandbox

**Given** a cancel or a tripped guard on an sbx run
**When** it fires
**Then** the engine's process group inside the microVM is killed by name of the recorded pid through `sbx exec` (argv only, no shell), the kill is recorded, and a kill that leaves the pid alive after its wait holds the run as DW-3 specifies

**Given** `jobrun.py submit|wake` run by hand or through the MCP `tk_job` surface on a project the supervisor serves
**When** it would start a run
**Then** the supervisor's lock file for the checkout names the queue as the only starter, the hand-started run is recorded as `external` on the next tick with its studio run id, and the pacer counts it as live until it ends (DW-6 closed)

**Given** the supervisor's test suite
**When** it runs
**Then** the pin, hold, release, kill-by-pid and external-run detection are pinned with a fake `sbx`, on both hosts

### Story 27.3: A Paused Run Whose Story Landed Is Closed Out by the Service

As the operator,
I want the supervisor to close out a run that paused after its story's work was committed, once a verdict exists,
So that the attended recipe of 2026-10-14 (verdict, harvest commit, meter, archive, relaunch) is the service's job (hole 9).

**Acceptance Criteria:**

**Given** a run that paused at the commit gate or on an escalation with the story's spec at `status: done` and a `reconcile_verdict` other than `escalate` recorded
**When** the supervisor's tick sees it
**Then** it commits the engine's staged harvest on the run branch with a named message, harvests the story's meter observation to the host ledger (Story 26.4's `meter.py harvest`), archives the run (`bmad-loop archive`, through `sbx exec`), relaunches the epic through `tk-studio-launch` (which skips done stories) under the same queue run with a `close-out` event, and never re-implements the story

**Given** the same run with no verdict, or `escalate`
**When** the tick sees it
**Then** it stays paused, one notification names the story and the reason, and the run's page row says "awaiting a ruling"

**Given** a story that halted before any commit
**When** the tick sees it
**Then** nothing is closed out; the run stays paused for the resume path (`bmad-loop resolve`), which the supervisor exposes as `POST /runs/{id}/resume` with an optional restore patch

**Given** the supervisor's test suite
**When** it runs
**Then** all three cases are pinned with a fake engine, on both hosts

### Story 27.4: A Host-Tier Verify Leg Runs Before Any PR Opens

As the operator,
I want the project's own verify command run on the Windows host, in the run's worktree, after the engine completes and before the PR opens,
So that Windows-only defects stop reaching branches (holes 11, 12 and 22).

**Acceptance Criteria:**

**Given** a project's tracked `.tk-studio/config.yaml` with `verify.host: <command>` (tk-studio: the lib suite and conformance; the supervisor: `bun test`; the-universe-awaits: its verify script)
**When** an sbx-tier run's engine completes
**Then** the supervisor runs that command on the host tier in the worktree, console-hosted, under the same guards as a host-tier worker, and records its exit, duration and the last lines of output on a `host-verify` event; the command comes from the project's config, never from the plugin (AD-2)

**Given** a red host verify
**When** the PR would open
**Then** the run ends `partial` naming the failing command, the branch is still pushed, the PR opens as a draft whose body carries the host failures, and the notification names them

**Given** a project with no `verify.host`
**When** a run ends
**Then** the PR opens as before and the event says the leg was skipped with the reason

**Given** the supervisor's test suite and the runbook
**When** the story closes
**Then** green, red and absent commands are pinned on both hosts, and runbook §3.8 retires the "attended host run before each PR" rule in favour of this leg

### Story 27.5: The Plan Follows the Run, and the Deferred Work Is Paid

As the operator,
I want the canonical plan to reflect a run's landing, and the supervisor's own deferred work closed,
So that the plan index stops under-reporting what is built (hole 18) and the queue is honest about cost, cancels, time and certificates (DW-11, DW-12, DW-13, DW-15, DW-19, DW-21, DW-23).

**Acceptance Criteria:**

**Given** a run that opens a PR
**When** the `ended` event is written
**Then** the supervisor calls the planning adapter's status verb (Story 26.5) on the project that owns the plan (the registry names it; a transcribed epic names its owner) for every story the run's spec marked done, setting `review`; the next tick that sees the PR merged sets `done`; both are recorded on the run's events, and a refused call never changes the run's state

**Given** a run resumed after a restart
**When** it finishes
**Then** `run.json`'s `total_cost_usd` is the sum across every iteration (per-iteration cost recorded as `accounted` events; DW-15)

**Given** a cancel racing a claim or a late studio-run record
**When** both happen
**Then** the cancel ends the studio run it finds on a re-read inside the end transaction, or the next recovery ends it, and no run is left unended (DW-12, DW-13); an ended run that keeps its lock counts as live for the pacer (DW-11)

**Given** the worker record on win32
**When** it is written
**Then** the pid lands before the start time, and the start time is read natively (`GetProcessTimes` through `bun:ffi` or an equivalent that takes under 50 ms), so a supervisor killed inside the window still leaves a usable record (DW-19)

**Given** the TLS certificate and a refused `finish`
**When** the certificate is within 14 days of expiry, or a skill run finished itself
**Then** the keeper renews the certificate and restarts `serve` once, outside a live run, with an event (DW-21); and a refused `finish` on an already-terminal studio run leaves the run's reason as the worker's own status-block reason, never the refusal text (DW-23)

**Given** the supervisor's test suite
**When** the story closes
**Then** every case above is pinned on both hosts, the deferred-work entries are closed with their evidence, and the runbook §4 names the new events and the certificate rule

## Epic 28: The Supervisor Moves In: One Repository

Pulled forward by Tim on 2026-10-16 from the end of the build order (design spec D3 as amended): after Epic 27 every later epic touches the supervisor, and the two-repository tax (a read-only mount of tk-studio in the supervisor's sandbox, a hand-over file for the tk-studio side, a second copy of the studio pipeline plugin with `$TK_STUDIO_ROOT` paths, three PRs per epic, an installer roster with two sources) is paid once per epic until the move. AD-21 names the layout: `apps/supervisor` is a nested studio project that keeps its own `_bmad/`, `_bmad-output/` (Epics 21 to 23 and 27 keep their numbers), `.tk-studio/config.yaml`, `.bmad-loop/` and `.claude/settings.json`; the plugin stays sealed in `plugins/tk-studio`; `apps/studio-web` is born in place with EP-30 and is not part of this epic. The motion is ADR §5: rehearse on throwaway clones until every check passes, then once for real, through protected `main`; the old repository is archived, never deleted, and its PR discussions stay there. Built by the loop in `claude-tk-studio` in two launches: Stories 28.1 and 28.2 before the merge (they change only tk-studio), then the attended merge PR (ADR §5 steps 1 to 3 and 7, replayed from the passed rehearsal by the operator on the host), then Stories 28.3 and 28.4 on the merged tree. Operator steps: Tim stops the supervisor tab and freezes the old repository (no run in flight, every PR merged on both), edits the Startup shortcut target after the merge, and archives the old repository; the attended session recreates the sandboxes and runs the Windows-only checks. Requirements trace: D1 (O2, AD-21), D3 as amended 2026-10-16, ADR §5 and §6; hole 16 (worktrees, landed in Story 27.1) was the precondition the ADR named for one sandbox serving both loops. Repo: tk-studio (every story); one commit on the old repository's README before it is archived.

### Story 28.1: The Rehearsal Is a Script With a Report

As the operator,
I want the migration rehearsed by a script on throwaway clones that ends in a report,
So that the real cut-over is a replay of a passed rehearsal and never an improvisation.

**Acceptance Criteria:**

**Given** a fresh `git clone --no-local` of the supervisor repository and a fresh clone of tk-studio, both in a scratch folder the script creates
**When** `tools/restructure/rehearse.py` runs (stdlib Python; `git` and `uvx git-filter-repo` through subprocess argv, never a shell)
**Then** it rewrites the supervisor clone's history under `apps/supervisor/` with `git filter-repo --to-subdirectory-filter apps/supervisor`, asserts there are no tags and no signed commits to lose and no `node_modules` path anywhere in the rewritten history, fetches the rewrite into the tk-studio clone on branch `restructure/supervisor-into-monorepo`, merges it with `--allow-unrelated-histories`, and asserts the merge produced no conflict (every path is new)

**Given** the merged clone
**When** the checks run
**Then** the report records each with its exit code, duration and last output lines: `tk activate` clean from the nested root `apps/supervisor` (the plugin's own entry point); `bmad-loop` finds its run workspace from the nested root; the supervisor's `bun test` passes from `apps/supervisor`; tk-studio's `tools/verify_host.py` passes from the repository root; the four loop hooks of `apps/supervisor/.claude/settings.json` fire with `$CLAUDE_PROJECT_DIR` equal to the nested root; the size of the clone after the merge (the design spec's open question)

**Given** a check the script's host cannot run (a Windows-only check inside the Linux engine; a Claude session's hook firing where no session can start)
**When** the report is written
**Then** the check is listed under `unverifiable-here` with the exact command for the agent PC, never as a pass, and the script's exit status does not count it as failed

**Given** the report `_bmad-output/implementation-artifacts/restructure-rehearsal-<date>.md`
**When** the script ends
**Then** it follows the order of ADR §5 steps 1 to 5, ends with a one-line verdict (`rehearsal passed` or the first failed step), the script exits non-zero when any step or check failed, it never touches `C:\GitHub\tk-studio`, the live supervisor checkout or any remote, and the lib suite pins it against a fake pair of small repositories (a fake `git-filter-repo` only where the real one is unavailable)

### Story 28.2: A Nested Studio Project Is a First-Class Root

As a developer,
I want the plugin to resolve a project root nested inside another studio project,
So that `apps/supervisor` keeps its own config, base, planning artifacts, engine workspace and hooks after the move, as AD-21 says.

**Acceptance Criteria:**

**Given** a working directory inside `apps/supervisor`
**When** any surface resolves the project root (activation and the drift check, `config.py resolve`, `plansync`, `jobrun`, `meter`, `observe`, the registry, the launch skill)
**Then** the nearest ancestor holding `.tk-studio/config.yaml` wins (the nested root), never the outer one; `TK_STUDIO_ROOT` keeps meaning the outer repository root, the plugin's home; activation reports both and names the project nested

**Given** the supervisor's tracked `.tk-studio/config.yaml` carrying `project_id: supervisor`
**When** the registry entry's `root` is amended to the nested root (`registry.py amend`)
**Then** `registry.py show`, activation and the launch skill agree on the root; the store paths stay per project (`~/.tk-studio/projects/supervisor/`), the nested project's plan counter and `plansync` never mint into the outer project's counter, and nothing of the outer project's store is read or written from the nested root

**Given** `apps/supervisor/.claude/settings.json` and `apps/supervisor/.bmad-loop/plugins/studio-pipeline/`
**When** a Claude session or the engine starts in the nested root
**Then** `$CLAUDE_PROJECT_DIR` is the nested root, the hooks resolve their scripts relative to it, and the pipeline plugin copy names the spine and the driver contract by a path relative to the nested root (`../../_bmad-output/...`, `../../plugins/tk-studio/contracts/...`) so `$TK_STUDIO_ROOT` is no longer required inside the microVM; the two copies of `task-planning.md`, `consult.md`, `gate.md` and `reconcile.md` differ only in those paths and the project's name, and a lib test pins that

**Given** the lib suite and conformance
**When** they run
**Then** nested-root resolution is pinned for every surface above with a fixture holding an outer and a nested project, the drift check reports a nested root distinctly, and the driver contract states the nearest-root rule in a minor bump

### Story 28.3: The Merged Tree Builds, Releases and Launches From One Root

As the operator,
I want the merged repository to release the supervisor, run both loops and pass both gates from one checkout,
So that nothing points at the old repository.

**Acceptance Criteria:**

**Given** the merge landed on `main` through the attended PR
**When** the fix-ups are applied
**Then** the root `.gitignore` carries the supervisor's ignore entries under `apps/supervisor/`; `README.md`, the runbook §3.8 and §4 and the offline-install runbook point at `apps/supervisor`; `tools/release_archive.py --app supervisor` reads `apps/supervisor` in this repository (the second prefix, ADR §6) and both rosters' supervisor entries drop their foreign `source`; `tk-studio update` on each channel still resolves every component against the rosters' digests

**Given** the engine sandboxes
**When** `claude-tk-studio` is recreated with one read-write mount of `C:\GitHub\tk-studio` and the read-only skills store
**Then** `launch-epic.sh` and `resume-run.sh` take `ROOT=/c/GitHub/tk-studio/apps/supervisor` for a supervisor epic and the repository root for a plugin epic; the `tk-studio:ro` second mount is gone from the runbook and the provisioning (`WITH_BUN=1` provisions bun for the nested project); `check-skills-mount.sh` holds; `claude-tk-studio-supervisor` is retired from the runbook; the two loops serialise on the checkout lock

**Given** the supervisor's own `.tk-studio/config.yaml` (`verify.host: bun test`) and its transcribed plan
**When** a supervisor run goes through the supervisor itself
**Then** the project served is the nested root and its `verify.host` is the one read at the run's base; `apps/supervisor/_bmad-output/planning-artifacts/epics.md` stays the nested project's transcription (Epics 21 to 23 and 27 keep their numbers) and the repository root's plan stays canonical; the supervisor's `TK_STUDIO_ROOT` is still the outer root

**Given** the host gates
**When** this story's work is verified
**Then** `tools/verify_host.py` from the root and `bun test` from `apps/supervisor` are green on both hosts (the Windows run attended), and the old repository's README (one commit there, before archiving) points at `tk-studio/apps/supervisor`

### Story 28.4: The Cut-Over on the Box Is Checked and Recorded

As the operator,
I want the service cut-over checked by the tooling and the record complete,
So that the old repository can be archived with nothing left pointing at it.

**Acceptance Criteria:**

**Given** the Startup shortcut retargeted to `C:\GitHub\tk-studio\apps\supervisor\start.ps1` by Tim and `bun install --frozen-lockfile` run in `apps/supervisor`
**When** `tk-studio doctor` runs on the agent PC
**Then** it reports the supervisor's root as the nested root, the registry root in agreement, folder trust for the nested root (trust has no inheritance; runbook §4.1), and the Startup shortcut's target (read from the `.lnk`), each `ok` or named; the checks are pinned with fakes in the lib suite and run for real on the box by the attended session

**Given** the supervisor started from the console from its new root
**When** the smoke test runs (`curl /status` from another device; one queued job to a guarded end)
**Then** both pass and the results are recorded in the PR; `TK_STUDIO_ROOT`, `TK_SUPERVISOR_*` and `set-supervisor-env.ps1` are unchanged

**Given** the record
**When** the story closes
**Then** runbook §3.8 and §4 describe the one-repository layout and sandbox; the handoff names the cut-over date and the archive; the spine's AD-21 carries a "done" note with the date; the observation ledger has every hole found during rehearsal; and `thkennedy/tk-studio-supervisor` is archived by Tim (`gh repo archive`), never deleted
