---
title: "Review — Input Reconciliation vs Architecture Spine"
review-type: input-reconciliation
target: ../ARCHITECTURE-SPINE.md
inputs:
  - ../../../briefs/brief-tk-studio-2026-07-25/brief.md
  - ../../../briefs/brief-tk-studio-2026-07-25/o1-decision-2026-07-26.md
  - ../../../briefs/brief-tk-studio-2026-07-25/addendum.md
date: 2026-07-26
verdict: STRONG WITH GAPS — one direct contradiction of the binding O1 ruling's framing, one dropped settled direction, three weakened requirements
---

# Input Reconciliation Review — tk-studio Architecture Spine

Method: each input read in full; every requirement, ruling, and constraint checked against the spine (ADs, conventions, stack, structural seed, capability map, deferred list). O2/O3/O4/O5/O8 are treated as decisions the spine was chartered to rule — only constraint/research fidelity is checked for those, not the ruling itself.

---

## Input 1 — brief.md

### Landed (brief)

- **Four named pillars** (Lockstep, Taxonomy, Recommendation, Operations) used throughout; no numbered pillar ids; "Perforce" always written in full.
- **Lockstep:** pin + drift check at activation with teeth (AD-1, AD-13); zero unmanaged installs; thin-pillar design honored structurally (lockfile + upstream installer, no fork).
- **Taxonomy:** all four categories with exact scope/VCS/location semantics (AD-3); halt-on-unclassifiable is a good hardening beyond the brief; per-project VCS binding with Perforce first-class (AD-18); studio repo stays git.
- **Planning:** local-first, Backlog.md default per-project binding, bmad-files fallback first-class, Jira first external target, per-project binding config, adapter-only access, designed migration with verification (AD-4/5/6/7/15/16). O2 ruling (file-plane sync) respects the research constraint (one-way promote + status pull-back; "true bidirectional sync barely exists in the wild").
- **Obsidian window:** vault path in user config; vault-is-a-view / registry-is-the-database adopted verbatim (AD-8, Vault window convention); Windows directory junctions.
- **Roles:** role-before-routing, role × project two-dimensional recommendation, evidence + explicit confirmation, v1 = direction-giver + developer, new roles as configuration (AD-17).
- **Layer stack / ClaudeOS separation:** depends-downward-only, driver contract as the sole upward surface, fully usable without ClaudeOS, connector deferred ClaudeOS-side (AD-2, AD-11, Deferred).
- **Operations:** dual-mode invariant with JSON status block and no-prompt/blocked-halt (AD-11); job-as-data hybrid (AD-10) matching the O8 framing and the job-definition placement question (generic types → plugin, instances → project config, run state → working data); model/effort conservative defaults with the exact precedence chain (AD-14); session discipline — boundary handoffs, resumable run workspaces (conventions).
- **Scope-out honored:** no dps personas/UE content, no bespoke runner, no cross-project KB (O4 out with seam reserved), connector out / contract in, distribution hardening deferred.
- **Success criteria 1–6, 8** each have a traceable home (AD-13/17, AD-1/13, AD-3, AD-4/16, AD-9 + Deferred overlay seam, AD-11, conventions).

### Did NOT land / landed weakened

