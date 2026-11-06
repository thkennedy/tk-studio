---
title: "The Sweep's Bugs and Cost Lines Before a Fourth Sweep"
type: 'bugfix'
created: '2026-11-06'
status: 'done'
baseline_revision: '0557d3fbaa0eca72e4f117cb19f0b595401d79dd'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-37/plans/37-5.md'
  - '{project-root}/_bmad-output/specs/spec-epic-37/SPEC.md'
warnings: [multiple-goals, oversized]
deferred: []
---

> **Serve-process change.** `hostleg.ts`, `sweep.ts`, `worktree.ts`, `planstatus.ts`, `api.ts`, `board.ts`, `inbox.ts` run inside `serve`: the operator stops the supervisor tab before the loop builds `apps/supervisor` and restarts it through the scheduled task after the merge.

<intent-contract>

## Intent

**Problem:** The sweep's end rules (Stories 36.2, 36.3) are proven under fakes only, and the Epic 36 retrospective found three end-rule bugs (B3: a green re-run over `POST /runs/{id}/verify` marks a paused sweep's WIP draft ready; B4: the ledger pass waits for ever on an id that never flips; B5: the paused-sweep stop deadline never starts when the status probe answers `unknown` from the start) and cost holes (DW-136, DW-137, DW-138, DW-139, DW-144) that a fourth sweep must not meet.

**Approach:** Fix each with a pinned fake in the supervisor and lib suites, price the engine's own `sweep-triage` session, name the rules in the 0.1.32 contract (additive), and name the fourth sweep's prerequisites and operator path in one handoff update — `max_runs` stays Tim's.

User story: As the operator, I want the sweep's three end-rule bugs fixed (a passing re-run never marks a half-finished sweep's draft ready, a ledger wait on an id that never flips ends with a line, the stop deadline starts on an `unknown` probe) and its cost lines whole (the engine's own `sweep-triage` session priced, the triage emit ordered and retried, the re-run count derived after the event is noted, the late-closed readers returning the full line), so that the fourth sweep, once Tim raises `max_runs`, runs on rules proven by tests, not by the sweep (AI-5; DW-136 to DW-139, DW-144; the retrospective's B3, B4, B5).

**Acceptance criteria (verbatim, authoritative):**

