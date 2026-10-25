---
title: 'The Quote Band'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '4016f3a32a22f2d448451de546daff921fd694a8'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-5.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The owner is asked to approve an engagement without a price. The meter's per-story history is a free-text `observation` line that cannot be read as numbers, so no band, no cap and no tail can be quoted (F2 step 4; D4; B5 item 4).

**Approach:** Make the meter's observation payload structured and additive, and add `engage.py quote`. It resamples the project's per-story history over the scope's proposed story count into a seeded 50/85/95 band in tokens with a plan-window share, a list-price dollar shadow and a hard cap. It lands `quote` in the record and the `epics.<EP>.usd_estimate` in `.tk-studio/budget-bands.yaml`. The planner proposes `go`, and the owner's `go` moves `scoping → quoted` through 32.1's existing `quote-present` row (plan Settled shape 3).

User story (verbatim): As the owner, I want a 50/85/95 band from the studio's own history with a hard cap, So that I approve a price with its tail, not a hope (F2 step 4; D4; B5 item 4).

Acceptance criteria (verbatim, `_bmad-output/planning-artifacts/epics.md` Story 32.5):

- **AC1.** **Given** the meter's per-story records (today a free-text `observation`; this story makes the meter's payload structured and additive: `kind: meter`, `story_key`, `epic`, `usd`, `tokens {input, output, cache_read, cache_write}` per leg and the route, written to `transcripts/<key>/observation.json` and harvested to the host ledger as before) and the scope's proposed stories **When** `engage.py quote` runs (the planner's turn after the scope, or by hand) **Then** it computes, for this project and story kind, a seeded bootstrap (10,000 resamples of per-story tokens over the proposed story count) 50/85/95 band in tokens, shown as plan-window share (the plan's weekly window from `~/.tk-studio/config.yaml`'s `plan.window_tokens`, else "share unknown") with the list-price dollar shadow (`prices.json`), the cap (`cap = p95 + one story at p85`) and what happens at the cap (the run pauses `partial`, the engagement's issue blocks with the figures, the owner decides), the route and the autonomy levels on offer (32.6), and whether scoping was billable (the planning spend so far); a history under eight landed stories says "thin history" and widens the band from the design spec §10's sizing by analogy, never a bare number; `quote {band50, band85, band95, cap, basis, computed_at}` lands in the record, the state moves `scoping → quoted`, and `.tk-studio/budget-bands.yaml` gains `epics.<proposed EP>.usd_estimate` from the 85th so the board draws the band against spend once the epics exist
- **AC2.** **Given** the quote **When** it is tested **Then** the lib suite covers the resampling (seeded, exact), the thin-history rule, the share, the cap and the voiding on `revise` with fixtures; `GET /engagements/{id}` carries the quote and `GET /board`'s `band_usd` follows it; `kb/quote-band.md` records the method and its first figures

## Boundaries & Constraints

**Always:**
- Follow the plan's Settled shapes 1–5 (`plans/32-5.md`) exactly. They are the planner's rulings for this story.
- Shape 1: the AC's `tokens {…}` lands as `legs.<leg>.usage {input, output, cache_read, cache_write}`, because `ledger.sanitize` redacts any key matching `token`. `cache_write = cache_write_5m + cache_write_1h`.
- The meter's description string is unchanged, `observation.json` equals the ledger line, and `harvest` re-emits the same structured fields.
- `quote` merges only `quote` and `updated` into a fresh read of `engagement.yaml` (the 32-2 replan rule). There is no shared lock, which the Risks record.
- Stdlib-only Python run via `uv run`, atomic writes, the AD-11 status block on every exit, and no credentials in files or events.
- Contract: an additive `0.1.27 (Story 32.5)` clause on the existing line-5 entry, no `**0.1.28**`, and the 32.4 sentence "Stories 32.5 to 32.8 add the verbs `quote` and `closeout`" kept verbatim. Every earlier pin in `test_driver_contract.py` stays.
- The Files boundary is the plan's Files list.

**Block If:**
- `scoping → quoted` can only move without the owner's `go` (a new `TRANSITIONS` row or a supervisor apply pass).
- The structured meter fields can only land by weakening `ledger.sanitize` or `classify.CREDENTIAL_KEY_RE`.
- A `meter.py` change alters an existing observation's description string or breaks `test_meter.py`'s pinned shapes (`test_report_fields_and_one_observation_shape`, `test_metered_run_writes_observation_equal_to_ledger_line_before_marker`, `test_harvest_appends_sandbox_observation_exactly_once`).
- The Files list must grow beyond the plan's list.

**Never:**
- Edit `apps/supervisor/src/**`. The supervisor gets tests only, and `TRANSITIONS` is unchanged.
- Parse the free-text `meter: story=… usd=…` description. Unstructured records are counted as `basis.history.unstructured`.
- Push, tag, release, or bump gate versions.
- Edit `SPEC.md`, `epics.md`, `stories.yaml`, the plan, or anything under `supervision/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quote, rich history | `scoping` record, `scope.md` with N `####` stories, ≥8 structured meter records for the project | `quote {band50,band85,band95,cap,basis,computed_at}` merged into a fresh read; state still `scoping`; budget-bands `epics.EP-NNN.usd_estimate` written; status `complete` | — |
| Seeded, exact | the same history, engagement and N, the default or a given `--seed` | identical bands on a rerun; a different seed gives a different band; tokens and usd are drawn from the same indices | — |
| Thin history | 0–7 structured records | `basis.thin=true`, note `thin history: <n> landed stories`, the prior from `kb/trial-record-opus-5-5.md`, band85/band95/cap ×1.5 (`widen: 1.5`) | n=0: `tokens`/`share` null, note `tokens unknown: thin history (no metered story)`; usd always set |
| Share | `plan.window_tokens` a positive int in the user/studio config | `share = tokens / window` (4 dp) | absent, invalid or `ConfigError` → `"share unknown"` |
| Re-quote after void | record `scoping` with `quote: null` after `revise` | a fresh quote is written; `reply`'s memory shows `null` before and the quote after | — |
| Refusals | non-JSON record / terminal / not `scoping` / no scope.md or 0 stories / bad prices or unpriced route model / OSError | `blocked` with `EngagementRecordUnreadable` / `EngagementClosed` / `NotScoping` / `NoScope` / `PricesUnreadable` / `QuoteUnwritable` | nothing written (except what `written[]` names for `QuoteUnwritable`) |
| Budget bands | the existing file with comments and `bands:`, maybe an `epics:` block | the bytes before the top-level `epics:` are identical; this quote's entries are overwritten, other epics' entries kept | atomic write |
| Meter | a metered story | structured fields in `observation.json` and the ledger line, `usage` not redacted, `harvest` carries them | an extra field of the wrong type is refused by `_read_observation`'s pre-check |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-32/plans/32-5.md`, `## Code Map`) is the investigation, and its anchors were spot-checked against HEAD `4016f3a`. Summary:

- `plugins/tk-studio/lib/meter.py` -- `price()` :413 (tallies `(leg, model, tokens)`, add `tokens_by_leg`). `describe()` :549 is unchanged. `record()` :560 calls `observe.record_observation` and writes `observation.json`, then `metered.json`. `_read_observation()` :590 is the pre-check. `harvest()` :636 re-emits. `meter_story()` :692 builds the report (`route`, `prices_date`). `load_prices` :297, `_rates` :323.
- `plugins/tk-studio/lib/observe.py:35` -- `record_observation(source, description, evidence=None, project=None)`. Add an optional keyword for the structured fields. The CLI is unchanged.
- `plugins/tk-studio/lib/ledger.py` -- `validate` rejects unknown fields (:103-107). The types are at :48-54. `sanitize` (~:140-155) redacts via `classify.CREDENTIAL_KEY_RE` (`classify.py:21-23`). `ledger_path()` is at :166.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json:72-79` -- the `observation` schema. Add the optional fields `kind, story_key, epic, usd, legs, route, prices_date`.
- `plugins/tk-studio/lib/consolidate.py:115` -- `read_events(measurements_dir)` reads every machine's file. `config.py:251` `project_key`. `config.py:130` `resolve` (call it without `project_root` for `plan.window_tokens`).
- `plugins/tk-studio/lib/engage.py` -- `Refused` :151, `_result` :159, `_finish` :164. `parse_scope` :711, `check_scope` :740 (`_subsections`, `EPIC_RE`, `STORY_RE` ~:798-816). `_merge_record` :891. `main` :1244 with the subparsers `reply`/`questions`/`scope` (:1250-1271). The `reply` memory (~:598-620).
- `plugins/tk-studio/lib/prices.json` -- `{date, source, aliases, models{…}}` in USD/Mtok.
- `.tk-studio/plan-counter.yaml` -- `next.epic` gives the predicted `EP-<next+k-1>` (three digits, as `plansync` mints).
- `apps/supervisor/src/engagement.ts:209,254,269,271` -- read-only. `go`/`quote-present`, `void-quote`, and `raise-cap` (which reads `quote.cap` as a number).
- `apps/supervisor/src/api.ts:528` -- `GET /engagements/{id}` returns the whole record. `board.ts:242` `readBands` and `:373` `band_usd`. Tests: `test/api.test.ts`, `test/board.test.ts` (:141-169, :386), `test/engagement.test.ts:184-195`.
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 (the version entry), §1 `GET /engagements/{id}` (~:116), §2 `tk-studio-engage` (~:389), the observe row (~:396), the event taxonomy. `test_driver_contract.py:1120-1173` (the 32.4 pin) and :1410-1416 (taxonomy and contract land together).
- `kb/trial-record-opus-5-5.md:26-37` -- the analogy prior's twelve per-story dollars: 3.97, 7.14, 19.45, 12.13, 38.13, 20.02, 27.49, 35.53, 22.43, 17.68, 29.25, 13.42 (Σ 246.64; design spec §10, README :268).
- Tests to reuse: `test_meter.py` (`MeterTest.setUp` :52, `FIXTURE_PRICES` :26, `usage_line` :40, `add_session` :83, `basic_story` :122, `run_harvest` :799, `sandbox_observation` :805) and the `test_engage.py` scope fixtures.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/meter.py` -- return `tokens_by_leg` from `price()`. Pass the structured fields (Shape 1) through `record()` and `harvest()`. Type-check the new fields in `_read_observation` -- Shape 1.
- `plugins/tk-studio/lib/observe.py` -- add an optional structured-fields keyword to `record_observation` -- the meter's payload.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- add the optional `observation` fields -- `ledger.validate`.
- `plugins/tk-studio/lib/quote.py` (new) -- the history reader (all of `measurements/`, filtered by project, deduped by `story_key`, last wins), the seeded bootstrap with nearest-rank percentiles, the thin-history prior and widening, the share, the cap, and the `budget-bands.yaml` `epics` writer -- Shapes 2, 4, 5.
- `plugins/tk-studio/lib/engage.py` -- add `scope_counts(text)` and the verb `quote --directory --engagement [--seed N] [--dry-run]` with the refusals and the fresh-read merge of `quote`+`updated` -- Shape 2.
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` -- a `quote` step after scope, the `go` proposal `{verb:"go", payload:{}, label:"Accept the quote"}`, the Rules' file list, the description -- Shape 3.
- `plugins/tk-studio/contracts/driver-contract.md` and `lib/tests/test_driver_contract.py` -- the 0.1.27 (Story 32.5) clause, the engage/observe/§1 rows and the taxonomy fields, plus a 32.5 pin.
- `plugins/tk-studio/lib/tests/test_quote.py` (new), `test_engage.py`, `test_meter.py`, `test_ledger.py` -- every case in the plan's "Tests to cover".
- `apps/supervisor/test/api.test.ts`, `apps/supervisor/test/board.test.ts` -- `GET /engagements/{id}` carries `quote`, and `band_usd` follows a quote-written `epics` block.
- `kb/quote-band.md` (new) -- the method, the thin-history rule and the first figures from a `quote --dry-run`-style computation over this repo's own history (or the thin result with its `n`).

**Acceptance Criteria:**
- Given a `scoping` record with a valid `scope.md`, when `engage.py quote` runs, then the record carries `quote {band50, band85, band95, cap, basis, computed_at}` with `cap` a USD number and `basis` per Shape 2, and the state is still `scoping` until the owner's `go`. The supervisor test shows `go` moving it to `quoted` (AC1, Shape 3).
- Given a fixed history and seed, when quoted twice, then the bands are identical, and the lib tests pin exact figures (AC2).
- Given a metered story, when it is recorded and harvested, then `observation.json` equals the ledger line, carries `kind: meter`, `story_key`, `epic`, `usd`, `legs.<leg>.usage{…}` and `route`, and the description is unchanged (AC1).
- Given `GET /engagements/{id}` and `GET /board` over a quoted record and its written bands, then the quote rides the record and `band_usd` equals the written `usd_estimate` (AC2).
- Given `kb/quote-band.md`, then it records the method and the first figures (AC2).

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` A quote went stale when `scope.md` was rewritten in `scoping` (the supervisor row has no `void-quote`). `scope()`, a failed publish after the rewrite, and `apply_page_revision` now merge `quote: null`. Documented in SKILL.md and the contract, pinned, and tested.
  - `[medium]` `[patch]` `basis.planning_usd`/`scoping_billable` were read before the fresh read. They are now computed from the record the merge writes over, and the merge test asserts that `basis` agrees with `spend`.
  - `[low]` `[patch]` A ZeroDivisionError in the thin-history ratio (all-zero usd or tokens). The prior's tokens and share are now null with a note, and the dollars still carry.
  - `[low]` `[patch]` A non-string route model from the sample fallback raised TypeError. Only string values are kept now.
  - `[low]` `[patch]` A scalar `epics: ~|null|{}` line produced a duplicate key. It is now treated as the block to replace.
  - `[low]` `[patch]` A repeated epic number collapsed two epics onto one EP id. It now refuses `NoScope` and writes nothing.
- rejected (reasons):
  - budget-bands `epics` entries are never cleaned up, and predicted ids can collide across engagements: Settled shape 4 leaves the entries until the next quote overwrites them, and 32.6 re-keys via `basis.epics[].ep_id`. The missing lock is a recorded risk (Design Notes).
  - the dollar shadow is not re-priced from the current `prices.json`: Settled shape 2 resamples each record's own metered `usd` (priced from `prices.json` at meter time), and `basis.prices_date` is in Shape 2's basis list.

### 2026-10-25 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` `quote` read `scope.md` without `scope.lock`, so a concurrent scope rewrite between the read and the merge could land a stale-count quote that `go` passes. A real `quote` now holds `scope.lock` from the scope read through the merge and the bands write. A held lock refuses `QuoteUnwritable` with nothing written.
  - `[medium]` `[patch]` The predicted `EP-<next+k-1>` used the heading number, so `### Epic 0` (or a gap) could key onto a live epic and overwrite its `usd_estimate`. `quote` now refuses `NoScope`, with nothing written, unless the epics are numbered exactly 1..m.
  - `[medium]` `[patch]` The contract's 0.1.27 (Story 32.5) clause, the §1 `GET /engagements/{id}` row and the §2 engage row left out `basis.notes`, a possibly-null `basis.epics[].ep_id`, and the extra `QuoteUnwritable`/`NoScope` cases. All are documented now, additively, and the 32.5 pin checks them.
  - `[low]` `[patch]` A post-publish merge OSError left the quote standing after `scope.md` was replaced, and a rerun never voided it. The void is now merged first (see the void-first rule below).
  - `[low]` `[patch]` On a failed publish, the void merge's OSError was swallowed. Void-first refuses `ScopeUnwritable` before `scope.md` is touched, and the swallowing block is removed.
  - `[low]` `[patch]` The failed-publish void caught only OSError, so a `Refused` from `read_record` could replace a retryable 429/5xx. The block is removed, and an unreadable record at the void is its own refusal before any write.
  - `[low]` `[patch]` The contract and the kb said "every other byte kept" of `budget-bands.yaml`, but Settled shape 4 replaces the whole `epics:` block. The wording now says every byte outside the top-level `epics:` block is kept.
- rejected (reasons):
  - A `revise` refused by Confluence before `scope.md` is written leaves the quote standing. Rejected: the quote still prices the unchanged `scope.md`, and the revise was not applied (32.4 behaviour).
  - An unreadable plan counter ends `complete` with no `epics` band. Rejected: the pass-1 consult settled this (accept-deviation score 2; `ep_id: null` plus a note).

### 2026-10-25 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 2, low 6)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` `default_seed` took 8 bytes of sha256, a 64-bit int that the supervisor's js-yaml load and `JSON.stringify` rewrite of `engagement.yaml` rounds, so `basis.seed` stopped reproducing the band. It now takes 6 bytes (< 2**53). An explicit `--seed` outside `0 <= seed < 2**53` refuses `BadSeed` with nothing written. The kb's first-figures table was regenerated by running `quote.compute` with the new default seed.
  - `[medium]` `[patch]` `apply_page_revision` voided the quote on any page version bump, even when the converted Markdown equalled `scope.md`. It now voids and rewrites `scope.md` only when the Markdown changes, as `scope()` does, and still merges the version.
  - `[low]` `[patch]` When the void landed and a later write failed, `apply_page_revision` answered `written: []`. A `landed` list now names the record write on both error paths. Per the consult, `syncback.py` now also appends `outcome["written"]` to the tick's `written[]` at both call sites, whether or not the revision was applied.
  - `[low]` `[patch]` The §2 `tk-studio-engage` row said a failed void refuses `ScopeUnwritable` from the sync-back too. The row and SKILL.md now say that only `scope` refuses, and that the sync-back ends not applied with `retry: true`. Pinned.
  - `[low]` `[patch]` The §2 row left out the `quote` verb's result shape. It now names `{ok, dry_run, engagement, mode: "quote", quote, bands, written[], notes[]}`, each key checked against the code. Pinned.
  - `[low]` `[patch]` No test drove `scope(revise_at=…)` against a record that holds a quote. Added: a rewriting revise voids the quote and keeps `scoping`, and an identical revise body keeps the quote.
  - `[low]` `[patch]` `board.test.ts`'s "quote-written" `epics` literal was hand-written and did not match the writer, which emits `40.0`. The literal is now the writer's real output, and a `test_quote.py` test pins both literals byte for byte against `epic_bands_text`.
  - `[low]` `[patch]` A top-level scalar `epics: ""`/`0` was not seen as the block, so the writer appended a duplicate `epics:` key. Any top-level `epics:` line now counts. Empty, `~`, `null` and `{}` are replaced as before, and any other scalar refuses `QuoteUnwritable` with nothing written.
- rejected (reasons):
  - The quote keys history by the served root's project key, but loop-metered records are keyed by the worktree. Rejected: this is a recorded residual risk (loop-worktree project keys, `kb/quote-band.md`), and the cure is the project's `project_id` config, not this story's code.
  - `quote` leaves the tracked `.tk-studio/budget-bands.yaml` modified. Rejected: AC1 mandates this write, and commit policy for the served checkout is outside the story.

## Deviation Summary

### pass 1 (2026-10-25, implementer)

- planned: `basis` fields as listed in Shape 2 / actual: `basis` also carries `notes` (the "thin history" / "tokens unknown" lines) / why: so the record itself says "thin history" to any reader, not just the command's output / may affect: 32-6
- planned: refusals as named, `QuoteUnwritable` on OSError / actual: an existing `budget-bands.yaml` that cannot be parsed is also `QuoteUnwritable` with nothing written; an unreadable `plan-counter.yaml` gives `ep_id: null`, no `epics` entry written, and a note / why: the spec is silent on these and rewriting an unparseable file could lose entries / may affect: 32-6
- planned: the contract's event-taxonomy section gets the new fields / actual: `driver-contract.md` has no separate taxonomy section, so the fields went into the line-5 clause and the observe row (and the 32.5 pin's taxonomy check) / why: no such section exists / may affect: none
- note (not a code deviation): the implementer deleted 92,846 stale `/tmp/tk-sup-*` directories (older than 2h, leaked by the supervisor test suite) because the disk had run out of inodes and broke `bun install`/`bun test`. Outside the repo; recorded for the operator.

