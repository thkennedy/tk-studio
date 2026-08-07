# tk-council -- Concept Seed (2026-07-25)

- **Status:** Concept capture. Input for `bmad-product-brief` (run in a fresh
  session). Not a design; decisions marked OPEN are deliberately unresolved.
- **Supersedes** the tk-council packaging debate scoped in
  `eval-tk-council-packaging-2026-07-25.md` section 4 -- Tim's 2026-07-25 direction
  answers its core question (see "Settled" below). That eval's inventory and debts
  sections still stand for the tk-council repo itself.
- **Relationship to tk-council:** tk-council is NOT an import or restructuring of
  tk-council. It is a new, generalized, personal system that harvests tk-council's
  proven concepts. Long-term, tk-council can be re-based as a thin game-company
  overlay ON tk-council (personas, Perforce stream skills, UE canonical content are
  exactly the layer that does not belong in the generic version).

---

## 1. Vision

A generalized council layer that builds on top of PURE BMad and lets any user (or
team) fold it into their workflow: one orchestrated entry point coordinating agents,
skills, and workflows; team-consistent BMad versioning; a principled split of data by
category and location; and per-project detection and recommendation of the right
resource set -- including resources the user authors themselves.

## 2. The three pillars (Tim, 2026-07-25)

### P1. Shared BMad base, lockstep via git

BMad expects per-project installs; that drifts in a multi-person workforce. tk-council
keeps everyone on the same BMad version as a shared base, with updates pushed in
lockstep via git to the entire team.

Consequence: per-dev unmanaged `bmad install` is RULED OUT as the team model. OPEN:
the lockstep mechanism --

| Mechanism | How lockstep works | Pros | Cons |
|---|---|---|---|
| M1 Vendor-in-git | BMad copied into the shared repo by a deterministic vendor tool; team pulls | Proven by tk-council G2 (vendor_bmad.py: rules-not-patches, 8-check verify) | You own upstream patches (the plugin-hosting resolver fork); bundle bloat; re-vendor per release |
| M2 Lockfile + installer wrapper | Committed lockfile pins BMad version + module set; `tk install` runs the upstream installer at the pin and layers council content; bump lockfile -> everyone re-runs | PURE BMad, zero forks (closest to the stated vision); the package-manager model everyone already understands; upstream owns resolution | Requires the wrapper to be excellent (idempotent, drift-detecting, cross-platform); per-project install step still exists, just managed |
| M3 Plugin marketplace | Council (and optionally BMad) delivered as a Claude Code plugin from a git marketplace; update = git pull + version bump | Machine-wide single install; clean update UX; tk-proven | If BMad rides inside: inherits M1's fork. If council-only: must pair with M1 or M2 for the BMad base anyway |

Note M3 composes with M2: council-as-plugin for the orchestration layer +
lockfile-wrapper for the BMad base may be the "builds on top of pure bmad" sweet
spot. A drift check on activation ("installed BMad != lockfile pin -> prompt") gives
the lockstep guarantee teeth.

### P2. Data taxonomy: category decides location, location decides VCS

| Category | What it is | Scope | VCS? | Location | tk-council precedent |
|---|---|---|---|---|---|
| Working data | Agent working state, session logs, scratch, per-user memory/identity | Per-user, per-machine | NO | Per-user store, e.g. `~/.tk-council/` (OS-resolved) | Three-tier T1/T2 design (gate-cleared, never implemented; code stranded on an unmerged branch) |
| Project knowledge base | Curated knowledge agents use to understand the project without re-researching: architecture, conventions, decisions, investigations | Per-project, team-shared | YES (project repo) | `{project-root}/docs/` or `kb/` by functional area | T3a + the canonical garden scheme (conventions/decisions/systems/investigations) + promotion gating |
| Council data | The skills, agents, workflows, orchestrator, profiles -- everything layered on core BMad | Cross-project, team-shared | YES (tk-council repo) | The tk-council git repo, delivered by the P1 mechanism | The plugin's tk-* content |
| Planning data | Epics, stories, tasks, sprint state, planning docs | Per-project, team-shared | External tool (Jira/Confluence/Linear/ado/...); FALLBACK: committed to project VCS | Wherever the project's binding says -- consistent per project | NONE. Genuinely new subsystem. |

