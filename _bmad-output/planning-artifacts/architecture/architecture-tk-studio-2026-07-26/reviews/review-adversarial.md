---
review-type: adversarial-architecture-spine
target: ../ARCHITECTURE-SPINE.md
reviewer-lens: "Construct units one level down that each obey every AD to the letter yet build incompatibly"
date: '2026-07-26'
verdict: "Spine is strong on ports/placement but has one critical unowned seam (stock-BMad artifacts vs. the canonical shape) and four load-bearing dual-ownership holes; each is closable with one new or tightened AD."
---

# Adversarial Spine Review — tk-studio

**Method.** For each finding I play two feature teams "one level down" — Lockstep tooling, planning adapter + migration, Recommendation (detect/onboard), Operations (jobs/loops/driver contract), Measurement, and orchestrator + roles. Each team obeys every AD as written. I then show a concrete build that ships incompatibly: clashing shared-data shapes, two owners of one entity or file, or conflicting mutation paths. Findings are ordered by severity; each ends with the AD to add or tighten.

---

## F1 — CRITICAL — Planning adapter × Lockstep/BMad base: nobody owns making stock artifacts *actually* canonical

**Units:** planning adapter team ↔ Lockstep team (as custodian of the untouched BMad base), with the Taxonomy structural seed as the battlefield.

**What each team builds, AD-compliant:**

- The Lockstep team, per AD-1 ("The BMad base is never vendored or forked") and AD-4 ("Stock BMad planning skills stay untouched and read/write their native artifacts"), ships pure BMad 6.10.0 at the pin. Stock BMad writes what stock BMad writes: its own story-file frontmatter, its own per-epic numbering (story `2.3`, not `ST-NNN`), its own status vocabulary (which is not the closed enum `draft|ready|in-progress|blocked|review|done|dropped`), under `_bmad-output/`.
- The adapter team, per AD-4 ("those artifacts, carrying the canonical frontmatter shape (AD-6), ARE the canonical local representation") and AD-6, builds `tk-studio-plan-sync` to read files that have `id: ST-NNN`, `shape_version: 1`, `type`, the closed status enum, and `external.<binding>` maps.

**The collision.** AD-4's parenthetical *asserts* that stock artifacts carry the AD-6 shape, but AD-1 forbids the only team that could make that true (by modifying BMad templates/skills) from doing so, and no AD assigns a normalization component. Both teams ship green: BMad emits BMad-shaped files; plan-sync parses AD-6-shaped files; on first sync against a real project, plan-sync finds zero canonical entities (or, worse, half-parses BMad frontmatter and promotes garbage to Jira). Sub-collisions inside the same hole:

1. **ID allocation has no authority.** AD-6 demands stable, never-reused `EP-/ST-/TA-NNN`. Who allocates NNN, and where does the counter live? Candidates that different teams will legitimately pick: BMad's planning flow (can't — untouched), `tk-studio-migrate` on import (assigns ST-001..ST-050 from Jira), `tk-studio-plan-sync` on first promote (assigns ST-001 to a new local story), Backlog.md's CLI (allocates `task-NNN` in its own sequence). Two allocators running in one project — migrate importing while a BMad sprint-planning session creates stories — mint the same id or fork numbering. "Stable, never reused" is unenforceable without a named allocator and a named counter location (which is itself an AD-3 classification question: working data? planning data?).
2. **Two simultaneous "canonical local representations."** The structural seed gives an onboarded project both `_bmad-output/` ("BMad planning/implementation artifacts (canonical local planning rep)") and `backlog/` ("planning data when binding = backlog-md"). AD-3 says planning data lives "wherever the project's planning binding says." When binding = backlog-md (the default!), a story exists twice: as a BMad story file in `_bmad-output/` and as a Backlog.md task in `backlog/`. Which does plan-sync promote? Which does the vault `backlog` junction point at? Who syncs the two — nobody, because AD-4 only covers local↔external, not local↔local. Two teams each pick one folder as truth and both cite the spine.
3. **BMad status vocabulary ↔ closed enum.** AD-6's mapping rule ("adapters map the enum onto backend states") covers *external backends*. Stock BMad's own status values are not covered by any mapping rule because BMad is not modeled as a backend — it's asserted to already be canonical.

**Why this is the top finding.** The brief calls the planning adapter "honestly new and therefore the highest-risk subsystem," and this seam is its foundation. Every other planning AD (AD-5, AD-7, AD-16) builds on entities that, as specified, will not exist.

