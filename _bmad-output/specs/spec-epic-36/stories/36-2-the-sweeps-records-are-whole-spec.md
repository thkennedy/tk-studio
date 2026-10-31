---
title: "The Sweep's Records Are Whole"
type: 'bugfix'
created: '2026-10-30'
status: 'done'
baseline_revision: 'e8bc43176654eb8cb4e6d4af63d914b9ef8b6a01'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-36/plans/36-2.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The engine's own `sweep-triage` session is not priced, so `engine_cost_usd` and `total_cost_usd` understate a sweep's full engine spend. Filed as DW-136.
    evidence: |-
      `meter.py` `BUNDLE_KEY_RE`; ordered by the first consult. Meets deferral rule (b): the contract paragraph states the exclusion, and the open question is the operator's.
    location: >-
      plugins/tk-studio/lib/meter.py:95
    severity: medium
  - summary: >-
      `emitTriage` appends the ledger line before patching the note, so a failed patch re-emits on the next tick. Filed as DW-137.
    evidence: |-
      Both review layers. Meets deferral rule (b): the contract says once per engine run.
    location: >-
      apps/supervisor/src/sweep.ts emitTriage
    severity: low
  - summary: >-
      `judgeJobRun` derives `n` from `host-verify` events but emits before that event is noted, so a failed note reuses a `run_id` and last-line-wins readers drop the earlier judge's cost. Filed as DW-138.
    evidence: |-
      Both review layers. Meets deferral rule (a): AC1 names the re-run judge's own line.
    location: >-
      apps/supervisor/src/hostleg.ts judgeJobRun
    severity: low
  - summary: >-
      On a late-closed sweep, `runCost` and the bare-id `jobRunCosts` readers return the worker-only own line, so API and delivery `cost_usd` read less than the PR body. Filed as DW-139.
    evidence: |-
      Ordered by the second consult, with one sentence in the contract paragraph. Meets deferral rule (a): AC1 names the job-run cost.
    location: >-
      apps/supervisor/src/inbox.ts runCost
    severity: medium
  - summary: >-
      A failed host `sweep-triage` emit is never retried: `emitTriage` notes `ledger: "error: …"`, and every later tick answers `seen`, so one transient failure keeps the event out of the host's ledger.
    evidence: |-
      Blind Hunter, confirmed at `sweep.ts emitTriage`. The failure is recorded as the matrix asks, and the queue note still holds the payload, but no later pass delivers it. Meets deferral rule (a): AC2 names the host's event.
    location: >-
      apps/supervisor/src/sweep.ts emitTriage
    severity: medium
---

