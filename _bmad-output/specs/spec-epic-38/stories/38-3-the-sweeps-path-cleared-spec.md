---
title: "The Sweep's Path Cleared"
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_revision: '829c284b9e8f19a115ad7d9cb7ba606f33830cf1'
deviation_score: 1
reconcile_verdict: not-required
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-38/plans/38-3.md'
  - '{project-root}/AGENTS.md'
warnings: [oversized, multiple-goals]
deferred: []
---

> **Serve process.** This story changes code that runs inside `serve` (`sweep.ts`, `worktree.ts`, `queue.ts`, `sandbox.ts`, `cli.ts`). The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.

<intent-contract>

## Intent

**Problem:** The Epic 37 retrospective found three defects on the fourth sweep's path (AI-3; B1, B2, B4) and DW-165 adds a fourth: the paused-sweep stop deadline never resets on a `running` probe (and an unanswered stop frees the lock and pin while the engine may still run); a `ledger-resolve` refusal settles the ledger pass silently; a missing id stays `pending` and the remedy line is relative to the studio checkout; a sweep bundle's engine passes leave no Stage Log row anywhere.

**Approach:** Transcribed from `epics.md` §Story 38.3 (authoritative), shaped by `plans/38-3.md` §Settled shape 1–10 (the SPEC design notes CAP-7/8/9):
- AC1 — **Given** `sweepStopPastDeadline` (measured from the first `unknown` or erroring note, a `running` probe never clears it, `sweep.test.ts:1316` pinning that as intended) and the stop in `worktree.ts` **When** an early `unknown` probe is followed by `running` probes and a later blip **Then** the deadline measures from the first note of the latest non-`running` streak (a `running` probe resets it; the rule named in the README), so a healthy engine is never stopped on an old blip, and `stopUnanswered`'s `blocked` end releases the lock and the pin only after a stop confirmed or the engine's own exit; `sweep.test.ts` pins the reset and the `:1316` case is rewritten to the new rule.
- AC2 — **Given** `ledgerPass` (a non-retryable refusal read as `settled` with no notifier line) and `LedgerDuplicateId` (`plansync.py ledger-resolve`, exit 2) **When** `ledger-resolve` refuses **Then** the pass ends with a `ledger-resolve {ok: false, settled: true, ended: "refused", reason}` note and one notifier line naming the refusal and the remedy (as B4's wait end does), never a silent settle; pinned with a fake refusal.
- AC3 — **Given** B4's remedy line (`ledger-resolve --ids <old ids>` with a relative plugin path; a missing id stays `pending`) and a sweep bundle's engine passes (DW-165) **When** an id in the sweep's record no longer names an open entry, and when a bundle's passes end **Then** `ledger-resolve` refuses a missing id by name (`LedgerMissingId`, exit 2, naming the id and the counter) instead of `pending`, the remedy line carries the verb's absolute path under the studio install and the run's `root` (`--directory`), and the test runs the remedy under a fixture root rather than reading the line's text; a bundle's passes write their Stage Log rows into the sweep PR body's `## Stage Log` (the story-doc shape: stage, start, stop, model, tokens, cost) and DW-165 closes with the Jira half declared not owed (a bundle has no issue) on the entry; the contract names the refusal and the rows (0.1.34, additive).

## Boundaries & Constraints

**Always:**
- Follow the plan's Settled shape 1–10 verbatim (names, line texts, record shapes, the contract clause and paragraph sub-heads). Its Files list is the boundary; any other file is a recorded deviation.
- Stdlib-only Python via `uv run`; atomic writes; `encoding="utf-8"` on every Python text open; TS writes name `"utf-8"`; every `bun test` names `--timeout`; the remedy path is a native host `join` (never `toVmPath`), and tests compare it against `join(...)`, never a POSIX literal; the remedy test spawns with `PYTHONIOENCODING=utf-8`.
- `sweep.ts` value-imports neither `worktree` nor `hygiene` (`cycles.test.ts`); a shared predicate lives in `queue.ts`.
- Contract change is additive inside the existing 0.1.34 entry; 37.5's and 0.1.30's paragraphs and their pins are superseded by statement, never edited; `test_0_1_32_story_37_5_…` stays green unchanged.
- The CLOSED skip and the `PLAN_RETRY_LIMIT` give-up stay silent; the triage sessions get no Stage Log table.

**Block If:**
- The 0.1.34 entry or the Stories row is not where Settled shape 9 places it (consult `deviation-gt-0`; never open a second bump).
- A test shows a held lock can never be freed by an operator action (consult, `bad_spec`). A held engine whose probe answers `unknown` for good stays held (fail closed) — not a block; no timer auto-release.
- A test needs an id absent only because the owner checkout is behind to stay `pending` (consult, `bad_spec`).

**Never:**
- Edit `.tk-studio/jobs/run-sweep.json` `max_runs`, submit a `run-sweep`, push, tag, or open a PR.
- Change `meter_hook.py`, `contracts/events/taxonomy.v1.json`, or the raced (cancel-won) path's lock/pin handling (DW-64/38.5).
- Fix the known `guards.test.ts` sbx-argv baseline (DW-173, 38.6's).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Streak reset | early `unknown` note, then `running` probes (one `engine-probe {phase:"running"}` written), a fresh blip <30 min ago | not past deadline; no stop | — |
| Healthy engine | `running` probes, no open streak | writes no note per tick | — |
| Legacy note | old `engine-probe` without `phase` | reads as non-`running` | — |
| Unanswered stop | streak >30 min, stop errors | run ends `blocked`, `ended.detail.engine_held {engine_run_id}`, lock kept as `handed_to_engine`, pin kept; line ends "lock and pin held until a stop is confirmed or the engine exits" | — |
| Held release | later tick: probe `ended` / stop answers `stopped` / `unknown` | release lock + pin, note `engine-released {by:"exit"\|"stop"}` / same with `by:"stop"` / nothing | fail closed on `unknown` |
| Probe-path stop answered `stopped` | :1376 case | keeps "… lock and pin released", releases at once | — |
| Refused ledger pass | `ledger-resolve` exit 2 `{error:"LedgerDuplicateId: …"}`, no `retryable` | record `{…, ok:false, settled:true, ended:"refused", reason, error}`; one notifier line with the remedy; `notify` patched | no notifier → `{ok:false, skipped:"no notifier injected"}` |
| Missing id | `--ids DW-9`, no `### DW-9` | `LedgerMissingId: DW-9 not in the ledger (the counter's next id: DW-n)`, `status: blocked`, exit 2, nothing written (dry-run too) | unreadable counter → `(the counter unreadable: <error>)` |
| Open id | `--ids DW-2` open | `pending` | — |
| Remedy from any cwd | `ledgerResolveCommand(fx.root, PR, ["DW-1"], {TK_STUDIO_ROOT: repo})` run in an unrelated temp dir | exit 0, ledger reads `status: resolved 2026-11-07 by acme/widget#42` | `TK_STUDIO_ROOT` unset + placeholders → `<studio-root>/plugins/tk-studio/lib/plansync.py` |
| Bundle rows | `stage --from-run --run-dir D --worktree W` | `{ok:true, columns, bundles:[{key, rows}], written:[]}`; PR body `## Stage Log` after `## Sweep`, before `## Host verify` | unreadable `state.json` → blocked exit 2; body `Stage Log not read: <error>`; no rows → `no engine pass recorded` |

</intent-contract>

## Code Map

The plan's `## Code Map` (`plans/38-3.md` lines 24–134, refreshed at the 38-2 gate) is the investigation; anchors re-grepped at `829c284b` and still hold:
- `apps/supervisor/src/sweep.ts` (745) -- `sweepStopPastDeadline` :576, `noteEngineProbe` :583, `endLedgerWait` :618 (template for the refused end; remedy text :629-630), `ledgerPass` :658 (silent settle :718), `sweepRecord` :443, `summaryFromRecord` :460, `engineCostOf` :502, `withEngineCost` :521; header prose :34-100.
- `apps/supervisor/src/worktree.ts` (1689) -- `prBody` :446 (`## Sweep` :465, before `## Host verify`), `applyTransition` :990, `release` :142, `engineStatus` :1332, `sweepEngines` :1406; late summary :1431, running/unknown branch `noteEngineProbe`/deadline/`answered` :1484-1497, paused branch :1514-1515, live summary :1593, `blocked` end `asked`/line texts :1631-1638, pending replay `release` :1459, raced path :1661-1681.
- `apps/supervisor/src/queue.ts` -- `endEngine` (~:1909, always `keepEngine`), `writeEnd` (~:2177; `engineRunId` set + no `keepEngine` → `handToEngine` ~:1571), `releaseEngineLock` (~:1796).
- `apps/supervisor/src/sandbox.ts` -- `sandboxHolders` :171-181, `releasePin` :183-215.
- `apps/supervisor/src/cli.ts` :1256 -- cancel's summary site.
- `apps/supervisor/src/runners.ts` -- `studioScript` :18, `engineStopArgv` :52-65 (builder precedent); `env.ts:32-40` `pluginRoot`/`StudioRootMissing`.
- `plugins/tk-studio/lib/plansync.py` (3808) -- `STAGE_COLUMNS` :2212, `_backfill_rows` :2988 (extract the per-session loop body; keep 38.2's `_session_outcome`), `stage_from_pass` :3057, `ledger_resolve` :3476 (miss :3502), `mint_deferred` :3530 (share next-id helper), `stage` exclusive group :3613, `_ledger_resolve_main` :3708, `_stage_main` :3752.
- `plugins/tk-studio/lib/dwledger.py` -- `LedgerDuplicateId(Refusal)` :30-31; add `LedgerMissingId` beside it.
- `plugins/tk-studio/lib/meter.py` -- `_bundle_keys` :835-857, `_state_tasks`, `_session_usd` (read-only reuse).
- `plugins/tk-studio/contracts/driver-contract.md` -- header line 5, Stories row line 6, 38.2's 0.1.34 paragraph :2718, `## 8. Conformance` :2771 (38.3's paragraph between).
- Tests: `apps/supervisor/test/sweep.test.ts` (`sweepFixture` :40-107, 36.3 block :1028-1237, 37.5 block :1239-1415), `sandbox.test.ts:380-396`, `lib/tests/test_plansync.py` (`LedgerResolveTests` :899, :941 rewrite, :1010 shape), `test_dwledger.py:53`, `test_driver_contract.py` (38.2 test ~:3492), `contracts/conformance/e2e_run_sweep.py:48` `FILTER`.
- Records: `apps/supervisor/README.md:239`, `deferred-work.md` DW-165 :1390, `handoff-phase1-loop-2026-10-09.md:79` (optional).

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/queue.ts` -- `endEngine` `holdEngine` opt (no `keepEngine` → `handToEngine`); export `heldEngine(events)` -- Settled shape 2.
- `apps/supervisor/src/sandbox.ts` -- `sandboxHolders` counts a terminal run with `heldEngine` set -- shape 2.
- `apps/supervisor/src/sweep.ts` -- streak helper, `sweepStopPastDeadline`, `noteEngineProbe(queue, run, phase, error?)` per-streak; refused record + line; `ledgerResolveCommand`/`ledgerRemedyText` (wait end and refused end both use them); `engineStageRowsOf`, `withStageRows`, `sweepStageLogText`, `sweepCloseOutSummary`; `stage_rows` on `BundleOutcome`/record/`summaryFromRecord`; header prose -- shapes 1, 3, 5, 7.
- `apps/supervisor/src/worktree.ts` -- `running` note when a streak is open; per-streak `answered`/`asked`/paused error-note dedup; held end (`PendingTransition.holdEngine`, skip `release()` at the end and pending replay, new line texts) and `releaseHeldEngines` per tick; `prBody` `## Stage Log`; summary sites → `sweepCloseOutSummary` -- shapes 1, 2, 7.
- `apps/supervisor/src/cli.ts` -- cancel's summary → `sweepCloseOutSummary` -- shape 7.
- `plugins/tk-studio/lib/dwledger.py` -- `LedgerMissingId(Refusal)`, docstring -- shape 4.
- `plugins/tk-studio/lib/plansync.py` -- missing-id refusal before any write, shared next-id helper, both except tuples; extracted session-row helper, `run_stage_rows`, `stage --from-run --run-dir --worktree`; docstrings -- shapes 4, 7.
- `apps/supervisor/test/sweep.test.ts`, `sandbox.test.ts` -- B1 reset (rewrite :1316, unit beside :1407), held end (lock kept; `engine-released` on exit and on confirmed stop; nothing on `unknown`), 36.3 block line/lock assertions, B2 fake refusal, remedy run under a fixture root (shape 6, 60 000 ms test timeout), Stage Log in the body and rebuilt from the record; titles `Story 38.3: …`.
- `plugins/tk-studio/lib/tests/test_plansync.py`, `test_dwledger.py` -- `LedgerMissingId` with counter (key present; seeded from ledger), :941 rewritten, dry-run refuses, `stage --from-run` fixture (two bundles, dev+review, `usage` fallback).
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- header clause, Stories row, `**0.1.34 (Story 38.3, additive).**` paragraph, `test_0_1_34_story_38_3_the_sweeps_path_cleared` -- shape 9.
- `plugins/tk-studio/contracts/conformance/e2e_run_sweep.py` -- `FILTER` `|Story 38.3`.
- `apps/supervisor/README.md`, `_bmad-output/implementation-artifacts/deferred-work.md` (DW-165 status, shape 8), `handoff-phase1-loop-2026-10-09.md` (optional, remedy form).

**Acceptance Criteria:** AC1–AC3 as transcribed in Intent; each is proven by the tests above and the verification commands below.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 2: (medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` AC1's pin half untested (host-tier fixture): added an sbx `sandbox` option to `sweepFixture` and five tests — the held end and the `holdEngine` pending replay release no pin; `releaseHeldEngines` orders `lock-released` → `pin-released` → `engine-released` on exit and on a confirmed stop.
  - `[low]` `[patch]` the contract-named "worktree gone" release had no test: added one (`engine-released {by: "exit"}`, `engine.gone`, lock freed, `heldEngine` cleared).
  - `[low]` `[patch]` README did not name the way out of a permanently `unknown` hold: one sentence (exit, a confirmed stop, or removing the kept worktree, which reads `ended`).
  - `[low]` `[patch]` a release whose `engine-released` note failed could never finish once the stopped sandbox made the probe `unknown`: `releaseHeldEngines` finishes a half-done release without probing (`resumed: true`), test added; the 0.1.34 Story 38.3 paragraph names it and its pin covers it (consult, pass 2).
- rejected (one line each): the refused line's remedy repeats the missing id — plan shape 3 / SPEC.md:151 mandate the call's ids and the line names the fix; per-tick event reads over terminal runs — plumbing efficiency, none of deferral criteria (a)–(c).

### 2026-11-08 — Review pass (follow-up review 1)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 9: (medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` AC1's per-streak readers in the paused branch were untested (the contract's "once per streak" `error` note; an older streak's `{stopped: true}` not counting as `confirmed`): two `Story 38.3 (B1): …` tests in `sweep.test.ts` (the `secondStreak` setup :1684-1711, tests :1713-1738) — a second streak gets its own `engine-stop {error}` and is not ended under the deadline; past it the run ends `blocked`, held (lock `{kind: "engine", engine_run_id: "E1"}`, `ended.detail.engine_held`, line ending "lock and pin held until a stop is confirmed or the engine exits").
- rejected (one line each):
  - missing-id refusal "breaking, not additive" — AC3 itself mandates the refusal instead of `pending` and "(0.1.34, additive)"; intent authority.
  - owner checkout behind main gets a refusal, not a wait — AC3 mandates refusing a missing id; plans/38-3.md:311 rules the remedy, run after a pull, flips it.
  - paused-branch `stopped` note suppressed by an older-streak note leaves a stop unconfirmed — invalid failure path: a `stopped` answer in the paused branch never sets `stopUnanswered` (worktree.ts:1571-1577), so the run closes out on that tick and is never held.
  - the held line names no way out — the line text is the plan's Settled shape (mandated verbatim); the way out is in the README and the contract.
  - `releaseHeldEngines` re-reads terminal runs and re-stops a running held engine every tick — the per-tick read was already rejected (plumbing), and one `stopSweepEngine` per tick on `running`/`paused` is plan shape 2's specified behaviour.
  - cancel and late close-out paths untested for `## Stage Log` — plumbing: all three sites call the one `sweepCloseOutSummary`, whose rows the live path's tests pin; none of (a)–(c).
  - `<studio root>` (docs) vs `<studio-root>` (code placeholder) — cosmetic: the docs describe the operator's real path, and the contract (driver-contract.md:2804) names `<studio-root>` as the unset-env placeholder, which the I/O matrix specifies.
  - half-done release when another claim freed the lock ("engine no longer live", queue.ts:1337) and the note then failed — a double fault (another run's claim, then a failed queue write after the pin release); the operator's way out (removing the kept worktree reads `ended`, no probe) still frees it.
  - relative `TK_STUDIO_ROOT` makes the remedy non-absolute — config misuse outside the story: `studioRoot` (env.ts:32) is used as given across the supervisor, and AD-15 sets it to the repo root.

## Design Notes

SPEC.md `## Design notes` CAP-7/CAP-8/CAP-9 bullets (lines 149–157) are binding; they mirror plan Settled shape 1–9.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_plansync tests.test_dwledger tests.test_driver_contract tests.test_release_roster` -- expected: OK
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bun test --timeout 30000` -- expected: 0 fail apart from the known `guards.test.ts` env-dependent baseline (run with `TK_ATLASSIAN_*` unset)
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p .` -- expected: clean

## Deviation Summary

### pass 1 (2026-11-08, implementer)

- planned: `LedgerMissingId` CLI answer with `ok` absent / actual: `ok: false`, `status: blocked`, exit 2, no `retryable` / why: the refusal path shared with `LedgerDuplicateId` always sets `ok: false` and its test asserts it / may affect: none
- planned: `sandboxHolders` counts every terminal run with `heldEngine` set / actual: counts held runs other than the `runId` being released / why: `releaseHeldEngines` frees the lock then calls `release()` before noting `engine-released`; counting its own run would keep its own pin forever / may affect: none
- planned: no new constant / actual: `queue.ts` exports `ENGINE_RELEASED = "engine-released"` / why: one name shared by `heldEngine`, `releaseHeldEngines` and tests / may affect: none
- planned: sweep.test.ts edits limited to named cases + new 38.3 tests / actual: older 35.7/36.2/37.5 tests that counted every `plansync.py` call now count only `ledger-resolve` calls; fixture answers `stage --from-run` (`answers.stageRows`) / why: close-out now also calls `stage --from-run` / may affect: none
- planned: rewrite 37.5 B5 test in place / actual: rewritten in place, backdating the early notes in the queue db / why: queue stamps events with the real clock while the deadline reads `deps.clockMs` / may affect: none
- planned: handoff remedy line at :79 / actual: edited at :103 / why: the file grew since the plan / may affect: none

DRIFT: LedgerMissingId CLI answer carries ok: false (plan: ok absent) — shared refusal path with LedgerDuplicateId sets ok: false — affects: none
DRIFT: sandboxHolders excludes the run being released from held holders — otherwise releaseHeldEngines could never free its own pin — affects: none
DRIFT: queue.ts exports ENGINE_RELEASED constant — one name for the new event kind — affects: none
DRIFT: older sweep.test.ts call counts narrowed to ledger-resolve; fixture answers stage --from-run — close-out gained a second plansync call — affects: none
DRIFT: 37.5 B5 test backdates queue events — queue clock vs deps.clockMs — affects: none
DRIFT: handoff remedy edited at :103 not :79 — anchor moved — affects: none

Consult ruling (deviation-gt-0): accepted, score 1. SPEC.md:152 ("per LedgerDuplicateId's shape") governs over plan shape 4's "`ok` absent" (plans/38-3.md:184); SPEC.md:151's "counts a held run" means held runs other than the one being released.

### pass 2 (2026-11-08, review patches)

- planned: half-done release detected by "no lock held by the run" / actual: requires a `lock-released` after the latest `ended` whose `why` is `ENGINE_EXITED`/`STOP_CONFIRMED` (new constants) and no engine lock held; notes `engine-released {engine_run_id, by, resumed: true}` without probing / why: a held end whose lock was never handed over also has no lock; treating it as released would free the pin while the engine may run / may affect: none
- planned: pin tests in sweep.test.ts and/or sandbox.test.ts / actual: all in sweep.test.ts via a new `sandbox` option on `sweepFixture` / why: the paths run through `sweepEngines`, whose fixture lives there / may affect: none

Consult ruling (deviation-gt-0, pass 2): accepted, score 1; the 0.1.34 Story 38.3 paragraph names the resumed `engine-released` field set and its test pins it.

DRIFT: half-done release detection keyed on releaseHeldEngines' own lock-released reasons; engine-released gains resumed: true (named in 38.3's own contract paragraph) — fail closed on a never-handed lock — affects: none
DRIFT: sbx pin tests in sweep.test.ts via sweepFixture's sandbox option — fixture locality — affects: none

- planned (consult pass 2 DO): "the lock and pin freed … the pin is released again" / actual: "(the lock freed, the pin perhaps too, …) … the pin is released (again, idempotent)" / why: the code takes the path once the lock is gone, so a crash between lock and pin also counts; the ruling's wording would misstate it / may affect: none

DRIFT: 0.1.34 resumed-release clause worded "the lock freed, the pin perhaps too" — matches the code's half-done condition precisely — affects: none

### pass 3 (2026-11-08, follow-up review patch, implementer)

Test-only, `apps/supervisor/test/sweep.test.ts`; no story, contract or src deviation (score unchanged at 1, no DRIFT line):
- planned: every older-streak note produced by real watch ticks / actual: the old `{stopped: true}` note is written with `fx.queue.note(...)` / why: in the paused branch a `stopped` answer closes the run out at once, so no tick sequence leaves that note while the engine runs.
- planned: no new helper / actual: one setup function local to the describe block (`secondStreak`) built from `sweepFixture` / why: both tests share the streak setup.

## Consult Log

- 2026-11-08T04:13:33Z — trigger: deviation-gt-0 — question: accept the implementer's six deviations (LedgerMissingId ok:false vs plan's ok absent; sandboxHolders excludes the releasing run; four local) at score 1? — ruling: accept-deviation score 1 — do: Keep both substantive deviations and the four local ones as implemented; do not add an ok-absent special case to the LedgerMissingId answer and do not count the releasing run's own held engine in sandboxHolders. / Record in the story's deviation log that the SPEC design note (SPEC.md:152) governs over plan shape 4's "ok absent" (plans/38-3.md:184), and that "counts a held run" (SPEC.md:151) means held runs other than the one being released. — rule candidate: When a plan's field-level shape contradicts the existing refusal shape its SPEC design note cites as the model ("per X's shape"), the cited shape wins and the difference is a score-1 deviation, with no consult needed.
- 2026-11-08T04:34:21Z — trigger: deviation-gt-0 (pass 2) — question: accept the narrowed half-done release detection (own lock-released reasons, engine-released resumed: true) and pin tests in sweep.test.ts at score 1? — ruling: accept-deviation score 1 — do: Keep both entries as reported. / In 38.3's own 0.1.34 paragraph, after the engine-released sentence, add one clause: a release left half-done is finished on a later tick without a probe — the pin released again and engine-released {engine_run_id, by, resumed: true} noted, by read back from the lock-released reason, no engine field; add it to test_0_1_34_story_38_3_…'s pinned phrases. / Make no other change to the contract, the SPEC design note or heldEngine. — rule candidate: When a story adds a field or variant to a queue event kind the same story introduces, its contract paragraph names every field set the code writes and the contract test pins it (score-1 completion, no consult).

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-07T20:38:28Z | 2026-11-07T21:02:55Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-08T00:54:57Z | 2026-11-08T00:56:17Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-08T03:40:45Z | 2026-11-08T04:41:18Z | 83cd2f4c-c89e-4e89-a876-21b4b023c563 | claude-opus-5-5 | medium | 31448675 | 201853 | 15.5290 | completed |
| review | 1 | 2026-11-08T04:41:19Z | 2026-11-08T04:55:13Z | 3eaded6c-a202-4ac2-8c3a-4f2764d021a9 | claude-opus-5-5 | medium | 5932217 | 58600 | 4.5587 | completed |
| gate | 1 | 2026-11-08T04:55:14Z | 2026-11-08T04:59:00Z | a5d19b8b-7d55-4ddf-bf49-a894fb6de0eb | claude-opus-5-5 | medium | 3892153 | 20515 | 2.1959 | completed |


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261108T033847Z-8b5e54` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Run.** Follow-up review 1 of the story implemented and reviewed in 4d60e952 (engine review session, `review_cycle` 1). Both layers ran (band L) over the diff since `829c284b` (the spec and the engine's stage file excluded). No consult trigger fired (no verify-red, no high finding, no deviation above the standing score 1, no file outside Files).

**Serve process.** `sweep.ts`, `worktree.ts`, `queue.ts`, `sandbox.ts` and `cli.ts` run inside `serve`. The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge. This pass changed tests only.

**Summary of the implemented change (unchanged from 4d60e952):**
- **AC1 (B1):** the paused-sweep stop deadline runs from the first note of the latest non-`running` streak; a `running` probe resets it.
  - An unanswered stop's `blocked` end holds the lock and the pin (`ended.detail.engine_held`).
  - `releaseHeldEngines` frees them only on the engine's exit (or its worktree gone) or on a confirmed stop, never on `unknown`, and finishes a half-done release (`resumed: true`).
- **AC2 (B2):** a refused `ledger-resolve` ends the pass `{ok: false, settled: true, ended: "refused", reason}` with one notifier line carrying the remedy.
- **AC3 (B4, DW-165):**
  - `LedgerMissingId` refuses a missing id by name, with the counter.
  - The remedy is one absolute, any-cwd command, and the test runs it.
  - The sweep PR body's `## Stage Log` lists each bundle's engine passes (`plansync.py stage --from-run`).
  - Contract 0.1.34, additive.

**Files changed in this pass:**
- `apps/supervisor/test/sweep.test.ts` — two `Story 38.3 (B1)` tests: a paused sweep's second streak gets its own `engine-stop {error}`, and past its deadline the run ends `blocked`, held (an older streak's `{stopped: true}` is not a confirmed stop).
- `_bmad-output/specs/spec-epic-38/stories/38-3-the-sweeps-path-cleared-spec.md` — this review record (the engine's Stage Log table included).
- `_bmad-output/specs/spec-epic-38/stages/38-3-the-sweeps-path-cleared.jsonl` — deletion committed as the engine left it: its rows are folded into the spec's `## Stage Log`.

**Review:** 1 patch applied (low 1), 0 deferred, 9 rejected (Review Triage Log, follow-up review 1).

**Follow-up review recommended: false.** Patched: high 0, medium 0, low 1. Score 3×0 + 1×1 = 1, below 5.

**Verification (this pass; every `TK_ATLASSIAN_*` unset):**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 2951 OK (4 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_plansync tests.test_dwledger tests.test_driver_contract tests.test_release_roster`: 266 OK.
- `bun test --timeout 30000` (apps/supervisor): 2049 pass, 95 skip, 0 fail. `test/sweep.test.ts` alone: 91 pass.
- `bun node_modules/typescript/bin/tsc --noEmit -p .`: clean. `bunx tsc` cannot resolve the bun types in this worktree.

**Unverifiable here (operator):**
- The Windows host leg, `uv run tools/verify_host.py`, run on the box.
- The serve restart after the merge.

**Residual risks:**
- A held engine whose probe answers `unknown` for good keeps the lock and the pin by design: it fails closed, with no timer. The way out is removing the kept worktree, as the README says.
- The double fault rejected above (another claim frees the lock, then a queue write fails) clears the same way.
- Deviation score 1 stands from passes 1–2, with two consults, both accept-deviation score 1.

DRIFT: LedgerMissingId CLI answer carries ok: false (plan: ok absent) — shared refusal path with LedgerDuplicateId sets ok: false — affects: none
DRIFT: sandboxHolders excludes the run being released from held holders — otherwise releaseHeldEngines could never free its own pin — affects: none
DRIFT: queue.ts exports ENGINE_RELEASED constant — one name for the new event kind — affects: none
DRIFT: older sweep.test.ts call counts narrowed to ledger-resolve; fixture answers stage --from-run — close-out gained a second plansync call — affects: none
DRIFT: 37.5 B5 test backdates queue events — queue clock vs deps.clockMs — affects: none
DRIFT: handoff remedy edited at :103 not :79 — anchor moved — affects: none
DRIFT: half-done release detection keyed on releaseHeldEngines' own lock-released reasons; engine-released gains resumed: true (named in 38.3's own contract paragraph) — fail closed on a never-handed lock — affects: none
DRIFT: sbx pin tests in sweep.test.ts via sweepFixture's sandbox option — fixture locality — affects: none
DRIFT: 0.1.34 resumed-release clause worded "the lock freed, the pin perhaps too" — matches the code's half-done condition precisely — affects: none

## Reconcile

- 2026-11-08 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 38-4-the-owners-decisions-have-a-source-and-a-sink (plan refreshed in place: 38.3's moved anchors, the one close-out seam `sweepCloseOutSummary`, `jiraBound` moved to the leaf `planseams.ts` because cycles.test.ts forbids sweep → closeout (Settled shape 14, +2 Files), FILTER already carries 38.3; CAP-10/11/12 open questions settled by SPEC design notes; plan stage rows ok)