**Close with:** a new AD naming the **canonicalization owner**: either (a) declare BMad's native artifact set a *backend* like any other, reached through a `bmad-files` adapter that maintains the canonical files as a separate, adapter-owned projection (and then say which folder is authoritative per binding, and that exactly one local representation is canonical per project); or (b) declare canonical files are authored only via studio flows and BMad output is *imported* (a designed AD-16-style operation) into canonical shape. Same AD must name the single id-allocation authority and the counter's location and category.

---

## F2 — HIGH — Planning adapter × BMad implementation flows: `status` has two owners and the round trip is lossy

**Units:** planning adapter team ↔ whoever moves stories through implementation (stock BMad dev flows sequenced by the orchestrator team).

**What each team builds, AD-compliant:**

- The BMad/orchestrator side legitimately mutates `status` locally: a dev flow marks ST-014 `done` when the story completes. Nothing forbids this — AD-4 explicitly blesses stock skills writing their native artifacts, and status is part of the entity.
- The adapter team implements AD-5 to the letter: "status observed externally wins locally." Pull-back reads Jira/Backlog.md and overwrites local `status`.

**Collision A — two writers, one field, external always wins.** Story ST-014 is marked `done` locally at 14:00; the last promote pushed it as `in-progress` at 13:00; the 14:05 scheduled pull-back (an Operations job, fully AD-10/AD-11 compliant) observes `in-progress` in Jira and — obeying AD-5 exactly — reverts the local `done`. The local completion is silently destroyed by the very rule designed to prevent silent merges. AD-5's precedence has no tiebreak for *status authored locally after the last promote* vs. *status observed externally*, and no notion of "the external value is just our own last echo."