1. **User-authored resources as a first-class path — DROPPED.** The brief lists it among Tim's 2026-07-25 settled strategic directions ("user-authored resources as a first-class path") and bakes it into the Recommendation pillar twice: the engine recommends "the right resource set — **including resources the user authors themselves**," and the inventory step explicitly enumerates "installed modules, known-but-uninstalled modules, **user-authored resources**." The spine never mentions user-authored resources anywhere — not in AD-17, not in the capability map, not in Deferred. A settled direction, not an open decision, and it is simply absent.
2. **Recommendation's inventory step unspecified.** The pillar is a four-verb loop — "**inventory** what exists (installed modules, known-but-uninstalled modules, user-authored resources); **detect**; **recommend**; **evolve**." The spine covers detect (read-only, no silent guessing), recommend (evidence, confirm, record), and evolve (observe-and-log), but the inventory verb — the catalog of what could be recommended — has no AD, no store location, no skill in the seed roster. Weakened.
3. **Required v1 job families not seeded.** Brief scope (In for v1): "a first scheduler cut — one-shot + recurring jobs covering **at least one research-job type and one maintenance-job type**." AD-10 says "generic job types ship with the plugin" but names none; the spine contains no mention of research jobs or maintenance jobs at all. This also leaves success criterion 7 ("a recurring scheduled research job runs end-to-end … and produces at least one Recommendation-pillar proposal the user accepts") with no specified pathway — the deferred item "Evolve-loop automation" is about proposals from observed toil, but the research-job → evolve-loop feed ("Research jobs are the formalized input engine for the Recommendation pillar's evolve loop — the Dream-prescription pattern generalized") landed nowhere.
4. **Dual-mode "preserve" leg implicit only.** The brief splits the invariant three ways in effect: preserve upstream `-H` contracts, extend to new surfaces, verify against the runner. AD-11 states the extend + status-contract halves explicitly; "never break upstream headless contracts when layering" is only derivable from AD-1/AD-4 (stock skills untouched), never stated. Minor.

### Contradictions