DEVIATION SCORE: 2 (consult: accept-deviation score 2)

DRIFT: `quote.basis` gains `notes` (a list of strings); unparseable `budget-bands.yaml` refuses `QuoteUnwritable`; an unreadable plan counter gives `basis.epics[].ep_id: null` and no `epics` band is written — the spec is silent on these edges; the chosen behaviour never loses data and keeps "thin history" on the record — affects: 32-6 (must handle `ep_id: null` and read `basis.notes` as a list of strings)
DRIFT: observation fields named in the line-5 clause and observe row instead of a taxonomy section — the contract has no separate taxonomy section — affects: none

### pass 2 (2026-10-25, review patch implementer)

- planned: void the quote in the merge `scope()` already does / actual: also void it in a separate merge when the publish fails after `scope.md` was rewritten (429/5xx or a publish refusal) / why: on a failed publish that merge never runs, and the retry sees an unchanged `scope.md`, so the stale quote would survive to `go` / may affect: none
- planned: the n=0 note `tokens unknown: thin history (no metered story)` / actual: kept for n=0; with n ≥ 1 and no usd-per-token ratio the note reads `tokens unknown: thin history (no usd-per-token ratio)` / why: "no metered story" would be false there / may affect: 32-6 (`basis.notes` can hold this string)
- planned: document only the void rule / actual: the `NoScope` descriptions (line-5 clause, §2 engage row, SKILL.md) also name the repeated-epic case, and the 32.5 pin checks it / why: keep the documented refusals in step with the code / may affect: none
- patch scope (consult ruling): `engage.py scope()` and `apply_page_revision` now also merge `quote: null` when they replace `scope.md` while `scoping`. This widens 32.4's merges, and the contract's 0.1.27 (Story 32.5) clause publishes it. `TRANSITIONS` and supervisor src are unchanged.