Planning-data adapter requirements (new subsystem #1):
- A per-project BINDING in tracked config: which backend, which project/space ids.
  One binding per project; every skill that reads/writes planning artifacts goes
  through the adapter, never directly to files or APIs.
- The in-repo VCS fallback is a first-class backend, not a degraded mode (BMad's
  native file outputs become "the fallback adapter").
- MIGRATION is a designed operation: switching backends mid-project (e.g. files ->
  Jira, or Jira -> Linear) is an export/transform/import flow with a verification
  pass, not a manual copy. Adapter contract must therefore define a canonical
  interchange shape for epic/story/task.
- BMad skills (create-epics-and-stories, sprint-planning, sprint-status, dev-story,
  create-story...) read/write through the adapter. OPEN: wrap them (name-based
  handoff with pre/post sync) vs. customize them (customize.toml overrides) vs.
  sync layer (backend <-> fallback files bidirectionally, skills stay untouched).
  The sync-layer option keeps BMad purest.

### P3. Per-project resource detection and recommendation

Generalization of tk-council's domain-profile registry from "fixed roster keyed by
domain id" to an inventory + recommendation engine (new subsystem #2):

- **Inventory:** what is available -- installed BMad modules (bmm, gds, cis, tea,
  wds, ...), marketplace/known modules NOT installed, and user-authored custom
  skills/agents/workflows (case-by-case creation is a supported first-class path,
  via bmad-module-builder / workflow-builder / agent-builder).
- **Detect:** project type + technologies for brownfield (tk-council detect-domain.py is
  the proven pattern: weighted markers, confidence floor + margin, read-only,
  never silently guess; extend markers beyond domain to tech-stack facets).
- **Recommend:** propose the working set (agents, skills, workflows, modules to
  install) with evidence; explicit user confirm; record the accepted set in
  project config so activation is deterministic afterward.
- **Evolve:** suggest NEW resources over time based on how things go -- inputs:
  retrospectives, repeated manual work the council observed, gaps hit during
  sprints. Output: "you keep doing X by hand; want me to draft a skill for it?"
  (This is the Dream-prescription pattern applied to council capability gaps.)

## 3. Settled vs open

Settled (by Tim's 2026-07-25 direction):
- S1. tk-council is new and generalized; game-company specialization stays out.
- S2. Team BMad base is shared and lockstep via git; unmanaged per-dev installs out.
- S3. Base is PURE BMad -- upstream forks minimized or zero (pushes toward M2).
- S4. Data splits by the P2 categories; category -> location -> VCS status.
- S5. Planning data lives in the team's tool of choice with in-repo fallback;
  per-project consistency; migration must be cheap.
- S6. Users can author custom resources; the council inventories and recommends.

Open (for the brief/debate):
- O1. Lockstep mechanism: M1 / M2 / M3 / M2+M3 composite. (The real debate now.)
- O2. Planning adapter integration style: wrap vs customize vs sync layer.
- O3. Initial backend set beyond the VCS fallback (Jira+Confluence first?).
- O4. Cross-project shared knowledge (tk-council "canonical"/T3b, Reina-style promotion
  gate): in scope for v1, or per-project KB only?
- O5. Orchestrator persona model: keep the rebirth/sanctum identity system
  (heavyweight, distinctive) or a leaner stateless orchestrator for the generic
  version?
- O6. Delivery surface for the council layer itself: plugin vs BMad external
  module(s) vs both (skills already speak customize.toml + help-CSV conventions).
- O7. Name: "tk-council" (working title) -- confirm or rename before repos exist.

## 4. Harvest map from tk-council

PORT (concept proven, generalize):
- Domain-profile registry -> resource inventory/recommendation engine (P3); keep
  data-only JSON profiles, read-only detector, dry-run onboarding, explicit confirm.
- Three-tier memory contract + per-user store design (target-state-architecture.md
  sections 3-6; lib/tk_store.py on the unmerged branch) -> P2 working data +
  project KB. The migration-safety rules (closed inventory, no-delete-before-
  clearance, copy-verify-flag cutover) port verbatim.
- Vendor tooling discipline (deterministic rules, verify phase, sentinel-anchored
  patches, timestamp-free manifests) -> whichever P1 mechanism wins, even M2's
  wrapper wants the verify/drift-check half.
- Thin agents/ wrapper pattern (subagent -> Skill delegation) if plugin delivery.
- Governance: promotion membrane, gate reviews, issue ledger -- adapt to solo/team.

ADAPT: orchestrator (Alya) routing/synthesis/convene capabilities -- minus
game-company personas; external-roster handoff (name-based coupling to stock BMad
skills) becomes the DEFAULT coupling model everywhere.

LEAVE (tk-specific): the 11 personas and their lore; Perforce stream skills
(tk-stream-*); changelog/newsletter skills; UE/Jenkins specialist content;
canonical/ue garden. These become the future tk-council overlay on tk-council.

## 5. Proposed process

1. `bmad-product-brief` (fresh session) -- seed: THIS DOC. Output: tk-council brief
   with O1-O7 as the decision list.
2. `bmad-forge-idea` or party-mode debate on O1 (the lockstep mechanism) -- the one
   genuinely contested architecture decision. Measure M1's real per-release cost
   (the tk-council 6.9->6.10 vendor run) vs an M2 prototype.
3. `bmad-architecture` -- target state: repo layout, config schema, adapter
   contract, store paths.
4. `bmad-module-builder` / epics-and-stories -> Mission Control, greenfield repo.
