---
title: 'The Pause Path Finished'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_revision: '5093d241df5e5177d6844cbd31181d8abb24940c'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-38/plans/38-5.md'
  - '{project-root}/AGENTS.md'
warnings: [multiple-goals, oversized]
deferred: []
---

> **Serve process changes.** `worktree.ts`, `closeout.ts` and `cli.ts` run inside `serve`. The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge (SPEC Constraints).

<intent-contract>

## Intent

**Problem:** Story 37.3's clock-as-pause left holes (the Epic 37 retrospective's B5 to B8; DW-166, DW-176, DW-177): a non-sweep pause runs its host leg inline in the engines loop before the `awaiting-ruling` notice; a pause leg and the later boundary end run two legs on the same commits; a checkout with no policy gets a stub, and a non-bare `[scm]` form fails the edit; `own_block` resubmissions are unbounded; an engine-clock pause tags the owner; the late close-out paths mark a draft ready with no leg; a `<key>-s2` spec makes the first half's spec lookup ambiguous.

**Approach:** Implement plan `plans/38-5.md` Settled shape 1-10 as written. That means: notice and block first, then the leg in its own pass (`pausedLegs`); one leg per code head (`code_head`); a refusal instead of a stub, plus a TOML-aware edit; `stop.max_own_blocks`; `track.py block --kind engine`; the three late paths as drafts with their records; one split-spec rule in three places. The contract's 0.1.34 entry is extended (additive).

### Acceptance criteria (story 38.5, transcribed verbatim from epics.md)