> **SERVE PROCESS CHANGE (the epic's rule).** `sweep.ts`'s watch and ledger passes run inside `serve`: the operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.

<intent-contract>

## Intent

**Problem:** A sweep's records stop short of a story's: `## Metered cost` and the `job-run` line carry the launch worker's turns only (hole 102, DW-131), the `sweep-triage` event lands in the sandbox's own ledger (DW-116), `## Sweep` is lost on a re-run (DW-123), the engine's own non-finished end is overridden by the bundle count (DW-118), the ledger pass's `pending` is a counted retry that gives up after 24 ticks (DW-122), a re-run's judge reaches no ledger line (DW-67), and a resumed run's body reads `not metered` (DW-119).

**Approach:** Price the engine's per-bundle sessions through the lib's one price table with a new `meter.py price-run` verb, emit the triage event from the host, make the ledger pass wait, keep the engine's end, rebuild `## Sweep` from the record on a re-run, and extend the 0.1.31 contract entry additively.

### Acceptance Criteria (verbatim, epics.md Story 36.2)

AC1. **Given** a `run-sweep` close-out, a 33.8 re-run and a resumed run's close-out
**When** `## Metered cost` and the `job-run` ledger line are written
**Then** the engine run's journal per-bundle token totals are priced with the routing's model rates (one pricing table in lib, read by the close-out and `report.py`) into `## Metered cost` as the worker's turns plus the engine, one line per bundle, and into the job-run line's `total_cost_usd`; the sweep's `ended` event carries `engine_cost_usd`; a re-run's judge lands as its own job-run line (`hostleg.ts runLeg`; DW-67); a resumed run meters its worker sessions as a first-launch run does and the PR body reads the number (`closeout.ts`; DW-119)

AC2. **Given** the sweep's triage and its ledger pass
**When** the supervisor copies `triage.json`, and when `ledger-resolve` answers `pending` only
**Then** the host side emits the `sweep-triage` ledger event with the payload the queue store holds (one shape for both records; `launch.py:1576`; DW-116), and the ledger pass waits uncounted and lease-free as the stage pass does (`planstatus.ts:513`, `sweep.ts:414`), the retry count kept for errors (`PLAN_RETRY_LIMIT`; DW-122); the flip's status line names the bundle once (`resolved … by #N (sweep bundle X)`, the doubled note of #290 and #293 gone)

AC3. **Given** a sweep whose engine ended `failed` or `blocked` after its last bundle, and a sweep's re-run
**When** `sweepEndState` runs (`worktree.ts:1078`) and `rewriteBody` renders the body (`hostleg.ts:209`)
**Then** the engine's own end is kept (`partial` at best when every bundle landed; DW-118) and `rewriteBody` passes `sweepSummary(queue, run)` so `## Sweep` survives (DW-123); one test each; the contract (0.1.31, additive) names the priced cost and the event; the entries close by this PR

### Planner readings (plans/36-2.md Settled shape; SPEC.md design notes)

These state how the criteria read against the code. They are not deviations.

1. **Cost source:** `meter.py price-run --run-dir <dir> --routing <routing.current.json> --json` is the one pricing reader of `prices.json` (`load_prices`/`_rates`). Per bundle it takes `transcripts/<key>/metered.json usd_total` (`source: "metered"`), else prices `state.json` `tasks[key].sessions[].usage` (`source: "sessions"`, `bound: "upper"`, cache writes at the 5m rate, `ttl: "unknown"`). A bundle with neither reads `usd: null` and the body line `not metered`. The journal's scalar `tokens` are never priced (Story 24.1). `report.py` gains no pricing code: its `cost_usd` cells came from the same table.
2. **Model priced:** the id the session record carries wins; only when empty, the routing's model for the session's `role` (`meter.route`).
3. **Priced records:** `sweepRecord.bundles[]` gains `cost_usd?: number | null` and `source?`; the record gains `engine_cost_usd?`; `ended` detail carries `engine_cost_usd`. `## Metered cost` reads `$<worker> (worker turns) + $<engine> (engine) = $<total>`, then one `- <bundle>: $<usd> (<source>)` line per bundle. The `job-run` `total_cost_usd` is the sum. A re-run's judge is its own line `{job_id: <same>, run_id: "<run_id>:verify-<n>", state: "complete", total_cost_usd: <judge>}` through `ledger.py emit` from the host (`n` = the count of the run's re-run legs).
4. **"`failed` or `blocked`":** the engine has no such statuses, so this reads as an end other than `finished` (`crashed`, `interrupted`, a `stopped` that is not 36.3's paused-sweep stop). Keep the `blocked` rules and 36.1's `legVerdict` branch first, then add the engine cap: `partial`, reason `engine ended '<status>' after <n>/<m> bundles`, even when every bundle landed.
5. **"`sweepSummary(queue, run)`" on a re-run:** a record-based `summaryFromRecord(events)` (`ended.detail.sweep`, else raced `closed_out.sweep`, plus the `sweep-triage` note), never computed from a removed worktree. The close-out's live `sweepSummary(queue, run)` is unchanged. The re-run's cost renders from the record's per-bundle `cost_usd`.
6. **One triage shape:** the host's ledger payload is the lib's `{run_id, bundles: int, dw_ids[], blocked[], decisions[], already_resolved[], skip[]}`, a projection of the richer queue note. The queue note gains `ledger: "emitted" | "error: <clipped>"`. Emitted once per engine run, after the first successful `recordTriage`.

## Boundaries & Constraints

**Always:** Stdlib-only Python through `uv run`; atomic writes; headless surfaces end in the AD-11 status block; contract changes are additive on 0.1.31, with conformance green (AD-19). Plan's Files list is the boundary. Re-grep every anchor: the AC's line numbers are planning-date anchors, not pins. The `pending` wait records one `ledger-resolve {…, waiting: true}` while it lasts and releases the lease settled, so `tries` is untouched; errors still count to `PLAN_RETRY_LIMIT`. Never edit a versioned contract note from an earlier story (36.1's consult ruling): new facts go in the new `**0.1.31 (Story 36.2, additive).**` paragraph, which states the end rule's order (`blocked` rules first), closing DW-134.

**Block If:** A consumer of `job-run` (`jobRunCosts`, `runCost`, `spendByEpic`) double-counts the judge line or drops the run's own line, and fixing it needs more than those three readers changed. The Files list must grow past the plan's band. A real sweep's bundles carry neither `metered.json` nor `usage` so that no number can be priced: that is `not metered` per bundle, a `meter_hook.py` follow-up, never an invented figure.

**Never:** Price the journal's scalar `tokens`. Add pricing code to `report.py` or a second price table. Run a `git push`, tag, PR or the release motion. Write under `implementation-artifacts/supervision/`, or edit `epics.md`, `stories.yaml`, `routing.toml` or `policy.toml`. Touch the engine on the host. Refactor outside Files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sweep close-out, metered | `transcripts/<key>/metered.json` for each bundle | Body: worker + engine = total, one line per bundle; `job-run` total is the sum; `ended.engine_cost_usd` set | None expected |
| Sessions fallback | No marker, `state.json` usage present | `source: "sessions"`, `bound: "upper"`, `ttl: "unknown"`; empty model takes the routing's role model | Model absent from the table: `MeterError` named refusal |
| No record for a bundle | Neither source | `usd: null`, body line `not metered` | Never a guess |
| `price-run` fails in close-out | Verb exits non-zero or no JSON | Close-out completes on the worker's cost, cost stated as unpriced | Never blocks the close-out |
| Re-run with judge cost | Sweep or story re-run with `playable.judge.cost_usd` | Own `job-run` line, `run_id` `<id>:verify-<n>`; the run's own line unchanged | Failed emit is recorded, the leg still finishes |
| Resumed run | `handBack` writes a fresh `launched` | `worker_cost_usd` carried forward; body reads the number | No prior value: `not metered` as today |
| Triage copied | First successful `recordTriage` | Host ledger gets the lib-shaped payload once; note gains `ledger: "emitted"` | Emit failure: note `ledger: "error: …"`, no throw |
| `pending` only | `ledger-resolve` answers pending, repeatedly | One `waiting: true` record, lease released settled, no give-up, ever | Errors still count and give up at the limit |
| Engine crashed after last bundle | All bundles landed, status `crashed` | `partial`, reason names status and n/m | Red or inconclusive leg's reason leads |
| Paused-sweep stop | `engineStop === "stopped"` / phase `paused` | Not penalised | None |
| Sweep re-run after worktree removal | `ended.detail.sweep` recorded | `## Sweep` present, bundles as recorded, not "not landed" | Raced `closed_out.sweep` is the fallback |

</intent-contract>

## Code Map

`plans/36-2.md` `## Code Map` is the investigation (in `context:`): read it, and do not repeat the search. It covers `worktree.ts` (`meteredCost`, `launchedCloseOutInput`, `prBody`, `finishStudio`, `sweepEngines`), `sweep.ts` (`sweepRecord`, `sweepEndState`, `recordTriage`, `ledgerPass`), `hostleg.ts` (`rewriteBody`, `runLeg`), `closeout.ts handBack`, `meter.py`, `plansync.py resolved_status`, `launch.py` (the emit, now ~:1719-1731), the tests and the contract anchors.

Anchors confirmed moved by 36.1: `sweep.ts sweepEndState` :310, `legVerdict` branch :317.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/meter.py` -- add `price-run` (metered marker, sessions fallback, routing role fallback) -- CAP-4's one reader of the table
- `plugins/tk-studio/lib/plansync.py` -- `resolved_status` strips a resolution that is only the engine's `resolved by sweep bundle <key>` -- one bundle note
- `apps/supervisor/src/sweep.ts` -- `sweepRecord` cost fields, `engineCostOf`, `summaryFromRecord`, the host `sweep-triage` emit, the `pending` wait, `sweepEndState`'s engine cap -- CAP-4, 5, 6
- `apps/supervisor/src/worktree.ts` -- priced cost into `prBody`, `finishStudio` and `ended`; pass `st.detail.status` to the end at ~:1078 -- CAP-4, 6
- `apps/supervisor/src/hostleg.ts` -- `rewriteBody` passes the record summary and cost; `runLeg` emits the judge's `job-run` -- DW-123, DW-67
- `apps/supervisor/src/closeout.ts` -- `handBack` carries `worker_cost_usd` -- DW-119
- `plugins/tk-studio/contracts/driver-contract.md` -- the `**0.1.31 (Story 36.2, additive).**` paragraph after 36.1's, the header clause and rulings entry, the `run-sweep` bullet -- AD-19
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- `sweep-triage` and `job-run` emitter text -- the host emitter
- `plugins/tk-studio/contracts/conformance/e2e_run_sweep.py`, `manifest.json` -- widen `FILTER` to `Story 35.7|Story 36.1|Story 36.2`; the drive note -- the drive runs this story's tests
- `plugins/tk-studio/lib/tests/test_meter.py` -- `price-run`: metered, sessions fallback (upper bound, `ttl_unknown`, empty model), missing model refusal, no record -- matrix
- `plugins/tk-studio/lib/tests/test_plansync.py` -- single bundle note (`LedgerResolveTests`) -- AC2
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- `test_0_1_31_story_36_2_…` in the 35.7 test's shape -- AC3
- `apps/supervisor/test/sweep.test.ts` -- priced cost in body, `finish` and `ended`; triage emit once; pending wait replacing the give-up test, an error path still counting; crashed-after-landed -- AC1-3. Name these describes `Story 36.2`.
- `apps/supervisor/test/hostleg.test.ts` -- sweep re-run body keeps `## Sweep`; judge's `job-run` with `<id>:verify-1` -- AC1, AC3
- `apps/supervisor/test/closeout.test.ts` -- resumed run's carried cost and body number -- AC1
- `apps/supervisor/test/worktree.test.ts` -- per-bundle lines in `prBody` -- AC1
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-67, 116, 118, 119, 122, 123, 131 `status: resolved 2026-10-30 by this story's PR (36.2: …)`; DW-134 too once the new paragraph states the order -- the entries close
- `kb/agent-pc-setup-runbook.md` -- the hole-102 row from recorded to fixed
- `apps/supervisor/README.md` -- the sweep's cost and `## Sweep` on a re-run

**Acceptance Criteria:** AC1, AC2 and AC3 above, each proven by a named test or a command whose output shows it. Given a consumer reads `job-run` (`jobRunCosts`, `runCost`, `spendByEpic`), when the judge's suffixed line lands, then the run's own cost is neither dropped nor double-counted (a test on the reader the suffix reaches).

## Spec Change Log

- 2026-10-30, follow-up review, score 1 deviation ordered logged here by the fourth consult: `ended` on an immediately closed-out cancel carries `engine_job_run`.

DRIFT: `ended` on an immediately closed-out cancel carries `engine_job_run` — a failed emit must be recorded — affects: none

- 2026-10-30, second follow-up review, score 1 deviation ordered logged here by the fifth consult: it supersedes the third consult's clause "emit `engineJobRun` only if the worktree was removed". A cancel's immediate close-out emits the `:engine` line whether the worktree was removed or kept, as no late close-out follows.

DRIFT: a cancel's immediate close-out emits the `:engine` line with the worktree kept too — `awaitingEngine` selects only `closeout.result = 'skipped'`, so no later pass emits it — affects: none

## Review Triage Log

### 2026-10-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 6, low 1)
- defer: 2 (high 0, medium 0, low 2)
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` Contract and ledger carried out the first consult's disclosure (`rerun.job_run` forms, bundles-only engine total, DW-136, DW-131's line).
  - `[medium]` `[patch]` A re-run's `## Sweep` kept later cycles' blocked, decisions and skip: `sweepRecord` persists them.
  - `[medium]` `[patch]` The late close-out passes the engine's status to `sweepEndState`.
  - `[medium]` `[patch]` The late close-out's engine cost lands as its own `<id>:engine` `job-run` line (`state: "complete"`, second consult).
  - `[medium]` `[patch]` The `pending` wait gained a lease-free fingerprint pre-check: no `gh`, lease or `plansync` while the owner ledger is unchanged.
  - `[medium]` `[patch]` The paused-sweep exemption survives a tick boundary through the `engine-stop` note.
  - `[low]` `[patch]` A sweep's worker figure is `launched.worker_cost_usd` alone.

Deferred: DW-137 and DW-138 from the review, DW-136 and DW-139 on the consults' orders: four in all, over the three-per-story line; the rule each meets is in the frontmatter.

### 2026-10-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 1 (high 0, medium 1, low 0)
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` A cancelled sweep closed at once through `closeOutNow` had no `## Sweep` and no priced engine: `cancelRun` now prices it and records it on `ended` (third consult; both layers found it).
  - `[low]` `[patch]` The contract's `job-run` sum omitted a first leg's judge cost: the 36.2 paragraph now states it.
  - `[low]` `[patch]` The contract's `skipped: <why>` forms of `rerun.job_run` and `engine_job_run` were unasserted: a test now pins each.

Deferred: the permanent failed triage emit, meeting rule (a). That makes five in all on this story, each with its rule in the frontmatter.

Rejected, one line each:
- DW-131's stage-log half has no open entry: AC1 does not name it, and DW-131's status line and the Residual risks disclose it, so it meets none of the deferral rules.
- The deleted stage `.jsonl` loses rows: both `plan` rows are in this spec's `## Stage Log`.
- The runbook still gives old operator steps: `:769-784` is the sandbox-recreate export, still correct, into its own `sandbox-*.jsonl` file (the push reads the `<user>-<machine>` ledger), and the runbook names no AI-3 step.
- The `:engine` reader fixture uses `state: "cancelled"`, and new tests have no explicit timeout: `jobRunCosts`, `runCost` and `spendByEpic` never read `state`, and `sweep.test.ts` took 9.9 s against the drive's 60 s bound, with no failure seen.

### 2026-10-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 0
- reject: 3
- addressed_findings:
  - `[medium]` `[patch]` A cancel's real close-out that kept its worktree never got the engine's `job-run` line, as no late close-out selects it: `cancelRun` emits it either way (fifth consult; both layers found it).
  - `[medium]` `[patch]` A sweep that lost the race to a cancel, with its `finish` refused, lost the engine's cost: the raced `closed_out` emits the `:engine` line and records `engine_cost_usd` and `engine_job_run`; a `finish` that succeeded emits none (both layers found it).
  - `[medium]` `[patch]` The status line still named the bundle twice when the resolution said more, and a test pinned that: the engine's clause is removed wherever it stands.
  - `[low]` `[patch]` The `job-run` emitter text in the taxonomy omitted the cancel and raced close-outs: both named, the `cli.ts` part asserted.
  - `[low]` `[patch]` A partial flip wrote a second `waiting` record for one wait: `seen` compares `pending` only.

Rejected, one line each:
- A re-emit when `patchEventDetail` throws after a successful `sweep-triage` emit: already DW-137.
- A reused `verify-<n>` after a failed `host-verify` note: already DW-138.
- A priced `dw*-` key outside the summary's bundles makes the engine total exceed its lines: it needs a triage that is unreadable, which the body already states, the total stays true, and the first consult accepted those keys.

## Design Notes

`bun` is at `~/.bun/bin/bun`, not on `PATH`: `export PATH="$HOME/.bun/bin:$PATH"`. `apps/supervisor/node_modules` may be absent: run `bun install --frozen-lockfile` there first and commit nothing it produces. `EPERM` link errors can leave `.bin` empty, so typecheck with `bun node_modules/typescript/bin/tsc --noEmit`. `test/tier.test.ts` fails at baseline (2 or 4 by the `TK_ATLASSIAN_*` environment): compare against that. If bun cannot run, report it plainly: the supervisor proof then stays `unverifiable-here`, stated, never implied green.

The whole `sweep.test.ts` runs under `e2e_run_sweep.py`'s 60 s bound (hole 97): the wait test should be faster than the 25-pass loop it replaces.

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- expected: green
- From `plugins/tk-studio/lib`: `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- From project root: `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: green
- From `apps/supervisor`: `bun test` -- expected: green over the `tier.test.ts` baseline, `Story 36.2` tests ran
- From `apps/supervisor`: `bun node_modules/typescript/bin/tsc --noEmit` -- expected: clean
- From project root: `uv run python plugins/tk-studio/contracts/conformance/e2e_run_sweep.py` -- expected: `ok` (or `not_run` without bun)

## Deviation Summary

### pass 1 (2026-10-30)

- planned: `sweepRecord` gains `cost_usd?`, `source?`, `engine_cost_usd?` / actual: it also gains `engine_cost_error?`, named in the contract / why: the matrix requires the cost "stated as unpriced", and a re-run can only repeat the reason if it is recorded / may affect: none
- planned: the Settled shape does not name where a failed judge emit is recorded / actual: added `rerun.job_run` (`<id>:verify-<n>`, `error: …` or `skipped: …`) to the `host-verify` event, named in the contract / why: the matrix says "Failed emit is recorded" / may affect: none
- planned: `e2e_run_sweep.py` changes `FILTER` only / actual: also changed its `ledger-resolve` pin from `(sweep bundle dw-a; ` to `(sweep bundle dw-a)` / why: AC2's single bundle note breaks the old pin / may affect: 36-4 (it edits this drive's bound)
- planned: `test_driver_contract.py` adds the new 36.2 test / actual: also loosened the 35.7 test's pin from `lib/launch.py sweep alone` to `lib/launch.py sweep` / why: the planned taxonomy text adds a host emitter, so "alone" is no longer true; the versioned contract note itself is unedited / may affect: none
- planned: `hostleg.test.ts` adds cases / actual: also added a `studioRunId` option to its `fixture()` and `sliceFixture()` / why: a terminal run's row is immutable, so the id must be set before the end / may affect: none
- planned: `price-run` keys are not specified beyond `tasks[key]` and transcripts / actual: keys are the triages' bundles first, then any other `dw*-` task or transcripts dir / why: a triaged bundle with no record must still read `usd: null`, and excluding non-`dw` keys leaves the engine's `sweep-triage` session unpriced / may affect: none

DEVIATION SCORE: 1

DRIFT: `sweepRecord` also carries `engine_cost_error?` — the matrix requires the cost stated as unpriced, on a re-run too — affects: none
DRIFT: `host-verify` carries `rerun.job_run` — the matrix requires a failed emit to be recorded — affects: none
DRIFT: `e2e_run_sweep.py`'s `ledger-resolve` pin changed beside `FILTER` — AC2's single note breaks the old pin — affects: 36-4
DRIFT: the 35.7 test's taxonomy pin loosened from `lib/launch.py sweep alone` — the planned emitter text adds the host — affects: none
DRIFT: `studioRunId` option added to the `hostleg.test.ts` fixtures — a terminal run's row is immutable — affects: none
DRIFT: `price-run` keys are the triages' bundles, then other `dw*-` tasks or transcripts; the engine's `sweep-triage` session is unpriced — a triaged bundle with no record must read `usd: null` — affects: none

### pass 1 ruling

Consult accepted all six at score 1. Corrections it ordered to the record above (the entries stay as written, this section is append-only):
- Deviation 6: `why` reads "both pinned texts say per bundle"; `may affect` reads "`engine_cost_usd` and `total_cost_usd` understate the engine's full spend".
- Deviation 3: a shared file with 36-4, not a dependency.

### pass 2 (2026-10-30, review patches)

- planned: spec reading 3 and AC1 say the `job-run` line's `total_cost_usd` is the sum of worker and engine / actual: on the late close-out path the run's own line stays worker-only and the engine lands as a separate `<studio_run_id>:engine` line / why: `finishStudio` has already run on that path, so its line cannot be rewritten / may affect: none
- planned: no field named for the outcome of the `:engine` emit / actual: `closed_out` also carries `engine_job_run` (the line's run id, `error: <why>` or `skipped: <why>`), named in the contract / why: the matrix's "failed emit is recorded" rule and the `rerun.job_run` form / may affect: none
- planned: the `waiting` record stores a fingerprint / actual: a wait continuing after the file changes patches the record's `fingerprint` instead of noting a new record / why: the spec's "one `waiting: true` record while it lasts" / may affect: none
- planned: the matrix keys the paused-sweep exemption on `engineStop === "stopped"` or phase `paused` / actual: `engine-stop` is also noted on a successful stop (`stopped: true`), and `stopped` plus that note exempts on later ticks / why: the exemption must survive a tick boundary / may affect: 36-3 (its paused-sweep stop reads the same note)

DEVIATION SCORE: 2 (consult: the implementer reported 1; the `engine-stop` note is a seam 36-3 reads)

DRIFT: the late close-out's engine cost is its own `<studio_run_id>:engine` `job-run` line, `state: "complete"` — `finishStudio` already ran on that path — affects: none
DRIFT: `closed_out` carries `engine_job_run` — a failed emit must be recorded — affects: none
DRIFT: the `waiting` record's `fingerprint` is patched as the wait continues — one record while it lasts — affects: none
DRIFT: `engine-stop` also noted on a successful stop, `{engine_run_id, stopped: true}`, exempting later ticks — the exemption must survive a tick boundary — affects: 36-3

### pass 3 (2026-10-30, the second consult's orders)

No new deviations from the implementer. `plans/36-3.md` is outside this story's Files, and the consult ordered the one line added there.

DRIFT: one line added to `plans/36-3.md`, outside Files — the second consult ordered it, as 36-3 reads the `engine-stop` note — affects: 36-3

### pass 4 (2026-10-30, follow-up review patches)

- planned: `apps/supervisor/src/cli.ts` is not in the plan's Files / actual: `cancelRun` prices a sweep's immediate close-out, and `closeOutNow`'s input gains `sweep` / why: AC1 names a `run-sweep` close-out, and the worktree's removal means no later pass can price it (third consult) / may affect: shares a file with 36-3, no dependency
- planned: the third consult put `sweep` and `engine_cost_usd` in `detail` / actual: `detail.engine_job_run` also holds the emit's answer, named in the contract / why: a failed emit must be recorded (fourth consult) / may affect: none

Pass 4's score is 1 on both; the story's stays 2.

DRIFT: `cli.ts` `cancelRun` changed, outside Files — AC1 names a `run-sweep` close-out and the worktree's removal loses the run dir — affects: none (a shared file with 36-3, not a dependency)
DRIFT: `ended` on an immediately closed-out cancel carries `engine_job_run` — a failed emit must be recorded — affects: none

### pass 5 (2026-10-30, second follow-up review patches)

- planned: the third consult emits a cancel's `:engine` line only if the worktree was removed / actual: emitted with the worktree kept too / why: `awaitingEngine` selects only `closeout.result = 'skipped'`, so no later pass emits it (fifth consult) / may affect: none
- planned: task line 122 strips a resolution that is only the engine's clause / actual: the clause is removed wherever it stands, and "The flip" sentence in the 0.1.31 (36.2) paragraph says so / why: AC2 says the status line names the bundle once, and the AC governs (sixth consult) / may affect: none
- planned: the raced close-out's note carries `engine_job_run` / actual: omitted when `finish.ok` is true / why: no line exists to name, and the run's own line holds the sum / may affect: none

Pass 5's score is 1; the story's stays 2.

DRIFT: `resolved_status` removes the engine's clause wherever it stands, not only when it is the whole resolution — AC2 requires one bundle note — affects: none

## Reconcile

### 2026-10-30 — adjust-stories

- Score: 2
- Reasoning: Two later stories were planned against things this unit changed, and notes in their `invoke_dev_with` absorb both; no acceptance criterion changes. 36-3's deadline reads the `engine-stop` note, which can now mean a stop that succeeded, and `sweepEndState`'s new engine cap would turn its `blocked` end into `partial`. One change has no `DRIFT:` line: `sweep.ts:66` imports `DEFERRED_REL` from `board.ts`, which merges the {closeout, planstatus, sweep, worktree} and board…registry SCCs into one of eleven modules (found by this gate, value imports at `e8bc431` against `HEAD`). The other drift (the `:engine` line, `rerun.job_run`, `closed_out.engine_job_run`, the `e2e_run_sweep.py` pin 36-4 shares) touches nothing later work relies on, and the contract's 0.1.31 (36.2) paragraph states each.
- Affected: 36-3-a-paused-or-resumed-run-is-never-parked — "a **deadline**, `SWEEP_STOP_DEADLINE_MS = 30 min` from the first `engine-stop` note's `at` for that engine run id" and "a `blocked` end through the sweep tail"
- Affected: 36-7-the-cycles-cut-and-the-docs-caught-up — "the set of remaining non-trivial SCCs equals the allowlist `{queue, sandbox}`, `{api, cli}`, `{board, engagement, inbox, log, office, page, registry}` exactly"
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 36-3-a-paused-or-resumed-run-is-never-parked

## Consult Log

- 2026-10-30T21:59:04Z — trigger: deviation-gt-0 — question: accept or reject the six deviations at the implementer's score 1? — ruling: accept-deviation score 1 (all six; 2 and 6 only with disclosure) — do: state in the 0.1.31 (36.2) paragraph that `rerun.job_run` holds the line's run id, or `error: <why>` or `skipped: <why>` when no line landed, and that `engine_cost_usd` and `(engine)` total the bundles only, so the engine's own `sweep-triage` session is not priced; add one open `deferred-work.md` entry for the unpriced triage session, name the gap in DW-131's status line, correct deviation 6's record, and do not add a triage line or widen `BUNDLE_KEY_RE`; record deviation 3 as a shared file with 36-4, and leave deviations 1, 3, 4 and 5 as implemented — rule candidate: When a story adds a field or failure form to a contract surface, or a total narrower than its label, the same story's contract paragraph must state the value forms and the exclusion, and any spend left unpriced gets a deferred-work entry.
- 2026-10-30T22:32:10Z — trigger: deviation-gt-0 — question: accept the four pass-2 deviations, and what of the `:engine` line's effect on `consolidate.py` and on the bare-id cost readers? — ruling: accept-deviation score 2 (1, 2, 3 at score 1; 4 at score 2, 36-3 reads the note) — do: (a) in `engineJobRun` emit `state: "complete"`, drop `state` from its `Pick`, update the contract and the test's assertion, leave `consolidate.py` untouched; (b) accept and file one deferred-work entry that on a late-closed sweep `runCost` and the bare-id `jobRunCosts` readers return the worker-only own line so API and delivery `cost_usd` read less than the PR body, add one sentence to the contract paragraph, leave those readers and `spendByEpic` unchanged; log item 4 as score 2 and add one line to `plans/36-3.md` that the first `engine-stop` note may be `{stopped: true}` and the deadline applies only while the engine is still `paused` and its stop is failing — rule candidate: A supplementary `job-run` line under a suffixed `run_id` reports a cost, not a transition, so it always carries `state: "complete"`, and bare-id readers keep reading the run's own line unless a contract change redefines them.
- 2026-10-30T22:50:14Z — trigger: file-outside-files — question: a cancelled sweep closed at once through `closeOutNow` (`cli.ts:1200-1201`) has no `## Sweep` and no priced engine: patch `cli.ts` or defer? — ruling: accept-deviation score 1 (option A) — do: edit `cancelRun` in `cli.ts`, widening `closeOutNow`'s input by `sweep`, logged as a score 1 deviation sharing a file with 36-3, no dependency; only for a sweep with `skip` unset and `pendingCloseOut` empty, run `recordTriage`, `emitTriage` and `withEngineCost(sweepSummary(...), await engineCostOf(...))` before `closeOutNow`, pass `sweep` and `launchedCloseOutInput(events, current, { workerOnly: true })`, every skip path staying with the late close-out; after it put `sweep: sweepRecord(s)` and `engine_cost_usd` in `detail`, emit `engineJobRun` only if the worktree was removed, never call `sweepEndState`; add one `sweep.test.ts` case for a confirmed-dead cancel (body `## Sweep` and priced lines, `ended.detail.sweep`, `engine_cost_usd`), keep the test at `sweep.test.ts:349` green, add one sentence to the 0.1.31 (36.2) paragraph, refactor nothing else in `cli.ts` — rule candidate: When an AC names a close-out kind, the planner lists every `closeOut` and `closeOutNow` caller in Code Map and marks each in or out of scope, so a parallel path never reaches review as a file outside Files.
- 2026-10-30T23:03:18Z — trigger: deviation-gt-0 — question: accept `detail.engine_job_run` on the cancel path at the implementer's score 1, or drop the field? — ruling: accept-deviation score 1 — do: keep `detail.engine_job_run` at `cli.ts:1217`, the `ended` assertion at `sweep.test.ts:816` and the contract sentence in the 0.1.31 (36.2) paragraph, changing nothing else for this field; log it in the Spec Change Log as a score 1 deviation with a DRIFT line: `ended` on an immediately closed-out cancel carries `engine_job_run` because a failed emit must be recorded, affects: none — rule candidate: When a story's close-out path calls a ledger emit, the planner names in the SPEC the event field that records the emit's run id, `error: <why>` or `skipped: <why>`, using the same field on every parallel close-out path.
- 2026-10-30T23:16:06Z — trigger: file-outside-files — question: `awaitingEngine` selects only `closeout.result = 'skipped'`, so a cancel's real close-out that keeps its worktree never gets the engine's `job-run` line: patch `cli.ts` against the third consult's "only if the worktree was removed", or defer? — ruling: accept-deviation score 1 (option A) — do: in `cli.ts:1215-1218` drop the `worktree === "removed"` condition so `detail.engine_job_run = await engineJobRun(current, usd, deps.worktree)` runs whenever `sweep` is set and `usd` is defined, correct the comment at `cli.ts:1212`, and log a score 1 deviation superseding the 22:50:14Z clause; in the 0.1.31 (Story 36.2) paragraph (`driver-contract.md:2153-2154`) replace "and the line is emitted only if the worktree was removed" with a statement that the line is emitted whether the worktree was removed or kept, because no late close-out follows, with no version bump or field change; add one `sweep.test.ts` case for a confirmed-dead cancel with a kept worktree (`closeout.result` not `skipped`, `ended.detail.engine_job_run` is `<studio_run_id>:engine`, one `:engine` line with the priced cost, a following `sweepEngines` does not pick up the run or emit a second line), changing nothing else in `cli.ts` — rule candidate: When a consult ruling conditions behaviour on another code path running later, it must cite that path's selection predicate (`file:line`) and the planner must add a test that the path picks up the state; a false premise voids that clause at score 1.
- 2026-10-30T23:36:07Z — trigger: deviation-gt-0 — question: accept the removal of the engine's clause wherever it stands and the rewritten "The flip" sentence, or revert to the full match? — ruling: accept-deviation score 1 — do: keep the Patch 3 code in `resolved_status` and the rewritten sentence, with `names the bundle once` kept; add to that sentence that only the engine's exact clause is removed, so a resolution's own other wording stays even if it names the bundle; leave task line 122 as written, add a `DRIFT:` line that `resolved_status` removes the engine's clause wherever it stands because AC2 requires one bundle note, affects: none, and re-run conformance before calling the pass done — rule candidate: When a story's task line is narrower than its verbatim AC, the AC governs and the implementer logs a score 1 DRIFT, and a contract sentence in the same story's unreleased paragraph is updated with the code without a consult.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-30T20:25:52Z | 2026-10-30T20:48:43Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-10-30T21:27:40Z | 2026-10-30T21:29:18Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-30T21:29:34Z | 2026-10-30T22:42:43Z | aa1bf26d-0c51-4243-8bea-6881426a7c4f | claude-opus-5-5 | medium | 11480162 | 205667 | 13.5686 | completed |
| review | 1 | 2026-10-30T22:42:44Z | 2026-10-30T23:10:25Z | 1e140d24-7c8e-4d0e-85e0-dca445b3825b | claude-opus-5-5 | medium | 4607925 | 93644 | 6.8778 | completed |
| review | 2 | 2026-10-30T23:10:25Z | 2026-10-30T23:37:29Z | 05e826da-b41f-43e2-b304-8b661e1a018e | claude-opus-5-5 | medium | 5535503 | 101136 | 7.3185 | completed |
| gate | 1 | 2026-10-30T23:37:30Z | 2026-10-30T23:44:37Z | c3ca5f2f-d29f-42c8-a9b8-4cb00322bcba | claude-opus-5-5 | medium | 1798632 | 26910 | 2.1275 | completed |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-36-20261030T201456Z-e76900` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** A second follow-up review of the implemented story. A sweep's engine cost is priced per bundle by `meter.py price-run` into `## Metered cost`, the `job-run` line and `ended.engine_cost_usd`. A re-run's judge and a late close-out's engine land as their own suffixed `job-run` lines, and a resumed run carries its worker cost. The host emits `sweep-triage`, a `pending` ledger pass is an uncounted, lease-free wait, and the engine's own end caps a sweep at `partial`. `## Sweep` survives a re-run from the record. This pass closes two paths where the engine's cost reached no `job-run` line (a cancel that kept its worktree, a sweep that lost the race to a cancel), makes the flip line name the bundle once in every case, and cuts a partial flip to one `waiting` record.

**Files changed in this pass:**
- `apps/supervisor/src/cli.ts`: a cancel's immediate close-out emits the `:engine` line with the worktree kept too.
- `apps/supervisor/src/worktree.ts`: the raced close-out emits the `:engine` line when its `finish` was refused, and records it on `closed_out`.
- `apps/supervisor/src/sweep.ts`: one `waiting` record while `pending` is unchanged.
- `apps/supervisor/test/sweep.test.ts`: the kept-worktree cancel, both raced cases, the partial flip.
- `plugins/tk-studio/lib/plansync.py`: `_BUNDLE_CLAUSE_RE` removes the engine's clause wherever it stands.
- `plugins/tk-studio/lib/tests/test_plansync.py`: the doubled form corrected, the clause at the start and mid-text.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the emitter names `cli.ts`.
- `plugins/tk-studio/contracts/driver-contract.md`: in the 0.1.31 (36.2) paragraph, the cancel and raced lines and "The flip".
- `plugins/tk-studio/contracts/events/taxonomy.v1.json`: the `job-run` emitter text.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the orchestrator's working-tree change (DW-144), committed as found and not edited here.

**Review:** patches 5 (medium 3, low 2); deferred 0; rejected 3. Follow-up review: true (patched high 0, medium 3, low 2; score 11). Both layers ran (band L). The 280 KB diff went to both layers by file path, not inline.

**Verification (run by this session after the last code change; conformance and `tests.test_driver_contract` re-run by the implementer after the final contract sentence):**
- `uv run python -m unittest discover tests`: 2681 tests, OK (skipped=4).
- `runner.py run`: `ok: true`, 23 surfaces.
- `tests.test_driver_contract`, after the final sentence: 77 tests, OK.
- `tests.test_release_roster`: 86 tests, OK.
- `e2e_run_sweep.py`: `ok: true`.
- `bun node_modules/typescript/bin/tsc --noEmit` in `apps/supervisor`: clean.
- `bun test` in `apps/supervisor`: **not fully green**: 1697 pass, 92 skip, 4 fail. All 4 are `sbx` argv cases in `tier.test.ts` and `guards.test.ts`. With the 5 `TK_ATLASSIAN_*` variables unset, those two files read 105 pass, 0 fail, so the failures are this environment's, the baseline the Design Notes describe.

**Residual risks:**
- The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.
- `price-run` has run only against fixtures, never a real engine run dir, so a real sweep may read `not metered` per bundle if the hook wrote nothing.
- `engine_cost_usd` covers bundles only, so it understates a sweep's engine spend (DW-136). DW-131's Jira stage-log half also remains, with no open entry: a bundle has no stage-log row.
- On a late-closed sweep, API and delivery `cost_usd` read worker-only while the PR body reads the total (DW-139). A cancel's immediate close-out reads the same way, as its `finish` is the ender's.
- A raced sweep whose computed state equals the studio run's existing state gets a no-op `finish` that answers ok without writing the cost, so the engine's cost is lost there. The implementer named this at `jobrun.py finish` and did not prove it reachable; it needs a same-state end, such as a killed sweep whose recorded end is `cancelled`.
- A driver ending the run between a cancel's close-out and `endReread`, with `closeout: skipped` and the worktree kept, could emit a second `:engine` line. The id is fixed, so `jobRunCosts` (last line per `run_id`) does not double count. Reachability was not checked.
- The `sweep.ts` header and the `engineJobRun` docstring still describe only the late close-out.
- A resolution naming two bundles in the engine's clause form loses the second name.
- A cancelled sweep whose engine was found only by the probe, with no recorded `engine_run_id`, has no triage and reads `engine not priced: no engine run recorded`.
- A failed host `sweep-triage` emit is recorded and never retried (DW-144).
- If the supervisor dies between a successful stop and its note, the next tick caps that sweep at `partial`.
- Hole 102's fix is proven only under test until a fourth sweep runs. Operator step: `max_runs` must be raised for it, as the epic states.
- `deferred-work.md` holds DW-140 to DW-143, duplicates of DW-136 to DW-139 from the same frontmatter items. They were left untouched on the instruction that the orchestrator owns the ledger's entries.

DRIFT: `sweepRecord` also carries `engine_cost_error?` — the matrix requires the cost stated as unpriced, on a re-run too — affects: none
DRIFT: `host-verify` carries `rerun.job_run` — the matrix requires a failed emit to be recorded — affects: none
DRIFT: `e2e_run_sweep.py`'s `ledger-resolve` pin changed beside `FILTER` — AC2's single note breaks the old pin — affects: none (a shared file with 36-4, not a dependency)
DRIFT: the 35.7 test's taxonomy pin loosened from `lib/launch.py sweep alone` — the planned emitter text adds the host — affects: none
DRIFT: `studioRunId` option added to the `hostleg.test.ts` fixtures — a terminal run's row is immutable — affects: none
DRIFT: `price-run` keys are the triages' bundles, then other `dw*-` tasks or transcripts, leaving the engine's `sweep-triage` session unpriced — both pinned texts say per bundle — affects: none (`engine_cost_usd` and `total_cost_usd` understate the engine's full spend; DW-136)
DRIFT: the late close-out's engine cost is its own `<studio_run_id>:engine` `job-run` line, `state: "complete"` — `finishStudio` already ran on that path — affects: none
DRIFT: `closed_out` carries `engine_job_run` — a failed emit must be recorded — affects: none
DRIFT: the `waiting` record's `fingerprint` is patched as the wait continues — one record while it lasts — affects: none
DRIFT: `engine-stop` also noted on a successful stop, `{engine_run_id, stopped: true}`, exempting later ticks — the exemption must survive a tick boundary — affects: 36-3
DRIFT: one line added to `plans/36-3.md`, outside Files — the second consult ordered it, as 36-3 reads the `engine-stop` note — affects: 36-3
DRIFT: `cli.ts` `cancelRun` changed, outside Files — AC1 names a `run-sweep` close-out and the worktree's removal loses the run dir — affects: none (a shared file with 36-3, not a dependency)
DRIFT: `ended` on an immediately closed-out cancel carries `engine_job_run` — a failed emit must be recorded — affects: none
DRIFT: a cancel's immediate close-out emits the `:engine` line with the worktree kept too — `awaitingEngine` selects only `closeout.result = 'skipped'`, so no later pass emits it — affects: none
DRIFT: `resolved_status` removes the engine's clause wherever it stands, not only when it is the whole resolution — AC2 requires one bundle note — affects: none