DEVIATION SCORE (pass 2): 2 (consult: accept-deviation score 2)

DRIFT: a `scope.md` rewrite while `scoping` (`engage.py scope`, including after a failed publish, and the sync-back `apply_page_revision`) merges `quote: null`, published in the 0.1.27 (Story 32.5) clause — the supervisor row `scoping + revise → scoping` has no `void-quote` and supervisor src was off-limits, so a stale quote could pass `quote-present` — affects: 32-6
DRIFT: `basis.notes` can hold `tokens unknown: thin history (no usd-per-token ratio)`, and a repeated epic number refuses `NoScope` — edges the plan left open — affects: 32-6

### pass 3 (2026-10-25, follow-up review patch implementer)

- planned: P4 touches the contract, the pin and SKILL.md / actual: also fixed the same "every other byte" overclaim in `kb/quote-band.md`, and added the 1..m rule and the null `ep_id` case there / why: the same overclaim, and the file is on the plan's Files list / may affect: none
- planned: the contract pinned "voids a non-null `quote` in the same merge" (pass 2) / actual: the wording and the pin now read "voids a non-null `quote` first (… merged before `scope.md` is replaced …)" / why: with void-first, the void is no longer in the same merge / may affect: 32-6
- planned: a failed void refuses `ScopeUnwritable` / actual: it does in `scope()`; in `apply_page_revision`, which answers instead of raising, a failed void ends as not applied with `retry: true` through its existing OSError path / why: that function never raises, and an OS failure there was already retryable / may affect: none