- None found against the brief proper. (The "evolve may land as observe-and-log first" scope line permits AD-8's v1 posture; deferring proposal drafting is allowed — but see weakened item 3 for the SC7 pathway gap.)

---

## Input 2 — o1-decision-2026-07-26.md (BINDING)

### Landed (brief)

- Composite mechanism exactly: studio as Claude Code plugin from git marketplace with `extraKnownMarketplaces` auto-prompt on folder trust; BMad base as thin lockfile pin running the **upstream installer at the pin**, zero forks (AD-1).
- Three-way front-door check, both planes cross-checked, cost "priced in" (AD-13), read-only and loud.
- Onboarding funnel as the first instrumented flow with the exact metrics (time-to-ready, failed steps, retries) (AD-13).
- Measurement subsystem first-class: full approved event taxonomy including the explicit human-authored `tk report` verb; per-user-per-machine append-only JSONL, atomic writes, never a shared file, sanitization at emission (AD-12).
- Reconciliation flow verbatim: measurement-push (branch → commit → PR), consolidation (PRs → issues → fix candidates), PR review as the promotion membrane riding plain git governance (AD-12, `measurements/`, `issues/ledger.md`).
- All four implied skills present in the seed roster (`measure-push`, `consolidate`, `base-update`, `activate`).
- "Instrument, don't predict" — the dropped pre-measurement experiment stays dropped; no speculative measurement appears anywhere in the spine.

### Did NOT land / contradictions

1. **CONTRADICTION — AD-1's "do not reopen" inverts the ruling's own framing.** The O1 ruling is explicit, twice: it is "blessed as the **working answer**" and "This is the working answer the experiment will correct — **not a final answer; the measurement loop exists to revise it**." Revisability-by-measurement is the ruling's governing reframe (its first section is titled "The reframe (governs everything below)"). AD-1 closes with "Ruled 2026-07-26; **do not reopen**" — foreclosing exactly the revision channel the ruling institutionalizes. The spine must honor O1 exactly; this clause contradicts its letter and its spirit. Fix: replace with something like "Ruled 2026-07-26; revisit only on evidence from the measurement loop (AD-12), not by relitigation."
2. **Base-update integration PR — DROPPED.** The ruling's base-update design: "bump the pin, run the upstream installer, **produce an integration PR for review**. This recovers M1's one genuine virtue (a reviewable upstream diff) without owning a fork." The spine names `tk-studio-base-update` (roster + capability map) and AD-1 covers running the installer at the pin, but the PR-for-review mechanic appears nowhere — AD-12's PR membrane covers only measurement ledgers. The reviewable-upstream-diff virtue the ruling deliberately recovered is lost as stated.
3. **Wrapper disposability tone softened.** "the wrapper stays thin and **disposable (v7 horizon)**" — the spine keeps the wrapper thin structurally but never records the disposability intent or the v7 horizon, which is the design pressure that keeps Lockstep thin against upstream collision (also a brief moat mitigation). Minor.
4. **Unblocker task (dps-council extraction) untracked.** "Unblocker task (**not optional**): Extract dps-council from `D:\ClaudeOS\dps-council.rar` into its own new private git repo … Frees the harvest." The spine adopts harvested patterns whose source this task frees (issue-ledger discipline in AD-12, migration safety in AD-16) but neither lists the extraction as a precondition nor mentions it in Deferred. Arguably backlog material rather than spine material — but the spine's Deferred list does carry comparable operational notes, and this one is flagged "not optional." Minor.

---

## Input 3 — addendum.md (A1–A8)

### Landed (brief)

- **A1:** M3 mechanics (marketplace.json catalog, version field as update gate, `extraKnownMarketplaces`/folder-trust auto-prompt, pull-based updates requiring the drift check) all present (AD-1, AD-13, structural seed lockstep comment).
- **A2 adapter requirements:** per-project binding in tracked config; fallback as first-class backend; migration as designed export/transform/import with verification; canonical interchange shape self-defined as frontmatter schema (research: no standard exists); Backlog.md epic gap bridged (canonical schema carries epic → milestone + label, AD-6); one-way promote + status pull-back (AD-5); atomic diff-friendly writes with concurrent Obsidian edits expected (conventions); Atlassian Cloud-only MCP fine for the team; beads deferred over binary storage with the exact revisit condition.
- **A6:** headless auth risk (silent-401, API-token requirement) landed twice (AD-7, AD-11); loop stop conditions/budget guards in the definition not the runner (AD-10); customize.toml as the home for model/effort defaults with the exact precedence (AD-14); handoff-at-boundaries + resumable run workspaces (conventions); harness-native primitives enumerated; session-scoped-schedule caveat honored with the cloud-routine/external-harness answer.
- **A7:** per-project VCS with Perforce task-stream ≙ git feature-branch expressed per-VCS (AD-18); P4IGNORE for the local overlay (AD-15); Recommendation suggests VCS tooling/MCP servers (AD-18); four-layer stack with depends-downward-only and the published driver contract (AD-2); dossier items 1–3 and 5 honored (connector ClaudeOS-side, contract contents match item 2's list exactly — invocation surface, status schema, job/scheduler verbs, model/effort override API, drift-check invocation; direct headless invocation until the connector exists).
- **A8:** the spine delivers precisely the step-3 charter (repo layout, config schema, adapter contract, store paths, driver contract, O2/O3/O4/O5/O8 rulings).

### Did NOT land / landed weakened

1. **A3/A6/A7 — Research→Knowledge Lifecycle PORT not landed.** A3 (PORT list, verified built): "Port as the Operations pillar's **session-discipline backbone**." A6 details the machinery (mission-start research spine, per-mini-goal seeds, anchored evidence-graded deltas → JSONL reconciliation queue → custodian promotion gate) and A7's dossier item 4 gives the architectural consequence: "generalizing it means **moving the runner-side halves council-side behind the driver contract**, with ClaudeOS as first driver." The spine's session discipline is generic (compact handoffs + resumable run workspaces); the promotion-gate pattern is reused only for measurements (AD-12) and reserved for v2 knowledge (AD-8). No research spine, no anchored deltas, no knowledge reconciliation queue, and the driver contract reserves no seam for the runner-side halves that are supposed to migrate council-side. This is the largest harvested-and-verified asset in the inputs and it landed as a shadow of itself. (Defensible as a v1 scope call — but then it belongs in Deferred with the seam named, as AD-8 does for the promotion gate; today it is silently absent.)
2. **A6 — model-routing mechanics notes partially dropped.** "the orchestrator wants a **routing table** mapping task class → model/effort" and "defaults should be **plan-headroom-aware** (flat-rate headroom changes the calculus vs PAYG)" — AD-14 has budget visibility but neither the routing table nor headroom awareness. Minor (mechanics notes, but explicitly addressed "for architecture").
3. **A6 — notification-driven wakeups weakened.** "Notification-driven wakeups (react when tracked work completes) **instead of blind polling**" is a defining feature of "formal" loops; AD-10 lists "self-paced wakeups" among substrate primitives and the driver contract has a `wake` verb, but the react-to-completion semantics and the anti-polling stance are not stated. Minor.
4. **A6 — job families** (maintenance: docs passes / architecture investigation / quality evaluation; research: trends / subject matter / tool discovery) — see brief finding 3; the addendum's concrete lists landed nowhere. Moderate (shared with brief scope requirement).
5. **A7 dossier item 6 — "the council does not grow a UI of its own; dashboards stay ClaudeOS"** — not restated in the spine. Nothing contradicts it (no UI is proposed), but as a standing constraint on future surfaces it would cost one line. Minor.
6. **A2 — vault link shape adapted, acceptably.** A2 recommends **one** junction per project (`<vault>/projects/<name>/` → the project's studio data root); the spine uses a real vault folder holding **per-category** junctions (kb, backlog). A justified adaptation — the spine's structural seed puts `kb/` and `backlog/` directly under project root, so a single junction would pull the whole repo into the vault — and A2 marked its shape "recommended," not ruled. Noted for the record, no action needed.

### Contradictions

- None. (The spine's O3 API-token mandate, ISS-008 citation, and Confluence-later stance are all consistent with A5/A6 research.)

---

## Internal ambiguity worth one clarifying line (not an input contradiction)

AD-4 declares stock BMad artifacts in `_bmad-output/` "ARE the canonical local representation," while the default binding is `backlog-md` with a separate `backlog/` folder (structural seed). When the binding is backlog-md, the relationship between the two local planes (does the adapter promote `_bmad-output` → `backlog/` like an external backend? are they the same files?) is unstated. Every input treats Backlog.md as the default backend and BMad files as the fallback backend, so the spine should say which plane is canonical under the default binding.

---

## Findings summary (severity-tiered)

| # | Severity | Finding | Input language | Spine locus |
|---|---|---|---|---|
| 1 | **High** | AD-1 "do not reopen" contradicts O1's binding framing: "not a final answer; the measurement loop exists to revise it" | o1-decision, Mechanism section | AD-1 |
| 2 | **High** | Settled direction dropped: "user-authored resources as a first-class path" / recommend "resources the user authors themselves" | brief exec summary, Why-now, Recommendation pillar | absent (AD-17 area) |
| 3 | **Medium** | v1-scope job families missing: "at least one research-job type and one maintenance-job type"; research jobs as "the formalized input engine for the … evolve loop" — SC7 pathway unspecified | brief Scope + Operations pillar; A6 job families | AD-10 |
| 4 | **Medium** | Base-update "integration PR for review … a reviewable upstream diff" dropped | o1-decision, BMad base updates | AD-1 / roster |
| 5 | **Medium** | Research→Knowledge Lifecycle PORT ("session-discipline backbone"; "moving the runner-side halves council-side behind the driver contract") reduced to generic handoffs; no Deferred entry, no contract seam | A3 PORT, A6, A7 dossier item 4 | conventions / AD-11 |
| 6 | Low | Recommendation inventory verb (installed / known-but-uninstalled / user-authored catalog) unspecified | brief Recommendation pillar | AD-17 |
| 7 | Low | Wrapper "disposable (v7 horizon)" intent unrecorded | o1-decision | AD-1 |
| 8 | Low | Routing table + plan-headroom-aware defaults not carried | A6 model routing | AD-14 |
| 9 | Low | Notification-driven wakeups vs blind polling not stated | A6 loops | AD-10 |
| 10 | Low | O1 "not optional" unblocker (dps-council extraction) untracked | o1-decision | Deferred |
| 11 | Low | "No studio UI; dashboards stay ClaudeOS" constraint not restated | A7 dossier item 6 | — |
| 12 | Low | Canonical-plane ambiguity under default backlog-md binding (internal, flagged for clarity) | — | AD-4 / seed |

**Verdict: STRONG WITH GAPS.** The spine is a faithful, often verbatim carrier of the inputs — every O-ruling respects its constraints and research findings, the measurement subsystem and taxonomy land exactly, and the ClaudeOS boundary is honored precisely. The five top findings are all fixable with targeted edits: reword AD-1's closure clause, add user-authored resources + inventory to AD-17, seed the two required job families in AD-10, add the base-update integration-PR mechanic, and either port or explicitly defer the Research→Knowledge Lifecycle with its contract seam.
