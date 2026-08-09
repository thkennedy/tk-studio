---
stepsCompleted: [1, 2, 3, 4]
status: complete
inputDocuments:
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/brief.md
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/addendum.md
  - _bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/o1-decision-2026-07-26.md
  - _bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/briefs/planning-pass-research-knowledge-port-2026-08-06.md
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