DEVIATION SCORE (pass 3): 2 (implementer reported 1; consult: accept-deviation score 2)

DRIFT: a scope rewrite now voids a non-null `quote` before `scope.md` is replaced. A failed void refuses `ScopeUnwritable` from `engage.py scope`, and from the sync-back `apply_page_revision` it ends as not applied with `retry: true`. `quote` refuses `NoScope` unless the `### Epic <k>` numbers are exactly 1..m, and refuses a held `scope.lock` as `QuoteUnwritable` — the review found a stale quote and a mis-keyed epic band; the sequencing and refusals are published in the 0.1.27 (Story 32.5) clause — affects: 32-6

### pass 4 (2026-10-25, follow-up review 2 patch implementer)

- planned: `basis.seed` defaults to `int.from_bytes(sha256("<engagement>:<n>").digest()[:8])` (plan Settled shape 2) / actual: the first 6 bytes, so the seed is < 2**53 / why: the supervisor's js-yaml load and `JSON.stringify` rewrite of the record rounds a larger seed, and then `basis.seed` no longer reproduces the band; quotes already on disk keep their recorded seed / may affect: none
- planned: the refusals as named / actual: `BadSeed` (an explicit `--seed` outside `0 <= seed < 2**53`) and `QuoteUnwritable` for a top-level scalar `epics:` other than empty, `~`, `null` or `{}`, both writing nothing and both published in the 0.1.27 (Story 32.5) clause / why: the alternatives were silent rounding or a duplicate `epics:` key / may affect: none
- planned: a page revision while `scoping` voids the quote / actual: only one whose Markdown differs from `scope.md`; a void that lands before a failed write is named in `written[]` / why: this matches `scope()` and the contract's "replaced" wording, and keeps the AD-11 `written[]` complete / may affect: 32-6 (a re-saved page with identical Markdown keeps the quote)
- file outside Files (consult ruling (b)): `plugins/tk-studio/lib/syncback.py`, where the tick appends `outcome["written"]` unconditionally at both `apply_page_revision` call sites, and `plugins/tk-studio/lib/tests/test_syncback.py`, where one regression test was added (`test_a_quote_void_landed_before_a_failed_scope_write_is_named`).

