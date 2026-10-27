---
title: "A Resumed Engine's Graceful Stop Ends Complete, and the Pacer's Passes Are Visible"
type: 'bugfix'
created: '2026-10-27'
status: 'done'
baseline_revision: 'c5749a65d27272999a2e8cd695562286b56ac2a1'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/plans/33-7.md'
warnings: [multiple-goals, oversized]
deferred:
  - summary: >-
      A pacer pass that hangs or runs long is invisible until it ends: the slow-pass warning, the notifier line and pacer.json are written only when the child closes.
    evidence: |-
      Criterion (a), AC2's slow-pass visibility. Settled shape 3/4 write at pass end, which meets AC2 as written; a 30-minute tick is still seen only at minute 30, and a tick that never returns leaves `pacer` on stale values. Consult ruling 2026-10-27: reject as a 33.7 fix, record as deferred.
    location: >-
      apps/supervisor/src/log.ts (runUnderLog finish)
    severity: medium
  - summary: >-
      A resumed or relaunched engine the supervisor killed, whose host verify was skipped, still has its open PR marked ready even though the run ends partial.
    evidence: |-
      Criterion (a), AC1's "the PR not a draft" tied to a complete end. Pre-existing at baseline c5749a6: closeOut's skipped-verify branch runs `gh pr ready` whatever the end state. Pinned as today's behaviour by the closeout.test.ts killed-resumed test comment.
    location: >-
      apps/supervisor/src/worktree.ts closeOut (the !input.verify branch, ~:480-483)
    severity: medium
  - summary: >-
      A killed relaunch whose engine handled TERM and reads stopped ends `relaunched engine ended 'stopped'` instead of keeping launched.end (the guard trip's reason is lost).
    evidence: |-
      Criterion (a), the story's rule "a killed relaunch keeps launched.end". Pre-existing at baseline: the `relaunched` predicate tests only st.detail.killed, set only when the probe did not read ended; killedEngine() is not consulted. Pinned by the closeout.test.ts killed-relaunch test comment.
    location: >-
      apps/supervisor/src/worktree.ts sweepEngines (the relaunched predicate)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A run whose engine was resumed or relaunched ends `partial` on a graceful `stopped` even after its story landed (hole 59), because `engineEndState` maps every status but `finished` to `partial`. Separately, the pacer's tick/drain passes are invisible, so a 30-minute tick (2026-10-26) was only seen afterwards.

**Approach:** The engine-end sweep reads the engine journal before close-out and ends a resumed/relaunched `stopped` run `complete` (`reason: null`) when its last story entry is a `story-done`. The log tee gains a `--pass` mode that logs each pacer step's duration and exit code, warns on a pass over 10 minutes naming the runs it drove, and writes `pacer.json`, served on `GET /status` as `pacer` and shown on the status page.

**Acceptance criteria (verbatim, Story 33.7, `_bmad-output/planning-artifacts/epics.md`):**
- **AC1. Given** a run whose engine was resumed (`POST /runs/{id}/resume`) or relaunched by the paused-run pass and then ends `stopped` after a `story-done` for the story it was driving **When** the engine-end sweep runs **Then** the run ends `complete` exactly as a first engine's graceful stop does (`reason: null`, the PR not a draft), and `partial` is reserved for an engine that stopped before its story landed; `bun test` covers both paths on resumed and relaunched engines
- **AC2. Given** the pacer (`start.ps1`: tick, drain, sleep) **When** each pass runs **Then** its duration and exit code are logged (33.1's file) and the last ones are served in `GET /status` as `pacer {last_tick_ms, last_drain_ms, last_pass_at}` (contract 0.1.28, additive), a pass longer than 10 minutes is logged as a warning naming the pass and the run it was driving, and the status page shows the pacer line; the runbook's supervisor table gains the pacer's shape

## Boundaries & Constraints

**Always:** Follow the plan's **Settled shape** 1-6 (`plans/33-7.md`) exactly; it is the design. Stdlib/bun built-ins only; atomic writes (tmp + rename). The `ended` event's detail shape is unchanged. `interrupted`/`crashed` stay `partial`; a red host verify still overrides to `partial`; a killed relaunch keeps `launched.end`; a first engine is untouched. The journal is read before `closeOut` (it may remove the worktree). `GET /status` JSON changes only by adding `pacer` (always present). Recover never passes `--pass`. The warning line and notifier text carry only the step, duration and run ids — never a credential. Tests use fakes and injected clocks/fetch; no live call.

**Block If:** The engine's graceful stop reports a terminal status other than `stopped` (hole 59 then has another cause: record the observed status, halt). The pacer data needs a queue table, a `service_events` kind, or a change to `tick.ts`/`cli.ts`. `GET /status` JSON must change anything but adding `pacer`. A production source file outside the Files list must change.

**Never:** Import `office.ts` from `worktree.ts` (cycle via `closeout.ts`). Fork or modify upstream bmad-loop. Bump the contract version (stays 0.1.28). Add a §8 hole-59 row to the runbook. Push, tag, or run the release motion. Edit `hygiene.test.ts`/`web.test.ts` beyond the two re-pins the consult allowed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Resumed, landed | resumed run, engine `stopped`, journal `run-start, story-start K, run-paused, run-resume, story-done K` | ends `complete`, `finish --state complete` with no `--reason`, existing PR marked ready | — |
| Resumed, not landed | `stopped`, no `story-done` after the latest `run-resume` (or last story entry `story-start`) | `partial`, reason `resumed engine ended 'stopped'` | — |
| Relaunched | `stopped`, last story entry `story-done` / `story-start` | `complete` / `partial` with `relaunched engine ended 'stopped'` | — |
| Journal missing / unparsable lines / empty `story_key` | — | missing → false → `partial`; bad lines skipped; empty key not counted | never throws |
| Red host verify + `story-done` | — | still `partial`, naming the red command | — |
| `--pass` step | tee `--tag tick --pass -- <script>` | `pass: <ms> ms, exit <code>` before `stopped (…)`; `pacer.json` updated | write failure swallowed |
| No `--pass` / `--pass` with `serve` | — | no pass line, no `pacer.json` / usage error exit 2 | — |
| Slow pass | `ms > SLOW_PASS_MS` (600_000) | one `warning: pass <tag> took <ms> ms (over 10 min), driving <ids>` (≤5 ids then `+<n> more`; none → `no run named`) and one notifier send via injected fetch | send failure swallowed; at/under threshold: neither |
| `readPacer` | absent / invalid / WORK unset | all three fields `null` | — |

</intent-contract>

## Code Map

The plan's **Code Map** (`_bmad-output/specs/spec-epic-33/plans/33-7.md`) is the investigation; anchors re-confirmed 2026-10-27:
- `apps/supervisor/src/worktree.ts` -- `ENGINE_ENDED` :596, `engineEndState` :601 (only caller :752), `sweepEngines` :670, non-paused branch :745-757, `launchedCloseOutInput` :526/:727 (read-before-closeOut precedent); `closeOut` already marks a resumed/relaunched PR ready on green/skipped verify (:480-495).
- Engine journal: `<servedRoot(run)>/.bmad-loop/runs/<engine_run_id>/journal.jsonl` (kinds: `run-start`, `run-resume`, `run-paused`, `story-start {story_key}`, `story-done {story_key}`, `run-stop`, …). Read locally with `readFileSync`.
- `apps/supervisor/src/log.ts` -- `parseTeeArgs` :129, `runUnderLog` :136 (`finish(code, why)` writes `stopped (…)`), `appendLine`, `logDir`, `readLogTail`, `LogTail`.
- `apps/supervisor/start.ps1` -- `Invoke-PacerStep` :358 (tee call :365); `Invoke-SupervisorRecover` :341 (no `--pass`).
- `apps/supervisor/src/env.ts` :241 `notifier(env)`; `apps/supervisor/src/hygiene.ts` :260 `sendText`, :167 `NOTICE_MAX_BYTES`; `queue.ts` :803 `mintRunId` (run id shape).
- `apps/supervisor/src/api.ts` `status()` :710-719; `apps/supervisor/src/page.ts` `PageData` :77, `gatherPage` :194/:279, `renderPage` :435, "Supervisor log" section :499-504.
- Tests: `test/closeout.test.ts` :925/:956/:987 (fixtures `pausedRun` :49, `passDeps` :88, `statusAnswer`, `E1`/`E2`); `test/log.test.ts` "the tee" :142, usage pin :159; `test/api.test.ts` :416; `test/page.test.ts` :181/:214.
- Re-pins (consult-allowed, outside Files): `test/hygiene.test.ts:706` (the `Invoke-PacerStep` tee line; keep `--pass` after `--tag $Tag` so :707's negative regex holds) and `test/web.test.ts:198` (`/status` JSON byte pin; add `pacer` with `null`s in emitted key order).
- Docs: `apps/supervisor/README.md` :55, :70, **Starting at logon**; `plugins/tk-studio/contracts/driver-contract.md` 0.1.28 paragraphs end at :325 (33.6); `kb/agent-pc-setup-runbook.md` §4 table :947-952.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/worktree.ts` -- export `storyLandedBeforeStop(journalDir)`; `engineEndState(status, storyDone = false)`; in `sweepEngines` resumed/relaunched `stopped` reads the journal before `closeOut` and ends `complete`/`reason: null` when landed -- AC1 (Settled shape 1)
- `apps/supervisor/src/log.ts` -- `--tag <tick|drain> [--pass] -- …` grammar and usage text; pass line; `SLOW_PASS_MS`; warning + one notifier send via injectable `fetch` on io; `pacer.json` atomic write; exported `readPacer(env)` and `Pacer` type -- AC2 (Settled shape 2-4)
- `apps/supervisor/start.ps1` -- `--pass` in `Invoke-PacerStep` only -- AC2
- `apps/supervisor/src/api.ts` -- `pacer: readPacer(env)` beside `log` -- AC2
- `apps/supervisor/src/page.ts` -- `PageData.pacer?`, `gatherPage`, the `pacer: …` / `pacer: no pass recorded` line opening "Supervisor log" -- AC2 (Settled shape 5)
- `apps/supervisor/test/{closeout,log,api,page}.test.ts` -- the plan's **Tests to write** list, all of it -- AC1, AC2
- `apps/supervisor/test/hygiene.test.ts`, `apps/supervisor/test/web.test.ts` -- the two re-pins only (consult ruling) -- keep suites green
- `apps/supervisor/README.md`, `plugins/tk-studio/contracts/driver-contract.md` (a `**0.1.28 (Story 33.7, additive).**` paragraph after the 33.6 one, no version bump), `kb/agent-pc-setup-runbook.md` (§4 `Pacer` row, Settled shape 6) -- AC2 docs

**Acceptance Criteria:**
- Given AC1's states on both resumed and relaunched engines, when `bun test test/closeout.test.ts` runs, then both the `complete` and `partial` paths pass.
- Given AC2, when `bun test` runs `log`, `api`, `page`, `hygiene`, `web` test files, then the pass line, warning, notifier send, `pacer.json`, `readPacer`, `GET /status` `pacer` and the page line are covered and green.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 1, medium 1)
- defer: 1 (medium 1)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` `sweepEngines`' new `storyDone` had no kill guard, so a supervisor-killed resumed/relaunched engine that handled TERM (`stopped`) with a landed journal would end `complete`, verify skipped, PR ready. `notKilled` (`!st.detail.killed && !killedEngine()`) is now computed once, gates `storyDone`, and is reused by the host-verify guard; two closeout.test.ts kill cases added (counterfactual: both fail without the guard). Consult ruling: apply.
  - `[medium]` `[patch]` driver-contract.md: the `GET /status` surface-table row (:111) and the 0.1.28 version-header list (:5) now name `pacer {last_tick_ms, last_drain_ms, last_pass_at}` (Story 33.7), no version bump.
- deferred (criterion (a) each): the hung/in-flight pacer pass (review F3, consult: reject as a fix, record deferred); and two pre-existing behaviours surfaced by the patch (killed engine's PR marked ready on a partial end; killed TERM-handling relaunch loses `launched.end`), consult ruling of the patch pass's deviations.
- Both layers ran (band L); the kill-guard finding came from both and was deduplicated.

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (medium 1, low 1)
- defer: 0
- reject: 6 (medium 2, low 4)
- addressed_findings:
  - `[medium]` `[patch]` driver-contract.md's 33.7 paragraph stated "a killed relaunch keeps its launch's recorded end" with no exception and did not say that a killed engine never ends `complete` through the journal rule. The sentence (:360-365) now states both, and names the TERM-handling relaunch that reads `stopped` as the DW-65 exception. No version bump.
  - `[low]` `[patch]` In `sweepEngines` (worktree.ts:774-778), `join(servedRoot(run)!, …)` threw a TypeError when the served root was `null`. The sweep's own catch absorbed it, so the run's close-out never completed. The served root is now computed once and must be non-null (no journal means `partial`). New test at closeout.test.ts:1098. It is low because the consult found the branch unreachable through `awaitingEngine` (queue.ts:1633-1635) and the probe (worktree.ts:733).
- rejected (one line each):
  - Version-header list omits the end-state change: the 0.1.28 header entries list surface additions only (33.3, 33.5 and 33.6 have none), and the body paragraph is complete.
  - "Story / rulings" row lacks 33.7: it lacks 33.3–33.6 too, so this is a pattern that predates the story, and no criterion names it.
  - An unbounded notifier await in the tee: `sendText` already bounds every send with `AbortSignal.timeout(SEND_TIMEOUT_MS)` (hygiene.ts:266, :269).
  - README does not describe the end-state change: the plan's README scope is the `/status` row, the page row and the pacer step. The contract body carries the rule.
  - The landed rule ignores `run-stop.graceful`: Settled shape 1 defines the rule as `stopped` plus a landed `story-done`, and a first engine's stop ends `complete` whatever the stop kind, so parity holds.
  - The warning may name runs a drain did not drive: Settled shape 3 defines the ids as the run-id matches in the child's stdout/stderr, first-seen.
- Both layers ran (band L).

## Design Notes

Journal segment rule: entries after the latest `run-start` or `run-resume` (whole file if none); landed ⇔ the segment's latest `story-start`/`story-done` entry is a `story-done` with non-empty `story_key`. Run-id regex: `/\bq-[A-Za-z0-9][A-Za-z0-9._-]*-\d{8}T\d{6}Z-[0-9a-f]{6}\b/g` over child stdout+stderr, first-seen order, distinct. `pacer.json` = `{last_tick_ms, last_drain_ms, last_pass_at}`; read-modify-write sets only the tag's field and `last_pass_at` (ISO of pass end).

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- green; `uv run python ../contracts/conformance/runner.py run` -- `ok: true`
- From `apps/supervisor`, with `~/.bun/bin` on PATH and `TK_STUDIO_ROOT` set, each under its own fresh `TMPDIR` removed afterwards: `bun test test/<f>.test.ts` for closeout, worktree, log, api, page, resume, autoresume, hygiene, web -- all pass
- `bun x tsc --noEmit` -- exit 0
- `git diff --stat -- .claude _bmad` -- empty; `find /tmp -maxdepth 1 -name 'tk-sup-*' | wc -l` -- does not grow

**Manual checks (unverifiable-here, operator on the agent PC after the release carrying 33.7 is installed):**
- The supervisor log shows `[tick] pass:` and `[drain] pass:` lines every pass, and `GET /status` carries `pacer`.
- The next resumed run that stops gracefully after its story ends `complete`.

## Deviation Summary

- DRIFT: `apps/supervisor/test/hygiene.test.ts:706` and `apps/supervisor/test/web.test.ts:198` re-pinned outside the plan's Files — they pin the exact `start.ps1` tee line and `/status` JSON this story must change — affects: none (consult ruling, score 1)

### pass 1 (2026-10-27, implementer)

- planned: re-pin only `hygiene.test.ts:706` and `web.test.ts:198` / actual: exactly those two lines changed (`--pass` after `--tag $Tag`; `pacer` nulls in emitted key order) / why: consult ruling / may affect: none
- planned: tests added beside `page.test.ts:181/:214` / actual: also updated three existing `page.test.ts` pins (the `/status` key lists at :182 and :196 gain `pacer`; the section HTML at :225-226 gains `pacer: no pass recorded`) / why: they pin the surfaces this story changes; file in Files / may affect: none
- planned: `log.ts` adds `readPacer` and `Pacer` / actual: also exports `pacerPath`, `writePacer`, `slowPassLine`, `PASS_TAGS`; `TeeIo` gains `fetch?`; `parseTeeArgs` answers `{tag, pass, args}` (one existing `log.test.ts` assertion updated) / why: injectable fetch (Settled shape 3) and testable helpers / may affect: none
- planned: compute `storyDone` before `closeOut` / actual: moved the existing resumed/relaunched computation above `closeOut`, no behaviour change / why: avoid duplicate logic / may affect: none

DEVIATION SCORE: 1

- DRIFT: `page.test.ts` existing pins (:182, :196, :225-226) updated for `pacer` — they pin the changed `/status` and page surfaces — affects: none
- DRIFT: `log.ts` exports `pacerPath`, `writePacer`, `slowPassLine`, `PASS_TAGS`, `TeeIo.fetch?`, `parseTeeArgs` returns `{tag, pass, args}` — injectable fetch and testable helpers — affects: none
- DRIFT: resumed/relaunched computation moved above `closeOut` in `sweepEngines` — the journal must be read before close-out — affects: none

### pass 2 (2026-10-27, review patches)

- planned: killed-resumed test asserts the PR is not marked ready / actual: asserts `partial`, the reason and no `host-verify` event; the PR assertion dropped / why: `closeOut` marks the PR ready on a skipped verify whatever the end state (pre-existing; deferred) / may affect: none
- planned: killed relaunch keeps `launched.end` / actual: asserts `partial`, `relaunched engine ended 'stopped'` / why: the pre-existing `relaunched` predicate checks only `st.detail.killed`; changing it was out of the patch's scope (deferred) / may affect: none

DEVIATION SCORE: 1 (implementer said 2; consult ruled accept-deviation score 1)

- DRIFT: closeout.test.ts killed-engine tests pin pre-existing behaviour (no PR-draft assertion; killed TERM-handling relaunch ends with the engine's own end) instead of the brief's — both behaviours predate 33.7 and are deferred — affects: none

### pass 3 (2026-10-27, follow-up review patches)

- planned: a closeout.test.ts case for a resumed `stopped` run with no worktree, built from the fixtures / actual: stubs `takeForCloseOut` on the test's own queue, because `awaitingEngine` and the probe need a worktree / why: a worktree-less run cannot reach the branch otherwise / may affect: none
- planned: the counterfactual fails by throwing / actual: it fails as an assertion (`sweepEngines` returns `[]` and the run never ends). The sweep's catch absorbs the TypeError / why: the sweep's own error handling / may affect: none

DEVIATION SCORE: 1 (consult: accept-deviation score 1)

- DRIFT: the no-worktree closeout.test.ts case stubs `takeForCloseOut` on its own queue instance to reach the defensive null branch — the public fixtures cannot build a worktree-less run in the sweep — affects: none

## Consult Log

- 2026-10-27T02:15:18Z — trigger: file-outside-files — question: may the implementer re-pin hygiene.test.ts:706 and web.test.ts:198 (outside Files) for the `--pass` tee line and `/status` `pacer`? — ruling: accept-deviation score 1 — do: change only those two lines (`--pass` after `--tag $Tag`; `pacer` nulls in emitted key order); record as test-only DRIFT, no HALT; add hygiene and web to the per-file bun runs — rule candidate: Before closing Files, the planner greps hygiene.test.ts and web.test.ts (and any suite pinning `start.ps1` text or full `/status` JSON) for literal pins of every changed surface and lists them in Files as "(modify): re-pin only".
- 2026-10-27T02:27:20Z — trigger: deviation-gt-0 — question: accept the implementer's three in-Files deviations (page.test.ts pin updates; extra log.ts exports, TeeIo.fetch, parseTeeArgs {tag, pass, args}; sweepEngines computation moved above closeOut)? — ruling: accept-deviation score 1 — do: keep all three as is, score 1 (local); revert nothing; continue to review — rule candidate: When a plan adds a field to an existing response or a line to rendered output, updating the existing exact-match pins in a listed test file, and adding helper exports used only inside a listed source file and its own test, is score 0 and needs no consult.
- 2026-10-27T02:30:16Z — trigger: high-severity-finding — question: the new storyDone in sweepEngines has no kill guard, so a guard-tripped resumed/relaunched engine that handled TERM (status stopped, killed only per killedEngine) with a landed journal ends complete, verify skipped, PR ready; patch or bad_spec? (plus F2 contract row/header, F3 hung pass) — ruling: apply — do: patch A: gate storyDone on `!st.detail.killed && !(await killedEngine(queue, run))`, computing the kill value once and reusing it in the host-verify guard; add closeout.test.ts cases (killed resumed stays partial; killed relaunch keeps launched.end); F2 patch driver-contract.md :111 row and :5 header with `pacer` (no bump); F3 reject, recorded as deferred work — rule candidate: Any sweep-path rule that upgrades an engine's end to complete must use the host-verify guard's not-killed test; a spec adding a field to a contract JSON answer also updates that surface's table row and the version-header list.
- 2026-10-27T02:34:32Z — trigger: deviation-gt-0 — question: accept the patch pass's two test-brief deviations (killed-resumed test asserts no host-verify instead of PR not ready; killed relaunch reading `stopped` asserts `relaunched engine ended 'stopped'` not `launched.end`), both claimed pre-existing at baseline? — ruling: accept-deviation score 1 — do: keep both tests, change neither closeOut nor the relaunched predicate; record two deferrals (killed resumed/relaunched PR marked ready on a partial end; killed TERM-handling relaunch loses launched.end); name each assertion in a test comment as pinning pre-existing behaviour, pointing to its deferral — rule candidate: Any sweep-path predicate that classifies a killed engine (relaunched, host-verify, storyDone, PR-ready) uses the single notKilled value, never st.detail.killed alone, and closeOut marks a PR ready only when the computed end is complete.
- 2026-10-27T02:44:50Z — trigger: deviation-gt-0 — question: accept the follow-up patch pass's test deviations (the no-worktree resumed `stopped` test stubs `takeForCloseOut` on its own queue because `awaitingEngine` and the probe require a worktree; the counterfactual fails as an assertion, not a throw, because the sweep's catch absorbs the TypeError)? — ruling: accept-deviation score 1 — do: keep the `served !== null` guard (worktree.ts:776-778) and the stubbed test (closeout.test.ts:1098-1108) as they are; record the counterfactual as "fails as an assertion (`sweepEngines` returns `[]`, the run never ends; the TypeError is absorbed by the sweep's catch)", not "fails (throws)" — rule candidate: When a briefed counterfactual says "throws" but the code under test sits inside a catch-all sweep/loop, the resulting assertion failure satisfies it; stubbing one queue method on the test's own fixture to reach a defensive-null branch unreachable through public fixtures is a score-1 local deviation, no consult needed.

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version) | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass on the done story. Its baseline was c5749a65d27272999a2e8cd695562286b56ac2a1, and the diff covered all 14 code and doc files. The story's implementation is unchanged:
- Hole 59: a resumed or relaunched engine whose graceful `stopped` comes after its story landed ends `complete`, with `reason: null`.
- The pacer: each pass is logged, a pass over 10 minutes is warned and notified, and the last pass is served as `GET /status` `pacer` and shown on the status page.

This pass hardened two places:
- The contract now states the kill rule as the code applies it.
- The sweep no longer throws when a run has no served root.

**Files changed (this pass).**
- `apps/supervisor/src/worktree.ts`: `sweepEngines` computes `servedRoot(run)` once and requires it to be non-null before reading the journal.
- `apps/supervisor/test/closeout.test.ts`: one test, for a resumed `stopped` run with no worktree. The sweep does not throw, and the run ends `partial`, `resumed engine ended 'stopped'`.
- `plugins/tk-studio/contracts/driver-contract.md`: the 33.7 paragraph says a killed engine never ends `complete` this way, and names the DW-65 exception for a killed relaunch.

**Review findings.**
- Both layers ran (band L) and returned 8 findings.
- Patches applied: 2 (medium 1, low 1).
- Deferred: 0.
- Rejected: 6, each with a one-line reason in the triage log.

**Follow-up review recommendation:** false. The patched counts are high 0, medium 1 and low 1, so the score is 3×1 + 1×1 = 4: below 5, with no high finding.

**Verification.**
- From `plugins/tk-studio/lib`:
  - `uv run python -m unittest discover tests`: 2078 tests OK (2 skipped).
  - `runner.py run`: `ok: true`.
- `bun test`, one file at a time, each in a fresh TMPDIR, with `~/.bun/bin` on PATH and `TK_STUDIO_ROOT` set:

  | File | Pass | Fail |
  |---|---|---|
  | closeout | 60 | 0 |
  | worktree | 102 | 0 |
  | log | 26 | 0 |
  | api | 98 | 0 |
  | page | 49 | 0 |
  | resume | 81 | 0 |
  | autoresume | 29 | 0 |
  | hygiene | 43 | 0 |
  | web | 27 | 0 |

- `bun x tsc --noEmit`: exit 0.
- `git diff --stat -- .claude _bmad`: empty.
- `/tmp/tk-sup-*`: 104 before and 104 after.
- Counterfactual, from the implementer: with the old `servedRoot(run)!` expression, the new test fails as an assertion (`sweepEngines` returns `[]` and the run never ends). The sweep's catch absorbs the TypeError.
- `unverifiable-here`: unchanged from the story. On the agent PC, after the release carrying 33.7 is installed, the operator checks that:
  - every pass logs `[tick] pass:` and `[drain] pass:` lines, and `GET /status` carries `pacer`;
  - the next resumed run that stops gracefully after its story ends `complete`.

**Residual risks.**
- "Landed" depends on the upstream journal shape. A different kind ends the run `partial`, which is the safe failure.
- Three items stay deferred: the hung pacer pass, a killed engine's PR marked ready on a partial end, and the killed TERM-handling relaunch that loses `launched.end`. They are DW-63, DW-64 and DW-65.
- The orchestrator's uncommitted ledger lines for DW-63..65 were committed unchanged so the tree is clean.

DRIFT: closeout.test.ts's no-worktree case stubs `takeForCloseOut` on its own queue instance — a worktree-less run cannot reach the sweep's journal read through the public fixtures — affects: none

## Reconcile

- 2026-10-27 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 33-8-an-ended-runs-host-leg-re-runnable