**Collision B — enum-degrading echo.** Backlog.md has roughly three states. Promote maps `review` → `In Progress` (nearest value, per AD-6's mapping rule — compliant). Pull-back maps `In Progress` → `in-progress` (compliant). Net effect of a promote+pull cycle *with zero human or external activity*: `review` → `in-progress`, `ready` → `draft`-or-`in-progress`, on every sync tick. Both mapping directions are individually correct; composed, they erode local state. The `external.<binding>.{synced_at, content_hash}` fields exist in AD-6 but no AD gives them semantics (echo suppression, dirty detection), so the adapter team is free to ship without them doing anything.

**Close with:** tighten AD-5: (1) pull-back applies an external status **only if it differs from the value this adapter last wrote for that binding** (echo suppression via `external.<binding>.status_at_sync` or content-hash); (2) when local status changed since last promote AND external status changed since last pull, that is a **conflict surfaced to a human**, same as content divergence — external does not auto-win; (3) mapping must be round-trip-stable for statuses the backend can't represent (a state that maps to a coarser backend state is never overwritten by the pull-back of its own coarse image).

---

## F3 — HIGH — Recommendation onboard × Lockstep activate × orchestrator: the project registry has no schema, no single writer, and no key authority

**Units:** Recommendation team (`tk-studio-onboard`), Lockstep team (`tk-studio-activate`), orchestrator team, Operations (headless jobs writing concurrently).

**What each team builds, AD-compliant:**

- AD-8 names `registry/projects.yaml` "the canonical path for 'status of all projects'." The structural seed places it. That is *everything* the spine says about it. No AD defines its schema, its writer, or its concurrency discipline (the atomic-write convention in AD-12 is scoped to measurement ledgers).
- Onboard (the natural registrar) writes `projects: [{key, root, planning: ..., vcs: ...}]` — a list, keyed by basename per the naming convention.
- Activate, to record drift/health "status of all projects," writes `projects: {<key>: {last_activated, drift: ...}}` — a map, and resolves the key via `project_id` when it detects a basename collision.
- The orchestrator reads it to resolve the project working set path; Operations jobs read it to resolve `~/.tk-studio/projects/<key>/runs/`; measurement events stamp `project?` with… whichever key their team resolved.

**The collision.** Three concrete breaks, all AD-legal: (1) **shape clash** — list vs. map vs. per-project files; the second team to write corrupts or forks the first team's data; (2) **split identity** — the naming convention says "project key = root basename, `project_id` overrides on collision," but no unit owns collision detection, so onboard registers `api` (basename) and activate later re-registers the same repo as `acme-api` (project_id): one project, two registry rows, two run-workspace trees, two values in measurement `project` fields, and the consolidation team cannot join them; (3) **concurrent writers** — an attended session and a scheduled headless job both update the registry; YAML read-modify-write with no locking rule loses one write.

**Close with:** a new AD: the registry is a **contract schema shipped in `contracts/`** (like the status block and job model); exactly one skill (name it — onboard, or a dedicated `tk-studio-register` library) may write it; all other units read-only; key resolution (`project_id` precedence, collision detection at registration time) is defined there; writes are atomic whole-file replaces, and every other subsystem's `<project-key>` (run workspaces, measurement `project`, vault folder name) is defined as *the registry key*, resolved once.

---

## F4 — MEDIUM-HIGH — Recommendation × orchestrator, multi-user: role×project working sets don't fit "recorded in project config"

**Units:** Recommendation team (records recommendations) ↔ orchestrator team (consumes working sets), with two real users per the brief (direction-giver + developer on one repo — the stated v1 test bed).

**What each team builds, AD-compliant:**

- AD-17: recommendations are "two-dimensional (role × project) … recorded in project config only after explicit confirmation." The structural seed shows tracked project config containing `working_set`. The Recommendation team therefore writes the confirmed working set to `{project-root}/.tk-studio/config.yaml` (tracked — it's team-shared project data per AD-3; `config.local.yaml` is for *per-dev overrides*, and a confirmed recommendation is not an override).
- The orchestrator team, per AD-9, resolves role from the user store, then reads `working_set` from project config.

**The collision.** Two AD-faithful shapes exist and they interlock wrongly either way:

- If Recommendation writes a flat `working_set: [...]` (what the seed's comment implies), then when Tim (direction-giver) onboards the repo and his developer teammate later runs detection, the developer's confirmation **overwrites the direction-giver's tracked working set** — one-dimensional storage for a two-dimensional value. Each commit of `.tk-studio/config.yaml` flips the repo between roles. AD-17's own "Prevents" line — "one-size working sets; role data leaking onto shared VCS" — is violated by a build that follows AD-17's own storage instruction.
- If Recommendation writes `working_set: {developer: [...], direction-giver: [...]}` (role-keyed map), the orchestrator team that read the seed's flat shape fails to resolve, and role-affiliated data now lives on shared VCS, which AD-17 says it prevents.

There is no AD arbitrating which shape is canonical or which config scope holds the role dimension.

**Close with:** tighten AD-17 + the structural seed: project config's tracked `working_set` is **role-keyed by definition** (`working_set: {<role>: [...]}`, with an optional `_default`), schema shipped in `contracts/`; confirmation writes only the confirming user's role key; the orchestrator resolves `working_set[role] ?? working_set._default`. (Alternative: store per-role working sets in the per-user store keyed by project — but then pick one and say it; the current text supports both.)

---

## F5 — MEDIUM — Operations × Measurement: event emission has two plausible owners and no payload contract

**Units:** Operations team (job runner, headless wrappers) ↔ Measurement team (ledger schema, consolidation).

**What each team builds, AD-compliant:**

- AD-12 lists event types including `headless-failure` and fixes the JSONL envelope (`{ts, event, user, machine, project?, payload}`) but not who emits which event or any `payload` shape. AD-11 makes every skill end headless runs with a status block but says nothing about measurement emission.
- The skill teams (activate, plan-sync, …) each emit their own failure events at point of failure — reasonable reading of "instrument, don't predict."
- The Operations team's job wrapper *also* emits `headless-failure` whenever a job's status block is `blocked`/`partial` — equally reasonable: it's the unit that observes headless outcomes.

**The collision.** One failed headless activation produces two ledger lines (skill's `activation-failure` + wrapper's `headless-failure`) with independently invented payloads; the consolidation team, building `issues/ledger.md` entries from PR'd ledgers, double-counts defects or cannot correlate the pair. Conversely, a skill team that assumes the wrapper instruments emits nothing, and a whole failure class goes dark. Secondary ambiguity: is AD-12's event list closed? Operations wants `job-run`/`job-complete` events; if the list is closed they can't instrument jobs at all, if open the consolidation tooling can't rely on the vocabulary.

**Close with:** tighten AD-12/AD-11: per-event-type **payload schemas live in `contracts/`** next to the status schema; each event type names its single emitter (rule of thumb: the *outermost* observer emits — the job wrapper owns `headless-failure`, the skill owns domain events like `drift-detection`); the event vocabulary is open but additions require a schema in `contracts/`; a correlation id (run-id from the run workspace) is mandatory in the envelope so multi-emitter traces join.

---

## F6 — MEDIUM — Recommendation onboard × Lockstep activate: the vault junction pair (create vs. verify) has no shared target-resolution rule

**Units:** Recommendation team (creates junctions at onboarding) ↔ Lockstep team (verifies them at activation).

The conventions table says `<vault>/projects/<name>/` holds junctions `kb → {project-root}/kb/` and `backlog → planning folder`, "created at onboarding, verified at activation." "Planning folder" is unresolved (see F1.2: `backlog/` vs `_bmad-output/`), and unresolved *twice* when binding = jira (no local planning folder at all — junction to what?). The onboard team points `backlog` at `_bmad-output/`; the activate team verifies against `backlog/`; every activation on every machine reports a broken vault forever, and the fix-guidance loop (AD-13) tells the user to re-run onboarding, which recreates the same junction. Also `<name>` vs. the registry key (F3): if these differ, two vault folders appear for one project.

**Close with:** fold into F1/F3's fixes: the junction map is a function of the registry entry (key + planning binding), defined once in the registry contract; bindings with no local planning folder get no `backlog` junction, and activate verifies against the same function, not its own table.

---

## Minor observations (not spine holes, note for module design)

- **M1 — Headless identity for jobs.** AD-9 resolves role from the per-user store at run time; the AD-10 job definition has model/effort and budget but no role/user capture. A job submitted by a direction-giver executes later under whatever the machine's user store then says — routing can differ between submission-time intent and execution-time resolution. Consider a `role` field (or explicit "jobs resolve role at execution time" statement) in the job model schema.
- **M2 — Driver-contract versioning discipline.** AD-11 makes the contract a versioned document, but per-skill invocation surfaces are owned by each skill team; nothing obliges a skill change to bump/regenerate the contract. A conformance check (contract ↔ shipped skills) in CI or in `tk-studio-activate`'s self-check would keep the deferred ClaudeOS connector startable "cold" as intended.
- **M3 — AD-16 blast radius.** "Any data relocation" literally covers `measure-push` (ledger → branch) and `base-update` (replacing `_bmad/`). Presumably the ceremony (closed inventory, clearance) is meant for planning/store migrations only; one clause scoping AD-16 to *authoritative-copy moves* (vs. additive copies and installer-managed trees) avoids teams either over-building ceremony or ignoring the AD as obviously-not-meant-literally.
- **M4 — `updated` timestamp owner.** AD-6 requires `updated` but with two writers of entity files (F1/F2) the field's meaning (content change? any sync touch?) affects `content_hash`/dirty detection. Define alongside the F2 echo-suppression semantics.

---

## Summary table

| # | Severity | Units in conflict | Hole | Close with |
|---|---|---|---|---|
| F1 | Critical | Planning adapter ↔ Lockstep/BMad base | Stock BMad artifacts asserted canonical but nobody may/must make them so; no id-allocation authority; `_bmad-output/` vs `backlog/` both "canonical" | New AD: canonicalization owner (bmad-files as a true adapter, or import-into-canonical), single id allocator + counter home, one canonical local rep per project |
| F2 | High | Planning adapter ↔ BMad dev flows/orchestrator | `status` dual-written; "external wins" clobbers local completions; promote+pull round trip degrades enum via coarse backends | Tighten AD-5: echo suppression, both-changed ⇒ human conflict, round-trip-stable mapping |
| F3 | High | Onboard ↔ Activate ↔ orchestrator ↔ Operations | `registry/projects.yaml`: canonical read path with no schema, no single writer, no key/collision authority, no concurrency rule | New AD: registry schema in `contracts/`, one writer, key resolution defined there, atomic writes |
| F4 | Medium-High | Recommendation ↔ orchestrator (multi-user) | role×project working set stored in a shape the spine leaves one-dimensional and tracked-shared | Tighten AD-17: role-keyed `working_set` schema in `contracts/`, per-role-key writes |
| F5 | Medium | Operations ↔ Measurement | Event emitter ownership ambiguous (double/zero emission); payload shapes and vocabulary openness undefined | Tighten AD-12: per-event schemas + named emitters in `contracts/`, run-id correlation |
| F6 | Medium | Onboard ↔ Activate | Vault junction created and verified by different units with no shared target-resolution rule | Junction map = function of registry entry, defined once |