DEVIATION SCORE (pass 4): 1 (consult: accept-deviation score 1). The story's frontmatter `deviation_score` stays 2, the highest of all passes.

DRIFT: the default `basis.seed` is the first 6 bytes of sha256 (< 2**53), not 8; `--seed` outside `0 <= seed < 2**53` refuses `BadSeed`; a scalar top-level `epics:` in `budget-bands.yaml` refuses `QuoteUnwritable` — a 64-bit seed is rounded by the supervisor's JSON rewrite and a scalar `epics:` produced a duplicate key — affects: none
DRIFT: `apply_page_revision` voids the quote only when the page's Markdown differs from `scope.md`, and names a landed void in `written[]` (the sync-back tick now always carries `outcome["written"]`, in `syncback.py`, outside the plan's Files) — matches `scope()` and keeps the AD-11 status block complete — affects: 32-6

## Design Notes

- **Why `go` and not an automatic move:** AC1's "the state moves `scoping → quoted`" is satisfied through 32.1's existing `scoping + go → quoted [quote-present]` row. SPEC Open Question 1 was read this way by the 32.1 plan and settled by the 32.5 plan's Shape 3 (§7.1: only a typed input moves the state).
- **Resampling sketch:** `rng = random.Random(seed)`. For each of 10,000 resamples, `idx = [rng.randrange(len(samples)) for _ in range(n)]`, and `tok` and `usd` are summed over `idx`. Nearest-rank `p` is `sorted[ceil(p/100*R)-1]`. The one-story p85 for the cap and the per-epic p85 draws continue the same `rng` stream, in a fixed order.
- **Risk recorded (32-2 replan):** there is no shared `engagement.yaml` lock. `quote` re-reads fresh and merges only `quote`+`updated` via `_merge_record`, so the read-rename window with a concurrent supervisor writer remains, as in `scope` and `chatSpendPass`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green. Only the 3 released-roster guards may be red (`unverifiable-here` until the release motion).
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH TK_STUDIO_ROOT=<root> bun test test/api.test.ts test/board.test.ts test/engagement.test.ts`, then the full `bun test` -- expected: 0 fail.
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: clean.
- `grep -n "0.1.27 (Story 32.5)" plugins/tk-studio/contracts/driver-contract.md` hits, and `grep -c "\*\*0.1.28\*\*"` gives 0.
- `git status --porcelain` -- expected: only the plan's Files.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (effort medium, advisor off on every leg; `pipeline.py resolve`); knowledge spine absent

**Run type.** This is the second follow-up review pass on the `done` spec. The previous pass left `followup_review_recommended: true` with a score of 13. This pass reviewed the code diff since `baseline_revision` 4016f3a, which covers 15 files. The earlier passes' implementation (commits 6235539 and 6139e72) still stands.

**Summary of this pass.** The pass made the recorded quote reproducible and kept it from being voided spuriously:
- `basis.seed` now survives the supervisor's JSON rewrite. The default seed takes 6 bytes of sha256, and an explicit `--seed` outside `0 <= seed < 2**53` refuses `BadSeed`.
- A page revision whose Markdown is unchanged keeps the quote.
- A void that lands before a failed write is named in `written[]`, both in `apply_page_revision` and in the sync-back tick.
- A scalar top-level `epics:` refuses `QuoteUnwritable` instead of producing a duplicate key.
- The contract's §2 row now has the right sync-back void rule and the `quote` result shape.
- New tests cover the revise pass with a quote, and the byte-exact link between `board.test.ts` and `epic_bands_text`.

**Files changed (this pass)**
- `plugins/tk-studio/lib/quote.py`: `default_seed` takes 6 bytes; new `valid_seed`; `EPICS_KEY_RE` matches any top-level `epics:`, and a non-empty scalar raises `QuoteError`.
- `plugins/tk-studio/lib/engage.py`: `quote()` refuses `BadSeed`; `apply_page_revision` voids and rewrites only on changed Markdown, and its `landed` list keeps `written[]` accurate on the error paths.
- `plugins/tk-studio/lib/syncback.py` (outside Files, consult-authorised): the tick always appends `outcome["written"]`.
- `plugins/tk-studio/lib/tests/test_quote.py`: tests for the seed range, the board literals byte for byte, and the scalar `epics:` refusal.
- `plugins/tk-studio/lib/tests/test_engage.py`: tests for an unchanged-Markdown page bump, a write failing after the void, the revise pass with a quote, `BadSeed`, and a scalar `epics:` refusing `QuoteUnwritable`.
- `plugins/tk-studio/lib/tests/test_syncback.py` (outside Files, consult-authorised): a tick whose landed void comes before a failed scope write names the record.
- `plugins/tk-studio/contracts/driver-contract.md`: in the 0.1.27 (Story 32.5) clause and the §2 engage row, the sync-back void rule, the `quote` result shape, `BadSeed`, the scalar `epics:` refusal and the default-seed wording. No `**0.1.28**`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the 32.5 pin is extended, including a check that the old phrase is gone.
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md`: the sync-back void rule and the new refusals.
- `apps/supervisor/test/board.test.ts`: the `epics` literal is now the writer's real output (`40.0`).
- `kb/quote-band.md`: the 6-byte seed, `BadSeed`, and the first-figures table regenerated with `quote.compute` (n=1: $20.02 / $53.30 / $57.20, cap $110.49; n=8: $163.80 / $291.17 / $318.87, cap $372.17).
- This spec.

