---
title: 'DW-52, DW-53: a refused close-out retried every pass; go after an unstopped end resubmits or re-closes'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_revision: 'd457da252f6c1bb2b756a9023d3ef84bbe6eed2c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
warnings: ['multiple-goals', 'oversized']
deferred: []
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** (DW-52) `closeoutStep` (`apps/supervisor/src/delivery.ts:373`) treats any `engagement-closeout` event naming the last run as done, so a named `engage.py closeout` refusal (`ok: false`) is never retried and the engagement stays `in-progress`/`partial` with its issue open. (DW-53) After a close-out leaves an engagement `partial` for a run that ended unstopped, an owner `go {cap}` moves it to `in-progress`; step 7 of `runStep` (`apps/supervisor/src/approve.ts:1361`) resubmits only stopped runs and the closeout pass sees the run already told, so nothing ever happens again.

**Approach:** Owner decision TKSTUDIO-218 (ENG-B), option A — both: the delivery pass retries a refused close-out on every pass, sending a notice only when the refusal reason changes; and a `go` after an unstopped end resubmits `last.job` when stories remain, else re-runs the close-out at once. "Stories remain" = engage.py's own verdict (consult ruling, see Consult Log): `engage.py closeout` reports an additive `stories_left` list, the supervisor copies it onto the `engagement-closeout` event, and both passes read that one predicate.

## Boundaries & Constraints

