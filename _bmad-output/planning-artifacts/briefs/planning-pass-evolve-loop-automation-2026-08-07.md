# Evolve-loop automation — planning pass

**Date:** 2026-08-07 · **Status:** ruled 2026-08-07 — see §9; plans only, no code
**Against:** ARCHITECTURE-SPINE.md Deferred entry ("Evolve-loop automation") ·
AD-8 (the v1 observe-only boundary) · AD-12 (measurement membrane) ·
epic-9-retro-2026-08-07.md (direction ruled at the 2026-08-07 fork)

This is the planning pass the Deferred entry calls for before any code. It
maps what the v1 observe half actually shipped, states what "automation"
means precisely (and what it must never mean), proposes the target shape and
staging, and isolates the product-direction forks that are the operator's to
call. Nothing here changes the contract pin (0.1.8) — the automation, when
built, is an additive patch bump (0.1.9) per the pre-1.0 change policy.

---

## 1. What the Deferred entry names, verified

> **Evolve-loop automation** (proposal drafting from observed toil) — v1
> observes and logs only. (spine:252)

AD-8's rule sentence carries the boundary: "The evolve loop only observes
and logs in v1." The Deferred entry is that boundary's named exit: the "in
v1" qualifier anticipates exactly this motion. Building it does not amend
AD-8's core rule (cross-project knowledge stays out; `scope:` stays reserved
and unread; only a human writes canonical) — it completes the loop AD-8
scoped. The spine's Deferred entry gets its "landed" annotation at epic
close, as the knowledge port's did.

**What "automation" means here, precisely:** the machine drafts *proposals*
from accumulated observations — clustered, evidenced, costed candidate
changes to the studio. It never applies one. The human-decides membrane
(AD-12, proven three times: measure-push, knowledge promotion, ISS rows) is
the load-bearing invariant; the automation ends where a human review begins.

## 2. The v1 observe half, verified