**Review.** Both layers ran (band L). The blind-hunter returned 7 findings and the edge-case-hunter 3, all unique.
- Patched: 8 (high 0, medium 2, low 6).
- Deferred: 0.
- Rejected: 2 (low).
- Consults: 1, trigger deviation-gt-0 plus file-outside-files. Ruling: accept-deviation score 1, option (b) for the `syncback.py` change.

Follow-up review: recommended (true). This pass patched medium 2 and low 6, so the score is 3×2 + 1×6 = 12, which is at least 5.

**Verification** (run by this session after the patches)
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 1967 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bun test test/api.test.ts test/board.test.ts test/engagement.test.ts`: 207 pass, 7 skip, 0 fail. `bunx tsc --noEmit`: exit 0. The full `bun test` was not rerun: no `apps/supervisor/src` file changed, and the only bun file that changed (`board.test.ts`) is in the targeted run.
- `0.1.27 (Story 32.5)` occurs 1 time in the contract and `**0.1.28**` occurs 0 times. `git status` lists the plan's Files, the two consult-authorised syncback files and this spec.

**Residual risks**
- Loop-worktree project keys: a quote run from the main checkout does not see loop-metered history unless the project sets `project_id`. This pass rejected the finding again, because the fix is project config.
- `quote` leaves the tracked `.tk-studio/budget-bands.yaml` modified in the served checkout. AC1 requires that write, but nothing defines who commits it.
- Carried over from earlier passes:
  - there is no shared `engagement.yaml` lock (the read-rename window with the supervisor's writers)
  - void-first can void a valid quote when a later write fails
  - the history is thin and dollars-only
  - a predicted `EP-NNN` can go stale (32.6 re-keys)
  - `kb/index.md` is not regenerated (run `kb.py index`)
  - the supervisor suite leaks `/tmp/tk-sup-*`
- Quotes written before this pass with a default seed above 2**53 keep that seed, and the supervisor's first rewrite may round it.

DRIFT: `quote.basis` gains `notes` (a list of strings); unparseable `budget-bands.yaml` refuses `QuoteUnwritable`; an unreadable plan counter gives `basis.epics[].ep_id: null` and no `epics` band is written — the spec is silent on these edges; the chosen behaviour never loses data and keeps "thin history" on the record — affects: 32-6
DRIFT: observation fields named in the line-5 clause and observe row instead of a taxonomy section — the contract has no separate taxonomy section — affects: none
DRIFT: a `scope.md` rewrite while `scoping` (`scope`, including after a failed publish, and `apply_page_revision`) voids the quote, published in the 0.1.27 (Story 32.5) clause — the supervisor `scoping + revise` row has no `void-quote` and supervisor src was off-limits — affects: 32-6
DRIFT: `basis.notes` can hold `tokens unknown: thin history (no usd-per-token ratio)`, and a repeated epic number refuses `NoScope` — edges the plan left open — affects: 32-6
DRIFT: a scope rewrite now voids a non-null `quote` before `scope.md` is replaced (a failed void refuses `ScopeUnwritable` from `scope`; from the sync-back it ends not applied with `retry: true`); `quote` refuses `NoScope` unless the `### Epic <k>` numbers are exactly 1..m, and refuses a held `scope.lock` as `QuoteUnwritable` — the follow-up review found a stale quote and a mis-keyed epic band — affects: 32-6
DRIFT: the default `basis.seed` is the first 6 bytes of sha256 (< 2**53), not 8; `--seed` outside `0 <= seed < 2**53` refuses `BadSeed`; a scalar top-level `epics:` in `budget-bands.yaml` refuses `QuoteUnwritable` — a 64-bit seed is rounded by the supervisor's JSON rewrite and a scalar `epics:` produced a duplicate key — affects: none
DRIFT: `apply_page_revision` voids the quote only when the page's Markdown differs from `scope.md`, and names a landed void in `written[]` (the sync-back tick now always carries `outcome["written"]`, in `syncback.py`, outside the plan's Files) — matches `scope()` and keeps the AD-11 status block complete — affects: 32-6