**Always:**
- "Done" for a last run = an `engagement-closeout` event with `ok: true` naming its `run_id`, and no `go` line in the record after that event (`go.at >= event.at`). An `ok: false` event never counts as done.
- A refusal writes an `ok: false` event plus one notice only when its `reason` differs from the newest `ok: false` event for the same `run_id` that has no `ok: true` event after it (none yet also counts as different). The same reason again writes no event and sends no notice, but still pushes to `out.refused`.
- `stories_left` (engage.py result) = the keys, deduplicated in first-seen order, of every story `closeout_verdicts` judges not landed: each proposed story of a queued epic whose landed entry is missing or not `spec_status: done`, shown under the same key `story <key> not landed` uses (and, with no proposed stories, each landed entry not `done`). An empty list when every story landed. The record's `closeout` merge is unchanged.
- The supervisor's "stories remain" for a run = the `stories_left` on its newest `ok: true` close-out event, filtered to `last.job`'s epic: a key starting `N-` when the job name ends in the digits `N` (`run-epic-N`); any key when the job name does not end in digits. A missing or non-array `stories_left` (events written before this change) counts as none.
- `go` after an unstopped end (record `in-progress`, the newest link of this cycle terminal, no ok stop naming it, no `after_run` naming it, an ok close-out event for it, a `go` line after that event, under the cap): stories remain → step 7 resubmits `last.job` exactly as the stopped path does (same `submit` call, `baseRef`, payload, recheck and `engagement-run-queued` event with `after_run`). None remain → step 7 does nothing and the same tick's closeout pass composes, runs `engage.py closeout`, applies `run-ended` from `in-progress` and tells again (a new ok event for the same `run_id`).
- When stories remain after such a `go`, the closeout pass never re-closes the run (a transient `submit` failure leaves it for step 7's next pass).
- The `run-ended` line used by the transient-retry path, and the `once` guard of its `applyRow`, count only a line for the run that is newer than the newest `go` line.
- Stdlib-only Python, atomic writes, every headless surface ends with its JSON status block, `encoding="utf-8"` on every text open, `bun test` always with `--timeout`.

**Block If:** the change would require a contract version bump or a breaking change to the `tk-studio-engage` result or to the record's `closeout` shape.

**Never:** edit `_bmad-output/implementation-artifacts/deferred-work.md`; change the transition table (`engagement.ts`); change the stopped-run resubmit rules (steady/ask/cap); re-derive "stories remain" from the queue run state, `closeout.not_done` or `stories.yaml`; push, tag or bump versions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Refusal, first | lib `blocked`, reason R1 | one `ok:false` event (reason R1), one notice, `refused:[ENG]`, state unmoved | — |
| Refusal, same reason next pass | lib called again, `blocked` R1 | lib IS called; no new event, no notice; `refused:[ENG]` | — |
| Refusal, reason changes | lib `blocked` R2 | a second `ok:false` event (R2) and a second notice | — |
| Refusal then success | lib `complete` | `run-ended` applied, issue closed, one ok event, notice; `closed:[ENG]`; the next pass calls no lib | — |
| go, stories remain | ok event `stories_left:["32-3"]`, job `run-epic-32`, `go` after it | step 7 `resubmitted:[ENG]` (the event carries `after_run`); the closeout pass calls no lib | `submit` throws → nothing queued; the closeout pass still does not re-close |
| go, stories left only in another epic | `stories_left:["31-2"]`, job `run-epic-32` | no resubmit; re-closed as below | — |
| go, none remain | `stories_left:[]` or field absent | step 7 resubmits nothing; the same tick's closeout pass calls the lib, applies `run-ended` from `in-progress`, writes a second ok event for the same `run_id` | lib transient → retried at the next pass |
| go after a cap stop (existing) | ok cap stop names the run | unchanged: step 7 resubmits; no re-close | — |

</intent-contract>

## Code Map

- `apps/supervisor/src/delivery.ts:1-56` -- header; lines 13-15 ("Once per last run…") and 50-53 (the refusal) must be rewritten to describe the new rules.
- `apps/supervisor/src/delivery.ts:373-427` `closeoutStep` -- `told()` (:379) matches any event on `run_id`; `ended()` (:383) finds any `run-ended` line; the refusal branch (:403-411) writes the event every time; the ok event (:425) must carry `stories_left` (from `lib.stories_left`, an array of strings else `[]`). The line-path outcome (:389) is read from the line.
- `apps/supervisor/src/delivery.ts:114-138` `lastRunEnded` -- already accepts an `in-progress` record with an unstopped terminal last run; reuse it unchanged.
- `apps/supervisor/src/approve.ts:1361-1392` step 7 -- `if (!prevStops.length) return;` (:1372) is where the unstopped-end branch goes. Everything after it (ask, steady gates) stays for stopped runs; factor the submit-and-record tail (:1384-1392) so both paths share it.
- `apps/supervisor/src/approve.ts:61-63` imports -- delivery.ts imports approve.ts, so a shared predicate (e.g. `goAfterEnd(queue, project, id, record, runId, job)` → `{ storiesLeft: string[] } | undefined`) lives in approve.ts and is exported; approve.ts never imports delivery.ts. The event name `"engagement-closeout"` may be defined in approve.ts and re-exported as `CLOSEOUT_EVENT` from delivery.ts (tests import it from delivery).
- `apps/supervisor/src/approve.ts:1117` `linksOf`, `eventsFor`, `stops` -- reuse. Record lines and queue events both carry ISO `at` strings and are compared as strings elsewhere (`since`).
- `plugins/tk-studio/lib/engage.py:1928-1994` `closeout_verdicts` -- `members_all` (queued, entry, key) is where "not landed" is known; :2307-2309 the result update (`outcome`, `done`, `not_done`) — add `stories_left` there and on the result path that returns (:~2392). Docstring at :150-200 documents the result `{status, engagement, outcome, page, written[]}`: add `stories_left`.
- `apps/supervisor/test/delivery.test.ts:481-575` -- "refusals and retries"; the test at :482 pins "not called again" and must be rewritten to the new rule. The fakes `deps({ lib, track, prStates })` and `closeouts(q)` at :146 are the harness.
- `apps/supervisor/test/approve.test.ts:1470-1535` -- "Story 32.8: … go past the cap, the run-end hand-off": the place and harness for the go-after-unstopped-end tests.
- `plugins/tk-studio/lib/tests/test_engage.py:1861+` -- the closeout fixtures (`closeout_input`).
- `plugins/tk-studio/contracts/driver-contract.md:774` -- the `tk-studio-engage` row's `closeout` result; the last `**0.1.34 (DW-51, additive).**` paragraph (end of the version history near :2900) is the precedent: add a `**0.1.34 (DW-52, DW-53, additive).**` paragraph, header version stays `0.1.34`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py:~1493` -- precedent pin of the closeout clause; add a test asserting the new paragraph names `stories_left`, the retry and the `go` rule.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/engage.py` -- compute and return `stories_left` (Always rules); docstring updated -- the predicate's single source.
- `plugins/tk-studio/lib/tests/test_engage.py` -- `stories_left` lists not-landed keys (a proposed story with no landed entry, one with `spec_status` not `done`); empty when every story landed; a merged-PR gap alone leaves it empty.
- `apps/supervisor/src/approve.ts` -- exported shared predicate; step 7 unstopped-end branch resubmitting through the shared tail; header lines describing step 7 updated.
- `apps/supervisor/src/delivery.ts` -- `told()` = ok and not superseded by a later `go`; refusal dedup by reason; `ended()`/`once` count only post-`go` lines; no re-close while stories remain; `stories_left` on the ok event; header rewritten.
- `apps/supervisor/test/delivery.test.ts` -- rewrite :482; add the matrix's refusal rows and the go/none-remain re-close row (through `engagementRunPass` then `closeoutPass`).
- `apps/supervisor/test/approve.test.ts` -- go/stories-remain resubmit; other-epic key not resubmitted; field-absent not resubmitted; `submit` throwing then the closeout pass not re-closing.
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the additive paragraph, the engage row naming `stories_left`, and its pin.

**Acceptance Criteria:**
- Given a last run whose close-out the lib refuses by name, when the closeout pass runs again with the lib still refusing for the same reason, then the lib is called again, no second event and no second notice are written; when the reason changes, one new `ok:false` event and one notice are written; when the lib then succeeds, `run-ended` applies and an ok event is written.
- Given an engagement made `partial` by the close-out of an unstopped run and an owner `go {cap}`, when the run pass and then the closeout pass run, then either a new run is queued with `after_run` naming the ended run (stories remain in its epic) or the close-out is re-run and the record leaves `in-progress` (none remain) — never `in-progress` with no run queued and no new close-out.
- Given `engage.py closeout` on a scope with an unlanded story, when it completes, then its status block carries `stories_left` naming that key.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- note: both layers ran (8+ files, not S-band); the 93 KB diff was handed to each reviewer as the file `/tmp/dw52-diff.txt` instead of inline text (context budget); Edge Case Hunter returned `[]`
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` A `go` from `partial` that leaves the cap at or below `runs_usd` is re-capped to `partial` by step 2, and the closeout pass then re-closed (second report and "partial" notice), because "a go after the ok event supersedes it" applied in every state. `told()` now cancels the ok event only while the record is `in-progress`; delivery.ts header and contract paragraph updated; test added (cap unchanged and cap = runs_usd: no lib call, no second event, no second close-out notice). Consult 2026-11-08T12:41:57Z accepted it as a deviation, score 1.
  - `[low]` `[patch]` `apps/supervisor/README.md:155` still described the old rules (a named refusal not retried, the event without `stories_left`, nothing after a `go {cap}`); the paragraph is rewritten for the new rules.

## Design Notes

Refusal dedup mirrors `stopRun`'s "a failure equal to the newest one … not repeated" (approve.ts). Re-close goes through the existing else-branch (compose → lib → `applyRow(run-ended)` → `closeIssue` → notice), not a new path; the `in-progress` rows for `run-ended` already exist in the transition table.

## Verification

**Commands:**
- `cd apps/supervisor && timeout -k 5 900 bun test --timeout 60000 test/delivery.test.ts test/approve.test.ts` -- expected: all pass
- `cd apps/supervisor && timeout -k 5 300 bunx tsc --noEmit -p .` -- expected: no errors (skip if the package has no tsconfig typecheck script)
- `cd plugins/tk-studio/lib && timeout -k 5 1800 uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && timeout -k 5 1800 uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-11-08)