- **AC1.** **Given** `worktree.ts:1221, :1245` (`if (!verify && notKilled) hostVerify(...)` inline in the engines loop, before `closeOutPaused`'s `awaiting-ruling` notice), `recordedVerify` (`worktree.ts:941`: legs before the latest `paused` ignored) and `closeOutLanded → boundaryLeg` (`closeout.ts:477-483`) **When** a run pauses on a ruling with commits landed and later ends at the boundary on the same commits **Then** the `awaiting-ruling` notice and the issue's block go out before the leg, the leg runs off the engines loop in its own pass (other runs' ticks never wait behind it), and the boundary end reuses a leg recorded for the same head (`recordedVerify` matches by commit, not by position after `paused`), so one commit set gets one leg; the supervisor suites pin pause-then-boundary
- **AC2.** **Given** `runWorktreeRollback` (`worktree.ts:241-258, :330`: a stub policy written where the checkout has none; the text edit at `:227-233` matching only a bare boolean under `[scm]`) and `launch.py sweep`'s gap check (`launch.py:1848-1849`) **When** the pin writes the run worktree's policy **Then** a checkout with no `.bmad-loop/policy.toml` is refused by name (`WorktreeFailed("policy: none in the checkout")`), never given a stub; the edit parses the file (`Bun.TOML.parse`) and sets `scm.rollback_on_failure = true` whatever the file's form (a quoted value, a dotted key, an inline table), every other byte kept where the form allows and the file re-serialised when not, verified by a parse after the write; the suites pin the four forms
- **AC3.** **Given** an `own_block` run (`jobrun.py:263-265`: counted toward neither `max_runs` nor `on_status`; `cli.ts:1800`), the paused-run pass's `track.py block` for an engine-clock pause (`closeout.ts`; DW-176), DW-64's remainder (the late terminal close-out, `closeOutNow`, `cancel`; DW-166) and the `<key>-s2` spec glob (DW-177: `plansync._stage_target`, `closeout.findSpec`, `task-planning.md` section 3) **When** these paths run **Then** a cadence job's `own_block` runs are bounded (`stop.max_own_blocks`, default 3, the stop line naming the cause) and `test_jobrun` pins it; an engine-clock pause (the journal's `session-end status timeout` or `paused_reason`) blocks the issue with `no owner action` and no mention (`track.py block --kind engine`) or sends only the notifier line; the late terminal close-out, `closeOutNow` and `cancel` each leave the records DW-64 named (the plan status, the stage row, the `job-run` line), pinned; a split story's spec resolves by the exact `<key>-spec.md` first and by the prefix glob only when one file matches, `-s2` and `-r<n>` excluded from the first half's glob, in `_stage_target`, `findSpec` and the planning doc; DW-166, DW-176 and DW-177 close by this PR; the contract names the rules (0.1.34, additive)

## Boundaries & Constraints

**Always:**
- The plan's Settled shape 1-10 are planner rulings. Implement them as written. The either/or in AC3 is settled as `track.py block --kind engine` (shape 6). The CAP-14 serialiser question is settled as a targeted per-form edit first, with `Bun.TOML.stringify` as the verified fallback (shape 4).
- The plan's Files list is the boundary.
- The paused leg's guard is 38.1's `legGuard(queue.definition(run))` (`hostverify.ts`). There is no second guard rule.
- `--kind engine` is a `--source run` form only. Keep 38.4's `--source sweep` refusal of `--kind`.
- The house rules apply:
  - Studio Python is stdlib-only, run via `uv run`, and names `encoding="utf-8"` on every text open.
  - Writes are atomic (the policy write: a tmp file renamed onto the file).
  - Pathspecs are argv-only with bracketed globs.
  - Every `bun test` names `--timeout`.
  - Nothing in the plugin imports the supervisor.
- Contract 0.1.34 stays additive:
  - The header clause goes after 38.4's.
  - `, Story 38.5` goes after `Story 38.4` in the Stories row.
  - The `**0.1.34 (Story 38.5, additive).**` paragraph goes directly after 38.4's paragraph (before the DW-51 paragraph), so it sits before `## 8. Conformance`.
  - Pin `test_0_1_34_story_38_5_the_pause_path_finished` after `test_0_1_34_story_38_4_…`.
- The ledger closures use the in-loop form `resolved 2026-11-08 by Story 38.5 (…)` on DW-166, DW-176 and DW-177.

**Block If:**
- The Files list must grow past the plan's Files or past band L. In that case use the `halt` consult. Its split candidates are in plan Risks (i)-(vi). Never split the story here.
- The fixture default policy (`fakes.ts`) breaks an assertion that the policy does not cause. That needs the `deviation-gt-0` consult.
- A resume must run while a paused leg is live, beyond the `RunNotPaused` "held by a live process" answer. Or the paused leg's PR flip must also write a `closed_out` or rewrite the `paused` event. Either needs a consult (bad_spec).
- `delivery.ts:158`, `office.ts:250` or `planstatus.ts ownerSpecPresent` turn out to resolve a spec for a decision, not just check presence. They are outside Files, so use the `file-outside-files` consult before touching them.

**Never:**
- No stub policy.
- No new lease kind, and no killing a live leg.
- No `cli.ts` change for `max_own_blocks`. The wake's refusal is the stop.
- No edit of bmad-loop upstream or stock skills.
- No push, tag, PR or release motion.
- No edit of `epics.md`, `stories.yaml`, the plan files, `policy.toml` or `routing.toml`.
- No refactor outside the named symbols.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Pause, then the boundary | A non-sweep run pauses on a ruling with commits; later it lands `complete` with only the harvest commit added | The `paused` close-out is a draft with no leg; `closeOutPaused` posts `awaiting-ruling` and blocks; `pausedLegs` runs exactly one leg with `code_head` and flips the PR ready on green; the boundary reuses it (one `host-verify` that ran) | A dirty tree: one `host-verify {skipped, reason: "paused: dirty tree", code_head}`, the PR stays a draft |
| `pausedLegs` lease | A run is held by `takeForCloseOut` mid-leg | A resume answers `RunNotPaused` ("held by a live process"); at most one leg per pass | Released in `finally` |
| The policy is missing | The worktree has no `.bmad-loop/policy.toml` after the copy | `worktree policy: none in the checkout`; nothing written | The run ends `blocked` as a prepare step |
| The policy's forms | Bare `false` + comment / `"false"` under `[scm]` / dotted `scm.rollback_on_failure = false` / `scm = { rollback_on_failure = false }` | The value replaced, every other byte kept (CRLF too); a parse after the write reads `true` | — |
| Policy fallback | A multi-line inline table or an `[scm.sub]`-only form | Re-serialised with `Bun.TOML.stringify`; the deep-equal check passes | No stringify, or the check fails → refused by name, original restored |
| Policy already true | `scm.rollback_on_failure === true` | No write | — |
| `max_own_blocks` | A recurring job whose last 3 counted runs all carry `own_block` | `stop: max_own_blocks (3) reached — the last 3 runs ended on the supervisor's own block (<kind>)` | A one-shot job is never stopped by it; a bad value fails `job.py validate` |
| Engine-clock pause | `paused_reason` contains "session timeout", or the journal's latest `session-end` before `run-paused` has `status: timeout` | `track.py block --kind engine`; the comment `Blocked (engine): … — no owner action`, no `[~accountid:…]`; `track-block.kind: "engine"`; no notifier | `--kind` other than `engine` with `--story` → exit 2 |
| Late paths | Late terminal close-out / `closeOutNow` / cancel with no vouching leg | `closeOut(... killed: true)` → draft; `closeout.result "draft PR"` + `pr` on `closed_out`/`ended.detail`; one job-run line | `complete` + a green/skipped leg, or no engine launched → ready as before |
| Split spec | `stories/K-spec.md` and `stories/K-s2-spec.md` exist | `K-spec.md` | Exact name absent: the glob excluding `^(s\|r)\d+(-.*)?\.md$` rests; several matches left → today's ambiguity answer |

</intent-contract>

## Code Map

The investigation is plan `plans/38-5.md`: its Code Map and its "Refreshed at the 38-4 gate" block. Load it. Anchors re-checked at HEAD `5093d241df5e5177d6844cbd31181d8abb24940c`. The refresh holds except as noted below.

- `apps/supervisor/src/worktree.ts`:
  - `WorktreeFailed` :151; `COPIED_RUNTIME` :224, `RUN_POLICY` :227; `withRunWorktreeRollback` :232, `runWorktreeRollback` :250. These carry AC2.
  - `PAUSED_DIRTY` :636, `treeClean` :650. Their pathspecs are reused by the new `codeHead`.
  - `markPrReady` :718, `markPrDraft` :727, `closeOut` :753, `priorPr` :957.
  - `recordedVerify` :969 gains a `codeHead?` argument.
  - `findSpec` :1036 gets the split rule here (`closeout.ts` re-exports it).
  - `sweepEngines` :1458:
    - The late terminal close-out (~:1476-1490) gets the `killed` rule.
    - `paused` :1586, `verify` :1594. The inline paused leg is removed here, and `code_head` goes on its legs.
- `apps/supervisor/src/closeout.ts`:
  - `pausedStory` :154, `gracefulStopInForce` :399 (the journal-read pattern for `engineClockPause`).
  - `boundaryLeg` :460 matches by code head. `closeOutLanded` :586.
  - `escalationBlocked` :703 is where the engine-clock check applies. `trackArgs` :712 (a `const` arrow) gains the kind. `trackBlock` :721.
  - `closeOutPaused` :901.
  - The new exported `pausedLegs`.
  - `resumePaused` :1251, whose `RunNotPaused` comes via `queue.resumeFromPause`.
- `apps/supervisor/src/cli.ts`:
  - The `closeOutPaused` finally blocks at :723, :1008 and :1652. Add `pausedLegs` as the last pass (after `sweepEnds`, before `queue.close()`).
  - `cancelQueueRun` :1148 (its `closeOutNow` :1259).
  - `closeOutNow` :1868, called at :1679 and :1835 (`s.state` and `terminal` in scope).
- `plugins/tk-studio/lib/jobrun.py`: `evaluate_stop` :256 (`max_own_blocks` after `max_runs`, before `until`), `OWN_BLOCK_KINDS` :398.
- `plugins/tk-studio/lib/job.py`: `STOP_KEYS` :76 (from the schema), `_validate_stop` :207.
- `plugins/tk-studio/contracts/job.schema.json`: `stop.fields`, with `max_runs` at ~:56.
- `plugins/tk-studio/lib/track.py`:
  - `comment_body` :311, `_block_issue` :396, `block` :451.
  - The argparse for `--kind` and the `--source sweep` refusal sit near :1755 and :1881-1892. Re-grep them.
- `plugins/tk-studio/lib/plansync.py`: `_stage_target` :2441.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md`: the §3 "Over the dev clock" paragraph at :86. Mirror it in `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md`; line 18 stays the only diff (`test_nest_pipeline.py`).
- `plugins/tk-studio/contracts/driver-contract.md`:
  - Header line 5 and the Stories row on line 6.
  - The 38.4 paragraph starts at :2816. It is followed by DW-51 :2900 and DW-52/53 :2927, then `## 8. Conformance` :2949.
  - Re-grep `stop.max_runs` and `after_stories` for the job-schema row, and `track.py block` for the block shapes.
- `_bmad-output/implementation-artifacts/deferred-work.md`: DW-166 :1407, DW-176 :1491, DW-177 :1499. Re-grep each status line.
- Tests:
  - `apps/supervisor/test/worktree.test.ts`: the policy cases from ~:185. Move the 37.3 paused-leg cases to the new pass; re-grep them by name.
  - `closeout.test.ts`: `findSpec` ~:150; the escalation-block cases.
  - `api.test.ts`: the cancel cases.
  - `fakes.ts`: `RUNTIME_GITIGNORE` :394, `gitRepo` :413. Default an untracked policy, with an opt-out.
  - Lib tests: `test_jobrun.py`, `test_job.py`, `test_track.py`, `test_plansync.py`, `test_planner_rules.py` and `test_driver_contract.py` (after :3649).

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/worktree.ts`:
  - `codeHead(run, deps)` (shape 2).
  - `recordedVerify(events, codeHead?)` (shape 2).
  - `sweepEngines`: no paused leg; the code head passed in; `code_head` recorded on legs; the late close-out's `killed` rule (shape 7a).
  - `runWorktreeRollback` and `withRunWorktreeRollback`: the refusal, the four forms and the stringify fallback (shapes 3-4).
  - `findSpec`: the split rule (shape 8).
- `apps/supervisor/src/closeout.ts`:
  - `pausedLegs` (shape 1).
  - `boundaryLeg` passes the code head and records `code_head`.
  - `engineClockPause`, `trackArgs` gains the kind, and the engine block lands on the `escalationBlocked` path (shape 6).
  - Header text.
- `apps/supervisor/src/cli.ts`:
  - `pausedLegs` in the three finally blocks.
  - `closeOutNow` takes the end state and applies `killed` (shape 7b).
  - The cancel passes `cancelled` (shape 7c).
- `plugins/tk-studio/lib/jobrun.py` and `job.py`, plus `contracts/job.schema.json`: `stop.max_own_blocks` (shape 5).
- `plugins/tk-studio/lib/track.py`: `block --story … --kind engine` comment with no mention; any other `--kind` with `--story` gets exit 2; docstring (shape 6).
- `plugins/tk-studio/lib/plansync.py`: `_stage_target`'s rule (shape 8).
- Both `task-planning.md` copies: the §3 sentence from shape 8, identical in each.
- `plugins/tk-studio/contracts/driver-contract.md`: the clause, the row entry, the paragraph (shape 9), the job-schema row and the block shapes.
- `_bmad-output/implementation-artifacts/deferred-work.md`: DW-166, DW-176 and DW-177 resolved by Story 38.5.
- Supervisor tests (`worktree.test.ts`, `closeout.test.ts`, `api.test.ts`, `fakes.ts`):
  - The four forms, the fallback and the refusal.
  - The fixture policy.
  - Pause-then-boundary, one leg.
  - The pass's order (notice and block before the leg) and its lease.
  - The engine block.
  - The late paths' records.
  - `findSpec`.
- Lib tests (`test_jobrun.py`, `test_job.py`, `test_track.py`, `test_plansync.py`, `test_planner_rules.py`, `test_driver_contract.py`): the cases above, plus `test_0_1_34_story_38_5_the_pause_path_finished`.

**Acceptance Criteria:** AC1-AC3 as transcribed in the intent contract. Each is proven by the pinned tests and the Verification commands below.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass

Both layers ran (band L): `blind-hunter` and `edge-case-hunter`, opus-5-5 medium.

- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 1, medium 3, low 4)
- defer: 0
- reject: 1 (medium 1): B3 — `pausedLegs` awaited in `recoverQueue`'s finally delays `tick.ts`'s job wakes. Rejected per the consult (Reading A): AC1's "ticks" are retro B5's engines-loop wait; the wake path already waited behind `recoverQueue`'s inline leg and is now bounded to one leg per pass; `tick.ts` is outside Files.
- addressed_findings:
  - `[high]` `[patch]` A slice run that paused reused the pause's code-only leg at its final close-out, so it got no assets proof. Fixed by consult ruling (a): `legForHead`/`recordedVerify` take `slice` and skip legs with no `assets` record, passed from `sweepEngines` and `boundaryLeg`. Pinned.
  - `[medium]` `[patch]` The boundary reused a `paused: dirty tree` skip at the same head. Fixed: a dirty skip is never returned by `recordedVerify`. Pinned.
  - `[medium]` `[patch]` A second pause on a dirty tree reused an earlier green leg and marked the PR ready. Fixed: the pause reuses a head's leg only on a clean tree; `pausedLegs` eligibility looks only at records since the latest `paused`. Pinned.
  - `[medium]` `[patch]` The late close-out's `leavesReady` counted dirty-tree and paused-sweep skips as vouching. Fixed by excluding them. Pinned.
  - `[low]` `[patch]` The late terminal close-out's ready branch was untested. Tests added: a green leg, the `no verify.host` and host-tier skips, and no engine launched.
  - `[low]` `[patch]` AC3's derived records. The stage rows are now asserted via `supervisorRows`, and `closed_out.detail.pr` is asserted.
  - `[low]` `[patch]` `test_planner_rules.py` had a doubled `skipUnless` and the next test was missing its decorator. Restored.
  - `[low]` `[patch]` The `boundaryLeg`/`codeHead` comments claimed the harvest touches only `_bmad-output/`. Reworded to describe the `git add -A` harvest.

### 2026-11-08 — Review pass (follow-up, review_loop_iteration 0)

Both layers ran (band L): `blind-hunter` and `edge-case-hunter`, opus-5-5 medium, over `git diff 5093d241df5e5177d6844cbd31181d8abb24940c` (the loop's own spec and stage files excluded).

- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 1, low 0)
- defer: 0
- reject: 5 (high 0, medium 3, low 2)
  - E1 (medium): the tick's job wakes wait behind `recoverQueue`'s `await pausedLegs` (`cli.ts:84`, `tick.ts:261`). This was already ruled by the 16:15:31Z consult (Reading A: AC1's "ticks" are retro B5's engines-loop wait). The same question is never consulted twice.
  - E2 (medium): `runJob`'s and `drainQueue`'s finally blocks await `pausedLegs` (`cli.ts:109`). The same consult ruling covers it: keep `pausedLegs` as the last pass of the recoverQueue/drainQueue/run finally blocks.
  - E3 (low): `engineClockPause`'s `/\bsession timeout\b/` could match a ruling's free-text `paused_reason`. That regex is plan Settled shape 6's detection rule verbatim (`plans/38-5.md:67`), and the engine writes `dev session <status>`.
  - B2 (medium): a guard-inconclusive pause leg is reused at the boundary on the same head. That is AC1's literal "one commit set gets one leg". An inconclusive guard leg is 38.1's designed `partial` end, and before 38.5 an inconclusive leg after `launched` was reused the same way.
  - B3 (low): the `max_own_blocks` streak never resets once scheduling stops. That is plan Settled shape 5's rule ("a recurring job stops scheduling once its last N counted runs all ended on own_block"). The stop is the bound.
- addressed_findings:
  - `[medium]` `[patch]` B1: `track.py _open_blocks` matched only `"Blocked: "`, so an issue's own `Blocked (engine): … — no owner action` comment never counted as its own block. A dependent blocked by A that also carries an engine-clock block was moved out of `Blocked - Awaiting User` when A unblocked, while its run was still paused. This broke plan shape 6's "dependents unchanged". Fixed: a stripped body starting with `Blocked (engine): ` also sets `own`. Pinned by `test_track.UnblockTests.test_story_38_5_a_dependent_with_its_own_engine_block_stays`, which fails without the fix.

## Deviation Summary

### pass 1 (2026-11-08, implementer)

- planned: the plan's Files list is the boundary (supervisor tests named: `worktree.test.ts`, `closeout.test.ts`, `api.test.ts`, `fakes.ts`) / actual: `apps/supervisor/test/sweep.test.ts` also edited (two lines: the prefixed sweep fixture writes `FIXTURE_POLICY` at its nested root) / why: the new policy refusal broke the prefixed sweep test and `gitRepo` cannot know the prefix; the `halt` consult was not run before the edit / may affect: none
- planned: pin the cancel's records in `api.test.ts` / actual: `api.test.ts` unchanged; the cancel's draft PR, `pr` on `ended.detail` and the single `finish --total-cost-usd` line pinned in `worktree.test.ts` cancel tests / why: `api.test.ts`'s fixture has no worktree or PR / may affect: none
- planned: `trackArgs(root, key, reason, spec, "engine")` / actual: `trackArgs(root, key, reason, spec, kind?, runId?)` / why: `--resolves` must name `POST /runs/<run id>/resume` / may affect: none
- planned: `pausedLegs` eligibility as listed in plan shape 1 / actual: also skips `paused_stage: "no-story"` pauses / why: ended engines with no commits that 38.2 already closes as "no changes"; keeps 37.3/38.2's no-leg behaviour / may affect: none
- planned: `closeOutNow` gains the end state / actual: a trailing required parameter `(…, skip, end)`; the no-engine test also reads `input.engineRunId` / why: smallest signature change; a status block naming an engine counts as a launch / may affect: none
- planned: the TOML edit's named refusals / actual: an extra refusal `scm is not a table`; `withRunWorktreeRollback` stays exported and returns the text unchanged when no in-place form exists (internal `rollbackLineEdit` returns undefined) / why: setting the key would replace a non-table value, so "every value kept" could not hold / may affect: none
- planned: `code_head` on supervisor legs / actual: also on skipped leg records (38.2 `no changes`, `no verify.host`, `host-tier`), so five 38.2 and two 27.4 test assertions gained `code_head: expect.any(String)` / why: the plan says every leg the supervisor records carries it / may affect: none

DEVIATION SCORE (implementer): 2
DEVIATION SCORE (consult): 1 — sweep.test.ts edit is the plan's policy-caused fixture fix (plans/38-5.md:111); no seam 38-6/38-7 relies on

DRIFT: `apps/supervisor/test/sweep.test.ts` edited outside Files (fixture policy at the nested prefix root) — the policy refusal broke the prefixed sweep fixture — affects: none
DRIFT: cancel's records pinned in `worktree.test.ts`, not `api.test.ts` — the api fixture has no worktree or PR — affects: none
DRIFT: `trackArgs` gains a sixth `runId?` parameter — `--resolves` names the run's resume route — affects: none
DRIFT: `pausedLegs` skips `no-story` pauses — 38.2's no-changes end owns them — affects: none
DRIFT: `closeOutNow` takes a trailing `end` parameter; engine launch also read from `input.engineRunId` — smallest signature change — affects: none
DRIFT: extra policy refusal `scm is not a table`; `withRunWorktreeRollback` returns text unchanged when no in-place form — every value must be kept — affects: none
DRIFT: `code_head` also on skipped leg records; 7 older assertions gained `code_head: expect.any(String)` — every supervisor leg record carries it — affects: none

### pass 2 (2026-11-08, implementer, review patches)

- planned: the review limited this pass to its eight items / actual: the story's own `**0.1.34 (Story 38.5, additive).**` contract paragraph extended (the `codeHead` wording: the harvest is `git add -A`; one sentence naming the slice, dirty-tree and clean-tree reuse exceptions and the late close-out's by-design vouching skips) / why: otherwise the paragraph states superseded rules; existing contract-test phrases pass / may affect: none
- planned: `pausedLegs` eligibility looks only at records since the latest `paused` (item 3) / actual: that, plus a skip on a clean tree whose head already has a ran leg / why: the pause's close-out already reused that leg; a second leg would break one leg per code head / may affect: none
- planned: item 6 pins the plan-status PR source via a planstatus helper / actual: `closed_out.detail.pr` asserted directly; the stage row via `supervisorRows` / why: `planstatus.ts` exports no such helper and is outside Files / may affect: none

DEVIATION SCORE (implementer, pass 2): 1
DEVIATION SCORE (consult, pass 2): 1 — the paragraph is the story's own and restates consult-amended rules; the extra skip enforces shape 2; the PR pin is shape 7's planned pin

DRIFT: the 38.5 contract paragraph also states the review-amended reuse exceptions and the `git add -A` harvest — the paragraph must state the rules as built — affects: none
DRIFT: `pausedLegs` skips a clean-tree head already covered by a ran leg — one leg per code head — affects: none
DRIFT: plan-status PR source pinned via `closed_out.detail.pr` — planstatus.ts exports no helper and is outside Files — affects: none

### pass 3 (2026-11-08, implementer, follow-up review patch B1)

- planned: the B1 pin test's dependent carries only its own engine-block comment / actual: the dependent also carries an earlier `Blocked: x` / `Blocked by: KEY-1` comment before the engine-block comment / why: with only the engine comment no key is named, so the old code already skipped the dependent and the test could not tell the fix from the old code / may affect: none

DEVIATION SCORE (implementer, pass 3): 1
DEVIATION SCORE (consult, pass 3): 1 — the test's arrangement only, inside Files; not the story, the spine or the contract

DRIFT: the B1 pin test's dependent also carries a `Blocked by: KEY-1` comment — an engine-only arrangement passes on the pre-fix code — affects: none

## Consult Log

- 2026-11-08T16:03:37Z — trigger: deviation-gt-0, file-outside-files — question: accept the sweep.test.ts fixture edit (outside Files) and the six pass-1 deviations, and at what score? — ruling: accept-deviation score 1 — do: keep the two-line sweep.test.ts fixture edit and all six deviations, revert nothing; add the consult score line under the implementer's score; continue to Verify — rule candidate: a test file outside Files that fails only because the story's own new refusal or fixture default fires on a shared fixture may take that minimal fixture fix as a score-1 DRIFT without a consult, provided the plan's Verify already runs that file.

- 2026-11-08T16:15:31Z — trigger: high-severity-finding — question: a slice run that paused reuses the pause's code-only leg at its final close-out (no assets proof); patch or intended? — ruling: apply — do: option (a): legForHead/recordedVerify take an optional slice flag and, when set, skip ran host-verify records with no assets record; pass isSlice(queue.definition(run)) from sweepEngines and boundaryLeg; non-slice rule and record shape unchanged; pin a paused slice run ending on the same code_head runs hostVerify with slice: true and records assets, a non-slice run still reuses — rule candidate: a plan that reuses a recorded host-verify across call sites names its slice treatment; a leg run without opts.slice never stands in for a slice run's final close-out leg.
- 2026-11-08T16:15:31Z — trigger: reading choice (review finding B3) — question: does AC1's "other runs' ticks never wait behind it" cover tick.ts's job wakes awaited after recoverQueue? — ruling: apply (Reading A, reject the finding) — do: keep pausedLegs as the last pass of the recoverQueue/drainQueue/run finally blocks, tick.ts unchanged; record that AC1's ticks are retro B5's engines-loop wait, the wake path already waited behind recoverQueue's inline leg and is now bounded to one leg per pass, out of scope — rule candidate: when an AC quotes a retrospective finding, read its terms with the scope that finding gives them; a pre-existing wait the story does not lengthen is out of scope for review.
- 2026-11-08T16:34:22Z — trigger: deviation-gt-0 (pass 2) — question: accept the three pass-2 deviations (own contract paragraph extended, pausedLegs clean-tree skip, PR source pinned on the event) and at what score? — ruling: accept-deviation score 1 — do: keep all three, revert nothing; add the consult score line; continue to Verify — rule candidate: when a consult ruling amends a rule the story's own contract paragraph restates, the implementer updates that paragraph in the same pass as a score-1 change without a new consult, if existing contract-test phrases pass and no new field or kind is named.
- 2026-11-08T16:47:54Z — trigger: deviation-gt-0 (follow-up review, B1 patch) — question: accept the B1 pin test's arrangement (an earlier `Blocked: x` / `Blocked by: KEY-1` comment before the engine-block comment, since an engine-only arrangement passes on the old code), and at what score? — ruling: accept-deviation score 1 — do: keep test_story_38_5_a_dependent_with_its_own_engine_block_stays with the earlier `Blocked by: KEY-1` comment; record it in the deviation log as score 1 (local: the test's arrangement only) — rule candidate: a regression test for a fix must fail on the pre-fix code; when the planned arrangement would already pass on the old code, add the smallest preceding state that makes it fail, and log it as a score-1 deviation without a consult.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-07T20:38:28Z | 2026-11-07T21:02:55Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-08T08:24:05Z | 2026-11-08T08:25:37Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-08T15:18:21Z | 2026-11-08T16:35:15Z | fbc9af42-8bb6-4920-be3b-6c9447f9ff82 | claude-opus-5-5 | medium | 51854037 | 232715 | 22.6198 | completed |
| review | 1 | 2026-11-08T16:35:16Z | 2026-11-08T16:54:26Z | 89ac179d-8be3-4e6d-a221-a52ca86a7c83 | claude-opus-5-5 | medium | 8847379 | 72717 | 5.7013 | completed |
| gate | 1 | 2026-11-08T16:54:26Z | 2026-11-08T16:57:36Z | 8c126a6c-dad4-4379-97e3-36d0d049062a | claude-opus-5-5 | medium | 2850047 | 14767 | 1.7282 | completed |

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests`. Expected: OK.
- From `plugins/tk-studio/lib`: `uv run python ../contracts/conformance/runner.py run`. Expected: `ok: true`.
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_jobrun tests.test_job tests.test_track tests.test_plansync tests.test_stage_log tests.test_planner_rules tests.test_nest_pipeline tests.test_driver_contract tests.test_release_roster tests.test_dwledger`. Expected: OK.
- `cd apps/supervisor && env -u TK_ATLASSIAN_SITE -u TK_ATLASSIAN_EMAIL -u TK_ATLASSIAN_TOKEN ~/.bun/bin/bun test --timeout 30000`. Expected: 0 fail.
- `cd apps/supervisor && ~/.bun/bin/bun node_modules/typescript/bin/tsc --noEmit -p .`. Expected: clean.

**Unverifiable here (operator):**
- The Windows host leg: `uv run tools/verify_host.py`.
- A live engine-clock pause and a live pause-then-boundary on the box.
- The serve restart after the merge.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261108T151649Z-12bae3` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Pass.** This was a follow-up review of the done story, since the first run recommended one. The implementation is in commit `6038443542361c3ff44489ca67fdedc350ddfbaf`, and this pass reviewed the whole diff since the baseline `5093d241df5e5177d6844cbd31181d8abb24940c`.

**Serve process.** `worktree.ts`, `closeout.ts` and `cli.ts` run inside `serve`. The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge. This pass changed no supervisor source.

**Summary.** The story's change is unchanged from the first run (see its record above, in the commit and the logs). This pass fixed one defect in AC3's engine block. `track.py`'s `_open_blocks` now counts an issue's own `Blocked (engine): …` comment as its own block, so unblocking story A no longer moves a dependent that is still engine-paused out of `Blocked - Awaiting User`. This matches plan shape 6: "dependents unchanged".

**Files changed (this pass):**
- `plugins/tk-studio/lib/track.py` — `_open_blocks` treats a stripped body starting with `Blocked (engine): ` as the issue's own block; the docstring names both forms.
- `plugins/tk-studio/lib/tests/test_track.py` — `UnblockTests.test_story_38_5_a_dependent_with_its_own_engine_block_stays` (asserts `_open_blocks` returns `({KEY-1}, True)`, and that the dependent stays Blocked, is skipped, and is not commented).
- `_bmad-output/specs/spec-epic-38/stories/38-5-the-pause-path-finished-spec.md` — this record; the stage rows the loop folded in (`stages/38-5-the-pause-path-finished.jsonl` removed by the loop, committed as found).

**Review.** Both layers ran (band L).
- 1 patch applied: medium 1.
- 0 deferred.
- 5 rejected: E1, E2 (already ruled by the earlier consult), E3, B3 (plan shapes 6 and 5 verbatim), B2 (AC1's "one commit set gets one leg").

**Follow-up review recommended: false.** Patched: high 0, medium 1, low 0. The score is 3×1 + 0 = 3, which is below 5, and no patch was high.

**Consults: 1** (deviation-gt-0, the pin test's arrangement): `accept-deviation score 1`. Recorded with `observe.py`.

**Verification.** Run by this session after the patch.
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): Ran 3037 tests, OK (skipped=4).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, failures `[]`.
- The targeted modules (`test_jobrun` … `test_dwledger`): Ran 668 tests, OK (skipped=1).
- `bun test --timeout 30000` (apps/supervisor, `~/.bun/bin` on PATH, every `TK_ATLASSIAN_*`, `GH_TOKEN`, `SBX_CRED_*` and `BMAD_LOOP_*` unset): 2104 pass, 95 skip, 0 fail across 2199 tests.
- `bun node_modules/typescript/bin/tsc --noEmit -p .`: clean (exit 0).

**Unverifiable here (operator):**
- The Windows host leg: `uv run tools/verify_host.py` on the box.
- A live engine-clock pause, and a live pause-then-boundary run.
- The serve restart after the merge.

**Residual risks:**
- `jirabackend.block_answered` still matches only the mentioned `Blocked:` line. An owner reply under an engine block is not read as an answer. This is by design: an engine block asks no owner action.
- A guard-inconclusive pause leg is reused at the boundary on the same head, and the run ends `partial` with a draft PR. A fresh leg needs an operator re-run.
- The first run's residual risks stand: a checkout with no policy blocks at prepare, a red slice leg is re-run on a retried boundary pass, and the tick's wakes wait behind one paused leg per pass.

DRIFT: the B1 pin test's dependent also carries a `Blocked by: KEY-1` comment — an engine-only arrangement passes on the pre-fix code — affects: none

## Reconcile

- 2026-11-08 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 38-6-the-gates-coverage-widened (plan refreshed in place; stage start/stop ok)