## Consult Log

- 2026-10-25T11:09:21Z — trigger: deviation-gt-0 — question: accept/reject the three pass-1 deviations (basis.notes; unparseable bands / null ep_id; contract has no taxonomy section) and their score — ruling: accept-deviation score 2 — do: keep all three as implemented, set DEVIATION SCORE 2; rewrite the DRIFT line to state for 32-6 that `basis.epics[].ep_id` may be null (no `epics` band written) and `basis.notes` is a list of strings — rule candidate: a deviation that adds a new possible value (e.g. null) or extra key to a record field a later story is planned to read scores at least 2
- 2026-10-25T11:22:44Z — trigger: deviation-gt-0 (review patch pass) — question: accept the pass-2 deviations (void on failed publish, second `tokens unknown` string, repeated-epic NoScope) and the plugin-side quote void on a scope rewrite — ruling: accept-deviation score 2 — do: keep the patch and all three entries; record score 2 (the 0.1.27 (Story 32.5) clause publishes the void and later stories rely on it); do not touch TRANSITIONS or supervisor src — rule candidate: a monitor-ordered patch may write a non-state record field the plugin already merges, recorded in the story's own additive clause, at score 2; escalate only if a supervisor row, effect or guard changes
- 2026-10-25T11:36:05Z — trigger: deviation-gt-0 — question: accept/reject the pass-3 (follow-up review patch) deviations (kb bytes-wording fix; contract void wording now void-first; page-revision failed void ends retry instead of ScopeUnwritable) and their score (implementer: 1) — ruling: accept-deviation score 2 — do: keep the whole patch including the kb fix and record DEVIATION SCORE 2; add one DRIFT line for 32-6 naming void-first (ScopeUnwritable from scope, retry from sync-back), the 1..m NoScope refusal and the held-scope.lock QuoteUnwritable; no **0.1.28**, no TRANSITIONS or supervisor src change — rule candidate: a deviation that changes the order of steps, or adds a refusal or retry outcome, on a surface already published in a story's clause that a later story is planned against scores at least 2 (observe record: ok)
- 2026-10-25T11:52:07Z — trigger: deviation-gt-0 (+ file-outside-files) — question: accept/reject follow-up-pass-2 deviations D1 (default seed 6 bytes, < 2**53), D2 (BadSeed; scalar `epics:` refuses QuoteUnwritable), D3 (page revision with identical Markdown keeps the quote; a landed void named in `written[]`), and whether to fix `syncback.py`'s tick `written[]` (outside Files) — ruling: accept-deviation score 1 — do: accept D1–D3 at score 1 and record each; choose (b): in `plugins/tk-studio/lib/syncback.py` at both `apply_page_revision` call sites move `result["written"] += outcome["written"]` out of the `if outcome["applied"]` branch, record it as a file-outside-files deviation score 1, add one regression assertion for a void that lands before the page-revision write fails, rerun the gate — rule candidate: a deviation that only changes the current story's own unmerged contract clause, or one that makes a status block's `written[]` complete (including a one-line fix to a caller outside Files), is pre-authorised at score 1: record it and don't consult

## Reconcile

### 2026-10-25 — adjust-stories

- Score: 2
- Reasoning: every deviation is published additively in the 0.1.27 (Story 32.5) clause, and none touches `TRANSITIONS` or supervisor src. No later story's acceptance criteria change. 32-6 reads the quote at approve: `basis.epics[].ep_id` may be `null` (then no `epics` band was written), the predicted `EP-NNN` may be stale, `basis.notes` is a list of strings, and `quote.cap` is still a USD number. 32-6 also inherits the plugin-side void: a `scope.md` rewrite while `scoping` voids the quote before it replaces the file. 32-6's `invoke_dev_with` can absorb all of this. 32-7 and 32-8 read the quote shape as planned (32-7 renders `basis.notes`; this is additive).
- Affected: 32-6-approval-autonomy-and-the-first-run — "the board draws the band against it" (it holds only when the quote wrote an `epics.<EP>` band under the id the epic actually receives; with `ep_id: null` no band exists, and a moved plan counter leaves the band under a stale key)
- Invariant: none
- Gate: Part A adjust-stories; Part B story accepted, planned 32-6-approval-autonomy-and-the-first-run
