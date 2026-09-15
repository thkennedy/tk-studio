# Research→Knowledge Lifecycle port — planning pass

**Date:** 2026-08-06 · **Status:** ruled 2026-08-06 — see §9; plans only, no code
**Against:** ARCHITECTURE-SPINE.md Deferred entry ("Research→Knowledge Lifecycle
port") · driver-contract.md §7 dossier row 4 · connectors/tk-studio/DESIGN.md
Deferred seam ("run-workspace ↔ handoff mapping")

This is the planning pass the Deferred entry calls for before any code. It
maps what is actually built on both sides, states what "port" means
precisely, proposes the target shape and staging, and isolates the
product-direction forks that are the operator's to call. Nothing here changes
the contract pin (1.6.0) — but the port, when built, is the deliberate MINOR
bump that DW-1 folds into.

---

## 1. What the Deferred entry names, verified

> **Research→Knowledge Lifecycle port** (mission spine/seed, anchored deltas,
> JSONL reconciliation queue, promotion gate — verified built in the legacy council/ClaudeOS)
> — the named session-discipline upgrade. v1 ships only boundary handoffs +
> resumable run workspaces; the port moves the runner-side halves council-side
> behind the driver contract, ClaudeOS as first driver. (spine:256)

The source lifecycle is split across two repos, and that split is the whole
reason for the port (dossier item 4, addendum.md:147):

| Lifecycle stage | Side today | File |
|---|---|---|
| research pass (method, evidence grading, anchor rules) | council | `tk-investigate/SKILL.md` |
| artifact template (seed, supersede header) | council | `tk-investigate/references/seed-template.md` |
| schema validator | **runner** | `ClaudeOS/scripts/knowledge-schema.ts` |
| spine pass orchestration + budget | **runner** | `mission-spine-pass.ts` |
| decompose → notify-gate → seed | **runner** | `mission-mg-start-pass.ts` |
| KB injection into segments | **runner** | `mission-runner.ts:487` (`renderKnowledgeBase`) |
| delta capture → JSONL queue | **runner** | `mission-reconciliation-queue.ts` |
| mission-close routing + GC | **runner** | `mission-reconciliation-queue.ts` |
| promotion gate (human, sole canonical writer) | council | `tk-agent-custodian/references/promotion-gate.md` |

"Moves the runner-side halves council-side" = rows 3–8 leave
`ClaudeOS/scripts/*.ts` and re-home **studio-side behind the driver
contract** (harness-agnostic, AD-2), with ClaudeOS driving them through the
MCP connector instead of owning them.

**Maturity check — "verified built" needs one asterisk.** Mechanisms 1–2
(spine/seed, anchored deltas) are exercised in production: real
schema-conformant spines, seeds, and emitted deltas exist under
`ClaudeOS/.mission/*`. Mechanisms 3–4 (queue, promotion gate) are built
and unit-green but were **never run end-to-end**: no
`reconciliation-queue.jsonl` or the legacy routing doc exists anywhere on
disk (the capture code shipped in the same mini-goal that emitted the first
deltas, so the queue never materialized), and the council-side promotion gate
as written reads daily-logs and stages via Perforce — it has **no reference
to the queue or routing doc at all**. The runner→custodian join is a human
reading a markdown file. The port must treat the back half as
*design-verified, execution-unproven*, and its definition of done must
include the e2e run the source never had.

## 2. The studio's v1 half, verified

- **Research** (`lib/research.py`, §2 row, contract 1.2.0+): charter-gated
  (`no charter, no run`), graded findings (`A/B/C/D`, only D may stand bare),
  closed finding shape `{title, summary, grade, evidence[], recommendation?}`,
  landing in the run workspace as `findings.json`/`findings.md`, plus one
  `observation` ledger event per recommendation-carrying finding.
- **Run workspaces** (`~/.tk-studio/projects/<key>/runs/<run-id>/`,
  job.schema.json): resumable by definition — "a fresh process continues from
  the workspace alone"; terminal states immutable.
- **Handoffs** (`lib/session.py`): `handoff.json`
  `{boundary, done, next, gotchas, artifacts}`, 16 KB budget, one per run,
  overwritten per boundary. **Contract-invisible**: no §2 row, no skill
  surface, no conformance drive — reachable only via a bullet in
  `tk-studio-job`'s SKILL.md.
- **kb/** (`lib/kb.py`): flat per-project markdown, frontmatter
  `{title, description, rank}` — that is the whole recognized key set;
  `scope:` is reserved by AD-8 and read by nothing (a clean, zero-cost seam).
- **The missing edge, precisely:** there is **no path from `findings.json`
  into `kb/`**. Research output escapes the per-user store only as one-line
  observation events riding the measurement membrane into `issues/ledger.md`
  — the *defect* channel. Knowledge is hand-authored. The port's product
  value is exactly this edge: findings → anchored, provisional knowledge →
  reviewed promotion → `kb/`.

## 3. The four invariants worth porting (unchanged)

These are the actual IP; every design choice below preserves them:

1. **Anchor ids are the join.** Immutable, append-only anchor ids
   (`SPINE-A<n>` / `SEED-<goal>-A<n>` — regex
   `\[((?:SPINE|SEED)(?:-[A-Za-z0-9]+)*-A\d+)\]`); deltas cite identity, not
   location, so corrections survive every edit. Unanchored and dangling
   deltas are named rejections.
2. **The supersede header is a wall.** `status: provisional` +
   `authority: mission-scoped-supersedes-canonical`, verbatim, required —
   provisional knowledge is authoritative in-flight and structurally
   incapable of becoming canonical by accident.
3. **Research sits behind a gate.** Scope approval precedes research spend
   (legacy-council: decompose → notify-gate → seed; studio analog: the charter is
   already the gate — `no charter, no run` — plus job budget guards).
4. **Only a human writes canonical.** The renderer routes and applies
   nothing; promotion is explicit per-item human approval. The studio
   already has this exact membrane shape: PR review (AD-12).

## 4. Proposed target shape

Concept mapping (legacy-council → studio), riding existing studio primitives wherever
one fits:

| legacy-council concept | Studio home (proposed) | Notes |
|---|---|---|
| mission | job run (research job) or epic-scoped engagement | the studio's unit of long work is the run |
| mission workspace `.mission/<ws>/` | run workspace `~/.tk-studio/projects/<key>/runs/<run-id>/` | already resumable, already contract-named (§2 job row) |
| spine (broad, once, budgeted) | **project research spine** — one per project, `knowledge/spine.md` in the *per-user store* project dir | budget = job guard (`max_turns`), not a new mechanism |
| seed (narrow, per-MG) | **per-run seed** — `seed.md` in the run workspace, `inherits:` spine anchors | run_id replaces goal id in anchor prefix |
| anchor grammar | unchanged, generalized prefix: `SPINE-A<n>` / `SEED-<run-id>-A<n>` | keep the regex; ids append-only |
| anchored deltas in handoff | `handoff.json` gains optional `deltas[]` (closed shape: `{anchor, verdict: WRONG\|STALE\|CONFIRMED, reality, evidence, tier: run-local\|spine}`) | structured JSON beats the source's heading-agnostic markdown scan; 16 KB budget: deltas are pointers, cap list length, price in ST |
| reconciliation queue (JSONL, per-mission, post-merge capture) | per-project queue in the per-user store: `~/.tk-studio/projects/<key>/knowledge/reconciliation-queue.jsonl`; capture on run finish (`tk_job finish` / wrapper close), deduped `(run_id, anchor, verdict, note)` | AD-3: per-user data never lands on the project VCS uninvited |
| mission-close routing (the legacy routing doc) | rendered routing doc beside the queue; produced by the consolidation-shaped verb of the new knowledge core | pure renderer, applies nothing |
| promotion gate (custodian persona, Perforce CL staging) | **PR membrane + custodian-shaped skill**: a `tk-studio-knowledge` skill drafts promotions from the routing doc into `kb/` files on a branch; PR review is the human gate | replaces the soft legacy-council join (human-reads-markdown + p4) with the studio's proven membrane (AD-12 pattern); kb frontmatter gains nothing — promoted files are ordinary kb files |
| schema validator (`knowledge-schema.ts`, pure) | new stdlib-only `lib/knowledge.py` — validate/capture/route verbs | direct port; the source module is explicitly pure ("no fs, no I/O, no globals") |
| KB injection (`renderKnowledgeBase`) | contract-published: a **driver-visible directive** — the §2 research row (and job wake directives) name spine/seed paths so any driver can inject them into segment prompts | the injection *contract* ports; the injection *act* stays driver-side (AD-2) |
| aid-not-gate discipline | preserved verbatim: a red/absent spine or seed never blocks a run | matches the source's one-exception rule (only the scope gate pauses) |

**Boundary discipline (AD-2/AD-3/AD-8/AD-12), held by construction:**

- The studio never imports ClaudeOS; ClaudeOS's `studio-jobs-tick` and
  connector drive the new surfaces through the contract only.
- Provisional knowledge (spine/seed/queue) lives in the per-user store —
  never on the project VCS. Only *promoted* knowledge crosses, as ordinary
  `kb/` files, through a PR.
- Per-project `kb/` stays the only knowledge target — this port does **not**
  open AD-8's cross-project canonical tier; `scope:` stays reserved and
  unread. The promotion-gate *pattern* ships; the v2 cross-project *target*
  does not.
- One emitter per event type: the knowledge core emits nothing to the
  measurement ledger except through existing named emitters; if a new
  `knowledge-promotion` taxonomy event is wanted, it gets exactly one named
  emitter (the promotion skill) — decision point D4.

## 5. Contract implications (the 1.7.0 bump, when built)

- **New §2 rows:** `tk-studio-session` (handoff/resume — currently
  contract-invisible; deltas ride handoffs, so drivers must be able to invoke
  it) and `tk-studio-knowledge` (spine/seed validate, capture, route,
  promote-draft verbs).
- **Changed §2 row:** `tk-studio-research` — finding shape gains optional
  `anchor`; artifacts gain `seed.md`; blocked conditions unchanged.
- **§4:** run-finish capture hook named (the executing wrapper's `finish`
  already exists — capture rides it, no new verb expected).
- **DW-1 folds in:** the §4 `submit` full-definition-form wording
  clarification ships in the same bump, per the standing deferral.
- **Conformance:** new manifest rows for both new surfaces (including a
  refusal drive each: dangling-delta rejection; promotion attempt without a
  routing doc), plus a session-discipline row closing the "handoff/resume
  unproven by the shipped suite" gap.
- **Companion schemas:** `handoff` shape formalized (today it's code-only),
  knowledge artifact frontmatter + queue line shape published, as
  `knowledge.schema.json`.

## 6. Staging sketch (epic-shaped, planning-first)

Six stories, each independently green, back half explicitly e2e-proven:

1. **Knowledge core + schemas** — `lib/knowledge.py` (validator: tiers,
   supersede header, anchor grammar, delta parse/reject), `knowledge.schema.json`,
   unit tests ported from the source module's cases.
2. **Session surface** — `tk-studio-session` skill + §2 row + `deltas[]` in
   `handoff.json` (byte-budget ruling inside), conformance row.
3. **Research anchors + seed** — `research.py` findings gain anchors; seed
   emission into the run workspace; spine as a chartered research run
   flavor at project scope.
4. **Capture + queue + routing** — run-finish capture, per-project JSONL
   queue, routing renderer. E2E: a sandbox run emits deltas → queue
   materializes → routing doc renders (the exact run the source never had).
5. **Promotion gate** — `tk-studio-knowledge` promote-draft verb: routing doc
   → drafted `kb/` changes on a branch → PR; human review is the gate;
   nothing auto-applies.
6. **Contract 1.7.0 + DW-1 + connector** — bump, manifest rows,
   `test_driver_contract.py` pin, connector-side wiring (injection directive
   honored by `studio-jobs-tick`/`tk_invoke`), through-connector conformance
   at the milestone.

## 7. Decision points for the operator (genuine forks)

- **D1 — Grade vocabulary.** Studio ships `A/B/C/D`; legacy-council uses
  `Confirmed/Deduced/Hypothesized`. Recommendation: keep `A/B/C/D`
  (contract-shipped since 1.2.0), publish the mapping
  (Confirmed→A, independent-agreement→B, Deduced→C, Hypothesized→D) in the
  knowledge schema doc. The alternative (adopt legacy-council vocabulary) breaks a
  shipped surface for naming-fidelity only.
- **D2 — Spine scope.** Per-project spine in the per-user store (proposed)
  vs. per-epic/per-job spines. Per-project matches "map, not territory" and
  the studio's project-centric taxonomy; per-run seeds carry the narrow tier.
- **D3 — Promotion membrane.** PR-review-as-gate (proposed; matches AD-12
  and replaces the source's unwired human join) vs. porting a
  custodian-persona interactive gate. The persona overlay is spine-deferred
  (legacy-council overlay content); the PR membrane needs no new trust machinery.
- **D4 — Measurement.** Should promotions emit a new taxonomy event
  (`knowledge-promotion`, sole emitter the promotion skill), or is git
  history enough? Cheap either way; taxonomy addition is a contract-visible
  change and belongs in the same 1.7.0 bump if wanted.
- **D5 — Epic declaration.** This is epic-sized (6 stories, a contract bump,
  cross-repo verification). Declaring it — and when it starts relative to
  other motions — is the operator's call; this pass is its planning input.

## 8. What this pass deliberately does not do

No code, no schema files, no contract edits, no new skills, no job
declarations (a real research-ecosystem instance starts weekly burns —
operator call). The legacy-council material is harvested as reference only and
none of it is committed (gitignored, per standing rule).

## 9. Operator rulings (2026-08-06)

Rulings taken via in-session operator Q&A; the durable record is the PR #7
rulings comment. Summary:

- **D1 — keep `A/B/C/D`**; publish the source-vocabulary mapping
  (Confirmed→A, independent-agreement→B, Deduced→C, Hypothesized→D) in the
  knowledge schema doc. Rider: the old company initials are scrubbed from
  all tracked artifacts and replaced with "tk" (this brief included; a
  repo-wide scrub PR follows this merge).
- **D2 — per-project spine** in the per-user store; per-run seeds carry the
  narrow tier.
- **D3 — PR-review-as-gate** (AD-12 pattern); no custodian-persona port.
- **D4 — add the `knowledge-promotion` taxonomy event**, sole emitter the
  promotion skill, folded into the 1.7.0 bump.
- **D5 — epic declared** at merge; story 1 starts immediately.

---

*Sources: ARCHITECTURE-SPINE.md (Deferred, AD-2/3/8/10/11/12);
driver-contract.md 1.6.0 §1/§2/§4/§7; connectors/tk-studio/DESIGN.md;
addendum.md A7 (dossier items 4–5); legacy-council-inventory-2026-07-25.md §2;
ClaudeOS scripts (knowledge-schema.ts, mission-spine-pass.ts,
mission-mg-start-pass.ts, mission-reconciliation-queue.ts,
mission-runner.ts); legacy-council/plugins/legacy-council/skills
(tk-investigate, tk-agent-custodian); plugins/tk-studio/lib
(research.py, session.py, kb.py, job.py); live artifacts under
ClaudeOS/.mission/*.*
