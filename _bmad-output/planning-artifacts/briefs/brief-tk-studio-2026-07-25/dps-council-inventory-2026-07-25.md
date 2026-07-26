# dps-council Plugin Inventory + Anti-Drift Tooling Findings — 2026-07-25

Input to the tk-council/tk-studio product brief. Read-only investigation.

- **Source inspected:** `D:\ClaudeOS\dps-council.rar` (full extract of the marketplace
  repo at `main` @ `d26a67f`, incl. git-ignored trees), extracted for this pass to
  `...\scratchpad\dps-council\dps-council`. No live checkout exists on this machine —
  the real repo home is the Perforce working dir on the other machine
  (`C:\Users\kenne\Perforce\dps-council`, git origin `DirtyPearlStudios/claude-plugins`).
- **Companion doc:** `D:\ClaudeOS\_bmad-output\council\eval-dps-council-packaging-2026-07-25.md`
  (packaging evaluation; its inventory summary is consistent with what is on disk).
- All repo-relative paths below are relative to the repo root of the extract.

---

## 1. Repository inventory

Repo = the `dps-local` marketplace hosting one plugin, **dps-council v0.7.1**
(`plugins/dps-council/.claude-plugin/plugin.json`). Extract totals: 9,270 files
(~81 MB uncompressed) incl. `.git` (3,671) and the two 1.9k-file vendor-source trees.

### 1.1 Top-level areas

| Area | Files | What it is |
|---|---|---|
| `plugins/dps-council/` | 1,543 | The plugin itself (see 1.2) |
| `.agents/`, `.claude/` | 1,907 + 1,908 | Byte-identical raw BMad-installer output; vendor SOURCE consumed only by `tools/vendor_bmad.py --source`; git-ignored, ~42 MB |
| `canonical/` | 103 | Perforce-shared canonical knowledge base; gardens `be/ commons/ tools/ ue/ web/` — only `ue/` (heavy) and `commons/` (light) have real content; `tools/`, `web/` empty shelves |
| `shared-memory/` | 20 | Alya's (orchestrator) sanctum ONLY: BOND/CREED/PERSONA/MEMORY/CAPABILITIES/INDEX + 14 session logs 2026-06-17→2026-07-23. Known defect: T1 memory on shared VCS + leaked token suffix in `MEMORY.md` (eval D1/D2) |
| `_bmad/` | 91 | BMad install for working IN this repo (bmb/bmm/cis/gds/tea/wds modules, configs); `_bmad/memory/` is empty |
| `tools/` | 2 | `vendor_bmad.py` (the vendoring pipeline) + `upstream-patches/resolver-plugin-hosting.md` |
| `.mission/`, `.mission-stories/`, `.mission-reviews/` | 7 + 3 + 4 | Mission Control (ClaudeOS runner) artifacts: 2 missions' seeds + proofs, story files, gate findings + `verdict.json` |
| `docs/` | 1 | `target-state-architecture.md` (three-tier memory + bundled-BMad design, G1 output) |
| Root docs | 7 | `README.md`, `BUILD-CONTRACT.md`, `BUILD-REPORT.md`, `MIGRATION-RUNBOOK.md`, `MISSION-STATUS.md`, 2× `HANDOFF-manual-mission-dev-*.md` |

### 1.2 The plugin (`plugins/dps-council/`)

| Piece | Count | Notes |
|---|---|---|
| `skills/dps-*` | 17 dirs (189 files incl. `__pycache__`) | The council IP: 11 persona-agent + 6 workflow skills |
| `skills/bmad-*` | 71 dirs | Vendored BMad 6.10.0 skills (machine-rewritten by `vendor_bmad.py`) |
| `skills/gds-*` | 33 dirs | Vendored game-dev-studio module skills |
| `agents/` | 11 files | ~1 KB delegation wrappers per persona ("invoke Skill `dps-council:<name>` as your FIRST action" → rebirth ritual runs). Not `skills:` preloads, deliberately |
| `bmad/` | 38 files | Vendored BMad framework modules: `bmb bmm cis gds tea reference scripts _config` |
| `lib/` | 3 files | ONLY stale `__pycache__` bytecode (`dps_store.cpython-312.pyc`, tests). The per-user store SOURCE lives only on unmerged branch `feat/mission-single-bmad-instal-stand-up-per-user-council-store-generali` — stranded |
| `agents-README.md`, `skills/README.md` | 2 | skills/README stale by 1 agent + 6 workflow skills (eval D4) |