- planned: rewrite only the delivery test at :482 / actual: also changed two other existing tests in `delivery.test.ts` — (a) "run-ended applied, the issue close transient, the record since moved on": the `go` case now expects a re-close from `in-progress`; the `revise` case unchanged; (b) "another process's pass tells mid-pass": the refusal half now expects `refused: [ENG]`; one exact ok-event expectation gains `stories_left: []` / why: direct consequences of the spec's post-`go` and same-reason rules / may affect: none
- planned: compute `stories_left` where `members_all` is built inside `closeout_verdicts` / actual: lookup factored into `_closeout_members`, used by `closeout_verdicts` and new `closeout_stories_left` / why: one source for the not-landed judgement, verdict shape unchanged / may affect: none
- planned: the ok event's `stories_left` comes from `lib.stories_left` / actual: on the issue-close retry path (no lib run) it is `[]` / why: no lib result on that path / may affect: none
- planned: precedent DW-51 also touched the contract header row / actual: only the engage-row field and the version-history paragraph / why: the spec names only those / may affect: none

DEVIATION SCORE (implementer): 1

DRIFT: tests beyond :482 updated in delivery.test.ts — the spec's post-go and same-reason rules change their expectations — affects: none
DRIFT: `_closeout_members` helper factored out of `closeout_verdicts` — a single not-landed source without changing verdict shape — affects: none
DRIFT: ok event on the issue-close retry path carries `stories_left: []` — no lib result on that path — affects: none
DRIFT: contract header row not amended — the spec names only the engage row and the paragraph — affects: none

