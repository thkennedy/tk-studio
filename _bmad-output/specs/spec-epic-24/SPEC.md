---
id: SPEC-epic-24
companions:
  - ../../../kb/execution-pipeline-model-routing.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 24: Opus 5.5 Earns Its Legs, Measured

## Why

An opportunity plus a measurement gap. The operator asked on 2026-09-28 to run Claude Opus 5.5 (`claude-opus-5-5`) in as many loop legs as suit it and to measure cost and speed. It lists at $4 / $20 per MTok input / output, cache reads $0.20: below Opus 5 ($5 / $25) and Fable 5.1 ($10 / $50), but twice Sonnet 5 ($2 / $10). It is a price cut on the consult, seam, review, triage and planner legs; on the session, implementer, reviewer and supervise legs it saves money only by finishing stories in fewer turns and retries. The routing is already in (PR #73: allowlist entry, and tk-studio's `.bmad-loop/routing.toml` on Opus 5.5 for every leg). Three gaps stop a verdict: the v2 baseline priced weighted tokens at one model's price and cannot price mixed-model routes; the engine now runs in Docker Sandboxes, so session transcripts live in the microVM, not the host backup; and there is no wall-clock baseline on this box. Repos: tk-studio, the supervisor repo, the-universe-awaits (throwaway branches only). Trace: operator request of 2026-09-28; the companion kb page.

## Capabilities

- **CAP-1** (24.1)
  - **intent:** A story's session and subagent transcripts leave the microVM at its boundary.
  - **success:** On a bmad-loop run on the sbx engine, when a story reaches its boundary, its session and subagent transcripts are in the run's directory in the mounted checkout, gitignored, so they reach the host and its nightly backup.
- **CAP-2** (24.1)
  - **intent:** Prices come from a committed, dated table.
  - **success:** A committed price table maps model id → input, output, cache-write and cache-read $ per MTok, and carries the table's date.
- **CAP-3** (24.1)
  - **intent:** A landed story is priced and timed from its transcripts and run.
  - **success:** The meter reports dollars per model and per leg (session, implementer, reviewers, consult, seam, review, triage, supervise), wall-clock from first dispatch to landed commit, attempt count, and the route in force read from `routing.current.json`.
- **CAP-4** (24.1)
  - **intent:** A model without a price is refused, not guessed.
  - **success:** A story whose transcripts name a model absent from the table gets a named refusal and no dollar figure.
- **CAP-5** (24.1)
  - **intent:** Each priced story is recorded in the ledger.
  - **success:** Exactly one `observation` event per priced story lands in this machine's ledger, carrying story key, route, dollars, wall-clock and attempts; the lib suite pins the pricing arithmetic, the missing-price refusal, and a mixed-model story.
- **CAP-6** (24.2)
  - **intent:** The Phase 1 build runs on the trial route and is measured story by story.
  - **success:** Every Epic 20–22 story run through the launch pipeline ran on the trial route (tk-studio's `routing.toml`, and the same table in the supervisor repo) and has its CAP-3/CAP-5 record.
- **CAP-7** (24.2)
  - **intent:** Landed Phase 1 stories are compared with v2 by story kind.
  - **success:** A kb trial record lists each story's dollars, wall-clock, attempts and kind against the v2 table (core code ≈ $4.4, feature ≈ $8.6 all-in), with the caveat that these are different stories in a different language (TypeScript and Python against the C#/Godot baseline).
- **CAP-8** (24.3)
  - **intent:** The same stories run under both routes from the same base.
  - **success:** Given the engine home (Story 23.1) and `throwaway/route-v2` and `throwaway/route-o55` cut from one recorded TUA `main` commit, stories `2-1-keyed-month-thread-scheduler` and `2-2` (in `spec-epic-2` order) run on each branch — shipped defaults on `route-v2`, Opus 5.5 on every leg on `route-o55`, via runtime overrides or a branch-local `routing.toml` — and each of the four story-arms has a CAP-3/CAP-5 record.
- **CAP-9** (24.3)
  - **intent:** The paired arms are compared per story and in total.
  - **success:** The kb trial record states, per story and in total, dollars split by leg, wall-clock, attempt-1 landing, review findings raised, and weekly plan-usage points; it notes n = 2 is directional, not significant; neither branch has merged anywhere.
- **CAP-10** (24.4)
  - **intent:** The evidence becomes a per-leg routing verdict the operator adopts or not.
  - **success:** Each leg is marked keep-Opus-5.5, revert, or needs-more-data with evidence cited; one `observation` per leg is in the ledger; `tk-studio-evolve` has minted the proposal; nothing is adopted except by the operator.
- **CAP-11** (24.4)
  - **intent:** An adopted proposal becomes the shipped defaults.
  - **success:** `[pipeline.legs]` in the `tk-studio-launch` `customize.toml` and the kb table show the adopted route with the trial's numbers; the release motion ships it with lib suite and conformance green; the project-tier trial table is gone from tk-studio's `routing.toml`.
- **CAP-12** (24.4)
  - **intent:** The session effort default is probed before it is set.
  - **success:** When budget is left after the paired runs and the verdict keeps Opus 5.5 on the session leg, one probe (session at `low` against `medium`, one story) is run and recorded before the effort default is set.

## Constraints

- AD-14 / AD-12 evidence discipline: the shipped `[pipeline.legs]` defaults change only after a recorded verdict the operator adopts; never silently.
- Routes are judged on dollars and wall-clock, never token counters; weighted-token pricing at one model's price is not a valid measure for mixed routes.
- No guessed prices: a missing model price is a named refusal.
- TUA `main` is never touched; route overrides never land on `main`; the throwaway branches never merge anywhere.
- Transcripts copied into the run directory stay gitignored.
- Story 24.2 spends nothing beyond the planned Phase 1 work.
- The paired runs depend on the engine home on this box (Story 23.1).

## Non-goals

- Changing shipped defaults before the verdict is recorded and adopted.
- Statistical significance: n = 2 paired stories is directional.
- Merging either throwaway branch.
- Extra runs to feed Story 24.2 beyond the planned Phase 1 work.
- Pricing by weighted tokens.

## Success signal

- Every landed trial story has one ledger `observation` carrying its dollars by model and leg, wall-clock, attempts and route; the kb trial record holds the by-kind and paired comparisons; and `[pipeline.legs]` changes only through an operator-adopted, per-leg verdict shipped by the release motion with lib suite and conformance green.

## Assumptions

- "Feature ≈ $8.6" is the kb's v2 real-feature / engine-node all-in figure.
- Weekly plan-usage points are percentage points of the weekly plan cap, as the kb defines them.
- "This machine's ledger" is the per-user store's event ledger, written through the existing `observation` path (`tk-studio-observe`).
- Per-leg dollars cover every leg's transcripts, including the engine-side seam, review, triage and supervise invocations, not only the story session.

## Open Questions

- Epic 20 landed (PR #79, plugin 0.2.16) before the 24.1 meter exists: are its stories priced retroactively from surviving transcripts, or does CAP-6 cover Epics 21–22 only?
- The source gives Opus 5.5's cache-read price only and no cache-write price for any model: which figures, from which source, populate the committed table?
- Is the transcript copy-out at the story boundary a studio-side step or a bmad-loop hook, given the studio reaches the substrate by CLI only (AD-2)?
- How are weekly plan-usage points captured per story (CAP-9)?
- What budget gates the CAP-12 effort probe, and who declares it left?