### 1.3 The 11 personas (persona-agent skills)

| Skill | Persona | Role |
|---|---|---|
| `dps-agent-orchestrator` | **Alya** | Front door; data-driven routing from `domain-profiles/<council_domain>.json`; convene/synthesize/curate; domain onboarding |
| `dps-agent-task-planner` | **Yui** | Ticket → fully-scoped AC, story breakdown, tech specs (references: scope-ticket, break-down, draft-ac, tech-spec, prior-art) |
| `dps-agent-custodian` | **Reina** | Memory custodian; SOLE writer to canonical KB; promotion gate; drift observation (scripts: integrity-check, build-canonical-index, scan-ascii) |
| `dps-agent-tech-writer` | **Sora** | Docs: module READMEs, guide distillation, API docs, PR descriptions |
| `dps-agent-game-dev` | Raven | UE5 C++/BP gameplay, VR |
| `dps-agent-backend-dev` | Hina | Go modules for Kraken backend |
| `dps-agent-be-code-reviewer` | Rei | Backend review, rubric-driven |
| `dps-agent-ue-code-reviewer` | Kai | UE/Perforce CL review via sub-agent |
| `dps-agent-ops` | Mei | Edgegap/Nakama ops, audit-logged |
| `dps-agent-build-engineer` | Suzune | UE build + Jenkins pipeline |
| `dps-agent-tools-backend` | Kita | UE↔backend integration, telemetry, editor tooling |

Every persona skill ships the same sanctum kit: `assets/{BOND,CREED,PERSONA,MEMORY,INDEX}-template.md`,
`references/first-breath.md` (rebirth ritual), `references/memory-guidance.md`,
`scripts/init-sanctum.py` (+ tests), `customize.toml`.

### 1.4 The 6 workflow skills

| Skill | Purpose |
|---|---|
| `dps-investigate` | Evidence-graded research pass producing the mission spine/seed KB (see Q1) |
| `dps-stream-open` | Open isolated Perforce task stream + agent workspace for a ticket |
| `dps-stream-review` | Task-stream work → Swarm review (quality gate, merge-down check, copy-up shelf) |
| `dps-stream-land` | HUMAN-GATED land to `kraken_main` + post-land verification |
| `dps-changelog` | Player-facing changelog from Perforce CLs + GitHub PRs |
| `dps-update-newsletter` | Patch-notes newsletter reconciling changelog vs WIP team doc |

### 1.5 Domain-profile machinery (orchestrator skill)

- `skills/dps-agent-orchestrator/domain-profiles/{ue,be,tools,web,generic}.json` + `garden-templates/default-garden.json` + `README.md`
- `scripts/detect-domain.py` (read-only weighted-marker scoring, confidence floor, 2-pt margin), `scripts/onboard-domain.py` (propose-with-evidence, dry-run-able), `scripts/validate-detection.py`, `scripts/init-sanctum.py`
- `web`/`generic` are external-roster profiles routing to plain BMad by SKILL NAME — the proven name-based-coupling model.

### 1.6 Stranded / unusual