### pass 2 (2026-11-08, the consult's reject-deviation patch)

- planned: deviation 3 rejected — carry `stories_left` on the `run-ended` row detail and read it on the issue-close retry path / actual: done as ruled, with the delivery.ts header and a delivery test / why: consult ruling 2026-11-08T12:29:05Z / may affect: none
- planned: run the bun command as given / actual: run with `~/.bun/bin` on PATH (no code change) / why: approve.test.ts's fake `gh` has a `#!/usr/bin/env bun` shebang, so it exits 127 without bun on PATH / may affect: none
- planned: contract edit only if the 0.1.34 paragraph describes the retry / actual: one clause added (the `run-ended` line carries `stories_left`; the retry reads it) / why: the paragraph describes the retry; the patch handoff asked for it / may affect: none

No further consult: the pass-2 entries apply the consult's own DO, or concern the verify environment. Score stays 1.

DRIFT: `run-ended` row detail gains `stories_left` — the retry path writes the ok event without running the lib — affects: none

### pass 3 (2026-11-08, review patches)

- planned: "Done" = ok event with no `go` line after it (any state) / actual: a later `go` supersedes the ok event only while the record is `in-progress` / why: a `go` re-capped to `partial` otherwise re-closes and re-notifies; the bundle intent scopes the re-close to in-progress (consult 2026-11-08T12:41:57Z, accept-deviation score 1) / may affect: none
- planned: README not named / actual: `apps/supervisor/README.md:155` closeout paragraph rewritten / why: it described the replaced rules (same consult) / may affect: none
- planned: count notices by state in the new test / actual: matched by the close-out notice text / why: the cap notice also has state `partial` / may affect: none