- **AC1.** **Given** a paused sweep whose WIP was committed on the run branch (Story 36.3) and a re-run over `POST /runs/{id}/verify` **When** the re-run goes green **Then** the draft stays a draft while the sweep's record names a bundle unfinished (B3: ready only when every bundle landed or the operator passes `ready: true`), the ledger pass's wait on an id that never flips ends after `SWEEP_LEDGER_WAIT` with a `ledger-resolve {pending: [...], ended: "wait"}` line and a notifier line (B4), and the stop deadline's clock starts on the first `unknown` probe as well as the first `error` note (B5, `sweepStopPastDeadline`)
- **AC2.** **Given** the sweep's cost lines **When** the close-out prices the engine **Then** the engine's own `sweep-triage` session is priced into `engine_cost_usd` and `total_cost_usd` (DW-136), `emitTriage` patches the note before it appends the ledger line and retries a failed emit on the next tick until it lands (DW-137, DW-144), `judgeJobRun` derives `n` after the `host-verify` event is noted (DW-138), and `runCost`/`jobRunCosts` keyed by the bare run id return the full line on a late-closed sweep (DW-139); the supervisor suites pin each with fakes; the contract names the rules (0.1.32, additive)
- **AC3.** **Given** the `run-sweep` instance's `stop.max_runs` (3, spent) **When** this story lands **Then** the handoff names the fourth sweep's prerequisites met except the figure (Tim's call: `max_runs` raised in `.tk-studio/jobs/run-sweep.json`) and the operator path (no `resume` on a paused sweep; cancel keeps landed bundles) in one place; the entries close by this PR

## Boundaries & Constraints

**Always:**
- Settled shapes from SPEC design notes CAP-13/14/15 and plans/37-5.md "Settled shape" 1-3 are the design (see Design Notes); do not re-decide them.
- Contract: header stays 0.1.33. Add the 37.5 clause (and `, Story 37.5` in the 0.1.32 row entry) after 37.4's and before `0.1.33 (DW-170, additive)`; the `**0.1.32 (Story 37.5, additive).**` paragraph after 37.4's paragraph and before DW-170's. Supersede 36.2's "is not priced" sentence by statement — never edit 36.2's pinned text (`test_driver_contract.py` pins it). New test `test_0_1_32_story_37_5_…` after `test_0_1_32_story_37_4_…` and before `test_0_1_33_dw_170_…`.
- Close DW-136, DW-137, DW-138, DW-139, DW-144 in `deferred-work.md` as `status: resolved 2026-11-06 by Story 37.5` (re-grep by id; never "by this story's PR").
- Every text-mode open names `encoding="utf-8"`; every `bun test` names `--timeout 30000`; lib stays stdlib-only; writes atomic.
- A missing id stays `pending` (no `missing[]`); `:verify-n` lines stay excluded from the bare-id sum.
- Cycle rule: `sweep.ts` never value-imports `hygiene` or `worktree`; the notifier reaches `ledgerPass` as an injected `notify` callback from `planstatus.mergePass`.

**Block If:**
- A WIP `wip:` tip and a record that reads every bundle `landed` disagree in a way the design note (hold on a `wip:` tip too) does not cover → consult (`bad_spec`).
- A consumer needs a number where the triage session's usage is absent (design: `usd: null`, line `not metered`, never a refusal of `price-run`) → consult.
- `ledgerPass` cannot revisit a terminal sweep run for the emit retry without a new tick path (never a background timer) → consult (`deviation-gt-0`).
- The Files list grows past the plan's band → `halt` consult.

**Never:**
- Edit `max_runs` in `.tk-studio/jobs/run-sweep.json`; submit a `run-sweep`; push, tag, PR, release.
- An `engine-stop` note to start the B5 clock (`engineEndStatus` reads it as the supervisor's own stop).
- Edit `epics.md`, plan files, `stories.yaml`, routing/policy toml, anything under `supervision/`.
- Fix the baseline `guards.test.ts` sbx-argv failures (2 cases, carried).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| B3 held | sweep run, record bundle `b` `landed: false` (or no triage, or `wip:` tip), draft PR, green re-run | no `gh pr ready`; `rerun.pr_ready: "held: b not landed"` (held reason names the cause) | — |
| B3 all landed | every bundle landed, no `wip:` tip, green re-run | `markPrReady` → `pr_ready: "marked"` | — |
| B3 override | `POST /runs/{id}/verify` body `{ready: true}` | ready flip; `rerun.ready_override: true` | body `{ready: "x"}` or extra keys → `400 SchemaError` |
| B4 bound | unchanged fingerprint waiting past `SWEEP_LEDGER_WAIT_MS` (60 min from first waiting record's `at`) | one `ledger-resolve {…, waiting: false, settled: true, ended: "wait", pending}` record + one notifier line; never again | changed `pending` set → new record, new clock |
| B5 unknown from start | probe answers `unknown`, never paused, no `engine-stop` | one `engine-probe {engine_run_id, phase: "unknown", error}` note per engine run; past `SWEEP_STOP_DEADLINE_MS` from earlier of probe/`engine-stop` error `at` → deadline path | a `running` probe does not reset |
| DW-136 | run dir `state.json` with `sweep-triage`, `sweep-triage-<N>`, `sweep-migrate` sessions | `price_run` `triage {usd, source: "sessions", bound: "upper"}`; `usd_total` includes it; `engine_cost_usd`/`total_cost_usd` include it; `- triage: $x (sessions)` line | no model and no `triage` leg → `usd: null`, line `not metered` |
| DW-137/144 | emit fails | note patched `ledger: "emitting"` before emit, then `emitted` or `error: …`; `ledgerPass` retries `emitting`/`error` on terminal sweep runs next tick until it lands | bounded by `PLAN_RETRY_LIMIT` errors; never doubled after `emitted` |
| DW-138 | judge after host-verify | event noted first; `n` = count including this event; `patchEventDetail(seq, {rerun: {...rerun, job_run}})` | a failed note never reuses `n` |
| DW-139 | late-closed sweep with own + `:engine` lines | `runCost(file, "s-2")` / `jobRunCosts` by bare id = own + `:engine` (e.g. 4.25, was 0.5) | `:verify-n` excluded |

</intent-contract>

## Code Map

The full investigation is `plans/37-5.md` `## Code Map` (context file) — read it; anchors re-checked against `0557d3fb` and current within ±1 line. Key anchors:

- `apps/supervisor/src/hostleg.ts` -- `rerunHostLeg` :242 (add `ready` opt), `judgeJobRun` :289 (note first), `runLeg` :303, ready flip :344; `isSweep`/`summaryFromRecord` imported :63; `HostLegRerun` :82-100.
- `apps/supervisor/src/api.ts` -- `postVerify` :795-814 (body `{}` or `{ready?: boolean}`), seam `deps.verify` :184/:340, header :25-32.
- `apps/supervisor/src/sweep.ts` -- header :34-62; `SWEEP_STOP_DEADLINE_MS` :86 (add `SWEEP_LEDGER_WAIT_MS` beside it); `emitTriage` :208-224; `summaryFromRecord`/`sweepRecord` :393-437; `engineCostOf` :446, `withEngineCost` :463, `sweepTotalCost` :486, `sweepCostText` :493; `sweepStopPastDeadline` :514; `ledgerSettled` :540; `ledgerPass` :543 (early skip :556-557, wait :594, patch :604-611).
- `apps/supervisor/src/worktree.ts` -- `engineStatus` :928-948; `sweepEngines` unknown branch :1070-1083 (`engine-probe` note at :1078); cost sums :1027/:1037-1040/:1152/:1185/:1188/:1199-1206; `emitTriage` callers :1026/:1062.
- `apps/supervisor/src/planstatus.ts` -- imports `notifier`/`sendText` (:106-108 area), `mergePass` → `ledgerPass` at :523; header :101-104.
- `apps/supervisor/src/inbox.ts` `runCost` :146-159; `board.ts` `jobRunCosts` :195-209; `cli.ts` cancel :1232-1250, `verifyVerb` :2765 (optional `--ready`).
- `plugins/tk-studio/lib/meter.py` -- `price_run` :879-908, `_bundle_keys` :826-848, `_session_usd` :851-876, `ROLE_LEGS` :87, docstring :41-48.
- `plugins/tk-studio/contracts/driver-contract.md` -- 0.1.32 row lines 5-6; 37.4 paragraph → insert after; verify body :376-379; 36.2 text :2142-2172, 36.3 :2245-2249.
- `plugins/tk-studio/contracts/conformance/e2e_run_sweep.py:48` -- `FILTER` gains `|Story 37.5`.
- Tests: `apps/supervisor/test/sweep.test.ts` (emit :570-598, :587 flips; wait :600-695; readers :944 flips to 4.25; 36.3 block :1026-1222), `hostleg.test.ts` (flip :118, sweep fixture :470-485, judge :601-635), `api.test.ts:1233-1256`, `inbox.test.ts:131-141`; `plugins/tk-studio/lib/tests/test_meter.py` `PriceRunTest` :1061 (:1088-1096 flips), `test_driver_contract.py` (shape `test_0_1_31_story_36_2_…` :3069-3105).
- Docs: `apps/supervisor/README.md` :56, :239; `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md` (one top update); `.tk-studio/jobs/run-sweep.json` description only (optional); `_bmad-output/implementation-artifacts/deferred-work.md`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostleg.ts` + `api.ts` (+ optional `cli.ts --ready`) -- B3 hold and `ready` override; DW-138 note-first judge -- AC1, AC2.
- `apps/supervisor/src/sweep.ts` + `planstatus.ts` -- `SWEEP_LEDGER_WAIT_MS`, bound checked before the skip, `ended: "wait"` + injected `notify`; `sweepStopPastDeadline` reads the earlier of `engine-probe`/`engine-stop` error; emit order `emitting`→emit→`emitted`/`error` and `ledgerPass` retry on terminal sweeps; triage cost fields and `- triage:` line -- AC1, AC2.
- `apps/supervisor/src/worktree.ts` -- once-per-engine-run `engine-probe` note at the unknown branch; totals include triage -- AC1, AC2.
- `apps/supervisor/src/inbox.ts`, `board.ts` -- bare-id lookup = own + `:engine` -- AC2.
- `plugins/tk-studio/lib/meter.py` -- `triage` member of `price_run` -- AC2.
- Tests: `sweep.test.ts`, `hostleg.test.ts`, `api.test.ts`, `inbox.test.ts`, `test_meter.py`, `test_driver_contract.py` -- one case per matrix row; flip the pins at sweep.test.ts:587, :944, test_meter.py:1088-1096 -- AC1, AC2.
- `driver-contract.md`, `e2e_run_sweep.py`, `taxonomy.v1.json` (only if emitter notes change), `README.md` -- the rules named (0.1.32, additive) -- AC2.
- `handoff-phase1-loop-2026-10-09.md` -- one top update `## Update (2026-11-06): the fourth sweep's prerequisites`; `deferred-work.md` -- close the five entries; optional `run-sweep.json` description wording (never `max_runs`) -- AC3.

**Acceptance Criteria:**
- Given the matrix rows, when the supervisor and lib suites run, then each row has a passing fake-backed test (AC1, AC2).
- Given the contract, when `test_driver_contract` and conformance run, then the 37.5 paragraph names B3/B4/B5, the priced triage, the ordered/retried emit, the note-first judge, the bare-id readers, `engine-probe`, `{ready?: boolean}`, and conformance is `ok: true` (AC2).
- Given the handoff, when read, then one top update names the prerequisites met except `max_runs` (Tim's, `.tk-studio/jobs/run-sweep.json`, 3 spent) and the operator path (no `resume` on a paused sweep; cancel keeps landed bundles); DW-136..139, DW-144 read resolved by Story 37.5 (AC3).

## Spec Change Log

## Review Triage Log

### 2026-11-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 0
- reject: 2: (medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` meter.py `_triage_usd`: a triage session on a model missing from the price table raised `MeterError` and refused the whole `price-run`; it now reads triage `usd: null`, and bundles stay priced (both layers)
  - `[medium]` `[patch]` sweep.ts `ledgerPass`: the DW-144 emit retry ran outside `claimPlanPhase(LEDGER_LEASE)`, so overlapping passes could double-emit; it now runs under the lease and re-reads the note
  - `[low]` `[patch]` meter.py: a partial triage sum was reported as an upper bound; any unpriceable triage session now nulls the member
  - `[low]` `[patch]` worktree.ts: the B5 notifier line claimed a paused sweep and an unanswered stop on a probe-only clock; it now names the `unknown` probe
  - `[low]` `[patch]` B4: the `ended: "wait"` notifier line and the handoff operator path now name the manual `plansync.py ledger-resolve --directory --pr --ids` remedy
  - `[low]` `[patch]` README `GET /runs/{id}` row: `cost_usd` now reads own + `:engine` (DW-139)
  - `[low]` `[patch]` driver-contract 37.5 paragraph: "keeps no `<run_id>:engine` entry" (consult's optional DO line), plus the patched rules, pinned in `test_0_1_32_story_37_5_…`
- rejected:
  - `[medium]` B5: a transient early `unknown` probe leaves a never-reset `engine-probe` clock, so a later `unknown` past 30 min stops the engine; it also shortens the paused-stop retry window. Rejected: AC1 says verbatim that the clock starts on "the first `unknown` probe as well as the first `error` note", and the SPEC CAP-13 design note says a `running` probe does not reset it. Carried as a residual risk.
  - `[low]` hostleg.ts: `queue.events` throwing after a successful note. Speculative queue plumbing, not behaviour the criteria name.

### 2026-11-06 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 1, medium 1, low 2)
- defer: 0
- reject: 6: (medium 2, low 4)
- addressed_findings:
  - `[high]` `[patch]` worktree.ts B5 probe-only path: a stop answered `stopped` noted no `engine-stop`, so the next tick's `stopped` end was penalised by `engineEndStatus` and no WIP was committed; it now notes `engine-stop {engine_run_id, stopped: true, engine}` once per engine run (the paused branch's rule), the unanswered case still writes none; comments, the contract's B5 sentence and its pin reworded (version stays 0.1.33); new test pins the WIP commit and the unpenalised end (edge-case-hunter; consult ruling apply, option A)
  - `[medium]` `[patch]` sweep.ts DW-144: an `emitting` note was retried every ledger pass with no bound (a post-emit patch that keeps failing re-emitted the `sweep-triage` line each tick); `triageEmitDue` now bounds `emitting` by `ledger_errors < PLAN_RETRY_LIMIT` and a retry of an `emitting` note counts into `ledger_errors` in its marker before the emit; header, contract sentence and a pin updated; new test pins at most `PLAN_RETRY_LIMIT` re-emits (both layers)
  - `[low]` `[patch]` sweep.ts B4 `endLedgerWait`: the notifier's manual remedy now quotes `--directory "<root>"` (a Windows root with spaces); the B4 line test updated (blind-hunter)
  - `[low]` `[patch]` README `POST /runs/{id}/verify` row: says the cli `verify` verb takes no ready override (a sweep's draft held the same, `pr_ready: "held: …"`; the override is the API body `{ready: true}`) (blind-hunter)
- rejected:
  - `[medium]` B5: one early transient `unknown` probe starts a never-reset clock. Rejected again, as in the first pass: AC1 verbatim and SPEC CAP-13; carried as a residual risk.
  - `[medium]` B4: the 60-min clock restarts or never fires when the owner ledger's fingerprint changes. Rejected: on the same `pending` set the record is patched with the new fingerprint (`seen`, sweep.ts ledgerPass), keeping its `at`, so the clock neither restarts nor stalls past the next unchanged tick.
  - `[low]` DW-138: the judge's cost is dropped when the `host-verify` note fails. Rejected: the leg throws on a failed note (the lease released); the criteria name the ordering, which holds.
  - `[low]` DW-138: a later leg's event could be counted in `n`. Rejected: `n` is counted synchronously right after the note, before any await; no other leg's note can interleave in one process.
  - `[low]` the triage cost line ignores `source` and does not say `upper`. Cosmetic.
  - `[low]` hostleg.ts: `queue.events` throwing after a successful note. Rejected in the first pass as speculative queue plumbing; same reason.

### 2026-11-06 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 5: (medium 2, low 3)
- addressed_findings:
  - `[medium]` `[patch]` worktree.ts B5 probe-only path: once a stop had answered `stopped` (noted `engine-stop {stopped: true}`), a probe that kept answering `unknown` re-sent `launch.py stop` every tick and `continue`d, so the run never ended (no `blocked` end, no line, lock and pin held). Now, past the deadline, a later tick whose probe is still `unknown` sends no second stop and ends the run `blocked` through the `stopUnanswered` path ("asked once more, then the `blocked` end", DW-121). The notifier's `asked` now reads an `engine-stop` note carrying `error`, so this case's line names the probe. The intermediate "stopped again" tick was dropped from the probe-only `stopped` test, and a new test pins the `blocked` end: one stop, one note, the probe line, WIP committed, worktree kept. The comments, the sweep.ts header and the contract's B5 sentence were reworded and 3 pins added; the version stays 0.1.33. Found by both layers, merged.
  - `[low]` `[patch]` hostleg.ts DW-138: a throw from the `seq` lookup after a successful `host-verify` note released the lease and rejected the re-run, dropping the judge's verify-n cost line. The lookup now has its own try: `seq` is left undefined, the judge still emits, and the event patch is skipped. A new test is in hostleg.test.ts (edge-case-hunter). This reverses the two earlier passes' "speculative plumbing" reject: the consequence is a lost cost line in DW-138's area, which AC2 names.
- rejected:
  - `[medium]` B5: one early transient `unknown` starts a never-reset clock that later stops a running engine (edge-case-hunter). Rejected as in both earlier passes: AC1 verbatim, SPEC CAP-13, matrix "a `running` probe does not reset". Carried as a residual risk.
  - `[medium]` B5 × DW-121: an old `engine-probe` note shortens a later paused stop's 30-min retry window (edge-case-hunter). Rejected: the settled shape (CAP-13; matrix "earlier of probe/`engine-stop` error `at`"; the contract) measures from the earlier note. This is the same root as the reject above. Carried as a residual risk.
  - `[low]` DW-144: an `emitting` marker patch that throws leaves the note with no `ledger`, and the run closing out on that same tick never retries it (blind-hunter). Rejected: it needs a queue that throws on the marker write yet takes the close-out's writes on the same tick. Widening `triageEmitDue` to a `ledger`-less note would back-emit every pre-36.2 terminal sweep's triage. Carried as a residual risk.
  - `[low]` DW-144: no give-up record or notifier line once `PLAN_RETRY_LIMIT` emit retries run out (blind-hunter). Rejected: the matrix names the bound ("bounded by `PLAN_RETRY_LIMIT` errors") and no give-up line; the note keeps `ledger: "error: …"` and `ledger_errors`.
  - `[low]` B4: an intervening retryable-error `ledger-resolve` record makes the next waiting answer a new record, restarting the 60-min clock (blind-hunter). Rejected: each restart needs an owner-ledger change plus an error, the errors are bounded by `PLAN_RETRY_LIMIT`, and the matrix reads a record other than the same wait as a new wait.

## Design Notes

Settled (SPEC.md design notes, verbatim intent):
- **CAP-13:** B3 — `runLeg` holds the ready flip for a sweep run whose record names a bundle `landed: false`, has no triage, or whose tip is a `wip:` commit (`rerun.pr_ready: "held: <bundle> not landed"`) unless the verify carried `{ready: true}` (`rerun.ready_override: true`). B4 — `SWEEP_LEDGER_WAIT_MS = 60 min` from the first waiting record's `at` on an unchanged fingerprint, checked before the unchanged-fingerprint skip; on expiry one record `{…, waiting: false, settled: true, ended: "wait", pending}` and one notifier line via the injected `notify`. B5 — once-per-engine-run `engine-probe {engine_run_id, phase: "unknown", error}` note; `sweepStopPastDeadline` takes the earlier `at`.
- **CAP-14:** `triage {usd, source: "sessions", bound: "upper"}` in `price_run` (never a bundle); `sweepRecord.triage_cost_usd?`; emit marker `ledger: "emitting"` (a crash between marker and emit is retried: one possible duplicate line, never a lost one); `ledgerPass` retries on terminal sweep runs under `PLAN_RETRY_LIMIT`; judge notes first; bare-id readers own + `:engine`.
- **CAP-15:** one handoff top update naming B3-B5 and DW-136..139/144 fixed, `max_runs` Tim's, and the operator path.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger tests.test_meter tests.test_driver_contract` -- expected: OK
- `cd apps/supervisor && bun test --timeout 30000` -- expected: all pass except the 2 baseline `guards.test.ts` sbx-argv cases
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: clean

## Deviation Summary

### pass 1 (2026-11-06, implementer)

- planned: Files list (plan's band) / actual: also edited `plugins/tk-studio/contracts/conformance/manifest.json` (the `e2e_run_sweep` entry's note names the `|Story 37.5` filter and its cases) / why: that note quotes the drive's filter, which would otherwise be stale / may affect: none
- planned: only the pins at sweep.test.ts:944 and test_meter.py:1088-1096 flip / actual: `jobRunCosts` folds the `:engine` line into the bare id's entry and drops the separate `:engine` key, so the pin `costs.get("s-2:engine")` (sweep.test.ts:940) now expects `undefined`; the map total stays 8.5 and `spendByEpic` stays 4.25 / why: keeping both keys would double-count in every consumer that sums the map's values / may affect: none
- planned: note shape `ledger: "emitting" | "emitted" | "error: …"` / actual: the `sweep-triage` note also gains `ledger_errors: <n>`; `emitTriage` gains `opts.retry`; `ledgerPass(queue, deps, notify?)` gains a third parameter; new exports `SWEEP_ENGINE_PROBE`, `SWEEP_LEDGER_WAIT_MS`, `noteEngineProbe`, `triageEmitDue`, `LedgerNotify` / why: the retry bound needs an error count, and nothing else carries one on a terminal run / may affect: none
- planned: held reason `held: <bundle> not landed` / actual: that form (comma-joined when several), plus `held: no triage recorded` and `held: the tip is a WIP commit (<subject>)` / why: the matrix asks the held reason to name its cause; only the bundle form was given / may affect: none
- planned: sweep.test.ts:587 "never thrown nor retried" flips / actual: retitled "not retried by the live tick", also asserts `ledger_errors: 1`; the retry is pinned in a new DW-144 test / why: the live tick still never retries (the ledger pass does once the run ends) / may affect: none

DEVIATION SCORE: 1

DRIFT: conformance `manifest.json` `e2e_run_sweep` note updated (file outside Files) — the note quotes the drive's filter, stale otherwise — affects: none
DRIFT: `jobRunCosts` folds `:engine` into the bare id and drops the `:engine` key — keeping both double-counts in summing consumers — affects: none
DRIFT: `sweep-triage` note gains `ledger_errors`; `emitTriage`/`ledgerPass` gain an option/parameter; new exports — the retry bound needs an error count on a terminal run — affects: none
DRIFT: held reasons for no-triage and `wip:` tip added beside `held: <bundle> not landed` — the matrix asks the reason to name its cause — affects: none
DRIFT: sweep.test.ts:587 retitled rather than flipped — the live tick still never retries; the ledger-pass retry has its own test — affects: none

### pass 2 (2026-11-06, implementer, review patches)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 3 (2026-11-06, implementer, follow-up review patches)

Files touched: `apps/supervisor/src/worktree.ts`, `apps/supervisor/src/sweep.ts`, `apps/supervisor/README.md`, `apps/supervisor/test/sweep.test.ts`, `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` (all within the plan's Files).

DEVIATIONS: none
DEVIATION SCORE: 0

## Consult Log

- 2026-11-06T08:03:45Z — trigger: deviation-gt-0 + file-outside-files — question: accept the five pass-1 deviations (manifest.json note; jobRunCosts drops the :engine key; ledger_errors and new seams; three held reasons; sweep.test.ts:587 retitled)? — ruling: accept-deviation score 1 — do: keep all five as built and leave the 37.5 contract paragraph (it already names the fold, ledger_errors, the held reasons, SWEEP_LEDGER_WAIT_MS, notify, engine-probe); optionally add "and keeps no `<run_id>:engine` entry" at driver-contract.md:2611 (carried to the review pass as an optional patch); carry the manifest.json edit in the Files drift line — rule candidate: when a story changes a conformance drive's FILTER, list contracts/conformance/manifest.json (that drive's note) in the plan's Files automatically
- 2026-11-06T08:33:49Z — trigger: high-severity-finding — question: follow-up review: B5's probe-only stop answering `stopped` notes no `engine-stop`, so `engineEndStatus` penalises the supervisor's own stop and no WIP commit is made — patch (A: note `engine-stop {stopped: true}`; B: exempt on `engine-probe`) or escalate? — ruling: apply — do: take option A, note `engine-stop {engine_run_id, stopped: true, engine}` before the `continue` at worktree.ts:1173 once per engine run with the paused branch's guard, and add the test (probe `unknown` from the start, past the deadline, stop answers `stopped`, next tick ends `stopped`, WIP committed, end not penalised); reword worktree.ts:1168-1169 and the contract's B5 sentence (driver-contract.md:2593-2598) so the probe path writes an `engine-stop` note only for a stop answered `stopped`, version stays 0.1.33; do not take option B — rule candidate: when a story gives a supervisor stop a new trigger, every path that calls `stopSweepEngine` and gets `stopped` writes the once-per-engine-run `engine-stop {stopped: true}` note, and its tests cover a later tick reading that stopped end

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-37-20261106T073317Z-aa7dbc` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This run was the second follow-up review of the done story. The story was implemented at 3f6d0118 and first followed up at 3e4def40. Everything those passes shipped still holds:
- B3 holds the draft, with a `{ready: true}` override.
- B4 ends the `SWEEP_LEDGER_WAIT_MS` wait with a notifier line.
- B5 starts the `engine-probe` deadline clock.
- DW-136 prices the triage session.
- DW-137/144 order the emit and retry it under the lease, bounded.
- DW-138 notes the event before the judge derives `n`.
- DW-139 makes bare-id readers return their own line plus `:engine`.
- The contract is 0.1.32 additive, with the header at 0.1.33.
- The handoff names the fourth sweep's prerequisites.

This pass patched two defects:
- **B5:** on the probe-only path, once a stop has answered `stopped`, a probe that stays `unknown` now ends the run `blocked` on the next tick, with no second stop and with the probe line. It used to re-stop every tick for ever.
- **DW-138:** a throw from the `seq` lookup after a recorded `host-verify` no longer drops the judge's cost line.

**Files changed (this pass).**
- `apps/supervisor/src/worktree.ts`: after an answered stop, a still-`unknown` probe ends the run `blocked` with no re-stop. The notifier's `asked` now reads an `error` note. Comments reworded.
- `apps/supervisor/src/sweep.ts`: the Story 37.5 (B5) header text reworded.
- `apps/supervisor/src/hostleg.ts`: the `seq` lookup has its own try; only a failed note releases the lease and rethrows.
- `apps/supervisor/test/sweep.test.ts`: the "stopped again" tick is dropped from the probe-only `stopped` test. New test: "B5: a probe-only stop that answered `stopped`, the next tick's probe still `unknown`: ended `blocked` on that tick, no second stop, the probe line".
- `apps/supervisor/test/hostleg.test.ts`: new test "Story 37.5 (DW-138): a `seq` lookup that throws after a recorded `host-verify` still emits the judge's line; …".
- `plugins/tk-studio/contracts/driver-contract.md`: the 37.5 B5 sentence reworded. The version stays 0.1.33, and the 36.2/36.3 text is untouched.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: 3 pins added to `test_0_1_32_story_37_5_…` for the new rule.

**Review findings.** Both layers ran (band L, `oversized`). The diff, about 275 KB, was handed to them as a file path, not inline. They returned 8 findings, 7 after one duplicate was merged:
- 2 patched (medium 1, low 1).
- 0 deferred.
- 5 rejected (medium 2, low 3).

No consult ran: no high finding, deviation 0 this pass, and no file outside Files.

**Follow-up review:** not recommended (`false`). The patched counts are high 0, medium 1, low 1, so the score is 3×1 + 1×1 = 4.

**Verification.** All of these ran after the patches and were re-run by this session:
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: 2910 tests, OK (4 skipped).
- From `plugins/tk-studio/lib`, `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger tests.test_meter tests.test_driver_contract`: 336 tests, OK.
- `bun test --timeout 30000` in `apps/supervisor`: 1967 pass, 2 fail. Both failures are the baseline `guards.test.ts` sbx-argv cases, carried.
- `bunx tsc --noEmit`: clean.

**Residual risks.**
- This is a serve-process change. The operator stops the supervisor tab before building `apps/supervisor` and restarts it through the scheduled task after the merge.
- B5 works as designed (AC1, CAP-13): a `running` probe never resets the `engine-probe` clock. One early transient `unknown` and a later one 30 or more minutes on stop a live engine. The same early note can also shorten a later paused stop's DW-121 retry window.
- On the probe-only path, after an answered stop, the `blocked` end comes on the next tick whose probe is still `unknown`. There is no extra grace.
- DW-144: a throw on the `emitting` marker patch on the engine's last tick, when the close-out succeeds on the same tick, loses that run's `sweep-triage` line.
- When the `emitted` patch keeps failing, up to `PLAN_RETRY_LIMIT` duplicate `sweep-triage` lines are possible, with no give-up line.
- `max_runs` is still Tim's call. No fourth sweep was submitted.

DRIFT: conformance `manifest.json` `e2e_run_sweep` note updated (file outside Files) — the note quotes the drive's filter, stale otherwise — affects: none
DRIFT: `jobRunCosts` folds `:engine` into the bare id and drops the `:engine` key — keeping both double-counts in summing consumers — affects: none
DRIFT: `sweep-triage` note gains `ledger_errors`; `emitTriage`/`ledgerPass` gain an option/parameter; new exports — the retry bound needs an error count on a terminal run — affects: none
DRIFT: held reasons for no-triage and `wip:` tip added beside `held: <bundle> not landed` — the matrix asks the reason to name its cause — affects: none
DRIFT: sweep.test.ts:587 retitled rather than flipped — the live tick still never retries; the ledger-pass retry has its own test — affects: none

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-02T21:12:25Z | 2026-11-02T21:26:53Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-06T06:29:33Z | 2026-11-06T06:30:49Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-06T07:35:46Z | 2026-11-06T08:29:03Z | f36fd429-83a1-491c-9b93-8ac38f0ed0c6 | claude-opus-5-5 | medium | 26816471 | 153128 | 13.9554 | completed |
| review | 1 | 2026-11-06T08:29:04Z | 2026-11-06T08:52:13Z | 7a3f2bba-f220-464a-9eb7-3bde4b49984e | claude-opus-5-5 | medium | 6276178 | 62163 | 5.0063 | completed |
| review | 2 | 2026-11-06T08:52:13Z | 2026-11-06T09:12:01Z | 7f9e44f4-77bd-48bc-8f36-9daea92fe8d4 | claude-opus-5-5 | medium | 7501516 | 69148 | 5.1289 | completed |
| gate | 1 | 2026-11-06T09:12:01Z | 2026-11-06T09:14:31Z | f4aebcba-a2d6-4ccc-bbaf-06d2414f9cd7 | claude-opus-5-5 | medium | 2425421 | 13167 | 1.4878 | completed |

## Reconcile

- 2026-11-06 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 37-6-one-stop-path-and-the-gates-blind-spots