- `lib/` on main = bytecode only; per-user store (`~/.dps-council/`) implemented on an unmerged branch that is not an ancestor of main (eval D1).
- `skills/dps-agent-orchestrator/scripts/tests/__pycache__/test_check_plugin_version.cpython-312.pyc` — bytecode for a test whose SOURCE exists nowhere in the repo (eval D3). 14 `__pycache__` dirs shipped inside the plugin.
- `shared-memory/dps-agent-orchestrator/MEMORY.md` — token-suffix leak, scrub flagged urgent (eval D2).
- Doc drift: stale `skills/README.md`, dead layout in `BUILD-CONTRACT.md`, two conflicting G0–G8 numberings (eval D4).
- `design-artifacts/` and `_bmad-output/` are empty dirs.

---

## 2. Q1 — Multi-session anti-drift process

### Verdict: EXISTS — fully designed AND built, split across two repos

It is the **"Research→Knowledge Lifecycle"**: a dedicated research pass that runs as its
own step BEFORE multi-session execution, producing a provisional in-progress knowledge
document that working segments read every session and correct via anchored deltas.

**How it works (two tiers, one schema):**

1. **Mission-start `spine` pass** (once, behind mission go/no-go): broad+shallow map —
   systems, entry points, invariants, glossary — budget-bounded (default 40 turns),
   written to `.mission/<workspace>/spine.md`. Every finding gets an immutable anchor id
   (`SPINE-A<n>`) and an evidence grade (Confirmed/Deduced/Hypothesized).
2. **MG-start `seed` pass** (per approved mini-goal, behind the MAX_STORIES notify
   gate): narrow+deep research for that MG's slice, inheriting spine anchors, written to
   `.mission/<workspace>/<goal>/seed.md` (`SEED-<goal>-A<n>` anchors).
3. **Every execution segment reads spine+seed** injected alongside its story (not just
   the prior handoff — the drift fix). The artifacts carry a mandatory header:
   `status: provisional`, `authority: mission-scoped-supersedes-canonical`.
4. **The working developer does NOT update the doc directly** — it "hands back for
   updating": segments emit **anchored deltas in their handoffs**
   (`[SEED-mg3-A1] WRONG — reality: ...`, tier `mg-local` | `spine`). The runner
   harvests them into an append-only per-mission queue
   (`.mission/<workspace>/reconciliation-queue.jsonl`).
5. **At mission close** the queue renders into `reina-reconciliation.md` and routes to
   **Reina's promotion gate**; canonical is only ever changed by explicit human
   promotion. Unpromoted seeds are garbage-collected; spine + queue are kept.