DRIFT: the go-supersedes-closeout rule is narrowed to an in-progress record — a go re-capped to partial otherwise re-closes and re-notifies — affects: none
DRIFT: apps/supervisor/README.md closeout paragraph updated (not in the spec's tasks) — it documented the replaced rules — affects: none

## Consult Log

- 2026-11-08T12:10:47Z — trigger: halt — question: what does "stories remain" (TKSTUDIO-218 `go` after an unstopped end) mean — queue state, `closeout.not_done`, engage.py's not-landed verdict, or a stories.yaml recompute? — ruling: apply — do: treat "stories remain" as engage.py's own `story <key> not landed` verdict in `last.job`'s epic, surfaced as an additive `stories_left` on the closeout result and copied onto the `engagement-closeout` event; step 7 resubmits on a non-empty list, else the close-out is owed again despite `told()`; never use the queue state, `not_done` or stories.yaml; pin both branches in approve and delivery tests — rule candidate: bind an owner's domain predicate to the lib verdict that already computes it, surfaced as an additive result field (observe.py record ok)
- 2026-11-08T12:29:05Z — trigger: deviation-gt-0 — question: accept or reject pass-1 deviations; is deviation 3 (ok event on the issue-close retry path carries `stories_left: []`) a defect? — ruling: reject-deviation — do: accept deviations 1, 2, 4 at score 1; reject 3: carry `stories_left` on the `run-ended` row detail on the lib pass and read it (strings only, else `[]`) on the retry path; update the delivery.ts header; add a delivery test (transient issue close, retry event `stories_left:["32-3"]`, a later go resubmits, no re-close) — rule candidate: when a retry path can skip the lib that produces a field a later decision reads, store the lib's value on the first-written input line (observe.py record ok)
- 2026-11-08T12:41:57Z — trigger: deviation-gt-0 — question: accept the review patches that (a) narrow "a go after the ok event supersedes it" to an in-progress record (a go leaving the cap unchanged, re-capped to partial, otherwise re-closes and re-notifies) and (b) update apps/supervisor/README.md:155? — ruling: accept-deviation score 1 — do: in `told()` a go at or after the ok event cancels it only while `record.state === "in-progress"`; add the unchanged-cap test; rewrite README.md:155 for the new rules; record both at score 1 — rule candidate: a state-scoped rule outranks a broader done/supersede definition; README paragraphs describing a changed pass belong in the code map (observe.py record ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T093348Z-f76978` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** DW-52: a close-out that engage.py refuses by name is now retried on every delivery pass. An `ok:false` `engagement-closeout` event and a notice go out only when the refusal reason changes. Only an ok event marks a run done. DW-53 (TKSTUDIO-218 option A): `engage.py closeout` reports an additive `stories_left` (the stories it judges not landed). The supervisor stores that list on the `run-ended` line and the ok event. After an owner `go` that follows an unstopped end, step 7 resubmits `last.job` when stories remain in its epic. Otherwise the same tick's closeout pass re-runs the close-out from `in-progress`. So the engagement is never left in-progress with no run and no report.

**Files changed.**
- `apps/supervisor/src/delivery.ts` -- the ok-only, in-progress-scoped `told()`; refusal dedup by reason; post-`go` `run-ended` line and once guard; no re-close while stories remain; `stories_left` on the `run-ended` row and the ok event; header rewritten.
- `apps/supervisor/src/approve.ts` -- exported `goAfterEnd` predicate and `CLOSEOUT_EVENT`; step 7's unstopped-end branch, sharing the stopped path's submit tail; header.
- `plugins/tk-studio/lib/engage.py` -- `_closeout_members` / `closeout_stories_left`; `stories_left` in the closeout result; docstring.
- `plugins/tk-studio/contracts/driver-contract.md` -- engage row names `stories_left`; `**0.1.34 (DW-52, DW-53, additive).**` paragraph (version stays 0.1.34).
- `apps/supervisor/README.md` -- closeout-pass paragraph brought to the new rules.
- `apps/supervisor/test/delivery.test.ts`, `apps/supervisor/test/approve.test.ts`, `plugins/tk-studio/lib/tests/test_engage.py`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the matrix rows, the retry-path `stories_left`, the re-capped `go`, and the contract pin.

**Review.** 2 patches applied (medium 1, low 1), 0 deferred, 0 rejected; Edge Case Hunter found nothing. Follow-up review recommendation: false. Patched: high 0, medium 1, low 1, score 3×1 + 1×1 = 4 (< 5).

**Verification.**
- `bun test --timeout 60000 test/delivery.test.ts test/approve.test.ts` (with `~/.bun/bin` on PATH): 110 pass, 3 skip, 0 fail.
- `bunx tsc --noEmit -p .`: exit 0.
- `uv run python -m unittest discover tests`: 3025 tests OK (4 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- Matrix audit: every I/O row is covered by a test that ran and passed.

**Deviations** (score 1; three consults, see Consult Log):
DRIFT: tests beyond :482 updated in delivery.test.ts — the spec's post-go and same-reason rules change their expectations — affects: none
DRIFT: `_closeout_members` helper factored out of `closeout_verdicts` — a single not-landed source without changing verdict shape — affects: none
DRIFT: contract header row not amended — the spec names only the engage row and the paragraph — affects: none
DRIFT: `run-ended` row detail gains `stories_left` — the retry path writes the ok event without running the lib — affects: none
DRIFT: the go-supersedes-closeout rule is narrowed to an in-progress record — a go re-capped to partial otherwise re-closes and re-notifies — affects: none
DRIFT: apps/supervisor/README.md closeout paragraph updated (not in the spec's tasks) — it documented the replaced rules — affects: none

**Residual risks.**
- approve.test.ts's fake `gh` uses a `#!/usr/bin/env bun` shebang, so the suite needs bun on PATH.
- `guards.test.ts` fails 2 tests in a shell that has `TK_ATLASSIAN_*` set. This is pre-existing and unrelated: it passes 57/57 with those variables unset.
- A refused close-out now re-runs `engage.py closeout` (up to 300 s) on every pass until it succeeds, by the owner's decision.
- `goAfterEnd` does not check the cap itself; it relies on step 7's cap gate and on step 2 re-capping first.
- Operator: rebuild `apps/supervisor` and restart the supervisor after merge (serve-process files changed).

## Reconcile

- 2026-11-08 — score 1; reconcile not required.

Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met (refusal retry/dedup at delivery.test.ts:495-508; go after unstopped end at delivery.test.ts:652 and approve.test.ts:1536; `stories_left` at test_engage.py:2026; contract pin at test_driver_contract.py:3716; verify gate green per the Auto Run Result)