- **`tk-studio-observe`** (`lib/observe.py`, §2 row since 0.1.x): records
  `observation` events to the per-user measurement ledger. The SKILL.md's
  hard rule: "recording an observation must trigger nothing (v1 boundary,
  AD-8)." Sources: `retrospective | repeated-manual-work | research-job |
  other`.
- **`tk-studio-report`**: human *defect* reports (`report` events) — a
  separate channel by emitter discipline; defects flow to the issues ledger.
- **`tk-studio-research`** (0.1.7): emits one `observation` event per
  recommendation-carrying finding — the research-ecosystem job (instance
  declared 2026-08-07, weekly self-paced) now feeds this channel on a
  schedule.
- **`tk-studio-consolidate`** (`lib/consolidate.py`): the *defect* loop's
  closing half — clusters defect-shaped events from merged `measurements/`
  into `issues/ledger.md` ISS-NNN rows (stable ids, in-place updates, never
  a deleted row, per-column ownership, idempotent reruns). **It does not
  read `observation` events** — its severity map covers defect shapes only.
- **The missing edge, precisely:** `observation` events have no consumer.
  Ten real events exist today (8 observations, 2 reports on this machine's
  ledger) — installer churn, cp1252 crash-class sweeps, drift-check plane
  gaps, headless-permission gaps, two ISS-002-class posture finds, the
  retro's recurring-pattern emission, and the job-instance type-resolution
  gap found declaring the research job today. Each states toil or a
  candidate change; none has anywhere to go. The evolve loop's product
  value is exactly this edge: observations → clustered, evidenced
  proposals → human ruling → adopted change.

## 3. Invariants preserved by construction

1. **One emitter per event type (AD-12).** Whatever the drafting surface
   is, it either derives (like consolidate — reads events, emits none) or
   gets exactly one new named event. Never both ambiguously.
2. **Derived records ride the repo; raw measurement rides the membrane.**
   Merged measurement data arrived through measure-push PRs; anything
   derived from it (`issues/ledger.md` today) lives in the studio repo where
   review can see it. Proposals are derived records.
3. **Stable-id row discipline** (legacy-council heritage, proven by ISS-NNN):
   ids assigned in order, never reused; rows update in place, never
   deleted; column ownership split between the machine and the operator;
   idempotent reruns stamped by evidence dates, not wall clock.
4. **Only a human adopts.** A proposal's status moves to adopted/declined by
   operator hand or by PR review — the drafting surface writes candidate
   rows and refreshes evidence, nothing else. No auto-apply, no
   auto-scaffold, no follow-on writes (the observe SKILL.md's "trigger
   nothing" discipline moves up one level: *drafting* triggers nothing).
5. **AD-3 classification.** Proposals derive from sanitized merged data;
   the drafting surface re-classifies at write like every repo-landing
   surface.

## 4. Proposed target shape

| Concern | Proposal | Notes |
|---|---|---|
| Surface | new skill `tk-studio-evolve`, verb `draft` (+ `status` read-only) | completes the observe/evolve pair; observe stays untouched |
| Core | stdlib-only `lib/evolve.py` | reads merged `measurements/*.jsonl` `observation` events (+ `report` events already consolidated as context), clusters by stated toil/change-candidate similarity — same clustering discipline as consolidate |
| Record | `proposals/ledger.md` in the studio repo — stable `PROP-NNN` rows | mirror of `issues/ledger.md`: Sev→Impact, Status `Draft / Under-review / Adopted / Declined`, Evidence (named events), Candidate change, Affected surfaces, Key, Opened/Updated |
| Defect boundary | defect-shaped events stay consolidate's; observation-shaped events are evolve's | the two ledgers cross-link where an observation and an issue share evidence (e.g. ISS-001 ↔ the installer-churn observation) |
| Trigger | on-demand verb first; optionally a shipped recurring job type (`evolve-proposals`) instances can declare later | same pattern as research-ecosystem; budget guards inherit from the job model |
| Emission | derive-only (no new taxonomy event), like consolidate | D4 fork below |
| Apply boundary | proposals are documents; implementation stays a human-initiated motion (an adopted proposal becomes ordinary planned work) | D1 fork below |

**Contract implications (0.1.9, additive):** one new §2 row
(`tk-studio-evolve`: payload `directory`, `dry_run?`; artifacts
`proposals/ledger.md` synced in place; blocked: directory missing /
measurements outside the studio repo / unparseable proposals ledger — the
consolidate refusal family), conformance manifest row with a refusal drive
(unparseable-ledger refusal), test pin move. Taxonomy untouched under the
recommended D4. Schema: the PROP row shape documented in the ledger header
(as ISS rows are), no new companion schema file.

## 5. What the live data says it would draft (grounding, not code)

Clustering today's ten events by hand yields three or four genuine
proposals — the loop has real work waiting:

- **PROP-candidate: per-outcome headless postures, linted.** Two
  ISS-002-class finds + the retro's recurring-pattern observation → a
  proposal to enforce team agreement 5 mechanically (a SKILL.md posture
  check in conformance).
- **PROP-candidate: installer churn normalization.** ISS-001's report + the
  repeated-manual-work observation → the base-update verify-step
  normalization already named as a fix candidate.
- **PROP-candidate: cp1252 stdout sweep as a platform invariant.** The
  crash-class observation → a suite-level check (team agreement 1's family).
- **PROP-candidate: job-instance self-description.** Today's type-resolution
  observation → require trigger+cadence in instances (schema tightening —
  a 0.2.0-line question, correctly a proposal for a human to weigh).

## 6. Staging sketch (epic-shaped, planning-first)

Three stories, each independently green:

1. **Proposal model + ledger** — `lib/evolve.py` (observation reader,
   clusterer, PROP-NNN ledger writer with the in-place/idempotent/ownership
   discipline ported from consolidate), `proposals/ledger.md` standing up
   with header discipline, unit tests.
2. **Surface + first real draft** — `tk-studio-evolve` SKILL.md (attended +
   headless postures per-outcome, per team agreement 5), draft run over the
   real merged data producing the first genuine PROP rows, operator triage
   of those rows as the acceptance evidence.
3. **Contract 0.1.9 + conformance + job type** — §2 row, manifest row +
   refusal drive, test pin, shipped `evolve-proposals` job type (no
   instance declared — that is an operator call, as research-ecosystem
   was), through-connector spot-check on the new surface.

## 7. Decision points for the operator (genuine forks)

- **D1 — Apply boundary.** Proposals are documents only (recommended: the
  membrane stays the gate; an adopted proposal becomes ordinary planned
  work) vs. the drafting surface also opens draft implementation PRs for
  small mechanical classes. The latter is real automation but moves the
  machine across the "drafting triggers nothing" line one epic after the
  discipline was written.
- **D2 — Record home + emission.** In-repo `proposals/ledger.md`,
  derive-only, consolidate-twin (recommended) vs. adding a
  `proposal-drafted` taxonomy event (contract-visible; one named emitter)
  vs. per-user-store proposals pushed through the membrane. In-repo +
  derive-only is the smallest true step and mirrors a proven surface.
- **D3 — Trigger.** New surface with an on-demand verb, shipped job type
  for recurring drafting arriving in story 3 but undeclared (recommended)
  vs. folding drafting into consolidate (blurs the defect/evolution
  boundary and consolidate's "derives, not emits" simplicity) vs. on-demand
  only, no job type.
- **D4 — folded into D2** (emission is where the taxonomy question lives).
- **D5 — Epic declaration.** Declare at brief merge with build starting
  next session (recommended: the boundary-handoff discipline; this session
  already shipped 0.1.8 + three operator decisions) vs. declare and start
  story 1 immediately vs. hold undeclared.

## 8. What this pass deliberately does not do

No code, no schema edits, no contract edits, no new skills, no taxonomy
changes, no epic/story records until D5 rules. The PROP-candidates in §5
are grounding for the pass, not pre-written rows — story 2's first real
draft derives them from the merged data by machine.

## 9. Operator rulings (2026-08-07)

Rulings taken via in-session operator Q&A at the post-Epic-9 direction fork
(where evolve-loop automation was chosen from the Deferred menu); the
durable record is this section plus the brief's PR thread.

- **D1 — proposal docs only.** The drafting surface produces PROP rows;
  adoption and implementation stay human-initiated. The membrane is the
  gate.
- **D2 — in-repo `proposals/ledger.md`, derive-only.** Consolidate-twin
  discipline; no new taxonomy event; taxonomy untouched at 0.1.9.
- **D3 — on-demand verb + shipped `evolve-proposals` job type,
  undeclared.** Instance declaration remains an operator call, as
  research-ecosystem was.
- **D4 — folded into D2** (derive-only carries the no-new-event ruling).
- **D5 — epic declared at brief merge; build starts next session** per the
  boundary-handoff discipline.

---

*Sources: ARCHITECTURE-SPINE.md (Deferred:252, AD-8:90–94, AD-12:114–118);
driver-contract.md 0.1.8 §2/§4 + change policy; epic-9-retro-2026-08-07.md
(direction fork, team agreements 1/5); plugins/tk-studio/lib (observe.py,
consolidate.py, research.py, job.py); skills/tk-studio-observe/SKILL.md;
issues/ledger.md (ISS-001/002); the live measurement ledger
(tim-Tim-PC.jsonl: 8 observations, 2 reports as of 2026-08-07).*