**Persona ownership (resolving Tim's recollection):** it is neither "tech-writer Reina"
nor solely Yui — three personas split it, per the design brief
(`D:\ClaudeOS\_bmad-output\council\brief-yui-knowledge-lifecycle-2026-07-07.md`):

- **Yui (task-planner)** — decompose + the notify gate (and authored the mission scoping; the brief is addressed Alya→Yui).
- **Sora (tech-writer)** — the seed + delta schema/template.
- **Reina (custodian, NOT tech-writer)** — the seed↔canonical wall, delta reconciliation queue, promotion gate at mission close.
- The pass itself (`dps-investigate`) is invoked automatically by the ClaudeOS mission runner; Alya routes manual runs.

**Evidence — council side (plugin repo):**

- `plugins/dps-council/skills/dps-investigate/SKILL.md` — the pass: two modes, budgets, anchor/evidence rules, "Never writes canonical", "promotion is Reina's gate".
- `plugins/dps-council/skills/dps-investigate/references/seed-template.md` — the artifact schema incl. the delta contract comment.
- Real artifacts produced by real missions: `.mission/adaptive-domain-onboarding-for-the-dps-c/g-mission-1783445603624-{2,3}/seed.md` and `.mission/single-bmad-install-council-memory-re-ho/mission-1784224747161-1/seed.md` (schema-conformant, anchored, evidence-graded).

**Evidence — runner side (this repo, D:\ClaudeOS):**

- `D:\ClaudeOS\scripts\mission-spine-pass.ts` (+ test) — mission-start spine pass (mg2), commits the spine when schema-green.
- `D:\ClaudeOS\scripts\mission-mg-start-pass.ts` (+ test) — decompose → notify-gate → seed pipeline (mg3).
- `D:\ClaudeOS\scripts\mission-runner.ts` — wires both (`maybeRunSpinePass` ~line 2614, MG-start pipeline ~line 2670), injects spine+seed into segment prompts (~lines 477–558), best-effort/never-blocking.
- `D:\ClaudeOS\scripts\knowledge-schema.ts` (+ tests + `scripts/fixtures/knowledge-schema/`) — validator for seed/spine artifacts and anchored deltas.
- `D:\ClaudeOS\scripts\mission-reconciliation-queue.ts` (+ test) — delta capture → JSONL queue → Reina routing doc → seed GC (mg6/mg8).
- `D:\ClaudeOS\docs\mission-knowledge-schema.md` — the formal contract (mg1 output).

**Design docs:** `_bmad-output/council/convene-knowledge-lifecycle-2026-07-07.md` (council
debate), `brief-yui-knowledge-lifecycle-2026-07-07.md` (scoping brief),
`mission-draft-knowledge-lifecycle-2026-07-07.md` (mission draft) — all in
`D:\ClaudeOS\_bmad-output\council\`.

**Caveat (adoption timing):** the mission-1784224747161-1 seed (2026-07-16) records
"The spine was not found at `spine_ref` ... this seed stands alone, `inherits: []`" —
missions run while the lifecycle was being built got seeds without spines. The
machinery on ClaudeOS main is complete; no `reconciliation-queue.jsonl` has yet
accumulated in the dps-council extract (deltas queue in target repos as missions run).

---

## 3. Q2 — Planning-stage "in-progress data set" tooling generally

Yes — four distinct layers of resumable cross-session state exist:

1. **The mission knowledge KB (the Q1 machinery)** — spine + per-MG seeds under
   `.mission/<workspace>/`, delta queue (`reconciliation-queue.jsonl`), routing doc.
   Explicitly designed as persistent state: dps-investigate step 1 says "Initialize the
   artifact ... BEFORE researching — it is the persistent state"; honest-partial rule
   writes what it has at budget and marks gaps as Missing-evidence findings.
2. **Segment handoff chain** — per-goal `.mission/<mission>/<goal>/handoff.md` +
   `~/.claude-os/handoff-latest.md`; segments cycle on a 75% context tripwire
   (`D:\ClaudeOS\scripts\mission-runner.ts`; described in the Yui brief). The KB layer
   was built precisely because handoffs alone drifted.
3. **Persona sanctums (long-term memory)** — every persona: `MEMORY.md` + `INDEX.md` +
   `sessions/*.md` logs + identity files, provisioned by per-skill `init-sanctum.py`,
   re-entered via the `first-breath.md` rebirth ritual on every activation. Alya's is
   cross-project (`shared-memory/dps-agent-orchestrator/`, 14 session logs); the 10
   specialists are project-local (`{project-root}/_bmad/memory/dps-agent-*/`). Reina's
   curation tooling (`integrity-check.py`, `build-canonical-index.py`, promotion-gate
   reference) maintains the canonical KB layer above it.
4. **Mission Control artifacts** — `.mission-stories/*.md` (full story specs written at
   planning time), `.mission-reviews/gate/*-findings.md` + `verdict.json` (independent
   gate reviews), root `HANDOFF-manual-mission-dev-*.md` + `MISSION-STATUS.md` (manual
   work-boundary state, mirroring the ClaudeOS handoff protocol).

Gap worth noting for tk-council: the designed **per-user store** (`~/.dps-council/`,
`lib/dps_store.py`) that would unify tiers 3's split memory models exists only on an
unmerged branch (eval D1) — on main, `plugins/dps-council/lib/` holds stale bytecode
only. The three-tier memory design itself is gate-cleared and packaging-orthogonal
(`docs/target-state-architecture.md` in the plugin repo).
